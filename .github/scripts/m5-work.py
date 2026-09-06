"""Branch-only M5 development patch, stage two. Removed before final PR."""
from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text or text.count(old) != 1:
        raise RuntimeError(f"Expected unique source in {path}: {old[:100]}")
    p.write_text(text.replace(old, new, 1))


borrow = "crates/fub-wasm-host/src/borrow.rs"
replace(borrow, "use fub_abi::traits::HostApi;", "use fub_abi::traits::{HostApi, ReadApi};")
replace(borrow, "type Guest = *mut (dyn HostApi + 'static);", '''#[derive(Clone, Copy)]
enum Guest {
    Mutable(*mut (dyn HostApi + 'static)),
    ReadOnly(*const (dyn ReadApi + 'static)),
}''')
replace(borrow, "Some(p) => Ok(unsafe { &mut *p }),", '''Some(Guest::Mutable(p)) => Ok(unsafe { &mut *p }),
            Some(Guest::ReadOnly(_)) => Err(PluginError::PermissionDenied(
                "il render di una view dispone soltanto di ReadApi".into(),
            )),''')
replace(borrow, "    /// Le capacità di questa chiamata.", '''    /// La metà leggibile del prestito, senza fabbricare un riferimento mutabile.
    pub(crate) fn read_guest(&mut self) -> Result<&dyn ReadApi, PluginError> {
        match self.guest {
            // SAFETY: entrambi i puntatori sono vivi soltanto nello scope del
            // prestito. Il riferimento condiviso termina prima che lo State
            // possa essere prestato nuovamente, anche in modalità mutabile.
            Some(Guest::Mutable(p)) => Ok(unsafe { &*p }),
            Some(Guest::ReadOnly(p)) => Ok(unsafe { &*p }),
            None => Err(PluginError::Internal(
                "host capabilities requested outside a contract call".into(),
            )),
        }
    }

    /// Le capacità di questa chiamata.''')
replace(borrow, "    let ptr: Guest = unsafe { std::mem::transmute(ptr) };", "    let ptr = Guest::Mutable(unsafe { std::mem::transmute::<*mut (dyn HostApi + '_), *mut (dyn HostApi + 'static)>(ptr) });")
replace(borrow, "/// Rimette a posto ciò che c'era prima, anche uscendo per un panico.", '''/// Presta la sola lettura per il render. Non converte mai `&T` in `&mut T`.
pub(crate) fn with_read_guest<R>(
    store: &mut Store<State>,
    host: &dyn ReadApi,
    f: impl FnOnce(&mut Store<State>) -> R,
) -> R {
    crate::limits::renew(store);
    let ptr: *const (dyn ReadApi + '_) = host;
    // SAFETY: come in with_guest, Return cancella il prestito prima che host
    // possa morire e la chiamata sincrona non sposta il puntatore fra thread.
    let ptr = Guest::ReadOnly(unsafe {
        std::mem::transmute::<*const (dyn ReadApi + '_), *const (dyn ReadApi + 'static)>(ptr)
    });
    let previous = store.data_mut().guest.replace(ptr);
    let guard = Return { store, previous };
    f(&mut *guard.store)
}

/// Rimette a posto ciò che c'era prima, anche uscendo per un panico.''')

p = Path("crates/fub-wasm-host/src/guest.rs")
text = p.read_text()
before, after = text.split("impl host_data_write::Host for State {", 1)
# All families before host-data-write are read-only; their shared access is
# available both during render and during mutable lifecycle/action calls.
start = before.index("impl host_env::Host for State")
before = before[:start] + before[start:].replace("self.guest()", "self.read_guest()").replace("guest!(self)", "read_guest!(self)")
macro = '''macro_rules! read_guest {
    ($self:expr) => {
        match $self.read_guest() {
            Ok(h) => h,
            Err(error) => return Err(tr::to_error(&error)),
        }
    };
}

'''
before = before.replace("impl host_env::Host for State", macro + "impl host_env::Host for State", 1)
p.write_text(before + "impl host_data_write::Host for State {" + after)

