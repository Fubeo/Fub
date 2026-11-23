//! Le letture del colore (piano K6, T14; la famiglia `colore`): `color.harmony`,
//! `color.convert` e `color.gamutCheck` (K6 T14, letture).
//!
//! Le letture non cambiano il disegno: niente passo, niente operazioni, il file
//! com'era. I valori qui sono **controllati a mano**, non copiati dalla risposta
//! del motore: ogni controllo dice da dove viene il numero atteso. I casi con la
//! risposta esatta stanno in `tests/famiglie/colore.json`; qui ci sono le
//! verifiche con la formula.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::disegni;
use fub_abi::{DrawingCommandRequest, DrawingOutcome};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/colore/base.svg");

fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, aperto) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    assert!(
        aperto
            .losses
            .iter()
            .all(|p| p.detail.contains("dentro <defs>")),
        "perdite fuori da <defs>: {:?}",
        aperto.losses
    );
    d
}

fn lettura(d: &mut Disegno, id: &str, scelti: &[&str], valore: Value) -> DrawingOutcome {
    let prima = d.testo().to_string();
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: format!("disegno.{id}"),
            selection: scelti.iter().map(|s| s.to_string()).collect(),
            value: valore,
            preview: false,
        })
        .expect("il comando gira");
    assert!(esito.refused.is_none(), "rifiutato: {esito:?}");
    assert!(
        esito.ops.is_none(),
        "una lettura non cambia il disegno: {esito:?}"
    );
    assert_eq!(d.testo(), prima, "il file cambia con una lettura");
    esito
}

fn numeri(v: &Value) -> Vec<f64> {
    v.as_array()
        .expect("una lista di numeri")
        .iter()
        .map(|x| x.as_f64().expect("un numero"))
        .collect()
}

/// `#rrggbb` in (r, g, b) con 0..255.
fn rgb(hex: &str) -> (u8, u8, u8) {
    let c = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex");
    (c(1), c(3), c(5))
}

