//! Il contratto del disegno: le forme con cui client, host e motore del
//! disegno si parlano (K5, ADR del motore vettoriale).
//!
//! Il client resta lo scrittore del file. Il motore tiene una copia del
//! disegno che segue il testo della `DocumentSession` ([`DrawingSync`]), ci fa
//! girare i suoi strumenti con i campioni della penna di Fub
//! ([`DrawingGesture`]) e restituisce la differenza come operazioni di scena
//! ([`DrawingOutcome::ops`], la forma di `docs/reference/scene-operations.md`),
//! che il client applica in un solo passo di annullamento. Ciò che il motore
//! non sa modificare si dice all'apertura ([`DrawingOpen::losses`]) e al gesto
//! ([`DrawingRefusal`]).
//!
//! Le coordinate degli eventi sono quelle della scena; gli offset di
//! [`DrawingEdit`] sono unità UTF-16 sul testo con i terminatori di riga
//! ridotti a LF, come `TextEdit` di `editors/core/text-operation.ts`.
//!
//! Ogni richiesta che attraversa il confine passa da `validate()` prima di
//! raggiungere il motore: un rifiuto è [`PluginError::BadArgs`] col nome del
//! campo in testa al messaggio.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::PluginError;

/// Il testo di un disegno, al più: lo stesso tetto di `fub_scene::MAX_EDIT_BYTES`.
pub const MAX_DRAWING_TEXT_BYTES: usize = 20 * 1024 * 1024;
/// Gli eventi di una sola richiesta di gesto, al più.
pub const MAX_GESTURE_EVENTS: usize = 100_000;
/// Le operazioni di un esito, al più: `MAX_BATCH` di `scene/ops.ts`. È anche
/// il tetto degli id di una selezione, perché spostare una selezione scrive
/// un'operazione per oggetto.
pub const MAX_DRAWING_OPS: usize = 10_000;
/// Il JSON delle operazioni di un esito, al più: `MAX_OP_BYTES` di
/// `scene/ops.ts`. Lo controlla chi scrive l'esito.
pub const MAX_DRAWING_OPS_BYTES: usize = 8 * 1024 * 1024;
/// Le parti che il motore non sa modificare, elencate al più.
pub const MAX_DRAWING_LOSSES: usize = 50_000;
/// Un colore dello stile, al più (`#rrggbb`, `rgb(…)`, un nome CSS).
pub const MAX_DRAWING_COLOR_BYTES: usize = 64;

/// Colore del tratto della selezione: `value` è il colore, una stringa.
pub const DRAWING_COMMAND_STROKE_COLOR: &str = "disegno.colore-tratto";
/// Colore del riempimento: `value` è il colore, o `null` per nessun riempimento.
pub const DRAWING_COMMAND_FILL_COLOR: &str = "disegno.colore-riempimento";
/// Spessore del tratto: `value` è un numero finito, zero o più.
pub const DRAWING_COMMAND_WIDTH: &str = "disegno.spessore";
/// I comandi del disegno di K5, nell'ordine in cui il motore li elenca.
pub const DRAWING_COMMANDS: [&str; 3] = [
    DRAWING_COMMAND_STROKE_COLOR,
    DRAWING_COMMAND_FILL_COLOR,
    DRAWING_COMMAND_WIDTH,
];

fn bad(message: String) -> PluginError {
    PluginError::BadArgs(message.into())
}

fn finite(field: &str, value: f64) -> Result<(), PluginError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(bad(format!("`{field}` is not a finite number")))
    }
}

/// Una lista di id di scena: nessuno vuoto, nessuno ripetuto, al più
/// [`MAX_DRAWING_OPS`].
fn ids(field: &str, list: &[String]) -> Result<(), PluginError> {
    if list.len() > MAX_DRAWING_OPS {
        return Err(bad(format!(
            "`{field}` has {} ids, at most {MAX_DRAWING_OPS}",
            list.len()
        )));
    }
    let mut seen = BTreeSet::new();
    for id in list {
        if id.is_empty() {
            return Err(bad(format!("`{field}` has an empty id")));
        }
        if !seen.insert(id.as_str()) {
            return Err(bad(format!("`{field}` repeats the id `{id}`")));
        }
    }
    Ok(())
}