replace("crates/fub-wasm-host/Cargo.toml", "serde_json.workspace = true", "serde_json.workspace = true\nserde.workspace = true")
replace("crates/fub-wasm-host/src/lib.rs", "mod translate;", "mod translate;\nmod view;\nmod ui;")
replace("crates/fub-wasm-host/src/translate.rs", "fn from_span(", "pub(crate) fn from_span(")

# UI conversion is exhaustive at compile time, but uses the shared ABI arena
# to rebuild the native tree. These declarations generate ordinary Rust once;
# they are not a new runtime schema or a second public contract.
plain = {
    "Stack": "dir: axis(v.dir), gap: v.gap, children: refs(v.children)",
    "Heading": "level: v.level, content: tr::from_text(v.content)",
    "ListItem": "title: tr::from_text(v.title), subtitle: v.subtitle.map(tr::from_text), action: v.action.map(action).transpose()?, selected: v.selected",
    "Button": "label: tr::from_text(v.label), intent: intent(v.intent), action: action(v.action)?",
    "WebView": "url: v.url, height: v.height",
    "Section": "title: tr::from_text(v.title), collapsed: v.collapsed, children: refs(v.children)",
    "Table": "columns: v.columns.into_iter().map(|c| n::TableColumn { title: tr::from_text(c.title), align: align(c.align) }).collect(), rows: refs(v.rows)",
    "Row": "cells: refs(v.cells), action: v.action.map(action).transpose()?",
    "TreeItem": "label: tr::from_text(v.label), expanded: v.expanded, action: v.action.map(action).transpose()?, selected: v.selected, children: refs(v.children)",
    "Tabs": "active: v.active, tabs: refs(v.tabs)",
    "Tab": "label: tr::from_text(v.label), action: v.action.map(action).transpose()?, children: refs(v.children)",
    "Badge": "label: tr::from_text(v.label), intent: intent(v.intent)",
    "Progress": "value: v.value, label: v.label.map(tr::from_text)",
    "EmptyState": "title: tr::from_text(v.title), detail: v.detail.map(tr::from_text), action: v.action.map(action).transpose()?",
    "TextInput": "field: v.field, label: v.label.map(tr::from_text), value: v.value, placeholder: v.placeholder.map(tr::from_text), action: v.action.map(action).transpose()?",
    "TextArea": "field: v.field, label: v.label.map(tr::from_text), value: v.value, rows: v.rows, action: v.action.map(action).transpose()?",
    "Number": "field: v.field, label: v.label.map(tr::from_text), value: v.value, min: v.min, max: v.max, step: v.step, action: v.action.map(action).transpose()?",
    "Checkbox": "field: v.field, label: tr::from_text(v.label), value: v.value, action: v.action.map(action).transpose()?",
    "Select": "field: v.field, label: v.label.map(tr::from_text), value: v.value, options: v.options.into_iter().map(option).collect(), multiple: v.multiple, action: v.action.map(action).transpose()?",
    "Radio": "field: v.field, label: v.label.map(tr::from_text), value: v.value, options: v.options.into_iter().map(option).collect(), action: v.action.map(action).transpose()?",
    "Slider": "field: v.field, label: v.label.map(tr::from_text), value: v.value, min: v.min, max: v.max, step: v.step, action: v.action.map(action).transpose()?",
    "DatePicker": "field: v.field, label: v.label.map(tr::from_text), value: v.value, action: v.action.map(action).transpose()?",
    "Form": "children: refs(v.children), submit_label: tr::from_text(v.submit_label), submit: action(v.submit)?",
    "Custom": "ns: v.ns, payload: tr::from_json(&v.payload)?, fallback: refs(v.fallback)",
    "Failed": "message: tr::from_text(v.message), retry: v.retry.map(action).transpose()?",
}
ui = r'''//! UI non fidata: traduzione esaustiva, budget prima del rebuild e convalida.
//!
//! Il tetto della memoria WASM non è un tetto della memoria dell'host. Questi
//! budget limitano la ricostruzione dell'arena dopo il lifting canonico; non
//! costituiscono una sandbox di processo per allocazioni del runtime.
use fub_abi::{arena as a, ui as n, PluginError};
use crate::contract::fub::abi::ui as w;
use crate::translate as tr;

const MAX_NODES: usize = 4096;
const MAX_DEPTH: usize = 64;
const MAX_EXPANDED_NODES: usize = 16384;
const MAX_UI_BYTES: usize = 4 * 1024 * 1024;

pub(crate) fn from_tree(tree: w::UiTree) -> Result<n::UiNode, PluginError> {
    if tree.nodes.len() > MAX_NODES {
        return Err(bad("troppi nodi nell'arena UI"));
    }
    let tree = a::UiTree {
        root: a::UiRef(tree.root),
        nodes: tree.nodes.into_iter().map(node).collect::<Result<_, _>>()?,
    };
    preflight(&tree)?;
    let root = tree.rebuild().map_err(|error| bad(&error.to_string()))?;
    root.validate_untrusted()?;
    Ok(root)
}

fn bad(message: &str) -> PluginError {
    PluginError::BadArgs(message.to_string().into())
}

fn refs(values: Vec<u32>) -> Vec<a::UiRef> {
    values.into_iter().map(a::UiRef).collect()
}
fn axis(value: w::Axis) -> n::Axis {
    match value { w::Axis::Row => n::Axis::Row, w::Axis::Column => n::Axis::Column }
}
fn intent(value: w::Intent) -> n::Intent {
    match value { w::Intent::Neutral => n::Intent::Neutral, w::Intent::Primary => n::Intent::Primary, w::Intent::Danger => n::Intent::Danger }
}
fn align(value: w::Align) -> n::Align {
    match value { w::Align::Start => n::Align::Start, w::Align::Center => n::Align::Center, w::Align::End => n::Align::End }
}
fn action(value: w::ActionRef) -> Result<n::ActionRef, PluginError> {
    Ok(n::ActionRef { action: n::ActionId(value.action), payload: tr::from_json(&value.payload)? })
}
fn option(value: w::UiOption) -> n::UiOption {
    n::UiOption { value: value.value, label: tr::from_text(value.label) }
}

fn node(value: w::UiNode) -> Result<a::UiNode, PluginError> {
    use w::UiKind as W;
    use a::UiKind as A;
    let kind = match value.kind {
        W::Text(content) => A::Text { content: tr::from_text(content) },
        W::List(items) => A::List { items: refs(items) },
        W::Html(html) => A::Html { html },
        W::Tree(roots) => A::Tree { roots: refs(roots) },
        W::Icon(name) => A::Icon { name },
        W::Separator => A::Separator,
        W::KeyValue(entries) => A::KeyValue { entries: entries.into_iter().map(|e| n::KeyValueEntry { label: tr::from_text(e.label), value: tr::from_text(e.value) }).collect() },
        W::Pending(label) => A::Pending { label: label.map(tr::from_text) },
'''
for variant, fields in plain.items():
    ui += f"        W::{variant}(v) => A::{variant} {{ {fields} }},\n"
