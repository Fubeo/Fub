//! Le maschere di ritaglio e Media (piano K6, T12, giro 6; la famiglia
//! `tracciati`, `src/famiglie/tracciati_ritagli.rs`, e la differenza,
//! `src/differenza_ritagli.rs`).
//!
//! Crea mette gli oggetti scelti in un `<g clip-path>` che il tracciato in
//! cima ritaglia, scritto come SVG semplice: un `<clipPath>` in `fub-defs`.
//! Il file salvato si riapre con la stessa maschera; Rilascia ridà il
//! tracciato. Un file di Inkscape (il `clipPath` in `<defs>`) si apre senza
//! perdere niente, e un ritaglio scritto sull'oggetto stesso (come lo
//! scrive Illustrator) si tiene, ma Rilascia lo rifiuta col perché. Ogni
//! comando è un passo solo, e ciò che non si può fare è spento col perché.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::applica::applica;
use common::{disegni, ops_di};
use fub_abi::{DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome, DrawingRefusal};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

/// Due quadrati (`oa1a1a1a1`, `oe5e5e5e5`), un'ellisse sopra
/// (`ob2b2b2b2`), un quadrato verde (`oc3c3c3c3`) e un testo in cima
/// (`od4d4d4d4`).
const RITAGLIO: &str = include_str!("famiglie/tracciati/ritaglio.svg");
/// Il gruppo `og1g1g1g1` ritagliato da un cerchio in `<defs>`, come lo
/// scrive Inkscape.
const INKSCAPE: &str = include_str!("famiglie/tracciati/ritaglio-inkscape.svg");
/// Il `clip-path` scritto sul tracciato `oa1a1a1a1`.
const SULL_OGGETTO: &str = include_str!("famiglie/tracciati/ritaglio-sull-oggetto.svg");
/// Tre tracciati aperti e uno chiuso, per Media.
const MEDIA: &str = include_str!("famiglie/tracciati/media.svg");

fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

/// Apre il disegno: le sole perdite ammesse sono le risorse in `<defs>`
/// (il `clipPath`), che l'apertura dice e tiene byte per byte.
fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, aperto) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    for p in &aperto.losses {
        let detto = format!("{p:?}");
        assert!(
            detto.contains("<defs>"),
            "perdita che non è una risorsa: {detto}"
        );
    }
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

fn spenta(d: &Disegno, id: &str, scelti: &[&str]) -> Option<DrawingDisabledReason> {
    let scelti: Vec<String> = scelti.iter().map(|s| s.to_string()).collect();
    let info = d
        .comandi(&scelti)
        .into_iter()
        .find(|c| c.id == format!("disegno.{id}"))
        .unwrap_or_else(|| panic!("manca la voce {id}"));
    assert_eq!(
        info.enabled,
        info.disabled_reason.is_none(),
        "{id}: {info:?}"
    );
    info.disabled_reason
}

fn un_passo(esito: &DrawingOutcome) -> Value {
    assert!(esito.refused.is_none(), "rifiutato: {esito:?}");
    let ops = ops_di(esito);
    let elenco = ops.as_array().expect("ops in un elenco");
    assert_eq!(elenco.len(), 1, "più di un passo: {ops}");
    // Un passo: un `batch`, o una sola operazione.
    assert!(
        elenco[0]["op"] == "batch" || elenco[0]["op"] == "set",
        "non è un passo solo: {ops}"
    );
    ops
}

/// L'id dell'elemento che porta `clip-path="url(#…)"` nel testo.
fn gruppo_ritagliato(testo: &str) -> String {
    let prima = testo
        .split("clip-path=\"url(#")
        .next()
        .expect("un ritaglio");
    let resto = prima.rsplit("id=\"").next().expect("un id");
    resto.split('"').next().unwrap().to_string()
}

