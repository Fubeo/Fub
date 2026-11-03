//! L'anteprima di un file VectorCraft, PhotoCraft o FigCraft: la versione del
//! formato (`read_meta`) e l'immagine che il file porta
//! (`container::embedded_preview`).

use fub_format_craft::container::{embedded_preview, read_meta};
use fub_format_craft::{CraftApp, CraftPreview, PreviewImage, PreviewOrigin, PreviewSize};

/// Completa `preview` coi byte del file.
pub(super) fn read(preview: &mut CraftPreview, app: CraftApp, bytes: &[u8], size: PreviewSize) {
    preview.info.format_version = read_meta(app, bytes)
        .ok()
        .and_then(|contents| contents.format_version);
    let image = embedded_preview(app, bytes, size)
        .ok()
        .flatten()
        .and_then(|png| PreviewImage::from_png(&png.bytes));
    if image.is_some() {
        preview.origin = PreviewOrigin::File;
        preview.image = image;
    }
}
