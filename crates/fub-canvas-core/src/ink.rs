//! L'inchiostro della lavagna: i livelli `fub:ink` di una `.canvas`, letti e
//! controllati come li legge la shell.
//!
//! Le regole sono quelle di `docs/reference/canvas-ink.md` e dei vettori di
//! `apps/client/src/__fixtures__/canvas-ink/` (`tests/ink_vectors.rs`). Sono
//! le sole regole dell'inchiostro: la shell non ne ha una copia, e chiede i
//! livelli a questo modulo per `.wasm` (`ink_layers` di `fub-canvas-wasm`,
//! che fa girare gli stessi vettori).
//!
//! - **Il livello** ([`InkLayer`]) è l'oggetto sotto la chiave [`INK_KEY`] di
//!   una scheda, di qualunque tipo, o della radice. Nel modello sta nei campi
//!   sconosciuti (`extra`) di chi lo tiene: la lettura non lo toglie da lì, e
//!   un livello che Fub non capisce ([`LayerState::Foreign`]) resta il valore
//!   JSON che era. Un `fub:ink` su un arco, o dentro un tratto, è un campo
//!   sconosciuto come gli altri.
//! - **Il tratto** ([`InkStroke`]) tiene i campi noti come valori JSON, così
//!   un tratto che non si disegna si conserva com'era, e i campi sconosciuti
//!   in `extra`, come il resto del modello. Lo stato ([`StrokeState`]) dice se
//!   si disegna ([`DrawnStroke`], già decodificato) o perché no
//!   ([`SkipReason`], la prima nell'ordine `tool`, `anchor`, `color`, `brush`,
//!   `ink`).
//! - **I limiti** sono quelli della §5 del formato della scena, del codec
//!   `fub-ink-codec`: [`INK_MAX_SAMPLES`] campioni e [`INK_MAX_BYTES`] della
//!   stringa `ink`, controllati prima di decodificarla.
//!
//! Il giro non perde niente: [`InkLayer::to_value`] di un livello letto dà un
//! valore uguale a quello del file, i numeri come erano scritti (`1.0` resta
//! un decimale) e i campi sconosciuti nel loro ordine. Dato a
//! `source::patch_source`, il sorgente non cambia di un byte.

use std::collections::HashSet;
use std::fmt;

use fub_ink_codec::brush::InkBrush;
use fub_ink_codec::ink::Ink;
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Number, Value};
use thiserror::Error;

use crate::model::{Canvas, CanvasNode};

pub use fub_ink_codec::ink::{INK_MAX_BYTES, INK_MAX_SAMPLES};

/// La chiave del livello, su una scheda o sulla radice.
pub const INK_KEY: &str = "fub:ink";

/// La versione del livello che Fub legge e scrive.
pub const INK_LAYER_VERSION: u64 = 1;

/// I campi noti di un tratto, nell'ordine in cui si scrivono.
const STROKE_FIELDS: [&str; 7] = ["id", "tool", "at", "brush", "color", "anchor", "ink"];

/// Dove sta un livello: sulla radice (`"board"`) o su una scheda
/// (`{"node": id}`). È la forma dei vettori e del lettore TypeScript.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum LayerRef {
    /// Il livello della radice: i tratti liberi.
    Board,
    /// Il livello della scheda con questo id.
    Node(String),
}

impl LayerRef {
    /// Il nome della radice nella forma serde.
    const BOARD: &'static str = "board";
}

impl Serialize for LayerRef {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        match self {
            LayerRef::Board => serializer.serialize_str(Self::BOARD),
            LayerRef::Node(id) => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("node", id)?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for LayerRef {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(LayerRefVisitor)
    }
}

struct LayerRefVisitor;

impl<'de> Visitor<'de> for LayerRefVisitor {
    type Value = LayerRef;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("\"board\" or {\"node\": id}")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<LayerRef, E> {
        if value == LayerRef::BOARD {
            Ok(LayerRef::Board)
        } else {
            Err(E::invalid_value(de::Unexpected::Str(value), &self))
        }
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<LayerRef, A::Error> {
        let mut node: Option<String> = None;
        while let Some(key) = map.next_key::<String>()? {
            if key != "node" {
                return Err(de::Error::unknown_field(&key, &["node"]));
            }
            if node.replace(map.next_value()?).is_some() {
                return Err(de::Error::duplicate_field("node"));
            }
        }
        node.map(LayerRef::Node)
            .ok_or_else(|| de::Error::missing_field("node"))
    }
}

/// Perché un livello è estraneo: si conserva byte per byte, non si disegna e
/// Fub non ci scrive.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Error)]
pub enum ForeignLayer {
    /// `fub:ink` non è un oggetto.
    #[error("the ink layer is not an object")]
    NotObject,
    /// `v` manca o non vale 1.
    #[error("the ink layer version is not 1")]
    Version,
    /// `strokes` manca o non è un array.
    #[error("the ink layer has no strokes array")]
    Strokes,
    /// Un elemento di `strokes` non è un oggetto.
    #[error("an ink stroke is not an object")]
    Stroke,
    /// Un tratto non ha un `id` stringa non vuota.
    #[error("an ink stroke has no non-empty string id")]
    StrokeId,
    /// Due tratti hanno lo stesso `id`.
    #[error("two ink strokes have the same id")]
    DuplicateId,
}

/// Un livello valido: la versione 1, i tratti nell'ordine in cui si
/// disegnano (l'ultimo sta sopra) e i campi sconosciuti.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "Value", into = "Value")]
pub struct InkLayer {
    /// `v` com'è scritto nel file: vale 1, anche scritto `1.0`.
    v: Number,
    pub strokes: Vec<InkStroke>,
    pub extra: Map<String, Value>,
}

impl Default for InkLayer {
    /// Il livello vuoto `{"v": 1, "strokes": []}`.
    fn default() -> Self {
        InkLayer {
            v: Number::from(INK_LAYER_VERSION),
            strokes: Vec::new(),
            extra: Map::new(),
        }
    }
}

impl InkLayer {
    /// Legge un livello dal valore della chiave [`INK_KEY`]; l'errore dice
    /// perché è estraneo.
    pub fn from_value(value: &Value) -> Result<InkLayer, ForeignLayer> {
        let Value::Object(fields) = value else {
            return Err(ForeignLayer::NotObject);
        };
        let v = match fields.get("v") {
            Some(Value::Number(v)) if is_version(v) => v.clone(),
            _ => return Err(ForeignLayer::Version),
        };
        let Some(Value::Array(items)) = fields.get("strokes") else {
            return Err(ForeignLayer::Strokes);
        };
        let mut ids = HashSet::with_capacity(items.len());
        let mut strokes = Vec::with_capacity(items.len());
        for item in items {
            let stroke = InkStroke::from_value(item)?;
            if !ids.insert(stroke.id.clone()) {
                return Err(ForeignLayer::DuplicateId);
            }
            strokes.push(stroke);
        }
        let extra = fields
            .iter()
            .filter(|(key, _)| !matches!(key.as_str(), "v" | "strokes"))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        Ok(InkLayer { v, strokes, extra })
    }

