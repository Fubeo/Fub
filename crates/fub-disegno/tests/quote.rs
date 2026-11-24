//! La Quota di VectorCraft (strumento `dimension`, `dimension.*`): una quota
//! è un gruppo che il file tiene con la ricetta; il legame con l'oggetto
//! misurato vive solo nel gesto, e il file non lo tiene.

#![cfg(feature = "completo")]

mod common;

use fub_abi::{DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/dinamici/fusione-base.svg");
const A: &str = "oa1a1a1a1";

fn apri(testo: &str) -> Disegno {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (d, aperto) = Disegno::apri_con(&disegni, testo).expect("il disegno si apre");
    assert!(aperto.losses.is_empty(), "{:?}", aperto.losses);
    d
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

/// Il record di ogni quota del file (dalle ricette), con l'id dell'elemento.
fn quote(testo: &str) -> Vec<(String, Value)> {
    vectorcraft_svg::recipes(testo)
        .iter()
        .filter_map(|r| {
            let byte = vectorcraft_svg::base64_decode(&r.data).expect("base64");
            let ricetta: Value = serde_json::from_slice(&byte).expect("JSON");
            let q = ricetta["node"].get("dimension").cloned()?;
            Some((r.for_id.clone(), q))
        })
        .collect()
}

fn spento(d: &Disegno, id: &str, scelti: &[&str]) -> Option<DrawingDisabledReason> {
    let scelti: Vec<String> = scelti.iter().map(|s| s.to_string()).collect();
    let info = d
        .comandi(&scelti)
        .into_iter()
        .find(|c| c.id == format!("disegno.{id}"))
        .expect("il comando c'è");
    assert_eq!(info.enabled, info.disabled_reason.is_none());
    info.disabled_reason
}

/// Il disegno con una quota libera da (50,50) a (150,50), e il suo id.
fn con_una_quota(testo: &str, a: [f64; 2], b: [f64; 2]) -> (String, String) {
    let mut d = apri(testo);
    let e = comando(
        &mut d,
        "dimension.create",
        &[],
        json!({"a": a, "b": b, "offset": 20}),
    );
    let dopo = scritto(testo, &e);
    assert_eq!(e.selection.len(), 1, "la quota nuova è scelta");
    (dopo, e.selection[0].clone())
}

#[test]
fn una_quota_libera_si_salva_con_la_sua_ricetta() {
    let (dopo, id) = con_una_quota(BASE, [50.0, 50.0], [150.0, 50.0]);
    let q = quote(&dopo);
    assert_eq!(q.len(), 1);
    assert_eq!(q[0].0, id);
    assert_eq!(q[0].1["mode"], "linear");
    assert_eq!(q[0].1["length"], 100.0);
    assert_eq!(q[0].1["offset"], 20.0);
    // Il disegno della quota (linee, frecce, etichetta) è nel file.
    assert!(dopo.contains(&format!("<g id=\"{id}\">")), "{dopo}");
    // Riaperta, la quota resta una: niente perdite, niente ricette nuove.
    let mut d = apri(&dopo);
    let e = comando(&mut d, "dimension.update", &[&id], json!({"offset": 30}));
    let ancora = scritto(&dopo, &e);
    let q = quote(&ancora);
    assert_eq!(q.len(), 1);
    assert_eq!(q[0].1["offset"], 30.0);
}

#[test]
fn una_quota_legata_a_un_lato_lo_misura_e_il_file_non_tiene_il_legame() {
    let mut d = apri(BASE);
    let e = comando(
        &mut d,
        "dimension.create",
        &[],
        json!({"mode": "linear", "source": {"kind": "segment", "edge": {"node": A, "subpath": 0, "segment": 0}}, "offset": 20}),
    );
    let dopo = scritto(BASE, &e);
    let q = quote(&dopo);
    assert_eq!(q.len(), 1);
    // Il primo lato del quadrato rosso va da (50,100) a (100,100).
    assert_eq!(q[0].1["a"], json!({"x": 50.0, "y": 100.0}));
    assert_eq!(q[0].1["b"], json!({"x": 100.0, "y": 100.0}));
    // Gli id del motore si rinumerano alla riapertura: il legame non si scrive.
    assert_eq!(q[0].1["source"], Value::Null);
}

#[test]
fn un_oggetto_che_il_disegno_non_ha_e_un_argomento_sbagliato() {
    let mut d = apri(BASE);
    let r = d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: "disegno.dimension.create".into(),
        selection: vec![],
        value: json!({"source": {"kind": "circle", "node": "onessuno0"}}),
        preview: false,
    });
    assert!(r.is_err(), "{r:?}");
}

#[test]
fn aggiorna_cambia_lo_stile_e_applica_a_tutti_lo_copia_su_ogni_quota() {
    let (uno, prima) = con_una_quota(BASE, [50.0, 50.0], [150.0, 50.0]);
    let (due, seconda) = con_una_quota(&uno, [50.0, 200.0], [150.0, 200.0]);
    let mut d = apri(&due);
    let rossa = json!({"lineColor": [255, 0, 0], "precision": 1});
    let e = comando(
        &mut d,
        "dimension.update",
        &[],
        json!({"ids": [prima], "options": rossa}),
    );
    let tre = scritto(&due, &e);
    let stili = |testo: &str| -> Vec<(String, Value)> {
        quote(testo)
            .into_iter()
            .map(|(id, q)| (id, q["options"]["lineColor"].clone()))
            .collect()
    };
    let s = stili(&tre);
    assert!(s.contains(&(prima.clone(), json!([255, 0, 0]))), "{s:?}");
    assert!(s.contains(&(seconda.clone(), json!([0, 0, 0]))), "{s:?}");
    let mut d = apri(&tre);
    let e = comando(&mut d, "dimension.applyToAll", &[&prima], json!({}));
    let quattro = scritto(&tre, &e);
    let s = stili(&quattro);
    assert_eq!(s.len(), 2);
    assert!(s.iter().all(|(_, c)| *c == json!([255, 0, 0])), "{s:?}");
}

#[test]
fn aggiorna_e_applica_a_tutti_vogliono_una_quota() {
    let (dopo, id) = con_una_quota(BASE, [50.0, 50.0], [150.0, 50.0]);
    let d = apri(&dopo);
    assert_eq!(spento(&d, "dimension.create", &[]), None);
    for c in ["dimension.update", "dimension.applyToAll"] {
        assert_eq!(spento(&d, c, &[]), Some(DrawingDisabledReason::NoSelection));
        assert!(matches!(
            spento(&d, c, &[A]),
            Some(DrawingDisabledReason::Other { .. })
        ));
        assert_eq!(spento(&d, c, &[&id]), None);
    }
    // Aggiorna vuole solo quote; Applica a tutti ne vuole una.
    assert!(spento(&d, "dimension.update", &[&id, A]).is_some());
    assert_eq!(spento(&d, "dimension.applyToAll", &[&id, A]), None);
}
