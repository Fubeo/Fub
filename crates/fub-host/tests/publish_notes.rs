//! Callout e note a piè di pagina si pubblicano.
//!
//! Il provider Markdown li legge come `Custom` (`callout`,
//! `footnote-definition`, `footnote-reference`), e il proiettore rifiutava
//! ogni `Custom` che non conosceva: una sola nota con un `> [!note]` o un
//! `[^1]` faceva fallire l'export dell'intero sito, con un errore che non
//! diceva né quale nota né quale costrutto. Adesso i due hanno una proiezione
//! statica, fatta soltanto di tag che il servizio di pubblicazione accetta
//! senza isolamento; ciò che resta senza proiezione ferma ancora l'export, ma
//! l'errore nomina la nota e il costrutto.

use fub_format_markdown::MarkdownProvider;
use fub_host::publish::site::{collect_export, ExportSnapshot};
use fub_testkit::Bench;

const PUBLISH: &str = "fub.publish";

fn export(text: &str) -> Result<ExportSnapshot, fub_abi::PluginError> {
    let mut vault = Bench::new()
        .with_format(Box::new(MarkdownProvider::new()))
        .with_plugin(PUBLISH)
        .with_file("note/pagina.md", text)
        .mounts();
    vault.with_host(PUBLISH, |host| collect_export(host, "blog", 1))
}

fn page(text: &str) -> String {
    let export = export(text).expect("la nota si pubblica");
    export
        .pages
        .into_iter()
        .find(|page| page.path == "note/pagina.html")
        .expect("la nota è una pagina")
        .html
}

#[test]
fn a_callout_publishes_as_a_quote_with_its_title() {
    let html = page(
        "---\npublish: true\n---\n> [!note] Il <titolo>\n> corpo **forte**\n\n> [!tip]\n> senza titolo\n",
    );
    assert!(
        html.contains(
            "<blockquote class=\"callout\" data-callout=\"note\">\
             <p class=\"callout-title\"><strong>Il &lt;titolo&gt;</strong></p>\
             <p>corpo <strong>forte</strong></p>\n</blockquote>"
        ),
        "{html}"
    );
    assert!(
        html.contains(
            "<blockquote class=\"callout\" data-callout=\"tip\"><p>senza titolo</p>\n</blockquote>"
        ),
        "{html}"
    );
}

#[test]
fn a_footnote_links_its_references_to_its_definition() {
    let html = page(
        "---\npublish: true\n---\n\
         uno[^Nota] e due[^nota], in linea ^[a <b>] e orfano [^manca]\n\n\
         [^nota]: la **nota**\n    \n    secondo paragrafo\n\n\
         [^mai]: nessuno la richiama\n",
    );
    // I due richiami portano alla stessa definizione: comrak li ha già
    // abbinati, e la pagina li lega con un'ancora che resta sua.
    assert_eq!(
        html.matches("<sup class=\"footnote-ref\"><a href=\"#fn-1\">nota</a></sup>")
            .count(),
        2,
        "{html}"
    );
    assert!(
        html.contains("<sup class=\"footnote-inline\">a &lt;b&gt;</sup>"),
        "{html}"
    );
    // Un richiamo che non trova la sua definizione si legge com'è scritto.
    assert!(html.contains("orfano [^manca]</p>"), "{html}");
    assert!(
        html.contains(
            "<div class=\"block-footnote-definition\" id=\"fn-1\">\
             <p><sup class=\"footnote-label\">nota</sup> la <strong>nota</strong></p>\n\
             <p>secondo paragrafo</p>\n</div>"
        ),
        "{html}"
    );
    // Una definizione che nessun richiamo usa sta nel file, non nella pagina.
    assert!(!html.contains("nessuno la richiama"), "{html}");
}

#[test]
fn a_construct_without_projection_names_itself_and_its_note() {
    let error = export("---\npublish: true\n---\nprima\n\n<div>grezzo</div>\n")
        .expect_err("l'HTML grezzo non ha una proiezione statica");
    let fub_abi::PluginError::BadArgs(message) = &error else {
        panic!("{error:?}");
    };
    let message = message.to_string();
    assert!(message.contains("`note/pagina.md`"), "{message}");
    assert!(message.contains("`html` block"), "{message}");
}

/// La nota passa dalle regole di sintassi che l'app monta con `fub.blocks`:
/// un recinto `math` o `mermaid` arriva al proiettore come `Custom`, non come
/// codice, e l'evidenziato e il commento come inline.
#[cfg(feature = "blocks")]
fn page_with_blocks(text: &str) -> String {
    use fub_features::{CommentRule, DiagramRule, HighlightRule, MathRule, BLOCKS_ID};
    let mut vault = Bench::new()
        .with_format(Box::new(MarkdownProvider::new()))
        .with_plugins([PUBLISH, BLOCKS_ID])
        .with_file("note/pagina.md", text)
        .mounts();
    let rules: [Box<dyn fub_abi::custom::SyntaxRule>; 4] = [
        Box::new(DiagramRule),
        Box::new(MathRule),
        Box::new(HighlightRule),
        Box::new(CommentRule),
    ];
    for rule in rules {
        vault
            .register_syntax_rule(BLOCKS_ID, rule)
            .expect("la regola si innesta");
    }
    let export = vault
        .with_host(PUBLISH, |host| collect_export(host, "blog", 1))
        .expect("la nota si pubblica");
    export
        .pages
        .into_iter()
        .find(|page| page.path == "note/pagina.html")
        .expect("la nota è una pagina")
        .html
}

#[cfg(feature = "blocks")]
#[test]
fn a_note_with_definitions_formulas_and_diagrams_publishes() {
    let html = page_with_blocks(
        "---\npublish: true\n---\n\
         Un [link][x] ==evidenziato== %%nascosto%%\n\n\
         [x]: https://example.test \"Titolo\"\n\n\
         ```math\na < b\n```\n\n\
         ```mermaid\ngraph TD; A-->B\n```\n",
    );
    // La definizione è già nel link che la usa; nella pagina non resta.
    assert!(html.contains("<a href=\"https://example.test\""), "{html}");
    assert!(!html.contains("[x]:"), "{html}");
    assert!(
        html.contains("<span class=\"inline-highlight\">evidenziato</span>"),
        "{html}"
    );
    assert!(!html.contains("nascosto"), "{html}");
    assert!(
        html.contains("<div class=\"math-block\">$$\na &lt; b\n$$</div>\n"),
        "{html}"
    );
    assert!(
        html.contains(
            "<pre class=\"diagram\" data-engine=\"mermaid\"><code>graph TD; A--&gt;B\n</code></pre>\n"
        ),
        "{html}"
    );
}
