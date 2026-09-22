//! Il composition root desktop attraversa manager, restart, host e componente reale.

#[path = "../../fub-wasm-host/tests/common/mod.rs"]
mod common;

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::InvokeMode;
use fub_abi::edit::Revision;
use fub_abi::settings::SettingValue;
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher, StartupSource};
use fub_wasm_host::installed::{Consent, InstalledPlugin};
use fub_wasm_host::managed::InstalledPluginManager;

const ID: &str = "demo.ping";
const COMMAND: &str = "demo.ping:conta";
const NOTE: &str = "# Nota dal restart\n";

fn root(dir: &tempfile::TempDir) -> &Utf8Path {
    Utf8Path::from_path(dir.path()).expect("path UTF-8")
}

fn inventory(config: &Utf8Path) -> Utf8PathBuf {
    config.join("wasm-plugins/inventory.json")
}

fn component(config: &Utf8Path, plugin: &InstalledPlugin) -> Utf8PathBuf {
    config.join("wasm-plugins/components").join(format!(
        "{}-{}.wasm",
        plugin.installation,
        plugin.digest.0.trim_start_matches("sha256:")
    ))
}

fn configured_host(config: &Utf8Path, manager: Arc<InstalledPluginManager>) -> Host {
    Host::new()
        .with_config_dir(config)
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1)
        .with_startup_source(manager)
}

fn installed_record(manager: &InstalledPluginManager, installation: u64) -> InstalledPlugin {
    manager
        .store()
        .snapshot()
        .expect("inventario")
        .plugins()
        .iter()
        .find(|plugin| plugin.installation == installation)
        .expect("installazione presente")
        .clone()
}

