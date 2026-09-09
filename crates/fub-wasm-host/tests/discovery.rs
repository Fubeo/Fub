//! Discovery di componenti reali, prima del consenso e del mount.
//!
//! Questo banco non sostituisce il lifecycle desktop: verifica che la scansione
//! mantenga candidati ed errori distinti e non scelga implicitamente un duplicato.

mod common;

use camino::Utf8PathBuf;
use fub_host::Bundle;
use fub_kernel::Trust;
use fub_wasm_host::discover;

fn directory() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("directory temporanea");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("percorso UTF-8");
    (dir, root)
}

#[test]
fn a_corrupt_candidate_does_not_hide_a_real_component_or_grant_it_trust() {
    let (_dir, root) = directory();
    let wasm = common::ping("");
    std::fs::write(root.join("a-corrotto.wasm"), b"not a component").unwrap();
    std::fs::copy(wasm, root.join("z-valido.wasm")).unwrap();

    let found = discover(&root).expect("la directory si legge");
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].path, root.join("a-corrotto.wasm"));
    assert!(found[0].bundle.is_err());
    assert_eq!(found[1].path, root.join("z-valido.wasm"));
    let bundle = found[1].bundle.as_ref().expect("il componente si carica");
    assert_eq!(bundle.manifest().id, "demo.ping");
    assert!(matches!(bundle.trust(), Trust::Community));
}

#[test]
fn incomplete_files_stay_invisible_and_duplicate_ids_stay_visible() {
    let (_dir, root) = directory();
    let wasm = common::ping("");
    let staged = root.join("secondo.wasm.part");
    let installed = root.join("secondo.wasm");
    std::fs::copy(&wasm, &staged).unwrap();
    assert!(discover(&root).unwrap().is_empty());

    std::fs::rename(&staged, &installed).unwrap();
    std::fs::copy(&wasm, root.join("primo.wasm")).unwrap();
    let found = discover(&root).unwrap();
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].path, root.join("primo.wasm"));
    assert_eq!(found[1].path, installed);
    for candidate in found {
        let bundle = candidate.bundle.expect("entrambi i file sono componenti");
        assert_eq!(bundle.manifest().id, "demo.ping");
        assert!(matches!(bundle.trust(), Trust::Community));
    }
    // La risoluzione della collisione appartiene all'installer, non alla scansione.
}
