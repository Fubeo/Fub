//! Le lunghezze che le finestre e i pannelli mandano sono della scena (le unità del `viewBox`); il
//! motore lavora nel suo documento, che con la radice scalata non coincide. Ogni comando con una
//! distanza la porta nel documento del motore (`famiglie::scala`), e il file torna come se la radice
//! non ci fosse: Sposta di 20 sposta di 20 nella scena, uno spessore di 4 è 4 nella scena.
#![cfg(feature = "completo")]

mod common;

use common::{apri, ops_di};
use fub_abi::{DrawingCommandRequest, DrawingOutcome};
use serde_json::{json, Value};

/// La radice scalata due volte (`viewBox` metà di `width`), come un file in millimetri.
const SCALATO: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="800" height="600">
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <g id="l1a2b3c4d" fub:layer="Livello 1">
    <rect id="oa1a1a1a1" x="100" y="100" width="100" height="50" fill="#ff0000" stroke="#000000" stroke-width="2"/>
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

/// Il file `testo` dopo il comando `id` sull'oggetto `oa1a1a1a1`.
fn dopo_su(testo: &str, id: &str, valore: Value) -> String {
    let (mut d, _) = apri(testo);
    let ops = ops_di(&comando(&mut d, id, &["oa1a1a1a1"], valore));
    common::applica::applica(testo, &ops).expect("la scena accetta")
}

/// Il file dopo il comando `id` sul rettangolo.
fn dopo(id: &str, valore: Value) -> String {
    dopo_su(SCALATO, id, valore)
}

/// Il riquadro (x, y, larghezza, altezza) nella scena dell'oggetto `id` del file `testo`.
fn riquadro(testo: &str, id: &str) -> [f64; 4] {
    let (mut d, _) = apri(testo);
    let r = comando(&mut d, "document.inspect", &[id], json!({"depth": 0}))
        .reading
        .expect("c'è una lettura")["transformBox"]
        .clone();
    let n = |v: &Value| v.as_f64().expect("un numero");
    [
        n(&r["points"][0][0]),
        n(&r["points"][0][1]),
        n(&r["width"]),
        n(&r["height"]),
    ]
}

fn vicini(a: [f64; 4], b: [f64; 4]) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-3)
}

/// Gli id degli oggetti disegnati del file, nell'ordine.
fn oggetti(testo: &str) -> Vec<String> {
    testo
        .split(" id=\"")
        .skip(1)
        .filter_map(|s| s.split('"').next())
        .filter(|id| id.starts_with('o') || id.starts_with('p'))
        .map(str::to_string)
        .collect()
}

#[test]
fn sposta_di_venti_nella_scena() {
    let testo = dopo("object.move", json!({"dx": 20, "dy": 10}));
    let r = riquadro(&testo, "oa1a1a1a1");
    assert!(vicini(r, [120.0, 110.0, 100.0, 50.0]), "{r:?}\n{testo}");
}

#[test]
fn trasforma_singolarmente_sposta_nella_scena() {
    let testo = dopo(
        "object.transformEach",
        json!({"scaleH": 100, "scaleV": 100, "moveH": 20, "moveV": 10, "rotate": 0}),
    );
    let r = riquadro(&testo, "oa1a1a1a1");
    assert!(vicini(r, [120.0, 110.0, 100.0, 50.0]), "{r:?}\n{testo}");
}

#[test]
fn la_misura_di_ciascuno_nella_scena() {
    let testo = dopo(
        "addon.arrange.size",
        json!({"width": 60, "height": 30, "proportional": false}),
    );
    let r = riquadro(&testo, "oa1a1a1a1");
    assert!(
        (r[2] - 60.0).abs() < 1e-3 && (r[3] - 30.0).abs() < 1e-3,
        "{r:?}\n{testo}"
    );
}

#[test]
fn lo_spessore_del_contorno_nella_scena() {
    let testo = dopo("stroke.set", json!({"weight": 4}));
    assert!(testo.contains("stroke-width=\"4\""), "{testo}");
}

#[test]
fn il_tratteggio_nella_scena() {
    let testo = dopo("stroke.set", json!({"dash": [6, 3]}));
    assert!(testo.contains("stroke-dasharray=\"6 3\""), "{testo}");
}

#[test]
fn sposta_tracciato_di_dieci_nella_scena() {
    let testo = dopo(
        "object.path.offsetPath",
        json!({"offset": 10, "joins": "miter", "miterLimit": 4}),
    );
    let nuovi: Vec<_> = oggetti(&testo)
        .into_iter()
        .filter(|id| id != "oa1a1a1a1")
        .collect();
    assert_eq!(nuovi.len(), 1, "{testo}");
    let r = riquadro(&testo, &nuovi[0]);
    assert!(vicini(r, [90.0, 90.0, 120.0, 70.0]), "{r:?}\n{testo}");
}

#[test]
fn dividi_in_trattini_nella_scena() {
    // Il perimetro è 300 nella scena: trattini e spazi di 50 fanno tre pezzi, non sei.
    let testo = dopo(
        "addon.pathtools.divideDashes",
        json!({"dash": 50, "gap": 50, "fit": false, "removeGaps": true}),
    );
    assert_eq!(oggetti(&testo).len(), 3, "{testo}");
}

#[test]
fn la_spaziatura_della_griglia_nella_scena() {
    // Dividi in griglia vuole un tracciato: lo stesso rettangolo, disegnato a punti.
    let tracciato = SCALATO.replace(
        r#"<rect id="oa1a1a1a1" x="100" y="100" width="100" height="50""#,
        r#"<path id="oa1a1a1a1" d="M100 100 L200 100 L200 150 L100 150 Z""#,
    );
    let testo = dopo_su(
        &tracciato,
        "object.path.splitIntoGrid",
        json!({"rows": 1, "columns": 2, "gutter": 10}),
    );
    let pezzi = oggetti(&testo);
    assert_eq!(pezzi.len(), 2, "{testo}");
    let r = riquadro(&testo, &pezzi[0]);
    assert!((r[2] - 45.0).abs() < 1e-3, "{r:?}\n{testo}");
}

#[test]
fn il_pannello_contorno_legge_lo_spessore_nella_scena() {
    let (mut d, _) = apri(SCALATO);
    let lettura = comando(
        &mut d,
        "document.node",
        &[],
        json!({"id": "oa1a1a1a1", "summary": true, "depth": 0}),
    )
    .reading
    .expect("c'è una lettura");
    assert_eq!(lettura["strokeWidth"].as_f64(), Some(2.0), "{lettura}");
}