ui += r'''    };
    Ok(a::UiNode { key: value.key, kind })
}

fn children(kind: &a::UiKind) -> &[a::UiRef] {
    use a::UiKind as K;
    match kind {
        K::Stack { children, .. } | K::Section { children, .. }
        | K::TreeItem { children, .. } | K::Tab { children, .. }
        | K::Form { children, .. } => children,
        K::List { items } => items,
        K::Table { rows, .. } => rows,
        K::Row { cells, .. } => cells,
        K::Tree { roots } => roots,
        K::Tabs { tabs, .. } => tabs,
        K::Custom { fallback, .. } => fallback,
        K::Text { .. } | K::Heading { .. } | K::ListItem { .. } | K::Button { .. }
        | K::Html { .. } | K::WebView { .. } | K::Badge { .. } | K::Icon { .. }
        | K::Progress { .. } | K::Separator | K::EmptyState { .. } | K::KeyValue { .. }
        | K::TextInput { .. } | K::TextArea { .. } | K::Number { .. }
        | K::Checkbox { .. } | K::Select { .. } | K::Radio { .. } | K::Slider { .. }
        | K::DatePicker { .. } | K::Pending { .. } | K::Failed { .. } => &[],
    }
}

// Misura senza allocare una seconda copia del JSON. Lo stesso tetto viene poi
// addebitato a ogni visita, così un DAG compatto non si espande senza limite.
struct Size(usize);
impl std::io::Write for Size {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 = self.0.saturating_add(bytes.len());
        if self.0 > MAX_UI_BYTES {
            return Err(std::io::Error::other("budget UI superato"));
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}
fn preflight(tree: &a::UiTree) -> Result<(), PluginError> {
    let mut sizes = Vec::with_capacity(tree.nodes.len());
    let mut total = 0usize;
    for node in &tree.nodes {
        let mut size = Size(0);
        serde_json::to_writer(&mut size, node).map_err(|error| bad(&error.to_string()))?;
        total = total.saturating_add(size.0);
        if total > MAX_UI_BYTES { return Err(bad("budget dell'arena UI superato")); }
        sizes.push(size.0);
    }
    let mut pending = vec![(tree.root, 1usize)];
    let mut expanded = 0usize;
    let mut bytes = 0usize;
    while let Some((index, depth)) = pending.pop() {
        let at = index.0 as usize;
        let node = tree.nodes.get(at).ok_or_else(|| bad("indice UI fuori intervallo"))?;
        expanded += 1;
        bytes = bytes.saturating_add(sizes[at]);
        if depth > MAX_DEPTH || expanded > MAX_EXPANDED_NODES || bytes > MAX_UI_BYTES {
            return Err(bad("UI ciclica, troppo profonda o troppo espansa"));
        }
        let children = children(&node.kind);
        if pending.len().saturating_add(children.len()) > MAX_EXPANDED_NODES {
            return Err(bad("troppi riferimenti UI"));
        }
        pending.extend(children.iter().map(|child| (*child, depth + 1)));
    }
    Ok(())
}

pub(crate) fn to_action(value: n::UiAction) -> w::UiAction {
    w::UiAction {
        action: value.action.0,
        payload: tr::to_json(&value.payload),
        fields: value.fields.into_iter().map(|field| w::FieldValue {
            field: field.field,
            value: match field.value {
                n::UiValue::Text(v) => w::UiValue::Text(v),
                n::UiValue::Number(v) => w::UiValue::Number(v),
                n::UiValue::Bool(v) => w::UiValue::Bool(v),
                n::UiValue::Choices(v) => w::UiValue::Choices(v),
            },
        }).collect(),
    }
}

pub(crate) fn from_update(value: w::ViewUpdate) -> Result<n::ViewUpdate, PluginError> {
    Ok(match value {
        w::ViewUpdate::Replace(tree) => n::ViewUpdate::Replace { root: from_tree(tree)? },
        w::ViewUpdate::None => n::ViewUpdate::None,
        w::ViewUpdate::Navigate(doc_id) => n::ViewUpdate::Navigate { doc_id },
        w::ViewUpdate::Reveal(v) => n::ViewUpdate::Reveal { doc_id: v.doc_id, span: tr::from_span(v.span)? },
        w::ViewUpdate::RunSearch(query) => n::ViewUpdate::RunSearch { query },
        w::ViewUpdate::Custom(v) => n::ViewUpdate::Custom { ns: v.ns, payload: tr::from_json(&v.payload)? },
        w::ViewUpdate::Patch(v) => n::ViewUpdate::Patch { key: v.key, node: from_tree(v.node)? },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::fub::abi::text::Text;

    fn text() -> w::UiNode {
        w::UiNode { key: Some("testo".into()), kind: w::UiKind::Text(Text::Literal("ciao".into())) }
    }
    #[test]
    fn a_valid_tree_keeps_keys_and_text() {
        let root = from_tree(w::UiTree { nodes: vec![text()], root: 0 }).unwrap();
        assert_eq!(root.key.as_deref(), Some("testo"));
        assert!(matches!(root.kind, n::UiKind::Text { content } if content.as_literal() == Some("ciao")));
    }
    #[test]
    fn forbidden_nodes_are_rejected_inside_containers_and_updates() {
        for kind in [w::UiKind::Html("<script>bad()</script>".into()), w::UiKind::WebView(w::UiWebView { url: "https://example.com".into(), height: 10 })] {
            let tree = w::UiTree { nodes: vec![w::UiNode { key: None, kind }, w::UiNode { key: None, kind: w::UiKind::List(vec![0]) }], root: 1 };
            assert!(matches!(from_update(w::ViewUpdate::Replace(tree)), Err(PluginError::PermissionDenied(_))));
        }
    }
    #[test]
    fn cycles_bad_indices_and_deep_trees_fail_before_rebuild() {
        for tree in [
            w::UiTree { nodes: vec![text()], root: 9 },
            w::UiTree { nodes: vec![w::UiNode { key: None, kind: w::UiKind::List(vec![0]) }], root: 0 },
            w::UiTree { nodes: (0..100).map(|i| w::UiNode { key: None, kind: w::UiKind::List(if i == 0 { vec![] } else { vec![i-1] }) }).collect(), root: 99 },
        ] { assert!(matches!(from_tree(tree), Err(PluginError::BadArgs(_)))); }
    }
    #[test]
    fn compact_dags_cannot_expand_exponentially() {
        let nodes = (0..30).map(|i| w::UiNode { key: None, kind: w::UiKind::List(if i == 0 { vec![] } else { vec![i-1, i-1] }) }).collect();
        assert!(matches!(from_tree(w::UiTree { nodes, root: 29 }), Err(PluginError::BadArgs(_))));
    }
    #[test]
    fn invalid_json_does_not_become_a_null_payload() {
        let kind = w::UiKind::Custom(w::UiCustom { ns: "demo".into(), payload: "[".into(), fallback: vec![] });
        assert!(matches!(from_tree(w::UiTree { nodes: vec![w::UiNode { key: None, kind }], root: 0 }), Err(PluginError::BadArgs(_))));
    }
}
'''
Path("crates/fub-wasm-host/src/ui.rs").write_text(ui)

