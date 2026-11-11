//! Le operazioni d'intento sulla lavagna (`CanvasOp`): «aggiungi», «sposta»,
//! «ridimensiona», «collega», «togli», «cambia», «porta sopra», «aggiungi
//! tratti», «cancella tratti». Un agente o
//! la sessione dal tablet pensano così, non in toppe con l'immagine di
//! prima: [`compile`] traduce una lista di operazioni nelle toppe di
//! [`crate::patch`], che sono la sola forma con cui una lavagna cambia.
//!
//! Le operazioni si compilano in ordine, ognuna sul modello lasciato dalla
//! precedente, e valgono tutte o nessuna: con un errore non esce nessuna
//! toppa. Le toppe compilate si applicano con [`patch::draft`] al modello di
//! partenza, e la loro [`patch::inverse`] lo ridà.
//!
//! Il modello di dopo resta valido: ogni scheda e ogni arco che
//! un'operazione mette passa le regole di [`Canvas::validate`], e i limiti
//! [`MAX_NODES`] e [`MAX_EDGES`] danno [`OpError::TooMany`]. `compile` si
//! aspetta un modello di partenza valido, come quello che dà
//! [`crate::parse`].
//!
//! Gli id nuovi vengono da un seme del chiamante ([`IdSource`]): stesso
//! seme, stessi id. Le regole e un esempio per operazione sono nella sezione
//! «Operazioni» di `docs/reference/canvas-operations.md`.

use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

use fub_ink_codec::brush::InkBrush;
use fub_ink_codec::ink::{round_half_up, Ink};

use crate::ink::{
    DrawnStroke, InkAnchor, InkLayer, InkStroke, LayerRef, StrokeState, INK_KEY, INK_MAX_BYTES,
};
use crate::js::js_number;
use crate::model::{
    Canvas, CanvasEdge, CanvasError, CanvasNode, CanvasNodeType, MAX_EDGES, MAX_NODES,
    MAX_SAFE_INTEGER,
};
use crate::patch::{self, upsert_edge_patch, upsert_node_patch, CanvasPatch, Null};

/// Un'operazione d'intento. La forma JSON ha il campo `op` per primo, in
/// `snake_case`; un campo che l'operazione non conosce è un errore di
/// lettura.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum CanvasOp {
    /// Aggiunge una scheda in cima all'ordine. `node` è una scheda come nel
    /// file; `id` è facoltativo (assente o `null`: lo dà il seme).
    AddCard { node: Map<String, Value> },
    /// Sposta le schede `ids` di `dx`, `dy`. Un gruppo si sposta da solo: le
    /// schede dentro restano dove sono, come sulla tela.
    Move {
        ids: Vec<String>,
        #[serde(deserialize_with = "saturating_integer")]
        dx: i64,
        #[serde(deserialize_with = "saturating_integer")]
        dy: i64,
    },
    /// Dà alla scheda `id` le misure `width` × `height`.
    Resize {
        id: String,
        #[serde(deserialize_with = "saturating_integer")]
        width: i64,
        #[serde(deserialize_with = "saturating_integer")]
        height: i64,
    },
    /// Aggiunge un arco in fondo alla lista. `edge` è un arco come nel file;
    /// `id` è facoltativo come in `add_card`.
    Connect { edge: Map<String, Value> },
    /// Toglie schede e archi. Gli archi che toccano una scheda tolta vanno
    /// via prima, nella stessa operazione.
    Remove { ids: Vec<String> },
    /// Cambia i campi di una scheda o di un arco; un campo `null` lo toglie.
    /// `id` (e `type` di una scheda) non si cambiano.
    Set {
        id: String,
        fields: Map<String, Value>,
    },
    /// Porta le schede `ids` in cima all'ordine, nell'ordine dato; le altre
    /// restano sotto nel loro ordine. Con tutti gli id, è l'ordine nuovo.
    Reorder { ids: Vec<String> },
    /// Aggiunge i tratti `strokes` in cima al livello `layer` (la radice o
    /// una scheda), nell'ordine dato. Ogni tratto è come nel file, campi
    /// sconosciuti compresi, e deve disegnarsi in quel livello; `id` è
    /// facoltativo (assente o `null`: lo dà il seme).
    AddStrokes {
        layer: LayerRef,
        strokes: Vec<Map<String, Value>>,
    },
    /// Cancella dal livello `layer` i tratti `ids`.
    EraseStrokes { layer: LayerRef, ids: Vec<String> },
    /// Sposta i tratti `ids` del livello `layer` di `dx`, `dy` in unità della
    /// lavagna. Con `to` diverso da `layer` i tratti passano a quel livello:
    /// i punti si riportano nelle unità della nuova ancora (`card` alla
    /// misura di adesso della scheda, o `free` sulla radice).
    MoveStrokes {
        layer: LayerRef,
        ids: Vec<String>,
        dx: f64,
        dy: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<LayerRef>,
    },
    /// Cambia il colore (`#rrggbb`) e lo spessore del pennello (`size`, in
    /// unità della lavagna) dei tratti `ids` del livello `layer`.
    RestyleStrokes {
        layer: LayerRef,
        ids: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        size: Option<f64>,
    },
}

/// Il risultato di [`compile`]: le toppe e gli id creati.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Compiled {
    /// Le toppe, nell'ordine in cui si applicano.
    pub patches: Vec<CanvasPatch>,
    /// Gli id di ogni scheda, arco e tratto aggiunti (`add_card`,
    /// `connect`, `add_strokes`), dati o generati, nell'ordine delle
    /// operazioni; e quelli nuovi dei tratti che `move_strokes` porta in un
    /// livello dove il loro id era già preso.
    pub created: Vec<String>,
}

