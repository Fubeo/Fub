//! La misura e l'allineamento del testo di una scheda: il campo `fub:text` di
//! una scheda `text`, letto e scritto come lo legge e lo scrive la shell.
//!
//! Il testo della scheda resta Markdown puro, nel campo `text` di JSON
//! Canvas: la misura (`s`, `m`, `l`, `xl`) e l'allineamento (`start`,
//! `center`, `end`) stanno a parte, sotto la chiave [`TEXT_KEY`], come
//! `fub:ink` e `fub:parts`. Obsidian non lo conosce, lo conserva e mostra il
//! testo di serie. Le regole sono quelle della sezione «La misura e
//! l'allineamento del testo» di `docs/reference/canvas-format.md` e dei
//! vettori di `apps/client/src/__fixtures__/canvas-text/`
//! (`tests/text_vectors.rs`), che il lettore TypeScript
//! (`apps/client/src/editors/canvas/text-style.ts`) fa girare uguali.
//!
//! - **La lettura** ([`read_text`], [`node_text`]) non tocca il file: il
//!   campo resta nei campi sconosciuti della scheda (`extra`). Un campo che
//!   Fub non capisce (una versione futura, una misura sconosciuta) si
//!   conserva byte per byte ([`TextState::Kept`], con la ragione) e la scheda
//!   si mostra di serie.
//! - **La scrittura** ([`write_text`]) dà il valore del campo per una misura
//!   e un allineamento scelti, `None` quando sono quelli di serie e non c'è
//!   altro da conservare: allora la chiave sparisce. Un campo valido tiene i
//!   suoi campi sconosciuti; uno conservato si riscrive alla versione 1.
//!
//! Il giro non perde niente: [`CanvasText::to_value`] di un campo letto è
//! uguale per valore al campo, con `v`, `size` e `align` in quest'ordine e
//! i campi sconosciuti nel loro. Leggere non riscrive mai il campo.

use serde_json::{Map, Number, Value};
use thiserror::Error;

use crate::model::{Canvas, CanvasNode, CanvasNodeType};

/// La chiave della misura e dell'allineamento, su una scheda `text`.
pub const TEXT_KEY: &str = "fub:text";

/// La versione del campo che Fub legge e scrive.
pub const TEXT_VERSION: u64 = 1;

/// I campi noti, nell'ordine in cui si scrivono.
const FIELDS: [&str; 3] = ["v", "size", "align"];

/// La misura del testo.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum TextSize {
    /// Piccolo.
    S,
    /// Medio: quello di serie, che non si scrive.
    #[default]
    M,
    /// Grande.
    L,
    /// Grandissimo.
    Xl,
}

impl TextSize {
    /// Le misure, dalla più piccola.
    pub const ALL: [TextSize; 4] = [TextSize::S, TextSize::M, TextSize::L, TextSize::Xl];

    /// Il nome nel file.
    pub fn as_str(self) -> &'static str {
        match self {
            TextSize::S => "s",
            TextSize::M => "m",
            TextSize::L => "l",
            TextSize::Xl => "xl",
        }
    }

    /// La misura dal suo nome nel file.
    pub fn parse(name: &str) -> Option<TextSize> {
        TextSize::ALL.into_iter().find(|size| size.as_str() == name)
    }
}

/// L'allineamento del testo, nel verso della lingua.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum TextAlign {
    /// All'inizio della riga: quello di serie, che non si scrive.
    #[default]
    Start,
    /// Al centro.
    Center,
    /// Alla fine della riga.
    End,
}

impl TextAlign {
    /// Gli allineamenti, nell'ordine della riga delle opzioni.
    pub const ALL: [TextAlign; 3] = [TextAlign::Start, TextAlign::Center, TextAlign::End];

    /// Il nome nel file.
    pub fn as_str(self) -> &'static str {
        match self {
            TextAlign::Start => "start",
            TextAlign::Center => "center",
            TextAlign::End => "end",
        }
    }

    /// L'allineamento dal suo nome nel file.
    pub fn parse(name: &str) -> Option<TextAlign> {
        TextAlign::ALL.into_iter().find(|align| align.as_str() == name)
    }
}

