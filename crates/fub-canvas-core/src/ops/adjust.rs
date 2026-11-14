//! Le operazioni che cambiano schede e archi che ci sono già: `move` (con
//! `contents`, perché un gruppo porta con sé le schede dentro), `resize` (con
//! `fit`, perché la scheda prende la misura del suo contenuto), `reorder` (con
//! `to`, perché si può portare sotto) e `color` (un colore con un nome, per più
//! schede e archi insieme). Le regole stanno in
//! `docs/reference/canvas-code.md`, «Le operazioni».

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::color;
use super::{
    ambiguous, check_node, distinct, refuse, saturate, saturating_integer, saturating_option,
    whole, Compiler, OpError,
};
use crate::layout::{self, CardKind};
use crate::model::{CanvasNode, CanvasNodeType};
use crate::patch::{upsert_edge_patch, upsert_node_patch, CanvasPatch};

/// Gli argomenti di `move`. Le schede `ids` si spostano di `dx` e `dy`; con
/// `contents: true` ogni gruppo di `ids` porta con sé le schede dentro di lui.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveArgs {
    /// Le schede da spostare.
    pub ids: Vec<String>,
    /// Lo spostamento in orizzontale, in unità della lavagna; satura a ±(2^53−1).
    #[serde(deserialize_with = "saturating_integer")]
    pub dx: i64,
    /// Lo spostamento in verticale, come `dx`.
    #[serde(deserialize_with = "saturating_integer")]
    pub dy: i64,
    /// Con `true`, un gruppo di `ids` porta con sé le schede che stanno dentro,
    /// una volta sola anche se sono in `ids`. Su una scheda che non è un gruppo
    /// non fa niente.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contents: Option<bool>,
}

/// Gli argomenti di `resize`. Senza `fit` la scheda prende `width` e `height`
/// (quella che manca resta com'è). Con `fit: content` tiene la larghezza, data
/// o di prima, e prende l'altezza del contenuto.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResizeArgs {
    /// La scheda da ridimensionare.
    pub id: String,
    /// La larghezza, in unità della lavagna.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub width: Option<i64>,
    /// L'altezza, in unità della lavagna. Non si dà con `fit`.
    #[serde(
        default,
        deserialize_with = "saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub height: Option<i64>,
    /// `content`: l'altezza viene dal contenuto (un testo, un'immagine, un PDF).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<Fit>,
    /// Le dimensioni del contenuto di un file, con `fit`: i pixel di un'immagine
    /// o i punti della prima pagina di un PDF. Di serie le legge il file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_size: Option<[f64; 2]>,
}

/// Il modo di prendere la misura da un contenuto.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    /// L'altezza del contenuto, con la larghezza data.
    Content,
}

/// Gli argomenti di `reorder`. Le schede `ids` vanno in cima (o in fondo, con
/// `to: back`), nell'ordine dato; le altre restano nel loro ordine.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReorderArgs {
    /// Le schede da portare, nell'ordine dato.
    pub ids: Vec<String>,
    /// `front` (di serie, in cima) o `back` (in fondo, sotto le altre).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<ReorderTo>,
}

/// Dove va a finire la scheda portata con `reorder`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReorderTo {
    /// In cima all'ordine: sopra le altre.
    Front,
    /// In fondo all'ordine: sotto le altre, nell'ordine dato.
    Back,
}

/// Gli argomenti di `color`. Un colore con un nome, il numero o `#rrggbb`, o
/// `null` per toglierlo, su schede e archi.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColorArgs {
    /// Le schede o gli archi da colorare.
    pub ids: Vec<String>,
    /// Il colore. Il campo c'è sempre, anche `null` (che toglie il colore).
    #[serde(deserialize_with = "color::deserialize")]
    pub color: Option<String>,
}

impl Compiler {
    /// `move`: le schede `ids`, e con `contents` le schede dentro i gruppi di
    /// `ids`. Ogni scheda si sposta una volta sola, di `dx` e `dy`.
    pub(super) fn move_nodes(
        &mut self,
        index: usize,
        args: &MoveArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        distinct(index, &args.ids)?;
        let mut moved = args.ids.clone();
        if args.contents == Some(true) {
            moved.extend(self.contents_of(&args.ids));
        }
        let mut patches = Vec::new();
        for id in &moved {
            let mut node = self.node(index, id)?.clone();
            node.x = saturate(node.x.saturating_add(args.dx));
            node.y = saturate(node.y.saturating_add(args.dy));
            check_node(index, &node)?;
            patches.extend(upsert_node_patch(&self.working, &node));
        }
        Ok(patches)
    }

    /// Le schede che i gruppi di `ids` portano con sé: quelle che stanno tutte
    /// dentro un gruppo di `ids`, e che non sono già in `ids`. Le posizioni sono
    /// quelle prima dell'operazione, e l'ordine è quello della lavagna. Un gruppo
    /// dentro un gruppo porta le sue schede, perché stanno dentro anche loro.
    fn contents_of(&self, ids: &[String]) -> Vec<String> {
        let groups: Vec<&CanvasNode> = self
            .working
            .nodes
            .iter()
            .filter(|node| node.node_type == CanvasNodeType::Group && ids.contains(&node.id))
            .collect();
        if groups.is_empty() {
            return Vec::new();
        }
        let mut listed: HashSet<&str> = ids.iter().map(String::as_str).collect();
        let mut extra = Vec::new();
        for node in &self.working.nodes {
            if listed.contains(node.id.as_str()) {
                continue;
            }
            if groups.iter().any(|group| layout::inside(node, group)) {
                listed.insert(node.id.as_str());
                extra.push(node.id.clone());
            }
        }
        extra
    }

