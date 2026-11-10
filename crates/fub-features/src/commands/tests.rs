//! Test dei comandi ufficiali.

use super::*;

use fub_abi::model::{DocId, ListItem};
use fub_abi::session::{SelectionSet, ViewContext};
use fub_abi::settings::SettingSpec;
use fub_abi::text::Strings;
use fub_abi::traits::{DataRead, VaultRead};
use fub_sdk::testing::MemoryHost;
use serde_json::json;

/// Il menu `/` lo dichiarano i comandi: la shell non ne tiene un elenco.
/// Chi trasforma la selezione compare solo con una selezione; gli altri
/// del registro restano della palette.
#[test]
fn the_slash_menu_is_declared_by_the_commands() {
    let surfaces = |id: &str| {
        CoreCommands::specs()
            .into_iter()
            .find(|spec| spec.id == id)
            .map(|spec| spec.surfaces)
            .unwrap_or_else(|| panic!("{id} is in the registry"))
    };
    assert_eq!(
        surfaces(SELECTION_WIKILINK),
        [CommandSurface::SlashSelection]
    );
    assert_eq!(surfaces(VAULT_REPLACE), [CommandSurface::SlashSelection]);
    assert_eq!(surfaces(NOTES_TASK_TOGGLE), [CommandSurface::Slash]);
    for id in [
        NOTES_CREATE,
        NOTES_RENAME,
        NOTES_TRASH,
        TRASH_EMPTY,
        SETTINGS_RESET,
    ] {
        assert!(surfaces(id).is_empty(), "{id} belongs to the palette only");
    }
}

