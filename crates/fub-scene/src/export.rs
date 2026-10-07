//! Che cosa entra nel file di un export (formato della scena, export): la
//! derivazione, che dal testo del disegno fa il testo da esportare, l'SVG
//! pulito per il web e la misura di un'immagine raster.
//!
//! La derivazione è la stessa del client, che la fa per l'anteprima della
//! finestra «Esporta»: i vettori di `apps/client/src/__fixtures__/scene-export/`
//! la provano nei due linguaggi, byte per byte. Cambia il testo in tre punti e
//! lascia uguale ogni altro byte:
//!
//! 1. **il rettangolo:** la radice prende `viewBox`, `width` e `height` di una
//!    tavola o del riquadro della selezione;
//! 2. **la selezione:** lungo la strada dalla radice a ogni oggetto scelto si
//!    tolgono gli elementi grafici che non sono scelti, non ne contengono uno e
//!    non sono una carta;
//! 3. **lo sfondo** [`Background::None`] toglie le carte.
//!
//! [`clean`] fa dal testo derivato l'SVG per il web, e [`measure`] dice i
//! pixel di un'immagine raster con il conto a 32 bit di `resvg`.

use std::collections::{HashMap, HashSet};
use std::fmt;

use crate::analysis::board_name;
use crate::classify;
use crate::ink::round_half_up;
use crate::xml::{self, Document, Element, Kind, NodeId, NS_FUB, NS_NONE, NS_SVG};
use crate::ReadError;

mod clean;
mod measure;

pub use clean::clean;
pub use measure::{measure, Measure, Size, AREA_MAX, SCALE_MAX, SIDE_MAX};

/// Un rettangolo sulla tela: angolo in alto a sinistra, larghezza e altezza.
pub type Rect = [f64; 4];

/// Che cosa esce in un file: il disegno intero, una tavola, o gli oggetti
/// scelti ritagliati sul loro riquadro.
#[derive(Clone, Debug, PartialEq)]
pub enum Scope {
    Drawing,
    /// La tavola con questo id.
    Board(String),
    /// Gli oggetti con questi id, sul riquadro `rect`.
    Selection {
        ids: Vec<String>,
        rect: Rect,
    },
}

/// Lo sfondo: le carte del disegno, o niente.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Background {
    Paper,
    None,
}

/// Perché una derivazione non si fa.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeriveError {
    /// Il disegno non ha una tavola con questo id.
    UnknownBoard(String),
    /// Questo id scelto non è un oggetto del disegno.
    UnknownObject(String),
    /// La selezione non ha id.
    EmptySelection,
    /// Il riquadro della selezione non ha quattro numeri finiti, o a 2
    /// decimali non è largo e alto più di 0.
    BadBox,
    /// Il testo non è un SVG.
    Read(ReadError),
}

impl DeriveError {
    /// Il nome del rifiuto, quello dei vettori di prova.
    pub fn kind(&self) -> &'static str {
        match self {
            DeriveError::UnknownBoard(_) => "unknown-board",
            DeriveError::UnknownObject(_) => "unknown-object",
            DeriveError::EmptySelection => "empty-selection",
            DeriveError::BadBox => "bad-box",
            DeriveError::Read(ReadError::Malformed { .. }) => "malformed",
            DeriveError::Read(ReadError::NotSvg { .. }) => "not-svg",
        }
    }
}

