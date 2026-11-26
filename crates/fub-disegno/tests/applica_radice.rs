#![cfg(feature = "completo")]
//! Il banco Rust che applica le operazioni del motore (`common/applica.rs`) mette i nuovi elementi della
//! radice dove li mette la scena del client (`scene/engine/base.ts`, ramo `first`): il `metadata` della
//! ricetta dopo la carta, non prima. Un secondo comando sul testo applicato da Rust deve trovare lo stesso
//! percorso che userebbe il client (il `metadata` al percorso 1, dopo `fub-paper` al percorso 0).

mod casi;
mod common;

use casi::cartella_famiglie;
use fub_abi::DrawingCommandRequest;
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

/// Un comando sulla sessione di `testo`: le sue operazioni (se ce ne sono).
fn operazioni(testo: &str, id: &str, sel: &[&str], valore: Value) -> Option<Value> {
    let disegni = casi::disegni_di_prova();
    let (mut d, _) = Disegno::apri_con(&disegni, testo).expect("il disegno si apre");
    let richiesta = DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: sel.iter().map(|s| s.to_string()).collect(),
        value: valore,
        preview: false,
    };
    let esito = d.comando(richiesta).expect("il comando risponde");
    esito
        .ops
        .map(|o| serde_json::from_str(&o).expect("le operazioni sono JSON"))
}

#[test]
fn il_metadata_della_ricetta_va_dopo_la_carta_come_nel_client() {
    let base = std::fs::read_to_string(cartella_famiglie().join("tracciati/base.svg")).unwrap();
    // Il primo comando crea la ricetta: il suo `add` del `metadata` va in testa alla radice.
    let ops = operazioni(
        &base,
        "addon.pathtools.cornerSet",
        &["op7a7a7a7"],
        json!({"radius": 10}),
    )
    .expect("Imposta angoli scrive operazioni");
    let applicato = common::applica::applica(&base, &ops).expect("le operazioni si applicano");
    let carta = applicato.find("fub-paper").expect("c'è la carta");
    let ricetta = applicato
        .find("<metadata")
        .expect("c'è il metadata della ricetta");
    assert!(
        carta < ricetta,
        "il metadata deve venire dopo la carta, come nel client:\n{applicato}"
    );
    // Il secondo comando, sul testo applicato da Rust, rimuove la ricetta: il percorso deve essere quello
    // del client, il metadata al percorso 1 (la carta è al percorso 0).
    let rimozione = operazioni(
        &applicato,
        "addon.pathtools.cornerRemove",
        &["op7a7a7a7"],
        json!({}),
    )
    .expect("Rimuovi angoli scrive operazioni");
    assert!(
        rimozione
            .to_string()
            .contains(r#""target":{"path":[1],"tag":"metadata"}"#),
        "il percorso del metadata deve essere 1, come nel client: {rimozione}"
    );
}
