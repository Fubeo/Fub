//! `insert`: incolla un frammento di lavagna, nella forma degli appunti di N6
//! T68 (`{version: 1, nodes, edges}`, `application/x-fub-canvas+json`). Ogni
//! scheda e ogni arco prende un id nuovo dal seme, e gli archi seguono le
//! schede. Il frammento si sposta come un blocco: l'angolo in alto a sinistra
//! del suo riquadro va in `x`, `y` (senza aggancio, come `placedSelection` di
//! `clipboard.ts`), se no accanto a `near`, se no nel posto automatico di
//! `add_card`. Le regole stanno in `docs/reference/canvas-code.md`, «Le
//! operazioni».

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{from_fields, invalid, refuse, saturating_option, whole, Compiler, OpError};
use crate::layout::{self, Rect};
use crate::model::{
    Canvas, CanvasEdge, CanvasEdgeSide, CanvasNode, MAX_EDGES, MAX_NODES, MAX_SAFE_INTEGER,
};
use crate::patch::CanvasPatch;

/// Le schede che un `insert` porta al più: oltre è `TooMany`.
pub const MAX_INSERTED: usize = 10_000;

/// La versione della forma degli appunti che il nucleo sa incollare.
const FRAGMENT_VERSION: u64 = 1;

/// Gli argomenti di `insert`. Il posto è `x` e `y` (insieme), o `near` (con
/// `side`), o nessuno dei due: il posto automatico.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InsertArgs {
    /// Il frammento, come negli appunti: `version` (1), `nodes` (le schede nel
    /// loro ordine, la profondità) ed `edges` (gli archi fra schede del
    /// frammento). Lo legge il compilatore: un frammento sbagliato è `Invalid`.
    pub fragment: Map<String, Value>,
    /// Dove va il bordo sinistro del frammento, insieme a `y`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub x: Option<i64>,
    /// Dove va il bordo alto del frammento, insieme a `x`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub y: Option<i64>,
    /// La scheda accanto alla quale va il frammento, come un blocco.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub near: Option<String>,
    /// Il lato di `near`; di serie `right`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<CanvasEdgeSide>,
}

/// Il posto del frammento, come lo chiede chi scrive.
enum Place<'a> {
    At(i64, i64),
    Near(&'a str, CanvasEdgeSide),
    Auto,
}

impl<'a> Place<'a> {
    /// `x` e `y` vanno insieme e non con `near`; `side` va con `near`.
    fn of(index: usize, args: &'a InsertArgs) -> Result<Self, OpError> {
        match (args.x, args.y, args.near.as_deref()) {
            (Some(_), None, _) | (None, Some(_), _) => {
                Err(refuse(index, "`x` and `y` go together: give both or none"))
            }
            (Some(_), Some(_), Some(_)) => Err(refuse(
                index,
                "a fragment has one place: `x` and `y`, or `near`",
            )),
            (Some(x), Some(y), None) => {
                if args.side.is_some() {
                    return Err(refuse(index, "`side` goes with `near`"));
                }
                Ok(Self::At(x, y))
            }
            (None, None, Some(near)) => {
                Ok(Self::Near(near, args.side.unwrap_or(CanvasEdgeSide::Right)))
            }
            (None, None, None) => {
                if args.side.is_some() {
                    return Err(refuse(index, "`side` goes with `near`"));
                }
                Ok(Self::Auto)
            }
        }
    }
}