# View proxy lives in component.rs, beside Instance and the other proxies;
# this module contains only the translation of the view-specific records.
view = r'''//! Le dichiarazioni delle view, tradotte senza perdere interessi o parametri.
use fub_abi::{command as c, event as e, session as s, traits as n};
use crate::contract::{exports::fub::abi::view as w, fub::abi::{events as we, session as ws, command as wc}};
use crate::translate as tr;

pub(crate) fn to_instance(v: &n::ViewInstance) -> w::ViewInstance {
    w::ViewInstance { view: v.view.clone(), instance: v.instance.clone(), params: tr::to_json(&v.params) }
}
pub(crate) fn from_interests(v: w::ViewInterests) -> n::ViewInterests {
    n::ViewInterests { refresh: mask(v.refresh), follows: context(v.follows) }
}
fn context(v: ws::ContextMask) -> s::ContextMask {
    s::ContextMask(v.into_iter().map(|k| match k {
        ws::ContextKind::Document => s::ContextKind::Document,
        ws::ContextKind::Selection => s::ContextKind::Selection,
        ws::ContextKind::Mode => s::ContextKind::Mode,
    }).collect())
}
fn mask(v: we::EventMask) -> e::EventMask {
    e::EventMask {
        kinds: v.kinds.into_iter().map(|k| match k {
'''
for v in ["VaultOpened", "DocumentChanged", "DocumentRemoved", "DocumentRenamed", "IndexUpdated", "JobDone", "Overflow", "Custom", "BatchEnded", "ViewInvalidated", "VaultClosed", "JobStarted", "JobProgress", "SettingChanged", "EntryChanged", "EntryRemoved", "EntryRenamed", "Trouble", "TimerFired"]:
    view += f"            we::EventKind::{v} => e::EventKind::{v},\n"
