//! `spread_pages` ed `excerpt`: le pagine di un PDF in fila accanto alla sua
//! scheda, come «Spargi le pagine…» della GUI (N6 T72), e l'estratto di una
//! scheda di file (`fub:parts`, N6 T73), scritto con le regole di
//! [`crate::parts`].
//!
//! Le misure e i posti di `spread_pages` sono quelli di `spreadLayout` e di
//! `bornSize("pdf", …)` in `apps/client/src/editors/canvas/drop-layout.ts`: le
//! misure di nascita si arrotondano all'intero (A-16) e non si agganciano, le
//! posizioni partono al primo multiplo di 8 che lascia 24. Le pagine si leggono
//! come `parsePageRanges` di `page-ranges.ts`. Il test
//! `spread-pages-parity.test.ts` rifà i vettori `canvas-ops/spread-pages-*.json`
//! con quelle funzioni della GUI.
//!
//! Le regole stanno in `docs/reference/canvas-pages-code.md`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{check_node, refuse, whole, Compiler, NoteCode, OpError};
use crate::layout::{self, CardKind, Rect};
use crate::model::{CanvasEdgeSide, CanvasNode, CanvasNodeType, MAX_NODES, MAX_SAFE_INTEGER};
use crate::parts::{self, CanvasParts, PartsKind, PartsState, PARTS_KEY};
use crate::patch::{upsert_node_patch, CanvasPatch};

/// Le pagine che uno `spread_pages` fa nascere al più: oltre è `TooMany`.
pub const MAX_SPREAD_PAGES: usize = 1000;

/// Quante pagine per riga: a capo dopo 10 (`SPREAD_ROW` della GUI).
const SPREAD_ROW: usize = 10;
/// Lo spazio fra le pagine e fra le righe, e il margine del gruppo
/// (`DROP_GAP`).
const SPREAD_GAP: f64 = 24.0;
/// Il passo a cui partono le pagine (`DROP_SNAP`).
const SPREAD_SNAP: f64 = 8.0;
/// Oltre questo numero di pagine, un gruppo le raccoglie
/// (`DROP_GROUP_THRESHOLD`).
const GROUP_ABOVE: usize = 12;
/// La misura più piccola di un lato (`DROP_MIN_SIZE`).
const MIN_SIDE: f64 = 40.0;
/// La larghezza di una pagina PDF appena nata.
const PDF_WIDTH: f64 = 360.0;
/// La misura di una pagina PDF senza la misura della pagina.
const PDF_DEFAULT: (f64, f64) = (360.0, 480.0);
/// Il lato lungo di un'immagine appena nata.
const IMAGE_LONG_SIDE: f64 = 480.0;
/// La misura di un'immagine senza la sua misura.
const IMAGE_DEFAULT: (f64, f64) = (480.0, 360.0);
/// La misura di nascita di una nota.
const NOTE_SIZE: (f64, f64) = (320.0, 240.0);

/// Le pagine di `spread_pages`: un testo come nel campo della GUI («3-7, 9»,
/// «20-», vuoto per tutte) o una lista di numeri di pagina, da 1.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PageList {
    Text(String),
    /// Gli elementi li controlla il compilatore: un numero che non è una
    /// pagina è `Invalid`, con l'elemento.
    List(Vec<Value>),
}

/// Gli argomenti di `spread_pages`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpreadPagesArgs {
    /// La scheda del PDF: le pagine nascono in fila alla sua destra.
    pub id: String,
    /// Le pagine; di serie tutte.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<PageList>,
    /// Quante pagine ha il PDF. `canvas.apply` lo legge dal file; senza, e
    /// senza il file, l'operazione è `Invalid`.
    #[serde(
        default,
        deserialize_with = "super::saturating_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub page_count: Option<i64>,
    /// La misura in punti di ogni pagina, `[larghezza, altezza]`, dalla prima:
    /// l'elemento `i` è la pagina `i + 1`. Una pagina senza misura, o con una
    /// misura che non è positiva, nasce 360×480. `canvas.apply` le legge dal
    /// file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_sizes: Option<Vec<Vec<f64>>>,
    /// L'etichetta del gruppo, oltre 12 pagine; di serie «N pagine».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Gli argomenti di `excerpt`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExcerptArgs {
    /// La scheda di file da cui nasce l'estratto.
    pub id: String,
    /// La parte, come il valore di `fub:parts`: `{"kind": "pages", "pages":
    /// [3, 4]}`, `region`, `sections`, `image`.
    pub part: Map<String, Value>,
    /// La scheda accanto alla quale nasce l'estratto; di serie `id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub near: Option<String>,
    /// Il lato di `near`; di serie `right`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<CanvasEdgeSide>,
    /// La misura del contenuto: i punti della pagina (`pages`, `region`) o i
    /// pixel dell'immagine (`image`). `canvas.apply` la legge dal file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_size: Option<[f64; 2]>,
    /// Con `true` è la scheda `id` a diventare l'estratto, al suo posto e con
    /// le sue misure, come il selettore delle sezioni e il ritaglio della GUI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_place: Option<bool>,
}

