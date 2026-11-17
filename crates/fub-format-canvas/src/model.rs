//! Modello persistito `.canvas`: vive nel nucleo della lavagna
//! (`fub-canvas-core`), puro e senza contratto, perché lo usano anche i
//! comandi e la WebView. Qui restano le due costanti del **formato**: l'id
//! che il provider rivendica e la versione dello schema interpretato.

pub use fub_canvas_core::model::*;

/// Id del formato, estensione rivendicata e namespace renderer della shell.
pub const FORMAT_ID: &str = "canvas";
/// Versione dello schema interpretato (JSON Canvas 1.0 non ha `version`).
pub const SCHEMA_VERSION: u32 = 1;
