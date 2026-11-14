//! L'interfaccia C del modulo: l'unico `unsafe` della facciata.
//!
//! Ogni funzione passa da [`crate::api::Cores`]; qui si traducono soltanto
//! puntatori e numeri. Le regole, che la pagina
//! `docs/reference/canvas-operations.md` § «WebAssembly» ripete:
//!
//! - **Dentro.** Il chiamante chiede `len` byte a [`fub_alloc`], ci scrive
//!   l'ingresso, chiama una funzione con `(ptr, len)` e poi libera lui con
//!   [`fub_free`]`(ptr, len)`, anche se la chiamata è fallita: il modulo non
//!   tiene mai un ingresso. `len` zero è un ingresso vuoto, qualunque sia il
//!   puntatore (anche nullo); un puntatore nullo con `len` non zero è un
//!   errore `request`.
//! - **Fuori.** Ogni chiamata (salvo `fub_alloc`, `fub_free` e le due qui
//!   sotto) mette la sua risposta, o l'errore, nel risultato:
//!   [`result_ptr`] e [`result_len`] lo descrivono, ed è del modulo. Vale fino
//!   alla chiamata dopo, che può spostarlo o far crescere la memoria: si copia
//!   subito.
//! - **Esito.** `canvas_open` dà l'handle, 0 se fallisce; le altre danno 0 se
//!   riescono e -1 se falliscono (il risultato è allora `{"error": …}`);
//!   `canvas_node_at` dà l'indice, -1 fuori da ogni scheda, -2 con un errore.
//!
//! Lo stato del modulo (le lavagne e il risultato) è per filo:
//! `wasm32-unknown-unknown` ne ha uno solo, e nei test nativi ogni filo ha il
//! suo modulo.

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;
use std::ptr::{self, NonNull};

use crate::api::{Cores, Failure, Handle, MAX_INPUT_BYTES};

/// Lo stato del modulo.
struct Bridge {
    cores: Cores,
    result: Vec<u8>,
}

thread_local! {
    static BRIDGE: RefCell<Bridge> = RefCell::new(Bridge {
        cores: Cores::new(),
        result: Vec::new(),
    });
}

/// L'esito che le funzioni `i32` danno con un errore.
const FAILED: i32 = -1;

/// Fa `work` sullo stato del modulo. `None` solo se lo stato non si
/// raggiunge (una chiamata dentro un'altra, o il filo che si chiude): allora
/// la funzione risponde con l'errore senza toccare il risultato.
fn with_bridge<R>(work: impl FnOnce(&mut Bridge) -> R) -> Option<R> {
    BRIDGE
        .try_with(|cell| {
            cell.try_borrow_mut()
                .ok()
                .map(|mut bridge| work(&mut bridge))
        })
        .ok()
        .flatten()
}

impl Bridge {
    /// Mette nel risultato la risposta o l'errore e dà l'esito `i32`.
    fn answer(&mut self, outcome: Result<String, Failure>) -> i32 {
        match outcome {
            Ok(text) => {
                self.result = text.into_bytes();
                0
            }
            Err(failure) => {
                self.result = failure.to_json().into_bytes();
                FAILED
            }
        }
    }
}

/// L'ingresso `(ptr, len)` come fetta.
///
/// # Safety
///
/// Con `len` non zero e `ptr` non nullo, `ptr` deve indicare `len` byte
/// leggibili e inizializzati che nessuno cambia durante la chiamata (quelli
/// dati da [`fub_alloc`]`(len)` e scritti dal chiamante).
unsafe fn input<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], Failure> {
    if len == 0 {
        return Ok(&[]);
    }
    if len > MAX_INPUT_BYTES {
        return Err(Failure::new(
            "limit",
            format!("the input exceeds the {MAX_INPUT_BYTES}-byte limit"),
        ));
    }
    if ptr.is_null() {
        return Err(Failure::new(
            "request",
            "null input pointer with a non-zero length",
        ));
    }
    // SAFETY: `ptr` non è nullo, `len` è fra 1 e `MAX_INPUT_BYTES` (quindi
    // sotto `isize::MAX`), e il chiamante garantisce che i `len` byte siano
    // leggibili, inizializzati e fermi per tutta la chiamata (il contratto
    // di questa funzione). La fetta non esce dalla chiamata: `api` la legge
    // e ne copia ciò che tiene.
    Ok(unsafe { std::slice::from_raw_parts(ptr, len) })
}

