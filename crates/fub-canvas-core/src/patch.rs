//! Le toppe sul modello (`upsert-node`, `remove-node`, `upsert-edge`,
//! `remove-edge`, `reorder`), ognuna con l'immagine di prima, e la loro
//! inversa.
//!
//! È il porto di `apps/client/src/editors/canvas/operation.ts`: la stessa
//! forma JSON di `CanvasPatch`, la stessa bozza (`canvasDraft`) e la stessa
//! inversa (`inverseCanvasPatches`). Una lista di toppe vale tutta o niente:
//! [`draft`] lavora su una copia e il modello di partenza non cambia mai a
//! metà. L'immagine di prima si confronta come valore JSON ([`same_value`],
//! regola R9 di `docs/reference/canvas-operations.md`).
//!
//! La bozza controlla la struttura (immagini di prima, posizioni, archi che
//! puntano a schede che ci sono, permutazioni); non chiama
//! [`Canvas::validate`]: un modello di dopo non valido lo rifiuta il commit.

use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Number, Value};
use thiserror::Error;

use crate::model::{Canvas, CanvasEdge, CanvasNode};

/// Il `null` obbligatorio di `after` nelle toppe che tolgono qualcosa.
///
/// Si scrive `null` e si legge solo da `null`: `{}`, `[]` o un campo assente
/// sono un errore, come nel tipo TypeScript (`after: null`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Null;

impl Serialize for Null {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_unit()
    }
}

impl<'de> Deserialize<'de> for Null {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Passa da `Value`, non da `deserialize_unit`: dentro un enum con il
        // tag serde bufferizza i campi e accetterebbe come unità anche `{}`
        // e `[]`.
        match Value::deserialize(deserializer)? {
            Value::Null => Ok(Null),
            other => Err(serde::de::Error::invalid_type(unexpected(&other), &"null")),
        }
    }
}

fn unexpected(value: &Value) -> serde::de::Unexpected<'_> {
    use serde::de::Unexpected;
    match value {
        Value::Null => Unexpected::Unit,
        Value::Bool(value) => Unexpected::Bool(*value),
        Value::Number(_) => Unexpected::Other("number"),
        Value::String(value) => Unexpected::Str(value),
        Value::Array(_) => Unexpected::Seq,
        Value::Object(_) => Unexpected::Map,
    }
}

/// Una toppa: un cambiamento del modello con l'immagine di prima.
///
/// La forma JSON è quella di `CanvasPatch` in TypeScript: il campo `kind`
/// per primo, poi `before`, `after` e, se c'è, `at` (la posizione nella lista
/// delle schede).
#[allow(
    clippy::large_enum_variant,
    reason = "la forma è quella di TypeScript e una lista di toppe è corta: \
              una `Box` per variante peserebbe su ogni chiamante per pochi byte"
)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CanvasPatch {
    /// Mette una scheda: la cambia se c'è (`before` è com'era), la aggiunge
    /// se non c'è (`before` è `null`), in `at` o in cima all'ordine.
    UpsertNode {
        before: Option<CanvasNode>,
        after: CanvasNode,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at: Option<usize>,
    },
    /// Toglie una scheda che non ha più archi. `at` è la posizione che aveva:
    /// serve all'inversa per rimetterla al suo posto.
    RemoveNode {
        before: CanvasNode,
        after: Null,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at: Option<usize>,
    },
    /// Mette un arco: lo cambia se c'è, lo aggiunge in fondo se non c'è.
    UpsertEdge {
        before: Option<CanvasEdge>,
        after: CanvasEdge,
    },
    /// Toglie un arco.
    RemoveEdge { before: CanvasEdge, after: Null },
    /// Cambia l'ordine delle schede (la profondità): `before` è l'ordine di
    /// prima, `after` una sua permutazione.
    Reorder {
        before: Vec<String>,
        after: Vec<String>,
    },
}

/// Che cosa non tornava in una toppa `Stale`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Subject {
    Node(String),
    Edge(String),
    /// L'ordine delle schede di un `reorder`.
    Order,
}

impl fmt::Display for Subject {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Node(id) => write!(formatter, "node {id:?}"),
            Self::Edge(id) => write!(formatter, "edge {id:?}"),
            Self::Order => formatter.write_str("node order"),
        }
    }
}

