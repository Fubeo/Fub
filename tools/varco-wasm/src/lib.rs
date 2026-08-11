//! Il contratto di Fub, di là dal confine.
//!
//! Questo crate non ha una riga scritta a mano oltre a questa: è il mondo
//! `plugin-world` di `crates/fub-abi/wit/fub/abi.wit` generato da `build.rs` e
//! compilato a `wasm32-unknown-unknown`. Se compila, il contratto attraversa il
//! confine; se non compila, non lo attraversa — e lo si sa **prima** del
//! freeze, che è la sola volta in cui saperlo serve a qualcosa (verbale 0146).
//!
//! Non si consuma: nessun crate del workspace lo nomina, e non è nemmeno un
//! membro. Il suo unico chiamante è la riga di `.github/workflows/ci.yml` che
//! lo compila per nome.
#![allow(clippy::all, dead_code, unused_imports)]

include!(concat!(env!("OUT_DIR"), "/plugin_world.rs"));
