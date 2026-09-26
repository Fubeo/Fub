//! Publish sceglie le pagine e risolve i link con le regole del vault, non
//! con quelle di un vault fatto solo di `.md`.
//!
//! Il kernel è quello vero, con i provider veri: la risoluzione è la stessa
//! della navigazione nell'app (`IndexQuery::Resolve`). Se il proiettore
//! tornasse ad aggiungere `.md` al nome di un wikilink, `[[Nota]]` verso
//! `dir/Nota.md` fallirebbe con «wikilink target is not published»; se la
//! scelta delle pagine tornasse a guardare l'id `markdown`, un formato terzo
//! con il frontmatter resterebbe fuori.

use fub_format_canvas::CanvasProvider;
use fub_format_markdown::MarkdownProvider;
use fub_host::publish::site::{collect_export, ExportSnapshot};
use fub_testkit::{Bench, Mounted};

const PUBLISH: &str = "fub.publish";

fn vault(files: &[(&str, &str)]) -> Mounted {
    let mut bench = Bench::new()
        .with_format(Box::new(MarkdownProvider::new()))
        .with_format(Box::new(CanvasProvider::new()))
        .with_plugin(PUBLISH);
    for (name, text) in files {
        bench = bench.with_file(name, text);
    }
    bench.mounts()
}

fn export(vault: &mut Mounted) -> Result<ExportSnapshot, fub_abi::PluginError> {
    vault.with_host(PUBLISH, |host| collect_export(host, "blog", 1))
}

fn page<'a>(export: &'a ExportSnapshot, path: &str) -> &'a str {
    &export
        .pages
        .iter()
        .find(|page| page.path == path)
        .unwrap_or_else(|| panic!("nessuna pagina `{path}`"))
        .html
}

#[test]
fn a_short_wikilink_reaches_the_note_in_its_folder() {
    let mut vault = vault(&[
        (
            "prima.md",
            "---\npublish: true\n---\n# Prima\n[[Nota]] e [vicina](dir/Nota)",
        ),
        ("dir/Nota.md", "---\npublish: true\n---\n# Nota\n"),
    ]);
    let export = export(&mut vault).expect("il nome breve si risolve");
    let prima = page(&export, "prima.html");
    assert_eq!(
        prima.matches("href=\"/s/blog/dir/nota.html\"").count(),
        2,
        "{prima}"
    );
}

#[test]
fn a_note_in_another_extension_is_a_page_under_its_stem() {
    let mut vault = vault(&[
        (
            "diario.markdown",
            "---\npublish: true\n---\n# Diario\nVedi [[indice]].",
        ),
        ("indice.md", "---\npublish: true\n---\n# Indice\n[[diario]]"),
    ]);
    let export = export(&mut vault).expect("`.markdown` è Markdown");
    assert!(page(&export, "diario.html").contains("href=\"/s/blog/indice.html\""));
    assert!(page(&export, "indice.html").contains("href=\"/s/blog/diario.html\""));
}

#[test]
fn two_notes_with_one_route_are_refused_by_name() {
    let mut vault = vault(&[
        ("nota.md", "---\npublish: true\n---\n# Una\n"),
        ("nota.markdown", "---\npublish: true\n---\n# Due\n"),
    ]);
    let refused = export(&mut vault).expect_err("una pagina non ne copre due");
    assert!(refused.to_string().contains("nota.html"), "{refused}");
}

#[test]
fn a_canvas_asset_is_read_by_its_format_and_narrowed() {
    let board = r#"{"nodes":[{"id":"a","type":"text","text":"Idea","x":0,"y":0,"width":10,"height":10}],"edges":[]}"#;
    let mut vault = vault(&[
        (
            "prima.md",
            "---\npublish: true\npublish_assets: [board.canvas]\n---\n# Prima\n",
        ),
        ("board.canvas", board),
    ]);
    let published = export(&mut vault).expect("una tela di sole card testuali si pubblica");
    assert!(page(&published, "board.canvas.html").contains("<td>Idea</td>"));

    // Una card che nomina un file porta un riferimento che la proiezione
    // perderebbe: si rifiuta invece di pubblicare metà tela.
    let file = r#"{"nodes":[{"id":"a","type":"file","file":"segreto.md","x":0,"y":0,"width":10,"height":10}]}"#;
    vault.write("board.canvas", file);
    vault.reindex().unwrap();
    assert!(export(&mut vault).is_err());
}
