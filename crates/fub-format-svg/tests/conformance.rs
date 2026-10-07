//! Il provider contro il contratto dei formati
//! (`fub_sdk::testing::conformance`): sui disegni di FubDraw, sugli SVG di
//! altri programmi e su sorgenti costruite per far male.

use fub_abi::format::{DocumentSource, ParseContext};
use fub_abi::model::DocumentModel;
use fub_abi::FormatProvider;
use fub_format_svg::SvgProvider;
use fub_sdk::testing::conformance;

/// Gli SVG veri del lettore delle scene, scritti da altri programmi.
const CORPUS: [(&str, &str); 6] = [
    ("icon", include_str!("../../../apps/clipper/icons/icon.svg")),
    (
        "mermaid-flowchart",
        include_str!("../../fub-scene/tests/corpus/mermaid-flowchart.svg"),
    ),
    (
        "mermaid-sequence",
        include_str!("../../fub-scene/tests/corpus/mermaid-sequence.svg"),
    ),
    (
        "chromium",
        include_str!("../../fub-scene/tests/corpus/chromium.svg"),
    ),
    (
        "inkscape",
        include_str!("../../fub-scene/tests/corpus/inkscape.svg"),
    ),
    (
        "illustrator",
        include_str!("../../fub-scene/tests/corpus/illustrator.svg"),
    ),
];

/// Le fixture che `fub-scene` genera per la superficie: un disegno FubDraw
/// canonico, uno estraneo, uno con BOM e CRLF, uno con `DOCTYPE` e uno con
/// tavole buone e sbagliate.
const MIRROR: [(&str, &str); 5] = [
    (
        "sparse",
        include_str!("../../../apps/client/src/__fixtures__/scene/sparse.svg"),
    ),
    (
        "foreign",
        include_str!("../../../apps/client/src/__fixtures__/scene/foreign.svg"),
    ),
    (
        "crlf-bom",
        include_str!("../../../apps/client/src/__fixtures__/scene/crlf-bom.svg"),
    ),
    (
        "doctype",
        include_str!("../../../apps/client/src/__fixtures__/scene/doctype.svg"),
    ),
    (
        "boards",
        include_str!("../../../apps/client/src/__fixtures__/scene/boards.svg"),
    ),
];

/// Le fixture del modello di questo crate.
const FIXTURES: [(&str, &str); 3] = [
    ("drawing", include_str!("fixtures/drawing.svg")),
    (
        "foreign-crlf-bom",
        include_str!("fixtures/foreign-crlf-bom.svg"),
    ),
    ("boards", include_str!("fixtures/boards.svg")),
];

fn parse(id: &str, source: &str) -> DocumentModel {
    SvgProvider
        .parse(
            &DocumentSource::Text(source.to_owned()),
            &ParseContext::obsidian(id),
        )
        .unwrap_or_else(|error| panic!("{id}: {error}"))
}

#[test]
fn the_provider_respects_the_format_contract() {
    conformance::a_format_respects_the_contract(&SvgProvider);
}

#[test]
fn every_model_tells_the_truth_about_its_source() {
    let new = SvgProvider
        .serialize(&DocumentModel::empty(fub_abi::model::DocId::new(
            "nuovo.svg",
        )))
        .unwrap();
    let all = CORPUS
        .iter()
        .chain(&MIRROR)
        .chain(&FIXTURES)
        .copied()
        .chain([("nuovo", new.as_str())]);
    let mut checked = 0;
    for (name, source) in all {
        let ctx = ParseContext::obsidian(format!("disegni/{name}.svg"));
        assert!(
            conformance::a_model_tells_the_truth_about_the_source(&SvgProvider, source, &ctx),
            "{name}: il provider ha rifiutato una scena"
        );
        checked += 1;
    }
    assert_eq!(checked, CORPUS.len() + MIRROR.len() + FIXTURES.len() + 1);
}

/// Il corpus non è vuoto di ciò che il modello porta: senza titoli, testi e
/// collegamenti la prova qui sopra passerebbe senza aver provato niente.
#[test]
fn the_corpus_carries_titles_texts_and_links() {
    let models: Vec<DocumentModel> = CORPUS
        .iter()
        .chain(&MIRROR)
        .chain(&FIXTURES)
        .map(|(name, source)| parse(name, source))
        .collect();
    assert!(models.iter().any(|m| !m.outline.is_empty()));
    assert!(models.iter().filter(|m| !m.text.is_empty()).count() >= 6);
    assert!(models.iter().any(|m| m.links.iter().any(|l| !l.embed)));
    assert!(models.iter().any(|m| m.links.iter().any(|l| l.embed)));
}

/// Ogni prefisso di ogni sorgente: quasi tutti malformati, e il provider li
/// rifiuta. Quelli che legge non devono avere uno span che manda in panico.
#[test]
fn no_prefix_of_a_source_panics_its_user() {
    let mut read = 0;
    for (name, source) in CORPUS.iter().chain(&MIRROR).chain(&FIXTURES) {
        let ctx = ParseContext::obsidian(format!("{name}.svg"));
        let step = (source.len() / 400).max(1);
        let cuts = (0..source.len()).step_by(step).chain([source.len()]);
        for at in cuts.filter(|&at| source.is_char_boundary(at)) {
            read += usize::from(conformance::no_span_panics_its_user(
                &SvgProvider,
                &source[..at],
                &ctx,
            ));
        }
    }
    // L'ultimo prefisso è la sorgente intera, che si legge sempre.
    assert!(read >= CORPUS.len() + MIRROR.len() + FIXTURES.len());
}

/// Un file costruito apposta, con migliaia di collegamenti uno dentro l'altro:
/// si legge senza esaurire lo stack, nessun collegamento si perde e gli span
/// restano veri.
#[test]
fn deeply_nested_links_neither_overflow_nor_get_lost() {
    let depth = 5_000;
    let mut source = String::from(r#"<svg xmlns="http://www.w3.org/2000/svg">"#);
    for i in 0..depth {
        source.push_str(&format!(r#"<a href="n{i}.md">"#));
    }
    source.push_str("<text>fondo</text>");
    source.push_str(&"</a>".repeat(depth));
    source.push_str("</svg>");
    let ctx = ParseContext::obsidian("profondo.svg");
    assert!(conformance::no_span_panics_its_user(
        &SvgProvider,
        &source,
        &ctx
    ));
    let model = parse("profondo.svg", &source);
    assert_eq!(model.links.len(), depth);
    conformance::flat_tables_are_the_tree_projection(&model);
}
