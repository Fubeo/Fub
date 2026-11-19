use super::*;
use fub_abi::format::ParseContext;
use fub_abi::locale::days_from_civil;
use fub_abi::FormatProvider;
use fub_sdk::testing::MemoryHost;

/// Il modello di una nota, letto dal provider Markdown vero.
fn model(doc: &str, source: &str) -> DocumentModel {
    fub_format_markdown::MarkdownProvider::new()
        .parse(&source.into(), &ParseContext::obsidian(doc))
        .expect("parses")
}

fn indexed(notes: &[(&str, &str)]) -> ReminderIndex {
    let mut index = ReminderIndex::new();
    let models: Vec<DocumentModel> = notes.iter().map(|(doc, src)| model(doc, src)).collect();
    assert!(index.on_documents_indexed(&models).is_empty());
    index
}

fn minute(text: &str) -> i64 {
    reminder_minute(text).unwrap_or_else(|| panic!("{text} is a reminder time"))
}

fn whens(list: &ReminderList) -> Vec<(&str, &str, &str)> {
    list.reminders
        .iter()
        .map(|r| (r.doc.as_str(), r.when.as_str(), r.text.as_str()))
        .collect()
}

/// Un istante UTC scritto come un orologio da parete.
fn utc(year: i64, month: u64, day: u64, hour: u64, min: u64) -> u64 {
    (days_from_civil(year, month, day) as u64 * 1_440 + hour * 60 + min) * 60_000
}

/// Un host con l'orologio a `utc_millis` e il fuso a `offset` minuti: il
/// doppio parte da un istante suo, e lo si sposta fin lì.
fn host_at(utc_millis: u64, offset: i16) -> MemoryHost {
    let host = MemoryHost::new().with_locale(Locale {
        language: "it".into(),
        utc_offset_minutes: offset,
        ..Locale::default()
    });
    let start = fub_abi::traits::HostEnv::now_unix_millis(&host);
    if utc_millis >= start {
        host.advance(utc_millis - start);
    } else {
        host.backtrack(start - utc_millis);
    }
    host
}

/// Uno sguardo del notificatore: l'ora del muro dell'host, la finestra, e i
/// promemoria che l'indice ci mette dentro.
fn look(watch: &mut ReminderWatch, index: &ReminderIndex, host: &MemoryHost) -> Vec<String> {
    match watch.look(civil_now(host)) {
        WatchStep::Nothing => Vec::new(),
        WatchStep::Ask { after, until } => index
            .between(Some(after), Some(until), REMINDER_LIMIT)
            .reminders
            .into_iter()
            .map(|r| r.text)
            .collect(),
    }
}

#[test]
fn only_open_tasks_with_a_readable_reminder_enter() {
    let index = indexed(&[(
        "a.md",
        "- [ ] Chiamare Mario ⏰ 2026-11-13 09:30 📅 2026-11-14\n\
         - [x] Già fatto ⏰ 2026-11-13 08:00\n\
         - [ ] Senza ora ⏰ 2026-11-13\n\
         - [ ] Refuso ⏰ 2026-02-30 09:00\n\
         - [ ] Nessun promemoria 📅 2026-11-13\n\
         - [/] In corso ⏰ 2026-11-13 10:00\n\
         > - [ ] In una citazione ⏰ 2026-11-12 18:00\n\
         - Voce\n  - [ ] Annidato ⏰ 2026-11-13 07:15\n",
    )]);
    assert_eq!(
        whens(&index.between(None, None, REMINDER_LIMIT)),
        vec![
            ("a.md", "2026-11-12 18:00", "In una citazione"),
            ("a.md", "2026-11-13 07:15", "Annidato"),
            ("a.md", "2026-11-13 09:00", "Senza ora"),
            ("a.md", "2026-11-13 09:30", "Chiamare Mario 📅 2026-11-14"),
            ("a.md", "2026-11-13 10:00", "In corso"),
        ],
        "a checked task, a typo and a task without ⏰ stay out; no time is nine"
    );
}