/// Perché una lista di operazioni non si compila. `index` è la posizione
/// dell'operazione nella lista, da zero.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum OpError {
    /// L'operazione vuole una scheda che non c'è (`move`, `resize`,
    /// `reorder`, gli estremi di un arco).
    #[error("canvas op {index}: there is no node {id:?}")]
    UnknownNode { index: usize, id: String },
    /// `remove` o `set` di un id che non è né una scheda né un arco.
    #[error("canvas op {index}: there is no node or edge {id:?}")]
    UnknownEdge { index: usize, id: String },
    /// Un id dato che c'è già (nel modello di partenza o creato nello stesso
    /// giro; per un tratto, nel suo livello), o un id ripetuto nella lista
    /// `ids` di un'operazione.
    #[error("canvas op {index}: id {id:?} is already taken or repeated")]
    DuplicateId { index: usize, id: String },
    /// La lavagna avrebbe più schede o archi del limite.
    #[error("canvas op {index}: a canvas holds at most {limit} {what}")]
    TooMany {
        index: usize,
        what: &'static str,
        limit: usize,
    },
    /// L'operazione porterebbe a una scheda o a un arco non validi, o non si
    /// può fare così com'è (un campo vietato, un id ambiguo).
    #[error("canvas op {index}: {reason}")]
    Invalid { index: usize, reason: String },
    /// `erase_strokes`, `move_strokes` o `restyle_strokes` di un id che non è
    /// un tratto del livello.
    #[error("canvas op {index}: there is no ink stroke {id:?} in the layer")]
    UnknownStroke { index: usize, id: String },
    /// Il livello d'inchiostro è estraneo: Fub non ci scrive.
    #[error("canvas op {index}: the ink layer is foreign")]
    ForeignLayer { index: usize, layer: LayerRef },
}

impl OpError {
    /// La posizione dell'operazione che non si compila.
    pub fn index(&self) -> usize {
        match self {
            Self::UnknownNode { index, .. }
            | Self::UnknownEdge { index, .. }
            | Self::DuplicateId { index, .. }
            | Self::TooMany { index, .. }
            | Self::Invalid { index, .. }
            | Self::UnknownStroke { index, .. }
            | Self::ForeignLayer { index, .. } => *index,
        }
    }
}

/// La sorgente degli id nuovi: SplitMix64 sul seme del chiamante, scritto in
/// sedici cifre esadecimali minuscole, come gli id di Obsidian.
///
/// A ogni id: `state += 0x9E3779B97F4A7C15`; `z = state`;
/// `z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9`;
/// `z = (z ^ (z >> 27)) * 0x94D049BB133111EB`; `z ^= z >> 31` (aritmetica
/// a 64 bit che si avvolge). Il TypeScript lo rifà uguale.
#[derive(Clone, Debug)]
pub struct IdSource {
    state: u64,
}

impl IdSource {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    /// Il prossimo id, preso o no.
    pub fn next_id(&mut self) -> String {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        format!("{z:016x}")
    }
}

/// Compila `ops` in toppe sul modello `canvas`, con gli id nuovi dal seme
/// `seed`. Tutte le operazioni o nessuna: `canvas` non cambia mai.
pub fn compile(canvas: &Canvas, ops: &[CanvasOp], seed: u64) -> Result<Compiled, OpError> {
    let mut compiler = Compiler::new(canvas, seed);
    for (index, op) in ops.iter().enumerate() {
        compiler.op(index, op)?;
    }
    Ok(Compiled {
        patches: compiler.patches,
        created: compiler.created,
    })
}

struct Compiler {
    /// Il modello dopo le operazioni compilate finora.
    working: Canvas,
    patches: Vec<CanvasPatch>,
    created: Vec<String>,
    /// Gli id che un id nuovo deve saltare: quelli del modello di partenza,
    /// schede e archi, più ogni id entrato nel modello in questo giro.
    taken: HashSet<String>,
    ids: IdSource,
    /// Le posizioni delle schede all'inizio della serie di `remove-node` in
    /// corso (vedi [`Compiler::remove`]).
    run_start: Option<HashMap<String, usize>>,
    /// Le posizioni degli archi all'inizio della serie di `remove-edge` in
    /// corso, come `run_start` per le schede.
    edge_run_start: Option<HashMap<String, usize>>,
}

impl Compiler {
    fn new(canvas: &Canvas, seed: u64) -> Self {
        let taken = canvas
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .chain(canvas.edges.iter().map(|edge| edge.id.clone()))
            .collect();
        Self {
            working: canvas.clone(),
            patches: Vec::new(),
            created: Vec::new(),
            taken,
            ids: IdSource::new(seed),
            run_start: None,
            edge_run_start: None,
        }
    }

    fn op(&mut self, index: usize, op: &CanvasOp) -> Result<(), OpError> {
        let patches = match op {
            CanvasOp::AddCard { node } => self.add_card(index, node)?,
            CanvasOp::Move { ids, dx, dy } => self.move_nodes(index, ids, *dx, *dy)?,
            CanvasOp::Resize { id, width, height } => self.resize(index, id, *width, *height)?,
            CanvasOp::Connect { edge } => self.connect(index, edge)?,
            CanvasOp::Remove { ids } => self.remove(index, ids)?,
            CanvasOp::Set { id, fields } => self.set(index, id, fields)?,
            CanvasOp::Reorder { ids } => self.reorder(index, ids)?,
            CanvasOp::AddStrokes { layer, strokes } => self.add_strokes(index, layer, strokes)?,
            CanvasOp::EraseStrokes { layer, ids } => self.erase_strokes(index, layer, ids)?,
            CanvasOp::MoveStrokes {
                layer,
                ids,
                dx,
                dy,
                to,
            } => self.move_strokes(index, layer, ids, (*dx, *dy), to.as_ref())?,
            CanvasOp::RestyleStrokes {
                layer,
                ids,
                color,
                size,
            } => self.restyle_strokes(index, layer, ids, color.as_deref(), *size)?,
        };
        if patches.is_empty() {
            return Ok(());
        }
        // Le toppe sono fatte sul modello di adesso: se non si applicano è
        // un errore di questo modulo, e si dice come errore, non in panico.
        patch::apply(&mut self.working, &patches).map_err(|error| OpError::Invalid {
            index,
            reason: format!("the compiled patches do not apply ({error})"),
        })?;
        if !patches
            .last()
            .is_some_and(|patch| matches!(patch, CanvasPatch::RemoveNode { .. }))
        {
            self.run_start = None;
        }
        if !patches
            .last()
            .is_some_and(|patch| matches!(patch, CanvasPatch::RemoveEdge { .. }))
        {
            self.edge_run_start = None;
        }
        self.patches.extend(patches);
        Ok(())
    }

