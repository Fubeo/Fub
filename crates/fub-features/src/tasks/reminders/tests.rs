use super::*;
use fub_abi::format::ParseContext;
use fub_abi::locale::days_from_civil;
use fub_abi::traits::{DataRead, DataWrite};
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

#[test]
fn a_reminder_moved_renamed_or_rebuilt_answers_from_its_new_place() {
    let mut index = indexed(&[
        (
            "a.md",
            "- [ ] Uno ⏰ 2026-11-13 09:00\n- [ ] Due ⏰ 2026-11-13 09:00\n",
        ),
        ("b.md", "- [ ] Tre ⏰ 2026-11-13 09:00\n"),
    ]);
    let nine = minute("2026-11-13 09:00");
    // Spostato d'ora: il minuto vecchio non lo dà più, quello nuovo sì.
    index.on_documents_indexed(&[model(
        "a.md",
        "- [ ] Uno ⏰ 2026-11-13 10:00\n- [ ] Due ⏰ 2026-11-13 09:00\n",
    )]);
    assert_eq!(
        whens(&index.between(Some(nine - 1), Some(nine), REMINDER_LIMIT)),
        vec![
            ("a.md", "2026-11-13 09:00", "Due"),
            ("b.md", "2026-11-13 09:00", "Tre")
        ]
    );
    assert_eq!(
        whens(&index.between(Some(nine), None, REMINDER_LIMIT)),
        vec![("a.md", "2026-11-13 10:00", "Uno")]
    );
    // Rinominata: il kernel toglie il nome vecchio e indicizza il nuovo.
    index.on_documents_removed(&[DocId::new("b.md")]);
    index.on_documents_indexed(&[model("z.md", "- [ ] Tre ⏰ 2026-11-13 09:00\n")]);
    assert_eq!(
        whens(&index.between(Some(nine - 1), Some(nine), REMINDER_LIMIT)),
        vec![
            ("a.md", "2026-11-13 09:00", "Due"),
            ("z.md", "2026-11-13 09:00", "Tre")
        ]
    );
    assert_eq!(index.len(), 3);
    // Chiuso il vault non resta niente; riaperto, le note lo rifanno uguale.
    let mut host = MemoryHost::new();
    index.close(&mut host).unwrap();
    assert!(index.is_empty());
    assert_eq!(index.len(), 0);
    assert_eq!(
        index.between(None, None, REMINDER_LIMIT),
        ReminderList::default()
    );
    index.on_documents_indexed(&[
        model(
            "a.md",
            "- [ ] Uno ⏰ 2026-11-13 10:00\n- [ ] Due ⏰ 2026-11-13 09:00\n",
        ),
        model("z.md", "- [ ] Tre ⏰ 2026-11-13 09:00\n"),
    ]);
    assert_eq!(index.len(), 3);
    // Un intervallo rovesciato, vuoto o agli estremi dei minuti è vuoto,
    // senza far cadere niente.
    assert!(index
        .between(Some(nine), Some(nine), REMINDER_LIMIT)
        .reminders
        .is_empty());
    assert!(index
        .between(Some(nine + 5), Some(nine), REMINDER_LIMIT)
        .reminders
        .is_empty());
    assert!(index
        .between(Some(i64::MAX), None, REMINDER_LIMIT)
        .reminders
        .is_empty());
    assert_eq!(
        index
            .between(Some(i64::MIN), Some(i64::MAX), REMINDER_LIMIT)
            .reminders
            .len(),
        3
    );
    // Un limite a zero non porta niente ma dice che ce ne sono.
    let none = index.between(None, None, 0);
    assert!(none.reminders.is_empty() && none.more);
}

/// Un generatore piccolo e ripetibile: le prove a caso hanno un seme fisso,
/// così un rosso si rifà uguale.
struct Dice(u64);

impl Dice {
    fn roll(&mut self, faces: u64) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) % faces
    }
}