impl fmt::Display for DeriveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DeriveError::UnknownBoard(id) => write!(f, "il disegno non ha la tavola «{id}»"),
            DeriveError::UnknownObject(id) => write!(f, "«{id}» non è un oggetto del disegno"),
            DeriveError::EmptySelection => f.write_str("la selezione non ha oggetti"),
            DeriveError::BadBox => f.write_str("il riquadro della selezione non ha area"),
            DeriveError::Read(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for DeriveError {}

impl From<ReadError> for DeriveError {
    fn from(error: ReadError) -> Self {
        DeriveError::Read(error)
    }
}

/// Una tavola del disegno: l'id, il nome che la scena le dà e il rettangolo.
#[derive(Clone, Debug, PartialEq)]
pub struct Board {
    pub id: String,
    /// Il primo `title`, con gli spazi ridotti, o l'id.
    pub name: String,
    pub rect: Rect,
}

/// Gli elementi grafici di SVG: quelli che la selezione toglie.
const GRAPHIC: [&str; 15] = [
    "a",
    "circle",
    "ellipse",
    "foreignObject",
    "g",
    "image",
    "line",
    "path",
    "polygon",
    "polyline",
    "rect",
    "svg",
    "switch",
    "text",
    "use",
];

/// Gli elementi grafici che ne contengono altri.
const GRAPHIC_CONTAINERS: [&str; 4] = ["a", "g", "svg", "switch"];

/// I decimali dei numeri del rettangolo, quelli della geometria.
const RECT_PLACES: usize = 2;

fn is_graphic(element: &Element<'_>) -> bool {
    element.ns == NS_SVG && GRAPHIC.contains(&element.local)
}

/// Vero se `element`, figlio della radice, è una carta.
fn is_paper(element: &Element<'_>) -> bool {
    element.is_svg("rect") && element.value(NS_FUB, "role") == Some("paper")
}

/// Un cambio del testo: i byte `[start, end)` diventano `text`.
#[derive(Debug)]
struct Edit {
    start: usize,
    end: usize,
    text: String,
}

/// Il cambio che toglie `siblings[at]`: dal suo inizio alla sua fine, con lo
/// spazio bianco che lo precede nel genitore se è un nodo di testo di soli
/// spazi.
fn removal(doc: &Document<'_>, siblings: &[NodeId], at: usize) -> Edit {
    let node = &doc.nodes[siblings[at]];
    let before = at.checked_sub(1).map(|i| &doc.nodes[siblings[i]]);
    let start = match before {
        Some(previous) if matches!(previous.kind, Kind::Text { blank: true, .. }) => previous.start,
        _ => node.start,
    };
    Edit {
        start,
        end: node.end,
        text: String::new(),
    }
}

/// Applica a `source` i cambi, che non si sovrappongono.
fn apply(source: &str, mut edits: Vec<Edit>) -> String {
    edits.sort_by_key(|edit| (edit.start, edit.end));
    let mut out = String::with_capacity(source.len());
    let mut at = 0;
    for edit in edits {
        out.push_str(&source[at..edit.start]);
        out.push_str(&edit.text);
        at = edit.end;
    }
    out.push_str(&source[at..]);
    out
}

/// Le potenze di dieci come letterali, fino ai 6 decimali dell'SVG pulito.
const POWERS_OF_TEN: [f64; 7] = [1.0, 10.0, 100.0, 1e3, 1e4, 1e5, 1e6];

/// Il numero `value` con al più `decimals` decimali, con la regola di §7:
/// `floor(v × 10ⁿ + 0,5)`, cifre esatte, niente esponente, niente zeri finali,
/// mai `-0`. È la scrittura di `formatNumber` del client.
pub(crate) fn format_number(value: f64, decimals: usize) -> String {
    format_units(round_half_up(value, POWERS_OF_TEN[decimals]), decimals)
}

/// Un intero di unità da 10⁻ⁿ (`decimals` = n) scritto come numero decimale:
/// sotto 10²¹ con le cifre più corte che si rileggono uguali, come `String`
/// di JavaScript, sopra con quelle esatte, come `BigInt`.
pub(crate) fn format_units(units: f64, decimals: usize) -> String {
    if units == 0.0 || !units.is_finite() {
        return "0".to_owned();
    }
    let magnitude = units.abs();
    let mut digits = if magnitude < 1e21 {
        format!("{magnitude}")
    } else {
        format!("{magnitude:.0}")
    };
    if decimals > 0 {
        if digits.len() <= decimals {
            digits = format!("{digits:0>width$}", width = decimals + 1);
        }
        let cut = digits.len() - decimals;
        let fraction = digits[cut..].trim_end_matches('0');
        digits = if fraction.is_empty() {
            digits[..cut].to_owned()
        } else {
            format!("{}.{fraction}", &digits[..cut])
        };
    }
    if units < 0.0 {
        format!("-{digits}")
    } else {
        digits
    }
}

/// Il disegno letto per l'export: il documento intero, anche oltre la misura
/// fino a cui l'editor lo modifica, perché l'export lo scrive tutto.
pub struct Source<'a> {
    doc: Document<'a>,
}

impl<'a> Source<'a> {
    /// Legge `text`, il testo intero del file. `Err` se non è un SVG.
    pub fn read(text: &'a str) -> Result<Self, ReadError> {
        let doc = read_whole(text)?;
        Ok(Source { doc })
    }

    /// Le tavole, in ordine di documento.
    pub fn boards(&self) -> Vec<Board> {
        classify::boards(&self.doc)
            .into_iter()
            .map(|(node, rect)| {
                let element = self.doc.element(node).expect("una tavola è un elemento");
                Board {
                    id: element.value(NS_NONE, "id").unwrap_or_default().to_owned(),
                    name: board_name(&self.doc, element),
                    rect,
                }
            })
            .collect()
    }