view += r'''        }).collect(),
        topics: v.topics,
        subjects: v.subjects.into_iter().map(|v| match v {
            we::Subject::Document(id) => e::Subject::document(id),
            we::Subject::Folder(path) => e::Subject::folder(path),
        }).collect(),
        changes: v.changes.into_iter().map(|v| match v {
            we::DocChange::Body => e::DocChange::Body,
            we::DocChange::Frontmatter => e::DocChange::Frontmatter,
            we::DocChange::Tags => e::DocChange::Tags,
            we::DocChange::Links => e::DocChange::Links,
            we::DocChange::Outline => e::DocChange::Outline,
            we::DocChange::Anchors => e::DocChange::Anchors,
        }).collect(),
    }
}
fn param(v: wc::ParamSpec) -> c::ParamSpec {
    c::ParamSpec {
        name: v.name, title: tr::from_text(v.title), description: tr::from_text(v.description), required: v.required,
        kind: match v.kind {
            wc::ParamKind::Text => c::ParamKind::Text,
            wc::ParamKind::Number => c::ParamKind::Number,
            wc::ParamKind::Bool => c::ParamKind::Bool,
            wc::ParamKind::Document => c::ParamKind::Document,
            wc::ParamKind::Documents => c::ParamKind::Documents,
            wc::ParamKind::Numbers => c::ParamKind::Numbers,
            wc::ParamKind::Choice(choices) => c::ParamKind::Choice(choices.into_iter().map(|v| c::Choice { value: v.value, title: tr::from_text(v.title) }).collect()),
        },
    }
}
pub(crate) fn from_spec(v: w::ViewSpec) -> n::ViewSpec {
    n::ViewSpec {
        id: v.id, title: tr::from_text(v.title),
        surface: match v.surface {
'''
for v in ["LeftSidebar", "RightSidebar", "Bottom", "Main", "Modal", "StatusBar", "Ribbon", "Menu", "ContextMenu", "SettingsTab"]:
    view += f"            w::ViewSurface::{v} => n::ViewSurface::{v},\n"
