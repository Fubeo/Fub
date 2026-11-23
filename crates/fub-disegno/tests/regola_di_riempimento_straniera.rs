//! La regola di riempimento di un file di un altro programma (`fill-rule="evenodd"` sull'attributo o
//! `style="fill-rule:evenodd"`) non si scrive dal Disegno: il formato non ha un `fill-rule` sui tracciati
//! (`mappa.tsv`, `path.setFillRule`). Il tracciato con la regola straniera è estraneo: i comandi su di lui
//! sono rifiutati (`unmapped`), e i comandi sugli altri oggetti lo lasciano byte per byte com'è.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use fub_abi::DrawingCommandRequest;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const PRIMA: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <path id=\"oq1q1q1q1\" d=\"M40 40 L160 40 L160 160 L40 160 Z M80 80 L80 120 L120 120 L120 80 Z\" fill=\"#3366aa\" fill-rule=\"evenodd\"/>\n    <path id=\"oq2q2q2q2\" d=\"M220 40 L300 40 L300 120 L220 120 Z\" fill=\"#ff0000\"/>\n  </g>\n</svg>\n";
const STILE: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <path id=\"oq1q1q1q1\" d=\"M40 40 L160 40 L160 160 L40 160 Z M80 80 L80 120 L120 120 L120 80 Z\" fill=\"#3366aa\" style=\"fill-rule:evenodd\"/>\n    <path id=\"oq2q2q2q2\" d=\"M220 40 L300 40 L300 120 L220 120 Z\" fill=\"#ff0000\"/>\n  </g>\n</svg>\n";

/// La riga del tracciato straniero, come sta nel file.
const RIGA_STRANIERA_ATTR: &str = "fill-rule=\"evenodd\"";
const RIGA_STRANIERA_STILE: &str = "style=\"fill-rule:evenodd\"";

fn disegni() -> Arc<Disegni> {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    disegni
}

/// La risposta del comando `id` sulla selezione `sel` del file `svg`.
fn comando(svg: &str, id: &str, sel: &[&str], valore: Value) -> fub_abi::DrawingOutcome {
    let (mut d, aperto) = Disegno::apri_con(&disegni(), svg).expect("si apre");
    d.comando(DrawingCommandRequest {
        revision: aperto.revision,
        id: format!("disegno.{id}"),
        selection: sel.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    })
    .expect("il comando risponde")
}

/// Il file dopo le operazioni del comando (o il file com'era, se non scrive).
fn dopo(svg: &str, esito: &fub_abi::DrawingOutcome) -> String {
    match &esito.ops {
        Some(ops) => {
            let ops: Value = serde_json::from_str(ops).expect("json");
            common::applica::applica(svg, &ops).expect("le operazioni si applicano")
        }
        None => svg.to_string(),
    }
}

/// La riga del tracciato straniero nel file: deve restare com'era, byte per byte.
fn riga_straniera(testo: &str) -> &str {
    testo
        .lines()
        .find(|l| l.contains("id=\"oq1q1q1q1\""))
        .expect("il tracciato straniero c'è ancora")
}

/// I comandi sul tracciato straniero stesso sono rifiutati: il file non cambia.
fn rifiutati_sul_tracciato_straniero(svg: &str) {
    let comandi: [(&str, Value); 5] = [
        ("object.nudge", json!({ "dx": 1 })),
        ("object.scale", json!({ "sx": 50 })),
        ("paint.setFill", json!({ "color": "#00aa00" })),
        ("edit.duplicate", json!({})),
        ("object.pathfinder.unite", json!({})),
    ];
    for (id, valore) in comandi {
        let sel: Vec<&str> = if id == "object.pathfinder.unite" {
            vec!["oq1q1q1q1", "oq2q2q2q2"]
        } else {
            vec!["oq1q1q1q1"]
        };
        let esito = comando(svg, id, &sel, valore);
        assert!(
            esito.ops.is_none(),
            "{id} sul tracciato straniero non scrive: {esito:?}"
        );
        assert_eq!(
            esito.refused,
            Some(fub_abi::DrawingRefusal::Unmapped),
            "{id}: rifiutato come estraneo"
        );
    }
}

/// I comandi sull'altro tracciato lasciano la riga straniera com'era, al byte.
fn altri_comandi_lasciano_la_riga(svg: &str, riga: &str) {
    let comandi: [(&str, Value); 3] = [
        ("object.nudge", json!({ "dx": 1 })),
        ("paint.setFill", json!({ "color": "#00aa00" })),
        ("edit.duplicate", json!({})),
    ];
    for (id, valore) in comandi {
        let esito = comando(svg, id, &["oq2q2q2q2"], valore);
        assert_eq!(
            esito.refused, None,
            "{id} sull'altro tracciato passa: {esito:?}"
        );
        let nuovo = dopo(svg, &esito);
        assert_eq!(
            riga_straniera(&nuovo),
            riga,
            "{id}: la regola straniera resta al byte"
        );
        assert!(nuovo.contains(riga), "{id}: la regola c'è ancora nel file");
    }
}

#[test]
fn la_regola_straniera_come_attributo_sopravvive_agli_altri_comandi() {
    rifiutati_sul_tracciato_straniero(PRIMA);
    altri_comandi_lasciano_la_riga(PRIMA, "    <path id=\"oq1q1q1q1\" d=\"M40 40 L160 40 L160 160 L40 160 Z M80 80 L80 120 L120 120 L120 80 Z\" fill=\"#3366aa\" fill-rule=\"evenodd\"/>");
    assert!(PRIMA.contains(RIGA_STRANIERA_ATTR));
}

#[test]
fn la_regola_straniera_nello_stile_sopravvive_agli_altri_comandi() {
    rifiutati_sul_tracciato_straniero(STILE);
    altri_comandi_lasciano_la_riga(STILE, "    <path id=\"oq1q1q1q1\" d=\"M40 40 L160 40 L160 160 L40 160 Z M80 80 L80 120 L120 120 L120 80 Z\" fill=\"#3366aa\" style=\"fill-rule:evenodd\"/>");
    assert!(STILE.contains(RIGA_STRANIERA_STILE));
}