/// Come si mostra il testo di una scheda: la misura e l'allineamento.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct TextStyle {
    pub size: TextSize,
    pub align: TextAlign,
}

/// Un campo `fub:text` valido: la versione com'è scritta, i campi noti (gli
/// assenti valgono di serie) e quelli sconosciuti, nel loro ordine.
#[derive(Clone, Debug, PartialEq)]
pub struct CanvasText {
    /// `v` com'è scritto nel file: vale 1, anche scritto `1.0`.
    v: Number,
    pub size: Option<TextSize>,
    pub align: Option<TextAlign>,
    pub extra: Map<String, Value>,
}

impl CanvasText {
    /// Legge il valore della chiave [`TEXT_KEY`]; l'errore dice perché si
    /// conserva senza mostrarlo. Non guarda il tipo della scheda: lo fa
    /// [`node_text`].
    pub fn from_value(value: &Value) -> Result<CanvasText, TextKept> {
        let Value::Object(fields) = value else {
            return Err(TextKept::Object);
        };
        let v = match fields.get("v") {
            Some(Value::Number(v)) if is_version(v) => v.clone(),
            _ => return Err(TextKept::Version),
        };
        let size = match fields.get("size") {
            None => None,
            Some(Value::String(name)) => Some(TextSize::parse(name).ok_or(TextKept::Field)?),
            Some(_) => return Err(TextKept::Field),
        };
        let align = match fields.get("align") {
            None => None,
            Some(Value::String(name)) => Some(TextAlign::parse(name).ok_or(TextKept::Field)?),
            Some(_) => return Err(TextKept::Field),
        };
        let extra = fields
            .iter()
            .filter(|(key, _)| !FIELDS.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        Ok(CanvasText {
            v,
            size,
            align,
            extra,
        })
    }

    /// Il campo come valore JSON: `v`, `size` e `align` se ci sono, poi i
    /// campi sconosciuti nel loro ordine.
    pub fn to_value(&self) -> Value {
        let mut map = Map::with_capacity(FIELDS.len() + self.extra.len());
        map.insert("v".to_owned(), Value::Number(self.v.clone()));
        if let Some(size) = self.size {
            map.insert("size".to_owned(), Value::from(size.as_str()));
        }
        if let Some(align) = self.align {
            map.insert("align".to_owned(), Value::from(align.as_str()));
        }
        for (key, value) in &self.extra {
            if !FIELDS.contains(&key.as_str()) {
                map.insert(key.clone(), value.clone());
            }
        }
        Value::Object(map)
    }

    /// Come si mostra: i campi che ci sono, di serie quelli che mancano.
    pub fn style(&self) -> TextStyle {
        TextStyle {
            size: self.size.unwrap_or_default(),
            align: self.align.unwrap_or_default(),
        }
    }

    /// `v` com'è scritto nel file.
    pub fn version(&self) -> &Number {
        &self.v
    }
}

/// Perché un campo `fub:text` si conserva senza mostrarlo; la scheda si
/// mostra di serie.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Error)]
pub enum TextKept {
    /// La scheda non è di tipo `text`: il campo si conserva e si ignora.
    #[error("the text style is not on a text card")]
    Node,
    /// `fub:text` non è un oggetto.
    #[error("the text style is not an object")]
    Object,
    /// `v` manca o non è 1: una versione che Fub non conosce.
    #[error("the text style has an unknown version")]
    Version,
    /// `size` o `align` non è un nome che Fub conosce.
    #[error("a text style field is not valid")]
    Field,
}

impl TextKept {
    /// Il nome della ragione, come nei vettori e nel TypeScript.
    pub fn as_str(self) -> &'static str {
        match self {
            TextKept::Node => "node",
            TextKept::Object => "object",
            TextKept::Version => "version",
            TextKept::Field => "field",
        }
    }
}

