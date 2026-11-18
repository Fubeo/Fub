#![cfg(all(feature = "recipes", feature = "properties"))]
//! **L'host trova, adotta, scarta e prova le ricette** (`crate::recipes`).
//!
//! Un `Host` vero su un vault temporaneo, senza rilevatore (le note si
//! scrivono prima di aprire, o si cambiano sul disco e si rileggono): la
//! ricetta proposta, adottata, cambiata e smontata; l'impronta vecchia
//! rifiutata; due note con lo stesso id; un'altra macchina; lo scarto; la prova
//! che non scrive; la riapertura che non riscrive le impostazioni; e i casi
//! limite della cartella, del limite, dei comandi che spariscono, del permesso
//! spento a mano e dell'id già preso da un bundle installato.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::error::PluginError;
use fub_abi::options::permission::RUN_COMMAND;
use fub_abi::settings::{permission_key, SettingValue};
use fub_abi::traits::{Plugin, PluginManifest};
use fub_host::registry::{Bundle, BundleKind, Registrar};
use fub_host::{Host, OnlyProviders, RecipeInfo, RecipeList, RecipeStatus};

const NOTA: &str = "Idee.md";
const TESTO: &str = "# Idee\n\nUna riga da archiviare.\n";
const RICETTA: &str = "Recipes/Archivia.md";
const COMANDO: &str = "recipe.archivia:run";
const BUNDLE: &str = "recipe.archivia";

/// La ricetta «archivia» del contratto, col titolo `title`.
fn archivia(title: &str) -> String {
    format!(
        r#"fub-recipe: 1
id: archivia
title: {title}
description: Segna la data e sposta la nota in Archivio.
steps:
  - run: note.property.set
    args: {{ doc: "{{{{doc}}}}", key: archiviata, value: "{{{{date}}}}" }}
  - run: note.rename
    args: {{ doc: "{{{{doc}}}}", to: "Archivio/{{{{title}}}}.md" }}"#
    )
}

/// Una ricetta di un passo, con l'id dato.
fn segna(id: &str) -> String {
    format!(
        r#"fub-recipe: 1
id: {id}
title: Segna {id}
description: Segna la nota come letta.
steps:
  - run: note.property.set
    args: {{ doc: "{{{{doc}}}}", key: letta, value: "sì" }}"#
    )
}

fn note(yaml: &str) -> String {
    format!("# Ricetta\n\nTesto libero per chi legge.\n\n```fub-recipe\n{yaml}\n```\n")
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        let vault = Vault { _dir: dir, root };
        vault.write(NOTA, TESTO);
        vault
    }

    fn write(&self, rel: &str, text: &str) {
        let path = self.root.join(rel);
        std::fs::create_dir_all(path.parent().expect("una cartella")).expect("la cartella");
        std::fs::write(path, text).expect("la nota");
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).expect("la nota c'è")
    }

    fn exists(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }

    /// Un host di questa macchina, col vault aperto.
    fn open(&self) -> Host {
        let host = Host::without_watcher();
        self.reopen(&host);
        host
    }

    fn reopen(&self, host: &Host) {
        host.open(&self.root).expect("il vault si apre");
    }

    fn close(&self, host: &Host) {
        let canonical = std::fs::canonicalize(&self.root).expect("la radice");
        let canonical = Utf8PathBuf::from_path_buf(canonical).expect("utf8");
        host.close_vault(&canonical).expect("il vault si chiude");
    }
}

fn list(host: &Host) -> RecipeList {
    host.recipes(None).expect("l'elenco delle ricette")
}

fn only(host: &Host) -> RecipeInfo {
    let list = list(host);
    assert_eq!(list.recipes.len(), 1, "una ricetta sola: {list:?}");
    list.recipes.into_iter().next().unwrap()
}

fn has_command(host: &Host, id: &str) -> bool {
    host.commands(None)
        .expect("i comandi")
        .iter()
        .any(|spec| spec.id == id)
}

fn adopted(host: &Host, root: &Utf8Path) -> std::collections::BTreeMap<String, String> {
    let canonical = std::fs::canonicalize(root).expect("la radice");
    host.vault_registry()
        .list()
        .into_iter()
        .find(|entry| Utf8Path::new(&entry.root).as_std_path() == canonical)
        .map(|entry| entry.recipes_adopted)
        .unwrap_or_default()
}