#[test]
fn crea_scrive_un_g_col_clippath_che_si_riapre_uguale() {
    let ds = motore();
    let mut d = apri(&ds, RITAGLIO);
    let scelti = ["oa1a1a1a1", "oe5e5e5e5", "ob2b2b2b2"];
    assert_eq!(spenta(&d, "object.clippingMask.make", &scelti), None);
    let esito = comando(&mut d, "object.clippingMask.make", &scelti, json!(null));
    let ops = un_passo(&esito);
    let salvato = applica(RITAGLIO, &ops).expect("le operazioni si applicano");
    // SVG semplice: il tracciato che ritaglia in un clipPath, il gruppo lo nomina.
    assert!(salvato.contains("<clipPath "), "{salvato}");
    assert!(
        salvato.contains("clipPathUnits=\"userSpaceOnUse\""),
        "{salvato}"
    );
    assert!(
        !salvato.contains("id=\"ob2b2b2b2\""),
        "l'ellisse è diventata il ritaglio: {salvato}"
    );
    let g = gruppo_ritagliato(&salvato);
    assert_eq!(
        esito.selection,
        vec![g.clone()],
        "la maschera nuova è scelta"
    );
    // Dentro il gruppo, i due quadrati nel loro ordine; fuori, il resto.
    let dentro = salvato
        .split(&format!("id=\"{g}\""))
        .nth(1)
        .unwrap()
        .split("</g>")
        .next()
        .unwrap();
    let a = dentro.find("oa1a1a1a1").expect("il primo quadrato dentro");
    let e = dentro
        .find("oe5e5e5e5")
        .expect("il secondo quadrato dentro");
    assert!(a < e);
    assert!(!dentro.contains("oc3c3c3c3"));

    // Riaperto: la stessa maschera, che si sceglie e si rilascia.
    let mut r = apri(&ds, &salvato);
    let tutte = comando(&mut r, "select.object.clippingMasks", &[], json!(null));
    assert_eq!(tutte.selection, vec![g.clone()]);
    let contenuto = comando(
        &mut r,
        "object.clippingMask.editContents",
        &[&g],
        json!(null),
    );
    assert_eq!(
        contenuto.selection,
        vec!["oa1a1a1a1".to_string(), "oe5e5e5e5".to_string()]
    );
    let rilascio = comando(&mut r, "object.clippingMask.release", &[&g], json!(null));
    let ops = un_passo(&rilascio);
    let rilasciato = applica(&salvato, &ops).expect("si applica");
    assert!(
        !rilasciato.contains(&format!("id=\"{g}\" clip-path")),
        "{rilasciato}"
    );
    // Il tracciato che ritagliava torna primo nel gruppo, senza colore.
    let dentro = rilasciato.split(&format!("id=\"{g}\"")).nth(1).unwrap();
    let primo = dentro.split("<path").nth(1).expect("un tracciato");
    assert!(primo.contains("fill=\"none\""), "{primo}");
    assert!(dentro.find("fill=\"none\"").unwrap() < dentro.find("oa1a1a1a1").unwrap());
}

#[test]
fn il_ritaglio_di_inkscape_si_apre_e_si_rilascia() {
    let ds = motore();
    let mut d = apri(&ds, INKSCAPE);
    assert_eq!(
        spenta(&d, "object.clippingMask.release", &["og1g1g1g1"]),
        None
    );
    let contenuto = comando(
        &mut d,
        "object.clippingMask.editContents",
        &["og1g1g1g1"],
        json!(null),
    );
    assert_eq!(
        contenuto.selection,
        vec!["oa1a1a1a1".to_string(), "ob2b2b2b2".to_string()]
    );
    let esito = comando(
        &mut d,
        "object.clippingMask.release",
        &["og1g1g1g1"],
        json!(null),
    );
    let ops = un_passo(&esito);
    let rilasciato = applica(INKSCAPE, &ops).expect("si applica");
    assert!(
        !rilasciato.contains("clip-path=\"url(#clipPath1)\""),
        "{rilasciato}"
    );
    // Il clipPath di Inkscape resta nel file: non è di Fub.
    assert!(rilasciato.contains("id=\"clipPath1\""), "{rilasciato}");
    assert!(rilasciato.contains("id=\"oa1a1a1a1\"") && rilasciato.contains("id=\"ob2b2b2b2\""));
}

#[test]
fn il_ritaglio_sull_oggetto_si_tiene_ma_rilascia_dice_perche() {
    let ds = motore();
    let mut d = apri(&ds, SULL_OGGETTO);
    let perche = spenta(&d, "object.clippingMask.release", &["oa1a1a1a1"]);
    let Some(DrawingDisabledReason::Other { text }) = perche else {
        panic!("Rilascia dovrebbe dire perché: {perche:?}");
    };
    assert!(text.contains("sull'oggetto stesso"), "{text}");
    let esito = comando(
        &mut d,
        "object.clippingMask.release",
        &["oa1a1a1a1"],
        json!(null),
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::Unsupported));
    assert_eq!(esito.ops, None);
    // Nessun gruppo di ritaglio del file: Maschere di ritaglio non ha niente.
    assert!(spenta(&d, "object.clippingMask.editContents", &["oa1a1a1a1"]).is_some());
    let tutte = comando(&mut d, "select.object.clippingMasks", &[], json!(null));
    assert_eq!(tutte.refused, Some(DrawingRefusal::Empty));
}

