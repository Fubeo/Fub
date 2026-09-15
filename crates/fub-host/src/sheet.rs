//! Motore workbook consumato dagli host concreti senza dipendere da Tauri.

use fub_abi::PluginError;
use fub_format_sheet::Workbook;
pub use fub_format_sheet::WorkbookEvaluation;

/// Parses, validates and evaluates one authoritative `.fubsheet` source.
pub fn evaluate(source: &str) -> Result<WorkbookEvaluation, PluginError> {
    Workbook::parse(source)
        .and_then(|workbook| workbook.evaluate())
        .map_err(|error| PluginError::BadArgs(error.to_string().into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_workbooks_are_bad_arguments() {
        let error = evaluate("{}").unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)));
    }
}