    /// Il livello come valore JSON: `v`, `strokes`, poi i campi sconosciuti
    /// nel loro ordine.
    pub fn to_value(&self) -> Value {
        let mut map = Map::with_capacity(2 + self.extra.len());
        map.insert("v".to_owned(), Value::Number(self.v.clone()));
        map.insert(
            "strokes".to_owned(),
            Value::Array(self.strokes.iter().map(InkStroke::to_value).collect()),
        );
        for (key, value) in &self.extra {
            if !matches!(key.as_str(), "v" | "strokes") {
                map.insert(key.clone(), value.clone());
            }
        }
        Value::Object(map)
    }

    /// `v` com'è scritto nel file.
    pub fn version(&self) -> &Number {
        &self.v
    }

    /// Il livello è esattamente `{"v": 1, "strokes": []}`: togliere l'ultimo
    /// tratto fa sparire la chiave.
    pub fn is_bare(&self) -> bool {
        self.strokes.is_empty() && self.extra.is_empty()
    }
}

impl TryFrom<Value> for InkLayer {
    type Error = ForeignLayer;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        InkLayer::from_value(&value)
    }
}

impl From<InkLayer> for Value {
    fn from(layer: InkLayer) -> Value {
        layer.to_value()
    }
}

/// `v` vale 1 per valore: `1`, `1.0` e `1e0` sì, `"1"` o `true` no.
fn is_version(v: &Number) -> bool {
    match (v.as_u64(), v.as_f64()) {
        (Some(integer), _) => integer == INK_LAYER_VERSION,
        (None, Some(float)) => float == 1.0,
        (None, None) => false,
    }
}

/// Un tratto: l'`id` (stringa non vuota, unica nel livello), i campi noti
/// come sono nel file (`None` se mancano, un `null` scritto resta) e quelli
/// sconosciuti nel loro ordine. Un campo noto non valido si conserva: lo
/// stato del tratto ([`InkStroke::state`]) dice soltanto che non si disegna.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "Value", into = "Value")]
pub struct InkStroke {
    pub id: String,
    pub tool: Option<Value>,
    pub at: Option<Value>,
    pub brush: Option<Value>,
    pub color: Option<Value>,
    pub anchor: Option<Value>,
    pub ink: Option<Value>,
    pub extra: Map<String, Value>,
}

impl InkStroke {
    /// Legge un tratto: un oggetto con un `id` stringa non vuota.
    pub fn from_value(value: &Value) -> Result<InkStroke, ForeignLayer> {
        let Value::Object(fields) = value else {
            return Err(ForeignLayer::Stroke);
        };
        let id = match fields.get("id") {
            Some(Value::String(id)) if !id.is_empty() => id.clone(),
            _ => return Err(ForeignLayer::StrokeId),
        };
        let field = |key: &str| fields.get(key).cloned();
        let extra = fields
            .iter()
            .filter(|(key, _)| !STROKE_FIELDS.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        Ok(InkStroke {
            id,
            tool: field("tool"),
            at: field("at"),
            brush: field("brush"),
            color: field("color"),
            anchor: field("anchor"),
            ink: field("ink"),
            extra,
        })
    }

    /// Il tratto come valore JSON, nell'ordine di scrittura: `id`, `tool`,
    /// `at`, `brush`, `color`, `anchor`, `ink` (gli assenti non ci sono), poi
    /// i campi sconosciuti nel loro ordine.
    pub fn to_value(&self) -> Value {
        let mut map = Map::with_capacity(STROKE_FIELDS.len() + self.extra.len());
        map.insert("id".to_owned(), Value::String(self.id.clone()));
        let known = [
            ("tool", &self.tool),
            ("at", &self.at),
            ("brush", &self.brush),
            ("color", &self.color),
            ("anchor", &self.anchor),
            ("ink", &self.ink),
        ];
        for (key, value) in known {
            if let Some(value) = value {
                map.insert(key.to_owned(), value.clone());
            }
        }
        for (key, value) in &self.extra {
            if !STROKE_FIELDS.contains(&key.as_str()) {
                map.insert(key.clone(), value.clone());
            }
        }
        Value::Object(map)
    }

    /// Se il tratto si disegna nel livello `layer`, o perché no: la prima
    /// ragione nell'ordine `tool`, `anchor`, `color`, `brush`, `ink`.
    pub fn state(&self, layer: &LayerRef) -> StrokeState {
        match self.drawn(layer) {
            Ok(drawn) => StrokeState::Drawn(Box::new(drawn)),
            Err(reason) => StrokeState::Kept(reason),
        }
    }

    fn drawn(&self, layer: &LayerRef) -> Result<DrawnStroke, SkipReason> {
        let tool = read_tool(self.tool.as_ref()).ok_or(SkipReason::Tool)?;
        let anchor = read_anchor(self.anchor.as_ref(), layer).ok_or(SkipReason::Anchor)?;
        let color = read_color(self.color.as_ref()).ok_or(SkipReason::Color)?;
        let brush = read_brush(self.brush.as_ref()).ok_or(SkipReason::Brush)?;
        let ink = read_ink(self.ink.as_ref()).ok_or(SkipReason::Ink)?;
        Ok(DrawnStroke {
            tool,
            anchor,
            color: color.to_owned(),
            brush,
            ink,
        })
    }
}

impl TryFrom<Value> for InkStroke {
    type Error = ForeignLayer;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        InkStroke::from_value(&value)
    }
}

impl From<InkStroke> for Value {
    fn from(stroke: InkStroke) -> Value {
        stroke.to_value()
    }
}

/// Lo strumento di un tratto.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum InkTool {
    Pen,
    Highlighter,
}

