//! Errori del kernel.

use camino::Utf8PathBuf;
use fubmd_abi::FormatError;

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("I/O su {path}: {source}")]
    Io {
        path: Utf8PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("nessun provider registrato per l'estensione {0:?}")]
    NoProvider(String),
    #[error("documento non trovato: {0}")]
    NotFound(String),
    #[error("esiste già un documento: {0}")]
    AlreadyExists(String),
    #[error("path fuori dal vault: {0}")]
    OutsideVault(Utf8PathBuf),
    #[error("path non UTF-8: {0}")]
    NonUtf8Path(std::path::PathBuf),
    #[error(transparent)]
    Format(#[from] FormatError),
}

pub type Result<T> = std::result::Result<T, KernelError>;
