//! La facciata WebAssembly del nucleo della lavagna.
//!
//! La WebView usa lo stesso nucleo (`fub-canvas-core`) dell'host, dei comandi
//! e dei test: questo crate lo mette dietro una porta stretta, scritta a mano
//! e senza librerie di collegamento (decisione D-1 (a) del piano N3). Due
//! livelli:
//!
//! - [`api`], sicuro e provato in nativo: una tabella di lavagne aperte per
//!   handle, con testo e JSON UTF-8 dentro e fuori, e ogni errore come
//!   `{"error": {"code", "message"}}`;
//! - [`abi`], l'unico `unsafe`: le funzioni `extern "C"` che il modulo
//!   esporta, con la memoria che il chiamante chiede a [`abi::fub_alloc`] e
//!   il risultato che legge da [`abi::result_ptr`] e [`abi::result_len`].
//!
//! Il `.wasm` si fa dalla stessa libreria con
//! `cargo rustc -p fub-canvas-wasm --lib --release --target
//! wasm32-unknown-unknown --crate-type cdylib`. Le funzioni, il loro JSON,
//! chi alloca e chi libera, i limiti e che cosa fa una trappola sono in
//! `docs/reference/canvas-operations.md` § «WebAssembly». Non è un contratto
//! pubblico: lo usano solo il caricatore della shell e il `.wasm` della
//! stessa build.

#![deny(unsafe_op_in_unsafe_fn)]

pub mod abi;
pub mod api;
