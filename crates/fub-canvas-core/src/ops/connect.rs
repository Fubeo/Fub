//! `connect`: un arco in fondo alla lista, in due forme che non si mescolano.
//! L'arco è quello del file (`edge`), o la forma breve fra due schede (`from`,
//! `to`): i lati e le punte li dà il nucleo, di serie come la GUI, cioè nessun
//! lato e una punta alla fine. Le regole stanno in
//! `docs/reference/canvas-code.md`, «Le operazioni».

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::color;
use super::{from_fields, refuse, Compiler, OpError};
use crate::layout;
use crate::model::{CanvasEdge, CanvasEdgeEnd, CanvasEdgeSide, MAX_EDGES};
use crate::patch::CanvasPatch;

/// Gli argomenti di `connect`. O `edge`, l'arco come nel file (e nessun altro
/// campo), o la forma breve: `from` e `to` sono le due schede.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectArgs {
    /// Un arco come nel file. `id` è dentro l'arco, facoltativo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge: Option<Map<String, Value>>,
    /// L'id dell'arco nuovo; se manca lo dà il seme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// La scheda di partenza.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// La scheda di arrivo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    /// L'etichetta dell'arco.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Il colore, come in `add_card`.
    #[serde(
        default,
        deserialize_with = "color::deserialize",
        skip_serializing_if = "Option::is_none"
    )]
    pub color: Option<String>,
    /// I lati: `"auto"` per i più vicini, o `{from, to}`. Di serie nessuno.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sides: Option<Sides>,
    /// Le punte: `arrow` alla fine (di serie), `none` nessuna, `both` alle due.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends: Option<Ends>,
}

impl ConnectArgs {
    /// Se c'è un campo della forma breve: tutto tranne `edge`.
    fn has_short_form(&self) -> bool {
        self.id.is_some()
            || self.from.is_some()
            || self.to.is_some()
            || self.label.is_some()
            || self.color.is_some()
            || self.sides.is_some()
            || self.ends.is_some()
    }
}

/// I lati di un arco nella forma breve.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Sides {
    /// `"auto"`: i lati più vicini, come [`layout::nearest_sides`].
    Auto(AutoWord),
    /// `{from, to}`: i lati scelti. Un lato assente non si scrive.
    Pair(SidePair),
}

/// La sola parola `auto`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AutoWord {
    Auto,
}

/// I due lati di un arco scelti a mano.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SidePair {
    /// Il lato della scheda di partenza.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<CanvasEdgeSide>,
    /// Il lato della scheda di arrivo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<CanvasEdgeSide>,
}

/// Le punte di un arco nella forma breve.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ends {
    /// Una punta alla scheda di arrivo: come nel file, di serie.
    Arrow,
    /// Nessuna punta.
    None,
    /// Una punta a ciascuna scheda.
    Both,
}

impl Compiler {
    /// Aggiunge l'arco: quello del file, o quello della forma breve.
    pub(super) fn connect(
        &mut self,
        index: usize,
        link: &ConnectArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        if self.working.edges.len() >= MAX_EDGES {
            return Err(OpError::TooMany {
                index,
                what: "edges",
                limit: MAX_EDGES,
            });
        }
        let edge = match &link.edge {
            Some(fields) => {
                if link.has_short_form() {
                    return Err(refuse(
                        index,
                        "`connect` takes `edge` or the short form, not both",
                    ));
                }
                self.whole_edge(index, fields)?
            }
            None => self.short_edge(index, link)?,
        };
        self.check_edge(index, &edge)?;
        self.taken.insert(edge.id.clone());
        self.created.push(edge.id.clone());
        Ok(vec![CanvasPatch::UpsertEdge {
            before: None,
            after: edge,
            at: None,
        }])
    }

    /// L'arco come lo scrive il file, con il suo `id` (o quello del seme).
    fn whole_edge(
        &mut self,
        index: usize,
        fields: &Map<String, Value>,
    ) -> Result<CanvasEdge, OpError> {
        let id = self.claim_id(index, fields.get("id"))?;
        let mut fields = fields.clone();
        fields.insert("id".to_owned(), Value::String(id));
        from_fields(index, "edge", fields)
    }

    /// L'arco della forma breve. I lati e le punte di serie sono quelli della
    /// GUI: nessun lato, una punta alla fine.
    fn short_edge(&mut self, index: usize, link: &ConnectArgs) -> Result<CanvasEdge, OpError> {
        let (Some(from), Some(to)) = (link.from.as_deref(), link.to.as_deref()) else {
            return Err(refuse(index, "`connect` needs `from` and `to`, or `edge`"));
        };
        let id = match &link.id {
            None => self.fresh_id(),
            Some(id) => self.claim_text(index, id)?,
        };
        let from_node = self.node(index, from)?.clone();
        let to_node = self.node(index, to)?.clone();
        let (from_side, to_side) = match link.sides {
            None => (None, None),
            Some(Sides::Auto(_)) => {
                let (from_side, to_side) = layout::nearest_sides(&from_node, &to_node);
                (Some(from_side), Some(to_side))
            }
            Some(Sides::Pair(pair)) => (pair.from, pair.to),
        };
        let (from_end, to_end) = match link.ends.unwrap_or(Ends::Arrow) {
            Ends::Arrow => (None, Some(CanvasEdgeEnd::Arrow)),
            Ends::None => (None, Some(CanvasEdgeEnd::None)),
            Ends::Both => (Some(CanvasEdgeEnd::Arrow), Some(CanvasEdgeEnd::Arrow)),
        };
        let color = match link.color.as_deref() {
            None => None,
            Some(text) => Some(
                color::parse(text)
                    .ok_or_else(|| refuse(index, "the color is not a name, a number or #rrggbb"))?,
            ),
        };
        Ok(CanvasEdge {
            id,
            from_node: from.to_owned(),
            to_node: to.to_owned(),
            from_side,
            from_end,
            to_side,
            to_end,
            color,
            label: link.label.clone(),
            extra: Map::new(),
        })
    }
}
