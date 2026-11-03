//! L'anteprima di un PDF o di un documento di testo.

use fub_format_craft::{CraftPreview, Missing};

/// Completa `preview` di un PDF o di un documento: senza leggerne i pezzi, il
/// file non porta un'anteprima.
pub(super) fn read(preview: &mut CraftPreview) {
    preview.missing = Some(Missing::Absent);
}
