//! Ciò che l'ospite e i componenti hanno in comune: la dipendenza pesante
//! condivisa (`serde_json`), un contatore che dice se la libreria è caricata
//! una volta sola, e la forma del componente.

use std::ffi::c_char;
use std::sync::atomic::{AtomicUsize, Ordering};

pub use serde_json;

/// La versione della forma di [`Descrizione`]: un componente con un'altra
/// versione non si carica.
pub const ABI: u32 = 1;

/// Il nome del simbolo che ogni componente esporta.
pub const SIMBOLO: &[u8] = b"fub_componente_v1\0";

/// Quello che un componente dice di sé, in forma C: stabile fra librerie
/// compilate a parte.
#[repr(C)]
pub struct Descrizione {
    pub abi: u32,
    /// Nome terminato da zero, statico.
    pub nome: *const c_char,
    /// Il lavoro del componente: riceve un numero, rende un numero. Non deve
    /// lasciar uscire un panic (lo prende lui e rende `u64::MAX`).
    pub lavora: extern "C" fn(u64) -> u64,
}

static CHIAMATE: AtomicUsize = AtomicUsize::new(0);

/// Conta una chiamata. Se l'ospite e i componenti vedono lo stesso numero, la
/// libreria comune è una sola in memoria.
pub fn conta() -> usize {
    CHIAMATE.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn chiamate() -> usize {
    CHIAMATE.load(Ordering::SeqCst)
}
