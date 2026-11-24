//! Gli strumenti dei simboli di VectorCraft (`symbolSprayer` … `symbolStyler`,
//! `tools/src/symbolism.rs`): lo Spruzzo mette istanze del simbolo scelto lungo
//! il tratto, gli altri cambiano le istanze sotto il pennello. Il file tiene le
//! istanze come `use` del simbolo.

#![cfg(feature = "completo")]

mod common;

use fub_abi::{DrawingCommandRequest, DrawingOutcome};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/simboli/base.svg");

fn apri(testo: &str) -> Disegno {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    Disegno::apri_con(&disegni, testo)
        .expect("il disegno si apre")
        .0
}

fn opzione(d: &mut Disegno, strumento: &str, chiave: &str, valore: Value) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: fub_abi::DRAWING_COMMAND_TOOL_OPTION.into(),
        selection: vec![],
        value: json!({ "strumento": strumento, "chiave": chiave, "valore": valore }),
        preview: false,
    })
    .expect("l'opzione gira")
}

fn scritto(testo: &str, esito: &DrawingOutcome) -> String {
    assert_eq!(esito.refused, None, "{esito:?}");
    let ops: Value =
        serde_json::from_str(esito.ops.as_deref().expect("le operazioni")).expect("JSON");
    common::applica::applica(testo, &ops).expect("le operazioni si applicano")
}

fn gesto(d: &mut Disegno, strumento: &str, phase: &str, eventi: Vec<Value>) -> DrawingOutcome {
    let g: fub_abi::DrawingGesture = serde_json::from_value(json!({
        "revision": d.revisione(),
        "phase": phase,
        "tool": { "engine": { "id": strumento } },
        "layer": null,
        "selection": [],
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#0000ff", "width": 3, "fill": "#00ff00" },
        "events": eventi,
        "inputs": [],
    }))
    .expect("il gesto si legge");
    d.gesto(g).expect("il gesto")
}

fn ev(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn tratto(da: (f64, f64), a: (f64, f64)) -> Vec<Value> {
    let mut v = vec![ev("down", da.0, da.1)];
    for i in 1..=10 {
        let f = f64::from(i) / 10.0;
        v.push(ev("drag", da.0 + (a.0 - da.0) * f, da.1 + (a.1 - da.1) * f));
    }
    v.push(ev("up", a.0, a.1));
    v
}

fn usi(testo: &str, simbolo: &str) -> usize {
    testo.matches(&format!("href=\"#{simbolo}\"")).count()
}

#[test]
fn lo_spruzzo_mette_istanze_del_simbolo_scelto() {
    let mut d = apri(BASE);
    let o = opzione(&mut d, "symbolSprayer", "symbol", json!("Vite"));
    assert_eq!(o.refused, None, "{o:?}");
    let e = gesto(
        &mut d,
        "symbolSprayer",
        "commit",
        tratto((60.0, 240.0), (300.0, 240.0)),
    );
    let t = scritto(BASE, &e);
    assert!(usi(&t, "r9x8w7v6u") >= 2, "{t}");
    assert_eq!(usi(&t, "r4k7m2p9q"), 2, "{t}");
}

#[test]
fn il_ridimensionamento_cambia_l_istanza_sotto_il_pennello() {
    let mut d = apri(BASE);
    let e = gesto(
        &mut d,
        "symbolSizer",
        "commit",
        tratto((318.0, 180.0), (322.0, 180.0)),
    );
    let t = scritto(BASE, &e);
    assert!(!t.contains(r#"transform="translate(320 180)""#), "{t}");
}
