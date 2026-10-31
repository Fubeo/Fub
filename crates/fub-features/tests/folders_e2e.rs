// Il banco di questa feature vive con lei: senza la cargo feature `commands`
// il modulo non è compilato, e un test che lo nomina non avrebbe un soggetto.
#![cfg(feature = "commands")]
//! **Una cartella intera**, spostata e cestinata attraverso il kernel vero.
//!
//! Ciò che conta qui è che una cartella non è un file: è le sue voci, ognuna
//! con i suoi link e la sua storia, più le cartelle che nessuna voce porta con
//! sé. Il banco prova che arrivano tutte, che chi le linka le segue, che ciò
//! che il vault non mostra non si cancella, e che l'annullamento rimette le
//! cose come stavano.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::traits::{FolderScope, IndexQuery, IndexResult};
use fub_abi::PluginError;
use fub_features::{
    CoreCommands, COMMANDS_ID, FOLDER_RENAME, FOLDER_TRASH, NOTES_FOLDER_PAGE, NOTES_SUBPAGE,
    VAULT_UNDO,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn with(files: &[(&str, &str)]) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        for (rel, body) in files {
            let path = root.join(rel);
            if rel.ends_with('/') {
                std::fs::create_dir_all(path).unwrap();
            } else {
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, body).unwrap();
            }
        }
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }

    fn on_disk(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }
}

fn run(
    ws: &mut Workspace,
    command: &str,
    args: serde_json::Value,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    ws.invoke_command(command, args, InvokeMode::Apply, Actor::User)
}

fn said(outcome: &fub_abi::command::CommandOutcome) -> String {
    outcome
        .notify
        .as_ref()
        .and_then(|t| t.as_literal().map(str::to_owned))
        .expect("l'esito dice qualcosa")
}

fn text(ws: &Workspace, id: &str) -> String {
    ws.read_source(&DocId::new(id)).expect("legge")
}

/// Le cartelle che l'albero mostra, tutte.
fn folders(ws: &Workspace) -> Vec<String> {
    let IndexResult::Folders(page) = ws
        .query_index(IndexQuery::Folders {
            under: None,
            page: None,
        })
        .unwrap()
    else {
        panic!("cartelle")
    };
    page.items.into_iter().map(|f| f.path).collect()
}

/// Chi linka questa voce, in ordine.
fn readers(ws: &Workspace, id: &str) -> Vec<String> {
    let IndexResult::Backlinks(page) = ws
        .query_index(IndexQuery::Backlinks {
            target: DocId::new(id),
            page: None,
        })
        .unwrap()
    else {
        panic!("backlink")
    };
    let mut out: Vec<String> = page
        .items
        .into_iter()
        .map(|b| b.source.to_string())
        .collect();
    out.sort();
    out.dedup();
    out
}

fn entries_in(ws: &Workspace, folder: &str) -> Vec<String> {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: Some(FolderScope {
                path: folder.into(),
                descendants: true,
            }),
            page: None,
        })
        .unwrap()
    else {
        panic!("voci")
    };
    page.items.into_iter().map(|e| e.id.to_string()).collect()
}

fn progetti() -> Vault {
    Vault::with(&[
        ("Progetti/Piano.md", "Vedi [[Dettagli]]."),
        ("Progetti/Sotto/Dettagli.md", "Torna a [[Piano]]."),
        ("Progetti/schema.png", "png"),
        ("Progetti/Vuota/", ""),
        ("Indice.md", "[[Progetti/Piano]] e [[Dettagli|i dettagli]]"),
    ])
}

