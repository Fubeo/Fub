//! View reale: lettura del vault, azione, UI ostile e teardown.
mod common;
use camino::Utf8PathBuf;
use fub_abi::{
    traits::ViewInstance,
    ui::{UiAction, UiKind, ViewUpdate},
    PluginError,
};
use fub_host::{Host, NoWatcher};
use fub_kernel::Trust;
use fub_wasm_host::{ComponentDirectory, WasmBundle};
use std::sync::OnceLock;

const ID: &str = "demo.vault-view";
const VIEW: &str = "demo.vault-view:documents";
fn component() -> &'static Utf8PathBuf {
    static PATH: OnceLock<Utf8PathBuf> = OnceLock::new();
    PATH.get_or_init(|| common::component("vault-view-wasm", "vault_view_wasm", "adversarial"))
}
fn with_view(
    f: impl FnOnce(&mut fub_kernel::Workspace, &mut fub_host::BundleRegistry, &WasmBundle),
) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let bundle = WasmBundle::from_file(component(), Trust::Community).unwrap();
    host.with_session(None, |session| {
        let mut ws = session.workspace().write().unwrap();
        let mut registry = session.bundles().write().unwrap();
        registry.mount(&bundle, &mut ws).unwrap();
        f(&mut ws, &mut registry, &bundle);
        assert!(registry.unmount(&mut ws, ID).is_empty());
        assert!(matches!(
            ws.render_view(&ViewInstance::only(VIEW)),
            Err(PluginError::UnknownView(_))
        ));
    })
    .unwrap();
    host.close();
}
#[test]
fn a_real_view_reads_the_vault_and_returns_navigation() {
    with_view(|ws, registry, bundle| {
        let instance = ViewInstance::only(VIEW);
        let tree = ws.render_view(&instance).unwrap();
        assert_eq!(tree.key.as_deref(), Some("documents"));
        let UiKind::List { items } = tree.kind else {
            panic!("expected list")
        };
        assert_eq!(items.len(), 1);
        let UiKind::ListItem {
            title,
            subtitle,
            action,
            ..
        } = &items[0].kind
        else {
            panic!("expected item")
        };
        assert_eq!(title.as_literal(), Some("Nota.md"));
        assert_eq!(subtitle.as_ref().unwrap().as_literal(), Some("7 caratteri"));
        let action = action.as_ref().unwrap();
        assert_eq!(
            ws.view_action(
                &instance,
                UiAction::new(action.action.0.clone()).with_payload(action.payload.clone())
            )
            .unwrap(),
            ViewUpdate::Navigate {
                doc_id: "Nota.md".into()
            }
        );
        assert!(registry.unmount(ws, ID).is_empty());
        registry.mount(bundle, ws).unwrap();
        assert!(ws.render_view(&instance).is_ok());
    });
}
#[test]
fn untrusted_ui_is_refused_on_render_replace_and_patch() {
    with_view(|ws, _, _| {
        for mode in ["html", "webview"] {
            let mut instance = ViewInstance::only(VIEW);
            instance.params = serde_json::json!({ "mode": mode });
            assert!(
                matches!(
                    ws.render_view(&instance),
                    Err(PluginError::PermissionDenied(_))
                ),
                "{mode}"
            );
        }
        for action in ["replace-html", "patch-html"] {
            assert!(
                matches!(
                    ws.view_action(&ViewInstance::only(VIEW), UiAction::new(action)),
                    Err(PluginError::PermissionDenied(_))
                ),
                "{action}"
            );
        }
    });
}
#[test]
fn malformed_and_expanding_arenas_are_errors_not_host_panics() {
    with_view(|ws, _, _| {
        for mode in ["cycle", "bad-index", "bad-json", "deep", "dag"] {
            let mut instance = ViewInstance::only(VIEW);
            instance.params = serde_json::json!({ "mode": mode });
            assert!(
                matches!(ws.render_view(&instance), Err(PluginError::BadArgs(_))),
                "{mode}"
            );
        }
        assert!(ws.render_view(&ViewInstance::only(VIEW)).is_ok());
    });
}
#[test]
fn render_does_not_borrow_mutable_host_capabilities() {
    with_view(|ws, _, _| {
        let mut instance = ViewInstance::only(VIEW);
        instance.params = serde_json::json!({ "mode": "write" });
        let error = ws.render_view(&instance).unwrap_err();
        assert!(matches!(error, PluginError::PermissionDenied(_)), "{error}");
        assert!(error.to_string().contains("ReadApi"), "{error}");
        // La stessa capacità è disponibile nell'azione, non nel render.
        assert_eq!(
            ws.view_action(&ViewInstance::only(VIEW), UiAction::new("probe-write"))
                .unwrap(),
            ViewUpdate::None
        );
    });
}
#[test]
fn traps_timeouts_and_memory_limits_leave_the_host_alive() {
    for mode in ["trap", "timeout", "memory"] {
        with_view(|ws, registry, bundle| {
            let mut instance = ViewInstance::only(VIEW);
            instance.params = serde_json::json!({ "mode": mode });
            assert!(
                matches!(ws.render_view(&instance), Err(PluginError::Internal(_))),
                "{mode}"
            );
            // Una trap può rendere l'istanza non richiamabile: lo smontaggio
            // deve comunque rimuovere tutte le registrazioni.
            let _ = registry.unmount(ws, ID);
            assert!(!registry.ids().contains(&ID));
            assert!(matches!(
                ws.render_view(&ViewInstance::only(VIEW)),
                Err(PluginError::UnknownView(_))
            ));
            registry.mount(bundle, ws).unwrap();
            assert!(ws.render_view(&ViewInstance::only(VIEW)).is_ok());
        });
    }
}
#[test]
fn incompatible_abi_is_refused_before_installation() {
    let path = common::component("vault-view-wasm", "vault_view_wasm", "bad-abi");
    assert!(matches!(
        ComponentDirectory::inspect(&path),
        Err(PluginError::Unserved(_))
    ));
}
#[test]
fn denied_activation_leaves_no_partial_mount() {
    let path = common::component(
        "vault-view-wasm",
        "vault_view_wasm",
        "no-permission,deny-activate",
    );
    let bundle = WasmBundle::from_file(&path, Trust::Community).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| {
        let mut ws = session.workspace().write().unwrap();
        let mut registry = session.bundles().write().unwrap();
        let error: PluginError = registry.mount(&bundle, &mut ws).unwrap_err().into();
        assert!(matches!(error, PluginError::PermissionDenied(_)), "{error}");
        assert!(!registry.ids().contains(&ID));
        assert!(!ws.plugins().iter().any(|plugin| plugin.id == ID));
        assert!(matches!(
            ws.render_view(&ViewInstance::only(VIEW)),
            Err(PluginError::UnknownView(_))
        ));
    })
    .unwrap();
    host.close();
}
