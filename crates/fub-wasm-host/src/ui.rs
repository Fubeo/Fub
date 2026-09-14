use std::convert::TryFrom;

use fub_abi::{arena, ui, PluginError};

use crate::contract::fub::abi::ui as w_ui;
use crate::translate as tr;

const MAX_DEPTH: u32 = 64;
const MAX_UNITS: u64 = 8 * 1024 * 1024;

fn bad(message: impl Into<String>) -> PluginError {
    PluginError::BadArgs(fub_abi::text::Text::Literal(message.into()))
}

fn axis(a: w_ui::Axis) -> ui::Axis {
    match a {
        w_ui::Axis::Row => ui::Axis::Row,
        w_ui::Axis::Column => ui::Axis::Column,
    }
}
fn intent(a: w_ui::Intent) -> ui::Intent {
    match a {
        w_ui::Intent::Neutral => ui::Intent::Neutral,
        w_ui::Intent::Primary => ui::Intent::Primary,
        w_ui::Intent::Danger => ui::Intent::Danger,
    }
}
fn align(a: w_ui::Align) -> ui::Align {
    match a {
        w_ui::Align::Start => ui::Align::Start,
        w_ui::Align::Center => ui::Align::Center,
        w_ui::Align::End => ui::Align::End,
    }
}
fn span(s: crate::contract::fub::abi::model::Span) -> Result<fub_abi::model::Span, PluginError> {
    Ok(fub_abi::model::Span {
        start: usize::try_from(s.start)
            .map_err(|_| bad(format!("span start {} does not fit usize", s.start)))?,
        end: usize::try_from(s.end)
            .map_err(|_| bad(format!("span end {} does not fit usize", s.end)))?,
    })
}

fn action(a: w_ui::ActionRef) -> Result<ui::ActionRef, PluginError> {
    Ok(ui::ActionRef {
        action: ui::ActionId(a.action),
        payload: tr::from_json(&a.payload)?,
    })
}
fn opt_action(a: Option<w_ui::ActionRef>) -> Result<Option<ui::ActionRef>, PluginError> {
    a.map(action).transpose()
}
fn option(o: w_ui::UiOption) -> Result<ui::UiOption, PluginError> {
    Ok(ui::UiOption {
        value: o.value,
        label: tr::from_text(o.label),
    })
}
fn column(c: w_ui::TableColumn) -> ui::TableColumn {
    ui::TableColumn {
        title: tr::from_text(c.title),
        align: align(c.align),
    }
}
fn kv(c: w_ui::KeyValueEntry) -> ui::KeyValueEntry {
    ui::KeyValueEntry {
        label: tr::from_text(c.label),
        value: tr::from_text(c.value),
    }
}

fn refs(kind: &w_ui::UiKind) -> &[u32] {
    match kind {
        w_ui::UiKind::Stack(x) => &x.children,
        w_ui::UiKind::List(x) | w_ui::UiKind::Tree(x) => x,
        w_ui::UiKind::Section(x) => &x.children,
        w_ui::UiKind::Table(x) => &x.rows,
        w_ui::UiKind::Row(x) => &x.cells,
        w_ui::UiKind::TreeItem(x) => &x.children,
        w_ui::UiKind::Tabs(x) => &x.tabs,
        w_ui::UiKind::Tab(x) => &x.children,
        w_ui::UiKind::Form(x) => &x.children,
        w_ui::UiKind::Custom(x) => &x.fallback,
        _ => &[],
    }
}
fn add_cost(total: &mut u64, value: u64) {
    *total = total.saturating_add(value);
}