    fn node(&self, index: usize, id: &str) -> Result<&CanvasNode, OpError> {
        self.working
            .nodes
            .iter()
            .find(|node| node.id == id)
            .ok_or_else(|| OpError::UnknownNode {
                index,
                id: id.to_owned(),
            })
    }

    fn has_node(&self, id: &str) -> bool {
        self.working.nodes.iter().any(|node| node.id == id)
    }

    fn has_edge(&self, id: &str) -> bool {
        self.working.edges.iter().any(|edge| edge.id == id)
    }

    /// L'id di un elemento nuovo: quello dato, se è libero, o il prossimo
    /// libero del seme.
    fn claim_id(&mut self, index: usize, given: Option<&Value>) -> Result<String, OpError> {
        let id = match given {
            None | Some(Value::Null) => loop {
                let id = self.ids.next_id();
                if !self.taken.contains(&id) {
                    break id;
                }
            },
            Some(Value::String(id)) => {
                if self.taken.contains(id) {
                    return Err(OpError::DuplicateId {
                        index,
                        id: id.clone(),
                    });
                }
                id.clone()
            }
            Some(_) => {
                return Err(OpError::Invalid {
                    index,
                    reason: "`id` must be a string".to_owned(),
                })
            }
        };
        Ok(id)
    }

