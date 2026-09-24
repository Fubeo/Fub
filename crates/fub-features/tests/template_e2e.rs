#![cfg(feature = "template")]
//! Template e note giornaliere end-to-end attraverso il kernel vero.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::model::{DocId, Span};
#[cfg(all(feature = "properties", feature = "commands"))]
use fub_abi::session::{SelectionSet, ViewContext};
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{UiAction, UiKind, UiNode};
#[cfg(all(feature = "properties", feature = "commands"))]
use fub_features::{
    CoreCommands, PropertiesCommands, COMMANDS_ID, NOTES_INSERT_TEMPLATE, PROPERTIES_ID, VAULT_UNDO,
};
use fub_features::{
    TemplateCommands, TemplateView, NOTES_DAILY, NOTES_EXTRACT, NOTES_FROM_TEMPLATE, NOTES_MERGE,
    TEMPLATE_ID, TEMPLATE_VIEW,
};
use fub_format_markdown::MarkdownProvider;
#[cfg(all(feature = "properties", feature = "commands"))]
use fub_kernel::MAIN_PANE;
use fub_kernel::{FormatRegistry, Workspace};

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
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        let mut manifest = PluginManifest::core(TEMPLATE_ID, TEMPLATE_ID)
            .speaking("it", fub_features::template::catalog());
        manifest.settings = TemplateCommands::settings();
        ws.register_plugin(manifest, fub_kernel::Trust::Core)
            .expect("dichiarato");
        ws.register_view_provider(TEMPLATE_ID, Box::new(TemplateView))
            .expect("view");
        ws.register_command_provider(TEMPLATE_ID, Box::new(TemplateCommands))
            .expect("comandi");
        ws.reindex().expect("reindex");
        ws
    }

    #[cfg(all(feature = "properties", feature = "commands"))]
    fn open_with_properties(&self) -> Workspace {
        let mut ws = self.open();
        ws.register_plugin(
            PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("core commands");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("core commands provider");
        ws.register_plugin(
            PluginManifest::core(PROPERTIES_ID, PROPERTIES_ID)
                .speaking("it", fub_features::properties::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("properties");
        ws.register_command_provider(PROPERTIES_ID, Box::new(PropertiesCommands))
            .expect("properties provider");
        ws.reindex().expect("reindex");
        ws
    }
}

fn entries(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::ListItem { title, .. } => out.push(title.to_string()),
            UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

#[test]
fn unique_collisions_random_names_and_datetime_insert_round_trip() {
    use fub_features::{NOTES_INSERT_DATETIME, NOTES_RANDOM, NOTES_UNIQUE};
    let vault = Vault::new();
    vault.put("Nota.md", "occupata\n");
    vault.put("Templates/Card.md", "# {{title}}\n");
    let mut ws = vault.open();
    // Di default il nome porta il prefisso temporale dell'host.
    let stamped = ws
        .invoke_command(
            NOTES_UNIQUE,
            serde_json::json!({"name": "Idea"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("nota col prefisso");
    let CommandEffect::Navigate { doc } = stamped.effect else {
        panic!("unique naviga alla nota creata")
    };
    let (prefix, rest) = doc.as_str().split_once(' ').expect("prefisso e nome");
    assert!(
        prefix.len() == 12 && prefix.bytes().all(|b| b.is_ascii_digit()),
        "{doc}"
    );
    assert_eq!(rest, "Idea.md");
    // Senza prefisso, le collisioni si risolvono come sempre.
    ws.set_setting(
        fub_features::template::UNIQUE_PREFIX_KEY,
        fub_abi::settings::SettingValue::Text(String::new()),
    )
    .expect("prefisso spento");
    let second = ws
        .invoke_command(
            NOTES_UNIQUE,
            serde_json::json!({"name": "Nota"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("collisione risolta");
    let CommandEffect::Navigate { doc } = second.effect else {
        panic!("unique naviga alla nota creata")
    };
    assert_eq!(doc.as_str(), "Nota 1.md");
    let random = ws
        .invoke_command(
            NOTES_UNIQUE,
            serde_json::json!({"name": "Qualsiasi", "random": true}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("nome casuale");
    let CommandEffect::Navigate { doc } = random.effect else {
        panic!("unique casuale naviga alla nota creata")
    };
    assert!(doc.as_str().starts_with("Nota-") && doc.as_str().ends_with(".md"));
    let pick = ws
        .invoke_command(
            NOTES_RANDOM,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("nota casuale");
    let CommandEffect::Navigate { doc } = pick.effect else {
        panic!("random naviga a una nota esistente")
    };
    assert!(ws.documents().contains(&doc));
    vault.put("note.md", "base\n");
    let mut ws = vault.open();
    ws.invoke_command(
        NOTES_INSERT_DATETIME,
        serde_json::json!({"doc": "note.md", "at": [5], "format": "date"}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("inserimento data");
    let text = ws.read_source(&DocId::new("note.md")).expect("rilettura");
    assert!(
        text.starts_with("base\n20")
            && !text.ends_with("\n\n")
            && text[5..15].chars().filter(|c| *c == '-').count() == 2,
        "{text:?}"
    );
}
#[test]
fn from_template_replaces_and_creates() {
    let vault = Vault::new();
    vault.put("Templates/Meeting.md", "# {{title}}\n\nData: {{date}}\n");
    let mut ws = vault.open();
    let outcome = ws
        .invoke_command(
            NOTES_FROM_TEMPLATE,
            serde_json::json!({"template": "Templates/Meeting.md", "name": "Standup"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("from_template");
    let CommandEffect::Navigate { doc } = outcome.effect else {
        panic!("atteso Navigate, {:?}", outcome.effect);
    };
    assert_eq!(doc, DocId::new("Standup.md"));
    let body = ws.read_source(&doc).unwrap();
    assert!(body.starts_with("# Standup\n"), "{body}");
    assert!(body.contains("Data: 20"), "{body}");
}

#[test]
fn daily_creates_and_the_second_time_opens() {
    let vault = Vault::new();
    vault.put("Templates/Daily.md", "diario {{date}}\n");
    let mut ws = vault.open();
    let first = ws
        .invoke_command(
            NOTES_DAILY,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("daily");
    let CommandEffect::Navigate { doc } = first.effect else {
        panic!("{:?}", first.effect);
    };
    assert!(doc.as_str().starts_with("Daily/"), "{}", doc.as_str());
    assert!(doc.as_str().ends_with(".md"));
    let body = ws.read_source(&doc).unwrap();
    assert!(body.starts_with("diario 20"), "{body}");

    let second = ws
        .invoke_command(
            NOTES_DAILY,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("daily di nuovo");
    let CommandEffect::Navigate { doc: of_new } = second.effect else {
        panic!("{:?}", second.effect);
    };
    assert_eq!(doc, of_new);
    assert_eq!(ws.read_source(&doc).unwrap(), body);
}

#[test]
fn the_view_lists_the_template() {
    let vault = Vault::new();
    vault.put("Templates/A.md", "a\n");
    vault.put("Templates/B.md", "b\n");
    vault.put("Altro.md", "no\n");
    let ws = vault.open();
    let tree = ws.render_view(&ViewInstance::only(TEMPLATE_VIEW)).unwrap();
    let entries = entries(&tree);
    assert_eq!(entries, vec!["A".to_string(), "B".to_string()]);
}

#[test]
fn dry_run_not_writes() {
    let vault = Vault::new();
    vault.put("Templates/X.md", "x\n");
    let mut ws = vault.open();
    let before = ws.documents();
    let outcome = ws
        .invoke_command(
            NOTES_FROM_TEMPLATE,
            serde_json::json!({"template": "Templates/X.md", "name": "Y"}),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("dry_run");
    assert!(matches!(outcome.effect, CommandEffect::Plan(_)));
    assert_eq!(ws.documents(), before);
}

#[test]
fn click_creates_from_template() {
    let vault = Vault::new();
    vault.put("Templates/Scheda.md", "ciao {{title}}\n");
    let mut ws = vault.open();
    let update = ws
        .view_action(
            &ViewInstance::only(TEMPLATE_VIEW),
            UiAction::new("use")
                .with_payload(serde_json::json!({"template": "Templates/Scheda.md"})),
        )
        .expect("view_action");
    match update {
        fub_abi::ui::ViewUpdate::Navigate { doc_id } => {
            assert!(doc_id.ends_with(".md"), "{doc_id}");
            let body = ws.read_source(&DocId::new(&doc_id)).unwrap();
            assert!(body.contains("ciao "), "{body}");
        }
        other => panic!("atteso Navigate, {other:?}"),
    }
}

#[cfg(all(feature = "properties", feature = "commands"))]
#[test]
fn daily_uses_explicit_civil_date_folder_template_and_typed_date() {
    let vault = Vault::new();
    vault.put("Templates/Journal.md", "Journal {{date}}\n");
    let mut ws = vault.open_with_properties();
    let args = serde_json::json!({
        "date": "2024-02-29", "folder": "Journal", "template": "Templates/Journal"
    });
    let outcome = ws
        .invoke_command(NOTES_DAILY, args, InvokeMode::Apply, Actor::User)
        .expect("leap day daily");
    assert!(
        matches!(outcome.effect, CommandEffect::Navigate { doc } if doc == DocId::new("Journal/2024-02-29.md"))
    );
    let doc = DocId::new("Journal/2024-02-29.md");
    let body = ws.read_source(&doc).unwrap();
    assert!(body.contains("Journal 2024-02-29\n"), "{body}");
    assert_eq!(
        ws.read_model(&doc).unwrap().frontmatter.get("date"),
        Some(&serde_json::json!("2024-02-29")),
    );
    assert!(ws
        .invoke_command(
            NOTES_DAILY,
            serde_json::json!({"date":"2026-02-29", "folder":"Journal"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .is_err());
    assert!(!ws
        .documents()
        .contains(&DocId::new("Journal/2026-02-29.md")));
}

#[cfg(all(feature = "properties", feature = "commands"))]
#[test]
fn inserting_template_merges_typed_properties_and_one_undo_restores_both() {
    let vault = Vault::new();
    let original = "---\nexisting: yes\n---\nbase\n";
    vault.put("note.md", original);
    vault.put(
        "Templates/typed.md",
        "---\naliases:\n  - Uno\n  - Due\nmeta:\n  owner: Mario\n---\ninserted\n",
    );
    let mut ws = vault.open_with_properties();
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(DocId::new("note.md")))
            .with_selections(Some(SelectionSet::caret(original.len()))),
    ));
    ws.invoke_command(
        NOTES_INSERT_TEMPLATE,
        serde_json::json!({"template":"Templates/typed.md"}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("insert template");
    let merged = ws.read_source(&DocId::new("note.md")).unwrap();
    assert!(merged.ends_with("base\ninserted\n"), "{merged}");
    let model = ws.read_model(&DocId::new("note.md")).unwrap();
    assert_eq!(
        model.frontmatter.get("aliases"),
        Some(&serde_json::json!(["Uno", "Due"]))
    );
    assert_eq!(
        model.frontmatter.get("meta"),
        Some(&serde_json::json!({"owner":"Mario"}))
    );
    ws.invoke_command(
        VAULT_UNDO,
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("one composer undo");
    assert_eq!(ws.read_source(&DocId::new("note.md")).unwrap(), original);
}
#[cfg(all(feature = "properties", feature = "commands"))]
#[test]
fn partial_property_merge_still_has_one_complete_composer_undo() {
    let vault = Vault::new();
    vault.put("note.md", "original");
    vault.put(
        "Templates/partial.md",
        "---\na: 7\naliases:\n  owner: invalid-list\n---\ninserted\n",
    );
    let mut ws = vault.open_with_properties();
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(DocId::new("note.md")))
            .with_selections(Some(SelectionSet::caret("original".len()))),
    ));
    let outcome = ws
        .invoke_command(
            NOTES_INSERT_TEMPLATE,
            serde_json::json!({"template":"Templates/partial.md"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("partial insert");
    assert!(
        outcome.partial.is_some(),
        "invalid declared list is reported"
    );
    let merged = ws.read_model(&DocId::new("note.md")).unwrap();
    assert_eq!(merged.frontmatter.get("a"), Some(&serde_json::json!(7)));
    assert_eq!(merged.frontmatter.get("aliases"), None);
    assert!(ws
        .read_source(&DocId::new("note.md"))
        .unwrap()
        .contains("inserted"));
    ws.invoke_command(
        VAULT_UNDO,
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("one undo after partial merge");
    assert_eq!(ws.read_source(&DocId::new("note.md")).unwrap(), "original");
}

#[test]
fn extraction_rejects_a_stale_selection_without_creating_an_orphan() {
    let vault = Vault::new();
    vault.put("note.md", "original");
    let mut ws = vault.open();
    ws.set_active_context(Some(
        fub_abi::session::ViewContext::new("main")
            .with_doc(Some(DocId::new("note.md")))
            .with_selections(Some(fub_abi::session::SelectionSet::anchored(
                Span::new(0, 4),
                "stale",
            ))),
    ));
    let err = ws
        .invoke_command(
            NOTES_EXTRACT,
            serde_json::json!({"name":"Extracted"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    assert!(matches!(err, fub_abi::PluginError::Conflict(_)));
    assert_eq!(ws.read_source(&DocId::new("note.md")).unwrap(), "original");
    assert!(!ws.documents().contains(&DocId::new("Extracted.md")));
}

#[test]
fn merge_refuses_to_trash_a_source_with_incoming_references() {
    let vault = Vault::new();
    vault.put("source.md", "source text");
    vault.put("target.md", "target text");
    vault.put("reader.md", "See [[source]]");
    let mut ws = vault.open();
    let err = ws
        .invoke_command(
            NOTES_MERGE,
            serde_json::json!({"from":["source.md"], "into":"target.md"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    assert!(matches!(err, fub_abi::PluginError::Conflict(_)));
    assert_eq!(
        ws.read_source(&DocId::new("source.md")).unwrap(),
        "source text"
    );
    assert_eq!(
        ws.read_source(&DocId::new("target.md")).unwrap(),
        "target text"
    );
    assert_eq!(
        ws.read_source(&DocId::new("reader.md")).unwrap(),
        "See [[source]]"
    );
}

#[test]
fn extract_refuses_to_move_relative_embedded_assets_across_folders() {
    let vault = Vault::new();
    let source = "![photo](images/pic.png)\n";
    vault.put("notes/source.md", source);
    let mut ws = vault.open();
    ws.set_active_context(Some(
        fub_abi::session::ViewContext::new("main")
            .with_doc(Some(DocId::new("notes/source.md")))
            .with_selections(Some(fub_abi::session::SelectionSet::anchored(
                Span::new(0, source.len()),
                source,
            ))),
    ));
    let err = ws
        .invoke_command(
            NOTES_EXTRACT,
            serde_json::json!({"name":"other/new"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    assert!(matches!(err, fub_abi::PluginError::Conflict(_)));
    assert_eq!(
        ws.read_source(&DocId::new("notes/source.md")).unwrap(),
        source
    );
    assert!(!ws.documents().contains(&DocId::new("other/new.md")));
}
