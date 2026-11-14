//! `duplicate`: copia le schede `ids` e gli archi che hanno tutti e due gli
//! estremi fra le copie, come «Copia» della GUI. Le copie stanno in cima
//! all'ordine, sfalsate di `dx` e `dy` (di serie 32 e 32, agganciate a 8, come
//! `#duplicateSelection` di `engine.ts`). Un gruppo senza le sue schede si copia
//! da solo. Le regole stanno in `docs/reference/canvas-code.md`, «Le operazioni».

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Map;

use super::{invalid, refuse, saturate, saturating_option, whole, Compiler, OpError};
use crate::layout;
use crate::model::{Canvas, CanvasEdge, CanvasNode, MAX_EDGES, MAX_NODES};
use crate::patch::CanvasPatch;

/// Lo spostamento di serie di una copia, in unità della lavagna: come la GUI.
const SHIFT: i64 = 32;

/// Gli argomenti di `duplicate`. Le copie sono sfalsate di `dx` e `dy`; `as`
/// dà loro gli id, un id per scheda nell'ordine di `ids`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DuplicateArgs {
    /// Le schede da copiare. Un id che non è una scheda è `UnknownNode`.
    pub ids: Vec<String>,
    /// Lo spostamento in orizzontale delle copie; di serie 32. La posizione si
    /// aggancia a 8; satura a ±(2^53−1).
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub dx: Option<i64>,
    /// Lo spostamento in verticale delle copie, come `dx`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub dy: Option<i64>,
    /// Gli id delle copie, nell'ordine di `ids`. Se manca li dà il seme.
    #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
    pub copies: Option<Vec<String>>,
}

impl Compiler {
    /// `duplicate`: le schede copiate, poi gli archi copiati, in cima all'ordine.
    pub(super) fn duplicate(
        &mut self,
        index: usize,
        args: &DuplicateArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let originals = self.cards(index, &args.ids)?;
        if originals.is_empty() {
            return Ok(Vec::new());
        }
        if self.working.nodes.len() + originals.len() > MAX_NODES {
            return Err(OpError::TooMany {
                index,
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        let ids = self.copy_ids(index, args.copies.as_deref(), originals.len())?;
        let dx = args.dx.unwrap_or(SHIFT);
        let dy = args.dy.unwrap_or(SHIFT);
        let cards: Vec<CanvasNode> = originals
            .iter()
            .zip(&ids)
            .map(|(original, id)| {
                let mut copy = original.clone();
                copy.id.clone_from(id);
                copy.x = shifted(index, original.x, dx)?;
                copy.y = shifted(index, original.y, dy)?;
                Ok(copy)
            })
            .collect::<Result<_, OpError>>()?;
        // Gli archi copiati: quelli con tutti e due gli estremi fra le schede
        // duplicate, nell'ordine della lavagna.
        let copied: HashMap<&str, &str> = args
            .ids
            .iter()
            .map(String::as_str)
            .zip(ids.iter().map(String::as_str))
            .collect();
        let inside: Vec<CanvasEdge> = self
            .working
            .edges
            .iter()
            .filter_map(|edge| {
                let from = copied.get(edge.from_node.as_str())?;
                let to = copied.get(edge.to_node.as_str())?;
                let mut copy = edge.clone();
                copy.from_node = (*from).to_owned();
                copy.to_node = (*to).to_owned();
                Some(copy)
            })
            .collect();
        if self.working.edges.len() + inside.len() > MAX_EDGES {
            return Err(OpError::TooMany {
                index,
                what: "edges",
                limit: MAX_EDGES,
            });
        }
        let mut edges = Vec::with_capacity(inside.len());
        for mut copy in inside {
            copy.id = self.fresh_id();
            self.taken.insert(copy.id.clone());
            edges.push(copy);
        }
        // Le copie si controllano come un modello a sé: le schede e gli archi
        // nuovi, con le regole del modello (il modello di lavoro non le ha
        // ancora).
        let batch = Canvas {
            nodes: cards.clone(),
            edges: edges.clone(),
            extra: Map::new(),
        };
        batch.validate().map_err(|error| invalid(index, &error))?;
        // Gli id dati in `created`: prima le schede, poi gli archi.
        self.created.extend(ids.iter().cloned());
        self.created.extend(edges.iter().map(|edge| edge.id.clone()));
        let patches = cards
            .into_iter()
            .map(|card| CanvasPatch::UpsertNode {
                before: None,
                after: card,
                at: None,
            })
            .chain(edges.into_iter().map(|edge| CanvasPatch::UpsertEdge {
                before: None,
                after: edge,
                at: None,
            }))
            .collect();
        Ok(patches)
    }

    /// Gli id delle copie: quelli di `as` (uno per scheda, liberi e distinti), o
    /// quelli del seme. Ogni id preso va in `taken` subito, così due copie non
    /// ne hanno uno uguale e gli archi nuovi non lo riprendono.
    fn copy_ids(
        &mut self,
        index: usize,
        given: Option<&[String]>,
        count: usize,
    ) -> Result<Vec<String>, OpError> {
        let mut ids = Vec::with_capacity(count);
        match given {
            Some(list) => {
                if list.len() != count {
                    return Err(refuse(
                        index,
                        format!(
                            "`as` gives {} ids for {count} cards: one id for each card in `ids`",
                            list.len()
                        ),
                    ));
                }
                for id in list {
                    let id = self.claim_text(index, id)?;
                    self.taken.insert(id.clone());
                    ids.push(id);
                }
            }
            None => {
                for _ in 0..count {
                    let id = self.fresh_id();
                    self.taken.insert(id.clone());
                    ids.push(id);
                }
            }
        }
        Ok(ids)
    }
}

/// La posizione di una copia: quella dell'originale più lo spostamento,
/// agganciata a 8 come `#duplicateSelection` di `engine.ts`.
fn shifted(index: usize, at: i64, by: i64) -> Result<i64, OpError> {
    let sum = saturate(at.saturating_add(by));
    whole(index, layout::snap(sum as f64))
}