    fn add_card(
        &mut self,
        index: usize,
        node: &Map<String, Value>,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        if self.working.nodes.len() >= MAX_NODES {
            return Err(OpError::TooMany {
                index,
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        let id = self.claim_id(index, node.get("id"))?;
        let mut fields = node.clone();
        fields.insert("id".to_owned(), Value::String(id.clone()));
        let node: CanvasNode = from_fields(index, "node", fields)?;
        check_node(index, &node)?;
        self.taken.insert(id.clone());
        self.created.push(id);
        Ok(vec![CanvasPatch::UpsertNode {
            before: None,
            after: node,
            at: None,
        }])
    }

    fn move_nodes(
        &mut self,
        index: usize,
        ids: &[String],
        dx: i64,
        dy: i64,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        distinct(index, ids)?;
        let mut patches = Vec::new();
        for id in ids {
            let mut node = self.node(index, id)?.clone();
            node.x = saturate(node.x.saturating_add(dx));
            node.y = saturate(node.y.saturating_add(dy));
            check_node(index, &node)?;
            patches.extend(upsert_node_patch(&self.working, &node));
        }
        Ok(patches)
    }

    fn resize(
        &mut self,
        index: usize,
        id: &str,
        width: i64,
        height: i64,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let mut node = self.node(index, id)?.clone();
        node.width = width;
        node.height = height;
        check_node(index, &node)?;
        Ok(upsert_node_patch(&self.working, &node)
            .into_iter()
            .collect())
    }

    fn connect(
        &mut self,
        index: usize,
        edge: &Map<String, Value>,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        if self.working.edges.len() >= MAX_EDGES {
            return Err(OpError::TooMany {
                index,
                what: "edges",
                limit: MAX_EDGES,
            });
        }
        let id = self.claim_id(index, edge.get("id"))?;
        let mut fields = edge.clone();
        fields.insert("id".to_owned(), Value::String(id.clone()));
        let edge: CanvasEdge = from_fields(index, "edge", fields)?;
        self.check_edge(index, &edge)?;
        self.taken.insert(id.clone());
        self.created.push(id);
        Ok(vec![CanvasPatch::UpsertEdge {
            before: None,
            after: edge,
            at: None,
        }])
    }

    /// Toglie schede e archi: prima gli archi (quelli nominati e quelli che
    /// toccano una scheda tolta, dall'ultimo della lista al primo), poi le
    /// schede, nell'ordine dato.
    ///
    /// L'`at` di ogni `remove-node` è la posizione della scheda all'inizio
    /// della serie di `remove-node` in cui cade, anche se la serie viene da
    /// più operazioni: [`patch::inverse`] rimette le schede di una serie per
    /// `at` crescente, e così ognuna torna al suo posto. Gli archi fanno lo
    /// stesso con la serie di `remove-edge`: una serie continua da
    /// un'operazione `remove` che ha tolto solo archi.
    fn remove(&mut self, index: usize, ids: &[String]) -> Result<Vec<CanvasPatch>, OpError> {
        distinct(index, ids)?;
        let mut nodes = Vec::new();
        let mut edges = HashSet::new();
        for id in ids {
            match (self.has_node(id), self.has_edge(id)) {
                (true, true) => return Err(ambiguous(index, id)),
                (true, false) => nodes.push(id.as_str()),
                (false, true) => {
                    edges.insert(id.as_str());
                }
                (false, false) => {
                    return Err(OpError::UnknownEdge {
                        index,
                        id: id.clone(),
                    })
                }
            }
        }
        let gone: HashSet<&str> = nodes.iter().copied().collect();
        let doomed: Vec<&CanvasEdge> = self
            .working
            .edges
            .iter()
            .rev()
            .filter(|edge| {
                edges.contains(edge.id.as_str())
                    || gone.contains(edge.from_node.as_str())
                    || gone.contains(edge.to_node.as_str())
            })
            .collect();
        let continues_edge_run = self
            .patches
            .last()
            .is_some_and(|patch| matches!(patch, CanvasPatch::RemoveEdge { .. }));
        if !doomed.is_empty() && (!continues_edge_run || self.edge_run_start.is_none()) {
            self.edge_run_start = Some(
                self.working
                    .edges
                    .iter()
                    .enumerate()
                    .map(|(position, edge)| (edge.id.clone(), position))
                    .collect(),
            );
        }
        // Dall'ultimo al primo, ognuno con la sua posizione all'inizio della
        // serie: l'inversa li rimette per `at` crescente.
        let mut patches = Vec::with_capacity(doomed.len() + nodes.len());
        for edge in doomed {
            let at = self
                .edge_run_start
                .as_ref()
                .and_then(|positions| positions.get(&edge.id).copied());
            if at.is_none() {
                return Err(OpError::Invalid {
                    index,
                    reason: format!("edge {:?} has no position to restore", edge.id),
                });
            }
            patches.push(CanvasPatch::RemoveEdge {
                before: edge.clone(),
                after: Null,
                at,
            });
        }
        if nodes.is_empty() {
            return Ok(patches);
        }
        let continues_run = patches.is_empty()
            && self
                .patches
                .last()
                .is_some_and(|patch| matches!(patch, CanvasPatch::RemoveNode { .. }));
        if !continues_run || self.run_start.is_none() {
            self.run_start = Some(
                self.working
                    .nodes
                    .iter()
                    .enumerate()
                    .map(|(position, node)| (node.id.clone(), position))
                    .collect(),
            );
        }
        let positions = self.run_start.as_ref();
        for id in nodes {
            let before = self.node(index, id)?.clone();
            let at = positions.and_then(|positions| positions.get(id).copied());
            if at.is_none() {
                return Err(OpError::Invalid {
                    index,
                    reason: format!("node {id:?} has no position to restore"),
                });
            }
            patches.push(CanvasPatch::RemoveNode {
                before,
                after: Null,
                at,
            });
        }
        Ok(patches)
    }

    fn set(
        &mut self,
        index: usize,
        id: &str,
        fields: &Map<String, Value>,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        match (self.has_node(id), self.has_edge(id)) {
            (true, true) => Err(ambiguous(index, id)),
            (true, false) => {
                for key in ["id", "type"] {
                    if fields.contains_key(key) {
                        return Err(OpError::Invalid {
                            index,
                            reason: format!("`set` cannot change the node `{key}`"),
                        });
                    }
                }
                let node = self.node(index, id)?;
                let changed: CanvasNode = from_fields(index, "node", merged(index, node, fields)?)?;
                check_node(index, &changed)?;
                Ok(upsert_node_patch(&self.working, &changed)
                    .into_iter()
                    .collect())
            }
            (false, true) => {
                if fields.contains_key("id") {
                    return Err(OpError::Invalid {
                        index,
                        reason: "`set` cannot change the edge `id`".to_owned(),
                    });
                }
                let edge = self
                    .working
                    .edges
                    .iter()
                    .find(|edge| edge.id == id)
                    .ok_or_else(|| OpError::UnknownEdge {
                        index,
                        id: id.to_owned(),
                    })?;
                let changed: CanvasEdge = from_fields(index, "edge", merged(index, edge, fields)?)?;
                self.check_edge(index, &changed)?;
                Ok(upsert_edge_patch(&self.working, &changed)
                    .into_iter()
                    .collect())
            }
            (false, false) => Err(OpError::UnknownEdge {
                index,
                id: id.to_owned(),
            }),
        }
    }

    fn reorder(&mut self, index: usize, ids: &[String]) -> Result<Vec<CanvasPatch>, OpError> {
        distinct(index, ids)?;
        for id in ids {
            self.node(index, id)?;
        }
        let lifted: HashSet<&str> = ids.iter().map(String::as_str).collect();
        let before: Vec<String> = self
            .working
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect();
        let after: Vec<String> = before
            .iter()
            .filter(|id| !lifted.contains(id.as_str()))
            .cloned()
            .chain(ids.iter().cloned())
            .collect();
        if after == before {
            return Ok(Vec::new());
        }
        Ok(vec![CanvasPatch::Reorder { before, after }])
    }

    /// Il livello d'inchiostro `layer` com'è adesso: vuoto se chi lo tiene
    /// non ha la chiave. Una scheda che non c'è è `UnknownNode`, un livello
    /// estraneo `ForeignLayer`.
    fn ink_layer(&self, index: usize, layer: &LayerRef) -> Result<InkLayer, OpError> {
        let value = match layer {
            LayerRef::Board => self.working.extra.get(INK_KEY),
            LayerRef::Node(id) => self.node(index, id)?.extra.get(INK_KEY),
        };
        match value {
            None => Ok(InkLayer::default()),
            Some(value) => InkLayer::from_value(value).map_err(|_| OpError::ForeignLayer {
                index,
                layer: layer.clone(),
            }),
        }
    }

    /// Una toppa `ink` per tratto, in fondo al livello. Gli id generati
    /// saltano quelli del livello e quelli dati prima nella stessa
    /// operazione; un id dato che il livello ha già è `DuplicateId`.
    fn add_strokes(
        &mut self,
        index: usize,
        layer: &LayerRef,
        strokes: &[Map<String, Value>],
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let ink = self.ink_layer(index, layer)?;
        let mut taken: HashSet<String> = ink.strokes.iter().map(|s| s.id.clone()).collect();
        let start = ink.strokes.len();
        let mut patches = Vec::with_capacity(strokes.len());
        for (at, fields) in (start..).zip(strokes) {
            let id = match fields.get("id") {
                None | Some(Value::Null) => loop {
                    let id = self.ids.next_id();
                    if !taken.contains(&id) {
                        break id;
                    }
                },
                Some(Value::String(id)) if id.is_empty() => {
                    return Err(OpError::Invalid {
                        index,
                        reason: "a stroke `id` cannot be empty".to_owned(),
                    })
                }
                Some(Value::String(id)) if taken.contains(id) => {
                    return Err(OpError::DuplicateId {
                        index,
                        id: id.clone(),
                    })
                }
                Some(Value::String(id)) => id.clone(),
                Some(_) => {
                    return Err(OpError::Invalid {
                        index,
                        reason: "`id` must be a string".to_owned(),
                    })
                }
            };
            let mut fields = fields.clone();
            fields.insert("id".to_owned(), Value::String(id.clone()));
            let stroke = InkStroke::from_value(&Value::Object(fields)).map_err(|error| {
                OpError::Invalid {
                    index,
                    reason: format!("invalid stroke: {error}"),
                }
            })?;
            if let StrokeState::Kept(reason) = stroke.state(layer) {
                return Err(OpError::Invalid {
                    index,
                    reason: format!(
                        "stroke {id:?} cannot be drawn in this layer ({})",
                        reason.as_str()
                    ),
                });
            }
            patches.push(CanvasPatch::Ink {
                layer: layer.clone(),
                at,
                before: None,
                after: Some(stroke),
            });
            taken.insert(id.clone());
            self.created.push(id);
        }
        Ok(patches)
    }

    /// Una toppa `ink` per tratto, nell'ordine dato, ognuna con la posizione
    /// del tratto dopo quelle prima. Un tratto che non si disegna si
    /// conserva e non si cancella (`Invalid`).
    fn erase_strokes(
        &mut self,
        index: usize,
        layer: &LayerRef,
        ids: &[String],
    ) -> Result<Vec<CanvasPatch>, OpError> {
        distinct(index, ids)?;
        let mut strokes = self.ink_layer(index, layer)?.strokes;
        let mut patches = Vec::with_capacity(ids.len());
        for id in ids {
            let at = strokes
                .iter()
                .position(|stroke| stroke.id == *id)
                .ok_or_else(|| OpError::UnknownStroke {
                    index,
                    id: id.clone(),
                })?;
            let before = strokes.remove(at);
            if !before.state(layer).is_drawn() {
                return Err(OpError::Invalid {
                    index,
                    reason: format!("stroke {id:?} is not drawn, and Fub keeps it as it is"),
                });
            }
            patches.push(CanvasPatch::Ink {
                layer: layer.clone(),
                at,
                before: Some(before),
                after: None,
            });
        }
        Ok(patches)
    }

    /// Dove si disegna il livello `layer`: la scheda che lo tiene (il suo
    /// angolo e la misura dei suoi tratti) o la lavagna.
    fn frame(&self, index: usize, layer: &LayerRef) -> Result<Frame, OpError> {
        match layer {
            LayerRef::Board => Ok(Frame::Board),
            LayerRef::Node(id) => Ok(Frame::Card(self.node(index, id)?.clone())),
        }
    }

    /// I tratti `ids` del livello, nell'ordine dato, ognuno con la sua
    /// posizione e il suo disegno. Un id che non c'è è `UnknownStroke`, uno
    /// ripetuto `DuplicateId`; un tratto che non si disegna si conserva com'è
    /// (`Invalid`).
    fn drawn_strokes(
        &self,
        index: usize,
        layer: &LayerRef,
        ids: &[String],
    ) -> Result<(InkLayer, Vec<(usize, DrawnStroke)>), OpError> {
        distinct(index, ids)?;
        let ink = self.ink_layer(index, layer)?;
        let mut found = Vec::with_capacity(ids.len());
        for id in ids {
            let at = ink
                .strokes
                .iter()
                .position(|stroke| stroke.id == *id)
                .ok_or_else(|| OpError::UnknownStroke {
                    index,
                    id: id.clone(),
                })?;
            let StrokeState::Drawn(drawn) = ink.strokes[at].state(layer) else {
                return Err(OpError::Invalid {
                    index,
                    reason: format!("stroke {id:?} is not drawn, and Fub keeps it as it is"),
                });
            };
            found.push((at, *drawn));
        }
        Ok((ink, found))
    }

    /// Sposta i tratti `ids` di `delta` (unità della lavagna). Nello stesso
    /// livello cambia solo `ink`, una toppa per tratto al suo posto. In un
    /// altro livello (`to`) li toglie da `layer` come `erase_strokes`, poi li
    /// aggiunge in fondo a `to` nell'ordine dato, con l'ancora nuova; un id
    /// che `to` ha già ne prende uno nuovo dal seme.
    fn move_strokes(
        &mut self,
        index: usize,
        layer: &LayerRef,
        ids: &[String],
        delta: (f64, f64),
        to: Option<&LayerRef>,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        if !(delta.0.is_finite() && delta.1.is_finite()) {
            return Err(OpError::Invalid {
                index,
                reason: "`dx` and `dy` must be finite numbers".to_owned(),
            });
        }
        let (ink, found) = self.drawn_strokes(index, layer, ids)?;
        let source = self.frame(index, layer)?;
        let Some(target_ref) = to.filter(|to| *to != layer) else {
            let mut patches = Vec::with_capacity(found.len());
            for (at, drawn) in found {
                let before = &ink.strokes[at];
                let fit = source.fit(&drawn.anchor);
                if fit.s <= 0.0 {
                    return Err(hidden(index, &before.id));
                }
                let moved = shifted(&drawn.ink, 1.0, (delta.0 / fit.s, delta.1 / fit.s))
                    .map_err(|reason| stroke_error(index, &before.id, &reason))?;
                let mut after = before.clone();
                after.ink = Some(Value::String(moved));
                patches.push(CanvasPatch::Ink {
                    layer: layer.clone(),
                    at,
                    before: Some(before.clone()),
                    after: Some(after),
                });
            }
            return Ok(patches);
        };
        let target_ink = self.ink_layer(index, target_ref)?;
        let (anchor, origin) = match self.frame(index, target_ref)? {
            Frame::Board => (InkAnchor::Free, (0.0, 0.0)),
            Frame::Card(node) => (InkAnchor::card_of(&node), corner(&node)),
        };
        let start = source.corner();
        let mut taken: HashSet<String> = target_ink.strokes.iter().map(|s| s.id.clone()).collect();
        let mut remaining = ink.strokes;
        let mut patches = Vec::with_capacity(found.len() * 2);
        let mut additions = Vec::with_capacity(found.len());
        let mut end = target_ink.strokes.len();
        for (id, (_, drawn)) in ids.iter().zip(found) {
            let at = remaining
                .iter()
                .position(|stroke| stroke.id == *id)
                .ok_or_else(|| OpError::UnknownStroke {
                    index,
                    id: id.clone(),
                })?;
            let before = remaining.remove(at);
            let fit = source.fit(&drawn.anchor);
            if fit.s <= 0.0 {
                return Err(hidden(index, id));
            }
            // Il punto `p` dell'ancora vecchia sta sulla lavagna in
            // `angolo + fit + s·p`; nella nuova ancora, meno il suo angolo.
            let offset = (
                start.0 + fit.x + delta.0 - origin.0,
                start.1 + fit.y + delta.1 - origin.1,
            );
            let moved =
                shifted(&drawn.ink, fit.s, offset).map_err(|reason| stroke_error(index, id, &reason))?;
            let mut after = before.clone();
            after.ink = Some(Value::String(moved));
            after.anchor = Some(anchor.to_value());
            if fit.s != 1.0 {
                // Lo spessore segue i punti: il tratto si vede uguale.
                let brush = before.brush.as_ref().and_then(Value::as_str).unwrap_or("");
                let size = brush_size(&drawn.brush) * fit.s;
                let resized = resized_brush(brush, size).map_err(|reason| stroke_error(index, id, &reason))?;
                after.brush = Some(Value::String(resized));
            }
            if taken.contains(&after.id) {
                let fresh = loop {
                    let fresh = self.ids.next_id();
                    if !taken.contains(&fresh) {
                        break fresh;
                    }
                };
                after.id = fresh.clone();
                self.created.push(fresh);
            }
            if !after.state(target_ref).is_drawn() {
                return Err(OpError::Invalid {
                    index,
                    reason: format!("stroke {id:?} cannot be drawn in the new layer"),
                });
            }
            taken.insert(after.id.clone());
            patches.push(CanvasPatch::Ink {
                layer: layer.clone(),
                at,
                before: Some(before),
                after: None,
            });
            additions.push(CanvasPatch::Ink {
                layer: target_ref.clone(),
                at: end,
                before: None,
                after: Some(after),
            });
            end += 1;
        }
        patches.extend(additions);
        Ok(patches)
    }

    /// Cambia colore e spessore dei tratti `ids`, una toppa per tratto al
    /// suo posto; un tratto che resta uguale non ne ha. Lo spessore è in
    /// unità della lavagna: sul tratto di una scheda `scale` si divide per il
    /// suo fattore, così si vede come è chiesto.
    fn restyle_strokes(
        &mut self,
        index: usize,
        layer: &LayerRef,
        ids: &[String],
        color: Option<&str>,
        size: Option<f64>,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        if color.is_none() && size.is_none() {
            return Err(OpError::Invalid {
                index,
                reason: "`restyle_strokes` needs `color` or `size`".to_owned(),
            });
        }
        if let Some(color) = color {
            let digits = color.strip_prefix('#').unwrap_or("");
            if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(OpError::Invalid {
                    index,
                    reason: "`color` must be #rrggbb".to_owned(),
                });
            }
        }
        if size.is_some_and(|size| !(size.is_finite() && size > 0.0)) {
            return Err(OpError::Invalid {
                index,
                reason: "`size` must be a finite number greater than zero".to_owned(),
            });
        }
        let (ink, found) = self.drawn_strokes(index, layer, ids)?;
        let frame = self.frame(index, layer)?;
        let mut patches = Vec::with_capacity(found.len());
        for (at, drawn) in found {
            let before = &ink.strokes[at];
            let mut after = before.clone();
            if let Some(color) = color {
                after.color = Some(Value::String(color.to_owned()));
            }
            if let Some(size) = size {
                let fit = frame.fit(&drawn.anchor);
                if fit.s <= 0.0 {
                    return Err(hidden(index, &before.id));
                }
                let brush = before.brush.as_ref().and_then(Value::as_str).unwrap_or("");
                let resized =
                    resized_brush(brush, size / fit.s).map_err(|reason| stroke_error(index, &before.id, &reason))?;
                after.brush = Some(Value::String(resized));
            }
            if patch::same_stroke(before, &after) {
                continue;
            }
            patches.push(CanvasPatch::Ink {
                layer: layer.clone(),
                at,
                before: Some(before.clone()),
                after: Some(after),
            });
        }
        Ok(patches)
    }

    /// Un arco va bene se le sue schede ci sono e se passa le regole del
    /// modello.
    fn check_edge(&self, index: usize, edge: &CanvasEdge) -> Result<(), OpError> {
        let from = self.node(index, &edge.from_node)?.clone();
        let mut nodes = vec![from];
        if edge.to_node != edge.from_node {
            nodes.push(self.node(index, &edge.to_node)?.clone());
        }
        let alone = Canvas {
            nodes,
            edges: vec![edge.clone()],
            extra: Map::new(),
        };
        alone.validate().map_err(|error| invalid(index, &error))
    }
}

/// Dove si disegna un livello: la radice, o la scheda che lo tiene.
enum Frame {
    Board,
    Card(CanvasNode),
}

impl Frame {
    /// L'angolo in alto a sinistra, in unità della lavagna.
    fn corner(&self) -> (f64, f64) {
        match self {
            Frame::Board => (0.0, 0.0),
            Frame::Card(node) => corner(node),
        }
    }

    /// Come la resa porta un tratto con l'ancora `anchor` sulla lavagna:
    /// sulla radice com'è; su una scheda come dice «La misura della scheda»
    /// di `docs/reference/canvas-ink.md`.
    fn fit(&self, anchor: &InkAnchor) -> Fit {
        match (self, anchor) {
            (Frame::Card(node), InkAnchor::Card { width, height }) => ink_fit(node, *width, *height),
            _ => Fit::IDENTITY,
        }
    }
}

/// Da unità dell'ancora a unità della scheda di adesso: il punto `(px, py)`
/// va a `(x + s·px, y + s·py)`.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Fit {
    s: f64,
    x: f64,
    y: f64,
}

impl Fit {
    const IDENTITY: Fit = Fit {
        s: 1.0,
        x: 0.0,
        y: 0.0,
    };
    const HIDDEN: Fit = Fit {
        s: 0.0,
        x: 0.0,
        y: 0.0,
    };
}

#[allow(clippy::cast_precision_loss)]
fn corner(node: &CanvasNode) -> (f64, f64) {
    // Coordinate intere entro ±(2^53−1): il cast è esatto.
    (node.x as f64, node.y as f64)
}

/// Le estensioni delle schede `scale` (`canvas-ink.md`, «La misura della
/// scheda»): le immagini e il PDF.
const SCALED_EXTENSIONS: [&str; 13] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic", "tif", "tiff", "pdf",
];