/// Una nota a caso: titoli, compiti aperti e spuntati, citazioni e liste
/// annidate, con le ore strette in pochi minuti perché si scontrino.
fn random_note(dice: &mut Dice, doc: &str) -> DocumentModel {
    let mut source = String::new();
    for line in 0..dice.roll(12) {
        let when = format!("2026-11-13 09:{:02}", dice.roll(6));
        match dice.roll(8) {
            0 => source.push_str(&format!("# Titolo {line}\n\n")),
            1 => source.push_str(&format!("## Sotto {line}\n\n")),
            2 | 3 => source.push_str(&format!("- [ ] Compito {line} ⏰ {when}\n")),
            4 => source.push_str(&format!("- [x] Fatto {line} ⏰ {when}\n")),
            5 => source.push_str(&format!("> - [ ] Citato {line} ⏰ {when}\n\n")),
            6 => source.push_str(&format!(
                "- Voce {line}\n  - [ ] Annidato {line} ⏰ {when}\n"
            )),
            _ => source.push_str(&format!("Testo {line}.\n\n")),
        }
    }
    model(doc, &source)
}

/// La risposta dell'implementazione semplice, quella di prima dell'indice
/// ordinato: tutti i promemoria del vault, filtrati e ordinati a ogni domanda,
/// con il titolo cercato da capo per ognuno.
fn scanned(
    vault: &BTreeMap<DocId, DocumentModel>,
    after: Option<i64>,
    until: Option<i64>,
    limit: usize,
) -> ReminderList {
    let mut hits: Vec<ReminderEntry> = Vec::new();
    for (doc, model) in vault {
        for reminder in reminders_of(model) {
            let heading = model
                .outline
                .iter()
                .take_while(|heading| heading.span.start < reminder.at)
                .last()
                .map(|heading| heading.text.clone());
            assert_eq!(
                heading, reminder.heading,
                "the section of {doc}@{}",
                reminder.at
            );
            if after.is_none_or(|a| reminder.minute > a)
                && until.is_none_or(|u| reminder.minute <= u)
            {
                hits.push(ReminderEntry {
                    doc: doc.clone(),
                    at: reminder.at,
                    when: reminder_text(reminder.minute),
                    text: reminder.text,
                    heading,
                });
            }
        }
    }
    hits.sort_by(|a, b| {
        (minute(&a.when), a.doc.as_str(), a.at).cmp(&(minute(&b.when), b.doc.as_str(), b.at))
    });
    let more = hits.len() > limit;
    hits.truncate(limit);
    ReminderList {
        reminders: hits,
        more,
    }
}

