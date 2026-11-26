//! La Fusione di VectorCraft (strumento `blend`, `object.blend.*`): gli oggetti
//! scelti diventano una fusione viva, che il file tiene con la ricetta.

#![cfg(feature = "completo")]

mod common;

use fub_abi::{DrawingCommandRequest, DrawingOutcome};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/dinamici/fusione-base.svg");

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
        "revision": d.revisione(),
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

const A: &str = "oa1a1a1a1";
const B: &str = "ob2b2b2b2";
const DORSO: &str = "oc3c3c3c3";

/// Il disegno con A e B fusi in 3 passi, e l'id del file della fusione.
fn con_la_fusione() -> (String, String) {
    let (mut d, _) = apri(BASE);
    let e = comando(&mut d, "object.blend.make", &[A, B], json!({"steps": 3}));
    let t = scritto(BASE, &e);
    let id = e.selection.first().cloned().expect("la fusione è scelta");
    (t, id)
}

/// I rettangoli di `testo` (le chiavi e i passi di una fusione).
fn rettangoli(testo: &str) -> usize {
    testo.matches("<rect id=\"o").count()
}

/// Il tipo del nodo di ogni ricetta del file.
fn ricette(testo: &str) -> Vec<String> {
    vectorcraft_svg::recipes(testo)
        .iter()
        .map(|r| {
            let byte = vectorcraft_svg::base64_decode(&r.data).expect("base64");
            let ricetta: Value = serde_json::from_slice(&byte).expect("JSON");
            ricetta["node"]["kind"]["type"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        })
        .collect()
}

fn spento(d: &Disegno, id: &str, scelti: &[&str]) -> Option<fub_abi::DrawingDisabledReason> {
    let scelti: Vec<String> = scelti.iter().map(|s| s.to_string()).collect();
    let info = d
        .comandi(&scelti)
        .into_iter()
        .find(|c| c.id == format!("disegno.{id}"))
        .expect("il comando c'è");
    assert_eq!(info.enabled, info.disabled_reason.is_none());
    info.disabled_reason
}

fn altro(testo: &str) -> Option<fub_abi::DrawingDisabledReason> {
    Some(fub_abi::DrawingDisabledReason::Other { text: testo.into() })
}

#[test]
fn crea_fusione_scrive_i_passi_con_la_ricetta_e_si_riapre_senza_perdite() {
    let (t, id) = con_la_fusione();
    // Le due chiavi e i tre passi, col colore di mezzo; A e B non sono più
    // elementi del file, stanno nella ricetta della fusione.
    assert_eq!(rettangoli(&t), 5, "{t}");
    assert!(t.contains("#800080"), "{t}");
    assert!(!t.contains(A) && !t.contains(B), "{t}");
    assert_eq!(ricette(&t), ["blend"]);
    let (mut d, perdite) = apri(&t);
    assert!(perdite.is_empty(), "{perdite:?}");
    // Info legge la fusione riaperta: 3 passi, l'id del file; le chiavi non
    // sono elementi del file.
    let e = comando(&mut d, "object.blend.info", &[&id], json!({}));
    let r = e.reading.expect("la lettura");
    assert_eq!(r["target"], "blend", "{r}");
    assert_eq!(r["steps"], 3);
    assert_eq!(r["id"], json!(id));
    assert_eq!(r["keys"], json!([null, null]));
}

#[test]
fn le_opzioni_cambiano_i_passi_della_fusione_scelta() {
    let (t, id) = con_la_fusione();
    let (mut d, _) = apri(&t);
    let e = comando(
        &mut d,
        "object.blend.options",
        &[&id],
        json!({"spacing": "steps", "value": 5, "easingType": "easeIn", "ramp": 0, "colorShift": 0}),
    );
    let t2 = scritto(&t, &e);
    assert_eq!(rettangoli(&t2), 7, "{t2}");
    let (mut d, perdite) = apri(&t2);
    assert!(perdite.is_empty(), "{perdite:?}");
    let e = comando(&mut d, "object.blend.info", &[&id], json!({}));
    assert_eq!(e.reading.expect("la lettura")["steps"], 5);
}

#[test]
fn rilascia_rende_le_chiavi_e_il_dorso_senza_ricetta() {
    let (t, id) = con_la_fusione();
    let (mut d, _) = apri(&t);
    let e = comando(&mut d, "object.blend.release", &[&id], json!({}));
    let t2 = scritto(&t, &e);
    assert!(ricette(&t2).is_empty(), "{t2}");
    // Le due chiavi tornano, il dorso resta come tracciato che non dipinge.
    assert!(t2.contains("#ff0000") && t2.contains("#0000ff"), "{t2}");
    assert!(!t2.contains("#800080"), "{t2}");
    assert_eq!(e.selection.len(), 3, "{e:?}");
    let (_, perdite) = apri(&t2);
    assert!(perdite.is_empty(), "{perdite:?}");
}

#[test]
fn espandi_fa_un_gruppo_dei_passi() {
    let (t, id) = con_la_fusione();
    let (mut d, _) = apri(&t);
    let e = comando(&mut d, "object.blend.expand", &[&id], json!({}));
    let t2 = scritto(&t, &e);
    assert!(ricette(&t2).iter().all(|r| r == "group"), "{t2}");
    assert_eq!(rettangoli(&t2), 5, "{t2}");
    let (_, perdite) = apri(&t2);
    assert!(perdite.is_empty(), "{perdite:?}");
}

#[test]
fn sostituisci_dorso_mette_i_passi_sulla_curva() {
    let (t, id) = con_la_fusione();
    let (mut d, _) = apri(&t);
    let e = comando(
        &mut d,
        "object.blend.replaceSpine",
        &[&id, DORSO],
        json!({}),
    );
    let t2 = scritto(&t, &e);
    // La curva è diventata il dorso: non è più un elemento del file, e le
    // chiavi stanno sui suoi capi.
    assert!(!t2.contains(DORSO), "{t2}");
    let (mut d, perdite) = apri(&t2);
    assert!(perdite.is_empty(), "{perdite:?}");
    let e = comando(&mut d, "object.blend.info", &[&id], json!({}));
    let r = e.reading.expect("la lettura");
    assert_eq!(r["spine"]["explicit"], true, "{r}");
    assert_eq!(r["spine"]["anchors"][0]["x"], 75.0, "{r}");
    // Un punto aggiunto al dorso dato dall'id del file della fusione.
    let e = comando(
        &mut d,
        "object.blend.spine.addAnchor",
        &[],
        json!({"id": id, "x": 200.0, "y": 212.5}),
    );
    let t3 = scritto(&t2, &e);
    let (mut d, _) = apri(&t3);
    let e = comando(&mut d, "object.blend.info", &[&id], json!({}));
    let r = e.reading.expect("la lettura");
    assert_eq!(
        r["spine"]["anchors"].as_array().map(Vec::len),
        Some(3),
        "{r}"
    );
}

#[test]
fn inverti_avanti_dietro_e_inverti_dorso_si_scrivono() {
    let (t, id) = con_la_fusione();
    let (mut d, _) = apri(&t);
    let e = comando(&mut d, "object.blend.reverseFrontToBack", &[&id], json!({}));
    let t2 = scritto(&t, &e);
    let (mut d, perdite) = apri(&t2);
    assert!(perdite.is_empty(), "{perdite:?}");
    // Il blu, che era sopra, ora è il primo disegnato.
    let rosso = t2.find("#ff0000").expect("il rosso");
    let blu = t2.find("#0000ff").expect("il blu");
    assert!(blu < rosso, "{t2}");
    let e = comando(&mut d, "object.blend.reverseSpine", &[&id], json!({}));
    assert_eq!(e.refused, None, "{e:?}");
}

#[test]
fn i_comandi_della_fusione_si_spengono_come_in_vectorcraft() {
    let (d, _) = apri(BASE);
    assert_eq!(
        spento(&d, "object.blend.make", &[]),
        Some(fub_abi::DrawingDisabledReason::NoSelection)
    );
    assert_eq!(
        spento(&d, "object.blend.make", &[A]),
        altro("Seleziona almeno due oggetti.")
    );
    assert_eq!(spento(&d, "object.blend.make", &[A, B]), None);
    assert_eq!(
        spento(&d, "object.blend.release", &[A]),
        altro("Seleziona una fusione.")
    );
    assert_eq!(
        spento(&d, "object.blend.expand", &[A, B]),
        altro("Seleziona una fusione.")
    );
    // Le opzioni senza fusione cambiano quelle delle fusioni nuove.
    assert_eq!(spento(&d, "object.blend.options", &[]), None);
    let (t, id) = con_la_fusione();
    let (d, _) = apri(&t);
    assert_eq!(spento(&d, "object.blend.release", &[&id]), None);
    assert_eq!(
        spento(&d, "object.blend.replaceSpine", &[&id]),
        altro("Seleziona una fusione e un tracciato.")
    );
    assert_eq!(spento(&d, "object.blend.replaceSpine", &[&id, DORSO]), None);
}

#[test]
fn le_opzioni_senza_fusione_valgono_per_le_fusioni_nuove() {
    let (mut d, _) = apri(BASE);
    let e = comando(
        &mut d,
        "object.blend.options",
        &[],
        // Tutta la finestra: senza fusione l'andamento e il colore restano fuori.
        json!({"spacing": "steps", "steps": 1, "distance": 10, "orientation": "page",
               "easingType": "easeOut", "ramp": 30, "colorShift": 20}),
    );
    assert_eq!(e.refused, None, "{e:?}");
    assert_eq!(e.ops, None, "{e:?}");
    assert_eq!(e.reading, Some(json!({"defaults": true})));
    let e = comando(&mut d, "object.blend.make", &[A, B], json!({}));
    let t = scritto(BASE, &e);
    assert_eq!(rettangoli(&t), 3, "{t}");
}

#[test]
fn lo_strumento_fonde_due_clic_e_il_terzo_aggiunge_alla_stessa_fusione() {
    let (mut d, _) = apri(BASE);
    // Il primo clic sceglie A e resta aperto; il secondo, su B, fa la fusione.
    let e = gesto(
        &mut d,
        "blend",
        &[],
        "preview",
        clic(75.0, 125.0, false, false),
    );
    assert_eq!(e.refused, None, "{e:?}");
    let e = gesto(
        &mut d,
        "blend",
        &[],
        "commit",
        clic(325.0, 125.0, false, false),
    );
    let t = scritto(BASE, &e);
    assert_eq!(ricette(&t), ["blend"], "{t}");
    let fusione = e.selection.first().cloned().expect("la fusione è scelta");
    assert!(t.contains(&format!("id=\"{fusione}\"")), "{t}");
    // Il client manda il testo nuovo; il clic dopo, sulla curva, aggiunge la
    // curva alla fusione appena fatta.
    let revision = d.revisione() + 1;
    d.sincronizza(fub_abi::DrawingSync {
        revision,
        change: fub_abi::DrawingChange::Text { text: t.clone() },
    })
    .expect("il testo passa");
    let e = gesto(
        &mut d,
        "blend",
        &[&fusione],
        "commit",
        clic(200.0, 212.5, false, false),
    );
    let poi = scritto(&t, &e);
    assert_eq!(ricette(&poi), ["blend"], "{poi}");
    let (mut d, perdite) = apri(&poi);
    assert!(perdite.is_empty(), "{perdite:?}");
    let scelta = e.selection.first().cloned().expect("la fusione è scelta");
    let info = comando(&mut d, "object.blend.info", &[&scelta], json!({}));
    let letto = info.reading.expect("la lettura");
    assert_eq!(letto["keys"].as_array().map(Vec::len), Some(3), "{letto}");
}
