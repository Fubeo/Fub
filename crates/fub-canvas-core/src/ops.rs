//! Le operazioni d'intento sulla lavagna (`CanvasOp`): «aggiungi», «sposta»,
//! «ridimensiona», «collega», «togli», «cambia», «porta sopra», «allinea»,
//! «distribuisci», «duplica», «inverti», «raggruppa». Un agente o
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
//! [`crate::model::MAX_NODES`] e [`crate::model::MAX_EDGES`] danno
//! [`OpError::TooMany`]; il tetto di `move` con `contents` dà
//! [`OpError::TooManyMoved`]. `compile` si aspetta un modello di partenza
//! valido, come quello che dà [`crate::parse`].
//!
//! Gli id nuovi vengono da un seme del chiamante ([`IdSource`]): stesso
//! seme, stessi id. Le regole e un esempio per operazione sono nella sezione
//! «Le operazioni» di `docs/reference/canvas-code.md`.

use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

use crate::model::{Canvas, CanvasEdge, CanvasError, CanvasNode, MAX_SAFE_INTEGER};
use crate::patch::{self, upsert_edge_patch, upsert_node_patch, CanvasPatch, Null};

mod adjust;
mod align;
mod card;
pub(crate) mod color;
mod connect;
mod duplicate;
mod group;
mod reverse;

pub use adjust::{ColorArgs, Fit, MoveArgs, ReorderArgs, ReorderTo, ResizeArgs};
pub use align::{AlignArgs, AlignTo, DistributeArgs, DistributeAxis};
pub use card::AddCardArgs;
pub use connect::{AutoWord, ConnectArgs, Ends, SidePair, Sides};
pub use duplicate::DuplicateArgs;
pub use group::GroupArgs;
pub use reverse::ReverseArgs;

/// Un'operazione d'intento. La forma JSON ha il campo `op` per primo, in
/// `snake_case`; un campo che l'operazione non conosce è un errore di
/// lettura.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum CanvasOp {
    /// Aggiunge una scheda in cima all'ordine: la scheda come nel file
    /// (`node`), o la forma breve. Le regole sono in `ops/card.rs`.
    AddCard(AddCardArgs),
    /// Sposta le schede `ids`; con `contents` un gruppo porta le schede dentro
    /// di sé. Le regole sono in `ops/adjust.rs`.
    Move(MoveArgs),
    /// Dà alla scheda le misure, o con `fit` la misura del suo contenuto. Le
    /// regole sono in `ops/adjust.rs`.
    Resize(ResizeArgs),
    /// Aggiunge un arco in fondo alla lista: l'arco come nel file (`edge`), o
    /// la forma breve fra due schede. Le regole sono in `ops/connect.rs`.
    Connect(ConnectArgs),
    /// Toglie schede e archi. Gli archi che toccano una scheda tolta vanno
    /// via prima, nella stessa operazione.
    Remove { ids: Vec<String> },
    /// Cambia i campi di una scheda o di un arco; un campo `null` lo toglie.
    /// `id` (e `type` di una scheda) non si cambiano. Il `color` accetta i nomi
    /// di `add_card`.
    Set {
        id: String,
        #[serde(deserialize_with = "set_fields")]
        fields: Map<String, Value>,
    },
    /// Porta le schede in cima all'ordine (o in fondo, con `to: back`). Le
    /// regole sono in `ops/adjust.rs`.
    Reorder(ReorderArgs),
    /// Colora più schede e archi in una volta. Le regole sono in `ops/adjust.rs`.
    Color(ColorArgs),
    /// Allinea le schede al lato comune, come i bottoni della barra. Le regole
    /// sono in `ops/align.rs`.
    Align(AlignArgs),
    /// Distribuisce le schede lungo un asse. Le regole sono in `ops/align.rs`.
    Distribute(DistributeArgs),
    /// Copia le schede e gli archi che le collegano fra loro. Le regole sono in
    /// `ops/duplicate.rs`.
    Duplicate(DuplicateArgs),
    /// Inverte gli archi: la partenza diventa l'arrivo. Le regole sono in
    /// `ops/reverse.rs`.
    Reverse(ReverseArgs),
    /// Mette le schede in un gruppo, sotto di loro. Le regole sono in
    /// `ops/group.rs`.
    Group(GroupArgs),
}

