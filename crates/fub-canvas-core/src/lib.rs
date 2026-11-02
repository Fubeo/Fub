//! Il nucleo della lavagna: il modello di una `.canvas` (JSON Canvas 1.0) e la
//! sua lettura.
//!
//! Il modello vive qui, in un posto puro, perché lo usano tre clienti: il
//! provider del formato (`fub-format-canvas`, accanto al kernel), i comandi
//! della lavagna (`fub-features`) e la facciata WebAssembly che la WebView
//! carica (`fub-canvas-wasm`). Per questo il crate non nomina il contratto
//! (`fub-abi`), il Markdown, il kernel né un toolkit: dipende solo da `serde`,
//! `serde_json` (con `float_roundtrip`) e `thiserror`, e compila per
//! `wasm32-unknown-unknown`. `crates/fub-abi/tests/dependency_invariant.rs`
//! lo verifica (`the_canvas_core_stands_alone`), e il giro completo di
//! `scripts/check.sh` lo compila per quel bersaglio.
//!
//! Regola d'oro: **i byte che non si interpretano non si toccano**. Ogni
//! livello del modello conserva i campi sconosciuti (`extra`).
//!
//! Il nucleo non va mai in panico su un input: ogni errore è un
//! [`CanvasError`]. Le regole di lettura e scrittura sono in
//! `docs/reference/canvas-format.md`.

pub mod commit;
pub mod js;
pub mod model;
pub mod ops;
pub mod patch;
pub mod read;
pub mod source;

pub use model::{
    Canvas, CanvasColor, CanvasEdge, CanvasEdgeEnd, CanvasEdgeSide, CanvasError, CanvasNode,
    CanvasNodeType, PresetColor,
};
pub use read::parse;
