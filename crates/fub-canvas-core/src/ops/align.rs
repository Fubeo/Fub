//! `align` e `distribute`: i bottoni di allineamento e di distribuzione della
//! barra, come una riga di codice. Le posizioni le dà [`layout::arrange`], con
//! la stessa regola di `engine.ts` (`#layoutSelection`); qui si scrivono le toppe
//! delle sole schede che cambiano posto. Le regole stanno in
//! `docs/reference/canvas-code.md`, «Le operazioni».

use serde::{Deserialize, Serialize};

use super::{check_node, whole, Compiler, OpError};
use crate::layout::arrange::{self, Align, Axis};
use crate::layout::Rect;
use crate::model::CanvasNode;
use crate::patch::{upsert_node_patch, CanvasPatch};

/// Il lato comune di `align`: i sei bottoni della barra.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlignTo {
    /// Il bordo sinistro comune, quello più a sinistra del gruppo.
    Left,
    /// Il centro orizzontale comune.
    Center,
    /// Il bordo destro comune, quello più a destra del gruppo.
    Right,
    /// Il bordo alto comune, quello più in alto del gruppo.
    Top,
    /// Il centro verticale comune.
    Middle,
    /// Il bordo basso comune, quello più in basso del gruppo.
    Bottom,
}

impl From<AlignTo> for Align {
    fn from(to: AlignTo) -> Self {
        match to {
            AlignTo::Left => Self::Left,
            AlignTo::Center => Self::Center,
            AlignTo::Right => Self::Right,
            AlignTo::Top => Self::Top,
            AlignTo::Middle => Self::Middle,
            AlignTo::Bottom => Self::Bottom,
        }
    }
}

/// L'asse di `distribute`: `x` per i centri in orizzontale, `y` in verticale.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DistributeAxis {
    /// I centri da sinistra a destra.
    X,
    /// I centri dall'alto in basso.
    Y,
}

impl From<DistributeAxis> for Axis {
    fn from(axis: DistributeAxis) -> Self {
        match axis {
            DistributeAxis::X => Self::Horizontal,
            DistributeAxis::Y => Self::Vertical,
        }
    }
}

/// Gli argomenti di `align`: le schede `ids` vanno al lato comune `to`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AlignArgs {
    /// Le schede da allineare. Con meno di due non si sposta niente.
    pub ids: Vec<String>,
    /// Il lato comune, come i bottoni della barra.
    pub to: AlignTo,
}

/// Gli argomenti di `distribute`: le schede `ids` si distribuiscono lungo `axis`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DistributeArgs {
    /// Le schede da distribuire. Le due estreme restano dove sono; con meno di
    /// tre non si sposta niente.
    pub ids: Vec<String>,
    /// L'asse dei centri: `x` o `y`.
    pub axis: DistributeAxis,
}

impl Compiler {
    /// `align`: ogni scheda va al lato comune del gruppo, agganciato a 8.
    pub(super) fn align(
        &mut self,
        index: usize,
        args: &AlignArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let cards = self.cards(index, &args.ids)?;
        let rects: Vec<Rect> = cards.iter().map(Rect::of_node).collect();
        let positions = arrange::align(&rects, args.to.into());
        self.place_cards(index, cards, &positions)
    }

    /// `distribute`: le schede di mezzo hanno il centro a passi uguali fra le
    /// estreme, agganciato a 8.
    pub(super) fn distribute(
        &mut self,
        index: usize,
        args: &DistributeArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let cards = self.cards(index, &args.ids)?;
        let rects: Vec<Rect> = cards.iter().map(Rect::of_node).collect();
        let positions = arrange::distribute(&rects, args.axis.into());
        self.place_cards(index, cards, &positions)
    }

    /// Le toppe delle schede che cambiano posto. `positions` sta nell'ordine di
    /// `cards`; una scheda che resta dov'è non dà toppa.
    fn place_cards(
        &self,
        index: usize,
        cards: Vec<CanvasNode>,
        positions: &[(f64, f64)],
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let mut patches = Vec::new();
        for (mut node, &(x, y)) in cards.into_iter().zip(positions) {
            node.x = whole(index, x)?;
            node.y = whole(index, y)?;
            check_node(index, &node)?;
            patches.extend(upsert_node_patch(&self.working, &node));
        }
        Ok(patches)
    }
}
