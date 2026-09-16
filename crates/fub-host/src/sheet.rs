//! Adapter workbook dell'host, senza dipendere da Tauri.
//!
//! Il motore della sessione vive nel formato ed è compilabile anche per WASM.
//! Questo adapter conserva l'API nativa e la derivazione comune `Revision::of`.
//! Non pubblica un contratto ABI/WIT e non sostituisce la porta provvisoria.

use fub_abi::{PluginError, Revision};
use fub_format_sheet::{SheetId, Workbook};

pub use fub_format_sheet::session::{
    SheetSessionError, SheetWindowCell, SheetWindowRequest, MAX_WINDOW_CELLS, MAX_WINDOW_COLUMNS,
    MAX_WINDOW_RESPONSE_BYTES, MAX_WINDOW_ROWS,
};
pub use fub_format_sheet::WorkbookEvaluation;

pub type SheetWindow<'a> = fub_format_sheet::session::SheetWindow<'a, Revision>;

/// Parses, validates and evaluates one authoritative `.fubsheet` source.
pub fn evaluate(source: &str) -> Result<WorkbookEvaluation, PluginError> {
    Workbook::parse(source)
        .and_then(|workbook| workbook.evaluate())
        .map_err(|error| PluginError::BadArgs(error.to_string().into()))
}

#[derive(Debug)]
pub struct SheetSession {
    inner: fub_format_sheet::session::SheetSession<Revision>,
}

impl SheetSession {
    pub fn open(source: &str) -> Result<Self, SheetSessionError> {
        Ok(Self {
            inner: fub_format_sheet::session::SheetSession::open(source, Revision::of)?,
        })
    }

    pub fn revision(&self) -> &Revision {
        self.inner.revision()
    }

    pub fn reload(&mut self, expected: &Revision, source: &str) -> Result<(), SheetSessionError> {
        self.inner.reload(expected, source, Revision::of)
    }

    pub fn window(
        &self,
        expected: &Revision,
        sheet_id: &SheetId,
        request: SheetWindowRequest,
    ) -> Result<SheetWindow<'_>, SheetSessionError> {
        self.inner.window(expected, sheet_id, request)
    }
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
