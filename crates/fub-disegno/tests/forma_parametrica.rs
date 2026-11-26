//! La Forma parametrica di VectorCraft (`parametricShape`, `addons/parametric_shape.rs`): un
//! trascinamento dal centro la disegna, le frecce durante il trascinamento ne cambiano i numeri, e
//! il file la riapre come forma viva, coi suoi numeri nella ricetta (`vc-pathtools-shape`): un clic
//! con lo strumento la riprende con le sue maniglie, come in VectorCraft.

#![cfg(feature = "completo")]

mod common;

use fub_abi::{DrawingGesture, DrawingOutcome};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/forme/base.svg");
const STRUMENTO: &str = "parametricShape";

fn apri(testo: &str) -> Disegno {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    Disegno::apri_con(&disegni, testo)
        .expect("il disegno si apre")
        .0
}

fn evento(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn gesto(d: &mut Disegno, phase: &str, eventi: Vec<Value>, ingressi: Vec<Value>) -> DrawingOutcome {
    let g: DrawingGesture = serde_json::from_value(json!({
        "phase": phase,
        "tool": { "engine": { "id": STRUMENTO } },
        "layer": null,
        "selection": [],
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#000000", "width": 2, "fill": null },
        "events": eventi,
        "inputs": ingressi,
    }))
    .expect("il gesto si legge");
    let esito = d.gesto(g).expect("il gesto");
    assert_eq!(esito.refused, None, "{esito:?}");
    esito
}

fn freccia(key: &str) -> Value {
    json!({ "kind": "key", "key": key, "code": key, "pressed": true })
}

/// Trascina dal centro (150, 190) a (170, 160), coi tasti `frecce` a metà: il file dopo.
fn disegnata(frecce: &[&str]) -> String {
    let mut d = apri(BASE);
    gesto(
        &mut d,
        "preview",
        vec![evento("down", 150.0, 190.0), evento("drag", 170.0, 160.0)],
        vec![],
    );
    if !frecce.is_empty() {
        let esito = gesto(
            &mut d,
            "preview",
            vec![],
            frecce.iter().map(|k| freccia(k)).collect(),
        );
        assert!(
            esito.preview.is_some_and(|p| !p.overlays.is_empty()),
            "la freccia rifà l'anteprima"
        );
    }
    let esito = gesto(&mut d, "commit", vec![evento("up", 170.0, 160.0)], vec![]);
    let ops: Value =
        serde_json::from_str(esito.ops.as_deref().expect("le operazioni")).expect("JSON");
    common::applica::applica(BASE, &ops).expect("le operazioni si applicano")
}

/// I punti del `<polygon>` della forma.
fn punti(testo: &str) -> usize {
    let da = testo.find("<polygon").expect("il poligono");
    let p = &testo[da..];
    let p = &p[p.find("points=\"").expect("i punti") + 8..];
    p[..p.find('"').unwrap()].split_whitespace().count()
}

#[test]
fn le_frecce_durante_il_trascinamento_cambiano_i_numeri() {
    let senza = disegnata(&[]);
    let su = disegnata(&["ArrowUp"]);
    assert_ne!(punti(&senza), punti(&su), "↑ cambia i lati:\n{senza}\n{su}");
    let giu = disegnata(&["ArrowUp", "ArrowDown"]);
    assert_eq!(punti(&senza), punti(&giu), "↑ e ↓ tornano dove erano");
}

#[test]
fn si_riapre_come_forma_viva_con_le_sue_maniglie() {
    let testo = disegnata(&[]);
    assert!(
        testo.contains("vectorcraft:recipe"),
        "i numeri nella ricetta:\n{testo}"
    );
    let mut d = apri(&testo);
    // Un clic sul contorno (la forma non ha riempimento) la sceglie e ne mostra il contorno e le maniglie.
    let esito = gesto(
        &mut d,
        "preview",
        vec![evento("down", 170.0, 160.0), evento("up", 170.0, 160.0)],
        vec![],
    );
    let segni = esito.preview.map(|p| p.overlays).unwrap_or_default();
    assert!(segni.len() >= 6, "contorno e maniglie: {segni:?}");
    // La stessa forma senza ricetta è un poligono qualunque: niente maniglie.
    let i = testo.find("<metadata").expect("la ricetta");
    let j = testo[i..].find("</metadata>").unwrap() + i + "</metadata>".len();
    let senza = format!("{}{}", &testo[..i], &testo[j..]);
    let mut d = apri(&senza);
    let esito = gesto(
        &mut d,
        "preview",
        vec![evento("down", 170.0, 160.0), evento("up", 170.0, 160.0)],
        vec![],
    );
    let segni = esito.preview.map(|p| p.overlays).unwrap_or_default();
    assert!(
        segni.len() < 6,
        "un poligono qualunque non ha maniglie: {segni:?}"
    );
}

/// Il doppio clic, come lo manda VectorCraft: giù e su due volte, poi il doppio clic, un gesto a sé.
/// Sul vuoto mette una forma coi numeri dell'ultima (`addon.pathtools.shape.create`).
#[test]
fn il_doppio_clic_sul_vuoto_ne_mette_una_coi_numeri_di_adesso() {
    let mut d = apri(BASE);
    for _ in 0..2 {
        gesto(&mut d, "preview", vec![evento("down", 60.0, 60.0)], vec![]);
        let clic = d
            .gesto(
                serde_json::from_value(json!({
                    "phase": "commit",
                    "tool": { "engine": { "id": STRUMENTO } },
                    "layer": null, "selection": [], "zoom": 1,
                    "snap": { "grid": null, "free": false },
                    "style": { "stroke": "#000000", "width": 2, "fill": null },
                    "events": [evento("up", 60.0, 60.0)], "inputs": [],
                }))
                .expect("il gesto si legge"),
            )
            .expect("il gesto");
        assert_eq!(
            clic.ops, None,
            "un clic senza trascinare non disegna niente"
        );
    }
    let esito = gesto(
        &mut d,
        "commit",
        vec![evento("double_click", 60.0, 60.0)],
        vec![],
    );
    let ops: Value =
        serde_json::from_str(esito.ops.as_deref().expect("le operazioni")).expect("JSON");
    let dopo = common::applica::applica(BASE, &ops).expect("le operazioni si applicano");
    assert!(dopo.contains("<polygon"), "una forma nuova:\n{dopo}");
    assert!(
        dopo.contains("vectorcraft:recipe"),
        "viva nel file:\n{dopo}"
    );
}
