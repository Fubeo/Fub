//! I token dei connettori passano dai comandi dell'host, non dagli argomenti
//! di un import: si salvano nella configurazione della macchina e l'elenco ne
//! dice soltanto i nomi.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_host::Host;
use serde_json::json;

fn saved(outcome: &fub_abi::command::CommandOutcome) -> serde_json::Value {
    match &outcome.effect {
        CommandEffect::Custom { ns, payload } if ns == "fub.connector.tokens" => {
            payload["saved"].clone()
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_token_is_saved_on_the_machine_and_only_its_name_comes_back() {
    let dir = tempfile::tempdir().unwrap();
    let config = Utf8PathBuf::from_path_buf(dir.path().join("config")).unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).unwrap();
    std::fs::create_dir_all(&config).unwrap();
    std::fs::create_dir(&root).unwrap();
    let host = Host::without_watcher().with_config_dir(&config);
    host.open(&root).unwrap();

    let specs = host.commands(None).unwrap();
    assert!(specs.iter().any(|spec| spec.id == "connector.token"));
    assert!(specs.iter().any(|spec| spec.id == "connector.tokens"));

    let outcome = host
        .invoke_user_command(
            None,
            "connector.token",
            json!({ "connector": "airtable", "token": "pat_segreto" }),
            InvokeMode::Apply,
        )
        .unwrap();
    assert_eq!(saved(&outcome), json!(["airtable"]));
    assert!(!format!("{outcome:?}").contains("pat_segreto"));
    let said = format!("{:?}", outcome.notify);
    assert!(
        said.contains("Airtable") && !said.contains("host.connector"),
        "{said}"
    );
    let file = config.join("connectors/airtable.token");
    assert_eq!(
        std::fs::read_to_string(&file).unwrap().trim(),
        "pat_segreto"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&file).unwrap().permissions().mode();
        assert_eq!(mode & 0o077, 0, "solo il proprietario: {mode:o}");
    }
    assert!(
        !root.join(".fub").join("connectors").exists(),
        "niente nel vault"
    );

    let listed = host
        .invoke_user_command(None, "connector.tokens", json!({}), InvokeMode::Apply)
        .unwrap();
    assert_eq!(saved(&listed), json!(["airtable"]));
}