/// Il modo `scale`: una scheda `file` il cui file, per l'estensione (senza
/// distinguere maiuscole), è un'immagine o un PDF. È la regola di
/// `inkFitMode` del client, con gli stessi vettori (`canvas-ink-fit/`).
fn scales(node: &CanvasNode) -> bool {
    if node.node_type != CanvasNodeType::File {
        return false;
    }
    let Some(file) = node.file.as_deref() else {
        return false;
    };
    let base = file.rsplit('/').next().unwrap_or("");
    let Some((stem, extension)) = base.rsplit_once('.') else {
        return false;
    };
    // `.png` da solo è un nome nascosto senza estensione.
    if stem.is_empty() {
        return false;
    }
    let extension = extension.to_ascii_lowercase();
    SCALED_EXTENSIONS.contains(&extension.as_str())
}

/// La regola `inkFit` del client: con `scale` lo stesso fattore nei due
/// sensi, il minore, centrato; con `fixed` il tratto resta com'è. Mai `NaN`.
#[allow(clippy::cast_precision_loss)]
fn ink_fit(node: &CanvasNode, ref_width: f64, ref_height: f64) -> Fit {
    if !scales(node) {
        return Fit::IDENTITY;
    }
    let (w, h) = (node.width as f64, node.height as f64);
    if !(ref_width.is_finite() && ref_height.is_finite() && ref_width > 0.0 && ref_height > 0.0) {
        return Fit::HIDDEN;
    }
    if !(w.is_finite() && h.is_finite() && w >= 0.0 && h >= 0.0) {
        return Fit::HIDDEN;
    }
    let s = (w / ref_width).min(h / ref_height);
    Fit {
        s,
        x: (w - ref_width * s) / 2.0,
        y: (h - ref_height * s) / 2.0,
    }
}

