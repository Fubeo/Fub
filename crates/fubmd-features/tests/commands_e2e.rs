//! I comandi ufficiali end-to-end **attraverso il kernel vero**.
//!
//! Gli unit test di `commands.rs` provano il comando contro il contratto (un
//! host in memoria). Qui si prova ciò che solo il kernel può dire: che
//! l'invocazione passa dalla convalida dell'host, che una simulazione non tocca
//! il disco, e che la scrittura di un comando è una **scrittura normale** — cioè
//! che grafo, indici ed eventi la vedono per la via di sempre. Un comando che
//! scrivesse per una via privilegiata non aggiornerebbe il grafo, e il backlink
//! che questo test controlla non esisterebbe.

use camino::Utf8PathBuf;
use fubmd_abi::command::{CommandEffect, InvokeMode};
use fubmd_abi::event::{Actor, Event, EventKind, Notice};
use fubmd_abi::model::{DocId, Span};
use fubmd_abi::session::{Selection, ViewContext};
use fubmd_abi::PluginError;
use fubmd_features::{
    CoreCommands, COMMANDS_ID, NOTE_CREATE, NOTE_RENAME, NOTE_TRASH, SELECTION_WIKILINK,
    SETTINGS_EXPORT, SETTINGS_IMPORT, SETTINGS_NS, SETTINGS_RESET, SETTINGS_SET, TRASH_EMPTY,
    TRASH_RESTORE, VAULT_ARCHIVE, VAULT_REPLACE,
};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace, MAIN_PANE};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry);
        // I plugin di prova si dichiarano prima di registrare (§7.3): il
        // kernel non presta capacità a una stringa.
        ws.register_core_feature(COMMANDS_ID, COMMANDS_ID)
            .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

#[test]
fn a_bulk_replace_is_shown_before_it_is_done_and_then_done() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "il gatto dorme, il gatto mangia")
        .expect("scrive");
    ws.write_document(&DocId::new("b.md"), "nessun felino qui")
        .expect("scrive");

    let args = serde_json::json!({ "find": "gatto", "replace": "cane" });

    let outcome = ws
        .invoke_command(VAULT_REPLACE, args.clone(), InvokeMode::DryRun, Actor::User)
        .expect("simula");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un dry-run risponde con un piano")
    };
    assert_eq!(plan.docs, vec![DocId::new("a.md")]);
    assert_eq!(plan.edit_count(), 2);
    assert_eq!(
        ws.read_source(&DocId::new("a.md")).expect("legge"),
        "il gatto dorme, il gatto mangia",
        "il piano si guarda, non si subisce"
    );

    let outcome = ws
        .invoke_command(VAULT_REPLACE, args, InvokeMode::Apply, Actor::User)
        .expect("applica");
    assert_eq!(
        ws.read_source(&DocId::new("a.md")).expect("legge"),
        "il cane dorme, il cane mangia"
    );
    let notify = outcome.notify.expect("un'operazione in blocco si racconta");
    assert!(notify.contains("2 sostituzioni"), "{notify}");
}

#[test]
fn a_command_writes_through_the_normal_path_so_the_graph_sees_it() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Kant.md"), "# Kant\n")
        .expect("scrive");
    let nota = DocId::new("Nota.md");
    ws.write_document(&nota, "parlo di Kant e di altro\n")
        .expect("scrive");
    assert!(
        ws.backlinks(&DocId::new("Kant.md")).is_empty(),
        "prima non c'è nessun riferimento"
    );

    // La shell pubblica il contesto: nota aperta, «Kant» selezionato, buffer
    // pulito (quindi lo span vale anche per il file).
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(nota.clone()))
            .with_selection(Some(Selection {
                span: Some(Span::new(9, 13)),
                text: "Kant".into(),
            })),
    ));

    let outcome = ws
        .invoke_command(
            SELECTION_WIKILINK,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("applica");
    assert_eq!(
        ws.read_source(&nota).expect("legge"),
        "parlo di [[Kant]] e di altro\n"
    );
    assert!(
        matches!(outcome.effect, CommandEffect::Reveal { .. }),
        "la shell riceve dove guardare"
    );

    let backlinks = ws.backlinks(&DocId::new("Kant.md"));
    assert_eq!(
        backlinks.len(),
        1,
        "il riferimento creato dal comando è nel grafo: la scrittura di un \
         comando è una scrittura come le altre"
    );
    assert_eq!(backlinks[0].source, nota);
}

