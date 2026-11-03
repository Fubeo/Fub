//! L'anteprima di una foto RAW.

use fub_format_craft::{CraftPreview, Missing};

/// Completa `preview` di una foto RAW: senza leggerne i pezzi, il file non
/// porta un'anteprima.
pub(super) fn read(preview: &mut CraftPreview) {
    preview.missing = Some(Missing::Absent);
}
