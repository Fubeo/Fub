// Il banco di questa feature vive con lei: senza la cargo feature `properties`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "properties")]
//! Il pannello proprietà end-to-end **attraverso il kernel vero**: vault su
//! disco, markdown vero, `KernelHost` vero. Prova che la view legge il
//! frontmatter dal modello e che set/remove riscrivono solo quel blocco.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode, UndoStep};
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::session::ViewContext;
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{FieldValue, UiAction, UiKind, UiNode, UiValue};
use fub_features::{
    PropertiesCommands, PropertiesView, NOTES_PROPERTY_REMOVE, NOTES_PROPERTY_SET, PROPERTIES_ID,
    PROPERTIES_VIEW,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace, MAIN_PANE};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).unwrap()
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            PluginManifest::core(PROPERTIES_ID, PROPERTIES_ID)
                .speaking("it", fub_features::properties::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(PROPERTIES_ID, Box::new(PropertiesView))
            .expect("view");
        ws.register_command_provider(PROPERTIES_ID, Box::new(PropertiesCommands))
            .expect("comandi");
        ws.reindex().expect("reindex");
        ws
    }
}

fn instance() -> ViewInstance {
    ViewInstance::only(PROPERTIES_VIEW)
}

fn open_notes(ws: &Workspace, rel: &str) {
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE).with_doc(Some(DocId::new(rel))),
    ));
}

