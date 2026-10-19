// Senza la cargo feature `tags` il modulo non è compilato, e il banco non ha un
// soggetto.
#![cfg(feature = "tags")]
//! `tag.rename` attraverso il kernel vero: corpo e frontmatter, figli, codice
//! lasciato stare, anteprima che non scrive, un annulla che rimette tutto.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode, UndoStep};
use fub_abi::event::Actor;
use fub_abi::traits::PluginManifest;
use fub_features::{TagCommands, TAGS_ID, TAG_RENAME};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

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

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).unwrap()
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            PluginManifest::core(TAGS_ID, TAGS_ID).speaking("it", fub_features::tags::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(TAGS_ID, Box::new(TagCommands))
            .expect("comandi");
        ws.reindex().expect("reindex");
        ws
    }
}

const A: &str = "---\ntags: [progetto, altro] # nota\n---\n\nVedi #Progetto e #progetto/casa, non #progettone.\n\n`#progetto` resta codice.\n";
const B: &str = "Solo nel testo: #progetto\n";
const C: &str = "Niente da fare: #altro\n";

#[test]
fn the_rename_previews_writes_and_undoes_body_and_frontmatter() {
    let vault = Vault::new();
    vault.put("a.md", A);
    vault.put("b.md", B);
    vault.put("c.md", C);
    let mut ws = vault.open();
    let args = serde_json::json!({"old_tag": "#progetto", "new_tag": "lavoro"});

    let plan = ws
        .invoke_command(TAG_RENAME, args.clone(), InvokeMode::DryRun, Actor::User)
        .unwrap();
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("un'anteprima")
    };
    assert_eq!(plan.docs.len(), 2);
    assert_eq!(vault.read("a.md"), A);

    let done = ws
        .invoke_command(TAG_RENAME, args.clone(), InvokeMode::Apply, Actor::User)
        .unwrap();
    assert!(done.partial.is_none(), "{:?}", done.partial);
    assert_eq!(
        vault.read("a.md"),
        "---\ntags: [lavoro, altro] # nota\n---\n\nVedi #lavoro e #lavoro/casa, non #progettone.\n\n`#progetto` resta codice.\n"
    );
    assert_eq!(vault.read("b.md"), "Solo nel testo: #lavoro\n");
    assert_eq!(vault.read("c.md"), C);

    let again = ws
        .invoke_command(TAG_RENAME, args, InvokeMode::Apply, Actor::User)
        .unwrap();
    assert!(again.undo.is_none(), "rieseguire non trova più niente");

    for step in done.undo.unwrap().steps {
        let UndoStep::Edit(planned) = step else {
            panic!("un edit inverso")
        };
        ws.apply_edit(&planned.doc, planned.edit).unwrap();
    }
    assert_eq!(vault.read("a.md"), A);
    assert_eq!(vault.read("b.md"), B);
}

#[test]
fn an_invalid_name_or_the_same_name_is_refused() {
    let vault = Vault::new();
    vault.put("a.md", B);
    let mut ws = vault.open();
    for args in [
        serde_json::json!({"old_tag": "progetto", "new_tag": "due parole"}),
        serde_json::json!({"old_tag": "progetto", "new_tag": "123"}),
        serde_json::json!({"old_tag": "progetto", "new_tag": "#progetto"}),
    ] {
        assert!(ws
            .invoke_command(TAG_RENAME, args, InvokeMode::Apply, Actor::User)
            .is_err());
    }
    assert_eq!(vault.read("a.md"), B);
}
