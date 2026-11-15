//! Le misure del contenuto che la lista non porta: il `content_size` di
//! un'immagine o di un PDF, per `add_card` con `file` e per `resize` con
//! `fit: content`; il numero e le misure delle pagine di un PDF per
//! `spread_pages` (`page_count`, `page_sizes`); la misura della pagina o
//! dell'immagine di un `excerpt` (`content_size`). Il nucleo non legge file: lo
//! fa qui, con `read_document_bytes`, e misura con `imagesize` (le immagini) e
//! con [`crate::draw::pdf_first_page`] e [`crate::draw::pdf_page_sizes`] (le
//! pagine di un PDF).
//!
//! Un file che non c'è, che non si legge, che supera [`MAX_BYTES`], o che non si
//! misura lascia l'operazione com'è: per `add_card` decidono le misure di serie,
//! per `resize` il rifiuto dice di dare `content_size`. Un file che non è
//! un'immagine né un PDF non si legge affatto: è la sua estensione a dirlo.

use std::collections::HashMap;

use fub_abi::model::DocId;
use fub_abi::traits::HostApi;
use fub_canvas_core::layout::{self, CardKind};
use fub_canvas_core::model::Canvas;
use fub_canvas_core::ops::{chosen_pages, CanvasOp, ExcerptArgs, SpreadPagesArgs};
use fub_canvas_core::parts::{CanvasParts, PartsKind};
use serde_json::Value;

use crate::draw;

/// Il byte più grande di un file che si misura: 32 MiB. Il vault non dice la
/// dimensione prima di leggere, quindi un file più grande si legge e si scarta.
const MAX_BYTES: usize = 32 * 1024 * 1024;

/// Le misure del contenuto per le operazioni di `ops` che le chiedono e non le
/// hanno. Dà `true` se ne ha messa almeno una.
pub(super) fn fill_ops(host: &dyn HostApi, canvas: &Canvas, ops: &mut [CanvasOp]) -> bool {
    let mut measured: HashMap<String, Option<[f64; 2]>> = HashMap::new();
    let mut paged: HashMap<String, Option<Vec<[f64; 2]>>> = HashMap::new();
    // Gli id delle schede aggiunte in questa lista con un `file`: un `resize`
    // che le segue trova il suo file anche se la scheda non è ancora nel modello.
    let mut files: HashMap<String, String> = HashMap::new();
    let mut changed = false;
    for op in ops.iter_mut() {
        match op {
            CanvasOp::AddCard(card) => {
                if card.node.is_none() && card.content_size.is_none() {
                    if let Some(file) = &card.file {
                        if let Some(size) = measure(host, &mut measured, file) {
                            card.content_size = Some(size);
                            changed = true;
                        }
                    }
                }
                if let (Some(id), Some(file)) = (&card.id, &card.file) {
                    files.insert(id.clone(), file.clone());
                }
            }
            CanvasOp::Resize(args) => {
                if args.fit.is_none() || args.content_size.is_some() {
                    continue;
                }
                let file = files.get(&args.id).cloned().or_else(|| {
                    canvas
                        .nodes
                        .iter()
                        .find(|node| node.id == args.id)
                        .and_then(|node| node.file.clone())
                });
                if let Some(file) = file {
                    if let Some(size) = measure(host, &mut measured, &file) {
                        args.content_size = Some(size);
                        changed = true;
                    }
                }
            }
            CanvasOp::SpreadPages(args) => {
                if args.page_count.is_some() && args.page_sizes.is_some() {
                    continue;
                }
                if let Some(file) = card_file(canvas, &files, &args.id) {
                    if let Some(sizes) = pages_of(host, &mut paged, &file) {
                        changed |= fill_spread(args, &sizes);
                    }
                }
            }
            CanvasOp::Excerpt(args) => {
                if args.in_place == Some(true) || args.content_size.is_some() {
                    continue;
                }
                if let Some(file) = card_file(canvas, &files, &args.id) {
                    if let Some(size) =
                        excerpt_measure(host, &mut measured, &mut paged, &file, args)
                    {
                        args.content_size = Some(size);
                        changed = true;
                    }
                }
            }
            _ => {}
        }
    }
    changed
}

/// Come [`fill_ops`], su una lista JSON com'è scritta: `check` riceve il JSON. Se
/// non c'è niente da misurare, o la lista non si legge (e lo dirà `check`), la
/// lista torna com'era.
pub(super) fn fill_list(host: &dyn HostApi, canvas: &Canvas, list: Value) -> Value {
    let Ok(mut ops) = serde_json::from_value::<Vec<CanvasOp>>(list.clone()) else {
        return list;
    };
    if !fill_ops(host, canvas, &mut ops) {
        return list;
    }
    serde_json::to_value(&ops).unwrap_or(list)
}

