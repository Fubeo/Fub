//! Esportare una cartella di Excel in PDF, con l'impaginazione di GridCraft.
//!
//! La cartella resta com'è: se ne leggono i byte salvati, se ne fa il modello
//! con il codec e se ne stampa ogni foglio con le sue impostazioni di pagina
//! (`gridcraft_engine::cmd::print`). Il PDF esce come artefatto alla porta di
//! export del contratto, e l'utente lo posa dove vuole: niente entra nel
//! vault (ADR 0211).
//!
//! # Nessuna perdita silenziosa
//!
//! Un PDF è una stampa: porta ciò che le pagine mostrano, e niente di ciò che
//! la cartella fa. Ciò che la stampa lascia fuori si **conta** sul modello e
//! diventa un avviso nel rapporto: i fogli nascosti, le note, le formule senza
//! un valore salvato (che si stampano vuote), le pagine oltre il limite. Ciò
//! che un PDF non può portare in nessun caso (le formule, le convalide, i
//! filtri, i caratteri oltre i quattordici del PDF) lo dice una nota a parte.

use fub_abi::command::{
    Choice, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind,
    ParamSpec,
};
use fub_abi::model::DocId;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi, ReadApi, VaultRead};
use fub_abi::transfer::{
    copy_names, ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportSelection,
    ExportTarget, TransferNote,
};
use fub_abi::PluginError;
use gridcraft_engine::cmd::print::{layouts, render_pdf, PrintOptions, MAX_PAGES};
use gridcraft_model::{Visibility, Workbook};

use crate::{guarded, read, XlsxError, FORMAT_ID};

/// La destinazione di questo provider.
pub const TARGET_PDF: &str = "xlsx.copy.pdf";

/// Il comando che esporta in PDF la cartella aperta.
pub const EXPORT_PDF: &str = "xlsx.export-pdf";

/// Il comando del contratto che accoda un export.
const EXPORT_RUN: &str = "export.run";

/// L'opzione che sceglie i fogli: `all`, ogni foglio visibile, o `active`,
/// il foglio che il file ha attivo.
pub const OPTION_SHEETS: &str = "sheets";

/// Quante cartelle esporta una richiesta sola: i PDF stanno in memoria finché
/// l'utente non li posa.
const MAX_DOCUMENTS: usize = 64;

/// Quali fogli si stampano.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sheets {
    All,
    Active,
}

impl Sheets {
    const ALL: [Sheets; 2] = [Sheets::All, Sheets::Active];

    fn key(self) -> &'static str {
        match self {
            Sheets::All => "all",
            Sheets::Active => "active",
        }
    }

    fn of_key(key: &str) -> Option<Sheets> {
        Sheets::ALL.into_iter().find(|sheets| sheets.key() == key)
    }
}

/// Le destinazioni offerte alla porta di export.
pub struct XlsxExport;

impl XlsxExport {
    pub fn boxed() -> Box<dyn ExportProvider> {
        Box::new(XlsxExport)
    }
}

impl ExportProvider for XlsxExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: TARGET_PDF.to_string(),
            name: "PDF".to_string(),
            extension: Some("pdf".to_string()),
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        if request.target != TARGET_PDF {
            return Err(PluginError::BadArgs(
                format!("`{}` is not a destination of this provider", request.target).into(),
            ));
        }
        let sheets = match request.options.get(OPTION_SHEETS) {
            None | Some(serde_json::Value::Null) => Sheets::All,
            Some(value) => value
                .as_str()
                .and_then(Sheets::of_key)
                .ok_or_else(|| PluginError::BadArgs("`sheets` must be `all` or `active`".into()))?,
        };
        let docs = request.selection.resolve(host)?;
        let mut report = ExportReport::default();
        let mut chosen = Vec::new();
        for doc in docs {
            if is_workbook(host, &doc) {
                chosen.push(doc);
            } else {
                report.log.push(
                    TransferNote::info("non è una cartella di Excel: resta fuori")
                        .about(doc.to_string()),
                );
            }
        }
        if chosen.is_empty() {
            return Err(PluginError::BadArgs(
                "nothing to export as PDF: no selected document is an Excel workbook".into(),
            ));
        }
        if chosen.len() > MAX_DOCUMENTS {
            return Err(PluginError::BadArgs(
                format!("more than {MAX_DOCUMENTS} workbooks: select a smaller batch").into(),
            ));
        }
        for (doc, name) in chosen.iter().zip(copy_names(&chosen, "pdf")) {
            let entry = doc.to_string();
            let printed = host.read_document_bytes(doc).and_then(|bytes| {
                print(&bytes, sheets, file_name(doc)).map_err(|error| {
                    PluginError::BadArgs(format!("`{doc}` cannot be printed: {error}").into())
                })
            });
            let printed = match printed {
                Ok(printed) => printed,
                Err(error) => {
                    report
                        .log
                        .push(TransferNote::warning(error.to_string()).about(entry));
                    continue;
                }
            };
            let handle = out.open_artifact(&name, "application/pdf")?;
            for chunk in printed.bytes.chunks(64 * 1024) {
                out.write_artifact(handle, chunk)?;
            }
            report.artifacts.push(out.close_artifact(handle)?);
            report.log.extend(
                printed
                    .losses
                    .into_iter()
                    .map(|loss| loss.about(entry.clone())),
            );
        }
        if report.artifacts.is_empty() {
            return Err(PluginError::BadArgs(
                "none of the selected workbooks could be exported as PDF".into(),
            ));
        }
        Ok(report)
    }
}