/// Perché una lista di toppe non si applica. `index` è la posizione della
/// toppa nella lista.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum PatchError {
    /// L'immagine di prima non è il modello: qualcuno l'ha cambiato nel
    /// frattempo, o la toppa è stata fatta su un altro modello.
    #[error("canvas patch {index}: the {subject} is not what the patch expects")]
    Stale { index: usize, subject: Subject },
    /// `at` oltre la fine della lista delle schede.
    #[error("canvas patch {index}: position {at} is past the end of the {len} nodes")]
    AtOutOfRange { index: usize, at: usize, len: usize },
    /// Una scheda da togliere ha ancora un arco: va tolto prima.
    #[error("canvas patch {index}: node {id:?} still has edge {edge:?}")]
    NodeHasEdges {
        index: usize,
        id: String,
        edge: String,
    },
    /// Un arco che punta a una scheda che non c'è.
    #[error("canvas patch {index}: edge {id:?} points to missing node {node:?}")]
    MissingEndpoint {
        index: usize,
        id: String,
        node: String,
    },
    /// L'ordine nuovo di un `reorder` non è una permutazione delle schede:
    /// un id che non c'è, uno ripetuto o uno mancante.
    #[error("canvas patch {index}: the new order is not a permutation of the nodes")]
    NotAPermutation { index: usize },
}

/// Due valori JSON uguali per valore (R9): le chiavi di un oggetto in
/// qualunque ordine, i numeri confrontati come `f64`, come li vede
/// JavaScript (`1` e `1.0` sono uguali, `-0` e `0` anche; un intero oltre
/// 2^53 vale il suo arrotondamento). Gli elementi di un array contano
/// nell'ordine.
pub fn same_value(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(left), Value::Bool(right)) => left == right,
        (Value::Number(left), Value::Number(right)) => same_number(left, right),
        (Value::String(left), Value::String(right)) => left == right,
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| same_value(left, right))
        }
        (Value::Object(left), Value::Object(right)) => same_map(left, right),
        _ => false,
    }
}

fn same_number(left: &Number, right: &Number) -> bool {
    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => left == right,
        _ => left == right,
    }
}

fn same_map(left: &Map<String, Value>, right: &Map<String, Value>) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .all(|(key, value)| right.get(key).is_some_and(|other| same_value(value, other)))
}

/// Due schede uguali come valori JSON (R9). La destrutturazione è completa
/// apposta: un campo nuovo del modello non compila finché non entra qui.
pub fn same_node(left: &CanvasNode, right: &CanvasNode) -> bool {
    let CanvasNode {
        id,
        node_type,
        x,
        y,
        width,
        height,
        color,
        text,
        file,
        subpath,
        url,
        label,
        background,
        background_style,
        extra,
    } = left;
    *id == right.id
        && *node_type == right.node_type
        && *x == right.x
        && *y == right.y
        && *width == right.width
        && *height == right.height
        && *color == right.color
        && *text == right.text
        && *file == right.file
        && *subpath == right.subpath
        && *url == right.url
        && *label == right.label
        && *background == right.background
        && *background_style == right.background_style
        && same_map(extra, &right.extra)
}

/// Due archi uguali come valori JSON (R9), come [`same_node`].
pub fn same_edge(left: &CanvasEdge, right: &CanvasEdge) -> bool {
    let CanvasEdge {
        id,
        from_node,
        to_node,
        from_side,
        from_end,
        to_side,
        to_end,
        color,
        label,
        extra,
    } = left;
    *id == right.id
        && *from_node == right.from_node
        && *to_node == right.to_node
        && *from_side == right.from_side
        && *from_end == right.from_end
        && *to_side == right.to_side
        && *to_end == right.to_end
        && *color == right.color
        && *label == right.label
        && same_map(extra, &right.extra)
}

/// Il modello dopo le toppe, su una copia (`canvasDraft`): tutte le toppe o
/// nessuna, e `canvas` non cambia.
pub fn draft(canvas: &Canvas, patches: &[CanvasPatch]) -> Result<Canvas, PatchError> {
    let mut draft = canvas.clone();
    for (index, patch) in patches.iter().enumerate() {
        step(&mut draft, index, patch)?;
    }
    Ok(draft)
}

/// Applica le toppe al modello (`applyCanvasPatches`): tutte o nessuna; con
/// un errore `canvas` resta com'era.
pub fn apply(canvas: &mut Canvas, patches: &[CanvasPatch]) -> Result<(), PatchError> {
    *canvas = draft(canvas, patches)?;
    Ok(())
}

fn node_position(canvas: &Canvas, id: &str) -> Option<usize> {
    canvas.nodes.iter().position(|node| node.id == id)
}

fn edge_position(canvas: &Canvas, id: &str) -> Option<usize> {
    canvas.edges.iter().position(|edge| edge.id == id)
}