fn invoke(
    host: &mut MemoryHost,
    command: &str,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    // Come farebbe il kernel: prima la convalida contro la spec, poi la
    // chiamata. Un test che saltasse la convalida proverebbe un percorso
    // che non esiste.
    let spec = CoreCommands::specs()
        .into_iter()
        .find(|s| s.id == command)
        .expect("comando dichiarato");
    spec.validate_args(&args)?;
    CoreCommands.invoke(command, args, mode, host)
}
#[test]
fn creation_in_a_folder_places_the_free_name_there() {
    let mut host = MemoryHost::new();
    let navigate = |outcome: CommandOutcome| match outcome.effect {
        CommandEffect::Navigate { doc } => doc,
        other => panic!("navigate atteso, arrivato {other:?}"),
    };
    let first = invoke(
        &mut host,
        NOTES_CREATE,
        json!({ "folder": "Progetti/" }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert_eq!(navigate(first).as_str(), "Progetti/Senza titolo.md");
    let named = invoke(
        &mut host,
        NOTES_CREATE,
        json!({ "folder": "Progetti", "name": "Idea" }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert_eq!(navigate(named).as_str(), "Progetti/Idea.md");
    // Un path esplicito non viene ribasato.
    let explicit = invoke(
        &mut host,
        NOTES_CREATE,
        json!({ "folder": "Progetti", "name": "Altrove/Idea" }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert_eq!(navigate(explicit).as_str(), "Altrove/Idea.md");
}

#[test]
fn creation_persists_prefilled_properties_atomically_and_rejects_duplicate_keys() {
    let mut host = MemoryHost::new();
    let outcome = invoke(&mut host, NOTES_CREATE, json!({
        "name": "Boards/Card",
        "properties": r#"{"status":"ready","rating":2,"tags":["a","b"],"metadata":{"owner":"x:y"}}"#
    }), InvokeMode::Apply).unwrap();
    assert!(matches!(outcome.effect, CommandEffect::Navigate { .. }));
    let source = host.read_document(&DocId::new("Boards/Card.md")).unwrap();
    let content = source
        .strip_prefix("---\n")
        .unwrap()
        .strip_suffix("---\n")
        .unwrap();
    let yaml: serde_json::Value = serde_yaml_ng::from_str(content).unwrap();
    assert_eq!(
        yaml,
        json!({"status":"ready","rating":2,"tags":["a","b"],"metadata":{"owner":"x:y"}})
    );
    assert!(invoke(
        &mut host,
        NOTES_CREATE,
        json!({
            "name": "Boards/Duplicate", "properties": r#"{"status":1,"status":2}"#
        }),
        InvokeMode::Apply
    )
    .is_err());
    assert!(host
        .read_document(&DocId::new("Boards/Duplicate.md"))
        .is_err());
}

/// Un `Text` **come lo legge chi guarda**: risolto col catalogo di questo
/// componente, invece che stampato col suo `Display`.
///
/// `Display` c'è ancora e serve — è la forma per il log della 0041 — ma per
/// un `Text::Message` stampa la chiave e gli argomenti, non la frase. Le
/// asserzioni che leggevano prosa devono passare di qui, e ci guadagnano:
/// adesso provano anche che quella chiave nel catalogo ci sia.
fn rendered(text: &Text) -> String {
    let catalog = catalog();
    let locale = fub_abi::locale::Locale::default();
    Strings::new(&catalog, "it", &locale).render(text)
}

fn plan(outcome: &CommandOutcome) -> &CommandPlan {
    match &outcome.effect {
        CommandEffect::Plan(plan) => plan,
        other => panic!("un dry-run risponde con un piano, non con {other:?}"),
    }
}

#[test]
fn every_command_declares_what_it_does_and_how_far_it_reaches() {
    for spec in CoreCommands::specs() {
        assert!(
            !spec.description.to_string().trim().is_empty(),
            "`{}` senza descrizione: è l'unico ingrediente su cui un \
                 chiamante non umano sceglie",
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

#[test]
fn opening_the_search_is_an_intent_for_the_shell_not_a_write() {
    let mut host = MemoryHost::new();
    let outcome = invoke(
        &mut host,
        SEARCH_OPEN,
        json!({ "query": "{\"any\":[{\"all\":[{\"negated\":false,\"predicate\":{\"kind\":\"tag\",\"name\":\"rust\",\"descendants\":false}}]}]}" }),
        InvokeMode::Apply,
    )
    .expect("cerca");
    assert_eq!(
        outcome.effect,
        CommandEffect::RunSearch {
            query: "{\"any\":[{\"all\":[{\"negated\":false,\"predicate\":{\"kind\":\"tag\",\"name\":\"rust\",\"descendants\":false}}]}]}".into()
        }
    );
}

#[test]
fn the_wikilink_command_needs_a_selection_that_is_true_for_the_file() {
    let mut host = MemoryHost::new().with_document("nota.md", "una nota di prova");
    host.set_active(Some("nota.md"));
    // Buffer sporco: c'è il testo, non lo span (decisione 0007).
    host.set_context(Some(
        ViewContext::new("main")
            .with_doc(Some(DocId::new("nota.md")))
            .with_selections(Some(SelectionSet::floating("nota"))),
    ));
    let err = invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::Apply).unwrap_err();
    let PluginError::BadArgs(msg) = err else {
        panic!("uno stato che non permette l'operazione si spiega")
    };
    assert!(rendered(&msg).contains("non salvate"), "{}", rendered(&msg));
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        "una nota di prova",
        "e non ha scritto niente"
    );
}

#[test]
fn the_wikilink_command_wraps_exactly_the_selected_bytes() {
    let mut host = MemoryHost::new().with_document("nota.md", "parlo di Kant e di altro");
    host.set_active(Some("nota.md"));
    host.set_selection(9, "Kant");

    let plan_first =
        invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::DryRun).expect("simula");
    assert_eq!(
        plan(&plan_first).docs,
        vec![DocId::new("nota.md")],
        "il piano nomina la nota che toccherebbe"
    );
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        "parlo di Kant e di altro",
        "una simulazione non scrive"
    );

    let outcome =
        invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::Apply).expect("applica");
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        "parlo di [[Kant]] e di altro"
    );
    let CommandEffect::Reveal { span, .. } = outcome.effect else {
        panic!("dopo aver scritto, la shell deve sapere dove guardare")
    };
    assert_eq!(
        span,
        Span::new(9, 17),
        "le coordinate sono quelle del testo NUOVO: `[[Kant]]`"
    );
}

#[test]
fn the_wikilink_command_refuses_a_single_left_bracket_in_the_selection() {
    let mut host = MemoryHost::new().with_document("nota.md", "parlo di [Kant e di altro");
    host.set_active(Some("nota.md"));
    host.set_selection(9, "[Kant");

    let err = invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::DryRun)
        .expect_err("una parentesi sinistra singola non può diventare un wikilink valido");
    assert!(
        matches!(err, PluginError::BadArgs(_)),
        "la selezione già simile a un link va rifiutata, arrivato {err:?}"
    );
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        "parlo di [Kant e di altro"
    );
}

#[test]
fn a_dry_run_of_a_bulk_replace_says_what_it_would_do_and_writes_nothing() {
    let mut host = MemoryHost::new()
        .with_document("a.md", "il gatto e il gatto")
        .with_document("b.md", "nessun felino")
        .with_document("c.md", "un gatto solo");

    let outcome = invoke(
        &mut host,
        VAULT_REPLACE,
        json!({ "find": "gatto", "replace": "cane" }),
        InvokeMode::DryRun,
    )
    .expect("simula");
    let plan = plan(&outcome);
    assert_eq!(
        plan.docs,
        vec![DocId::new("a.md"), DocId::new("c.md")],
        "le note senza occorrenze non entrano nel piano"
    );
    assert_eq!(plan.edit_count(), 3);
    assert_eq!(
        rendered(&plan.summary),
        "Sostituzioni: 3 · Note: 2",
        "il riassunto conta le sostituzioni e le note, e lo dice nella \
             lingua di chi legge"
    );
    assert_eq!(
        host.read_document(&DocId::new("a.md")).unwrap(),
        "il gatto e il gatto"
    );
}

#[test]
fn a_bulk_replace_applies_to_the_documents_it_was_given() {
    let mut host = MemoryHost::new()
        .with_document("a.md", "il gatto")
        .with_document("b.md", "il gatto");
    invoke(
        &mut host,
        VAULT_REPLACE,
        json!({ "find": "gatto", "replace": "cane", "docs": ["b.md"] }),
        InvokeMode::Apply,
    )
    .expect("applica");
    assert_eq!(host.read_document(&DocId::new("a.md")).unwrap(), "il gatto");
    assert_eq!(host.read_document(&DocId::new("b.md")).unwrap(), "il cane");
}

#[test]
fn whole_words_only_is_the_difference_between_a_fix_and_a_mess() {
    assert_eq!(
        occurrences("nota, annotazione, nota", "nota", false).len(),
        3,
        "senza il vincolo, `nota` si trova dentro `annotazione`"
    );
    let whole = occurrences("nota, annotazione, nota", "nota", true);
    assert_eq!(whole, vec![Span::new(0, 4), Span::new(19, 23)]);
    // Accentate: il confine è un carattere, non un byte.
    assert!(occurrences("però", "per", true).is_empty());
}

#[test]
fn an_empty_needle_is_refused_even_though_the_schema_accepts_it() {
    let mut host = MemoryHost::new().with_document("a.md", "x");
    let err = invoke(
        &mut host,
        VAULT_REPLACE,
        json!({ "find": "", "replace": "y" }),
        InvokeMode::DryRun,
    )
    .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)));
}

