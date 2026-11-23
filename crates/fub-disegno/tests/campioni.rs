//! I campioni del documento (K6 T14) sul motore: gli argomenti che il file non prende dicono il perché,
//! prima del motore, in italiano. I casi che cambiano il file, e l'ordine che si riapre, stanno in
//! `tests/famiglie/colore.json`.
#![cfg(feature = "completo")]

mod common;

use common::apri;
use fub_abi::{DrawingCommandRequest, PluginError};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};
use std::path::Path;

/// Il disegno con tre campioni (Blu, Arancio, Viola), e Viola usata da un oggetto bloccato.
fn campioni() -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/famiglie/colore/campioni.svg"),
    )
    .expect("il disegno dei campioni")
}

fn richiesta(id: &str, valore: Value) -> DrawingCommandRequest {
    DrawingCommandRequest {
        revision: 0,
        id: id.into(),
        selection: vec![],
        value: valore,
        preview: false,
    }
}

/// Il perché di un argomento che il file non prende: un errore `bad_args` col suo testo.
fn perche(d: &mut Disegno, id: &str, valore: Value) -> String {
    match d.comando(richiesta(id, valore)) {
        Err(PluginError::BadArgs(motivo)) => motivo.to_string(),
        esito => panic!("{id}: attesa una richiesta col suo perché, non {esito:?}"),
    }
}

#[test]
fn gli_argomenti_dei_campioni_dicono_il_perche() {
    let (mut d, _) = apri(&campioni());
    assert_eq!(
        perche(&mut d, "disegno.swatch.duplicate", json!({})),
        "Scegli il campione."
    );
    assert_eq!(
        perche(
            &mut d,
            "disegno.swatch.duplicate",
            json!({ "name": "Verde" })
        ),
        "«Verde» non è un campione del disegno."
    );
    assert_eq!(
        perche(&mut d, "disegno.swatch.merge", json!({ "names": ["Blu"] })),
        "Scegli due o più campioni da unire."
    );
    assert_eq!(
        perche(
            &mut d,
            "disegno.swatch.merge",
            json!({ "names": ["Blu", "Blu"] })
        ),
        "Un campione si unisce una volta sola: togli il doppione."
    );
    // Viola è usata da un oggetto bloccato: unirla lo riscriverebbe.
    assert_eq!(
        perche(
            &mut d,
            "disegno.swatch.merge",
            json!({ "names": ["Blu", "Viola"] })
        ),
        "«Viola» è usato da un oggetto bloccato: sbloccalo prima di unirlo."
    );
    assert_eq!(
        perche(&mut d, "disegno.swatch.move", json!({ "names": [] })),
        "Scegli il campione."
    );
    assert_eq!(
        perche(
            &mut d,
            "disegno.swatch.move",
            json!({ "names": ["Viola", "Viola"] })
        ),
        "Un campione si sposta una volta sola: togli il doppione."
    );
    assert_eq!(
        perche(
            &mut d,
            "disegno.swatch.move",
            json!({ "names": ["Blu"], "group": "Grigi" })
        ),
        "Sposta campione cambia il posto di un campione, non il suo gruppo: usa «Modifica gruppo colori»."
    );
    assert_eq!(
        perche(
            &mut d,
            "disegno.swatch.move",
            json!({ "names": ["Blu"], "to": "primo" })
        ),
        "La posizione è un numero intero, dal primo campione: 0."
    );
}