view += r'''        },
        refresh: mask(v.refresh), follows: context(v.follows),
        params: v.params.into_iter().map(param).collect(), icon: v.icon, order: v.order,
        open_by_default: v.open_by_default, preferred_size: v.preferred_size, closable: v.closable,
    }
}
'''
Path("crates/fub-wasm-host/src/view.rs").write_text(view)

component = "crates/fub-wasm-host/src/component.rs"
p = Path(component)
text = p.read_text()
# Keep the original import layout; separate imports avoid assumptions about fmt.
text = text.replace("use std::sync::", "use fub_abi::traits::{ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec};\nuse fub_abi::ui::{UiAction, UiNode, ViewUpdate};\nuse crate::contract::exports::fub::abi::view as w_view;\nuse crate::borrow::with_read_guest;\nuse std::sync::", 1)
text = text.replace("    command_indices: Option<w_command::GuestIndices>,", "    command_indices: Option<w_command::GuestIndices>,\n    view_indices: Option<w_view::GuestIndices>,", 1)
text = text.replace("        let command_indices = w_command::GuestIndices::new(&pre).ok();", "        let command_indices = w_command::GuestIndices::new(&pre).ok();\n        let view_indices = w_view::GuestIndices::new(&pre).ok();", 1)
text = text.replace("            command_indices,", "            command_indices,\n            view_indices,", 1)
text = text.replace("        Ok(Instance {\n            store,\n            interfaces: Interfaces { plugin, commands },", "        let views = self.view_indices.as_ref().map(|indices| indices.load(&mut store, &instance)).transpose().map_err(|error| LoadError::Instantiation(format!(\"{error:#}\")))?;\n        Ok(Instance {\n            store,\n            interfaces: Interfaces { plugin, commands, views },", 1)
text = text.replace("    commands: Option<w_command::Guest>,", "    commands: Option<w_command::Guest>,\n    views: Option<w_view::Guest>,", 1)
text = text.replace("let provider = WasmCommandProvider { inner, specs };", "let provider = WasmCommandProvider { inner: Arc::clone(&inner), specs };", 1)
needle = "        warnings\n    }\n}\n\n/// Il plugin che non è mai nato"
if needle not in text:
    raise RuntimeError("bundle register end not found")
