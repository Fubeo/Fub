//! I documenti di videoscrittura composti dall'host.
//!
//! `fub-format-rich` possiede il codec e la proiezione; il kernel conosce
//! soltanto il formato a byte. L'host li compone alle due porte dei documenti
//! della shell, senza aggiungerne una:
//!
//! - **leggere** un documento di questi formati restituisce la proiezione come
//!   testo, con la revisione dei byte del file;
//! - **scrivere** quel testo lo riporta ai byte, partendo dal file alla
//!   revisione su cui la shell ha lavorato, e li scrive con il CAS della
//!   revisione grezza.
//!
//! Le **copie** in altri formati passano invece dalla porta di export del
//! contratto: il bundle [`RICH_ID`] registra l'esportatore e il comando
//! «Esporta una copia» di `fub-format-rich`.
//!
//! Il codec gira fuori dal lucchetto del workspace: si leggono i byte, si
//! rilascia, si proietta o si salva, poi si rientra per scrivere. Senza la
//! feature `rich` nessun formato è di questi, e ogni funzione qui lo dice.

use fub_abi::format::{DocumentFormat, FormatProvider};
#[cfg(feature = "rich")]
use fub_abi::{Arg, Text};
use fub_abi::{DocId, PluginError};

#[cfg(feature = "rich")]
pub(crate) use fub_format_rich::Codec;

/// Senza la feature non c'è codec: il tipo resta, perché le firme dell'host
/// non cambino, ma non ha valori.
#[cfg(not(feature = "rich"))]
#[derive(Clone, Copy, Debug)]
pub(crate) enum Codec {}

/// I provider di formato da registrare al montaggio.
pub(crate) fn providers() -> Vec<Box<dyn FormatProvider>> {
    #[cfg(feature = "rich")]
    {
        Codec::ALL
            .into_iter()
            .map(fub_format_rich::RichProvider::boxed)
            .collect()
    }
    #[cfg(not(feature = "rich"))]
    {
        Vec::new()
    }
}

/// Il bundle che esporta le copie dei documenti di videoscrittura.
#[cfg(feature = "rich")]
pub(crate) const RICH_ID: &str = "fub.rich";

/// Registra l'esportatore delle copie e il comando che le chiede: il comando
/// passa da `export.run`, quindi senza gli importatori dice che il comando non
/// c'è, invece di accodare un lavoro che nessuno esegue.
#[cfg(feature = "rich")]
pub(crate) fn register(registrar: &mut crate::registry::Registrar<'_>) -> Vec<String> {
    let mut failures = Vec::new();
    if let Err(error) =
        registrar.register_export_provider(fub_format_rich::export::RichExport::boxed())
    {
        failures.push(format!("rich export not registered: {error}"));
    }
    if let Err(error) =
        registrar.register_command_provider(fub_format_rich::export::RichCommands::boxed())
    {
        failures.push(format!("rich commands not registered: {error}"));
    }
    failures
}

/// Il codec del formato di un documento, se è un documento di videoscrittura.
pub(crate) fn codec(format: Option<&DocumentFormat>) -> Option<Codec> {
    #[cfg(feature = "rich")]
    {
        format.and_then(|known| Codec::of_format(&known.descriptor.id))
    }
    #[cfg(not(feature = "rich"))]
    {
        let _ = format;
        None
    }
}

/// La proiezione dei byte di `doc`.
pub(crate) fn open(codec: Codec, doc: &DocId, bytes: &[u8]) -> Result<String, PluginError> {
    #[cfg(feature = "rich")]
    {
        fub_format_rich::open(codec, bytes)
            .map(|opened| opened.projection)
            .map_err(|error| plugin_error(doc, error))
    }
    #[cfg(not(feature = "rich"))]
    {
        let _ = (doc, bytes);
        match codec {}
    }
}

/// Che cosa scrivere per salvare `projection` sul file `current`.
#[cfg_attr(not(feature = "rich"), allow(dead_code))]
pub(crate) enum Save {
    /// La proiezione descrive il file com'è.
    Unchanged,
    /// I byte nuovi, già riletti dal codec.
    Bytes(Vec<u8>),
}