fn adopt(host: &Host, info: &RecipeInfo) -> Result<(), PluginError> {
    host.adopt_recipe(
        None,
        info.id.as_deref().expect("un id"),
        info.fingerprint.as_deref().expect("un'impronta"),
    )
}

fn codes(info: &RecipeInfo) -> Vec<&str> {
    info.problems.iter().map(|p| p.code.as_str()).collect()
}

#[test]
fn proposta_adottata_poi_cambiata_e_smontata() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();

    let info = only(&host);
    assert_eq!(info.id.as_deref(), Some("archivia"));
    assert_eq!(info.title, "Archivia la nota");
    assert_eq!(info.doc.as_str(), RICETTA);
    assert_eq!(info.status, RecipeStatus::Proposed);
    assert_eq!(info.command.as_deref(), Some(COMANDO));
    assert!(info.problems.is_empty(), "{:?}", info.problems);
    assert!(!info.mounted && !info.allowed);
    assert_eq!(info.steps.len(), 2);
    assert_eq!(info.steps[0].run, "note.property.set");
    assert!(info.steps[0].writes && info.steps[0].reversible);
    assert!(info.steps[0].title.is_some(), "il titolo vero del comando");
    assert!(!has_command(&host, COMANDO), "una proposta non gira");

    adopt(&host, &info).expect("la ricetta si adotta");
    let info = only(&host);
    assert_eq!(info.status, RecipeStatus::Adopted);
    assert!(info.mounted && info.allowed, "{info:?}");
    assert!(has_command(&host, COMANDO));
    assert_eq!(
        adopted(&host, &vault.root).get("archivia"),
        info.fingerprint.as_ref()
    );

    // Il bundle: una ricetta, non un componente, e il permesso nomina i
    // comandi dei passi e niente altro.
    let bundle = host
        .bundles(None)
        .unwrap()
        .into_iter()
        .find(|bundle| bundle.id == BUNDLE)
        .expect("il bundle della ricetta");
    assert_eq!(bundle.kind, BundleKind::Recipe);
    assert_eq!(bundle.trust, fub_kernel::Trust::Community);
    assert_eq!(
        bundle.permissions.keys().collect::<Vec<_>>(),
        vec![RUN_COMMAND]
    );
    assert_eq!(
        bundle.permissions.get(RUN_COMMAND),
        Some(&serde_json::json!(["note.property.set", "note.rename"]))
    );
    // Una ricetta non si accende né si spegne dalla pagina dei componenti.
    assert!(host.set_plugin_enabled(None, BUNDLE, false).is_err());

    // Gira, e nella lingua di chi la usa.
    let outcome = host
        .invoke_user_command(
            None,
            COMANDO,
            serde_json::json!({ "doc": NOTA }),
            InvokeMode::Apply,
        )
        .expect("la ricetta gira");
    assert!(outcome.partial.is_none(), "{outcome:?}");
    assert!(!vault.exists(NOTA));
    assert!(vault.read("Archivio/Idee.md").contains("archiviata: "));

    // La nota della ricetta cambia: la ricetta torna da guardare, e smette di
    // girare finché la persona non la riguarda.
    vault.write(RICETTA, &note(&archivia("Archivia e basta")));
    let changed = only(&host);
    assert_eq!(changed.status, RecipeStatus::Changed);
    assert_ne!(changed.fingerprint, info.fingerprint);
    assert!(!changed.mounted);
    assert!(!has_command(&host, COMANDO), "il testo cambiato non gira");
    assert!(
        !host.bundles(None).unwrap().iter().any(|b| b.id == BUNDLE),
        "il bundle è smontato e dimenticato"
    );
    assert_eq!(
        adopted(&host, &vault.root).get("archivia"),
        info.fingerprint.as_ref(),
        "l'adozione di prima resta scritta"
    );

    // Riguardata e riaccesa, gira il testo nuovo.
    adopt(&host, &changed).expect("si riadotta");
    let again = only(&host);
    assert_eq!(again.status, RecipeStatus::Adopted);
    assert!(again.mounted);
}

