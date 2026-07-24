//! Test end-to-end della pipeline M1 sul vault di esempio:
//! scansione vault → provider markdown nativo → grafo dei link, senza GUI.

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, KernelError, Workspace};

fn sample_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/sample-vault")
}

fn open(root: &Utf8PathBuf) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed());
    let mut ws = Workspace::new(root, registry);
    ws.reindex().expect("reindex del vault di esempio");
    ws
}

fn open_sample() -> Workspace {
    open(&sample_root())
}

/// Una copia usa-e-getta del vault di esempio.
///
/// I test che *creano* file passano di qui: il fixture lo leggono tutti gli
/// altri, e una nota dimenticata dentro lo farebbe mentire.
fn open_scratch() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    copy_dir(&sample_root(), &root);
    let ws = open(&root);
    (dir, ws)
}

fn copy_dir(from: &Utf8PathBuf, to: &Utf8PathBuf) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let src = Utf8PathBuf::from_path_buf(entry.path()).unwrap();
        let dst = to.join(entry.file_name().to_string_lossy().as_ref());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&src, &dst);
        } else {
            std::fs::copy(&src, &dst).unwrap();
        }
    }
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

#[test]
fn a_new_note_takes_the_first_free_untitled_name() {
    let (_scratch, mut ws) = open_scratch();

    assert_eq!(ws.create_note(None).unwrap(), DocId::new("Senza titolo.md"));
    assert_eq!(ws.create_note(None).unwrap(), DocId::new("Senza titolo 1.md"));
    assert_eq!(ws.create_note(None).unwrap(), DocId::new("Senza titolo 2.md"));

    // Nasce vuota, e nasce già dentro il vault: nessun secondo passaggio.
    assert_eq!(ws.read_source(&DocId::new("Senza titolo.md")).unwrap(), "");
    assert!(ws.documents().contains(&DocId::new("Senza titolo 1.md")));
}

#[test]
fn creating_the_note_a_dangling_link_points_to_makes_the_backlink_appear() {
    let (_scratch, mut ws) = open_scratch();
    // `index.md` contiene `[[Inesistente]]`, un link che non risolve.
    assert!(ws.resolve_link("Inesistente").is_none());

    let creata = ws.create_note(Some("Inesistente")).unwrap();

    assert_eq!(creata, DocId::new("Inesistente.md"), "l'estensione la mette il kernel");
    assert_eq!(ws.resolve_link("Inesistente"), Some(creata.clone()));
    // Il backlink compare da solo: il link in `index.md` non è stato toccato,
    // è il grafo a risolverlo di nuovo ora che la destinazione esiste.
    let sorgenti: Vec<String> = ws
        .backlinks(&creata)
        .iter()
        .map(|r| r.source.to_string())
        .collect();
    assert!(sorgenti.contains(&"index.md".to_string()), "backlink: {sorgenti:?}");
}

#[test]
fn a_note_created_in_a_folder_stays_there() {
    let (_scratch, mut ws) = open_scratch();
    let creata = ws.create_note(Some("Progetti/Beta")).unwrap();
    assert_eq!(creata, DocId::new("Progetti/Beta.md"));
    assert_eq!(ws.resolve_link("Beta"), Some(creata));
}

#[test]
fn creating_a_note_over_an_existing_one_is_refused() {
    let (_scratch, mut ws) = open_scratch();
    // Nessun nome aggiustato in silenzio: se il path esistesse, il link da cui
    // arriva la richiesta non sarebbe stato non risolto.
    let err = ws.create_note(Some("Nota B")).unwrap_err();
    assert!(matches!(err, KernelError::AlreadyExists(_)), "trovato {err}");
    let err = ws.create_note(Some("   ")).unwrap_err();
    assert!(matches!(err, KernelError::BadName(_)), "trovato {err}");
}
