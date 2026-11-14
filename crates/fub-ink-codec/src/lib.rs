//! Il codec dei tratti a mano libera, come li scrive il [formato della
//! scena](../../../docs/reference/scene-format.md), §5: i `§` dei commenti sono
//! le sue sezioni.
//!
//! - [`ink`] è il codec di `fub:ink`: i campioni di un tratto come interi
//!   quantizzati, il primo assoluto e gli altri in differenze ([`Ink`]).
//! - [`brush`] è la lettura di `fub:brush`: `pf1` ([`InkBrush`]) o `nib1`
//!   ([`Nib1Brush`]) e coppie `chiave=valore` ([`Brush`]).
//!
//! Li usano due lettori: i disegni (`fub-scene`), per dire se un tratto si
//! ridisegna, e il nucleo della lavagna, che scrive gli stessi tratti nel
//! campo `fub:ink` di una `.canvas`. Per questo stanno qui e non in
//! `fub-scene`: la lavagna non deve portarsi dietro il lettore XML dei disegni
//! ([ADR 0204](../../../docs/decisions/0204-nucleo-inchiostro.md), punto 2).
//!
//! Il crate è puro. Dipende soltanto da `fub-ink`, di cui quantizza il
//! campione, non fa I/O, non ha codice di piattaforma e compila per
//! `wasm32-wasip2` e `wasm32-unknown-unknown`:
//! `crates/fub-abi/tests/dependency_invariant.rs` ne verifica le dipendenze.

pub mod brush;
pub mod ink;

pub use brush::{Brush, BrushError, InkBrush, Nib1Brush, NIB1, NIB1_KEYS, PF1, PF1_KEYS};
pub use ink::{Ink, InkError, Sample, Scale};
