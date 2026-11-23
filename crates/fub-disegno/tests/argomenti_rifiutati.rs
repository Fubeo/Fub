//! Un comando con argomenti che il motore non prende (`PluginError::BadArgs`) non tocca niente:
//! la copia del disegno resta al byte, la revisione non avanza, non arrivano operazioni (quindi
//! nessun passo nella cronologia del client, né niente da annullare), e il comando dopo va come
//! su un motore appena aperto. Il client tiene viva la sessione dopo un `bad_args`
//! (`docs/architecture/disegno-completo.md`, «La sessione del motore»): questa è la prova che può.
#![cfg(feature = "completo")]

mod common;

use std::path::Path;

use common::apri;
use fub_abi::{DrawingCommandRequest, DrawingOutcome, PluginError};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const TRACCIATI: &str = include_str!("famiglie/tracciati/base.svg");

fn campioni() -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/famiglie/colore/campioni.svg"),
    )
    .expect("il disegno dei campioni")
}

fn comando(
    d: &mut Disegno,
    id: &str,
    scelti: &[&str],
    valore: Value,
) -> Result<DrawingOutcome, PluginError> {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: scelti.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    })
}

/// `sbagliato` dà `BadArgs` e non cambia né la copia né la revisione; poi `giusto` dà le stesse
/// operazioni che dà su un motore appena aperto sullo stesso file.
fn rifiuta_e_poi_va(
    svg: &str,
    sbagliato: (&str, &[&str], Value),
    giusto: (&str, &[&str], Value),
) -> String {
    let (mut d, _) = apri(svg);
    let (testo, revisione) = (d.testo().to_owned(), d.revisione());
    let (id, scelti, valore) = sbagliato;
    let motivo = match comando(&mut d, id, scelti, valore) {
        Err(PluginError::BadArgs(motivo)) => motivo.to_string(),
        altro => panic!("{id}: atteso BadArgs, non {altro:?}"),
    };
    assert_eq!(d.testo(), testo, "{id}: la copia non cambia");
    assert_eq!(d.revisione(), revisione, "{id}: la revisione non avanza");

    let (id, scelti, valore) = giusto;
    let dopo = comando(&mut d, id, scelti, valore.clone()).expect("il comando dopo vale");
    let (mut nuovo, _) = apri(svg);
    let fresco = comando(&mut nuovo, id, scelti, valore).expect("il comando vale");
    assert_eq!(dopo.refused, None, "{id}: {dopo:?}");
    assert!(
        dopo.ops.is_some(),
        "{id}: il comando dopo cambia il disegno"
    );
    assert_eq!(
        common::ops_di(&dopo),
        common::ops_di(&fresco),
        "{id}: il rifiuto non ha lasciato niente nel motore"
    );
    motivo
}

#[test]
fn unire_un_campione_solo_non_tocca_niente() {
    let motivo = rifiuta_e_poi_va(
        &campioni(),
        ("swatch.merge", &[], json!({ "names": ["Blu"] })),
        ("swatch.merge", &[], json!({ "names": ["Blu", "Arancio"] })),
    );
    assert_eq!(motivo, "Scegli due o più campioni da unire.");
}

#[test]
fn un_punto_che_il_tracciato_non_ha_non_tocca_niente() {
    rifiuta_e_poi_va(
        TRACCIATI,
        (
            "path.moveAnchor",
            &["op7a7a7a7"],
            json!({ "element": "op7a7a7a7", "anchor": 99, "x": 1, "y": 1 }),
        ),
        (
            "path.moveAnchor",
            &["op7a7a7a7"],
            json!({ "element": "op7a7a7a7", "anchor": 0, "x": 310, "y": 210 }),
        ),
    );
}

#[test]
fn un_numero_che_non_e_un_numero_non_tocca_niente() {
    rifiuta_e_poi_va(
        TRACCIATI,
        (
            "path.moveAnchor",
            &["op7a7a7a7"],
            json!({ "element": "op7a7a7a7", "anchor": "uno", "x": 1, "y": 1 }),
        ),
        (
            "path.moveAnchor",
            &["op7a7a7a7"],
            json!({ "element": "op7a7a7a7", "anchor": 0, "x": 310, "y": 210 }),
        ),
    );
}