fn step(draft: &mut Canvas, index: usize, patch: &CanvasPatch) -> Result<(), PatchError> {
    match patch {
        CanvasPatch::UpsertNode { before, after, at } => {
            let current = node_position(draft, &after.id);
            let matches = match (before, current) {
                (None, None) => true,
                (Some(before), Some(position)) => draft
                    .nodes
                    .get(position)
                    .is_some_and(|current| same_node(current, before)),
                _ => false,
            };
            if !matches {
                return Err(stale_node(index, &after.id));
            }
            // Una scheda che c'è si cambia al suo posto: `at` vale solo per
            // una scheda nuova, come in TypeScript.
            match (
                current.and_then(|position| draft.nodes.get_mut(position)),
                *at,
            ) {
                (Some(slot), _) => *slot = after.clone(),
                (None, Some(at)) => {
                    let len = draft.nodes.len();
                    if at > len {
                        return Err(PatchError::AtOutOfRange { index, at, len });
                    }
                    draft.nodes.insert(at, after.clone());
                }
                (None, None) => draft.nodes.push(after.clone()),
            }
        }
        CanvasPatch::RemoveNode { before, .. } => {
            let found = node_position(draft, &before.id).is_some_and(|position| {
                draft
                    .nodes
                    .get(position)
                    .is_some_and(|current| same_node(current, before))
            });
            if !found {
                return Err(stale_node(index, &before.id));
            }
            if let Some(edge) = draft
                .edges
                .iter()
                .find(|edge| edge.from_node == before.id || edge.to_node == before.id)
            {
                return Err(PatchError::NodeHasEdges {
                    index,
                    id: before.id.clone(),
                    edge: edge.id.clone(),
                });
            }
            // Come `filter` in TypeScript: via ogni scheda con quell'id.
            draft.nodes.retain(|node| node.id != before.id);
        }
        CanvasPatch::UpsertEdge { before, after } => {
            let current = edge_position(draft, &after.id);
            match (before, current) {
                (None, None) => {}
                (Some(before), Some(position))
                    if draft
                        .edges
                        .get(position)
                        .is_some_and(|current| same_edge(current, before)) => {}
                _ => {
                    return Err(PatchError::Stale {
                        index,
                        subject: Subject::Edge(after.id.clone()),
                    })
                }
            }
            for node in [&after.from_node, &after.to_node] {
                if node_position(draft, node).is_none() {
                    return Err(PatchError::MissingEndpoint {
                        index,
                        id: after.id.clone(),
                        node: node.clone(),
                    });
                }
            }
            match current.and_then(|position| draft.edges.get_mut(position)) {
                Some(slot) => *slot = after.clone(),
                None => draft.edges.push(after.clone()),
            }
        }
        CanvasPatch::RemoveEdge { before, .. } => {
            let found = edge_position(draft, &before.id).is_some_and(|position| {
                draft
                    .edges
                    .get(position)
                    .is_some_and(|current| same_edge(current, before))
            });
            if !found {
                return Err(PatchError::Stale {
                    index,
                    subject: Subject::Edge(before.id.clone()),
                });
            }
            draft.edges.retain(|edge| edge.id != before.id);
        }
        CanvasPatch::Reorder { before, after } => {
            let current: Vec<&str> = draft.nodes.iter().map(|node| node.id.as_str()).collect();
            if current.len() != before.len()
                || current
                    .iter()
                    .zip(before)
                    .any(|(left, right)| *left != right)
            {
                return Err(PatchError::Stale {
                    index,
                    subject: Subject::Order,
                });
            }
            let mut sorted_after: Vec<&str> = after.iter().map(String::as_str).collect();
            let mut sorted_current = current;
            sorted_after.sort_unstable();
            sorted_current.sort_unstable();
            if sorted_after != sorted_current {
                return Err(PatchError::NotAPermutation { index });
            }
            // Come la `Map` di TypeScript: con due schede dello stesso id
            // (un modello mai validato) vince l'ultima.
            let by_id: HashMap<&str, &CanvasNode> = draft
                .nodes
                .iter()
                .map(|node| (node.id.as_str(), node))
                .collect();
            let nodes: Vec<CanvasNode> = after
                .iter()
                .filter_map(|id| by_id.get(id.as_str()).map(|node| (*node).clone()))
                .collect();
            draft.nodes = nodes;
        }
    }
    Ok(())
}

fn stale_node(index: usize, id: &str) -> PatchError {
    PatchError::Stale {
        index,
        subject: Subject::Node(id.to_owned()),
    }
}

