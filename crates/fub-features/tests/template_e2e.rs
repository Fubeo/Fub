#![cfg(feature = "template")]
//! Template e note giornaliere end-to-end attraverso il kernel vero.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{UiAction, UiKind, UiNode};
use fub_features::{
    TemplateCommands, TemplateView, NOTE_DAILY, NOTE_FROM_TEMPLATE, TEMPLATE_ID, TEMPLATE_VIEW,
};
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
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            PluginManifest::core(TEMPLATE_ID, TEMPLATE_ID)
                .speaking("it", fub_features::template::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(TEMPLATE_ID, Box::new(TemplateView))
            .expect("view");
        ws.register_command_provider(TEMPLATE_ID, Box::new(TemplateCommands))
            .expect("comandi");
        ws.reindex().expect("reindex");
        ws
    }
}

fn voci(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::ListItem { title, .. } => out.push(title.to_string()),
            UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

#[test]
fn from_template_sostituisce_e_crea() {
    let vault = Vault::new();
    vault.put("Templates/Meeting.md", "# {{title}}\n\nData: {{date}}\n");
    let mut ws = vault.open();
    let esito = ws
        .invoke_command(
            NOTE_FROM_TEMPLATE,
            serde_json::json!({"template": "Templates/Meeting.md", "name": "Standup"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("from_template");
    let CommandEffect::Navigate { doc } = esito.effect else {
        panic!("atteso Navigate, {:?}", esito.effect);
    };
    assert_eq!(doc, DocId::new("Standup.md"));
    let corpo = ws.read_source(&doc).unwrap();
    assert!(corpo.starts_with("# Standup\n"), "{corpo}");
    assert!(corpo.contains("Data: 20"), "{corpo}");
}

#[test]
fn daily_crea_e_la_seconda_volta_apre() {
    let vault = Vault::new();
    vault.put("Templates/Daily.md", "diario {{date}}\n");
    let mut ws = vault.open();
    let primo = ws
        .invoke_command(
            NOTE_DAILY,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("daily");
    let CommandEffect::Navigate { doc } = primo.effect else {
        panic!("{:?}", primo.effect);
    };
    assert!(doc.as_str().starts_with("Daily/"), "{}", doc.as_str());
    assert!(doc.as_str().ends_with(".md"));
    let corpo = ws.read_source(&doc).unwrap();
    assert!(corpo.starts_with("diario 20"), "{corpo}");

    let secondo = ws
        .invoke_command(
            NOTE_DAILY,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("daily di nuovo");
    let CommandEffect::Navigate { doc: di_nuovo } = secondo.effect else {
        panic!("{:?}", secondo.effect);
    };
    assert_eq!(doc, di_nuovo);
    assert_eq!(ws.read_source(&doc).unwrap(), corpo);
}

#[test]
fn la_view_elenca_i_template() {
    let vault = Vault::new();
    vault.put("Templates/A.md", "a\n");
    vault.put("Templates/B.md", "b\n");
    vault.put("Altro.md", "no\n");
    let ws = vault.open();
    let tree = ws.render_view(&ViewInstance::only(TEMPLATE_VIEW)).unwrap();
    let voci = voci(&tree);
    assert_eq!(voci, vec!["A".to_string(), "B".to_string()]);
}

#[test]
fn dry_run_non_scrive() {
    let vault = Vault::new();
    vault.put("Templates/X.md", "x\n");
    let mut ws = vault.open();
    let prima = ws.documents();
    let esito = ws
        .invoke_command(
            NOTE_FROM_TEMPLATE,
            serde_json::json!({"template": "Templates/X.md", "name": "Y"}),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("dry_run");
    assert!(matches!(esito.effect, CommandEffect::Plan(_)));
    assert_eq!(ws.documents(), prima);
}

#[test]
fn click_crea_da_template() {
    let vault = Vault::new();
    vault.put("Templates/Scheda.md", "ciao {{title}}\n");
    let mut ws = vault.open();
    let update = ws
        .view_action(
            &ViewInstance::only(TEMPLATE_VIEW),
            UiAction::new("use")
                .with_payload(serde_json::json!({"template": "Templates/Scheda.md"})),
        )
        .expect("view_action");
    match update {
        fub_abi::ui::ViewUpdate::Navigate { doc_id } => {
            assert!(doc_id.ends_with(".md"), "{doc_id}");
            let corpo = ws.read_source(&DocId::new(&doc_id)).unwrap();
            assert!(corpo.contains("ciao "), "{corpo}");
        }
        other => panic!("atteso Navigate, {other:?}"),
    }
}
