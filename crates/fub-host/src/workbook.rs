//! Le cartelle di Excel composte dall'host, in sola lettura.
//!
//! `fub-format-xlsx` possiede il codec e la proiezione; il kernel conosce
//! soltanto il formato a byte. L'host li compone alle due porte dei documenti
//! della shell, come per la videoscrittura ([`crate::rich`]):
//!
//! - **leggere** una cartella restituisce la sua proiezione come testo, con la
//!   revisione dei byte del file;
//! - **scriverla** si rifiuta: da qui una cartella non si salva, e il file
//!   resta com'è.
//!
//! Il codec gira fuori dal lucchetto del workspace: si leggono i byte, si
//! rilascia, si proietta. Senza la feature `xlsx` nessun formato è di questi, e
//! ogni funzione qui lo dice.

use fub_abi::format::{DocumentFormat, FormatProvider};
use fub_abi::{Arg, DocId, PluginError, Text};

/// I provider di formato da registrare al montaggio.
pub(crate) fn providers() -> Vec<Box<dyn FormatProvider>> {
    #[cfg(feature = "xlsx")]
    {
        vec![fub_format_xlsx::XlsxProvider::boxed()]
    }
    #[cfg(not(feature = "xlsx"))]
    {
        Vec::new()
    }
}

/// Se il documento è una cartella di Excel.
pub(crate) fn is_workbook(format: Option<&DocumentFormat>) -> bool {
    #[cfg(feature = "xlsx")]
    {
        format.is_some_and(|known| known.descriptor.id == fub_format_xlsx::FORMAT_ID)
    }
    #[cfg(not(feature = "xlsx"))]
    {
        let _ = format;
        false
    }
}

/// La proiezione dei byte di `doc`.
pub(crate) fn open(doc: &DocId, bytes: &[u8]) -> Result<String, PluginError> {
    #[cfg(feature = "xlsx")]
    {
        fub_format_xlsx::open(bytes).map_err(|error| plugin_error(doc, error))
    }
    #[cfg(not(feature = "xlsx"))]
    {
        let _ = bytes;
        Err(read_only(doc))
    }
}

/// Il rifiuto di scrivere una cartella.
pub(crate) fn read_only(doc: &DocId) -> PluginError {
    PluginError::PermissionDenied(Text::message(
        "host.xlsx.readonly",
        vec![Arg::text("doc", doc.as_str())],
    ))
}

/// L'errore del confine con la sua specie: il file non si apre per scelta di
/// chi l'ha scritto (`PermissionDenied`), non è ciò che il nome dice
/// (`BadArgs`), o il codec non sa (`Internal`).
#[cfg(feature = "xlsx")]
fn plugin_error(doc: &DocId, error: fub_format_xlsx::XlsxError) -> PluginError {
    use fub_format_xlsx::XlsxError;
    let doc_arg = || Arg::text("doc", doc.as_str());
    match error {
        XlsxError::Encrypted => {
            PluginError::PermissionDenied(Text::message("host.xlsx.encrypted", vec![doc_arg()]))
        }
        XlsxError::TooLarge(bytes) => PluginError::BadArgs(Text::message(
            "host.xlsx.too_large",
            vec![doc_arg(), Arg::text("bytes", bytes.to_string())],
        )),
        XlsxError::NotXlsx(found) => PluginError::BadArgs(Text::message(
            "host.xlsx.not_xlsx",
            vec![doc_arg(), Arg::text("found", found)],
        )),
        XlsxError::Codec(why) | XlsxError::Crashed(why) => PluginError::Internal(Text::message(
            "host.xlsx.codec",
            vec![doc_arg(), Arg::text("why", why)],
        )),
    }
}