/// Il layout di un ingresso di `len` byte: `None` oltre il limite.
fn layout(len: usize) -> Option<Layout> {
    if len == 0 || len > MAX_INPUT_BYTES {
        return None;
    }
    Layout::array::<u8>(len).ok()
}

/// Riserva `len` byte per un ingresso. Dà nullo (0 nel modulo) se `len` passa
/// [`MAX_INPUT_BYTES`] o la memoria non basta: mai un panico. Per `len` zero
/// dà un puntatore non nullo che non si legge né si scrive.
#[no_mangle]
pub extern "C" fn fub_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return NonNull::<u8>::dangling().as_ptr();
    }
    let Some(layout) = layout(len) else {
        return ptr::null_mut();
    };
    // SAFETY: il layout ha dimensione non zero (`len` > 0). `alloc` dà nullo
    // se la memoria non basta, e il nullo passa così al chiamante.
    unsafe { alloc(layout) }
}

/// Libera un ingresso dato da [`fub_alloc`]. Un puntatore nullo o `len`
/// zero non fanno niente.
///
/// # Safety
///
/// `ptr` deve essere un valore dato da [`fub_alloc`]`(len)` con lo stesso
/// `len`, non ancora liberato.
#[no_mangle]
pub unsafe extern "C" fn fub_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    let Some(layout) = layout(len) else {
        return;
    };
    // SAFETY: `ptr` viene da `fub_alloc(len)` (il contratto di questa
    // funzione), che l'ha riservato con questo stesso layout, e non è ancora
    // stato liberato.
    unsafe { dealloc(ptr, layout) }
}

/// Apre una lavagna dai byte del file. Dà l'handle, o 0 con l'errore nel
/// risultato; la risposta è `{"handle", "canvas"}`.
///
/// # Safety
///
/// `(ptr, len)` come in [`fub_free`]: dato da [`fub_alloc`] e scritto, o
/// `len` zero.
#[no_mangle]
pub unsafe extern "C" fn canvas_open(ptr: *const u8, len: usize) -> u32 {
    // SAFETY: il contratto di `input` è quello di questa funzione.
    let source = unsafe { input(ptr, len) };
    with_bridge(
        |bridge| match source.and_then(|source| bridge.cores.open(source)) {
            Ok((handle, answer)) => {
                bridge.result = answer.into_bytes();
                handle
            }
            Err(failure) => {
                bridge.result = failure.to_json().into_bytes();
                0
            }
        },
    )
    .unwrap_or(0)
}

/// Riapre la lavagna `handle` da un sorgente nuovo: `{"canvas"}`.
///
/// # Safety
///
/// Come [`canvas_open`].
#[no_mangle]
pub unsafe extern "C" fn canvas_reset(handle: Handle, ptr: *const u8, len: usize) -> i32 {
    // SAFETY: il contratto di `input` è quello di questa funzione.
    let source = unsafe { input(ptr, len) };
    with_bridge(|bridge| {
        let outcome = source.and_then(|source| bridge.cores.reset(handle, source));
        bridge.answer(outcome)
    })
    .unwrap_or(FAILED)
}

/// Applica una lista di toppe (JSON): `{"edit", "inverse"}`.
///
/// # Safety
///
/// Come [`canvas_open`].
#[no_mangle]
pub unsafe extern "C" fn canvas_commit(handle: Handle, ptr: *const u8, len: usize) -> i32 {
    // SAFETY: il contratto di `input` è quello di questa funzione.
    let request = unsafe { input(ptr, len) };
    with_bridge(|bridge| {
        let outcome = request.and_then(|request| bridge.cores.commit(handle, request));
        bridge.answer(outcome)
    })
    .unwrap_or(FAILED)
}

