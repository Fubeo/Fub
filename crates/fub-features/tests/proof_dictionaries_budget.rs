//! I dizionari della macchina sono una cache del budget dei motori: il
//! correttore che li legge la iscrive, la cache conta i byte del dizionario
//! letto, e un budget a tetto basso lo lascia cadere senza cambiare la
//! risposta, perché la parola dopo lo rilegge.
//!
//! È un eseguibile a parte, come `proof_machine_dictionary.rs`: il motore
//! tiene i dizionari in uno stato di processo.
#![cfg(feature = "proof")]

use fub_abi::traits::{IndexProvider, IndexQuery, IndexResult};
use fub_features::proof::{dictionaries_cache, dictionary_bytes, empty_dictionaries};
use fub_features::{ProofIndex, PROOF_ID};
use fub_motori::{Budget, Servizi, Tetto};
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
fn i_dizionari_letti_stanno_nel_budget_e_si_rileggono() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("it_IT.aff"), "SET UTF-8\n").unwrap();
    std::fs::write(
        dir.path().join("it_IT.dic"),
        "6\nil\ngatto\ndorme\nsul\ndivano\nperché\n",
    )
    .unwrap();
    std::env::set_var("WORDCRAFT_DICTIONARIES", dir.path());

    let processo = Servizi::processo();
    let prima = processo.memoria().quante();
    let machine = ProofIndex::with_machine_dictionaries();
    assert_eq!(
        processo.memoria().quante(),
        prima + 1,
        "iscritta nel budget"
    );
    let _ = ProofIndex::with_machine_dictionaries();
    assert_eq!(processo.memoria().quante(), prima + 1, "una volta sola");
    assert_eq!(dictionary_bytes(), 0, "nessun dizionario ancora letto");

    let text = "Il gatto dormee sul divano.";
    let risposta = check(&machine, text);
    assert_eq!(risposta["language"]["spelling"], true);
    let letti = dictionary_bytes();
    assert!(letti > 0, "il dizionario letto si conta");
    assert_eq!(dictionaries_cache().byte(), letti);
    assert!(processo.memoria().usati() >= letti);

    // Un budget a tetto basso lo lascia cadere; la domanda dopo lo rilegge e
    // risponde uguale.
    let budget = Budget::nuovo(Tetto::fisso(1));
    budget.registra(&dictionaries_cache());
    let resoconto = budget.rispetta();
    assert_eq!(resoconto.prima, letti, "{resoconto:?}");
    assert_eq!(resoconto.dopo, 0, "{resoconto:?}");
    assert_eq!(dictionary_bytes(), 0);
    assert_eq!(check(&machine, text), risposta);
    assert_eq!(dictionary_bytes(), letti);

    // Svuotarli del tutto, come alla chiusura dell'ultimo vault.
    assert_eq!(empty_dictionaries(), letti);
    assert_eq!(dictionary_bytes(), 0);
}
