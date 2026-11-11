//! Le toppe sul modello (`upsert-node`, `remove-node`, `upsert-edge`,
//! `remove-edge`, `reorder`, `ink`), ognuna con l'immagine di prima, e la
//! loro inversa.
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
//!
//! La toppa `ink` aggiunge, toglie o cambia un tratto in un livello
//! d'inchiostro (`fub:ink`, [`crate::ink`]) di una scheda o della radice: il
//! livello nasce con la prima toppa, e se resta esattamente
//! `{"v": 1, "strokes": []}` la chiave sparisce. Un livello estraneo non si
//! tocca: è [`PatchError::ForeignLayer`], che il commit dà come `invalid`
//! ([`PatchError::reason`]).

use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Number, Value};
use thiserror::Error;

use crate::ink::{ForeignLayer, InkLayer, InkStroke, LayerRef, INK_KEY};
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
/// delle schede o degli archi).
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
    /// Mette un arco: lo cambia se c'è (`at` non conta), lo aggiunge se non
    /// c'è, in `at` o in fondo alla lista.
    UpsertEdge {
        before: Option<CanvasEdge>,
        after: CanvasEdge,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at: Option<usize>,
    },
    /// Toglie un arco. `at` è la posizione che aveva: serve all'inversa per
    /// rimetterlo al suo posto; senza, l'inversa lo rimette in fondo.
    RemoveEdge {
        before: CanvasEdge,
        after: Null,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at: Option<usize>,
    },
    /// Cambia l'ordine delle schede (la profondità): `before` è l'ordine di
    /// prima, `after` una sua permutazione.
    Reorder {
        before: Vec<String>,
        after: Vec<String>,
    },
    /// Cambia un tratto alla posizione `at` del livello `layer`: lo aggiunge
    /// (`before` è `null`, `at` può essere la fine), lo toglie (`after` è
    /// `null`) o lo sostituisce. Il livello che non c'è nasce vuoto; quello
    /// che resta esattamente `{"v": 1, "strokes": []}` sparisce.
    Ink {
        layer: LayerRef,
        at: usize,
        before: Option<InkStroke>,
        after: Option<InkStroke>,
    },
}

/// Che cosa non tornava in una toppa `Stale`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Subject {
    Node(String),
    Edge(String),
    /// L'ordine delle schede di un `reorder`.
    Order,
    /// Il tratto `id` alla posizione di una toppa `ink`, nel livello
    /// `layer`.
    Stroke {
        layer: LayerRef,
        id: String,
    },
}

/// Il livello per un messaggio d'errore: `board` o `node "id"`.
struct LayerName<'a>(&'a LayerRef);

impl fmt::Display for LayerName<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            LayerRef::Board => formatter.write_str("board"),
            LayerRef::Node(id) => write!(formatter, "node {id:?}"),
        }
    }
}

impl fmt::Display for Subject {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Node(id) => write!(formatter, "node {id:?}"),
            Self::Edge(id) => write!(formatter, "edge {id:?}"),
            Self::Order => formatter.write_str("node order"),
            Self::Stroke { layer, id } => {
                write!(formatter, "ink stroke {id:?} of the {}", LayerName(layer))
            }
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
    /// `at` oltre la fine della lista delle schede o degli archi: `list` è
    /// `"nodes"` o `"edges"`.
    #[error("canvas patch {index}: position {at} is past the end of the {len} {list}")]
    AtOutOfRange {
        index: usize,
        at: usize,
        len: usize,
        list: &'static str,
    },
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
    /// L'`at` di una toppa `ink` che aggiunge un tratto è oltre la fine dei
    /// tratti del livello.
    #[error(
        "canvas patch {index}: position {at} is past the end of the {len} ink strokes of the {}",
        LayerName(layer)
    )]
    InkAtOutOfRange {
        index: usize,
        layer: LayerRef,
        at: usize,
        len: usize,
    },
    /// Il livello d'inchiostro è estraneo (`reason` dice perché): Fub non ci
    /// scrive.
    #[error(
        "canvas patch {index}: the ink layer of the {} is foreign ({reason})",
        LayerName(layer)
    )]
    ForeignLayer {
        index: usize,
        layer: LayerRef,
        reason: ForeignLayer,
    },
    /// Il tratto di dopo ha l'id di un altro tratto del livello: il livello
    /// diventerebbe estraneo.
    #[error(
        "canvas patch {index}: the {} already has an ink stroke {id:?}",
        LayerName(layer)
    )]
    DuplicateStroke {
        index: usize,
        layer: LayerRef,
        id: String,
    },
    /// Una toppa `ink` con `before` e `after` tutti e due `null`.
    #[error("canvas patch {index}: an ink patch needs a stroke before or after")]
    EmptyInk { index: usize },
}