impl InkTool {
    /// La parola del file.
    pub fn as_str(self) -> &'static str {
        match self {
            InkTool::Pen => "pen",
            InkTool::Highlighter => "highlighter",
        }
    }
}

/// L'ancora di un tratto che si disegna: in quali unità sono i punti.
#[derive(Clone, Debug, PartialEq)]
pub enum InkAnchor {
    /// Unità della scheda alla misura `width × height` di quando il tratto si
    /// è scritto, origine in alto a sinistra. Solo nel livello di una scheda.
    Card { width: f64, height: f64 },
    /// Coordinate della lavagna. Solo nel livello della radice.
    Free,
    /// Punti PDF (1/72 di pollice) dall'angolo in alto a sinistra della
    /// pagina `page` (da 1) di una scheda PDF, come si vede, con la sua
    /// rotazione; `width × height` è la misura della pagina, in punti, quando
    /// il tratto si è scritto. Solo nel livello di una scheda: dove la pagina
    /// sta dentro la scheda lo sa la resa, non il nucleo.
    Page { page: u64, width: f64, height: f64 },
    /// Pixel del foglio al 100% dall'angolo in alto a sinistra della cella
    /// `cell` del foglio `sheet` (il nome com'è nel file) di una scheda di
    /// foglio. L'ancora segue l'indirizzo, non il contenuto: se un altro
    /// programma inserisce una riga sopra, il tratto va sulla cella che ora
    /// ha quel nome. Solo nel livello di una scheda: dove la cella sta dentro
    /// la scheda lo sa la resa, non il nucleo.
    Cell { sheet: String, cell: CellAddress },
}

/// L'indirizzo di una cella in notazione A1, come lo scrive l'ancora `cell`:
/// la colonna da `A` a `XFD` (da 1 a 16384), poi la riga da 1 a 1048576.
/// Solo maiuscole, senza `$` e senza zeri davanti, così un indirizzo si
/// scrive in un modo solo e il giro non cambia il file.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct CellAddress {
    /// La colonna, da 1 (`A`) a [`CellAddress::MAX_COLUMN`] (`XFD`).
    pub column: u32,
    /// La riga, da 1 a [`CellAddress::MAX_ROW`].
    pub row: u32,
}

impl CellAddress {
    /// L'ultima colonna, `XFD`.
    pub const MAX_COLUMN: u32 = 16_384;
    /// L'ultima riga.
    pub const MAX_ROW: u32 = 1_048_576;

    /// L'indirizzo `text` in notazione A1; `None` se non lo è (`A0`, `B`,
    /// `b3`, `$B$3`, `B03`, `XFE1`, `A1048577`).
    pub fn parse(text: &str) -> Option<CellAddress> {
        let letters = text.bytes().take_while(u8::is_ascii_uppercase).count();
        let (columns, digits) = text.split_at(letters);
        if !(1..=3).contains(&letters)
            || !(1..=7).contains(&digits.len())
            || digits.starts_with('0')
            || !digits.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        let column = columns
            .bytes()
            .fold(0_u32, |acc, b| acc * 26 + u32::from(b - b'A') + 1);
        let row: u32 = digits.parse().ok()?;
        (column <= Self::MAX_COLUMN && row <= Self::MAX_ROW)
            .then_some(CellAddress { column, row })
    }
}

/// L'indirizzo come si scrive: `B3`, `XFD1048576`.
impl fmt::Display for CellAddress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut letters = Vec::with_capacity(3);
        let mut column = self.column;
        while column > 0 {
            column -= 1;
            // `column % 26` sta fra 0 e 25: il cast è esatto.
            #[allow(clippy::cast_possible_truncation)]
            letters.push(char::from(b'A' + (column % 26) as u8));
            column /= 26;
        }
        let name: String = letters.iter().rev().collect();
        write!(f, "{name}{}", self.row)
    }
}

impl InkAnchor {
    /// L'ancora `card` della misura di adesso di `node`.
    pub fn card_of(node: &CanvasNode) -> InkAnchor {
        // Le misure di una scheda sono interi entro ±(2^53−1): il cast è
        // esatto.
        #[allow(clippy::cast_precision_loss)]
        let (width, height) = (node.width as f64, node.height as f64);
        InkAnchor::Card { width, height }
    }

    /// L'ancora come si scrive: `kind`, poi `page` per l'ancora di pagina,
    /// poi `width` e `height` (interi quando lo sono); per l'ancora di cella
    /// `kind`, `sheet` e `cell`.
    pub fn to_value(&self) -> Value {
        let mut map = Map::new();
        match *self {
            InkAnchor::Card { width, height } => {
                map.insert("kind".to_owned(), Value::from("card"));
                map.insert("width".to_owned(), measure_value(width));
                map.insert("height".to_owned(), measure_value(height));
            }
            InkAnchor::Free => {
                map.insert("kind".to_owned(), Value::from("free"));
            }
            InkAnchor::Page {
                page,
                width,
                height,
            } => {
                map.insert("kind".to_owned(), Value::from("page"));
                map.insert("page".to_owned(), Value::from(page));
                map.insert("width".to_owned(), measure_value(width));
                map.insert("height".to_owned(), measure_value(height));
            }
            InkAnchor::Cell {
                ref sheet,
                ref cell,
            } => {
                map.insert("kind".to_owned(), Value::from("cell"));
                map.insert("sheet".to_owned(), Value::from(sheet.as_str()));
                map.insert("cell".to_owned(), Value::from(cell.to_string()));
            }
        }
        Value::Object(map)
    }
}

