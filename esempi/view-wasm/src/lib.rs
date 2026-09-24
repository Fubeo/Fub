//! A real declarative view component: the WIT is its only ABI.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:view/view",
    generate_all,
});

use exports::fub::abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatError, FormatErrorUnsupported,
    Guest as FormatGuest, ParseContext, RenderOptions, RenderTarget, SourceKind,
};
use exports::fub::abi::plugin::{Guest as PluginGuest, PluginManifest, PluginPermissions};
use exports::fub::abi::view::{
    Guest as ViewGuest, ViewInstance, ViewInterests, ViewSpec, ViewSurface,
};
use fub::abi::errors::PluginError;
use fub::abi::model::{Block, BlockParagraph, DocumentModel, DocumentTree, Inline, Span};
use fub::abi::options::OptionEntry;
use fub::abi::text::Text;
use fub::abi::ui::{ActionRef, Axis, FieldValue, UiKind, UiNode, UiTree, UiValue, ViewUpdate};

const PLUGIN_ID: &str = "example.view";
const VIEW_ID: &str = "example.view:panel";
const STATUS_ID: &str = "example.view:status";
const TOOLBAR_ID: &str = "example.view:toolbar";
static mut ACTIVATED: bool = false;

fn literal(value: impl Into<String>) -> Text {
    Text::Literal(value.into())
}

fn node(key: &str, kind: UiKind) -> UiNode {
    UiNode {
        key: Some(key.to_string()),
        kind,
    }
}

fn tree(nodes: Vec<UiNode>) -> UiTree {
    UiTree { root: 0, nodes }
}

fn action(id: &str, payload: &str) -> ActionRef {
    ActionRef {
        action: id.to_string(),
        payload: payload.to_string(),
    }
}

fn labelled_action(id: &str, payload: &str, label: &str) -> UiNode {
    node(
        id,
        UiKind::Button(fub::abi::ui::UiButton {
            label: literal(label),
            intent: fub::abi::ui::Intent::Neutral,
            action: action(id, payload),
        }),
    )
}

struct Component;

impl PluginGuest for Component {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: PLUGIN_ID.to_string(),
            name: "Example Declarative View".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.2.0".to_string(),
            permissions: PluginPermissions {
                granted: vec![OptionEntry {
                    key: "fub:read-vault".to_string(),
                    value: "true".to_string(),
                }],
            },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "en".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        unsafe {
            ACTIVATED = true;
        }
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        unsafe {
            ACTIVATED = false;
        }
        Ok(())
    }

    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Err(PluginError::UnknownJob(literal(format!(
            "view fixture has no job: {job}"
        ))))
    }
}