#[test]
fn the_ordered_index_answers_like_the_full_scan() {
    let base = minute("2026-11-13 09:00");
    let mut dice = Dice(0x5EED_F0B0_2026_1120);
    let mut index = ReminderIndex::new();
    let mut vault: BTreeMap<DocId, DocumentModel> = BTreeMap::new();
    let mut host = MemoryHost::new();
    for step in 0..600 {
        let doc = DocId::new(format!("n{}.md", dice.roll(12)));
        match dice.roll(10) {
            // Aggiunta o modifica: la nota rientra col modello nuovo.
            0..=4 => {
                let note = random_note(&mut dice, doc.as_str());
                index.on_documents_indexed(std::slice::from_ref(&note));
                vault.insert(doc, note);
            }
            // Cancellazione.
            5 => {
                index.on_documents_removed(std::slice::from_ref(&doc));
                vault.remove(&doc);
            }
            // Rinomina: via il nome vecchio, dentro il nuovo con lo stesso testo.
            6 => {
                if let Some(old) = vault.remove(&doc) {
                    let to = DocId::new(format!("r{}.md", dice.roll(12)));
                    let mut moved = old.clone();
                    moved.id = to.clone();
                    index.on_documents_removed(std::slice::from_ref(&doc));
                    index.on_documents_indexed(std::slice::from_ref(&moved));
                    vault.insert(to, moved);
                }
            }
            // Riallineamento dopo la scansione: resta solo una parte.
            7 => {
                let alive: Vec<DocId> = vault
                    .keys()
                    .filter(|_| dice.roll(4) != 0)
                    .cloned()
                    .collect();
                index.reconcile(&alive);
                vault.retain(|doc, _| alive.contains(doc));
            }
            // Riavvio: chiuso e rifatto dalle note.
            8 => {
                index.close(&mut host).unwrap();
                let models: Vec<DocumentModel> = vault.values().cloned().collect();
                index.on_documents_indexed(&models);
            }
            // Una nota rientrata uguale: niente cambia.
            _ => {
                if let Some(same) = vault.get(&doc) {
                    index.on_documents_indexed(std::slice::from_ref(same));
                }
            }
        }
        for _ in 0..4 {
            let bound = |dice: &mut Dice| match dice.roll(8) {
                0 => None,
                n => Some(base + n as i64 - 2),
            };
            let (after, until) = (bound(&mut dice), bound(&mut dice));
            let limit = dice.roll(7) as usize;
            assert_eq!(
                index.between(after, until, limit),
                scanned(&vault, after, until, limit),
                "step {step}: ({after:?}, {until:?}] limit {limit}"
            );
        }
        assert_eq!(
            index.len(),
            scanned(&vault, None, None, usize::MAX).reminders.len(),
            "step {step}"
        );
        assert_eq!(
            index.is_empty(),
            vault.values().all(|note| reminders_of(note).is_empty()),
            "step {step}"
        );
    }
}

/// La misura dell'indice su un vault grande: 10.000 note, 5.000 promemoria
/// sparsi su un anno, e il notificatore che chiede un minuto alla volta.
/// Non è una prova (il tempo dipende dalla macchina): la si lancia a mano con
/// `cargo test -p fub-features --release --lib -- --ignored
/// misura_promemoria --nocapture`.
#[test]
#[ignore = "misura, non prova: si lancia a mano"]
fn misura_promemoria_su_un_vault_grande() {
    use std::time::Instant;
    let start = minute("2026-01-01 00:00");
    let mut models = Vec::new();
    for i in 0..10_000i64 {
        let source = if i % 2 == 0 {
            let at = reminder_text(start + (i * 7_919) % 525_600);
            format!("# Nota {i}\n\n- [ ] Compito {i} ⏰ {at}\n")
        } else {
            format!("# Nota {i}\n\nTesto.\n")
        };
        models.push(model(&format!("n{i:05}.md"), &source));
    }
    let mut index = ReminderIndex::new();
    let clock = Instant::now();
    index.on_documents_indexed(&models);
    let built = clock.elapsed();
    assert_eq!(index.len(), 5_000);
    let clock = Instant::now();
    let mut rung = 0;
    for step in 0..10_000i64 {
        let now = start + step * 37;
        rung += index
            .between(Some(now - 1), Some(now), REMINDER_LIMIT)
            .reminders
            .len();
    }
    let minutes = clock.elapsed();
    // Una nota sola con molti titoli e molti promemoria: l'abbinamento dei
    // titoli.
    let mut source = String::new();
    for i in 0..4_000 {
        source.push_str(&format!(
            "# Sezione {i}\n\n- [ ] Compito {i} ⏰ {}\n\n",
            reminder_text(start + i)
        ));
    }
    let big = model("grande.md", &source);
    let clock = Instant::now();
    index.on_documents_indexed(std::slice::from_ref(&big));
    let headings = clock.elapsed();
    println!(
        "costruzione {built:?} · 10.000 domande di un minuto {minutes:?} ({rung} suonati) · \
         nota con 4.000 titoli {headings:?}"
    );
}

// ---- Il file dei promemoria (#521) ----

