use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::format::{DocumentSource, FormatProvider, ParseContext, RenderOptions, RenderTarget};
use fub_abi::model::DocId;
use fub_format_canvas::{parse_canvas, CanvasProvider};
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

fn mounted(root: &camino::Utf8Path) -> fub_host::mount::Mounted {
    let mut mounted = fub_host::mount::mount(
        root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("mount with the production canvas provider");
    mounted.workspace.reindex().expect("index the actual vault");
    mounted
}

#[test]
fn rename_rewrites_file_card_and_wiki_text_through_real_host_provider() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::create_dir(root.join("Notes")).unwrap();
    std::fs::create_dir(root.join("Boards")).unwrap();
    std::fs::write(root.join("Notes/Vecchia.md"), "# Sezione\ncontenuto").unwrap();
    let source = r#"{"unrecognizedRoot": [1, {"preserve":true}],"nodes":[{"id":"file","type":"file","x":0,"y":0,"width":160,"height":90,"file":"Notes/Vecchia.md","future":{"emoji":"🧭"}},{"id":"text","type":"text","x":180,"y":0,"width":160,"height":90,"text":"Riga\n[[Vecchia#Sezione|alias]]","unknown":"\u0055"}],"edges":[]}"#;
    std::fs::write(root.join("Boards/board.canvas"), source).unwrap();
    let mut mounted = mounted(&root);
    let board = DocId::new("Boards/board.canvas");
    assert_eq!(
        mounted.workspace.format_of(&board).unwrap().descriptor.id,
        "canvas"
    );
    let old = DocId::new("Notes/Vecchia.md");
    assert_eq!(mounted.workspace.backlinks(&old).len(), 2);

    let new = DocId::new("Notes/Nuova.md");
    mounted
        .workspace
        .rename_document(&old, &new)
        .expect("generic rename applies canvas provider edits");
    let after = mounted.workspace.read_source(&board).unwrap();
    let expected = source
        .replace(
            "\"file\":\"Notes/Vecchia.md\"",
            "\"file\":\"Notes/Nuova.md\"",
        )
        .replace("[[Vecchia#Sezione|alias]]", "[[Nuova#Sezione|alias]]");
    assert_eq!(
        after.as_bytes(),
        expected.as_bytes(),
        "everything outside the two references remains byte-identical"
    );
    let canvas = parse_canvas(&after).unwrap();
    assert_eq!(canvas.nodes[0].file.as_deref(), Some("Notes/Nuova.md"));
    assert_eq!(
        canvas.nodes[1].text.as_deref(),
        Some("Riga\n[[Nuova#Sezione|alias]]")
    );
    assert_eq!(canvas.nodes[0].extra["future"]["emoji"], "🧭");
    assert_eq!(canvas.extra["unrecognizedRoot"][1]["preserve"], true);
    assert_eq!(mounted.workspace.backlinks(&new).len(), 2);
    assert!(mounted.workspace.backlinks(&old).is_empty());
}