fn text_cost(text: &crate::contract::fub::abi::text::Text) -> u64 {
    use crate::contract::fub::abi::text::{ArgValue, Text};
    let mut total = 0;
    match text {
        Text::Literal(s) => add_cost(&mut total, s.len() as u64),
        Text::Message(m) => {
            add_cost(&mut total, m.key.len() as u64);
            add_cost(&mut total, m.args.len() as u64);
            for a in &m.args {
                add_cost(&mut total, a.name.len() as u64);
                add_cost(
                    &mut total,
                    match &a.value {
                        ArgValue::Text(s) => s.len() as u64,
                        ArgValue::Int(_) | ArgValue::Float(_) | ArgValue::Timestamp(_) => 8,
                    },
                );
            }
        }
    }
    total
}

fn json_cost(json: &str) -> u64 {
    json.len() as u64
}

fn action_cost(action: &w_ui::ActionRef) -> u64 {
    (action.action.len() as u64).saturating_add(json_cost(&action.payload))
}

fn opt_action_cost(action: &Option<w_ui::ActionRef>) -> u64 {
    action
        .as_ref()
        .map_or(0, |action| action_cost(action).saturating_add(1))
}

fn opt_text_cost(text: &Option<crate::contract::fub::abi::text::Text>) -> u64 {
    text.as_ref()
        .map_or(0, |text| text_cost(text).saturating_add(1))
}

fn opt_string_cost(value: &Option<String>) -> u64 {
    value
        .as_ref()
        .map_or(0, |value| (value.len() as u64).saturating_add(1))
}

fn strings_cost(strings: &[String]) -> u64 {
    strings
        .iter()
        .fold(strings.len() as u64, |mut total, value| {
            add_cost(&mut total, value.len() as u64);
            total
        })
}

