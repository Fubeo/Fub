"""Temporary branch-only M5 verification driver. Removed before final PR."""
from pathlib import Path
import runpy

if not Path("crates/fub-wasm-host/src/view.rs").exists():
    runpy.run_path(".github/scripts/m5-work.py")


def change(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        if new in text:
            return
        raise RuntimeError(f"Missing source in {path}: {old[:100]}")
    p.write_text(text.replace(old, new))


change("crates/fub-wasm-host/src/component.rs", "call(&self.inner, host, |store, interfaces|", "call(&self.inner, host, |interfaces, store|")
change("crates/fub-wasm-host/src/view.rs", "e::Subject::document(id)", "e::Subject::document(id.id)")
change("crates/fub-wasm-host/src/view.rs", "e::Subject::folder(path)", "e::Subject::folder(path.path)")
p = Path("crates/fub-wasm-host/src/view.rs")
t = p.read_text()
a, b = t.index("fn param("), t.index("pub(crate) fn from_spec(")
t = t[:a] + t[b:]
t = t.replace("command as c, ", "").replace(", command as wc", "").replace("map(param)", "map(tr::from_param_spec)")
p.write_text(t)
change("crates/fub-wasm-host/src/translate.rs", "\nfn from_param_spec(", "\npub(crate) fn from_param_spec(")
p = Path("crates/fub-wasm-host/Cargo.toml")
p.write_text(p.read_text().replace("\nserde.workspace = true", ""))

# A real view with host reads and action round-trips. The adversarial branches
# are compiled only by the negative test fixture, not the author example.
example = Path("esempi/vault-view-wasm")
(example / "src").mkdir(parents=True, exist_ok=True)
(example / "wit").mkdir(exist_ok=True)
change("Cargo.toml", '    "esempi/eventi-wasm",', '    "esempi/eventi-wasm",\n    "esempi/vault-view-wasm",')
(example / "Cargo.toml").write_text('''# Componente esterno al workspace: il test lo costruisce per wasm32-wasip2.
[package]
name = "vault-view-wasm"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[features]
adversarial = []
no-permission = []
bad-abi = []
deny-activate = []

[dependencies]
wit-bindgen = "0.60"
serde_json = "1"

[profile.release]
strip = true
opt-level = "s"
''')
(example / "wit/view.wit").write_text('''package esempio:vault-view;

world vault-view {
    import fub:abi/host-vault-read@0.1.1;
    import fub:abi/host-data-write@0.1.1;
    export fub:abi/plugin@0.1.1;
    export fub:abi/view@0.1.1;
}
''')
(example / "src/lib.rs").write_text(r'''//! Una lista di documenti letta dal vero host, con azioni di navigazione.
//! Nessun fub-abi Rust: soltanto il contratto WIT, come un componente di terzi.
wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:vault-view/vault-view",
    generate_all,
});

use exports::fub::abi::{plugin, view};
use fub::abi::{errors::PluginError, events::EventMask, options::OptionEntry, text::Text, ui::*};
const ID: &str = "demo.vault-view";
const VIEW: &str = "demo.vault-view:documents";
struct Component;
fn literal(text: impl Into<String>) -> Text { Text::Literal(text.into()) }
fn error(text: impl Into<String>) -> PluginError { PluginError::BadArgs(literal(text)) }

impl plugin::Guest for Component {
    fn manifest() -> plugin::PluginManifest {
        plugin::PluginManifest {
            id: ID.into(), name: "Documenti del vault (WASM)".into(), version: "0.1.0".into(),
            abi_version: if cfg!(feature = "bad-abi") { "9.0.0" } else { "0.1.1" }.into(),
            permissions: plugin::PluginPermissions {
                granted: if cfg!(feature = "no-permission") { vec![] } else {
                    vec![OptionEntry { key: "fub:read-vault".into(), value: "true".into() }]
                },
            },
            provides: vec![], requires: vec![], settings: vec![], strings: vec![], default_locale: "it".into(), timers: vec![],
        }
    }
    fn activate() -> Result<(), PluginError> {
        if cfg!(feature = "deny-activate") { fub::abi::host_vault_read::list_documents()?; }
        Ok(())
    }
    fn deactivate() -> Result<(), PluginError> { Ok(()) }
    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Err(PluginError::UnknownJob(literal(job)))
    }
}
fn interests() -> view::ViewInterests {
    view::ViewInterests {
        refresh: EventMask {
            kinds: vec![fub::abi::events::EventKind::DocumentChanged, fub::abi::events::EventKind::DocumentRemoved, fub::abi::events::EventKind::DocumentRenamed],
            topics: vec![], subjects: vec![], changes: vec![],
        },
        follows: vec![],
    }
}
fn single(kind: UiKind) -> UiTree { UiTree { nodes: vec![UiNode { key: None, kind }], root: 0 } }
impl view::Guest for Component {
    fn views() -> Vec<view::ViewSpec> {
        let interests = interests();
        vec![view::ViewSpec {
            id: VIEW.into(), title: literal("Documenti del vault"), surface: view::ViewSurface::RightSidebar,
            refresh: interests.refresh, follows: interests.follows,
            params: vec![fub::abi::command::ParamSpec {
                name: "mode".into(), title: literal("Modalità di prova"), description: literal("Solo per il banco negativo"),
                kind: fub::abi::command::ParamKind::Text, required: false,
            }],
            icon: Some("files".into()), order: 10, open_by_default: false, preferred_size: Some(280), closable: true,
        }]
    }
    fn interests(_instance: view::ViewInstance) -> view::ViewInterests { interests() }
    fn render_view(instance: view::ViewInstance) -> Result<UiTree, PluginError> {
        if instance.view != VIEW { return Err(PluginError::UnknownView(literal(instance.view))); }
        let params: serde_json::Value = serde_json::from_str(&instance.params).map_err(|e| error(e.to_string()))?;
        #[cfg(feature = "adversarial")]
        if let Some(mode) = params.get("mode").and_then(|v| v.as_str()) {
            match mode {
                "html" => return Ok(single(UiKind::Html("<script>bad()</script>".into()))),
                "webview" => return Ok(single(UiKind::WebView(UiWebView { url: "https://example.com".into(), height: 10 }))),
                "cycle" => return Ok(single(UiKind::List(vec![0]))),
                "bad-index" => return Ok(UiTree { nodes: vec![], root: 1 }),
                "bad-json" => return Ok(single(UiKind::Custom(UiCustom { ns: ID.into(), payload: "[".into(), fallback: vec![] }))),
                "deep" => return Ok(UiTree { nodes: (0..100).map(|i| UiNode { key: None, kind: UiKind::List(if i == 0 { vec![] } else { vec![i-1] }) }).collect(), root: 99 }),
                "dag" => return Ok(UiTree { nodes: (0..30).map(|i| UiNode { key: None, kind: UiKind::List(if i == 0 { vec![] } else { vec![i-1, i-1] }) }).collect(), root: 29 }),
                "write" => { fub::abi::host_data_write::data_write("probe", b"must-not-be-written")?; return Err(error("read-only boundary failed")); }
                "trap" => panic!("test del confine"),
                "timeout" => loop { std::hint::spin_loop(); },
                "memory" => { let mut data = Vec::new(); loop { data.push([42u8; 65536]); std::hint::black_box(&data); } }
                _ => return Err(error("modalità sconosciuta")),
            }
        }
        let _ = params;
        let mut ids = fub::abi::host_vault_read::list_documents()?;
        ids.sort();
        let mut nodes = Vec::new();
        for id in ids {
            let text = fub::abi::host_vault_read::read_document(&id)?;
            nodes.push(UiNode {
                key: Some(id.clone()),
                kind: UiKind::ListItem(UiListItem {
                    title: literal(id.clone()), subtitle: Some(literal(format!("{} caratteri", text.chars().count()))),
                    action: Some(ActionRef { action: "open".into(), payload: serde_json::to_string(&id).unwrap() }), selected: false,
                }),
            });
        }
        let root = nodes.len() as u32;
        nodes.push(UiNode { key: Some("documents".into()), kind: UiKind::List((0..root).collect()) });
        Ok(UiTree { nodes, root })
    }
    fn on_action(_instance: view::ViewInstance, action: UiAction) -> Result<ViewUpdate, PluginError> {
        match action.action.as_str() {
            "open" => Ok(ViewUpdate::Navigate(serde_json::from_str(&action.payload).map_err(|e| error(e.to_string()))?)),
            #[cfg(feature = "adversarial")]
            "replace-html" => Ok(ViewUpdate::Replace(single(UiKind::Html("bad".into())))),
            #[cfg(feature = "adversarial")]
            "patch-html" => Ok(ViewUpdate::Patch(ViewUpdatePatch { key: "documents".into(), node: single(UiKind::Html("bad".into())) })),
            "probe-write" => { fub::abi::host_data_write::data_write("probe", b"action")?; Ok(ViewUpdate::None) }
            _ => Err(error("azione sconosciuta")),
        }
    }
}
export!(Component);
''')

Path("crates/fub-wasm-host/tests/views_cross_the_boundary.rs").write_text(r'''//! View reale: lettura del vault, azione, UI ostile e teardown.
mod common;
use std::sync::OnceLock;
use camino::Utf8PathBuf;
use fub_abi::{traits::ViewInstance, ui::{UiAction, UiKind, ViewUpdate}, PluginError};
use fub_host::{Host, NoWatcher};
use fub_kernel::Trust;
use fub_wasm_host::{ComponentDirectory, WasmBundle};

const ID: &str = "demo.vault-view";
const VIEW: &str = "demo.vault-view:documents";
fn component() -> &'static Utf8PathBuf {
    static PATH: OnceLock<Utf8PathBuf> = OnceLock::new();
    PATH.get_or_init(|| common::component("vault-view-wasm", "vault_view_wasm", "adversarial"))
}
fn with_view(f: impl FnOnce(&mut fub_kernel::Workspace, &mut fub_host::BundleRegistry, &WasmBundle)) {
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
        assert!(matches!(ws.render_view(&ViewInstance::only(VIEW)), Err(PluginError::UnknownView(_))));
    }).unwrap();
    host.close();
}
#[test]
fn a_real_view_reads_the_vault_and_returns_navigation() {
    with_view(|ws, registry, bundle| {
        let instance = ViewInstance::only(VIEW);
        let tree = ws.render_view(&instance).unwrap();
        assert_eq!(tree.key.as_deref(), Some("documents"));
        let UiKind::List { items } = tree.kind else { panic!("expected list") };
        assert_eq!(items.len(), 1);
        let UiKind::ListItem { title, subtitle, action, .. } = &items[0].kind else { panic!("expected item") };
        assert_eq!(title.as_literal(), Some("Nota.md"));
        assert_eq!(subtitle.as_ref().unwrap().as_literal(), Some("7 caratteri"));
        let action = action.as_ref().unwrap();
        assert_eq!(ws.view_action(&instance, UiAction::new(action.action.0.clone()).with_payload(action.payload.clone())).unwrap(), ViewUpdate::Navigate { doc_id: "Nota.md".into() });
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
            assert!(matches!(ws.render_view(&instance), Err(PluginError::PermissionDenied(_))), "{mode}");
        }
        for action in ["replace-html", "patch-html"] {
            assert!(matches!(ws.view_action(&ViewInstance::only(VIEW), UiAction::new(action)), Err(PluginError::PermissionDenied(_))), "{action}");
        }
    });
}
#[test]
fn malformed_and_expanding_arenas_are_errors_not_host_panics() {
    with_view(|ws, _, _| {
        for mode in ["cycle", "bad-index", "bad-json", "deep", "dag"] {
            let mut instance = ViewInstance::only(VIEW);
            instance.params = serde_json::json!({ "mode": mode });
            assert!(matches!(ws.render_view(&instance), Err(PluginError::BadArgs(_))), "{mode}");
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
        assert_eq!(ws.view_action(&ViewInstance::only(VIEW), UiAction::new("probe-write")).unwrap(), ViewUpdate::None);
    });
}
#[test]
fn traps_timeouts_and_memory_limits_leave_the_host_alive() {
    for mode in ["trap", "timeout", "memory"] {
        with_view(|ws, registry, bundle| {
            let mut instance = ViewInstance::only(VIEW);
            instance.params = serde_json::json!({ "mode": mode });
            assert!(matches!(ws.render_view(&instance), Err(PluginError::Internal(_))), "{mode}");
            // Una trap può rendere l'istanza non richiamabile: lo smontaggio
            // deve comunque rimuovere tutte le registrazioni.
            let _ = registry.unmount(ws, ID);
            assert!(!registry.ids().contains(&ID));
            assert!(matches!(ws.render_view(&ViewInstance::only(VIEW)), Err(PluginError::UnknownView(_))));
            registry.mount(bundle, ws).unwrap();
            assert!(ws.render_view(&ViewInstance::only(VIEW)).is_ok());
        });
    }
}
#[test]
fn incompatible_abi_is_refused_before_installation() {
    let path = common::component("vault-view-wasm", "vault_view_wasm", "bad-abi");
    assert!(matches!(ComponentDirectory::inspect(&path), Err(PluginError::Unserved(_))));
}
#[test]
fn denied_activation_leaves_no_partial_mount() {
    let path = common::component("vault-view-wasm", "vault_view_wasm", "no-permission,deny-activate");
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
        assert!(matches!(ws.render_view(&ViewInstance::only(VIEW)), Err(PluginError::UnknownView(_))));
    }).unwrap();
    host.close();
}
''')