#[test]
fn a_renamed_folder_takes_every_entry_and_the_links_follow() {
    let vault = progetti();
    let mut ws = vault.open();
    let outcome = run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "Progetti", "to": "Lavori" }),
    )
    .unwrap();
    assert!(said(&outcome).contains("Lavori"), "{}", said(&outcome));
    assert_eq!(
        entries_in(&ws, "Lavori"),
        [
            "Lavori/Piano.md",
            "Lavori/Sotto/Dettagli.md",
            "Lavori/schema.png"
        ]
    );
    assert!(entries_in(&ws, "Progetti").is_empty());
    // La cartella vuota viaggia anche lei: nessuna voce l'avrebbe portata.
    assert!(vault.on_disk("Lavori/Vuota"));
    assert!(!vault.on_disk("Progetti"), "il guscio d'origine se ne va");
    let shown = folders(&ws);
    assert!(shown.contains(&"Lavori/Vuota".to_string()), "{shown:?}");
    assert!(
        !shown.iter().any(|f| f.starts_with("Progetti")),
        "{shown:?}"
    );
    assert_eq!(
        readers(&ws, "Lavori/Piano.md"),
        ["Indice.md", "Lavori/Sotto/Dettagli.md"]
    );
    assert_eq!(
        readers(&ws, "Lavori/Sotto/Dettagli.md"),
        ["Indice.md", "Lavori/Piano.md"]
    );
    assert!(!text(&ws, "Indice.md").contains("Progetti"));
    assert!(matches!(
        outcome.effect,
        CommandEffect::Custom { ref ns, .. } if ns == "fub.folder.moved"
    ));
}

#[test]
fn moving_into_another_folder_is_the_same_gesture() {
    let vault = progetti();
    let mut ws = vault.open();
    run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "Progetti", "to": "Archivio/Progetti" }),
    )
    .unwrap();
    assert!(vault.on_disk("Archivio/Progetti/Sotto/Dettagli.md"));
    assert_eq!(
        readers(&ws, "Archivio/Progetti/Piano.md"),
        ["Archivio/Progetti/Sotto/Dettagli.md", "Indice.md"]
    );
}

#[test]
fn undoing_a_move_puts_the_tree_and_the_links_back() {
    let vault = progetti();
    let mut ws = vault.open();
    run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "Progetti", "to": "Lavori" }),
    )
    .unwrap();
    run(&mut ws, VAULT_UNDO, serde_json::Value::Null).unwrap();
    assert_eq!(
        entries_in(&ws, "Progetti"),
        [
            "Progetti/Piano.md",
            "Progetti/Sotto/Dettagli.md",
            "Progetti/schema.png"
        ]
    );
    assert!(vault.on_disk("Progetti/Vuota"));
    assert!(!vault.on_disk("Lavori"));
    assert_eq!(
        readers(&ws, "Progetti/Piano.md"),
        ["Indice.md", "Progetti/Sotto/Dettagli.md"]
    );
    assert!(!text(&ws, "Indice.md").contains("Lavori"));
}

#[test]
fn a_destination_with_entries_is_refused_and_nothing_moves() {
    let vault = Vault::with(&[("A/uno.md", "uno"), ("B/due.md", "due")]);
    let mut ws = vault.open();
    let refused = run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "A", "to": "B" }),
    );
    assert!(
        matches!(refused, Err(PluginError::AlreadyExists(_))),
        "{refused:?}"
    );
    assert!(vault.on_disk("A/uno.md"));
    assert!(vault.on_disk("B/due.md"));
}

#[test]
fn a_folder_does_not_move_inside_itself() {
    let vault = progetti();
    let mut ws = vault.open();
    let refused = run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "Progetti", "to": "Progetti/Sotto/Progetti" }),
    );
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );
    assert!(vault.on_disk("Progetti/Piano.md"));
}

#[test]
fn a_missing_folder_is_named() {
    let vault = progetti();
    let mut ws = vault.open();
    let missing = run(
        &mut ws,
        FOLDER_TRASH,
        serde_json::json!({ "folder": "Assente" }),
    );
    assert!(
        matches!(missing, Err(PluginError::NotFound(_))),
        "{missing:?}"
    );
}

#[test]
fn a_hidden_file_keeps_its_folder_and_the_outcome_says_so() {
    let vault = Vault::with(&[("A/nota.md", "testo"), ("A/.nascosto", "mio")]);
    let mut ws = vault.open();
    let outcome = run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "A", "to": "B" }),
    )
    .unwrap();
    assert!(vault.on_disk("B/nota.md"));
    // Il file che il vault non mostra resta dov'era, intero.
    assert_eq!(
        std::fs::read_to_string(vault.root.join("A/.nascosto")).unwrap(),
        "mio"
    );
    assert!(said(&outcome).contains("«A»"), "{}", said(&outcome));
    // E l'annullamento passa lo stesso: la cartella rimasta non ha voci.
    run(&mut ws, VAULT_UNDO, serde_json::Value::Null).unwrap();
    assert!(vault.on_disk("A/nota.md"));
    assert!(!vault.on_disk("B"));
}