#[test]
fn the_index_follows_the_vault_and_rebuilds_from_it() {
    let mut index = indexed(&[
        ("a.md", "- [ ] Uno ⏰ 2026-11-13 09:00\n"),
        ("b.md", "- [ ] Due ⏰ 2026-11-13 10:00\n"),
        ("c.md", "- [ ] Tre ⏰ 2026-11-13 11:00\n"),
    ]);
    assert_eq!(index.len(), 3);

    // Spuntato: la nota rientra col modello nuovo e il promemoria esce.
    index.on_documents_indexed(&[model("a.md", "- [x] Uno ⏰ 2026-11-13 09:00\n")]);
    // Cancellato il segno: esce anche lui.
    index.on_documents_indexed(&[model("b.md", "- [ ] Due\n")]);
    assert_eq!(index.len(), 1);
    // Una nota tolta dal vault esce.
    index.on_documents_removed(&[DocId::new("c.md")]);
    assert!(index.is_empty());

    // Una nota sparita ad app chiusa esce col riallineamento.
    let mut index = indexed(&[
        ("a.md", "- [ ] Uno ⏰ 2026-11-13 09:00\n"),
        ("b.md", "- [ ] Due ⏰ 2026-11-13 10:00\n"),
    ]);
    index.reconcile(&[DocId::new("b.md")]);
    assert_eq!(
        whens(&index.between(None, None, REMINDER_LIMIT)),
        vec![("b.md", "2026-11-13 10:00", "Due")]
    );

    // Derivato: un indice nuovo alimentato con le stesse note dà la stessa
    // risposta, che è ciò che fa il kernel a ogni apertura del vault.
    let again = indexed(&[("b.md", "- [ ] Due ⏰ 2026-11-13 10:00\n")]);
    assert_eq!(
        again.between(None, None, REMINDER_LIMIT),
        index.between(None, None, REMINDER_LIMIT)
    );
}

#[test]
fn the_interval_excludes_after_and_includes_until() {
    let index = indexed(&[(
        "a.md",
        "- [ ] Prima ⏰ 2026-11-13 08:59\n- [ ] Nove ⏰ 2026-11-13 09:00\n- [ ] Dopo ⏰ 2026-11-13 09:01\n",
    )]);
    let list = index.between(
        Some(minute("2026-11-13 08:59")),
        Some(minute("2026-11-13 09:00")),
        REMINDER_LIMIT,
    );
    assert_eq!(whens(&list), vec![("a.md", "2026-11-13 09:00", "Nove")]);
}

#[test]
fn a_thousand_reminders_and_more_are_cut_in_time_order() {
    let mut source = String::new();
    for i in 0..1_500 {
        let (hour, min) = (i / 60 % 24, i % 60);
        source.push_str(&format!(
            "- [ ] Compito {i} ⏰ 2026-11-{:02} {hour:02}:{min:02}\n",
            13 + i / 1_440
        ));
    }
    let index = indexed(&[("molti.md", &source)]);
    assert_eq!(index.len(), 1_500);
    let list = index.between(None, None, REMINDER_LIMIT);
    assert_eq!(list.reminders.len(), REMINDER_LIMIT);
    assert!(list.more, "the answer says there are others");
    assert_eq!(list.reminders[0].text, "Compito 0");
    assert_eq!(list.reminders[999].text, "Compito 999");
    let rest = index.between(
        Some(minute(&list.reminders[999].when)),
        None,
        REMINDER_LIMIT,
    );
    assert_eq!(rest.reminders.len(), 500);
    assert!(!rest.more);
}