#[test]
fn desktop_manager_lifecycle_survives_restarts_and_preserves_authoritative_data() {
    let config_dir = tempfile::tempdir().expect("config tempdir");
    let config = root(&config_dir);
    let vault_dir = tempfile::tempdir().expect("vault tempdir");
    let vault = root(&vault_dir);
    std::fs::write(vault.join("Nota.md"), NOTE).expect("nota");

    let manager = Arc::new(InstalledPluginManager::open(config).expect("manager installato"));
    let host = configured_host(config, manager.clone());
    let installed = manager
        .install(&common::ping(""))
        .expect("installazione scelta dalla shell");
    assert!(!installed.enabled);
    assert_eq!(installed.consent, Consent::Undecided);
    assert!(!installed.bundle.mounted);
    assert!(!installed.runtime_known);
    let installed_component =
        component(config, &installed_record(&manager, installed.installation));

    host.open(vault).expect("il vault resta apribile");
    host.wait_indexed(None).expect("indicizzazione conclusa");
    assert!(manager
        .set_consent(&host, installed.installation, Consent::Granted)
        .expect("consenso persistito")
        .is_empty());
    assert!(manager
        .set_enabled(&host, installed.installation, true)
        .expect("enabled persistito")
        .is_empty());
    let inventory_before_command = std::fs::read(inventory(config)).expect("inventory bytes");

    let listed = manager
        .list(&host, Some(vault.as_str()))
        .expect("lista installata");
    assert_eq!(listed.len(), 1);
    assert!(listed[0].enabled);
    assert_eq!(listed[0].consent, Consent::Granted);
    assert!(listed[0].runtime_known);
    assert!(listed[0].bundle.mounted);

    let permission =
        fub_abi::settings::permission_key(ID, fub_abi::options::permission::READ_VAULT);
    assert!(matches!(
        host.invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply),
        Err(PluginError::PermissionDenied(_))
    ));
    host.set_setting_for_user(
        Some(vault.as_str()),
        &permission,
        SettingValue::Toggle(true),
    )
    .expect("permesso esplicito");
    let outcome = host
        .invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply)
        .expect("comando WASM");
    assert_eq!(
        outcome
            .notify
            .expect("il comando restituisce il risultato")
            .as_literal(),
        Some(format!("{} caratteri", NOTE.chars().count()).as_str())
    );
    assert_eq!(
        std::fs::read(inventory(config)).expect("inventory after command"),
        inventory_before_command
    );

    assert!(manager
        .set_enabled(&host, installed.installation, false)
        .expect("disable esegue teardown")
        .is_empty());
    let after_toggle = manager
        .list(&host, Some(vault.as_str()))
        .expect("metadata dopo toggle");
    assert!(!after_toggle[0].enabled);
    assert!(after_toggle[0].runtime_known);
    assert!(!after_toggle[0].bundle.mounted);
    assert!(matches!(
        host.invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply),
        Err(PluginError::UnknownCommand(_))
    ));
    assert!(
        !host
            .bundles(Some(vault.as_str()))
            .expect("runtime inventory dopo teardown")
            .iter()
            .find(|bundle| bundle.id == ID)
            .expect("installazione resta nota nel runtime")
            .mounted
    );

    assert!(host.close().is_empty());
    manager
        .shutdown()
        .expect("manager chiuso prima del restart");
    drop(host);
    drop(manager);

    let restarted = Arc::new(InstalledPluginManager::open(config).expect("manager al restart"));
    let restarted_host = configured_host(config, restarted.clone());
    let persisted = restarted
        .list(&restarted_host, None)
        .expect("metadata persistiti");
    assert_eq!(persisted.len(), 1);
    assert!(!persisted[0].enabled);
    assert_eq!(persisted[0].consent, Consent::Granted);
    assert!(!persisted[0].runtime_known);
    assert!(!persisted[0].bundle.mounted);

    restarted_host
        .open(vault)
        .expect("vault utilizzabile senza il plugin disabilitato");
    restarted_host
        .wait_indexed(None)
        .expect("indicizzazione al restart");
    let disabled = restarted
        .list(&restarted_host, Some(vault.as_str()))
        .expect("metadata disabled al restart");
    assert!(!disabled[0].enabled);
    assert!(!disabled[0].runtime_known);
    assert!(!disabled[0].bundle.mounted);
    assert!(matches!(
        restarted_host.invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply),
        Err(PluginError::UnknownCommand(_))
    ));

    assert!(restarted
        .set_enabled(&restarted_host, installed.installation, true)
        .expect("enabled dopo restart")
        .is_empty());
    let enabled_again = restarted
        .list(&restarted_host, Some(vault.as_str()))
        .expect("metadata enabled dopo restart");
    assert!(enabled_again[0].enabled);
    assert!(enabled_again[0].runtime_known);
    assert!(enabled_again[0].bundle.mounted);
    restarted_host
        .invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply)
        .expect("capability concessa resta utilizzabile");
    assert!(restarted_host.close().is_empty());
    restarted
        .shutdown()
        .expect("manager chiuso dopo il riavvio disabled");
    drop(restarted_host);
    drop(restarted);

    let enabled_restart =
        Arc::new(InstalledPluginManager::open(config).expect("manager al restart enabled"));
    let enabled_host = configured_host(config, enabled_restart.clone());
    enabled_host
        .open(vault)
        .expect("vault riaperto con plugin enabled");
    enabled_host
        .wait_indexed(None)
        .expect("indicizzazione al restart enabled");
    let enabled_persisted = enabled_restart
        .list(&enabled_host, Some(vault.as_str()))
        .expect("metadata enabled al restart");
    assert!(enabled_persisted[0].enabled);
    assert_eq!(enabled_persisted[0].consent, Consent::Granted);
    assert!(enabled_persisted[0].runtime_known);
    assert!(enabled_persisted[0].bundle.mounted);
    enabled_host
        .invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply)
        .expect("comando disponibile dopo restart enabled");

    assert!(enabled_restart
        .set_enabled(&enabled_host, installed.installation, false)
        .expect("disable prima della rimozione")
        .is_empty());
    let plugin_data = vault.join(".fub/plugins/demo.ping/authoritative.bin");
    std::fs::create_dir_all(plugin_data.parent().expect("plugin data parent"))
        .expect("plugin data directory");
    std::fs::write(&plugin_data, b"authoritative plugin data").expect("plugin data write");
    assert!(enabled_restart
        .remove(&enabled_host, installed.installation)
        .expect("rimozione da disabled")
        .is_empty());
    assert!(enabled_restart
        .list(&enabled_host, Some(vault.as_str()))
        .expect("metadata dopo rimozione")
        .is_empty());
    assert!(!installed_component.exists(), "blob installato rimosso");

    assert!(!enabled_host
        .bundles(Some(vault.as_str()))
        .expect("runtime inventory dopo rimozione")
        .iter()
        .any(|bundle| bundle.id == ID));
    assert_eq!(
        std::fs::read(&plugin_data).expect("dati autorevoli preservati"),
        b"authoritative plugin data"
    );
    assert!(enabled_host.close().is_empty());
    enabled_restart.shutdown().expect("manager restart chiuso");
}