impl PatchError {
    /// La ragione in una parola, quella di `CommitError::reason`: `invalid`
    /// per una toppa che porterebbe a un livello d'inchiostro che Fub non
    /// scrive (estraneo, con due tratti dello stesso id, senza tratto),
    /// `stale` per tutto il resto.
    pub fn reason(&self) -> &'static str {
        match self {
            Self::ForeignLayer { .. } | Self::DuplicateStroke { .. } | Self::EmptyInk { .. } => {
                "invalid"
            }
            Self::Stale { .. }
            | Self::AtOutOfRange { .. }
            | Self::NodeHasEdges { .. }
            | Self::MissingEndpoint { .. }
            | Self::NotAPermutation { .. }
            | Self::InkAtOutOfRange { .. } => "stale",
        }
    }
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

/// Due mappe uguali come valori JSON (R9): le stesse chiavi, in qualunque
/// ordine, con valori uguali per [`same_value`].
pub(crate) fn same_map(left: &Map<String, Value>, right: &Map<String, Value>) -> bool {
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
    let mut index = 0;
    while index < patches.len() {
        index = step(&mut draft, patches, index)?;
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

/// Applica la toppa `index` di `patches` (e, per una toppa `ink`, quelle
/// vicine sullo stesso livello) e dà la posizione della prossima da
/// applicare.
fn step(draft: &mut Canvas, patches: &[CanvasPatch], index: usize) -> Result<usize, PatchError> {
    let Some(patch) = patches.get(index) else {
        return Ok(patches.len());
    };
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
                        return Err(PatchError::AtOutOfRange {
                            index,
                            at,
                            len,
                            list: "nodes",
                        });
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
        CanvasPatch::UpsertEdge { before, after, at } => {
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
            // Come per le schede: `at` vale solo per un arco nuovo.
            match (
                current.and_then(|position| draft.edges.get_mut(position)),
                *at,
            ) {
                (Some(slot), _) => *slot = after.clone(),
                (None, Some(at)) => {
                    let len = draft.edges.len();
                    if at > len {
                        return Err(PatchError::AtOutOfRange {
                            index,
                            at,
                            len,
                            list: "edges",
                        });
                    }
                    draft.edges.insert(at, after.clone());
                }
                (None, None) => draft.edges.push(after.clone()),
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
        // Le toppe `ink` vicine sullo stesso livello vanno insieme: il
        // livello si legge e si riscrive una volta per la serie.
        CanvasPatch::Ink { layer, .. } => return ink_run(draft, patches, index, layer),
    }
    Ok(index + 1)
}

/// I campi di chi tiene il livello `layer`: la radice o la prima scheda con
/// quell'id (come `node_position`). `None` se la scheda non c'è.
fn ink_holder<'a>(canvas: &'a mut Canvas, layer: &LayerRef) -> Option<&'a mut Map<String, Value>> {
    match layer {
        LayerRef::Board => Some(&mut canvas.extra),
        LayerRef::Node(id) => {
            let position = node_position(canvas, id)?;
            canvas.nodes.get_mut(position).map(|node| &mut node.extra)
        }
    }
}

/// Due tratti uguali come valori JSON (R9).
pub fn same_stroke(left: &InkStroke, right: &InkStroke) -> bool {
    same_value(&left.to_value(), &right.to_value())
}

/// Applica la serie di toppe `ink` che parte da `start` e continua con le
/// toppe `ink` vicine sullo stesso livello `layer`, e dà la posizione della
/// prima toppa dopo la serie.
///
/// Il livello si legge una volta all'inizio e si riscrive una volta alla
/// fine: il risultato e gli errori (con l'`index` della toppa colpevole)
/// sono quelli di una toppa alla volta, che rileggerebbe e riscriverebbe il
/// livello ogni volta (`docs/reference/canvas-ink.md`; il confronto è in
/// `tests/ink_runs.rs`). Così duemila toppe su un livello di duemila tratti
/// costano millisecondi, non secondi. Per questo:
///
/// - i controlli della prima toppa vengono nell'ordine di sempre: toppa
///   vuota, chi tiene il livello, livello estraneo; per le altre chi tiene il
///   livello c'è ancora e il livello, appena scritto, si rileggerebbe uguale;
/// - un livello che a metà serie resta nudo perde la chiave in quel momento
///   (`shift_remove`) e riparte come livello nuovo, `{"v": 1, "strokes": []}`:
///   un tratto aggiunto dopo rimette la chiave in fondo, come rileggendo;
/// - un tratto con l'`id` vuoto (lo può fare solo chi costruisce le toppe in
///   Rust: il JSON non lo legge) chiude la serie, così la toppa dopo rilegge il
///   livello e lo trova estraneo come prima.
fn ink_run(
    draft: &mut Canvas,
    patches: &[CanvasPatch],
    start: usize,
    layer: &LayerRef,
) -> Result<usize, PatchError> {
    if let Some(CanvasPatch::Ink {
        before: None,
        after: None,
        ..
    }) = patches.get(start)
    {
        return Err(PatchError::EmptyInk { index: start });
    }
    let Some(fields) = ink_holder(draft, layer) else {
        let id = match layer {
            LayerRef::Node(id) => id.as_str(),
            LayerRef::Board => "",
        };
        return Err(stale_node(start, id));
    };
    let mut ink = match fields.get(INK_KEY) {
        None => InkLayer::default(),
        Some(value) => InkLayer::from_value(value).map_err(|reason| PatchError::ForeignLayer {
            index: start,
            layer: layer.clone(),
            reason,
        })?,
    };
    // Gli id del livello: un livello letto non ne ha di doppi, e i passi non
    // ne fanno.
    let mut ids: HashSet<String> = ink.strokes.iter().map(|stroke| stroke.id.clone()).collect();
    let mut index = start;
    while let Some(CanvasPatch::Ink {
        layer: next,
        at,
        before,
        after,
    }) = patches.get(index)
    {
        if next != layer {
            break;
        }
        let change = InkChange {
            index,
            layer,
            at: *at,
            before: before.as_ref(),
            after: after.as_ref(),
        };
        change.apply(&mut ink, &mut ids)?;
        index += 1;
        if ink.is_bare() {
            // `shift_remove`: gli altri campi restano nel loro ordine.
            fields.shift_remove(INK_KEY);
            ink = InkLayer::default();
        }
        if after.as_ref().is_some_and(|after| after.id.is_empty()) {
            break;
        }
    }
    if !ink.is_bare() {
        // Una chiave che c'è resta al suo posto; una nuova va in fondo.
        fields.insert(INK_KEY.to_owned(), ink.to_value());
    }
    Ok(index)
}

/// Una toppa `ink` da applicare a un livello già letto.
struct InkChange<'a> {
    index: usize,
    layer: &'a LayerRef,
    at: usize,
    before: Option<&'a InkStroke>,
    after: Option<&'a InkStroke>,
}