/// Una misura come numero JSON: un intero se lo è, come la scriverebbe
/// JavaScript.
fn measure_value(measure: f64) -> Value {
    #[allow(clippy::cast_precision_loss)]
    let bound = crate::model::MAX_SAFE_INTEGER as f64;
    if measure.fract() == 0.0 && measure.abs() <= bound {
        // Entro ±(2^53−1) e senza parte frazionaria: il cast è esatto.
        #[allow(clippy::cast_possible_truncation)]
        let integer = measure as i64;
        Value::from(integer)
    } else {
        Number::from_f64(measure).map_or(Value::Null, Value::Number)
    }
}

/// Perché un tratto di un livello valido non si disegna. Si conserva, e la
/// gomma non lo vede.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum SkipReason {
    /// `tool` manca o non è `"pen"` né `"highlighter"`.
    Tool,
    /// `anchor` manca, non è un oggetto, ha un `kind` sconosciuto o fuori
    /// posto, una misura che manca o non è un numero maggiore di zero,
    /// (l'ancora `page`) una pagina che non è un intero da 1 in su, o
    /// (l'ancora `cell`) un foglio che non è un testo non vuoto o una cella
    /// che non è un indirizzo A1 valido.
    Anchor,
    /// `color` manca o non è `#rrggbb`.
    Color,
    /// `brush` manca o non è un pennello valido della §5.
    Brush,
    /// `ink` manca, non rispetta la grammatica o i limiti della §5, o ha un
    /// canale sconosciuto.
    Ink,
}

impl SkipReason {
    /// La parola dei vettori.
    pub fn as_str(self) -> &'static str {
        match self {
            SkipReason::Tool => "tool",
            SkipReason::Anchor => "anchor",
            SkipReason::Color => "color",
            SkipReason::Brush => "brush",
            SkipReason::Ink => "ink",
        }
    }
}

/// Un tratto che si disegna, già decodificato.
#[derive(Clone, Debug, PartialEq)]
pub struct DrawnStroke {
    pub tool: InkTool,
    pub anchor: InkAnchor,
    /// Il colore `#rrggbb` com'è scritto, maiuscole comprese.
    pub color: String,
    pub brush: InkBrush,
    /// I campioni, nelle unità dell'ancora moltiplicate per la scala.
    pub ink: Ink,
}

/// Lo stato di un tratto di un livello valido.
#[derive(Clone, Debug, PartialEq)]
pub enum StrokeState {
    /// Si disegna.
    Drawn(Box<DrawnStroke>),
    /// Si conserva e non si disegna, per questa ragione.
    Kept(SkipReason),
}

impl StrokeState {
    pub fn is_drawn(&self) -> bool {
        matches!(self, StrokeState::Drawn(_))
    }
}

/// Lo stato di un livello.
#[derive(Clone, Debug, PartialEq)]
pub enum LayerState {
    /// Un livello valido, con lo stato di ogni tratto nell'ordine di
    /// `layer.strokes`.
    Ok {
        layer: InkLayer,
        strokes: Vec<StrokeState>,
    },
    /// Un livello estraneo: il suo valore resta nel modello com'era, e non
    /// elenca tratti.
    Foreign(ForeignLayer),
}

/// Un livello letto: dove sta e il suo stato.
#[derive(Clone, Debug, PartialEq)]
pub struct LayerRead {
    pub layer: LayerRef,
    pub state: LayerState,
}

impl LayerRead {
    fn new(layer: LayerRef, value: &Value) -> LayerRead {
        let state = match InkLayer::from_value(value) {
            Ok(ink) => {
                let strokes = ink.strokes.iter().map(|s| s.state(&layer)).collect();
                LayerState::Ok {
                    layer: ink,
                    strokes,
                }
            }
            Err(reason) => LayerState::Foreign(reason),
        };
        LayerRead { layer, state }
    }

    pub fn is_foreign(&self) -> bool {
        matches!(self.state, LayerState::Foreign(_))
    }
}

/// I livelli d'inchiostro di `canvas`: quelli delle schede nell'ordine di
/// `nodes`, poi quello della radice. Una scheda o una radice senza la chiave
/// non compare; gli archi non hanno livelli.
pub fn read_layers(canvas: &Canvas) -> Vec<LayerRead> {
    let cards = canvas.nodes.iter().filter_map(|node| {
        node.extra
            .get(INK_KEY)
            .map(|value| LayerRead::new(LayerRef::Node(node.id.clone()), value))
    });
    let board = canvas
        .extra
        .get(INK_KEY)
        .map(|value| LayerRead::new(LayerRef::Board, value));
    cards.chain(board).collect()
}

/// Il livello `at` di `canvas`; `None` se chi lo tiene non c'è o non ha la
/// chiave.
pub fn layer(canvas: &Canvas, at: &LayerRef) -> Option<LayerRead> {
    let value = match at {
        LayerRef::Board => canvas.extra.get(INK_KEY)?,
        LayerRef::Node(id) => canvas
            .nodes
            .iter()
            .find(|node| node.id == *id)?
            .extra
            .get(INK_KEY)?,
    };
    Some(LayerRead::new(at.clone(), value))
}

fn read_tool(value: Option<&Value>) -> Option<InkTool> {
    match value?.as_str()? {
        "pen" => Some(InkTool::Pen),
        "highlighter" => Some(InkTool::Highlighter),
        _ => None,
    }
}