impl ViewGuest for Component {
    fn views() -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: VIEW_ID.to_string(),
            title: literal("Example View"),
            surface: ViewSurface::RightSidebar,
            refresh: fub::abi::events::EventMask {
                kinds: vec![
                    fub::abi::events::EventKind::DocumentChanged,
                    fub::abi::events::EventKind::ViewInvalidated,
                ],
                topics: vec!["example.view".to_string()],
                subjects: vec![],
                changes: vec![],
            },
            follows: vec![
                fub::abi::session::ContextKind::Document,
                fub::abi::session::ContextKind::Selection,
            ],
            params: vec![
                fub::abi::command::ParamSpec {
                    name: "mode".to_string(),
                    title: literal("Mode"),
                    description: literal("Display mode for the fixture"),
                    kind: fub::abi::command::ParamKind::Choice(vec![
                        fub::abi::command::Choice {
                            value: "summary".to_string(),
                            title: literal("Summary"),
                        },
                        fub::abi::command::Choice {
                            value: "detail".to_string(),
                            title: literal("Detail"),
                        },
                        fub::abi::command::Choice {
                            value: "trap-interests".to_string(),
                            title: literal("Trap interests"),
                        },
                        fub::abi::command::Choice {
                            value: "self-format".to_string(),
                            title: literal("Self format"),
                        },
                    ]),
                    required: true,
                },
                fub::abi::command::ParamSpec {
                    name: "density".to_string(),
                    title: literal("Density"),
                    description: literal("Numeric density hint"),
                    kind: fub::abi::command::ParamKind::Number,
                    required: false,
                },
            ],
            icon: Some("layout-dashboard".to_string()),
            order: 17,
            open_by_default: true,
            preferred_size: Some(360),
            closable: true,
        },
        ViewSpec {
            id: STATUS_ID.to_string(),
            title: literal("Document status"),
            surface: ViewSurface::StatusBar,
            refresh: fub::abi::events::EventMask {
                kinds: vec![fub::abi::events::EventKind::DocumentChanged],
                topics: vec![],
                subjects: vec![],
                changes: vec![],
            },
            follows: vec![fub::abi::session::ContextKind::Document],
            params: vec![],
            icon: None,
            order: 10,
            open_by_default: true,
            preferred_size: None,
            closable: false,
        },
        ViewSpec {
            id: TOOLBAR_ID.to_string(),
            title: literal("Document toolbar"),
            surface: ViewSurface::Ribbon,
            refresh: fub::abi::events::EventMask {
                kinds: vec![],
                topics: vec![],
                subjects: vec![],
                changes: vec![],
            },
            follows: vec![fub::abi::session::ContextKind::Document],
            params: vec![],
            icon: None,
            order: 11,
            open_by_default: true,
            preferred_size: None,
            closable: false,
        }]
    }

    fn interests(instance: ViewInstance) -> ViewInterests {
        if instance.params == r#"{"mode":"trap-interests"}"# {
            panic!("deterministic interests trap");
        }
        ViewInterests {
            refresh: fub::abi::events::EventMask {
                kinds: vec![fub::abi::events::EventKind::DocumentChanged],
                topics: vec!["example.view".to_string()],
                subjects: vec![],
                changes: vec![],
            },
            follows: vec![fub::abi::session::ContextKind::Document],
        }
    }

    fn render_view(instance: ViewInstance) -> Result<UiTree, PluginError> {
        if instance.view == STATUS_ID {
            let doc = fub::abi::host_env::active_context()
                .and_then(|context| context.doc)
                .unwrap_or_else(|| "No document".to_string());
            return Ok(tree(vec![node(
                "statusbar-text",
                UiKind::Text(literal(format!("Document: {doc}"))),
            )]));
        }
        if instance.view == TOOLBAR_ID {
            return Ok(tree(vec![labelled_action(
                "toolbar-refresh",
                "{}",
                "Refresh document status",
            )]));
        }
        let active = unsafe { ACTIVATED };
        let now = fub::abi::host_env::now_unix_millis();
        let context = fub::abi::host_env::active_context();
        let doc = context
            .and_then(|c| c.doc)
            .unwrap_or_else(|| "<none>".to_string());
        let status = format!(
            "activated={active}; view={}; instance={}; mode={}; host-now={now}; doc={doc}",
            instance.view, instance.instance, instance.params
        );
        if instance.view != VIEW_ID {
            return Err(PluginError::UnknownView(literal(format!(
                "unknown view instance: {}",
                instance.view
            ))));
        }
        if instance.params == r#"{"mode":"self-format"}"# {
            fub::abi::host_vault_read::read_model("Self.viewfmt")?;
        }
        #[cfg(feature = "active-content")]
        let root_children = vec![1, 2, 3, 4, 5, 8];
        #[cfg(not(feature = "active-content"))]
        let root_children = vec![1, 2, 3, 4, 5];
        #[allow(unused_mut)]
        let mut nodes = vec![
            node(
                "root",
                UiKind::Stack(fub::abi::ui::UiStack {
                    dir: Axis::Column,
                    gap: 10,
                    children: root_children,
                }),
            ),
            node(
                "title",
                UiKind::Heading(fub::abi::ui::UiHeading {
                    level: 2,
                    content: literal("Example View"),
                }),
            ),
            node("status", UiKind::Text(literal(status))),
            labelled_action("replace", "{\"route\":\"replace\"}", "Replace tree"),
            labelled_action(
                "patch",
                "{\"route\":\"patch\",\"key\":\"status\"}",
                "Patch status",
            ),
            node("nested", UiKind::Tree(vec![6])),
            fub::abi::ui::UiNode {
                key: None,
                kind: UiKind::TreeItem(fub::abi::ui::UiTreeItem {
                    label: literal("nested"),
                    expanded: true,
                    action: None,
                    selected: false,
                    children: vec![7],
                }),
            },
            fub::abi::ui::UiNode {
                key: None,
                kind: UiKind::TreeItem(fub::abi::ui::UiTreeItem {
                    label: literal("leaf"),
                    expanded: false,
                    action: None,
                    selected: false,
                    children: vec![],
                }),
            },
        ];
        #[cfg(feature = "active-content")]
        nodes.push(node(
            "web",
            UiKind::WebView(fub::abi::ui::UiWebView {
                url: "https://example.invalid/view".to_string(),
                height: 120,
            }),
        ));
        #[cfg(feature = "malformed-arena")]
        return Ok(UiTree { root: 999, nodes });
        Ok(tree(nodes))
    }

    fn on_action(
        instance: ViewInstance,
        input: fub::abi::ui::UiAction,
    ) -> Result<ViewUpdate, PluginError> {
        let fields = input
            .fields
            .iter()
            .map(field_summary)
            .collect::<Vec<_>>()
            .join(",");
        let observed = format!(
            "action={};payload={};fields=[{}]",
            input.action, input.payload, fields
        );
        if instance.view == TOOLBAR_ID && input.action == "toolbar-refresh" {
            return Ok(ViewUpdate::Replace(tree(vec![node(
                "toolbar-message",
                UiKind::Text(literal("Status refreshed")),
            )])));
        }
        match input.action.as_str() {
            "replace" => Ok(ViewUpdate::Replace(tree(vec![
                node(
                    "replace-root",
                    UiKind::Stack(fub::abi::ui::UiStack {
                        dir: Axis::Column,
                        gap: 6,
                        children: vec![1],
                    }),
                ),
                node(
                    "replace-value",
                    UiKind::Text(literal(format!("REPLACE:{observed}"))),
                ),
            ]))),
            "patch" => Ok(ViewUpdate::Patch(fub::abi::ui::ViewUpdatePatch {
                key: "status".to_string(),
                node: tree(vec![node(
                    "patched",
                    UiKind::Text(literal(format!("PATCH:{observed}"))),
                )]),
            })),
            "html" => Ok(ViewUpdate::Replace(tree(vec![node(
                "html-route",
                UiKind::Html(format!("HTML_ROUTE:{observed}")),
            )]))),
            "web-view" => Ok(ViewUpdate::Replace(tree(vec![
                node(
                    "web-route-root",
                    UiKind::Stack(fub::abi::ui::UiStack {
                        dir: Axis::Column,
                        gap: 4,
                        children: vec![1, 2],
                    }),
                ),
                node(
                    "web-route-observed",
                    UiKind::Text(literal(format!("WEB_VIEW:{observed}"))),
                ),
                node(
                    "web-route",
                    UiKind::WebView(fub::abi::ui::UiWebView {
                        url: "https://example.invalid/action".to_string(),
                        height: 144,
                    }),
                ),
            ]))),
            "error" => Err(PluginError::BadArgs(literal(format!(
                "ERROR_ROUTE:{observed}"
            )))),
            "trap" => panic!("TRAP_ROUTE:{observed}"),
            _ => Err(PluginError::UnknownView(literal(format!(
                "UNKNOWN_ROUTE:{observed}"
            )))),
        }
    }
}

