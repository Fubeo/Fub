// Il banco di questa feature vive con lei: senza la cargo feature `properties`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "properties")]
//! Il pannello proprietà end-to-end attraverso il kernel vero: frontmatter
//! lessicale, tipi dichiarati, vista globale e rinomina reversibile.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode, UndoStep};
use fub_abi::event::Actor;
use fub_abi::model::{DocId, PropertyType, PropertyTypes};
use fub_abi::session::ViewContext;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{FieldValue, UiAction, UiKind, UiNode, UiValue};
use fub_features::{
    PropertiesCommands, PropertiesView, GLOBAL_PROPERTIES_VIEW, NOTES_PROPERTY_REMOVE,
    NOTES_PROPERTY_SET, PROPERTIES_ID, PROPERTIES_VIEW, PROPERTY_KEY_RENAME, PROPERTY_TYPE_SET,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace, MAIN_PANE};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

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
            PluginManifest::core("fub.core-test", "Core test")
                .configuring(fub_kernel::properties::properties_settings())
                .speaking("it", fub_kernel::properties::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("impostazioni core dichiarate");
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

fn global_instance() -> ViewInstance {
    ViewInstance::only(GLOBAL_PROPERTIES_VIEW)
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
    assert_ne!(after, before);
    let undo = outcome.undo.expect("undoable");
    let UndoStep::Edit(p) = &undo.steps[0] else {
        panic!("atteso Edit, trovato {:?}", undo.steps);
    };
    ws.apply_edit(&p.doc, p.edit.clone()).expect("inverse");
    assert_eq!(vault.read("a.md"), before);
}

#[test]
fn tagged_property_cas_distinguishes_absent_null_false_and_revision() {
    let vault = Vault::new();
    vault.put("a.md", "---\nnullable:\nflag: false\n---\n\nBody\n");
    let mut ws = vault.open();
    let original = ws.document_revision(&DocId::new("a.md")).unwrap();
    let run = |ws: &mut Workspace,
               key: &str,
               value: &str,
               expected: serde_json::Value,
               revision: Option<&str>| {
        let mut args = serde_json::json!({
            "doc": "a.md", "key": key, "value": value,
            "expected": expected.to_string()
        });
        if let Some(revision) = revision {
            args["expected_revision"] = revision.into();
        }
        ws.invoke_command(NOTES_PROPERTY_SET, args, InvokeMode::Apply, Actor::User)
    };
    let present_null = serde_json::json!({"kind":"value","value":{"kind":"empty"}});
    let absent = serde_json::json!({"kind":"absent"});
    assert!(matches!(
        run(&mut ws, "nullable", "42", absent.clone(), None),
        Err(fub_abi::PluginError::Conflict(_))
    ));
    assert!(vault.read("a.md").contains("nullable:"));
    run(&mut ws, "nullable", "42", present_null, Some(&original.0)).unwrap();
    let after_null = vault.read("a.md");
    assert!(after_null.contains("nullable: 42"), "{after_null}");
    assert!(matches!(
        run(
            &mut ws,
            "flag",
            "true",
            serde_json::json!({"kind":"value","value":{"kind":"bool","value":true}}),
            None
        ),
        Err(fub_abi::PluginError::Conflict(_))
    ));
    assert!(matches!(
        run(
            &mut ws,
            "flag",
            "true",
            serde_json::json!({"kind":"value","value":{"kind":"bool","value":false}}),
            Some(&original.0)
        ),
        Err(fub_abi::PluginError::Conflict(_))
    ));
    assert!(vault.read("a.md").contains("flag: false"));
    run(&mut ws, "missing", "false", absent, None).unwrap();
    assert!(vault.read("a.md").contains("missing: false"));
}

#[test]
fn the_commands_are_in_the_record() {
    let vault = Vault::new();
    let ws = vault.open();
    let ids: Vec<String> = ws.commands().into_iter().map(|c| c.id).collect();
    assert!(ids.contains(&NOTES_PROPERTY_SET.to_string()), "{ids:?}");
    assert!(ids.contains(&NOTES_PROPERTY_REMOVE.to_string()), "{ids:?}");
    assert!(ids.contains(&PROPERTY_TYPE_SET.to_string()), "{ids:?}");
    assert!(ids.contains(&PROPERTY_KEY_RENAME.to_string()), "{ids:?}");
}

fn declare(ws: &mut Workspace, key: &str, kind: &str) {
    ws.invoke_command(
        PROPERTY_TYPE_SET,
        serde_json::json!({"key": key, "type": kind}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("declare property type");
}

#[test]
fn declared_widgets_preserve_datetime_and_unknown_yaml_is_source_only() {
    let vault = Vault::new();
    vault.put("a.md", "---\ncount: \"5\"\ndue: 2026-01-02\nwhen: 2026-01-02T10:20:30+02:00\nnested:\n  child: [a, {b: c}]\nlist: [a, [nested]]\n---\n\n# Body\n");
    let mut ws = vault.open();
    declare(&mut ws, "count", "number");
    declare(&mut ws, "due", "date");
    declare(&mut ws, "when", "date_time");
    open_notes(&ws, "a.md");
    let tree = ws.render_view(&instance()).unwrap();
    let fields = fields(&tree);
    assert!(fields.contains(&("count".into(), "number")), "{fields:?}");
    assert!(fields.contains(&("due".into(), "date")), "{fields:?}");
    assert!(fields.contains(&("when".into(), "text")), "{fields:?}");
    assert!(
        !fields
            .iter()
            .any(|(key, _)| key == "nested" || key == "list"),
        "{fields:?}"
    );
    let json = serde_json::to_string(&tree).unwrap();
    assert!(
        json.contains("source only") || json.contains("solo sorgente"),
        "{json}"
    );
    let before = vault.read("a.md");
    ws.view_action(
        &instance(),
        UiAction::new("set")
            .with_payload(serde_json::json!({"key":"when","doc":"a.md"}))
            .with_fields(vec![FieldValue {
                field: "when".into(),
                value: UiValue::Text("2026-01-02T10:20:30+02:00".into()),
            }]),
    )
    .unwrap();
    assert!(vault.read("a.md").contains("2026-01-02T10:20:30+02:00"));
    assert!(before.contains("nested:\n  child: [a, {b: c}]"));
    assert!(vault.read("a.md").contains("nested:\n  child: [a, {b: c}]"));
}

#[test]
fn presentation_modes_hide_widgets_and_reveal_exact_frontmatter() {
    let vault = Vault::new();
    vault.put("a.md", "---\nodd: {nested: true} # keep\n---\n\n# Body\n");
    let mut ws = vault.open();
    open_notes(&ws, "a.md");
    ws.view_action(
        &instance(),
        UiAction::new("mode").with_payload(serde_json::json!({"mode":"hidden"})),
    )
    .unwrap();
    assert!(
        !serde_json::to_string(&ws.render_view(&instance()).unwrap())
            .unwrap()
            .contains("odd")
    );
    ws.view_action(
        &instance(),
        UiAction::new("mode").with_payload(serde_json::json!({"mode":"source"})),
    )
    .unwrap();
    let source_tree = serde_json::to_string(&ws.render_view(&instance()).unwrap()).unwrap();
    assert!(
        source_tree.contains("odd: {nested: true} # keep"),
        "{source_tree}"
    );
    let update = ws
        .view_action(
            &instance(),
            UiAction::new("source").with_payload(serde_json::json!({"doc":"a.md"})),
        )
        .unwrap();
    assert!(
        matches!(update, fub_abi::ui::ViewUpdate::Reveal { doc_id, span }
        if doc_id == "a.md" && &vault.read("a.md")[span.start..span.end] == "---\nodd: {nested: true} # keep\n---\n")
    );
    ws.view_action(
        &instance(),
        UiAction::new("mode").with_payload(serde_json::json!({"mode":"structured"})),
    )
    .unwrap();
    assert!(serde_json::to_string(&ws.render_view(&instance()).unwrap())
        .unwrap()
        .contains("odd"));
}

#[test]
fn types_persist_across_reopen_and_invalid_registry_is_not_overwritten() {
    let vault = Vault::new();
    vault.put("a.md", "---\nflag: true\nrating: 4\n---\n");
    {
        let mut ws = vault.open();
        declare(&mut ws, "flag", "checkbox");
        declare(&mut ws, "rating", "text");
        let SettingValue::Text(raw) = ws.setting("properties.types").unwrap() else {
            panic!("text setting")
        };
        let types: PropertyTypes = serde_json::from_str(&raw).unwrap();
        assert_eq!(types.version, 1);
        assert_eq!(types.types["flag"], PropertyType::Checkbox);
        assert_eq!(types.types["rating"], PropertyType::Text);
    }
    let mut ws = vault.open();
    open_notes(&ws, "a.md");
    let fields = fields(&ws.render_view(&instance()).unwrap());
    assert!(fields.contains(&("flag".into(), "checkbox")), "{fields:?}");
    assert!(!fields.iter().any(|(key, _)| key == "rating"), "{fields:?}");
    for raw in ["{broken", "{\"version\":2,\"types\":{\"future\":\"text\"}}"] {
        ws.set_setting("properties.types", SettingValue::Text(raw.into()))
            .unwrap();
        assert!(ws
            .invoke_command(
                PROPERTY_TYPE_SET,
                serde_json::json!({"key":"new","type":"text"}),
                InvokeMode::Apply,
                Actor::User
            )
            .is_err());
        assert_eq!(
            ws.setting("properties.types").unwrap(),
            SettingValue::Text(raw.into())
        );
    }
}

#[test]
fn conventional_keys_are_editable_and_global_view_counts_and_opens() {
    let vault = Vault::new();
    vault.put(
        "a.md",
        "---\ntags: [rust, notes]\nalias: Primary\ncssclasses: [red]\n---\n",
    );
    vault.put(
        "b.md",
        "---\ntags: [rust]\naliases: [Secondary]\ncssclass: blue\n---\n",
    );
    let mut ws = vault.open();
    open_notes(&ws, "a.md");
    let fields = fields(&ws.render_view(&instance()).unwrap());
    for key in ["tags", "alias", "cssclasses"] {
        assert!(fields.contains(&(key.into(), "text")), "{fields:?}");
    }
    let global = serde_json::to_string(&ws.render_view(&global_instance()).unwrap()).unwrap();
    assert!(global.contains("tags"), "{global}");
    assert!(global.contains("rust · 2"), "{global}");
    assert!(
        global.contains("a.md") && global.contains("b.md"),
        "{global}"
    );
    ws.view_action(
        &global_instance(),
        UiAction::new("filter").with_fields(vec![FieldValue {
            field: "property_filter".into(),
            value: UiValue::Text("Secondary".into()),
        }]),
    )
    .unwrap();
    let filtered = serde_json::to_string(&ws.render_view(&global_instance()).unwrap()).unwrap();
    assert!(
        filtered.contains("aliases") && filtered.contains("b.md"),
        "{filtered}"
    );
    assert!(!filtered.contains("a.md"), "{filtered}");
    let opened = ws
        .view_action(
            &global_instance(),
            UiAction::new("open").with_payload(serde_json::json!({"doc":"b.md"})),
        )
        .unwrap();
    assert!(matches!(opened, fub_abi::ui::ViewUpdate::Navigate { doc_id } if doc_id == "b.md"));
}

#[test]
fn global_rename_previews_lexical_edits_and_one_undo_restores_all_sources() {
    let vault = Vault::new();
    vault.put(
        "a.md",
        "---\n'old key': {nested: [a, b]} # comment\nother: yes\n---\n\n# Keep\n",
    );
    vault.put("b.md", "---\n\"old key\": [one, two]\n---\n\nText\n");
    let mut ws = vault.open();
    let before_a = vault.read("a.md");
    let before_b = vault.read("b.md");
    let args = serde_json::json!({"old_key":"old key","new_key":"new key"});
    let plan = ws
        .invoke_command(
            PROPERTY_KEY_RENAME,
            args.clone(),
            InvokeMode::DryRun,
            Actor::User,
        )
        .unwrap();
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("expected dry-run plan")
    };
    assert_eq!(plan.docs.len(), 2);
    assert_eq!(plan.edits.len(), 2);
    assert_eq!(vault.read("a.md"), before_a);
    assert_eq!(vault.read("b.md"), before_b);
    let result = ws
        .invoke_command(
            PROPERTY_KEY_RENAME,
            args.clone(),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap();
    assert!(result.partial.is_none());
    assert_eq!(result.undo.as_ref().unwrap().steps.len(), 2);
    assert_eq!(
        vault.read("a.md"),
        before_a.replace("'old key'", "'new key'")
    );
    assert_eq!(
        vault.read("b.md"),
        before_b.replace("\"old key\"", "\"new key\"")
    );
    let rerun = ws
        .invoke_command(PROPERTY_KEY_RENAME, args, InvokeMode::Apply, Actor::User)
        .unwrap();
    assert!(rerun.undo.is_none());
    for step in result.undo.unwrap().steps {
        let UndoStep::Edit(planned) = step else {
            panic!("inverse edit expected")
        };
        ws.apply_edit(&planned.doc, planned.edit).unwrap();
    }
    assert_eq!(vault.read("a.md"), before_a);
    assert_eq!(vault.read("b.md"), before_b);
}

#[test]
fn concurrent_cas_failure_reports_partial_undo_and_rerun_only_remaining() {
    let vault = Vault::new();
    vault.put("a.md", "---\nold: A\n---\n");
    vault.put("b.md", "---\nold: B\n---\n");
    let mut ws = vault.open();
    let root = vault.root.clone();
    let once = Arc::new(AtomicBool::new(true));
    let armed = once.clone();
    ws.set_before_write_hook(
        PROPERTIES_ID,
        Some(Arc::new(move |_, doc| {
            if doc.as_str() == "a.md" && armed.swap(false, Ordering::SeqCst) {
                // External concurrent writer after all rename CAS revisions were
                // captured, before b's edit reaches its disk CAS.
                std::fs::write(root.join("b.md"), "---\nold: B\nnewer: true\n---\n").unwrap();
            }
            Ok(())
        })),
    );
    let args = serde_json::json!({"old_key":"old","new_key":"new"});
    let outcome = ws
        .invoke_command(
            PROPERTY_KEY_RENAME,
            args.clone(),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap();
    let partial = outcome.partial.expect("explicit partial outcome");
    assert_eq!(
        (partial.attempted, partial.done, partial.failures.len()),
        (2, 1, 1)
    );
    assert_eq!(partial.failures[0].subject, Some(DocId::new("b.md")));
    assert!(matches!(
        &partial.failures[0].error,
        fub_abi::PluginError::Conflict(_)
    ));
    assert_eq!(outcome.undo.as_ref().unwrap().steps.len(), 1);
    assert!(vault.read("a.md").contains("new: A"));
    assert!(vault.read("b.md").contains("old: B"));
    ws.set_before_write_hook(PROPERTIES_ID, None);
    ws.reindex().unwrap();
    let resumed = ws
        .invoke_command(PROPERTY_KEY_RENAME, args, InvokeMode::Apply, Actor::User)
        .unwrap();
    assert!(resumed.partial.is_none());
    assert_eq!(resumed.undo.as_ref().unwrap().steps.len(), 1);
    assert!(vault.read("a.md").contains("new: A"));
    assert!(vault.read("b.md").contains("new: B\nnewer: true"));
    for step in outcome.undo.unwrap().steps {
        let UndoStep::Edit(planned) = step else {
            panic!("inverse edit expected")
        };
        ws.apply_edit(&planned.doc, planned.edit).unwrap();
    }
    assert!(vault.read("a.md").contains("old: A"));
    assert!(vault.read("b.md").contains("new: B"));
}

#[test]
fn typed_rename_copies_conventional_type_before_edit_without_clobbering_future_schema() {
    let vault = Vault::new();
    vault.put("a.md", "---\ntags: [rust, notes]\n---\n");
    let mut ws = vault.open();
    let args = serde_json::json!({"old_key":"tags","new_key":"topics"});
    let before = ws.setting("properties.types").unwrap();
    ws.invoke_command(
        PROPERTY_KEY_RENAME,
        args.clone(),
        InvokeMode::DryRun,
        Actor::User,
    )
    .unwrap();
    assert_eq!(ws.setting("properties.types").unwrap(), before);
    ws.invoke_command(
        PROPERTY_KEY_RENAME,
        args.clone(),
        InvokeMode::Apply,
        Actor::User,
    )
    .unwrap();
    let SettingValue::Text(raw) = ws.setting("properties.types").unwrap() else {
        panic!("text setting")
    };
    let types: PropertyTypes = serde_json::from_str(&raw).unwrap();
    assert_eq!(types.resolve("topics"), Some(PropertyType::Tags));
    assert_eq!(types.resolve("tags"), Some(PropertyType::Tags));
    open_notes(&ws, "a.md");
    assert!(fields(&ws.render_view(&instance()).unwrap()).contains(&("topics".into(), "text")));
    ws.set_setting(
        "properties.types",
        SettingValue::Text("{\"version\":3,\"types\":{}}".into()),
    )
    .unwrap();
    let source = vault.read("a.md");
    assert!(ws
        .invoke_command(
            PROPERTY_KEY_RENAME,
            serde_json::json!({"old_key":"topics","new_key":"subjects"}),
            InvokeMode::Apply,
            Actor::User
        )
        .is_err());
    assert_eq!(vault.read("a.md"), source);
}

#[test]
fn datetime_inside_a_list_keeps_its_clock_and_offset_in_global_values() {
    let vault = Vault::new();
    vault.put("a.md", "---\nwhen: [\"2026-01-02T10:20:30+02:00\"]\n---\n");
    let ws = vault.open();
    let global = serde_json::to_string(&ws.render_view(&global_instance()).unwrap()).unwrap();
    assert!(global.contains("2026-01-02T10:20:30+02:00"), "{global}");
}
