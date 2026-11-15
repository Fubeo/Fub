//! Il riassunto di ciò che una lista di operazioni cambierebbe: le schede e gli
//! archi nati, tolti, spostati, ridimensionati, i campi cambiati, e se l'ordine
//! cambia. [`summarize`] lo legge dalle toppe di [`Compiled`], non dal
//! confronto di due lavagne: una scheda nata e tolta nello stesso giro non
//! compare, e una scheda cambiata da più operazioni compare una volta sola, con
//! il saldo del giro. I tratti d'inchiostro nati e tolti (le toppe `ink`) si
//! contano per livello allo stesso modo.
//!
//! Ogni voce porta l'id, e per una scheda il suo testo accorciato come nella
//! lettura ([`crate::describe::outline`]). Le regole e un esempio stanno in
//! `docs/reference/canvas-code.md`, «Il controllo».

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::describe::{card_text, shorten};
use crate::ink::{InkStroke, LayerRef};
use crate::model::{Canvas, CanvasEdge, CanvasNode};
use crate::ops::Compiled;
use crate::patch::{self, same_value, CanvasPatch};

/// Il riassunto di un giro di operazioni. Una lista vuota vuol dire che il giro
/// non cambia quella cosa.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Summary {
    /// Le schede nate, nell'ordine in cui sono nate.
    pub cards_added: Vec<CardRef>,
    /// Le schede tolte, com'erano prima del giro.
    pub cards_removed: Vec<CardRef>,
    /// Le schede rimaste che hanno cambiato posto, misura o campi.
    pub cards_changed: Vec<CardChange>,
    /// Gli archi nati.
    pub edges_added: Vec<EdgeRef>,
    /// Gli archi tolti, com'erano prima del giro.
    pub edges_removed: Vec<EdgeRef>,
    /// Gli archi rimasti che hanno cambiato campi.
    pub edges_changed: Vec<EdgeChange>,
    /// Se l'ordine delle schede rimaste è cambiato, per un `reorder`.
    pub order_changed: bool,
    /// I tratti nati, col loro livello. Senza tratti il campo non si scrive.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub strokes_added: Vec<StrokeRef>,
    /// I tratti tolti, col loro livello. Senza tratti il campo non si scrive.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub strokes_removed: Vec<StrokeRef>,
    /// I tratti rimasti che una toppa ha sostituito. Senza il campo non si
    /// scrive.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub strokes_changed: Vec<StrokeRef>,
}

/// Un tratto d'inchiostro nato, tolto o cambiato, e il livello dove sta.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StrokeRef {
    pub id: String,
    pub layer: LayerRef,
}

/// Una scheda nata o tolta.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CardRef {
    pub id: String,
    /// Il testo accorciato, se la scheda ne ha uno: come nella lettura.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Una scheda rimasta che cambia. `moved` e `resized` ci sono solo se la
/// posizione o la misura sono cambiate; `fields` ha i nomi dei campi del file
/// che cambiano, senza la posizione e la misura.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CardChange {
    pub id: String,
    /// Il testo di dopo, accorciato.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moved: Option<Moved>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resized: Option<Resized>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<String>,
}

/// Dove era una scheda e dove va.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Moved {
    pub from: Place,
    pub to: Place,
}

/// Com'era la misura di una scheda e com'è.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Resized {
    pub from: Size,
    pub to: Size,
}

/// Un punto della lavagna, in unità della lavagna.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Place {
    pub x: i64,
    pub y: i64,
}

/// Una misura della lavagna, in unità della lavagna.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Size {
    pub width: i64,
    pub height: i64,
}

/// Un arco nato o tolto. Gli estremi hanno i nomi del file.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeRef {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
}

/// Un arco rimasto che cambia campi, col nome che hanno nel file.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeChange {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub fields: Vec<String>,
}

