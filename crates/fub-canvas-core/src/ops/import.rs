//! `from_mermaid` e `from_outline`: un testo diventa schede di testo, gruppi e
//! archi, già disposti, come un blocco. I lettori e la disposizione stanno in
//! [`crate::import`]; qui si decidono gli id, il posto del blocco e le toppe.
//!
//! Il blocco va in `x`, `y`, accanto a `near` o nel posto automatico, con le
//! regole di `insert`. I gruppi entrano prima delle schede (il più fuori per
//! primo), così stanno sotto di loro; gli archi vanno in fondo alla lista. Le
//! note del lettore vanno in [`super::Compiled::notes`]. Le regole stanno in
//! `docs/reference/canvas-import.md`.

use serde::{Deserialize, Serialize};
use serde_json::Map;

use super::insert::{shifted, Place};
use super::layout::LayoutDirection;
use super::{invalid, saturating_option, whole, Compiler, OpError};
use crate::import::{self, mermaid, outline, End, ImportError, Sketch, MAX_TEXT};
use crate::layout::arrange::Direction;
use crate::model::{
    Canvas, CanvasEdge, CanvasEdgeEnd, CanvasEdgeSide, CanvasNode, CanvasNodeType, MAX_EDGES,
    MAX_NODES,
};
use crate::patch::CanvasPatch;

/// Gli argomenti di `from_mermaid`. Il posto è `x` e `y` (insieme), o `near`
/// (con `side`), o nessuno dei due: il posto automatico.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FromMermaidArgs {
    /// Il diagramma: `flowchart` o `graph`, al più 256 KiB.
    pub text: String,
    /// Dove va il bordo sinistro del blocco, insieme a `y`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub x: Option<i64>,
    /// Dove va il bordo alto del blocco, insieme a `x`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub y: Option<i64>,
    /// La scheda accanto alla quale va il blocco.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub near: Option<String>,
    /// Il lato di `near`; di serie `right`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<CanvasEdgeSide>,
    /// Il testo davanti a ogni id di Mermaid (`A` diventa `m-A`). Di serie
    /// nessuno.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

/// Gli argomenti di `from_outline`: come `from_mermaid`, più il verso
/// dell'albero.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FromOutlineArgs {
    /// La scaletta: una riga per scheda, rientrata di 2 spazi o un tab per
    /// livello, al più 256 KiB.
    pub text: String,
    /// Il verso dell'albero; di serie `right` (la radice a sinistra, i figli
    /// in colonna alla sua destra).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<LayoutDirection>,
    /// Dove va il bordo sinistro del blocco, insieme a `y`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub x: Option<i64>,
    /// Dove va il bordo alto del blocco, insieme a `x`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub y: Option<i64>,
    /// La scheda accanto alla quale va il blocco.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub near: Option<String>,
    /// Il lato di `near`; di serie `right`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<CanvasEdgeSide>,
    /// Con `prefix` l'id di una scheda è `prefix` più il numero della sua riga
    /// (da 1); senza, gli id vengono dal seme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

impl Compiler {
    /// `from_mermaid`: il diagramma come blocco. Gli id sono quelli di Mermaid,
    /// con `prefix` davanti.
    pub(super) fn import_mermaid(
        &mut self,
        index: usize,
        args: &FromMermaidArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let place = Place::new(index, args.x, args.y, args.near.as_deref(), args.side)?;
        within_text_limit(index, &args.text)?;
        let sketch = mermaid::read(&args.text).map_err(|error| failed(index, error))?;
        let prefix = args.prefix.as_deref().unwrap_or("");
        self.import(index, &sketch, &place, Some(prefix))
    }

    /// `from_outline`: la scaletta come albero, nel verso dato.
    pub(super) fn import_outline(
        &mut self,
        index: usize,
        args: &FromOutlineArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let place = Place::new(index, args.x, args.y, args.near.as_deref(), args.side)?;
        within_text_limit(index, &args.text)?;
        let direction = args.direction.map_or(Direction::Right, Direction::from);
        let sketch = outline::read(&args.text, direction).map_err(|error| failed(index, error))?;
        self.import(index, &sketch, &place, args.prefix.as_deref())
    }

