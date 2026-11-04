//! La facciata attraverso il livello sicuro ([`Cores`]): i vettori, il
//! tratto UTF-16, gli ingressi sbagliati, gli handle, le dimensioni e i
//! risultati. `tests/abi.rs` fa gli stessi controlli attraverso le funzioni
//! `extern "C"`.

mod common;

use common::Via;
use fub_canvas_wasm::api::{Cores, Failure};
use serde_json::Value;

/// [`Cores`] come via: un errore è l'oggetto `error` del suo JSON.
#[derive(Default)]
struct Api(Cores);

fn error(failure: Failure) -> Value {
    let json: Value = serde_json::from_str(&failure.to_json()).expect("l'errore è JSON");
    json["error"].clone()
}

fn answer(outcome: Result<String, Failure>) -> Result<Value, Value> {
    outcome
        .map(|text| serde_json::from_str(&text).expect("la risposta è JSON"))
        .map_err(error)
}

impl Via for Api {
    fn open(&mut self, source: &[u8]) -> Result<(u32, Value), Value> {
        let (handle, text) = self.0.open(source).map_err(error)?;
        let json: Value = serde_json::from_str(&text).expect("la risposta è JSON");
        assert_eq!(json["handle"], handle);
        Ok((handle, json))
    }
    fn reset(&mut self, handle: u32, source: &[u8]) -> Result<Value, Value> {
        answer(self.0.reset(handle, source))
    }
    fn commit(&mut self, handle: u32, request: &[u8]) -> Result<Value, Value> {
        answer(self.0.commit(handle, request))
    }
    fn preview(&mut self, handle: u32, request: &[u8]) -> Result<Vec<u8>, Value> {
        self.0
            .preview(handle, request)
            .map(String::into_bytes)
            .map_err(error)
    }
    fn compile(&mut self, handle: u32, request: &[u8]) -> Result<Value, Value> {
        answer(self.0.compile(handle, request))
    }
    fn model(&mut self, handle: u32) -> Result<Value, Value> {
        answer(self.0.model(handle))
    }
    fn node_at(&mut self, handle: u32, byte: u32) -> Result<Option<usize>, Value> {
        self.0.node_at(handle, byte as usize).map_err(error)
    }
    fn close(&mut self, handle: u32) -> Result<(), Value> {
        self.0.close(handle).map_err(error)
    }
}

#[test]
fn every_vector_gives_the_text_the_edit_and_the_error() {
    let mut api = Api::default();
    common::every_vector(&mut api);
    assert!(api.0.is_empty(), "una lavagna è rimasta aperta");
}

#[test]
fn the_utf16_edit_rebuilds_the_new_source() {
    common::utf16_round_trip(&mut Api::default());
}

#[test]
fn bad_input_is_a_json_error() {
    common::bad_input(&mut Api::default());
}

#[test]
fn handles_are_never_reused() {
    common::handles(&mut Api::default());
}

#[test]
fn sixteen_mib_open_one_more_byte_is_a_limit() {
    common::sizes(&mut Api::default());
}

#[test]
fn empty_and_large_results() {
    common::results(&mut Api::default());
}

/// Un ingresso oltre il limite d'ingresso è `limit` prima di guardarne i
/// byte.
#[test]
fn an_input_over_the_limit_is_refused_unread() {
    let mut cores = Cores::new();
    let huge = vec![0xFF; fub_canvas_wasm::api::MAX_INPUT_BYTES + 1];
    assert_eq!(cores.open(&huge).map(|_| ()).unwrap_err().code, "limit");
}