/// Il salvataggio di `projection` su `current`, i byte del file alla revisione
/// su cui la shell ha lavorato.
pub(crate) fn save(
    codec: Codec,
    doc: &DocId,
    current: &[u8],
    projection: &str,
) -> Result<Save, PluginError> {
    #[cfg(feature = "rich")]
    {
        match fub_format_rich::save(codec, current, projection) {
            Ok(fub_format_rich::Saved::Unchanged) => Ok(Save::Unchanged),
            Ok(fub_format_rich::Saved::Bytes(bytes)) => Ok(Save::Bytes(bytes)),
            Err(error) => Err(plugin_error(doc, error)),
        }
    }
    #[cfg(not(feature = "rich"))]
    {
        let _ = (doc, current, projection);
        match codec {}
    }
}

/// I byte di un file che non c'è ancora, scritto da `projection`: si parte da
/// un documento vuoto, e il file si crea anche quando la proiezione è vuota.
pub(crate) fn create(codec: Codec, doc: &DocId, projection: &str) -> Result<Vec<u8>, PluginError> {
    #[cfg(feature = "rich")]
    {
        let blank = fub_format_rich::blank(codec).map_err(|error| plugin_error(doc, error))?;
        match save(codec, doc, &blank, projection)? {
            Save::Unchanged => Ok(blank),
            Save::Bytes(bytes) => Ok(bytes),
        }
    }
    #[cfg(not(feature = "rich"))]
    {
        let _ = (doc, projection);
        match codec {}
    }
}

/// L'errore del confine con la sua specie: chi chiama sbaglia la proiezione
/// (`BadArgs`), il file non si scrive (`PermissionDenied`), o il codec non
/// sa (`Internal`).
#[cfg(feature = "rich")]
fn plugin_error(doc: &DocId, error: fub_format_rich::RichError) -> PluginError {
    use fub_format_rich::RichError;
    let doc_arg = || Arg::text("doc", doc.as_str());
    match error {
        RichError::Encrypted => {
            PluginError::PermissionDenied(Text::message("host.rich.encrypted", vec![doc_arg()]))
        }
        RichError::ReadOnly(reason) => PluginError::PermissionDenied(Text::message(
            format!("host.rich.readonly.{}", read_only_name(reason)),
            vec![doc_arg()],
        )),
        RichError::TooLarge(bytes) => PluginError::BadArgs(Text::message(
            "host.rich.too_large",
            vec![doc_arg(), Arg::text("bytes", bytes.to_string())],
        )),
        RichError::Malformed(why) => PluginError::BadArgs(Text::message(
            "host.rich.projection",
            vec![doc_arg(), Arg::text("why", why)],
        )),
        RichError::Version(version) => PluginError::BadArgs(Text::message(
            "host.rich.version",
            vec![doc_arg(), Arg::text("version", version.to_string())],
        )),
        RichError::Missing(what) => PluginError::BadArgs(Text::message(
            "host.rich.missing",
            vec![doc_arg(), Arg::text("what", what)],
        )),
        RichError::DuplicateStory(_) => {
            PluginError::BadArgs(Text::message("host.rich.duplicate", vec![doc_arg()]))
        }
        RichError::NoWriter(_) => {
            PluginError::PermissionDenied(Text::message("host.rich.no_writer", vec![doc_arg()]))
        }
        RichError::Fidelity => {
            PluginError::Internal(Text::message("host.rich.fidelity", vec![doc_arg()]))
        }
        RichError::Codec(why) => PluginError::Internal(Text::message(
            "host.rich.codec",
            vec![doc_arg(), Arg::text("why", why)],
        )),
    }
}

#[cfg(feature = "rich")]
fn read_only_name(reason: fub_format_rich::ReadOnly) -> &'static str {
    use fub_format_rich::ReadOnly;
    match reason {
        ReadOnly::Revisions => "revisions",
        ReadOnly::TrackChanges => "track_changes",
        ReadOnly::Protected => "protected",
        ReadOnly::Projection => "projection",
        ReadOnly::Codec => "codec",
        ReadOnly::Import => "import",
    }
}
