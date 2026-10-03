//! Il modello delle fixture, serializzato: ciò che un disegno porta
//! all'indice, alla ricerca e al grafo, fissato byte per byte.
//!
//! Rigenera con `UPDATE_MIRROR=1 cargo test -p fub-format-svg --test
//! model_fixtures`. Senza la variabile il test confronta i file e fallisce
//! alla prima differenza.
//!
//! In `tests/fixtures/`, ogni `<nome>.svg` e ogni `<nome>.fubann` ha accanto
//! `<nome>.model.json`: il [`DocumentModel`] serializzato, con due spazi di
//! rientro e un a capo finale.
//!
//! - `drawing`: un disegno FubDraw canonico, con titolo, descrizione, testi su
//!   più righe, un collegamento attorno a un testo, uno attorno a un'immagine
//!   del vault, uno attorno a una forma, un tratto di penna e un testo estraneo
//!   con un collegamento dentro;
//! - `foreign-crlf-bom`: un SVG di un altro programma con BOM e righe CRLF,
//!   valori fra apici singoli, un `xlink:href` accanto a `href` con lo stesso
//!   URL, testo fuori dal piano base di Unicode e collegamenti che non sono
//!   del vault;
//! - `annotations`: le annotazioni di `atti/Bando di gara.pdf`, con impronta e
//!   numero di pagine, due pagine, un evidenziatore, una copertura, una nota
//!   con testo e corpo su più righe, una nota senza testo, un collegamento in
//!   una pagina e un testo estraneo, senza `id`, fuori dalle pagine.

use std::path::PathBuf;

use fub_abi::format::{DocumentSource, ParseContext};
use fub_abi::model::{Block, DocumentModel};
use fub_abi::FormatProvider;
use fub_format_svg::{FubannProvider, SvgProvider, ANNOTATIONS_KIND, NOTE_KIND, PAGE_KIND};

const REGENERATE: &str =
    "rigenera con UPDATE_MIRROR=1 cargo test -p fub-format-svg --test model_fixtures";

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

/// La sorgente e il modello della fixture `name`: un disegno, o le
/// annotazioni di `atti/Bando di gara.pdf` se `name` è `annotations`.
fn model_of(name: &str) -> (String, DocumentModel) {
    let (file, id, provider): (_, _, &dyn FormatProvider) = if name == "annotations" {
        (
            format!("{name}.fubann"),
            "atti/Bando di gara.pdf.fubann".to_owned(),
            &FubannProvider,
        )
    } else {
        (
            format!("{name}.svg"),
            format!("disegni/{name}.svg"),
            &SvgProvider,
        )
    };
    let source = std::fs::read_to_string(fixtures().join(file)).unwrap();
    let model = provider
        .parse(
            &DocumentSource::Text(source.clone()),
            &ParseContext::obsidian(id),
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
fn the_annotations_model_is_the_fixture() {
    check("annotations");
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
}

/// Le annotazioni dicono ciò che devono: il PDF è il primo collegamento, le
/// pagine sono due blocchi con le loro annotazioni, e note e testi si cercano.
#[test]
fn the_annotations_fixture_says_what_it_claims() {
    let (source, model) = model_of("annotations");
    assert_eq!(model.outline[0].text, "Revisione del bando");
    for text in [
        "ufficio gare & contratti",
        "Importo da rivedere",
        "L'importo a base d'asta è cambiato.",
        "Chiedere conferma all'ufficio <gare>.",
        "Manca la firma del RUP",
        "Vedi il verbale",
        "Fuori dalle pagine",
    ] {
        assert!(model.text.contains(text), "{text}");
    }
    let links: Vec<_> = model
        .links
        .iter()
        .map(|link| {
            (
                format!("{:?}", link.target),
                &source[link.span.start..link.span.end],
            )
        })
        .collect();
    assert_eq!(
        links[0],
        (
            r#"Path("Bando%20di%20gara.pdf")"#.to_owned(),
            "Bando%20di%20gara.pdf"
        )
    );
    assert_eq!(links[1].0, r#"Path("../Verbali/Verbale%2012.md")"#);
    assert_eq!(links.len(), 2);
    assert!(model.links[0]
        .context
        .as_deref()
        .unwrap()
        .starts_with("Le correzioni"));

    let Block::Custom {
        custom_kind,
        attrs,
        blocks,
        ..
    } = &model.body[0]
    else {
        panic!("{:?}", model.body);
    };
    assert_eq!(custom_kind, ANNOTATIONS_KIND);
    assert_eq!(attrs["annotates"], "Bando%20di%20gara.pdf");
    assert_eq!(attrs["pages"], 12);
    assert_eq!(
        attrs["sections"],
        serde_json::json!(["Revisione del bando", "page=1", "page=3"])
    );
    let pages: Vec<_> = blocks
        .iter()
        .filter_map(|block| match block {
            Block::Custom {
                custom_kind,
                attrs,
                blocks,
                ..
            } if custom_kind == PAGE_KIND => Some((attrs["page"].clone(), blocks.len())),
            _ => None,
        })
        .collect();
    assert_eq!(
        pages,
        [(serde_json::json!(1), 1), (serde_json::json!(3), 2)]
    );
    let notes = blocks
        .iter()
        .flat_map(|block| match block {
            Block::Custom { blocks, .. } => blocks.as_slice(),
            _ => &[],
        })
        .filter(
            |block| matches!(block, Block::Custom { custom_kind, .. } if custom_kind == NOTE_KIND),
        )
        .count();
    assert_eq!(notes, 2);
}
