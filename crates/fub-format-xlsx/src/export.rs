//! Esportare la **copia in Excel** di un foglio `.fubsheet` alla porta di
//! export del contratto.
//!
//! Il `.fubsheet` resta com'è e niente entra nel vault: la copia è un
//! artefatto che l'utente posa dove vuole, con le note di
//! [`fubsheet::copy`](crate::fubsheet::copy) su ciò che non porta. Una
//! cartella di Excel non si copia in sé stessa, e ogni altro documento della
//! selezione resta fuori con un'informazione.

use fub_abi::command::{
    CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::model::DocId;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi, ReadApi, VaultRead};
use fub_abi::transfer::{
    copy_names, ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportSelection,
    ExportTarget, TransferNote,
};
use fub_abi::PluginError;
use fub_format_sheet::Workbook as SheetWorkbook;

use crate::fubsheet;

/// La destinazione di questo provider.
pub const TARGET: &str = "xlsx.copy";

/// Il comando che esporta la copia del foglio aperto.
pub const EXPORT_COPY: &str = "xlsx.export-copy";

/// Il comando del contratto che accoda un export.
const EXPORT_RUN: &str = "export.run";

/// Il tipo dei byte di una cartella di Excel.
pub const MEDIA_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/// L'estensione della copia.
const EXTENSION: &str = "xlsx";

/// Quanti fogli esporta una richiesta sola: ognuno si calcola due volte, e le
/// copie stanno in memoria finché l'utente non le posa.
const MAX_DOCUMENTS: usize = 64;

/// La destinazione offerta alla porta di export.
pub struct XlsxExport;

impl XlsxExport {
    pub fn boxed() -> Box<dyn ExportProvider> {
        Box::new(XlsxExport)
    }
}

impl ExportProvider for XlsxExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: TARGET.to_string(),
            name: "Excel".to_string(),
            extension: Some(EXTENSION.to_string()),
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        if request.target != TARGET {
            return Err(PluginError::BadArgs(
                format!("`{}` is not a destination of this provider", request.target).into(),
            ));
        }
        let docs = request.selection.resolve(host)?;
        let mut report = ExportReport::default();
        let mut chosen = Vec::new();
        for doc in docs {
            if is_fubsheet(host, &doc) {
                chosen.push(doc);
            } else {
                report.log.push(
                    TransferNote::info("non è un foglio .fubsheet: resta fuori")
                        .about(doc.to_string()),
                );
            }
        }
        if chosen.is_empty() {
            return Err(PluginError::BadArgs(
                "nothing to export as Excel: no selected document is a .fubsheet sheet".into(),
            ));
        }
        if chosen.len() > MAX_DOCUMENTS {
            return Err(PluginError::BadArgs(
                format!("more than {MAX_DOCUMENTS} sheets: select a smaller batch").into(),
            ));
        }
        for (doc, name) in chosen.iter().zip(copy_names(&chosen, EXTENSION)) {
            let entry = doc.to_string();
            let copy = match read(host, doc).and_then(|source| {
                fubsheet::copy(&source).map_err(|error| {
                    PluginError::Internal(
                        format!("the Excel copy of `{doc}` cannot be written: {error}").into(),
                    )
                })
            }) {
                Ok(copy) => copy,
                Err(error) => {
                    report
                        .log
                        .push(TransferNote::warning(error.to_string()).about(entry));
                    continue;
                }
            };
            let handle = out.open_artifact(&name, MEDIA_TYPE)?;
            for chunk in copy.bytes.chunks(64 * 1024) {
                out.write_artifact(handle, chunk)?;
            }
            report.artifacts.push(out.close_artifact(handle)?);
            report.log.extend(copy.notes.into_iter().map(|note| {
                match note.warning {
                    true => TransferNote::warning(note.text),
                    false => TransferNote::info(note.text),
                }
                .about(entry.clone())
            }));
        }
        if report.artifacts.is_empty() {
            return Err(PluginError::BadArgs(
                "none of the selected sheets could be exported as Excel".into(),
            ));
        }
        Ok(report)
    }
}

/// Se il registro serve `doc` come foglio `.fubsheet`.
pub fn is_fubsheet<H: VaultRead + ?Sized>(host: &H, doc: &DocId) -> bool {
    host.format_of(doc)
        .is_some_and(|format| format.descriptor.id == fub_format_sheet::FORMAT_ID)
}

fn read(host: &dyn ReadApi, doc: &DocId) -> Result<SheetWorkbook, PluginError> {
    let source = host.read_document(doc)?;
    SheetWorkbook::parse(&source)
        .map_err(|error| PluginError::BadArgs(format!("`{doc}` cannot be read: {error}").into()))
}

const T_TITLE: &str = "cmd.xlsx.export-copy.title";
const T_DESC: &str = "cmd.xlsx.export-copy.desc";
const T_DOC: &str = "cmd.xlsx.export-copy.doc";

/// Il comando «Esporta una copia in Excel»: accoda l'export del foglio con il
/// comando del contratto, `export.run`. La copia arriva nell'attività, dove
/// l'utente la salva.
pub struct XlsxCommands;

impl XlsxCommands {
    pub fn boxed() -> Box<dyn CommandProvider> {
        Box::new(XlsxCommands)
    }
}

impl CommandProvider for XlsxCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(EXPORT_COPY, Text::key(T_TITLE))
            .describing(Text::key(T_DESC))
            // Accodare l'export è un effetto, ma non tocca il vault: un
            // comando di sola lettura girerebbe in simulazione, e la sua
            // invocazione di `export.run` con lui.
            .with_scope(CommandScope::writing(CommandReach::Session))
            .with_param(ParamSpec::new("doc", Text::key(T_DOC), ParamKind::Document).required())]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != EXPORT_COPY {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let spec = self.commands().remove(0);
        spec.validate_args(&args)?;
        let doc = DocId::new(args["doc"].as_str().unwrap_or_default());
        if !is_fubsheet(&*host, &doc) {
            return Err(PluginError::BadArgs(
                format!("`{doc}` is not a .fubsheet sheet").into(),
            ));
        }
        let request = ExportRequest::new(TARGET, ExportSelection::Documents(vec![doc]));
        let request_json = serde_json::to_string(&request)
            .map_err(|error| PluginError::BadArgs(error.to_string().into()))?;
        // Il modo (prova o esecuzione) è dell'host, e passa con l'invocazione.
        host.run_command(
            EXPORT_RUN,
            serde_json::json!({ "request_json": request_json }),
        )
    }
}

/// Le stringhe del comando.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(T_TITLE, "Esporta una copia in Excel")
            .with(
                T_DESC,
                "Scrive una cartella di Excel con i fogli, i valori, le formule e gli stili \
                 del foglio, senza toccarlo. La copia arriva nell'attività, da salvare dove \
                 vuoi, con l'elenco di ciò che Excel non porta o calcola diverso.",
            )
            .with(T_DOC, "Foglio"),
        StringCatalog::new("en")
            .with(T_TITLE, "Export a copy to Excel")
            .with(
                T_DESC,
                "Writes an Excel workbook with the sheets, values, formulas and styles of \
                 the sheet without touching it. The copy appears in Activity, to save \
                 wherever you like, with the list of what Excel does not carry or computes \
                 differently.",
            )
            .with(T_DOC, "Sheet"),
    ]
}
