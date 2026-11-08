//! Le cartelle di Excel composte dall'host: si modificano con il giornale della
//! sessione (ADR 0216, ADR 0219) e si stampano in PDF con l'export del bundle.
//!
//! `fub-format-xlsx` possiede il codec, la superficie della griglia sui byte e
//! l'innesto; il kernel conosce soltanto il formato a byte. L'host li compone
//! alle due porte dei documenti della shell:
//!
//! - **leggere** una cartella dà il testo di un giornale vuoto, con la
//!   revisione dei byte del file: il testo della `DocumentSession` è il
//!   giornale delle celle cambiate, e la griglia si apre sui byte;
//! - **scriverla** con un giornale innesta le sue voci nei byte che la shell
//!   ha visto, attraverso il provider registrato, e scrive con il CAS della
//!   stessa revisione. Un giornale vuoto non scrive niente.
//!
//! Il codec gira fuori dal lucchetto del workspace: si leggono i byte, si
//! rilascia, si chiama il provider. Senza la feature `xlsx` nessun formato è di
//! questi, e ogni funzione qui lo dice.

use fub_abi::format::{DocumentFormat, FormatProvider};
use fub_abi::{Arg, DocId, GridJournal, PluginError, Text};

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

/// Il bundle che registra la superficie della griglia sui byte.
#[cfg(feature = "xlsx")]
pub(crate) const WORKBOOK_ID: &str = "fub.xlsx";

/// Registra la superficie della griglia delle cartelle, la stessa che la
/// shell apre e che il salvataggio usa per l'innesto, e l'export in PDF con il
/// suo comando.
#[cfg(feature = "xlsx")]
pub(crate) fn register(registrar: &mut crate::registry::Registrar<'_>) -> Vec<String> {
    let mut failures = Vec::new();
    if let Err(error) = registrar
        .register_grid_bytes_provider(Box::new(fub_format_xlsx::grid::XlsxGridProvider::new()))
    {
        failures.push(format!("workbook grid NOT registered: {error}"));
    }
    if let Err(error) =
        registrar.register_export_provider(fub_format_xlsx::export::XlsxExport::boxed())
    {
        failures.push(format!("workbook export not registered: {error}"));
    }
    if let Err(error) =
        registrar.register_command_provider(fub_format_xlsx::export::XlsxCommands::boxed())
    {
        failures.push(format!("workbook commands not registered: {error}"));
    }
    if let Err(error) =
        registrar.register_command_provider(Box::new(crate::new_file::NewFileCommands(&NEW_SHEET)))
    {
        failures.push(format!("{SHEET_CREATE} not registered: {error}"));
    }
    failures
}

/// Le frasi del bundle: quelle della stampa e quelle di «Nuovo foglio»,
/// sommate per lingua.
#[cfg(feature = "xlsx")]
pub(crate) fn catalog() -> Vec<fub_abi::text::StringCatalog> {
    let mut catalogs = fub_format_xlsx::export::catalog();
    catalogs.extend(NEW_SHEET.catalog());
    catalogs
}

/// «Nuovo foglio»: una cartella di Excel vuota, che si apre.
#[cfg(feature = "xlsx")]
pub const SHEET_CREATE: &str = "sheet.create";

