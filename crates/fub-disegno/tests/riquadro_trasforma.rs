//! Il riquadro della selezione del pannello Trasforma, come quello di VectorCraft: Ispeziona
//! documento lo porta (`transformBox`) nelle coordinate della scena, coi nove punti di
//! riferimento, e i comandi che il pannello manda (`object.setBounds`, `object.rotate` con
//! `origin`) tornano dalla scena al documento del motore anche quando la radice del file è
//! scalata.
#![cfg(feature = "completo")]

mod common;

use common::{apri, ops_di};
use fub_abi::{DrawingCommandRequest, DrawingOutcome};
use serde_json::{json, Value};

/// Un file con la radice scalata due volte (`viewBox` metà di `width`): la scena e il documento
/// del motore non coincidono.
const SCALATO: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="800" height="600">
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <g id="l1a2b3c4d" fub:layer="Livello 1">
    <rect id="oa1a1a1a1" x="100" y="100" width="100" height="50" fill="#ff0000" stroke="#000000" stroke-width="2"/>
    <rect id="ob1b1b1b1" x="100" y="200" width="100" height="50" fill="#00ff00" transform="rotate(30 150 225)"/>
  </g>
</svg>
"##;

fn comando(
    d: &mut fub_disegno::motore::Disegno,
    id: &str,
    scelti: &[&str],
    valore: Value,
) -> DrawingOutcome {
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: format!("disegno.{id}"),
            selection: scelti.iter().map(|s| (*s).to_string()).collect(),
            value: valore,
            preview: false,
        })
        .expect("il comando passa");
    assert_eq!(esito.refused, None, "{esito:?}");
    esito
}

fn riquadro(d: &mut fub_disegno::motore::Disegno, scelti: &[&str]) -> Value {
    let lettura = comando(d, "document.inspect", scelti, json!({"depth": 0}))
        .reading
        .expect("c'è una lettura");
    lettura.get("transformBox").cloned().unwrap_or(Value::Null)
}

fn vicino(v: &Value, atteso: f64) -> bool {
    v.as_f64().is_some_and(|x| (x - atteso).abs() < 1e-4)
}

fn punto(r: &Value, i: usize, x: f64, y: f64) {
    let p = &r["points"][i];
    assert!(
        vicino(&p[0], x) && vicino(&p[1], y),
        "punto {i}: {p} invece di [{x}, {y}]"
    );
}

#[test]
fn il_riquadro_sta_nella_scena_coi_nove_punti() {
    let (mut d, _) = apri(SCALATO);
    let r = riquadro(&mut d, &["oa1a1a1a1"]);
    // Senza «Usa i contorni di anteprima» il riquadro è la forma, senza il tratto.
    assert!(vicino(&r["angle"], 0.0), "{r}");
    assert!(
        vicino(&r["width"], 100.0) && vicino(&r["height"], 50.0),
        "{r}"
    );
    punto(&r, 0, 100.0, 100.0);
    punto(&r, 4, 150.0, 125.0);
    punto(&r, 8, 200.0, 150.0);
    punto(&r, 5, 200.0, 125.0);
}

#[test]
fn senza_selezione_non_c_e_riquadro() {
    let (mut d, _) = apri(SCALATO);
    assert_eq!(riquadro(&mut d, &[]), Value::Null);
}

#[test]
fn il_riquadro_ruota_con_l_oggetto() {
    let (mut d, _) = apri(SCALATO);
    let r = riquadro(&mut d, &["ob1b1b1b1"]);
    // `rotate(30)` gira in senso orario sullo schermo: il motore conta in senso antiorario.
    assert!(vicino(&r["angle"], -30.0), "{r}");
    assert!(
        vicino(&r["width"], 100.0) && vicino(&r["height"], 50.0),
        "{r}"
    );
    punto(&r, 4, 150.0, 225.0);
}

#[test]
fn x_e_y_del_pannello_sono_della_scena() {
    let (mut d, _) = apri(SCALATO);
    let ops = ops_di(&comando(
        &mut d,
        "object.setBounds",
        &["oa1a1a1a1"],
        json!({"x": 40, "y": 30, "reference": 0}),
    ));
    let testo = common::applica::applica(SCALATO, &ops).expect("la scena accetta");
    let (mut d, aperto) = apri(&testo);
    assert!(aperto.losses.is_empty(), "{:?}", aperto.losses);
    let r = riquadro(&mut d, &["oa1a1a1a1"]);
    punto(&r, 0, 40.0, 30.0);
    assert!(vicino(&r["width"], 100.0), "{r}");
}