fn fields(tree: &UiNode) -> Vec<(String, &'static str)> {
    fn walk(node: &UiNode, out: &mut Vec<(String, &'static str)>) {
        match &node.kind {
            UiKind::TextInput { field, .. } => out.push((field.clone(), "text")),
            UiKind::Number { field, .. } => out.push((field.clone(), "number")),
            UiKind::Checkbox { field, .. } => out.push((field.clone(), "checkbox")),
            UiKind::DatePicker { field, .. } => out.push((field.clone(), "date")),
            UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
            UiKind::Form { children, .. } => children.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

fn and_empty_state(tree: &UiNode) -> bool {
    fn walk(node: &UiNode) -> bool {
        match &node.kind {
            UiKind::EmptyState { .. } => true,
            UiKind::Stack { children, .. } => children.iter().any(walk),
            UiKind::List { items } => items.iter().any(walk),
            UiKind::Form { children, .. } => children.iter().any(walk),
            _ => false,
        }
    }
    walk(tree)
}

const MISTA: &str = "\
---
title: Hello
count: 3
done: false
when: 2026-01-02
tags:
  - a
  - b
see: \"[[Other]]\"
---

# Body stays

paragraph
";

#[test]
fn render_mixed_has_the_widget_right_for_key() {
    let vault = Vault::new();
    vault.put("a.md", MISTA);
    let ws = vault.open();
    open_notes(&ws, "a.md");
    let tree = ws.render_view(&instance()).unwrap();
    let fields = fields(&tree);
    assert!(fields.contains(&("title".into(), "text")), "{fields:?}");
    assert!(fields.contains(&("count".into(), "number")), "{fields:?}");
    assert!(fields.contains(&("done".into(), "checkbox")), "{fields:?}");
    assert!(fields.contains(&("when".into(), "date")), "{fields:?}");
    assert!(fields.contains(&("tags".into(), "text")), "{fields:?}");
    assert!(fields.contains(&("see".into(), "text")), "{fields:?}");
}

#[test]
fn no_one_notes_open_and_empty_state() {
    let vault = Vault::new();
    vault.put("a.md", MISTA);
    let ws = vault.open();
    let tree = ws.render_view(&instance()).unwrap();
    assert!(and_empty_state(&tree));
}

#[test]
fn set_bool_writes_yaml_and_leaves_the_body() {
    let vault = Vault::new();
    vault.put("a.md", MISTA);
    let mut ws = vault.open();
    open_notes(&ws, "a.md");
    ws.view_action(
        &instance(),
        UiAction::new("set")
            .with_payload(serde_json::json!({"key": "done", "doc": "a.md"}))
            .with_fields(vec![FieldValue {
                field: "done".into(),
                value: UiValue::Bool(true),
            }]),
    )
    .expect("view_action");
    let after = vault.read("a.md");
    assert!(
        after.contains("done: true") || after.contains("done: true\n"),
        "{after}"
    );
    assert!(after.contains("# Body stays"), "{after}");
    assert!(after.contains("paragraph\n"), "{after}");
    let body = after.split_once("\n# Body stays").expect("corpo").1;
    let expected = MISTA.split_once("\n# Body stays").expect("orig").1;
    assert_eq!(body, expected);
}

#[test]
fn add_on_notes_without_frontmatter_born_the_block() {
    let vault = Vault::new();
    vault.put("a.md", "# Solo corpo\n\nresto\n");
    let mut ws = vault.open();
    open_notes(&ws, "a.md");
    ws.view_action(
        &instance(),
        UiAction::new("add")
            .with_payload(serde_json::json!({"doc": "a.md"}))
            .with_fields(vec![
                FieldValue {
                    field: "new_key".into(),
                    value: UiValue::Text("title".into()),
                },
                FieldValue {
                    field: "new_value".into(),
                    value: UiValue::Text("Ciao".into()),
                },
            ]),
    )
    .expect("view_action");
    let after = vault.read("a.md");
    assert!(after.starts_with("---\n"), "{after}");
    assert!(after.contains("title:"), "{after}");
    assert!(after.contains("# Solo corpo"), "{after}");
    assert!(after.contains("resto\n"), "{after}");
    let body = after.split_once("# Solo corpo").expect("corpo").1;
    let expected = "# Solo corpo\n\nresto\n"
        .split_once("# Solo corpo")
        .expect("orig")
        .1;
    assert_eq!(body, expected);
}

#[test]
fn remove_removes_the_key_and_the_body_remains() {
    let vault = Vault::new();
    vault.put("a.md", MISTA);
    let mut ws = vault.open();
    open_notes(&ws, "a.md");
    ws.view_action(
        &instance(),
        UiAction::new("remove").with_payload(serde_json::json!({"key": "count", "doc": "a.md"})),
    )
    .expect("view_action");
    let after = vault.read("a.md");
    assert!(!after.contains("count:"), "{after}");
    assert!(after.contains("title:"), "{after}");
    let body = after.split_once("\n# Body stays").expect("corpo").1;
    let expected = MISTA.split_once("\n# Body stays").expect("orig").1;
    assert_eq!(body, expected);
}

#[test]
fn dry_run_not_writes() {
    let vault = Vault::new();
    vault.put("a.md", MISTA);
    let mut ws = vault.open();
    let before = vault.read("a.md");
    let outcome = ws
        .invoke_command(
            NOTES_PROPERTY_SET,
            serde_json::json!({"doc": "a.md", "key": "done", "value": "true"}),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("dry_run");
    assert!(
        matches!(outcome.effect, CommandEffect::Plan(_)),
        "{:?}",
        outcome.effect
    );
    assert_eq!(vault.read("a.md"), before);
}

#[test]
fn undo_of_the_set_restores_the_block() {
    let vault = Vault::new();
    vault.put("a.md", MISTA);
    let mut ws = vault.open();
    let before = vault.read("a.md");
    let outcome = ws
        .invoke_command(
            NOTES_PROPERTY_SET,
            serde_json::json!({"doc": "a.md", "key": "done", "value": "true"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("apply");
    let after = vault.read("a.md");
    assert_eq!(after, before);
    let undo = outcome.undo.expect("undoable");
    let UndoStep::Edit(p) = &undo.steps[0] else {
        panic!("atteso Edit, trovato {:?}", undo.steps);
    };
    ws.apply_edit(&p.doc, p.edit.clone()).expect("inverse");
    assert_eq!(vault.read("a.md"), before);
}

#[test]
fn the_commands_are_in_the_record() {
    let vault = Vault::new();
    let ws = vault.open();
    let ids: Vec<String> = ws.commands().into_iter().map(|c| c.id).collect();
    assert!(ids.contains(&NOTES_PROPERTY_SET.to_string()), "{ids:?}");
    assert!(ids.contains(&NOTES_PROPERTY_REMOVE.to_string()), "{ids:?}");
}
