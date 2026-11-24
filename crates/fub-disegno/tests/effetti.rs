//! «Applica effetto» (`effect.apply`) col filtro dell'IPC (K6, famiglia
//! effetti): l'effetto che aggiunge passa come una riga sua. Un effetto fatto
//! gira; uno da fare non è servito («non ancora pronto») e non arriva al
//! motore; uno che la mappa non ha è rifiutato. I casi con le operazioni sono
//! in `famiglie/effetti.json`.

mod common;

use std::sync::Arc;

use fub_abi::{DrawingCommandRequest, DrawingOutcome, DrawingRefusal, PluginError};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/effetti/base.svg");

fn apri() -> Disegno {
    let ds: Arc<Disegni> = common::disegni();
    ds.filtra(Filtro::Fatte);
    let (d, _) = Disegno::apri_con(&ds, BASE).expect("il disegno si apre");
    d
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
fn un_effetto_da_fare_non_e_servito() {
    let mut d = apri();
    for chiave in ["effect", "id"] {
        let esito = applica(&mut d, json!({ chiave: "artistic.neonGlow" }));
        assert!(matches!(esito, Err(PluginError::Unserved(_))), "{esito:?}");
        assert!(
            format!("{esito:?}").contains("host.drawing.not_done"),
            "{esito:?}"
        );
    }
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
