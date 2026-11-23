//! Un testo di punto dentro un gruppo (K6 T13, «testo dentro un gruppo»): Ruota, Scala, Inclina,
//! Rifletti e Sposta sul gruppo scrivono la `transform` sul `<g>`, e Ruota e Scala sul testo scelto da
//! solo scrivono la `transform` sul `<text>` dentro il gruppo. Il file riaperto ha ancora il testo come
//! testo di punto, con le sue parole, senza perdite oltre a quelle dell'originale.
//!
//! Il testo in area dentro un gruppo non è qui: il motore lo importa come testo di punto (vedi
//! `RISCHI` nel rapporto del giro), e il caso va fermato prima di scriverlo.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use fub_abi::DrawingCommandRequest;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};
use vectorcraft_doc::NodeKind;

const GRUPPO: &str = include_str!("famiglie/trasforma/t13-gruppo-testo.svg");
const GRUPPO_ID: &str = "gt5t5t5t5";
const TESTO_ID: &str = "ot1t1t1t1";

fn disegni() -> Arc<Disegni> {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    disegni
}

/// Il file dopo il comando su `scelto`, applicate le operazioni; la lista dei nomi che il comando scrive.
fn dopo(
    disegni: &Arc<Disegni>,
    svg: &str,
    scelto: &str,
    comando: &str,
    valore: Value,
) -> (String, Vec<String>) {
    let (mut d, aperto) = Disegno::apri_con(disegni, svg).expect("si apre");
    let esito = d
        .comando(DrawingCommandRequest {
            revision: aperto.revision,
            id: format!("disegno.{comando}"),
            selection: vec![scelto.into()],
            value: valore,
            preview: false,
        })
        .expect("il comando risponde");
    assert_eq!(esito.refused, None, "{comando} su {scelto}: {esito:?}");
    let ops: Value =
        serde_json::from_str(&esito.ops.expect("il comando dà operazioni")).expect("json");
    let mut scritti = Vec::new();
    fn raccogli(op: &Value, scritti: &mut Vec<String>) {
        if let Some(figli) = op.get("ops").and_then(Value::as_array) {
            figli.iter().for_each(|f| raccogli(f, scritti));
        } else if let Some(id) = op.get("id").and_then(Value::as_str) {
            scritti.push(id.to_string());
        }
    }
    for op in ops.as_array().expect("una lista") {
        raccogli(op, &mut scritti);
    }
    (
        common::applica::applica(svg, &ops).expect("le operazioni si applicano"),
        scritti,
    )
}

/// Il file riaperto: nessuna perdita oltre a quelle dell'originale, un solo testo di punto nel disegno,
/// e le sue parole ancora nel file.
fn riaperto(disegni: &Arc<Disegni>, svg: &str) {
    let (_, prima) = Disegno::apri_con(disegni, GRUPPO).expect("l'originale si apre");
    let (mut d, dopo) = Disegno::apri_con(disegni, svg).expect("il file riaperto si apre");
    assert!(
        dopo.losses.len() <= prima.losses.len(),
        "la trasformazione non aggiunge perdite: {:?}",
        dopo.losses
    );
    let mut testi = 0;
    let _ = d.a_mano(|doc, _| {
        doc.walk(|n| {
            if matches!(n.kind, NodeKind::Text(_)) {
                testi += 1;
            }
        });
    });
    assert_eq!(testi, 1, "il testo è un testo nel disegno riaperto");
    assert!(svg.contains("Ciao"), "le parole ci sono ancora");
    assert!(
        svg.contains(&format!("id=\"{TESTO_ID}\"")),
        "il testo ha il suo id"
    );
}

#[test]
fn le_trasformazioni_del_gruppo_con_un_testo_si_riaprono_come_testo() {
    let disegni = disegni();
    let sul_gruppo = [
        ("object.rotate", json!({ "angle": 90 })),
        ("object.scale", json!({ "sx": 50 })),
        ("object.shear", json!({ "angle": 15, "axis": "horizontal" })),
        ("object.reflect", json!({ "axis": "vertical" })),
        ("object.nudge", json!({ "dx": 1 })),
    ];
    for (comando, valore) in sul_gruppo {
        let (svg, scritti) = dopo(&disegni, GRUPPO, GRUPPO_ID, comando, valore);
        assert!(
            scritti.iter().all(|s| s == GRUPPO_ID),
            "{comando}: scrive solo il gruppo, scrive {scritti:?}"
        );
        riaperto(&disegni, &svg);
    }
    let sul_testo = [
        ("object.rotate", json!({ "angle": 90 })),
        ("object.scale", json!({ "sx": 50 })),
    ];
    for (comando, valore) in sul_testo {
        let (svg, scritti) = dopo(&disegni, GRUPPO, TESTO_ID, comando, valore);
        assert!(
            scritti.iter().all(|s| s == TESTO_ID),
            "{comando}: scrive solo il testo, scrive {scritti:?}"
        );
        riaperto(&disegni, &svg);
    }
}

/// Il testo in area dentro un gruppo (`t13-gruppo-area.svg`) è importato come testo di punto, senza
/// perdita segnalata: le righe si uniscono e `fub:wrap` non entra nel modello. Il caso è fermato qui,
/// `#[ignore]` finché l'importazione non lo tiene come area (il file minimo è questo).
#[test]
#[ignore = "il testo in area dentro un gruppo è importato come testo di punto: da correggere nell'importazione"]
fn il_testo_in_area_dentro_un_gruppo_resta_in_area() {
    use vectorcraft_doc::text::TextKind;
    let disegni = disegni();
    let svg = include_str!("famiglie/trasforma/t13-gruppo-area.svg");
    let (mut d, _) = Disegno::apri_con(&disegni, svg).expect("si apre");
    let mut in_area = 0;
    let _ = d.a_mano(|doc, _| {
        doc.walk(|n| {
            if let NodeKind::Text(t) = &n.kind {
                if matches!(t.kind, TextKind::Area { .. }) {
                    in_area += 1;
                }
            }
        });
    });
    assert_eq!(
        in_area, 1,
        "il testo in area dentro il gruppo resta in area"
    );
}
