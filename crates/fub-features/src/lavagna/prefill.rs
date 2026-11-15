//! Le misure del contenuto che la lista non porta: il `content_size` di
//! un'immagine o di un PDF, per `add_card` con `file` e per `resize` con
//! `fit: content`; il numero e le misure delle pagine di un PDF per
//! `spread_pages` (`page_count`, `page_sizes`); il numero delle pagine e la
//! misura della pagina o dell'immagine di un `excerpt` (`page_count`,
//! `content_size`); il numero delle pagine e la misura della pagina di un
//! `on` sulla pagina di un PDF, per `draw` ed `erase_along` (`page_count`,
//! `page_size`). Il nucleo non legge file: lo fa qui, con
//! `read_document_bytes`, e misura con `imagesize` (le immagini) e con
//! [`crate::draw::pdf_page_sizes`] (le pagine di un PDF). Ogni file si legge
//! una volta sola per lista.
//!
//! Un file che non c'è, che non si legge, che supera [`MAX_BYTES`], o che non si
//! misura (un PDF malformato o cifrato) lascia l'operazione com'è: per
//! `add_card` decidono le misure di serie, per `resize` il rifiuto dice di dare
//! `content_size`, per `spread_pages` di dare `page_count`. Un file che non è
//! un'immagine né un PDF non si legge affatto: è la sua estensione a dirlo.
//!
//! Il numero delle pagine letto dal file vince su quello dato: se sono diversi,
//! la nota `page_count_from_file` lo dice.

use std::collections::HashMap;

use fub_abi::model::DocId;
use fub_abi::traits::HostApi;
use fub_canvas_core::layout::{self, CardKind};
use fub_canvas_core::model::Canvas;
use fub_canvas_core::ops::{
    chosen_pages, CanvasOp, CompileNote, DrawArgs, EraseAlongArgs, ExcerptArgs, InkOn, NoteCode,
    OnPage, SpreadPagesArgs,
};
use fub_canvas_core::parts::{CanvasParts, PartsKind};
use serde_json::Value;

use crate::draw;

/// Il byte più grande di un file che si misura: 32 MiB. Il vault non dice la
/// dimensione prima di leggere, quindi un file più grande si legge e si scarta.
const MAX_BYTES: usize = 32 * 1024 * 1024;

/// Ciò che un file dà: i pixel di un'immagine, o le misure delle pagine di un
/// PDF (almeno una), in punti, dalla prima.
enum Content {
    Image([f64; 2]),
    Pages(Vec<[f64; 2]>),
}

impl Content {
    /// La misura che conta per una scheda: l'immagine, o la prima pagina.
    fn size(&self) -> Option<[f64; 2]> {
        match self {
            Content::Image(size) => Some(*size),
            Content::Pages(pages) => pages.first().copied(),
        }
    }

    fn pages(&self) -> Option<&[[f64; 2]]> {
        match self {
            Content::Pages(pages) => Some(pages),
            Content::Image(_) => None,
        }
    }
}

/// I file letti in questa lista: `None` se il file non si misura.
struct Files<'h> {
    host: &'h dyn HostApi,
    read: HashMap<String, Option<Content>>,
}

impl Files<'_> {
    /// Ciò che dà `file`, letto la prima volta che serve.
    fn content(&mut self, file: &str) -> Option<&Content> {
        let host = self.host;
        self.read
            .entry(file.to_owned())
            .or_insert_with(|| read_content(host, file))
            .as_ref()
    }

    fn size(&mut self, file: &str) -> Option<[f64; 2]> {
        self.content(file)?.size()
    }

    fn pages(&mut self, file: &str) -> Option<&[[f64; 2]]> {
        self.content(file)?.pages()
    }
}

/// Le misure del contenuto per le operazioni di `ops` che le chiedono e non le
/// hanno. Dà le note di ciò che ha corretto (un `page_count` diverso dal file).
pub(super) fn fill_ops(
    host: &dyn HostApi,
    canvas: &Canvas,
    ops: &mut [CanvasOp],
) -> Vec<CompileNote> {
    let mut files = Files {
        host,
        read: HashMap::new(),
    };
    // Gli id delle schede aggiunte in questa lista con un `file`: un `resize`
    // che le segue trova il suo file anche se la scheda non è ancora nel modello.
    let mut added: HashMap<String, String> = HashMap::new();
    let mut notes = Vec::new();
    for (index, op) in ops.iter_mut().enumerate() {
        match op {
            CanvasOp::AddCard(card) => {
                if card.node.is_none() && card.content_size.is_none() {
                    if let Some(file) = &card.file {
                        card.content_size = files.size(file);
                    }
                }
                if let (Some(id), Some(file)) = (&card.id, &card.file) {
                    added.insert(id.clone(), file.clone());
                }
            }
            CanvasOp::Resize(args) => {
                if args.fit.is_none() || args.content_size.is_some() {
                    continue;
                }
                if let Some(file) = card_file(canvas, &added, &args.id) {
                    args.content_size = files.size(&file);
                }
            }
            CanvasOp::SpreadPages(args) => {
                if let Some(file) = card_file(canvas, &added, &args.id) {
                    if let Some(pages) = files.pages(&file) {
                        notes.extend(fill_spread(index, args, pages));
                    }
                }
            }
            CanvasOp::Excerpt(args) => {
                if let Some(file) = card_file(canvas, &added, &args.id) {
                    notes.extend(fill_excerpt(index, &mut files, &file, args));
                }
            }
            CanvasOp::Draw(DrawArgs {
                on: Some(InkOn::Page(on)),
                ..
            })
            | CanvasOp::EraseAlong(EraseAlongArgs {
                on: Some(InkOn::Page(on)),
                ..
            }) => {
                if let Some(file) = card_file(canvas, &added, &on.card) {
                    if let Some(pages) = files.pages(&file) {
                        notes.extend(fill_page(index, on, pages));
                    }
                }
            }
            _ => {}
        }
    }
    notes
}

