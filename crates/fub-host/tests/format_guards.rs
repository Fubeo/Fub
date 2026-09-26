//! Le feature non scrivono sintassi di nota dentro un formato che non la
//! capisce.
//!
//! Il montaggio è quello vero: Markdown, Canvas e Base registrati, tutte le
//! feature ufficiali. Il reparse del kernel prima della scrittura ferma un
//! canvas rotto, ma non un `.base`, che si analizza sempre: senza la guardia di
//! formato un frontmatter davanti alle viste le cancellava, e il comando
//! rispondeva con successo.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates, Workspace};

const BASE: &str = "views:\n  - name: Tutto\n    type: table\n";
const CANVAS: &str = r#"{"nodes":[{"id":"a","type":"text","text":"vedi bear://x  ","x":0,"y":0,"width":10,"height":10}],"edges":[]}"#;
const NOTE: &str = "# B\n\ntesto con nodes e name\n";

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    workspace: Workspace,
}

impl Vault {
    fn open() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        std::fs::write(root.join("tab.base"), BASE).unwrap();
        std::fs::write(root.join("board.canvas"), CANVAS).unwrap();
        std::fs::write(root.join("b.md"), NOTE).unwrap();
        let mut mounted = fub_host::mount::mount(
            &root,
            MachineSettings::in_memory(),
            ViewStates::in_memory(),
            Arc::new(SystemLocale::default()),
            &fub_kernel::log::Levels::default(),
        )
        .unwrap();
        mounted.workspace.reindex().unwrap();
        Vault {
            _dir: dir,
            root,
            workspace: mounted.workspace,
        }
    }

    fn run(&mut self, command: &str, args: serde_json::Value) -> Result<(), PluginError> {
        self.workspace
            .invoke_command(command, args, InvokeMode::Apply, Actor::User)
            .map(|_| ())
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).unwrap()
    }

    fn untouched(&self) {
        assert_eq!(self.read("tab.base"), BASE, "il .base è cambiato");
        assert_eq!(self.read("board.canvas"), CANVAS, "il canvas è cambiato");
    }
}

fn bad_args(result: Result<(), PluginError>) {
    match result {
        Err(PluginError::BadArgs(_)) => {}
        other => panic!("atteso un rifiuto tipizzato, non {other:?}"),
    }
}

#[test]
fn a_property_is_never_written_into_a_base_or_a_canvas() {
    let mut vault = Vault::open();
    for doc in ["tab.base", "board.canvas"] {
        bad_args(vault.run(
            "note.property.set",
            serde_json::json!({ "doc": doc, "key": "status", "value": "x" }),
        ));
        bad_args(vault.run(
            "note.property.remove",
            serde_json::json!({ "doc": doc, "key": "status" }),
        ));
    }
    vault.untouched();
    // Sulla nota Markdown lo stesso comando scrive.
    vault
        .run(
            "note.property.set",
            serde_json::json!({ "doc": "b.md", "key": "status", "value": "x" }),
        )
        .unwrap();
    assert!(vault.read("b.md").starts_with("---\nstatus: x\n---\n"));
}

#[test]
fn text_insertions_and_merges_refuse_structured_formats() {
    let mut vault = Vault::open();
    bad_args(vault.run(
        "note.merge",
        serde_json::json!({ "from": ["b.md"], "into": "tab.base" }),
    ));
    bad_args(vault.run(
        "note.merge",
        serde_json::json!({ "from": ["board.canvas", "tab.base"], "into": "b.md" }),
    ));
    bad_args(vault.run(
        "note.insert_datetime",
        serde_json::json!({ "doc": "tab.base", "at": [0] }),
    ));
    bad_args(vault.run(
        "note.insert_template",
        serde_json::json!({ "doc": "tab.base", "at": [0], "template": "Templates/T.md" }),
    ));
    vault.untouched();
    // Il merge rifiutato non ha cestinato niente.
    assert_eq!(vault.read("b.md"), NOTE);
}

