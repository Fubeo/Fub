//! La Maglia di VectorCraft (strumento `mesh`, `object.mesh.*`): un tracciato
//! pieno diventa una maglia di sfumatura, che il file tiene con la ricetta.

#![cfg(feature = "completo")]

mod common;

use fub_abi::{DrawingCommandRequest, DrawingOutcome};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/trame/maglia-base.svg");

fn apri(testo: &str) -> (Disegno, Vec<String>) {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (d, aperto) = Disegno::apri_con(&disegni, testo).expect("il disegno si apre");
    (d, aperto.losses.iter().map(|l| format!("{l:?}")).collect())
}

#[allow(dead_code)]
fn comando(d: &mut Disegno, id: &str, scelti: &[&str], valore: Value) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: scelti.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    })
    .expect("il comando gira")
}

fn scritto(testo: &str, esito: &DrawingOutcome) -> String {
    assert_eq!(esito.refused, None, "{esito:?}");
    let ops: Value =
        serde_json::from_str(esito.ops.as_deref().expect("le operazioni")).expect("JSON");
    common::applica::applica(testo, &ops).expect("le operazioni si applicano")
}

fn gesto(
    d: &mut Disegno,
    strumento: &str,
    scelti: &[&str],
    phase: &str,
    eventi: Vec<Value>,
) -> DrawingOutcome {
    gesto_con(
        d,
        json!({ "engine": { "id": strumento } }),
        scelti,
        phase,
        eventi,
    )
}

fn gesto_con(
    d: &mut Disegno,
    strumento: Value,
    scelti: &[&str],
    phase: &str,
    eventi: Vec<Value>,
) -> DrawingOutcome {
    let g: fub_abi::DrawingGesture = serde_json::from_value(json!({
        "phase": phase,
        "tool": strumento,
        "layer": null,
        "selection": scelti,
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": { "stroke": "#0000ff", "width": 3, "fill": "#ff0000" },
        "events": eventi,
        "inputs": [],
    }))
    .expect("il gesto si legge");
    d.gesto(g).expect("il gesto")
}

fn ev(kind: &str, x: f64, y: f64, shift: bool, alt: bool) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": shift, "alt": alt, "cmd": false })
}

fn clic(x: f64, y: f64, shift: bool, alt: bool) -> Vec<Value> {
    vec![ev("down", x, y, shift, alt), ev("up", x, y, shift, alt)]
}

/// Una maglia nata da un clic dentro il rettangolo pieno: il file che ne esce.
fn con_la_maglia() -> String {
    let (mut d, _) = apri(BASE);
    let e = gesto(
        &mut d,
        "mesh",
        &[],
        "commit",
        clic(150.0, 150.0, false, false),
    );
    scritto(BASE, &e)
}

/// Quanti punti della maglia, nella ricetta del file, hanno il colore
/// `[r, g, b]` (da 0 a 1), e quanti sono in tutto.
fn punti_col_colore(testo: &str, rgb: [f64; 3]) -> (usize, usize) {
    let ricette = vectorcraft_svg::recipes(testo);
    assert_eq!(ricette.len(), 1, "{testo}");
    let byte = vectorcraft_svg::base64_decode(&ricette[0].data).expect("base64");
    let ricetta: Value = serde_json::from_slice(&byte).expect("JSON");
    let punti = ricetta["node"]["kind"]["points"]
        .as_array()
        .expect("i punti")
        .clone();
    let uguali = punti
        .iter()
        .filter(|p| {
            let c = &p["color"];
            ["r", "g", "b"]
                .iter()
                .zip(rgb)
                .all(|(k, v)| (c[k].as_f64().unwrap_or(-1.0) - v).abs() < 1e-3)
        })
        .count();
    (uguali, punti.len())
}

const VERDE: [f64; 3] = [0.0, 1.0, 0.0];
const BLU: [f64; 3] = [0.2, 0.4, 0.8];

#[test]
fn un_clic_dentro_un_tracciato_pieno_fa_la_maglia_che_si_riapre_senza_perdite() {
    let t = con_la_maglia();
    assert!(t.contains("vectorcraft:recipe"), "{t}");
    assert!(
        !t.contains("M100 100 L300 100"),
        "il tracciato è diventato maglia: {t}"
    );
    let (_, perdite) = apri(&t);
    assert!(perdite.is_empty(), "{perdite:?}");
}

