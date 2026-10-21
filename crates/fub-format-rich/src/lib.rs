//! I documenti di videoscrittura — Word (`.docx`), OpenDocument (`.odt`), RTF e
//! Word 97-2003 (`.doc`, `.dot`) — letti, e dove si può scritti, con il modello
//! e i codec di WordCraft (`vendor/wordcraft`).
//!
//! Il crate possiede tre cose, e l'host le compone senza possederle:
//!
//! - il **codec**, [`Codec`]: byte del file ↔ [`wordcraft_doc::Document`]. Il
//!   codec Word riporta il file intero; gli altri sono **importatori** che
//!   leggono il modello di WordCraft e lasciano indietro ciò che non conoscono
//!   ([`Codec::lossless`]). L'OpenDocument ha in più un codec di Fub, che legge
//!   e riscrive `content.xml` senza passare da quel modello: un `.odt` si
//!   scrive con quello, e l'importatore resta per l'indice e per i file che il
//!   codec di Fub non sa rappresentare;
//! - il **provider di formato**, [`RichProvider`]: un formato a byte che dà al
//!   kernel il modello comune (titoli, paragrafi, elenchi, tabelle, link) per
//!   la ricerca, l'outline e l'anteprima;
//! - la **proiezione modificabile**, [`session`]: il documento come JSON chiuso
//!   e versionato che la superficie ricca della shell modifica, e il ritorno da
//!   quel JSON ai byte;
//! - l'**esportazione di una copia**, [`export`]: il documento in HTML, testo
//!   semplice, LaTeX, RTF, OpenDocument o Word XML con gli esportatori di
//!   WordCraft, e l'elenco misurato di ciò che la copia non porta.
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
mod canonical;
mod diff;
pub mod export;
mod fidelity;
mod flow;
mod fresh;
mod graft;
mod inventory;
mod model;
mod odt;
pub mod preservation;
pub mod projection;
mod running;
pub mod session;
mod stories;
mod unproject;

pub use session::{blank, open, save, Opened, ReadOnly, Saved};

/// L'id del formato Word.
pub const DOCX_FORMAT_ID: &str = "docx";
/// L'id del formato OpenDocument Text.
pub const ODT_FORMAT_ID: &str = "odt";
/// L'id del formato RTF.
pub const RTF_FORMAT_ID: &str = "rtf";
/// L'id del formato Word 97-2003, documenti e modelli.
pub const DOC_FORMAT_ID: &str = "doc";
/// Il file più grande che si apre: lo stesso ordine di grandezza dei limiti di
/// WordCraft sulle parti del pacchetto.
pub const MAX_SOURCE_BYTES: usize = 256 * 1024 * 1024;

/// Un formato di videoscrittura e il suo codec.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Codec {
    /// WordprocessingML (`.docx`).
    Docx,
    /// OpenDocument Text (`.odt`). [`Codec::read`] è l'importatore di
    /// WordCraft, che non riporta note, commenti, caselle, forme e gran parte
    /// degli stili; la proiezione modificabile ([`session`]) usa invece il
    /// codec di Fub, che conserva l'XML originale.
    Odt,
    /// Rich Text Format (`.rtf`): l'importatore di WordCraft.
    Rtf,
    /// Word 97-2003 (`.doc`, `.dot`): si legge, non si scrive.
    Doc,
}

impl Codec {
    /// Tutti i codec, nell'ordine in cui l'host li registra.
    pub const ALL: [Codec; 4] = [Codec::Docx, Codec::Odt, Codec::Rtf, Codec::Doc];

    /// Il codec dell'id di formato, se è uno di questi.
    pub fn of_format(format_id: &str) -> Option<Codec> {
        Codec::ALL
            .into_iter()
            .find(|codec| codec.format_id() == format_id)
    }