/// La voce del vault che il kernel mostra a `up_to_date`: una nota con la
/// revisione che dichiara.
fn entry(doc: &str, revision: Option<&str>) -> VaultEntry {
    VaultEntry {
        id: DocId::new(doc),
        kind: EntryKind::Document,
        size: 10,
        mtime: 1,
        fingerprint: revision.map(Revision::new),
    }
}

fn ids(list: &[DocId]) -> Vec<&str> {
    list.iter().map(DocId::as_str).collect()
}

fn shown(notes: &[(&str, &str, &str)]) -> Vec<VaultEntry> {
    notes.iter().map(|(d, r, _)| entry(d, Some(r))).collect()
}

fn alive(entries: &[VaultEntry]) -> Vec<DocId> {
    entries.iter().map(|e| e.id.clone()).collect()
}

/// Il giro freddo del kernel: chiede `up_to_date`, consegna le note che
/// nessuno ha, riallinea, scrive con `flush`. Le note sono
/// `(id, revisione, sorgente)`.
fn cold(host: &mut MemoryHost, notes: &[(&str, &str, &str)]) -> ReminderIndex {
    let mut index = ReminderIndex::new();
    index.activate(host).expect("activates");
    let entries = shown(notes);
    assert!(
        index.up_to_date(&entries).is_empty(),
        "the first time it has nothing"
    );
    let models: Vec<DocumentModel> = notes.iter().map(|(d, _, s)| model(d, s)).collect();
    index.on_documents_indexed(&models);
    index.reconcile(&alive(&entries));
    index.flush(host).expect("flushes");
    index
}

const NOTES: &[(&str, &str, &str)] = &[
    (
        "a.md",
        "sha256:a1",
        "# Casa\n\n- [ ] Uno ⏰ 2026-11-13 09:00\n",
    ),
    ("b.md", "sha256:b1", "- [ ] Due ⏰ 2026-11-13 10:00\n"),
    // La maggioranza: una nota senza promemoria, che va ricordata lo stesso.
    ("c.md", "sha256:c1", "Solo testo.\n"),
];

#[test]
fn a_reopened_index_has_what_it_saw_without_rereading() {
    let mut host = MemoryHost::new();
    let mut first = cold(&mut host, NOTES);
    let before = first.between(None, None, REMINDER_LIMIT);
    first.close(&mut host).expect("closes");

    let mut again = ReminderIndex::new();
    again.activate(&mut host).expect("activates");
    let mut current = again.up_to_date(&shown(NOTES));
    current.sort();
    assert_eq!(ids(&current), vec!["a.md", "b.md", "c.md"]);
    // Nessuna consegna: la risposta è quella di prima, sezione compresa.
    assert_eq!(again.between(None, None, REMINDER_LIMIT), before);
    assert_eq!(before.reminders.len(), 2);
    assert_eq!(before.reminders[0].heading.as_deref(), Some("Casa"));
}

#[test]
fn a_note_changed_while_closed_is_reread_and_its_new_revision_kept() {
    let mut host = MemoryHost::new();
    cold(&mut host, NOTES).close(&mut host).expect("closes");

    let mut again = ReminderIndex::new();
    again.activate(&mut host).expect("activates");
    let entries = vec![
        entry("a.md", Some("sha256:a2")),
        entry("b.md", Some("sha256:b1")),
        entry("c.md", Some("sha256:c1")),
    ];
    let mut current = again.up_to_date(&entries);
    current.sort();
    assert_eq!(ids(&current), vec!["b.md", "c.md"]);
    again.on_documents_indexed(&[model("a.md", "- [ ] Nuovo ⏰ 2026-11-14 08:00\n")]);
    again.reconcile(&alive(&entries));
    again.flush(&mut host).expect("flushes");
    assert_eq!(
        whens(&again.between(None, None, REMINDER_LIMIT)),
        vec![
            ("b.md", "2026-11-13 10:00", "Due"),
            ("a.md", "2026-11-14 08:00", "Nuovo"),
        ]
    );

    // E la terza apertura ha la revisione nuova.
    let mut third = ReminderIndex::new();
    third.activate(&mut host).expect("activates");
    assert_eq!(third.up_to_date(&entries).len(), 3);
    assert_eq!(
        third.between(None, None, REMINDER_LIMIT),
        again.between(None, None, REMINDER_LIMIT)
    );
}

