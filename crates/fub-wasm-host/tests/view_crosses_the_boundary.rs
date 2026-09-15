mod common;

use camino::Utf8PathBuf;
use fub_abi::command::{Choice, ParamKind, ParamSpec};
use fub_abi::event::{EventKind, EventMask};
use fub_abi::traits::{
    HostApi, Plugin, PluginManifest, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, Axis, FieldValue, UiAction, UiKind, UiNode, UiValue, ViewUpdate};
use fub_abi::{ContextKind, ContextMask, PluginError, Text};
use fub_host::registry::{Bundle, Registrar};
use fub_host::{Host, NoWatcher};
use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;
use serde_json::Value;

const PLUGIN_ID: &str = "example.view";
const VIEW_ID: &str = "example.view:panel";
const INSTANCE: &str = "example.view:panel.detail";

fn find_status(value: &Value) -> Option<&str> {
    match value {
        Value::String(text) if text.starts_with("activated=true;") => Some(text),
        Value::Array(values) => values.iter().find_map(find_status),
        Value::Object(values) => values.values().find_map(find_status),
        _ => None,
    }
}

fn normalize_host_now(value: &mut Value) {
    match value {
        Value::String(text) => {
            const FIELD: &str = "host-now=";
            if text.starts_with("activated=true;") {
                if let Some(start) = text.find(FIELD).map(|at| at + FIELD.len()) {
                    if let Some(end) = text[start..].find(';').map(|at| start + at) {
                        if !text[start..end].is_empty()
                            && text[start..end].bytes().all(|byte| byte.is_ascii_digit())
                        {
                            text.replace_range(start..end, "<host-now>");
                        }
                    }
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                normalize_host_now(value);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                normalize_host_now(value);
            }
        }
        _ => {}
    }
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 vault");
        std::fs::write(root.join("Nota.md"), "# Nota\ncontenuto\n").expect("fixture");
        Self { _dir: dir, root }
    }
}

fn instance() -> ViewInstance {
    ViewInstance::new(
        VIEW_ID,
        INSTANCE,
        serde_json::json!({"mode": "detail", "density": 2}),
    )
}

fn action(action: &str) -> UiAction {
    UiAction::new(action)
        .with_payload(serde_json::json!({"route": action, "marker": "payload-17"}))
        .with_fields(vec![FieldValue {
            field: "field-17".into(),
            value: UiValue::Text("field-value-17".into()),
        }])
}

fn mount(host: &Host, bundle: &dyn Bundle) {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().expect("workspace");
        s.bundles()
            .write()
            .expect("bundles")
            .mount(bundle, &mut ws)
            .expect("bundle mounts");
    })
    .expect("session");
}

fn unmount(host: &Host) {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().expect("workspace");
        let errors = s
            .bundles()
            .write()
            .expect("bundles")
            .unmount(&mut ws, PLUGIN_ID);
        assert!(errors.is_empty(), "unmount errors: {errors:?}");
    })
    .expect("session");
}

fn host(vault: &Vault) -> Host {
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&vault.root).expect("vault opens");
    host.wait_indexed(None).expect("indexing finishes");
    host
}

fn literal(value: impl Into<String>) -> Text {
    Text::Literal(value.into())
}