/// Le pagine scelte, in ordine e senza doppi, e se qualcuna oltre l'ultima
/// pagina del PDF si è tagliata.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChosenPages {
    pub pages: Vec<u64>,
    pub cut: bool,
}

/// Perché le pagine non si scelgono.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PagesProblem {
    /// Un pezzo del testo che non si legge, com'è scritto.
    Bad(String),
    /// Un elemento della lista che non è un numero di pagina, in JSON.
    NotPage(String),
    /// La lista è vuota.
    Empty,
    /// Nessuna delle pagine chieste c'è nel PDF.
    NoneInPdf,
    /// Più di [`MAX_SPREAD_PAGES`] pagine.
    TooMany,
}

/// Le pagine che `pages` chiede in un PDF di `count` pagine (almeno una),
/// come `parsePageRanges` della GUI: un pezzo `N`, `N-M` o `N-` (fino
/// all'ultima), il trattino anche «–», i pezzi separati da virgole; il testo
/// vuoto, o `None`, vuol dire tutte. Le pagine oltre `count` si tagliano
/// (`cut`). Le pagine si contano prima di elencarle: oltre
/// [`MAX_SPREAD_PAGES`] è [`PagesProblem::TooMany`].
pub fn chosen_pages(pages: Option<&PageList>, count: u64) -> Result<ChosenPages, PagesProblem> {
    let mut spans: Vec<(u64, u64)> = Vec::new();
    let mut cut = false;
    match pages {
        None => spans.push((1, count)),
        Some(PageList::Text(text)) => {
            let source = js_trim(text);
            if source.is_empty() {
                spans.push((1, count));
            }
            for raw in source.split(',').filter(|_| !source.is_empty()) {
                let piece = js_trim(raw);
                if piece.is_empty() {
                    continue;
                }
                let (first, last) =
                    read_piece(piece, count).ok_or_else(|| PagesProblem::Bad(piece.to_owned()))?;
                if first > count as f64 {
                    cut = true;
                    continue;
                }
                if last > count as f64 {
                    cut = true;
                }
                // `first` è un intero da 1 a `count`, che sta in 2^53.
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                spans.push((first as u64, (last.min(count as f64)) as u64));
            }
        }
        Some(PageList::List(items)) => {
            if items.is_empty() {
                return Err(PagesProblem::Empty);
            }
            for item in items {
                let page =
                    page_number(item).ok_or_else(|| PagesProblem::NotPage(item.to_string()))?;
                if page > count {
                    cut = true;
                } else {
                    spans.push((page, page));
                }
            }
        }
    }
    if spans.is_empty() {
        return Err(PagesProblem::NoneInPdf);
    }
    // Gli intervalli uniti, in ordine: così si contano senza elencarli.
    spans.sort_unstable();
    let mut merged: Vec<(u64, u64)> = Vec::with_capacity(spans.len());
    for (first, last) in spans {
        match merged.last_mut() {
            Some(previous) if first <= previous.1.saturating_add(1) => {
                previous.1 = previous.1.max(last);
            }
            _ => merged.push((first, last)),
        }
    }
    let total = merged.iter().fold(0u64, |sum, (first, last)| {
        sum.saturating_add(last - first + 1)
    });
    if total > MAX_SPREAD_PAGES as u64 {
        return Err(PagesProblem::TooMany);
    }
    let pages = merged
        .into_iter()
        .flat_map(|(first, last)| first..=last)
        .collect();
    Ok(ChosenPages { pages, cut })
}

