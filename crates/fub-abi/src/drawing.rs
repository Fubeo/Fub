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
/// Un'opzione di uno strumento del motore (`Tool::set_option`): `value` è
/// `{ "strumento": id, "chiave": nome, "valore": JSON }`.
pub const DRAWING_COMMAND_TOOL_OPTION: &str = "disegno.strumento.opzione";
/// Prepara una famiglia di comandi del motore: `value` è
/// `{ "famiglia": id }`, con l'id fra [`DRAWING_FAMILIES`].
pub const DRAWING_COMMAND_FAMILY_PREPARE: &str = "disegno.famiglia.prepara";
/// Le 26 famiglie della mappa del motore (`crates/fub-disegno/mappa.tsv`).
pub const DRAWING_FAMILIES: [&str; 26] = [
    "aspetto",
    "automazione",
    "colore",
    "dati",
    "dinamici",
    "effetti",
    "formati",
    "forme",
    "grafici",
    "immagini",
    "livelli",
    "nucleo",
    "pennelli",
    "prospettiva",
    "pulizia",
    "raster",
    "simboli",
    "stampa",
    "tavole",
    "testo",
    "tracciati",
    "trame",
    "trasforma",
    "tre-d",
    "vista",
    "web",
];
/// L'id di uno strumento del motore, al più.
pub const MAX_DRAWING_TOOL_ID_BYTES: usize = 64;
/// Gli ingressi da tastiera di una sola richiesta di gesto, al più.
pub const MAX_DRAWING_INPUTS: usize = 10_000;
/// `key` e `code` di un tasto, al più.
pub const MAX_DRAWING_KEY_BYTES: usize = 64;
/// Le sovrapposizioni di un'anteprima, al più.
pub const MAX_DRAWING_OVERLAYS: usize = 10_000;
/// Il testo di un'etichetta o di una misura, al più.
pub const MAX_DRAWING_OVERLAY_TEXT_BYTES: usize = 1024;
/// I dati `d` di un tracciato sovrapposto, al più.
pub const MAX_DRAWING_OVERLAY_PATH_BYTES: usize = 1024 * 1024;
/// La chiave di un'opzione di uno strumento, al più.
pub const MAX_DRAWING_OPTION_KEY_BYTES: usize = 64;

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

/// Una matrice `[a, b, c, d, e, f]` come `matrix(…)` di SVG: sei numeri
/// finiti e un'inversa finita (una cornice che si può rifare all'indietro).
fn invertible(field: &str, m: &[f64; 6]) -> Result<(), PluginError> {
    m.iter().try_for_each(|value| finite(field, *value))?;
    let [a, b, c, d, e, f] = *m;
    let det = a * d - b * c;
    let inverse = [
        d / det,
        -b / det,
        -c / det,
        a / det,
        (c * f - d * e) / det,
        (b * e - a * f) / det,
    ];
    if det == 0.0 || !det.is_finite() || !inverse.iter().all(|v| v.is_finite()) {
        return Err(bad(format!("`{field}` is not an invertible matrix")));
    }
    Ok(())
}

/// Un riquadro `[x0, y0, x1, y1]`: quattro numeri finiti, l'angolo in basso
/// a destra non prima di quello in alto a sinistra.
fn bounds(field: &str, r: &[f64; 4]) -> Result<(), PluginError> {
    r.iter().try_for_each(|value| finite(field, *value))?;
    if r[2] < r[0] || r[3] < r[1] {
        return Err(bad(format!("`{field}` ends before it starts")));
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

/// Lo strumento del gesto. Le sei unità sono gli strumenti di K5, scritti
/// come stringhe (`"select"`); `Engine` è uno strumento del motore preso dal
/// suo catalogo (`TOOL_GROUPS`), scritto `{"engine": {"id": "pen"}}`. Un id
/// che il motore non ha è il rifiuto [`DrawingRefusal::UnknownTool`].
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingTool {
    Select,
    Rect,
    Ellipse,
    Line,
    Arrow,
    Text,
    Engine { id: String },
}

impl DrawingTool {
    pub fn validate(&self) -> Result<(), PluginError> {
        if let DrawingTool::Engine { id } = self {
            if id.is_empty() || id.len() > MAX_DRAWING_TOOL_ID_BYTES {
                return Err(bad(format!(
                    "`tool.engine.id` must have 1 to {MAX_DRAWING_TOOL_ID_BYTES} bytes"
                )));
            }
            if !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return Err(bad(
                    "`tool.engine.id` must be ASCII letters, digits, `_` or `-`".into(),
                ));
            }
        }
        Ok(())
    }
}

/// I modificatori di un tasto.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct DrawingKeyMods {
    #[serde(default)]
    pub shift: bool,
    /// Option su macOS.
    #[serde(default)]
    pub alt: bool,
    /// Ctrl su Windows e Linux, ⌘ su macOS.
    #[serde(default)]
    pub cmd: bool,
    /// Ctrl su macOS (altrove è `cmd`).
    #[serde(default)]
    pub ctrl: bool,
}

