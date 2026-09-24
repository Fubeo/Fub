//! Real inbound components cross the same host registration and lifecycle as
//! native providers; a trapped declaration must not leave a mounted owner.

mod common;

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_host::{BundleClaim, Host, StartupBundle};
use fub_kernel::Trust;
use fub_wasm_host::{LoadError, WasmBundle};
use serde_json::{json, Value};

const INDEX: &str = "demo.index-provider";
const ROUTE: &str = "demo.index-provider:ids";
const EVENT: &str = "demo.event-handler";

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("vault tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("vault utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").expect("nota fixture");
        Self { _dir: dir, root }
    }
}

fn host(vault: &Vault) -> Host {
    let host = Host::without_watcher().with_job_threads(1);
    host.open(&vault.root).expect("vault opens");
    host.wait_indexed(None).expect("opening finishes");
    host
}

fn startup(vault: &Vault, example: &str, artifact: &str) -> Host {
    let wasm = common::component(example, artifact, "");
    let bundle = Arc::new(WasmBundle::from_file(&wasm, Trust::Community).expect("guest loads"));
    let source = Arc::new(vec![StartupBundle::new(bundle, true, BundleClaim::new())]);
    let host = Host::without_watcher()
        .with_job_threads(1)
        .with_startup_source(source);
    host.open(&vault.root)
        .expect("vault opens with inbound provider");
    host.wait_indexed(None).expect("opening finishes");
    host
}

fn index_state(host: &Host) -> Value {
    match host
        .query_index(
            None,
            IndexQuery::Custom {
                ns: ROUTE.to_string(),
                query: Value::Null,
            },
        )
        .expect("WASM index owns its declared route")
    {
        IndexResult::Custom(value) => value,
        other => panic!("unexpected index reply: {other:?}"),
    }
}

#[test]
fn index_feed_query_flush_close_and_empty_reconcile_cross_the_component() {
    let vault = Vault::new();
    let host = startup(&vault, "index-provider-wasm", "index_provider_wasm");
    let state = index_state(&host);
    assert_eq!(state["count"], 1, "initial scan feeds the guest: {state}");
    // `up_to_date` is an intersection across every mounted index: native
    // providers conservatively answer nothing, so the guest's scan request
    // is never consulted on a cold open — the document is always fed.

    host.write_document(
        None,
        &DocId("Nota.md".into()),
        "# Nota\nseconda versione\n",
        WriteBase::Dictated,
    )
    .expect("write feeds the index");
    let written = index_state(&host);
    assert_eq!(written["count"], 1);
    assert!(written["fed"].as_u64().unwrap() > state["fed"].as_u64().unwrap());

    assert!(host
        .close_vault(&vault.root)
        .expect("close vault")
        .is_empty());
    assert!(
        host.bundles(None).is_err(),
        "closed session owns no registrations"
    );
    host.open(&vault.root)
        .expect("reopen loads persisted index");
    host.wait_indexed(None).expect("reopen indexes");
    let reopened = index_state(&host);
    assert_eq!(reopened["loaded"], 1, "flush persisted the accepted id");
    assert_eq!(reopened["closed_before"], true, "close ran after flush");

    assert!(host
        .close_vault(&vault.root)
        .expect("second close")
        .is_empty());
    std::fs::remove_file(vault.root.join("Nota.md")).expect("delete while closed");
    host.open(&vault.root).expect("reopen empty vault");
    host.wait_indexed(None).expect("empty scan completes");
    let empty = index_state(&host);
    assert_eq!(
        empty["loaded"], 1,
        "index retained the old id before reconciliation"
    );
    assert_eq!(empty["count"], 0, "an empty reconcile removes stale ids");
    assert!(empty["reconciled"].as_u64().unwrap() >= 1);
    assert!(host.close().is_empty());
}