#[test]
fn crea_e_rilascia_spenti_col_perche() {
    let ds = motore();
    let mut d = apri(&ds, RITAGLIO);
    assert_eq!(
        spenta(&d, "object.clippingMask.make", &["oa1a1a1a1"]),
        Some(DrawingDisabledReason::NeedsTwo)
    );
    // Il testo in cima non è un tracciato che possa ritagliare.
    assert_eq!(
        spenta(&d, "object.clippingMask.make", &["oa1a1a1a1", "od4d4d4d4"]),
        Some(DrawingDisabledReason::NeedsPath)
    );
    let esito = comando(
        &mut d,
        "object.clippingMask.make",
        &["oa1a1a1a1", "od4d4d4d4"],
        json!(null),
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::Unsupported));
    let Some(DrawingDisabledReason::Other { text }) =
        spenta(&d, "object.clippingMask.release", &["oa1a1a1a1"])
    else {
        panic!("Rilascia senza maschera dice perché");
    };
    assert_eq!(text, "Scegli una maschera di ritaglio.");
    let esito = comando(
        &mut d,
        "object.clippingMask.release",
        &["oa1a1a1a1"],
        json!(null),
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty));
    let esito = comando(&mut d, "select.object.clippingMasks", &[], json!(null));
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty));
}

#[test]
fn media_porta_i_punti_sull_asse_in_un_passo() {
    let ds = motore();
    let mut d = apri(&ds, MEDIA);
    let esito = comando(
        &mut d,
        "path.average",
        &["oc1c1c1c1"],
        json!({ "axis": "horizontal" }),
    );
    let ops = un_passo(&esito);
    let dopo = applica(MEDIA, &ops).expect("si applica");
    assert!(
        dopo.contains("d=\"M40 66.67 L100 66.67 L160 66.67\""),
        "{dopo}"
    );
    // Coi punti scelti, solo quelli.
    let punti = json!([
        { "element": "od2d2d2d2", "subpath": 0, "anchor": 0, "at": [180, 120], "end": true },
        { "element": "og6g6g6g6", "subpath": 0, "anchor": 1, "at": [120, 200], "end": true },
    ]);
    let esito = comando(
        &mut d,
        "path.average",
        &["od2d2d2d2", "og6g6g6g6"],
        json!({ "axis": "horizontal", "anchors": punti }),
    );
    let dopo = applica(MEDIA, &un_passo(&esito)).expect("si applica");
    assert!(dopo.contains("d=\"M180 160 L240 140\""), "{dopo}");
    assert!(dopo.contains("d=\"M40 200 L120 160\""), "{dopo}");
    // Tutti i punti di un tracciato in uno: niente da fare.
    let esito = comando(
        &mut d,
        "path.average",
        &["oe3e3e3e3"],
        json!({ "axis": "both" }),
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty));
    assert_eq!(esito.ops, None);
}

#[test]
fn media_e_unisci_unisce_due_estremi_o_dice_perche() {
    let ds = motore();
    let mut d = apri(&ds, MEDIA);
    assert_eq!(
        spenta(&d, "path.averageJoin", &["oc1c1c1c1", "od2d2d2d2"]),
        None
    );
    let esito = comando(
        &mut d,
        "path.averageJoin",
        &["oc1c1c1c1", "od2d2d2d2"],
        json!({ "to": "corner" }),
    );
    let dopo = applica(MEDIA, &un_passo(&esito)).expect("si applica");
    assert!(!dopo.contains("id=\"od2d2d2d2\""), "{dopo}");
    assert!(
        dopo.contains("d=\"M40 60 L100 60 L170 100 L240 140\""),
        "{dopo}"
    );
    assert_eq!(esito.selection, vec!["oc1c1c1c1".to_string()]);
    let Some(DrawingDisabledReason::Other { text }) =
        spenta(&d, "path.averageJoin", &["oe3e3e3e3"])
    else {
        panic!("un tracciato chiuso non ha estremi da unire");
    };
    assert!(text.contains("tracciati aperti"), "{text}");
    let esito = comando(
        &mut d,
        "path.averageJoin",
        &["oe3e3e3e3"],
        json!({ "to": "corner" }),
    );
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty));
}