#[test]
fn the_route_has_a_closed_shape() {
    let index = indexed(&[("a.md", "- [ ] Uno ⏰ 2026-11-13 09:00\n")]);
    let answer = index
        .query(RemindersQuery::between(None, Some(minute("2026-11-13 09:00"))).to_index_query())
        .expect("answers");
    let list = ReminderList::from_index_result(answer).expect("reads");
    assert_eq!(whens(&list), vec![("a.md", "2026-11-13 09:00", "Uno")]);
    assert_eq!(
        list.reminders[0].at, 3,
        "the marker byte, as in the tasks view: for toggle and open"
    );

    let ask = |query: serde_json::Value| {
        index.query(IndexQuery::Custom {
            ns: TASKS_ID.into(),
            query,
        })
    };
    for bad in [
        serde_json::json!({"kind": "reminders", "version": 2}),
        serde_json::json!({"kind": "reminders", "version": 1, "until": "domani"}),
        serde_json::json!({"kind": "reminders", "version": 1, "after": "2026-11-13T09:00"}),
        serde_json::json!({"kind": "reminders", "version": 1, "extra": true}),
        serde_json::json!({"kind": "other", "version": 1}),
    ] {
        assert!(
            matches!(ask(bad.clone()), Err(PluginError::BadArgs(_))),
            "{bad} is refused"
        );
    }
    assert!(matches!(
        index.query(IndexQuery::Custom {
            ns: "fub.other".into(),
            query: serde_json::Value::Null,
        }),
        Err(PluginError::Unserved(_))
    ));
    let limited = ask(serde_json::json!({"kind": "reminders", "version": 1, "limit": 5_000}))
        .map(ReminderList::from_index_result)
        .expect("answers")
        .expect("reads");
    assert_eq!(
        limited.reminders.len(),
        1,
        "a limit above the cap is the cap"
    );
}

#[test]
fn the_first_look_after_start_rings_nothing() {
    let index = indexed(&[(
        "a.md",
        "- [ ] Ieri ⏰ 2026-11-12 09:00\n- [ ] Adesso ⏰ 2026-11-13 09:00\n",
    )]);
    let mut watch = ReminderWatch::new();
    // Le 9:00 di Roma d'inverno, cioè le 8:00 UTC: tutto ciò che è passato va
    // nell'elenco all'avvio, non in una notifica.
    let host = host_at(utc(2026, 11, 13, 8, 0), 60);
    assert!(look(&mut watch, &index, &host).is_empty());
    assert_eq!(watch.seen(), Some(minute("2026-11-13 09:00")));
    let past = index.between(None, watch.seen(), REMINDER_LIMIT);
    assert_eq!(
        past.reminders.len(),
        2,
        "both are in the list of past reminders"
    );
}

#[test]
fn a_reminder_rings_at_the_wall_clock_of_the_offset_of_now() {
    let index = indexed(&[("a.md", "- [ ] Chiamare ⏰ 2026-11-13 09:00\n")]);
    let mut watch = ReminderWatch::new();
    // Roma d'inverno (+60): le 8:59 civili sono le 7:59 UTC.
    assert!(look(&mut watch, &index, &host_at(utc(2026, 11, 13, 7, 59), 60)).is_empty());
    assert_eq!(
        look(&mut watch, &index, &host_at(utc(2026, 11, 13, 8, 0), 60)),
        vec!["Chiamare"],
        "rings at nine in Rome, that is eight UTC"
    );
    assert!(
        look(&mut watch, &index, &host_at(utc(2026, 11, 13, 8, 1), 60)).is_empty(),
        "and once"
    );
}

#[test]
fn daylight_saving_moves_the_utc_instant_not_the_wall_clock() {
    // Scritto d'inverno per un giorno d'estate: il 2026-03-29 alle 9 di Roma
    // è dopo il cambio, cioè le 7:00 UTC e non le 8:00.
    let index = indexed(&[("a.md", "- [ ] Dopo il cambio ⏰ 2026-03-29 09:00\n")]);
    let mut watch = ReminderWatch::new();
    assert!(look(&mut watch, &index, &host_at(utc(2026, 3, 29, 6, 59), 120)).is_empty());
    assert_eq!(
        look(&mut watch, &index, &host_at(utc(2026, 3, 29, 7, 0), 120)),
        vec!["Dopo il cambio"]
    );

    // Il cambio d'autunno ripete un'ora del muro: le 2:30 del 2026-10-25 a Roma
    // capitano due volte, e il promemoria suona alla prima.
    let index = indexed(&[("a.md", "- [ ] Ora ripetuta ⏰ 2026-10-25 02:30\n")]);
    let mut watch = ReminderWatch::new();
    assert!(look(&mut watch, &index, &host_at(utc(2026, 10, 25, 0, 29), 120)).is_empty());
    assert_eq!(
        look(&mut watch, &index, &host_at(utc(2026, 10, 25, 0, 30), 120)),
        vec!["Ora ripetuta"]
    );
    // Un'ora dopo l'orologio torna alle 2:00 (offset +60) e ripassa le 2:30.
    assert!(look(&mut watch, &index, &host_at(utc(2026, 10, 25, 1, 0), 60)).is_empty());
    assert!(
        look(&mut watch, &index, &host_at(utc(2026, 10, 25, 1, 30), 60)).is_empty(),
        "the repeated hour does not ring twice"
    );

    // Il cambio di primavera salta le 2:30: il promemoria suona appena l'ora
    // del muro le supera, alle 3:00.
    let index = indexed(&[("a.md", "- [ ] Ora saltata ⏰ 2026-03-29 02:30\n")]);
    let mut watch = ReminderWatch::new();
    assert!(look(&mut watch, &index, &host_at(utc(2026, 3, 29, 0, 59), 60)).is_empty());
    assert_eq!(
        look(&mut watch, &index, &host_at(utc(2026, 3, 29, 1, 0), 120)),
        vec!["Ora saltata"]
    );
}