#[test]
fn a_delivery_nobody_announced_is_not_written_as_current() {
    let mut host = MemoryHost::new();
    let mut index = cold(&mut host, NOTES);
    // Un salvataggio a sessione aperta: nessuna revisione dichiarata.
    index.on_documents_indexed(&[model("b.md", "- [ ] Due bis ⏰ 2026-11-15 10:00\n")]);
    index.close(&mut host).expect("closes");

    let mut again = ReminderIndex::new();
    again.activate(&mut host).expect("activates");
    let mut current = again.up_to_date(&shown(NOTES));
    current.sort();
    // b.md non si salta con la revisione vecchia: si rilegge.
    assert_eq!(ids(&current), vec!["a.md", "c.md"]);
    assert!(again
        .between(None, None, REMINDER_LIMIT)
        .reminders
        .iter()
        .all(|r| r.doc.as_str() != "b.md"));
}

#[test]
fn a_note_said_current_but_delivered_anyway_keeps_its_revision() {
    // Un altro indice non l'aveva: il kernel la consegna lo stesso, con il
    // testo della revisione che ha dichiarato. L'indice la tiene con quella.
    let mut host = MemoryHost::new();
    cold(&mut host, NOTES).close(&mut host).expect("closes");
    let mut again = ReminderIndex::new();
    again.activate(&mut host).expect("activates");
    assert_eq!(again.up_to_date(&shown(NOTES)).len(), 3);
    again.on_documents_indexed(&[model("a.md", NOTES[0].2)]);
    again.close(&mut host).expect("closes");

    let mut third = ReminderIndex::new();
    third.activate(&mut host).expect("activates");
    let mut current = third.up_to_date(&shown(NOTES));
    current.sort();
    assert_eq!(ids(&current), vec!["a.md", "b.md", "c.md"]);
}

/// Un indice prudente accanto: risponde sempre «non ho niente», e il kernel
/// consegna ogni nota a ogni apertura. È la parte del kernel che il test
/// rifà: la consegna è l'unione di ciò che manca a qualcuno.
fn reopen_beside_a_prudent_index(host: &mut MemoryHost) -> Vec<DocId> {
    let mut index = ReminderIndex::new();
    index.activate(host).expect("activates");
    let entries = shown(NOTES);
    let mut current = index.up_to_date(&entries);
    current.sort();
    let prudent: Vec<DocId> = Vec::new();
    let delivered: Vec<DocumentModel> = NOTES
        .iter()
        .filter(|(d, _, _)| !prudent.iter().any(|id| id.as_str() == *d))
        .map(|(d, _, s)| model(d, s))
        .collect();
    index.on_documents_indexed(&delivered);
    index.reconcile(&alive(&entries));
    index.flush(host).expect("flushes");
    index.close(host).expect("closes");
    current
}

#[test]
fn beside_a_prudent_index_a_still_vault_does_not_swing() {
    let mut host = MemoryHost::new();
    reopen_beside_a_prudent_index(&mut host);
    let written = host.writes_on(stored::FILE).0;
    assert_eq!(written, 1, "the cold opening writes the file");
    for round in 2..=3 {
        let current = reopen_beside_a_prudent_index(&mut host);
        assert_eq!(
            ids(&current),
            vec!["a.md", "b.md", "c.md"],
            "round {round}: it has every note, so nothing would be reread for it"
        );
        assert_eq!(
            host.writes_on(stored::FILE).0,
            written,
            "round {round}: same notes, same file"
        );
    }
}

