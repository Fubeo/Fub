//! **Il banco che compila gli esempi**, condiviso dai binari di prova di questo
//! crate.
//!
//! Ogni test di qui ha bisogno della stessa cosa — un `.wasm` vero, compilato
//! adesso — e la ragione per cui è codice invece di un artefatto cercato in
//! giro sta in `il_primo_componente.rs`: un test che si salta da solo quando il
//! file non c'è è un test che un giorno non gira più e nessuno se ne accorge.
//! Quello che cambia da un test all'altro è l'esempio; la disciplina è la
//! stessa, e stava scritta in quattro copie.

#![allow(dead_code)]

use camino::Utf8PathBuf;

/// Compila `examples/{example}` per `wasm32-wasip2` e restituisce il `.wasm`.
///
/// - `artifact` è il nome del `cdylib` (`ping_wasm` per `examples/ping-wasm`):
///   cargo lo prende dal `Cargo.toml` dell'esempio, non dalla cartella.
/// - `feature` è la variante, o `""`. Una variante è **una riga sola di
///   differenza** dentro il componente — il manifest senza `read-vault`, il
///   mondo che chiede anche la rete — e non un secondo esempio.
///
/// # Una cartella per variante
///
/// Il file finale del `cdylib` ha lo stesso nome per tutte le feature. Inoltre
/// i binari di integrazione sono processi distinti: un `Mutex` statico ne
/// serializza i thread, non le build lanciate da un altro binario di test.
///
/// Per questo ogni variante ha una `--target-dir` propria. Due chiamanti della
/// stessa variante possono ancora incontrarsi, ma Cargo protegge quella stessa
/// cartella col proprio lock e producono gli stessi byte; varianti diverse non
/// condividono invece né fingerprint né artefatto finale. È più importante che
/// il test monti deterministicamente il manifest richiesto che risparmiare una
/// ricompilazione del piccolo esempio.
// Un panico dentro la parentesi avvelena il `Mutex`, e un test già rotto non
pub fn component(example: &str, artifact: &str, feature: &str) -> Utf8PathBuf {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    // è una ragione per farne fallire altri con un messaggio che parla di
    // avvelenamento invece che del guasto vero.
    let _guard = LOCK.lock().unwrap_or_else(|and| and.into_inner());

    let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("esempi")
        .join(example);
    let variant = if feature.is_empty() { "base" } else { feature };
    let output = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("{example}-{variant}"));
    let copy = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("{artifact}-{variant}.wasm"));

    let mut cargo = std::process::Command::new(env!("CARGO"));
    cargo
        .arg("build")
        .arg("--release")
        .arg("--target")
        .arg("wasm32-wasip2")
        .arg("--manifest-path")
        .arg(root.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&output);
    if !feature.is_empty() {
        cargo.arg("--features").arg(feature);
    }
    let status = cargo.output().expect("cargo runs");
    assert!(
        status.status.success(),
        "the component `{example}` does not compile.\n\
         If the target is missing: `rustup target add wasm32-wasip2`.\n{}",
        String::from_utf8_lossy(&status.stderr)
    );

    let wasm = output.join(format!("wasm32-wasip2/release/{artifact}.wasm"));
    assert!(wasm.exists(), "the compiled component is not at {wasm}");
    std::fs::copy(&wasm, &copy).expect("copying the variant");
    copy
}

/// Il ping di M5, nella variante chiesta (`""` = quella con `read-vault`).
pub fn ping(feature: &str) -> Utf8PathBuf {
    component("ping-wasm", "ping_wasm", feature)
}
