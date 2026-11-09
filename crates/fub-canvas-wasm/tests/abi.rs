//! La facciata attraverso le funzioni `extern "C"` di `abi.rs`, chiamate in
//! nativo come le chiama il caricatore della shell: la memoria chiesta a
//! `fub_alloc`, scritta, passata, liberata con `fub_free`; la risposta letta
//! da `result_ptr` e `result_len`. Gli stessi controlli di `tests/api.rs`,
//! più quelli dei puntatori e della memoria.
//!
//! Lo stato del modulo è per filo (`abi.rs`), e così il conto della memoria
//! viva di [`Counting`]: ogni test, nel suo filo, ha un modulo suo e un conto
//! suo, anche quando libtest ne fa girare più d'uno insieme.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use common::{expect_code, Via};
use fub_canvas_core::model::MAX_SOURCE_BYTES;
use fub_canvas_wasm::abi::{
    canvas_close, canvas_commit, canvas_compile, canvas_ink_layers, canvas_model, canvas_node_at,
    canvas_open, canvas_preview, canvas_reset, fub_alloc, fub_free, result_len, result_ptr,
};
use fub_canvas_wasm::api::MAX_INPUT_BYTES;
use serde_json::{json, Value};

/// L'allocatore di sistema, con il conto dei byte vivi del filo che chiede
/// e libera.
struct Counting;

thread_local! {
    // `const` e senza distruttore: si legge anche dentro l'allocatore.
    static LIVE: Cell<isize> = const { Cell::new(0) };
}

fn count(delta: isize) {
    let _ = LIVE.try_with(|live| live.set(live.get() + delta));
}

fn live() -> isize {
    LIVE.with(Cell::get)
}

