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
/// # Una cartella per variante, un lucchetto fra i processi
///
/// I binari di integrazione sono processi distinti, e una dozzina chiede gli
/// stessi esempi. Ogni variante ha una `--target-dir` sua, condivisa da tutti:
/// il primo binario la compila, gli altri trovano cargo fresco in pochi
/// millisecondi. Una variante non scrive mai nella cartella di un'altra, quindi
/// chi chiede il ping normale non apre i byte della variante senza permessi.
///
/// Due processi che chiedono la **stessa** variante si contendono invece il
/// `.wasm` finale: cargo, anche quando non ricompila, lo rimette al suo posto
/// togliendolo e ricollegandolo, e chi lo copia in quel momento non lo trova.
/// Compilazione e copia stanno allora dentro un `File::lock` sulla
/// variante, che mette in fila i processi oltre ai thread. La copia porta il
/// nonce del processo, composto da pid e istante di avvio del banco: il file
/// che una prova apre non lo tocca nessun altro. Dentro un processo la prima
/// compilazione viene memorizzata e le prove successive riusano quel file.
pub fn component(example: &str, artifact: &str, feature: &str) -> Utf8PathBuf {
    static BUILT: OnceLock<Mutex<HashMap<String, Utf8PathBuf>>> = OnceLock::new();
    static NONCE: OnceLock<String> = OnceLock::new();

    let built = BUILT.get_or_init(|| Mutex::new(HashMap::new()));
    // Un panico dentro la parentesi avvelena il `Mutex`, e un test già rotto non
    // è una ragione per farne fallire altri con un messaggio che parla di
    // avvelenamento invece che del guasto vero.
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
    let tmp = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let output = tmp.join(format!("{example}-{variant}"));
    let copy = tmp.join(format!("{artifact}-{variant}-{nonce}.wasm"));

    // Il lucchetto vive fino alla fine della funzione: compilazione e copia
    // stanno dentro insieme.
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(tmp.join(format!("{example}-{variant}.lock")))
        .expect("the lock file of the variant opens");
    lock.lock().expect("the lock of the variant is taken");

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
/// Il componente grid che usa il motore `SheetSession` condiviso col provider nativo.
pub fn grid() -> Utf8PathBuf {
    component("grid-wasm", "grid_wasm", "")
}
