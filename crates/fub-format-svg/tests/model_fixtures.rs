//! Il modello delle fixture, serializzato: ciò che un disegno porta
//! all'indice, alla ricerca e al grafo, fissato byte per byte.
//!
//! Rigenera con `UPDATE_MIRROR=1 cargo test -p fub-format-svg --test
//! model_fixtures`. Senza la variabile il test confronta i file e fallisce
//! alla prima differenza.
//!
//! In `tests/fixtures/`, ogni `<nome>.svg` ha accanto `<nome>.model.json`: il
//! [`DocumentModel`] serializzato, con due spazi di rientro e un a capo finale.
//!
//! - `drawing`: un disegno FubDraw canonico, con titolo, descrizione, testi su
//!   più righe, un collegamento attorno a un testo, uno attorno a un'immagine
//!   del vault, uno attorno a una forma, un tratto di penna e un testo estraneo
//!   con un collegamento dentro;
//! - `foreign-crlf-bom`: un SVG di un altro programma con BOM e righe CRLF,
//!   valori fra apici singoli, un `xlink:href` accanto a `href` con lo stesso
//!   URL, testo fuori dal piano base di Unicode e collegamenti che non sono
//!   del vault;
//! - `boards`: un disegno FubDraw con quattro tavole e le loro carte: una col
//!   nome su più righe, una senza titolo, che si chiama col suo id, e una con
//!   il nome di una tavola prima.

use std::path::PathBuf;

use fub_abi::format::{DocumentSource, ParseContext};
use fub_abi::model::DocumentModel;
use fub_abi::FormatProvider;
use fub_format_svg::SvgProvider;

const REGENERATE: &str =
    "rigenera con UPDATE_MIRROR=1 cargo test -p fub-format-svg --test model_fixtures";

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn model_of(name: &str) -> (String, DocumentModel) {
    let source = std::fs::read_to_string(fixtures().join(format!("{name}.svg"))).unwrap();
    let model = SvgProvider
        .parse(
            &DocumentSource::Text(source.clone()),
            &ParseContext::obsidian(format!("disegni/{name}.svg")),
        )
        .unwrap();
    (source, model)
}

fn check(name: &str) {
    let (_, model) = model_of(name);
    let mut actual = serde_json::to_string_pretty(&model).unwrap();
    actual.push('\n');
    let path = fixtures().join(format!("{name}.model.json"));
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &actual).unwrap();
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{name}.model.json non si legge ({error}): {REGENERATE}"));
    if expected != actual {
        let at = expected
            .lines()
            .zip(actual.lines())
            .position(|(a, b)| a != b)
            .unwrap_or(expected.lines().count().min(actual.lines().count()));
        panic!(
            "{name}.model.json è diverso alla riga {}: atteso «{}», ottenuto «{}»; {REGENERATE}",
            at + 1,
            expected.lines().nth(at).unwrap_or(""),
            actual.lines().nth(at).unwrap_or(""),
        );
    }
    // Il file si rilegge come il modello che lo ha scritto.
    let back: DocumentModel = serde_json::from_str(&expected).unwrap();
    assert_eq!(back, model, "{name}: il JSON non torna lo stesso modello");
}

#[test]
fn the_drawing_model_is_the_fixture() {
    check("drawing");
}

#[test]
fn the_foreign_model_is_the_fixture() {
    check("foreign-crlf-bom");
}

#[test]
fn the_boards_model_is_the_fixture() {
    check("boards");
}

/// Le fixture dicono ciò che devono: senza questi controlli un modello
/// sbagliato rigenerato con `UPDATE_MIRROR` passerebbe.
#[test]
fn the_fixtures_say_what_they_claim() {
    let (source, model) = model_of("drawing");
    assert_eq!(model.outline[0].text, "Ciclo dell'acqua");
    assert!(model.text.contains("Dal mare alle nuvole & ritorno"));
    assert!(model.text.contains("Evaporazione e condensa"));
    assert!(model.text.contains("Vedi la pioggia e il mare"));
    let links: Vec<_> = model
        .links
        .iter()
        .map(|link| (format!("{:?}", link.target), link.embed))
        .collect();
    assert_eq!(
        links,
        [
            (r#"Path("../note/Nuvole.md#Cumuli")"#.to_owned(), false),
            (r#"Path("/Glossario.md")"#.to_owned(), false),
            (r#"Path("foto/mare.png")"#.to_owned(), true),
            (r#"Path("Sale & pepe.md")"#.to_owned(), false),
            (r#"Path("Pioggia.md")"#.to_owned(), false),
        ]
    );
    for link in &model.links {
        let element = &source[link.span.start..link.span.end];
        assert!(
            element.starts_with("<a ") || element.starts_with("<image "),
            "{element}"
        );
    }

    let (source, model) = model_of("foreign-crlf-bom");
    assert!(source.starts_with('\u{feff}') && source.contains("\r\n"));
    assert_eq!(model.outline[0].text, "Mappa del quartiere");
    assert!(model.text.contains("Parco giochi 𝄞"));
    assert!(model.text.contains("Scrivi al comune"));
    let paths: Vec<_> = model
        .links
        .iter()
        .map(|link| format!("{:?}", link.target))
        .collect();
    assert_eq!(
        paths,
        [r#"Path("quartiere/parco.md")"#, r#"Path("foto/mappa.png")"#]
    );
    assert_eq!(model.body[0].span().start, 3);

    let (source, model) = model_of("boards");
    let outline: Vec<_> = model
        .outline
        .iter()
        .map(|heading| (heading.level, heading.text.as_str()))
        .collect();
    assert_eq!(
        outline,
        [
            (1, "Quaderno di viaggio"),
            (2, "Copertina"),
            (2, "Mappa del porto"),
            (2, "b00000003"),
            (2, "Copertina"),
        ]
    );
    for heading in &model.outline[1..] {
        let element = &source[heading.span.start..heading.span.end];
        assert!(element.starts_with("<view "), "{element}");
    }
    assert_eq!(
        model.text,
        "Quaderno di viaggio\nQuattro tavole\nCopertina\nMappa del porto\nb00000003\nCopertina\nPartenza\nIl porto"
    );
}
