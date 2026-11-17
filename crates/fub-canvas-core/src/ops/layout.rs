//! `layout`: dispone le schede in griglia, in riga, in colonna o ad albero, come
//! quando si lasciano cadere più file insieme. Le posizioni le dà
//! [`arrange`], con la stessa regola per tutte le disposizioni; qui si decide che
//! cosa si muove. Un gruppo nella lista va come un blocco, con le schede dentro;
//! una scheda dentro un gruppo della lista va con lui, una volta sola; senza
//! `ids` si dispongono le schede che non stanno in un gruppo. Le regole stanno in
//! `docs/reference/canvas-code.md`, «Le operazioni».

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::{check_node, refuse, saturate, saturating_option, whole, Compiler, OpError};
use crate::layout::arrange::{self, Direction};
use crate::layout::{self, snap};
use crate::model::{CanvasNode, CanvasNodeType};
use crate::patch::{upsert_node_patch, CanvasPatch};

/// Lo spazio di serie fra due schede vicine, come in `arrange`.
const GAP: i64 = 24;

/// La disposizione: come si mettono le schede.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutKind {
    /// In griglia: `ceil(√n)` colonne, riempite per righe.
    Grid,
    /// Una riga, nell'ordine dato.
    Row,
    /// Una colonna, nell'ordine dato.
    Column,
    /// Un albero a strati, con gli archi fra le schede date.
    Tree,
}

/// Il verso di un albero: da quale lato parte la radice.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutDirection {
    /// La radice in alto, gli strati scendono (di serie).
    Down,
    /// La radice a sinistra, gli strati vanno a destra.
    Right,
    /// La radice in basso, gli strati salgono.
    Up,
    /// La radice a destra, gli strati vanno a sinistra.
    Left,
}

impl From<LayoutDirection> for Direction {
    fn from(direction: LayoutDirection) -> Self {
        match direction {
            LayoutDirection::Down => Self::Down,
            LayoutDirection::Right => Self::Right,
            LayoutDirection::Up => Self::Up,
            LayoutDirection::Left => Self::Left,
        }
    }
}

/// Gli argomenti di `layout`. L'origine (`x` e `y`, insieme) è l'angolo in alto a
/// sinistra della disposizione, agganciato a 8; senza, è quello delle schede date.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutArgs {
    /// Le schede da disporre, nell'ordine dato. Senza, o `null`: tutte le schede
    /// che non stanno in un gruppo, nell'ordine della lavagna.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
    /// La disposizione.
    pub kind: LayoutKind,
    /// Lo spazio fra due schede vicine, in unità della lavagna; di serie 24. Non
    /// negativo. Fra gli strati di un albero lo spazio è fisso.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub gap: Option<i64>,
    /// La coordinata orizzontale dell'origine. Va con `y`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub x: Option<i64>,
    /// La coordinata verticale dell'origine. Va con `x`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub y: Option<i64>,
    /// Il verso di un albero (`tree`); di serie `down`. Con le altre disposizioni
    /// non si dà.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<LayoutDirection>,
}

impl Compiler {
    /// `layout`: ogni blocco va nella sua posizione della disposizione, e le
    /// schede che un gruppo porta con sé si spostano della stessa quantità.
    pub(super) fn layout(
        &mut self,
        index: usize,
        args: &LayoutArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let gap = gap_of(index, args.gap)?;
        let given_origin = origin_of(index, args.x, args.y)?;
        if args.direction.is_some() && args.kind != LayoutKind::Tree {
            return Err(refuse(index, "`direction` goes with `tree` only"));
        }
        let listed = match &args.ids {
            Some(ids) => self.cards(index, ids)?,
            None => self.loose_cards(),
        };
        let blocks = blocks_of(&listed);
        if blocks.is_empty() {
            return Ok(Vec::new());
        }
        let carried = self.carried_by(&blocks);
        let origin = match given_origin {
            Some((x, y)) => (snap(x as f64), snap(y as f64)),
            None => corner(&blocks),
        };
        let sizes: Vec<(f64, f64)> = blocks
            .iter()
            .map(|block| (block.width as f64, block.height as f64))
            .collect();
        let placed = self.arrange_blocks(args, &blocks, &sizes, gap, origin);
        let mut patches = Vec::new();
        for ((block, &(x, y)), followers) in blocks.iter().zip(&placed).zip(&carried) {
            let (x, y) = (whole(index, x.round())?, whole(index, y.round())?);
            let (dx, dy) = (x - block.x, y - block.y);
            let mut moved = block.clone();
            moved.x = x;
            moved.y = y;
            check_node(index, &moved)?;
            patches.extend(upsert_node_patch(&self.working, &moved));
            for &position in followers {
                let mut node = self.working.nodes[position].clone();
                node.x = saturate(node.x.saturating_add(dx));
                node.y = saturate(node.y.saturating_add(dy));
                check_node(index, &node)?;
                patches.extend(upsert_node_patch(&self.working, &node));
            }
        }
        Ok(patches)
    }