// -----------------------------------------------------------------------
// note.task.toggle — il cliente one-shot del modello (decisione 0018)
// -----------------------------------------------------------------------
/// Il sorgente e il modello che gli corrisponde, con gli span contati a
/// mano: due task, la seconda annidata nella prima.
///
/// ```text
/// - [ ] fare la spesa\n  - [x] pane\n
/// 0  3               19  22 25     32
/// ```
///
/// L'host in memoria non parsa (e non deve: proverebbe la feature contro un
/// provider invece che contro il contratto), quindi il modello lo si semina
/// — ed è l'occasione per dire negli span esattamente cosa il comando si
/// aspetta di ricevere.
const TASK_SOURCE: &str = "- [ ] fare la spesa\n  - [x] pane\n";

fn with_task(symbol_external: Option<char>) -> MemoryHost {
    let inner = ListItem {
        blocks: Vec::new(),
        task: Some(TaskMarker {
            symbol: Some('x'),
            span: Span::new(25, 26),
        }),
        span: Span::new(22, 32),
    };
    let external = ListItem {
        blocks: vec![Block::List {
            ordered: false,
            start: None,
            items: vec![inner],
            anchor: None,
            span: Span::new(22, 32),
        }],
        task: Some(TaskMarker {
            symbol: symbol_external,
            span: Span::new(3, 4),
        }),
        span: Span::new(0, 32),
    };
    let mut model = DocumentModel::empty(DocId::new("nota.md"));
    model.body = vec![Block::List {
        ordered: false,
        start: None,
        items: vec![external],
        anchor: None,
        span: Span::new(0, 32),
    }];
    let host = MemoryHost::new()
        .with_document("nota.md", TASK_SOURCE)
        .with_model("nota.md", model);
    host.set_active(Some("nota.md"));
    host
}

