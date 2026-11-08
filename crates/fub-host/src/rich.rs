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

/// Svuota le cache dei motori che tengono documenti e dizionari: le prove a
/// vuoto del motore dei documenti e i dizionari del correttore letti dal
/// disco, poi restituisce al sistema la memoria liberata. La chiama la
/// chiusura dell'ultimo vault, fuori da ogni lucchetto dell'host; con un altro
/// vault aperto le cache restano al budget dei motori, che le toglie da solo.
///
/// Senza le feature `rich` e `proof` non c'è niente da svuotare, ma la memoria
/// si restituisce lo stesso. Dà i byte stimati liberati.
pub(crate) fn empty_engine_caches() -> u64 {
    let mut freed = 0u64;
    #[cfg(feature = "rich")]
    {
        use fub_motori::Voce as _;
        freed += fub_format_rich::motore::MotoreDocumenti::processo().svuota();
    }
    #[cfg(feature = "proof")]
    {
        freed += fub_features::proof::empty_dictionaries();
    }
    fub_motori::rilascia_al_sistema();
    freed
}

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
    if let Err(error) = registrar
        .register_command_provider(Box::new(crate::new_file::NewFileCommands(&NEW_DOCUMENT)))
    {
        failures.push(format!("{DOCUMENT_CREATE} not registered: {error}"));
    }
    failures
}

/// Le frasi del bundle: quelle dell'esportatore e quelle di «Nuovo
/// documento», sommate per lingua.
#[cfg(feature = "rich")]
pub(crate) fn catalog() -> Vec<fub_abi::text::StringCatalog> {
    let mut catalogs = fub_format_rich::export::catalog();
    catalogs.extend(NEW_DOCUMENT.catalog());
    catalogs
}

/// «Nuovo documento»: un documento di Word vuoto, che si apre.
#[cfg(feature = "rich")]
pub const DOCUMENT_CREATE: &str = "document.create";

/// Il documento di Word che nasce vuoto: i byte li scrive il codec, da un
/// documento senza paragrafi, e si rileggono con la stessa apertura della
/// superficie prima di arrivare nel vault.
#[cfg(feature = "rich")]
static NEW_DOCUMENT: crate::new_file::NewFile = crate::new_file::NewFile {
    command: DOCUMENT_CREATE,
    format: fub_format_rich::DOCX_FORMAT_ID,
    extension: "docx",
    words: &[
        crate::new_file::Words {
            locale: "it",
            title: "Nuovo documento",
            desc: "Crea un documento di Word vuoto e lo apre. Senza nome nasce «Documento senza \
                   titolo», e se quel nome è preso «Documento senza titolo 1», «2», …",
            untitled: "Documento senza titolo",
            the: "il documento",
            the_start: "Il documento",
            of_the: "del documento",
            a: "un documento",
            a_new: "un documento nuovo",
            all: "i documenti di Word",
            extra: &[],
        },
        crate::new_file::Words {
            locale: "en",
            title: "New document",
            desc: "Creates an empty Word document and opens it. Without a name it is called \
                   «Untitled document», and if that name is taken «Untitled document 1», «2», …",
            untitled: "Untitled document",
            the: "the document",
            the_start: "The document",
            of_the: "the document",
            a: "a document",
            a_new: "a new document",
            all: "Word documents",
            extra: &[],
        },
    ],
    blank: |_doc, _say| {
        let codec = Codec::Docx;
        let bytes = fub_format_rich::blank(codec).map_err(|error| error.to_string())?;
        let opened =
            fub_format_rich::open_unremembered(codec, &bytes).map_err(|error| error.to_string())?;
        match opened.readonly {
            None => Ok(bytes),
            Some(reason) => Err(format!("read only ({})", read_only_name(reason))),
        }
    },
};

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

/// Se un'apertura tiene il documento aperto, e quindi ricorda la prova a
/// vuoto dei suoi byte, o è una lettura semplice che la lascia cadere
/// ([`crate::engines`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Opening {
    /// Un'apertura sotto una chiave: la prova resta, per il salvataggio.
    Kept,
    /// Una lettura semplice: la stessa proiezione, nessuna prova ricordata.
    Plain,
}

/// La proiezione dei byte di `doc`.
pub(crate) fn open(
    codec: Codec,
    doc: &DocId,
    bytes: &[u8],
    opening: Opening,
) -> Result<String, PluginError> {
    #[cfg(feature = "rich")]
    {
        let opened = match opening {
            Opening::Kept => fub_format_rich::open(codec, bytes),
            Opening::Plain => fub_format_rich::open_unremembered(codec, bytes),
        };
        opened
            .map(|opened| opened.projection)
            .map_err(|error| plugin_error(doc, error))
    }
    #[cfg(not(feature = "rich"))]
    {
        let _ = (doc, bytes, opening);
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
///
/// Salvare sul documento vuoto può ricordarne la prova a vuoto: la sua
/// revisione va in `left`, anche quando il salvataggio fallisce, perché chi
/// scrive la dimentichi se nessuna chiave la tiene ([`crate::engines`]).
pub(crate) fn create(
    codec: Codec,
    doc: &DocId,
    projection: &str,
    left: &mut Vec<fub_abi::Revision>,
) -> Result<Vec<u8>, PluginError> {
    #[cfg(feature = "rich")]
    {
        let blank = fub_format_rich::blank(codec).map_err(|error| plugin_error(doc, error))?;
        left.push(fub_abi::Revision::of_bytes(&blank));
        match save(codec, doc, &blank, projection)? {
            Save::Unchanged => Ok(blank),
            Save::Bytes(bytes) => Ok(bytes),
        }
    }
    #[cfg(not(feature = "rich"))]
    {
        let _ = (doc, projection, left);
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
        RichError::OpaqueSchema(schema) => PluginError::BadArgs(Text::message(
            "host.rich.opaque_schema",
            vec![doc_arg(), Arg::text("schema", schema.to_string())],
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
        // Il numero del paragrafo da uno, come lo conta chi legge.
        RichError::Locked(Some(block)) => PluginError::PermissionDenied(Text::message(
            "host.rich.locked.block",
            vec![doc_arg(), Arg::text("block", (block + 1).to_string())],
        )),
        RichError::Locked(None) => PluginError::PermissionDenied(Text::message(
            "host.rich.locked.outside",
            vec![doc_arg()],
        )),
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