/// Un pezzo `N`, `N-M` o `N-` (`PIECE` della GUI): la prima e l'ultima
/// pagina, come numeri (un numero molto lungo resta grande, come `Number`).
/// `None` se il pezzo non si legge, se la prima pagina è 0, o se l'ultima
/// viene prima della prima.
fn read_piece(piece: &str, count: u64) -> Option<(f64, f64)> {
    let digits_end = piece
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(piece.len());
    if digits_end == 0 {
        return None;
    }
    let first: f64 = piece[..digits_end].parse().ok()?;
    let rest = piece[digits_end..].trim_start_matches(is_js_space);
    let last = if rest.is_empty() && digits_end == piece.len() {
        first
    } else {
        let after = rest
            .strip_prefix('-')
            .or_else(|| rest.strip_prefix('–'))?
            .trim_start_matches(is_js_space);
        if after.is_empty() {
            count as f64
        } else if after.chars().all(|c| c.is_ascii_digit()) {
            after.parse().ok()?
        } else {
            return None;
        }
    };
    (first >= 1.0 && last >= first).then_some((first, last))
}

/// Un numero di pagina della lista: un intero da 1 a 2^53−1, anche scritto
/// `3.0`.
fn page_number(value: &Value) -> Option<u64> {
    let page = value.as_f64()?;
    let in_range = (1.0..=MAX_SAFE_INTEGER as f64).contains(&page);
    // Dentro 2^53 un `f64` intero è esatto.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let whole = page as u64;
    (in_range && page.fract() == 0.0).then_some(whole)
}

/// Lo spazio di `\s` e di `trim()` in JavaScript: gli spazi bianchi e i fine
/// riga di ECMAScript, `U+FEFF` compreso.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{000B}' | '\u{000C}' | '\r' | ' ' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// Il primo multiplo di 8 che lascia almeno 24 dopo `end` (`nextStart`).
fn next_start(end: f64) -> f64 {
    ((end + SPREAD_GAP) / SPREAD_SNAP).ceil() * SPREAD_SNAP
}

/// Un lato di nascita come `roundSide` della GUI: l'intero più vicino, non
/// sotto 40; un valore non finito o non positivo vale 40.
fn round_side(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value.round().max(MIN_SIDE)
    } else {
        MIN_SIDE
    }
}

/// La misura del contenuto, se è finita e positiva nei due lati.
fn known(content: Option<(f64, f64)>) -> Option<(f64, f64)> {
    content.filter(|(width, height)| {
        width.is_finite() && *width > 0.0 && height.is_finite() && *height > 0.0
    })
}

/// La misura di nascita come `bornSize` della GUI, per un PDF (`image`
/// falso: largo 360, alto secondo il contenuto) o un'immagine (il lato lungo
/// 480). Senza misura, o con un lato che esce dai limiti del modello, la
/// misura di serie.
fn born(image: bool, content: Option<(f64, f64)>) -> (f64, f64) {
    let fallback = if image { IMAGE_DEFAULT } else { PDF_DEFAULT };
    let Some((width, height)) = known(content) else {
        return fallback;
    };
    let size = if image {
        let scale = IMAGE_LONG_SIDE / width.max(height);
        (round_side(width * scale), round_side(height * scale))
    } else {
        (PDF_WIDTH, round_side(PDF_WIDTH * height / width))
    };
    let limit = MAX_SAFE_INTEGER as f64;
    if size.0 <= limit && size.1 <= limit {
        size
    } else {
        fallback
    }
}

/// Le posizioni delle pagine accanto a `beside`, come `spreadLayout` della
/// GUI, e il rettangolo del gruppo oltre 12 pagine.
fn spread_layout(sizes: &[(f64, f64)], beside: Rect) -> (Vec<Rect>, Option<Rect>) {
    let origin_x = next_start(beside.x + beside.width);
    let origin_y = layout::snap(beside.y);
    let mut rects = Vec::with_capacity(sizes.len());
    let mut row_y = origin_y;
    for row in sizes.chunks(SPREAD_ROW) {
        let mut x = origin_x;
        let mut row_height: f64 = 0.0;
        for &(width, height) in row {
            rects.push(Rect {
                x,
                y: row_y,
                width,
                height,
            });
            x = next_start(x + width);
            row_height = row_height.max(height);
        }
        row_y = next_start(row_y + row_height);
    }
    if sizes.len() <= GROUP_ABOVE {
        return (rects, None);
    }
    let right = rects
        .iter()
        .map(|rect| rect.x + rect.width)
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = rects
        .iter()
        .map(|rect| rect.y + rect.height)
        .fold(f64::NEG_INFINITY, f64::max);
    let group = Rect {
        x: origin_x - SPREAD_GAP,
        y: origin_y - SPREAD_GAP,
        width: right - origin_x + 2.0 * SPREAD_GAP,
        height: bottom - origin_y + 2.0 * SPREAD_GAP,
    };
    (rects, Some(group))
}

