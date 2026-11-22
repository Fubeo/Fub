//! Il Generatore forme (piano K6, T13 giro 7; la famiglia `forme`,
//! `src/famiglie/forme.rs`): il comando `shapeBuilder.merge` e lo strumento
//! `shapeBuilder` unisce le forme che il trascinamento tocca, con Alt toglie le
//! regioni toccate, e `shapeBuilder.regions` legge le regioni.
//!
//! I casi che scrivono il disegno sono in `tests/famiglie/forme.json`; qui ci
//! sono i motivi delle voci spente (`comandi`) e i rifiuti che il banco non
//! distingue: meno di due oggetti, un'immagine, un oggetto bloccato.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::disegni;
use fub_abi::{DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome, DrawingRefusal};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const GENERATORE: &str = include_str!("famiglie/forme/generatore.svg");
const BLOCCATO: &str = include_str!("famiglie/trasforma/bloccato.svg");

const A: &str = "oa1a1a1a1";
const B: &str = "ob2b2b2b2";
const IMMAGINE: &str = "oimmagin1";

fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, aperto) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    assert!(
        aperto.losses.is_empty(),
        "perdite all'apertura: {:?}",
        aperto.losses
    );
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

/// Il perché di una voce spenta, `None` se è accesa.
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

const MERGE: &str = "shapeBuilder.merge";

fn punti() -> Value {
    json!({ "points": [[120, 125], [220, 125]] })
}

#[test]
fn il_generatore_vuole_due_forme_e_dice_perche_e_spento() {
    let ds = motore();
    let d = apri(&ds, GENERATORE);
    assert_eq!(
        spenta(&d, MERGE, &[]),
        Some(DrawingDisabledReason::NoSelection)
    );
    assert_eq!(
        spenta(&d, MERGE, &[A]),
        Some(DrawingDisabledReason::NeedsTwo)
    );
    // Due forme: acceso.
    assert_eq!(spenta(&d, MERGE, &[A, B]), None);
}

#[test]
fn un_immagine_non_si_unisce_perche_la_mappa_non_la_tocca() {
    let ds = motore();
    let d = apri(&ds, GENERATORE);
    // L'immagine non ha un elemento del motore nella mappa: `unmapped`, come per gli altri comandi.
    assert_eq!(
        spenta(&d, MERGE, &[A, IMMAGINE]),
        Some(DrawingDisabledReason::Unmapped)
    );
}

#[test]
fn il_rifiuto_del_comando_non_cambia_niente() {
    let ds = motore();
    let mut d = apri(&ds, GENERATORE);
    // Una forma sola: `empty`, niente da unire.
    assert_eq!(
        comando(&mut d, MERGE, &[A], punti()).refused,
        Some(DrawingRefusal::Empty)
    );
    // Un'immagine con una forma: `unmapped`.
    assert_eq!(
        comando(&mut d, MERGE, &[A, IMMAGINE], punti()).refused,
        Some(DrawingRefusal::Unmapped)
    );
}

#[test]
fn un_oggetto_bloccato_spegne_il_generatore_come_gli_altri_comandi() {
    let ds = motore();
    let mut d = apri(&ds, BLOCCATO);
    assert_eq!(
        spenta(&d, MERGE, &[A, B]),
        Some(DrawingDisabledReason::ReadOnly)
    );
    assert_eq!(
        comando(&mut d, MERGE, &[A, B], punti()).refused,
        Some(DrawingRefusal::Locked)
    );
}

#[test]
fn le_regioni_si_leggono_e_il_comando_non_cambia_il_disegno() {
    let ds = motore();
    let mut d = apri(&ds, GENERATORE);
    let esito = comando(&mut d, "shapeBuilder.regions", &[A, B], json!({}));
    let lettura = esito.reading.expect("una lettura");
    // Tre regioni: la sola B, la sola A e la parte che hanno in comune.
    assert_eq!(lettura["regions"].as_array().map(Vec::len), Some(3));
    assert!(esito.ops.is_none());
}