#[test]
fn l_impronta_vista_non_e_quella_di_ora_e_rifiutata() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();
    let seen = only(&host);
    vault.write(RICETTA, &note(&archivia("Un altro titolo")));

    let refused = adopt(&host, &seen);
    assert!(
        matches!(refused, Err(PluginError::Conflict(_))),
        "{refused:?}"
    );
    let said = refused.unwrap_err();
    assert!(
        said.message()
            .as_literal()
            .is_some_and(|s| s.contains("archivia")),
        "l'errore è già una frase, non una chiave: {said:?}"
    );
    assert!(adopted(&host, &vault.root).is_empty(), "niente è adottato");
    let now = only(&host);
    assert_eq!(now.status, RecipeStatus::Proposed);
    assert!(!now.mounted);

    let unknown = host.adopt_recipe(None, "non-c-e", "x");
    assert!(
        matches!(unknown, Err(PluginError::NotFound(_))),
        "{unknown:?}"
    );
}

#[test]
fn due_note_con_lo_stesso_id_nessuna_si_monta() {
    let vault = Vault::new();
    vault.write("Recipes/Uno.md", &note(&segna("segna")));
    vault.write("Recipes/Due.md", &note(&segna("segna")));
    let host = vault.open();

    let list = list(&host);
    assert_eq!(list.recipes.len(), 2);
    for info in &list.recipes {
        assert_eq!(info.status, RecipeStatus::Problems);
        assert_eq!(codes(info), vec!["id-ripetuto"]);
        assert!(!info.mounted);
    }
    let refused = adopt(&host, &list.recipes[0]);
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );

    // Anche adottata a mano nel registro, una delle due non si monta.
    let canonical =
        Utf8PathBuf::from_path_buf(std::fs::canonicalize(&vault.root).unwrap()).unwrap();
    host.vault_registry()
        .adopt_recipe(
            &canonical,
            "segna",
            list.recipes[0].fingerprint.as_deref().unwrap(),
        )
        .unwrap();
    assert!(list_of(&host).iter().all(|info| !info.mounted));
    assert!(!has_command(&host, "recipe.segna:run"));
}

fn list_of(host: &Host) -> Vec<RecipeInfo> {
    list(host).recipes
}

#[test]
fn un_altra_macchina_la_vede_proposta() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let here = vault.open();
    adopt(&here, &only(&here)).expect("adottata qui");
    vault.close(&here);

    // Un'altra macchina: un registro dei vault vuoto.
    let there = vault.open();
    let info = only(&there);
    assert_eq!(info.status, RecipeStatus::Proposed);
    assert!(!info.mounted);
    assert!(!has_command(&there, COMANDO));
}

#[test]
fn scartare_smonta_e_toglie_l_impronta() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();
    adopt(&host, &only(&host)).expect("adottata");
    assert!(has_command(&host, COMANDO));

    host.discard_recipe(None, "archivia").expect("scartata");
    let info = only(&host);
    assert_eq!(info.status, RecipeStatus::Proposed);
    assert!(!info.mounted);
    assert!(!has_command(&host, COMANDO));
    assert!(adopted(&host, &vault.root).is_empty());

    let again = host.discard_recipe(None, "archivia");
    assert!(matches!(again, Err(PluginError::NotFound(_))), "{again:?}");
}

#[test]
fn la_prova_non_scrive_e_nomina_le_due_note() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();

    // Anche non adottata.
    let plan = host
        .simulate_recipe(None, "archivia", serde_json::json!({ "doc": NOTA }))
        .expect("la prova riesce");
    let docs: Vec<&str> = plan.docs.iter().map(|doc| doc.as_str()).collect();
    assert!(docs.contains(&NOTA), "{docs:?}");
    assert!(docs.contains(&"Archivio/Idee.md"), "{docs:?}");
    assert!(
        plan.summary
            .as_literal()
            .is_some_and(|s| s.contains("Archivia la nota")),
        "il riassunto è già nella lingua di chi guarda: {:?}",
        plan.summary
    );
    assert_eq!(vault.read(NOTA), TESTO, "la nota non è cambiata");
    assert!(!vault.exists("Archivio"));
    assert_eq!(only(&host).status, RecipeStatus::Proposed);

    // Gli argomenti che l'esecuzione rifiuterebbe, la prova li rifiuta.
    let missing = host.simulate_recipe(None, "archivia", serde_json::json!({}));
    assert!(
        matches!(missing, Err(PluginError::BadArgs(_))),
        "{missing:?}"
    );
}

