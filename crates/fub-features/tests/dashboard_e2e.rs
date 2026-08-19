#![cfg(feature = "dashboard")]
//! Dashboard del vault: conteggi da Entries/Tags/VaultHealth.

use camino::Utf8PathBuf;
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{UiKind, UiNode};
use fub_features::{DashboardView, DASHBOARD_ID, DASHBOARD_VIEW};
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
            PluginManifest::core(DASHBOARD_ID, DASHBOARD_ID)
                .speaking("it", fub_features::dashboard::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(DASHBOARD_ID, Box::new(DashboardView))
            .expect("view");
        ws.reindex().expect("reindex");
        ws
    }
}

fn testi(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::Text { content } => out.push(format!("{content}")),
            UiKind::ListItem {
                title, subtitle, ..
            } => {
                out.push(format!("{title}"));
                if let Some(s) = subtitle {
                    out.push(format!("{s}"));
                }
            }
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
fn conta_note_tag_e_link_rotti() {
    let vault = Vault::new();
    vault.put("a.md", "# A\n\n#rust\n[[manca]]\n");
    vault.put("b.md", "# B\n");
    let ws = vault.open();
    let tree = ws.render_view(&ViewInstance::only(DASHBOARD_VIEW)).unwrap();
    let testi = testi(&tree);
    let blob = testi.join(" | ");
    assert!(
        testi.iter().any(|t| t.contains("2") && t.contains("note")),
        "note: {blob}"
    );
    assert!(testi.iter().any(|t| t.contains("tag")), "tag: {blob}");
    assert!(
        testi.iter().any(|t| t.contains("link rotti")),
        "rotti: {blob}"
    );
    assert!(
        testi.iter().any(|t| t.contains("a.md")),
        "il link rotto nomina la nota: {blob}"
    );
}

#[test]
fn vault_vuoto_zero_rotti() {
    let vault = Vault::new();
    let ws = vault.open();
    let tree = ws.render_view(&ViewInstance::only(DASHBOARD_VIEW)).unwrap();
    let testi = testi(&tree);
    let blob = testi.join(" | ");
    assert!(
        testi.iter().any(|t| t.contains("0") && t.contains("note")),
        "{blob}"
    );
}