    pub fn format_id(self) -> &'static str {
        match self {
            Codec::Docx => DOCX_FORMAT_ID,
            Codec::Odt => ODT_FORMAT_ID,
            Codec::Rtf => RTF_FORMAT_ID,
            Codec::Doc => DOC_FORMAT_ID,
        }
    }

    fn descriptor(self) -> FormatDescriptor {
        let (name, extensions): (&str, &[&str]) = match self {
            Codec::Docx => ("Word", &["docx"]),
            Codec::Odt => ("OpenDocument", &["odt"]),
            Codec::Rtf => ("RTF", &["rtf"]),
            Codec::Doc => ("Word 97-2003", &["doc", "dot"]),
        };
        FormatDescriptor {
            id: self.format_id().to_string(),
            name: name.to_string(),
            extensions: extensions.iter().map(|e| e.to_string()).collect(),
            source: SourceKind::Bytes,
        }
    }

    /// Legge i byte di un file.
    pub fn read(self, bytes: &[u8]) -> Result<Document, RichError> {
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(RichError::TooLarge(bytes.len()));
        }
        let mut document = match self {
            Codec::Docx => read_docx(bytes)?,
            Codec::Odt => wordcraft_formats::odt::import(bytes).map_err(RichError::Codec)?,
            Codec::Rtf => wordcraft_formats::rtf::import(bytes).map_err(RichError::Codec)?,
            Codec::Doc => read_doc(bytes)?,
        };
        if self != Codec::Docx {
            // Come quando WordCraft apre un file importato: un documento
            // senza blocchi ha comunque un paragrafo dove scrivere.
            document.ensure_nonempty();
        }
        Ok(document)
    }

    /// Scrive un documento nei byte del file. Soltanto il codec Word scrive un
    /// modello di WordCraft: gli esportatori per gli altri formati riscrivono il
    /// file dal modello, e ciò che l'importatore ha lasciato indietro andrebbe
    /// perso. Un `.odt` si scrive dalla proiezione, con il codec di Fub.
    pub fn write(self, document: &Document) -> Result<Vec<u8>, RichError> {
        match self {
            Codec::Docx => {
                wordcraft_docx::write(document).map_err(|error| RichError::Codec(error.to_string()))
            }
            Codec::Odt | Codec::Rtf | Codec::Doc => Err(RichError::NoWriter(self.format_id())),
        }
    }

    /// Se il codec *può* riscrivere il file senza perderne niente. Non è una
    /// garanzia: il codec Word lo dimostra file per file, a ogni apertura e a
    /// ogni salvataggio, rileggendo il modello e misurando i byte del
    /// pacchetto con il controllo di Fub ([`preservation`], vedi [`session`]);
    /// un importatore non lo promette mai.
    pub fn lossless(self) -> bool {
        matches!(self, Codec::Docx)
    }
}

fn read_docx(bytes: &[u8]) -> Result<Document, RichError> {
    wordcraft_docx::read(bytes).map_err(|error| match error {
        wordcraft_docx::DocxError::PasswordRequired | wordcraft_docx::DocxError::WrongPassword => {
            RichError::Encrypted
        }
        other => RichError::Codec(other.to_string()),
    })
}

/// Un file `.doc` è spesso altro sotto lo stesso nome: un Word cifrato (OOXML
/// in un contenitore OLE), un `.docx` o un RTF rinominati. Come WordCraft, lo
/// legge chi ne riconosce la firma.
fn read_doc(bytes: &[u8]) -> Result<Document, RichError> {
    if wordcraft_docx::is_encrypted(bytes) || wordcraft_docbin::is_encrypted(bytes) {
        return Err(RichError::Encrypted);
    }
    if bytes.starts_with(b"PK\x03\x04") {
        return read_docx(bytes);
    }
    if bytes.starts_with(b"{\\rtf") {
        return wordcraft_formats::rtf::import(bytes).map_err(RichError::Codec);
    }
    wordcraft_docbin::read(bytes).map_err(|error| match error {
        wordcraft_docbin::DocbinError::PasswordRequired
        | wordcraft_docbin::DocbinError::WrongPassword => RichError::Encrypted,
        other => RichError::Codec(other.to_string()),
    })
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
    /// I dati opachi della proiezione sono di uno schema che questo Fub non
    /// legge: li ha scritti un Fub più nuovo.
    #[error("rich opaque data schema {0} is not supported")]
    OpaqueSchema(u32),
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
    /// Il formato si legge ma non si scrive.
    #[error("rich format {0} has no writer")]
    NoWriter(&'static str),
    /// Il documento da scrivere non si rilegge uguale: non si scrive.
    #[error("rich document would not read back as written")]
    Fidelity,
    /// Il salvataggio toccherebbe ciò che il codec non riscrive senza
    /// perdite: un blocco chiuso del corpo, con il suo indice nel file, o,
    /// senza indice, ciò che sta fuori dal corpo di un documento che si
    /// salva soltanto per innesto ([`crate::preservation`]).
    #[error("rich document has closed parts: block {0:?}")]
    Locked(Option<usize>),
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
