//! Gli strumenti dei grafici del Disegno completo (`vendor/vectorcraft/crates/tools/src/graph.rs`,
//! famiglia `grafici`): il trascinamento disegna un grafico scelto, i dati scritti in CSV cambiano
//! le serie, e le cinque finestre del grafico leggono i loro valori senza valori mandati.
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

fn comando(d: &mut Disegno, id: &str, scelti: &[String], valore: Value) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: id.into(),
        selection: scelti.to_vec(),
        value: valore,
        preview: false,
    })
    .expect("il comando gira")
}

#[test]
fn il_trascinamento_disegna_un_grafico_che_legge_e_cambia_i_suoi_dati() {
    let mut d = apri(BASE);
    let e = gesto(
        &mut d,
        "columnGraph",
        "commit",
        tratto((60.0, 60.0), (260.0, 200.0)),
    );
    let testo = scritto(BASE, &e);
    assert_eq!(e.selection.len(), 1, "il grafico nuovo è scelto: {e:?}");
    let grafico = e.selection.clone();

    let mut d = apri(&testo);
    let letto = comando(&mut d, "disegno.graph.setData", &grafico, json!({}));
    assert_eq!(letto.refused, None, "{letto:?}");
    assert!(letto.ops.is_none(), "una lettura non scrive");
    let r = letto.reading.expect("la lettura dei dati");
    assert!(
        r["series"].is_array() && r["categories"].is_array() && r["rows"].is_array(),
        "{r}"
    );

    let cambiato = comando(
        &mut d,
        "disegno.graph.setData",
        &grafico,
        json!({ "csv": ",\"Mele\",\"Pere\"\n\"2024\",1,2\n\"2025\",3,4" }),
    );
    // Il disegno riaperto dal testo scritto ha i dati nuovi.
    let testo = scritto(&testo, &cambiato);
    let mut d = apri(&testo);
    let scelti = if cambiato.selection.is_empty() {
        grafico
    } else {
        cambiato.selection.clone()
    };
    let r = comando(&mut d, "disegno.graph.setData", &scelti, json!({}))
        .reading
        .expect("i dati nuovi");
    assert_eq!(r["series"], json!(["Mele", "Pere"]));
    assert_eq!(r["categories"], json!(["2024", "2025"]));
    assert_eq!(r["rows"], json!([[1.0, 2.0], [3.0, 4.0]]));

    for id in [
        "disegno.graph.setType",
        "disegno.graph.column",
        "disegno.graph.marker",
        "disegno.graph.design",
    ] {
        let o = comando(&mut d, id, &scelti, json!({}));
        assert_eq!(o.refused, None, "{id}: {o:?}");
        assert!(o.ops.is_none(), "{id} legge e non scrive");
        assert!(o.reading.is_some(), "{id} dà una lettura");
    }
    let tipo = comando(&mut d, "disegno.graph.setType", &scelti, json!({}))
        .reading
        .unwrap();
    assert_eq!(tipo["type"], "column");
}

#[test]
fn ogni_strumento_disegna_il_suo_tipo() {
    for (strumento, tipo) in [
        ("columnGraph", "column"),
        ("stackedColumnGraph", "stackedColumn"),
        ("barGraph", "bar"),
        ("stackedBarGraph", "stackedBar"),
        ("lineGraph", "line"),
        ("areaGraph", "area"),
        ("scatterGraph", "scatter"),
        ("pieGraph", "pie"),
        ("radarGraph", "radar"),
    ] {
        let mut d = apri(BASE);
        let e = gesto(
            &mut d,
            strumento,
            "commit",
            tratto((40.0, 40.0), (200.0, 160.0)),
        );
        let testo = scritto(BASE, &e);
        let mut d = apri(&testo);
        let r = comando(&mut d, "disegno.graph.setType", &e.selection, json!({}))
            .reading
            .unwrap_or_else(|| panic!("{strumento}: la lettura del tipo"));
        assert_eq!(r["type"], tipo, "{strumento}");
    }
}
