//! Una lista di documenti letta dal vero host, con azioni di navigazione.
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
        if cfg!(feature = "deny-activate") { fub::abi::host_vault_read::list_documents(None)?; }
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
#[cfg(feature = "adversarial")]
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
        let mut ids = fub::abi::host_vault_read::list_documents(None)?.items;
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
