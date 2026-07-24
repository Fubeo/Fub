//! Tipi d'errore del contratto. Tutti serializzabili così da poter
//! attraversare il confine WASM (M5) e l'IPC verso il frontend.

use serde::{Deserialize, Serialize};

/// Errore prodotto da un `FormatProvider`.
#[derive(Clone, Debug, thiserror::Error, Serialize, Deserialize)]
pub enum FormatError {
    #[error("parse fallito: {0}")]
    Parse(String),
    #[error("render fallito: {0}")]
    Render(String),
    #[error("serialize fallito: {0}")]
    Serialize(String),
    #[error("formato non supportato: {0}")]
    Unsupported(String),
}

/// Errore prodotto da un plugin (nativo o WASM).
#[derive(Clone, Debug, thiserror::Error, Serialize, Deserialize)]
pub enum PluginError {
    #[error("comando sconosciuto: {0}")]
    UnknownCommand(String),
    #[error("view sconosciuta: {0}")]
    UnknownView(String),
    #[error("argomenti non validi: {0}")]
    BadArgs(String),
    #[error("permesso negato: {0}")]
    PermissionDenied(String),
    #[error("errore interno del plugin: {0}")]
    Internal(String),
}
