#![cfg(feature = "recipes")]
//! `recipes.new` attraverso il kernel vero, come `template_e2e.rs`: la nota e
//! la cartella che nascono, il nome libero, l'impostazione della cartella, il
//! rifiuto dei titoli che sono percorsi, la prova che non scrive niente e
//! l'annullamento che porta la ricetta nel cestino.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::error::PluginError;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::settings::SettingValue;
use fub_abi::traits::PluginManifest;
use fub_features::{
    CoreCommands, RecipesCommands, COMMANDS_ID, RECIPES_FOLDER_KEY, RECIPES_ID, RECIPES_NEW,
    VAULT_UNDO,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Trust, Workspace};

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

    /// Il vault con i comandi del core, che portano `note.trash` e
    /// `vault.undo`, e con le ricette.
    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("il vault si apre");
        ws.register_plugin(
            PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            Trust::Core,
        )
        .expect("i comandi del core");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("i comandi del core");
        let mut manifest = PluginManifest::core(RECIPES_ID, RECIPES_ID)
            .speaking("it", fub_features::recipes::catalog());
        manifest.settings = RecipesCommands::settings();
        ws.register_plugin(manifest, Trust::Core)
            .expect("le ricette");
        ws.register_command_provider(RECIPES_ID, Box::new(RecipesCommands))
            .expect("le ricette");
        ws.reindex().expect("reindex");
        ws
    }

    fn exists(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }
}

fn new(ws: &mut Workspace, args: serde_json::Value) -> Result<DocId, PluginError> {
    let outcome = ws.invoke_command(RECIPES_NEW, args, InvokeMode::Apply, Actor::User)?;
    match outcome.effect {
        CommandEffect::Navigate { doc } => Ok(doc),
        other => panic!("recipes.new apre la ricetta, non {other:?}"),
    }
}

/// Il blocco `fub-recipe` della nota, letto come YAML.
fn block_of(source: &str) -> serde_json::Value {
    let open = "```fub-recipe\n";
    let start = source.find(open).expect("il blocco apre") + open.len();
    let end = start + source[start..].find("\n```").expect("il blocco chiude");
    serde_yaml_ng::from_str(&source[start..end]).expect("il blocco è YAML")
}

#[test]
fn recipes_new_crea_la_ricetta_e_l_annullamento_la_porta_nel_cestino() {
    let vault = Vault::new();
    let mut ws = vault.open();
    assert!(!vault.exists("Recipes"));

    let doc = new(&mut ws, serde_json::json!({})).expect("la ricetta nasce");
    assert_eq!(doc.as_str(), "Recipes/Nuova ricetta.md");
    assert!(
        vault.exists("Recipes/Nuova ricetta.md"),
        "la cartella è nata"
    );
    let block = block_of(&ws.read_source(&doc).expect("la nota c'è"));
    assert_eq!(block["fub-recipe"], 1);
    assert_eq!(block["id"], "nuova-ricetta");
    assert_eq!(block["title"], "Nuova ricetta");
    assert_eq!(block["steps"][0]["run"], "note.property.set");
    assert_eq!(block["steps"][1]["run"], "note.rename");

    ws.invoke_command(
        VAULT_UNDO,
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("l'annullamento riesce");
    assert!(
        !vault.exists("Recipes/Nuova ricetta.md"),
        "la ricetta è tolta"
    );
    assert!(ws.read_source(&doc).is_err());
}

#[test]
fn una_seconda_ricetta_prende_un_nome_e_un_id_liberi() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let first = new(&mut ws, serde_json::json!({ "title": "Riunione" })).expect("la prima");
    let second = new(&mut ws, serde_json::json!({ "title": "Riunione" })).expect("la seconda");
    assert_eq!(first.as_str(), "Recipes/Riunione.md");
    assert_ne!(first, second, "mai una sovrascrittura");
    let a = block_of(&ws.read_source(&first).unwrap());
    let b = block_of(&ws.read_source(&second).unwrap());
    assert_eq!(a["title"], "Riunione", "la prima non è stata toccata");
    assert_ne!(a["id"], b["id"], "due ricette nuove non si contendono l'id");
}

#[test]
fn la_cartella_viene_dall_impostazione() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.set_setting(RECIPES_FOLDER_KEY, SettingValue::Text("Azioni/Mie/".into()))
        .expect("l'impostazione si scrive");
    let doc = new(&mut ws, serde_json::json!({ "title": "Libri" })).expect("nasce");
    assert_eq!(doc.as_str(), "Azioni/Mie/Libri.md");

    // Una cartella che non si può creare vale come quella di serie.
    ws.set_setting(RECIPES_FOLDER_KEY, SettingValue::Text("../fuori".into()))
        .expect("l'impostazione si scrive");
    let doc = new(&mut ws, serde_json::json!({ "title": "Libri" })).expect("nasce");
    assert_eq!(doc.as_str(), "Recipes/Libri.md");
}

#[test]
fn un_titolo_che_e_un_percorso_e_rifiutato() {
    let vault = Vault::new();
    let mut ws = vault.open();
    for title in ["../fuori", "Sotto/cartella", "a\\b", "..", ".nascosta"] {
        let refused = new(&mut ws, serde_json::json!({ "title": title }));
        assert!(
            matches!(refused, Err(PluginError::BadArgs(_))),
            "«{title}»: {refused:?}"
        );
    }
    assert!(!vault.exists("Recipes"), "niente è nato");
}

#[test]
fn la_prova_nomina_la_nota_e_non_scrive_niente() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let outcome = ws
        .invoke_command(
            RECIPES_NEW,
            serde_json::json!({ "title": "Libri" }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("la prova riesce");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("la prova dà un piano")
    };
    assert_eq!(plan.docs, vec![DocId::new("Recipes/Libri.md")]);
    assert!(!vault.exists("Recipes"));
}