// SAFETY: ogni metodo passa la richiesta così com'è a `System`, che rispetta
// il contratto di `GlobalAlloc`; il conto non tocca la memoria data.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: lo stesso contratto del chiamante, passato a `System`.
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            count(layout.size() as isize);
        }
        ptr
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // SAFETY: lo stesso contratto del chiamante, passato a `System`.
        let ptr = unsafe { System.alloc_zeroed(layout) };
        if !ptr.is_null() {
            count(layout.size() as isize);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` viene da questo allocatore, cioè da `System`, con
        // questo layout (il contratto del chiamante).
        unsafe { System.dealloc(ptr, layout) };
        count(-(layout.size() as isize));
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        // SAFETY: lo stesso contratto del chiamante, passato a `System`.
        let moved = unsafe { System.realloc(ptr, layout, new_size) };
        if !moved.is_null() {
            count(new_size as isize - layout.size() as isize);
        }
        moved
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// Il risultato dell'ultima chiamata, copiato.
fn result() -> Vec<u8> {
    let len = result_len();
    if len == 0 {
        return Vec::new();
    }
    // SAFETY: `result_ptr` e `result_len` descrivono il risultato del modulo
    // di questo filo, che nessuna chiamata cambia finché lo si copia.
    unsafe { std::slice::from_raw_parts(result_ptr(), len) }.to_vec()
}

fn json_result() -> Value {
    serde_json::from_slice(&result()).expect("il risultato è JSON")
}

fn error_result() -> Value {
    let json = json_result();
    assert!(json["error"].is_object(), "non è un errore: {json}");
    json["error"].clone()
}

/// Copia `bytes` in memoria chiesta a `fub_alloc`, chiama `call` e libera.
fn with_input<R>(bytes: &[u8], call: impl FnOnce(*const u8, usize) -> R) -> R {
    let ptr = fub_alloc(bytes.len());
    assert!(!ptr.is_null(), "fub_alloc({}) ha dato 0", bytes.len());
    // SAFETY: `ptr` indica `bytes.len()` byte appena riservati, che non si
    // sovrappongono a `bytes`.
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()) };
    let outcome = call(ptr, bytes.len());
    // SAFETY: `ptr` viene da `fub_alloc(bytes.len())` e non è ancora libero.
    unsafe { fub_free(ptr, bytes.len()) };
    outcome
}

/// Le funzioni `extern "C"` come via.
struct Abi;

fn status(code: i32) -> Result<Value, Value> {
    match code {
        0 => Ok(json_result()),
        -1 => Err(error_result()),
        other => panic!("esito {other}"),
    }
}

impl Via for Abi {
    fn open(&mut self, source: &[u8]) -> Result<(u32, Value), Value> {
        // SAFETY: `with_input` passa memoria di `fub_alloc` scritta.
        let handle = with_input(source, |ptr, len| unsafe { canvas_open(ptr, len) });
        if handle == 0 {
            return Err(error_result());
        }
        let json = json_result();
        assert_eq!(json["handle"], handle);
        Ok((handle, json))
    }
    fn reset(&mut self, handle: u32, source: &[u8]) -> Result<Value, Value> {
        // SAFETY: come in `open`.
        status(with_input(source, |ptr, len| unsafe {
            canvas_reset(handle, ptr, len)
        }))
    }
    fn commit(&mut self, handle: u32, request: &[u8]) -> Result<Value, Value> {
        // SAFETY: come in `open`.
        status(with_input(request, |ptr, len| unsafe {
            canvas_commit(handle, ptr, len)
        }))
    }
    fn preview(&mut self, handle: u32, request: &[u8]) -> Result<Vec<u8>, Value> {
        // SAFETY: come in `open`.
        match with_input(request, |ptr, len| unsafe {
            canvas_preview(handle, ptr, len)
        }) {
            0 => Ok(result()),
            -1 => Err(error_result()),
            other => panic!("esito {other}"),
        }
    }
    fn compile(&mut self, handle: u32, request: &[u8]) -> Result<Value, Value> {
        // SAFETY: come in `open`.
        status(with_input(request, |ptr, len| unsafe {
            canvas_compile(handle, ptr, len)
        }))
    }
    fn model(&mut self, handle: u32) -> Result<Value, Value> {
        status(canvas_model(handle))
    }
    fn node_at(&mut self, handle: u32, byte: u32) -> Result<Option<usize>, Value> {
        match canvas_node_at(handle, byte) {
            -2 => Err(error_result()),
            -1 => {
                assert_eq!(result_len(), 0);
                Ok(None)
            }
            index => Ok(Some(usize::try_from(index).expect("un indice"))),
        }
    }
    fn ink_layers(&mut self, handle: u32) -> Result<Value, Value> {
        status(canvas_ink_layers(handle))
    }
    fn close(&mut self, handle: u32) -> Result<(), Value> {
        match canvas_close(handle) {
            0 => {
                assert_eq!(result_len(), 0, "close riuscito ha un risultato vuoto");
                Ok(())
            }
            -1 => Err(error_result()),
            other => panic!("esito {other}"),
        }
    }
}

#[test]
fn every_vector_gives_the_text_the_edit_and_the_error() {
    common::every_vector(&mut Abi);
}

#[test]
fn every_ink_vector_gives_the_layers_of_the_core() {
    common::every_ink_vector(&mut Abi);
}

#[test]
fn ink_layers_follow_the_commits() {
    common::ink_layers_follow_commits(&mut Abi);
}

#[test]
fn the_utf16_edit_rebuilds_the_new_source() {
    common::utf16_round_trip(&mut Abi);
}

#[test]
fn bad_input_is_a_json_error() {
    common::bad_input(&mut Abi);
}

#[test]
fn handles_are_never_reused() {
    common::handles(&mut Abi);
}

#[test]
fn sixteen_mib_open_one_more_byte_is_a_limit() {
    common::sizes(&mut Abi);
}

#[test]
fn empty_and_large_results() {
    common::results(&mut Abi);
}

/// `len` zero è un ingresso vuoto con qualunque puntatore, anche nullo; un
/// puntatore nullo con `len` non zero è un errore, non una lettura.
#[test]
fn zero_lengths_and_null_pointers() {
    // SAFETY: con `len` zero il puntatore non si legge.
    let handle = unsafe { canvas_open(std::ptr::null(), 0) };
    assert_ne!(handle, 0, "un sorgente vuoto è una lavagna vuota");
    assert_eq!(json_result()["canvas"], json!({"nodes": [], "edges": []}));
    let dangling = fub_alloc(0);
    assert!(!dangling.is_null(), "fub_alloc(0) non dà 0");
    // SAFETY: con `len` zero il puntatore non si legge.
    assert_eq!(unsafe { canvas_reset(handle, dangling, 0) }, 0);
    // SAFETY: `fub_free` con `len` zero non fa niente.
    unsafe { fub_free(dangling, 0) };
    // SAFETY: un puntatore nullo non si legge, con qualunque `len`.
    unsafe {
        assert_eq!(canvas_open(std::ptr::null(), 4), 0);
        assert_eq!(error_result()["code"], "request");
        assert_eq!(canvas_commit(handle, std::ptr::null(), 2), -1);
        assert_eq!(error_result()["code"], "request");
        assert_eq!(canvas_preview(handle, std::ptr::null(), 2), -1);
        assert_eq!(error_result()["code"], "request");
        assert_eq!(canvas_compile(handle, std::ptr::null(), 2), -1);
        assert_eq!(error_result()["code"], "request");
        assert_eq!(canvas_reset(handle, std::ptr::null(), 2), -1);
        assert_eq!(error_result()["code"], "request");
        // Una richiesta vuota non è JSON.
        assert_eq!(canvas_commit(handle, std::ptr::null(), 0), -1);
        assert_eq!(error_result()["code"], "request");
        // Liberare il nullo non fa niente.
        fub_free(std::ptr::null_mut(), 8);
    }
    assert_eq!(canvas_close(handle), 0);
}

/// `fub_alloc` oltre il limite d'ingresso dà 0; al limite dà memoria.
/// Una chiamata con un `len` oltre il limite risponde `limit` senza leggere.
#[test]
fn alloc_over_the_limit_is_zero() {
    assert!(fub_alloc(MAX_INPUT_BYTES + 1).is_null());
    assert!(fub_alloc(usize::MAX).is_null());
    let ptr = fub_alloc(MAX_INPUT_BYTES);
    assert!(!ptr.is_null());
    // SAFETY: viene da `fub_alloc(MAX_INPUT_BYTES)`.
    unsafe { fub_free(ptr, MAX_INPUT_BYTES) };
    // Il sorgente di un byte oltre `MAX_SOURCE_BYTES` sta sotto il limite
    // d'ingresso: arriva al nucleo, che risponde `limit`.
    const { assert!(MAX_SOURCE_BYTES < MAX_INPUT_BYTES) };
    let over = vec![b' '; MAX_INPUT_BYTES + 1];
    // SAFETY: con un `len` oltre il limite il puntatore non si legge (e qui
    // indicherebbe comunque `len` byte veri).
    assert_eq!(unsafe { canvas_open(over.as_ptr(), over.len()) }, 0);
    assert_eq!(error_result()["code"], "limit");
}

/// Dopo 10 000 giri di `open`, `commit`, `preview` e `close` la memoria viva
/// del filo è quella dopo il primo giro: niente resta indietro.
#[test]
fn ten_thousand_rounds_leave_no_memory_behind() {
    let source = common::one_card("😀 una scheda é", true, true);
    let round = || {
        let (handle, opened) = Abi.open(source.as_bytes()).expect("si apre");
        let node = opened["canvas"]["nodes"][0].clone();
        let mut after = node.clone();
        after["x"] = json!(3);
        let request =
            serde_json::to_vec(&json!([{ "kind": "upsert-node", "before": node, "after": after }]))
                .expect("si scrive");
        let preview = Abi.preview(handle, &request).expect("preview");
        assert!(!preview.is_empty());
        Abi.commit(handle, &request).expect("commit");
        // Un errore libera come un successo.
        expect_code(Abi.commit(handle, &request), "stale");
        Abi.close(handle).expect("close");
    };
    round();
    let after_first = live();
    for _ in 1..10_000 {
        round();
    }
    assert_eq!(
        live(),
        after_first,
        "la memoria viva è cambiata di {} byte in 10 000 giri",
        live() - after_first
    );
}

/// Dopo 10 000 giri di `open`, `canvas_ink_layers`, un `commit`
/// d'inchiostro, di nuovo `canvas_ink_layers`, `close` e una chiamata su
/// l'handle chiuso, la memoria viva del filo è quella dopo il primo giro.
#[test]
fn ten_thousand_ink_rounds_leave_no_memory_behind() {
    let source = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"😀"}],"edges":[]}"#;
    let add = common::add_free_stroke("s-1");
    let round = || {
        let (handle, _) = Abi.open(source.as_bytes()).expect("si apre");
        assert_eq!(
            Abi.ink_layers(handle).expect("vuota"),
            json!({ "layers": [] })
        );
        Abi.commit(handle, &add).expect("commit");
        let layers = Abi.ink_layers(handle).expect("dopo");
        assert_eq!(layers["layers"][0]["strokes"][0]["drawn"], true);
        Abi.close(handle).expect("close");
        // Un errore libera come un successo.
        expect_code(Abi.ink_layers(handle), "handle");
    };
    round();
    let after_first = live();
    for _ in 1..10_000 {
        round();
    }
    assert_eq!(
        live(),
        after_first,
        "la memoria viva è cambiata di {} byte in 10 000 giri",
        live() - after_first
    );
}