#[test]
fn a_change_of_time_zone_rings_at_the_new_wall_clock() {
    let index = indexed(&[
        ("a.md", "- [ ] Nove ⏰ 2026-11-13 09:00\n"),
        ("b.md", "- [ ] Mezzogiorno ⏰ 2026-11-13 12:00\n"),
    ]);
    let mut watch = ReminderWatch::new();
    // A Roma (+60) alle 8:00 civili.
    assert!(look(&mut watch, &index, &host_at(utc(2026, 11, 13, 7, 0), 60)).is_empty());
    // Un volo verso New York (-300): atterrato, sono le 7:00 civili. L'ora del
    // muro è tornata indietro, e non suona niente.
    assert!(look(&mut watch, &index, &host_at(utc(2026, 11, 13, 12, 0), -300)).is_empty());
    // Le 9:00 di Roma l'orologio non le ha mai segnate (si è passati dalle
    // 8:00 alle 7:00): il promemoria è un'ora del muro, e suona alle 9:00 di
    // New York.
    assert_eq!(
        look(&mut watch, &index, &host_at(utc(2026, 11, 13, 14, 0), -300)),
        vec!["Nove"]
    );
    // Mezzogiorno a New York: suona.
    assert_eq!(
        look(&mut watch, &index, &host_at(utc(2026, 11, 13, 17, 0), -300)),
        vec!["Mezzogiorno"]
    );

    // Verso est l'ora del muro salta avanti: ciò che sta nel salto è passato,
    // e suona subito.
    let mut watch = ReminderWatch::new();
    assert!(look(&mut watch, &index, &host_at(utc(2026, 11, 13, 7, 0), 60)).is_empty());
    assert_eq!(
        look(&mut watch, &index, &host_at(utc(2026, 11, 13, 7, 1), 240)),
        vec!["Nove"],
        "from 8:00 in Rome to 11:01 in Dubai"
    );
}

#[test]
fn a_reminder_written_in_the_past_does_not_ring() {
    let mut index = indexed(&[]);
    let mut watch = ReminderWatch::new();
    assert!(look(&mut watch, &index, &host_at(utc(2026, 11, 13, 9, 0), 0)).is_empty());
    // Scritto adesso per un'ora già passata.
    index.on_documents_indexed(&[model("a.md", "- [ ] Tardi ⏰ 2026-11-13 08:00\n")]);
    assert!(look(&mut watch, &index, &host_at(utc(2026, 11, 13, 9, 1), 0)).is_empty());
    // Scritto per fra un minuto: suona.
    index.on_documents_indexed(&[model("b.md", "- [ ] Presto ⏰ 2026-11-13 09:02\n")]);
    assert_eq!(
        look(&mut watch, &index, &host_at(utc(2026, 11, 13, 9, 2), 0)),
        vec!["Presto"]
    );
}

#[test]
fn the_notification_words_are_in_the_language_of_who_reads() {
    let it = Locale {
        language: "it-IT".into(),
        ..Locale::default()
    };
    let en = Locale {
        language: "en".into(),
        ..Locale::default()
    };
    assert_eq!(
        notification_words(&it, "en"),
        NotificationWords {
            title: "Promemoria".into(),
            open: "Apri la nota".into(),
        }
    );
    assert_eq!(notification_words(&en, "it").title, "Reminder");
    assert_eq!(notification_words(&en, "it").open, "Open the note");
    assert_eq!(
        notification_more(&it, "en", 12, false),
        "Altri 12 promemoria: sono nella vista dei compiti."
    );
    assert_eq!(
        notification_more(&en, "it", 996, true),
        "More than 996 other reminders: they are in the tasks view."
    );
    assert_eq!(
        notification_words(&Locale::default(), "it").title,
        "Promemoria",
        "without a language, the default one"
    );
}

