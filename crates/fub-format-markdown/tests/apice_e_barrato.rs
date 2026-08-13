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
        .expect("il caso è markdown, e il markdown parsa")
}

fn serialize(model: &DocumentModel) -> String {
    MarkdownProvider::new()
        .serialize(model)
        .expect("il modello si serializza")
}

fn inlines(doc: &DocumentModel) -> &[Inline] {
    match &doc.body[0] {
        Block::Paragraph { inlines, .. } => inlines,
        _ => panic!("atteso un paragrafo come primo blocco"),
    }
}

/// **Un input con entrambi i delimitatori produce due rappresentazioni
/// distinte.** `~~barrato~~` e `^apice^` nello stesso paragrafo arrivano
/// ognuno nella sua variante, col suo testo e nel suo ordine — e nessuno dei
/// due è enfasi, forza o `Custom`.
#[test]
fn i_due_delimitatori_restano_due_rappresentazioni() {
    let doc = parse("~~barrato~~ e testo ^apice^ qui\n");
    assert_eq!(
        inlines(&doc),
        &[
            Inline::Strikethrough(vec![Inline::Text("barrato".into())]),
            Inline::Text(" e testo ".into()),
            Inline::Superscript(vec![Inline::Text("apice".into())]),
            Inline::Text(" qui".into()),
        ],
        "il barrato e l'apice devono restare due varianti, in ordine"
    );
    assert!(
        !inlines(&doc).iter().any(|i| matches!(
            i,
            Inline::Emph(_) | Inline::Strong(_) | Inline::Custom { .. }
        )),
        "nessuno dei due può collassare in enfasi, forza o Custom"
    );
}

/// **Il serializer riscrive la sintassi di ciascuno.** Il barrato torna
/// `~~…~~`, l'apice torna `^…^` — e il giro riparte da lì identico: la forma
/// del modello non cambia fra round 1 e round 2.
#[test]
fn la_serializzazione_usa_il_delimitatore_di_ciascuno() {
    let sorgente = "~~barrato~~ e testo ^apice^ qui\n";
    let doc = parse(sorgente);
    let riscritto = serialize(&doc);
    assert_eq!(riscritto, sorgente, "la riscrittura cambia il documento");
    assert_eq!(parse(&riscritto), doc, "il giro non è stabile");
}

/// **La resa dà a ciascuno il suo elemento.** `<del>` per il barrato e
/// `<sup>` per l'apice — due elementi, non uno stile unico.
#[test]
fn la_resa_usa_l_elemento_di_ciascuno() {
    let doc = parse("~~barrato~~ e testo ^apice^ qui\n");
    let html = MarkdownProvider::new()
        .render_html(&doc, &fub_abi::format::RenderOptions::default())
        .expect("il modello si rende");
    assert!(html.contains("<del>barrato</del>"), "html: {html}");
    assert!(html.contains("<sup>apice</sup>"), "html: {html}");
}