impl CanvasOp {
    /// Il nome dell'operazione nella forma JSON, cioè il campo `op`. È la
    /// stessa stringa di [`crate::spec::OPS`]. Il `match` non ha `_`: una
    /// variante nuova senza nome non compila.
    pub fn name(&self) -> &'static str {
        match self {
            Self::AddCard(_) => "add_card",
            Self::Move(_) => "move",
            Self::Resize(_) => "resize",
            Self::Connect(_) => "connect",
            Self::Remove { .. } => "remove",
            Self::Set { .. } => "set",
            Self::Reorder(_) => "reorder",
            Self::Color(_) => "color",
            Self::Align(_) => "align",
            Self::Distribute(_) => "distribute",
            Self::Duplicate(_) => "duplicate",
            Self::Reverse(_) => "reverse",
            Self::Group(_) => "group",
        }
    }
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
    /// L'operazione vuole una scheda che non c'è (`move`, `resize`, `reorder`,
    /// `align`, `distribute`, `duplicate`, `group`, gli estremi di un arco).
    #[error("canvas op {index}: there is no node {id:?}")]
    UnknownNode { index: usize, id: String },
    /// `remove`, `set` o `color` di un id che non è né una scheda né un arco; e
    /// `reverse` di un id che non è un arco (anche se è una scheda).
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
    /// Un `move` con `contents` tocca più schede del tetto (quelle di `ids` e
    /// quelle che i gruppi portano con sé): la lista si divide in più `move`.
    #[error("canvas op {index}: `move` with `contents` moves at most {limit} cards")]
    TooManyMoved { index: usize, limit: usize },
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
            | Self::TooManyMoved { index, .. }
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
    /// Le posizioni degli archi all'inizio della serie di `remove-edge` in
    /// corso, come `run_start` per le schede.
    edge_run_start: Option<HashMap<String, usize>>,
    /// L'ultima scheda messa in fondo alla lista automatica di `add_card`: la
    /// prossima va sotto di lei, se è ancora nel modello.
    auto_last: Option<String>,
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
            auto_last: None,
        }
    }

    fn op(&mut self, index: usize, op: &CanvasOp) -> Result<(), OpError> {
        let patches = match op {
            CanvasOp::AddCard(card) => self.add_card(index, card)?,
            CanvasOp::Move(args) => self.move_nodes(index, args)?,
            CanvasOp::Resize(args) => self.resize(index, args)?,
            CanvasOp::Connect(link) => self.connect(index, link)?,
            CanvasOp::Remove { ids } => self.remove(index, ids)?,
            CanvasOp::Set { id, fields } => self.set(index, id, fields)?,
            CanvasOp::Reorder(args) => self.reorder(index, args)?,
            CanvasOp::Color(args) => self.color(index, args)?,
            CanvasOp::Align(args) => self.align(index, args)?,
            CanvasOp::Distribute(args) => self.distribute(index, args)?,
            CanvasOp::Duplicate(args) => self.duplicate(index, args)?,
            CanvasOp::Reverse(args) => self.reverse(index, args)?,
            CanvasOp::Group(args) => self.group(index, args)?,
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

    /// Le schede `ids` com'erano nel modello, nell'ordine dato. Un id ripetuto è
    /// `DuplicateId`; un id che non è una scheda è `UnknownNode`.
    fn cards(&self, index: usize, ids: &[String]) -> Result<Vec<CanvasNode>, OpError> {
        distinct(index, ids)?;
        ids.iter().map(|id| self.node(index, id).cloned()).collect()
    }

    fn has_node(&self, id: &str) -> bool {
        self.working.nodes.iter().any(|node| node.id == id)
    }

    fn has_edge(&self, id: &str) -> bool {
        self.working.edges.iter().any(|edge| edge.id == id)
    }

    /// L'id di un elemento nuovo: quello dato, se è libero, o il prossimo
    /// libero del seme. Un `id` che non è un testo non si legge.
    fn claim_id(&mut self, index: usize, given: Option<&Value>) -> Result<String, OpError> {
        match given {
            None | Some(Value::Null) => Ok(self.fresh_id()),
            Some(Value::String(id)) => self.claim_text(index, id),
            Some(_) => Err(OpError::Invalid {
                index,
                reason: "`id` must be a string".to_owned(),
            }),
        }
    }

    /// Il prossimo id del seme che non è preso.
    fn fresh_id(&mut self) -> String {
        loop {
            let id = self.ids.next_id();
            if !self.taken.contains(&id) {
                return id;
            }
        }
    }

    /// Un id dato a mano: `DuplicateId` se è già preso.
    fn claim_text(&mut self, index: usize, id: &str) -> Result<String, OpError> {
        if self.taken.contains(id) {
            return Err(OpError::DuplicateId {
                index,
                id: id.to_owned(),
            });
        }
        Ok(id.to_owned())
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
        // Un colore scritto con un nome diventa il valore del file, come in
        // `add_card`: `set` non legge i nomi da solo.
        let fields = color::canonical_fields(index, fields)?;
        let fields = fields.as_ref();
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

/// I campi di `set`: un oggetto, il cui `color` (se c'è e non è `null`) è un
/// colore che la tavola legge, come in `add_card`. Così un colore sbagliato è un
/// errore di lettura, come negli altri comandi che scrivono un colore.
fn set_fields<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Map<String, Value>, D::Error> {
    let fields = Map::<String, Value>::deserialize(deserializer)?;
    match fields.get("color") {
        None | Some(Value::Null) => Ok(fields),
        Some(Value::String(text)) if color::parse(text).is_some() => Ok(fields),
        Some(other) => Err(de::Error::custom(format_args!("unknown color {other}"))),
    }
}

/// Lo stesso di [`saturating_integer`], o assente: `null` vale come assente (R7).
fn saturating_option<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    #[derive(Deserialize)]
    struct Saturated(#[serde(deserialize_with = "saturating_integer")] i64);

    Ok(Option::<Saturated>::deserialize(deserializer)?.map(|Saturated(value)| value))
}

/// Un motivo di rifiuto di un'operazione di forma breve, con la sua posizione.
fn refuse(index: usize, reason: impl Into<String>) -> OpError {
    OpError::Invalid {
        index,
        reason: reason.into(),
    }
}

/// Un valore calcolato dal nucleo (un posto, una misura) come intero del
/// modello. Un valore non intero, o fuori dai limiti del modello, non entra.
fn whole(index: usize, value: f64) -> Result<i64, OpError> {
    let bound = MAX_SAFE_INTEGER as f64;
    if value.is_finite() && value.fract() == 0.0 && value.abs() <= bound {
        // Dentro ±(2^53−1) un `f64` intero è esatto: il cast non arrotonda.
        #[allow(clippy::cast_possible_truncation)]
        let integer = value as i64;
        Ok(integer)
    } else {
        Err(refuse(
            index,
            "a position or a size is not a whole number within the model limits",
        ))
    }
}
