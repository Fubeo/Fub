//! L'ortografia italiana con un dizionario Hunspell della macchina.
//!
//! È un eseguibile a parte perché il motore tiene il dizionario caricato in uno
//! stato di processo: la prima domanda in italiano lo cerca e lo ricorda, e un
//! test che lo installa non deve cambiare la risposta agli altri. Il dizionario
//! qui è minuscolo e scritto apposta; quello vero (`it_IT` di LibreOffice o del
//! pacchetto `hunspell-it`) segue la stessa strada.
#![cfg(feature = "proof")]

use fub_abi::traits::{IndexProvider, IndexQuery, IndexResult};
use fub_features::{ProofIndex, PROOF_ID};
use serde_json::{json, Value};

fn check(index: &ProofIndex, text: &str) -> Value {
    let Ok(IndexResult::Custom(value)) = index.query(IndexQuery::Custom {
        ns: PROOF_ID.into(),
        query: json!({"op": "check", "version": 1, "language": "it-IT", "segments": [text]}),
    }) else {
        panic!("check must answer");
    };
    value
}

#[test]
fn only_the_host_wiring_reads_the_machine_dictionary() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("it_IT.aff"), "SET UTF-8\n").unwrap();
    std::fs::write(
        dir.path().join("it_IT.dic"),
        "6\nil\ngatto\ndorme\nsul\ndivano\nperché\n",
    )
    .unwrap();
    std::env::set_var("WORDCRAFT_DICTIONARIES", dir.path());

    // Senza il collegamento dell'host la feature non guarda il disco, anche
    // se il dizionario c'è: dice soltanto cosa manca.
    let bundled = ProofIndex::bundled_only();
    let value = check(&bundled, "Il gatto dormee sul divano.");
    assert_eq!(value["language"]["spelling"], false);
    assert_eq!(value["language"]["missing_dictionary"], "it_IT");
    assert_eq!(value["segments"][0], json!([]));

    let machine = ProofIndex::with_machine_dictionaries();
    let text = "Il gatto dormee sul divano, perché sì.";
    let value = check(&machine, text);
    assert_eq!(value["language"]["spelling"], true);
    assert_eq!(value["language"]["missing_dictionary"], Value::Null);
    let issues = value["segments"][0].as_array().unwrap();
    let spelled: Vec<&str> = issues
        .iter()
        .filter(|i| i["kind"] == "spelling")
        .map(|i| &text[i["start"].as_u64().unwrap() as usize..i["end"].as_u64().unwrap() as usize])
        .collect();
    assert_eq!(spelled, ["dormee", "sì"]);
}