/// L'ancora nel livello `layer`: `card`, `page` e `cell` solo su una scheda,
/// `free` solo sulla radice. I campi sconosciuti dell'ancora non contano.
fn read_anchor(value: Option<&Value>, layer: &LayerRef) -> Option<InkAnchor> {
    let anchor = value?.as_object()?;
    match (anchor.get("kind")?.as_str()?, layer) {
        ("card", LayerRef::Node(_)) => Some(InkAnchor::Card {
            width: positive(anchor.get("width"))?,
            height: positive(anchor.get("height"))?,
        }),
        ("free", LayerRef::Board) => Some(InkAnchor::Free),
        ("page", LayerRef::Node(_)) => Some(InkAnchor::Page {
            page: page_number(anchor.get("page"))?,
            width: positive(anchor.get("width"))?,
            height: positive(anchor.get("height"))?,
        }),
        ("cell", LayerRef::Node(_)) => Some(InkAnchor::Cell {
            sheet: sheet_name(anchor.get("sheet"))?.to_owned(),
            cell: CellAddress::parse(anchor.get("cell")?.as_str()?)?,
        }),
        _ => None,
    }
}

/// Il nome di un foglio: un testo non vuoto, preso com'è (spazi e virgolette
/// compresi, senza gli apici che lo racchiudono nelle formule).
fn sheet_name(value: Option<&Value>) -> Option<&str> {
    value?.as_str().filter(|name| !name.is_empty())
}

/// Un numero di pagina: un intero da 1 a 2^53−1, per valore (`3`, `3.0`,
/// `3e0`), come lo legge JavaScript.
fn page_number(value: Option<&Value>) -> Option<u64> {
    let number = value?.as_f64()?;
    #[allow(clippy::cast_precision_loss)]
    let bound = crate::model::MAX_SAFE_INTEGER as f64;
    if !(number.fract() == 0.0 && (1.0..=bound).contains(&number)) {
        return None;
    }
    // Un intero fra 1 e 2^53−1: il cast è esatto.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Some(number as u64)
}

/// Un numero finito maggiore di zero, per valore: `640`, `640.0`, `6.4e2`.
fn positive(value: Option<&Value>) -> Option<f64> {
    let number = value?.as_f64()?;
    (number.is_finite() && number > 0.0).then_some(number)
}

/// `#rrggbb`, maiuscole o minuscole.
fn read_color(value: Option<&Value>) -> Option<&str> {
    let color = value?.as_str()?;
    let digits = color.strip_prefix('#')?;
    (digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_hexdigit())).then_some(color)
}

fn read_brush(value: Option<&Value>) -> Option<InkBrush> {
    InkBrush::parse(value?.as_str()?).ok()
}