/// Lo stato del campo di una scheda.
#[derive(Clone, Debug, PartialEq)]
pub enum TextState {
    /// Valido: la scheda si mostra così.
    Ok(CanvasText),
    /// Si conserva così com'è e la scheda si mostra di serie.
    Kept(TextKept),
}

impl TextState {
    /// Come si mostra la scheda: di serie se il campo si conserva.
    pub fn style(&self) -> TextStyle {
        match self {
            TextState::Ok(text) => text.style(),
            TextState::Kept(_) => TextStyle::default(),
        }
    }
}

/// Il campo di una scheda, letto.
#[derive(Clone, Debug, PartialEq)]
pub struct TextRead {
    /// L'id della scheda.
    pub node: String,
    pub state: TextState,
}

/// Il campo `fub:text` della scheda, letto; `None` se la scheda non l'ha.
pub fn node_text(node: &CanvasNode) -> Option<TextState> {
    let value = node.extra.get(TEXT_KEY)?;
    if node.node_type != CanvasNodeType::Text {
        return Some(TextState::Kept(TextKept::Node));
    }
    Some(match CanvasText::from_value(value) {
        Ok(text) => TextState::Ok(text),
        Err(reason) => TextState::Kept(reason),
    })
}

/// Come si mostra il testo della scheda: quello del campo valido, di serie
/// senza campo o con un campo che si conserva.
pub fn text_style(node: &CanvasNode) -> TextStyle {
    node_text(node).map_or_else(TextStyle::default, |state| state.style())
}

/// I campi `fub:text` di `canvas`, nell'ordine di `nodes`; una scheda senza
/// la chiave non compare.
pub fn read_text(canvas: &Canvas) -> Vec<TextRead> {
    canvas
        .nodes
        .iter()
        .filter_map(|node| {
            node_text(node).map(|state| TextRead {
                node: node.id.clone(),
                state,
            })
        })
        .collect()
}

/// Perché Fub non scrive la misura e l'allineamento.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Error)]
pub enum TextRefused {
    /// La scheda non è di tipo `text`.
    #[error("the card is not a text card")]
    Node,
}

impl TextRefused {
    /// Il nome della ragione, come nei vettori e nel TypeScript.
    pub fn as_str(self) -> &'static str {
        match self {
            TextRefused::Node => "node",
        }
    }
}

/// Il valore di `fub:text` che Fub scrive sulla scheda `node` per mostrarla
/// con `style`; `None`: la chiave non c'è.
///
/// Solo ciò che non è di serie si scrive (`m` e `start` no). Un campo
/// valido tiene i suoi campi sconosciuti, e con quelli il campo resta anche
/// di serie (`{"v": 1, …}`); uno che si conserva senza mostrarlo (una
/// versione futura) si riscrive alla versione 1, senza il suo contenuto.
pub fn write_text(node: &CanvasNode, style: TextStyle) -> Result<Option<Value>, TextRefused> {
    if node.node_type != CanvasNodeType::Text {
        return Err(TextRefused::Node);
    }
    let extra = match node_text(node) {
        Some(TextState::Ok(text)) => text.extra,
        _ => Map::new(),
    };
    let text = CanvasText {
        v: Number::from(TEXT_VERSION),
        size: (style.size != TextSize::default()).then_some(style.size),
        align: (style.align != TextAlign::default()).then_some(style.align),
        extra,
    };
    let bare = text.size.is_none() && text.align.is_none() && text.extra.is_empty();
    Ok((!bare).then(|| text.to_value()))
}

/// `v` vale 1, scritto intero o decimale (`1.0`), come in JavaScript.
fn is_version(v: &Number) -> bool {
    match (v.as_u64(), v.as_f64()) {
        (Some(integer), _) => integer == TEXT_VERSION,
        (None, Some(float)) => float == TEXT_VERSION as f64,
        (None, None) => false,
    }
}
