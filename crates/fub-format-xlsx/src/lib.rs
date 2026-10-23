//! Le cartelle di lavoro di Excel — `.xlsx`, `.xlsm`, `.xltx`, `.xltm` — lette
//! con il codec e il modello di GridCraft (`vendor/gridcraft`), e modificate
//! nei soli valori con un innesto sui byte del file.
//!
//! Il crate possiede tre cose, e l'host le compone senza possederle:
//!
//! - il **provider di formato**, [`XlsxProvider`]: un formato a byte che dà al
//!   kernel il modello comune (un titolo per foglio, un'anteprima in tabella e
//!   il testo delle celle) per la ricerca, l'outline e l'anteprima;
//! - la **superficie della griglia** ([`grid`]): la cartella sul protocollo
//!   a byte (ADR 0216), con i valori del file già formattati ([`display`]) e
//!   le celle cambiate in un giornale;
//! - l'**innesto** ([`graft`]): i byte della cartella con alcuni valori
//!   cambiati, e ogni altro byte com'era. L'input di una cella ([`input`]) e i
//!   suoi blocchi ([`locks`]) sono le regole che lo precedono.
//!
//! Il codec di GridCraft non scrive mai il file: lo riscriverebbe dal suo
//! modello, e ciò che quel modello non conosce andrebbe perso.
//!
//! I valori sono quelli che il file ha salvato, e niente si ricalcola: aprire
//! una cartella costa la sua lettura, qualunque formula contenga, e un valore
//! casuale o di oggi resta quello del file. Le celle versate dalle matrici
//! hanno il valore che il file ha salvato (la patch `0003` di
//! `vendor/gridcraft`); una formula salvata senza valore resta vuota, e la
//! sessione della griglia lo dice.
//!
//! Il codec gira in un thread suo con uno stack grande, e un suo panic diventa
//! un errore: una formula annidata a fondo non abbatte l'host.

use std::panic::{catch_unwind, AssertUnwindSafe};

use fub_abi::model::DocumentModel;
use fub_abi::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatError, FormatProvider, LinkRewrite,
    ParseContext, RenderOptions, SourceKind, TextEdit,
};
use gridcraft_model::Workbook;
use gridcraft_xlsx::{Format, ReadReport};

mod commands;
// Le cartelle di prova dei test d'integrazione, anche per quelli interni.
#[cfg(test)]
#[path = "../tests/common/mod.rs"]
mod common;
pub mod display;
pub mod graft;
pub mod grid;
pub mod input;
mod inventory;
pub mod locks;
mod model;
mod package;
mod sheet_xml;

/// L'id del formato.
pub const FORMAT_ID: &str = "xlsx";
/// Le estensioni della famiglia SpreadsheetML che il formato apre.
pub const EXTENSIONS: [&str; 4] = ["xlsx", "xlsm", "xltx", "xltm"];
/// Il file più grande che si apre: lo stesso limite dei documenti di
/// videoscrittura.
pub const MAX_SOURCE_BYTES: usize = 256 * 1024 * 1024;
/// Lo stack del thread che legge: il parser delle formule di GridCraft scende
/// ricorsivamente nelle espressioni.
const STACK_BYTES: usize = 64 * 1024 * 1024;

/// Perché una cartella non si legge.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum XlsxError {
    /// Il file è cifrato con una password.
    #[error("workbook is encrypted")]
    Encrypted,
    /// Il file supera [`MAX_SOURCE_BYTES`].
    #[error("workbook of {0} bytes exceeds the limit")]
    TooLarge(usize),
    /// Il contenuto non è un pacchetto SpreadsheetML: un altro foglio di
    /// calcolo (ODS, XLSB, XLS), un CSV o un file d'altro tipo con questo nome.
    #[error("file is not an Excel workbook: {0}")]
    NotXlsx(&'static str),
    /// Il codec rifiuta il pacchetto.
    #[error("workbook cannot be read: {0}")]
    Codec(String),
    /// Il codec si è fermato con un panic.
    #[error("workbook reader stopped: {0}")]
    Crashed(String),
}