/// Le toppe che disfano `patches` (`inverseCanvasPatches`): ognuna
/// rovesciata, in ordine inverso.
///
/// Le schede da rimettere che stanno vicine nella lista si riordinano per
/// `at` crescente (quelle senza `at` per ultime, nell'ordine che avevano):
/// gli `at` di una lista di `remove-node` sono le posizioni nel modello di
/// partenza, e rimettendole dalla più bassa ogni scheda torna al suo posto.
pub fn inverse(patches: &[CanvasPatch]) -> Vec<CanvasPatch> {
    let mut inverse: Vec<CanvasPatch> = patches.iter().rev().map(invert).collect();
    let mut start = 0;
    while start < inverse.len() {
        if !is_insert(&inverse[start]) {
            start += 1;
            continue;
        }
        let mut end = start + 1;
        while end < inverse.len() && is_insert(&inverse[end]) {
            end += 1;
        }
        // Stabile, come `Array.prototype.sort`.
        inverse[start..end].sort_by_key(|patch| match patch {
            CanvasPatch::UpsertNode { at: Some(at), .. } => (false, *at),
            _ => (true, 0),
        });
        start = end;
    }
    inverse
}

fn is_insert(patch: &CanvasPatch) -> bool {
    matches!(patch, CanvasPatch::UpsertNode { before: None, .. })
}

fn invert(patch: &CanvasPatch) -> CanvasPatch {
    match patch {
        CanvasPatch::UpsertNode {
            before: None,
            after,
            ..
        } => CanvasPatch::RemoveNode {
            before: after.clone(),
            after: Null,
            at: None,
        },
        CanvasPatch::UpsertNode {
            before: Some(before),
            after,
            ..
        } => CanvasPatch::UpsertNode {
            before: Some(after.clone()),
            after: before.clone(),
            at: None,
        },
        CanvasPatch::RemoveNode { before, at, .. } => CanvasPatch::UpsertNode {
            before: None,
            after: before.clone(),
            at: *at,
        },
        CanvasPatch::UpsertEdge {
            before: None,
            after,
        } => CanvasPatch::RemoveEdge {
            before: after.clone(),
            after: Null,
        },
        CanvasPatch::UpsertEdge {
            before: Some(before),
            after,
        } => CanvasPatch::UpsertEdge {
            before: Some(after.clone()),
            after: before.clone(),
        },
        CanvasPatch::RemoveEdge { before, .. } => CanvasPatch::UpsertEdge {
            before: None,
            after: before.clone(),
        },
        CanvasPatch::Reorder { before, after } => CanvasPatch::Reorder {
            before: after.clone(),
            after: before.clone(),
        },
    }
}

/// La toppa che porta la scheda `after.id` ad `after` (`upsertNodePatch`):
/// `None` se la scheda è già così.
pub fn upsert_node_patch(canvas: &Canvas, after: &CanvasNode) -> Option<CanvasPatch> {
    let before = canvas.nodes.iter().find(|node| node.id == after.id);
    if before.is_some_and(|before| same_node(before, after)) {
        return None;
    }
    Some(CanvasPatch::UpsertNode {
        before: before.cloned(),
        after: after.clone(),
        at: None,
    })
}

/// La toppa che toglie la scheda `id`, con la sua posizione
/// (`removeNodePatch`): `None` se la scheda non c'è.
pub fn remove_node_patch(canvas: &Canvas, id: &str) -> Option<CanvasPatch> {
    let at = node_position(canvas, id)?;
    let before = canvas.nodes.get(at)?.clone();
    Some(CanvasPatch::RemoveNode {
        before,
        after: Null,
        at: Some(at),
    })
}

/// La toppa che porta l'arco `after.id` ad `after` (`upsertEdgePatch`):
/// `None` se l'arco è già così.
pub fn upsert_edge_patch(canvas: &Canvas, after: &CanvasEdge) -> Option<CanvasPatch> {
    let before = canvas.edges.iter().find(|edge| edge.id == after.id);
    if before.is_some_and(|before| same_edge(before, after)) {
        return None;
    }
    Some(CanvasPatch::UpsertEdge {
        before: before.cloned(),
        after: after.clone(),
    })
}

/// La toppa che toglie l'arco `id` (`removeEdgePatch`): `None` se l'arco non
/// c'è.
pub fn remove_edge_patch(canvas: &Canvas, id: &str) -> Option<CanvasPatch> {
    let before = canvas.edges.iter().find(|edge| edge.id == id)?.clone();
    Some(CanvasPatch::RemoveEdge {
        before,
        after: Null,
    })
}