/// L'inchiostro `ink` coi punti `p` portati a `scale·p + offset` (unità
/// locali), riscritto. Con `scale` uguale a 1 i punti si spostano tutti
/// dello stesso intero, così la forma resta identica e cambia solo il primo
/// campione; altrimenti ogni punto si riquantizza con `floor(v + 0,5)`. Gli
/// altri canali non cambiano.
fn shifted(ink: &Ink, scale: f64, offset: (f64, f64)) -> Result<String, String> {
    let factor = ink.scale().factor();
    let width = ink.channels().len();
    let mut values = Vec::with_capacity(ink.len() * width);
    #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
    let integer = |value: f64| -> Result<i64, String> {
        if value.is_finite() && value.abs() <= MAX_SAFE_INTEGER as f64 {
            Ok(value as i64)
        } else {
            Err("the moved points are out of range".to_owned())
        }
    };
    let step = (
        integer(round_half_up(offset.0, factor))?,
        integer(round_half_up(offset.1, factor))?,
    );
    for i in 0..ink.len() {
        let sample = ink.sample(i);
        let (x, y) = if scale == 1.0 {
            (
                sample[0].checked_add(step.0).ok_or("the moved points are out of range")?,
                sample[1].checked_add(step.1).ok_or("the moved points are out of range")?,
            )
        } else {
            #[allow(clippy::cast_precision_loss)]
            let (x, y) = (sample[0] as f64, sample[1] as f64);
            (
                integer((scale * x + offset.0 * factor + 0.5).floor())?,
                integer((scale * y + offset.1 * factor + 0.5).floor())?,
            )
        };
        values.push(x);
        values.push(y);
        values.extend_from_slice(&sample[2..]);
    }
    let moved = Ink::new(ink.scale(), ink.channels(), values).map_err(|error| error.to_string())?;
    let text = moved.encode();
    if text.len() > INK_MAX_BYTES {
        return Err("the moved stroke is too large".to_owned());
    }
    Ok(text)
}