#[test]
fn a_question_without_a_fingerprint_withdraws_the_declaration() {
    // Un'apertura interrotta: il kernel ha chiesto con le revisioni, poi non
    // consegna e ritira chiedendo di nuovo senza impronta. Il salvataggio a
    // sessione aperta che arriva dopo non deve prendersi la revisione vecchia.
    let mut host = MemoryHost::new();
    cold(&mut host, NOTES).close(&mut host).expect("closes");
    let mut again = ReminderIndex::new();
    again.activate(&mut host).expect("activates");
    assert_eq!(again.up_to_date(&shown(NOTES)).len(), 3);
    let withdrawn: Vec<VaultEntry> = NOTES.iter().map(|(d, _, _)| entry(d, None)).collect();
    assert!(again.up_to_date(&withdrawn).is_empty());
    again.on_documents_indexed(&[model("a.md", "- [ ] Cambiata ⏰ 2026-11-16 09:00\n")]);
    again.close(&mut host).expect("closes");

    let mut third = ReminderIndex::new();
    third.activate(&mut host).expect("activates");
    let mut current = third.up_to_date(&shown(NOTES));
    current.sort();
    assert_eq!(ids(&current), vec!["b.md", "c.md"], "a.md is reread");
}

#[test]
fn without_a_declared_revision_or_for_an_asset_it_does_not_answer() {
    let mut host = MemoryHost::new();
    cold(&mut host, NOTES).close(&mut host).expect("closes");
    let mut again = ReminderIndex::new();
    again.activate(&mut host).expect("activates");
    let mut folder = entry("a.md", Some("sha256:a1"));
    folder.kind = EntryKind::Asset;
    assert!(again.up_to_date(&[entry("b.md", None), folder]).is_empty());
    fub_sdk::testing::conformance::up_to_date_only_reported_what_it_saw(&again);
}

#[test]
fn a_note_gone_while_closed_leaves_the_file_with_the_reconcile() {
    let mut host = MemoryHost::new();
    cold(&mut host, NOTES).close(&mut host).expect("closes");
    let mut again = ReminderIndex::new();
    again.activate(&mut host).expect("activates");
    again.up_to_date(&[entry("b.md", Some("sha256:b1"))]);
    again.reconcile(&[DocId::new("b.md")]);
    again.close(&mut host).expect("closes");

    let mut third = ReminderIndex::new();
    third.activate(&mut host).expect("activates");
    assert!(third
        .up_to_date(&[entry("a.md", Some("sha256:a1"))])
        .is_empty());
    assert_eq!(
        whens(&third.between(None, None, REMINDER_LIMIT)),
        vec![("b.md", "2026-11-13 10:00", "Due")]
    );
}

#[test]
fn an_unreadable_or_foreign_file_is_thrown_away_and_rebuilt() {
    let good = {
        let mut host = MemoryHost::new();
        cold(&mut host, NOTES).close(&mut host).expect("closes");
        host.cache_read(stored::FILE).unwrap().expect("written")
    };
    let text = String::from_utf8(good.clone()).unwrap();
    let old_schema = text.replacen(
        &format!("\"schema\":{}", stored::SCHEMA),
        &format!("\"schema\":{}", stored::SCHEMA + 1),
        1,
    );
    let other_rule = text.replacen(
        &format!("\"rule\":{}", stored::RULE),
        &format!("\"rule\":{}", stored::RULE + 1),
        1,
    );
    assert_ne!(old_schema, text);
    assert_ne!(other_rule, text);
    let bad: Vec<(&str, Vec<u8>)> = vec![
        ("truncated", good[..good.len() / 2].to_vec()),
        ("garbage", b"\xff\x00 non json".to_vec()),
        ("old schema", old_schema.into_bytes()),
        ("other rule", other_rule.into_bytes()),
        (
            "empty revision",
            text.replacen("sha256:a1", "", 1).into_bytes(),
        ),
    ];
    for (what, raw) in bad {
        let mut host = MemoryHost::new();
        host.cache_write(stored::FILE, &raw).unwrap();
        let mut index = ReminderIndex::new();
        index
            .activate(&mut host)
            .unwrap_or_else(|e| panic!("{what}: {e:?}"));
        assert!(index.is_empty(), "{what}: starts empty");
        let entries = shown(NOTES);
        assert!(
            index.up_to_date(&entries).is_empty(),
            "{what}: asks for everything"
        );
        // Ricostruito dalle note, e il file torna buono.
        let models: Vec<DocumentModel> = NOTES.iter().map(|(d, _, s)| model(d, s)).collect();
        index.on_documents_indexed(&models);
        index.flush(&mut host).unwrap();
        let mut again = ReminderIndex::new();
        again.activate(&mut host).unwrap();
        assert_eq!(again.up_to_date(&entries).len(), 3, "{what}: rewritten");
        assert_eq!(again.len(), 2, "{what}");
    }
}