#[test]
fn checking_a_task_writes_one_character_where_the_model_says() {
    let mut host = with_task(None);
    host.set_caret(Some(10)); // dentro il testo della voce esterna

    let outcome = invoke(&mut host, NOTES_TASK_TOGGLE, json!({}), InvokeMode::Apply)
        .expect("spunta il task sotto il cursore");

    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        "- [x] fare la spesa\n  - [x] pane\n",
        "un carattere solo: il testo del task, l'indentazione e la voce \
             annidata non si toccano"
    );
    let CommandEffect::Reveal { span, .. } = outcome.effect else {
        panic!("dopo aver scritto, la shell deve sapere dove guardare")
    };
    assert_eq!(span, Span::new(3, 4));
}

#[test]
fn the_innermost_task_wins_when_they_are_nested() {
    let mut host = with_task(None);
    // Una posizione che sta dentro **entrambe** le voci: la annidata è la
    // più stretta, ed è quella che l'utente sta guardando.
    invoke(
        &mut host,
        NOTES_TASK_TOGGLE,
        json!({ "doc": "nota.md", "at": [29] }),
        InvokeMode::Apply,
    )
    .expect("spunta");
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        "- [ ] fare la spesa\n  - [ ] pane\n"
    );
}

#[test]
fn a_custom_state_goes_back_to_undone_and_is_not_promoted_to_done() {
    let mut host = with_task(Some('/'));
    host.set_caret(Some(0));
    invoke(&mut host, NOTES_TASK_TOGGLE, json!({}), InvokeMode::Apply).expect("de-spunta");
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        "- [ ] fare la spesa\n  - [x] pane\n",
        "«in corso» non lo si promuove a «fatto»: quale sia il suo prossimo \
             stato è una domanda che il prodotto non ha ancora deciso"
    );
}

#[test]
fn a_dirty_buffer_stops_it_because_the_model_is_the_one_of_the_file() {
    let mut host = with_task(None);
    host.set_caret(None); // buffer sporco: nessuno span è vero (decisione 0007)

    let err = invoke(&mut host, NOTES_TASK_TOGGLE, json!({}), InvokeMode::Apply).unwrap_err();
    let PluginError::BadArgs(msg) = err else {
        panic!("uno stato che non permette l'operazione si spiega")
    };
    assert!(rendered(&msg).contains("non salvate"), "{}", rendered(&msg));
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        TASK_SOURCE,
        "e non ha scritto niente"
    );
}

#[test]
fn a_position_that_is_not_a_byte_offset_is_refused_before_the_write() {
    let mut host = with_task(None);
    for at in [json!([-1]), json!([3.5]), json!([9999])] {
        let err = invoke(
            &mut host,
            NOTES_TASK_TOGGLE,
            json!({ "doc": "nota.md", "at": at }),
            InvokeMode::Apply,
        )
        .unwrap_err();
        assert!(
            matches!(err, PluginError::BadArgs(_)),
            "`at` = {at}: una posizione che non nomina un task si dice, non \
                 si arrotonda a quello vicino"
        );
    }
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        TASK_SOURCE
    );
}