    /// Le toppe di uno schizzo: i gruppi, poi le schede, poi gli archi. Con
    /// `prefix`, l'id di una scheda o di un gruppo è `prefix` più il suo nome, e
    /// un id preso è `DuplicateId`; senza, viene dal seme. Gli archi prendono
    /// sempre l'id dal seme.
    fn import(
        &mut self,
        index: usize,
        sketch: &Sketch,
        place: &Place<'_>,
        prefix: Option<&str>,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let count = sketch.nodes.len() + sketch.groups.len();
        if self.working.nodes.len() + count > MAX_NODES {
            return Err(OpError::TooMany {
                index,
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        if self.working.edges.len() + sketch.edges.len() > MAX_EDGES {
            return Err(OpError::TooMany {
                index,
                what: "edges",
                limit: MAX_EDGES,
            });
        }
        let arranged = import::arrange(sketch);
        let (to_x, to_y) = self.block_origin(index, place, arranged.size)?;

        // Prima gli id dati, tutti, poi quelli del seme: un id del seme non
        // prende il posto di un nome che viene dopo.
        let mut group_ids = Vec::with_capacity(sketch.groups.len());
        let mut node_ids = Vec::with_capacity(sketch.nodes.len());
        if let Some(prefix) = prefix {
            for name in sketch.groups.iter().map(|group| &group.name) {
                group_ids.push(self.claim_import_id(index, prefix, name)?);
            }
            for name in sketch.nodes.iter().map(|node| &node.name) {
                node_ids.push(self.claim_import_id(index, prefix, name)?);
            }
        } else {
            for _ in 0..count {
                let id = self.fresh_id();
                self.taken.insert(id.clone());
                if group_ids.len() < sketch.groups.len() {
                    group_ids.push(id);
                } else {
                    node_ids.push(id);
                }
            }
        }

        // I gruppi dal più fuori al più dentro: ognuno sta sotto i suoi.
        let mut groups_outer_first: Vec<usize> = (0..sketch.groups.len()).collect();
        groups_outer_first.sort_by_key(|&group| depth(sketch, group));
        let mut cards = Vec::with_capacity(count);
        for group in groups_outer_first {
            let rect = arranged.groups[group];
            cards.push(CanvasNode {
                id: group_ids[group].clone(),
                node_type: CanvasNodeType::Group,
                x: shifted(index, whole(index, rect.x)?, to_x)?,
                y: shifted(index, whole(index, rect.y)?, to_y)?,
                width: whole(index, rect.width)?,
                height: whole(index, rect.height)?,
                color: None,
                text: None,
                file: None,
                subpath: None,
                url: None,
                label: Some(sketch.groups[group].label.clone()),
                background: None,
                background_style: None,
                extra: Map::new(),
            });
        }
        for (node, rect) in sketch.nodes.iter().zip(&arranged.nodes) {
            cards.push(CanvasNode {
                id: node_ids[cards.len() - sketch.groups.len()].clone(),
                node_type: CanvasNodeType::Text,
                x: shifted(index, whole(index, rect.x)?, to_x)?,
                y: shifted(index, whole(index, rect.y)?, to_y)?,
                width: whole(index, rect.width)?,
                height: whole(index, rect.height)?,
                color: None,
                text: Some(node.text.clone()),
                file: None,
                subpath: None,
                url: None,
                label: None,
                background: None,
                background_style: None,
                extra: Map::new(),
            });
        }
        let id_of = |end: End| match end {
            End::Node(node) => node_ids[node].clone(),
            End::Group(group) => group_ids[group].clone(),
        };
        let mut links = Vec::with_capacity(sketch.edges.len());
        for edge in &sketch.edges {
            let id = self.fresh_id();
            self.taken.insert(id.clone());
            links.push(CanvasEdge {
                id,
                from_node: id_of(edge.from),
                to_node: id_of(edge.to),
                from_side: None,
                from_end: edge.from_arrow.then_some(CanvasEdgeEnd::Arrow),
                to_side: None,
                to_end: Some(if edge.to_arrow {
                    CanvasEdgeEnd::Arrow
                } else {
                    CanvasEdgeEnd::None
                }),
                color: None,
                label: edge.label.clone(),
                extra: Map::new(),
            });
        }
        // Il blocco si controlla come un modello a sé, con le regole del modello.
        let batch = Canvas {
            nodes: cards,
            edges: links,
            extra: Map::new(),
        };
        batch.validate().map_err(|error| invalid(index, &error))?;
        for (code, detail) in &sketch.notes.list {
            self.note(index, *code, detail.clone());
        }
        self.notes_omitted += sketch.notes.omitted;
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

    /// L'id `prefix` + `name`, se è libero: entra subito fra i presi.
    fn claim_import_id(
        &mut self,
        index: usize,
        prefix: &str,
        name: &str,
    ) -> Result<String, OpError> {
        let id = self.claim_text(index, &format!("{prefix}{name}"))?;
        self.taken.insert(id.clone());
        Ok(id)
    }
}

/// Quanti blocchi contengono il blocco `group`.
fn depth(sketch: &Sketch, group: usize) -> usize {
    let mut depth = 0;
    let mut parent = sketch.groups[group].parent;
    while let Some(outer) = parent {
        depth += 1;
        parent = sketch.groups[outer].parent;
    }
    depth
}

/// Il testo sta nel limite di [`MAX_TEXT`] byte.
fn within_text_limit(index: usize, text: &str) -> Result<(), OpError> {
    if text.len() > MAX_TEXT {
        return Err(OpError::TooMany {
            index,
            what: "bytes of text in one import",
            limit: MAX_TEXT,
        });
    }
    Ok(())
}

/// L'errore di un lettore come errore dell'operazione `index`.
fn failed(index: usize, error: ImportError) -> OpError {
    match error {
        ImportError::Invalid(reason) => OpError::Invalid { index, reason },
        ImportError::TooMany { what, limit } => OpError::TooMany { index, what, limit },
    }
}
