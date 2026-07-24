//! Test end-to-end della pipeline M1 sul vault di esempio:
//! scansione vault → provider markdown nativo → grafo dei link, senza GUI.

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

fn open_sample() -> Workspace {
    let root =
        Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/sample-vault");
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed());
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().expect("reindex del vault di esempio");
    ws
}

#[test]
fn scans_all_documents() {
    let ws = open_sample();
    let docs = ws.documents();
    assert_eq!(docs.len(), 4, "documenti: {docs:?}");
    assert!(docs.contains(&DocId::new("index.md")));
    assert!(docs.contains(&DocId::new("Progetti/Alpha.md")));
}

#[test]
fn resolves_wikilinks_by_name_alias_and_path() {
    let ws = open_sample();
    assert_eq!(ws.resolve_link("Nota B"), Some(DocId::new("Nota B.md")));
    assert_eq!(
        ws.resolve_link("Alfa"),
        Some(DocId::new("Progetti/Alpha.md"))
    );
    assert_eq!(
        ws.resolve_link("Progetti/Alpha"),
        Some(DocId::new("Progetti/Alpha.md"))
    );
    assert_eq!(ws.resolve_link("Inesistente"), None);
}

#[test]
fn computes_backlinks_with_context() {
    let ws = open_sample();
    let bl = ws.backlinks(&DocId::new("Nota B.md"));
    let sources: Vec<_> = bl.iter().map(|r| r.source.as_str()).collect();
    // index (2 link), Progetti/Alpha, Daily (via embed) puntano a Nota B.
    assert!(sources.contains(&"index.md"), "backlink: {sources:?}");
    assert!(
        sources.contains(&"Progetti/Alpha.md"),
        "backlink: {sources:?}"
    );
    assert!(
        sources.contains(&"Daily/2026-07-24.md"),
        "backlink: {sources:?}"
    );
    assert!(bl.iter().any(|r| r.context.is_some()));
}

#[test]
fn renders_preview_with_wikilink_data_attrs() {
    let ws = open_sample();
    let html = ws.render_preview(&DocId::new("index.md")).unwrap();
    assert!(
        html.contains("data-wikilink-page=\"Nota B\""),
        "html: {html}"
    );
    assert!(html.contains("class=\"tag\""));
}

#[test]
fn edit_updates_graph_and_backlinks() {
    let mut ws = open_sample();
    let daily = DocId::new("Daily/2026-07-24.md");
    // Prima: Daily non punta a index.
    assert!(!ws
        .backlinks(&DocId::new("index.md"))
        .iter()
        .any(|r| r.source == daily));
    // Scrive un nuovo contenuto che aggiunge un link a index (poi ripristina).
    let original = ws.read_source(&daily).unwrap();
    ws.write_document(&daily, "# Diario\n\nAdesso punto a [[index]].\n")
        .unwrap();
    assert!(ws
        .backlinks(&DocId::new("index.md"))
        .iter()
        .any(|r| r.source == daily));
    ws.write_document(&daily, &original).unwrap();
}
