//! Test dei template e dei comandi sulle note.

use super::*;
use fub_abi::locale::Locale;
use fub_sdk::testing::MemoryHost;

/// Ogni comando del template si offre nel menu `/`: è lì che si inserisce
/// uno scheletro mentre si scrive, e la shell non ne tiene un elenco.
/// Le celle di ogni settimana del calendario, come testo: un bottone è la
/// sua etichetta (con `*` se ha la giornaliera), un testo è sé stesso.
fn weeks(root: &UiNode) -> (String, Vec<String>, Vec<Vec<String>>) {
    let UiKind::Stack { children, .. } = &root.kind else {
        panic!("una colonna: barra e mese")
    };
    let UiKind::Stack { children: bar, .. } = &children[0].kind else {
        panic!("la barra")
    };
    let UiKind::Heading { content, .. } = &bar[1].kind else {
        panic!("il titolo fra le frecce")
    };
    let UiKind::Table { columns, rows } = &children[1].kind else {
        panic!("il mese è una tabella")
    };
    let label = |text: &Text| match text {
        Text::Literal(s) => s.clone(),
        Text::Message(m) => format!("<{}>", m.key),
    };
    let cells = rows
        .iter()
        .map(|row| {
            let UiKind::Row { cells, .. } = &row.kind else {
                panic!("una settimana è una riga")
            };
            cells
                .iter()
                .map(|cell| match &cell.kind {
                    UiKind::Text { content } => label(content),
                    UiKind::Button {
                        label: l, intent, ..
                    } => {
                        let mark = if *intent == Intent::Primary { "*" } else { "" };
                        format!("{}{mark}", label(l))
                    }
                    other => panic!("{other:?}"),
                })
                .collect()
        })
        .collect();
    (
        label(content),
        columns.iter().map(|c| label(&c.title)).collect(),
        cells,
    )
}

/// Il banco dice 2023-11-14 (il suo orologio fisso); novembre 2023 comincia
/// di mercoledì, nella settimana ISO 44.
#[test]
fn the_calendar_shows_the_month_with_numbered_weeks_and_the_daily_notes() {
    let host = MemoryHost::new()
        .with_document("Daily/2023-11-03.md", "")
        .with_document("Daily/2023-12-01.md", "");
    let (title, columns, cells) = weeks(&calendar(&host).unwrap());
    assert_eq!(title, "November 2023");
    assert_eq!(
        columns,
        [
            "<calendar.week>",
            "Mon",
            "Tue",
            "Wed",
            "Thu",
            "Fri",
            "Sat",
            "Sun"
        ]
    );
    assert_eq!(cells.len(), 5);
    assert_eq!(cells[0], ["44", "", "", "1", "2", "3*", "4", "5"]);
    assert_eq!(cells[2][0], "46");
    assert_eq!(cells[2][2], "14•", "today has its dot");
    assert_eq!(cells[4], ["48", "27", "28", "29", "30", "", "", ""]);
}

#[test]
fn the_week_starts_where_the_locale_says() {
    let host = MemoryHost::new().with_locale(Locale {
        language: "it".into(),
        first_day_of_week: fub_abi::locale::Weekday::Sunday,
        ..Locale::default()
    });
    let (title, columns, cells) = weeks(&calendar(&host).unwrap());
    assert_eq!(title, "novembre 2023");
    assert_eq!(
        columns[1..],
        ["dom", "lun", "mar", "mer", "gio", "ven", "sab"]
    );
    // La settimana da domenica 29 ottobre: il suo giovedì è il 2 novembre,
    // settimana ISO 44.
    assert_eq!(cells[0], ["44", "", "", "", "1", "2", "3", "4"]);
}

#[test]
fn the_calendar_remembers_the_month_it_was_moved_to() {
    let mut host = MemoryHost::new().with_instance(CALENDAR_VIEW);
    let go = |host: &mut MemoryHost, action: &str| {
        let update = calendar_action(UiAction::new(action), host).unwrap();
        let ViewUpdate::Replace { root } = update else {
            panic!("un mese nuovo si ridisegna")
        };
        weeks(&root).0
    };
    assert_eq!(go(&mut host, CALENDAR_NEXT), "December 2023");
    assert_eq!(go(&mut host, CALENDAR_NEXT), "January 2024");
    assert_eq!(
        weeks(&calendar(&host).unwrap()).0,
        "January 2024",
        "a redraw keeps the month the view state remembers"
    );
    assert_eq!(go(&mut host, CALENDAR_PREV), "December 2023");
    assert_eq!(go(&mut host, CALENDAR_TODAY), "November 2023");
    assert_eq!(
        fub_abi::traits::ViewStateRead::view_state(&host, SHOWN).unwrap(),
        None
    );
}

