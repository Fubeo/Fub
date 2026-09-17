//! Adapter workbook dell'host, senza dipendere da Tauri.
//!
//! Il motore della sessione vive nel formato ed è compilabile anche per WASM.
//! Questo adapter conserva l'API nativa e la derivazione comune `Revision::of`.
//! La valutazione della vertical slice usa il canale dati del bundle `fub.sheet`.
//! La sessione a finestre resta interna fino alla conformità nativa e WASM.

mod index;

pub(crate) use index::{SheetIndex, SHEET_ID};

use fub_abi::{PluginError, Revision};
use fub_format_sheet::{SheetId, Workbook};

pub use fub_format_sheet::session::{
    SheetCellPatch, SheetInvalidation, SheetOperation, SheetSessionError, SheetSourceEdit,
    SheetWindowCell, SheetWindowRequest, MAX_INVALIDATED_CELLS, MAX_OPERATION_INPUT_BYTES,
    MAX_OPERATION_PATCHES, MAX_WINDOW_CELLS, MAX_WINDOW_COLUMNS, MAX_WINDOW_RESPONSE_BYTES,
    MAX_WINDOW_ROWS,
};
pub use fub_format_sheet::WorkbookEvaluation;

pub type SheetWindow<'a> = fub_format_sheet::session::SheetWindow<'a, Revision>;
pub type SheetCommit = fub_format_sheet::session::SheetCommit<Revision>;

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

    pub fn source(&self) -> &str {
        self.inner.source()
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

    pub fn commit(
        &mut self,
        expected: &Revision,
        operation: &SheetOperation,
    ) -> Result<SheetCommit, SheetSessionError> {
        self.inner.commit(expected, operation, Revision::of)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_format_sheet::CellKey;

    #[test]
    fn malformed_workbooks_are_bad_arguments() {
        let error = evaluate("{}").unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)));
    }

    #[test]
    fn native_adapter_derives_the_new_revision_after_an_atomic_patch() {
        let source = r#"{"version":1,"sheets":[{"id":"s","name":"Foglio","rows":[{"id":"r"}],"columns":[{"id":"c"}],"cells":[{"row":"r","column":"c","input":"1"}]}]}"#;
        let mut session = SheetSession::open(source).unwrap();
        let before = session.revision().clone();
        let committed = session
            .commit(
                &before,
                &SheetOperation {
                    patches: vec![SheetCellPatch {
                        cell: CellKey {
                            sheet: "s".into(),
                            row: "r".into(),
                            column: "c".into(),
                        },
                        before: Some("1".into()),
                        after: "2".into(),
                    }],
                },
            )
            .unwrap();
        assert_eq!(&committed.revision, session.revision());
        assert_ne!(session.revision(), &before);
        assert!(session.source().contains("\"input\": \"2\""));
    }
}