#[test]
fn startup_source_skips_corrupt_unapproved_blobs_and_diagnoses_the_selected_one() {
    for (enabled, consent) in [
        (true, Consent::Undecided),
        (true, Consent::Denied),
        (false, Consent::Granted),
    ] {
        let dir = tempfile::tempdir().expect("config tempdir");
        let config = root(&dir);
        let manager = Arc::new(InstalledPluginManager::open(config).expect("manager"));
        let host = configured_host(config, manager.clone());
        let info = manager.install(&common::ping("")).expect("installazione");
        if enabled {
            assert!(manager
                .set_enabled(&host, info.installation, true)
                .expect("enabled")
                .is_empty());
        }
        if consent != Consent::Undecided {
            assert!(manager
                .set_consent(&host, info.installation, consent)
                .expect("consenso")
                .is_empty());
        }
        let plugin = installed_record(&manager, info.installation);
        std::fs::write(component(config, &plugin), b"blob corrotto non selezionato")
            .expect("corruzione controllata");
        let inventory_before = std::fs::read(inventory(config)).expect("inventory bytes");

        let startup = manager.prepare().expect("i metadata restano leggibili");
        assert!(startup.bundles.is_empty());
        assert!(
            startup.diagnostics.is_empty(),
            "il blob escluso non va letto"
        );
        assert_eq!(std::fs::read(inventory(config)).unwrap(), inventory_before);
    }

    let dir = tempfile::tempdir().expect("config tempdir");
    let config = root(&dir);
    let manager = Arc::new(InstalledPluginManager::open(config).expect("manager"));
    let host = configured_host(config, manager.clone());
    let info = manager.install(&common::ping("")).expect("installazione");
    manager
        .set_consent(&host, info.installation, Consent::Granted)
        .expect("consenso");
    manager
        .set_enabled(&host, info.installation, true)
        .expect("enabled");
    let plugin = installed_record(&manager, info.installation);
    std::fs::write(component(config, &plugin), b"blob corrotto selezionato")
        .expect("corruzione controllata");
    let inventory_before = std::fs::read(inventory(config)).expect("inventory bytes");

    let vault_dir = tempfile::tempdir().expect("vault tempdir");
    let vault = root(&vault_dir);
    std::fs::write(vault.join("Nota.md"), NOTE).expect("nota");
    host.open(vault).expect("il vault resta apribile");
    assert!(matches!(
        host.startup_diagnostics(None)
            .expect("diagnostica apertura")
            .as_slice(),
        [PluginError::Conflict(_)]
    ));
    let listed = manager
        .list(&host, Some(vault.as_str()))
        .expect("lista installata");
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].bundle.mounted);
    assert!(matches!(
        host.invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply),
        Err(PluginError::UnknownCommand(_))
    ));
    assert_eq!(std::fs::read(inventory(config)).unwrap(), inventory_before);
    manager.shutdown().expect("manager chiuso");
    assert!(host.close().is_empty());

    let dir = tempfile::tempdir().expect("config tempdir");
    let config = root(&dir);
    let manager = Arc::new(InstalledPluginManager::open(config).expect("manager"));
    let host = configured_host(config, manager.clone());
    let info = manager.install(&common::ping("")).expect("installazione");
    manager
        .set_consent(&host, info.installation, Consent::Granted)
        .expect("consenso");
    manager
        .set_enabled(&host, info.installation, true)
        .expect("enabled");
    let plugin = installed_record(&manager, info.installation);
    let malformed = b"byte coerenti col digest ma non un componente";
    let mut malformed_record = plugin.clone();
    malformed_record.digest = Revision::of_bytes(malformed);
    std::fs::remove_file(component(config, &plugin)).expect("ritiro blob originale");
    std::fs::write(component(config, &malformed_record), malformed)
        .expect("blob malformed pubblicato dal banco");
    let mut persisted: serde_json::Value =
        serde_json::from_slice(&std::fs::read(inventory(config)).unwrap()).unwrap();
    persisted["plugins"][0]["digest"] = malformed_record.digest.0.clone().into();
    let inventory_before = serde_json::to_vec_pretty(&persisted).unwrap();
    std::fs::write(inventory(config), &inventory_before).expect("inventory coerente col blob");

    let vault_dir = tempfile::tempdir().expect("vault tempdir");
    let vault = root(&vault_dir);
    std::fs::write(vault.join("Nota.md"), NOTE).expect("nota");
    host.open(vault).expect("il vault resta apribile");
    assert!(matches!(
        host.startup_diagnostics(None)
            .expect("diagnostica apertura")
            .as_slice(),
        [PluginError::BadArgs(_)]
    ));
    let listed = manager
        .list(&host, Some(vault.as_str()))
        .expect("lista installata");
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].bundle.mounted);
    assert!(matches!(
        host.invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply),
        Err(PluginError::UnknownCommand(_))
    ));
    assert_eq!(std::fs::read(inventory(config)).unwrap(), inventory_before);
    manager.shutdown().expect("manager chiuso");
    assert!(host.close().is_empty());
}