/// Il file della scheda `id`: aggiunta prima nella lista, o nel modello. La
/// parte dal primo `#` non è del percorso.
fn card_file(canvas: &Canvas, added: &HashMap<String, String>, id: &str) -> Option<String> {
    let file = added.get(id).cloned().or_else(|| {
        canvas
            .nodes
            .iter()
            .find(|node| node.id == id)
            .and_then(|node| node.file.clone())
    })?;
    Some(file.split('#').next().unwrap_or(&file).to_owned())
}

/// Il conto delle pagine del file in `page_count`: se ne era dato un altro,
/// vince il file e la nota lo dice.
fn count_from_file(index: usize, given: &mut Option<i64>, pages: usize) -> Option<CompileNote> {
    let read = i64::try_from(pages).ok()?;
    let note = given
        .filter(|count| *count != read)
        .map(|count| CompileNote {
            index,
            code: NoteCode::PageCountFromFile,
            detail: format!("`page_count` is {count}, but the PDF has {read} pages: the file wins"),
        });
    *given = Some(read);
    note
}

/// `page_count` e `page_sizes` di uno `spread_pages` dalle misure delle pagine
/// del PDF: il conto del file, e le misure delle pagine fino all'ultima scelta
/// (le altre non servono) se non sono date.
fn fill_spread(
    index: usize,
    args: &mut SpreadPagesArgs,
    pages: &[[f64; 2]],
) -> Option<CompileNote> {
    let note = count_from_file(index, &mut args.page_count, pages.len());
    if args.page_sizes.is_none() {
        // Pagine che non vanno: lo dirà la compilazione.
        let last = u64::try_from(pages.len())
            .ok()
            .and_then(|count| chosen_pages(args.pages.as_ref(), count).ok())
            .and_then(|chosen| chosen.pages.last().copied())
            .and_then(|last| usize::try_from(last).ok());
        if let Some(last) = last {
            args.page_sizes = Some(pages.iter().take(last).map(|size| size.to_vec()).collect());
        }
    }
    note
}

/// Il conto delle pagine di un estratto di un PDF, e la misura del contenuto
/// di un estratto nuovo: la pagina (`pages`, la prima; `region`) o l'immagine
/// (`image`). Le sezioni non ne hanno.
fn fill_excerpt(
    index: usize,
    files: &mut Files<'_>,
    file: &str,
    args: &mut ExcerptArgs,
) -> Option<CompileNote> {
    let note = files
        .pages(file)
        .and_then(|pages| count_from_file(index, &mut args.page_count, pages.len()));
    if args.in_place == Some(true) || args.content_size.is_some() {
        return note;
    }
    let part = CanvasParts::from_value(&Value::Object(args.part.clone())).ok();
    args.content_size = match part.map(|part| part.kind) {
        Some(PartsKind::Pages { pages, .. }) => {
            pages.first().and_then(|page| page_size(files, file, *page))
        }
        Some(PartsKind::Region { page, .. }) => page_size(files, file, page),
        Some(PartsKind::Image { .. }) => files.size(file),
        Some(PartsKind::Sections { .. }) | None => None,
    };
    note
}

/// `page_count` e `page_size` di un `on` sulla pagina di un PDF (`draw`,
/// `erase_along`): il conto del file, e la misura della pagina se non è data.
/// Una pagina oltre l'ultima resta senza misura: la rifiuta la compilazione,
/// col conto.
fn fill_page(index: usize, on: &mut OnPage, pages: &[[f64; 2]]) -> Option<CompileNote> {
    let note = count_from_file(index, &mut on.page_count, pages.len());
    if on.page_size.is_none() {
        on.page_size = on
            .page
            .checked_sub(1)
            .and_then(|at| usize::try_from(at).ok())
            .and_then(|at| pages.get(at).copied());
    }
    note
}

/// La misura della pagina `page` (da 1) di un PDF.
fn page_size(files: &mut Files<'_>, file: &str, page: u64) -> Option<[f64; 2]> {
    let at = usize::try_from(page.checked_sub(1)?).ok()?;
    files.pages(file)?.get(at).copied()
}

/// Ciò che dà `file`: le misure di un'immagine, o delle pagine di un PDF. Un
/// file di un'altra specie non si legge.
fn read_content(host: &dyn HostApi, file: &str) -> Option<Content> {
    let kind = layout::kind_of_path(file);
    if !matches!(kind, CardKind::Image | CardKind::Pdf) {
        return None;
    }
    let bytes = host.read_document_bytes(&DocId::new(file)).ok()?;
    if bytes.len() > MAX_BYTES {
        return None;
    }
    match kind {
        CardKind::Pdf => draw::pdf_page_sizes(&bytes).map(|sizes| {
            Content::Pages(
                sizes
                    .into_iter()
                    .map(|(width, height)| [width, height])
                    .collect(),
            )
        }),
        _ => {
            let size = imagesize::blob_size(&bytes).ok()?;
            // Le dimensioni di un'immagine stanno ben dentro un `f64` esatto.
            #[allow(clippy::cast_precision_loss)]
            let measured = [size.width as f64, size.height as f64];
            Some(Content::Image(measured))
        }
    }
}