impl Compiler {
    /// `insert`: le schede del frammento in cima all'ordine, nell'ordine del
    /// frammento, poi i suoi archi in fondo alla lista.
    pub(super) fn insert(
        &mut self,
        index: usize,
        args: &InsertArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let place = Place::of(index, args)?;
        let (nodes, edges) = read_fragment(index, &args.fragment)?;
        if nodes.len() > MAX_INSERTED {
            return Err(OpError::TooMany {
                index,
                what: "nodes in one insert",
                limit: MAX_INSERTED,
            });
        }
        if self.working.nodes.len() + nodes.len() > MAX_NODES {
            return Err(OpError::TooMany {
                index,
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        if self.working.edges.len() + edges.len() > MAX_EDGES {
            return Err(OpError::TooMany {
                index,
                what: "edges",
                limit: MAX_EDGES,
            });
        }
        // Gli id del frammento, e gli archi che escono dal frammento, prima di
        // ogni altra cosa: dicono se il frammento si può rimappare.
        let node_ids = fragment_node_ids(index, nodes)?;
        check_fragment_edges(index, edges, &node_ids)?;
        if nodes.is_empty() {
            return Ok(Vec::new());
        }
        // Le schede come nel file, ancora al loro posto nel frammento.
        let mut cards: Vec<CanvasNode> = nodes
            .iter()
            .map(|value| {
                let fields = value.as_object().cloned().unwrap_or_default();
                from_fields(index, "node", fields)
            })
            .collect::<Result<_, OpError>>()?;
        let frame = frame(&cards);
        let (to_x, to_y) = match place {
            Place::At(x, y) => (i128::from(x), i128::from(y)),
            Place::Near(near, side) => {
                let size = ((frame.2 - frame.0) as f64, (frame.3 - frame.1) as f64);
                let rect = layout::place_sized_near(&self.working, near, side, None, size)
                    .ok_or_else(|| OpError::UnknownNode {
                        index,
                        id: near.to_owned(),
                    })?;
                (
                    i128::from(whole(index, rect.x)?),
                    i128::from(whole(index, rect.y)?),
                )
            }
            Place::Auto => {
                let after = self
                    .auto_last
                    .as_deref()
                    .and_then(|id| self.working.nodes.iter().find(|node| node.id == id))
                    .map(Rect::of_node);
                let (x, y) = layout::auto_place(&self.working, after);
                // La lista automatica non continua sotto una scheda che il
                // frammento può coprire: la prossima scheda automatica va
                // accanto a tutto, frammento compreso.
                self.auto_last = None;
                (i128::from(whole(index, x)?), i128::from(whole(index, y)?))
            }
        };
        let (dx, dy) = (to_x - frame.0, to_y - frame.1);
        for card in &mut cards {
            card.x = shifted(index, card.x, dx)?;
            card.y = shifted(index, card.y, dy)?;
        }
        // Gli id nuovi: prima le schede, poi gli archi, nell'ordine del
        // frammento. Ognuno entra in `taken` subito, così non torna.
        let mut renamed: HashMap<&str, String> = HashMap::with_capacity(cards.len());
        for (card, old) in cards.iter_mut().zip(&node_ids) {
            card.id = self.fresh_id();
            self.taken.insert(card.id.clone());
            renamed.insert(old.as_str(), card.id.clone());
        }
        let mut links: Vec<CanvasEdge> = Vec::with_capacity(edges.len());
        for value in edges {
            let mut fields = value.as_object().cloned().unwrap_or_default();
            let id = self.fresh_id();
            self.taken.insert(id.clone());
            fields.insert("id".to_owned(), Value::String(id));
            for end in ["fromNode", "toNode"] {
                let old = fields.get(end).and_then(Value::as_str).unwrap_or_default();
                let new = renamed.get(old).cloned().unwrap_or_default();
                fields.insert(end.to_owned(), Value::String(new));
            }
            links.push(from_fields(index, "edge", fields)?);
        }
        // Il frammento si controlla come un modello a sé, con le regole del
        // modello: le sue schede e i suoi archi, già al loro posto.
        let batch = Canvas {
            nodes: cards,
            edges: links,
            extra: Map::new(),
        };
        batch.validate().map_err(|error| invalid(index, &error))?;
        self.created
            .extend(batch.nodes.iter().map(|node| node.id.clone()));
        self.created
            .extend(batch.edges.iter().map(|edge| edge.id.clone()));
        let patches = batch
            .nodes
            .into_iter()
            .map(|card| CanvasPatch::UpsertNode {
                before: None,
                after: card,
                at: None,
            })
            .chain(batch.edges.into_iter().map(|edge| CanvasPatch::UpsertEdge {
                before: None,
                after: edge,
                at: None,
            }))
            .collect();
        Ok(patches)
    }
}

/// Le schede e gli archi del frammento: un oggetto con `version` 1, `nodes` ed
/// `edges` liste, e nient'altro (i tratti liberi, `fub:ink`, non si incollano
/// con `insert`: non si perdono in silenzio).
fn read_fragment(
    index: usize,
    fragment: &Map<String, Value>,
) -> Result<(&[Value], &[Value]), OpError> {
    if let Some(key) = fragment
        .keys()
        .find(|key| !matches!(key.as_str(), "version" | "nodes" | "edges"))
    {
        return Err(refuse(
            index,
            format!("the fragment has no field {key:?}: it holds `version`, `nodes` and `edges`"),
        ));
    }
    match fragment.get("version") {
        Some(version) if version.as_u64() == Some(FRAGMENT_VERSION) => {}
        Some(version) => {
            return Err(refuse(
                index,
                format!(
                    "the fragment is version {version}: `insert` reads version {FRAGMENT_VERSION}"
                ),
            ))
        }
        None => return Err(refuse(index, "the fragment has no `version`")),
    }
    let list = |field: &str| match fragment.get(field) {
        Some(Value::Array(items)) => Ok(items.as_slice()),
        _ => Err(refuse(
            index,
            format!("the fragment `{field}` is not a list"),
        )),
    };
    Ok((list("nodes")?, list("edges")?))
}

/// Gli id delle schede del frammento, nel suo ordine: ognuna un oggetto con un
/// `id` testo non vuoto, e nessun id due volte.
fn fragment_node_ids(index: usize, nodes: &[Value]) -> Result<Vec<String>, OpError> {
    let mut seen = HashSet::with_capacity(nodes.len());
    nodes
        .iter()
        .enumerate()
        .map(|(position, node)| {
            let id = fragment_id(index, "node", position, node)?;
            if !seen.insert(id.clone()) {
                return Err(refuse(
                    index,
                    format!("the fragment has the node {id:?} twice"),
                ));
            }
            Ok(id)
        })
        .collect()
}

/// Ogni arco del frammento ha un `id` testo non vuoto e unico, e tutti e due gli
/// estremi fra le schede del frammento: un arco che esce non si incolla.
fn check_fragment_edges(index: usize, edges: &[Value], node_ids: &[String]) -> Result<(), OpError> {
    let nodes: HashSet<&str> = node_ids.iter().map(String::as_str).collect();
    let mut seen = HashSet::with_capacity(edges.len());
    for (position, edge) in edges.iter().enumerate() {
        let id = fragment_id(index, "edge", position, edge)?;
        for end in ["fromNode", "toNode"] {
            match edge.get(end) {
                Some(Value::String(node)) if nodes.contains(node.as_str()) => {}
                Some(Value::String(node)) => {
                    return Err(refuse(
                        index,
                        format!(
                            "the fragment edge {id:?} ends outside the fragment: there is no node {node:?} in it"
                        ),
                    ))
                }
                _ => {
                    return Err(refuse(
                        index,
                        format!("the fragment edge {id:?} has no `{end}` string"),
                    ))
                }
            }
        }
        if !seen.insert(id.clone()) {
            return Err(refuse(
                index,
                format!("the fragment has the edge {id:?} twice"),
            ));
        }
    }
    Ok(())
}

/// L'`id` di una scheda o di un arco del frammento: un testo non vuoto.
fn fragment_id(
    index: usize,
    what: &str,
    position: usize,
    value: &Value,
) -> Result<String, OpError> {
    let Some(object) = value.as_object() else {
        return Err(refuse(
            index,
            format!("the fragment {what} {position} is not an object"),
        ));
    };
    match object.get("id") {
        Some(Value::String(id)) if !id.is_empty() => Ok(id.clone()),
        _ => Err(refuse(
            index,
            format!("the fragment {what} {position} has no `id` string"),
        )),
    }
}

/// Il riquadro delle schede: sinistra, alto, destra, basso. Le schede non sono
/// vuote, e i conti stanno in `i128`, senza traboccare.
fn frame(cards: &[CanvasNode]) -> (i128, i128, i128, i128) {
    let mut frame = (i128::MAX, i128::MAX, i128::MIN, i128::MIN);
    for card in cards {
        let (x, y) = (i128::from(card.x), i128::from(card.y));
        frame.0 = frame.0.min(x);
        frame.1 = frame.1.min(y);
        frame.2 = frame.2.max(x + i128::from(card.width));
        frame.3 = frame.3.max(y + i128::from(card.height));
    }
    frame
}

/// Una coordinata spostata del blocco. Fuori da ±(2^53−1) il frammento non
/// entra: saturare la sposterebbe da sola, e il blocco si romperebbe.
fn shifted(index: usize, at: i64, by: i128) -> Result<i64, OpError> {
    let moved = i128::from(at) + by;
    if moved.abs() > i128::from(MAX_SAFE_INTEGER) {
        return Err(refuse(
            index,
            "the fragment would end outside the model limits",
        ));
    }
    // Entro ±(2^53−1) il valore sta in un `i64`.
    i64::try_from(moved)
        .map_err(|_| refuse(index, "the fragment would end outside the model limits"))
}
