//! Gli Oggetti sul tracciato di VectorCraft (strumento `objectsOnPath`,
//! `object.objectsOnPath.*`): gli oggetti scelti si attaccano a un tracciato
//! in un gruppo vivo, che il file tiene con la ricetta.

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

const A: &str = "oa1a1a1a1";
const B: &str = "ob2b2b2b2";
const TRACCIATO: &str = "oc3c3c3c3";

/// Il tipo del nodo di ogni ricetta del file, con il suo record degli
/// Oggetti sul tracciato se ne ha uno.
fn ricette(testo: &str) -> Vec<(String, Option<Value>)> {
    vectorcraft_svg::recipes(testo)
        .iter()
        .map(|r| {
            let byte = vectorcraft_svg::base64_decode(&r.data).expect("base64");
            let ricetta: Value = serde_json::from_slice(&byte).expect("JSON");
            let nodo = &ricetta["node"];
            (
                nodo["kind"]["type"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                nodo.get("objects_on_path").cloned(),
            )
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

/// Il disegno con A e B attaccati al tracciato, e l'id del file del gruppo.
fn attaccati() -> (String, String) {
    let (mut d, _) = apri(BASE);
    let e = comando(
        &mut d,
        "object.objectsOnPath.attach",
        &[A, B],
        json!({ "path": TRACCIATO }),
    );
    let t = scritto(BASE, &e);
    let id = e.selection.first().cloned().expect("il gruppo è scelto");
    (t, id)
}

/// Il record degli Oggetti sul tracciato della ricetta di `testo`.
fn record(testo: &str) -> Value {
    let r = ricette(testo);
    assert_eq!(r.len(), 1, "una ricetta: {r:?}");
    assert_eq!(r[0].0, "group");
    r[0].1
        .clone()
        .expect("il gruppo è degli Oggetti sul tracciato")
}

#[test]
fn attacca_scrive_il_gruppo_con_la_ricetta_e_si_riapre_senza_perdite() {
    let (t, id) = attaccati();
    // A, B e il tracciato non sono più elementi del file: stanno nel gruppo,
    // il tracciato sotto, i due quadrati girati lungo la curva.
    for vecchio in [A, B, TRACCIATO] {
        assert!(!t.contains(vecchio), "{t}");
    }
    let gruppo = &t[t.find(&format!("<g id=\"{id}\"")).expect("il gruppo")..];
    assert!(
        gruppo.find("<path").unwrap() < gruppo.find("#ff0000").unwrap(),
        "{t}"
    );
    assert_eq!(gruppo.matches("<polygon").count(), 2, "{t}");
    let r = record(&t);
    assert_eq!(r["members"].as_array().map(Vec::len), Some(2), "{r}");
    assert_eq!(r["pivot"], 4);
    let (_, perdite) = apri(&t);
    assert_eq!(perdite, Vec::<String>::new());
}

#[test]
fn le_opzioni_lavorano_sul_gruppo_riaperto() {
    let (t, id) = attaccati();
    let (mut d, _) = apri(&t);
    assert_eq!(spento(&d, "object.objectsOnPath.options", &[&id]), None);
    let e = comando(
        &mut d,
        "object.objectsOnPath.options",
        &[&id],
        json!({ "pivot": 7, "rotate": 30 }),
    );
    let t2 = scritto(&t, &e);
    let r = record(&t2);
    assert_eq!(
        (r["pivot"].clone(), r["rotate"].clone()),
        (json!(7), json!(30.0))
    );
    assert_ne!(t, t2, "i quadrati si spostano col nuovo punto di aggancio");
    let (_, perdite) = apri(&t2);
    assert_eq!(perdite, Vec::<String>::new());
}

#[test]
fn espandi_lascia_un_gruppo_semplice_senza_ricetta() {
    let (t, id) = attaccati();
    let (mut d, _) = apri(&t);
    let e = comando(&mut d, "object.objectsOnPath.expand", &[&id], json!({}));
    let t2 = scritto(&t, &e);
    assert!(ricette(&t2).is_empty(), "{t2}");
    assert!(t2.contains(&format!("<g id=\"{id}\"")), "{t2}");
    let (mut d2, perdite) = apri(&t2);
    assert_eq!(perdite, Vec::<String>::new());
    assert!(spento(&d2, "object.objectsOnPath.options", &[&id]).is_some());
    // Gli oggetti del gruppo espanso sono elementi del file: uno si sposta
    // da solo, e il gruppo semplice si scioglie come ogni gruppo.
    let figlio = t2
        .split("<polygon id=\"")
        .nth(1)
        .and_then(|r| r.split('"').next())
        .expect("un quadrato")
        .to_string();
    let e = comando(
        &mut d2,
        "object.move",
        &[&figlio],
        json!({"dx": 5, "dy": 0}),
    );
    let t3 = scritto(&t2, &e);
    assert_ne!(t2, t3);
    assert!(ricette(&t3).is_empty(), "{t3}");
    let (mut d3, _) = apri(&t3);
    let e = comando(&mut d3, "object.ungroup", &[&id], json!({}));
    let t4 = scritto(&t3, &e);
    assert!(!t4.contains(&format!("<g id=\"{id}\"")), "{t4}");
}

#[test]
fn le_regole_di_accensione_sono_quelle_di_vectorcraft() {
    let (d, _) = apri(BASE);
    assert_eq!(
        spento(&d, "object.objectsOnPath.attach", &[]),
        Some(fub_abi::DrawingDisabledReason::NoSelection)
    );
    assert_eq!(spento(&d, "object.objectsOnPath.attach", &[A]), None);
    let altro = Some(fub_abi::DrawingDisabledReason::Other {
        text: "Seleziona un gruppo di oggetti sul tracciato.".into(),
    });
    assert_eq!(spento(&d, "object.objectsOnPath.options", &[A]), altro);
    assert_eq!(spento(&d, "object.objectsOnPath.expand", &[A, B]), altro);
}

#[test]
fn un_tracciato_che_non_c_e_e_rifiutato_col_suo_nome() {
    let (mut d, _) = apri(BASE);
    let e = d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: "disegno.object.objectsOnPath.attach".into(),
        selection: vec![A.into()],
        value: json!({ "path": "onessuno0" }),
        preview: false,
    });
    let testo = format!("{e:?}");
    assert!(testo.contains("onessuno0"), "{testo}");
}

fn gesto(d: &mut Disegno, scelti: &[&str], phase: &str, eventi: Vec<Value>) -> DrawingOutcome {
    let g: fub_abi::DrawingGesture = serde_json::from_value(json!({
        "revision": d.revisione(),
        "phase": phase,
        "tool": { "engine": { "id": "objectsOnPath" } },
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

fn ev(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

#[test]
fn un_clic_dello_strumento_sul_tracciato_attacca_gli_oggetti_scelti() {
    let (mut d, _) = apri(BASE);
    // Il mezzo della curva: y = 212.5 a x = 200.
    let e = gesto(
        &mut d,
        &[A, B],
        "commit",
        vec![ev("down", 200.0, 212.5), ev("up", 200.0, 212.5)],
    );
    let t = scritto(BASE, &e);
    assert_eq!(
        record(&t)["members"].as_array().map(Vec::len),
        Some(2),
        "{t}"
    );
    // Un clic lontano da ogni tracciato non fa niente.
    let (mut d, _) = apri(BASE);
    let e = gesto(
        &mut d,
        &[A, B],
        "commit",
        vec![ev("down", 200.0, 50.0), ev("up", 200.0, 50.0)],
    );
    assert!(
        e.ops.as_deref().is_none_or(|o| !o.contains("recipe")),
        "{e:?}"
    );
}

#[test]
fn ispeziona_oggetto_legge_le_opzioni_del_gruppo_con_l_id_del_file() {
    let g = include_str!("famiglie/dinamici/oggetti-sul-tracciato-strumento.svg");
    let (mut d, _) = apri(g);
    let e = comando(&mut d, "document.node", &[], json!({"id": "o44ukzs5q"}));
    let r = e.reading.expect("la lettura");
    assert_eq!(r["objects_on_path"]["pivot"], json!(4), "{r}");
    assert_eq!(
        r["objects_on_path"]["members"].as_array().map(Vec::len),
        Some(2),
        "{r}"
    );
}

#[test]
fn ispeziona_oggetto_rifiuta_un_id_del_file_che_non_c_e() {
    let (mut d, _) = apri(BASE);
    let e = d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: "disegno.document.node".into(),
        selection: vec![],
        value: json!({ "id": "onessuno0" }),
        preview: false,
    });
    let testo = format!("{e:?}");
    assert!(testo.contains("onessuno0"), "{testo}");
}
