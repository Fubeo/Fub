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

// ---------------------------------------------------------------------------
// L'esecuzione, l'annullamento e la prova di una ricetta (`RecipeCommand`)
// ---------------------------------------------------------------------------

/// Le ricette che lavorano sulle proprietà: con `properties` acceso.
#[cfg(feature = "properties")]
mod run {
    use super::*;
    use fub_abi::command::CommandOutcome;
    use fub_abi::format::{DocumentSource, ParseContext};
    use fub_abi::options::permission;
    use fub_abi::traits::PluginPermissions;
    use fub_abi::FormatProvider;
    use fub_features::recipes::{parse, RecipeCommand};
    use fub_features::{PropertiesCommands, PROPERTIES_ID};

    const NOTA: &str = "Idee.md";
    const TESTO: &str = "# Idee\n\nUna riga da archiviare.\n";

    /// La ricetta «archivia» del contratto.
    const ARCHIVIA: &str = r#"fub-recipe: 1
id: archivia
title: Archivia la nota
description: Segna la data e sposta la nota in Archivio.
steps:
  - run: note.property.set
    args: { doc: "{{doc}}", key: archiviata, value: "{{date}}" }
  - run: note.rename
    args: { doc: "{{doc}}", to: "Archivio/{{title}}.md" }"#;

    const BOTH: &[&str] = &["note.property.set", "note.rename"];

    impl Vault {
        fn write(&self, rel: &str, text: &str) {
            let path = self.root.join(rel);
            std::fs::create_dir_all(path.parent().expect("una cartella")).expect("la cartella");
            std::fs::write(path, text).expect("la nota");
        }

        fn read(&self, rel: &str) -> String {
            std::fs::read_to_string(self.root.join(rel)).expect("la nota c'è")
        }

        /// Il vault con i comandi del core, le proprietà e la ricetta `yaml`
        /// montata nel suo bundle `recipe.<id>`, con `fub:run-command` che
        /// nomina soltanto `allowed`: il consenso che l'host darà adottandola.
        fn with_recipe(&self, yaml: &str, allowed: &[&str]) -> (Workspace, String) {
            let mut ws = self.open();
            ws.register_plugin(
                PluginManifest::core(PROPERTIES_ID, PROPERTIES_ID)
                    .speaking("it", fub_features::properties::catalog()),
                Trust::Core,
            )
            .expect("le proprietà");
            ws.register_command_provider(PROPERTIES_ID, Box::new(PropertiesCommands))
                .expect("le proprietà");
            let source = format!("# Ricetta\n\n```fub-recipe\n{yaml}\n```\n");
            let model = MarkdownProvider::new()
                .parse(
                    &DocumentSource::Text(source.clone()),
                    &ParseContext::obsidian("Recipes/Ricetta.md"),
                )
                .expect("il Markdown si legge");
            let recipe = parse(&model, &source).expect("la ricetta si legge");
            let bundle = format!("recipe.{}", recipe.id);
            let command = RecipeCommand::new(recipe, &ws.commands());
            let id = command.spec().id.clone();
            let mut permissions = PluginPermissions::of(&[permission::RUN_COMMAND]);
            permissions
                .granted
                .set(permission::RUN_COMMAND, serde_json::json!(allowed));
            ws.register_plugin(
                PluginManifest::new(bundle.as_str(), bundle.as_str())
                    .granting(permissions)
                    .speaking("it", fub_features::recipes::catalog()),
                Trust::Community,
            )
            .expect("il bundle della ricetta");
            ws.register_command_provider(bundle.as_str(), Box::new(command))
                .expect("il comando della ricetta");
            ws.reindex().expect("reindex");
            (ws, id)
        }
    }

    fn run(
        ws: &mut Workspace,
        id: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        ws.invoke_command(id, args, mode, Actor::User)
    }

    fn on_the_note(ws: &mut Workspace, id: &str) -> Result<CommandOutcome, PluginError> {
        run(
            ws,
            id,
            serde_json::json!({ "doc": NOTA }),
            InvokeMode::Apply,
        )
    }