    /// Le schede senza `ids`: quelle che non sono gruppi e non stanno dentro
    /// nessun gruppo, nell'ordine della lavagna.
    fn loose_cards(&self) -> Vec<CanvasNode> {
        let groups: Vec<&CanvasNode> = self
            .working
            .nodes
            .iter()
            .filter(|node| node.node_type == CanvasNodeType::Group)
            .collect();
        self.working
            .nodes
            .iter()
            .filter(|node| {
                node.node_type != CanvasNodeType::Group
                    && !groups.iter().any(|group| layout::inside(node, group))
            })
            .cloned()
            .collect()
    }

    /// Per ogni blocco, le posizioni nel modello delle schede che si muovono con
    /// lui: quelle che non sono blocchi e stanno dentro il suo rettangolo, se è un
    /// gruppo. Una scheda dentro due gruppi della lista va con il primo.
    fn carried_by(&self, blocks: &[CanvasNode]) -> Vec<Vec<usize>> {
        let mut carried = vec![Vec::new(); blocks.len()];
        let groups: Vec<(usize, &CanvasNode)> = blocks
            .iter()
            .enumerate()
            .filter(|(_, block)| block.node_type == CanvasNodeType::Group)
            .collect();
        if groups.is_empty() {
            return carried;
        }
        let blocked: HashSet<&str> = blocks.iter().map(|block| block.id.as_str()).collect();
        for (position, node) in self.working.nodes.iter().enumerate() {
            if blocked.contains(node.id.as_str()) {
                continue;
            }
            if let Some(&(block, _)) = groups.iter().find(|(_, group)| carries(group, node)) {
                carried[block].push(position);
            }
        }
        carried
    }

    /// Le posizioni dei blocchi (`x`, `y`) nell'ordine dato, con la disposizione
    /// di `args` e l'origine. Un albero usa gli archi fra i blocchi.
    fn arrange_blocks(
        &self,
        args: &LayoutArgs,
        blocks: &[CanvasNode],
        sizes: &[(f64, f64)],
        gap: f64,
        origin: (f64, f64),
    ) -> Vec<(f64, f64)> {
        match args.kind {
            LayoutKind::Grid => arrange::grid(sizes, gap, origin),
            LayoutKind::Row => arrange::row(sizes, gap, origin),
            LayoutKind::Column => arrange::column(sizes, gap, origin),
            LayoutKind::Tree => {
                let direction = args.direction.map_or(Direction::Down, Direction::from);
                let at: HashMap<&str, usize> = blocks
                    .iter()
                    .enumerate()
                    .map(|(position, block)| (block.id.as_str(), position))
                    .collect();
                let edges: Vec<(usize, usize)> = self
                    .working
                    .edges
                    .iter()
                    .filter_map(|edge| {
                        Some((
                            *at.get(edge.from_node.as_str())?,
                            *at.get(edge.to_node.as_str())?,
                        ))
                    })
                    .collect();
                arrange::tree(sizes, &edges, direction, gap)
                    .into_iter()
                    .map(|(x, y)| (x + origin.0, y + origin.1))
                    .collect()
            }
        }
    }
}

/// Se `group` porta con sé `node`: `node` sta dentro il rettangolo del gruppo.
/// Due gruppi con lo stesso rettangolo non si portano a vicenda: così il legame
/// è un ordine stretto, e nessun gruppo resta senza blocco.
fn carries(group: &CanvasNode, node: &CanvasNode) -> bool {
    group.node_type == CanvasNodeType::Group
        && layout::inside(node, group)
        && !(node.node_type == CanvasNodeType::Group && same_rect(node, group))
}

fn same_rect(left: &CanvasNode, right: &CanvasNode) -> bool {
    left.x == right.x
        && left.y == right.y
        && left.width == right.width
        && left.height == right.height
}

/// I blocchi di una lista: le schede che nessun gruppo della lista porta con sé.
/// Una scheda data insieme al gruppo che la contiene si muove con il gruppo, una
/// volta sola.
fn blocks_of(listed: &[CanvasNode]) -> Vec<CanvasNode> {
    let groups: Vec<&CanvasNode> = listed
        .iter()
        .filter(|node| node.node_type == CanvasNodeType::Group)
        .collect();
    listed
        .iter()
        .filter(|node| !groups.iter().any(|group| carries(group, node)))
        .cloned()
        .collect()
}

/// L'angolo in alto a sinistra dei blocchi, agganciato a 8.
fn corner(blocks: &[CanvasNode]) -> (f64, f64) {
    let x = blocks.iter().map(|block| block.x).min().unwrap_or(0);
    let y = blocks.iter().map(|block| block.y).min().unwrap_or(0);
    (snap(x as f64), snap(y as f64))
}

/// Lo spazio dato, o quello di serie. Non negativo.
fn gap_of(index: usize, gap: Option<i64>) -> Result<f64, OpError> {
    match gap {
        None => Ok(GAP as f64),
        Some(gap) if gap < 0 => Err(refuse(index, "`gap` is not negative")),
        Some(gap) => Ok(gap as f64),
    }
}

/// L'origine data: `x` e `y` insieme, o nessuno dei due.
fn origin_of(index: usize, x: Option<i64>, y: Option<i64>) -> Result<Option<(i64, i64)>, OpError> {
    match (x, y) {
        (None, None) => Ok(None),
        (Some(x), Some(y)) => Ok(Some((x, y))),
        _ => Err(refuse(index, "`x` and `y` go together: give both or none")),
    }
}
