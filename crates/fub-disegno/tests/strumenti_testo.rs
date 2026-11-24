#![cfg(feature = "completo")]
//! Gli strumenti di testo del motore nel Completo, con le lettere di Inter come nell'app: un clic su
//! un testo che c'è mette il cursore dove si clicca e lo cambia, e Testo in area prende anche il
//! bordo di un rettangolo, che diventa la cornice. Un binario a sé: `disegni_con_inter()` cambia i
//! caratteri del processo (vedi `famiglie_inter.rs`).

mod common;

use common::disegni_con_inter;
use fub_abi::{DrawingGesture, DrawingOutcome};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const DISEGNO: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300">
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <g id="l1a2b3c4d" fub:layer="Livello 1">
    <rect id="oa1a1a1a1" x="100" y="100" width="100" height="50" fill="#cccccc"/>
    <text id="ot1t1t1t1" x="20" y="60" font-family="Inter, sans-serif" font-size="32" fill="#000000"><tspan x="20" dy="0">Ciao</tspan></text>
  </g>
</svg>
"##;

fn evento(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn gesto(
    d: &mut Disegno,
    id: &str,
    phase: &str,
    eventi: Vec<Value>,
    ingressi: Vec<Value>,
) -> DrawingOutcome {
    let richiesta: DrawingGesture = serde_json::from_value(json!({
        "phase": phase, "tool": { "engine": { "id": id } }, "layer": null, "selection": [], "zoom": 1,
        "snap": { "grid": null, "free": false }, "style": { "stroke": "#000000", "width": 2, "fill": null },
        "events": eventi, "inputs": ingressi,
    }))
    .expect("il gesto si legge");
    d.gesto(richiesta).expect("il gesto")
}

/// Le operazioni di un clic in (x, y) con lo strumento `id`, poi «Ciao mondo» ed Esc.
fn clic_e_scrivi(id: &str, x: f64, y: f64) -> Value {
    let mut d = Disegno::apri_con(&disegni_con_inter(), DISEGNO)
        .expect("si apre")
        .0;
    let clic = gesto(
        &mut d,
        id,
        "preview",
        vec![evento("down", x, y), evento("up", x, y)],
        vec![],
    );
    assert_eq!(clic.refused, None, "{clic:?}");
    assert!(
        clic.state.as_ref().is_some_and(|s| s.wants_text),
        "lo strumento vuole il testo"
    );
    let scritto = gesto(
        &mut d,
        id,
        "preview",
        vec![],
        vec![json!({"kind":"text","text":"Ciao mondo"})],
    );
    assert_eq!(scritto.refused, None, "{scritto:?}");
    let esc = json!({ "kind": "key", "key": "Escape", "code": "Escape", "pressed": true });
    let fine = gesto(&mut d, id, "commit", vec![], vec![esc]);
    assert_eq!(fine.refused, None, "{fine:?}");
    serde_json::from_str(&fine.ops.expect("le operazioni")).expect("json")
}

#[test]
fn un_clic_su_un_testo_che_c_e_lo_cambia_dove_si_clicca() {
    // «Ci|ao»: il cursore va fra le lettere cliccate, e cambia lo stesso testo.
    let ops = clic_e_scrivi("type", 70.0, 50.0);
    assert_eq!(
        ops,
        json!([{"op": "text", "id": "ot1t1t1t1", "lines": ["CiaCiao mondoo"]}])
    );
}

#[test]
fn testo_in_area_sul_bordo_di_un_rettangolo() {
    let ops = clic_e_scrivi("areaType", 100.0, 125.0);
    let passi = ops[0]["ops"]
        .as_array()
        .expect("un passo con più operazioni");
    assert_eq!(
        passi[0],
        json!({"op": "remove", "target": "oa1a1a1a1"}),
        "{ops}"
    );
    let testo = &passi[1]["elem"];
    assert_eq!(testo["attrs"]["fub:wrap"], "100", "{ops}");
    assert_eq!(testo["attrs"]["x"], "100", "{ops}");
    let righe: Vec<&str> = testo["children"]
        .as_array()
        .expect("le righe")
        .iter()
        .filter_map(|r| r["text"].as_str())
        .collect();
    // Le righe a capo nella cornice larga 100 ridanno il testo, senza lo spazio fra le righe.
    assert_eq!(righe.concat(), "Ciaomondo", "{ops}");
}

#[test]
fn un_clic_dentro_un_rettangolo_con_testo_in_area_fa_un_testo_di_punto() {
    // Come VectorCraft: la cornice si prende sul bordo; dentro, il clic fa un testo di punto.
    let ops = clic_e_scrivi("areaType", 150.0, 125.0);
    assert_eq!(ops[0]["op"], "add", "{ops}");
    assert!(ops[0]["elem"]["attrs"].get("fub:wrap").is_none(), "{ops}");
}
