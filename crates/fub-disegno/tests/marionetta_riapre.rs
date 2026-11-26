//! Altera marionetta (`object.puppetWarp`, K6 T13): il file deformato si riapre senza perdite e la
//! marionetta vale ancora sopra, due volte di fila (gli spilli sono nel valore del comando, non nello
//! stato della sessione: il secondo comando parte dal file riaperto).

#![cfg(feature = "completo")]

mod common;

use fub_abi::DrawingCommandRequest;
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/trasforma/base.svg");

/// Il comando della marionetta su `svg`: il file dopo, applicate le operazioni.
fn deforma(svg: &str, pins: Value, moved: Value) -> String {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (mut d, aperto) = Disegno::apri_con(&disegni, svg).expect("si apre");
    let esito = d
        .comando(DrawingCommandRequest {
            revision: aperto.revision,
            id: "disegno.object.puppetWarp".into(),
            selection: vec!["op7a7a7a7".into()],
            value: json!({ "pins": pins, "moved": moved }),
            preview: false,
        })
        .expect("il comando risponde");
    assert_eq!(esito.refused, None, "{esito:?}");
    let ops: Value =
        serde_json::from_str(&esito.ops.expect("il comando dà operazioni")).expect("json");
    common::applica::applica(svg, &ops).expect("le operazioni si applicano")
}

#[test]
fn la_marionetta_si_riapre_senza_perdite_e_vale_due_volte_di_fila() {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (_, prima) = Disegno::apri_con(&disegni, BASE).expect("l'originale si apre");

    let primo = deforma(
        BASE,
        json!([[300, 200], [360, 200], [330, 260]]),
        json!([[300, 220], [360, 200], [330, 260]]),
    );
    let (_, dopo_primo) = Disegno::apri_con(&disegni, &primo).expect("il file deformato si apre");
    assert!(
        dopo_primo.losses.len() <= prima.losses.len(),
        "la riapertura non aggiunge perdite: {:?}",
        dopo_primo.losses
    );
    assert!(
        primo.contains(r#"d="M300 220 L360 200 L330 260 Z""#),
        "la forma è cambiata: {primo}"
    );

    // Secondo giro: uno spillo sul vertice spostato, e l'oggetto segue dal file riaperto.
    let secondo = deforma(&primo, json!([[360, 200]]), json!([[370, 200]]));
    assert_ne!(secondo, primo, "il secondo giro cambia il file");
    let (_, dopo_secondo) = Disegno::apri_con(&disegni, &secondo).expect("il secondo file si apre");
    assert!(
        dopo_secondo.losses.len() <= prima.losses.len(),
        "il secondo file non aggiunge perdite: {:?}",
        dopo_secondo.losses
    );
}