fn payload_cost(kind: &w_ui::UiKind) -> u64 {
    use w_ui::UiKind as W;
    let mut total = 0;
    match kind {
        W::Stack(x) => {
            add_cost(&mut total, 2);
            add_cost(&mut total, x.children.len() as u64);
        }
        W::Text(s) => add_cost(&mut total, text_cost(s)),
        W::Heading(x) => {
            add_cost(&mut total, 2);
            add_cost(&mut total, text_cost(&x.content));
        }
        W::List(x) => add_cost(&mut total, x.len() as u64),
        W::ListItem(x) => {
            add_cost(&mut total, 1);
            add_cost(&mut total, text_cost(&x.title));
            add_cost(&mut total, opt_text_cost(&x.subtitle));
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::Button(x) => {
            add_cost(&mut total, text_cost(&x.label));
            add_cost(&mut total, 1);
            add_cost(&mut total, action_cost(&x.action));
        }
        W::Html(s) | W::Icon(s) => add_cost(&mut total, s.len() as u64),
        W::WebView(x) => {
            add_cost(&mut total, x.url.len() as u64);
            add_cost(&mut total, 4);
        }
        W::Section(x) => {
            add_cost(&mut total, text_cost(&x.title));
            add_cost(&mut total, 2);
            add_cost(&mut total, x.children.len() as u64);
        }
        W::Table(x) => {
            add_cost(&mut total, x.columns.len() as u64);
            for column in &x.columns {
                add_cost(&mut total, text_cost(&column.title));
                add_cost(&mut total, 1);
            }
            add_cost(&mut total, x.rows.len() as u64);
        }
        W::Row(x) => {
            add_cost(&mut total, x.cells.len() as u64);
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::Tree(x) => add_cost(&mut total, x.len() as u64),
        W::TreeItem(x) => {
            add_cost(&mut total, text_cost(&x.label));
            add_cost(&mut total, 2);
            add_cost(&mut total, opt_action_cost(&x.action));
            add_cost(&mut total, x.children.len() as u64);
        }
        W::Tabs(x) => {
            add_cost(&mut total, 4);
            add_cost(&mut total, x.tabs.len() as u64);
        }
        W::Tab(x) => {
            add_cost(&mut total, text_cost(&x.label));
            add_cost(&mut total, opt_action_cost(&x.action));
            add_cost(&mut total, x.children.len() as u64);
        }
        W::Badge(x) => {
            add_cost(&mut total, text_cost(&x.label));
            add_cost(&mut total, 1);
        }
        W::Progress(x) => {
            add_cost(&mut total, 8);
            add_cost(&mut total, opt_text_cost(&x.label));
        }
        W::Separator => {}
        W::EmptyState(x) => {
            add_cost(&mut total, text_cost(&x.title));
            add_cost(&mut total, opt_text_cost(&x.detail));
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::KeyValue(x) => {
            add_cost(&mut total, x.len() as u64);
            for entry in x {
                add_cost(&mut total, text_cost(&entry.label));
                add_cost(&mut total, text_cost(&entry.value));
            }
        }
        W::TextInput(x) => {
            add_cost(&mut total, x.field.len() as u64);
            add_cost(&mut total, opt_text_cost(&x.label));
            add_cost(&mut total, x.value.len() as u64);
            add_cost(&mut total, opt_text_cost(&x.placeholder));
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::TextArea(x) => {
            add_cost(&mut total, x.field.len() as u64);
            add_cost(&mut total, opt_text_cost(&x.label));
            add_cost(&mut total, x.value.len() as u64);
            add_cost(&mut total, 4);
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::Number(x) => {
            add_cost(&mut total, x.field.len() as u64);
            add_cost(&mut total, opt_text_cost(&x.label));
            add_cost(&mut total, 36);
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::Checkbox(x) => {
            add_cost(&mut total, x.field.len() as u64);
            add_cost(&mut total, text_cost(&x.label));
            add_cost(&mut total, 1);
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::Select(x) => {
            add_cost(&mut total, x.field.len() as u64);
            add_cost(&mut total, opt_text_cost(&x.label));
            add_cost(&mut total, strings_cost(&x.value));
            add_cost(&mut total, x.options.len() as u64);
            for option in &x.options {
                add_cost(&mut total, option.value.len() as u64);
                add_cost(&mut total, text_cost(&option.label));
            }
            add_cost(&mut total, 1);
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::Radio(x) => {
            add_cost(&mut total, x.field.len() as u64);
            add_cost(&mut total, opt_text_cost(&x.label));
            add_cost(&mut total, opt_string_cost(&x.value));
            add_cost(&mut total, x.options.len() as u64);
            for option in &x.options {
                add_cost(&mut total, option.value.len() as u64);
                add_cost(&mut total, text_cost(&option.label));
            }
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::Slider(x) => {
            add_cost(&mut total, x.field.len() as u64);
            add_cost(&mut total, opt_text_cost(&x.label));
            add_cost(&mut total, 32);
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::DatePicker(x) => {
            add_cost(&mut total, x.field.len() as u64);
            add_cost(&mut total, opt_text_cost(&x.label));
            add_cost(&mut total, opt_string_cost(&x.value));
            add_cost(&mut total, opt_action_cost(&x.action));
        }
        W::Form(x) => {
            add_cost(&mut total, x.children.len() as u64);
            add_cost(&mut total, text_cost(&x.submit_label));
            add_cost(&mut total, action_cost(&x.submit));
        }
        W::Custom(x) => {
            add_cost(&mut total, x.ns.len() as u64);
            add_cost(&mut total, json_cost(&x.payload));
            add_cost(&mut total, x.fallback.len() as u64);
        }
        W::Pending(x) => add_cost(&mut total, opt_text_cost(x)),
        W::Failed(x) => {
            add_cost(&mut total, text_cost(&x.message));
            add_cost(&mut total, opt_action_cost(&x.retry));
        }
    }
    total
}

fn preflight(t: &w_ui::UiTree) -> Result<(), PluginError> {
    let node_count = t.nodes.len();
    if (node_count as u64) > MAX_UNITS {
        return Err(bad("ui arena exceeds wire budget"));
    }
    let root = usize::try_from(t.root).map_err(|_| bad("ui root does not fit usize"))?;
    if root >= node_count {
        return Err(bad(format!(
            "ui root {} out of range ({} nodes)",
            t.root, node_count
        )));
    }
    for (index, node) in t.nodes.iter().enumerate() {
        for &child in refs(&node.kind) {
            if usize::try_from(child)
                .ok()
                .filter(|&c| c < node_count)
                .is_none()
            {
                return Err(bad(format!(
                    "ui node {} references {} out of range",
                    index, child
                )));
            }
        }
    }
    let mut wire = 0u64;
    for node in &t.nodes {
        add_cost(&mut wire, 1);
        add_cost(&mut wire, node.key.as_ref().map_or(0, String::len) as u64);
        add_cost(&mut wire, payload_cost(&node.kind));
    }
    if wire > MAX_UNITS {
        return Err(bad("ui arena exceeds wire budget"));
    }
    let mut colour = vec![0u8; node_count];
    let mut height = vec![0u32; node_count];
    let mut costs = vec![0u64; node_count];
    let mut stack = Vec::new();
    for start in 0..node_count {
        if colour[start] == 0 {
            stack.push((start, false));
            while let Some((at, leaving)) = stack.pop() {
                if leaving {
                    let mut total = 1u64;
                    add_cost(
                        &mut total,
                        t.nodes[at].key.as_ref().map_or(0, String::len) as u64,
                    );
                    add_cost(&mut total, payload_cost(&t.nodes[at].kind));
                    let mut h = 1u32;
                    for &child in refs(&t.nodes[at].kind) {
                        let c = usize::try_from(child)
                            .map_err(|_| bad("ui reference does not fit usize"))?;
                        h = h.max(height[c].saturating_add(1));
                        total = total.saturating_add(costs[c]);
                    }
                    if h > MAX_DEPTH {
                        return Err(bad(format!("ui depth exceeds {}", MAX_DEPTH)));
                    }
                    height[at] = h;
                    costs[at] = total;
                    colour[at] = 2;
                } else {
                    if colour[at] == 1 {
                        return Err(bad(format!("ui node {} is cyclic", at)));
                    }
                    if colour[at] == 2 {
                        continue;
                    }
                    colour[at] = 1;
                    stack.push((at, true));
                    for &child in refs(&t.nodes[at].kind).iter().rev() {
                        let c = usize::try_from(child)
                            .map_err(|_| bad("ui reference does not fit usize"))?;
                        if colour[c] == 1 {
                            return Err(bad(format!("ui node {} is cyclic", c)));
                        }
                        if colour[c] == 0 {
                            stack.push((c, false));
                        }
                    }
                }
            }
        }
    }
    if costs[root] > MAX_UNITS {
        return Err(bad("ui tree exceeds materialization budget"));
    }
    Ok(())
}

fn node(n: w_ui::UiNode) -> Result<arena::UiNode, PluginError> {
    use w_ui::UiKind as W;
    let key = n.key;
    let kind = match n.kind {
        W::Stack(x) => arena::UiKind::Stack {
            dir: axis(x.dir),
            gap: x.gap,
            children: x.children.into_iter().map(arena::UiRef).collect(),
        },
        W::Text(x) => arena::UiKind::Text {
            content: tr::from_text(x),
        },
        W::Heading(x) => arena::UiKind::Heading {
            level: x.level,
            content: tr::from_text(x.content),
        },
        W::List(x) => arena::UiKind::List {
            items: x.into_iter().map(arena::UiRef).collect(),
        },
        W::ListItem(x) => arena::UiKind::ListItem {
            title: tr::from_text(x.title),
            subtitle: x.subtitle.map(tr::from_text),
            action: opt_action(x.action)?,
            selected: x.selected,
        },
        W::Button(x) => arena::UiKind::Button {
            label: tr::from_text(x.label),
            intent: intent(x.intent),
            action: action(x.action)?,
        },
        W::Html(x) => arena::UiKind::Html { html: x },
        W::WebView(x) => arena::UiKind::WebView {
            url: x.url,
            height: x.height,
        },
        W::Section(x) => arena::UiKind::Section {
            title: tr::from_text(x.title),
            collapsed: x.collapsed,
            children: x.children.into_iter().map(arena::UiRef).collect(),
        },
        W::Table(x) => arena::UiKind::Table {
            columns: x.columns.into_iter().map(column).collect(),
            rows: x.rows.into_iter().map(arena::UiRef).collect(),
        },
        W::Row(x) => arena::UiKind::Row {
            cells: x.cells.into_iter().map(arena::UiRef).collect(),
            action: opt_action(x.action)?,
        },
        W::Tree(x) => arena::UiKind::Tree {
            roots: x.into_iter().map(arena::UiRef).collect(),
        },
        W::TreeItem(x) => arena::UiKind::TreeItem {
            label: tr::from_text(x.label),
            expanded: x.expanded,
            action: opt_action(x.action)?,
            selected: x.selected,
            children: x.children.into_iter().map(arena::UiRef).collect(),
        },
        W::Tabs(x) => arena::UiKind::Tabs {
            active: x.active,
            tabs: x.tabs.into_iter().map(arena::UiRef).collect(),
        },
        W::Tab(x) => arena::UiKind::Tab {
            label: tr::from_text(x.label),
            action: opt_action(x.action)?,
            children: x.children.into_iter().map(arena::UiRef).collect(),
        },
        W::Badge(x) => arena::UiKind::Badge {
            label: tr::from_text(x.label),
            intent: intent(x.intent),
        },
        W::Icon(x) => arena::UiKind::Icon { name: x },
        W::Progress(x) => arena::UiKind::Progress {
            value: x.value,
            label: x.label.map(tr::from_text),
        },
        W::Separator => arena::UiKind::Separator,
        W::EmptyState(x) => arena::UiKind::EmptyState {
            title: tr::from_text(x.title),
            detail: x.detail.map(tr::from_text),
            action: opt_action(x.action)?,
        },
        W::KeyValue(x) => arena::UiKind::KeyValue {
            entries: x.into_iter().map(kv).collect(),
        },
        W::TextInput(x) => arena::UiKind::TextInput {
            field: x.field,
            label: x.label.map(tr::from_text),
            value: x.value,
            placeholder: x.placeholder.map(tr::from_text),
            action: opt_action(x.action)?,
        },
        W::TextArea(x) => arena::UiKind::TextArea {
            field: x.field,
            label: x.label.map(tr::from_text),
            value: x.value,
            rows: x.rows,
            action: opt_action(x.action)?,
        },
        W::Number(x) => arena::UiKind::Number {
            field: x.field,
            label: x.label.map(tr::from_text),
            value: x.value,
            min: x.min,
            max: x.max,
            step: x.step,
            action: opt_action(x.action)?,
        },
        W::Checkbox(x) => arena::UiKind::Checkbox {
            field: x.field,
            label: tr::from_text(x.label),
            value: x.value,
            action: opt_action(x.action)?,
        },
        W::Select(x) => arena::UiKind::Select {
            field: x.field,
            label: x.label.map(tr::from_text),
            value: x.value,
            options: x
                .options
                .into_iter()
                .map(option)
                .collect::<Result<_, _>>()?,
            multiple: x.multiple,
            action: opt_action(x.action)?,
        },
        W::Radio(x) => arena::UiKind::Radio {
            field: x.field,
            label: x.label.map(tr::from_text),
            value: x.value,
            options: x
                .options
                .into_iter()
                .map(option)
                .collect::<Result<_, _>>()?,
            action: opt_action(x.action)?,
        },
        W::Slider(x) => arena::UiKind::Slider {
            field: x.field,
            label: x.label.map(tr::from_text),
            value: x.value,
            min: x.min,
            max: x.max,
            step: x.step,
            action: opt_action(x.action)?,
        },
        W::DatePicker(x) => arena::UiKind::DatePicker {
            field: x.field,
            label: x.label.map(tr::from_text),
            value: x.value,
            action: opt_action(x.action)?,
        },
        W::Form(x) => arena::UiKind::Form {
            children: x.children.into_iter().map(arena::UiRef).collect(),
            submit_label: tr::from_text(x.submit_label),
            submit: action(x.submit)?,
        },
        W::Custom(x) => arena::UiKind::Custom {
            ns: x.ns,
            payload: tr::from_json(&x.payload)?,
            fallback: x.fallback.into_iter().map(arena::UiRef).collect(),
        },
        W::Pending(x) => arena::UiKind::Pending {
            label: x.map(tr::from_text),
        },
        W::Failed(x) => arena::UiKind::Failed {
            message: tr::from_text(x.message),
            retry: opt_action(x.retry)?,
        },
    };
    Ok(arena::UiNode { key, kind })
}

pub(crate) fn from_tree(t: w_ui::UiTree) -> Result<ui::UiNode, PluginError> {
    preflight(&t)?;
    let root = t.root;
    let tree = arena::UiTree {
        nodes: t.nodes.into_iter().map(node).collect::<Result<_, _>>()?,
        root: arena::UiRef(root),
    };
    tree.rebuild()
        .map_err(|e| bad(format!("invalid ui tree: {e}")))
}

pub(crate) fn from_update(u: w_ui::ViewUpdate) -> Result<ui::ViewUpdate, PluginError> {
    use w_ui::ViewUpdate as W;
    Ok(match u {
        W::Replace(t) => ui::ViewUpdate::Replace {
            root: from_tree(t)?,
        },
        W::None => ui::ViewUpdate::None,
        W::Navigate(x) => ui::ViewUpdate::Navigate { doc_id: x },
        W::Reveal(x) => ui::ViewUpdate::Reveal {
            doc_id: x.doc_id,
            span: span(x.span)?,
        },
        W::RunSearch(x) => ui::ViewUpdate::RunSearch { query: x },
        W::Custom(x) => ui::ViewUpdate::Custom {
            ns: x.ns,
            payload: tr::from_json(&x.payload)?,
        },
        W::Patch(x) => ui::ViewUpdate::Patch {
            key: x.key,
            node: from_tree(x.node)?,
        },
    })
}

pub(crate) fn to_action(a: &ui::UiAction) -> Result<w_ui::UiAction, PluginError> {
    Ok(w_ui::UiAction {
        action: a.action.0.clone(),
        payload: tr::to_json(&a.payload),
        fields: a
            .fields
            .iter()
            .map(|f| w_ui::FieldValue {
                field: f.field.clone(),
                value: match &f.value {
                    ui::UiValue::Text(x) => w_ui::UiValue::Text(x.clone()),
                    ui::UiValue::Number(x) => w_ui::UiValue::Number(*x),
                    ui::UiValue::Bool(x) => w_ui::UiValue::Bool(*x),
                    ui::UiValue::Choices(x) => w_ui::UiValue::Choices(x.clone()),
                },
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(value: &str) -> w_ui::UiNode {
        w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Text(crate::contract::fub::abi::text::Text::Literal(
                value.to_owned(),
            )),
        }
    }

    #[test]
    fn action_roundtrip() {
        let a = ui::UiAction::new("go").with_payload(serde_json::json!({"x": 1}));
        let w = to_action(&a).unwrap();
        assert_eq!(w.action, "go");
        assert_eq!(tr::from_json(&w.payload).unwrap(), a.payload);
    }

    #[test]
    fn valid_node() {
        let got = from_tree(w_ui::UiTree {
            nodes: vec![text("ok")],
            root: 0,
        })
        .unwrap();
        assert_eq!(
            got.kind,
            ui::UiKind::Text {
                content: fub_abi::text::Text::Literal("ok".into())
            }
        );
    }

    #[test]
    fn rejects_range_cycle_depth_and_budget() {
        let bad_ref = w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Stack(w_ui::UiStack {
                dir: w_ui::Axis::Column,
                gap: 0,
                children: vec![9],
            }),
        };
        assert!(from_tree(w_ui::UiTree {
            nodes: vec![bad_ref],
            root: 0
        })
        .is_err());
        let cycle = w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Stack(w_ui::UiStack {
                dir: w_ui::Axis::Column,
                gap: 0,
                children: vec![0],
            }),
        };
        assert!(from_tree(w_ui::UiTree {
            nodes: vec![cycle],
            root: 0
        })
        .is_err());
        let mut nodes = vec![text("leaf")];
        for i in 0..65 {
            nodes.push(w_ui::UiNode {
                key: None,
                kind: w_ui::UiKind::Stack(w_ui::UiStack {
                    dir: w_ui::Axis::Column,
                    gap: 0,
                    children: vec![i],
                }),
            });
        }
        assert!(from_tree(w_ui::UiTree { nodes, root: 65 }).is_err());
        let huge = w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Html("x".repeat((MAX_UNITS + 1) as usize)),
        };
        assert!(from_tree(w_ui::UiTree {
            nodes: vec![huge],
            root: 0
        })
        .is_err());
    }

    #[test]
    fn accepts_small_dag_with_repeated_edges() {
        let leaf = text("shared");
        let root = w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Stack(w_ui::UiStack {
                dir: w_ui::Axis::Column,
                gap: 0,
                children: vec![1, 1],
            }),
        };
        assert!(from_tree(w_ui::UiTree {
            nodes: vec![root, leaf],
            root: 0,
        })
        .is_ok());
    }

    #[test]
    fn rejects_dag_height_even_when_shared_node_was_seen_shallow() {
        let stack = |children| w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Stack(w_ui::UiStack {
                dir: w_ui::Axis::Column,
                gap: 0,
                children,
            }),
        };
        let mut nodes = vec![text("leaf"); 65];
        nodes.push(text("shared")); // 65
        nodes[0] = stack(vec![65]);
        nodes[64] = stack(vec![66]);
        for index in 66..=128 {
            nodes.push(if index == 128 {
                stack(vec![65])
            } else {
                stack(vec![(index + 1) as u32])
            });
        }
        nodes.push(stack((0..65).collect())); // 129
        assert!(from_tree(w_ui::UiTree { nodes, root: 129 }).is_err());
    }

    #[test]
    fn rejects_oversized_button_action_json_before_conversion() {
        let node = w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Button(w_ui::UiButton {
                label: crate::contract::fub::abi::text::Text::Literal("go".into()),
                intent: w_ui::Intent::Primary,
                action: w_ui::ActionRef {
                    action: "go".into(),
                    payload: "x".repeat((MAX_UNITS + 1) as usize),
                },
            }),
        };
        assert!(from_tree(w_ui::UiTree {
            nodes: vec![node],
            root: 0
        })
        .is_err());
    }

    #[test]
    fn rejects_oversized_unreachable_custom_payload() {
        let root = text("ok");
        let custom = w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Custom(w_ui::UiCustom {
                ns: "test".into(),
                payload: "x".repeat((MAX_UNITS + 1) as usize),
                fallback: Vec::new(),
            }),
        };
        assert!(from_tree(w_ui::UiTree {
            nodes: vec![root, custom],
            root: 0
        })
        .is_err());
    }
    #[test]
    fn rejects_repeated_edge_materialization_budget() {
        let stack = |children| w_ui::UiNode {
            key: None,
            kind: w_ui::UiKind::Stack(w_ui::UiStack {
                dir: w_ui::Axis::Column,
                gap: 0,
                children,
            }),
        };
        let mut nodes = vec![text("leaf")];
        for previous in 0..23 {
            let child = previous as u32;
            nodes.push(stack(vec![child, child]));
        }
        let root = (nodes.len() - 1) as u32;
        assert!(from_tree(w_ui::UiTree { nodes, root }).is_err());
    }
}
