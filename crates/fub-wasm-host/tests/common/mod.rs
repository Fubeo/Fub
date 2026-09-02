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

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use camino::Utf8PathBuf;

/// Compila `examples/{example}` per `wasm32-wasip2` e restituisce il `.wasm`.
///
/// - `artifact` è il nome del `cdylib` (`ping_wasm` per `examples/ping-wasm`):
///   cargo lo prende dal `Cargo.toml` dell'esempio, non dalla cartella.
/// - `feature` è la variante, o `""`. Una variante è **una riga sola di
///   differenza** dentro il componente — il manifest senza `read-vault`, il
///   mondo che chiede anche la rete — e non un secondo esempio.
///
/// # Una cartella per variante e per processo
///
/// I binari di integrazione sono processi distinti. Un `Mutex` statico mette in
/// fila i thread di **questo** binario, ma non impedisce a un altro binario di
/// compilare contemporaneamente lo stesso esempio né di sostituire un file col
/// medesimo nome. Il risultato era un banco intermittente: chi chiedeva il ping
/// normale poteva aprire i byte appena prodotti dalla variante senza permessi.
///
/// Ogni processo riceve quindi un nonce proprio, composto da pid e istante di
/// avvio del banco. `--target-dir` e copia finale includono quel nonce e la
/// variante. Dentro un processo la prima compilazione viene memorizzata e le
/// prove successive riusano esattamente quel file; fra processi non esiste più
/// alcun nome condiviso da poter sovrascrivere.
pub fn component(example: &str, artifact: &str, feature: &str) -> Utf8PathBuf {
    static BUILT: OnceLock<Mutex<HashMap<String, Utf8PathBuf>>> = OnceLock::new();
    static NONCE: OnceLock<String> = OnceLock::new();

    let built = BUILT.get_or_init(|| Mutex::new(HashMap::new()));
    let mut built = built.lock().unwrap_or_else(|and| and.into_inner());
    let key = format!("{example}\0{artifact}\0{feature}");
    if let Some(path) = built.get(&key) {
        return path.clone();
    }

    let nonce = NONCE.get_or_init(|| {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock is after the Unix epoch")
            .as_nanos();
        format!("{}-{now}", std::process::id())
    });
    let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("esempi")
        .join(example);
    let variant = if feature.is_empty() { "base" } else { feature };
    let output =
        Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{example}-{variant}-{nonce}"));
    let copy = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("{artifact}-{variant}-{nonce}.wasm"));

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
    built.insert(key, copy.clone());
    copy
}

/// Il ping di M5, nella variante chiesta (`""` = quella con `read-vault`).
pub fn ping(feature: &str) -> Utf8PathBuf {
    component("ping-wasm", "ping_wasm", feature)
}
