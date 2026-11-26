//! «Applica effetto» (`effect.apply`) col filtro dell'IPC (K6, famiglia
//! effetti): l'effetto che aggiunge passa come una riga sua. Un effetto fatto
//! gira; uno che la mappa non ha è rifiutato (uno da fare non è servito,
//! «non ancora pronto»: la prova è in `src/famiglie/tests.rs`, perché la mappa
//! non ne ha più). La pila degli effetti di un oggetto (`effetti/pila.svg`: il
//! primo quadrato ha Irruvidisci e Gonfia e restringi, il secondo Irruvidisci):
//! la lettura, i comandi spenti senza scelta, l'anteprima delle opzioni e un
//! posto che non c'è. I casi con le operazioni sono in `famiglie/effetti.json`.

mod common;

use std::sync::Arc;

use fub_abi::{DrawingCommandRequest, DrawingOutcome, DrawingRefusal, PluginError};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/effetti/base.svg");
const PILA: &str = include_str!("famiglie/effetti/pila.svg");

fn apri() -> Disegno {
    apri_il(BASE)
}

fn apri_il(testo: &str) -> Disegno {
    let ds: Arc<Disegni> = common::disegni();
    ds.filtra(Filtro::Fatte);
    let (d, _) = Disegno::apri_con(&ds, testo).expect("il disegno si apre");
    d
}

fn comando(
    d: &mut Disegno,
    id: &str,
    selezione: &[&str],
    valore: Value,
    anteprima: bool,
) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: selezione.iter().map(|s| (*s).to_string()).collect(),
        value: valore,
        preview: anteprima,
    })
    .expect("il comando risponde")
}

fn applica(d: &mut Disegno, valore: Value) -> Result<DrawingOutcome, PluginError> {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: "disegno.effect.apply".into(),
        selection: vec!["oa1a1a1a1".into()],
        value: valore,
        preview: false,
    })
}

#[test]
fn un_effetto_fatto_gira() {
    let mut d = apri();
    let esito = applica(
        &mut d,
        json!({ "effect": "stylize.roundCorners", "params": { "radius": 15 } }),
    )
    .expect("il comando gira");
    assert!(esito.refused.is_none(), "{esito:?}");
    assert!(esito.ops.is_some(), "{esito:?}");
}

#[test]
fn un_effetto_che_la_mappa_non_ha_e_rifiutato() {
    let mut d = apri();
    let esito =
        applica(&mut d, json!({ "effect": "nessuno.effetto" })).expect("il comando risponde");
    assert!(
        matches!(esito.refused, Some(DrawingRefusal::Unsupported)),
        "{esito:?}"
    );
    assert!(esito.ops.is_none(), "{esito:?}");
}

#[test]
fn la_pila_si_legge_nell_ordine_in_cui_gli_effetti_sono_stati_applicati() {
    let mut d = apri_il(PILA);
    let esito = comando(&mut d, "effect.list", &["oa1a1a1a1"], json!({}), false);
    assert!(esito.refused.is_none(), "{esito:?}");
    assert!(
        esito.ops.is_none(),
        "una lettura non cambia il disegno: {esito:?}"
    );
    let lettura = esito.reading.expect("la pila si legge");
    let applicati = lettura["applied"].as_array().expect("gli oggetti letti");
    assert_eq!(applicati.len(), 1, "{lettura}");
    let ids: Vec<&str> = applicati[0]["effects"]
        .as_array()
        .expect("gli effetti dell'oggetto")
        .iter()
        .filter_map(|e| e["id"].as_str())
        .collect();
    assert_eq!(ids, ["distort.roughen", "distort.puckerBloat"]);
    assert!(
        lettura["catalog"].as_array().is_some_and(|c| !c.is_empty()),
        "il catalogo degli effetti: {lettura}"
    );
}

#[test]
fn i_comandi_della_pila_sono_spenti_senza_scelta_e_accesi_con_un_oggetto() {
    let d = apri_il(PILA);
    let pila = [
        "disegno.effect.remove",
        "disegno.effect.setParams",
        "disegno.effect.duplicate",
        "disegno.effect.move",
    ];
    for (selezione, acceso) in [(vec![], false), (vec!["oa1a1a1a1".to_string()], true)] {
        let comandi = d.comandi(&selezione);
        for id in pila {
            let info = comandi
                .iter()
                .find(|c| c.id == id)
                .unwrap_or_else(|| panic!("{id} manca fra i comandi"));
            assert_eq!(info.enabled, acceso, "{id} con {selezione:?}: {info:?}");
            if !acceso {
                assert_eq!(
                    info.disabled_reason,
                    Some(fub_abi::DrawingDisabledReason::NoSelection),
                    "{id}: {info:?}"
                );
            }
        }
    }
}

#[test]
fn le_opzioni_di_un_effetto_applicato_si_vedono_in_anteprima_senza_cambiare_il_disegno() {
    let mut d = apri_il(PILA);
    let prima = d.revisione();
    let esito = comando(
        &mut d,
        "effect.setParams",
        &["oa1a1a1a1"],
        json!({ "index": 0, "params": { "size": 10 } }),
        true,
    );
    assert!(esito.refused.is_none(), "{esito:?}");
    assert!(esito.preview.is_some(), "l'anteprima: {esito:?}");
    assert!(esito.ops.is_none(), "un'anteprima non scrive: {esito:?}");
    assert_eq!(d.revisione(), prima);
}

#[test]
fn un_posto_della_pila_che_l_oggetto_non_ha_non_cambia_niente() {
    let mut d = apri_il(PILA);
    for (id, valore) in [
        ("effect.remove", json!({ "index": 7 })),
        ("effect.duplicate", json!({ "index": 2 })),
        ("effect.move", json!({ "from": 5, "to": 0 })),
    ] {
        let esito = comando(&mut d, id, &["ob2b2b2b2"], valore, false);
        assert!(esito.ops.is_none(), "{id}: {esito:?}");
        assert!(esito.refused.is_some(), "{id}: {esito:?}");
    }
}
