//! `add_card`: una scheda in cima all'ordine, in due forme che non si
//! mescolano. La scheda intera (`node`) è quella del file. La forma breve dice
//! solo ciò che una persona sceglie (il testo, il file, il posto): misure, posto
//! e colore li dà il nucleo, con le stesse regole della GUI. Le regole stanno in
//! `docs/reference/canvas-code.md`, «Le operazioni».
//!
//! Le misure vengono da [`layout::born_size`], il posto da [`layout::place_near`]
//! o da [`layout::auto_place`], il colore dalla tavola di [`super::color`].

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::color;
use super::{check_node, from_fields, refuse, whole, Compiler, OpError};
use crate::layout::{self, Rect};
use crate::model::{CanvasEdgeSide, CanvasNode, CanvasNodeType, MAX_NODES};
use crate::patch::CanvasPatch;

/// Gli argomenti di `add_card`. O `node`, la scheda come nel file (e nessun
/// altro campo), o la forma breve: `text`, `file`, `url`, `label` o `type` dà il
/// tipo; `x` e `y` (insieme) o `near` (con `side` e `gap`) danno il posto;
/// `width` e `height` danno le misure, se mancano sono quelle di nascita.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AddCardArgs {
    /// Una scheda come nel file. `id` è dentro la scheda, facoltativo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<Map<String, Value>>,
    /// L'id della scheda nuova; se manca lo dà il seme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Il testo di una scheda di testo; se manca è vuoto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Il percorso di un file del vault: una scheda di file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Il collegamento di una scheda link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// L'etichetta di un gruppo; da sola fa un gruppo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Il tipo: `text`, `file`, `link` o `group`. Se manca lo dice il campo che c'è.
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<CanvasNodeType>,
    /// Il sottopercorso di un file, come `#page=3`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subpath: Option<String>,
    /// La posizione, insieme a `y`.
    #[serde(
        default,
        deserialize_with = "super::saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub x: Option<i64>,
    /// La posizione, insieme a `x`.
    #[serde(
        default,
        deserialize_with = "super::saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub y: Option<i64>,
    /// La larghezza; di serie quella di nascita del tipo.
    #[serde(
        default,
        deserialize_with = "super::saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub width: Option<i64>,
    /// L'altezza; di serie quella di nascita del tipo e del testo.
    #[serde(
        default,
        deserialize_with = "super::saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub height: Option<i64>,
    /// Il colore: un nome, il numero da 1 a 6, o `#rrggbb`.
    #[serde(
        default,
        deserialize_with = "color::deserialize",
        skip_serializing_if = "Option::is_none"
    )]
    pub color: Option<String>,
    /// La scheda accanto alla quale nasce questa.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub near: Option<String>,
    /// Il lato di `near`; di serie `right`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<CanvasEdgeSide>,
    /// La distanza da `near`, non negativa; di serie 48 a destra e a sinistra,
    /// 24 sopra e sotto.
    #[serde(
        default,
        deserialize_with = "super::saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub gap: Option<i64>,
    /// Le dimensioni del contenuto di un file: i pixel di un'immagine, o i punti
    /// della prima pagina di un PDF. Danno le misure di nascita.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_size: Option<[f64; 2]>,
}

impl AddCardArgs {
    /// Se c'è un campo della forma breve: tutto tranne `node`.
    fn has_short_form(&self) -> bool {
        self.id.is_some()
            || self.text.is_some()
            || self.file.is_some()
            || self.url.is_some()
            || self.label.is_some()
            || self.kind.is_some()
            || self.subpath.is_some()
            || self.x.is_some()
            || self.y.is_some()
            || self.width.is_some()
            || self.height.is_some()
            || self.color.is_some()
            || self.near.is_some()
            || self.side.is_some()
            || self.gap.is_some()
            || self.content_size.is_some()
    }
}

/// Il posto di una scheda nuova, come lo chiede chi scrive.
enum Place<'a> {
    /// `x` e `y`: il posto dato.
    At(i64, i64),
    /// Accanto a `near`, sul lato `side`, a `gap` (di serie).
    Near {
        near: &'a str,
        side: CanvasEdgeSide,
        gap: Option<f64>,
    },
    /// Nessun posto: il nucleo mette la scheda in fondo alla lista automatica.
    Auto,
}

