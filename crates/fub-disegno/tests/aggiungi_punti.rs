//! Aggiungi punti ai segmenti (`addon.pathtools.addPoints`, piano K6, T12; la famiglia `tracciati`): la
//! voce spenta col perché quando la scelta non va (niente, solo testo, forme primitive), i valori fuori
//! dal campo che lo dicono in italiano prima del motore, e il bloccato. Il comando sul tracciato
//! (i punti nuovi, la forma uguale) è nel banco `tests/famiglie/tracciati.json`, col disegno dopo.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::disegni;
use fub_abi::{
    DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome, DrawingRefusal, PluginError,
};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const COMANDO: &str = "addon.pathtools.addPoints";
const APERTO: &str = include_str!("famiglie/tracciati/addpoints-aperto.svg");
const RETTANGOLO: &str = include_str!("famiglie/tracciati/addpoints-rettangolo.svg");
const ELLISSE: &str = include_str!("famiglie/tracciati/addpoints-ellisse.svg");
const TESTO: &str = include_str!("famiglie/tracciati/addpoints-testo.svg");
const BLOCCATO: &str = include_str!("famiglie/tracciati/addpoints-bloccato.svg");

const FRASE_TESTO: &str = "Il testo non ha segmenti: prima crea i profili.";
const FRASE_FORMA: &str = "Una forma non ha segmenti: prima trasformala in tracciato.";

fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, _) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    d
}

fn comando(d: &mut Disegno, scelti: &[&str], valore: Value) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{COMANDO}"),
        selection: scelti.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    })
    .expect("il comando gira")
}

/// Il perché di una voce spenta sulla scelta, `None` se è accesa.
fn spenta(d: &Disegno, scelti: &[&str]) -> Option<DrawingDisabledReason> {
    let scelti: Vec<String> = scelti.iter().map(|s| s.to_string()).collect();
    let info = d
        .comandi(&scelti)
        .into_iter()
        .find(|c| c.id == format!("disegno.{COMANDO}"))
        .expect("la voce c'è");
    assert_eq!(info.enabled, info.disabled_reason.is_none(), "{info:?}");
    info.disabled_reason
}

#[test]
fn senza_nessun_oggetto_la_voce_e_spenta_per_mancanza_di_scelta() {
    let ds = motore();
    let d = apri(&ds, APERTO);
    assert!(matches!(
        spenta(&d, &[]),
        Some(DrawingDisabledReason::NoSelection)
    ));
}

#[test]
fn su_un_tracciato_aperto_la_voce_e_accesa() {
    let ds = motore();
    let d = apri(&ds, APERTO);
    assert_eq!(spenta(&d, &["oaper0001"]), None);
}

#[test]
fn su_un_testo_la_voce_e_spenta_con_la_frase() {
    let ds = motore();
    let d = apri(&ds, TESTO);
    match spenta(&d, &["otxt00001"]) {
        Some(DrawingDisabledReason::Other { text }) => assert_eq!(text, FRASE_TESTO),
        altro => panic!("sul testo doveva dire perché: {altro:?}"),
    }
}

#[test]
fn su_un_rettangolo_e_su_un_ellisse_di_fub_la_voce_e_spenta_con_la_frase() {
    let ds = motore();
    for (fonte, id) in [(RETTANGOLO, "orett0001"), (ELLISSE, "oell00001")] {
        let d = apri(&ds, fonte);
        match spenta(&d, &[id]) {
            Some(DrawingDisabledReason::Other { text }) => assert_eq!(text, FRASE_FORMA, "{id}"),
            altro => panic!("{id} doveva dire perché: {altro:?}"),
        }
    }
}

#[test]
fn il_rifiuto_su_testo_e_forma_e_unsupported_prima_del_motore() {
    let ds = motore();
    for (fonte, id) in [(TESTO, "otxt00001"), (RETTANGOLO, "orett0001")] {
        let mut d = apri(&ds, fonte);
        let esito = comando(&mut d, &[id], json!({ "count": 1 }));
        assert_eq!(
            esito.refused,
            Some(DrawingRefusal::Unsupported),
            "{id}: {esito:?}"
        );
        assert!(esito.ops.is_none(), "{id}: niente passo");
    }
}

#[test]
fn un_oggetto_bloccato_e_bloccato_nel_motore() {
    let ds = motore();
    let mut d = apri(&ds, BLOCCATO);
    let esito = comando(&mut d, &["obloc0001"], json!({ "count": 1 }));
    assert_eq!(esito.refused, Some(DrawingRefusal::Locked), "{esito:?}");
    assert!(esito.ops.is_none());
}

#[test]
fn i_valori_fuori_dal_campo_li_dice_la_famiglia_in_italiano_e_niente_cambia() {
    let ds = motore();
    for valore in [
        json!({ "count": 0 }),
        json!({ "count": -2 }),
        json!({ "count": 1.5 }),
        json!({ "count": 101 }),
        json!({ "count": "due" }),
    ] {
        let mut d = apri(&ds, APERTO);
        let prima = d.testo().to_string();
        let errore = d
            .comando(DrawingCommandRequest {
                revision: d.revisione(),
                id: format!("disegno.{COMANDO}"),
                selection: vec!["oaper0001".into()],
                value: valore.clone(),
                preview: false,
            })
            .expect_err("doveva rifiutare");
        match errore {
            // `Text` è un testo letterale: il suo formato di debug contiene la frase italiana.
            PluginError::BadArgs(testo) => assert!(
                format!("{testo:?}").contains("Quanti punti"),
                "{valore}: {testo:?}"
            ),
            altro => panic!("{valore}: {altro:?}"),
        }
        assert_eq!(d.testo(), prima, "{valore}: il disegno non cambia");
    }
}