#[test]
fn canvas_preview_and_nested_embed_projections_use_the_registered_provider() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let board = r#"{"nodes":[{"id":"text","type":"text","x":0,"y":0,"width":200,"height":100,"text":"Safe <script>evil</script>\n\n![[nested.canvas]] ![[detail.md]]"}],"edges":[],"vendor":{"keep":true}}"#;
    let nested = r#"{"nodes":[{"id":"child","type":"text","x":0,"y":0,"width":200,"height":100,"text":"Nested & <safe>"}],"edges":[]}"#;
    std::fs::write(root.join("board.canvas"), board).unwrap();
    std::fs::write(root.join("nested.canvas"), nested).unwrap();
    std::fs::write(root.join("detail.md"), "# Detail\nBody from note").unwrap();
    std::fs::write(root.join("parent.md"), "![[board.canvas]]").unwrap();
    let mounted = mounted(&root);
    let parent = mounted
        .workspace
        .render_preview(&DocId::new("parent.md"))
        .unwrap();
    assert!(
        parent.html.contains("data-embed-page=\"board.canvas\""),
        "{}",
        parent.html
    );
    let preview = mounted
        .workspace
        .render_preview(&DocId::new("board.canvas"))
        .unwrap();
    assert!(preview.html.contains("canvas-preview"), "{}", preview.html);
    assert!(
        preview.html.contains("&lt;script&gt;") && preview.html.contains("&lt;/script&gt;"),
        "{}",
        preview.html
    );
    assert!(!preview.html.contains("<script>"), "{}", preview.html);
    for page in ["nested.canvas", "detail.md"] {
        assert!(
            preview
                .html
                .contains(&format!("data-embed-page=\"{page}\"")),
            "{}",
            preview.html
        );
    }
    let board_id = DocId::new("board.canvas");
    let embedded = mounted.workspace.render_preview(&board_id).unwrap();
    assert_eq!(embedded.html, preview.html);
    let nested_id = DocId::new("nested.canvas");
    let nested_render = mounted.workspace.render_preview(&nested_id).unwrap();
    assert_eq!(nested_id, DocId::new("nested.canvas"));
    assert!(
        nested_render.html.contains("Nested &amp;") && nested_render.html.contains("&lt;safe&gt;"),
        "{}",
        nested_render.html
    );
    let note_id = DocId::new("detail.md");
    let note_render = mounted.workspace.render_preview(&note_id).unwrap();
    assert_eq!(note_id, DocId::new("detail.md"));
    assert!(
        note_render.html.contains("Body from note"),
        "{}",
        note_render.html
    );

    // Static/export-facing provider projection is inert, not an iframe or executable HTML.
    let provider = CanvasProvider::new();
    let model = provider
        .parse(
            &DocumentSource::Text(board.into()),
            &ParseContext::obsidian("board.canvas"),
        )
        .unwrap();
    let options = RenderOptions {
        target: RenderTarget::StaticSite,
        ..RenderOptions::default()
    };
    let html = provider.render_html(&model, &options).unwrap();
    assert!(html.contains("canvas-preview"), "{html}");
    assert!(
        !html.contains("<script>") && !html.contains("<iframe"),
        "{html}"
    );
    assert!(
        html.contains("data-embed-page=\"nested.canvas\"")
            && html.contains("data-embed-page=\"detail.md\""),
        "{html}"
    );
}

/// I55, attraverso i provider veri: `[[board.canvas]]` — la forma in cui
/// Obsidian scrive i link ai canvas — porta al canvas, il nome nudo accanto a
/// omonimi di formati diversi porta alla pagina di prosa, e la rinomina
/// conserva la forma che l'autore aveva scritto.
#[test]
fn a_name_with_its_extension_reaches_the_canvas_and_survives_a_rename() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let empty = r#"{"nodes":[],"edges":[]}"#;
    std::fs::write(root.join("board.canvas"), empty).unwrap();
    std::fs::write(root.join("Progetto.md"), "# Progetto\n").unwrap();
    std::fs::write(root.join("Progetto.canvas"), empty).unwrap();
    std::fs::write(
        root.join("Progetto.base"),
        "views:\n  - {name: A, type: table}\n",
    )
    .unwrap();
    let note = "[[board.canvas]] e [[board]], [[Progetto]] e [[Progetto.canvas]]\n";
    std::fs::write(root.join("Riunione.md"), note).unwrap();
    let mut mounted = mounted(&root);
    let workspace = &mut mounted.workspace;
    let sources = |workspace: &fub_kernel::Workspace, id: &str| -> Vec<String> {
        workspace
            .backlinks(&DocId::new(id))
            .into_iter()
            .map(|link| link.source.to_string())
            .collect()
    };

    assert_eq!(
        sources(workspace, "board.canvas"),
        ["Riunione.md", "Riunione.md"]
    );
    assert_eq!(sources(workspace, "Progetto.md"), ["Riunione.md"]);
    assert_eq!(sources(workspace, "Progetto.canvas"), ["Riunione.md"]);
    assert!(sources(workspace, "Progetto.base").is_empty());

    workspace
        .rename_document(&DocId::new("board.canvas"), &DocId::new("Lavagna.canvas"))
        .expect("rename the board");
    workspace
        .rename_document(&DocId::new("Progetto.canvas"), &DocId::new("Piano.canvas"))
        .expect("rename the project board");
    let riunione = DocId::new("Riunione.md");
    assert_eq!(
        workspace.read_source(&riunione).unwrap(),
        "[[Lavagna.canvas]] e [[Lavagna]], [[Progetto]] e [[Piano.canvas]]\n",
        "the extension the author wrote stays, the bare name to the page is untouched"
    );
    assert_eq!(
        sources(workspace, "Lavagna.canvas"),
        ["Riunione.md", "Riunione.md"]
    );
    assert_eq!(sources(workspace, "Piano.canvas"), ["Riunione.md"]);
    assert_eq!(sources(workspace, "Progetto.md"), ["Riunione.md"]);
}