#[test]
fn naming_a_notes_without_saying_where_does_not_take_the_caret_of_another() {
    let mut host = with_task(None);
    host.set_caret(Some(10));
    let err = invoke(
        &mut host,
        NOTES_TASK_TOGGLE,
        json!({ "doc": "altra.md" }),
        InvokeMode::Apply,
    )
    .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)));
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        TASK_SOURCE,
        "il cursore di una nota non è una posizione in un'altra"
    );
}

#[test]
fn simulating_the_toggle_says_which_notes_it_would_touch_and_writes_nothing() {
    let mut host = with_task(None);
    host.set_caret(Some(10));
    let outcome =
        invoke(&mut host, NOTES_TASK_TOGGLE, json!({}), InvokeMode::DryRun).expect("simula");
    assert_eq!(plan(&outcome).docs, vec![DocId::new("nota.md")]);
    assert_eq!(plan(&outcome).edit_count(), 1);
    assert_eq!(
        host.read_document(&DocId::new("nota.md")).unwrap(),
        TASK_SOURCE
    );
}

/// La specie di una chiave la dichiara lo **schema**, e il comando la legge
/// da lì: è ciò che permette a `value` di essere testo — la sola forma che
/// un chiamante non interattivo (una CLI, un'automazione, un modello) sa
/// compilare.
#[test]
fn a_setting_value_is_read_according_to_the_kind_the_key_declares() {
    let number = SettingKind::Number {
        default: 14.0,
        min: Some(8.0),
        max: Some(72.0),
    };
    assert_eq!(
        parse_value(&number, " 18 ").unwrap(),
        SettingValue::Number(18.0)
    );
    assert!(parse_value(&number, "grande").is_err());

    let toggle = SettingKind::Toggle { default: true };
    assert_eq!(
        parse_value(&toggle, "off").unwrap(),
        SettingValue::Toggle(false)
    );
    assert!(
        parse_value(&toggle, "forse").is_err(),
        "un interruttore ha due stati, e «forse» non è uno di quelli"
    );

    // Un elenco si scrive con le virgole: chiedere il JSON vorrebbe dire
    // far scrivere virgolette dentro una stringa di un JSON.
    let list = SettingKind::List {
        default: Vec::new(),
    };
    assert_eq!(
        parse_value(&list, "a, b ,, c").unwrap(),
        SettingValue::List(vec!["a".into(), "b".into(), "c".into()])
    );
}

/// Il comando visto **dal contratto**: il doppio in memoria applica il
/// cancello della chiave come lo applica il kernel, quindi ciò che qui
/// passa è ciò che passa nell'app.
#[test]
fn the_command_refuses_a_key_that_is_not_program_writable_and_says_which() {
    let mut host = MemoryHost::new()
        .with_value(
            SettingSpec::toggle("versioning.enabled", "Versioning", true).program_writable(),
            SettingValue::Toggle(true),
        )
        .with_setting(SettingSpec::toggle(
            "privacy.telemetry",
            "Telemetria",
            false,
        ));

    let outcome = invoke(
        &mut host,
        SETTINGS_SET,
        json!({ "key": "versioning.enabled", "value": "false" }),
        InvokeMode::Apply,
    );
    assert!(outcome.is_ok(), "{outcome:?}");

    let error = invoke(
        &mut host,
        SETTINGS_SET,
        json!({ "key": "privacy.telemetry", "value": "true" }),
        InvokeMode::Apply,
    )
    .expect_err("non si è dichiarata scrivibile da un programma");
    assert!(
        matches!(error, PluginError::PermissionDenied(_)),
        "{error:?}"
    );

    // E una chiave che nessuno dichiara è un'altra cosa ancora: un errore
    // di chi la chiede, non un permesso che manca.
    let error = invoke(
        &mut host,
        SETTINGS_SET,
        json!({ "key": "boh", "value": "1" }),
        InvokeMode::Apply,
    )
    .expect_err("nessuno la dichiara");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
}

