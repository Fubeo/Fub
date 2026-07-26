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
    /// Nessun formato registrato, quindi nemmeno uno con cui far nascere una
    /// nota nuova.
    #[error("nessun formato registrato: non so con quale creare una nota")]
    NoDefaultFormat,
    #[error("nome non valido per una nota: {0:?}")]
    BadName(String),
    #[error("documento non trovato: {0}")]
    NotFound(String),
    #[error("esiste già un documento: {0}")]
    AlreadyExists(String),
    #[error("path fuori dal vault: {0}")]
    OutsideVault(Utf8PathBuf),
    /// Il rename È riuscito (file, grafo, evento), ma la riscrittura dei
    /// wikilink entranti è fallita in una o più sorgenti — le altre sono
    /// state comunque completate.
    #[error("rename riuscito, ma la riscrittura dei link è fallita per: {0}")]
    LinkRewrite(String),
    /// Il sorgente su cui una modifica chirurgica era stata calcolata non è più
    /// quello: qualcuno ha scritto nel frattempo, e applicare gli span vecchi
    /// avrebbe tagliato i byte sbagliati. Non è stato scritto niente.
    #[error("{0} è cambiato da quando la modifica è stata calcolata")]
    Stale(String),
    /// Gli edit di una modifica chirurgica non stanno in piedi sul sorgente
    /// (fuori dal testo, a metà di un carattere, sovrapposti, due nello stesso
    /// punto). Come sopra: niente di parziale, niente scritto.
    #[error("modifica non applicabile a {doc}: {why}")]
    BadEdit { doc: String, why: String },
    #[error("path non UTF-8: {0}")]
    NonUtf8Path(std::path::PathBuf),
    #[error(transparent)]
    Format(#[from] FormatError),
}

pub type Result<T> = std::result::Result<T, KernelError>;