#[test]
fn a_case_only_rename_goes_through() {
    let vault = Vault::with(&[
        ("progetti/nota.md", "testo"),
        ("Altro.md", "[[progetti/nota]]"),
    ]);
    let mut ws = vault.open();
    run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "progetti", "to": "Progetti" }),
    )
    .unwrap();
    assert_eq!(entries_in(&ws, "Progetti"), ["Progetti/nota.md"]);
    assert!(!folders(&ws).iter().any(|f| f.contains(".~")));
    assert_eq!(readers(&ws, "Progetti/nota.md"), ["Altro.md"]);
}

#[test]
fn a_dry_run_names_the_readers_and_touches_nothing() {
    let vault = progetti();
    let mut ws = vault.open();
    let outcome = ws
        .invoke_command(
            FOLDER_RENAME,
            serde_json::json!({ "folder": "Progetti", "to": "Lavori" }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .unwrap();
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un piano")
    };
    assert!(
        plan.docs.contains(&DocId::new("Indice.md")),
        "{:?}",
        plan.docs
    );
    assert!(vault.on_disk("Progetti/Piano.md"));
    assert!(!vault.on_disk("Lavori"));
}

#[test]
fn a_trashed_folder_leaves_and_comes_back_with_undo() {
    let vault = progetti();
    let mut ws = vault.open();
    let outcome = run(
        &mut ws,
        FOLDER_TRASH,
        serde_json::json!({ "folder": "Progetti" }),
    )
    .unwrap();
    assert!(said(&outcome).contains("Progetti"), "{}", said(&outcome));
    assert!(!vault.on_disk("Progetti"));
    assert!(entries_in(&ws, "Progetti").is_empty());
    assert_eq!(ws.list_trash().unwrap().len(), 3);

    run(&mut ws, VAULT_UNDO, serde_json::Value::Null).unwrap();
    assert_eq!(
        entries_in(&ws, "Progetti"),
        [
            "Progetti/Piano.md",
            "Progetti/Sotto/Dettagli.md",
            "Progetti/schema.png"
        ]
    );
    assert!(ws.list_trash().unwrap().is_empty());
    assert_eq!(
        text(&ws, "Progetti/Sotto/Dettagli.md"),
        "Torna a [[Piano]]."
    );
}

#[test]
fn an_empty_folder_goes_to_nothing_and_leaves_the_tree() {
    let vault = Vault::with(&[("Vuota/Dentro/", ""), ("nota.md", "x")]);
    let mut ws = vault.open();
    run(
        &mut ws,
        FOLDER_TRASH,
        serde_json::json!({ "folder": "Vuota" }),
    )
    .unwrap();
    assert!(!vault.on_disk("Vuota"));
    assert!(folders(&ws).is_empty(), "{:?}", folders(&ws));
}

#[test]
fn an_attachment_renamed_with_its_extension_keeps_one() {
    let vault = Vault::with(&[("foto.png", "png")]);
    let mut ws = vault.open();
    run(
        &mut ws,
        fub_features::NOTES_RENAME,
        serde_json::json!({ "doc": "foto.png", "to": "mare.png" }),
    )
    .unwrap();
    assert!(vault.on_disk("mare.png"));
    assert!(!vault.on_disk("mare.png.png"));
}

#[test]
fn the_icon_and_the_chosen_order_follow_the_folder() {
    let vault = progetti();
    let mut ws = vault.open();
    ws.set_icon("Progetti", Some("📁".into())).unwrap();
    ws.organization_store()
        .set_order("Progetti", vec!["schema.png".into(), "Piano.md".into()])
        .unwrap();
    run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "Progetti", "to": "Lavori" }),
    )
    .unwrap();
    let org = ws.organization_store().snapshot();
    assert_eq!(org.icons.get("Lavori").map(String::as_str), Some("📁"));
    assert_eq!(
        org.order.get("Lavori").unwrap(),
        &["schema.png", "Piano.md"]
    );
    run(&mut ws, VAULT_UNDO, serde_json::Value::Null).unwrap();
    let org = ws.organization_store().snapshot();
    assert_eq!(org.icons.get("Progetti").map(String::as_str), Some("📁"));
    assert_eq!(
        org.order.get("Progetti").unwrap(),
        &["schema.png", "Piano.md"]
    );
}

