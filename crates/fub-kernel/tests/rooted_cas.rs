//! CAS cooperativo sul backend di produzione, con handle aperti indipendenti.
//!
//! Ogni contesa deve riuscire: le iterazioni non sono tentativi di recupero.
//! Il binario separato conserva la diagnostica degli errori I/O senza dipendere
//! dagli hook di panic installati dai test dei confini dei provider.

use std::sync::Barrier;

use camino::{Utf8Path, Utf8PathBuf};
use fub_kernel::log::captured_default;
use fub_kernel::{ConditionalWrite, RootedFsStorage, VaultStorage};

fn race(left: &RootedFsStorage, right: &RootedFsStorage, path: &Utf8Path, expected: Option<&[u8]>) {
    let start = Barrier::new(2);
    let [(left_result, left_log), (right_result, right_log)] = std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            captured_default(|| {
                start.wait();
                left.write_if_unchanged(path, expected, b"left")
            })
        });
        let right = captured_default(|| {
            start.wait();
            right.write_if_unchanged(path, expected, b"right")
        });
        // Raccoglie entrambi gli esiti prima di qualsiasi asserzione: un errore
        // I/O non perde il secondo risultato e non lascia un worker non atteso.
        let left = worker.join().expect("panic nel worker CAS");
        [left, right]
    });
    let outcomes = [left_result, right_result];
    let expected_bytes: &[u8] = match &outcomes {
        [Ok(ConditionalWrite::Written(_)), Ok(ConditionalWrite::Changed)] => b"left",
        [Ok(ConditionalWrite::Changed), Ok(ConditionalWrite::Written(_))] => b"right",
        _ => panic!(
            "CAS su {path}: atteso un solo vincitore, esiti {outcomes:?}; \
             log sinistro {left_log:?}; log destro {right_log:?}"
        ),
    };
    assert_eq!(
        left.read(path).expect("rilettura del risultato CAS"),
        expected_bytes,
        "il contenuto deve appartenere al vincitore: {path}; {outcomes:?}"
    );
}

fn exercise(present: bool, warm_lock: bool) {
    let temp = tempfile::tempdir().expect("directory CAS");
    let root = Utf8PathBuf::from_path_buf(temp.path().to_owned()).expect("root UTF-8");
    let left = RootedFsStorage::open(&root).expect("primo handle della root");
    let right = RootedFsStorage::open(&root).expect("secondo handle della root");
    for round in 0..32 {
        let path = root.join(format!("round-{round}.txt"));
        let expected = if present {
            left.write(&path, b"base").expect("contenuto iniziale");
            Some(b"base".as_slice())
        } else {
            None
        };
        if warm_lock {
            // Il primo CAS crea il lock attraverso l'API reale, ma la revisione
            // errata non deve creare o cambiare il file autorevole.
            let outcome = left
                .write_if_unchanged(&path, Some(b"never-current"), b"must-not-appear")
                .expect("CAS preliminare sul lock esistente");
            assert!(matches!(outcome, ConditionalWrite::Changed));
        }
        race(&left, &right, &path, expected);
    }
}

#[test]
fn existing_target_with_a_fresh_lock_has_one_winner() {
    exercise(true, false);
}

#[test]
fn existing_target_with_a_reused_lock_has_one_winner() {
    exercise(true, true);
}

#[test]
fn missing_target_with_a_fresh_lock_has_one_winner() {
    exercise(false, false);
}

#[test]
fn missing_target_with_a_reused_lock_has_one_winner() {
    exercise(false, true);
}

#[test]
fn reusing_a_lock_preserves_its_identity_and_contents() {
    let temp = tempfile::tempdir().expect("directory CAS");
    let root = Utf8PathBuf::from_path_buf(temp.path().to_owned()).expect("root UTF-8");
    let storage = RootedFsStorage::open(&root).expect("handle della root");
    let path = root.join("target.txt");
    let lock = root.join(".target.txt.lock");
    std::fs::write(&lock, b"stable lock").expect("lock esistente");
    let identity = storage.file_identity(&lock).expect("identità del lock");

    assert!(matches!(
        storage.write_if_unchanged(&path, None, b"first"),
        Ok(ConditionalWrite::Written(_))
    ));
    assert!(matches!(
        storage.write_if_unchanged(&path, Some(b"first"), b"second"),
        Ok(ConditionalWrite::Written(_))
    ));
    assert_eq!(storage.read(&lock).unwrap(), b"stable lock");
    assert_eq!(storage.file_identity(&lock).unwrap(), identity);
    assert_eq!(storage.read(&path).unwrap(), b"second");
}

#[test]
fn a_lock_that_cannot_be_opened_does_not_change_the_target() {
    let temp = tempfile::tempdir().expect("directory CAS");
    let root = Utf8PathBuf::from_path_buf(temp.path().to_owned()).expect("root UTF-8");
    let storage = RootedFsStorage::open(&root).expect("handle della root");
    let path = root.join("target.txt");
    storage.write(&path, b"base").expect("target iniziale");
    std::fs::create_dir(root.join(".target.txt.lock")).expect("lock non regolare");

    let error = storage
        .write_if_unchanged(&path, Some(b"base"), b"must-not-appear")
        .expect_err("un lock non apribile deve impedire il CAS");
    assert!(
        error.raw_os_error().is_some(),
        "errore I/O originale: {error:?}"
    );
    assert_eq!(storage.read(&path).unwrap(), b"base");
}