impl InkChange<'_> {
    /// Cambia `ink` (e i suoi `ids`) come dice la toppa, o dice perché non
    /// si può; con un errore `ink` può restare a metà, e la bozza si butta.
    fn apply(&self, ink: &mut InkLayer, ids: &mut HashSet<String>) -> Result<(), PatchError> {
        let InkChange {
            index,
            layer,
            at,
            before,
            after,
        } = *self;
        if before.is_none() && after.is_none() {
            return Err(PatchError::EmptyInk { index });
        }
        let len = ink.strokes.len();
        match before {
            None if at > len => {
                return Err(PatchError::InkAtOutOfRange {
                    index,
                    layer: layer.clone(),
                    at,
                    len,
                })
            }
            Some(before)
                if !ink
                    .strokes
                    .get(at)
                    .is_some_and(|current| same_stroke(current, before)) =>
            {
                return Err(PatchError::Stale {
                    index,
                    subject: Subject::Stroke {
                        layer: layer.clone(),
                        id: before.id.clone(),
                    },
                });
            }
            None | Some(_) => {}
        }
        if let Some(after) = after {
            // Con `before` il tratto di prima, che è al posto `at` e ha il suo
            // stesso id, lascia il posto: non conta come doppione.
            let replaced = before.is_some_and(|before| before.id == after.id);
            if !replaced && ids.contains(&after.id) {
                return Err(PatchError::DuplicateStroke {
                    index,
                    layer: layer.clone(),
                    id: after.id.clone(),
                });
            }
        }
        match (before, after) {
            (None, Some(after)) => {
                ink.strokes.insert(at, after.clone());
                ids.insert(after.id.clone());
            }
            (Some(_), Some(after)) => {
                if let Some(slot) = ink.strokes.get_mut(at) {
                    ids.remove(&slot.id);
                    ids.insert(after.id.clone());
                    *slot = after.clone();
                }
            }
            (Some(_), None) => {
                let removed = ink.strokes.remove(at);
                ids.remove(&removed.id);
            }
            (None, None) => return Err(PatchError::EmptyInk { index }),
        }
        Ok(())
    }
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
/// gli `at` di una serie di `remove-node` sono le posizioni nel modello
/// all'inizio della serie, e rimettendole dalla più bassa ogni scheda torna
/// al suo posto. Gli archi da rimettere vicini fanno lo stesso, fra loro:
/// una serie di schede e una di archi non si mescolano, perché un arco va
/// rimesso dopo le sue schede.
pub fn inverse(patches: &[CanvasPatch]) -> Vec<CanvasPatch> {
    let mut inverse: Vec<CanvasPatch> = patches.iter().rev().map(invert).collect();
    let mut start = 0;
    while start < inverse.len() {
        let Some(list) = insert_list(&inverse[start]) else {
            start += 1;
            continue;
        };
        let mut end = start + 1;
        while end < inverse.len() && insert_list(&inverse[end]) == Some(list) {
            end += 1;
        }
        // Stabile, come `Array.prototype.sort`.
        inverse[start..end].sort_by_key(|patch| match patch {
            CanvasPatch::UpsertNode { at: Some(at), .. }
            | CanvasPatch::UpsertEdge { at: Some(at), .. } => (false, *at),
            _ => (true, 0),
        });
        start = end;
    }
    inverse
}

