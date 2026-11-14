//! `group`: un gruppo attorno alle schede `ids`, col rettangolo che le racchiude
//! e un margine di 24 per lato, come «Raggruppa» della GUI. Il gruppo nasce
//! appena sotto la più bassa delle sue schede, così le copre e non le nasconde.
//! Le regole stanno in `docs/reference/canvas-code.md`, «Le operazioni».

use serde::{Deserialize, Serialize};
use serde_json::Map;

use super::{check_node, color, refuse, whole, Compiler, OpError};
use crate::layout::{self, Rect};
use crate::model::{CanvasNode, CanvasNodeType, MAX_NODES};
use crate::patch::CanvasPatch;

/// Il margine del gruppo attorno alle sue schede, per lato: come la GUI.
const MARGIN: f64 = 24.0;

/// Gli argomenti di `group`: le schede `ids` finiscono in un gruppo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupArgs {
    /// Le schede da raggruppare. Almeno una; un id che non è una scheda è
    /// `UnknownNode`.
    pub ids: Vec<String>,
    /// L'id del gruppo nuovo. Se manca lo dà il seme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// L'etichetta del gruppo. Di serie vuota.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Il colore del gruppo, come in `add_card`.
    #[serde(
        default,
        deserialize_with = "color::deserialize",
        skip_serializing_if = "Option::is_none"
    )]
    pub color: Option<String>,
}

impl Compiler {
    /// `group`: il gruppo nuovo, in cima alla lista ma sotto la più bassa delle
    /// sue schede. Se una scheda è già in un gruppo, il nuovo sta sopra quel
    /// gruppo, perché sta sotto le schede.
    pub(super) fn group(
        &mut self,
        index: usize,
        args: &GroupArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let members = self.cards(index, &args.ids)?;
        if members.is_empty() {
            return Err(refuse(index, "`group` needs at least one card in `ids`"));
        }
        if self.working.nodes.len() >= MAX_NODES {
            return Err(OpError::TooMany {
                index,
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        let rects: Vec<Rect> = members.iter().map(Rect::of_node).collect();
        let rect = layout::group_rect(&rects, MARGIN)
            .ok_or_else(|| refuse(index, "`group` needs at least one card in `ids`"))?;
        let color = match args.color.as_deref() {
            None => None,
            Some(text) => {
                Some(color::parse(text).ok_or_else(|| refuse(index, color::NOT_A_COLOR))?)
            }
        };
        let id = match &args.id {
            None => self.fresh_id(),
            Some(id) => self.claim_text(index, id)?,
        };
        // La posizione nella lista: quella della scheda più in basso fra quelle
        // raggruppate, così il gruppo le sta sotto.
        let at = self
            .working
            .nodes
            .iter()
            .position(|node| args.ids.contains(&node.id))
            .unwrap_or(self.working.nodes.len());
        let node = CanvasNode {
            id,
            node_type: CanvasNodeType::Group,
            x: whole(index, rect.x)?,
            y: whole(index, rect.y)?,
            width: whole(index, rect.width)?,
            height: whole(index, rect.height)?,
            color,
            text: None,
            file: None,
            subpath: None,
            url: None,
            label: Some(args.label.clone().unwrap_or_default()),
            background: None,
            background_style: None,
            extra: Map::new(),
        };
        check_node(index, &node)?;
        self.taken.insert(node.id.clone());
        self.created.push(node.id.clone());
        Ok(vec![CanvasPatch::UpsertNode {
            before: None,
            after: node,
            at: Some(at),
        }])
    }
}
