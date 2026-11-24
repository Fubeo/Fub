//! Il profilo dello spessore (pannello Contorno › Profilo, `stroke.set {profile}`): una linea
//! semplice va nel file come linea a spessore variabile del formato (`fub:shape="width"`), si
//! riapre con lo stesso profilo, e Uniforme la riporta a un contorno.
#![cfg(feature = "completo")]

mod common;

use common::{apri, ops_di};
use fub_abi::DrawingCommandRequest;
use serde_json::{json, Value};

const TESTA: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300">
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <g id="l1a2b3c4d" fub:layer="Livello 1">
"##;
const CODA: &str = "  </g>\n</svg>\n";

fn file(corpo: &str) -> String {
    format!("{TESTA}{corpo}{CODA}")
}

const LINEA: &str = "    <path id=\"oa1a1a1a1\" d=\"M10 50 L110 50\" fill=\"none\" stroke=\"#ff0000\" stroke-width=\"4\"/>\n";

/// Il file `testo` dopo `id` con `valore` sull'oggetto `oa1a1a1a1`.
fn dopo(testo: &str, id: &str, valore: Value) -> String {
    let (mut d, _) = apri(testo);
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: format!("disegno.{id}"),
            selection: vec!["oa1a1a1a1".into()],
            value: valore,
            preview: false,
        })
        .expect("il comando passa");
    assert_eq!(esito.refused, None, "{esito:?}");
    common::applica::applica(testo, &ops_di(&esito)).expect("la scena accetta")
}

/// Le opzioni del contorno di `oa1a1a1a1` lette dal motore.
fn opzioni(testo: &str) -> Value {
    let (mut d, _) = apri(testo);
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.document.node".into(),
            selection: vec![],
            value: json!({"id": "oa1a1a1a1", "summary": true, "depth": 0}),
            preview: false,
        })
        .expect("si legge");
    esito.reading.expect("c'è una lettura")
}

/// L'elemento `oa1a1a1a1` del file.
fn elemento(testo: &str) -> &str {
    let da = testo.find("id=\"oa1a1a1a1\"").expect("c'è");
    let inizio = testo[..da].rfind('<').expect("tag");
    let fine = inizio + testo[inizio..].find("/>").expect("chiuso");
    &testo[inizio..fine]
}

#[test]
fn la_lente_scrive_la_linea_a_spessore_variabile() {
    let testo = dopo(&file(LINEA), "stroke.set", json!({"profile": "lens"}));
    let e = elemento(&testo);
    assert!(e.contains("fub:shape=\"width\""), "{e}");
    assert!(
        e.contains("fub:geom=\"butt miter 0 0 0 0.49 1.96 1.96 0.5 2 2 0.51 1.96 1.96 1 0 0 M10 50 L110 50\""),
        "{e}"
    );
    assert!(e.contains("fill=\"#ff0000\""), "{e}");
    assert!(!e.contains("stroke"), "{e}");
    // Si riapre con lo stesso profilo e lo stesso peso.
    let letto = opzioni(&testo);
    assert_eq!(letto["strokeOptions"]["profile"], "lens", "{letto}");
    assert_eq!(letto["strokeWidth"].as_f64(), Some(4.0), "{letto}");
}

#[test]
fn ogni_profilo_del_menu_torna_uguale() {
    for id in ["taperStart", "taperEnd", "pinch", "teardrop", "wave"] {
        let testo = dopo(&file(LINEA), "stroke.set", json!({"profile": id}));
        assert!(
            elemento(&testo).contains("fub:shape=\"width\""),
            "{id}: {testo}"
        );
        let letto = opzioni(&testo);
        assert_eq!(letto["strokeOptions"]["profile"], id, "{letto}");
    }
}

#[test]
fn uniforme_torna_un_contorno() {
    let lente = dopo(&file(LINEA), "stroke.set", json!({"profile": "lens"}));
    let testo = dopo(&lente, "stroke.set", json!({"profile": "uniform"}));
    let e = elemento(&testo);
    assert!(!e.contains("fub:shape"), "{e}");
    assert!(e.contains("stroke=\"#ff0000\""), "{e}");
    assert!(e.contains("stroke-width=\"4\""), "{e}");
}

#[test]
fn il_colore_di_una_linea_variabile_va_nel_riempimento() {
    let lente = dopo(&file(LINEA), "stroke.set", json!({"profile": "lens"}));
    let testo = dopo(&lente, "stroke.set", json!({"weight": 8}));
    let e = elemento(&testo);
    assert!(e.contains("fub:shape=\"width\""), "{e}");
    assert!(e.contains(" 0.5 4 4 "), "{e}");
}

#[test]
fn spostata_cambia_solo_la_transform() {
    let lente = dopo(&file(LINEA), "stroke.set", json!({"profile": "lens"}));
    let testo = dopo(&lente, "object.move", json!({"dx": 20, "dy": 10}));
    let e = elemento(&testo);
    assert!(
        e.contains("transform=\"translate(20 10)\"")
            || e.contains("transform=\"matrix(1 0 0 1 20 10)\""),
        "{e}"
    );
    assert!(e.contains("M10 50 L110 50"), "{e}");
}

#[test]
fn col_tratteggio_resta_la_ricetta() {
    let tratteggiata = LINEA.replace(
        "stroke-width=\"4\"",
        "stroke-width=\"4\" stroke-dasharray=\"6 3\"",
    );
    let testo = dopo(
        &file(&tratteggiata),
        "stroke.set",
        json!({"profile": "lens"}),
    );
    assert!(!testo.contains("fub:shape=\"width\""), "{testo}");
    assert!(
        testo.contains("fub:recipe") || testo.contains("recipe"),
        "{testo}"
    );
}

#[test]
fn il_profilo_rovesciato_si_scrive() {
    let inizio = dopo(&file(LINEA), "stroke.set", json!({"profile": "taperStart"}));
    let testo = dopo(
        &inizio,
        "stroke.setAdvanced",
        json!({"flipProfile": "along"}),
    );
    assert!(elemento(&testo).contains("fub:shape=\"width\""), "{testo}");
    let letto = opzioni(&testo);
    assert_eq!(letto["strokeOptions"]["profile"], "taperEnd", "{letto}");
}
