// Senza la cargo feature `outline` il modulo non è compilato, e il banco non ha
// un soggetto.
#![cfg(feature = "outline")]
//! `heading.rename` attraverso il kernel vero: il titolo, i link della nota e
//! quelli delle altre, ciò che non va toccato, l'anteprima e l'annulla.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode, UndoStep};
use fub_abi::event::Actor;
use fub_abi::traits::PluginManifest;
use fub_features::{OutlineCommands, HEADING_RENAME, OUTLINE_ID};
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
            PluginManifest::core(OUTLINE_ID, OUTLINE_ID)
                .speaking("it", fub_features::outline::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(OUTLINE_ID, Box::new(OutlineCommands))
            .expect("comandi");
        ws.reindex().expect("reindex");
        ws
    }
}

const NOTA: &str = "# Nota\n\n## Piano iniziale ##\n\nVedi [[#Piano iniziale]].\n\n## Altro\n";
const A: &str = "Il [[Nota#Piano iniziale|piano]], ![[Nota#piano-iniziale]] e [[Nota#Altro]].\n";
const B: &str = "Un omonimo: [[Altra#Piano iniziale]].\n";
const ALTRA: &str = "## Piano iniziale\n";

#[test]
fn the_heading_and_the_links_to_it_are_renamed_and_undone() {
    let vault = Vault::new();
    vault.put("Nota.md", NOTA);
    vault.put("a.md", A);
    vault.put("b.md", B);
    vault.put("Altra.md", ALTRA);
    let mut ws = vault.open();
    let args = serde_json::json!({"doc": "Nota.md", "heading": "Piano iniziale", "new_heading": "Piano finale"});

    let plan = ws
        .invoke_command(
            HEADING_RENAME,
            args.clone(),
            InvokeMode::DryRun,
            Actor::User,
        )
        .unwrap();
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("un'anteprima")
    };
    assert_eq!(plan.docs.len(), 2);
    assert_eq!(vault.read("Nota.md"), NOTA);

    let done = ws
        .invoke_command(HEADING_RENAME, args.clone(), InvokeMode::Apply, Actor::User)
        .unwrap();
    assert!(done.partial.is_none(), "{:?}", done.partial);
    assert_eq!(
        vault.read("Nota.md"),
        "# Nota\n\n## Piano finale ##\n\nVedi [[#Piano finale]].\n\n## Altro\n"
    );
    assert_eq!(
        vault.read("a.md"),
        "Il [[Nota#Piano finale|piano]], ![[Nota#Piano finale]] e [[Nota#Altro]].\n"
    );
    assert_eq!(vault.read("b.md"), B, "un'altra nota con lo stesso titolo");
    assert_eq!(vault.read("Altra.md"), ALTRA);

    // Il titolo vecchio non c'è più: rieseguire è un errore, non una scrittura.
    assert!(ws
        .invoke_command(HEADING_RENAME, args, InvokeMode::Apply, Actor::User)
        .is_err());

    for step in done.undo.unwrap().steps {
        let UndoStep::Edit(planned) = step else {
            panic!("un edit inverso")
        };
        ws.apply_edit(&planned.doc, planned.edit).unwrap();
    }
    assert_eq!(vault.read("Nota.md"), NOTA);
    assert_eq!(vault.read("a.md"), A);
}

#[test]
fn a_rename_that_would_mislead_the_links_is_refused() {
    let vault = Vault::new();
    let body = "## Uno\n\n## **Forte**\n\n## Uno\n\n## Due\n";
    vault.put("Nota.md", body);
    let mut ws = vault.open();
    for (heading, new_heading) in [
        ("Forte", "Debole"),    // formattazione nel testo
        ("Due", "Uno"),         // un titolo precedente ha già quel nome
        ("Uno", "Primo"),       // l'omonimo passerebbe da uno-1 a uno
        ("Due", "Tre|quattro"), // non sta in un link
        ("Manca", "Altro"),
    ] {
        let args =
            serde_json::json!({"doc": "Nota.md", "heading": heading, "new_heading": new_heading});
        assert!(
            ws.invoke_command(HEADING_RENAME, args, InvokeMode::Apply, Actor::User)
                .is_err(),
            "{heading} → {new_heading}"
        );
    }
    assert_eq!(vault.read("Nota.md"), body);
}
