//! Faithful CSV export (target `importers.csv`).
//!
//! One row per document from scalar frontmatter keys + title: lossy by
//! construction, so the report logs every dropped key and every non-scalar
//! value. Import lives in [`crate::csv`]; this module is the export half so
//! the two can evolve behind one target id.

pub use crate::csv::{CsvExport, TARGET_CSV_FILES as TARGET_CSV};
