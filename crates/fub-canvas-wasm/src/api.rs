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

use fub_canvas_core::commit::{Changed, CommitError, Core, LayerChange};
use fub_canvas_core::ink::{board_layer, node_layer, LayerRead, LayerState, StrokeState, INK_KEY};
use fub_canvas_core::model::{Canvas, CanvasError, CanvasNode, MAX_SOURCE_BYTES};
use fub_canvas_core::ops::{compile, CanvasOp, OpError};
use fub_canvas_core::patch::CanvasPatch;
use fub_canvas_core::source::{canvas_value, node_at, node_value};
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
            OpError::UnknownStroke { id, .. } => ("UnknownStroke", Some(id)),
            OpError::ForeignLayer { .. } => ("ForeignLayer", None),
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
    open: BTreeMap<Handle, Open>,
    /// Il prossimo handle; `u32::MAX` vuol dire finiti.
    next: Handle,
}

/// Una lavagna aperta: il nucleo e quello che la facciata ricorda del suo
/// sorgente di adesso, per non rifare il lavoro di tutto il testo a ogni
/// commit di un tratto.
#[derive(Debug)]
struct Open {
    core: Core,
    /// Quante unità UTF-16 ha il sorgente.
    units: usize,
    /// I livelli d'inchiostro letti, già scritti in JSON; `None` finché
    /// nessuno li chiede dopo l'apertura, un `reset` o un commit che cambia
    /// altro dall'inchiostro.
    ink: Option<InkRead>,
}

impl Open {
    fn new(core: Core) -> Self {
        let units = utf16_units(core.source());
        Self {
            core,
            units,
            ink: None,
        }
    }
}

/// I livelli d'inchiostro di una lavagna nella forma di [`Cores::ink_layers`],
/// per chi li tiene: uno per scheda (nell'ordine di `nodes`, `None` senza
/// livello) e quello della radice.
#[derive(Debug)]
struct InkRead {
    nodes: Vec<Option<String>>,
    board: Option<String>,
}

impl InkRead {
    fn new(canvas: &Canvas) -> Self {
        Self {
            nodes: canvas.nodes.iter().map(node_layer_json).collect(),
            board: board_layer_json(canvas),
        }
    }

    /// Rilegge soltanto le parti che un commit di un tratto ha cambiato.
    /// Falso se le schede non sono più quelle lette: allora si rilegge
    /// tutto alla prossima domanda.
    fn follow(&mut self, canvas: &Canvas, nodes: &[usize], board: bool) -> bool {
        if self.nodes.len() != canvas.nodes.len() {
            return false;
        }
        for &at in nodes {
            match (self.nodes.get_mut(at), canvas.nodes.get(at)) {
                (Some(slot), Some(node)) => *slot = node_layer_json(node),
                _ => return false,
            }
        }
        if board {
            self.board = board_layer_json(canvas);
        }
        true
    }

    fn to_json(&self) -> String {
        let mut out = String::from("{\"layers\":[");
        let layers = self.nodes.iter().flatten().chain(&self.board);
        for (k, layer) in layers.enumerate() {
            if k > 0 {
                out.push(',');
            }
            out.push_str(layer);
        }
        out.push_str("]}");
        out
    }
}

fn node_layer_json(node: &CanvasNode) -> Option<String> {
    node_layer(node).map(|read| layer_json(&read).to_string())
}