#[test]
fn un_secondo_clic_aggiunge_una_linea_alla_maglia() {
    let t = con_la_maglia();
    let (mut d, _) = apri(&t);
    let e = gesto(
        &mut d,
        "mesh",
        &["oa1a1a1a1"],
        "commit",
        clic(250.0, 130.0, false, false),
    );
    let t2 = scritto(&t, &e);
    assert_ne!(t, t2);
    assert!(t2.len() > t.len(), "più punti, più testo");
}

#[test]
fn trascinare_un_punto_lo_sposta() {
    let t = con_la_maglia();
    let (mut d, _) = apri(&t);
    let e = gesto(
        &mut d,
        "mesh",
        &["oa1a1a1a1"],
        "commit",
        vec![
            ev("down", 150.0, 150.0, false, false),
            ev("drag", 170.0, 160.0, false, false),
            ev("up", 170.0, 160.0, false, false),
        ],
    );
    let t2 = scritto(&t, &e);
    assert_ne!(t, t2);
}

#[test]
fn il_colore_pieno_va_solo_ai_punti_scelti_con_la_maglia() {
    let t = con_la_maglia();
    assert_eq!(punti_col_colore(&t, BLU), (9, 9));
    let (mut d, _) = apri(&t);
    // Un clic sul punto in mezzo lo sceglie e non cambia il disegno.
    let e = gesto(
        &mut d,
        "mesh",
        &["oa1a1a1a1"],
        "commit",
        clic(150.0, 150.0, false, false),
    );
    assert!(e.ops.is_none(), "{e:?}");
    let e = comando(
        &mut d,
        "paint.setFill",
        &["oa1a1a1a1"],
        json!({"color": "#00ff00"}),
    );
    let t2 = scritto(&t, &e);
    // Solo il punto in mezzo diventa verde; gli altri otto restano blu.
    assert_eq!(punti_col_colore(&t2, VERDE), (1, 9));
    assert_eq!(punti_col_colore(&t2, BLU), (8, 9));
}

#[test]
fn senza_punti_scelti_il_colore_pieno_non_tocca_i_punti_della_maglia() {
    let t = con_la_maglia();
    let (mut d, _) = apri(&t);
    let e = comando(
        &mut d,
        "paint.setFill",
        &["oa1a1a1a1"],
        json!({"color": "#00ff00"}),
    );
    let t2 = scritto(&t, &e);
    // Come in VectorCraft: il colore va al riempimento dell'oggetto, i punti
    // tengono i loro colori.
    assert_eq!(punti_col_colore(&t2, BLU), (9, 9));
}

#[test]
fn un_altro_strumento_dimentica_i_punti_della_maglia() {
    let t = con_la_maglia();
    let (mut d, _) = apri(&t);
    let _ = gesto(
        &mut d,
        "mesh",
        &["oa1a1a1a1"],
        "commit",
        clic(150.0, 150.0, false, false),
    );
    // Un clic della Selezione: lo strumento Maglia non è più quello attivo.
    let _ = gesto_con(
        &mut d,
        json!("select"),
        &["oa1a1a1a1"],
        "commit",
        clic(150.0, 150.0, false, false),
    );
    let e = comando(
        &mut d,
        "paint.setFill",
        &["oa1a1a1a1"],
        json!({"color": "#00ff00"}),
    );
    let t2 = scritto(&t, &e);
    assert_eq!(punti_col_colore(&t2, BLU), (9, 9));
}

#[test]
fn la_trasparenza_sfuma_solo_i_punti_scelti_con_la_maglia() {
    let t = con_la_maglia();
    let (mut d, _) = apri(&t);
    let _ = gesto(
        &mut d,
        "mesh",
        &["oa1a1a1a1"],
        "commit",
        clic(150.0, 150.0, false, false),
    );
    let e = comando(
        &mut d,
        "transparency.set",
        &["oa1a1a1a1"],
        json!({"opacity": 40}),
    );
    let t2 = scritto(&t, &e);
    let ricette = vectorcraft_svg::recipes(&t2);
    let byte = vectorcraft_svg::base64_decode(&ricette[0].data).expect("base64");
    let ricetta: Value = serde_json::from_slice(&byte).expect("JSON");
    let opacita: Vec<f64> = ricetta["node"]["kind"]["points"]
        .as_array()
        .expect("i punti")
        .iter()
        .map(|p| p["opacity"].as_f64().unwrap_or(1.0))
        .collect();
    assert_eq!(
        opacita.iter().filter(|o| (**o - 0.4).abs() < 1e-3).count(),
        1,
        "{opacita:?}"
    );
    assert_eq!(
        opacita.iter().filter(|o| (**o - 1.0).abs() < 1e-3).count(),
        8,
        "{opacita:?}"
    );
}