/// La lista in cui una toppa aggiunge una voce nuova: le schede o gli archi.
#[derive(Clone, Copy, PartialEq, Eq)]
enum List {
    Nodes,
    Edges,
}

fn insert_list(patch: &CanvasPatch) -> Option<List> {
    match patch {
        CanvasPatch::UpsertNode { before: None, .. } => Some(List::Nodes),
        CanvasPatch::UpsertEdge { before: None, .. } => Some(List::Edges),
        _ => None,
    }
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
            ..
        } => CanvasPatch::RemoveEdge {
            before: after.clone(),
            after: Null,
            at: None,
        },
        CanvasPatch::UpsertEdge {
            before: Some(before),
            after,
            ..
        } => CanvasPatch::UpsertEdge {
            before: Some(after.clone()),
            after: before.clone(),
            at: None,
        },
        CanvasPatch::RemoveEdge { before, at, .. } => CanvasPatch::UpsertEdge {
            before: None,
            after: before.clone(),
            at: *at,
        },
        CanvasPatch::Reorder { before, after } => CanvasPatch::Reorder {
            before: after.clone(),
            after: before.clone(),
        },
        CanvasPatch::Ink {
            layer,
            at,
            before,
            after,
        } => CanvasPatch::Ink {
            layer: layer.clone(),
            at: *at,
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
        at: None,
    })
}

/// La toppa che toglie l'arco `id`, con la sua posizione
/// (`removeEdgePatch`): `None` se l'arco non c'è.
pub fn remove_edge_patch(canvas: &Canvas, id: &str) -> Option<CanvasPatch> {
    let at = edge_position(canvas, id)?;
    let before = canvas.edges.get(at)?.clone();
    Some(CanvasPatch::RemoveEdge {
        before,
        after: Null,
        at: Some(at),
    })
}
