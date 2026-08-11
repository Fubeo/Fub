//! Genera i binding guest di `plugin-world` da `crates/fub-abi/wit/fub/abi.wit`.
//!
//! Non è un passo di build del prodotto: è **metà del presidio**. L'altra metà
//! è `src/lib.rs`, che include ciò che esce di qui e lo fa compilare a
//! `wasm32-unknown-unknown`. Le due metà insieme rispondono alla domanda della
//! §27.1 — *qualcuno ha mai provato ad attraversare il confine?* — e ci
//! rispondono ogni volta, non una volta sola.
//!
//! # Perché il generatore e non il parser
//!
//! `crates/fub-abi/tests/wit_conformance.rs` dà `abi.wit` in pasto a
//! `wit-parser`: verifica che il contratto sia **WIT valido**. È una cosa
//! diversa da «un plugin ci si può costruire contro»: la validità è una
//! proprietà del testo, la costruibilità è una proprietà del *generato*, e in
//! mezzo ci stanno le collisioni di nome, le parole riservate di Rust, i tipi
//! ricorsivi che il lifting non sa smontare, e ogni costrutto che risolve ma
//! non si lascia lowerare. Quelli si vedono qui e in nessun altro punto del
//! repo.
//!
//! # `stubs: true` non è una comodità
//!
//! Senza stub, il generato dichiara i dodici trait degli export e un `macro`
//! che nessuno invoca: il corpo delle funzioni di **lifting** — la metà del
//! confine che un plugin attraversa davvero, e la più grossa — resta dentro una
//! macro non espansa, cioè non compilata. Con gli stub il mondo è implementato
//! per intero, la macro viene invocata, e il compilatore guarda tutti e due i
//! versi del varco.

use std::path::{Path, PathBuf};

use wit_bindgen_core::wit_parser::Resolve;
use wit_bindgen_core::WorldGenerator;

fn main() {
    let radice = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let wit = radice.join("../../crates/fub-abi/wit/fub/abi.wit");

    // Il contratto è la sorgente: se cambia, questo si rifà.
    println!("cargo:rerun-if-changed={}", wit.display());
    println!("cargo:rerun-if-changed=build.rs");

    let mut resolve = Resolve::default();
    let (pacchetto, _) = resolve
        .push_path(&wit)
        .unwrap_or_else(|e| panic!("il contratto non si risolve: {e:?}"));
    let mondo = resolve
        .select_world(&[pacchetto], None)
        .unwrap_or_else(|e| panic!("il contratto non dichiara un mondo solo: {e:?}"));

    let mut opzioni = wit_bindgen_rust::Opts::default();
    opzioni.stubs = true;
    let mut generatore = opzioni.build();

    let mut file = wit_bindgen_core::Files::default();
    generatore
        .generate(&mut resolve, mondo, &mut file)
        .unwrap_or_else(|e| panic!("il contratto non si lascia generare: {e:?}"));

    let uscita = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    let mut scritti = 0usize;
    for (nome, contenuto) in file.iter() {
        std::fs::write(uscita.join(nome), contenuto).expect("scrittura del generato");
        scritti += 1;
    }

    // Un generatore che non genera niente compilerebbe benissimo, e sarebbe un
    // presidio spento: `include!` di un file che non c'è è un errore, ma un
    // errore che parla di percorsi invece che di contratti.
    assert_eq!(
        scritti, 1,
        "atteso un solo file generato, ne sono usciti {scritti}"
    );
    assert!(
        Path::new(&uscita.join("plugin_world.rs")).exists(),
        "il mondo generato non si chiama più plugin_world.rs"
    );
}
