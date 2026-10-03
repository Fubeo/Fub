//! Le fixture delle annotazioni per la superficie TypeScript: file `.fubann`
//! scritti qui, ognuno con ciò che [`read_annotations`] ne legge, perché il
//! profilo `pdf` dell'editor trovi le stesse pagine e le stesse note del
//! provider.
//!
//! Rigenera con `UPDATE_MIRROR=1 cargo test -p fub-scene --test annotation_mirror`.
//! Senza la variabile il test confronta i file byte per byte.
//!
//! In `apps/client/src/__fixtures__/annotations/`, per ogni `<nome>.fubann`
//! un `<nome>.json`: le [`Annotations`] serializzate senza la scena, che ha le
//! sue fixture in `__fixtures__/scene/`.
//!
//! - `bando`: l'esempio del formato, con due pagine e due note;
//! - `bordi`: ogni grammatica fuori dal suo campo (pagina zero, dimensione di
//!   tre numeri, impronta maiuscola da portare in minuscolo, un gruppo di
//!   pagina annidato, due gruppi con lo stesso numero, un corpo di soli spazi,
//!   un `text` dentro un `text`, `fub:note` su un rettangolo, un URL esterno);
//! - `crlf-bom`: BOM e righe CRLF, un corpo con `&#13;&#10;` e `&#13;`, testo
//!   fuori dal piano base di Unicode: gli span UTF-16 si allontanano dai byte.

use std::path::PathBuf;

use fub_scene::{read_annotations, Annotations};
use serde_json::Value;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/annotations")
}

const REGENERATE: &str =
    "rigenera con UPDATE_MIRROR=1 cargo test -p fub-scene --test annotation_mirror";

fn mirror(name: &str, actual: &str) {
    let path = fixtures().join(name);
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::create_dir_all(fixtures()).unwrap();
        std::fs::write(&path, actual).unwrap();
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{name} non si legge ({error}): {REGENERATE}"));
    assert!(expected == actual, "{name} differisce: {REGENERATE}");
}

/// Le annotazioni come le conserva la fixture: senza la scena.
fn without_scene(annotations: &Annotations) -> String {
    let mut value: Value = serde_json::to_value(annotations).unwrap();
    value.as_object_mut().unwrap().remove("scene");
    format!("{}\n", serde_json::to_string_pretty(&value).unwrap())
}

fn fixture(name: &str, source: &str) -> Annotations {
    let annotations = read_annotations(source).unwrap_or_else(|e| panic!("{name}: {e}"));
    mirror(&format!("{name}.fubann"), source);
    mirror(&format!("{name}.json"), &without_scene(&annotations));
    annotations
}

const HEAD: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1""#;

const HEX: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

#[test]
fn bando() {
    let source = format!(
        "{HEAD} fub:annotates=\"Bando%20di%20gara.pdf\" fub:digest=\"sha256:{HEX}\" fub:pages=\"12\">\n\
         \x20 <title>Revisione del bando</title>\n\
         \x20 <g id=\"p0001\" fub:page=\"1\" fub:page-size=\"595.28 841.89\">\n\
         \x20   <path id=\"o7k2m9x4q\" fub:tool=\"highlighter\" d=\"M72 140 L320 140 L320 156 L72 156 Z\" fill=\"#f0e442\" fill-opacity=\"0.4\"/>\n\
         \x20   <text id=\"o5p6q7r8s\" x=\"330\" y=\"150\" fill=\"#000000\" font-family=\"Inter, sans-serif\" font-size=\"12\" fub:note=\"L'importo a base d'asta è cambiato.&#10;&#10;Chiedere conferma all'ufficio gare.\">\n\
         \x20     <tspan x=\"330\" dy=\"0\">Importo da rivedere</tspan>\n\
         \x20   </text>\n\
         \x20 </g>\n\
         \x20 <g id=\"p0003\" fub:page=\"3\" fub:page-size=\"595.28 841.89\">\n\
         \x20   <rect id=\"o1a2b3c4d\" x=\"72\" y=\"300\" width=\"200\" height=\"40\" fill=\"#ffffff\"/>\n\
         \x20   <text id=\"o4d5e6f7g\" x=\"300\" y=\"400\" fill=\"#000000\" font-family=\"Inter, sans-serif\" font-size=\"12\" fub:note=\"Manca la firma del RUP: vedi l'allegato B.\"/>\n\
         \x20 </g>\n\
         </svg>\n"
    );
    let annotations = fixture("bando", &source);
    assert_eq!(annotations.page_count, Some(12));
    assert_eq!(annotations.pages.len(), 2);
    assert_eq!(annotations.notes.len(), 2);
}

#[test]
fn bordi() {
    let source = format!(
        "{HEAD} fub:annotates=\"https://example.org/bando.pdf\" fub:digest=\"sha256:{}\" fub:pages=\"007\">\n\
         \x20 <g fub:page=\"0\"><text fub:note=\"fuori dalle pagine\">zero</text></g>\n\
         \x20 <g id=\"p0002\" fub:page=\"2\" fub:page-size=\"612 792 1\">\n\
         \x20   <g fub:page=\"5\"><rect x=\"1\" y=\"1\" width=\"2\" height=\"2\" fub:note=\"non conta\"/></g>\n\
         \x20   <text fub:note=\" \t \">soli spazi</text>\n\
         \x20   <text fub:note=\"esterna\">fuori<text fub:note=\"interna\">dentro</text></text>\n\
         \x20 </g>\n\
         \x20 <g fub:page=\"2\" fub:page-size=\" 612,792 \"/>\n\
         \x20 <g fub:page=\"4294967296\"/>\n\
         \x20 <g fub:page=\"+3\"/>\n\
         </svg>\n",
        HEX.to_uppercase()
    );
    let annotations = fixture("bordi", &source);
    assert_eq!(annotations.annotates, None);
    assert_eq!(annotations.digest, Some(format!("sha256:{HEX}")));
    assert_eq!(annotations.page_count, Some(7));
    let pages: Vec<_> = annotations
        .pages
        .iter()
        .map(|p| (p.number, p.size))
        .collect();
    assert_eq!(pages, [(2, None), (2, Some([612.0, 792.0]))]);
    let notes: Vec<_> = annotations.notes.iter().map(|n| n.body.as_str()).collect();
    assert_eq!(notes, ["fuori dalle pagine", "esterna"]);
}

#[test]
fn crlf_bom() {
    let source = format!(
        "\u{feff}{HEAD} fub:annotates=\"/Archivio/Atto%20%F0%9F%93%9C.pdf#page=2\" fub:pages=\"3\">\r\n\
         \x20 <g id=\"p0002\" fub:page=\"2\" fub:page-size=\"841.89 595.28\">\r\n\
         \x20   <text id=\"o9z8y7x6w\" x=\"40\" y=\"60\" fub:note=\"Prima riga&#13;&#10;seconda&#13;terza\">\r\n\
         \x20     <tspan x=\"40\" dy=\"0\">Firma 🖋️</tspan>\r\n\
         \x20     <tspan x=\"40\" dy=\"1.2em\">da verificare</tspan>\r\n\
         \x20   </text>\r\n\
         \x20 </g>\r\n\
         </svg>\r\n"
    );
    let annotations = fixture("crlf-bom", &source);
    assert_eq!(annotations.digest, None);
    assert_eq!(annotations.notes[0].body, "Prima riga\nseconda\nterza");
    assert_eq!(annotations.notes[0].text, "Firma 🖋️ da verificare");
    let path = &annotations.annotates.as_ref().unwrap().path;
    assert!(path.starts_with("/Archivio/"), "{path}");
}