    /// Il testo da esportare con l'ambito `scope` e lo sfondo `background`.
    pub fn derive(&self, scope: &Scope, background: Background) -> Result<String, DeriveError> {
        let doc = &self.doc;
        let root = doc.element(doc.root).expect("la radice è un elemento");
        let mut edits = Vec::new();
        match scope {
            Scope::Drawing => {}
            Scope::Board(id) => edits.extend(on_rect(doc, root, self.board_rect(id)?)),
            Scope::Selection { ids, rect } => {
                let empty = |side: f64| round_half_up(side, POWERS_OF_TEN[RECT_PLACES]) <= 0.0;
                if !rect.iter().all(|n| n.is_finite()) || empty(rect[2]) || empty(rect[3]) {
                    return Err(DeriveError::BadBox);
                }
                edits.extend(self.selection_edits(ids)?);
                edits.extend(on_rect(doc, root, *rect));
            }
        }
        if background == Background::None {
            let children = doc.children(doc.root);
            for (at, &child) in children.iter().enumerate() {
                if doc.element(child).is_some_and(is_paper) {
                    edits.push(removal(doc, children, at));
                }
            }
        }
        Ok(apply(doc.source, edits))
    }

    /// Il rettangolo della tavola `id`.
    fn board_rect(&self, id: &str) -> Result<Rect, DeriveError> {
        classify::boards(&self.doc)
            .into_iter()
            .find(|&(node, _)| {
                self.doc.element(node).and_then(|e| e.value(NS_NONE, "id")) == Some(id)
            })
            .map(|(_, rect)| rect)
            .ok_or_else(|| DeriveError::UnknownBoard(id.to_owned()))
    }

    /// Gli elementi grafici a cui si arriva dalla radice passando soltanto per
    /// elementi grafici, per id: di due con lo stesso id vale il primo, in
    /// ordine di documento. Le carte non ci sono.
    fn graphic_ids(&self) -> HashMap<&str, NodeId> {
        let doc = &self.doc;
        let mut found = HashMap::new();
        // Una pila esplicita: un disegno annidato a fondo non consuma lo stack.
        let mut stack: Vec<(NodeId, bool)> = doc
            .children(doc.root)
            .iter()
            .rev()
            .map(|&child| (child, true))
            .collect();
        while let Some((node, at_root)) = stack.pop() {
            let Some(element) = doc.element(node) else {
                continue;
            };
            if !is_graphic(element) || (at_root && is_paper(element)) {
                continue;
            }
            if let Some(id) = element.value(NS_NONE, "id") {
                found.entry(id).or_insert(node);
            }
            if GRAPHIC_CONTAINERS.contains(&element.local) {
                stack.extend(element.children.iter().rev().map(|&child| (child, false)));
            }
        }
        found
    }

    /// I cambi che lasciano, degli elementi grafici, solo gli oggetti `ids`,
    /// ciò che li contiene e le carte.
    fn selection_edits(&self, ids: &[String]) -> Result<Vec<Edit>, DeriveError> {
        let doc = &self.doc;
        if ids.is_empty() {
            return Err(DeriveError::EmptySelection);
        }
        let known = self.graphic_ids();
        let mut chosen = HashSet::new();
        for id in ids {
            let node = known
                .get(id.as_str())
                .ok_or_else(|| DeriveError::UnknownObject(id.clone()))?;
            chosen.insert(*node);
        }
        // Ciò che contiene un oggetto scelto, e di questo ciò che sta dentro
        // un altro scelto: il contenuto di uno scelto resta tutto. Si sale da
        // ogni scelto fino al primo scelto sopra di lui, perché da lì in su
        // sale quello.
        let mut holders = HashSet::new();
        let mut inside = HashSet::new();
        for &node in &chosen {
            let mut path = Vec::new();
            let mut at = doc.nodes[node].parent;
            while let Some(holder) = at {
                holders.insert(holder);
                if chosen.contains(&holder) {
                    inside.extend(path);
                    break;
                }
                path.push(holder);
                at = doc.nodes[holder].parent;
            }
        }
        let mut edits = Vec::new();
        for &holder in &holders {
            if chosen.contains(&holder) || inside.contains(&holder) {
                continue;
            }
            let children = doc.children(holder);
            for (at, &child) in children.iter().enumerate() {
                let Some(element) = doc.element(child) else {
                    continue;
                };
                if !is_graphic(element) || chosen.contains(&child) || holders.contains(&child) {
                    continue;
                }
                if holder == doc.root && is_paper(element) {
                    continue;
                }
                edits.push(removal(doc, children, at));
            }
        }
        Ok(edits)
    }
}

/// Il testo da esportare: `source` con l'ambito `scope` e lo sfondo
/// `background`. Per derivare più volte dallo stesso disegno, [`Source`] lo
/// legge una volta sola.
pub fn derive(source: &str, scope: &Scope, background: Background) -> Result<String, DeriveError> {
    Source::read(source)?.derive(scope, background)
}