#[test]
fn a_quiet_session_does_not_rewrite_the_file() {
    let mut host = MemoryHost::new();
    cold(&mut host, NOTES).close(&mut host).expect("closes");
    assert_eq!(
        host.writes_on(stored::FILE).0,
        1,
        "the cold opening writes once, flush and close together"
    );

    let mut again = ReminderIndex::new();
    again.activate(&mut host).expect("activates");
    let entries = shown(NOTES);
    assert_eq!(again.up_to_date(&entries).len(), 3);
    again.reconcile(&alive(&entries));
    again.flush(&mut host).expect("flushes");
    again.close(&mut host).expect("closes");
    assert_eq!(
        host.writes_on(stored::FILE).0,
        1,
        "nothing changed, nothing written"
    );
}

#[test]
fn the_file_is_a_cache_not_user_data() {
    let mut host = MemoryHost::new();
    cold(&mut host, NOTES).close(&mut host).expect("closes");
    assert!(host.cache_read(stored::FILE).unwrap().is_some());
    assert!(
        host.data_read(stored::FILE).unwrap().is_none(),
        "a derivative never enters the data space a backup carries"
    );
}

#[test]
fn an_empty_vault_gets_no_file() {
    let mut host = MemoryHost::new();
    let index = cold(&mut host, &[]);
    let mut index = index;
    index.close(&mut host).expect("closes");
    assert_eq!(host.writes_on(stored::FILE).0, 0);
    assert!(host.cache_read(stored::FILE).unwrap().is_none());

    // Le note prese a sessione aperta non hanno revisione: ancora niente.
    let mut index = ReminderIndex::new();
    index.activate(&mut host).unwrap();
    index.reconcile(&[]);
    index.on_documents_indexed(&[model("a.md", NOTES[0].2)]);
    index.flush(&mut host).unwrap();
    assert_eq!(host.writes_on(stored::FILE).0, 0);
}

#[test]
fn a_vault_emptied_keeps_its_file_true() {
    let mut host = MemoryHost::new();
    cold(&mut host, NOTES).close(&mut host).expect("closes");
    let mut again = ReminderIndex::new();
    again.activate(&mut host).unwrap();
    again.up_to_date(&[]);
    again.reconcile(&[]);
    again.close(&mut host).unwrap();
    assert_eq!(host.writes_on(stored::FILE).0, 2, "rewritten empty");
    let mut third = ReminderIndex::new();
    third.activate(&mut host).unwrap();
    assert!(third.up_to_date(&shown(NOTES)).is_empty());
    assert!(third.is_empty());
}