/// Un ingresso da tastiera di un gesto con uno strumento del motore: lo
/// strumento lo vede dopo i puntatori della stessa richiesta.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DrawingInput {
    /// Un tasto premuto o lasciato: `key` e `code` come in `KeyboardEvent`
    /// (`"Enter"`, `"ArrowUp"`, `"a"`; `"KeyA"`, `"Digit1"`). Un tasto che
    /// lo strumento non conosce non fa niente.
    Key {
        key: String,
        code: String,
        #[serde(default)]
        mods: DrawingKeyMods,
        pressed: bool,
    },
    /// Il testo scritto, o ciò che l'IME conferma.
    Text { text: String },
    /// La composizione dell'IME: `preedit` sostituisce quella di prima (vuoto
    /// la chiude); `active` è la parte che si sta convertendo, `[da, a)` in
    /// caratteri Unicode di `preedit` (il client converte dagli indici
    /// JavaScript), `None` se non c'è.
    Ime {
        preedit: String,
        #[serde(default)]
        active: Option<[u32; 2]>,
    },
}

impl DrawingInput {
    pub fn validate(&self) -> Result<(), PluginError> {
        match self {
            DrawingInput::Key { key, code, .. } => {
                if key.is_empty() || key.len() > MAX_DRAWING_KEY_BYTES {
                    return Err(bad(format!(
                        "`inputs.key` must have 1 to {MAX_DRAWING_KEY_BYTES} bytes"
                    )));
                }
                if code.len() > MAX_DRAWING_KEY_BYTES {
                    return Err(bad(format!(
                        "`inputs.code` has more than {MAX_DRAWING_KEY_BYTES} bytes"
                    )));
                }
                Ok(())
            }
            DrawingInput::Text { text } => {
                if text.is_empty() || text.len() > MAX_DRAWING_TEXT_BYTES {
                    return Err(bad(format!(
                        "`inputs.text` must have 1 to {MAX_DRAWING_TEXT_BYTES} bytes"
                    )));
                }
                Ok(())
            }
            DrawingInput::Ime { preedit, active } => {
                if preedit.len() > MAX_DRAWING_TEXT_BYTES {
                    return Err(bad(format!(
                        "`inputs.preedit` has more than {MAX_DRAWING_TEXT_BYTES} bytes"
                    )));
                }
                if let Some([da, a]) = active {
                    let n = preedit.chars().count();
                    if da > a || *a as usize > n {
                        return Err(bad(format!(
                            "`inputs.active` must be a range within the {n} characters of `preedit`"
                        )));
                    }
                }
                Ok(())
            }
        }
    }
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

/// La cornice di trasformazione che il client tiene per più oggetti scelti
/// dopo averli girati o ridimensionati (`Frame` di `tools/frame.ts`, in
/// `ctx.kept`): la matrice e i due riquadri nelle sue coordinate. I
/// riquadri viaggiano con lei perché sono quelli di quando la cornice è
/// nata: rifatti dagli oggetti, con le `transform` scritte a quattro
/// decimali, darebbero una misura appena diversa da quella del client.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawingFrame {
    /// Dalle coordinate della cornice alla scena, `[a, b, c, d, e, f]` come
    /// `matrix(…)` di SVG.
    pub matrix: [f64; 6],
    /// Il riquadro col contorno, `[x0, y0, x1, y1]` nelle coordinate della
    /// cornice.
    pub bounds: [f64; 4],
    /// Il riquadro della geometria, senza contorno, nella stessa forma.
    pub geometry: [f64; 4],
}

