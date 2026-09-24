//! Modello persistito `.canvas`: JSON Canvas 1.0 con conservazione verbatim
//! dei campi sconosciuti.
//!
//! Ogni livello conserva `extra: Map<String, Value>` — radice, nodi, archi —
//! e il serializzatore li riemette tali e quali. I tipi noti seguono
//! https://jsoncanvas.org/spec/1.0/ (nodi in ordine di z crescente, colori
//! preset `"1"`–`"6"` oppure hex, lati/estremi degli archi).

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

/// Id del formato, estensione rivendicata e namespace renderer della shell.
pub const FORMAT_ID: &str = "canvas";
/// Versione dello schema interpretato (JSON Canvas 1.0 non ha `version`).
pub const SCHEMA_VERSION: u32 = 1;

pub const MAX_SOURCE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_NODES: usize = 100_000;
pub const MAX_EDGES: usize = 200_000;
pub const MAX_TEXT_BYTES: usize = 1_048_576;
pub const MAX_PATH_BYTES: usize = 8_192;
pub const MAX_LABEL_BYTES: usize = 65_536;

/// Tela persistita: nodi + archi + membri radice sconosciuti.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Canvas {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<CanvasNode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
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
    pub x: i64,
    pub y: i64,
    pub width: i64,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasNodeType {
    Text,
    File,
    Link,
    Group,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CanvasColor {
    Preset(PresetColor),
    Hex(String),
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

fn validate_color(color: &CanvasColor) -> Result<(), CanvasError> {
    match color {
        CanvasColor::Preset(_) => Ok(()),
        CanvasColor::Hex(hex) => {
            let digits = hex
                .strip_prefix('#')
                .ok_or_else(|| CanvasError::Invalid(format!("invalid canvas color {hex:?}")))?;
            let ok_len = matches!(digits.len(), 3 | 4 | 6 | 8);
            let ok_hex = digits.bytes().all(|b| b.is_ascii_hexdigit());
            if ok_len && ok_hex {
                Ok(())
            } else {
                Err(CanvasError::Invalid(format!(
                    "invalid canvas color {hex:?}"
                )))
            }
        }
    }
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
            if let Some(color) = &edge.color {
                validate_color(color)?;
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
        if let Some(color) = &self.color {
            validate_color(color)?;
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