    /// `resize`: le misure date, o con `fit` la misura del contenuto.
    pub(super) fn resize(
        &mut self,
        index: usize,
        args: &ResizeArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let mut node = self.node(index, &args.id)?.clone();
        let (width, height) = match args.fit {
            None => {
                if args.width.is_none() && args.height.is_none() {
                    return Err(refuse(
                        index,
                        "resize needs `width`, `height` or `fit: content`",
                    ));
                }
                if args.content_size.is_some() {
                    return Err(refuse(index, "`content_size` goes with `fit: content`"));
                }
                (
                    args.width.unwrap_or(node.width),
                    args.height.unwrap_or(node.height),
                )
            }
            Some(Fit::Content) => {
                if args.height.is_some() {
                    return Err(refuse(
                        index,
                        "`fit: content` sets the height: do not give `height`",
                    ));
                }
                let width = args.width.unwrap_or(node.width);
                (
                    width,
                    fitted_height(index, &node, width, args.content_size)?,
                )
            }
        };
        node.width = width;
        node.height = height;
        check_node(index, &node)?;
        Ok(upsert_node_patch(&self.working, &node)
            .into_iter()
            .collect())
    }

    /// `reorder`: le schede `ids` in cima (`front`, di serie) o in fondo
    /// (`back`), nell'ordine dato; le altre restano nel loro ordine.
    pub(super) fn reorder(
        &mut self,
        index: usize,
        args: &ReorderArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        distinct(index, &args.ids)?;
        for id in &args.ids {
            self.node(index, id)?;
        }
        let lifted: HashSet<&str> = args.ids.iter().map(String::as_str).collect();
        let before: Vec<String> = self
            .working
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect();
        let rest = || {
            before
                .iter()
                .filter(|id| !lifted.contains(id.as_str()))
                .cloned()
        };
        let after: Vec<String> = match args.to.unwrap_or(ReorderTo::Front) {
            ReorderTo::Front => rest().chain(args.ids.iter().cloned()).collect(),
            ReorderTo::Back => args.ids.iter().cloned().chain(rest()).collect(),
        };
        if after == before {
            return Ok(Vec::new());
        }
        Ok(vec![CanvasPatch::Reorder { before, after }])
    }

    /// `color`: il colore di ogni scheda e arco di `ids`, con un nome, il numero
    /// o `#rrggbb`; `null` lo toglie. Un id che è sia una scheda sia un arco è
    /// ambiguo, come in `set`.
    pub(super) fn color(
        &mut self,
        index: usize,
        args: &ColorArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        distinct(index, &args.ids)?;
        let value = match &args.color {
            None => None,
            Some(text) => {
                Some(color::parse(text).ok_or_else(|| refuse(index, color::NOT_A_COLOR))?)
            }
        };
        let mut patches = Vec::new();
        for id in &args.ids {
            match (self.has_node(id), self.has_edge(id)) {
                (true, true) => return Err(ambiguous(index, id)),
                (true, false) => {
                    let mut node = self.node(index, id)?.clone();
                    node.color = value.clone();
                    check_node(index, &node)?;
                    patches.extend(upsert_node_patch(&self.working, &node));
                }
                (false, true) => {
                    let mut edge = self
                        .working
                        .edges
                        .iter()
                        .find(|edge| edge.id == *id)
                        .cloned()
                        .ok_or_else(|| OpError::UnknownEdge {
                            index,
                            id: id.clone(),
                        })?;
                    edge.color = value.clone();
                    self.check_edge(index, &edge)?;
                    patches.extend(upsert_edge_patch(&self.working, &edge));
                }
                (false, false) => {
                    return Err(OpError::UnknownEdge {
                        index,
                        id: id.clone(),
                    })
                }
            }
        }
        Ok(patches)
    }
}

/// L'altezza di `fit: content` per una scheda larga `width`. Un testo prende la
/// stima di [`layout::estimate_text_height`]; un'immagine o un PDF prende le
/// proporzioni del suo contenuto. Le altre schede non hanno una misura del
/// contenuto, e lo dice la ragione.
fn fitted_height(
    index: usize,
    node: &CanvasNode,
    width: i64,
    content: Option<[f64; 2]>,
) -> Result<i64, OpError> {
    // Le misure del modello stanno entro ±(2^53−1): il `f64` le tiene esatte.
    #[allow(clippy::cast_precision_loss)]
    let width = width as f64;
    match layout::card_kind(node) {
        CardKind::Text => {
            if content.is_some() {
                return Err(refuse(
                    index,
                    "`content_size` goes with an image or a PDF card",
                ));
            }
            let text = node.text.as_deref().unwrap_or("");
            whole(index, layout::estimate_text_height(text, width))
        }
        CardKind::Image | CardKind::Pdf => {
            let [content_width, content_height] = content.ok_or_else(|| {
                refuse(
                    index,
                    "`fit: content` needs the size of the content: give `content_size`, or a file that can be read",
                )
            })?;
            let height = layout::content_height(width, (content_width, content_height))
                .ok_or_else(|| refuse(index, "`content_size` is not a positive size"))?;
            whole(index, height)
        }
        _ => Err(refuse(
            index,
            "`fit: content` works on a text, an image or a PDF card",
        )),
    }
}
