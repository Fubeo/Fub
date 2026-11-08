//! Le lavagne aperte, per handle: il livello sicuro della facciata.
//!
//! [`Cores`] tiene un [`Core`] per lavagna aperta. Ogni funzione prende testo
//! o JSON UTF-8 e risponde con JSON UTF-8 (o con il testo intero, per
//! [`Cores::preview`]); un errore è un [`Failure`], che si scrive
//! `{"error": {"code", "message", …}}`. Niente qui va in panico su un input.
//!
//! Gli handle partono da 1, crescono e non si riusano: un handle chiuso
//! risponde `handle` per sempre e non arriva mai alla lavagna di un altro.
//! `0` e `u32::MAX` non sono mai handle.
//!
//! Le forme del JSON sono in `docs/reference/canvas-operations.md`
//! § «WebAssembly».

#![forbid(unsafe_code)]

use std::collections::BTreeMap;

use fub_canvas_core::commit::{CommitError, Core};
use fub_canvas_core::model::{Canvas, CanvasError, MAX_SOURCE_BYTES};
use fub_canvas_core::ops::{compile, CanvasOp, OpError};
use fub_canvas_core::patch::CanvasPatch;
use fub_canvas_core::source::{canvas_value, node_at};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value};

/// Un handle: il numero di una lavagna aperta.
pub type Handle = u32;

/// Il limite d'ingresso di una chiamata, in byte: il doppio di
/// [`MAX_SOURCE_BYTES`]. Un sorgente sta sempre sotto (e uno di un byte più
/// di [`MAX_SOURCE_BYTES`] arriva fino al nucleo, che risponde `limit`); una
/// lista di toppe porta le immagini di prima e di dopo, e con loro fino a
/// 1 MiB di testo di scheda per immagine, scritto come stringa JSON.
pub const MAX_INPUT_BYTES: usize = 2 * MAX_SOURCE_BYTES;

/// Perché una chiamata non riesce. `code` è una parola stabile (l'elenco è
/// nella pagina), `message` la spiegazione in inglese del nucleo, `detail`
/// i campi in più di un codice (per `op`: `kind`, `index` e, se c'è, `id`).
#[derive(Clone, Debug, PartialEq)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
    pub detail: Map<String, Value>,
}

impl Failure {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: Map::new(),
        }
    }

    fn handle(handle: Handle) -> Self {
        Self::new("handle", format!("no open canvas has handle {handle}"))
    }

    fn internal(message: impl std::fmt::Display) -> Self {
        Self::new("internal", message.to_string())
    }

    /// `{"error": {"code", "message", …detail}}`.
    pub fn to_json(&self) -> String {
        let mut error = Map::new();
        error.insert("code".into(), Value::String(self.code.into()));
        error.insert("message".into(), Value::String(self.message.clone()));
        for (key, value) in &self.detail {
            error.insert(key.clone(), value.clone());
        }
        json!({ "error": error }).to_string()
    }
}

impl From<CanvasError> for Failure {
    fn from(error: CanvasError) -> Self {
        let code = match error {
            CanvasError::Limit { .. } => "limit",
            CanvasError::Json(_) | CanvasError::Invalid(_) => "source",
        };
        Self::new(code, error.to_string())
    }
}

impl From<CommitError> for Failure {
    fn from(error: CommitError) -> Self {
        Self::new(error.reason(), error.to_string())
    }
}

impl From<OpError> for Failure {
    fn from(error: OpError) -> Self {
        let mut failure = Self::new("op", error.to_string());
        let (kind, id) = match &error {
            OpError::UnknownNode { id, .. } => ("UnknownNode", Some(id)),
            OpError::UnknownEdge { id, .. } => ("UnknownEdge", Some(id)),
            OpError::DuplicateId { id, .. } => ("DuplicateId", Some(id)),
            OpError::TooMany { .. } => ("TooMany", None),
            OpError::Invalid { .. } => ("Invalid", None),
        };
        failure
            .detail
            .insert("kind".into(), Value::String(kind.into()));
        failure
            .detail
            .insert("index".into(), Value::from(error.index()));
        if let Some(id) = id {
            failure
                .detail
                .insert("id".into(), Value::String(id.clone()));
        }
        failure
    }
}

/// La richiesta di [`Cores::compile`]: le operazioni e il seme degli id
/// nuovi (0 se manca; un numero o una stringa di cifre decimali, perché
/// JavaScript non scrive esatto un intero oltre 2^53).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CompileRequest {
    ops: Vec<CanvasOp>,
    #[serde(default, deserialize_with = "seed")]
    seed: u64,
}

fn seed<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    match Value::deserialize(deserializer)? {
        Value::Number(number) => number
            .as_u64()
            .ok_or_else(|| serde::de::Error::custom("seed is not an unsigned 64-bit integer")),
        Value::String(text)
            if !text.is_empty() && text.len() <= 20 && text.bytes().all(|b| b.is_ascii_digit()) =>
        {
            text.parse()
                .map_err(|_| serde::de::Error::custom("seed is not an unsigned 64-bit integer"))
        }
        _ => Err(serde::de::Error::custom(
            "seed is not an unsigned 64-bit integer",
        )),
    }
}

/// Le lavagne aperte. Un errore lascia ogni lavagna com'era.
#[derive(Debug)]
pub struct Cores {
    open: BTreeMap<Handle, Core>,
    /// Il prossimo handle; `u32::MAX` vuol dire finiti.
    next: Handle,
}

impl Default for Cores {
    fn default() -> Self {
        Self::new()
    }
}

impl Cores {
    pub fn new() -> Self {
        Self {
            open: BTreeMap::new(),
            next: 1,
        }
    }

    /// Quante lavagne sono aperte.
    pub fn len(&self) -> usize {
        self.open.len()
    }