#[test]
fn a_reminder_knows_the_section_it_opens_on() {
    let index = indexed(&[(
        "a.md",
        "- [ ] In cima ⏰ 2026-11-13 08:00\n\n# Lavoro\n\n- [ ] Chiamare ⏰ 2026-11-13 09:00\n\n## Casa\n\n- [ ] Spesa ⏰ 2026-11-13 10:00\n",
    )]);
    let list = index.between(None, None, REMINDER_LIMIT);
    let headings: Vec<Option<&str>> = list
        .reminders
        .iter()
        .map(|r| r.heading.as_deref())
        .collect();
    assert_eq!(headings, vec![None, Some("Lavoro"), Some("Casa")]);
}

#[test]
fn the_route_answers_the_next_occurrence_with_the_toggle_rule() {
    // L'indice vuoto risponde lo stesso: la domanda non legge le note.
    let index = ReminderIndex::new();
    let next = |line: &str, today: &str| {
        index
            .query(RemindersQuery::next_occurrence(line, today).to_index_query())
            .map(|answer| match answer {
                IndexResult::Custom(value) => {
                    serde_json::from_value::<NextOccurrence>(value).expect("reads")
                }
                other => panic!("not a custom answer: {other:?}"),
            })
    };
    assert_eq!(
        next(
            "- [ ] 1:1 del giovedì 🔁 every week 📅 2026-11-19",
            "2026-11-19"
        )
        .expect("answers")
        .line
        .as_deref(),
        Some("- [ ] 1:1 del giovedì 🔁 every week 📅 2026-11-26")
    );
    assert_eq!(
        next(
            "- [ ] F24 mensile 🔁 every month 📅 2026-11-16",
            "2026-11-19"
        )
        .expect("answers")
        .line
        .as_deref(),
        Some("- [ ] F24 mensile 🔁 every month 📅 2026-12-16")
    );
    assert_eq!(
        next(
            "- [ ] Taglio 🔁 every 3 weeks when done 📅 2026-09-01",
            "2026-10-19"
        )
        .expect("answers")
        .line
        .as_deref(),
        Some("- [ ] Taglio 🔁 every 3 weeks when done 📅 2026-11-09"),
        "`when done` counts from the day of who asks"
    );
    assert_eq!(
        next("- [ ] Senza ricorrenza 📅 2026-11-19", "2026-11-19")
            .expect("answers")
            .line,
        None,
        "a line that does not recur answers no line, not an error"
    );

    let ask = |query: serde_json::Value| {
        index.query(IndexQuery::Custom {
            ns: TASKS_ID.into(),
            query,
        })
    };
    let long = format!(
        "- [ ] {} 🔁 every day 📅 2026-11-19",
        "x".repeat(NEXT_OCCURRENCE_MAX_LINE)
    );
    for bad in [
        serde_json::json!({"kind": "next_occurrence", "version": 2, "line": "- [ ] a", "today": "2026-11-19"}),
        serde_json::json!({"kind": "next_occurrence", "version": 1, "line": "- [ ] a", "today": "domani"}),
        serde_json::json!({"kind": "next_occurrence", "version": 1, "line": "- [ ] a", "today": "2026-02-30"}),
        serde_json::json!({"kind": "next_occurrence", "version": 1, "line": "- [ ] a\n- [ ] b", "today": "2026-11-19"}),
        serde_json::json!({"kind": "next_occurrence", "version": 1, "line": long, "today": "2026-11-19"}),
        serde_json::json!({"kind": "next_occurrence", "version": 1, "line": "- [ ] a"}),
        serde_json::json!({"kind": "next_occurrence", "version": 1, "line": "- [ ] a", "today": "2026-11-19", "extra": 1}),
    ] {
        assert!(
            matches!(ask(bad.clone()), Err(PluginError::BadArgs(_))),
            "{bad} is refused"
        );
    }
}