impl Compiler {
    /// Aggiunge la scheda: la forma intera, o quella breve.
    pub(super) fn add_card(
        &mut self,
        index: usize,
        card: &AddCardArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        if self.working.nodes.len() >= MAX_NODES {
            return Err(OpError::TooMany {
                index,
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        let (node, automatic) = match &card.node {
            Some(fields) => {
                if card.has_short_form() {
                    return Err(refuse(
                        index,
                        "`add_card` takes `node` or the short form, not both",
                    ));
                }
                (self.whole_card(index, fields)?, false)
            }
            None => self.short_card(index, card)?,
        };
        check_node(index, &node)?;
        self.taken.insert(node.id.clone());
        self.created.push(node.id.clone());
        if automatic {
            self.auto_last = Some(node.id.clone());
        }
        Ok(vec![CanvasPatch::UpsertNode {
            before: None,
            after: node,
            at: None,
        }])
    }

    /// La scheda come la scrive il file: il suo `id` (o quello del seme) e i
    /// campi dati.
    fn whole_card(
        &mut self,
        index: usize,
        fields: &Map<String, Value>,
    ) -> Result<CanvasNode, OpError> {
        let id = self.claim_id(index, fields.get("id"))?;
        let mut fields = fields.clone();
        fields.insert("id".to_owned(), Value::String(id));
        from_fields(index, "node", fields)
    }

    /// La scheda della forma breve, e se è nata in fondo alla lista automatica.
    fn short_card(
        &mut self,
        index: usize,
        card: &AddCardArgs,
    ) -> Result<(CanvasNode, bool), OpError> {
        let kind = shape(index, card)?;
        let id = match &card.id {
            None => self.fresh_id(),
            Some(id) => self.claim_text(index, id)?,
        };
        let color = match card.color.as_deref() {
            None => None,
            Some(text) => Some(
                color::parse(text)
                    .ok_or_else(|| refuse(index, "the color is not a name, a number or #rrggbb"))?,
            ),
        };
        let mut node = CanvasNode {
            id,
            node_type: kind,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            color,
            text: (kind == CanvasNodeType::Text).then(|| card.text.clone().unwrap_or_default()),
            file: card.file.clone(),
            subpath: card.subpath.clone(),
            url: card.url.clone(),
            label: (kind == CanvasNodeType::Group).then(|| card.label.clone().unwrap_or_default()),
            background: None,
            background_style: None,
            extra: Map::new(),
        };
        let species = layout::card_kind(&node);
        let text = node.text.as_deref();
        let content = card.content_size.map(|[width, height]| (width, height));
        let born = layout::born_size(species, text, content);
        let given = |born: f64, value: Option<i64>| value.map_or(born, |value| value as f64);
        let (x, y, width, height, automatic) = match Place::of(index, card)? {
            Place::At(x, y) => (
                x as f64,
                y as f64,
                given(born.0, card.width),
                given(born.1, card.height),
                false,
            ),
            Place::Near { near, side, gap } => {
                let rect =
                    layout::place_near(&self.working, near, side, gap, species, text, content)
                        .ok_or_else(|| OpError::UnknownNode {
                            index,
                            id: near.to_owned(),
                        })?;
                let width = given(rect.width, card.width);
                let height = given(rect.height, card.height);
                // Con una misura scritta a mano, la scheda a sinistra o sopra
                // tocca `near` ancora a `gap`: la misura di nascita è quella
                // dello scivolamento, come in `place_near`.
                let x = if side == CanvasEdgeSide::Left {
                    rect.x + rect.width - width
                } else {
                    rect.x
                };
                let y = if side == CanvasEdgeSide::Top {
                    rect.y + rect.height - height
                } else {
                    rect.y
                };
                (x, y, width, height, false)
            }
            Place::Auto => {
                let after = self
                    .auto_last
                    .as_deref()
                    .and_then(|id| self.working.nodes.iter().find(|node| node.id == id))
                    .map(Rect::of_node);
                let (x, y) = layout::auto_place(&self.working, after);
                (
                    x,
                    y,
                    given(born.0, card.width),
                    given(born.1, card.height),
                    true,
                )
            }
        };
        node.x = whole(index, x)?;
        node.y = whole(index, y)?;
        node.width = whole(index, width)?;
        node.height = whole(index, height)?;
        Ok((node, automatic))
    }
}

impl<'a> Place<'a> {
    /// Il posto della forma breve. `x` e `y` vanno insieme e non con `near`;
    /// `side` e `gap` vanno con `near`.
    fn of(index: usize, card: &'a AddCardArgs) -> Result<Self, OpError> {
        match (card.x, card.y) {
            (Some(_), None) | (None, Some(_)) => {
                Err(refuse(index, "`x` and `y` go together: give both or none"))
            }
            (Some(x), Some(y)) => {
                if card.near.is_some() || card.side.is_some() || card.gap.is_some() {
                    return Err(refuse(
                        index,
                        "a card has one place: `x` and `y`, or `near`",
                    ));
                }
                Ok(Self::At(x, y))
            }
            (None, None) => match card.near.as_deref() {
                Some(near) => {
                    if card.gap.is_some_and(|gap| gap < 0) {
                        return Err(refuse(index, "`gap` is not negative"));
                    }
                    Ok(Self::Near {
                        near,
                        side: card.side.unwrap_or(CanvasEdgeSide::Right),
                        gap: card.gap.map(|gap| gap as f64),
                    })
                }
                None => {
                    if card.side.is_some() || card.gap.is_some() {
                        return Err(refuse(index, "`side` and `gap` go with `near`"));
                    }
                    Ok(Self::Auto)
                }
            },
        }
    }
}

/// Il tipo della scheda breve. Un solo contenuto (`text`, `file` o `url`), o
/// `label` per un gruppo, o `type` che dice quale; ogni campo sta col suo tipo.
fn shape(index: usize, card: &AddCardArgs) -> Result<CanvasNodeType, OpError> {
    let contents = [card.text.is_some(), card.file.is_some(), card.url.is_some()]
        .into_iter()
        .filter(|present| *present)
        .count();
    if contents > 1 {
        return Err(refuse(
            index,
            "text, file and url are three kinds of card: give one of them",
        ));
    }
    let kind = match card.kind {
        Some(kind) => kind,
        None if card.text.is_some() => CanvasNodeType::Text,
        None if card.file.is_some() => CanvasNodeType::File,
        None if card.url.is_some() => CanvasNodeType::Link,
        None if card.label.is_some() => CanvasNodeType::Group,
        None => {
            return Err(refuse(
                index,
                "add_card needs `node`, or `text`, `file`, `url`, or `label` for a group",
            ))
        }
    };
    let needed = match kind {
        CanvasNodeType::File if card.file.is_none() => Some("file"),
        CanvasNodeType::Link if card.url.is_none() => Some("url"),
        _ => None,
    };
    if let Some(field) = needed {
        return Err(refuse(
            index,
            format!("a {} card needs `{field}`", kind_name(kind)),
        ));
    }
    // Ogni campo che c'è dice a quale tipo di scheda va: un campo fuori posto
    // è un errore, non un dettaglio da ignorare.
    let owners = [
        ("text", card.text.is_some(), CanvasNodeType::Text),
        ("file", card.file.is_some(), CanvasNodeType::File),
        ("url", card.url.is_some(), CanvasNodeType::Link),
        ("label", card.label.is_some(), CanvasNodeType::Group),
        ("subpath", card.subpath.is_some(), CanvasNodeType::File),
        (
            "content_size",
            card.content_size.is_some(),
            CanvasNodeType::File,
        ),
    ];
    for (field, present, owner) in owners {
        if present && owner != kind {
            return Err(refuse(
                index,
                format!("`{field}` does not go with a {} card", kind_name(kind)),
            ));
        }
    }
    Ok(kind)
}

/// Il nome del tipo come lo scrive il formato.
fn kind_name(kind: CanvasNodeType) -> &'static str {
    match kind {
        CanvasNodeType::Text => "text",
        CanvasNodeType::File => "file",
        CanvasNodeType::Link => "link",
        CanvasNodeType::Group => "group",
    }
}