#[test]
fn an_empty_document_list_is_not_the_whole_vault() {
    let mut host = MemoryHost::new().with_document("a.md", "il gatto");
    let outcome = invoke(
        &mut host,
        VAULT_REPLACE,
        json!({ "find": "gatto", "replace": "cane", "docs": [] }),
        InvokeMode::DryRun,
    )
    .expect("simula");
    assert!(
        plan(&outcome).is_empty(),
        "elenco vuoto = nessuna nota, non «tutte»: è ciò che la spec dichiara"
    );
}
#[test]
fn archive_preflight_rejects_every_invalid_member_without_moving_anything() {
    let mut host = MemoryHost::new()
        .with_document("a.md", "a")
        .with_document("c.md", "c")
        .with_document("Archivio/c.md", "someone else");
    let outcome = invoke(
        &mut host,
        VAULT_ARCHIVE,
        json!({ "docs": ["a.md", "missing.md", "c.md"] }),
        InvokeMode::Apply,
    )
    .expect("preflight reports all failures");
    let partial = outcome.partial.expect("the batch was rejected");
    assert_eq!((partial.attempted, partial.done), (3, 0));
    assert_eq!(partial.failures.len(), 2);
    assert!(matches!(
        partial.failures[0].error,
        PluginError::NotFound(_)
    ));
    assert!(matches!(
        partial.failures[1].error,
        PluginError::AlreadyExists(_)
    ));
    assert_eq!(host.read_document(&DocId::new("a.md")).unwrap(), "a");
    assert!(matches!(
        host.document_revision(&DocId::new("Archivio/a.md")),
        Err(PluginError::NotFound(_))
    ));
    assert!(host.data_read(ARCHIVE_RECOVERY).unwrap().is_none());
    assert_eq!(host.writes_on(ARCHIVE_RECOVERY).0, 0);
}

#[test]
fn archive_preflight_rejects_two_sources_claiming_one_destination() {
    let mut host = MemoryHost::new()
        .with_document("one/same.md", "first")
        .with_document("two/same.md", "second");
    let outcome = invoke(
        &mut host,
        VAULT_ARCHIVE,
        json!({ "docs": ["one/same.md", "two/same.md"] }),
        InvokeMode::Apply,
    )
    .unwrap();
    let partial = outcome.partial.expect("duplicate destinations conflict");
    assert_eq!(partial.done, 0);
    assert_eq!(partial.failures.len(), 2);
    assert!(partial
        .failures
        .iter()
        .all(|failure| matches!(&failure.error, PluginError::Conflict(_))));
    assert_eq!(
        host.read_document(&DocId::new("one/same.md")).unwrap(),
        "first"
    );
    assert_eq!(
        host.read_document(&DocId::new("two/same.md")).unwrap(),
        "second"
    );
    assert!(host.data_read(ARCHIVE_RECOVERY).unwrap().is_none());
    assert_eq!(host.writes_on(ARCHIVE_RECOVERY).0, 0);
}

#[test]
fn archive_never_renames_without_a_durable_intent() {
    let mut host = MemoryHost::new().with_document("a.md", "original");
    host.denies_write(ARCHIVE_RECOVERY);
    let error = invoke(
        &mut host,
        VAULT_ARCHIVE,
        json!({ "docs": ["a.md"] }),
        InvokeMode::Apply,
    )
    .expect_err("an unwritable intent stops the batch");
    assert!(matches!(error, PluginError::Io(_)));
    assert_eq!(host.read_document(&DocId::new("a.md")).unwrap(), "original");
    assert!(matches!(
        host.document_revision(&DocId::new("Archivio/a.md")),
        Err(PluginError::NotFound(_))
    ));
}

