//! `reverse`: inverte gli archi `ids`, come «Inverti la direzione» della GUI. La
//! partenza diventa l'arrivo, e ogni lato va con la sua scheda. Le punte no: la
//! punta resta sul ruolo, `toEnd` è la punta all'arrivo, così la freccia cambia
//! verso. Le regole stanno in `docs/reference/canvas-code.md`, «Le operazioni».

use serde::{Deserialize, Serialize};

use super::{ambiguous, distinct, Compiler, OpError};
use crate::model::{CanvasEdge, CanvasEdgeEnd};
use crate::patch::{upsert_edge_patch, CanvasPatch};

/// Gli argomenti di `reverse`: gli archi da invertire.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReverseArgs {
    /// Gli archi da invertire. Un id che non è un arco è `UnknownEdge`.
    pub ids: Vec<String>,
}

impl Compiler {
    /// `reverse`: ogni arco di `ids` si scambia di verso.
    pub(super) fn reverse(
        &mut self,
        index: usize,
        args: &ReverseArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        distinct(index, &args.ids)?;
        let mut patches = Vec::new();
        for id in &args.ids {
            match (self.has_node(id), self.has_edge(id)) {
                (true, true) => return Err(ambiguous(index, id)),
                (true, false) | (false, false) => {
                    return Err(OpError::UnknownEdge {
                        index,
                        id: id.clone(),
                    })
                }
                (false, true) => {}
            }
            let edge = self
                .working
                .edges
                .iter()
                .find(|edge| edge.id == *id)
                .ok_or_else(|| OpError::UnknownEdge {
                    index,
                    id: id.clone(),
                })?;
            let flipped = flipped(edge);
            self.check_edge(index, &flipped)?;
            patches.extend(upsert_edge_patch(&self.working, &flipped));
        }
        Ok(patches)
    }
}

/// L'arco scambiato. `fromNode` e `toNode` si scambiano, con `fromSide` e
/// `toSide`. Le punte restano dove sono per ruolo: `fromEnd` alla partenza,
/// `toEnd` all'arrivo. Una punta che il file non scrive vale quella di serie di
/// JSON Canvas (`fromEnd` `none`, `toEnd` `arrow`), e si scrive prima di
/// scambiare, così il verso nuovo non ne cambia una per caso.
fn flipped(edge: &CanvasEdge) -> CanvasEdge {
    CanvasEdge {
        id: edge.id.clone(),
        from_node: edge.to_node.clone(),
        from_side: edge.to_side,
        from_end: Some(edge.from_end.unwrap_or(CanvasEdgeEnd::None)),
        to_node: edge.from_node.clone(),
        to_side: edge.from_side,
        to_end: Some(edge.to_end.unwrap_or(CanvasEdgeEnd::Arrow)),
        color: edge.color.clone(),
        label: edge.label.clone(),
        extra: edge.extra.clone(),
    }
}
