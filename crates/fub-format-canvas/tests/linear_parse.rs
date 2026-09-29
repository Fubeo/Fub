//! **Una tela grande costa quanto è grande.**
//!
//! Il parse di una tela gira a ogni apertura e indicizzazione, la riscrittura a
//! ogni rinomina di una nota che la tela cita. Ognuno di questi casi scorreva
//! un elenco intero per ogni elemento, cioè era quadratico:
//!
//! - ogni link di una card cercava il proprio char nella mappa dell'intera
//!   card, all'apertura e di nuovo alla rinomina;
//! - ogni campo di un nodo si confrontava con tutti quelli già visti;
//! - ogni nodo e ogni arco cercava il proprio literale fra tutti.
//!
//! Con N = 30 000 ogni caso qui sotto sta sotto il secondo anche in debug;
//! prima il primo passava i due minuti. Al tetto (una card da un mega, un nodo
//! di sedici) erano decine di minuti.

use fub_abi::format::{DocumentSource, LinkRewrite, ParseContext};
use fub_abi::model::DocumentModel;
use fub_abi::FormatProvider;
use fub_format_canvas::CanvasProvider;

const N: usize = 30_000;

fn ctx() -> ParseContext {
    ParseContext::obsidian("tela.canvas")
}

fn parse(source: &str) -> DocumentModel {
    CanvasProvider::new()
        .parse(&DocumentSource::Text(source.to_string()), &ctx())
        .expect("la tela si legge")
}

fn one_text_card(text: &str) -> String {
    format!(
        r#"{{"nodes":[{{"id":"n","type":"text","text":"{text}","x":0,"y":0,"width":1,"height":1}}],"edges":[]}}"#
    )
}

#[test]
fn many_links_in_one_card_are_found_and_renamed_each_in_place() {
    // L'escape davanti a ogni link (sei byte grezzi, due decodificati) sposta
    // le due coordinate: la mappa conta davvero.
    let source = one_text_card(&"\\u00e9 [[a]] ".repeat(N));
    let model = parse(&source);
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
    let edits = CanvasProvider::new()
        .rewrite_links(&DocumentSource::Text(source.clone()), &ctx(), &rewrites)
        .expect("la riscrittura riesce")
        .expect("la tela riscrive da sé");
    let mut renamed = source.clone();
    for edit in edits.iter().rev() {
        renamed.replace_range(edit.span.start..edit.span.end, &edit.text);
    }
    assert_eq!(renamed, one_text_card(&"\\u00e9 [[b]] ".repeat(N)));
}

#[test]
fn a_node_with_many_unknown_fields_is_read_once() {
    let fields: String = (0..N).map(|i| format!(r#","x{i}":0"#)).collect();
    let source = format!(
        r#"{{"nodes":[{{"id":"n","type":"text","text":"[[a]]","x":0,"y":0,"width":1,"height":1{fields}}}],"edges":[]}}"#
    );
    assert_eq!(parse(&source).links.len(), 1);
}

#[test]
fn many_edge_labels_each_find_their_own_literal() {
    let edges: Vec<String> = (0..N)
        .map(|i| format!(r#"{{"id":"e{i}","fromNode":"n","toNode":"n","label":"\u00e9 #t{i}"}}"#))
        .collect();
    let source = format!(
        r#"{{"nodes":[{{"id":"n","type":"text","text":"x","x":0,"y":0,"width":1,"height":1}}],"edges":[{}]}}"#,
        edges.join(",")
    );
    let model = parse(&source);
    assert_eq!(model.tags.len(), N);
    let last = model.tags.last().unwrap();
    assert_eq!(
        &source[last.span.start..last.span.end],
        format!("#t{}", N - 1)
    );
}