#[test]
fn guida_complementare_di_rosso_e_ciano_a_180_gradi() {
    // Da fare a mano: #ff0000 in HSL è tinta 0°, saturazione 100 %, luminosità 50 %.
    // Il complementare è la tinta 180°, con la stessa saturazione e luminosità: HSL(180°, 100 %, 50 %)
    // = #00ffff (R=0, G=255, B=255). Il colore base viene per primo, nel centro della griglia.
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let e = lettura(
        &mut d,
        "color.harmony",
        &[],
        json!({ "color": "#ff0000", "rule": "complementary" }),
    );
    let r = e.reading.expect("una lettura");
    let colori: Vec<&str> = r["colors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert_eq!(colori[0], "#ff0000", "il colore base viene per primo");
    assert_eq!(
        colori[1], "#00ffff",
        "complementare = tinta 180° di HSL(0°,100 %,50 %)"
    );
    // Griglia: la riga 0 è il colore base, con 2·4+1 = 9 variazioni; il centro (indice 4) è il base.
    let riga0 = r["grid"][0].as_array().unwrap();
    assert_eq!(riga0.len(), 9, "2·steps+1 con steps 4");
    assert_eq!(riga0[4], "#ff0000", "il colore stesso sta al centro");
}

#[test]
fn guida_monocroma_di_un_grigio_resta_grigia() {
    // Da fare a mano: #808080 ha R=G=B, quindi saturazione 0. Ogni variazione monocroma ha
    // di nuovo R=G=B: il controllo non dipende dai numeri del motore, solo dalla regola.
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let e = lettura(
        &mut d,
        "color.harmony",
        &[],
        json!({ "color": "#808080", "rule": "monochromatic", "steps": 1 }),
    );
    let r = e.reading.expect("una lettura");
    let colori: Vec<&str> = r["colors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert_eq!(colori[0], "#808080", "il colore base viene per primo");
    for c in &colori {
        let (x, y, z) = rgb(c);
        assert!(x == y && y == z, "{c} non è un grigio");
    }
}

#[test]
fn conversione_di_bianco_e_nero_in_lab_e_esatta() {
    // Da fare a mano: Lab del bianco D65 è L*=100, a*=0, b*=0; del nero L*=0, a*=0, b*=0.
    // Sono i punti fissi della definizione di CIELAB: nessuna tolleranza di profilo.
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let bianco = lettura(
        &mut d,
        "color.convert",
        &[],
        json!({ "color": "#ffffff", "to": "lab" }),
    );
    assert_eq!(
        numeri(&bianco.reading.unwrap()["lab"]),
        vec![100.0, 0.0, 0.0]
    );
    let nero = lettura(
        &mut d,
        "color.convert",
        &[],
        json!({ "color": "#000000", "to": "lab" }),
    );
    let l = numeri(&nero.reading.unwrap()["lab"]);
    assert!(l.iter().all(|x| x.abs() < 1e-3), "{l:?}");
}

#[test]
fn conversione_del_rosso_in_lab_e_vicina_al_srgb_standard() {
    // Da fare a mano, dalla formula sRGB → XYZ (D65) → CIELAB: #ff0000 dà L*≈53,24, a*≈80,09,
    // b*≈67,20 (valori di riferimento sRGB D65). Il motore passa per il profilo di stampa
    // (`outOfGamut` è vero: il rosso pieno sta fuori dal CMYK), e lo scarto misurato è
    // ΔL*≈1,05, Δa*≈0,72, Δb*≈2,68: la tolleranza è 3, e i segni restano quelli di sRGB.
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let e = lettura(
        &mut d,
        "color.convert",
        &[],
        json!({ "color": "#ff0000", "to": "lab" }),
    );
    let lab = numeri(&e.reading.unwrap()["lab"]);
    for (ottenuto, atteso) in lab.iter().zip([53.24, 80.09, 67.20]) {
        assert!(
            (ottenuto - atteso).abs() < 3.0,
            "{lab:?} lontano da [53.24, 80.09, 67.20]"
        );
    }
    assert!(lab[1] > 0.0 && lab[2] > 0.0, "il rosso ha a* e b* positivi");
}

#[test]
fn conversione_del_rosso_in_cmyk_ha_ciano_zero_e_nero_zero() {
    // Da fare a mano: il rosso è R piena, G e B vuote. Nella formula semplice CMY =
    // (1−R, 1−G, 1−B) = (0, 1, 1), e K = 0. Il profilo di stampa sposta solo la magenta (≈0,97):
    // ciano 0, giallo 1 e nero 0 restano quelli della formula.
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let e = lettura(
        &mut d,
        "color.convert",
        &[],
        json!({ "color": "#ff0000", "to": "cmyk" }),
    );
    let v = numeri(&e.reading.unwrap()["values"]);
    assert_eq!(v.len(), 4, "C M Y K");
    assert!(v[0].abs() < 1e-9, "ciano {}", v[0]);
    assert!(v[3].abs() < 1e-9, "nero {}", v[3]);
    assert!((v[2] - 1.0).abs() < 1e-3, "giallo {}", v[2]);
    assert!(v[1] > 0.95 && v[1] <= 1.0, "magenta {}", v[1]);
}

#[test]
fn grigio_medio_in_gray_e_in_lab_e_quello_della_formula() {
    // Da fare a mano: #808080 ha Y = ((128/255+0,055)/1,055)^2,4 ≈ 0,21586, quindi
    // L* = 116·Y^(1/3) − 16 ≈ 53,59. Il grigio (gray) del motore è 127/255 ≈ 0,498.
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let e = lettura(
        &mut d,
        "color.convert",
        &[],
        json!({ "color": "#808080", "to": "lab" }),
    );
    let l = numeri(&e.reading.unwrap()["lab"])[0];
    assert!((l - 53.59).abs() < 0.05, "L* {l}");
    let g = lettura(
        &mut d,
        "color.convert",
        &[],
        json!({ "color": "#808080", "to": "gray" }),
    );
    let v = numeri(&g.reading.unwrap()["values"])[0];
    assert!((v - 0.5).abs() < 0.01, "grigio {v}");
}

#[test]
fn il_controllo_gamut_distingue_il_blu_pieno_dal_grigio_e_dal_bianco() {
    // Da fare a mano: #0000ff (blu pieno) è fuori dal CMYK di stampa (il blu saturo non si
    // stampa), #808080 e #ffffff stanno dentro. Il numero di colori controllati è quello dato.
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let e = lettura(
        &mut d,
        "color.gamutCheck",
        &[],
        json!({ "colors": ["#0000ff", "#808080", "#ffffff"] }),
    );
    let r = e.reading.unwrap();
    assert_eq!(r["checked"], 3);
    let fuori: Vec<&str> = r["outOfGamut"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["hex"].as_str().unwrap())
        .collect();
    assert_eq!(fuori, vec!["#0000ff"], "solo il blu pieno è fuori");
}

#[test]
fn il_controllo_gamut_con_una_scelta_legge_i_colori_dell_oggetto() {
    // Da fare a mano, dal file base.svg: l'oggetto oa1 ha riempimento #ff0000 e tratto #0000ff.
    // Con oa1 scelto il controllo legge questi due colori, e nessun altro (due colori).
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let e = lettura(&mut d, "color.gamutCheck", &["oa1a1a1a1"], json!({}));
    let r = e.reading.unwrap();
    assert_eq!(r["checked"], 2, "riempimento e tratto di oa1");
}