text = text.replace(needle, '''        let views = (|| -> Result<Vec<ViewSpec>, String> {
            let mut inst = inner.lock().map_err(|_| "component instance is poisoned".to_string())?;
            let Instance { store, interfaces } = &mut *inst;
            let Some(views) = interfaces.views.as_ref() else { return Ok(Vec::new()); };
            crate::limits::renew(&mut *store);
            let specs = views.call_views(&mut *store).map_err(|error| format!("view non dichiarate: {error:#}"))?;
            Ok(specs.into_iter().map(crate::view::from_spec).collect())
        })();
        match views {
            Ok(specs) if !specs.is_empty() => {
                let provider = WasmViewProvider { inner, specs };
                if let Err(error) = ws.register_view_provider(&self.manifest.id, Box::new(provider)) {
                    warnings.push(format!("view non registrate: {error}"));
                }
            }
            Ok(_) => {}
            Err(error) => warnings.push(error),
        }
        warnings
    }
}

/// Il plugin che non è mai nato''', 1)
text += r'''

/// Una view dello stesso componente che possiede lifecycle e comandi.
pub struct WasmViewProvider {
    inner: Arc<Mutex<Instance>>,
    specs: Vec<ViewSpec>,
}

impl ViewProvider for WasmViewProvider {
    fn views(&self) -> Vec<ViewSpec> { self.specs.clone() }

    fn interests(&self, instance: &ViewInstance) -> ViewInterests {
        // Il trait è infallibile: conserviamo gli interessi dichiarati se la
        // chiamata cade. Il render successivo restituisce l'errore tipizzato.
        let fallback = self.specs.iter().find(|spec| spec.id == instance.view)
            .map(|spec| ViewInterests { refresh: spec.refresh.clone(), follows: spec.follows.clone() })
            .unwrap_or_default();
        let Ok(mut inst) = self.inner.lock() else { return fallback; };
        let Instance { store, interfaces } = &mut *inst;
        let Some(views) = interfaces.views.as_ref() else { return fallback; };
        crate::limits::renew(&mut *store);
        views.call_interests(&mut *store, &crate::view::to_instance(instance))
            .map(crate::view::from_interests).unwrap_or(fallback)
    }

    fn render_view(&self, instance: &ViewInstance, host: &dyn ReadApi) -> Result<UiNode, PluginError> {
        let mut inst = self.inner.lock().map_err(|_| PluginError::Internal("component instance is poisoned".into()))?;
        let Instance { store, interfaces } = &mut *inst;
        let views = interfaces.views.as_ref().ok_or_else(|| PluginError::UnknownView(instance.view.clone().into()))?;
        let tree = with_read_guest(store, host, |store| views.call_render_view(store, &crate::view::to_instance(instance)))
            .map_err(failure)?.map_err(tr::from_error)?;
        crate::ui::from_tree(tree)
    }

    fn on_action(&mut self, instance: &ViewInstance, action: UiAction, host: &mut dyn HostApi) -> Result<ViewUpdate, PluginError> {
        call(&self.inner, host, |store, interfaces| {
            let views = interfaces.views.as_ref().ok_or_else(|| PluginError::UnknownView(instance.view.clone().into()))?;
            let update = views.call_on_action(store, &crate::view::to_instance(instance), &crate::ui::to_action(action))
                .map_err(failure)?.map_err(tr::from_error)?;
            crate::ui::from_update(update)
        })
    }
}
'''
p.write_text(text)
replace("crates/fub-wasm-host/src/lib.rs", "WasmPlugin", "WasmPlugin") if False else None
p = Path("crates/fub-wasm-host/src/lib.rs")
p.write_text(p.read_text().replace("pub use directory::", "pub use component::WasmViewProvider;\npub use directory::", 1))
