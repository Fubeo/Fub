//! Prove the deferred provider boundary of the current WASM runtime.
//!
//! `IndexProvider` and inbound `EventHandler` exports are deliberately not part
//! of the runtime surface yet. A guest can carry those exports, but they must
//! not become registrations by accident. Separately, a genuinely unserved host
//! family must be rejected before any mount state is published.

mod common;

use camino::Utf8PathBuf;
use fub_host::Host;
use fub_kernel::{RegistrationKind, Trust};
use fub_wasm_host::{LoadError, WasmBundle};
use std::sync::Arc;

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

fn assert_deferred_export_is_not_registered(
    vault: &Vault,
    example: &str,
    artifact: &str,
    plugin_id: &str,
    _deferred_kind: RegistrationKind,
) {
    let wasm = common::component(example, artifact, "");
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("guest loads");
    let host = host(vault);
    host.mount_bundle(None, Arc::new(bundle))
        .expect("plugin itself mounts");
    assert!(
        host.plugin_ids(None)
            .expect("plugin inventory")
            .iter()
            .any(|id| id == plugin_id),
        "mounted guest is declared"
    );
    assert!(
        host.bundles(Some(vault.root.as_str()))
            .expect("runtime inventory")
            .iter()
            .any(|bundle| bundle.id == plugin_id),
        "the runtime bundle is published"
    );
    assert!(host.close_vault(&vault.root).expect("teardown").is_empty());
    assert!(
        host.bundles(None).is_err(),
        "teardown removes the deferred guest session"
    );

    host.open(&vault.root)
        .expect("host reopens after deferred teardown");
    host.wait_indexed(None).expect("reopened vault indexes");
    let valid = WasmBundle::from_file(&common::ping(""), Trust::Community)
        .expect("a supported guest remains loadable");
    host.mount_bundle(None, Arc::new(valid))
        .expect("supported guest mounts after teardown");
    let plugins = host.plugin_ids(None).expect("plugin inventory");
    assert!(plugins.iter().any(|id| id == "demo.ping"));
    assert!(!plugins.iter().any(|id| id == plugin_id));
    assert!(host.close().is_empty(), "reopened host closes cleanly");
}

#[test]
fn index_provider_export_is_deferred_without_a_registration_or_residue() {
    let vault = Vault::new();
    assert_deferred_export_is_not_registered(
        &vault,
        "index-provider-wasm",
        "index_provider_wasm",
        "demo.index-provider",
        RegistrationKind::Index,
    );
}

#[test]
fn inbound_event_handler_export_is_deferred_without_a_registration_or_residue() {
    let vault = Vault::new();
    assert_deferred_export_is_not_registered(
        &vault,
        "event-handler-wasm",
        "event_handler_wasm",
        "demo.event-handler",
        RegistrationKind::EventHandler,
    );
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
        "the failure remains the named-family model: {message}"
    );
    assert!(
        message.contains("host-network"),
        "the rejection names the unserved family: {message}"
    );
    assert!(
        !host
            .plugin_ids(None)
            .expect("plugin inventory")
            .iter()
            .any(|id| id == "demo.ping"),
        "rejected guest publishes no plugin declaration or claim"
    );
    assert!(
        !host
            .bundles(None)
            .expect("bundle inventory")
            .iter()
            .any(|bundle| bundle.id == "demo.ping"),
        "rejected guest publishes no runtime bundle"
    );

    let valid = WasmBundle::from_file(&common::ping(""), Trust::Community)
        .expect("supported guest remains loadable after rejection");
    host.mount_bundle(None, Arc::new(valid))
        .expect("host mounts a supported guest after rejection");
    assert!(host
        .plugin_ids(None)
        .expect("plugin inventory")
        .iter()
        .any(|id| id == "demo.ping"));
    assert!(
        host.close().is_empty(),
        "host closes without rollback residue"
    );
}
