//! Il pannello tag end-to-end **attraverso il kernel vero**: vault su disco,
//! markdown vero, modelli veri, `KernelHost` vero.
//!
//! Prova che l'aggregazione dei tag arriva dal kernel via `IndexQuery::Tags`
//! (nessun indice della view), che il conteggio è per **note** e non per
//! occorrenze, e che il click chiede una ricerca (`ViewUpdate::RunSearch`).

use camino::Utf8PathBuf;
use fubmd_abi::ui::{ActionId, UiAction, UiNode, ViewUpdate};
use fubmd_features::{TagPanelView, TAGS_ID, TAGS_VIEW};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Trust, Workspace};

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

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry.register(MarkdownProvider::boxed());
        let mut ws = Workspace::new(&self.root, registry);
        ws.register_view_provider(TAGS_ID, Trust::Trusted, Box::new(TagPanelView));
        ws.reindex().expect("reindex");
        ws
    }
}

/// (titolo, sottotitolo) di ogni voce, in ordine: `("#tag", "count")`.
fn rows(tree: &UiNode) -> Vec<(String, Option<String>)> {
    fn walk(node: &UiNode, out: &mut Vec<(String, Option<String>)>) {
        match node {
            UiNode::ListItem {
                title, subtitle, ..
            } => out.push((title.clone(), subtitle.clone())),
            UiNode::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiNode::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

#[test]
fn tags_are_aggregated_across_the_vault_and_counted_per_note() {
    let vault = Vault::new();
    // `#rust` in due note (una lo ripete: conta comunque 1 per nota), `#nota`
    // in una.
    vault.put("A.md", "#rust e ancora #rust qui\n");
    vault.put("B.md", "#rust e #nota\n");
    vault.put("C.md", "niente tag\n");
    let ws = vault.open();

    let tree = ws.render_view(TAGS_VIEW).unwrap();
    let rows = rows(&tree);
    // ordinati per nome dal kernel: nota (1), rust (2)
    assert_eq!(
        rows,
        vec![
            ("#nota".to_string(), Some("1".to_string())),
            ("#rust".to_string(), Some("2".to_string())),
        ]
    );
}

#[test]
fn spellings_of_the_same_tag_are_one_row_with_one_count() {
    let vault = Vault::new();
    // `#Rust` e `#rust` sono lo stesso tag (chiave canonica, stile Obsidian):
    // una riga sola nel pannello, col conteggio che il click poi conferma.
    vault.put("A.md", "#Rust qui\n");
    vault.put("B.md", "#rust là\n");
    let ws = vault.open();

    let tree = ws.render_view(TAGS_VIEW).unwrap();
    let rows = rows(&tree);
    assert_eq!(rows.len(), 1, "righe: {rows:?}");
    assert_eq!(rows[0].1, Some("2".to_string()));
    // Il display conserva il case di una grafia reale (la minore, per essere
    // deterministici), non inventa una forma minuscola mai scritta.
    assert_eq!(rows[0].0, "#Rust");
}

#[test]
fn clicking_a_tag_asks_the_shell_to_search_for_it() {
    let vault = Vault::new();
    vault.put("A.md", "#rust\n");
    let mut ws = vault.open();

    let update = ws
        .view_action(
            TAGS_VIEW,
            UiAction {
                action: ActionId("tag:rust".into()),
                payload: serde_json::Value::Null,
            },
        )
        .expect("view_action");
    assert_eq!(
        update,
        ViewUpdate::RunSearch {
            query: "tags:rust".to_string()
        }
    );
}
