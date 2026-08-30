use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_format_sheet::SheetProvider;
use fub_kernel::{FormatRegistry, Workspace};

#[test]
fn kernel_indexes_the_common_projection_from_a_real_fubsheet() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8 path");
    std::fs::create_dir_all(&root).expect("vault directory");
    std::fs::write(
        root.join("Conti.fubsheet"),
        r#"{
  "schema": 1,
  "workbook": {
    "id": "workbook-1",
    "metadata": { "owner": "Bilancio" },
    "sheets": [{
      "id": "sheet-1",
      "name": "Preventivo",
      "rows": [{ "id": "row-1" }],
      "columns": [{ "id": "column-1" }],
      "cells": [{ "row": "row-1", "column": "column-1", "input": "Ricavi" }]
    }]
  }
}
"#,
    )
    .expect("sheet source");

    let mut formats = FormatRegistry::new();
    formats
        .register(SheetProvider::boxed())
        .expect("single provider has no conflict");
    let mut workspace = Workspace::new(&root, formats).expect("vault opens");
    workspace.reindex().expect("sheet projection indexes");

    let outline = workspace
        .query_index(IndexQuery::Outline {
            doc: DocId::new("Conti.fubsheet"),
        })
        .expect("outline query is served");
    let IndexResult::Outline(headings) = outline else {
        panic!("expected outline projection");
    };
    assert_eq!(headings.len(), 1);
    assert_eq!(headings[0].text, "Preventivo");
    assert_eq!(headings[0].slug, "sheet-1");
}
