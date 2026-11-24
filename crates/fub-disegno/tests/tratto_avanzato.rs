//! Il tratto «come VectorCraft» che la scena non dice con un attributo:
//! l'allineamento dentro o fuori, il tratteggio adattato agli angoli e le
//! frecce. Il motore li disegna in SVG (un ritaglio per il tratto dentro, una
//! maschera per quello fuori, il tratteggio e le punte come tracciati) e li
//! ricorda con la sua ricetta, così un altro comando sullo stesso oggetto li
//! ritrova dopo la riapertura e un lettore senza Fub vede lo stesso disegno.
#![cfg(feature = "completo")]

mod common;

use common::{apri, ops_di};
use fub_abi::{DrawingCommandRequest, DrawingOutcome};
use serde_json::{json, Value};

const LINEA: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300">
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <g id="l1a2b3c4d" fub:layer="Livello 1">
    <rect id="oa1a1a1a1" x="100" y="100" width="100" height="50" fill="#ff0000" stroke="#000000" stroke-width="2"/>
    <path id="op1p1p1p1" d="M50 250 L150 250 L150 200" fill="none" stroke="#000000"/>
  </g>
</svg>
"##;

fn tratto(d: &mut fub_disegno::motore::Disegno, id: &str, valore: Value) -> DrawingOutcome {
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.stroke.set".into(),
            selection: vec![id.into()],
            value: valore,
            preview: false,
        })
        .expect("il comando passa");
    assert_eq!(esito.refused, None, "{esito:?}");
    esito
}

/// Applica il comando, riapre il testo senza perdite e ci rimanda un altro
/// comando (lo spessore): il testo che ne esce deve tenere ancora `segno`.
fn resta_dopo_la_riapertura(id: &str, valore: Value, segno: &str) {
    let (mut d, _) = apri(LINEA);
    let ops = ops_di(&tratto(&mut d, id, valore));
    let testo = common::applica::applica(LINEA, &ops).expect("la scena accetta");
    assert!(testo.contains(segno), "{testo}");
    assert!(testo.contains("vectorcraft:recipe"), "{testo}");
    let (mut riaperto, aperto) = apri(&testo);
    assert!(aperto.losses.is_empty(), "{:?}", aperto.losses);
    let ops = ops_di(&tratto(&mut riaperto, id, json!({"weight": 3})));
    let ancora = common::applica::applica(&testo, &ops).expect("la scena accetta");
    assert!(ancora.contains(segno), "{ancora}");
}

#[test]
fn il_tratto_dentro_e_un_ritaglio() {
    resta_dopo_la_riapertura("oa1a1a1a1", json!({"align": "inside"}), "clip-path=\"url(#");
}

#[test]
fn il_tratto_fuori_e_una_maschera() {
    resta_dopo_la_riapertura("oa1a1a1a1", json!({"align": "outside"}), "mask=\"url(#");
}

#[test]
fn il_tratteggio_adattato_agli_angoli_si_disegna() {
    // VectorCraft allunga i trattini perché ogni angolo ne abbia uno intero:
    // il tratteggio diventa un tracciato pieno, senza `stroke-dasharray`.
    let (mut d, _) = apri(LINEA);
    let ops = ops_di(&tratto(
        &mut d,
        "oa1a1a1a1",
        json!({"dash": [10, 4], "alignDashes": true}),
    ))
    .to_string();
    assert!(!ops.contains("stroke-dasharray"), "{ops}");
    resta_dopo_la_riapertura(
        "oa1a1a1a1",
        json!({"dash": [10, 4], "alignDashes": true}),
        "<polygon",
    );
}

#[test]
fn le_frecce_sono_punte_disegnate() {
    let (mut d, _) = apri(LINEA);
    let ops = ops_di(&tratto(
        &mut d,
        "op1p1p1p1",
        json!({"startArrow": "Arrow", "endArrow": "Circle", "weight": 2}),
    ))
    .to_string();
    // La linea più le due punte, ognuna un tracciato pieno.
    assert!(ops.matches("<path ").count() >= 3, "{ops}");
    resta_dopo_la_riapertura(
        "op1p1p1p1",
        json!({"endArrow": "Triangle"}),
        "<g id=\"op1p1p1p1\">",
    );
}

