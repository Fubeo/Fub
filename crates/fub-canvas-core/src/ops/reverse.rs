//! `reverse`: inverte gli archi `ids`, come «Inverti il filo» della GUI
//! (`reversedEdge` di `model.ts`, #353). La partenza diventa l'arrivo, e ogni
//! lato e ogni punta vanno con la loro scheda: la freccia che stava su una
//! scheda ci resta, e cambia solo chi è la partenza e chi l'arrivo. Le regole stanno in `docs/reference/canvas-code.md`, «Le operazioni».

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

/// L'arco scambiato, come `reversedEdge` di `model.ts`. `fromNode` e `toNode`
/// si scambiano, e con loro i lati e le punte: la punta nuova alla partenza è
/// quella che l'arco mostrava all'arrivo, e viceversa. Una punta che il file
/// non scrive vale quella di serie di JSON Canvas (`fromEnd` `none`, `toEnd`
/// `arrow`); dopo lo scambio si scrive solo una punta che non è quella di
/// serie del suo posto, e un lato solo se c'era.
fn flipped(edge: &CanvasEdge) -> CanvasEdge {
    let start = edge.to_end.unwrap_or(CanvasEdgeEnd::Arrow);
    let finish = edge.from_end.unwrap_or(CanvasEdgeEnd::None);
    CanvasEdge {
        id: edge.id.clone(),
        from_node: edge.to_node.clone(),
        from_side: edge.to_side,
        from_end: (start != CanvasEdgeEnd::None).then_some(start),
        to_node: edge.from_node.clone(),
        to_side: edge.from_side,
        to_end: (finish != CanvasEdgeEnd::Arrow).then_some(finish),
        color: edge.color.clone(),
        label: edge.label.clone(),
        extra: edge.extra.clone(),
    }
}