/// Il percorso del file della scheda, senza la parte dal primo `#`
/// (`cardTarget` della GUI); `None` se la scheda non è di file o il percorso
/// è vuoto.
fn file_path(node: &CanvasNode) -> Option<&str> {
    if node.node_type != CanvasNodeType::File {
        return None;
    }
    let file = node.file.as_deref()?;
    let path = file.split('#').next().unwrap_or(file);
    (!path.trim().is_empty()).then_some(path)
}

/// Una scheda nuova di file col rettangolo `rect`.
fn file_card(index: usize, id: String, path: &str, rect: Rect) -> Result<CanvasNode, OpError> {
    Ok(CanvasNode {
        id,
        node_type: CanvasNodeType::File,
        x: whole(index, rect.x)?,
        y: whole(index, rect.y)?,
        width: whole(index, rect.width)?,
        height: whole(index, rect.height)?,
        color: None,
        text: None,
        file: Some(path.to_owned()),
        subpath: None,
        url: None,
        label: None,
        background: None,
        background_style: None,
        extra: Map::new(),
    })
}

impl Compiler {
    /// `spread_pages`: il gruppo (oltre 12 pagine) e poi le pagine, in cima
    /// all'ordine, con gli id dal seme in quest'ordine.
    pub(super) fn spread_pages(
        &mut self,
        index: usize,
        args: &SpreadPagesArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let node = self.node(index, &args.id)?.clone();
        let path = match file_path(&node) {
            Some(path) if layout::card_kind(&node) == CardKind::Pdf => path.to_owned(),
            _ => {
                return Err(refuse(
                    index,
                    format!(
                        "`spread_pages` spreads the pages of a PDF card: {:?} is not one",
                        args.id
                    ),
                ))
            }
        };
        let count = match args.page_count {
            None => {
                return Err(refuse(
                    index,
                    "`spread_pages` needs `page_count`, the number of pages of the PDF: \
                     `canvas.apply` reads it from the file, give it when the file cannot be read",
                ))
            }
            Some(count) => u64::try_from(count)
                .ok()
                .filter(|count| *count >= 1)
                .ok_or_else(|| refuse(index, "`page_count` must be at least 1"))?,
        };
        let sizes = args.page_sizes.as_deref().unwrap_or_default();
        if let Some(position) = sizes.iter().position(|size| size.len() != 2) {
            return Err(refuse(
                index,
                format!("`page_sizes` item {position} is not `[width, height]`"),
            ));
        }
        let chosen = chosen_pages(args.pages.as_ref(), count).map_err(|problem| match problem {
            PagesProblem::TooMany => OpError::TooMany {
                index,
                what: "pages in one spread_pages",
                limit: MAX_SPREAD_PAGES,
            },
            PagesProblem::Bad(piece) => refuse(
                index,
                format!("`pages`: {piece:?} is not a page or a range like \"3-7\" or \"20-\""),
            ),
            PagesProblem::NotPage(item) => refuse(
                index,
                format!("`pages`: {item} is not a page number (a whole number from 1)"),
            ),
            PagesProblem::Empty => refuse(index, "`pages` is an empty list"),
            PagesProblem::NoneInPdf => refuse(
                index,
                format!("`pages`: none of the pages is in the PDF, which has {count} pages"),
            ),
        })?;
        let n = chosen.pages.len();
        let grouped = n > GROUP_ABOVE;
        if self.working.nodes.len() + n + usize::from(grouped) > MAX_NODES {
            return Err(OpError::TooMany {
                index,
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        if chosen.cut {
            self.note(
                index,
                NoteCode::PagesCut,
                format!("the PDF has {count} pages: the pages after page {count} are left out"),
            );
        }
        let born_sizes: Vec<(f64, f64)> = chosen
            .pages
            .iter()
            .map(|&page| {
                let size = usize::try_from(page - 1)
                    .ok()
                    .and_then(|at| sizes.get(at))
                    .map(|size| (size[0], size[1]));
                born(false, size)
            })
            .collect();
        let (rects, group) = spread_layout(&born_sizes, layout::Rect::of_node(&node));
        let mut patches = Vec::with_capacity(n + 1);
        if let Some(rect) = group {
            let id = self.fresh_id();
            let mut card = file_card(index, id, &path, rect)?;
            card.node_type = CanvasNodeType::Group;
            card.file = None;
            card.label = Some(args.label.clone().unwrap_or_else(|| format!("{n} pagine")));
            patches.push(self.born(index, card)?);
        }
        for (page, rect) in chosen.pages.iter().zip(rects) {
            let id = self.fresh_id();
            let mut card = file_card(index, id, &path, rect)?;
            card.subpath = Some(format!("#page={page}"));
            patches.push(self.born(index, card)?);
        }
        Ok(patches)
    }

    /// `excerpt`: una scheda nuova sullo stesso file accanto a `near`, o con
    /// `in_place` la scheda `id` stessa.
    pub(super) fn excerpt(
        &mut self,
        index: usize,
        args: &ExcerptArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let node = self.node(index, &args.id)?.clone();
        let path = file_path(&node)
            .ok_or_else(|| {
                refuse(
                    index,
                    format!(
                        "`excerpt` needs a file card: {:?} is not one, or has no file",
                        args.id
                    ),
                )
            })?
            .to_owned();
        let mut part =
            CanvasParts::from_value(&Value::Object(args.part.clone())).map_err(|reason| {
                refuse(
                    index,
                    format!("`part` is not valid ({}): {reason}", reason.as_str()),
                )
            })?;
        let in_place = args.in_place.unwrap_or(false);
        if in_place {
            if args.near.is_some() || args.side.is_some() || args.content_size.is_some() {
                return Err(refuse(
                    index,
                    "`in_place` keeps the card where it is and as large as it is: no `near`, `side` or `content_size`",
                ));
            }
            // I campi sconosciuti di un estratto valido della stessa specie
            // restano, come nella GUI; quelli di `part` vanno sopra.
            if let Some(PartsState::Ok(old)) = parts::node_parts(&node) {
                if old.kind.name() == part.kind.name() {
                    let mut extra = old.extra;
                    extra.extend(part.extra);
                    part.extra = extra;
                }
            }
        } else if args.content_size.is_some() && matches!(part.kind, PartsKind::Sections { .. }) {
            return Err(refuse(
                index,
                "`content_size` is the size of a page or of an image: sections have none",
            ));
        }
        let written = parts::write_parts(&path, &part).map_err(|reason| {
            refuse(
                index,
                format!("the part cannot be written ({}): {reason}", reason.as_str()),
            )
        })?;
        if in_place {
            let mut changed = node;
            changed.subpath = written.subpath;
            changed.extra.shift_remove(PARTS_KEY);
            if let Some(value) = written.parts {
                changed.extra.insert(PARTS_KEY.to_owned(), value);
            }
            check_node(index, &changed)?;
            return Ok(upsert_node_patch(&self.working, &changed)
                .into_iter()
                .collect());
        }
        if self.working.nodes.len() >= MAX_NODES {
            return Err(OpError::TooMany {
                index,
                what: "nodes",
                limit: MAX_NODES,
            });
        }
        let size = excerpt_size(&part.kind, args.content_size.map(|[w, h]| (w, h)));
        let near = args.near.as_deref().unwrap_or(&args.id);
        let side = args.side.unwrap_or(CanvasEdgeSide::Right);
        let rect =
            layout::place_sized_near(&self.working, near, side, None, size).ok_or_else(|| {
                OpError::UnknownNode {
                    index,
                    id: near.to_owned(),
                }
            })?;
        let id = self.fresh_id();
        let mut card = file_card(index, id, &path, rect)?;
        card.subpath = written.subpath;
        if let Some(value) = written.parts {
            card.extra.insert(PARTS_KEY.to_owned(), value);
        }
        Ok(vec![self.born(index, card)?])
    }

    /// Una scheda nuova: controllata, con l'id preso e fra i creati.
    fn born(&mut self, index: usize, card: CanvasNode) -> Result<CanvasPatch, OpError> {
        check_node(index, &card)?;
        self.taken.insert(card.id.clone());
        self.created.push(card.id.clone());
        Ok(CanvasPatch::UpsertNode {
            before: None,
            after: card,
            at: None,
        })
    }
}

/// La misura di nascita di un estratto: una pagina come il PDF, una regione
/// con le proporzioni del suo rettangolo sulla pagina, sezioni come una nota,
/// un ritaglio con le proporzioni della zona (girata di 90 o 270 gradi, i
/// lati si scambiano). Senza `content` la pagina vale 360×480 e l'immagine
/// 480×360.
fn excerpt_size(kind: &PartsKind, content: Option<(f64, f64)>) -> (f64, f64) {
    match kind {
        PartsKind::Pages { .. } => born(false, content),
        PartsKind::Region { rect, .. } => {
            let (width, height) = known(content).unwrap_or(PDF_DEFAULT);
            born(false, Some((rect.width * width, rect.height * height)))
        }
        PartsKind::Sections { .. } => NOTE_SIZE,
        PartsKind::Image { rect, rotate } => {
            let (width, height) = known(content).unwrap_or(IMAGE_DEFAULT);
            let zone = (rect.width * width, rect.height * height);
            let turned = rotate
                .is_some_and(|degrees| (degrees.rem_euclid(180.0) - 90.0).abs() < f64::EPSILON);
            born(true, Some(if turned { (zone.1, zone.0) } else { zone }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::{compile, CanvasOp};
    use serde_json::json;

    fn text(source: &str, count: u64) -> Result<ChosenPages, PagesProblem> {
        chosen_pages(Some(&PageList::Text(source.to_owned())), count)
    }

    fn pages(list: &[u64], cut: bool) -> Result<ChosenPages, PagesProblem> {
        Ok(ChosenPages {
            pages: list.to_vec(),
            cut,
        })
    }

    /// I casi di `page-ranges.test.ts`, uguali.
    #[test]
    fn le_pagine_si_leggono_come_nella_gui() {
        assert_eq!(text("", 5), pages(&[1, 2, 3, 4, 5], false));
        assert_eq!(text("  ", 3), pages(&[1, 2, 3], false));
        assert_eq!(text("3-5, 1", 9), pages(&[1, 3, 4, 5], false));
        assert_eq!(text("2–4", 9), pages(&[2, 3, 4], false));
        assert_eq!(text("7-", 9), pages(&[7, 8, 9], false));
        assert_eq!(text("7 - ", 9), pages(&[7, 8, 9], false));
        assert_eq!(text("4 -6", 9), pages(&[4, 5, 6], false));
        assert_eq!(text("2, 2, 1-3", 9), pages(&[1, 2, 3], false));
        assert_eq!(text("1,,3", 9), pages(&[1, 3], false));
        assert_eq!(text("8-12", 9), pages(&[8, 9], true));
        assert_eq!(text("3, 40", 9), pages(&[3], true));
        assert_eq!(text("1-99999999999999999999", 2), pages(&[1, 2], true));
        assert_eq!(text("\u{FEFF}2\u{3000}", 3), pages(&[2], false));
        for bad in ["0", "0-3", "5-3", "a", "3-x", "3--4", "-3", "3 4", "3.5"] {
            assert_eq!(
                text(bad, 9),
                Err(PagesProblem::Bad(bad.trim().to_owned())),
                "{bad}"
            );
        }
        assert_eq!(text("12, 30", 9), Err(PagesProblem::NoneInPdf));
        // «30-» finisce all'ultima pagina, che viene prima: come nella GUI non si legge.
        assert_eq!(text("30-", 9), Err(PagesProblem::Bad("30-".to_owned())));
    }

    #[test]
    fn la_lista_si_ordina_si_taglia_e_rifiuta_cio_che_non_e_una_pagina() {
        let list = |items: Value| {
            let Value::Array(items) = items else {
                unreachable!()
            };
            chosen_pages(Some(&PageList::List(items)), 9)
        };
        assert_eq!(list(json!([3, 1, 3.0, 12])), pages(&[1, 3], true));
        assert_eq!(list(json!([])), Err(PagesProblem::Empty));
        assert_eq!(list(json!([10, 11])), Err(PagesProblem::NoneInPdf));
        assert_eq!(list(json!([0])), Err(PagesProblem::NotPage("0".to_owned())));
        assert_eq!(
            list(json!([1.5])),
            Err(PagesProblem::NotPage("1.5".to_owned()))
        );
        assert_eq!(
            list(json!(["2"])),
            Err(PagesProblem::NotPage("\"2\"".to_owned()))
        );
    }

    #[test]
    fn le_pagine_si_contano_prima_di_elencarle() {
        let huge = MAX_SAFE_INTEGER as u64;
        assert_eq!(text("", huge), Err(PagesProblem::TooMany));
        assert_eq!(text("1-", huge), Err(PagesProblem::TooMany));
        assert_eq!(chosen_pages(None, 1000).map(|c| c.pages.len()), Ok(1000));
        assert_eq!(chosen_pages(None, 1001), Err(PagesProblem::TooMany));
        // Gli intervalli che si toccano o si coprono contano una volta.
        assert_eq!(
            text("1-600, 400-1000", huge).map(|c| c.pages.len()),
            Ok(1000)
        );
    }

    #[test]
    fn le_misure_di_nascita_sono_quelle_di_born_size_della_gui() {
        // `drop-layout.test.ts`: un A4 nasce 360×509, una 16:9 480×270.
        assert_eq!(born(false, Some((595.0, 842.0))), (360.0, 509.0));
        assert_eq!(born(true, Some((1920.0, 1080.0))), (480.0, 270.0));
        assert_eq!(born(true, Some((1.0, 4000.0))), (40.0, 480.0));
        assert_eq!(born(false, None), PDF_DEFAULT);
        assert_eq!(born(false, Some((0.0, 842.0))), PDF_DEFAULT);
        assert_eq!(born(true, Some((f64::NAN, 1.0))), IMAGE_DEFAULT);
        // Un lato infinito vale 40, come `roundSide`.
        assert_eq!(born(false, Some((1e-300, 1e300))), (360.0, 40.0));
    }

    #[test]
    fn la_fila_e_quella_di_spread_layout() {
        // `drop-layout.test.ts`: la prima pagina accanto alla scheda, a 384.
        let beside = Rect {
            x: 0.0,
            y: 0.0,
            width: 360.0,
            height: 480.0,
        };
        let (rects, group) = spread_layout(&[(360.0, 466.0)], beside);
        assert_eq!(
            rects,
            vec![Rect {
                x: 384.0,
                y: 0.0,
                width: 360.0,
                height: 466.0
            }]
        );
        assert_eq!(group, None);
        let (rects, group) = spread_layout(&vec![(360.0, 466.0); 24], beside);
        let rows: std::collections::BTreeSet<i64> = rects.iter().map(|r| r.y as i64).collect();
        assert_eq!(rows.into_iter().collect::<Vec<_>>(), vec![0, 496, 992]);
        assert!(rects.iter().all(|r| r.x as i64 % 8 == 0));
        let group = group.expect("oltre 12 pagine c'è il gruppo");
        assert_eq!((group.x, group.y), (360.0, -24.0));
    }

    fn board() -> crate::model::Canvas {
        crate::parse(
            r#"{"nodes":[
                {"id":"p","type":"file","file":"Corsi/dispensa.pdf","x":0,"y":0,"width":360,"height":480},
                {"id":"n","type":"file","file":"Corsi/appunti.md","x":0,"y":600,"width":320,"height":240},
                {"id":"t","type":"text","text":"x","x":0,"y":-400,"width":320,"height":160}
            ],"edges":[]}"#,
        )
        .expect("la lavagna si legge")
    }

    fn ops(value: Value) -> Vec<CanvasOp> {
        serde_json::from_value(value).expect("le operazioni si leggono")
    }

    #[test]
    fn le_pagine_tagliate_lasciano_una_nota() {
        let compiled = compile(
            &board(),
            &ops(json!([{"op": "spread_pages", "id": "p", "pages": "3-20", "page_count": 4}])),
            1,
        )
        .expect("si compila");
        assert_eq!(compiled.created.len(), 2);
        assert_eq!(compiled.notes.len(), 1);
        assert_eq!(compiled.notes[0].code, NoteCode::PagesCut);
        assert!(
            compiled.notes[0].detail.contains("4 pages"),
            "{}",
            compiled.notes[0].detail
        );
        let whole = compile(
            &board(),
            &ops(json!([{"op": "spread_pages", "id": "p", "pages": [1, 2], "page_count": 4}])),
            1,
        )
        .expect("si compila");
        assert!(whole.notes.is_empty());
    }

    #[test]
    fn le_ragioni_dei_rifiuti_dicono_che_cosa_correggere() {
        let reason = |op: Value| match compile(&board(), &ops(json!([op])), 1) {
            Err(OpError::Invalid { reason, .. }) => reason,
            other => panic!("non è Invalid: {other:?}"),
        };
        assert!(
            reason(json!({"op": "spread_pages", "id": "p", "pages": "1-3"})).contains("page_count")
        );
        assert!(
            reason(json!({"op": "spread_pages", "id": "n", "page_count": 3})).contains("not one")
        );
        assert!(
            reason(json!({"op": "spread_pages", "id": "p", "page_count": 0}))
                .contains("at least 1")
        );
        assert!(
            reason(json!({"op": "spread_pages", "id": "p", "page_count": 3, "pages": "x"}))
                .contains("\"x\"")
        );
        assert!(reason(
            json!({"op": "spread_pages", "id": "p", "page_count": 3, "page_sizes": [[1, 2, 3]]})
        )
        .contains("item 0"));
        assert!(reason(
            json!({"op": "excerpt", "id": "t", "part": {"kind": "sections", "sections": ["A"]}})
        )
        .contains("file card"));
        assert!(reason(
            json!({"op": "excerpt", "id": "p", "part": {"kind": "sections", "sections": ["A"]}})
        )
        .contains("(file)"));
        assert!(reason(
            json!({"op": "excerpt", "id": "p", "part": {"kind": "pages", "pages": []}})
        )
        .contains("(field)"));
        assert!(reason(json!({"op": "excerpt", "id": "p", "part": {"kind": "pages", "pages": [1], "layout": "x"}})).contains("(field)"));
        assert!(
            reason(json!({"op": "excerpt", "id": "p", "part": {"kind": "rombo"}}))
                .contains("(kind)")
        );
        assert!(reason(json!({"op": "excerpt", "id": "n", "part": {"kind": "sections", "sections": ["A"]}, "in_place": true, "near": "p"})).contains("in_place"));
    }

    #[test]
    fn sul_posto_restano_i_campi_sconosciuti_dell_estratto_di_prima() {
        let mut canvas = board();
        canvas.nodes[1].subpath = Some("#A".to_owned());
        canvas.nodes[1].extra.insert(
            PARTS_KEY.to_owned(),
            json!({"kind": "sections", "sections": ["A", "B"], "fub:nota": 1}),
        );
        let compiled = compile(
            &canvas,
            &ops(json!([{"op": "excerpt", "id": "n", "part": {"kind": "sections", "sections": ["C", "D"]}, "in_place": true}])),
            1,
        )
        .expect("si compila");
        let after = crate::patch::draft(&canvas, &compiled.patches).expect("si applica");
        let card = &after.nodes[1];
        assert_eq!(card.subpath.as_deref(), Some("#C"));
        assert_eq!(
            card.extra[PARTS_KEY],
            json!({"kind": "sections", "sections": ["C", "D"], "fub:nota": 1})
        );
        assert!(compiled.created.is_empty());
    }

    #[test]
    fn le_misure_dell_estratto_vengono_dalla_parte() {
        let region = PartsKind::Region {
            page: 2,
            rect: parts::PartRect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 0.25,
            },
            key: None,
        };
        // Un quarto di un A4: 595 × 210,5 punti, largo 360.
        assert_eq!(excerpt_size(&region, Some((595.0, 842.0))), (360.0, 127.0));
        let crop = |rotate| PartsKind::Image {
            rect: parts::PartRect {
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            },
            rotate,
        };
        assert_eq!(
            excerpt_size(&crop(None), Some((1600.0, 1200.0))),
            (320.0, 480.0)
        );
        assert_eq!(
            excerpt_size(&crop(Some(90.0)), Some((1600.0, 1200.0))),
            (480.0, 320.0)
        );
        assert_eq!(
            excerpt_size(&crop(Some(-270.0)), Some((1600.0, 1200.0))),
            (480.0, 320.0)
        );
        assert_eq!(
            excerpt_size(&crop(Some(180.0)), Some((1600.0, 1200.0))),
            (320.0, 480.0)
        );
        let sections = PartsKind::Sections {
            sections: vec!["A".to_owned()],
        };
        assert_eq!(excerpt_size(&sections, None), NOTE_SIZE);
    }
}