/// Il riassunto di un giro di operazioni compilato su `canvas`. Le toppe di
/// [`Compiled`] vengono da [`crate::ops::compile`] su quella lavagna, quindi si
/// applicano: se non si applicassero, l'ordine non si direbbe cambiato.
pub fn summarize(canvas: &Canvas, compiled: &Compiled) -> Summary {
    let mut nodes = Track::new();
    let mut edges = Track::new();
    let mut strokes: Track<(LayerRef, InkStroke)> = Track::new();
    for patch in &compiled.patches {
        match patch {
            CanvasPatch::UpsertNode { before, after, .. } => {
                *nodes.touch(&after.id, before.as_ref()) = Some(after.clone());
            }
            CanvasPatch::RemoveNode { before, .. } => {
                *nodes.touch(&before.id, Some(before)) = None;
            }
            CanvasPatch::UpsertEdge { before, after, .. } => {
                *edges.touch(&after.id, before.as_ref()) = Some(after.clone());
            }
            CanvasPatch::RemoveEdge { before, .. } => {
                *edges.touch(&before.id, Some(before)) = None;
            }
            CanvasPatch::Reorder { .. } => {}
            CanvasPatch::Ink {
                layer,
                before,
                after,
                ..
            } => {
                let Some(id) = after.as_ref().or(before.as_ref()).map(|s| s.id.clone()) else {
                    continue;
                };
                let key = stroke_key(layer, &id);
                let before = before.clone().map(|stroke| (layer.clone(), stroke));
                *strokes.touch(&key, before.as_ref()) =
                    after.clone().map(|stroke| (layer.clone(), stroke));
            }
        }
    }

    let mut summary = Summary::default();
    for (before, after) in nodes.entries {
        match (before, after) {
            (None, None) => {}
            (None, Some(node)) => summary.cards_added.push(card_ref(&node)),
            (Some(node), None) => summary.cards_removed.push(card_ref(&node)),
            (Some(before), Some(after)) => {
                summary.cards_changed.extend(card_change(&before, &after));
            }
        }
    }
    for (before, after) in edges.entries {
        match (before, after) {
            (None, None) => {}
            (None, Some(edge)) => summary.edges_added.push(edge_ref(&edge)),
            (Some(edge), None) => summary.edges_removed.push(edge_ref(&edge)),
            (Some(before), Some(after)) => {
                summary.edges_changed.extend(edge_change(&before, &after));
            }
        }
    }
    for (before, after) in strokes.entries {
        match (before, after) {
            (None, None) => {}
            (None, Some((layer, stroke))) => summary.strokes_added.push(StrokeRef {
                id: stroke.id,
                layer,
            }),
            (Some((layer, stroke)), None) => summary.strokes_removed.push(StrokeRef {
                id: stroke.id,
                layer,
            }),
            (Some(_), Some((layer, stroke))) => summary.strokes_changed.push(StrokeRef {
                id: stroke.id,
                layer,
            }),
        }
    }
    // Solo un `reorder` cambia l'ordine di chi resta: le altre toppe aggiungono
    // o tolgono, e non si fa la copia della lavagna se non serve.
    let reordered = compiled
        .patches
        .iter()
        .any(|patch| matches!(patch, CanvasPatch::Reorder { .. }));
    summary.order_changed = reordered
        && patch::draft(canvas, &compiled.patches).is_ok_and(|after| !same_order(canvas, &after));
    summary
}

/// La chiave di un tratto nel giro: lo stesso id può stare in due livelli.
fn stroke_key(layer: &LayerRef, id: &str) -> String {
    match layer {
        LayerRef::Board => format!("board\u{0}{id}"),
        LayerRef::Node(node) => format!("node\u{0}{node}\u{0}{id}"),
    }
}

/// Le entrate di un giro, una per id, nell'ordine del primo incontro: com'era
/// prima (`None` se non c'era) e com'è dopo l'ultima toppa (`None` se è tolta).
struct Track<T> {
    position: HashMap<String, usize>,
    entries: Vec<(Option<T>, Option<T>)>,
}

impl<T: Clone> Track<T> {
    fn new() -> Self {
        Self {
            position: HashMap::new(),
            entries: Vec::new(),
        }
    }