#[test]
fn the_selection_span_is_dropped_by_the_kernel_and_the_command_says_so() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let nota = DocId::new("Nota.md");
    ws.write_document(&nota, "parlo di Kant\n").expect("scrive");
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(nota.clone()))
            .with_selection(Some(Selection {
                span: Some(Span::new(9, 13)),
                text: "Kant".into(),
            })),
    ));

    // Qualcun altro riscrive la nota: il kernel lascia cadere lo span, perché
    // quelle coordinate erano di un altro testo (decisione 0007).
    ws.write_document(&nota, "un testo completamente diverso\n")
        .expect("scrive");

    let err = ws
        .invoke_command(
            SELECTION_WIKILINK,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    assert!(
        matches!(err, PluginError::BadArgs(_)),
        "senza uno span vero il comando non indovina un punto in cui scrivere"
    );
    assert_eq!(
        ws.read_source(&nota).expect("legge"),
        "un testo completamente diverso\n"
    );
}

#[test]
fn the_search_command_is_an_intent_and_the_kernel_refuses_it_no_writes() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let outcome = ws
        .invoke_command(
            fubmd_features::SEARCH_OPEN,
            serde_json::json!({ "query": "gatto" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("cerca");
    assert_eq!(
        outcome.effect,
        CommandEffect::RunSearch {
            query: "gatto".into()
        },
        "un comando può chiedere alla shell di fare qualcosa senza toccare il vault"
    );
}

#[test]
fn the_registry_is_what_a_palette_or_a_cli_reads() {
    let vault = Vault::new();
    let ws = vault.open();
    let specs = ws.commands();
    assert_eq!(specs.len(), 14, "i quattordici comandi ufficiali");
    let replace = specs
        .iter()
        .find(|s| s.id == VAULT_REPLACE)
        .expect("dichiarato");
    assert!(replace.scope.writes);
    assert_eq!(
        replace
            .params
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>(),
        vec!["find", "replace", "whole_word", "docs"],
        "l'ordine dei parametri è quello in cui ha senso chiederli"
    );
}

// ---------------------------------------------------------------------------
// Il lotto (decisione 0011) e l'origine (decisione 0012) su un comando vero
// ---------------------------------------------------------------------------

#[test]
fn a_bulk_replace_over_n_notes_is_one_thing_with_the_origin_of_who_asked() {
    let vault = Vault::new();
    let mut ws = vault.open();
    for nome in ["a.md", "b.md", "c.md"] {
        ws.write_document(&DocId::new(nome), "il gatto dorme")
            .expect("scrive");
    }
    let rx = ws.bus().subscribe();

    // Chi invoca dichiara chi è: qui un'automazione, che è il caso in cui
    // attribuire all'utente sarebbe l'errore di 16.2.
    let automa = Actor::Plugin {
        id: "fubmd.automa".into(),
    };
    ws.invoke_command(
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
        InvokeMode::Apply,
        automa.clone(),
    )
    .expect("applica");

    let notices: Vec<Notice> = rx.try_iter().collect();
    assert_eq!(
        notices
            .iter()
            .filter(|n| n.kind() == EventKind::IndexUpdated)
            .count(),
        0,
        "tre note riscritte non sono tre aggiornamenti dell'indice: l'invocazione \
         di un comando è UNA cosa che qualcuno ha chiesto"
    );
    let terminali: Vec<&Notice> = notices
        .iter()
        .filter(|n| n.kind() == EventKind::BatchEnded)
        .collect();
    assert_eq!(terminali.len(), 1);
    let Event::BatchEnded { changed, .. } = &terminali[0].event else {
        unreachable!()
    };
    assert_eq!(
        changed,
        &vec![DocId::new("a.md"), DocId::new("b.md"), DocId::new("c.md")],
        "e il terminale nomina le tre note: chi ridisegna sa su cosa"
    );
    assert!(
        notices.iter().all(|n| n.origin.actor == automa),
        "ogni evento porta l'origine di chi ha INVOCATO, non del provider che ha \
         eseguito: è ciò che permette a quell'automazione di non reagire alle \
         proprie scritture invece di rincorrersi finché il budget del dispatch \
         non la tronca"
    );
}

#[test]
fn a_dry_run_opens_no_batch_because_it_touches_nothing() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "il gatto dorme")
        .expect("scrive");
    let rx = ws.bus().subscribe();

    ws.invoke_command(
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("simula");

    assert_eq!(
        rx.try_iter().count(),
        0,
        "una simulazione non emette niente, nemmeno un terminale di lotto: il \
         non-scrivere della decisione 0010 vale anche per gli eventi, o la shell \
         ridisegnerebbe per un'anteprima"
    );
}

// ---------------------------------------------------------------------------
// I comandi strutturali (decisione 0013): il giro che la shell faceva coi comandi Tauri
// ---------------------------------------------------------------------------

/// Il ciclo di vita completo di una nota, chiesto **solo** al registro: creare,
/// rinominare, cestinare, ripristinare, svuotare.
///
/// È il dogfooding che la decisione 0009 non aveva potuto fare: nessuna riga qui chiama
/// un metodo di `Workspace` per cambiare il vault. Se un giorno una di queste
/// azioni tornasse a passare per una via privilegiata, questo test resterebbe
/// verde — ed è per questo che il suo compagno è la sparizione dei comandi
/// Tauri, che si vede nel diff e non in un assert.
#[test]
fn the_whole_life_of_a_note_goes_through_the_registry() {
    let vault = Vault::new();
    let mut ws = vault.open();

    let outcome = ws
        .invoke_command(
            NOTE_CREATE,
            serde_json::json!({ "name": "Progetti/Idee" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("crea");
    let CommandEffect::Navigate { doc } = outcome.effect else {
        panic!("creare risponde con dove andare, che è anche l'id della nota nuova")
    };
    assert_eq!(
        doc.as_str(),
        "Progetti/Idee.md",
        "un nome senza estensione diventa una nota markdown"
    );
    assert_eq!(ws.documents(), vec![doc.clone()]);

    // Ricrearla sopra è rifiutato: è la differenza fra `create_document` e
    // `write_document`, vista dal comando.
    let e = ws
        .invoke_command(
            NOTE_CREATE,
            serde_json::json!({ "name": "Progetti/Idee.md" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect_err("il path è occupato");
    assert!(matches!(e, PluginError::Internal(_)), "{e}");

    ws.invoke_command(
        NOTE_RENAME,
        serde_json::json!({ "doc": "Progetti/Idee.md", "to": "Progetti/Idee vecchie.md" }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("rinomina");
    assert_eq!(ws.documents(), vec![DocId::new("Progetti/Idee vecchie.md")]);

    ws.invoke_command(
        NOTE_TRASH,
        serde_json::json!({ "doc": "Progetti/Idee vecchie.md" }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("cestina");
    assert!(ws.documents().is_empty());

    let voce = ws.list_trash().expect("cestino")[0].id.clone();
    let outcome = ws
        .invoke_command(
            TRASH_RESTORE,
            serde_json::json!({ "entry": voce.as_str() }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("ripristina");
    assert_eq!(
        outcome.effect,
        CommandEffect::Navigate {
            doc: DocId::new("Progetti/Idee vecchie.md")
        },
        "il ripristino dice con che path la nota è tornata: è ciò che la shell \
         usa al posto del valore di ritorno che un comando non ha"
    );

    // E infine il cestino, che è vuoto e lo dice.
    let outcome = ws
        .invoke_command(
            TRASH_EMPTY,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("svuota");
    assert!(outcome.notify.expect("dice quante").contains('0'));
}

#[test]
fn trashing_without_an_argument_takes_the_note_the_user_is_looking_at() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("aperta.md"), "x")
        .expect("scrive");
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE).with_doc(Some(DocId::new("aperta.md"))),
    ));

    ws.invoke_command(
        NOTE_TRASH,
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("cestina la nota attiva");
    assert!(ws.documents().is_empty());
}

// ---------------------------------------------------------------------------
// Il modello parsato dietro un comando (decisione 0018)
// ---------------------------------------------------------------------------

/// Spuntare un task è **un carattere**, e chi lo spunta non conosce la sintassi
/// dei task.
///
/// È il percorso one-shot del §4.2 su un vault vero: il comando chiede il
/// modello di *questa* nota, legge lo `span` del marcatore e scrive lì. Un test
/// con un host in memoria non proverebbe la parte che conta — che il modello
/// arriva **parsato da comrak**, con le posizioni del file vero, indentazione e
/// frontmatter compresi.
#[test]
fn checking_a_task_goes_through_the_parsed_model_and_writes_one_byte() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let sorgente = "---\ntitolo: Spesa\n---\n\n- [ ] pane\n- [ ] latte\n";
    ws.write_document(&DocId::new("spesa.md"), sorgente)
        .expect("scrive");

    // La posizione è dentro il testo della **seconda** voce: nessuno qui conta
    // le parentesi quadre, e il frontmatter davanti sposta ogni offset.
    let at = sorgente.find("latte").expect("c'è") as u64;
    let outcome = ws
        .invoke_command(
            fubmd_features::NOTE_TASK_TOGGLE,
            serde_json::json!({ "doc": "spesa.md", "at": at }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("spunta");

    assert_eq!(
        ws.read_source(&DocId::new("spesa.md")).expect("rilegge"),
        "---\ntitolo: Spesa\n---\n\n- [ ] pane\n- [x] latte\n",
        "una sola `x`, e nella voce giusta"
    );
    let CommandEffect::Reveal { span, .. } = outcome.effect else {
        panic!("la shell deve sapere dove guardare")
    };
    assert_eq!(
        span.end - span.start,
        1,
        "la patch più piccola che si scriva"
    );

    // E il giro contrario: il modello di adesso è quello del file di adesso,
    // non quello di quando è stato indicizzato.
    ws.invoke_command(
        fubmd_features::NOTE_TASK_TOGGLE,
        serde_json::json!({ "doc": "spesa.md", "at": at }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("de-spunta");
    assert_eq!(
        ws.read_source(&DocId::new("spesa.md")).expect("rilegge"),
        sorgente
    );
}

/// Una posizione che non sta in nessun task si dice, e non tocca il vault.
#[test]
fn a_position_outside_every_task_is_refused_by_the_command_not_guessed() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("spesa.md"), "# Titolo\n\n- [ ] pane\n")
        .expect("scrive");

    let err = ws
        .invoke_command(
            fubmd_features::NOTE_TASK_TOGGLE,
            serde_json::json!({ "doc": "spesa.md", "at": 2 }),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");
    assert_eq!(
        ws.read_source(&DocId::new("spesa.md")).expect("rilegge"),
        "# Titolo\n\n- [ ] pane\n"
    );
}

/// Il piano di una rinomina nomina **anche** le note che la linkano.
///
/// Senza, l'utente approverebbe «rinomina una nota» e ne verrebbero toccate
/// quaranta: il raggio dichiarato (`documents`) dice che succede, e il piano
/// dice a *chi*.
#[test]
fn the_plan_of_a_rename_names_the_notes_that_link_it() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("bersaglio.md"), "sono io")
        .expect("scrive");
    ws.write_document(&DocId::new("chi-linka.md"), "vedi [[bersaglio]]")
        .expect("scrive");

    let outcome = ws
        .invoke_command(
            NOTE_RENAME,
            serde_json::json!({ "doc": "bersaglio.md", "to": "nuovo.md" }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("simula");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un dry-run risponde con un piano")
    };
    assert!(
        plan.docs.contains(&DocId::new("chi-linka.md")),
        "la nota che linka è impattata e il piano la nomina: {:?}",
        plan.docs
    );
    assert_eq!(
        ws.read_source(&DocId::new("bersaglio.md")).expect("legge"),
        "sono io",
        "e simulare non ha rinominato niente"
    );
}

// ---------------------------------------------------------------------------
// vault.archive: comporre comandi (decisione 0013, `run_command`)
// ---------------------------------------------------------------------------

#[test]
fn archiving_n_notes_is_n_renames_one_batch_and_one_actor() {
    let vault = Vault::new();
    let mut ws = vault.open();
    for nome in ["a.md", "b.md", "c.md"] {
        ws.write_document(&DocId::new(nome), "x").expect("scrive");
    }
    ws.write_document(&DocId::new("indice.md"), "vedi [[a]] e [[b]]")
        .expect("scrive");
    let rx = ws.bus().subscribe();

    ws.invoke_command(
        VAULT_ARCHIVE,
        serde_json::json!({ "docs": ["a.md", "b.md", "c.md"] }),
        InvokeMode::Apply,
        Actor::Plugin {
            id: "automazione".into(),
        },
    )
    .expect("archivia");

    let mut docs = ws.documents();
    docs.sort();
    assert_eq!(
        docs,
        vec![
            DocId::new("Archivio/a.md"),
            DocId::new("Archivio/b.md"),
            DocId::new("Archivio/c.md"),
            DocId::new("indice.md"),
        ]
    );
    assert_eq!(
        ws.read_source(&DocId::new("indice.md")).expect("legge"),
        "vedi [[a]] e [[b]]",
        "i wikilink per nome pagina restano validi: li ha gestiti `note.rename`, \
         che questa macro non ha riscritto"
    );

    let notices: Vec<Notice> = rx.try_iter().collect();
    let batches: Vec<&Notice> = notices
        .iter()
        .filter(|n| n.kind() == EventKind::BatchEnded)
        .collect();
    assert_eq!(
        batches.len(),
        1,
        "tre comandi invocati dentro un comando sono UN lotto: l'utente ha \
         chiesto una cosa, e la shell ridisegna una volta"
    );
    assert_eq!(
        batches[0].origin.actor,
        Actor::Plugin {
            id: "automazione".into()
        },
        "invocare non riazzera l'attore"
    );
}

/// Simulare una macro simula i suoi passi, e il piano che ne esce è l'unione
/// dei loro. È la prova che il **modo viaggia con l'host**: `vault.archive` non
/// dice mai a `note.rename` che si sta simulando.
#[test]
fn the_plan_of_a_macro_is_the_union_of_the_plans_of_its_steps() {
    let vault = Vault::new();
    let mut ws = vault.open();
    for nome in ["a.md", "b.md"] {
        ws.write_document(&DocId::new(nome), "x").expect("scrive");
    }
    ws.write_document(&DocId::new("indice.md"), "vedi [[a]]")
        .expect("scrive");

    let outcome = ws
        .invoke_command(
            VAULT_ARCHIVE,
            serde_json::json!({ "docs": ["a.md", "b.md"], "folder": "Vecchie" }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("simula");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un dry-run risponde con un piano")
    };

    for atteso in ["a.md", "b.md", "Vecchie/a.md", "Vecchie/b.md", "indice.md"] {
        assert!(
            plan.docs.contains(&DocId::new(atteso)),
            "il piano della macro contiene ciò che ogni passo avrebbe toccato — \
             manca {atteso}: {:?}",
            plan.docs
        );
    }
    assert!(
        plan.summary.contains("Vecchie"),
        "il riassunto è della macro, non dell'ultimo passo: {}",
        plan.summary
    );

    let mut docs = ws.documents();
    docs.sort();
    assert_eq!(
        docs,
        vec![
            DocId::new("a.md"),
            DocId::new("b.md"),
            DocId::new("indice.md")
        ],
        "e simulare non ha spostato niente, nemmeno attraverso i comandi invocati"
    );
}

// --- i comandi delle impostazioni (§11.1) -----------------------------------
//
// Sono i primi clienti di `CommandReach::Settings`, che dalla decisione 0010 era
// vocabolario senza nessuno che lo usasse. Qui si prova ciò che solo il kernel
// vero può dire: che la scrittura passa dai **due cancelli** (il permesso e la
// chiave), che una simulazione non sposta niente, e che l'export tira fuori ciò
// che qualcuno ha deciso e non i default.

/// Un vault coi comandi montati e due chiavi dichiarate: una che un programma
/// può scrivere, e una no.
fn vault_con_impostazioni() -> (Vault, Workspace) {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.register_plugin(
        fubmd_abi::traits::PluginManifest::core("fubmd.versioning", "Versioning").configuring(
            vec![
                fubmd_abi::settings::SettingSpec::toggle("versioning.enabled", "Versioning", true)
                    .grouped("Vault")
                    .program_writable(),
                fubmd_abi::settings::SettingSpec::toggle("privacy.telemetry", "Telemetria", false),
            ],
        ),
        fubmd_kernel::Trust::Core,
    )
    .expect("dichiarato");
    (vault, ws)
}

fn valore(ws: &Workspace, key: &str) -> fubmd_abi::settings::SettingValue {
    ws.setting(key).expect("dichiarata")
}

#[test]
fn a_command_writes_a_setting_reading_its_type_from_the_declared_schema() {
    let (_vault, mut ws) = vault_con_impostazioni();

    // `value` è **testo**, e a dargli un tipo è lo schema: è la forma che un
    // chiamante non interattivo (una CLI, un'automazione, un modello) sa
    // compilare senza conoscere la specie della chiave.
    let outcome = ws
        .invoke_command(
            SETTINGS_SET,
            serde_json::json!({ "key": "versioning.enabled", "value": "false" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("scrive");
    assert!(
        outcome.notify.is_some(),
        "un comando che cambia qualcosa lo dice"
    );
    assert_eq!(
        valore(&ws, "versioning.enabled"),
        fubmd_abi::settings::SettingValue::Toggle(false)
    );

    // Azzerare non è scrivere il default: è **smettere di decidere**, e da qui
    // in poi la chiave segue di nuovo lo schema.
    ws.invoke_command(
        SETTINGS_RESET,
        serde_json::json!({ "key": "versioning.enabled" }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("azzera");
    assert_eq!(
        valore(&ws, "versioning.enabled"),
        fubmd_abi::settings::SettingValue::Toggle(true)
    );
}

#[test]
fn a_program_cannot_move_a_key_that_did_not_declare_itself_program_writable() {
    let (_vault, mut ws) = vault_con_impostazioni();
    let errore = ws
        .invoke_command(
            SETTINGS_SET,
            serde_json::json!({ "key": "privacy.telemetry", "value": "true" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect_err("la chiave non si è dichiarata scrivibile da un programma");
    assert!(
        matches!(errore, PluginError::PermissionDenied(_)),
        "è un rifiuto di permesso, non un argomento sbagliato: {errore:?}"
    );
    assert_eq!(
        valore(&ws, "privacy.telemetry"),
        fubmd_abi::settings::SettingValue::Toggle(false),
        "e il valore è rimasto quello che era"
    );
}

#[test]
fn simulating_a_setting_change_says_what_would_change_and_changes_nothing() {
    let (_vault, mut ws) = vault_con_impostazioni();
    let outcome = ws
        .invoke_command(
            SETTINGS_SET,
            serde_json::json!({ "key": "versioning.enabled", "value": "false" }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("simula");
    assert!(matches!(outcome.effect, CommandEffect::Plan(_)));
    assert_eq!(
        valore(&ws, "versioning.enabled"),
        fubmd_abi::settings::SettingValue::Toggle(true),
        "una simulazione che spegnesse il versioning lo lascerebbe spento: è \
         l'effetto meno ritirabile di tutti, perché sopravvive alla sessione"
    );
}

#[test]
fn export_carries_what_someone_decided_and_import_puts_it_back() {
    let (_vault, mut ws) = vault_con_impostazioni();

    // Niente deciso: l'export è vuoto. I default non sono una configurazione —
    // portarli dentro vorrebbe dire che reimportare **decide** tutto ciò che
    // nessuno aveva deciso, congelando i default di oggi.
    let outcome = ws
        .invoke_command(
            SETTINGS_EXPORT,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("esporta");
    let CommandEffect::Custom { ns, payload } = outcome.effect else {
        panic!("l'export esce come intento custom: dove salvarlo lo sa la shell")
    };
    assert_eq!(ns, SETTINGS_NS);
    assert_eq!(payload, serde_json::json!({}));

    ws.set_setting(
        "versioning.enabled",
        fubmd_abi::settings::SettingValue::Toggle(false),
    )
    .expect("scritto");
    let outcome = ws
        .invoke_command(
            SETTINGS_EXPORT,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("esporta");
    let CommandEffect::Custom { payload, .. } = outcome.effect else {
        panic!("intento custom")
    };
    assert_eq!(payload, serde_json::json!({ "versioning.enabled": false }));

    // E rimetterlo dentro dopo aver azzerato lo riporta com'era: il giro
    // completo, che è ciò per cui import ed export esistono.
    ws.reset_setting("versioning.enabled").expect("azzerato");
    let json = serde_json::to_string(&payload).unwrap();
    ws.invoke_command(
        SETTINGS_IMPORT,
        serde_json::json!({ "json": json }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("importa");
    assert_eq!(
        valore(&ws, "versioning.enabled"),
        fubmd_abi::settings::SettingValue::Toggle(false)
    );
}

#[test]
fn an_import_says_what_it_could_not_apply_instead_of_stopping_or_lying() {
    let (_vault, mut ws) = vault_con_impostazioni();
    let outcome = ws
        .invoke_command(
            SETTINGS_IMPORT,
            serde_json::json!({
                "json": r#"{
                    "versioning.enabled": false,
                    "privacy.telemetry": true,
                    "com.acme.mai-vista": 3
                }"#
            }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("importa ciò che può");

    let messaggio = outcome.notify.expect("dice com'è andata");
    assert!(
        messaggio.contains("1 impostazione applicata"),
        "{messaggio}"
    );
    assert!(messaggio.contains("privacy.telemetry"), "{messaggio}");
    assert!(messaggio.contains("com.acme.mai-vista"), "{messaggio}");
    assert_eq!(
        valore(&ws, "versioning.enabled"),
        fubmd_abi::settings::SettingValue::Toggle(false),
        "ciò che si poteva applicare è applicato"
    );
    assert_eq!(
        valore(&ws, "privacy.telemetry"),
        fubmd_abi::settings::SettingValue::Toggle(false),
        "e un file di impostazioni che passa di mano non sposta le chiavi che \
         un programma non può scrivere"
    );
}

/// Il cancello della chiave vale **anche in simulazione**, e questa prova è il
/// perché: un piano che dicesse «due applicate» prima di un'applicazione che ne
/// applica una non è un piano, è un preventivo. La decisione 0010 chiede che
/// simulare dica ciò che succederebbe, e ciò che succederebbe qui è un rifiuto.
#[test]
fn simulating_an_import_counts_the_key_gate_too() {
    let (_vault, mut ws) = vault_con_impostazioni();
    let json = r#"{ "versioning.enabled": false, "privacy.telemetry": true }"#;

    let simulato = ws
        .invoke_command(
            SETTINGS_IMPORT,
            serde_json::json!({ "json": json }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("simula")
        .notify
        .expect("dice cosa farebbe");
    assert!(
        simulato.contains("1 impostazione applicata") && simulato.contains("privacy.telemetry"),
        "la simulazione nomina già ciò che non entrerebbe: {simulato}"
    );

    let applicato = ws
        .invoke_command(
            SETTINGS_IMPORT,
            serde_json::json!({ "json": json }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("importa")
        .notify
        .expect("dice com'è andata");
    assert!(
        applicato.contains("1 impostazione applicata") && applicato.contains("privacy.telemetry"),
        "e l'applicazione dice la stessa cosa: {applicato}"
    );
}

/// Lo stesso, sul comando singolo: simulare una chiave che un programma non può
/// scrivere è un rifiuto, non un piano.
#[test]
fn simulating_a_write_on_a_locked_key_is_a_refusal_and_not_a_plan() {
    let (_vault, mut ws) = vault_con_impostazioni();
    let errore = ws
        .invoke_command(
            SETTINGS_SET,
            serde_json::json!({ "key": "privacy.telemetry", "value": "true" }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect_err("simulare un rifiuto è un rifiuto");
    assert!(
        matches!(errore, PluginError::PermissionDenied(_)),
        "{errore:?}"
    );
}