impl From<XlsxError> for FormatError {
    fn from(error: XlsxError) -> Self {
        FormatError::Parse(error.to_string())
    }
}

/// La cartella letta dal codec, con ciò che la lettura ha lasciato indietro.
pub struct Read {
    pub workbook: Workbook,
    pub report: ReadReport,
}

/// Legge i byte di una cartella.
pub fn read(bytes: &[u8]) -> Result<Read, XlsxError> {
    check(bytes)?;
    guarded(|| {
        gridcraft_xlsx::read_xlsx(bytes)
            .map(|(workbook, report)| Read { workbook, report })
            .map_err(|error| XlsxError::Codec(error.to_string()))
    })
}

/// Il contenuto prima del codec: le dimensioni e la firma. Non legge il
/// pacchetto: dice soltanto se il codec ha qualcosa da leggere.
pub fn check(bytes: &[u8]) -> Result<(), XlsxError> {
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(XlsxError::TooLarge(bytes.len()));
    }
    match gridcraft_xlsx::sniff(bytes) {
        Format::Xlsx => Ok(()),
        Format::Encrypted => Err(XlsxError::Encrypted),
        Format::Xlsb => Err(XlsxError::NotXlsx("xlsb")),
        Format::Ods => Err(XlsxError::NotXlsx("ods")),
        Format::Xls => Err(XlsxError::NotXlsx("xls")),
        Format::Csv => Err(XlsxError::NotXlsx("csv")),
        Format::LegacyBinary | Format::Unknown => Err(XlsxError::NotXlsx("unknown")),
    }
}

/// Esegue `work` in un thread con [`STACK_BYTES`] di stack, e ne fa un errore
/// se si ferma con un panic.
pub(crate) fn guarded<T: Send>(
    work: impl FnOnce() -> Result<T, XlsxError> + Send,
) -> Result<T, XlsxError> {
    std::thread::scope(|scope| {
        let thread = std::thread::Builder::new()
            .name("fub-xlsx".into())
            .stack_size(STACK_BYTES)
            .spawn_scoped(scope, || {
                catch_unwind(AssertUnwindSafe(work))
                    .unwrap_or_else(|panic| Err(XlsxError::Crashed(panic_message(panic.as_ref()))))
            })
            .map_err(|error| XlsxError::Crashed(error.to_string()))?;
        thread
            .join()
            .unwrap_or_else(|panic| Err(XlsxError::Crashed(panic_message(panic.as_ref()))))
    })
}

pub(crate) fn panic_message(panic: &(dyn std::any::Any + Send)) -> String {
    panic
        .downcast_ref::<&str>()
        .map(|text| text.to_string())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic".to_string())
}

/// Il provider di formato delle cartelle di Excel.
#[derive(Default)]
pub struct XlsxProvider;

impl XlsxProvider {
    pub fn new() -> Self {
        XlsxProvider
    }

    pub fn boxed() -> Box<dyn FormatProvider> {
        Box::new(XlsxProvider)
    }
}

impl FormatProvider for XlsxProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: FORMAT_ID.to_string(),
            name: "Excel".to_string(),
            extensions: EXTENSIONS.iter().map(|e| e.to_string()).collect(),
            source: SourceKind::Bytes,
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        // Nessuna sintassi del vault: una cella non ha wikilink né tag.
        FormatCapabilities::of(&[])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let DocumentSource::Bytes(bytes) = source else {
            return Err(FormatError::Unsupported {
                format: FORMAT_ID.to_string(),
                got: source.kind(),
            });
        };
        let read = read(bytes)?;
        Ok(model::document_model(&read.workbook, ctx))
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
        Err(FormatError::Unsupported {
            format: FORMAT_ID.to_string(),
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