#[test]
fn index_removal_feed_crosses_the_component() {
    let vault = Vault::new();
    let host = startup(&vault, "index-provider-wasm", "index_provider_wasm");
    assert_eq!(index_state(&host)["count"], 1);
    host.invoke_user_command(
        None,
        "note.trash",
        json!({"doc": "Nota.md"}),
        InvokeMode::Apply,
    )
    .expect("the official trash command removes a document");
    let removed = index_state(&host);
    assert_eq!(removed["count"], 0);
    assert!(removed["removed"].as_u64().unwrap() >= 1);
    assert!(host.close().is_empty());
}

#[test]
fn subscribed_notices_reach_guest_and_guard_denies_missing_read_permission() {
    let vault = Vault::new();
    let host = startup(&vault, "event-handler-wasm", "event_handler_wasm");
    let before = host
        .invoke_job(None, EVENT, "snapshot", json!({}))
        .expect("event snapshot");
    host.write_document(
        None,
        &DocId("Nota.md".into()),
        "# Nota\nevento\n",
        WriteBase::Dictated,
    )
    .expect("document change is committed");
    let after = host
        .invoke_job(None, EVENT, "snapshot", json!({}))
        .expect("event snapshot");
    assert!(after["changed"].as_u64().unwrap() > before["changed"].as_u64().unwrap());
    assert!(after["denied"].as_u64().unwrap() > before["denied"].as_u64().unwrap());

    assert!(host
        .close_vault(&vault.root)
        .expect("close vault")
        .is_empty());
    assert!(
        host.bundles(None).is_err(),
        "handler is unregistered at teardown"
    );
    host.open(&vault.root).expect("reopen handler");
    host.wait_indexed(None).expect("reopen scan");
    let reopened = host
        .invoke_job(None, EVENT, "snapshot", json!({}))
        .expect("event snapshot");
    assert_eq!(
        reopened["closed_before"], true,
        "VaultClosed reached the old handler"
    );
    assert!(host.close().is_empty());
}

#[test]
fn trapped_index_declaration_rolls_back_without_a_route_or_plugin() {
    let vault = Vault::new();
    let host = host(&vault);
    let wasm = common::component("index-provider-wasm", "index_provider_wasm", "trap-routes");
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("guest loads");
    let error = host
        .mount_bundle(None, Arc::new(bundle))
        .expect_err("route declaration traps");
    assert!(
        error.to_string().contains("indice non dichiarato"),
        "{error}"
    );
    assert!(!host
        .plugin_ids(None)
        .expect("inventory")
        .iter()
        .any(|id| id == INDEX));
    assert!(host
        .query_index(
            None,
            IndexQuery::Custom {
                ns: ROUTE.into(),
                query: Value::Null
            }
        )
        .is_err());
    let valid = WasmBundle::from_file(&common::ping(""), Trust::Community).expect("valid guest");
    host.mount_bundle(None, Arc::new(valid))
        .expect("host remains reusable");
    assert!(host.close().is_empty());
}

#[test]
fn an_unserved_host_family_names_itself_and_leaves_a_reusable_host() {
    let vault = Vault::new();
    let host = host(&vault);

    let rejected = WasmBundle::from_file(&common::ping("con-rete"), Trust::Community)
        .expect_err("an unserved family is rejected before mounting");
    let message = rejected.to_string();
    assert!(
        matches!(rejected, LoadError::UnservedFamilies(_)),
        "{message}"
    );
    assert!(message.contains("host-network"), "{message}");
    assert!(!host
        .plugin_ids(None)
        .expect("inventory")
        .iter()
        .any(|id| id == "demo.ping"));
    assert!(!host
        .bundles(None)
        .expect("bundles")
        .iter()
        .any(|bundle| bundle.id == "demo.ping"));

    let valid = WasmBundle::from_file(&common::ping(""), Trust::Community).expect("valid guest");
    host.mount_bundle(None, Arc::new(valid))
        .expect("supported guest mounts after rejection");
    assert!(host
        .plugin_ids(None)
        .expect("inventory")
        .iter()
        .any(|id| id == "demo.ping"));
    assert!(host.close().is_empty());
}