#[test]
fn a_failed_write_is_not_an_error_and_is_not_retried() {
    // Un vault in sola lettura: la cache non si scrive. Il flush non dà
    // errore (il file è un derivato), e la stessa sessione non ci riprova.
    let mut host = MemoryHost::new();
    host.denies_write(stored::FILE);
    let mut index = ReminderIndex::new();
    index.activate(&mut host).unwrap();
    index.up_to_date(&[entry("a.md", Some("sha256:a1"))]);
    index.on_documents_indexed(&[model("a.md", NOTES[0].2)]);
    index
        .flush(&mut host)
        .expect("a derivative not written is no error");
    index.on_documents_indexed(&[model("b.md", NOTES[1].2)]);
    let mut other = MemoryHost::new();
    index.flush(&mut other).expect("still no error");
    index.close(&mut other).expect("closes");
    assert_eq!(
        other.writes_on(stored::FILE).0,
        0,
        "given up for the session: no attempt on every flush"
    );

    // La prossima apertura rilegge le note e ci riprova.
    let mut again = ReminderIndex::new();
    again.activate(&mut other).unwrap();
    again.up_to_date(&[entry("a.md", Some("sha256:a1"))]);
    again.on_documents_indexed(&[model("a.md", NOTES[0].2)]);
    again.flush(&mut other).unwrap();
    assert_eq!(other.writes_on(stored::FILE).0, 1);
}

/// La storia delle regole di lettura: per ogni [`stored::RULE`], l'impronta
/// dei promemoria che il corpus dà. Se il test fallisce, la lettura è
/// cambiata: alza `RULE` e aggiungi una riga, così i file scritti con la
/// lettura di prima si buttano. Non correggere l'impronta di una riga che
/// c'è.
const RULE_HISTORY: &[(u32, u64)] = &[(1, 0xc81a_f619_d7da_7c28)];

/// Compiti che toccano ogni parte della lettura: forme dell'ora, compiti
/// chiusi, annidati, in citazione, con formattazione, link e titoli.
const RULE_CORPUS: &str = "\
# Casa

- [ ] Semplice ⏰ 2026-11-13 09:00
- [x] Chiuso ⏰ 2026-11-13 09:00
- [ ] Senza ora ⏰ 2026-11-13
- [ ] Ora corta ⏰ 2026-11-13 9:05
- [ ] **Forte** e _corsivo_ ⏰ 2026-11-14 10:30 dopo
- [ ] Con [link](x.md) e [[nota]] ⏰ 2026-11-14 11:00
- [ ] `codice` ⏰ 2026-11-14 12:00
- [ ] Falso ⏰ 2026-13-40 25:61
- [ ] Doppio ⏰ 2026-11-15 08:00 e ⏰ 2026-11-16 08:00

## Lavoro

> - [ ] In citazione ⏰ 2026-11-17 07:00

1. [ ] Numerato ⏰ 2026-11-18 06:00
   - [ ] Annidato ⏰ 2026-11-18 06:30
- [-] Annullato ⏰ 2026-11-19 05:00
- [ ] ==Evidenziato== ⏰ 2026-11-20 04:00
";

#[test]
fn the_reading_rule_is_bound_to_what_it_reads() {
    let found = reminders_of(&model("regola.md", RULE_CORPUS));
    assert!(found.len() > 5, "the corpus reads: {found:?}");
    let mut rendered = String::new();
    for r in &found {
        rendered.push_str(&format!(
            "{}|{}|{}|{:?}\n",
            r.minute, r.at, r.text, r.heading
        ));
    }
    // FNV-1a 64: stabile fra versioni di Rust, a differenza di `DefaultHasher`.
    let print = rendered.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    });
    let (last_rule, last_print) = *RULE_HISTORY.last().expect("history");
    assert_eq!(
        last_rule,
        stored::RULE,
        "RULE is the last row of the history"
    );
    assert!(
        RULE_HISTORY.windows(2).all(|w| w[0].0 < w[1].0),
        "one row per rule, in order"
    );
    assert_eq!(
        print,
        last_print,
        "the reminders read from the same text changed: raise stored::RULE and \
         add a row ({}, {print:#x}) to RULE_HISTORY\n{rendered}",
        stored::RULE + 1
    );
}
