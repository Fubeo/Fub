//! Una nota con formule fra dollari si pubblica.
//!
//! Il provider Markdown legge `$…$` e `$$…$$` come `Inline::Custom` `math`, e
//! il proiettore rifiuta ciò che non ha un significato statico verificato. La
//! formula ce l'ha: il sito statico non ha un motore TeX, e la formula si
//! pubblica come il suo sorgente fra i suoi dollari — il testo che la nota
//! porta, con le barre di `\{` intatte. Se il proiettore tornasse a
//! rifiutarla, una sola formula farebbe fallire l'export dell'intero sito.

use fub_format_markdown::MarkdownProvider;
use fub_host::publish::site::{collect_export, ExportSnapshot};
use fub_testkit::Bench;

const PUBLISH: &str = "fub.publish";

fn export(text: &str) -> Result<ExportSnapshot, fub_abi::PluginError> {
    let mut vault = Bench::new()
        .with_format(Box::new(MarkdownProvider::new()))
        .with_plugin(PUBLISH)
        .with_file("formule.md", text)
        .mounts();
    vault.with_host(PUBLISH, |host| collect_export(host, "blog", 1))
}

#[test]
fn a_note_with_formulas_publishes_their_source() {
    let export =
        export("---\npublish: true\n---\nvale $\\{x \\mid x<0\\}$ e $a*b$\n\n$$\n\\sum_i i\n$$\n")
            .expect("a formula has a static projection");
    let html = &export
        .pages
        .iter()
        .find(|page| page.path == "formule.html")
        .expect("the note is a page")
        .html;
    assert!(
        html.contains("<p>vale $\\{x \\mid x&lt;0\\}$ e $a*b$</p>"),
        "{html}"
    );
    assert!(html.contains("<p>$$\n\\sum_i i\n$$</p>"), "{html}");
}