/// La pagina della cartella è `X/_index.<ext>`, e il suo nome è quello della
/// cartella (decisione 0229): `[[Viaggio]]` la trova, e quando la cartella
/// cambia nome i link la seguono con il nome nuovo, lasciando intatti titolo
/// e alias.
#[test]
fn the_folder_page_answers_to_the_folders_name_and_follows_it() {
    let vault = Vault::with(&[
        ("Viaggio/_index.md", "# Tappe\n"),
        ("Viaggio/Lisbona.md", "Parte di [[Viaggio]]."),
        ("Diario.md", "[[Viaggio]] e [[Viaggio#Tappe|le tappe]]."),
    ]);
    let mut ws = vault.open();
    assert_eq!(
        readers(&ws, "Viaggio/_index.md"),
        ["Diario.md", "Viaggio/Lisbona.md"]
    );
    run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "Viaggio", "to": "Vacanze" }),
    )
    .unwrap();
    assert_eq!(
        text(&ws, "Diario.md"),
        "[[Vacanze]] e [[Vacanze#Tappe|le tappe]]."
    );
    assert_eq!(text(&ws, "Vacanze/Lisbona.md"), "Parte di [[Vacanze]].");
    assert_eq!(
        readers(&ws, "Vacanze/_index.md"),
        ["Diario.md", "Vacanze/Lisbona.md"]
    );
}

/// Accanto a una nota omonima il nome è conteso come fra due note qualsiasi:
/// la regola degli omonimi resta quella di sempre, e la rinomina della
/// cartella scrive un riferimento che non si confonde.
#[test]
fn a_folder_page_and_a_homonym_note_contend_the_name_like_two_notes() {
    let vault = Vault::with(&[
        ("Viaggio/_index.md", "# Pagina\n"),
        ("Altro/Viaggio.md", "# Nota\n"),
        ("Diario.md", "[[Viaggio/_index]] e [[Altro/Viaggio]]."),
    ]);
    let mut ws = vault.open();
    assert_eq!(readers(&ws, "Viaggio/_index.md"), ["Diario.md"]);
    assert_eq!(readers(&ws, "Altro/Viaggio.md"), ["Diario.md"]);
    run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "Viaggio", "to": "Vacanze" }),
    )
    .unwrap();
    // Nessuno contende più «Vacanze»: il riferimento diventa il nome.
    assert_eq!(text(&ws, "Diario.md"), "[[Vacanze]] e [[Altro/Viaggio]].");
    assert_eq!(readers(&ws, "Vacanze/_index.md"), ["Diario.md"]);
    assert_eq!(readers(&ws, "Altro/Viaggio.md"), ["Diario.md"]);
}

/// Alla radice `_index.md` non è la pagina di nessuna cartella: è una nota
/// che si chiama `_index`, e nessun file si rinomina da solo.
#[test]
fn an_index_at_the_root_is_an_ordinary_note() {
    let vault = Vault::with(&[
        ("_index.md", "# Radice\n"),
        ("Viaggio/Viaggio.md", "# Vecchio nome\n"),
        ("Diario.md", "[[_index]] e [[Viaggio]]."),
    ]);
    let ws = vault.open();
    assert_eq!(DocId::new("_index.md").page_name(), "_index");
    assert_eq!(readers(&ws, "_index.md"), ["Diario.md"]);
    // `Viaggio/Viaggio.md` è una nota normale: si chiama ancora «Viaggio».
    assert_eq!(readers(&ws, "Viaggio/Viaggio.md"), ["Diario.md"]);
    assert!(vault.on_disk("Viaggio/Viaggio.md"));
    assert!(!vault.on_disk("Viaggio/_index.md"));
}

