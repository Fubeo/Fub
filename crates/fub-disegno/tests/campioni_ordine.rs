//! Ordina i campioni per specie (`swatch.sortByKind`, piano K6, T14; la famiglia `colore`).
//!
//! Nel formato del disegno tutti i campioni sono colori pieni e globali (`campioni.rs` rifiuta gli altri),
//! quindi l'ordine per specie non cambia niente: il comando dà sempre `empty`, prima e dopo, e il file
//! resta com'è. Qui si prova che cosa si vede dopo il comando, e che un disegno di sola lettura lo rifiuta.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::disegni;
use fub_abi::{DrawingCommandRequest, DrawingOutcome, DrawingRefusal};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const CAMPIONI: &str = include_str!("famiglie/colore/campioni.svg");

fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, _) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    d
}

fn comando(d: &mut Disegno, id: &str, valore: Value) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: vec![],
        value: valore,
        preview: false,
    })
    .expect("il comando gira")
}

/// Il nome di ogni campione, nell'ordine in cui il motore li elenca.
fn elenco(d: &mut Disegno) -> Vec<String> {
    let lettura = comando(d, "swatch.list", json!({}))
        .reading
        .expect("una lettura");
    lettura["swatches"]
        .as_array()
        .or_else(|| lettura.as_array())
        .expect("una lista di campioni")
        .iter()
        .filter_map(|s| s["name"].as_str().map(str::to_string))
        .collect()
}

#[test]
fn ordinare_per_specie_non_cambia_il_file_ne_l_elenco_e_si_ripete_uguale() {
    let ds = motore();
    let mut d = apri(&ds, CAMPIONI);
    let file_prima = d.testo().to_string();
    let elenco_prima = elenco(&mut d);
    // Prima volta: `empty`, niente passo.
    let primo = comando(&mut d, "swatch.sortByKind", json!({}));
    assert_eq!(primo.refused, Some(DrawingRefusal::Empty), "{primo:?}");
    assert!(primo.ops.is_none());
    // Seconda volta: uguale alla prima, niente doppioni, niente errore.
    let secondo = comando(&mut d, "swatch.sortByKind", json!({}));
    assert_eq!(secondo.refused, Some(DrawingRefusal::Empty), "{secondo:?}");
    assert_eq!(d.testo(), file_prima, "il file non cambia");
    assert_eq!(elenco(&mut d), elenco_prima, "l'elenco non cambia");
}

#[test]
fn salvare_e_riaprire_dopo_l_ordinamento_ritrova_lo_stesso_elenco() {
    let ds = motore();
    let mut d = apri(&ds, CAMPIONI);
    let elenco_prima = elenco(&mut d);
    let _ = comando(&mut d, "swatch.sortByKind", json!({}));
    let testo = d.testo().to_string();
    let mut riaperto = apri(&ds, &testo);
    assert_eq!(
        elenco(&mut riaperto),
        elenco_prima,
        "dopo la riapertura l'elenco è lo stesso"
    );
}

#[test]
fn in_sola_lettura_ordinare_si_rifiuta_come_gli_altri_comandi_sul_colore() {
    // Un SVG che Fub non apre come suo: in sola lettura, il comando non scrive il disegno e si rifiuta.
    let ds = motore();
    let testo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\"><rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/></svg>";
    let mut d = apri(&ds, testo);
    let esito = comando(&mut d, "swatch.sortByKind", json!({}));
    assert_eq!(
        esito.refused,
        Some(DrawingRefusal::Unsupported),
        "{esito:?}"
    );
}