#[test]
fn bulk_rewrites_skip_what_is_not_prose() {
    let mut vault = Vault::open();
    for (find, replace) in [("nodes", "nodi"), ("name", "nome")] {
        vault
            .run(
                "vault.replace",
                serde_json::json!({ "find": find, "replace": replace }),
            )
            .unwrap();
    }
    vault
        .run("import.normalize", serde_json::json!({}))
        .unwrap();
    vault
        .run("import.convert_legacy", serde_json::json!({}))
        .unwrap();
    vault.untouched();
    assert_eq!(vault.read("b.md"), "# B\n\ntesto con nodi e nome\n");
}

#[test]
fn a_rename_without_extension_keeps_the_format() {
    let mut vault = Vault::open();
    vault
        .run(
            "note.rename",
            serde_json::json!({ "doc": "board.canvas", "to": "Lavagna" }),
        )
        .unwrap();
    assert_eq!(vault.read("Lavagna.canvas"), CANVAS);
    assert!(!vault.root.join("Lavagna.md").exists());
}

#[test]
fn a_new_note_takes_the_configured_extension_and_properties_only_where_they_fit() {
    let mut vault = Vault::open();
    let outcome = vault
        .workspace
        .invoke_command(
            "note.create",
            serde_json::json!({ "name": "Idea" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap();
    assert!(
        matches!(&outcome.effect, CommandEffect::Navigate { doc } if doc == &DocId::new("Idea.md")),
        "{outcome:?}"
    );
    bad_args(vault.run(
        "note.create",
        serde_json::json!({ "name": "altra.base", "properties": "{\"status\":\"x\"}" }),
    ));
    assert!(!vault.root.join("altra.base").exists());
}

#[test]
fn the_daily_note_and_its_template_follow_the_new_note_extension() {
    let mut vault = Vault::open();
    std::fs::create_dir_all(vault.root.join("Templates")).unwrap();
    std::fs::write(
        vault.root.join("Templates/Daily.markdown"),
        "diario {{date}}\n",
    )
    .unwrap();
    vault.workspace.reindex().unwrap();
    vault
        .workspace
        .set_setting(
            "files.new-note-extension",
            fub_abi::settings::SettingValue::Text("markdown".into()),
        )
        .unwrap();
    vault
        .run("note.daily", serde_json::json!({ "date": "2024-02-29" }))
        .unwrap();
    let daily = vault.read("Daily/2024-02-29.markdown");
    assert!(
        daily.ends_with("diario 2024-02-29\n"),
        "il template senza estensione è quello del formato delle note nuove: {daily}"
    );
    assert!(!vault.root.join("Daily/2024-02-29.md").exists());
}

/// Una nota è prosa con qualunque estensione il formato dichiari: un vault di
/// soli `.markdown` ha note da estrarre a caso e template nel pannello (I67),
/// come per `fub-cli templates --list`.
#[test]
fn random_note_and_template_panel_see_markdown_by_any_extension() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::create_dir_all(root.join("Templates")).unwrap();
    std::fs::write(root.join("nota.markdown"), "# Nota\n").unwrap();
    std::fs::write(root.join("Templates/T.markdown"), "modello\n").unwrap();
    let root = root.canonicalize_utf8().unwrap();
    let host = fub_host::Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    let outcome = host
        .invoke_user_command(
            Some(root.as_str()),
            fub_features::template::NOTES_RANDOM,
            serde_json::Value::Null,
            InvokeMode::Apply,
        )
        .expect("a vault of .markdown notes has notes");
    assert!(
        matches!(&outcome.effect, CommandEffect::Navigate { doc } if doc.as_str().ends_with(".markdown")),
        "{outcome:?}"
    );

    let panel = host
        .render_view(
            Some(root.as_str()),
            &fub_abi::traits::ViewInstance::only(fub_features::template::TEMPLATE_VIEW),
        )
        .unwrap();
    let shown = serde_json::to_string(&panel).unwrap();
    assert!(
        shown.contains("Templates/T.markdown"),
        "the template panel lists the .markdown template: {shown}"
    );
}
