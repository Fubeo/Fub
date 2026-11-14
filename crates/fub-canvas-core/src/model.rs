//! Modello persistito `.canvas`: JSON Canvas 1.0 con conservazione verbatim
//! dei campi sconosciuti.
//!
//! Ogni livello conserva `extra: Map<String, Value>` — radice, nodi, archi —
//! e il serializzatore li riemette tali e quali. I tipi noti seguono
//! https://jsoncanvas.org/spec/1.0/ (nodi in ordine di z crescente, colori
//! preset `"1"`–`"6"`, hex o un colore che Fub non conosce, lati/estremi degli
//! archi).
//!
//! L'id del formato e la versione dello schema non stanno qui: sono del
//! provider (`fub-format-canvas`), non del modello.

use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use thiserror::Error;

pub const MAX_SOURCE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_NODES: usize = 100_000;
pub const MAX_EDGES: usize = 200_000;
pub const MAX_TEXT_BYTES: usize = 1_048_576;
pub const MAX_PATH_BYTES: usize = 8_192;
pub const MAX_LABEL_BYTES: usize = 65_536;

/// Tela persistita: nodi + archi + membri radice sconosciuti.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Canvas {
    /// `"nodes": null` vale come assente (R7).
    #[serde(
        default,
        deserialize_with = "null_as_empty",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub nodes: Vec<CanvasNode>,
    /// `"edges": null` vale come assente (R7).
    #[serde(
        default,
        deserialize_with = "null_as_empty",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub edges: Vec<CanvasEdge>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: CanvasNodeType,
    /// Le coordinate e le misure sono interi entro ±(2^53−1), scritti anche
    /// come `1.0` o `1e2` (R2).
    #[serde(deserialize_with = "integer_x")]
    pub x: i64,
    #[serde(deserialize_with = "integer_y")]
    pub y: i64,
    #[serde(deserialize_with = "integer_width")]
    pub width: i64,
    #[serde(deserialize_with = "integer_height")]
    pub height: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<CanvasColor>,
    /// Card testo: markdown con wikilink/tag/embed della grammatica normale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Card file: path letterale relativo al vault (JSON Canvas `file`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Sottopercorso `#heading` / `#^blocco`, sempre con `#` iniziale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subpath: Option<String>,
    /// Card web: URL remoto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Gruppi: etichetta testuale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_style: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Il più grande intero che un `f64` (e quindi JavaScript) tiene esatto:
/// `Number.MAX_SAFE_INTEGER`, 2^53−1.
pub const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

/// `null` o assente: una lista vuota (R7). Il `null` non si ricorda: quando Fub
/// riscrive la lavagna, la chiave sparisce o torna come lista.
fn null_as_empty<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

/// Legge un campo intero di una scheda (R2): un intero JSON, o un numero con
/// la virgola o l'esponente senza parte frazionaria (`1.0`, `1e2`, `-0`),
/// entro ±[`MAX_SAFE_INTEGER`]. Come `Number.isSafeInteger` del lettore
/// TypeScript; `-0` diventa `0`. L'errore nomina il campo.
struct SafeInteger(&'static str);

impl SafeInteger {
    fn check<E: de::Error>(&self, value: i128) -> Result<i64, E> {
        if (-i128::from(MAX_SAFE_INTEGER)..=i128::from(MAX_SAFE_INTEGER)).contains(&value) {
            // Entro ±(2^53−1) il valore sta in un `i64`.
            i64::try_from(value).map_err(|_| self.out_of_range())
        } else {
            Err(self.out_of_range())
        }
    }

    fn out_of_range<E: de::Error>(&self) -> E {
        E::custom(format_args!(
            "node `{}` must be an integer within ±{MAX_SAFE_INTEGER}",
            self.0
        ))
    }
}

impl Visitor<'_> for SafeInteger {
    type Value = i64;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "an integer within ±{MAX_SAFE_INTEGER} for node `{}`",
            self.0
        )
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<i64, E> {
        self.check(i128::from(value))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<i64, E> {
        self.check(i128::from(value))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<i64, E> {
        // Un `f64` finito senza parte frazionaria entro ±2^53 è esatto: il
        // cast non arrotonda. Ciò che resta fuori (frazioni, valori grandi,
        // non finiti) è un errore che nomina il campo.
        let bound = MAX_SAFE_INTEGER as f64;
        if value.is_finite() && value.fract() == 0.0 && value.abs() <= bound {
            #[allow(clippy::cast_possible_truncation)]
            let integer = value as i64;
            Ok(integer)
        } else {
            Err(self.out_of_range())
        }
    }
}

fn integer_x<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    deserializer.deserialize_any(SafeInteger("x"))
}

fn integer_y<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    deserializer.deserialize_any(SafeInteger("y"))
}

fn integer_width<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    deserializer.deserialize_any(SafeInteger("width"))
}

