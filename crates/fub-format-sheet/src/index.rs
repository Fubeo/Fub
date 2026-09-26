//! La query privata della vertical slice passa dal registro, non da IPC bespoke.

use fub_abi::{
    DocId, DocumentModel, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, PluginError,
    QueryKind, QueryRoute,
};
use serde::{Deserialize, Serialize};

use crate::session::{check_response_size, SheetSessionError};
use crate::{Workbook, WorkbookEvaluation};

/// Id del bundle che monta griglia e valutazione, e namespace della query.
pub const SHEET_ID: &str = "fub.sheet";

/// Parses, validates and evaluates one authoritative `.fubsheet` source.
pub fn evaluate(source: &str) -> Result<WorkbookEvaluation, PluginError> {
    Workbook::parse(source)
        .and_then(|workbook| workbook.evaluate())
        .map_err(|error| PluginError::BadArgs(error.to_string().into()))
}

/// Non è il futuro protocollo grid: è la sola lettura della vertical slice,
/// con versione e campi chiusi, trasportata dal canale custom già esistente.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum SheetQuery<'a> {
    Evaluate { version: u32, source: &'a str },
}

#[derive(Serialize)]
struct EvaluationEnvelope<'a> {
    kind: &'static str,
    value: &'a WorkbookEvaluation,
}

pub struct SheetIndex;

impl IndexProvider for SheetIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(SHEET_ID.into()))]
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, _: &[DocumentModel]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn on_documents_removed(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, request: IndexQuery) -> Result<IndexResult, PluginError> {
        let IndexQuery::Custom { ns, query } = request else {
            return Err(PluginError::BadArgs("expected a sheet query".into()));
        };
        if ns != SHEET_ID {
            return Err(PluginError::BadArgs("unexpected sheet namespace".into()));
        }
        // Deserialize dal valore preso in prestito: nessuna seconda copia della
        // sorgente prima del limite imposto dal parser del formato.
        let SheetQuery::Evaluate { version, source } = SheetQuery::deserialize(&query)
            .map_err(|error| PluginError::BadArgs(error.to_string().into()))?;
        if version != 1 {
            return Err(PluginError::BadArgs(
                "unsupported sheet query version".into(),
            ));
        }
        let evaluation = evaluate(source)?;
        check_response_size(&EvaluationEnvelope {
            kind: "custom",
            value: &evaluation,
        })
        .map_err(|error| match error {
            SheetSessionError::ResponseTooLarge => {
                PluginError::BadArgs("sheet response exceeds 8 MiB".into())
            }
            _ => PluginError::Internal(error.to_string().into()),
        })?;
        serde_json::to_value(evaluation)
            .map(IndexResult::Custom)
            .map_err(|error| PluginError::Internal(error.to_string().into()))
    }

    fn flush(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
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

    #[test]
    fn budget_counts_the_same_envelope_as_the_real_index_result() {
        let evaluation = evaluate(r#"{"version":1,"sheets":[]}"#).unwrap();
        let borrowed = serde_json::to_value(EvaluationEnvelope {
            kind: "custom",
            value: &evaluation,
        })
        .unwrap();
        let actual = IndexResult::Custom(serde_json::to_value(evaluation).unwrap());
        assert_eq!(borrowed, serde_json::to_value(actual).unwrap());
    }
}