/// La stringa `ink`, con i limiti della §5 controllati prima di decodificarla:
/// i byte e il numero dei campioni (le parti dopo versione, scala e canali).
/// Un canale sconosciuto non si ridisegna: la lavagna non ha un `d` già
/// calcolato da usare al suo posto.
fn read_ink(value: Option<&Value>) -> Option<Ink> {
    let text = value?.as_str()?;
    if text.len() > INK_MAX_BYTES {
        return None;
    }
    let parts = text.bytes().filter(|&b| b == b' ').count() + 1;
    if parts.saturating_sub(3) > INK_MAX_SAMPLES {
        return None;
    }
    let ink = Ink::decode(text).ok()?;
    ink.unknown_channels().is_empty().then_some(ink)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::read::parse;
    use serde_json::json;

    const BRUSH: &str = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
    const INK: &str = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";

    fn card_stroke() -> Value {
        json!({ "id": "s-1", "tool": "pen", "brush": BRUSH, "color": "#0072b2",
                "anchor": { "kind": "card", "width": 300, "height": 200 }, "ink": INK })
    }

    fn card() -> LayerRef {
        LayerRef::Node("n1".to_owned())
    }

    fn state_on_card(stroke: Value) -> StrokeState {
        InkStroke::from_value(&stroke).unwrap().state(&card())
    }

    /// Una stringa `ink` di `n` campioni `cxy`: il primo assoluto, gli altri
    /// in differenze di una unità.
    fn ink_of(n: usize) -> String {
        let mut text = String::from("1 s100 cxy 0,0");
        for _ in 1..n {
            text.push_str(" 1,1");
        }
        text
    }

    #[test]
    fn layer_ref_reads_and_writes_board_or_node() {
        assert_eq!(
            serde_json::to_value(LayerRef::Board).unwrap(),
            json!("board")
        );
        assert_eq!(
            serde_json::to_value(card()).unwrap(),
            json!({ "node": "n1" })
        );
        let board: LayerRef = serde_json::from_value(json!("board")).unwrap();
        assert_eq!(board, LayerRef::Board);
        let node: LayerRef = serde_json::from_value(json!({ "node": "n1" })).unwrap();
        assert_eq!(node, card());
        assert!(serde_json::from_value::<LayerRef>(json!("radice")).is_err());
        assert!(serde_json::from_value::<LayerRef>(json!({})).is_err());
        assert!(serde_json::from_value::<LayerRef>(json!({ "node": 1 })).is_err());
        assert!(serde_json::from_value::<LayerRef>(json!({ "node": "a", "x": 1 })).is_err());
    }

    #[test]
    fn a_valid_stroke_is_drawn_and_decoded() {
        let StrokeState::Drawn(drawn) = state_on_card(card_stroke()) else {
            panic!("il tratto si disegna");
        };
        assert_eq!(drawn.tool, InkTool::Pen);
        assert_eq!(
            drawn.anchor,
            InkAnchor::Card {
                width: 300.0,
                height: 200.0
            }
        );
        assert_eq!(drawn.color, "#0072b2");
        assert_eq!(drawn.ink.len(), 3);
    }

    #[test]
    fn measures_compare_by_value() {
        for (width, height) in [(json!(640.0), json!(6.4e2)), (json!(640), json!(420.0))] {
            let mut stroke = card_stroke();
            stroke["anchor"] = json!({ "kind": "card", "width": width, "height": height });
            assert!(state_on_card(stroke).is_drawn());
        }
        let source = r##"{"nodes":[{"id":"n1","type":"text","text":"","x":0,"y":0,"width":640,"height":420,
            "fub:ink":{"v":1,"strokes":[{"id":"s-1","tool":"pen","brush":"pf1","color":"#0072b2",
            "anchor":{"kind":"card","width":640.0,"height":4.2e2},"ink":"1 s100 cxy 0,0"}]}}]}"##;
        let layers = read_layers(&parse(source).unwrap());
        let LayerState::Ok { strokes, .. } = &layers[0].state else {
            panic!("il livello è valido");
        };
        let StrokeState::Drawn(drawn) = &strokes[0] else {
            panic!("il tratto si disegna");
        };
        assert_eq!(
            drawn.anchor,
            InkAnchor::Card {
                width: 640.0,
                height: 420.0
            }
        );
    }

    #[test]
    fn a_zero_or_negative_measure_is_an_anchor_reason() {
        for (width, height) in [(0, 200), (300, 0), (-300, 200), (300, -1)] {
            let mut stroke = card_stroke();
            stroke["anchor"] = json!({ "kind": "card", "width": width, "height": height });
            assert_eq!(state_on_card(stroke), StrokeState::Kept(SkipReason::Anchor));
        }
        let mut stroke = card_stroke();
        stroke["anchor"] = json!({ "kind": "card", "width": "300", "height": 200 });
        assert_eq!(state_on_card(stroke), StrokeState::Kept(SkipReason::Anchor));
    }

    #[test]
    fn an_anchor_out_of_place_is_an_anchor_reason() {
        let stroke = InkStroke::from_value(&card_stroke()).unwrap();
        assert_eq!(
            stroke.state(&LayerRef::Board),
            StrokeState::Kept(SkipReason::Anchor)
        );
        let mut free = card_stroke();
        free["anchor"] = json!({ "kind": "free" });
        let free = InkStroke::from_value(&free).unwrap();
        assert!(free.state(&LayerRef::Board).is_drawn());
        assert_eq!(free.state(&card()), StrokeState::Kept(SkipReason::Anchor));
    }

    #[test]
    fn an_uppercase_color_is_valid_and_written_as_it_was() {
        let mut value = card_stroke();
        value["color"] = json!("#00AAFF");
        let stroke = InkStroke::from_value(&value).unwrap();
        let StrokeState::Drawn(drawn) = stroke.state(&card()) else {
            panic!("il tratto si disegna");
        };
        assert_eq!(drawn.color, "#00AAFF");
        assert_eq!(stroke.to_value(), value);
        for color in ["#07b", "#0072b2ff", "0072b2", "#0072bg", "blue"] {
            let mut value = card_stroke();
            value["color"] = json!(color);
            assert_eq!(
                state_on_card(value),
                StrokeState::Kept(SkipReason::Color),
                "{color}"
            );
        }
    }

    #[test]
    fn an_at_that_is_not_a_date_is_drawn_and_kept() {
        for at in [json!("ieri"), json!(42), json!(null)] {
            let mut value = card_stroke();
            value["at"] = at.clone();
            let stroke = InkStroke::from_value(&value).unwrap();
            assert!(stroke.state(&card()).is_drawn());
            assert_eq!(stroke.at, Some(at));
            assert_eq!(stroke.to_value(), value);
        }
    }

    #[test]
    fn the_reason_is_the_first_in_order() {
        let stroke =
            json!({ "id": "s", "tool": "marker", "anchor": 1, "color": 2, "brush": 3, "ink": 4 });
        assert_eq!(state_on_card(stroke), StrokeState::Kept(SkipReason::Tool));
        let stroke = json!({ "id": "s", "tool": "pen" });
        assert_eq!(state_on_card(stroke), StrokeState::Kept(SkipReason::Anchor));
        let mut stroke = card_stroke();
        stroke["brush"] = json!("pf2");
        stroke["ink"] = json!("");
        assert_eq!(state_on_card(stroke), StrokeState::Kept(SkipReason::Brush));
        let mut stroke = card_stroke();
        stroke["ink"] = json!("1 s100 cxyq 0,0,0");
        assert_eq!(state_on_card(stroke), StrokeState::Kept(SkipReason::Ink));
    }

    #[test]
    fn ten_thousand_samples_draw_and_one_more_does_not() {
        let mut stroke = card_stroke();
        stroke["ink"] = json!(ink_of(INK_MAX_SAMPLES));
        assert!(state_on_card(stroke).is_drawn());
        let mut stroke = card_stroke();
        stroke["ink"] = json!(ink_of(10_001));
        assert_eq!(state_on_card(stroke), StrokeState::Kept(SkipReason::Ink));
    }

    #[test]
    fn an_ink_string_over_512_kib_is_an_ink_reason() {
        // Pochi campioni, ma uno lungo: è il limite dei byte che vale.
        let mut text = String::from("1 s100 cxy 0,");
        text.push_str(&"0".repeat(INK_MAX_BYTES + 1 - text.len()));
        assert_eq!(text.len(), INK_MAX_BYTES + 1);
        let mut stroke = card_stroke();
        stroke["ink"] = json!(text);
        assert_eq!(state_on_card(stroke), StrokeState::Kept(SkipReason::Ink));
        assert_eq!(read_ink(Some(&json!(text))), None);
    }

    #[test]
    fn foreign_layers_say_why() {
        let cases = [
            (json!([]), ForeignLayer::NotObject),
            (json!("x"), ForeignLayer::NotObject),
            (json!({ "strokes": [] }), ForeignLayer::Version),
            (json!({ "v": 2, "strokes": [] }), ForeignLayer::Version),
            (json!({ "v": "1", "strokes": [] }), ForeignLayer::Version),
            (json!({ "v": true, "strokes": [] }), ForeignLayer::Version),
            (json!({ "v": 1 }), ForeignLayer::Strokes),
            (json!({ "v": 1, "strokes": {} }), ForeignLayer::Strokes),
            (json!({ "v": 1, "strokes": [1] }), ForeignLayer::Stroke),
            (
                json!({ "v": 1, "strokes": [{ "id": "" }] }),
                ForeignLayer::StrokeId,
            ),
            (
                json!({ "v": 1, "strokes": [{ "id": 3 }] }),
                ForeignLayer::StrokeId,
            ),
            (json!({ "v": 1, "strokes": [{}] }), ForeignLayer::StrokeId),
            (
                json!({ "v": 1, "strokes": [{ "id": "a" }, { "id": "a" }] }),
                ForeignLayer::DuplicateId,
            ),
        ];
        for (value, reason) in cases {
            assert_eq!(InkLayer::from_value(&value), Err(reason), "{value}");
        }
        assert!(InkLayer::from_value(&json!({ "v": 1.0, "strokes": [] })).is_ok());
    }

    #[test]
    fn the_round_trip_loses_nothing() {
        let value = json!({ "v": 1.0, "author": "Ada", "strokes": [
            { "tool": 5, "id": "s-0", "x-app": [1, 2], "anchor": { "kind": "card", "width": 640.0, "height": 420, "origin": "tl" },
              "color": null, "fub:ink": { "v": 9 } },
            card_stroke()
        ], "x-app": { "zoom": 2 } });
        let layer = InkLayer::from_value(&value).unwrap();
        assert_eq!(layer.to_value(), value);
        assert_eq!(layer.strokes[0].color, Some(Value::Null));
        // `v` resta un decimale: il valore è uguale anche nella sua forma.
        assert!(layer.version().is_f64());
        // Serde passa dalla stessa strada.
        assert_eq!(serde_json::to_value(&layer).unwrap(), value);
        let again: InkLayer = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(again, layer);
        assert!(serde_json::from_value::<InkLayer>(json!({ "v": 2, "strokes": [] })).is_err());
        // I campi noti del tratto si scrivono nell'ordine di scrittura, poi gli
        // sconosciuti nel loro.
        let keys: Vec<String> = layer.strokes[0]
            .to_value()
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, ["id", "tool", "color", "anchor", "x-app", "fub:ink"]);
    }

    #[test]
    fn a_layer_on_an_edge_is_an_unknown_field() {
        let source = r#"{"nodes":[{"id":"a","type":"text","text":"","x":0,"y":0,"width":10,"height":10}],
            "edges":[{"id":"e","fromNode":"a","toNode":"a","fub:ink":{"v":1,"strokes":[]}}]}"#;
        let canvas = parse(source).unwrap();
        assert!(read_layers(&canvas).is_empty());
        assert!(canvas.edges[0].extra.contains_key(INK_KEY));
    }

    #[test]
    fn layer_finds_one_layer() {
        let source = r#"{"nodes":[{"id":"n1","type":"text","text":"","x":0,"y":0,"width":10,"height":10,
            "fub:ink":{"v":1,"strokes":[]}},{"id":"n2","type":"text","text":"","x":0,"y":0,"width":10,"height":10}],
            "fub:ink":7}"#;
        let canvas = parse(source).unwrap();
        let n1 = layer(&canvas, &card()).unwrap();
        assert!(matches!(&n1.state, LayerState::Ok { layer, .. } if layer.is_bare()));
        assert_eq!(layer(&canvas, &LayerRef::Node("n2".into())), None);
        assert_eq!(layer(&canvas, &LayerRef::Node("n3".into())), None);
        let board = layer(&canvas, &LayerRef::Board).unwrap();
        assert_eq!(board.state, LayerState::Foreign(ForeignLayer::NotObject));
        assert_eq!(read_layers(&canvas), vec![n1, board]);
    }

    #[test]
    fn a_card_anchor_is_written_with_integer_measures() {
        let canvas = parse(r#"{"nodes":[{"id":"n1","type":"text","text":"","x":0,"y":0,"width":640,"height":420}]}"#).unwrap();
        let anchor = InkAnchor::card_of(&canvas.nodes[0]);
        assert_eq!(
            anchor.to_value(),
            json!({ "kind": "card", "width": 640, "height": 420 })
        );
        assert_eq!(InkAnchor::Free.to_value(), json!({ "kind": "free" }));
        let fractional = InkAnchor::Card {
            width: 640.5,
            height: 1.0,
        };
        assert_eq!(
            fractional.to_value(),
            json!({ "kind": "card", "width": 640.5, "height": 1 })
        );
        assert!(InkLayer::default().is_bare());
        assert_eq!(
            InkLayer::default().to_value(),
            json!({ "v": 1, "strokes": [] })
        );
    }

    fn page_stroke(anchor: Value) -> Value {
        let mut stroke = card_stroke();
        stroke["anchor"] = anchor;
        stroke
    }

    #[test]
    fn a_page_anchor_is_drawn_on_a_card_and_compares_by_value() {
        for page in [json!(3), json!(3.0), json!(3e0)] {
            let stroke = page_stroke(
                json!({ "kind": "page", "page": page, "width": 595.276, "height": 842 }),
            );
            let StrokeState::Drawn(drawn) = state_on_card(stroke) else {
                panic!("il tratto si disegna");
            };
            assert_eq!(
                drawn.anchor,
                InkAnchor::Page {
                    page: 3,
                    width: 595.276,
                    height: 842.0
                }
            );
        }
        // Sulla radice un'ancora di pagina è fuori posto.
        let stroke = InkStroke::from_value(&page_stroke(
            json!({ "kind": "page", "page": 1, "width": 595, "height": 842 }),
        ))
        .unwrap();
        assert_eq!(
            stroke.state(&LayerRef::Board),
            StrokeState::Kept(SkipReason::Anchor)
        );
    }

    #[test]
    fn a_page_anchor_that_does_not_hold_is_an_anchor_reason() {
        let cases = [
            json!({ "kind": "page", "page": 0, "width": 595, "height": 842 }),
            json!({ "kind": "page", "page": -2, "width": 595, "height": 842 }),
            json!({ "kind": "page", "page": 2.5, "width": 595, "height": 842 }),
            json!({ "kind": "page", "page": "3", "width": 595, "height": 842 }),
            json!({ "kind": "page", "page": 9_007_199_254_740_992_u64, "width": 595, "height": 842 }),
            json!({ "kind": "page", "width": 595, "height": 842 }),
            json!({ "kind": "page", "page": 3, "width": 0, "height": 842 }),
            json!({ "kind": "page", "page": 3, "width": 595, "height": -1 }),
            json!({ "kind": "page", "page": 3, "width": 595 }),
        ];
        for anchor in cases {
            assert_eq!(
                state_on_card(page_stroke(anchor.clone())),
                StrokeState::Kept(SkipReason::Anchor),
                "{anchor}"
            );
        }
    }

    #[test]
    fn a_page_anchor_keeps_its_unknown_fields_and_is_written_in_order() {
        let value = page_stroke(
            json!({ "kind": "page", "page": 2, "width": 612.0, "height": 792, "box": "crop" }),
        );
        let stroke = InkStroke::from_value(&value).unwrap();
        assert!(stroke.state(&card()).is_drawn());
        assert_eq!(stroke.to_value(), value);
        let anchor = InkAnchor::Page {
            page: 2,
            width: 595.0,
            height: 841.89,
        };
        let written = anchor.to_value();
        assert_eq!(
            written,
            json!({ "kind": "page", "page": 2, "width": 595, "height": 841.89 })
        );
        let keys: Vec<&String> = written.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["kind", "page", "width", "height"]);
    }

    fn cell(text: &str) -> CellAddress {
        CellAddress::parse(text).unwrap_or_else(|| panic!("{text} è un indirizzo"))
    }

    #[test]
    fn a_cell_address_reads_and_writes_in_a1() {
        for (text, column, row) in [
            ("A1", 1, 1),
            ("B3", 2, 3),
            ("Z9", 26, 9),
            ("AA10", 27, 10),
            ("AZ1", 52, 1),
            ("BA1", 53, 1),
            ("ZZ1", 702, 1),
            ("AAA1", 703, 1),
            ("XFD1048576", 16_384, 1_048_576),
        ] {
            let address = cell(text);
            assert_eq!(address, CellAddress { column, row }, "{text}");
            assert_eq!(address.to_string(), text);
        }
        for text in [
            "", "A0", "B", "3", "b3", "B3 ", " B3", "$B$3", "B03", "XFE1", "AAAA1", "A1048577",
            "A10485760", "B-3", "B3.0", "ÀB3", "B٣",
        ] {
            assert_eq!(CellAddress::parse(text), None, "{text:?}");
        }
    }

    #[test]
    fn a_cell_anchor_is_drawn_on_a_card_with_the_sheet_as_written() {
        for (sheet, address) in [
            ("Foglio1", "B3"),
            ("Conti 'Q1' \"bis\"", "A1"),
            (" ", "XFD1048576"),
        ] {
            let stroke =
                page_stroke(json!({ "kind": "cell", "sheet": sheet, "cell": address }));
            let StrokeState::Drawn(drawn) = state_on_card(stroke) else {
                panic!("il tratto si disegna");
            };
            assert_eq!(
                drawn.anchor,
                InkAnchor::Cell {
                    sheet: sheet.to_owned(),
                    cell: cell(address)
                }
            );
        }
        // Sulla radice un'ancora di cella è fuori posto.
        let stroke = InkStroke::from_value(&page_stroke(
            json!({ "kind": "cell", "sheet": "Foglio1", "cell": "B3" }),
        ))
        .unwrap();
        assert_eq!(
            stroke.state(&LayerRef::Board),
            StrokeState::Kept(SkipReason::Anchor)
        );
    }

    #[test]
    fn a_cell_anchor_that_does_not_hold_is_an_anchor_reason() {
        let cases = [
            json!({ "kind": "cell", "sheet": "Foglio1", "cell": "A0" }),
            json!({ "kind": "cell", "sheet": "Foglio1", "cell": "B" }),
            json!({ "kind": "cell", "sheet": "Foglio1", "cell": "b3" }),
            json!({ "kind": "cell", "sheet": "Foglio1", "cell": "$B$3" }),
            json!({ "kind": "cell", "sheet": "Foglio1", "cell": "XFE1" }),
            json!({ "kind": "cell", "sheet": "Foglio1", "cell": "A1048577" }),
            json!({ "kind": "cell", "sheet": "Foglio1", "cell": 3 }),
            json!({ "kind": "cell", "sheet": "Foglio1" }),
            json!({ "kind": "cell", "sheet": "", "cell": "B3" }),
            json!({ "kind": "cell", "sheet": 1, "cell": "B3" }),
            json!({ "kind": "cell", "cell": "B3" }),
        ];
        for anchor in cases {
            assert_eq!(
                state_on_card(page_stroke(anchor.clone())),
                StrokeState::Kept(SkipReason::Anchor),
                "{anchor}"
            );
        }
    }

    #[test]
    fn a_cell_anchor_keeps_its_unknown_fields_and_is_written_in_order() {
        let value = page_stroke(
            json!({ "kind": "cell", "merge": "B3:C4", "sheet": "Foglio 2", "cell": "B3" }),
        );
        let stroke = InkStroke::from_value(&value).unwrap();
        assert!(stroke.state(&card()).is_drawn());
        assert_eq!(stroke.to_value(), value);
        let anchor = InkAnchor::Cell {
            sheet: "Foglio 2".to_owned(),
            cell: cell("AB12"),
        };
        let written = anchor.to_value();
        assert_eq!(
            written,
            json!({ "kind": "cell", "sheet": "Foglio 2", "cell": "AB12" })
        );
        let keys: Vec<&String> = written.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["kind", "sheet", "cell"]);
    }
}
