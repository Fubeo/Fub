//! I documenti di videoscrittura — per ora Word (`.docx`) — letti e scritti con
//! il modello e il codec di WordCraft (`vendor/wordcraft`).
//!
//! Il crate possiede tre cose, e l'host le compone senza possederle:
//!
//! - il **codec**, [`Codec`]: byte del file ↔ [`wordcraft_doc::Document`];
//! - il **provider di formato**, [`RichProvider`]: un formato a byte che dà al
//!   kernel il modello comune (titoli, paragrafi, elenchi, tabelle, link) per
//!   la ricerca, l'outline e l'anteprima;
//! - la **proiezione modificabile**, [`session`]: il documento come JSON chiuso
//!   e versionato che la superficie ricca della shell modifica, e il ritorno da
//!   quel JSON ai byte.
//!
//! La regola che tiene insieme le tre è **nessuna perdita silenziosa**: un
//! documento che non torna identico da sé stesso (codec o proiezione) si apre in
//! sola lettura con il motivo, e un salvataggio che non si rilegge uguale a ciò
//! che si voleva scrivere non scrive. Il Markdown non dipende da niente di qui.

use fub_abi::model::DocumentModel;
use fub_abi::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatError, FormatProvider, LinkRewrite,
    ParseContext, RenderOptions, SourceKind, TextEdit,
};
use wordcraft_doc::Document;

mod blob;
mod fidelity;
mod model;
pub mod projection;
pub mod session;
mod unproject;

pub use session::{open, save, Opened, ReadOnly, Saved};

/// L'id del formato Word.
pub const DOCX_FORMAT_ID: &str = "docx";
/// Il file più grande che si apre: lo stesso ordine di grandezza dei limiti di
/// WordCraft sulle parti del pacchetto.
pub const MAX_SOURCE_BYTES: usize = 256 * 1024 * 1024;

/// Un formato di videoscrittura e il suo codec.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Codec {
    /// WordprocessingML (`.docx`).
    Docx,
}

impl Codec {
    /// Il codec dell'id di formato, se è uno di questi.
    pub fn of_format(format_id: &str) -> Option<Codec> {
        match format_id {
            DOCX_FORMAT_ID => Some(Codec::Docx),
            _ => None,
        }
    }

    pub fn format_id(self) -> &'static str {
        match self {
            Codec::Docx => DOCX_FORMAT_ID,
        }
    }

    fn descriptor(self) -> FormatDescriptor {
        match self {
            Codec::Docx => FormatDescriptor {
                id: DOCX_FORMAT_ID.to_string(),
                name: "Word".to_string(),
                extensions: vec!["docx".to_string()],
                source: SourceKind::Bytes,
            },
        }
    }

    /// Legge i byte di un file.
    pub fn read(self, bytes: &[u8]) -> Result<Document, RichError> {
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(RichError::TooLarge(bytes.len()));
        }
        match self {
            Codec::Docx => wordcraft_docx::read(bytes).map_err(|error| match error {
                wordcraft_docx::DocxError::PasswordRequired
                | wordcraft_docx::DocxError::WrongPassword => RichError::Encrypted,
                other => RichError::Codec(other.to_string()),
            }),
        }
    }

    /// Scrive un documento nei byte del file.
    pub fn write(self, document: &Document) -> Result<Vec<u8>, RichError> {
        match self {
            Codec::Docx => {
                wordcraft_docx::write(document).map_err(|error| RichError::Codec(error.to_string()))
            }
        }
    }
}

/// Perché un documento non si legge, non si proietta o non si salva.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum RichError {
    /// Il codec rifiuta i byte, o non sa scrivere il documento.
    #[error("rich codec: {0}")]
    Codec(String),
    /// Il file è cifrato con una password.
    #[error("rich document is encrypted")]
    Encrypted,
    /// Il file supera [`MAX_SOURCE_BYTES`].
    #[error("rich document of {0} bytes exceeds the limit")]
    TooLarge(usize),
    /// La proiezione non è JSON della forma attesa.
    #[error("rich projection is malformed: {0}")]
    Malformed(String),
    /// La proiezione dichiara un formato o una versione che qui non si legge.
    #[error("rich projection version {0} is not supported")]
    Version(u32),
    /// Il documento sul disco si apre soltanto in lettura.
    #[error("rich document is read-only: {0:?}")]
    ReadOnly(ReadOnly),
    /// Un oggetto della proiezione nomina qualcosa che il documento non ha:
    /// un'immagine, una nota, una casella di testo.
    #[error("rich projection refers to {0}, which the document does not have")]
    Missing(String),
    /// Due oggetti della proiezione mostrano la stessa nota o casella di testo.
    #[error("rich projection shows story {0} twice")]
    DuplicateStory(u32),
    /// Il documento da scrivere non si rilegge uguale: non si scrive.
    #[error("rich document would not read back as written")]
    Fidelity,
}

impl From<RichError> for FormatError {
    fn from(error: RichError) -> Self {
        FormatError::Parse(error.to_string())
    }
}

/// Il provider di formato dei documenti di videoscrittura.
pub struct RichProvider {
    codec: Codec,
}

impl RichProvider {
    pub fn new(codec: Codec) -> Self {
        RichProvider { codec }
    }

    pub fn boxed(codec: Codec) -> Box<dyn FormatProvider> {
        Box::new(RichProvider::new(codec))
    }
}

impl FormatProvider for RichProvider {
    fn descriptor(&self) -> FormatDescriptor {
        self.codec.descriptor()
    }

    fn capabilities(&self) -> FormatCapabilities {
        // Nessuna sintassi del vault: un documento di Word non ha wikilink né
        // tag, e i suoi link sono URL o segnalibri interni.
        FormatCapabilities::of(&[])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let DocumentSource::Bytes(bytes) = source else {
            return Err(FormatError::Unsupported {
                format: self.codec.format_id().to_string(),
                got: source.kind(),
            });
        };
        let document = self.codec.read(bytes)?;
        Ok(model::document_model(&document, ctx))
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        // Il modello comune è lo stesso di ogni formato: la resa del Markdown
        // lo disegna già, e un'altra copia divergerebbe.
        fub_format_markdown::MarkdownProvider::new().render_html(model, opts)
    }

    fn serialize(&self, _model: &DocumentModel) -> Result<String, FormatError> {
        // Un file di Word non è testo: generarne uno da un modello lossy non è
        // un'operazione di questo formato.
        Err(FormatError::Unsupported {
            format: self.codec.format_id().to_string(),
            got: SourceKind::Text,
        })
    }

    fn rewrite_links(
        &self,
        _source: &DocumentSource,
        _ctx: &ParseContext,
        _rewrites: &[LinkRewrite],
    ) -> Result<Option<Vec<TextEdit>>, FormatError> {
        Ok(None)
    }
}
