//! Le misure del contenuto che la lista non porta: il `content_size` di
//! un'immagine o di un PDF, per `add_card` con `file` e per `resize` con
//! `fit: content`. Il nucleo non legge file: lo fa qui, con
//! `read_document_bytes`, e misura con `imagesize` (le immagini) e con
//! [`crate::draw::pdf_first_page`] (la prima pagina di un PDF).
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
use fub_canvas_core::ops::CanvasOp;
use serde_json::Value;

use crate::draw;

/// Il byte più grande di un file che si misura: 32 MiB. Il vault non dice la
/// dimensione prima di leggere, quindi un file più grande si legge e si scarta.
const MAX_BYTES: usize = 32 * 1024 * 1024;

/// Le misure del contenuto per le operazioni di `ops` che le chiedono e non le
/// hanno. Dà `true` se ne ha messa almeno una.
pub(super) fn fill_ops(host: &dyn HostApi, canvas: &Canvas, ops: &mut [CanvasOp]) -> bool {
    let mut measured: HashMap<String, Option<[f64; 2]>> = HashMap::new();
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
    let bytes = host.read_document_bytes(&DocId::new(file)).ok()?;
    if bytes.len() > MAX_BYTES {
        return None;
    }
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
