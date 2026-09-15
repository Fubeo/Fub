//! End-to-end failure boundaries for the untrusted WASM view provider.
//!
//! These calls deliberately use `Host`, rather than the component proxy, so
//! the test covers Bundle/Registrar mounting and the workspace guard around
//! `render_view`/`view_action`.

mod common;

use camino::Utf8PathBuf;
use fub_abi::traits::ViewInstance;
use fub_abi::ui::UiAction;
use fub_abi::PluginError;
use fub_host::Host;
use fub_host::NoWatcher;
use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;

const PLUGIN: &str = "example.view";
const VIEW: &str = "example.view:panel";

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Note.md"), "# Boundary\n").expect("note");
        Self { _dir: dir, root }
    }
}

fn bench(vault: &Vault, feature: &str) -> Host {
    let wasm = common::component("view-wasm", "view_wasm", feature);
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("view component loads");
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&vault.root).expect("vault opens");
    host.wait_indexed(None).expect("indexing completes");
    host.with_session(None, |session| {
        let mut workspace = session.workspace().write().unwrap();
        session
            .bundles()
            .write()
            .unwrap()
            .mount(&bundle, &mut workspace)
            .expect("community view mounts through Bundle/Registrar");
        assert!(
            workspace.plugins().iter().any(|plugin| plugin.id == PLUGIN),
            "the mounted component is declared in the workspace"
        );
    })
    .expect("open session");
    host
}

fn instance() -> ViewInstance {
    ViewInstance::new(
        VIEW,
        "example.view#boundary",
        serde_json::json!({"mode": "summary"}),
    )
}

fn close_and_assert_session_is_gone(host: &Host) -> Vec<PluginError> {
    let errors = host.close();
    assert!(
        host.with_session(None, |_| ()).is_err(),
        "close removes the session and every live registration"
    );
    errors
}

#[test]
fn community_view_interests_trap_is_contained_and_recovery_stays_usable() {
    let vault = Vault::new();
    let host = bench(&vault, "");
    let trapped = ViewInstance::new(
        VIEW,
        "example.view#boundary",
        serde_json::json!({"mode": "trap-interests"}),
    );

    let error = host
        .with_session(None, |session| {
            let workspace = session.workspace().read().expect("workspace");
            workspace.view_interests(&trapped)
        })
        .expect("session")
        .expect_err("the fixture intentionally traps while computing interests");
    assert!(
        matches!(error, PluginError::Internal(_)),
        "guest interests trap is contained as typed Internal: {error}"
    );

    let views = host
        .views(None)
        .expect("the host remains usable after the interests trap");
    assert!(views.iter().any(|view| view.id == VIEW));
    let errors = close_and_assert_session_is_gone(&host);
    assert!(
        errors
            .iter()
            .any(|error| matches!(error, PluginError::Internal(_))),
        "teardown reports the contained interests trap: {errors:?}"
    );
}

#[test]
fn community_view_render_rejects_nested_webview_and_host_stays_usable() {
    let vault = Vault::new();
    let host = bench(&vault, "active-content");

    let error = host
        .render_view(None, &instance())
        .expect_err("untrusted render tree contains a nested WebView");
    assert!(
        matches!(error, PluginError::PermissionDenied(_)),
        "the kernel UI guard returns a typed permission error: {error}"
    );

    let views = host
        .views(None)
        .expect("the host remains usable after denial");
    assert!(views.iter().any(|view| view.id == VIEW));
    assert!(close_and_assert_session_is_gone(&host).is_empty());
}

#[test]
fn community_view_action_rejects_nested_webview_and_typed_guest_error_survives() {
    let vault = Vault::new();
    let host = bench(&vault, "");
    let view = instance();

    let denied = host
        .view_action(
            None,
            &view,
            UiAction::new("web-view").with_payload(serde_json::json!({"route": "web-view"})),
        )
        .expect_err("untrusted action update contains a nested WebView");
    assert!(
        matches!(denied, PluginError::PermissionDenied(_)),
        "action output crosses the same typed UI guard: {denied}"
    );
    let html_denied = host
        .view_action(
            None,
            &view,
            UiAction::new("html").with_payload(serde_json::json!({"route": "html"})),
        )
        .expect_err("untrusted action update contains Html");
    assert!(
        matches!(html_denied, PluginError::PermissionDenied(_)),
        "Html is rejected by the typed UI guard independently of WebView: {html_denied}"
    );

    let guest = host
        .view_action(
            None,
            &view,
            UiAction::new("error").with_payload(serde_json::json!({"route": "error"})),
        )
        .expect_err("the guest deliberately returns a typed error");
    assert!(
        matches!(guest, PluginError::BadArgs(_)),
        "guest error remains typed rather than becoming a trap: {guest}"
    );
    assert!(close_and_assert_session_is_gone(&host).is_empty());
}

#[test]
fn community_view_trap_is_recoverable_at_host_boundary_and_teardown_is_observable() {
    let vault = Vault::new();
    let host = bench(&vault, "");
    let view = instance();

    let error = host
        .view_action(None, &view, UiAction::new("trap"))
        .expect_err("the fixture intentionally traps");
    assert!(
        matches!(error, PluginError::Internal(_)),
        "guest trap is translated to typed Internal without a process panic: {error}"
    );
    let errors = close_and_assert_session_is_gone(&host);
    assert!(
        errors
            .iter()
            .any(|error| matches!(error, PluginError::Internal(_))),
        "teardown reports the contained guest trap: {errors:?}"
    );
}

#[test]
fn malformed_view_arena_returns_typed_bad_args_and_close_keeps_host_clean() {
    let vault = Vault::new();
    let host = bench(&vault, "malformed-arena");

    let error = host
        .render_view(None, &instance())
        .expect_err("the fixture returns an out-of-range root");
    assert!(
        matches!(error, PluginError::BadArgs(_)),
        "malformed arena is rejected as typed BadArgs: {error}"
    );
    assert!(close_and_assert_session_is_gone(&host).is_empty());
}