impl FormatGuest for Component {
    fn descriptor() -> FormatDescriptor {
        FormatDescriptor {
            id: "example.view-format".to_string(),
            name: "Example View Format".to_string(),
            extensions: vec!["viewfmt".to_string()],
            source: SourceKind::Text,
        }
    }

    fn capabilities() -> FormatCapabilities {
        FormatCapabilities { syntax: vec![] }
    }

    fn parse(source: DocumentSource, ctx: ParseContext) -> Result<DocumentModel, FormatError> {
        let text = match source {
            DocumentSource::Text(text) => text,
            DocumentSource::Bytes(_) => {
                return Err(FormatError::Unsupported(FormatErrorUnsupported {
                    format: "example.view-format".to_string(),
                    got: SourceKind::Bytes,
                }))
            }
        };
        let span = Span {
            start: 0,
            end: text.len() as u64,
        };
        Ok(DocumentModel {
            id: ctx.doc_id,
            frontmatter: "{}".to_string(),
            body: DocumentTree {
                blocks: vec![Block::Paragraph(BlockParagraph {
                    inlines: vec![0],
                    anchor: None,
                    span,
                })],
                inlines: vec![Inline::Text(text.clone())],
                roots: vec![0],
            },
            outline: vec![],
            links: vec![],
            tags: vec![],
            anchors: vec![],
            text,
            frontmatter_present: false,
        })
    }

    fn render_html(model: DocumentModel, opts: RenderOptions) -> Result<String, FormatError> {
        let target = match opts.target {
            RenderTarget::Screen => "screen",
            RenderTarget::Print => "print",
            RenderTarget::Pdf => "pdf",
            RenderTarget::StaticSite => "static-site",
        };
        Ok(format!(
            "<p data-format=\"example.view-format\" data-target=\"{target}\">{}</p>",
            fub_abi::html::escape(&model.text)
        ))
    }

    fn serialize(model: DocumentModel) -> Result<String, FormatError> {
        Ok(model.text)
    }
}

fn field_summary(field: &FieldValue) -> String {
    let value = match &field.value {
        UiValue::Text(value) => format!("text:{value}"),
        UiValue::Number(value) => format!("number:{value}"),
        UiValue::Bool(value) => format!("bool:{value}"),
        UiValue::Choices(values) => format!("choices:{values:?}"),
    };
    format!("{}={value}", field.field)
}

export!(Component);
