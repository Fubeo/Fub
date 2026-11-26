//! La Pittura dinamica di VectorCraft (`livePaint.*`, `builder/live_paint.rs`):
//! i tracciati diventano un gruppo di facce e bordi che si colorano uno per
//! uno, e il file tiene il gruppo vivo con la ricetta.

#![cfg(feature = "completo")]

mod common;

use fub_abi::{DrawingCommandRequest, DrawingOutcome, DrawingRefusal};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/trame/pittura-dinamica.svg");

fn apri(testo: &str) -> (Disegno, usize) {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (d, aperto) = Disegno::apri_con(&disegni, testo).expect("il disegno si apre");
    (d, aperto.losses.len())
}

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

/// L'id del gruppo della Pittura dinamica nel file: il primo `g` dentro il livello.
fn gruppo(testo: &str) -> String {
    testo
        .split("<g id=\"")
        .nth(2)
        .and_then(|t| t.split('"').next())
        .expect("il gruppo")
        .to_string()
}

/// Il file con i due quadrati fatti vivi, e l'id del gruppo.
fn vivo() -> (String, String) {
    let (mut d, _) = apri(BASE);
    let esito = comando(
        &mut d,
        "livePaint.make",
        &["oa1a1a1a1", "ob2b2b2b2"],
        json!({}),
    );
    let dopo = scritto(BASE, &esito);
    let g = gruppo(&dopo);
    (dopo, g)
}

/// Il comando `id` su `testo` riaperto, con `scelti`: il file scritto, che
/// si riapre senza perdite.
fn dopo(testo: &str, id: &str, scelti: &[&str], valore: Value) -> (String, DrawingOutcome) {
    let (mut d, _) = apri(testo);
    let esito = comando(&mut d, id, scelti, valore);
    let t = scritto(testo, &esito);
    let (_, perdite) = apri(&t);
    assert_eq!(perdite, 0, "{id}: il file si riapre senza perdite\n{t}");
    (t, esito)
}

/// Le facce e i bordi del gruppo `g` secondo il motore, dal file riaperto.
fn info(testo: &str, g: &str) -> Value {
    let (mut d, _) = apri(testo);
    let esito = comando(&mut d, "livePaint.info", &[g], json!({}));
    assert_eq!(esito.refused, None);
    esito.reading.expect("la lettura")
}

#[test]
fn crea_toglie_i_tracciati_e_il_file_tiene_il_gruppo_vivo() {
    let (t, g) = vivo();
    assert!(!t.contains("oa1a1a1a1") && !t.contains("ob2b2b2b2"), "{t}");
    assert!(
        t.contains("vectorcraft:recipe"),
        "la ricetta tiene il gruppo vivo"
    );
    let (_, perdite) = apri(&t);
    assert_eq!(perdite, 0);
    // Due quadrati che si sovrappongono: tre facce.
    let info = info(&t, &g);
    assert_eq!(info["faces"].as_array().map(Vec::len), Some(3), "{info}");
}

