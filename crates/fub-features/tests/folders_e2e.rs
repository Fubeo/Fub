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
use fub_features::{CoreCommands, COMMANDS_ID, FOLDER_RENAME, FOLDER_TRASH, VAULT_UNDO};
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
