//! UI non fidata: traduzione esaustiva, budget prima del rebuild e convalida.
//!
//! Il tetto della memoria WASM non è un tetto della memoria dell'host. Questi
//! budget limitano la ricostruzione dell'arena dopo il lifting canonico; non
//! costituiscono una sandbox di processo per allocazioni del runtime.
use crate::contract::fub::abi::ui as w;
use crate::translate as tr;
use fub_abi::{arena as a, ui as n, PluginError};

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
    match value {
        w::Axis::Row => n::Axis::Row,
        w::Axis::Column => n::Axis::Column,
    }
}
fn intent(value: w::Intent) -> n::Intent {
    match value {
        w::Intent::Neutral => n::Intent::Neutral,
        w::Intent::Primary => n::Intent::Primary,
        w::Intent::Danger => n::Intent::Danger,
    }
}
fn align(value: w::Align) -> n::Align {
    match value {
        w::Align::Start => n::Align::Start,
        w::Align::Center => n::Align::Center,
        w::Align::End => n::Align::End,
    }
}
fn action(value: w::ActionRef) -> Result<n::ActionRef, PluginError> {
    Ok(n::ActionRef {
        action: n::ActionId(value.action),
        payload: tr::from_json(&value.payload)?,
    })
}
fn option(value: w::UiOption) -> n::UiOption {
    n::UiOption {
        value: value.value,
        label: tr::from_text(value.label),
    }
}

fn node(value: w::UiNode) -> Result<a::UiNode, PluginError> {
    use a::UiKind as A;
    use w::UiKind as W;
    let kind = match value.kind {
        W::Text(content) => A::Text {
            content: tr::from_text(content),
        },
        W::List(items) => A::List { items: refs(items) },
        W::Html(html) => A::Html { html },
        W::Tree(roots) => A::Tree { roots: refs(roots) },
        W::Icon(name) => A::Icon { name },
        W::Separator => A::Separator,
        W::KeyValue(entries) => A::KeyValue {
            entries: entries
                .into_iter()
                .map(|e| n::KeyValueEntry {
                    label: tr::from_text(e.label),
                    value: tr::from_text(e.value),
                })
                .collect(),
        },
        W::Pending(label) => A::Pending {
            label: label.map(tr::from_text),
        },
        W::Stack(v) => A::Stack {
            dir: axis(v.dir),
            gap: v.gap,
            children: refs(v.children),
        },
        W::Heading(v) => A::Heading {
            level: v.level,
            content: tr::from_text(v.content),
        },
        W::ListItem(v) => A::ListItem {
            title: tr::from_text(v.title),
            subtitle: v.subtitle.map(tr::from_text),
            action: v.action.map(action).transpose()?,
            selected: v.selected,
        },
        W::Button(v) => A::Button {
            label: tr::from_text(v.label),
            intent: intent(v.intent),
            action: action(v.action)?,
        },
        W::WebView(v) => A::WebView {
            url: v.url,
            height: v.height,
        },
        W::Section(v) => A::Section {
            title: tr::from_text(v.title),
            collapsed: v.collapsed,
            children: refs(v.children),
        },
        W::Table(v) => A::Table {
            columns: v
                .columns
                .into_iter()
                .map(|c| n::TableColumn {
                    title: tr::from_text(c.title),
                    align: align(c.align),
                })
                .collect(),
            rows: refs(v.rows),
        },
        W::Row(v) => A::Row {
            cells: refs(v.cells),
            action: v.action.map(action).transpose()?,
        },
        W::TreeItem(v) => A::TreeItem {
            label: tr::from_text(v.label),
            expanded: v.expanded,
            action: v.action.map(action).transpose()?,
            selected: v.selected,
            children: refs(v.children),
        },
        W::Tabs(v) => A::Tabs {
            active: v.active,
            tabs: refs(v.tabs),
        },
        W::Tab(v) => A::Tab {
            label: tr::from_text(v.label),
            action: v.action.map(action).transpose()?,
            children: refs(v.children),
        },
        W::Badge(v) => A::Badge {
            label: tr::from_text(v.label),
            intent: intent(v.intent),
        },
        W::Progress(v) => A::Progress {
            value: v.value,
            label: v.label.map(tr::from_text),
        },
        W::EmptyState(v) => A::EmptyState {
            title: tr::from_text(v.title),
            detail: v.detail.map(tr::from_text),
            action: v.action.map(action).transpose()?,
        },
        W::TextInput(v) => A::TextInput {
            field: v.field,
            label: v.label.map(tr::from_text),
            value: v.value,
            placeholder: v.placeholder.map(tr::from_text),
            action: v.action.map(action).transpose()?,
        },
        W::TextArea(v) => A::TextArea {
            field: v.field,
            label: v.label.map(tr::from_text),
            value: v.value,
            rows: v.rows,
            action: v.action.map(action).transpose()?,
        },
        W::Number(v) => A::Number {
            field: v.field,
            label: v.label.map(tr::from_text),
            value: v.value,
            min: v.min,
            max: v.max,
            step: v.step,
            action: v.action.map(action).transpose()?,
        },
        W::Checkbox(v) => A::Checkbox {
            field: v.field,
            label: tr::from_text(v.label),
            value: v.value,
            action: v.action.map(action).transpose()?,
        },
        W::Select(v) => A::Select {
            field: v.field,
            label: v.label.map(tr::from_text),
            value: v.value,
            options: v.options.into_iter().map(option).collect(),
            multiple: v.multiple,
            action: v.action.map(action).transpose()?,
        },
        W::Radio(v) => A::Radio {
            field: v.field,
            label: v.label.map(tr::from_text),
            value: v.value,
            options: v.options.into_iter().map(option).collect(),
            action: v.action.map(action).transpose()?,
        },
        W::Slider(v) => A::Slider {
            field: v.field,
            label: v.label.map(tr::from_text),
            value: v.value,
            min: v.min,
            max: v.max,
            step: v.step,
            action: v.action.map(action).transpose()?,
        },
        W::DatePicker(v) => A::DatePicker {
            field: v.field,
            label: v.label.map(tr::from_text),
            value: v.value,
            action: v.action.map(action).transpose()?,
        },
        W::Form(v) => A::Form {
            children: refs(v.children),
            submit_label: tr::from_text(v.submit_label),
            submit: action(v.submit)?,
        },
        W::Custom(v) => A::Custom {
            ns: v.ns,
            payload: tr::from_json(&v.payload)?,
            fallback: refs(v.fallback),
        },
        W::Failed(v) => A::Failed {
            message: tr::from_text(v.message),
            retry: v.retry.map(action).transpose()?,
        },
    };
    Ok(a::UiNode {
        key: value.key,
        kind,
    })
}

