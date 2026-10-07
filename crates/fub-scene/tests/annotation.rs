//! Le annotazioni di un PDF: documento annotato, impronta, numero di pagine,
//! gruppi di pagina e note, con gli span che puntano i byte giusti.

mod common;

use common::{check_lossless, text, utf16_prefix};
use fub_scene::{read, read_annotations, Annotations, ReadError, Status, MAX_EDIT_BYTES};

const FUB: &str = "https://fubeo.github.io/ns/scene/1";

/// La radice di un `.fubann` di prova con gli attributi `root` e `body`
/// dentro.
fn fubann(root: &str, body: &str) -> String {
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="{FUB}" fub:version="1" {root}>{body}</svg>"#
    )
}

/// Legge `source`, che deve essere un `.fubann`, e verifica che la scena sia
/// quella di [`read`] e che ogni span cada su confini di carattere con
/// l'offset UTF-16 giusto.
fn load(source: &str) -> Annotations {
    let annotations = read_annotations(source).unwrap_or_else(|e| panic!("{e}\n{source}"));
    assert_eq!(annotations.scene, read(source).unwrap());
    if !annotations.scene.truncated {
        check_lossless(source, &annotations.scene);
    }
    let units = utf16_prefix(source);
    let spans = annotations
        .annotates
        .iter()
        .map(|a| a.value)
        .chain(annotations.pages.iter().map(|p| p.span))
        .chain(annotations.notes.iter().flat_map(|n| {
            [Some(n.span), n.content, Some(n.value)]
                .into_iter()
                .flatten()
        }));
    for span in spans {
        assert_eq!(
            span.utf16,
            [units[span.bytes[0]], units[span.bytes[1]]],
            "{span:?}"
        );
    }
    annotations
}

const HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[test]
fn the_root_names_the_pdf_its_digest_and_its_pages() {
    let source = fubann(
        &format!(r#"fub:annotates="Bando di gara.pdf" fub:digest="sha256:{HEX}" fub:pages="12""#),
        "<title>Revisione</title>",
    );
    let annotations = load(&source);
    let annotated = annotations.annotates.as_ref().unwrap();
    assert_eq!(annotated.path, "Bando di gara.pdf");
    assert_eq!(text(&source, &annotated.value), "Bando di gara.pdf");
    assert_eq!(
        annotations.digest.as_deref(),
        Some(format!("sha256:{HEX}").as_str())
    );
    assert_eq!(annotations.page_count, Some(12));
    assert!(annotations.scene.editable());
    assert_eq!(
        annotations.scene.index.title.as_ref().unwrap().text,
        "Revisione"
    );
}

#[test]
fn the_annotated_pdf_follows_the_rule_of_a_link() {
    let annotates = |value: &str| {
        let source = fubann(&format!(r#"fub:annotates="{value}""#), "");
        load(&source).annotates.map(|a| a.path)
    };
    // Il testo dell'URL, con la codifica percentuale com'è scritta e gli spazi
    // ai bordi tolti: chi risolve il percorso la decodifica.
    assert_eq!(
        annotates("Bando%20di%20gara.pdf").as_deref(),
        Some("Bando%20di%20gara.pdf")
    );
    assert_eq!(
        annotates(" atti/Bando.pdf ").as_deref(),
        Some("atti/Bando.pdf")
    );
    assert_eq!(
        annotates("/atti/Bando.pdf").as_deref(),
        Some("/atti/Bando.pdf")
    );
    assert_eq!(annotates("a&amp;b.pdf").as_deref(), Some("a&b.pdf"));
    // Niente che porti a un documento del vault.
    for elsewhere in [
        "",
        "  ",
        "#page=2",
        "https://example.org/a.pdf",
        "//host/a.pdf",
        "file:///a.pdf",
    ] {
        assert_eq!(annotates(elsewhere), None, "{elsewhere:?}");
    }
}

#[test]
fn the_attributes_are_found_by_namespace() {
    let source = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:f="{FUB}" f:annotates="a.pdf" f:pages="2"/>"#
    );
    let annotations = load(&source);
    assert_eq!(annotations.annotates.unwrap().path, "a.pdf");
    assert_eq!(annotations.page_count, Some(2));
    // Senza `fub:version` il documento è estraneo, ma le annotazioni si
    // leggono lo stesso: decide chi lo apre.
    assert_eq!(annotations.scene.status, Status::Foreign);

    // Gli stessi nomi senza namespace, o in un altro, non sono del formato.
    let source = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://example.org/fub" annotates="a.pdf" fub:pages="2" fub:annotates="b.pdf"/>"#;
    let annotations = load(source);
    assert_eq!(annotations.annotates, None);
    assert_eq!(annotations.page_count, None);
}

#[test]
fn values_outside_the_grammar_are_absent() {
    let source = fubann(
        r#"fub:annotates="a.pdf" fub:digest="sha256:abc" fub:pages="0""#,
        "",
    );
    let annotations = load(&source);
    assert_eq!(annotations.digest, None);
    assert_eq!(annotations.page_count, None);
    // Il documento resta modificabile: i valori li controlla chi apre il PDF.
    assert!(annotations.scene.editable());
}

#[test]
fn a_page_is_a_root_group_with_a_page_number() {
    let source = fubann(
        r#"fub:annotates="a.pdf" fub:pages="9""#,
        concat!(
            r#"<g fub:page="1" fub:page-size="595.28 841.89"><rect width="10" height="10"/></g>"#,
            r#"<g fub:page="3" fub:page-size="842 595"/>"#,
            // Fuori grammatica: un gruppo qualunque.
            r#"<g fub:page="0"/><g fub:page="2a"/><g fub:page=" 4"/>"#,
            // Solo i figli della radice, e solo i `g` di SVG.
            r#"<g><g fub:page="5"/></g><rect fub:page="6"/>"#,
            r#"<x:g xmlns:x="https://example.org" fub:page="7"/>"#,
            // Una dimensione fuori grammatica non toglie la pagina.
            r#"<g fub:page="8" fub:page-size="595"/>"#,
            // L'ordine e i doppioni sono quelli del file.
            r#"<g fub:page="2"/><g fub:page="2"/>"#,
        ),
    );
    let annotations = load(&source);
    let pages: Vec<_> = annotations
        .pages
        .iter()
        .map(|page| (page.number, page.size))
        .collect();
    assert_eq!(
        pages,
        [
            (1, Some([595.28, 841.89])),
            (3, Some([842.0, 595.0])),
            (8, None),
            (2, None),
            (2, None),
        ]
    );
    let first = &annotations.pages[0];
    assert!(text(&source, &first.span).starts_with(r#"<g fub:page="1""#));
    assert!(text(&source, &first.span).ends_with("</g>"));
    assert_eq!(
        text(&source, &annotations.pages[1].span),
        r#"<g fub:page="3" fub:page-size="842 595"/>"#
    );
}

#[test]
fn a_note_is_a_text_with_a_body() {
    let source = fubann(
        r#"fub:annotates="a.pdf""#,
        concat!(
            r#"<g fub:page="1">"#,
            r#"<text x="10" y="20" fub:note="Rivedere l'importo.&#10;Chiedere a Anna."><tspan x="10" dy="0">Importo</tspan><tspan x="10" dy="12">sbagliato</tspan></text>"#,
            r#"<text fub:note="Solo il corpo"/>"#,
            r#"<text>Un testo e basta</text>"#,
            r#"</g>"#,
        ),
    );
    let annotations = load(&source);
    let [first, second] = annotations.notes.as_slice() else {
        panic!("{:?}", annotations.notes);
    };
    assert_eq!(first.text, "Importo sbagliato");
    assert_eq!(first.body, "Rivedere l'importo.\nChiedere a Anna.");
    assert!(text(&source, &first.span).starts_with("<text x=\"10\""));
    assert_eq!(
        text(&source, first.content.as_ref().unwrap()),
        r#"<tspan x="10" dy="0">Importo</tspan><tspan x="10" dy="12">sbagliato</tspan>"#
    );
    assert_eq!(
        text(&source, &first.value),
        "Rivedere l'importo.&#10;Chiedere a Anna."
    );
    // Un `text` autochiuso: la nota non mostra niente e non ha contenuto.
    assert_eq!(second.text, "");
    assert_eq!(second.body, "Solo il corpo");
    assert_eq!(second.content, None);
    // L'indice legge i testi come sempre, note comprese.
    let texts: Vec<_> = annotations
        .scene
        .index
        .texts
        .iter()
        .map(|t| t.text.as_str())
        .collect();
    assert_eq!(texts, ["Importo sbagliato", "Un testo e basta"]);
}

#[test]
fn a_body_keeps_its_lines_and_nothing_else_changes() {
    let note = |value: &str| {
        let source = fubann("", &format!(r#"<text fub:note="{value}">x</text>"#));
        load(&source).notes.into_iter().next().map(|n| n.body)
    };
    // I terminatori scritti come riferimenti diventano `\n`; quelli letterali
    // il parser XML li ha già fatti spazi.
    assert_eq!(note("a&#13;&#10;b&#13;c").as_deref(), Some("a\nb\nc"));
    assert_eq!(note("a\nb").as_deref(), Some("a b"));
    assert_eq!(note("  a  &#9;b ").as_deref(), Some("  a  \tb "));
    assert_eq!(note("&lt;&amp;&quot;").as_deref(), Some("<&\""));
    // Un corpo vuoto o di soli spazi non fa una nota.
    for blank in ["", "   ", "&#10;&#9;"] {
        assert_eq!(note(blank), None, "{blank:?}");
    }
}

#[test]
fn only_a_drawn_text_carries_a_note() {
    let source = fubann(
        "",
        concat!(
            r#"<text fub:note="esterno">a<text fub:note="annidato">b</text></text>"#,
            r#"<text>c<tspan fub:note="su un tspan">d</tspan></text>"#,
            r#"<rect fub:note="su un rettangolo"/>"#,
            r#"<a href="altro.md"><text fub:note="in un collegamento">e</text></a>"#,
            r#"<x:text xmlns:x="https://example.org" fub:note="in un altro namespace"/>"#,
        ),
    );
    let bodies: Vec<_> = load(&source)
        .notes
        .into_iter()
        .map(|note| note.body)
        .collect();
    assert_eq!(bodies, ["esterno", "in un collegamento"]);
}

#[test]
fn a_note_keeps_its_bytes_in_crlf_with_a_bom() {
    let source = format!(
        "\u{feff}{}",
        fubann(
            r#"fub:annotates="è.pdf""#,
            "\r\n  <g fub:page=\"2\">\r\n    <text fub:note=\"perché&#10;sì\">àè</text>\r\n  </g>\r\n",
        )
    );
    let annotations = load(&source);
    assert!(annotations.scene.bom);
    assert_eq!(
        text(&source, &annotations.annotates.unwrap().value),
        "è.pdf"
    );
    let note = &annotations.notes[0];
    assert_eq!(text(&source, &note.value), "perché&#10;sì");
    assert_eq!(note.body, "perché\nsì");
    assert_eq!(note.text, "àè");
}

#[test]
fn a_truncated_file_has_its_root_but_no_pages() {
    let filler = format!("<rect/><!--{}-->", "x".repeat(MAX_EDIT_BYTES));
    let source = fubann(
        &format!(r#"fub:annotates="a.pdf" fub:digest="sha256:{HEX}" fub:pages="3""#),
        &format!(r#"<title>Grande</title><g fub:page="1"><text fub:note="n">t</text></g>{filler}"#),
    );
    let annotations = load(&source);
    assert!(annotations.scene.truncated);
    assert_eq!(annotations.annotates.unwrap().path, "a.pdf");
    assert!(annotations.digest.is_some());
    assert_eq!(annotations.page_count, Some(3));
    assert!(annotations.pages.is_empty());
    assert!(annotations.notes.is_empty());
}

#[test]
fn what_is_not_a_scene_is_not_annotations_either() {
    for source in ["<svg", "<html xmlns=\"http://www.w3.org/1999/xhtml\"/>", ""] {
        assert_eq!(
            read_annotations(source).map(|_| ()),
            read(source).map(|_| ()),
            "{source:?}"
        );
        assert!(read_annotations(source).is_err());
    }
    assert!(matches!(
        read_annotations("<html/>"),
        Err(ReadError::NotSvg { offset: 0 })
    ));
}
