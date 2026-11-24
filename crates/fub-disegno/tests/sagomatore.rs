//! Il Sagomatore di VectorCraft (`shaper`, `extra.rs`): un disegno a mano
//! libera diventa una forma pulita (rettangolo, ellisse, poligono, linea), e
//! uno scarabocchio sopra le forme le toglie o le unisce in un gruppo del
//! Sagomatore, come in VectorCraft.

#![cfg(feature = "completo")]

mod common;

use fub_abi::{DrawingGesture, DrawingOutcome};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/forme/base.svg");
const STRUMENTO: &str = "shaper";

fn apri(testo: &str) -> Disegno {
    apri_e_perdite(testo).0
}

fn apri_e_perdite(testo: &str) -> (Disegno, usize) {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (d, aperto) = Disegno::apri_con(&disegni, testo).expect("il disegno si apre");
    (d, aperto.losses.len())
}

fn evento(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn gesto(d: &mut Disegno, phase: &str, eventi: Vec<Value>) -> DrawingOutcome {
    let g: DrawingGesture = serde_json::from_value(json!({
        "phase": phase,
        "tool": { "engine": { "id": STRUMENTO } },
        "layer": null,
        "selection": [],
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#000000", "width": 2, "fill": null },
        "events": eventi,
        "inputs": [],
    }))
    .expect("il gesto si legge");
    d.gesto(g).expect("il gesto")
}

/// Il tratto a mano `punti` (giù, trascinamenti, su), e il file dopo.
fn tratto(testo: &str, punti: &[(f64, f64)]) -> (DrawingOutcome, Option<String>) {
    let mut d = apri(testo);
    let (x0, y0) = punti[0];
    let mut eventi = vec![evento("down", x0, y0)];
    eventi.extend(punti[1..].iter().map(|&(x, y)| evento("drag", x, y)));
    gesto(&mut d, "preview", eventi);
    let (xn, yn) = *punti.last().unwrap();
    let esito = gesto(&mut d, "commit", vec![evento("up", xn, yn)]);
    let dopo = esito.ops.as_deref().map(|ops| {
        let ops: Value = serde_json::from_str(ops).expect("JSON");
        common::applica::applica(testo, &ops).expect("le operazioni si applicano")
    });
    (esito, dopo)
}

/// Un rettangolo storto, da (20, 180) a (90, 280), coi punti ogni 5.
fn rettangolo_a_mano() -> Vec<(f64, f64)> {
    let mut p = Vec::new();
    let lato = |a: (f64, f64), b: (f64, f64), p: &mut Vec<(f64, f64)>| {
        for i in 0..10 {
            let t = f64::from(i) / 10.0;
            p.push((
                a.0 + (b.0 - a.0) * t + (i % 2) as f64,
                a.1 + (b.1 - a.1) * t,
            ));
        }
    };
    lato((20.0, 180.0), (90.0, 181.0), &mut p);
    lato((90.0, 181.0), (89.0, 280.0), &mut p);
    lato((89.0, 280.0), (21.0, 279.0), &mut p);
    lato((21.0, 279.0), (20.0, 182.0), &mut p);
    p.push((20.0, 182.0));
    p
}

/// Uno scarabocchio a zig-zag da `x0` a `x1`, fra le quote `alto` e `basso`.
fn scarabocchio(x0: f64, x1: f64, alto: f64, basso: f64) -> Vec<(f64, f64)> {
    (0..12)
        .map(|i| {
            let x = x0 + (x1 - x0) * f64::from(i) / 11.0;
            (x, if i % 2 == 0 { alto } else { basso })
        })
        .collect()
}

#[test]
fn un_rettangolo_a_mano_diventa_un_rettangolo_pulito() {
    let (esito, dopo) = tratto(BASE, &rettangolo_a_mano());
    assert_eq!(esito.refused, None);
    let dopo = dopo.expect("il rettangolo si scrive");
    assert!(
        dopo.contains(
            r##"<rect x="20" y="180" width="70.9" height="100" fill="none" stroke="#000000""##
        ),
        "{dopo}"
    );
}

#[test]
fn uno_scarabocchio_su_una_forma_la_cancella_e_la_tiene_come_sorgente() {
    let (esito, dopo) = tratto(BASE, &scarabocchio(110.0, 187.0, 105.0, 145.0));
    assert_eq!(esito.refused, None);
    let dopo = dopo.expect("lo scarabocchio scrive");
    // Il rettangolo nero esce dal livello ed entra, trasparente, nelle
    // sorgenti del gruppo del Sagomatore, che va al suo posto con la ricetta.
    assert!(!dopo.contains(r#"id="oa1a1a1a1""#), "{dopo}");
    assert!(dopo.contains("vectorcraft:recipe"), "{dopo}");
    assert!(dopo.contains(r#"opacity="0"><rect"#), "{dopo}");
    let (_, perdite) = apri_e_perdite(&dopo);
    assert_eq!(perdite, 0, "il gruppo si riapre intero");
}

#[test]
fn uno_scarabocchio_su_due_forme_le_unisce_col_colore_della_prima_toccata() {
    let (esito, dopo) = tratto(BASE, &scarabocchio(180.0, 235.0, 110.0, 140.0));
    assert_eq!(esito.refused, None);
    let dopo = dopo.expect("lo scarabocchio scrive");
    assert!(!dopo.contains(r#"id="oa1a1a1a1""#), "{dopo}");
    assert!(!dopo.contains(r#"id="ob2b2b2b2""#), "{dopo}");
    assert!(
        dopo.contains(
            r##"d="M100 150 L100 100 L200 100 L200 150 Z M220 150 L220 100 L280 100 L280 150 Z" fill="#000000""##
        ),
        "{dopo}"
    );
    // Riaperto, il gruppo è ancora del Sagomatore: un altro scarabocchio sul
    // pezzo rosso lo cancella e riscrive il gruppo.
    let (_, perdite) = apri_e_perdite(&dopo);
    assert_eq!(perdite, 0);
    let (esito, ancora) = tratto(&dopo, &scarabocchio(225.0, 275.0, 105.0, 145.0));
    assert_eq!(esito.refused, None);
    let ancora = ancora.expect("il secondo scarabocchio scrive");
    // Resta il pezzo nero; il rosso è solo fra le sorgenti, trasparenti.
    assert!(
        ancora.contains(r##"fill="#ff0000"/></g><rect"##)
            && ancora.contains(r##"width="100" height="50" fill="#000000"/></g>"##),
        "{ancora}"
    );
    assert_eq!(ancora.matches("#ff0000").count(), 1, "{ancora}");
    assert_eq!(ancora.matches("vectorcraft:recipe ").count(), 1, "{ancora}");
}

/// Il doppio clic del Sagomatore su un gruppo sceglie la sorgente sotto il
/// puntatore e passa alla Selezione, come in VectorCraft (`ShaperTool`,
/// `Action::SwitchTool("selection")`).
#[test]
fn il_doppio_clic_su_un_gruppo_del_sagomatore_passa_alla_selezione() {
    let (_, dopo) = tratto(BASE, &scarabocchio(180.0, 235.0, 110.0, 140.0));
    let mut d = apri(&dopo.expect("lo scarabocchio scrive"));
    let esito = gesto(&mut d, "commit", vec![evento("double_click", 150.0, 125.0)]);
    assert_eq!(
        esito.state.as_ref().and_then(|s| s.switch_tool.as_deref()),
        Some("selection"),
        "{esito:?}"
    );
}