#[test]
fn riempi_colora_la_faccia_sotto_il_punto_e_il_gruppo_tiene_il_suo_id() {
    let (t, g) = vivo();
    let (t, esito) = dopo(
        &t,
        "livePaint.fill",
        &[&g],
        json!({ "point": [175, 175], "color": "#ff0000" }),
    );
    assert_eq!(esito.selection, vec![g.clone()]);
    assert_eq!(gruppo(&t), g, "il gruppo tiene il suo id");
    assert!(
        t.contains(r##"x="150" y="150" width="50" height="50" fill="#ff0000""##),
        "{t}"
    );
    // Il motore lo legge ancora vivo dopo la riapertura.
    let info = info(&t, &g);
    let rosse = info["faces"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["fill"] != "None")
        .count();
    assert_eq!(rosse, 1, "{info}");
}

#[test]
fn riempi_sui_tracciati_li_fa_vivi_prima() {
    let (t, _) = dopo(
        BASE,
        "livePaint.fill",
        &["oa1a1a1a1", "ob2b2b2b2"],
        json!({ "point": [120, 120], "color": "#00ff00" }),
    );
    assert!(
        !t.contains("oa1a1a1a1") && t.contains(r##"fill="#00ff00""##),
        "{t}"
    );
}

#[test]
fn bordo_colora_il_lato_vicino_al_punto() {
    let (t, g) = vivo();
    let (t, _) = dopo(
        &t,
        "livePaint.strokeEdge",
        &[&g],
        json!({ "point": [150, 175], "color": "#0000ff", "width": 3 }),
    );
    assert_eq!(gruppo(&t), g);
    assert!(t.contains(r##"stroke="#0000ff" stroke-width="3""##), "{t}");
}

#[test]
fn bordo_e_info_senza_un_gruppo_vivo_non_fanno_niente() {
    let (mut d, _) = apri(BASE);
    for id in ["livePaint.strokeEdge", "livePaint.info"] {
        let esito = comando(&mut d, id, &["oa1a1a1a1"], json!({ "point": [100, 150] }));
        assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "{id}");
    }
}

#[test]
fn rilascia_rende_i_tracciati_e_toglie_la_ricetta() {
    let (t, g) = vivo();
    let (t, esito) = dopo(&t, "livePaint.release", &[&g], json!({}));
    assert_eq!(esito.selection.len(), 2);
    assert!(!t.contains(&g) && !t.contains("vectorcraft:recipe"), "{t}");
    assert_eq!(t.matches("<path ").count(), 2, "{t}");
}

#[test]
fn espandi_lascia_un_gruppo_semplice_coi_pezzi_dipinti() {
    let (t, g) = vivo();
    let (t, _) = dopo(
        &t,
        "livePaint.fill",
        &[&g],
        json!({ "point": [175, 175], "color": "#ff0000" }),
    );
    let (t, _) = dopo(&t, "livePaint.expand", &[&g], json!({}));
    assert!(
        t.contains(r##"fill="#ff0000""##) && t.contains("<polyline"),
        "{t}"
    );
    // Le facce senza colore se ne vanno: resta solo quella rossa.
    assert_eq!(
        t.matches("<polygon").count() + t.matches("<rect id=\"o").count(),
        1,
        "{t}"
    );
    let (mut d, _) = apri(&t);
    let esito = comando(&mut d, "livePaint.info", &[&g], json!({}));
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "non è più vivo");
}

#[test]
fn unisci_porta_un_tracciato_nel_gruppo_di_prima() {
    let (mut d, _) = apri(BASE);
    let esito = comando(&mut d, "livePaint.make", &["oa1a1a1a1"], json!({}));
    let uno = scritto(BASE, &esito);
    let g = gruppo(&uno);
    assert_eq!(info(&uno, &g)["faces"].as_array().map(Vec::len), Some(1));
    let (t, esito) = dopo(&uno, "livePaint.merge", &[&g, "ob2b2b2b2"], json!({}));
    assert_eq!(esito.selection, vec![g.clone()]);
    assert!(
        !t.contains("ob2b2b2b2"),
        "il tracciato entra nel gruppo\n{t}"
    );
    assert_eq!(info(&t, &g)["faces"].as_array().map(Vec::len), Some(3));
}

#[test]
fn le_opzioni_delle_aperture_restano_nel_file() {
    let (t, g) = vivo();
    let (t, _) = dopo(
        &t,
        "livePaint.gapOptions",
        &[&g],
        json!({ "detect": true, "size": "large" }),
    );
    let info = info(&t, &g);
    assert_eq!(info["gapOptions"]["detect"], true, "{info}");
    assert_eq!(info["gapOptions"]["size"], "large", "{info}");
}

fn gesto(
    d: &mut Disegno,
    strumento: &str,
    scelti: &[&str],
    phase: &str,
    eventi: Vec<Value>,
) -> DrawingOutcome {
    let g: fub_abi::DrawingGesture = serde_json::from_value(json!({
        "phase": phase,
        "tool": { "engine": { "id": strumento } },
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

fn clic(x: f64, y: f64, shift: bool, alt: bool) -> Vec<Value> {
    let e = |kind: &str| json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": shift, "alt": alt, "cmd": false });
    vec![e("down"), e("up")]
}

/// Il `fill` della faccia quadrata in mezzo (150–200), quella dove i due
/// quadrati si sovrappongono.
fn riempimento_in_mezzo(testo: &str) -> &str {
    const PRIMA: &str = r#"x="150" y="150" width="50" height="50" fill=""#;
    let da = testo.find(PRIMA).expect("la faccia in mezzo") + PRIMA.len();
    let fine = testo[da..].find('"').expect("la fine") + da;
    &testo[da..fine]
}

#[test]
fn il_secchiello_colora_la_faccia_sotto_il_clic() {
    let (t, g) = vivo();
    let (mut d, _) = apri(&t);
    let e = gesto(
        &mut d,
        "livePaintBucket",
        &[],
        "commit",
        clic(175.0, 175.0, false, false),
    );
    assert_eq!(e.refused, None, "{e:?}");
    let poi = scritto(&t, &e);
    assert_eq!(riempimento_in_mezzo(&poi), "#ff0000", "{poi}");
    // Il gruppo resta lui, e si riapre intero.
    assert!(poi.contains(&format!(r#"<g id="{g}""#)), "{poi}");
    let (_, perdite) = apri(&poi);
    assert_eq!(perdite, 0);
}

#[test]
fn la_selezione_pittura_sceglie_la_faccia_e_il_colore_la_riempie() {
    let (t, g) = vivo();
    let (mut d, _) = apri(&t);
    let e = gesto(
        &mut d,
        "livePaintSelection",
        &[&g],
        "commit",
        clic(175.0, 175.0, false, false),
    );
    // Scegliere non scrive niente: la faccia è la selezione nuova.
    assert_eq!(e.refused, Some(DrawingRefusal::Empty));
    let faccia = t
        .find(r#"<rect id="o"#)
        .map(|i| &t[i + 10..i + 19])
        .expect("la faccia");
    assert_eq!(e.selection, vec![faccia.to_string()]);
    let e = comando(
        &mut d,
        "paint.setFill",
        &[faccia],
        json!({ "color": "#00ff00" }),
    );
    assert_eq!(e.refused, None, "{e:?}");
    let poi = scritto(&t, &e);
    assert_eq!(riempimento_in_mezzo(&poi), "#00ff00", "{poi}");
    let (_, perdite) = apri(&poi);
    assert_eq!(perdite, 0);
}

#[test]
fn un_clic_fuori_dalle_facce_toglie_la_selezione() {
    let (t, g) = vivo();
    let (mut d, _) = apri(&t);
    let e = gesto(
        &mut d,
        "livePaintSelection",
        &[&g],
        "commit",
        clic(350.0, 280.0, false, false),
    );
    assert!(e.selection.is_empty(), "{e:?}");
}
