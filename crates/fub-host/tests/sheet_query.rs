//! La shell e un plugin leggono il medesimo provider posseduto dal bundle.
//! Rigenera la fixture con UPDATE_MIRROR=1 cargo test -p fub-host --test sheet_query.

use camino::Utf8PathBuf;
use fub_abi::{DocId, IndexQuery, IndexResult, PluginError};
use fub_host::Host;
use serde_json::{json, Value};

fn source(inputs: &[&str]) -> String {
    json!({
        "version": 1,
        "sheets": [{
            "id": "s", "name": "Foglio",
            "rows": [{"id": "r"}],
            "columns": (0..inputs.len()).map(|i| json!({"id": format!("c{i}")})).collect::<Vec<_>>(),
            "cells": inputs.iter().enumerate().map(|(i, input)| json!({
                "row": "r", "column": format!("c{i}"), "input": input
            })).collect::<Vec<_>>()
        }]
    })
    .to_string()
}

fn query(source: &str) -> IndexQuery {
    IndexQuery::Custom {
        ns: "fub.sheet".into(),
        query: json!({"kind": "evaluate", "version": 1, "source": source}),
    }
}

fn host() -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let host = Host::without_watcher();
    host.open(&path).unwrap();
    host.wait_indexed(None).unwrap();
    (dir, path, host)
}

#[test]
fn real_query_matches_the_typescript_fixture_without_a_dedicated_ipc() {
    let (_dir, _path, host) = host();
    let request = query(&source(&["2", "=A1+1", "caffè 😀", "=TRUE", "=1/0", ""]));
    let result = host.query_index(None, request.clone()).unwrap();
    let IndexResult::Custom(ref value) = result else {
        panic!("custom result")
    };
    assert_eq!(
        value["cells"][1]["value"],
        json!({"kind": "number", "value": 3.0})
    );
    assert_eq!(
        value["cells"][4]["value"],
        json!({"kind": "error", "value": "div_zero"})
    );
    assert_eq!(value["dependencies"][0]["depends_on"][0]["column"], "c0");
    let actual = json!({"query": request, "result": result});
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/sheet-query.json");
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&actual).unwrap()),
        )
        .unwrap();
    }
    let expected: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        actual, expected,
        "regenerate the fixture with UPDATE_MIRROR=1"
    );
}

#[test]
fn disabling_the_owner_retires_only_its_route_and_reenable_restores_it() {
    let (_dir, path, host) = host();
    let bytes = source(&["2", "=A1+1"]);
    std::fs::write(path.join("book.fubsheet"), &bytes).unwrap();
    let before = host
        .read_document(None, &DocId::new("book.fubsheet"))
        .unwrap();
    let expected = host.query_index(None, query(&bytes)).unwrap();
    for _ in 0..3 {
        assert!(host
            .set_plugin_enabled(None, "fub.sheet", false)
            .unwrap()
            .is_empty());
        assert!(matches!(
            host.query_index(None, query(&bytes)),
            Err(PluginError::Unserved(_))
        ));
        assert_eq!(
            host.read_document(None, &DocId::new("book.fubsheet"))
                .unwrap(),
            before
        );
        assert!(host
            .set_plugin_enabled(None, "fub.sheet", true)
            .unwrap()
            .is_empty());
        assert_eq!(host.query_index(None, query(&bytes)).unwrap(), expected);
    }
    assert_eq!(
        std::fs::read_to_string(path.join("book.fubsheet")).unwrap(),
        bytes
    );
    assert!(host.close_vault(&path).unwrap().is_empty());
}

#[test]
fn request_shape_and_version_are_closed_and_fail_with_typed_errors() {
    let (_dir, _path, host) = host();
    let empty = source(&[]);
    for payload in [
        json!({"kind":"evaluate","version":2,"source":empty}),
        json!({"kind":"evaluate","version":1,"source":empty,"extra":true}),
        json!({"kind":"evaluate","version":1}),
        json!({"kind":"evaluate","version":1,"source":42}),
        json!({"kind":"commit","version":1,"source":empty}),
        json!({"kind":"evaluate","version":1,"source":"{}"}),
    ] {
        let request = IndexQuery::Custom {
            ns: "fub.sheet".into(),
            query: payload,
        };
        assert!(matches!(
            host.query_index(None, request),
            Err(PluginError::BadArgs(_))
        ));
    }
    let absent = IndexQuery::Custom {
        ns: "fub.absent".into(),
        query: json!({}),
    };
    assert!(matches!(
        host.query_index(None, absent),
        Err(PluginError::Unserved(_))
    ));
    assert!(host.query_index(None, query(&empty)).is_ok());
}

#[test]
fn source_and_escaped_response_limits_apply_on_the_real_route() {
    let (_dir, _path, host) = host();
    let too_large = " ".repeat(fub_format_sheet::MAX_SOURCE_BYTES + 1);
    assert!(matches!(
        host.query_index(None, query(&too_large)),
        Err(PluginError::BadArgs(_))
    ));
    let large = "\u{0001}".repeat(fub_format_sheet::MAX_CELL_INPUT_BYTES);
    let bytes = source(&[&large, &large]);
    assert!(bytes.len() < fub_format_sheet::MAX_SOURCE_BYTES);
    assert!(matches!(
        host.query_index(None, query(&bytes)),
        Err(PluginError::BadArgs(_))
    ));
    assert!(host.query_index(None, query(&source(&["4"]))).is_ok());
}