fn board_layer_json(canvas: &Canvas) -> Option<String> {
    board_layer(canvas).map(|read| layer_json(&read).to_string())
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
        self.open.insert(handle, Open::new(core));
        Ok((
            handle,
            json!({ "handle": handle, "canvas": canvas }).to_string(),
        ))
    }

    /// Riapre la lavagna `handle` da un sorgente nuovo (il file è cambiato da
    /// fuori). Risponde `{"canvas"}`; con un errore la lavagna resta com'era.
    pub fn reset(&mut self, handle: Handle, source: &[u8]) -> Result<String, Failure> {
        let open = self.open_mut(handle)?;
        let fresh = Core::open(text(source)?)?;
        let canvas = model(fresh.canvas())?;
        *open = Open::new(fresh);
        Ok(json!({ "canvas": canvas }).to_string())
    }

    /// Il modello della lavagna `handle`: `{"canvas"}`.
    pub fn model(&self, handle: Handle) -> Result<String, Failure> {
        let canvas = model(self.core(handle)?.canvas())?;
        Ok(json!({ "canvas": canvas }).to_string())
    }

    /// Applica una lista di toppe (un array JSON). Risponde
    /// `{"edit": {"start", "end", "text"}, "inverse": [toppe]}`: il tratto
    /// cambiato in unità UTF-16 del sorgente di prima
    /// (`prima[..start] + text + prima[end..]` è il sorgente nuovo) e le
    /// toppe che lo disfano.
    ///
    /// Se il commit ha cambiato soltanto livelli d'inchiostro (di schede che
    /// restano al loro posto, o quello della radice che c'era e c'è ancora)
    /// c'è anche `changed`: `{"nodes": [...], "root": {...}, "board"?}`.
    /// Ogni voce di `nodes` è una scheda riscritta, con la sua posizione:
    /// `{"at", "node"}` la dà intera, `{"at", "id", "strokes"}` dice che
    /// è cambiata solo la lista dei tratti del suo livello. `root` ha le
    /// chiavi della radice riscritte intere, `board` il cambio della sola
    /// lista dei tratti della radice. Un cambio della lista è
    /// `{"start", "remove", "insert"}`: i tratti da `start` a
    /// `start + remove` sono diventati `insert`. Messo sul modello di prima,
    /// `changed` dà quello che darebbe il modello; senza, il modello si
    /// rilegge intero.
    pub fn commit(&mut self, handle: Handle, request: &[u8]) -> Result<String, Failure> {
        let patches = patches(request)?;
        let open = self.open_mut(handle)?;
        let committed = open.core.commit(&patches)?;
        let after = &committed.source;
        let edit = &committed.edit;
        // Il prefisso fino a `start` è comune ai due sorgenti, e il resto
        // del vecchio dopo `end` è il resto del nuovo dopo il testo inserito:
        // contati sul sorgente nuovo, con le unità del vecchio già note.
        let head = after.get(..edit.start).unwrap_or_default();
        let tail = after
            .get(edit.start + edit.text.len()..)
            .unwrap_or_default();
        let (head, inserted, tail) = (
            utf16_units(head),
            utf16_units(&edit.text),
            utf16_units(tail),
        );
        let end = open.units.saturating_sub(tail);
        open.units = head + inserted + tail;
        let inverse = serde_json::to_value(&committed.inverse).map_err(Failure::internal)?;
        let mut answer = json!({
            "edit": { "start": head, "end": end, "text": edit.text },
            "inverse": inverse,
        });
        let canvas = open.core.canvas();
        match &committed.changed {
            Changed::Ink { nodes, board } => {
                let positions: Vec<usize> = nodes.iter().map(|(at, _)| *at).collect();
                let followed = open
                    .ink
                    .as_mut()
                    .is_some_and(|ink| ink.follow(canvas, &positions, board.is_some()));
                if !followed {
                    open.ink = None;
                }
                answer["changed"] = changed(canvas, nodes, board.as_ref())?;
            }
            Changed::Whole => open.ink = None,
        }
        Ok(answer.to_string())
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

    /// I livelli d'inchiostro della lavagna `handle`, come li legge il
    /// nucleo ([`fub_canvas_core::ink::read_layers`]): `{"layers": [...]}`,
    /// nella forma di `expect` dei vettori di `canvas-ink/`. Ogni livello è
    /// `{"layer", "state", "strokes"}`: `layer` è `"board"` o
    /// `{"node": id}`, `state` è `"ok"` o `"foreign"` (un livello estraneo
    /// ha `strokes` vuoto), e ogni tratto di un livello valido è
    /// `{"id", "drawn"}` più `reason` se non si disegna. La facciata tiene i
    /// livelli letti: dopo un commit di un tratto rilegge solo quelli che ha
    /// cambiato.
    pub fn ink_layers(&mut self, handle: Handle) -> Result<String, Failure> {
        let open = self.open_mut(handle)?;
        let ink = match &mut open.ink {
            Some(ink) => ink,
            empty => empty.insert(InkRead::new(open.core.canvas())),
        };
        Ok(ink.to_json())
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
            .map(|open| &open.core)
            .ok_or_else(|| Failure::handle(handle))
    }

    fn open_mut(&mut self, handle: Handle) -> Result<&mut Open, Failure> {
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

/// Un livello letto nella forma dei vettori di `canvas-ink/`.
fn layer_json(read: &LayerRead) -> Value {
    let (state, strokes) = match &read.state {
        LayerState::Foreign(_) => ("foreign", Vec::new()),
        LayerState::Ok { layer, strokes } => (
            "ok",
            layer
                .strokes
                .iter()
                .zip(strokes)
                .map(|(stroke, state)| match state {
                    StrokeState::Drawn(_) => json!({ "id": stroke.id, "drawn": true }),
                    StrokeState::Kept(reason) => {
                        json!({ "id": stroke.id, "drawn": false, "reason": reason.as_str() })
                    }
                })
                .collect(),
        ),
    };
    json!({ "layer": read.layer, "state": state, "strokes": strokes })
}

/// Quello che un commit di un tratto ha cambiato, nella forma di
/// `changed` di [`Cores::commit`].
fn changed(
    canvas: &Canvas,
    nodes: &[(usize, LayerChange)],
    board: Option<&LayerChange>,
) -> Result<Value, Failure> {
    let nodes = nodes
        .iter()
        .map(|(at, change)| {
            let node = canvas
                .nodes
                .get(*at)
                .ok_or_else(|| Failure::internal(format!("the changed card {at} is missing")))?;
            Ok(match strokes_json(change) {
                Some(strokes) => json!({ "at": at, "id": node.id, "strokes": strokes }),
                None => json!({ "at": at, "node": node_value(node).map_err(Failure::internal)? }),
            })
        })
        .collect::<Result<Vec<_>, Failure>>()?;
    let mut answer = json!({ "nodes": nodes, "root": {} });
    if let Some(change) = board {
        match strokes_json(change) {
            Some(strokes) => answer["board"] = strokes,
            None => {
                let value = canvas
                    .extra
                    .get(INK_KEY)
                    .ok_or_else(|| Failure::internal("the changed board layer is missing"))?;
                answer["root"][INK_KEY] = value.clone();
            }
        }
    }
    Ok(answer)
}

/// Un cambio della sola lista dei tratti come `{"start", "remove", "insert"}`;
/// `None` per un livello da prendere intero.
fn strokes_json(change: &LayerChange) -> Option<Value> {
    match change {
        LayerChange::Whole => None,
        LayerChange::Strokes {
            start,
            remove,
            insert,
        } => Some(json!({ "start": start, "remove": remove, "insert": insert })),
    }
}

/// Le unità UTF-16 di `text`, senza codificarlo: una per carattere, due
/// per uno di quattro byte.
pub(crate) fn utf16_units(text: &str) -> usize {
    if text.is_ascii() {
        return text.len();
    }
    text.bytes()
        .map(|byte| usize::from((byte as i8) >= -0x40) + usize::from(byte >= 0xF0))
        .sum()
}

fn model(canvas: &Canvas) -> Result<Value, Failure> {
    canvas_value(canvas).map_err(Failure::internal)
}

#[cfg(test)]
mod tests {
    use super::utf16_units;

    /// Il conto senza codifica è quello di `encode_utf16`, per caratteri di
    /// uno, due, tre e quattro byte, da soli e mescolati.
    #[test]
    fn utf16_units_count_like_the_encoder() {
        let texts = [
            "",
            "abc",
            "é",
            "€",
            "😀",
            "𝄞",
            "a😀b€é\r\n",
            "\u{feff}{\"x\":1}",
            "\u{7f}\u{80}",
            "\u{7ff}\u{800}\u{ffff}\u{10000}\u{10ffff}",
        ];
        for text in texts {
            assert_eq!(utf16_units(text), text.encode_utf16().count(), "{text:?}");
            // Ogni posizione rispetto alle parole di otto byte.
            for shift in 0..8 {
                let moved = format!("{}{text}", "x".repeat(shift));
                assert_eq!(
                    utf16_units(&moved),
                    moved.encode_utf16().count(),
                    "{text:?} da {shift}"
                );
            }
            let long = text.repeat(37);
            assert_eq!(
                utf16_units(&long),
                long.encode_utf16().count(),
                "{text:?} × 37"
            );
        }
    }
}
