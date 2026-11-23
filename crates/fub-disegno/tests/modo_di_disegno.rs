//! La modalità di disegno (`view.drawMode`, piano K6, T11; la famiglia `vista` e la creazione di forme).
//!
//! Il modo sta nella sessione del motore, non nel file: all'apertura di un disegno torna «normale». Dietro
//! sposta il nuovo oggetto sotto il primo scelto (o in fondo al livello). Dentro non si fa ancora (vedi
//! `famiglie/vista.rs`). Qui si provano il ritorno a normale, la riapertura, la selezione dopo il disegno
//! e il file salvato.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::disegni;
use fub_abi::{DrawingCommandRequest, DrawingOutcome, DrawingRefusal};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/forme/base.svg");
const TRIANGOLO: &str = "op7a7a7a7";

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

fn rettangolo(d: &mut Disegno, scelti: &[&str]) -> DrawingOutcome {
    comando(
        d,
        "shape.rectangle",
        scelti,
        json!({ "x": 20, "y": 150, "width": 30, "height": 20 }),
    )
}

/// La posizione in cui il rettangolo nuovo sta nel passo: `after` (sotto un oggetto), `first` (in fondo) o
/// `last` (in cima).
fn posizione(esito: &DrawingOutcome) -> Value {
    common::ops_di(esito)[0]["pos"].clone()
}

#[test]
fn dietro_con_un_oggetto_scelto_mette_il_nuovo_sotto_di_lui() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    assert!(comando(
        &mut d,
        "view.drawMode",
        &[TRIANGOLO],
        json!({ "mode": "behind" })
    )
    .refused
    .is_none());
    let esito = rettangolo(&mut d, &[TRIANGOLO]);
    assert!(esito.refused.is_none(), "{esito:?}");
    // Il nuovo sta subito dopo (sotto, nel modo di Fub) l'oggetto scelto, nello stesso livello.
    let pos = posizione(&esito);
    assert!(pos.get("after").is_some(), "{pos}");
    assert_ne!(
        pos["after"],
        json!(TRIANGOLO),
        "il nuovo non va sul triangolo ma sotto di lui"
    );
}

#[test]
fn tornare_a_normale_rimette_il_nuovo_in_cima() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    comando(&mut d, "view.drawMode", &[], json!({ "mode": "behind" }));
    let torna = comando(&mut d, "view.drawMode", &[], json!({ "mode": "normal" }));
    assert_eq!(torna.reading.as_ref().unwrap()["mode"], "normal");
    let esito = rettangolo(&mut d, &[TRIANGOLO]);
    assert_eq!(
        posizione(&esito),
        json!({ "last": true }),
        "normale mette in cima"
    );
}

#[test]
fn chiudere_e_riaprire_il_disegno_riporta_il_modo_a_normale() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    comando(&mut d, "view.drawMode", &[], json!({ "mode": "behind" }));
    // Il file non ha il modo: riaprirlo lo rimette a normale.
    let testo = d.testo().to_string();
    let mut riaperto = apri(&ds, &testo);
    let esito = rettangolo(&mut riaperto, &[TRIANGOLO]);
    assert_eq!(
        posizione(&esito),
        json!({ "last": true }),
        "dopo la riapertura il modo è normale"
    );
}

#[test]
fn il_modo_non_scrive_il_file_e_il_nuovo_si_salva_sotto_il_triangolo() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let prima = d.testo().to_string();
    comando(&mut d, "view.drawMode", &[], json!({ "mode": "behind" }));
    assert_eq!(d.testo(), prima, "cambiare modo non cambia il file");
    let esito = rettangolo(&mut d, &[TRIANGOLO]);
    assert!(esito.refused.is_none());
    // Salva e riapri: il nuovo resta, e viene prima del triangolo nel file (sotto nella pila).
    // Il client applica il passo al file, poi il file si riapre.
    let scritto = common::applica::applica(&prima, &common::ops_di(&esito))
        .expect("il passo si applica al file");
    let riaperto = apri(&ds, &scritto);
    let ordine = riaperto.testo().to_string();
    let pos_nuovo = ordine
        .find("width=\"30\" height=\"20\"")
        .expect("il nuovo rettangolo nel file");
    let pos_triangolo = ordine
        .find("id=\"op7a7a7a7\"")
        .expect("il triangolo nel file");
    assert!(
        pos_nuovo < pos_triangolo,
        "il nuovo sta sotto il triangolo nel file"
    );
}

#[test]
fn dentro_e_senza_modo_si_rifiutano_prima_del_motore_in_italiano() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    for valore in [json!({ "mode": "inside" }), json!({})] {
        let errore = d
            .comando(DrawingCommandRequest {
                revision: d.revisione(),
                id: "disegno.view.drawMode".into(),
                selection: vec![TRIANGOLO.into()],
                value: valore.clone(),
                preview: false,
            })
            .expect_err("doveva rifiutare");
        let testo = format!("{errore:?}");
        assert!(
            testo.contains("Dentro") || testo.contains("Scegli il modo"),
            "{valore}: {testo}"
        );
    }
    // Il rifiuto non cambia il modo: resta normale.
    let esito = rettangolo(&mut d, &[TRIANGOLO]);
    assert_eq!(posizione(&esito), json!({ "last": true }));
}

#[test]
fn un_passo_sotto_il_modo_dietro_si_annulla_come_ogni_altro_passo() {
    // Il passo di Annulla è quello dei casi del client: `shape.rectangle` con `dopo` (casi.test.ts),
    // che li applica e li annulla al byte. Qui si controlla che il comando dia un passo solo.
    let ds = motore();
    let mut d = apri(&ds, BASE);
    comando(&mut d, "view.drawMode", &[], json!({ "mode": "behind" }));
    let esito = rettangolo(&mut d, &[TRIANGOLO]);
    assert_eq!(
        common::ops_di(&esito).as_array().unwrap().len(),
        1,
        "un solo passo"
    );
    assert_ne!(esito.refused, Some(DrawingRefusal::Empty));
}