fn native_tree(instance: &ViewInstance, host: &dyn ReadApi) -> UiNode {
    let doc = host
        .active_context()
        .and_then(|context| context.doc)
        .map(|doc| doc.to_string())
        .unwrap_or_else(|| "<none>".into());
    let status = format!(
        "activated=true; view={}; instance={}; mode={}; host-now={}; doc={doc}",
        instance.view,
        instance.instance,
        instance.params,
        host.now_unix_millis()
    );
    UiNode::keyed(
        "root",
        UiKind::Stack {
            dir: Axis::Column,
            gap: 10,
            children: vec![
                UiNode::keyed(
                    "title",
                    UiKind::Heading {
                        level: 2,
                        content: literal("Example View"),
                    },
                ),
                UiNode::keyed(
                    "status",
                    UiKind::Text {
                        content: literal(status),
                    },
                ),
                UiNode::keyed(
                    "replace",
                    UiKind::Button {
                        label: literal("Replace tree"),
                        intent: Default::default(),
                        action: ActionRef::with("replace", serde_json::json!({"route": "replace"})),
                    },
                ),
                UiNode::keyed(
                    "patch",
                    UiKind::Button {
                        label: literal("Patch status"),
                        intent: Default::default(),
                        action: ActionRef::with(
                            "patch",
                            serde_json::json!({"route": "patch", "key": "status"}),
                        ),
                    },
                ),
                UiNode::keyed(
                    "nested",
                    UiKind::Tree {
                        roots: vec![UiNode::new(UiKind::TreeItem {
                            label: literal("nested"),
                            expanded: true,
                            action: None,
                            selected: false,
                            children: vec![UiNode::new(UiKind::TreeItem {
                                label: literal("leaf"),
                                expanded: false,
                                action: None,
                                selected: false,
                                children: vec![],
                            })],
                        })],
                    },
                ),
            ],
        },
    )
}
fn native_spec() -> ViewSpec {
    ViewSpec::new(VIEW_ID, literal("Example View"), ViewSurface::RightSidebar)
        .refreshing(EventMask::of([EventKind::DocumentChanged]).on_topics(["example.view"]))
        .following(ContextMask(vec![
            ContextKind::Document,
            ContextKind::Selection,
        ]))
        .with_params(vec![
            ParamSpec {
                name: "mode".into(),
                title: literal("Mode"),
                description: literal("Display mode for the fixture"),
                kind: ParamKind::Choice(vec![
                    Choice {
                        value: "summary".into(),
                        title: literal("Summary"),
                    },
                    Choice {
                        value: "detail".into(),
                        title: literal("Detail"),
                    },
                    Choice {
                        value: "trap-interests".into(),
                        title: literal("Trap interests"),
                    },
                    Choice {
                        value: "self-format".into(),
                        title: literal("Self format"),
                    },
                ]),
                required: true,
            },
            ParamSpec {
                name: "density".into(),
                title: literal("Density"),
                description: literal("Numeric density hint"),
                kind: ParamKind::Number,
                required: false,
            },
        ])
        .with_icon("layout-dashboard")
        .ordered(17)
        .open_by_default()
        .sized(360)
}

struct NativeView;

impl ViewProvider for NativeView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![native_spec()]
    }

    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::DocumentChanged]).on_topics(["example.view"]),
            follows: ContextMask(vec![ContextKind::Document]),
        }
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(native_tree(instance, host))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        let observed = format!(
            "action={};payload={};fields=[{}]",
            action.action.0,
            action.payload,
            action
                .fields
                .iter()
                .map(|field| {
                    let value = match &field.value {
                        UiValue::Text(value) => format!("text:{value}"),
                        UiValue::Number(value) => format!("number:{value}"),
                        UiValue::Bool(value) => format!("bool:{value}"),
                        UiValue::Choices(values) => format!("choices:{values:?}"),
                    };
                    format!("{}={value}", field.field)
                })
                .collect::<Vec<_>>()
                .join(",")
        );
        match action.action.0.as_str() {
            "replace" => Ok(ViewUpdate::Replace {
                root: UiNode::keyed(
                    "replace-root",
                    UiKind::Stack {
                        dir: Axis::Column,
                        gap: 6,
                        children: vec![UiNode::keyed(
                            "replace-value",
                            UiKind::Text {
                                content: literal(format!("REPLACE:{observed}")),
                            },
                        )],
                    },
                ),
            }),
            "patch" => Ok(ViewUpdate::Patch {
                key: "status".into(),
                node: UiNode::keyed(
                    "patched",
                    UiKind::Text {
                        content: literal(format!("PATCH:{observed}")),
                    },
                ),
            }),
            _ => Ok(ViewUpdate::None),
        }
    }
}

struct NativePlugin;
impl Plugin for NativePlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(PLUGIN_ID, "Example Declarative View")
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn run_job(
        &self,
        _job: &str,
        _payload: serde_json::Value,
        _host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        Err(PluginError::UnknownJob("native view has no jobs".into()))
    }
}