/// Lo spessore del pennello, in unità dell'ancora.
fn brush_size(brush: &InkBrush) -> f64 {
    match brush {
        InkBrush::Pf1(brush) => brush.size,
        InkBrush::Nib1(brush) => brush.size,
    }
}

/// Il pennello `brush` con lo spessore `size`: la voce `size=` cambia al suo
/// posto (o, se manca, entra dopo il nome dell'algoritmo), le altre restano
/// come sono scritte. Il risultato si deve rileggere.
fn resized_brush(brush: &str, size: f64) -> Result<String, String> {
    let value = format!("size={}", js_number(size));
    let mut tokens: Vec<String> = brush.split(' ').map(str::to_owned).collect();
    match tokens.iter().position(|token| token.starts_with("size=")) {
        Some(at) => tokens[at] = value,
        None => {
            let at = tokens.iter().position(|token| !token.is_empty()).map_or(tokens.len(), |at| at + 1);
            tokens.insert(at, value);
        }
    }
    let text = tokens.join(" ");
    InkBrush::parse(&text).map_err(|error| format!("the brush does not take the new size ({error})"))?;
    Ok(text)
}

fn hidden(index: usize, id: &str) -> OpError {
    OpError::Invalid {
        index,
        reason: format!("stroke {id:?} is not visible in its card (the card has no size)"),
    }
}

fn stroke_error(index: usize, id: &str, reason: &str) -> OpError {
    OpError::Invalid {
        index,
        reason: format!("stroke {id:?}: {reason}"),
    }
}

/// Una scheda va bene se passa le regole del modello, da sola.
fn check_node(index: usize, node: &CanvasNode) -> Result<(), OpError> {
    let alone = Canvas {
        nodes: vec![node.clone()],
        edges: Vec::new(),
        extra: Map::new(),
    };
    alone.validate().map_err(|error| invalid(index, &error))
}

fn invalid(index: usize, error: &CanvasError) -> OpError {
    OpError::Invalid {
        index,
        reason: error.to_string(),
    }
}

fn ambiguous(index: usize, id: &str) -> OpError {
    OpError::Invalid {
        index,
        reason: format!("id {id:?} is both a node and an edge"),
    }
}

/// Nessun id ripetuto nella lista.
fn distinct(index: usize, ids: &[String]) -> Result<(), OpError> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id.as_str()) {
            return Err(OpError::DuplicateId {
                index,
                id: id.clone(),
            });
        }
    }
    Ok(())
}

/// I campi di `current` con `fields` sopra: un valore sostituisce quello di
/// prima al suo posto, o va in fondo; `null` toglie il campo.
fn merged<T: Serialize>(
    index: usize,
    current: &T,
    fields: &Map<String, Value>,
) -> Result<Map<String, Value>, OpError> {
    let mut map = match serde_json::to_value(current) {
        Ok(Value::Object(map)) => map,
        Ok(_) | Err(_) => {
            return Err(OpError::Invalid {
                index,
                reason: "the element does not serialize as an object".to_owned(),
            })
        }
    };
    for (key, value) in fields {
        if value.is_null() {
            // `shift_remove`: con `preserve_order`, `remove` sposterebbe
            // l'ultimo campo al posto di quello tolto.
            map.shift_remove(key);
        } else {
            map.insert(key.clone(), value.clone());
        }
    }
    Ok(map)
}