fn is_workbook<H: VaultRead + ?Sized>(host: &H, doc: &DocId) -> bool {
    host.format_of(doc)
        .is_some_and(|format| format.descriptor.id == FORMAT_ID)
}

/// Il nome del file nelle intestazioni e nei piè di pagina (`&F`).
fn file_name(doc: &DocId) -> String {
    doc.as_str()
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

/// Un PDF stampato, con ciò che non porta.
pub struct Printed {
    pub bytes: Vec<u8>,
    pub pages: usize,
    pub losses: Vec<TransferNote>,
}

/// Stampa in PDF i byte di una cartella. Il codec e l'impaginazione girano in
/// un thread con lo stack grande, come la lettura.
pub fn print(bytes: &[u8], sheets: Sheets, file: String) -> Result<Printed, XlsxError> {
    let read = read(bytes)?;
    guarded(move || {
        let workbook = read.workbook;
        let options = PrintOptions {
            all_sheets: sheets == Sheets::All,
            range: None,
            fit_to_page: None,
        };
        let laid = layouts(&workbook, &options);
        // Il percorso del file nel vault non esce nel PDF (`&Z`): basta il nome.
        let (bytes, pages) = render_pdf(&workbook, &laid, &file, "");
        let printed: Vec<usize> = laid.iter().map(|layout| layout.sheet).collect();
        let losses = losses(&workbook, sheets, &printed, pages);
        Ok(Printed {
            bytes,
            pages,
            losses,
        })
    })
}

/// Gli avvisi su ciò che il PDF non porta, contati sul modello.
fn losses(
    workbook: &Workbook,
    sheets: Sheets,
    printed: &[usize],
    pages: usize,
) -> Vec<TransferNote> {
    let mut notes = Vec::new();
    let hidden = workbook
        .sheets
        .iter()
        .filter(|sheet| sheet.visibility != Visibility::Visible)
        .count();
    if sheets == Sheets::All && hidden > 0 {
        notes.push(TransferNote::warning(format!(
            "{} non si stampa{}",
            counted(hidden, "foglio nascosto", "fogli nascosti"),
            if hidden == 1 { "" } else { "no" }
        )));
    }
    if sheets == Sheets::Active && workbook.sheets.len() > 1 {
        notes.push(TransferNote::info(format!(
            "si stampa soltanto il foglio attivo del file, su {}",
            counted(workbook.sheets.len(), "foglio", "fogli")
        )));
    }
    let empty = workbook
        .sheets
        .iter()
        .enumerate()
        .filter(|(index, sheet)| {
            sheets == Sheets::All
                && sheet.visibility == Visibility::Visible
                && !printed.contains(index)
        })
        .count();
    if empty > 0 {
        notes.push(TransferNote::info(format!(
            "{} senza niente da stampare non {} pagine",
            counted(empty, "foglio", "fogli"),
            if empty == 1 { "ha" } else { "hanno" }
        )));
    }
    let in_print = |index: usize| printed.contains(&index);
    let comments: usize = workbook
        .sheets
        .iter()
        .enumerate()
        .filter(|(index, _)| in_print(*index))
        .map(|(_, sheet)| sheet.comments.len())
        .sum();
    if comments > 0 {
        notes.push(TransferNote::warning(format!(
            "{} non si stampa{}",
            counted(comments, "nota o commento", "note e commenti"),
            if comments == 1 { "" } else { "no" }
        )));
    }
    let uncomputed = workbook
        .sheets
        .iter()
        .enumerate()
        .filter(|(index, _)| in_print(*index))
        .flat_map(|(_, sheet)| sheet.cells.iter())
        .filter(|(_, cell)| cell.formula.is_some() && cell.value.is_empty())
        .count();
    if uncomputed > 0 {
        notes.push(TransferNote::warning(format!(
            "{} senza un valore salvato nel file si stampa{} vuot{}",
            counted(uncomputed, "formula", "formule"),
            if uncomputed == 1 { "" } else { "no" },
            if uncomputed == 1 { "a" } else { "e" }
        )));
    }
    if pages >= MAX_PAGES {
        notes.push(TransferNote::warning(format!(
            "il PDF si ferma a {MAX_PAGES} pagine: le altre non ci sono"
        )));
    }
    notes.push(TransferNote::info(
        "il PDF è una stampa dei valori salvati nel file: formule, convalide, filtri e \
         collegamenti fra fogli restano nella cartella, e i caratteri diventano i quattordici \
         del PDF",
    ));
    notes
}

fn counted(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

const T_TITLE: &str = "cmd.xlsx.export-pdf.title";
const T_DESC: &str = "cmd.xlsx.export-pdf.desc";
const T_DOC: &str = "cmd.xlsx.export-pdf.doc";
const T_SHEETS: &str = "cmd.xlsx.export-pdf.sheets";

fn sheets_key(sheets: Sheets) -> String {
    format!("{T_SHEETS}.{}", sheets.key())
}

/// Il comando «Esporta in PDF»: sceglie la cartella e i fogli e accoda
/// l'export con il comando del contratto, `export.run`. Il PDF arriva
/// nell'attività, dove l'utente lo salva.
pub struct XlsxCommands;

impl XlsxCommands {
    pub fn boxed() -> Box<dyn CommandProvider> {
        Box::new(XlsxCommands)
    }
}

impl CommandProvider for XlsxCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        let sheets = Sheets::ALL
            .into_iter()
            .map(|sheets| Choice::new(sheets.key(), Text::key(sheets_key(sheets))))
            .collect();
        vec![CommandSpec::new(EXPORT_PDF, Text::key(T_TITLE))
            .describing(Text::key(T_DESC))
            // Come le copie dei documenti di videoscrittura: accodare l'export è
            // un effetto, che non tocca il vault.
            .with_scope(CommandScope::writing(CommandReach::Session))
            .with_param(ParamSpec::new("doc", Text::key(T_DOC), ParamKind::Document).required())
            .with_param(ParamSpec::new(
                OPTION_SHEETS,
                Text::key(T_SHEETS),
                ParamKind::Choice(sheets),
            ))]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != EXPORT_PDF {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let spec = self.commands().remove(0);
        spec.validate_args(&args)?;
        let doc = DocId::new(args["doc"].as_str().unwrap_or_default());
        if !is_workbook(&*host, &doc) {
            return Err(PluginError::BadArgs(
                format!("`{doc}` is not an Excel workbook").into(),
            ));
        }
        let sheets = args
            .get(OPTION_SHEETS)
            .and_then(serde_json::Value::as_str)
            .unwrap_or(Sheets::All.key());
        let request = ExportRequest::new(TARGET_PDF, ExportSelection::Documents(vec![doc]))
            .with_options(serde_json::json!({ OPTION_SHEETS: sheets }));
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
            .with(T_TITLE, "Esporta in PDF")
            .with(
                T_DESC,
                "Stampa la cartella di Excel in un PDF con le impostazioni di pagina di ogni \
                 foglio, senza toccarla. Il PDF arriva nell'attività, da salvare dove vuoi, con \
                 l'elenco di ciò che la stampa non porta.",
            )
            .with(T_DOC, "Cartella")
            .with(T_SHEETS, "Fogli")
            .with(sheets_key(Sheets::All), "Tutti i fogli visibili")
            .with(sheets_key(Sheets::Active), "Il foglio attivo"),
        StringCatalog::new("en")
            .with(T_TITLE, "Export to PDF")
            .with(
                T_DESC,
                "Prints the Excel workbook to a PDF with each sheet's page setup, without \
                 touching it. The PDF appears in Activity, to save wherever you like, with the \
                 list of what printing does not carry.",
            )
            .with(T_DOC, "Workbook")
            .with(T_SHEETS, "Sheets")
            .with(sheets_key(Sheets::All), "All visible sheets")
            .with(sheets_key(Sheets::Active), "The active sheet"),
    ]
}