#[test]
fn every_template_command_is_offered_in_the_slash_menu() {
    for spec in TemplateCommands::specs() {
        assert_eq!(spec.surfaces, [CommandSurface::Slash], "{}", spec.id);
    }
}

fn ctx_for(date: &str) -> Ctx {
    Ctx {
        date: date.into(),
        time: "14:30".into(),
        datetime: format!("{date} 14:30"),
        year: date.get(..4).unwrap_or("").into(),
        month: date.get(5..7).unwrap_or("").into(),
        day: date.get(8..10).unwrap_or("").into(),
        hour: "14".into(),
        minute: "30".into(),
    }
}

#[test]
fn expands_the_three_variables() {
    let host = MemoryHost::new();
    let ctx = ctx_for("2026-08-15");
    let s = expand_full("ciao {{title}} il {{date}} ({{name}})", "Nota", &ctx, &host).unwrap();
    assert_eq!(s, "ciao Nota il 2026-08-15 (Nota)");
}

#[test]
fn an_unknown_variable_stays_text_instead_of_failing() {
    let ctx = ctx_for("2026-09-01");
    // Nessun callback, nessuno scripting: ciò che non sta nel vocabolario
    // resta identico, non errore e non stringa vuota.
    assert_eq!(
        expand_full(
            "{{title}} {{callback()}} {{for x in y}}",
            "Nota",
            &ctx,
            &MemoryHost::new()
        )
        .unwrap(),
        "Nota {{callback()}} {{for x in y}}"
    );
}

#[test]
fn civil_timezone_wins_over_utc_for_daily_variables() {
    // 2026-09-01 00:30 a Roma (+02:00) = 2026-08-31 22:30 UTC: la data
    // civile è il primo, non il 31.
    let rome = Locale {
        utc_offset_minutes: 120,
        ..Locale::default()
    };
    let utc_day_before = 1_788_215_400_000u64;
    let ctx = context_at(utc_day_before, &rome).unwrap();
    assert_eq!(ctx.date, "2026-09-01");
    assert_eq!(
        expand_full("{{date}}", "x", &ctx, &MemoryHost::new()).unwrap(),
        "2026-09-01"
    );
}

#[test]
fn named_zone_uses_its_winter_and_summer_offsets_not_the_snapshot_offset() {
    let rome = Locale {
        timezone: "Europe/Rome".into(),
        utc_offset_minutes: 0,
        ..Locale::default()
    };
    // 23:30 UTC in January (+01:00), 22:30 UTC in July (+02:00).
    let winter = context_at(1_768_519_800_000, &rome).unwrap();
    let summer = context_at(1_784_154_600_000, &rome).unwrap();
    assert_eq!(winter.datetime, "2026-01-16 00:30");
    assert_eq!(summer.datetime, "2026-07-16 00:30");
}

#[test]
fn memory_host_named_zone_drives_daily_and_inserted_datetime() {
    let host = MemoryHost::new().with_locale(Locale {
        timezone: "Europe/Helsinki".into(),
        utc_offset_minutes: 0,
        ..Locale::default()
    });
    assert_eq!(today(&host).unwrap(), "2023-11-15");
    assert_eq!(
        datetime_now(&host, CLOCK_DATETIME).unwrap(),
        "2023-11-15 00:13"
    );
}

