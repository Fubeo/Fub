//! Il campione più vicino (piano K6, T14, giro 9; la famiglia `colore`,
//! `src/famiglie/colore.rs`): due prove che non stanno nei casi del banco.
//!
//! - Il colore scritto nel file resta legato al campione globale: si applica
//!   il passo, si salva il file, lo si riapre con l'apertura di Fub, e il
//!   riempimento e il tratto puntano ancora ai campioni, non a un colore sciolto.
//! - Un documento senza campioni spegne Applica e Trova campione più vicino
//!   con una frase in italiano, e il comando si rifiuta senza cambiare niente.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::applica::applica;
use common::{disegni, ops_di};
use fub_abi::{DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome, DrawingRefusal};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const SCENARI: &str = include_str!("famiglie/colore/campioni-scenari.svg");
const BASE: &str = include_str!("famiglie/colore/base.svg");

const APPLICA: &str = "addon.color.applyNearestSwatch";
const TROVA: &str = "addon.color.nearestSwatch";

fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, aperto) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    // I campioni e le risorse dentro <defs> sono segnalati come perdite all'apertura, ma
    // restano nel file (`campioni.rs` li legge): nessun'altra perdita è accettata.
    assert!(
        aperto
            .losses
            .iter()
            .all(|p| p.detail.contains("dentro <defs>")),
        "perdite fuori da <defs>: {:?}",
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

#[test]
fn il_colore_applicato_resta_legato_al_campione_anche_dopo_salva_e_riapri() {
    let ds = motore();
    let mut d = apri(&ds, SCENARI);
    // Un riempimento (rosso → Viola) e un tratto (verde → Blu, lo fa il campione esatto).
    let esito = comando(&mut d, APPLICA, &["ox1x1x1x1", "ox2x2x2x2"], json!({}));
    assert!(esito.refused.is_none(), "rifiutato: {esito:?}");
    let ops = ops_di(&esito);
    let dopo = applica(SCENARI, &ops).expect("il passo si applica al file");

    // Il file salvato si riapre con l'apertura di Fub: niente perdite, il disegno è quello.
    let mut riaperto = apri(&ds, &dopo);
    let testo = riaperto.testo().to_string();
    assert!(
        testo.contains("id=\"ox1x1x1x1\"") && testo.contains("fill=\"url(#r3c3c3c3c) #cc79a7\""),
        "il riempimento di ox1 non è legato al campione Viola:\n{testo}"
    );
    assert!(
        testo.contains("fill=\"url(#r2b2b2b2b) #e69f00\"")
            && testo.contains("stroke=\"url(#r1a1a1a1a) #0072b2\""),
        "ox2 non ha il riempimento e il tratto legati ai campioni"
    );
    // I campioni ci sono ancora nel file, con il loro nome e il loro ruolo.
    assert!(
        testo.contains("<linearGradient id=\"r3c3c3c3c\" fub:role=\"swatch\" fub:name=\"Viola\"")
    );
    // E il motore li vede come campioni del documento riaperto: la lista ha Viola e Blu.
    let lista = comando(&mut riaperto, "swatch.list", &[], json!({}));
    let nomi = lista.reading.expect("una lettura").to_string();
    assert!(nomi.contains("Viola") && nomi.contains("Blu"), "{nomi}");
}

#[test]
fn senza_campioni_il_perche_e_in_italiano_e_il_comando_non_cambia_niente() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    // Applica: spento con la frase, e rifiutato senza cambiare il disegno.
    match spenta(&d, APPLICA, &["oa1a1a1a1"]) {
        Some(DrawingDisabledReason::Other { text }) => {
            assert!(text.contains("campioni"), "{text}");
            assert!(
                text.starts_with("Il disegno non ha campioni"),
                "la frase non è quella in italiano: {text}"
            );
            assert!(!text.contains("has no colours"), "{text}");
        }
        altro => panic!("Applica doveva dire perché: {altro:?}"),
    }
    let esito = comando(&mut d, APPLICA, &["oa1a1a1a1"], json!({}));
    assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "{esito:?}");
    assert!(esito.ops.is_none());
    // Trova: stesso perché, e nessuna lettura con i colori del motore.
    let trova = comando(&mut d, TROVA, &[], json!({ "color": "#ff0000" }));
    assert_eq!(trova.refused, Some(DrawingRefusal::Empty), "{trova:?}");
    assert!(trova.reading.is_none());
}
