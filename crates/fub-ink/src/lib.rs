//! Il nucleo condiviso dell'inchiostro: dai campioni del puntatore ai tratti.
//!
//! Questo crate è il posto dove sta ciò che serve a **ogni** prodotto di Fub
//! che raccoglie inchiostro, e che quindi non può essere di FubDraw né di un
//! futuro editor: il campione del puntatore ([`PointerSample`]), la decisione
//! su chi disegna e chi è il palmo ([`roles`]), la curva della pressione
//! ([`pressure`]), l'inclinazione della penna ([`tilt`]), lo stabilizzatore del
//! tratto ([`stabilizer`]) e il ciclo di vita del tratto ([`Session`]).
//!
//! Il contratto con la piattaforma è un solo tipo in ingresso, il
//! [`PointerSample`], e un solo tipo in uscita, l'[`Effect`]. Un adattatore
//! (gli eventi del puntatore del browser, un toolkit nativo) riempie i campioni
//! e traduce gli effetti; il crate non sa che cosa sia un DOM, una camera, un
//! documento o un prodotto.
//!
//! Il crate è puro. Non dipende da niente — nemmeno da `fub-abi` —, non fa I/O
//! e compila per `wasm32-wasip2`: `crates/fub-abi/tests/dependency_invariant.rs`
//! lo verifica, e la CI lo compila per quel bersaglio. È la forma che ha un
//! nucleo che un domani può diventare un componente.
//!
//! # Un nucleo in due lingue
//!
//! Il percorso caldo del tratto, evento per evento, gira nel client, in
//! TypeScript (`apps/client/src/ink/`): niente IPC né WASM a ogni battuta. Il
//! nucleo è scritto quindi due volte, e Rust è la copia che fa fede. La
//! fixture `apps/client/src/ink/__fixtures__/ink-samples.json` la genera il
//! test `ts_mirror` con le risposte di Rust, e il gemello Vitest passa gli
//! stessi scenari alla copia TypeScript e pretende le stesse risposte:
//! cambiare la regola da un lato solo è rosso.

pub mod pointer;
pub mod pressure;
pub mod roles;
pub mod sample;
pub mod session;
pub mod stabilizer;
pub mod tilt;

pub use pointer::{PointerKind, PointerSample, Tilt, View};
pub use pressure::{PenCurve, DEFAULT_CURVE, MAX_MIN, MIN_FULL};
pub use roles::{classify_pointer, PointerRole, RoleContext, TouchPolicy};
pub use sample::{Sample, MAX_SAMPLES};
pub use session::{
    CancelReason, ConfigError, Effect, FinishedStroke, Session, SessionConfig, StrokeStart,
};
pub use stabilizer::{Stabilizer, StabilizerConfig};
pub use tilt::{angles_from_tilt, pen_angles, reports_tilt, PenAngles};
