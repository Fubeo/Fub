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

struct NativeView;
impl fub_abi::traits::ViewProvider for NativeView {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        use fub_abi::event::{EventKind, EventMask};
        fub_abi::traits::ViewInterests {
            refresh: EventMask {
                kinds: vec![
                    EventKind::DocumentChanged,
                    EventKind::DocumentRemoved,
                    EventKind::DocumentRenamed,
                ],
                ..Default::default()
            },
            follows: Default::default(),
        }
    }

    fn views(&self) -> Vec<fub_abi::traits::ViewSpec> {
        vec![fub_abi::traits::ViewSpec {
            id: "demo.native:documents".into(),
            title: "Documenti del vault".into(),
            surface: fub_abi::traits::ViewSurface::RightSidebar,
            refresh: Default::default(),
            follows: Default::default(),
            params: vec![],
            icon: Some("files".into()),
            order: 10,
            open_by_default: false,
            preferred_size: Some(280),
            closable: true,
        }]
    }
    fn render_view(
        &self,
        _: &ViewInstance,
        host: &dyn fub_abi::traits::ReadApi,
    ) -> Result<fub_abi::ui::UiNode, PluginError> {
        use fub_abi::ui::{ActionId, ActionRef, UiNode};
        let mut ids = host.list_documents(None)?.items;
        ids.sort_by(|a, b| a.0.cmp(&b.0));
        let mut items = Vec::new();
        for id in ids {
            let text = host.read_document(&id)?;
            items.push(UiNode {
                key: Some(id.0.clone()),
                kind: UiKind::ListItem {
                    title: id.0.clone().into(),
                    subtitle: Some(format!("{} caratteri", text.chars().count()).into()),
                    action: Some(ActionRef {
                        action: ActionId("open".into()),
                        payload: serde_json::json!(id.0),
                    }),
                    selected: false,
                },
            });
        }
        Ok(UiNode {
            key: Some("documents".into()),
            kind: UiKind::List { items },
        })
    }
    fn on_action(
        &mut self,
        _: &ViewInstance,
        action: UiAction,
        _: &mut dyn fub_abi::traits::HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::Navigate {
            doc_id: serde_json::from_value(action.payload)
                .map_err(|error| PluginError::BadArgs(error.to_string().into()))?,
        })
    }
}

#[test]
fn native_and_wasm_views_have_the_same_observable_tree_and_action() {
    with_view(|ws, _, bundle| {
        use fub_host::Bundle;
        let mut manifest = bundle.manifest();
        manifest.id = "demo.native".into();
        ws.register_plugin(manifest, Trust::Community).unwrap();
        ws.register_view_provider("demo.native", Box::new(NativeView))
            .unwrap();
        let native = ViewInstance::only("demo.native:documents");
        let wasm = ViewInstance::only(VIEW);
        assert_eq!(
            ws.render_view(&native).unwrap(),
            ws.render_view(&wasm).unwrap()
        );
        let action = || UiAction::new("open").with_payload(serde_json::json!("Nota.md"));
        assert_eq!(
            ws.view_action(&native, action()).unwrap(),
            ws.view_action(&wasm, action()).unwrap()
        );
    });
}