fn children(kind: &a::UiKind) -> &[a::UiRef] {
    use a::UiKind as K;
    match kind {
        K::Stack { children, .. }
        | K::Section { children, .. }
        | K::TreeItem { children, .. }
        | K::Tab { children, .. }
        | K::Form { children, .. } => children,
        K::List { items } => items,
        K::Table { rows, .. } => rows,
        K::Row { cells, .. } => cells,
        K::Tree { roots } => roots,
        K::Tabs { tabs, .. } => tabs,
        K::Custom { fallback, .. } => fallback,
        K::Text { .. }
        | K::Heading { .. }
        | K::ListItem { .. }
        | K::Button { .. }
        | K::Html { .. }
        | K::WebView { .. }
        | K::Badge { .. }
        | K::Icon { .. }
        | K::Progress { .. }
        | K::Separator
        | K::EmptyState { .. }
        | K::KeyValue { .. }
        | K::TextInput { .. }
        | K::TextArea { .. }
        | K::Number { .. }
        | K::Checkbox { .. }
        | K::Select { .. }
        | K::Radio { .. }
        | K::Slider { .. }
        | K::DatePicker { .. }
        | K::Pending { .. }
        | K::Failed { .. } => &[],
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
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn preflight(tree: &a::UiTree) -> Result<(), PluginError> {
    let mut sizes = Vec::with_capacity(tree.nodes.len());
    let mut total = 0usize;
    for node in &tree.nodes {
        let mut size = Size(0);
        serde_json::to_writer(&mut size, node).map_err(|error| bad(&error.to_string()))?;
        total = total.saturating_add(size.0);
        if total > MAX_UI_BYTES {
            return Err(bad("budget dell'arena UI superato"));
        }
        sizes.push(size.0);
    }
    let mut pending = vec![(tree.root, 1usize)];
    let mut expanded = 0usize;
    let mut bytes = 0usize;
    while let Some((index, depth)) = pending.pop() {
        let at = index.0 as usize;
        let node = tree
            .nodes
            .get(at)
            .ok_or_else(|| bad("indice UI fuori intervallo"))?;
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
        fields: value
            .fields
            .into_iter()
            .map(|field| w::FieldValue {
                field: field.field,
                value: match field.value {
                    n::UiValue::Text(v) => w::UiValue::Text(v),
                    n::UiValue::Number(v) => w::UiValue::Number(v),
                    n::UiValue::Bool(v) => w::UiValue::Bool(v),
                    n::UiValue::Choices(v) => w::UiValue::Choices(v),
                },
            })
            .collect(),
    }
}

pub(crate) fn from_update(value: w::ViewUpdate) -> Result<n::ViewUpdate, PluginError> {
    Ok(match value {
        w::ViewUpdate::Replace(tree) => n::ViewUpdate::Replace {
            root: from_tree(tree)?,
        },
        w::ViewUpdate::None => n::ViewUpdate::None,
        w::ViewUpdate::Navigate(doc_id) => n::ViewUpdate::Navigate { doc_id },
        w::ViewUpdate::Reveal(v) => n::ViewUpdate::Reveal {
            doc_id: v.doc_id,
            span: tr::from_span(v.span)?,
        },
        w::ViewUpdate::RunSearch(query) => n::ViewUpdate::RunSearch { query },
        w::ViewUpdate::Custom(v) => n::ViewUpdate::Custom {
            ns: v.ns,
            payload: tr::from_json(&v.payload)?,
        },
        w::ViewUpdate::Patch(v) => n::ViewUpdate::Patch {
            key: v.key,
            node: from_tree(v.node)?,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::fub::abi::text::Text;

    fn text() -> w::UiNode {
        w::UiNode {
            key: Some("testo".into()),
            kind: w::UiKind::Text(Text::Literal("ciao".into())),
        }
    }
    #[test]
    fn a_valid_tree_keeps_keys_and_text() {
        let root = from_tree(w::UiTree {
            nodes: vec![text()],
            root: 0,
        })
        .unwrap();
        assert_eq!(root.key.as_deref(), Some("testo"));
        assert!(
            matches!(root.kind, n::UiKind::Text { content } if content.as_literal() == Some("ciao"))
        );
    }
    #[test]
    fn forbidden_nodes_are_rejected_inside_containers_and_updates() {
        for kind in [
            w::UiKind::Html("<script>bad()</script>".into()),
            w::UiKind::WebView(w::UiWebView {
                url: "https://example.com".into(),
                height: 10,
            }),
        ] {
            let tree = w::UiTree {
                nodes: vec![
                    w::UiNode { key: None, kind },
                    w::UiNode {
                        key: None,
                        kind: w::UiKind::List(vec![0]),
                    },
                ],
                root: 1,
            };
            assert!(matches!(
                from_update(w::ViewUpdate::Replace(tree)),
                Err(PluginError::PermissionDenied(_))
            ));
        }
    }
    #[test]
    fn cycles_bad_indices_and_deep_trees_fail_before_rebuild() {
        for tree in [
            w::UiTree {
                nodes: vec![text()],
                root: 9,
            },
            w::UiTree {
                nodes: vec![w::UiNode {
                    key: None,
                    kind: w::UiKind::List(vec![0]),
                }],
                root: 0,
            },
            w::UiTree {
                nodes: (0..100)
                    .map(|i| w::UiNode {
                        key: None,
                        kind: w::UiKind::List(if i == 0 { vec![] } else { vec![i - 1] }),
                    })
                    .collect(),
                root: 99,
            },
        ] {
            assert!(matches!(from_tree(tree), Err(PluginError::BadArgs(_))));
        }
    }
    #[test]
    fn compact_dags_cannot_expand_exponentially() {
        let nodes = (0..30)
            .map(|i| w::UiNode {
                key: None,
                kind: w::UiKind::List(if i == 0 { vec![] } else { vec![i - 1, i - 1] }),
            })
            .collect();
        assert!(matches!(
            from_tree(w::UiTree { nodes, root: 29 }),
            Err(PluginError::BadArgs(_))
        ));
    }
    #[test]
    fn invalid_json_does_not_become_a_null_payload() {
        let kind = w::UiKind::Custom(w::UiCustom {
            ns: "demo".into(),
            payload: "[".into(),
            fallback: vec![],
        });
        assert!(matches!(
            from_tree(w::UiTree {
                nodes: vec![w::UiNode { key: None, kind }],
                root: 0
            }),
            Err(PluginError::BadArgs(_))
        ));
    }
}
