//! L'anteprima di un file VectorCraft, PhotoCraft o FigCraft: la versione del
//! formato (`read_meta`) e l'immagine che il file porta
//! (`container::embedded_preview`).

use fub_format_craft::container::{embedded_preview, read_meta};
use fub_format_craft::{CraftApp, CraftPreview, Missing, PreviewImage, PreviewOrigin, PreviewSize};

/// Completa `preview` coi byte del file. Un file che non si apre come il suo
/// formato è `missing: unreadable`; uno che si apre senza un'anteprima resta
/// `absent`.
pub(super) fn read(preview: &mut CraftPreview, app: CraftApp, bytes: &[u8], size: PreviewSize) {
    match read_meta(app, bytes) {
        Ok(contents) => preview.info.format_version = contents.format_version,
        Err(_) => preview.missing = Some(Missing::Unreadable),
    }
    let image = embedded_preview(app, bytes, size)
        .ok()
        .flatten()
        .and_then(|png| PreviewImage::from_png(&png.bytes));
    if image.is_some() {
        preview.origin = PreviewOrigin::File;
        preview.image = image;
        preview.missing = None;
    }
}