    /// La casella «com'è dopo» dell'id, aperta alla prima toppa con `before` come
    /// immagine di prima.
    fn touch(&mut self, id: &str, before: Option<&T>) -> &mut Option<T> {
        let index = match self.position.get(id) {
            Some(&index) => index,
            None => {
                self.entries.push((before.cloned(), before.cloned()));
                let index = self.entries.len() - 1;
                self.position.insert(id.to_owned(), index);
                index
            }
        };
        &mut self.entries[index].1
    }
}

fn card_ref(node: &CanvasNode) -> CardRef {
    CardRef {
        id: node.id.clone(),
        text: card_label(node),
    }
}

/// La scheda rimasta cambiata, se qualcosa cambia.
fn card_change(before: &CanvasNode, after: &CanvasNode) -> Option<CardChange> {
    let moved = (before.x, before.y) != (after.x, after.y);
    let resized = (before.width, before.height) != (after.width, after.height);
    let fields = changed_fields(before, after, &["id", "x", "y", "width", "height"]);
    if !moved && !resized && fields.is_empty() {
        return None;
    }
    Some(CardChange {
        id: after.id.clone(),
        text: card_label(after),
        moved: moved.then_some(Moved {
            from: Place {
                x: before.x,
                y: before.y,
            },
            to: Place {
                x: after.x,
                y: after.y,
            },
        }),
        resized: resized.then_some(Resized {
            from: Size {
                width: before.width,
                height: before.height,
            },
            to: Size {
                width: after.width,
                height: after.height,
            },
        }),
        fields,
    })
}

fn edge_ref(edge: &CanvasEdge) -> EdgeRef {
    EdgeRef {
        id: edge.id.clone(),
        from_node: edge.from_node.clone(),
        to_node: edge.to_node.clone(),
    }
}

/// L'arco rimasto cambiato, se qualcosa cambia (estremi compresi).
fn edge_change(before: &CanvasEdge, after: &CanvasEdge) -> Option<EdgeChange> {
    let fields = changed_fields(before, after, &["id"]);
    (!fields.is_empty()).then(|| EdgeChange {
        id: after.id.clone(),
        from_node: after.from_node.clone(),
        to_node: after.to_node.clone(),
        fields,
    })
}

/// Il testo della scheda come lo mostra la lettura, accorciato allo stesso modo.
fn card_label(node: &CanvasNode) -> Option<String> {
    card_text(node).map(|text| shorten(&text))
}

/// I nomi dei campi che cambiano fra due valori della stessa scheda o dello
/// stesso arco, come si scrivono nel file. `skip` sono i campi che hanno già
/// una voce propria. Un campo assente vale `null`.
fn changed_fields<T: Serialize>(before: &T, after: &T, skip: &[&str]) -> Vec<String> {
    let (Some(before), Some(after)) = (fields_of(before), fields_of(after)) else {
        return Vec::new();
    };
    let mut names: Vec<&str> = after.keys().map(String::as_str).collect();
    names.extend(
        before
            .keys()
            .map(String::as_str)
            .filter(|key| !after.contains_key(*key)),
    );
    names
        .into_iter()
        .filter(|name| !skip.contains(name))
        .filter(|name| {
            let old = before.get(*name).unwrap_or(&Value::Null);
            let new = after.get(*name).unwrap_or(&Value::Null);
            !same_value(old, new)
        })
        .map(str::to_owned)
        .collect()
}

/// Il valore di una scheda o di un arco come mappa dei suoi campi. Dà `None`
/// solo se il valore non è un oggetto, che per questi tipi non accade.
fn fields_of<T: Serialize>(value: &T) -> Option<Map<String, Value>> {
    match serde_json::to_value(value) {
        Ok(Value::Object(map)) => Some(map),
        _ => None,
    }
}

/// Se le schede che sono in tutti e due i modelli stanno nello stesso ordine.
fn same_order(before: &Canvas, after: &Canvas) -> bool {
    let kept_after: HashSet<&str> = after.nodes.iter().map(|node| node.id.as_str()).collect();
    let kept_before: HashSet<&str> = before.nodes.iter().map(|node| node.id.as_str()).collect();
    let left = before
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .filter(|id| kept_after.contains(id));
    let right = after
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .filter(|id| kept_before.contains(id));
    left.eq(right)
}