impl DrawingFrame {
    /// Il controllo della cornice nel campo `field`: la matrice ha
    /// un'inversa finita, i riquadri sono finiti e dritti.
    pub fn validate(&self, field: &str) -> Result<(), PluginError> {
        invertible(&format!("{field}.matrix"), &self.matrix)?;
        bounds(&format!("{field}.bounds"), &self.bounds)?;
        bounds(&format!("{field}.geometry"), &self.geometry)
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
    /// La cornice che il client tiene per più oggetti scelti, girata o
    /// ridimensionata da un gesto di prima. `None` se il client non ne
    /// tiene una: la cornice è il riquadro comune nella scena. Il motore la
    /// usa solo se la selezione è ancora quella.
    #[serde(default)]
    pub frame: Option<DrawingFrame>,
    pub events: Vec<DrawingPointer>,
    /// Tasti, testo e IME per uno strumento del motore, dopo `events`. Può
    /// mancare (vale vuoto); solo per [`DrawingTool::Engine`].
    #[serde(default)]
    pub inputs: Vec<DrawingInput>,
}

impl DrawingGesture {
    pub fn validate(&self) -> Result<(), PluginError> {
        self.tool.validate()?;
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
        if let Some(frame) = &self.frame {
            frame.validate("frame")?;
        }
        if self.events.len() > MAX_GESTURE_EVENTS {
            return Err(bad(format!(
                "`events` has {} events, at most {MAX_GESTURE_EVENTS}",
                self.events.len()
            )));
        }
        self.events.iter().try_for_each(DrawingPointer::validate)?;
        if !self.inputs.is_empty() && !matches!(self.tool, DrawingTool::Engine { .. }) {
            return Err(bad("`inputs` are only for an engine tool".into()));
        }
        if self.inputs.len() > MAX_DRAWING_INPUTS {
            return Err(bad(format!(
                "`inputs` has {} inputs, at most {MAX_DRAWING_INPUTS}",
                self.inputs.len()
            )));
        }
        self.inputs.iter().try_for_each(DrawingInput::validate)
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
    /// I segni di uno strumento del motore, in coordinate di scena, nell'ordine
    /// in cui si disegnano. Può mancare (vale vuoto).
    #[serde(default)]
    pub overlays: Vec<DrawingOverlay>,
}

/// Il ruolo di un segno: il client lo colora con i suoi token. Viene dal
/// colore che il motore gli dà; un colore che il ponte non conosce è
/// `preview`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingOverlayRole {
    /// La selezione e i suoi punti (il colore del livello).
    Selection,
    /// Le guide magnetiche e le guide del righello.
    Guide,
    /// Ciò che il gesto sta disegnando.
    Preview,
    /// Le misure e le distanze.
    Measure,
    /// La griglia prospettica.
    Perspective,
}

/// Un punto `[x, y]` in coordinate di scena.
pub type DrawingPoint = [f64; 2];

/// Un segno di uno strumento del motore: uno per ognuno dei dodici tipi di
/// `Overlay` del motore. Le misure (`width`, `size`) sono pixel dello schermo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DrawingOverlay {
    /// Il riquadro di selezione `[x, y, larghezza, altezza]`.
    Marquee { rect: [f64; 4] },
    /// Un tracciato (l'elastico della penna): `d` come in SVG.
    Path {
        d: String,
        role: DrawingOverlayRole,
        width: f64,
        dashed: bool,
    },
    /// Un segmento (una guida, la linea di una maniglia).
    Line {
        a: DrawingPoint,
        b: DrawingPoint,
        role: DrawingOverlayRole,
        dashed: bool,
    },
    /// Un punto d'ancoraggio quadrato; pieno se è scelto.
    Anchor {
        at: DrawingPoint,
        role: DrawingOverlayRole,
        filled: bool,
        size: f64,
    },
    /// Un punto dello strumento Curvatura, tondo; pieno se è l'ultimo toccato.
    CurvePoint {
        at: DrawingPoint,
        role: DrawingOverlayRole,
        filled: bool,
        size: f64,
    },
    /// La punta di una maniglia.
    Handle {
        at: DrawingPoint,
        role: DrawingOverlayRole,
    },
    /// Un'etichetta delle guide (il testo del motore, da passare per il
    /// glossario).
    Label {
        at: DrawingPoint,
        text: String,
        role: DrawingOverlayRole,
    },
    /// La misura vicino al puntatore.
    Measure { at: DrawingPoint, text: String },
    /// Una distanza da `a` a `b`, con la sua misura in mezzo.
    Distance {
        a: DrawingPoint,
        b: DrawingPoint,
        text: String,
        role: DrawingOverlayRole,
    },
    /// Un quadrilatero trasparente (il testo scelto).
    Highlight {
        quad: [DrawingPoint; 4],
        role: DrawingOverlayRole,
    },
    /// Un campione di colore di misura fissa (una tappa di una sfumatura):
    /// `color` è il colore vero, `#rrggbbaa`; cerchiato se è scelto.
    Swatch {
        at: DrawingPoint,
        color: String,
        selected: bool,
    },
    /// Una linea sottile della griglia prospettica.
    GridLine {
        a: DrawingPoint,
        b: DrawingPoint,
        role: DrawingOverlayRole,
    },
}

