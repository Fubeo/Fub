//! **Un file lungo costa quanto è lungo.**
//!
//! Il parse di una nota gira a ogni apertura, a ogni indicizzazione e a ogni
//! modifica, e le note arrivano anche da chi le scrive apposta. Ognuno di questi
//! casi era quadratico o peggio in un punto di Fub, non di comrak:
//!
//! - una riga lunga: ogni nodo chiedeva la propria colonna ricontando la riga
//!   da capo (ventimila link su una riga, quindici secondi);
//! - molte reference definition: ciascuna cercava il proprio contenitore e si
//!   inseriva con `Vec::insert`;
//! - molti richiami `[^n]` senza definizione: una ricorsione per richiamo, e
//!   ventimila sfondavano lo stack del thread, cioè il processo;
//! - molte note citate: ogni riga chiedeva a ogni blocco se la copriva;
//! - una rinomina: ogni link da riscrivere si cercava fra tutti i link della
//!   nota.
//!
//! Con le correzioni ogni caso qui sotto sta sotto il secondo anche in debug.
//! Senza, il terzo abortisce e gli altri durano minuti.

use fub_abi::format::{DocumentSource, FormatProvider, LinkRewrite, ParseContext};
use fub_abi::model::{custom_kind, Block, DocumentModel, Inline};
use fub_format_markdown::MarkdownProvider;

const N: usize = 30_000;

fn parse(src: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), &ParseContext::obsidian("nota.md"))
        .expect("markdown parses")
}

fn footnote_references(model: &DocumentModel) -> usize {
    model
        .body
        .iter()
        .filter_map(|block| match block {
            Block::Paragraph { inlines, .. } => Some(inlines),
            _ => None,
        })
        .flatten()
        .filter(|inline| {
            matches!(inline, Inline::Custom { custom_kind: kind, .. } if kind == custom_kind::FOOTNOTE_REFERENCE)
        })
        .count()
}

#[test]
fn many_links_on_one_line_keep_their_spans() {
    let src: String = (0..N).map(|i| format!("[l{i}](u{i}) ")).collect();
    let model = parse(&src);
    assert_eq!(model.links.len(), N);
    let last = model.links.last().unwrap();
    let expected = format!("[l{}](u{})", N - 1, N - 1);
    assert_eq!(&src[last.span.start..last.span.end], expected);
}

#[test]
fn many_reference_definitions_stay_in_source_order() {
    let src: String = (0..N).map(|i| format!("[l{i}]: /u{i}\n")).collect();
    let model = parse(&src);
    let labels: Vec<&str> = model
        .body
        .iter()
        .filter_map(|block| match block {
            Block::ReferenceDefinition { label, .. } => Some(label.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(labels.len(), N);
    assert_eq!(labels[0], "l0");
    assert_eq!(labels[N - 1], format!("l{}", N - 1));
}

#[test]
fn many_dangling_footnote_references_do_not_exhaust_the_stack() {
    let src: String = (0..N).map(|i| format!("[^{i}] ")).collect();
    assert_eq!(footnote_references(&parse(&src)), N);
}

#[test]
fn many_cited_footnotes_are_read_once_each() {
    let src = (0..N).map(|i| format!("[^{i}] ")).collect::<String>()
        + &(0..N)
            .map(|i| format!("\n[^{i}]: nota"))
            .collect::<String>();
    let model = parse(&src);
    assert_eq!(footnote_references(&model), N);
    let definitions = model
        .body
        .iter()
        .filter(|block| {
            matches!(block, Block::Custom { custom_kind: kind, .. } if kind == custom_kind::FOOTNOTE_DEFINITION)
        })
        .count();
    assert_eq!(definitions, N);
}

#[test]
fn renaming_many_links_checks_each_one_once() {
    let src = "[[a]] [x](a.md) ".repeat(N / 2);
    let model = parse(&src);
    assert_eq!(model.links.len(), N);
    let rewrites: Vec<LinkRewrite> = model
        .links
        .iter()
        .map(|link| LinkRewrite {
            span: link.span,
            target: link.target.clone(),
            replacement: "b".into(),
        })
        .collect();
    let edits = MarkdownProvider::new()
        .rewrite_links(
            &DocumentSource::Text(src.clone()),
            &ParseContext::obsidian("nota.md"),
            &rewrites,
        )
        .expect("the rename rewrites every link")
        .expect("markdown rewrites its own links");
    assert_eq!(edits.len(), N);
}