#[test]
fn riaprire_un_vault_con_ricette_adottate_non_riscrive_le_impostazioni() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    vault.write(
        ".fub/settings.json",
        &serde_json::json!({"version": 1, "values": {"recipes.folder": "Recipes"}}).to_string(),
    );
    let settings = vault.root.join(".fub").join("settings.json");
    let host = vault.open();
    let before = std::fs::read(&settings).unwrap();
    let stamp = std::fs::metadata(&settings).unwrap().modified().unwrap();
    // Montare con `mount_bundle` riscriverebbe il file (riscrive
    // `plugins.disabled` anche quando non cambia): la ricetta è una voce di
    // una sorgente runtime, e adottarla non tocca il vault.
    adopt(&host, &only(&host)).expect("adottata");
    assert_eq!(std::fs::read(&settings).unwrap(), before);
    vault.close(&host);

    vault.reopen(&host);
    // La riconciliazione è dell'apertura: montata prima di ogni elenco.
    assert!(has_command(&host, COMANDO), "montata all'apertura");
    assert_eq!(std::fs::read(&settings).unwrap(), before);
    assert_eq!(
        std::fs::metadata(&settings).unwrap().modified().unwrap(),
        stamp
    );
    let info = only(&host);
    assert_eq!(info.status, RecipeStatus::Adopted);
    assert!(info.mounted && info.allowed, "il consenso è della macchina");
    assert_eq!(std::fs::read(&settings).unwrap(), before);
}

#[test]
fn la_cartella_che_non_c_e_e_le_note_che_non_sono_ricette() {
    let vault = Vault::new();
    let host = vault.open();
    assert_eq!(list(&host), RecipeList::default());
    vault.close(&host);

    vault.write("Recipes/LEGGIMI.md", "# Le ricette\n\nNessun blocco qui.\n");
    vault.write(
        "Recipes/Rotta.md",
        &note("fub-recipe: 1\nid: rotta\nsconosciuto: 1"),
    );
    vault.reopen(&host);
    let info = only(&host);
    assert_eq!(info.doc.as_str(), "Recipes/Rotta.md");
    assert_eq!(info.id, None, "il blocco non si legge intero");
    assert_eq!(info.status, RecipeStatus::Problems);
    assert!(codes(&info).contains(&"campo-sconosciuto"), "{info:?}");
    assert!(
        info.problems
            .iter()
            .all(|p| p.message.as_literal().is_some()),
        "i problemi sono frasi, non chiavi: {:?}",
        info.problems
    );
}

#[test]
fn oltre_duecento_ricette_il_vault_lo_dice_una_volta() {
    let vault = Vault::new();
    for n in 0..201 {
        vault.write(
            &format!("Recipes/r-{n:03}.md"),
            &note(&segna(&format!("r-{n:03}"))),
        );
    }
    let host = vault.open();
    let list = list(&host);
    assert_eq!(list.recipes.len(), 200);
    assert_eq!(list.recipes.last().unwrap().id.as_deref(), Some("r-199"));
    assert_eq!(list.problems.len(), 1);
    assert_eq!(list.problems[0].code, "troppe");
    assert!(list.problems[0].message.as_literal().is_some());
}

#[test]
fn un_comando_che_sparisce_lascia_la_ricetta_adottata_ma_spenta() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();
    adopt(&host, &only(&host)).expect("adottata");

    host.set_plugin_enabled(None, "fub.properties", false)
        .expect("le proprietà si spengono");
    let info = only(&host);
    assert_eq!(info.status, RecipeStatus::Problems);
    assert_eq!(codes(&info), vec!["comando-sconosciuto"]);
    assert!(!info.mounted);
    assert!(
        adopted(&host, &vault.root).contains_key("archivia"),
        "resta adottata"
    );

    host.set_plugin_enabled(None, "fub.properties", true)
        .expect("le proprietà si riaccendono");
    let info = only(&host);
    assert_eq!(info.status, RecipeStatus::Adopted);
    assert!(info.mounted);
}