impl DrawingOverlay {
    pub fn validate(&self) -> Result<(), PluginError> {
        let punto = |p: &DrawingPoint| p.iter().try_for_each(|v| finite("preview.overlays", *v));
        let testo = |t: &str| {
            if t.len() > MAX_DRAWING_OVERLAY_TEXT_BYTES {
                Err(bad(format!(
                    "`preview.overlays.text` has {} bytes, at most {MAX_DRAWING_OVERLAY_TEXT_BYTES}",
                    t.len()
                )))
            } else {
                Ok(())
            }
        };
        let misura = |v: f64| {
            if v.is_finite() && v >= 0.0 {
                Ok(())
            } else {
                Err(bad(
                    "`preview.overlays` has a size that is not a finite number, 0 or more".into(),
                ))
            }
        };
        match self {
            DrawingOverlay::Marquee { rect } => {
                rect.iter()
                    .try_for_each(|v| finite("preview.overlays.rect", *v))?;
                if rect[2] < 0.0 || rect[3] < 0.0 {
                    return Err(bad("`preview.overlays.rect` has a negative size".into()));
                }
                Ok(())
            }
            DrawingOverlay::Path { d, width, .. } => {
                if d.len() > MAX_DRAWING_OVERLAY_PATH_BYTES {
                    return Err(bad(format!(
                        "`preview.overlays.d` has {} bytes, at most {MAX_DRAWING_OVERLAY_PATH_BYTES}",
                        d.len()
                    )));
                }
                misura(*width)
            }
            DrawingOverlay::Line { a, b, .. } | DrawingOverlay::GridLine { a, b, .. } => {
                punto(a)?;
                punto(b)
            }
            DrawingOverlay::Anchor { at, size, .. }
            | DrawingOverlay::CurvePoint { at, size, .. } => {
                punto(at)?;
                misura(*size)
            }
            DrawingOverlay::Handle { at, .. } => punto(at),
            DrawingOverlay::Label { at, text, .. } | DrawingOverlay::Measure { at, text } => {
                punto(at)?;
                testo(text)
            }
            DrawingOverlay::Distance { a, b, text, .. } => {
                punto(a)?;
                punto(b)?;
                testo(text)
            }
            DrawingOverlay::Highlight { quad, .. } => quad.iter().try_for_each(punto),
            DrawingOverlay::Swatch { at, color: c, .. } => {
                punto(at)?;
                color("preview.overlays.color", c)
            }
        }
    }
}

impl DrawingPreview {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.overlays.len() > MAX_DRAWING_OVERLAYS {
            return Err(bad(format!(
                "`preview.overlays` has {} overlays, at most {MAX_DRAWING_OVERLAYS}",
                self.overlays.len()
            )));
        }
        self.overlays
            .iter()
            .try_for_each(DrawingOverlay::validate)?;
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
    /// La cornice che il client tiene per la selezione dopo, com'è
    /// diventata (la forma di [`DrawingGesture::frame`]): solo per più
    /// oggetti che il gesto ha girato, ridimensionato o spostato nella loro
    /// cornice. `None`: il client non ne tiene nessuna.
    #[serde(default)]
    pub frame: Option<DrawingFrame>,
    /// Com'è lo strumento del motore dopo il gesto (o dopo
    /// `disegno.strumento.opzione`); `None` per gli strumenti di K5 e per i
    /// comandi. Può mancare (vale `None`).
    #[serde(default)]
    pub state: Option<DrawingToolState>,
    /// La lettura di un comando che legge e non cambia niente, per i
    /// pannelli; `None` per gli altri. Può mancare (vale `None`).
    #[serde(default)]
    pub reading: Option<Value>,
}

/// Lo stato dello strumento del motore che il client guarda fra un gesto e
/// l'altro.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawingToolState {
    /// Un'interazione è in corso (un trascinamento, un tracciato aperto).
    pub busy: bool,
    /// Lo strumento sta trasformando la selezione.
    pub transforming: bool,
    /// Lo strumento vuole il testo: le scorciatoie a un tasto non partono.
    pub wants_text: bool,
    /// Un IME sta componendo: tasti, scorciatoie e annulla aspettano.
    pub composing: bool,
    /// Il puntatore, in `snake_case` (`arrow`, `pen_close`, `rotate_toward_3`):
    /// il client lo traduce in un cursore CSS, e uno che non conosce è la
    /// freccia.
    pub cursor: String,
    /// Le opzioni dello strumento (`Tool::options()`), `null` se non ne ha.
    pub options: Value,
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
        if let Some(frame) = &self.frame {
            frame.validate("frame")?;
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
    /// La memoria del motore non ha spazio per una famiglia o per il comando.
    NoMemory,
    /// Il comando non sa dare un'anteprima (`preview: true`).
    NoPreview,
    /// Lo strumento del motore non c'è nel suo catalogo.
    UnknownTool,
}