#[test]
fn su_un_tracciato_chiuso_la_freccia_si_ricorda_ma_non_si_disegna() {
    // Come VectorCraft: le punte stanno solo agli estremi di un tracciato
    // aperto; su un rettangolo restano nella ricetta, pronte se si apre.
    let (mut d, _) = apri(LINEA);
    let ops = ops_di(&tratto(
        &mut d,
        "oa1a1a1a1",
        json!({"endArrow": "Triangle"}),
    ))
    .to_string();
    assert!(ops.contains("<rect id=\\\"oa1a1a1a1\\\""), "{ops}");
    assert!(ops.contains("vectorcraft:recipe"), "{ops}");
}

/// La scala delle frecce (`stroke.setAdvanced`): la punta disegnata cresce, e
/// la ricetta ricorda la scala dopo la riapertura, dove la lettura del nodo la
/// dà al pannello insieme a `canAlign`.
#[test]
fn la_scala_delle_frecce_si_ricorda() {
    let (mut d, _) = apri(LINEA);
    let ops = ops_di(&tratto(
        &mut d,
        "op1p1p1p1",
        json!({"endArrow": "Triangle"}),
    ));
    let testo = common::applica::applica(LINEA, &ops).expect("la scena accetta");
    let (mut d, _) = apri(&testo);
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.stroke.setAdvanced".into(),
            selection: vec!["op1p1p1p1".into()],
            value: json!({"arrowScale": [100, 250]}),
            preview: false,
        })
        .expect("il comando passa");
    assert_eq!(esito.refused, None, "{esito:?}");
    let grande = common::applica::applica(&testo, &ops_di(&esito)).expect("la scena accetta");
    assert_ne!(grande, testo);
    let (mut d, aperto) = apri(&grande);
    assert!(aperto.losses.is_empty(), "{:?}", aperto.losses);
    let nodo = |d: &mut fub_disegno::motore::Disegno, id: &str| {
        d.comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.document.node".into(),
            selection: vec![],
            value: json!({"id": id, "summary": true}),
            preview: false,
        })
        .expect("la lettura passa")
        .reading
        .expect("c'è una lettura")
    };
    let aperto = nodo(&mut d, "op1p1p1p1");
    assert_eq!(aperto["strokeOptions"]["arrowScale"], json!([100.0, 250.0]));
    assert_eq!(aperto["strokeOptions"]["endArrow"], json!("Triangle"));
    assert_eq!(aperto["strokeOptions"]["canAlign"], json!(false));
    assert_eq!(
        nodo(&mut d, "oa1a1a1a1")["strokeOptions"]["canAlign"],
        json!(true)
    );
}

/// Lo scambio delle punte porta la freccia dalla fine all'inizio.
#[test]
fn lo_scambio_porta_la_freccia_all_inizio() {
    let (mut d, _) = apri(LINEA);
    let ops = ops_di(&tratto(&mut d, "op1p1p1p1", json!({"endArrow": "Circle"})));
    let testo = common::applica::applica(LINEA, &ops).expect("la scena accetta");
    let (mut d, _) = apri(&testo);
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.stroke.setAdvanced".into(),
            selection: vec!["op1p1p1p1".into()],
            value: json!({"swapArrows": true}),
            preview: false,
        })
        .expect("il comando passa");
    assert_eq!(esito.refused, None, "{esito:?}");
    let scambiato = common::applica::applica(&testo, &ops_di(&esito)).expect("la scena accetta");
    let (mut d, _) = apri(&scambiato);
    let lettura = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.document.node".into(),
            selection: vec![],
            value: json!({"id": "op1p1p1p1", "summary": true}),
            preview: false,
        })
        .expect("la lettura passa")
        .reading
        .expect("c'è una lettura");
    assert_eq!(lettura["strokeOptions"]["startArrow"], json!("Circle"));
    assert_eq!(lettura["strokeOptions"]["endArrow"], Value::Null);
}

/// Il profilo rovesciato e il pennello non hanno ancora una forma nel file.
#[test]
fn profilo_e_pennello_restano_fuori() {
    for valore in [json!({"flipProfile": "along"}), json!({"brush": "Gesso"})] {
        let (mut d, _) = apri(LINEA);
        let esito = d
            .comando(DrawingCommandRequest {
                revision: d.revisione(),
                id: "disegno.stroke.setAdvanced".into(),
                selection: vec!["oa1a1a1a1".into()],
                value: valore,
                preview: false,
            })
            .expect("il comando risponde");
        assert_eq!(esito.refused, Some(fub_abi::DrawingRefusal::Unsupported));
    }
}