/// Il sorgente intero che darebbe `canvas_commit` con le stesse toppe, come
/// testo e non JSON, senza cambiare la lavagna.
///
/// # Safety
///
/// Come [`canvas_open`].
#[no_mangle]
pub unsafe extern "C" fn canvas_preview(handle: Handle, ptr: *const u8, len: usize) -> i32 {
    // SAFETY: il contratto di `input` è quello di questa funzione.
    let request = unsafe { input(ptr, len) };
    with_bridge(|bridge| {
        let outcome = request.and_then(|request| bridge.cores.preview(handle, request));
        bridge.answer(outcome)
    })
    .unwrap_or(FAILED)
}

/// Compila `{"ops", "seed"}` in toppe: `{"patches", "created"}`.
///
/// # Safety
///
/// Come [`canvas_open`].
#[no_mangle]
pub unsafe extern "C" fn canvas_compile(handle: Handle, ptr: *const u8, len: usize) -> i32 {
    // SAFETY: il contratto di `input` è quello di questa funzione.
    let request = unsafe { input(ptr, len) };
    with_bridge(|bridge| {
        let outcome = request.and_then(|request| bridge.cores.compile(handle, request));
        bridge.answer(outcome)
    })
    .unwrap_or(FAILED)
}

/// Il modello della lavagna `handle`: `{"canvas"}`.
#[no_mangle]
pub extern "C" fn canvas_model(handle: Handle) -> i32 {
    with_bridge(|bridge| {
        let outcome = bridge.cores.model(handle);
        bridge.answer(outcome)
    })
    .unwrap_or(FAILED)
}

/// I livelli d'inchiostro della lavagna `handle`, letti dal nucleo:
/// `{"layers"}`, nella forma di `expect` dei vettori di `canvas-ink/`. Come
/// [`canvas_model`] non prende un ingresso, quindi non ha niente da liberare
/// né puntatori da leggere: il risultato è del modulo, come sempre.
#[no_mangle]
pub extern "C" fn canvas_ink_layers(handle: Handle) -> i32 {
    with_bridge(|bridge| {
        let outcome = bridge.cores.ink_layers(handle);
        bridge.answer(outcome)
    })
    .unwrap_or(FAILED)
}

/// L'indice della scheda che contiene il byte `byte` del sorgente, -1 fuori
/// da ogni scheda, -2 con un errore (nel risultato). Se riesce, il
/// risultato è vuoto.
#[no_mangle]
pub extern "C" fn canvas_node_at(handle: Handle, byte: u32) -> i32 {
    with_bridge(|bridge| match bridge.cores.node_at(handle, byte as usize) {
        Ok(found) => {
            bridge.result.clear();
            // Le schede sono al più `MAX_NODES`, ben sotto `i32::MAX`.
            found.map_or(-1, |index| i32::try_from(index).unwrap_or(-2))
        }
        Err(failure) => {
            bridge.result = failure.to_json().into_bytes();
            -2
        }
    })
    .unwrap_or(-2)
}

/// Chiude la lavagna `handle`. Se riesce, il risultato è vuoto.
#[no_mangle]
pub extern "C" fn canvas_close(handle: Handle) -> i32 {
    with_bridge(|bridge| {
        let outcome = bridge.cores.close(handle).map(|()| String::new());
        bridge.answer(outcome)
    })
    .unwrap_or(FAILED)
}

/// Dove comincia il risultato dell'ultima chiamata.
#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    with_bridge(|bridge| bridge.result.as_ptr()).unwrap_or(NonNull::<u8>::dangling().as_ptr())
}

/// Quanti byte è lungo il risultato dell'ultima chiamata.
#[no_mangle]
pub extern "C" fn result_len() -> usize {
    with_bridge(|bridge| bridge.result.len()).unwrap_or(0)
}