/// Perché un comando è spento sulla selezione di adesso: il client lo dice
/// con i suoi testi.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingDisabledReason {
    /// Non c'è niente di scelto.
    NoSelection,
    /// Serve un tracciato.
    NeedsPath,
    /// Serve un testo.
    NeedsText,
    /// Serve un gruppo.
    NeedsGroup,
    /// Servono almeno due oggetti.
    NeedsTwo,
    /// Il disegno, o ciò che è scelto, non si può modificare.
    ReadOnly,
    /// Ciò che è scelto è una parte che il motore non sa modificare.
    Unmapped,
    /// Un altro perché, con il testo del motore passato per il glossario:
    /// `{"other": {"text": "…"}}`.
    Other { text: String },
}

// ---------------------------------------------------------------------------
// I comandi
// ---------------------------------------------------------------------------

/// Un comando del disegno, acceso o spento sulla selezione.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawingCommandInfo {
    pub id: String,
    pub enabled: bool,
    /// Perché è spento; `None` se è acceso. Può mancare (vale `None`).
    #[serde(default)]
    pub disabled_reason: Option<DrawingDisabledReason>,
}

/// Un comando dato sulla selezione.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawingCommandRequest {
    #[serde(with = "crate::ipc::u64_string")]
    pub revision: u64,
    pub id: String,
    pub selection: Vec<String>,
    pub value: Value,
    /// L'anteprima: il comando gira su una copia e rende le operazioni
    /// senza che il client le applichi né le metta nella cronologia; un
    /// comando che non ne sa dare risponde `no_preview`. Può mancare (vale
    /// `false`).
    #[serde(default)]
    pub preview: bool,
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
            DRAWING_COMMAND_TOOL_OPTION => {
                let campi = self.value.as_object().ok_or_else(|| {
                    bad("`value` must be an object with `strumento`, `chiave` and `valore`".into())
                })?;
                if let Some(altro) = campi
                    .keys()
                    .find(|k| !matches!(k.as_str(), "strumento" | "chiave" | "valore"))
                {
                    return Err(bad(format!("`value.{altro}` is not a field of the option")));
                }
                let strumento = campi
                    .get("strumento")
                    .and_then(Value::as_str)
                    .ok_or_else(|| bad("`value.strumento` must be a tool id".into()))?;
                DrawingTool::Engine {
                    id: strumento.to_string(),
                }
                .validate()
                .map_err(|_| {
                    bad(format!(
                        "`value.strumento` must have 1 to {MAX_DRAWING_TOOL_ID_BYTES} bytes of ASCII letters, digits, `_` or `-`"
                    ))
                })?;
                match campi.get("chiave").and_then(Value::as_str) {
                    Some(k) if !k.is_empty() && k.len() <= MAX_DRAWING_OPTION_KEY_BYTES => {}
                    _ => {
                        return Err(bad(format!(
                            "`value.chiave` must be a string of 1 to {MAX_DRAWING_OPTION_KEY_BYTES} bytes"
                        )))
                    }
                }
                if !campi.contains_key("valore") {
                    return Err(bad("`value.valore` is missing".into()));
                }
                Ok(())
            }
            DRAWING_COMMAND_FAMILY_PREPARE => {
                let campi = self
                    .value
                    .as_object()
                    .ok_or_else(|| bad("`value` must be an object with `famiglia`".into()))?;
                if let Some(altro) = campi.keys().find(|k| k.as_str() != "famiglia") {
                    return Err(bad(format!(
                        "`value.{altro}` is not a field of the request"
                    )));
                }
                match campi.get("famiglia").and_then(Value::as_str) {
                    Some(f) if DRAWING_FAMILIES.contains(&f) => Ok(()),
                    _ => Err(bad(format!(
                        "`value.famiglia` must be one of the {} families of the engine map",
                        DRAWING_FAMILIES.len()
                    ))),
                }
            }
            _ => Ok(()),
        }
    }
}