#[test]
fn object_mesh_create_dalla_finestra_fa_la_trama_con_righe_e_colonne() {
    let (mut d, _) = apri(BASE);
    let e = comando(
        &mut d,
        "object.mesh.create",
        &["oa1a1a1a1"],
        json!({"rows": 2, "cols": 3, "appearance": "center", "highlight": 50}),
    );
    let t = scritto(BASE, &e);
    // 3 righe di punti per 4 colonne.
    let (_, tutti) = punti_col_colore(&t, BLU);
    assert_eq!(tutti, 12, "{t}");
    let (_, perdite) = apri(&t);
    assert!(perdite.is_empty(), "{perdite:?}");
}

#[test]
fn i_comandi_sui_punti_trovano_la_trama_dall_id_del_file_o_dalla_selezione() {
    let t = con_la_maglia();
    // Colore di un punto, con l'id del file.
    let (mut d, _) = apri(&t);
    let e = comando(
        &mut d,
        "object.mesh.setPointColor",
        &[],
        json!({"id": "oa1a1a1a1", "index": 4, "color": "#00ff00"}),
    );
    let t2 = scritto(&t, &e);
    assert_eq!(punti_col_colore(&t2, VERDE), (1, 9));
    // Senza id: la trama scelta.
    let (mut d, _) = apri(&t);
    let e = comando(
        &mut d,
        "object.mesh.setPointColor",
        &["oa1a1a1a1"],
        json!({"points": [0, 8], "color": "#00ff00"}),
    );
    assert_eq!(punti_col_colore(&scritto(&t, &e), VERDE), (2, 9));
    // Sposta, aggiungi una linea, togli le linee di un punto.
    for (id, valore) in [
        (
            "object.mesh.movePoint",
            json!({"index": 4, "x": 170, "y": 160}),
        ),
        (
            "object.mesh.movePoints",
            json!({"items": [{"id": "oa1a1a1a1", "points": [4]}], "dx": 5, "dy": 0}),
        ),
        ("object.mesh.addLine", json!({"x": 250, "y": 130})),
        ("object.mesh.deletePoint", json!({"index": 4})),
    ] {
        let (mut d, _) = apri(&t);
        let e = comando(&mut d, id, &["oa1a1a1a1"], valore);
        assert_ne!(scritto(&t, &e), t, "{id}");
    }
}

#[test]
fn espandi_trama_sfumatura_vuole_una_trama_scelta() {
    let t = con_la_maglia();
    let (mut d, _) = apri(&t);
    let e = comando(&mut d, "object.mesh.expand", &["oa1a1a1a1"], json!({}));
    let t2 = scritto(&t, &e);
    // La trama è diventata un gruppo di pezzi a tinta piatta (la ricetta, se
    // c'è, tiene solo i numeri esatti dei pezzi).
    for r in vectorcraft_svg::recipes(&t2) {
        let byte = vectorcraft_svg::base64_decode(&r.data).expect("base64");
        let ricetta: Value = serde_json::from_slice(&byte).expect("JSON");
        assert_eq!(ricetta["node"]["kind"]["type"], "group", "{ricetta}");
    }
    assert_eq!(t2.matches("<polygon").count(), 4, "{t2}");
    // Sul rettangolo pieno (non una trama) il comando è spento.
    let (d, _) = apri(BASE);
    let info = d
        .comandi(&["oa1a1a1a1".to_string()])
        .into_iter()
        .find(|c| c.id == "disegno.object.mesh.expand")
        .expect("il comando c'è");
    assert!(!info.enabled);
    assert_eq!(
        info.disabled_reason,
        Some(fub_abi::DrawingDisabledReason::Other {
            text: "Seleziona una trama sfumatura.".into()
        })
    );
}