struct NativeBundle;
impl Bundle for NativeBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(PLUGIN_ID, "Example Declarative View")
    }
    fn trust(&self) -> Trust {
        Trust::Community
    }
    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(NativePlugin)
    }
    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        registrar
            .register_view_provider(Box::new(NativeView))
            .err()
            .map(|e| vec![e.to_string()])
            .unwrap_or_default()
    }
}

#[test]
fn wasm_view_mounts_specs_renders_and_actions_match_native() {
    let vault = Vault::new();
    let wasm = WasmBundle::from_file(
        &common::component("view-wasm", "view_wasm", ""),
        Trust::Community,
    )
    .expect("component loads");
    let native = NativeBundle;
    let host = host(&vault);

    mount(&host, &wasm);
    let wasm_spec = host
        .views(None)
        .expect("wasm specs")
        .into_iter()
        .find(|s| s.id == VIEW_ID)
        .expect("wasm view");
    assert_eq!(wasm_spec.params.len(), 2);
    assert_eq!(wasm_spec.params[0].name, "mode");
    assert!(wasm_spec.params[0].required);
    assert_eq!(wasm_spec.params[1].name, "density");
    assert!(!wasm_spec.params[1].required);
    let wasm_interests = host
        .with_session(None, |s| {
            let ws = s.workspace().read().expect("workspace");
            ws.view_interests(&instance()).expect("wasm interests")
        })
        .expect("session");
    assert_eq!(
        wasm_interests.follows,
        ContextMask(vec![ContextKind::Document])
    );
    let wasm_render = host.render_view(None, &instance()).expect("wasm render");
    let wasm_json = serde_json::to_value(&wasm_render).expect("wasm render serializes");
    let wasm_status = find_status(&wasm_json).expect("wasm render has status");
    assert!(
        wasm_status.starts_with("activated=true;"),
        "wasm view activated: {wasm_status}"
    );
    let wasm_replace = host
        .view_action(None, &instance(), action("replace"))
        .expect("wasm replace");
    let wasm_patch = host
        .view_action(None, &instance(), action("patch"))
        .expect("wasm patch");
    assert!(matches!(wasm_replace, ViewUpdate::Replace { .. }));
    assert!(matches!(wasm_patch, ViewUpdate::Patch { ref key, .. } if key == "status"));
    unmount(&host);
    assert!(matches!(
        host.render_view(None, &instance()),
        Err(PluginError::UnknownView(_))
    ));

    mount(&host, &native);
    let native_spec = host
        .views(None)
        .expect("native specs")
        .into_iter()
        .find(|s| s.id == VIEW_ID)
        .expect("native view");
    assert_eq!(native_spec, wasm_spec);
    let native_interests = host
        .with_session(None, |s| {
            let ws = s.workspace().read().expect("workspace");
            ws.view_interests(&instance()).expect("native interests")
        })
        .expect("session");
    assert_eq!(native_interests, wasm_interests);
    let native_render = host.render_view(None, &instance()).expect("native render");
    assert!(matches!(&native_render.kind, UiKind::Stack { .. }));
    let native_json = serde_json::to_value(&native_render).expect("native render serializes");
    if wasm_json != native_json {
        let mut wasm_normalized = wasm_json.clone();
        let mut native_normalized = native_json.clone();
        normalize_host_now(&mut wasm_normalized);
        normalize_host_now(&mut native_normalized);
        assert_eq!(
            wasm_normalized, native_normalized,
            "wasm and native render trees differ"
        );
    }
    let native_replace = host
        .view_action(None, &instance(), action("replace"))
        .expect("native replace");
    let native_patch = host
        .view_action(None, &instance(), action("patch"))
        .expect("native patch");
    assert_eq!(native_replace, wasm_replace);
    assert_eq!(native_patch, wasm_patch);
    assert!(matches!(native_patch, ViewUpdate::Patch { ref key, .. } if key == "status"));
    unmount(&host);
    assert!(matches!(
        host.view_action(None, &instance(), action("replace")),
        Err(PluginError::UnknownView(_))
    ));
    assert!(host.close().is_empty(), "host closes cleanly");
}
