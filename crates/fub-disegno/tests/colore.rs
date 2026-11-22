//! La famiglia `colore` (piano K6, T14; `docs/product/drawing-colors.md`):
//! il colore attivo e Modifica colori sono spenti col perché vero quando gli
//! oggetti scelti non si possono ricolorare, e il lato attivo del colore si
//! cambia e si legge senza toccare il disegno.

#![cfg(feature = "completo")]

mod common;

use common::apri;
use fub_abi::{DrawingCommandRequest, DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/colore/base.svg");

/// I comandi che ricolorano gli oggetti scelti, uno per gruppo.
const SUGLI_SCELTI: [&str; 4] = [
    "paint.setFill",
    "paint.invert",
    "edit.colors.saturate",
    "edit.colors.blendHorizontally",
];

fn perche(d: &Disegno, scelti: &[&str]) -> Vec<(String, Option<DrawingDisabledReason>)> {
    let scelti: Vec<String> = scelti.iter().map(|s| s.to_string()).collect();
    let stato = d.comandi(&scelti);
    SUGLI_SCELTI
        .iter()
        .map(|id| {
            let info = stato
                .iter()
                .find(|c| c.id == format!("disegno.{id}"))
                .unwrap_or_else(|| panic!("{id} elencato"));
            assert_eq!(info.enabled, info.disabled_reason.is_none(), "{id}");
            (id.to_string(), info.disabled_reason.clone())
        })
        .collect()
}

fn comando(
    d: &mut Disegno,
    id: &str,
    scelti: &[&str],
    valore: Value,
) -> Result<fub_abi::DrawingOutcome, PluginError> {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: scelti.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    })
}

fn tutti(r: Option<DrawingDisabledReason>) -> Vec<(String, Option<DrawingDisabledReason>)> {
    SUGLI_SCELTI
        .iter()
        .map(|id| (id.to_string(), r.clone()))
        .collect()
}

#[test]
fn i_comandi_del_colore_sono_spenti_col_perche() {
    let (d, _) = apri(BASE);
    use DrawingDisabledReason::*;
    assert_eq!(perche(&d, &[]), tutti(Some(NoSelection)));
    assert_eq!(perche(&d, &["oa1a1a1a1"]), tutti(None));
    // Un oggetto bloccato non si cambia: lo dice «sola lettura».
    assert_eq!(perche(&d, &["oc3c3c3c3"]), tutti(Some(ReadOnly)));
    // Un tratto dell'Inchiostro è di Fub: i suoi colori non passano dal motore.
    assert_eq!(perche(&d, &["oa1a1a1a1", "oi8b8b8b8"]), tutti(Some(FubInk)));
    // Un id che il disegno non ha.
    assert_eq!(perche(&d, &["onessuno1"]), tutti(Some(Unmapped)));
}

#[test]
fn il_lato_attivo_si_cambia_e_si_legge_senza_toccare_il_disegno() {
    let (mut d, _) = apri(BASE);
    let prima = d.revisione();
    let esito = comando(&mut d, "paint.toggleActive", &[], json!({ "fill": false }))
        .expect("il lato attivo si cambia anche senza niente di scelto");
    assert_eq!(d.revisione(), prima, "il disegno non cambia");
    assert_eq!(
        esito.reading,
        Some(json!({ "fillActive": false })),
        "{esito:?}"
    );
    // «Nessuno» ora va sul tratto, che è il lato attivo.
    let esito = comando(&mut d, "paint.none", &["oa1a1a1a1"], json!({})).expect("vale");
    assert_eq!(
        common::ops_di(&esito),
        json!([{ "op": "set", "id": "oa1a1a1a1", "attrs": { "stroke": "none", "stroke-width": "0" } }])
    );
}

#[test]
fn una_fusione_con_meno_di_tre_riempimenti_non_fa_niente() {
    let (mut d, _) = apri(BASE);
    let prima = d.revisione();
    // Il gruppo conta i suoi due figli: con il nero sono tre.
    assert!(comando(
        &mut d,
        "edit.colors.blendFrontToBack",
        &["gd4d4d4d4", "ob2b2b2b2"],
        json!({})
    )
    .is_ok());
    let (mut d, _) = apri(BASE);
    match comando(
        &mut d,
        "edit.colors.blendVertically",
        &["oa1a1a1a1", "ob2b2b2b2"],
        json!({}),
    ) {
        Ok(esito) => assert_eq!(esito.refused, Some(DrawingRefusal::Empty), "{esito:?}"),
        Err(e) => panic!("{e:?}"),
    }
    assert_eq!(d.revisione(), prima);
}