/// La cartella di Excel che nasce vuota: un foglio solo, col nome che Excel
/// gli dà nella lingua di chi la crea («Foglio1», «Sheet1»), e i byte scritti
/// da GridCraft attraverso `fub-format-xlsx`, lo stesso padrone che innesta il
/// giornale, che li rilegge prima di darli.
#[cfg(feature = "xlsx")]
static NEW_SHEET: crate::new_file::NewFile = crate::new_file::NewFile {
    command: SHEET_CREATE,
    format: fub_format_xlsx::FORMAT_ID,
    extension: "xlsx",
    words: &[
        crate::new_file::Words {
            locale: "it",
            title: "Nuovo foglio",
            desc: "Crea una cartella di Excel vuota, con un foglio solo, e la apre. Senza nome \
                   nasce «Foglio senza titolo», e se quel nome è preso «Foglio senza titolo 1», \
                   «2», …",
            untitled: "Foglio senza titolo",
            the: "il foglio",
            of_the: "del foglio",
            a: "un foglio",
            a_new: "un foglio nuovo",
            all: "i fogli di Excel",
            extra: &[("first_sheet", "Foglio1")],
        },
        crate::new_file::Words {
            locale: "en",
            title: "New spreadsheet",
            desc: "Creates an empty Excel workbook with one sheet and opens it. Without a name \
                   it is called «Untitled spreadsheet», and if that name is taken «Untitled \
                   spreadsheet 1», «2», …",
            untitled: "Untitled spreadsheet",
            the: "the spreadsheet",
            of_the: "the spreadsheet",
            a: "a spreadsheet",
            a_new: "a new spreadsheet",
            all: "Excel spreadsheets",
            extra: &[("first_sheet", "Sheet1")],
        },
    ],
    blank: |doc, say| {
        let file_name = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
        fub_format_xlsx::blank(file_name, &say("first_sheet")).map_err(|error| error.to_string())
    },
};

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

/// La superficie della griglia sui byte delle cartelle.
pub(crate) fn surface(doc: &DocId) -> Result<&'static str, PluginError> {
    #[cfg(feature = "xlsx")]
    {
        let _ = doc;
        Ok(fub_format_xlsx::grid::XLSX_GRID_SURFACE)
    }
    #[cfg(not(feature = "xlsx"))]
    {
        Err(read_only(doc))
    }
}

/// Il controllo dei byte di `doc` prima di darli alla griglia: le dimensioni e
/// la firma, senza leggere il pacchetto.
pub(crate) fn check(doc: &DocId, bytes: &[u8]) -> Result<(), PluginError> {
    #[cfg(feature = "xlsx")]
    {
        fub_format_xlsx::check(bytes).map_err(|error| plugin_error(doc, error))
    }
    #[cfg(not(feature = "xlsx"))]
    {
        let _ = bytes;
        Err(read_only(doc))
    }
}

/// Il giornale che la shell manda a salvare, nella sua forma canonica.
pub(crate) fn journal(doc: &DocId, source: &str) -> Result<GridJournal, PluginError> {
    GridJournal::parse(source).map_err(|error| {
        PluginError::BadArgs(Text::message(
            "host.xlsx.journal",
            vec![
                Arg::text("doc", doc.as_str()),
                Arg::text("why", error.to_string()),
            ],
        ))
    })
}

/// Il rifiuto di coprire una cartella con byte che non vengono dall'innesto.
pub(crate) fn read_only(doc: &DocId) -> PluginError {
    PluginError::PermissionDenied(Text::message(
        "host.xlsx.readonly",
        vec![Arg::text("doc", doc.as_str())],
    ))
}

/// Il rifiuto di far nascere una cartella da un giornale: senza i byte non c'è
/// niente in cui innestare.
pub(crate) fn missing(doc: &DocId) -> PluginError {
    PluginError::PermissionDenied(Text::message(
        "host.xlsx.missing",
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

/// I comandi che fanno nascere un file vuoto seguono la feature del loro
/// formato: spenta la feature, il comando non è dichiarato. Gira anche con
/// `--no-default-features`, che è la metà che conta.
#[cfg(test)]
mod new_file_commands_follow_their_features {
    use camino::Utf8PathBuf;

    #[test]
    fn document_create_e_sheet_create_ci_sono_solo_con_la_loro_feature() {
        let vault = tempfile::tempdir().unwrap();
        let config = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
        let config = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap();
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        let host = crate::session::Host::without_watcher().with_config_dir(&config);
        host.open(&root).unwrap();
        host.wait_indexed(None).unwrap();
        let ids: Vec<String> = host
            .commands(None)
            .unwrap()
            .into_iter()
            .map(|spec| spec.id)
            .collect();
        let declared = |id: &str| ids.iter().any(|own| own == id);
        assert_eq!(
            declared("document.create"),
            cfg!(feature = "rich"),
            "{ids:?}"
        );
        assert_eq!(declared("sheet.create"), cfg!(feature = "xlsx"), "{ids:?}");
    }
}