/// Il documento intero, se è un SVG.
fn read_whole(text: &str) -> Result<Document<'_>, ReadError> {
    let doc = xml::parse(text, false).map_err(|e| ReadError::Malformed {
        offset: e.offset,
        kind: e.kind,
    })?;
    let root = doc.element(doc.root).expect("la radice è un elemento");
    if !root.is_svg("svg") {
        return Err(ReadError::NotSvg {
            offset: doc.nodes[doc.root].start,
        });
    }
    Ok(doc)
}

/// I cambi che portano la radice sul rettangolo `rect`: un attributo che c'è
/// cambia valore sul posto, quelli che mancano si aggiungono in quest'ordine
/// dopo l'ultimo attributo. La radice ne ha sempre uno: la dichiarazione del
/// namespace di SVG.
fn on_rect(doc: &Document<'_>, root: &Element<'_>, rect: Rect) -> Vec<Edit> {
    let view_box = rect.map(|n| format_number(n, RECT_PLACES)).join(" ");
    let values = [
        ("viewBox", view_box),
        ("width", format_number(rect[2], RECT_PLACES)),
        ("height", format_number(rect[3], RECT_PLACES)),
    ];
    let mut edits = Vec::new();
    let mut added = String::new();
    for (local, value) in values {
        match root.attr(NS_NONE, local) {
            Some(attr) => edits.push(Edit {
                start: attr.raw.0,
                end: attr.raw.1,
                text: value,
            }),
            None => added.push_str(&format!(" {local}=\"{value}\"")),
        }
    }
    if !added.is_empty() {
        // Dopo la virgoletta che chiude il valore.
        let end = match root.attrs.last() {
            Some(attr) => attr.raw.1 + 1,
            None => doc.nodes[doc.root].start + 1 + root.name.len(),
        };
        edits.push(Edit {
            start: end,
            end,
            text: added,
        });
    }
    edits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_written_like_the_client_writes_them() {
        assert_eq!(format_number(120.5, 2), "120.5");
        assert_eq!(format_number(-0.03, 2), "-0.03");
        assert_eq!(format_number(-0.001, 2), "0");
        assert_eq!(format_number(0.125, 2), "0.13");
        assert_eq!(format_number(-0.125, 2), "-0.12");
        assert_eq!(format_number(1e3, 0), "1000");
        assert_eq!(format_number(12.0, 6), "12");
        assert_eq!(format_number(0.000_001_5, 6), "0.000002");
        // Oltre 10²¹ le cifre esatte del double, come `BigInt`.
        assert_eq!(format_number(1e22, 2), "9999999999999999832227.84");
        assert_eq!(format_number(1.5e21, 0), "1500000000000000000000");
    }

    const DRAWING: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 800 600" width="800" height="600">
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="800" height="600" fill="#ffffff"/>
  <view id="b1" fub:role="board" viewBox="10 20 300 200"><title>  Prima   tavola </title></view>
  <view id="b2" fub:role="board" viewBox="400 20 300 200"/>
  <view id="b1" fub:role="board" viewBox="0 0 1 1"/>
  <g id="l1" fub:layer="Livello 1">
    <rect id="o1" x="10" y="10" width="100" height="50"/>
  </g>
</svg>
"##;

    #[test]
    fn the_boards_are_named_in_document_order_and_the_first_id_wins() {
        let source = Source::read(DRAWING).unwrap();
        let boards = source.boards();
        assert_eq!(
            boards,
            vec![
                Board {
                    id: "b1".into(),
                    name: "Prima tavola".into(),
                    rect: [10.0, 20.0, 300.0, 200.0],
                },
                Board {
                    id: "b2".into(),
                    name: "b2".into(),
                    rect: [400.0, 20.0, 300.0, 200.0],
                },
            ]
        );
        let derived = source
            .derive(&Scope::Board("b1".into()), Background::Paper)
            .unwrap();
        assert!(derived.contains(r#"viewBox="10 20 300 200" width="300" height="200""#));
    }

    #[test]
    fn a_deep_drawing_does_not_exhaust_the_stack() {
        let depth = 20_000;
        let mut text = String::from(r#"<svg xmlns="http://www.w3.org/2000/svg">"#);
        text.push_str(&"<g>".repeat(depth));
        text.push_str(r#"<rect id="deep" width="1" height="1"/>"#);
        text.push_str(&"</g>".repeat(depth));
        text.push_str("<rect id=\"other\"/></svg>");
        let scope = Scope::Selection {
            ids: vec!["deep".into()],
            rect: [0.0, 0.0, 1.0, 1.0],
        };
        let derived = derive(&text, &scope, Background::Paper).unwrap();
        assert!(!derived.contains("other"));
    }
}