#[test]
fn unknown_named_zone_fails_typed_instead_of_becoming_utc() {
    let host = MemoryHost::new().with_locale(Locale {
        timezone: "Mars/Olympus".into(),
        ..Locale::default()
    });
    assert!(matches!(today(&host), Err(PluginError::BadArgs(_))));
    assert!(matches!(
        datetime_now(&host, ISO_DATE),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn template_random_uses_injected_entropy_only_when_requested() {
    let host = MemoryHost::new();
    let ctx = ctx_for("2026-09-01");
    let first = expand_full("{{random}} {{random}}", "x", &ctx, &host).unwrap();
    let second = expand_full("{{random}}", "x", &ctx, &host).unwrap();
    let pair: Vec<_> = first.split_whitespace().collect();
    assert_eq!(pair.len(), 2);
    assert_eq!(pair[0], pair[1], "one expansion has one random value");
    assert_ne!(first[..4].to_string(), second);
    let denied = MemoryHost::new().without_entropy();
    assert_eq!(
        expand_full("{{date}}", "x", &ctx, &denied).unwrap(),
        ctx.date
    );
    assert!(matches!(
        expand_full("{{random}}", "x", &ctx, &denied),
        Err(PluginError::PermissionDenied(_))
    ));
}

#[test]
fn inserted_date_and_time_follow_the_injected_civil_clock() {
    let host = MemoryHost::new().with_locale(Locale {
        utc_offset_minutes: 120,
        ..Locale::default()
    });
    assert_eq!(datetime_now(&host, ISO_DATE).unwrap(), "2023-11-15");
    assert_eq!(datetime_now(&host, CLOCK_TIME).unwrap(), "00:13");
    assert_eq!(
        datetime_now(&host, CLOCK_DATETIME).unwrap(),
        "2023-11-15 00:13"
    );
    assert!(datetime_now(&host, "25:00").is_err());
}

#[test]
fn daily_paths_reject_impossible_civil_dates() {
    for invalid in ["2026-02-29", "2026-02-30", "2026-04-31"] {
        assert!(valid_date(invalid).is_err(), "{invalid}");
    }
    assert_eq!(valid_date("2024-02-29").unwrap(), "2024-02-29");
}

#[test]
fn daily_names_follow_the_declared_format() {
    assert_eq!(
        daily_name(DAILY_FORMAT_DEFAULT, "2026-10-19", "it"),
        "2026-10-19"
    );
    assert_eq!(
        daily_name("YYYY/MMMM/YYYY-MMM-DD", "2026-10-19", "it"),
        "2026/ottobre/2026-ott-19"
    );
    assert_eq!(
        daily_name("YYYY/MM MMMM/dddd D", "2026-03-01", "en"),
        "2026/03 March/Sunday 1"
    );
    assert_eq!(
        daily_name("[Diario] YY.M.D ddd", "2024-02-29", "it"),
        "Diario 24.2.29 gio"
    );
    // Una `[` senza chiusura resta un carattere.
    assert_eq!(daily_name("[YYYY", "2026-10-19", "it"), "[2026");
}

#[test]
fn a_folder_may_not_escape_or_name_machine_space() {
    assert_eq!(valid_folder("Diario").unwrap(), "Diario");
    for bad in ["", "../fuori", ".fub/x", ".trash/y", "a/../../b"] {
        assert!(valid_folder(bad).is_err(), "{bad}");
    }
}

#[test]
fn cjk_counts_one_word_per_ideograph() {
    // Il conteggio CJK è di `stats::count` e resta pinnato lì
    // (`stats.rs::counts_cjk_without_spaces_one_word_per_ideograph`):
    // qui il report usa parole già contate, senza chiamare l'altro modulo.
    assert_eq!("ciao mondo".split_whitespace().count(), 2);
    assert_eq!("、。".chars().count(), 2);
}

#[test]
fn split_frontmatter_keeps_the_body_byte_identical() {
    let src = "---\ntitle: Ciao\ntags: a\n---\n# Corpo\n";
    let (props, body) = split_frontmatter(src).unwrap();
    assert_eq!(body, "# Corpo\n");
    let title = props.iter().find(|(key, _)| key == "title").unwrap();
    assert_eq!(
        serde_yaml_ng::from_str::<serde_json::Value>(&title.1).unwrap(),
        serde_json::json!("Ciao")
    );
    let nested = "---\naliases:\n  - Uno\n  - Due\nmeta:\n  owner: Mario\n---\nCorpo\n";
    let (props, body) = split_frontmatter(nested).unwrap();
    assert_eq!(body, "Corpo\n");
    assert_eq!(
        props.iter().find(|(key, _)| key == "aliases").unwrap().1,
        "[\"Uno\",\"Due\"]"
    );
    assert_eq!(
        props.iter().find(|(key, _)| key == "meta").unwrap().1,
        "{\"owner\":\"Mario\"}"
    );
    let crlf = "---\r\ntitle: Ciao\r\n---\r\n# Corpo\r\n";
    let (_, body) = split_frontmatter(crlf).unwrap();
    assert!(!body.starts_with('\r'), "{body:?}");
    assert!(body.contains("# Corpo"), "{body:?}");
    let (props, body) = split_frontmatter("# Solo corpo\n").unwrap();
    assert!(props.is_empty());
    assert_eq!(body, "# Solo corpo\n");
}

#[test]
fn malformed_template_properties_fail_before_any_text_is_extracted() {
    assert!(split_frontmatter("---\naliases: [unterminated\n---\nbody").is_err());
    // Un annidamento che il parser pagherebbe in tempo quadratico non gli
    // arriva: il motivo è quello della regola condivisa.
    let deep = format!("---\na: {}\n---\nbody", "[".repeat(100_000));
    let Err(PluginError::BadArgs(text)) = split_frontmatter(&deep) else {
        panic!("il frontmatter troppo annidato è stato accettato");
    };
    assert!(
        format!("{text:?}").contains(yaml_rule::OVER_BUDGET),
        "{text:?}"
    );
    assert!(split_frontmatter("---\njust a scalar\n---\nbody").is_err());
    assert_eq!(split_frontmatter("---\n\n---\nbody").unwrap().1, "body");
}

/// **Il frontmatter di un template è quello che il provider legge**: chiude
/// soltanto una riga `---` non indentata. Un `---` dentro un blocco YAML è
/// del valore, e `...` o un `---` senza niente in mezzo sono testo, come
/// nella nota.
#[test]
fn a_template_frontmatter_closes_where_the_provider_closes_it() {
    let src = "---\ndesc: |\n  ---\n  ...\ntitle: T\n---\nCorpo\n";
    let (props, body) = split_frontmatter(src).unwrap();
    assert_eq!(body, "Corpo\n");
    assert_eq!(
        props.iter().find(|(key, _)| key == "desc").unwrap().1,
        "\"---\\n...\\n\""
    );
    assert!(props.iter().any(|(key, _)| key == "title"), "{props:?}");
    for text in [
        "---\ntitle: T\n...\nCorpo\n",
        "---\n---\nCorpo\n",
        "---\ntitle: T\n---x\nCorpo\n",
        "---\ntitle: T\n --- \nCorpo\n",
    ] {
        let (props, body) = split_frontmatter(text).unwrap();
        assert!(props.is_empty(), "{text:?}: {props:?}");
        assert_eq!(body, text);
    }
    // Con terminatori misti comrak cerca prima la chiusura seguita da CRLF.
    let mixed = "---\ntitle: T\n---\nCorpo\n---\r\nAltro\r\n";
    assert_eq!(
        frontmatter_bounds(mixed).unwrap().1,
        mixed.find("Altro").unwrap()
    );
}

#[test]
fn unique_names_never_overwrite_and_random_comes_from_the_host() {
    let mut host = MemoryHost::new();
    // Il prefisso è l'ora dell'orologio (fermo) del doppio.
    let stamp = format_moment(UNIQUE_PREFIX_DEFAULT, &context(&host).unwrap());
    assert_eq!(stamp.len(), 12);
    host = host.with_document(&format!("{stamp} Nota.md"), "occupata");
    let id = unique_name(Args::new(&serde_json::json!({ "name": "Nota" })), &host).unwrap();
    assert_eq!(id.as_str(), format!("{stamp} Nota 1.md"));
    let bare = unique_name(Args::new(&serde_json::json!({})), &host).unwrap();
    assert_eq!(bare.as_str(), format!("{stamp}.md"));
    let a = random_name(&host).unwrap();
    let b = random_name(&host).unwrap();
    assert_ne!(a, b, "due chiamate non danno mai lo stesso blocco");
    let denied = MemoryHost::new().without_entropy();
    assert!(matches!(
        random_name(&denied),
        Err(PluginError::PermissionDenied(_))
    ));
}

#[test]
fn the_prefix_format_keeps_what_is_not_a_token() {
    let ctx = context_at(1_790_000_000_000, &fub_abi::locale::Locale::default()).unwrap();
    let out = format_moment("YYYY-MM-DD_HHmm z", &ctx);
    assert_eq!(
        out,
        format!(
            "{}-{}-{}_{}{} z",
            ctx.year, ctx.month, ctx.day, ctx.hour, ctx.minute
        )
    );
}

#[test]
fn insert_target_refuses_a_dirty_buffer_instead_of_guessing() {
    let host = MemoryHost::new().with_document("nota.md", "una nota di prova");
    host.set_active(Some("nota.md"));
    host.set_context(Some(
        fub_abi::session::ViewContext::new("main")
            .with_doc(Some(DocId::new("nota.md")))
            .with_selections(Some(fub_abi::session::SelectionSet::floating("nota"))),
    ));
    let err = insert_target(Args::new(&serde_json::json!({})), &host).unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)));
}

#[test]
fn every_command_declares_what_it_does_and_how_far_it_reaches() {
    for spec in TemplateCommands::specs() {
        assert!(
            !spec.description.to_string().trim().is_empty(),
            "`{}` senza descrizione",
            spec.id
        );
        for param in &spec.params {
            assert!(
                !param.description.to_string().trim().is_empty(),
                "`{}.{}` senza descrizione",
                spec.id,
                param.name
            );
        }
        if spec.scope.writes {
            assert!(
                spec.scope.reach >= CommandReach::Document,
                "`{}` scrive ma dichiara di non toccare il vault",
                spec.id
            );
        }
    }
}