#[test]
fn il_componente_ricette_spento_le_spegne_tutte() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();
    adopt(&host, &only(&host)).expect("adottata");

    host.set_plugin_enabled(None, "fub.recipes", false)
        .expect("spento");
    assert_eq!(list(&host), RecipeList::default());
    assert!(!has_command(&host, COMANDO));
    assert!(adopted(&host, &vault.root).contains_key("archivia"));
    let refused = host.simulate_recipe(None, "archivia", serde_json::json!({ "doc": NOTA }));
    assert!(
        matches!(refused, Err(PluginError::NotFound(_))),
        "{refused:?}"
    );

    host.set_plugin_enabled(None, "fub.recipes", true)
        .expect("riacceso");
    assert!(only(&host).mounted);
}

#[test]
fn il_permesso_spento_a_mano_lo_dice_e_il_guard_rifiuta() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();
    adopt(&host, &only(&host)).expect("adottata");

    host.set_setting_for_user(
        None,
        &permission_key(BUNDLE, RUN_COMMAND),
        SettingValue::Toggle(false),
    )
    .expect("la persona spegne il permesso");
    let info = only(&host);
    assert_eq!(info.status, RecipeStatus::Adopted);
    assert!(info.mounted && !info.allowed, "{info:?}");
    let refused = host.invoke_user_command(
        None,
        COMANDO,
        serde_json::json!({ "doc": NOTA }),
        InvokeMode::Apply,
    );
    assert!(refused.is_err(), "il Guard rifiuta i passi: {refused:?}");
    assert_eq!(vault.read(NOTA), TESTO);

    // Riadottare è di nuovo il consenso.
    adopt(&host, &only(&host)).expect("riadottata");
    assert!(only(&host).allowed);
}

/// Un bundle installato che si chiama già come il bundle della ricetta.
struct Abusivo;

impl Bundle for Abusivo {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(BUNDLE, "Un componente qualunque")
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        Vec::new()
    }
}

#[test]
fn un_bundle_che_ha_gia_il_nome_lascia_la_ricetta_spenta() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();
    host.remember_unclaimed_bundle(None, Arc::new(Abusivo))
        .expect("il bundle si ricorda");

    let info = only(&host);
    assert_eq!(info.status, RecipeStatus::Problems);
    assert_eq!(codes(&info), vec!["id-occupato"]);
    assert!(matches!(adopt(&host, &info), Err(PluginError::BadArgs(_))));
    let bundle = host
        .bundles(None)
        .unwrap()
        .into_iter()
        .find(|bundle| bundle.id == BUNDLE)
        .expect("il bundle resta com'è");
    assert_eq!(bundle.kind, BundleKind::Component);
    assert_eq!(bundle.name, "Un componente qualunque");
}

#[test]
fn una_ricetta_adottata_gira_e_si_annulla_tutta() {
    let vault = Vault::new();
    vault.write(RICETTA, &note(&archivia("Archivia la nota")));
    let host = vault.open();
    adopt(&host, &only(&host)).expect("adottata");
    let outcome = host
        .invoke_user_command(
            None,
            COMANDO,
            serde_json::json!({ "doc": NOTA }),
            InvokeMode::Apply,
        )
        .expect("gira");
    assert!(
        outcome
            .notify
            .as_ref()
            .and_then(|t| t.as_literal())
            .is_some(),
        "l'avviso è una frase: {outcome:?}"
    );
    assert!(matches!(
        outcome.effect,
        CommandEffect::Navigate { .. } | CommandEffect::Done
    ));
    host.invoke_user_command(
        None,
        "vault.undo",
        serde_json::Value::Null,
        InvokeMode::Apply,
    )
    .expect("l'annullamento riesce");
    assert_eq!(vault.read(NOTA), TESTO);
    assert!(!vault.exists("Archivio/Idee.md"));
}