    pub fn is_empty(&self) -> bool {
        self.open.is_empty()
    }

    /// Apre una lavagna dai byte del file, così come sono (non JSON
    /// incapsulato: il sorgente è il file). Risponde
    /// `{"handle", "canvas"}` con il modello.
    pub fn open(&mut self, source: &[u8]) -> Result<(Handle, String), Failure> {
        if self.next == Handle::MAX {
            return Err(Failure::new(
                "limit",
                "no canvas handles are left: reload the module",
            ));
        }
        let core = Core::open(text(source)?)?;
        let canvas = model(core.canvas())?;
        let handle = self.next;
        self.next += 1;
        self.open.insert(handle, core);
        Ok((
            handle,
            json!({ "handle": handle, "canvas": canvas }).to_string(),
        ))
    }

    /// Riapre la lavagna `handle` da un sorgente nuovo (il file è cambiato da
    /// fuori). Risponde `{"canvas"}`; con un errore la lavagna resta com'era.
    pub fn reset(&mut self, handle: Handle, source: &[u8]) -> Result<String, Failure> {
        let core = self.core_mut(handle)?;
        let fresh = Core::open(text(source)?)?;
        let canvas = model(fresh.canvas())?;
        *core = fresh;
        Ok(json!({ "canvas": canvas }).to_string())
    }

    /// Il modello della lavagna `handle`: `{"canvas"}`.
    pub fn model(&self, handle: Handle) -> Result<String, Failure> {
        let canvas = model(self.core(handle)?.canvas())?;
        Ok(json!({ "canvas": canvas }).to_string())
    }

    /// Applica una lista di toppe (un array JSON). Risponde
    /// `{"edit": {"start", "end", "text"}, "inverse": [toppe]}`: il tratto
    /// cambiato in unità UTF-16 del sorgente di prima (prima[..start] + text
    /// + prima[end..] è il sorgente nuovo) e le toppe che lo disfano.
    pub fn commit(&mut self, handle: Handle, request: &[u8]) -> Result<String, Failure> {
        let patches = patches(request)?;
        let core = self.core_mut(handle)?;
        // Il conto UTF-16 del sorgente di prima, senza copiarlo: dopo il
        // commit il sorgente è l'altro.
        let before_units = core.source().encode_utf16().count();
        let committed = core.commit(&patches)?;
        let after = &committed.source;
        let edit = &committed.edit;
        // Il prefisso fino a `start` è comune ai due sorgenti, e il resto
        // del vecchio dopo `end` è il resto del nuovo dopo il testo inserito.
        let head = after.get(..edit.start).unwrap_or_default();
        let tail = after
            .get(edit.start + edit.text.len()..)
            .unwrap_or_default();
        let start = head.encode_utf16().count();
        let end = before_units.saturating_sub(tail.encode_utf16().count());
        let inverse = serde_json::to_value(&committed.inverse).map_err(Failure::internal)?;
        Ok(json!({
            "edit": { "start": start, "end": end, "text": edit.text },
            "inverse": inverse,
        })
        .to_string())
    }

    /// Il sorgente intero che darebbe [`Cores::commit`] con le stesse toppe,
    /// senza cambiare la lavagna. Risponde il testo, non JSON.
    pub fn preview(&self, handle: Handle, request: &[u8]) -> Result<String, Failure> {
        let patches = patches(request)?;
        Ok(self.core(handle)?.preview(&patches)?)
    }

    /// Compila `{"ops", "seed"}` in toppe sul modello della lavagna, senza
    /// cambiarla. Risponde `{"patches", "created"}`.
    pub fn compile(&self, handle: Handle, request: &[u8]) -> Result<String, Failure> {
        let request: CompileRequest = serde_json::from_str(text(request)?)
            .map_err(|error| Failure::new("request", error.to_string()))?;
        let core = self.core(handle)?;
        let compiled = compile(core.canvas(), &request.ops, request.seed)?;
        serde_json::to_string(&compiled).map_err(Failure::internal)
    }

    /// L'indice della scheda che contiene il byte `byte` del sorgente (BOM
    /// compreso), o `None` fuori da ogni scheda.
    pub fn node_at(&self, handle: Handle, byte: usize) -> Result<Option<usize>, Failure> {
        Ok(node_at(self.core(handle)?.source(), byte))
    }

    /// Chiude la lavagna `handle`; il suo numero non torna più.
    pub fn close(&mut self, handle: Handle) -> Result<(), Failure> {
        self.open
            .remove(&handle)
            .map(drop)
            .ok_or_else(|| Failure::handle(handle))
    }

    fn core(&self, handle: Handle) -> Result<&Core, Failure> {
        self.open
            .get(&handle)
            .ok_or_else(|| Failure::handle(handle))
    }

    fn core_mut(&mut self, handle: Handle) -> Result<&mut Core, Failure> {
        self.open
            .get_mut(&handle)
            .ok_or_else(|| Failure::handle(handle))
    }
}

/// I byte come testo: oltre [`MAX_INPUT_BYTES`] è `limit`, non UTF-8 è
/// `utf8` (anche un surrogato codificato, che UTF-8 non ammette).
fn text(bytes: &[u8]) -> Result<&str, Failure> {
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(Failure::new(
            "limit",
            format!("the input exceeds the {MAX_INPUT_BYTES}-byte limit"),
        ));
    }
    std::str::from_utf8(bytes).map_err(|error| Failure::new("utf8", error.to_string()))
}

fn patches(request: &[u8]) -> Result<Vec<CanvasPatch>, Failure> {
    serde_json::from_str(text(request)?).map_err(|error| Failure::new("request", error.to_string()))
}

fn model(canvas: &Canvas) -> Result<Value, Failure> {
    canvas_value(canvas).map_err(Failure::internal)
}
