//! **I due id del vecchio PDF di solo testo**, come sinonimi (E28, T80).
//!
//! Fino a T80 `importers.pdf` (un PDF per nota) e `importers.pdf.single` (la
//! scelta in un PDF solo) erano destinazioni di `export.run`: il testo della
//! nota in un PDF statico, senza immagini, diagrammi né formule. Il PDF delle
//! note ora lo fa lo spazio «Esporta in PDF» (la vista impagina, il core
//! scrive: ADR 0247), e da fuori il comando `pdf.export_note`.
//!
//! Chi chiama ancora `export.run` con uno dei due id (un agente via MCP, uno
//! script) non si rompe: [`forward`] passa la richiesta a `pdf.export_note`.
//!
//! - una nota sola: è `pdf.export_note` con quella nota, col profilo che vale
//!   per lei e il PDF accanto alla nota; l'esito è il suo (la richiesta
//!   partita verso l'app, o l'errore tipato che chiede l'app aperta);
//! - più note: [`PluginError::BadArgs`], che dice di chiedere una nota alla
//!   volta o di usare «Esporta in PDF…» su una cartella nell'app;
//! - nessuna nota: [`PluginError::BadArgs`], come prima;
//! - `pdf.export_note` assente (una build senza il PDF delle note):
//!   [`PluginError::Unserved`].
//!
//! L'opzione `with_meta` del vecchio esportatore non ha più effetto: le
//! proprietà le decide il profilo. I due id non sono più fra le destinazioni
//! registrate, quindi «Esporta il vault…» non offre più il PDF: più note in un
//! PDF si fanno dal tasto destro su una cartella.

use fub_abi::command::CommandOutcome;
use fub_abi::traits::HostApi;
use fub_abi::transfer::ExportRequest;
use fub_abi::PluginError;

use crate::common::bad_args;

/// Il vecchio «un PDF per nota».
pub const TARGET_PDF: &str = "importers.pdf";
/// Il vecchio «la scelta in un PDF solo».
pub const TARGET_PDF_SINGLE: &str = "importers.pdf.single";
/// Il comando che fa il PDF di una nota (`fub_features::pdf_export::command`).
pub const PDF_EXPORT_NOTE: &str = "pdf.export_note";

/// `target` è uno dei due id del vecchio PDF di solo testo.
pub fn is_legacy_target(target: &str) -> bool {
    target == TARGET_PDF || target == TARGET_PDF_SINGLE
}

/// Esegue una richiesta di `export.run` per uno dei due id vecchi col comando
/// nuovo. Il modo (prova o davvero) è quello dell'host, come per ogni
/// `run_command`.
pub(crate) fn forward(
    request: &ExportRequest,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    debug_assert!(is_legacy_target(&request.target));
    let docs = request.selection.resolve(&*host)?;
    let doc = match docs.as_slice() {
        [] => return Err(bad_args("nothing selected: the PDF would be empty")),
        [doc] => doc,
        _ => {
            return Err(bad_args(format!(
                "`{}` now exports one note at a time with `{PDF_EXPORT_NOTE}`: \
                 {} notes were selected. Call it once per note, or use \
                 «Esporta in PDF…» on a folder in the app for one PDF of many notes",
                request.target,
                docs.len()
            )))
        }
    };
    match host.run_command(PDF_EXPORT_NOTE, serde_json::json!({ "note": doc.as_str() })) {
        Err(PluginError::UnknownCommand(_)) => Err(PluginError::Unserved(
            format!(
                "`{}` is served by `{PDF_EXPORT_NOTE}`, which this build does not have",
                request.target
            )
            .into(),
        )),
        other => other,
    }
}