    fn undo(ws: &mut Workspace) {
        ws.invoke_command(
            VAULT_UNDO,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("l'annullamento riesce");
    }

    fn notify(outcome: &CommandOutcome) -> String {
        outcome
            .notify
            .as_ref()
            .and_then(|t| t.as_literal())
            .expect("l'avviso arriva già nella lingua di chi usa Fub")
            .to_string()
    }

    /// `archiviata: AAAA-MM-GG` nel frontmatter.
    fn archived_today(text: &str) -> bool {
        let Some(rest) = text.split("archiviata: ").nth(1) else {
            return false;
        };
        let date: String = rest.chars().take(10).collect();
        date.len() == 10
            && date.chars().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 {
                    c == '-'
                } else {
                    c.is_ascii_digit()
                }
            })
    }

    #[test]
    fn archivia_segna_la_data_sposta_la_nota_e_un_annulla_la_riporta() {
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        let (mut ws, id) = vault.with_recipe(ARCHIVIA, BOTH);
        assert_eq!(id, "recipe.archivia:run");
        assert!(!vault.exists("Archivio"));

        let outcome = on_the_note(&mut ws, &id).expect("la ricetta riesce");
        assert_eq!(outcome.partial, None);
        assert!(notify(&outcome).contains("Archivia la nota"), "{outcome:?}");
        assert!(!vault.exists(NOTA), "la nota si è spostata");
        let moved = vault.read("Archivio/Idee.md");
        assert!(archived_today(&moved), "la data è segnata:\n{moved}");
        assert!(moved.contains("Una riga da archiviare."));

        undo(&mut ws);
        assert!(!vault.exists("Archivio/Idee.md"));
        assert_eq!(vault.read(NOTA), TESTO, "testo e percorso com'erano");
    }

    #[test]
    fn la_prova_non_scrive_niente_e_nomina_i_due_documenti() {
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        let (mut ws, id) = vault.with_recipe(ARCHIVIA, BOTH);
        let outcome = run(
            &mut ws,
            &id,
            serde_json::json!({ "doc": NOTA }),
            InvokeMode::DryRun,
        )
        .expect("la prova riesce");
        let CommandEffect::Plan(plan) = outcome.effect else {
            panic!("la prova dà un piano: {outcome:?}")
        };
        assert!(plan.docs.contains(&DocId::new(NOTA)), "{:?}", plan.docs);
        assert!(
            plan.docs.contains(&DocId::new("Archivio/Idee.md")),
            "{:?}",
            plan.docs
        );
        assert_eq!(plan.edits.len(), 1, "la data, come modifica da mostrare");
        let summary = plan.summary.as_literal().expect("già nella lingua");
        assert!(summary.starts_with("«Archivia la nota»: "), "{summary}");
        assert_eq!(vault.read(NOTA), TESTO, "niente è cambiato");
        assert!(!vault.exists("Archivio"));
    }

    #[test]
    fn un_secondo_passo_che_cade_lascia_il_primo_un_partial_e_il_suo_annullamento() {
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        vault.write("Archivio/Idee.md", "occupata\n");
        let (mut ws, id) = vault.with_recipe(ARCHIVIA, BOTH);

        let outcome = on_the_note(&mut ws, &id).expect("a metà è un esito");
        let partial = outcome.partial.clone().expect("a metà");
        assert_eq!((partial.attempted, partial.done), (2, 1));
        assert_eq!(partial.failures[0].subject, Some(DocId::new(NOTA)));
        let said = notify(&outcome);
        assert!(said.contains("passo 2 (note.rename)"), "{said}");
        assert!(archived_today(&vault.read(NOTA)), "il primo passo è fatto");
        assert_eq!(vault.read("Archivio/Idee.md"), "occupata\n");

        undo(&mut ws);
        assert_eq!(vault.read(NOTA), TESTO, "l'annullamento toglie il primo");
        assert_eq!(vault.read("Archivio/Idee.md"), "occupata\n");
    }

    #[test]
    fn la_nota_spostata_al_primo_passo_non_si_trova_al_secondo() {
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        let yaml = r#"fub-recipe: 1
id: sposta-e-segna
title: Sposta e segna
description: Il secondo passo cerca la nota dov'era.
steps:
  - run: note.rename
    args: { doc: "{{doc}}", to: "Archivio/{{title}}.md" }
  - run: note.property.set
    args: { doc: "{{doc}}", key: archiviata, value: "{{date}}" }"#;
        let (mut ws, id) = vault.with_recipe(yaml, BOTH);
        let outcome = on_the_note(&mut ws, &id).expect("a metà");
        assert!(outcome.partial.is_some(), "{outcome:?}");
        assert_eq!(vault.read("Archivio/Idee.md"), TESTO);
        undo(&mut ws);
        assert_eq!(vault.read(NOTA), TESTO);
        assert!(!vault.exists("Archivio/Idee.md"));
    }

    #[test]
    fn un_passo_fuori_dall_elenco_e_rifiutato_dal_guard() {
        // Il secondo passo fuori dall'elenco: il primo resta, a metà.
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        let (mut ws, id) = vault.with_recipe(ARCHIVIA, &["note.property.set"]);
        let outcome = on_the_note(&mut ws, &id).expect("a metà");
        let partial = outcome.partial.clone().expect("a metà");
        assert!(
            matches!(partial.failures[0].error, PluginError::PermissionDenied(_)),
            "{partial:?}"
        );
        assert!(vault.exists(NOTA), "la rinomina non è avvenuta");
        undo(&mut ws);
        assert_eq!(vault.read(NOTA), TESTO);

        // Il primo passo fuori dall'elenco: l'errore, e niente cambia.
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        let (mut ws, id) = vault.with_recipe(ARCHIVIA, &["note.rename"]);
        let refused = on_the_note(&mut ws, &id);
        assert!(
            matches!(refused, Err(PluginError::PermissionDenied(_))),
            "{refused:?}"
        );
        assert_eq!(vault.read(NOTA), TESTO);
        assert!(!vault.exists("Archivio"));
    }

    #[test]
    fn un_passo_sparito_dal_registro_si_ferma_con_un_partial() {
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        let yaml = r#"fub-recipe: 1
id: sparito
title: Con un passo sparito
description: Il secondo comando non c'è più.
steps:
  - run: note.property.set
    args: { doc: "{{doc}}", key: archiviata, value: "{{date}}" }
  - run: altro.sparito
    args: { doc: "{{doc}}" }"#;
        let (mut ws, id) = vault.with_recipe(yaml, &["note.property.set", "altro.sparito"]);
        let outcome = on_the_note(&mut ws, &id).expect("a metà");
        let partial = outcome.partial.clone().expect("a metà");
        assert!(
            matches!(partial.failures[0].error, PluginError::UnknownCommand(_)),
            "{partial:?}"
        );
        undo(&mut ws);
        assert_eq!(vault.read(NOTA), TESTO);
    }

    #[test]
    fn un_passo_che_torna_senza_annullamento_lascia_la_ricetta_senza() {
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        // Togliere una proprietà che non c'è non cambia niente e torna senza
        // annullamento: la ricetta non lo distingue da un passo che non si
        // annulla, e non promette un annullamento a metà.
        let yaml = r#"fub-recipe: 1
id: senza-annulla
title: Senza annullamento
description: Il primo passo torna senza annullamento.
steps:
  - run: note.property.remove
    args: { doc: "{{doc}}", key: assente }
  - run: note.property.set
    args: { doc: "{{doc}}", key: archiviata, value: "{{date}}" }"#;
        let (mut ws, id) = vault.with_recipe(yaml, &["note.property.remove", "note.property.set"]);
        let outcome = on_the_note(&mut ws, &id).expect("riesce");
        assert_eq!(outcome.undo, None);
        assert!(
            notify(&outcome).contains("non si può annullare"),
            "{outcome:?}"
        );
        assert!(archived_today(&vault.read(NOTA)));
    }

    #[test]
    fn un_parametro_number_vuole_un_numero() {
        let vault = Vault::new();
        vault.write(NOTA, TESTO);
        let yaml = r#"fub-recipe: 1
id: numera
title: Numera
description: Segna un numero.
params:
  - name: quanti
    title: Quanti
    kind: number
    required: true
steps:
  - run: note.property.set
    args: { doc: "{{doc}}", key: numero, value: "n. {{param.quanti}}" }"#;
        let (mut ws, id) = vault.with_recipe(yaml, &["note.property.set"]);
        let refused = run(
            &mut ws,
            &id,
            serde_json::json!({ "doc": NOTA, "quanti": "5" }),
            InvokeMode::Apply,
        );
        assert!(
            matches!(refused, Err(PluginError::BadArgs(_))),
            "{refused:?}"
        );
        assert_eq!(vault.read(NOTA), TESTO);

        run(
            &mut ws,
            &id,
            serde_json::json!({ "doc": NOTA, "quanti": 5 }),
            InvokeMode::Apply,
        )
        .expect("con un numero riesce");
        assert!(vault.read(NOTA).contains("n. 5"), "{}", vault.read(NOTA));
    }
}
