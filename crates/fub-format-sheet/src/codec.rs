use fub_abi::schema::SchemaVersion;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::model::{ValidationError, Workbook};

pub const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);
pub const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum SheetError {
    #[error("fubsheet source contains {actual} bytes, limit is {MAX_SOURCE_BYTES}")]
    SourceTooLarge { actual: usize },
    #[error("fubsheet source is not valid JSON: {0}")]
    InvalidJson(String),
    #[error("fubsheet source has no schema version")]
    MissingSchema,
    #[error("unsupported fubsheet schema {found}; this build supports {supported}")]
    UnsupportedSchema {
        found: SchemaVersion,
        supported: SchemaVersion,
    },
    #[error("invalid fubsheet workbook: {0}")]
    InvalidWorkbook(#[from] ValidationError),
    #[error("fubsheet serialization failed: {0}")]
    Serialize(String),
}

#[derive(Deserialize)]
struct VersionProbe {
    schema: Option<SchemaVersion>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    schema: SchemaVersion,
    workbook: Workbook,
}

#[derive(Serialize)]
struct EnvelopeRef<'a> {
    schema: SchemaVersion,
    workbook: &'a Workbook,
}

pub fn parse(source: &str) -> Result<Workbook, SheetError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(SheetError::SourceTooLarge {
            actual: source.len(),
        });
    }

    let probe: VersionProbe =
        serde_json::from_str(source).map_err(|error| SheetError::InvalidJson(error.to_string()))?;
    let schema = probe.schema.ok_or(SheetError::MissingSchema)?;
    if schema != SCHEMA_VERSION {
        return Err(SheetError::UnsupportedSchema {
            found: schema,
            supported: SCHEMA_VERSION,
        });
    }

    let envelope: Envelope =
        serde_json::from_str(source).map_err(|error| SheetError::InvalidJson(error.to_string()))?;
    debug_assert_eq!(envelope.schema, SCHEMA_VERSION);
    envelope.workbook.validate()?;
    Ok(envelope.workbook)
}

pub fn serialize(workbook: &Workbook) -> Result<String, SheetError> {
    serialize_with_limit(workbook, MAX_SOURCE_BYTES)
}

fn serialize_with_limit(
    workbook: &Workbook,
    max_source_bytes: usize,
) -> Result<String, SheetError> {
    workbook.validate()?;
    let envelope = EnvelopeRef {
        schema: SCHEMA_VERSION,
        workbook,
    };
    let mut source = serde_json::to_string_pretty(&envelope)
        .map_err(|error| SheetError::Serialize(error.to_string()))?;
    source.push('\n');
    if source.len() > max_source_bytes {
        return Err(SheetError::SourceTooLarge {
            actual: source.len(),
        });
    }
    Ok(source)
}

#[cfg(test)]
mod tests {
    use serde_json::Map;

    use super::*;
    use crate::model::{Column, ColumnId, Row, RowId, Sheet, SheetId, WorkbookId};

    fn minimal_workbook() -> Workbook {
        Workbook {
            id: WorkbookId::from("workbook"),
            metadata: Map::new(),
            sheets: vec![Sheet {
                id: SheetId::from("sheet"),
                name: "Foglio".into(),
                metadata: Map::new(),
                rows: vec![Row {
                    id: RowId::from("row"),
                    height: None,
                }],
                columns: vec![Column {
                    id: ColumnId::from("column"),
                    width: None,
                }],
                cells: Vec::new(),
            }],
        }
    }

    #[test]
    fn serialization_limit_counts_the_final_newline_and_preserves_round_trip() {
        let workbook = minimal_workbook();
        let source = serialize_with_limit(&workbook, usize::MAX).expect("fixture serializes");
        assert!(source.ends_with('\n'));

        assert_eq!(
            serialize_with_limit(&workbook, source.len() - 1),
            Err(SheetError::SourceTooLarge {
                actual: source.len(),
            }),
            "the final newline must count toward the source limit"
        );

        let bounded = serialize_with_limit(&workbook, source.len())
            .expect("source exactly at the limit serializes");
        assert_eq!(bounded.len(), source.len());
        assert_eq!(parse(&bounded), Ok(workbook));
    }
}