#[test]
fn le_misure_del_pannello_sono_della_scena() {
    let (mut d, _) = apri(SCALATO);
    let ops = ops_di(&comando(
        &mut d,
        "object.setBounds",
        &["oa1a1a1a1"],
        json!({"width": 60, "reference": 0}),
    ));
    let testo = common::applica::applica(SCALATO, &ops).expect("la scena accetta");
    let (mut d, _) = apri(&testo);
    let r = riquadro(&mut d, &["oa1a1a1a1"]);
    assert!(
        vicino(&r["width"], 60.0) && vicino(&r["height"], 50.0),
        "{r}"
    );
    punto(&r, 0, 100.0, 100.0);
}

#[test]
fn la_rotazione_attorno_a_un_punto_della_scena() {
    let (mut d, _) = apri(SCALATO);
    // Raddrizza il rettangolo girato attorno al suo centro, dato nella scena.
    let ops = ops_di(&comando(
        &mut d,
        "object.rotate",
        &["ob1b1b1b1"],
        json!({"angle": 0, "absolute": true, "origin": [150, 225]}),
    ));
    let testo = common::applica::applica(SCALATO, &ops).expect("la scena accetta");
    let (mut d, _) = apri(&testo);
    let r = riquadro(&mut d, &["ob1b1b1b1"]);
    assert!(vicino(&r["angle"], 0.0), "{r}");
    punto(&r, 0, 100.0, 200.0);
}

#[test]
fn alt_invio_applica_a_una_copia() {
    let (mut d, _) = apri(SCALATO);
    let ops = ops_di(&comando(
        &mut d,
        "object.setBounds",
        &["oa1a1a1a1"],
        json!({"x": 300, "reference": 0, "copy": true}),
    ));
    let testo = common::applica::applica(SCALATO, &ops).expect("la scena accetta");
    // L'originale resta dov'era, e accanto c'è la copia spostata.
    assert_eq!(testo.matches(" id=\"o").count(), 3, "{testo}");
    assert!(
        testo.contains("M300 100 L400 100 L400 150 L300 150 Z"),
        "{testo}"
    );
    let (mut d, _) = apri(&testo);
    let r = riquadro(&mut d, &["oa1a1a1a1"]);
    punto(&r, 0, 100.0, 100.0);
}

#[test]
fn il_riflesso_attorno_al_punto_della_scena() {
    let (mut d, _) = apri(SCALATO);
    // Specchia sull'asse verticale che passa per il lato destro (x 200 nella scena).
    let ops = ops_di(&comando(
        &mut d,
        "object.reflect",
        &["oa1a1a1a1"],
        json!({"axis": "vertical", "origin": [200, 125]}),
    ));
    let testo = common::applica::applica(SCALATO, &ops).expect("la scena accetta");
    let (mut d, _) = apri(&testo);
    let r = riquadro(&mut d, &["oa1a1a1a1"]);
    assert!(
        vicino(&r["width"], 100.0) && vicino(&r["height"], 50.0),
        "{r}"
    );
    // Il riquadro riflesso ha gli angoli scambiati: il centro è quello che conta.
    punto(&r, 4, 250.0, 125.0);
}

#[test]
fn l_inclinazione_attorno_al_punto_della_scena_lo_tiene_fermo() {
    let (mut d, _) = apri(SCALATO);
    let ops = ops_di(&comando(
        &mut d,
        "object.shear",
        &["oa1a1a1a1"],
        json!({"angle": 20, "axis": "horizontal", "origin": [100, 150]}),
    ));
    let testo = common::applica::applica(SCALATO, &ops).expect("la scena accetta");
    // Il lato di sotto (y 150) non si muove; quello di sopra va a destra di 50·tan 20°.
    let (mut d, _) = apri(&testo);
    let r = riquadro(&mut d, &["oa1a1a1a1"]);
    let spinta = 50.0 * 20f64.to_radians().tan();
    // Il file scrive la parte lineare della matrice con tre decimali (-0.364): un centesimo basta.
    assert!(vicino(&r["points"][6][1], 150.0), "{r}");
    let destra = r["points"][2][0]
        .as_f64()
        .expect("x")
        .max(r["points"][8][0].as_f64().expect("x"));
    assert!((destra - (200.0 + spinta)).abs() < 1e-2, "{r}");
}
