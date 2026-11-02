//! **Chiuso l'ultimo vault, le cache dei motori sono vuote.**
//!
//! Leggere un `.docx` lascia nel motore dei documenti la prova a vuoto
//! accettata, e controllare l'ortografia italiana lascia in memoria il
//! dizionario della macchina. Con un altro vault ancora aperto le cache
//! restano al budget dei motori; chiuso l'ultimo, l'host le svuota.
//!
//! È un eseguibile a parte: le cache sono del processo, e gli altri test
//! dell'host le riempirebbero e le svuoterebbero mentre questo le guarda.

#![cfg(all(feature = "rich", feature = "proof"))]

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_format_rich::motore::MotoreDocumenti;
use fub_format_rich::Codec;
use fub_host::Host;
use fub_motori::Voce;
use serde_json::json;

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn with_docx(host: &Host) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        std::fs::write(root.join("Lettera.docx"), docx()).unwrap();
        host.open(&root).expect("opens the vault");
        host.wait_indexed(Some(root.as_str())).expect("indexed");
        Vault { _dir: dir, root }
    }
}

/// Un `.docx` vuoto, scritto dal codec stesso.
fn docx() -> Vec<u8> {
    fub_format_rich::blank(Codec::Docx).unwrap()
}

fn check_italian(host: &Host, vault: &Vault) {
    let Ok(IndexResult::Custom(value)) = host.query_index(
        Some(vault.root.as_str()),
        IndexQuery::Custom {
            ns: "fub.proof".into(),
            query: json!({"op": "check", "version": 1, "language": "it-IT", "segments": ["Il gatto dormee."]}),
        },
    ) else {
        panic!("the proof route answers");
    };
    assert_eq!(value["language"]["spelling"], true, "{value}");
}

#[test]
fn chiuso_l_ultimo_vault_le_cache_dei_motori_sono_vuote() {
    let dictionaries = tempfile::tempdir().unwrap();
    std::fs::write(dictionaries.path().join("it_IT.aff"), "SET UTF-8\n").unwrap();
    std::fs::write(
        dictionaries.path().join("it_IT.dic"),
        "3\nil\ngatto\ndorme\n",
    )
    .unwrap();
    std::env::set_var("WORDCRAFT_DICTIONARIES", dictionaries.path());

    let config = tempfile::tempdir().expect("config");
    let host = Host::without_watcher()
        .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
    let motore = MotoreDocumenti::processo();
    let primo = Vault::with_docx(&host);
    let secondo = Vault::with_docx(&host);

    host.read_document(Some(primo.root.as_str()), &DocId::new("Lettera.docx"))
        .expect("reads the document");
    check_italian(&host, &primo);
    let documenti = motore.byte();
    assert!(documenti > 0, "la prova a vuoto letta si conta");
    let dizionari = fub_features::proof::dictionary_bytes();
    assert!(dizionari > 0, "il dizionario letto si conta");

    // Un altro vault è aperto: le cache restano al budget.
    assert!(host.close_vault(&primo.root).unwrap().is_empty());
    assert_eq!(motore.byte(), documenti);
    assert_eq!(fub_features::proof::dictionary_bytes(), dizionari);

    // Chiuso l'ultimo, sono vuote.
    assert!(host.close_vault(&secondo.root).unwrap().is_empty());
    assert_eq!(motore.byte(), 0);
    assert_eq!(motore.prove_ricordate(), 0);
    assert_eq!(fub_features::proof::dictionary_bytes(), 0);

    // Riaperto un vault, i documenti si leggono di nuovo, e chiudere tutto
    // (lo spegnimento dell'app) le svuota allo stesso modo.
    let terzo = Vault::with_docx(&host);
    host.read_document(Some(terzo.root.as_str()), &DocId::new("Lettera.docx"))
        .expect("reads the document");
    check_italian(&host, &terzo);
    assert!(motore.byte() > 0);
    assert!(host.close().is_empty());
    assert_eq!(motore.byte(), 0);
    assert_eq!(fub_features::proof::dictionary_bytes(), 0);
}
