#![cfg(feature = "template")]
//! Template e note giornaliere end-to-end attraverso il kernel vero.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::model::{DocId, Span};
use fub_abi::options::source;
#[cfg(all(feature = "properties", feature = "commands"))]
use fub_abi::session::{SelectionSet, ViewContext};
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{UiAction, UiKind, UiNode};
use fub_abi::OptionMap;
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
use fub_testkit::SampleText;

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
        // Una prosa che non legge il frontmatter: per lei `---` è testo.
        registry
            .register(
                SampleText::by_extension("txt")
                    .with_syntax(OptionMap::new().with(source::PROSE, true))
                    .boxed(),
            )
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

/// **Una nota da template è il template espanso, e nient'altro** (difetto
/// I22).
///
/// La proprietà `date` lega una nota giornaliera al suo giorno, ed è di
/// `note.daily`. `note.from_template` la scriveva in ogni nota nuova
/// (progetti, verbali, schede), e così anche la cattura e `fub://new` che ci
/// passano. Si vede solo con il provider delle proprietà montato, come nell'app.
#[cfg(all(feature = "properties", feature = "commands"))]
#[test]
fn a_note_from_a_template_gets_no_property_the_template_does_not_have() {
    let vault = Vault::new();
    vault.put("templates/project.md", "# Project\nDescription here\n");
    vault.put(
        "templates/card.md",
        "---\nstatus: draft\n---\n# {{title}}\n",
    );
    let mut ws = vault.open_with_properties();
    for (template, name, expected) in [
        (
            "templates/project",
            "my_project",
            "# Project\nDescription here\n",
        ),
        (
            "templates/card",
            "Scheda",
            "---\nstatus: draft\n---\n# Scheda\n",
        ),
    ] {
        ws.invoke_command(
            NOTES_FROM_TEMPLATE,
            serde_json::json!({"template": template, "name": name}),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap();
        let doc = DocId::new(format!("{name}.md"));
        assert_eq!(ws.read_source(&doc).unwrap(), expected);
        assert_eq!(ws.read_model(&doc).unwrap().frontmatter.get("date"), None);
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

/// **L'unione tiene l'ordine delle sorgenti, in testa come in coda** (difetto
/// I20), ed è il testo che il piano aveva mostrato.
///
/// In testa ogni corpo entrava all'offset 0 uno dopo l'altro, quindi ciascuno
/// sopra il precedente: `[a, b, c]` diventava `c`, `b`, `a`.
#[test]
fn merge_keeps_the_order_of_its_sources_and_of_its_plan() {
    for (mode, target, expected) in [
        (
            "prepend",
            "Target Content",
            "Content A\n\nContent B\n\nContent C\n\nTarget Content",
        ),
        (
            "prepend",
            "---\nt: T\n---\nTarget Content",
            "---\nt: T\n---\nContent A\n\nContent B\n\nContent C\n\nTarget Content",
        ),
        (
            "append",
            "Target Content",
            "Target Content\n\nContent A\n\nContent B\n\nContent C",
        ),
    ] {
        let vault = Vault::new();
        vault.put("a.md", "Content A");
        vault.put("b.md", "Content B");
        vault.put("c.md", "Content C");
        vault.put("target.md", target);
        let mut ws = vault.open();
        let args = serde_json::json!({
            "from": ["a.md", "b.md", "c.md"], "into": "target.md", "mode": mode, "trash": false,
        });
        let plan = ws
            .invoke_command(NOTES_MERGE, args.clone(), InvokeMode::DryRun, Actor::User)
            .unwrap();
        let CommandEffect::Plan(plan) = plan.effect else {
            panic!("a dry run plans: {:?}", plan.effect);
        };
        let [insert] = plan.edits[0].edit.edits.as_slice() else {
            panic!("one insertion: {:?}", plan.edits);
        };
        let mut planned = target.to_string();
        planned.replace_range(insert.span.start..insert.span.end, &insert.text);
        assert_eq!(planned, expected, "{mode}: the plan");

        ws.invoke_command(NOTES_MERGE, args, InvokeMode::Apply, Actor::User)
            .unwrap();
        assert_eq!(
            ws.read_source(&DocId::new("target.md")).unwrap(),
            expected,
            "{mode}: what the merge wrote is not what its plan showed"
        );
    }
}

/// **In testa vuol dire in testa al contenuto**: dopo il BOM e il frontmatter
/// della destinazione, che restano dove un lettore li cerca. Il BOM di una
/// sorgente non entra in mezzo al testo, e una sorgente che ha soltanto il BOM è
/// vuota. La riga vuota dopo il frontmatter resta sua, un `---` indentato
/// dentro un valore YAML non lo chiude, e conta anche un frontmatter che il
/// provider non sa leggere. Un frontmatter non chiuso, o in una
/// prosa che non lo legge, è testo, e il corpo va prima.
///
/// L'offset 0 è prima del BOM: il corpo entrava lì, il frontmatter non era più
/// in testa e le sue proprietà diventavano testo.
#[test]
fn a_prepended_merge_goes_after_the_bom_and_the_frontmatter() {
    for (into, target, expected) in [
        (
            "target.md",
            "\u{feff}---\ntitle: T\n---\nTarget Content",
            "\u{feff}---\ntitle: T\n---\nContent A\n\nTarget Content",
        ),
        (
            "target.md",
            "---\r\ntitle: T\r\n---\r\nTarget Content",
            "---\r\ntitle: T\r\n---\r\nContent A\n\nTarget Content",
        ),
        (
            "target.md",
            "---\ntitle: T\n---",
            "---\ntitle: T\n---\nContent A\n\n",
        ),
        (
            "target.md",
            "\u{feff}Target Content",
            "\u{feff}Content A\n\nTarget Content",
        ),
        (
            "target.md",
            "---\nt: T\n---\n\nTarget Content",
            "---\nt: T\n---\n\nContent A\n\nTarget Content",
        ),
        (
            "target.md",
            "---\r\nt: T\r\n---\r\n\r\nTarget Content",
            "---\r\nt: T\r\n---\r\n\r\nContent A\n\nTarget Content",
        ),
        (
            "target.md",
            "---\ndesc: |\n  ---\nt: T\n---\nTarget Content",
            "---\ndesc: |\n  ---\nt: T\n---\nContent A\n\nTarget Content",
        ),
        (
            "target.md",
            "---\n[non letto\n---\nTarget Content",
            "---\n[non letto\n---\nContent A\n\nTarget Content",
        ),
        (
            "target.md",
            "---\nnon chiuso\nTarget Content",
            "Content A\n\n---\nnon chiuso\nTarget Content",
        ),
        (
            "target.txt",
            "\u{feff}---\ntitle: T\n---\nTarget Content",
            "\u{feff}Content A\n\n---\ntitle: T\n---\nTarget Content",
        ),
    ] {
        let vault = Vault::new();
        vault.put("a.md", "\u{feff}Content A");
        vault.put("vuota.md", "\u{feff}\n");
        vault.put(into, target);
        let mut ws = vault.open();
        let args = serde_json::json!({
            "from": ["a.md", "vuota.md"], "into": into, "mode": "prepend", "trash": true,
        });
        let plan = ws
            .invoke_command(NOTES_MERGE, args.clone(), InvokeMode::DryRun, Actor::User)
            .unwrap();
        let CommandEffect::Plan(plan) = plan.effect else {
            panic!("a dry run plans: {:?}", plan.effect);
        };
        let [insert] = plan.edits[0].edit.edits.as_slice() else {
            panic!("one insertion: {:?}", plan.edits);
        };
        let mut planned = target.to_string();
        planned.replace_range(insert.span.start..insert.span.end, &insert.text);
        assert_eq!(planned, expected, "{target:?}: the plan");

        ws.invoke_command(NOTES_MERGE, args, InvokeMode::Apply, Actor::User)
            .unwrap();
        assert_eq!(
            ws.read_source(&DocId::new(into)).unwrap(),
            expected,
            "{target:?}: what the merge wrote"
        );
        assert!(
            !ws.documents().contains(&DocId::new("a.md")),
            "{target:?}: the merged source goes to the trash"
        );
    }
}

/// L'undo di un'unione in testa toglie i corpi nell'ordine inverso a quello in
/// cui sono entrati, e la destinazione torna com'era.
#[cfg(all(feature = "properties", feature = "commands"))]
#[test]
fn one_undo_takes_a_prepended_merge_back_out() {
    let vault = Vault::new();
    vault.put("a.md", "Content A");
    vault.put("b.md", "Content B");
    vault.put("target.md", "Target Content");
    let mut ws = vault.open_with_properties();
    ws.invoke_command(
        NOTES_MERGE,
        serde_json::json!({"from": ["a.md", "b.md"], "into": "target.md", "mode": "prepend", "trash": false}),
        InvokeMode::Apply,
        Actor::User,
    )
    .unwrap();
    ws.invoke_command(
        VAULT_UNDO,
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("one undo");
    assert_eq!(
        ws.read_source(&DocId::new("target.md")).unwrap(),
        "Target Content"
    );
}

/// Il piano di un'unione dice dove finisce il testo: se la destinazione non si
/// legge, non si sa dov'è la fine, e un piano che inserisse all'inizio
/// mentirebbe su ciò che l'applicazione farebbe.
#[test]
fn merge_dry_run_on_an_unreadable_target_plans_nothing() {
    let vault = Vault::new();
    vault.put("source.md", "source text");
    std::fs::write(vault.root.join("target.md"), b"target \xff text").unwrap();
    let mut ws = vault.open();
    let outcome = ws.invoke_command(
        NOTES_MERGE,
        serde_json::json!({"from":["source.md"], "into":"target.md", "trash": false}),
        InvokeMode::DryRun,
        Actor::User,
    );
    assert!(
        matches!(outcome, Err(fub_abi::PluginError::Io(_))),
        "{outcome:?}"
    );
}

/// **Un template senza `{{selection}}` non fa sparire la selezione** (difetto
/// I21).
///
/// La sorgente la sostituisce con un link in ogni caso: se il template non
/// diceva dove metterla, la nota nuova nasceva senza, e il testo non stava più
/// da nessuna parte. Va in coda al template, dopo una riga vuota; dove il
/// segnaposto c'è, resta dove dice lui.
#[test]
fn extract_keeps_the_selection_when_the_template_does_not_place_it() {
    for (template, expected) in [
        (
            "# Template Header\nSome boilerplate text.\n",
            "# Template Header\nSome boilerplate text.\n\nvery important",
        ),
        (
            "# Header\r\nboilerplate",
            "# Header\r\nboilerplate\r\n\r\nvery important",
        ),
        ("> {{selection}}\n— fine\n", "> very important\n— fine\n"),
    ] {
        let vault = Vault::new();
        let source = "Initial source text that is very important";
        vault.put("source.md", source);
        vault.put("templates/simple.md", template);
        let mut ws = vault.open();
        let at = source.find("very important").unwrap();
        ws.set_active_context(Some(
            fub_abi::session::ViewContext::new("main")
                .with_doc(Some(DocId::new("source.md")))
                .with_selections(Some(fub_abi::session::SelectionSet::anchored(
                    Span::new(at, source.len()),
                    "very important",
                ))),
        ));
        ws.invoke_command(
            NOTES_EXTRACT,
            serde_json::json!({"name": "extracted_note", "template": "templates/simple"}),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap();
        assert_eq!(
            ws.read_source(&DocId::new("extracted_note.md")).unwrap(),
            expected,
            "the new note of {template:?}"
        );
        assert_eq!(
            ws.read_source(&DocId::new("source.md")).unwrap(),
            "Initial source text that is [[extracted_note]]"
        );
    }
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
