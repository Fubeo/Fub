//! Le operazioni d'intento sulla lavagna (`CanvasOp`): «aggiungi», «sposta»,
//! «ridimensiona», «collega», «togli», «cambia», «porta sopra». Un agente o
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

use crate::model::{
    Canvas, CanvasEdge, CanvasError, CanvasNode, MAX_EDGES, MAX_NODES, MAX_SAFE_INTEGER,
};
use crate::patch::{
    self, remove_edge_patch, upsert_edge_patch, upsert_node_patch, CanvasPatch, Null,
};

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
}

/// Il risultato di [`compile`]: le toppe e gli id creati.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Compiled {
    /// Le toppe, nell'ordine in cui si applicano.
    pub patches: Vec<CanvasPatch>,
    /// Gli id di ogni scheda e arco aggiunti (`add_card`, `connect`), dati
    /// o generati, nell'ordine delle operazioni.
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
    /// giro), o un id ripetuto nella lista `ids` di un'operazione.
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
}

impl OpError {
    /// La posizione dell'operazione che non si compila.
    pub fn index(&self) -> usize {
        match self {
            Self::UnknownNode { index, .. }
            | Self::UnknownEdge { index, .. }
            | Self::DuplicateId { index, .. }
            | Self::TooMany { index, .. }
            | Self::Invalid { index, .. } => *index,
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
        }])
    }

    /// Toglie schede e archi: prima gli archi (quelli nominati e quelli che
    /// toccano una scheda tolta, dall'ultimo della lista al primo), poi le
    /// schede, nell'ordine dato.
    ///
    /// L'`at` di ogni `remove-node` è la posizione della scheda all'inizio
    /// della serie di `remove-node` in cui cade, anche se la serie viene da
    /// più operazioni: [`patch::inverse`] rimette le schede di una serie per
    /// `at` crescente, e così ognuna torna al suo posto.
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
        // Dall'ultimo al primo: l'inversa li rimette in fondo alla lista in
        // ordine inverso, cioè in quello di prima.
        let mut patches: Vec<CanvasPatch> = self
            .working
            .edges
            .iter()
            .rev()
            .filter(|edge| {
                edges.contains(edge.id.as_str())
                    || gone.contains(edge.from_node.as_str())
                    || gone.contains(edge.to_node.as_str())
            })
            .filter_map(|edge| remove_edge_patch(&self.working, &edge.id))
            .collect();
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
