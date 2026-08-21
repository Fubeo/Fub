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
/// # Una cartella per esempio, un `cargo` per volta
///
/// Le varianti di uno stesso esempio condividono la `--target-dir`, ed è la
/// ragione del lucchetto. Misurato sul ping: con una cartella per variante
/// l'albero delle dipendenze si compilava tre volte (~62s), con una sola una
/// volta (~19s) e a cambiare resta il `cdylib`. Il prezzo è che due `cargo`
/// sulla stessa cartella con feature diverse si sovrascriverebbero il `.wasm` a
/// vicenda — e i test girano su thread paralleli. Quindi: si serializza, e
/// appena l'artefatto è pronto lo si **copia** in un file che porta il nome
/// della variante, prima di lasciare il lucchetto.
///
/// Il lucchetto è per processo, e i binari di prova di un crate sono processi
/// diversi: cargo li esegue uno alla volta, ed è **quello** a coprire il resto.
/// Detto qui perché il giorno in cui qualcuno li lancerà in parallelo il
/// sintomo sarà un `.wasm` della variante sbagliata, che non somiglia a una
/// corsa fra processi.
// Un panico dentro la parentesi avvelena il `Mutex`, e un test già rotto non
pub fn component(example: &str, artifact: &str, feature: &str) -> Utf8PathBuf {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    // è una ragione per farne fallire altri con un messaggio che parla di
    // avvelenamento invece che del guasto vero.
    // avvelenamento invece che del guasto vero.
    let _guard = LOCK.lock().unwrap_or_else(|and| and.into_inner());

    let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("esempi")
        .join(example);
    let output = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(example);
    let copy = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "{artifact}-{}.wasm",
        if feature.is_empty() { "base" } else { feature }
    ));

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
