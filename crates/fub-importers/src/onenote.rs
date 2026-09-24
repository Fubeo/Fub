//! OneNote adapter re-export: the real implementation lives in
//! [`crate::apple`] (shared prerequisites); this module is the dispatch
//! half so the mount table reads `OneNoteImport` / `AppleImport` as the
//! matrix names them.

pub use crate::apple::OneNoteImport;
