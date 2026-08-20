//! **Apice e barrato restano due costrutti distinti, dal parse alla resa.**
//!
//! Il difetto era in `convert_inlines`: i nodi comrak `Superscript` (`^…^`) e
//! `Strikethrough` (`~~…~~`) finivano nel catch-all, e nel modello ne restava
//! solo il testo — il costrutto spariva dal modello, e alla prima riscrittura
//! anche dal file («il barrato non arriva nel modello», «l'apice non arriva
//! nel modello»).
//!
//! Il modello adesso ha due varianti proprie, `Inline::Superscript` (l'apice,
//! estensione `superscript` di comrak) e `Inline::Strikethrough` (il barrato,
//! estensione `strikethrough`), e questo banco presidia il patto end-to-end:
//! un input che porta **entrambi i delimitatori** mantiene **due
//! rappresentazioni** distinte — non collassa in uno stile unico, in
//! `Custom` o nel testo piatto — e il serializer riscrive ciascuna con la sua
//! sintassi (`^…^` e `~~…~~`), così il giro riparte identico. Il render dà a
//! ciascuno il suo elemento (`<sup>` e `<del>`). Niente di qui gira: è il
//! banco mirato che il coordinatore eseguirà con la validazione.

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{Block, DocumentModel, Inline};
use fub_format_markdown::MarkdownProvider;

fn parse(src: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), &ParseContext::obsidian("nota.md"))
        .expect("the input is markdown, and markdown parses")
}

fn serialize(model: &DocumentModel) -> String {
    MarkdownProvider::new()
        .serialize(model)
        .expect("the model serializes")
}

fn inlines(doc: &DocumentModel) -> &[Inline] {
    match &doc.body[0] {
        Block::Paragraph { inlines, .. } => inlines,
        _ => panic!("expected a paragraph as the first block"),
    }
}

/// **Un input con entrambi i delimitatori produce due rappresentazioni
/// distinte.** `~~barrato~~` e `^apice^` nello stesso paragrafo arrivano
/// ognuno nella sua variante, col suo testo e nel suo ordine — e nessuno dei
/// due è enfasi, forza o `Custom`.
#[test]
fn both_delimiters_remain_distinct_representations() {
    let doc = parse("~~barrato~~ e testo ^apice^ qui\n");
    assert_eq!(
        inlines(&doc),
        &[
            Inline::Strikethrough(vec![Inline::Text("barrato".into())]),
            Inline::Text(" e testo ".into()),
            Inline::Superscript(vec![Inline::Text("apice".into())]),
            Inline::Text(" qui".into()),
        ],
        "strikethrough and superscript must remain two distinct variants, in order"
    );
    assert!(
        !inlines(&doc).iter().any(|the| matches!(
            the,
            Inline::Emph(_) | Inline::Strong(_) | Inline::Custom { .. }
        )),
        "neither can collapse into emphasis, strong, or Custom"
    );
}

/// **Il serializer riscrive la sintassi di ciascuno.** Il barrato torna
/// `~~…~~`, l'apice torna `^…^` — e il giro riparte da lì identico: la forma
/// del modello non cambia fra round 1 e round 2.
#[test]
fn serialization_uses_each_delimiters_own_syntax() {
    let source = "~~barrato~~ e testo ^apice^ qui\n";
    let doc = parse(source);
    let rewritten = serialize(&doc);
    assert_eq!(rewritten, source, "the rewrite changes the document");
    assert_eq!(parse(&rewritten), doc, "the pass is not stable");
}

/// **La resa dà a ciascuno il suo elemento.** `<del>` per il barrato e
/// `<sup>` per l'apice — due elementi, non uno stile unico.
#[test]
fn render_uses_each_constructs_own_element() {
    let doc = parse("~~barrato~~ e testo ^apice^ qui\n");
    let html = MarkdownProvider::new()
        .render_html(&doc, &fub_abi::format::RenderOptions::default())
        .expect("the model renders");
    assert!(html.contains("<del>barrato</del>"), "html: {html}");
    assert!(html.contains("<sup>apice</sup>"), "html: {html}");
}