#[test]
fn archive_recovery_resumes_after_persisted_and_unpersisted_moves() {
    let mut host = MemoryHost::new()
        .with_document("a.md", "a")
        .with_document("b.md", "b")
        .with_document("c.md", "c");
    let mut items: Vec<ArchiveItem> = ["a.md", "b.md", "c.md"]
        .into_iter()
        .map(|from| ArchiveItem {
            from: DocId::new(from),
            to: DocId::new(format!("Archivio/{from}")),
            preimage: host.document_revision(&DocId::new(from)).unwrap(),
            status: ArchiveStatus::Pending,
        })
        .collect();
    items[0].status = ArchiveStatus::Done;
    archive_store(
        &mut host,
        &ArchiveBatch {
            schema_version: ARCHIVE_SCHEMA,
            items,
        },
    )
    .unwrap();
    host.rename_of_hidden("a.md", "Archivio/a.md");
    host.rename_of_hidden("b.md", "Archivio/b.md"); // crash before its status write

    let report = recover_archive_batch(&mut host).unwrap();
    assert_eq!(
        report.done,
        ["a.md", "b.md", "c.md"].map(DocId::new).to_vec()
    );
    assert!(report.failures.is_empty());
    assert_eq!(
        host.read_document(&DocId::new("Archivio/c.md")).unwrap(),
        "c"
    );
    assert!(host.data_read(ARCHIVE_RECOVERY).unwrap().is_none());
    let again = recover_archive_batch(&mut host).unwrap();
    assert!(again.done.is_empty() && again.failures.is_empty());
}

#[test]
fn archive_recovery_conflicts_on_external_revision_without_overwriting_tail() {
    let mut host = MemoryHost::new()
        .with_document("a.md", "original")
        .with_document("b.md", "tail");
    let items = ["a.md", "b.md"]
        .into_iter()
        .map(|from| ArchiveItem {
            from: DocId::new(from),
            to: DocId::new(format!("Archivio/{from}")),
            preimage: host.document_revision(&DocId::new(from)).unwrap(),
            status: ArchiveStatus::Pending,
        })
        .collect();
    archive_store(
        &mut host,
        &ArchiveBatch {
            schema_version: ARCHIVE_SCHEMA,
            items,
        },
    )
    .unwrap();
    host.forgets_document("a.md");
    host = host.with_document("a.md", "external edit");

    let report = recover_archive_batch(&mut host).unwrap();
    assert_eq!(report.done, vec![DocId::new("b.md")]);
    assert_eq!(report.failures.len(), 1);
    assert!(matches!(report.failures[0].error, PluginError::Conflict(_)));
    assert_eq!(
        host.read_document(&DocId::new("a.md")).unwrap(),
        "external edit"
    );
    assert!(matches!(
        host.document_revision(&DocId::new("Archivio/a.md")),
        Err(PluginError::NotFound(_))
    ));
    assert_eq!(
        host.read_document(&DocId::new("Archivio/b.md")).unwrap(),
        "tail"
    );
    assert!(host.data_read(ARCHIVE_RECOVERY).unwrap().is_none());
}

#[test]
fn a_new_archive_request_surfaces_an_earlier_conflict_before_starting() {
    let mut host = MemoryHost::new()
        .with_document("a.md", "external edit")
        .with_document("c.md", "fresh request");
    archive_store(
        &mut host,
        &ArchiveBatch {
            schema_version: ARCHIVE_SCHEMA,
            items: vec![ArchiveItem {
                from: DocId::new("a.md"),
                to: DocId::new("Archivio/a.md"),
                preimage: Revision::of("original"),
                status: ArchiveStatus::Pending,
            }],
        },
    )
    .unwrap();

    let outcome = invoke(
        &mut host,
        VAULT_ARCHIVE,
        json!({ "docs": ["c.md"] }),
        InvokeMode::Apply,
    )
    .expect("the earlier conflict is an observable partial outcome");
    let partial = outcome.partial.expect("the previous batch conflicted");
    assert_eq!((partial.attempted, partial.done), (1, 0));
    assert_eq!(partial.failures.len(), 1);
    assert_eq!(partial.failures[0].subject, Some(DocId::new("a.md")));
    assert!(matches!(
        partial.failures[0].error,
        PluginError::Conflict(_)
    ));
    assert_eq!(
        host.read_document(&DocId::new("c.md")).unwrap(),
        "fresh request"
    );
    assert!(matches!(
        host.document_revision(&DocId::new("Archivio/c.md")),
        Err(PluginError::NotFound(_))
    ));
}