fn losses(field: &str, list: &[DrawingLoss]) -> Result<(), PluginError> {
    if list.len() > MAX_DRAWING_LOSSES {
        return Err(bad(format!(
            "`{field}` has {} parts, at most {MAX_DRAWING_LOSSES}",
            list.len()
        )));
    }
    for loss in list {
        if loss.element.is_empty() {
            return Err(bad(format!("`{field}.element` is empty")));
        }
    }
    Ok(())
}

fn color(field: &str, value: &str) -> Result<(), PluginError> {
    if value.is_empty() || value.len() > MAX_DRAWING_COLOR_BYTES {
        return Err(bad(format!(
            "`{field}` must be a color of 1 to {MAX_DRAWING_COLOR_BYTES} bytes"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// L'apertura
// ---------------------------------------------------------------------------

/// Il disegno aperto nel motore: l'istanza da nominare nelle richieste dopo,
/// la revisione della copia e quanto del file il motore sa modificare.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawingOpen {
    pub instance: String,
    #[serde(with = "crate::ipc::u64_string")]
    pub revision: u64,
    /// Gli elementi che il motore sa modificare.
    pub mapped: u32,
    /// Gli elementi che restano come sono.
    pub unmapped: u32,
    /// Le parti che restano come sono, con il perché: il chip «N parti
    /// restano come sono» e «Che cosa manca?».
    pub losses: Vec<DrawingLoss>,
}

impl DrawingOpen {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.instance.is_empty() {
            return Err(bad("`instance` is empty".into()));
        }
        losses("losses", &self.losses)
    }
}

/// Una parte del disegno che il motore non sa modificare.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawingLoss {
    /// L'id dell'elemento, o il suo percorso nell'albero se non ne ha uno.
    pub element: String,
    pub kind: DrawingLossKind,
    /// Che cosa manca, in un codice o una frase breve del motore: la shell
    /// lo mostra nel dettaglio di «Che cosa manca?».
    pub detail: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingLossKind {
    /// Il motore non ha un oggetto per l'elemento: resta com'è e un gesto che
    /// lo toccherebbe è rifiutato.
    Unmapped,
    /// Il motore lo modifica con un'approssimazione (un attributo che non
    /// rappresenta esattamente).
    Approximated,
    /// L'elemento usa una cosa che il motore non sostiene affatto.
    Unsupported,
}

// ---------------------------------------------------------------------------
// La copia segue il file
// ---------------------------------------------------------------------------

/// Il testo del disegno è cambiato: la copia del motore lo segue fino a
/// `revision`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawingSync {
    #[serde(with = "crate::ipc::u64_string")]
    pub revision: u64,
    pub change: DrawingChange,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum DrawingChange {
    /// La differenza dal testo che la copia ha, come un `TextOperation` del
    /// client: gli intervalli in ordine, senza sovrapporsi, sul testo prima.
    Edits {
        edits: Vec<DrawingEdit>,
        length_before: u32,
        length_after: u32,
    },
    /// Il testo intero, quando la differenza non c'è o costerebbe di più.
    Text { text: String },
}

/// Un intervallo sostituito, in unità UTF-16 sul testo LF.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawingEdit {
    pub from: u32,
    pub to: u32,
    pub deleted: String,
    pub inserted: String,
}

/// La copia del motore è alla revisione detta.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawingSynced {
    #[serde(with = "crate::ipc::u64_string")]
    pub revision: u64,
}

impl DrawingSync {
    pub fn validate(&self) -> Result<(), PluginError> {
        match &self.change {
            DrawingChange::Text { text } => {
                if text.len() > MAX_DRAWING_TEXT_BYTES {
                    return Err(bad(format!(
                        "`change.text` has {} bytes, at most {MAX_DRAWING_TEXT_BYTES}",
                        text.len()
                    )));
                }
                Ok(())
            }
            DrawingChange::Edits {
                edits,
                length_before,
                length_after,
            } => {
                // Un'unità UTF-16 è almeno un byte UTF-8: una lunghezza oltre il
                // tetto in byte è oltre il tetto anche in unità.
                for (field, length) in [
                    ("change.length_before", *length_before),
                    ("change.length_after", *length_after),
                ] {
                    if length as usize > MAX_DRAWING_TEXT_BYTES {
                        return Err(bad(format!(
                            "`{field}` is {length}, at most {MAX_DRAWING_TEXT_BYTES}"
                        )));
                    }
                }
                let mut bytes = 0usize;
                let mut previous_to = 0u32;
                let mut delta = 0i64;
                for (index, edit) in edits.iter().enumerate() {
                    bytes = bytes
                        .saturating_add(edit.deleted.len())
                        .saturating_add(edit.inserted.len());
                    if bytes > MAX_DRAWING_TEXT_BYTES {
                        return Err(bad(format!(
                            "`change.edits` carries more than {MAX_DRAWING_TEXT_BYTES} bytes"
                        )));
                    }
                    if edit.to < edit.from {
                        return Err(bad(format!(
                            "`change.edits[{index}]` ends before it starts"
                        )));
                    }
                    if edit.from < previous_to || edit.to > *length_before {
                        return Err(bad(format!(
                            "`change.edits[{index}]` overlaps another edit or leaves the text"
                        )));
                    }
                    let deleted = edit.deleted.encode_utf16().count();
                    if deleted != (edit.to - edit.from) as usize {
                        return Err(bad(format!(
                            "`change.edits[{index}].deleted` is not as long as its range"
                        )));
                    }
                    previous_to = edit.to;
                    delta += edit.inserted.encode_utf16().count() as i64 - deleted as i64;
                }
                if i64::from(*length_before) + delta != i64::from(*length_after) {
                    return Err(bad("`change.length_after` does not match the edits".into()));
                }
                Ok(())
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Il gesto
// ---------------------------------------------------------------------------

/// Un campione della penna, in coordinate di scena.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawingPointer {
    pub kind: DrawingPointerKind,
    pub x: f64,
    pub y: f64,
    /// Da 0 a 1; 0 al rilascio.
    pub pressure: f32,
    pub shift: bool,
    pub alt: bool,
    /// Ctrl su Windows e Linux, ⌘ su macOS.
    pub cmd: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingPointerKind {
    Down,
    Drag,
    Up,
    /// Il puntatore si muove senza premere (il passaggio sopra un oggetto).
    Move,
    DoubleClick,
}

impl DrawingPointer {
    pub fn validate(&self) -> Result<(), PluginError> {
        finite("events.x", self.x)?;
        finite("events.y", self.y)?;
        if !self.pressure.is_finite() || !(0.0..=1.0).contains(&self.pressure) {
            return Err(bad("`events.pressure` must be between 0 and 1".into()));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingPhase {
    /// Il gesto continua: il motore risponde con l'anteprima.
    Preview,
    /// Il gesto è finito: il motore risponde con le operazioni. È il caso di
    /// una richiesta che non lo dice, come i vettori dei gesti, che portano il
    /// gesto intero.
    #[default]
    Commit,
    /// Il gesto è annullato: la copia torna com'era.
    Cancel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingTool {
    Select,
    Rect,
    Ellipse,
    Line,
    Arrow,
    Text,
}

/// La griglia magnetica del gesto.
#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct DrawingSnap {
    /// Il passo della griglia, in unità di scena; `None` se è spenta.
    pub grid: Option<f64>,
    /// Ctrl/⌘ tenuto per tutto il gesto: la griglia non aggancia.
    pub free: bool,
}

impl DrawingSnap {
    pub fn validate(&self) -> Result<(), PluginError> {
        if let Some(grid) = self.grid {
            if !grid.is_finite() || grid <= 0.0 {
                return Err(bad("`snap.grid` must be a finite number above 0".into()));
            }
        }
        Ok(())
    }
}

/// Lo stile con cui uno strumento di forma disegna.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawingStyle {
    pub stroke: String,
    pub width: f64,
    /// `None`: nessun riempimento.
    pub fill: Option<String>,
}

impl DrawingStyle {
    pub fn validate(&self) -> Result<(), PluginError> {
        color("style.stroke", &self.stroke)?;
        if let Some(fill) = &self.fill {
            color("style.fill", fill)?;
        }
        if !self.width.is_finite() || self.width < 0.0 {
            return Err(bad(
                "`style.width` must be a finite number, 0 or more".into()
            ));
        }
        Ok(())
    }
}

/// Una richiesta di gesto: gli eventi nuovi dall'ultima richiesta dello
/// stesso gesto, con ciò che serve a rifarlo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawingGesture {
    /// La revisione della copia su cui il client ha visto il disegno. I
    /// vettori dei gesti non la portano: per loro è 0, il disegno appena
    /// aperto.
    #[serde(default, with = "crate::ipc::u64_string")]
    pub revision: u64,
    #[serde(default)]
    pub phase: DrawingPhase,
    pub tool: DrawingTool,
    /// Il livello scelto nel menu dei livelli; `None`: lo sceglie il motore
    /// come lo sceglie l'editor.
    pub layer: Option<String>,
    /// Gli oggetti selezionati prima del gesto.
    pub selection: Vec<String>,
    /// La scala della vista, per le tolleranze.
    pub zoom: f64,
    pub snap: DrawingSnap,
    /// `None` per `select`.
    pub style: Option<DrawingStyle>,
    /// La riga del testo nuovo, solo per lo strumento `text`: la scrive il
    /// client nella lingua dell'interfaccia.
    #[serde(default)]
    pub text: Option<String>,
    pub events: Vec<DrawingPointer>,
}

impl DrawingGesture {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.layer.as_deref() == Some("") {
            return Err(bad("`layer` is empty".into()));
        }
        ids("selection", &self.selection)?;
        if !self.zoom.is_finite() || self.zoom <= 0.0 {
            return Err(bad("`zoom` must be a finite number above 0".into()));
        }
        self.snap.validate()?;
        if let Some(style) = &self.style {
            style.validate()?;
        }
        if let Some(text) = &self.text {
            if self.tool != DrawingTool::Text {
                return Err(bad("`text` is only for the text tool".into()));
            }
            if text.len() > MAX_DRAWING_TEXT_BYTES {
                return Err(bad(format!(
                    "`text` has {} bytes, at most {MAX_DRAWING_TEXT_BYTES}",
                    text.len()
                )));
            }
            if text.contains(['\n', '\r']) {
                return Err(bad("`text` must be a single line".into()));
            }
        }
        if self.events.len() > MAX_GESTURE_EVENTS {
            return Err(bad(format!(
                "`events` has {} events, at most {MAX_GESTURE_EVENTS}",
                self.events.len()
            )));
        }
        self.events.iter().try_for_each(DrawingPointer::validate)
    }
}

// ---------------------------------------------------------------------------
// L'esito
// ---------------------------------------------------------------------------

/// Ciò che la superficie disegna mentre il gesto continua, con i suoi segni
/// (`showShape`).
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct DrawingPreview {
    /// La forma nuova, come un `Elem` della scena.
    pub shape: Option<Value>,
    /// La matrice della selezione che si sposta, ridimensiona o ruota:
    /// `[a, b, c, d, e, f]` come `matrix(…)` di SVG.
    pub matrix: Option<[f64; 6]>,
    /// Il riquadro di selezione: `[x, y, larghezza, altezza]` in coordinate
    /// di scena.
    pub marquee: Option<[f64; 4]>,
}

impl DrawingPreview {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.shape.as_ref().is_some_and(|shape| !shape.is_object()) {
            return Err(bad("`preview.shape` must be an element object".into()));
        }
        if let Some(matrix) = &self.matrix {
            matrix
                .iter()
                .try_for_each(|value| finite("preview.matrix", *value))?;
        }
        if let Some(marquee) = &self.marquee {
            marquee
                .iter()
                .try_for_each(|value| finite("preview.marquee", *value))?;
            if marquee[2] < 0.0 || marquee[3] < 0.0 {
                return Err(bad("`preview.marquee` has a negative size".into()));
            }
        }
        Ok(())
    }
}

/// La risposta a un gesto o a un comando.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawingOutcome {
    #[serde(with = "crate::ipc::u64_string")]
    pub revision: u64,
    /// Solo per `phase: preview`.
    pub preview: Option<DrawingPreview>,
    /// Il JSON di un array di operazioni di scena, `None` se il gesto non ne
    /// scrive: il client le passa da `parseWireOp`.
    pub ops: Option<String>,
    /// La selezione dopo.
    pub selection: Vec<String>,
    /// Le parti che il gesto ha trovato e che restano come sono.
    pub losses: Vec<DrawingLoss>,
    /// Perché il gesto non ha fatto niente; `None` se ha fatto ciò che doveva.
    pub refused: Option<DrawingRefusal>,
}

impl DrawingOutcome {
    /// Il controllo di chi scrive l'esito, prima di mandarlo.
    pub fn validate(&self) -> Result<(), PluginError> {
        if let Some(preview) = &self.preview {
            preview.validate()?;
        }
        if let Some(ops) = &self.ops {
            if ops.len() > MAX_DRAWING_OPS_BYTES {
                return Err(bad(format!(
                    "`ops` has {} bytes, at most {MAX_DRAWING_OPS_BYTES}",
                    ops.len()
                )));
            }
            if self.refused.is_some() {
                return Err(bad("`ops` and `refused` are both set".into()));
            }
        }
        ids("selection", &self.selection)?;
        losses("losses", &self.losses)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingRefusal {
    /// La revisione della richiesta non è quella della copia.
    Stale,
    /// Il gesto toccherebbe una parte che il motore non sa modificare, o lo
    /// strumento non conosce il gesto.
    Unmapped,
    /// Il gesto non tocca niente: sotto la misura minima, una selezione vuota
    /// trascinata, uno spostamento che torna al punto di partenza.
    Empty,
    /// Il motore non sa fare ciò che il gesto chiede.
    Unsupported,
    /// L'esito supererebbe i limiti del contratto.
    TooLarge,
    /// L'istanza è chiusa.
    Closed,
    /// La copia non è ancora pronta (il reimport è in corso).
    NotReady,
    /// Il livello è bloccato, o non c'è un livello dove disegnare.
    Locked,
    /// Il livello è nascosto.
    Hidden,
}

// ---------------------------------------------------------------------------
// I comandi
// ---------------------------------------------------------------------------

/// Un comando del disegno, acceso o spento sulla selezione.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawingCommandInfo {
    pub id: String,
    pub enabled: bool,
}

/// Un comando dato sulla selezione.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawingCommandRequest {
    #[serde(with = "crate::ipc::u64_string")]
    pub revision: u64,
    pub id: String,
    pub selection: Vec<String>,
    pub value: Value,
}

impl DrawingCommandRequest {
    /// La forma della richiesta. Un id che il motore non serve passa di qui
    /// e il motore risponde `unsupported`; il valore dei comandi di K5 si
    /// controlla qui.
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.id.is_empty() {
            return Err(bad("`id` is empty".into()));
        }
        ids("selection", &self.selection)?;
        match self.id.as_str() {
            DRAWING_COMMAND_STROKE_COLOR => match &self.value {
                Value::String(value) => color("value", value),
                _ => Err(bad("`value` must be a color".into())),
            },
            DRAWING_COMMAND_FILL_COLOR => match &self.value {
                Value::String(value) => color("value", value),
                Value::Null => Ok(()),
                _ => Err(bad("`value` must be a color or null".into())),
            },
            DRAWING_COMMAND_WIDTH => match self.value.as_f64() {
                Some(width) if width.is_finite() && width >= 0.0 => Ok(()),
                _ => Err(bad("`value` must be a finite number, 0 or more".into())),
            },
            _ => Ok(()),
        }
    }
}