/// «Usa come pagina della cartella» rinomina la nota in `_index`, con la
/// rinomina del kernel: i link la seguono col nome della cartella, e
/// l'annullamento la riporta com'era.
#[test]
fn use_as_folder_page_renames_to_index_and_undoes() {
    let vault = Vault::with(&[
        ("Viaggio/Viaggio.md", "# Tappe\n"),
        ("Diario.md", "Vedi [[Viaggio/Viaggio|il viaggio]]."),
    ]);
    let mut ws = vault.open();
    run(
        &mut ws,
        NOTES_FOLDER_PAGE,
        serde_json::json!({ "doc": "Viaggio/Viaggio.md" }),
    )
    .unwrap();
    assert!(vault.on_disk("Viaggio/_index.md"));
    assert!(!vault.on_disk("Viaggio/Viaggio.md"));
    assert_eq!(text(&ws, "Diario.md"), "Vedi [[Viaggio|il viaggio]].");
    assert_eq!(readers(&ws, "Viaggio/_index.md"), ["Diario.md"]);

    run(&mut ws, VAULT_UNDO, serde_json::json!({})).unwrap();
    assert!(vault.on_disk("Viaggio/Viaggio.md"));
    assert!(!vault.on_disk("Viaggio/_index.md"));
    assert_eq!(readers(&ws, "Viaggio/Viaggio.md"), ["Diario.md"]);
}

/// Una pagina che c'è già, con qualunque estensione, non si sostituisce; la
/// radice non ha una pagina; una pagina non diventa pagina due volte. In tutti
/// i casi il disco resta com'era.
#[test]
fn use_as_folder_page_never_overwrites_and_names_why() {
    let vault = Vault::with(&[
        ("Viaggio/_index.md", "# Pagina\n"),
        ("Viaggio/Tappe.md", "# Tappe\n"),
        ("Diario.md", "# Diario\n"),
    ]);
    let mut ws = vault.open();
    let taken = run(
        &mut ws,
        NOTES_FOLDER_PAGE,
        serde_json::json!({ "doc": "Viaggio/Tappe.md" }),
    );
    assert!(
        matches!(taken, Err(PluginError::AlreadyExists(_))),
        "{taken:?}"
    );
    let root = run(
        &mut ws,
        NOTES_FOLDER_PAGE,
        serde_json::json!({ "doc": "Diario.md" }),
    );
    assert!(matches!(root, Err(PluginError::BadArgs(_))), "{root:?}");
    let again = run(
        &mut ws,
        NOTES_FOLDER_PAGE,
        serde_json::json!({ "doc": "Viaggio/_index.md" }),
    );
    assert!(matches!(again, Err(PluginError::BadArgs(_))), "{again:?}");
    assert_eq!(text(&ws, "Viaggio/_index.md"), "# Pagina\n");
    assert!(vault.on_disk("Viaggio/Tappe.md"));
    assert!(vault.on_disk("Diario.md"));
}

/// «Nuova sottopagina» su una nota qualunque: la nota diventa la pagina della
/// sua cartella con la rinomina del kernel, e `[[Viaggio]]` la trova ancora
/// col nome della cartella; nella cartella nasce la sottopagina. Si annulla
/// all'incontrario, e tutto torna com'era.
#[test]
fn a_subpage_turns_the_note_into_its_folder_page_and_undoes() {
    let vault = Vault::with(&[
        ("Viaggio.md", "# Viaggio\n"),
        ("Diario.md", "Vedi [[Viaggio]]."),
    ]);
    let mut ws = vault.open();
    run(
        &mut ws,
        NOTES_SUBPAGE,
        serde_json::json!({ "doc": "Viaggio.md", "name": "Tappe" }),
    )
    .unwrap();
    assert!(vault.on_disk("Viaggio/_index.md"));
    assert!(vault.on_disk("Viaggio/Tappe.md"));
    assert!(!vault.on_disk("Viaggio.md"));
    assert_eq!(text(&ws, "Viaggio/_index.md"), "# Viaggio\n");
    assert_eq!(text(&ws, "Diario.md"), "Vedi [[Viaggio]].");
    assert_eq!(readers(&ws, "Viaggio/_index.md"), ["Diario.md"]);

    run(&mut ws, VAULT_UNDO, serde_json::json!({})).unwrap();
    assert!(vault.on_disk("Viaggio.md"));
    assert!(!vault.on_disk("Viaggio/_index.md"));
    assert!(!vault.on_disk("Viaggio/Tappe.md"));
    assert_eq!(readers(&ws, "Viaggio.md"), ["Diario.md"]);
}

