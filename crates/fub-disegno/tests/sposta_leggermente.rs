//! Sposta leggermente (`object.nudge`) su una catena di passi (K6 T13, scenario «dieci volte di
//! fila»): ogni passo si applica al testo come farebbe il client, il file si riapre, e il passo dopo
//! parte dal file riaperto. Il ritorno di un passo (Annulla) è della cronologia del client, e lì
//! è provato byte per byte per ogni caso (`casi.test.ts`); qui si prova che la catena regge, con
//! una riapertura a ogni passo.

#![cfg(feature = "completo")]

mod common;

use fub_abi::DrawingCommandRequest;
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/trasforma/base.svg");

fn comando(id: &str, selezione: &[&str], valore: Value, revisione: u64) -> DrawingCommandRequest {
    DrawingCommandRequest {
        revision: revisione,
        id: id.into(),
        selection: selezione.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    }
}

fn apri(testo: &str) -> (Disegno, u64) {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (d, aperto) = Disegno::apri_con(&disegni, testo).expect("il disegno si apre");
    assert!(aperto.losses.is_empty(), "la riapertura non perde niente: {:?}", aperto.losses);
    (d, aperto.revision)
}

#[test]
fn dieci_spostamenti_di_fila_reggono_con_una_riapertura_a_ogni_passo() {
    let mut testo = BASE.to_string();
    let mut prima = testo.clone();
    for passo in 1..=10 {
        let (mut d, revisione) = apri(&testo);
        let esito = d
            .comando(comando("disegno.object.nudge", &["oa1a1a1a1"], json!({ "dx": 1 }), revisione))
            .expect("il comando risponde");
        assert!(esito.refused.is_none(), "passo {passo}: nessun rifiuto");
        let ops: Value = serde_json::from_str(esito.ops.as_deref().expect("il passo dà operazioni"))
            .expect("le operazioni sono JSON");
        let nuovo = common::applica::applica(&testo, &ops).expect("le operazioni si applicano");
        assert_ne!(nuovo, prima, "passo {passo}: il file cambia");
        prima = testo;
        testo = nuovo;
    }
    // Dopo dieci passi l'oggetto è spostato di 10 pt nel piano della pagina, e il file si riapre.
    assert!(
        testo.contains(r#"transform="matrix(1 0 0 1 10 0)""#) && testo.contains(r#"id="oa1a1a1a1""#),
        "il rettangolo è spostato di 10: {testo}"
    );
    let (_, _) = apri(&testo);
}