/// Una scheda o un arco dai suoi campi, come nel file: un campo noto `null`
/// vale come assente (R7).
fn from_fields<T: for<'de> Deserialize<'de>>(
    index: usize,
    what: &str,
    mut fields: Map<String, Value>,
) -> Result<T, OpError> {
    fields.retain(|key, value| !(value.is_null() && is_known_optional(key)));
    serde_json::from_value(Value::Object(fields)).map_err(|error| OpError::Invalid {
        index,
        reason: format!("invalid {what}: {error}"),
    })
}

/// I campi noti facoltativi di schede e archi, dove `null` vuol dire
/// «assente» (R7). Un campo sconosciuto `null` resta `null`.
fn is_known_optional(key: &str) -> bool {
    matches!(
        key,
        "color"
            | "text"
            | "file"
            | "subpath"
            | "url"
            | "label"
            | "background"
            | "backgroundStyle"
            | "fromSide"
            | "fromEnd"
            | "toSide"
            | "toEnd"
    )
}

fn saturate(value: i64) -> i64 {
    value.clamp(-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER)
}

/// Un intero JSON (anche `1.0` o `1e2`) portato entro ±[`MAX_SAFE_INTEGER`]:
/// un valore più grande satura. Una frazione vera è un errore di lettura.
fn saturating_integer<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    struct Saturating;

    impl Visitor<'_> for Saturating {
        type Value = i64;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("an integer")
        }

        fn visit_i64<E: de::Error>(self, value: i64) -> Result<i64, E> {
            Ok(saturate(value))
        }

        fn visit_u64<E: de::Error>(self, value: u64) -> Result<i64, E> {
            Ok(saturate(i64::try_from(value).unwrap_or(i64::MAX)))
        }

        fn visit_f64<E: de::Error>(self, value: f64) -> Result<i64, E> {
            if !value.is_finite() || value.fract() != 0.0 {
                return Err(E::invalid_value(de::Unexpected::Float(value), &self));
            }
            let bound = MAX_SAFE_INTEGER as f64;
            // Dentro ±(2^53−1) un `f64` intero è esatto: il cast non
            // arrotonda.
            #[allow(clippy::cast_possible_truncation)]
            let integer = value.clamp(-bound, bound) as i64;
            Ok(integer)
        }
    }

    deserializer.deserialize_any(Saturating)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// La scheda di un vettore di `canvas-ink-fit/`, alla misura `size`.
    fn fit_card(card: &Value, size: &Value) -> CanvasNode {
        let mut fields = card.as_object().cloned().unwrap_or_default();
        fields.insert("id".to_owned(), json!("n"));
        fields.insert("x".to_owned(), json!(0));
        fields.insert("y".to_owned(), json!(0));
        fields.insert("width".to_owned(), size["width"].clone());
        fields.insert("height".to_owned(), size["height"].clone());
        serde_json::from_value(Value::Object(fields)).expect("la scheda del vettore")
    }

    /// La misura della scheda si calcola come nel client: gli stessi vettori
    /// di `inkFit` (`apps/client/src/__fixtures__/canvas-ink-fit/`).
    #[test]
    fn the_fit_follows_the_client_vectors() {
        let folder = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/client/src/__fixtures__/canvas-ink-fit");
        let mut seen = 0;
        for entry in std::fs::read_dir(folder).expect("la cartella dei vettori") {
            let path = entry.expect("una voce").path();
            let text = std::fs::read_to_string(&path).expect("il file");
            let vector: Value = serde_json::from_str(&text).expect("JSON");
            let name = vector["name"].as_str().unwrap_or_default();
            let node = fit_card(&vector["card"], &vector["size"]);
            let width = vector["ref"]["width"].as_f64().expect("ref.width");
            let height = vector["ref"]["height"].as_f64().expect("ref.height");
            let expect = &vector["expect"];
            assert_eq!(scales(&node), expect["mode"] == "scale", "{name}: il modo");
            let fit = ink_fit(&node, width, height);
            for (key, got) in [("s", fit.s), ("x", fit.x), ("y", fit.y)] {
                let want = expect[key].as_f64().expect("un numero");
                assert!((got - want).abs() < 1e-9, "{name}: {key} = {got}, non {want}");
            }
            seen += 1;
        }
        assert!(seen >= 20, "troppo pochi vettori: {seen}");
    }

    #[test]
    fn a_shift_by_whole_units_changes_only_the_first_sample() {
        let ink = Ink::decode("1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8").unwrap();
        assert_eq!(
            shifted(&ink, 1.0, (10.0, -0.004)).unwrap(),
            "1 s100 cxypt 13050,3020,128,0 25,-3,2,8 31,-5,0,8"
        );
        assert_eq!(
            shifted(&ink, 0.5, (1.0, 0.0)).unwrap(),
            "1 s100 cxypt 6125,1510,128,0 13,-1,2,8 15,-3,0,8"
        );
        let far = Ink::decode("1 s100 cxy 0,0").unwrap();
        assert!(shifted(&far, 1.0, (1e300, 0.0)).is_err());
    }

    #[test]
    fn the_brush_size_changes_in_place() {
        let pf1 = "pf1 size=3 thinning=0.5 pen=ballpoint";
        assert_eq!(
            resized_brush(pf1, 6.5).unwrap(),
            "pf1 size=6.5 thinning=0.5 pen=ballpoint"
        );
        assert_eq!(
            resized_brush("pf1 thinning=0.5", 2.0).unwrap(),
            "pf1 size=2 thinning=0.5"
        );
        assert_eq!(resized_brush("pf1", 2.0).unwrap(), "pf1 size=2");
        assert_eq!(
            resized_brush("nib1 size=12 tip=1", 4.0).unwrap(),
            "nib1 size=4 tip=1"
        );
        assert!(resized_brush(pf1, 0.0).is_err());
    }
}