/// Su una pagina di cartella la sottopagina nasce accanto e basta; in una
/// cartella che c'è già senza pagina, la nota ci entra e le voci restano.
#[test]
fn a_subpage_of_a_folder_page_only_creates_and_an_existing_folder_is_entered() {
    let vault = Vault::with(&[
        ("Viaggio/_index.md", "# Viaggio\n"),
        ("Casa.md", "# Casa\n"),
        ("Casa/Cucina.md", "# Cucina\n"),
    ]);
    let mut ws = vault.open();
    run(
        &mut ws,
        NOTES_SUBPAGE,
        serde_json::json!({ "doc": "Viaggio/_index.md", "name": "Tappe" }),
    )
    .unwrap();
    assert!(vault.on_disk("Viaggio/_index.md"));
    assert!(vault.on_disk("Viaggio/Tappe.md"));

    run(
        &mut ws,
        NOTES_SUBPAGE,
        serde_json::json!({ "doc": "Casa.md", "name": "Bagno" }),
    )
    .unwrap();
    assert!(vault.on_disk("Casa/_index.md"));
    assert!(vault.on_disk("Casa/Bagno.md"));
    assert_eq!(text(&ws, "Casa/Cucina.md"), "# Cucina\n");
}

/// Niente si sovrascrive, e niente si muove prima di saperlo: una cartella
/// che ha già la sua pagina, una sottopagina col nome già preso, un nome
/// vuoto o con una cartella dentro.
#[test]
fn a_subpage_never_overwrites_and_moves_nothing_first() {
    let vault = Vault::with(&[
        ("Viaggio.md", "# Viaggio\n"),
        ("Viaggio/_index.md", "# Pagina\n"),
        ("Casa.md", "# Casa\n"),
        ("Casa/Cucina.md", "# Cucina\n"),
    ]);
    let mut ws = vault.open();
    let page = run(
        &mut ws,
        NOTES_SUBPAGE,
        serde_json::json!({ "doc": "Viaggio.md", "name": "Tappe" }),
    );
    assert!(
        matches!(page, Err(PluginError::AlreadyExists(_))),
        "{page:?}"
    );
    let taken = run(
        &mut ws,
        NOTES_SUBPAGE,
        serde_json::json!({ "doc": "Casa.md", "name": "Cucina" }),
    );
    assert!(
        matches!(taken, Err(PluginError::AlreadyExists(_))),
        "{taken:?}"
    );
    for name in ["  ", "a/b"] {
        let bad = run(
            &mut ws,
            NOTES_SUBPAGE,
            serde_json::json!({ "doc": "Casa.md", "name": name }),
        );
        assert!(matches!(bad, Err(PluginError::BadArgs(_))), "{bad:?}");
    }
    assert_eq!(text(&ws, "Viaggio.md"), "# Viaggio\n");
    assert_eq!(text(&ws, "Viaggio/_index.md"), "# Pagina\n");
    assert!(vault.on_disk("Casa.md"));
    assert!(!vault.on_disk("Casa/_index.md"));
    assert!(!vault.on_disk("Viaggio/Tappe.md"));
}

/// Se la creazione fallisce dopo lo spostamento — un nome che la regola dei
/// nomi nuovi rifiuta — la pagina torna dov'era, con i link.
#[test]
fn a_subpage_that_cannot_be_created_puts_the_page_back() {
    let vault = Vault::with(&[
        ("Viaggio.md", "# Viaggio\n"),
        ("Diario.md", "Vedi [[Viaggio]]."),
    ]);
    let mut ws = vault.open();
    let failed = run(
        &mut ws,
        NOTES_SUBPAGE,
        serde_json::json!({ "doc": "Viaggio.md", "name": "Tappe." }),
    );
    assert!(failed.is_err(), "{failed:?}");
    assert!(vault.on_disk("Viaggio.md"));
    assert!(!vault.on_disk("Viaggio/_index.md"));
    assert_eq!(text(&ws, "Diario.md"), "Vedi [[Viaggio]].");
    assert_eq!(readers(&ws, "Viaggio.md"), ["Diario.md"]);
}
