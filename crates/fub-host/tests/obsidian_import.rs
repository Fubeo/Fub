//! `settings.import_obsidian`: le scelte di `.obsidian/` diventano impostazioni
//! di Fub sull'host vero, e ciò che non si importa torna per nome.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode};
use fub_abi::settings::SettingValue;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::PluginError;
use fub_host::obsidian_import::OBSIDIAN_IMPORT;
use fub_host::Host;
use serde_json::json;

fn vault(files: &[(&str, &str)]) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).unwrap();
    std::fs::create_dir(&root).unwrap();
    for (name, text) in files {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    let host = Host::without_watcher();
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    (dir, root, host)
}

fn import(host: &Host, mode: InvokeMode) -> Result<CommandOutcome, PluginError> {
    host.invoke_user_command(None, OBSIDIAN_IMPORT, json!({}), mode)
}

fn value(host: &Host, key: &str) -> SettingValue {
    match host
        .query_index(None, IndexQuery::Settings { plugin: None })
        .unwrap()
    {
        IndexResult::Settings(entries) => {
            entries
                .into_iter()
                .find(|entry| entry.spec.key == key)
                .unwrap_or_else(|| panic!("{key} è dichiarata"))
                .value
        }
        other => panic!("{other:?}"),
    }
}

fn payload(outcome: &CommandOutcome) -> serde_json::Value {
    match &outcome.effect {
        CommandEffect::Custom { ns, payload } if ns == "fub.settings.imported" => payload.clone(),
        other => panic!("l'esito dice cosa è stato importato: {other:?}"),
    }
}

const APP: &str = r#"{
  "attachmentFolderPath": "./allegati",
  "newFileLocation": "current",
  "useMarkdownLinks": true,
  "newLinkFormat": "relative",
  "promptDelete": false,
  "readableLineLength": false
}"#;

#[test]
fn the_choices_of_obsidian_become_settings_and_its_files_stay() {
    let (_dir, root, host) = vault(&[("Nota.md", "# Nota\n"), (".obsidian/app.json", APP)]);
    let outcome = import(&host, InvokeMode::Apply).expect("importa");
    assert_eq!(
        value(&host, "files.attachment-folder"),
        SettingValue::Text("./allegati".into())
    );
    assert_eq!(
        value(&host, "files.new-note-folder"),
        SettingValue::Text("./".into())
    );
    assert_eq!(
        value(&host, "files.link-style"),
        SettingValue::Text("markdown".into())
    );
    assert_eq!(
        value(&host, "files.link-format"),
        SettingValue::Text("relative".into())
    );
    assert_eq!(
        value(&host, "files.confirm-trash"),
        SettingValue::Toggle(false)
    );
    let report = payload(&outcome);
    assert_eq!(report["written"].as_array().unwrap().len(), 5);
    assert_eq!(
        report["lost"],
        json!([{ "from": "app.json:readableLineLength", "why": "no_equivalent" }])
    );
    // I file di Obsidian si leggono soltanto.
    assert_eq!(
        std::fs::read_to_string(root.join(".obsidian/app.json")).unwrap(),
        APP
    );

    // Una seconda volta non c'è niente da cambiare.
    let again = payload(&import(&host, InvokeMode::Apply).unwrap());
    assert_eq!(again["written"], json!([]));
    assert_eq!(again["same"].as_array().unwrap().len(), 5);
}

#[test]
fn the_dry_run_names_the_changes_and_writes_nothing() {
    let (_dir, _root, host) = vault(&[("Nota.md", "# Nota\n"), (".obsidian/app.json", APP)]);
    let before = value(&host, "files.link-style");
    let outcome = import(&host, InvokeMode::DryRun).expect("prova");
    assert!(
        matches!(outcome.effect, CommandEffect::Plan(_)),
        "{:?}",
        outcome.effect
    );
    assert_eq!(value(&host, "files.link-style"), before);
}

#[test]
fn a_vault_without_obsidian_says_so() {
    let (_dir, _root, host) = vault(&[("Nota.md", "# Nota\n")]);
    assert!(matches!(
        import(&host, InvokeMode::Apply),
        Err(PluginError::NotFound(_))
    ));
}

#[test]
fn a_broken_file_is_an_error_and_changes_nothing() {
    let (_dir, _root, host) = vault(&[
        ("Nota.md", "# Nota\n"),
        (".obsidian/app.json", APP),
        (".obsidian/appearance.json", "{ non è json"),
    ]);
    let before = value(&host, "files.link-style");
    assert!(matches!(
        import(&host, InvokeMode::Apply),
        Err(PluginError::BadArgs(_))
    ));
    assert_eq!(value(&host, "files.link-style"), before);
}

#[cfg(unix)]
#[test]
fn a_link_that_leaves_the_vault_is_not_followed() {
    let (dir, root, host) = vault(&[("Nota.md", "# Nota\n")]);
    let outside = dir.path().join("fuori");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("app.json"), APP).unwrap();
    std::os::unix::fs::symlink(&outside, root.join(".obsidian")).unwrap();
    let before = value(&host, "files.link-style");
    assert!(import(&host, InvokeMode::Apply).is_err());
    assert_eq!(value(&host, "files.link-style"), before);
}