fn integer_height<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    deserializer.deserialize_any(SafeInteger("height"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasNodeType {
    Text,
    File,
    Link,
    Group,
}

/// Il colore di una scheda o di un arco (`color` in JSON Canvas).
///
/// Il testo si legge com'è e si riscrive uguale. Tre forme: uno dei sei
/// preset, un esadecimale `#rgb`, `#rgba`, `#rrggbb` o `#rrggbbaa` (com'è
/// scritto, maiuscole comprese), o un colore che Fub non conosce (`"7"`,
/// `"rosso"`, `""`): quello non ferma la lavagna, non si disegna, e si scrive
/// solo se la lavagna l'ha letto ([`crate::commit::Core`]). Un valore che non
/// è una stringa non è un colore: è un errore di lettura.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CanvasColor {
    /// Uno dei sei preset `"1"`…`"6"`.
    Preset(PresetColor),
    /// Un esadecimale valido, com'è scritto.
    Hex(String),
    /// Un testo che non è né un preset né un esadecimale valido.
    Unknown(String),
}

impl CanvasColor {
    /// Il colore com'è scritto nel file.
    pub fn as_str(&self) -> &str {
        match self {
            Self::Preset(preset) => preset.as_str(),
            Self::Hex(text) | Self::Unknown(text) => text,
        }
    }

    /// `true` per i sei preset e per un esadecimale valido: il colore che Fub
    /// conosce, che può scrivere da sé.
    pub fn is_known(&self) -> bool {
        match self {
            Self::Preset(_) => true,
            Self::Hex(text) | Self::Unknown(text) => is_hex(text),
        }
    }

    /// Il colore letto da un testo: un preset, un esadecimale, o il resto.
    fn from_text(text: String) -> Self {
        if let Some(preset) = PresetColor::from_text(&text) {
            Self::Preset(preset)
        } else if is_hex(&text) {
            Self::Hex(text)
        } else {
            Self::Unknown(text)
        }
    }
}

impl Serialize for CanvasColor {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for CanvasColor {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Un numero, un oggetto o `true` non è un colore: l'errore dice il tipo.
        String::deserialize(deserializer).map(Self::from_text)
    }
}

/// Un esadecimale `#rgb`, `#rgba`, `#rrggbb` o `#rrggbbaa`: la stessa
/// grammatica di `CANVAS_COLOR` in `apps/client/src/editors/canvas/colors.ts`.
fn is_hex(text: &str) -> bool {
    text.strip_prefix('#').is_some_and(|digits| {
        matches!(digits.len(), 3 | 4 | 6 | 8) && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresetColor {
    #[serde(rename = "1")]
    Red,
    #[serde(rename = "2")]
    Orange,
    #[serde(rename = "3")]
    Yellow,
    #[serde(rename = "4")]
    Green,
    #[serde(rename = "5")]
    Cyan,
    #[serde(rename = "6")]
    Purple,
}

impl PresetColor {
    const ALL: [Self; 6] = [
        Self::Red,
        Self::Orange,
        Self::Yellow,
        Self::Green,
        Self::Cyan,
        Self::Purple,
    ];

    /// Il numero che il file scrive per il preset (`"1"`…`"6"`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Red => "1",
            Self::Orange => "2",
            Self::Yellow => "3",
            Self::Green => "4",
            Self::Cyan => "5",
            Self::Purple => "6",
        }
    }

    fn from_text(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|preset| preset.as_str() == text)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_side: Option<CanvasEdgeSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_end: Option<CanvasEdgeEnd>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_side: Option<CanvasEdgeSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_end: Option<CanvasEdgeEnd>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<CanvasColor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasEdgeSide {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasEdgeEnd {
    None,
    Arrow,
}

#[derive(Debug, Error)]
pub enum CanvasError {
    #[error(".canvas source exceeds the {limit}-byte {what} limit")]
    Limit { what: &'static str, limit: usize },
    #[error("invalid .canvas JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid .canvas: {0}")]
    Invalid(String),
}

pub(crate) fn validate_id(kind: &'static str, id: &str) -> Result<(), CanvasError> {
    if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
        // `len` è in byte: il limite è 128 byte come nel contratto sheet.
        return Err(CanvasError::Invalid(format!(
            "{kind} id must be non-empty, at most 128 bytes, and contain no control characters"
        )));
    }
    Ok(())
}

impl Canvas {
    pub fn validate(&self) -> Result<(), CanvasError> {
        if self.nodes.len() > MAX_NODES {
            return Err(CanvasError::Limit {
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        if self.edges.len() > MAX_EDGES {
            return Err(CanvasError::Limit {
                what: "edges",
                limit: MAX_EDGES,
            });
        }
        let mut ids = HashSet::new();
        for node in &self.nodes {
            validate_id("node", &node.id)?;
            if !ids.insert(node.id.as_str()) {
                return Err(CanvasError::Invalid(format!(
                    "duplicate node id {:?}",
                    node.id
                )));
            }
            node.validate()?;
        }
        let mut edge_ids = HashSet::new();
        for edge in &self.edges {
            validate_id("edge", &edge.id)?;
            if !edge_ids.insert(edge.id.as_str()) {
                return Err(CanvasError::Invalid(format!(
                    "duplicate edge id {:?}",
                    edge.id
                )));
            }
            if !ids.contains(edge.from_node.as_str()) {
                return Err(CanvasError::Invalid(format!(
                    "edge {:?} starts at unknown node {:?}",
                    edge.id, edge.from_node
                )));
            }
            if !ids.contains(edge.to_node.as_str()) {
                return Err(CanvasError::Invalid(format!(
                    "edge {:?} ends at unknown node {:?}",
                    edge.id, edge.to_node
                )));
            }
            if edge
                .label
                .as_ref()
                .is_some_and(|l| l.len() > MAX_LABEL_BYTES)
            {
                return Err(CanvasError::Limit {
                    what: "edge label bytes",
                    limit: MAX_LABEL_BYTES,
                });
            }
        }
        Ok(())
    }

    /// Indice id nodo → posizione, per archi e sessioni derivate.
    pub fn node_index(&self) -> HashMap<&str, usize> {
        self.nodes
            .iter()
            .enumerate()
            .map(|(index, node)| (node.id.as_str(), index))
            .collect()
    }
}

impl CanvasNode {
    fn validate(&self) -> Result<(), CanvasError> {
        if self.width < 1 || self.height < 1 {
            return Err(CanvasError::Invalid(format!(
                "node {:?} must have positive width and height",
                self.id
            )));
        }
        match self.node_type {
            CanvasNodeType::Text => {
                let text = self.text.as_deref().ok_or_else(|| {
                    CanvasError::Invalid(format!("text node {:?} has no `text`", self.id))
                })?;
                if text.len() > MAX_TEXT_BYTES {
                    return Err(CanvasError::Limit {
                        what: "text node bytes",
                        limit: MAX_TEXT_BYTES,
                    });
                }
            }
            CanvasNodeType::File => {
                let file = self.file.as_deref().ok_or_else(|| {
                    CanvasError::Invalid(format!("file node {:?} has no `file`", self.id))
                })?;
                if file.is_empty() || file.len() > MAX_PATH_BYTES {
                    return Err(CanvasError::Limit {
                        what: "file node path bytes",
                        limit: MAX_PATH_BYTES,
                    });
                }
                if let Some(subpath) = self.subpath.as_deref() {
                    if !subpath.starts_with('#') || subpath.len() > 1024 {
                        return Err(CanvasError::Invalid(format!(
                            "file node {:?} has invalid `subpath`",
                            self.id
                        )));
                    }
                }
            }
            CanvasNodeType::Link => {
                let url = self.url.as_deref().ok_or_else(|| {
                    CanvasError::Invalid(format!("link node {:?} has no `url`", self.id))
                })?;
                if url.is_empty() || url.len() > MAX_PATH_BYTES {
                    return Err(CanvasError::Limit {
                        what: "link node url bytes",
                        limit: MAX_PATH_BYTES,
                    });
                }
            }
            CanvasNodeType::Group => {
                if self
                    .label
                    .as_ref()
                    .is_some_and(|l| l.len() > MAX_LABEL_BYTES)
                {
                    return Err(CanvasError::Limit {
                        what: "group label bytes",
                        limit: MAX_LABEL_BYTES,
                    });
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_colour_is_a_preset_a_hex_or_kept_as_it_is() {
        for (text, known) in [
            ("1", true),
            ("6", true),
            ("#ABC", true),
            ("#aabbccdd", true),
            ("7", false),
            ("rosso", false),
            ("", false),
            ("#12", false),
            ("#0f0f ", false),
        ] {
            let color: CanvasColor = serde_json::from_value(json!(text)).unwrap();
            assert_eq!(color.as_str(), text);
            assert_eq!(color.is_known(), known, "{text:?}");
            assert_eq!(serde_json::to_value(&color).unwrap(), json!(text));
        }
        let hex: CanvasColor = serde_json::from_value(json!("#ABC")).unwrap();
        assert!(matches!(hex, CanvasColor::Hex(_)));
        let unknown: CanvasColor = serde_json::from_value(json!("rosso")).unwrap();
        assert!(matches!(unknown, CanvasColor::Unknown(_)));
    }

    #[test]
    fn a_value_that_is_not_a_string_is_not_a_colour() {
        for value in [json!(7), json!(true), json!(["1"]), json!({"c": "1"})] {
            assert!(serde_json::from_value::<CanvasColor>(value).is_err());
        }
    }

    #[test]
    fn the_preset_names_are_the_serde_names() {
        for preset in PresetColor::ALL {
            assert_eq!(
                serde_json::to_value(preset).unwrap(),
                json!(preset.as_str())
            );
        }
    }
}
