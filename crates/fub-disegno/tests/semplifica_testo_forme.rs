//! Semplifica e Smussa (piano K6, T12, finestre e automatico; la famiglia `tracciati`) su solo testo o
//! forme primitive: la voce è spenta con la frase in italiano, e il comando si rifiuta come
//! `unsupported` prima del motore. Con una scelta che ha un tracciato il comando resta acceso.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::disegni;
use fub_abi::{DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome, DrawingRefusal};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

/// Un tracciato a zigzag (`oz1z1z1z1`), un rettangolo di base (`oa1a1a1a1`, di un altro programma) e un
/// testo (`od4d4d4d4`) nel disegno della campionatura.
const CAMPIONI: &str = include_str!("famiglie/colore/campioni.svg");
const ZIGZAG: &str = include_str!("famiglie/tracciati/zigzag.svg");
/// Una forma viva di Fub: un rettangolo arrotondato (`o5qgdpjl6`) con la sua ricetta.
const FORMA_VIVA: &str = include_str!("famiglie/forme/roundedrectangle-4.svg");

const TESTO: &str = "Il testo non si semplifica: prima crea i profili.";
const FORMA: &str = "Una forma non si semplifica: prima trasformala in tracciato.";

fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, _) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
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

/// Il perché di una voce spenta sulla scelta, `None` se è accesa.
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

#[test]
fn il_testo_e_la_forma_primitiva_spengono_semplifica_e_smussa_con_la_frase() {
    let ds = motore();
    let d = apri(&ds, CAMPIONI);
    for id in ["object.path.simplify", "object.path.smooth"] {
        match spenta(&d, id, &["od4d4d4d4"]) {
            Some(DrawingDisabledReason::Other { text }) => assert_eq!(text, TESTO, "{id}"),
            altro => panic!("{id} sul testo doveva dire perché: {altro:?}"),
        }
    }
    let forma = apri(&ds, FORMA_VIVA);
    for id in ["object.path.simplify", "object.path.smooth"] {
        match spenta(&forma, id, &["o5qgdpjl6"]) {
            Some(DrawingDisabledReason::Other { text }) => assert_eq!(text, FORMA, "{id}"),
            altro => panic!("{id} sulla forma doveva dire perché: {altro:?}"),
        }
    }
}

#[test]
fn il_rifiuto_dice_unsupported_prima_del_motore_sul_testo_e_sulla_forma() {
    let ds = motore();
    let mut d = apri(&ds, CAMPIONI);
    let esito = comando(
        &mut d,
        "object.path.simplify",
        &["od4d4d4d4"],
        json!({ "auto": true }),
    );
    assert_eq!(
        esito.refused,
        Some(DrawingRefusal::Unsupported),
        "{esito:?}"
    );
    assert!(esito.ops.is_none());
    let mut forma = apri(&ds, FORMA_VIVA);
    let esito = comando(
        &mut forma,
        "object.path.smooth",
        &["o5qgdpjl6"],
        json!({ "level": 50 }),
    );
    assert_eq!(
        esito.refused,
        Some(DrawingRefusal::Unsupported),
        "{esito:?}"
    );
}

/// Con un tracciato nella scelta il comando resta acceso: il motore salta il rettangolo di base.
#[test]
fn la_scelta_mista_resta_accesa() {
    let ds = motore();
    let d = apri(&ds, ZIGZAG);
    assert_eq!(
        spenta(&d, "object.path.simplify", &["oz1z1z1z1", "oa1a1a1a1"]),
        None
    );
    assert_eq!(
        spenta(&d, "object.path.smooth", &["oz1z1z1z1", "oa1a1a1a1"]),
        None
    );
}