/// Il file della scheda `id`: aggiunta prima nella lista, o nel modello. La
/// parte dal primo `#` non è del percorso.
fn card_file(canvas: &Canvas, files: &HashMap<String, String>, id: &str) -> Option<String> {
    let file = files.get(id).cloned().or_else(|| {
        canvas
            .nodes
            .iter()
            .find(|node| node.id == id)
            .and_then(|node| node.file.clone())
    })?;
    Some(file.split('#').next().unwrap_or(&file).to_owned())
}

/// `page_count` e `page_sizes` di uno `spread_pages` dalle misure delle pagine
/// del PDF: il conto se manca, e le misure delle pagine fino all'ultima scelta
/// (le altre non servono). Dà `true` se ha messo qualcosa.
fn fill_spread(args: &mut SpreadPagesArgs, sizes: &[[f64; 2]]) -> bool {
    let mut changed = false;
    if args.page_count.is_none() {
        args.page_count = i64::try_from(sizes.len()).ok();
        changed = args.page_count.is_some();
    }
    if args.page_sizes.is_none() {
        let count = args.page_count.and_then(|count| u64::try_from(count).ok());
        // Con un conto o pagine che non vanno, lo dirà la compilazione.
        let last = count
            .filter(|count| *count >= 1)
            .and_then(|count| chosen_pages(args.pages.as_ref(), count).ok())
            .and_then(|chosen| chosen.pages.last().copied())
            .and_then(|last| usize::try_from(last).ok());
        if let Some(last) = last {
            let wanted = sizes.iter().take(last).map(|size| size.to_vec()).collect();
            args.page_sizes = Some(wanted);
            changed = true;
        }
    }
    changed
}

/// La misura del contenuto di un estratto nuovo: la pagina (`pages`, la prima;
/// `region`) di un PDF, o l'immagine (`image`). Le sezioni non ne hanno.
fn excerpt_measure(
    host: &dyn HostApi,
    measured: &mut HashMap<String, Option<[f64; 2]>>,
    paged: &mut HashMap<String, Option<Vec<[f64; 2]>>>,
    file: &str,
    args: &ExcerptArgs,
) -> Option<[f64; 2]> {
    let part = CanvasParts::from_value(&Value::Object(args.part.clone())).ok()?;
    let page = match part.kind {
        PartsKind::Pages { pages, .. } => *pages.first()?,
        PartsKind::Region { page, .. } => page,
        PartsKind::Image { .. } => return measure(host, measured, file),
        PartsKind::Sections { .. } => return None,
    };
    let sizes = pages_of(host, paged, file)?;
    let at = usize::try_from(page.checked_sub(1)?).ok()?;
    sizes.get(at).copied()
}

/// Le misure delle pagine di un PDF, una volta sola per lista: `None` se il
/// file non è un PDF, non si legge o non si apre.
fn pages_of(
    host: &dyn HostApi,
    paged: &mut HashMap<String, Option<Vec<[f64; 2]>>>,
    file: &str,
) -> Option<Vec<[f64; 2]>> {
    if let Some(sizes) = paged.get(file) {
        return sizes.clone();
    }
    let sizes = (layout::kind_of_path(file) == CardKind::Pdf)
        .then(|| read_bytes(host, file))
        .flatten()
        .and_then(|bytes| draw::pdf_page_sizes(&bytes))
        .map(|sizes| {
            sizes
                .into_iter()
                .map(|(width, height)| [width, height])
                .collect()
        });
    paged.insert(file.to_owned(), sizes.clone());
    sizes
}

/// I byte di un file del vault, fino a [`MAX_BYTES`].
fn read_bytes(host: &dyn HostApi, file: &str) -> Option<Vec<u8>> {
    let bytes = host.read_document_bytes(&DocId::new(file)).ok()?;
    (bytes.len() <= MAX_BYTES).then_some(bytes)
}

/// La misura di un file, una volta sola per lista: `None` se non ce n'è una.
fn measure(
    host: &dyn HostApi,
    measured: &mut HashMap<String, Option<[f64; 2]>>,
    file: &str,
) -> Option<[f64; 2]> {
    if let Some(size) = measured.get(file) {
        return *size;
    }
    let size = read_measure(host, file);
    measured.insert(file.to_owned(), size);
    size
}

/// Le dimensioni che dà il contenuto di `file`: quelle di un'immagine, o della
/// prima pagina di un PDF. Un file di un'altra specie non si legge.
fn read_measure(host: &dyn HostApi, file: &str) -> Option<[f64; 2]> {
    let kind = layout::kind_of_path(file);
    if !matches!(kind, CardKind::Image | CardKind::Pdf) {
        return None;
    }
    let bytes = read_bytes(host, file)?;
    match kind {
        CardKind::Pdf => draw::pdf_first_page(&bytes).map(|(width, height)| [width, height]),
        _ => {
            let size = imagesize::blob_size(&bytes).ok()?;
            // Le dimensioni di un'immagine stanno ben dentro un `f64` esatto.
            #[allow(clippy::cast_precision_loss)]
            let measured = [size.width as f64, size.height as f64];
            Some(measured)
        }
    }
}
