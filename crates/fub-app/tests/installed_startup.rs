//! Il composition root desktop attraversa store, restart, host e componente reale.

#[path = "../../fub-wasm-host/tests/common/mod.rs"]
mod common;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::InvokeMode;
use fub_abi::edit::Revision;
use fub_abi::settings::SettingValue;
use fub_abi::PluginError;
use fub_app_lib::startup::{installed, InstalledStartup, StartupStage};
use fub_host::{Host, NoWatcher};
use fub_wasm_host::installed::{Consent, InstallError, InstalledPlugin, InstalledPluginStore};

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

fn install_with_decision(config: &Utf8Path, enabled: bool, consent: Consent) -> InstalledPlugin {
    let store = InstalledPluginStore::open(config).expect("store");
    let plugin = store
        .install(&store.snapshot().expect("inventory"), &common::ping(""))
        .expect("installazione valida");
    if enabled {
        store
            .set_enabled(
                &store.snapshot().expect("inventory dopo install"),
                plugin.installation,
                true,
            )
            .expect("enabled persistito");
    }
    if consent != Consent::Undecided {
        store
            .set_consent(
                &store.snapshot().expect("inventory dopo enabled"),
                plugin.installation,
                consent,
            )
            .expect("consenso persistito");
    }
    store.snapshot().expect("inventory finale").plugins()[0].clone()
}

fn host(config: &Utf8Path, startup: InstalledStartup) -> (Host, InstalledPluginStore) {
    let InstalledStartup {
        store,
        bundles,
        diagnostics,
    } = startup;
    assert!(diagnostics.is_empty(), "startup inatteso: {diagnostics:?}");
    (
        Host::new()
            .with_config_dir(config)
            .with_watcher(Box::new(NoWatcher))
            .with_job_threads(1)
            .with_startup_bundles(bundles),
        store,
    )
}

#[test]
fn granted_enabled_component_crosses_a_real_restart_and_disabled_stays_metadata() {
    let config_dir = tempfile::tempdir().expect("config tempdir");
    let config = root(&config_dir);
    let installed_plugin = install_with_decision(config, true, Consent::Granted);
    let inventory_before = std::fs::read(inventory(config)).expect("inventory bytes");

    let vault_dir = tempfile::tempdir().expect("vault tempdir");
    let vault = root(&vault_dir);
    std::fs::write(vault.join("Nota.md"), NOTE).expect("nota");

    let (host, store) = host(config, installed(config).expect("startup autorizzato"));
    host.open(vault).expect("il vault resta apribile");
    host.wait_indexed(None).expect("indicizzazione conclusa");
    assert!(host
        .bundles(None)
        .expect("inventario runtime")
        .iter()
        .any(|bundle| bundle.id == ID && bundle.mounted));

    let permission =
        fub_abi::settings::permission_key(ID, fub_abi::options::permission::READ_VAULT);
    host.set_setting_for_user(None, &permission, SettingValue::Toggle(true))
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
    assert_eq!(std::fs::read(inventory(config)).unwrap(), inventory_before);
    assert!(host.close().is_empty());

    store
        .set_enabled(
            &store.snapshot().expect("inventory al toggle"),
            installed_plugin.installation,
            false,
        )
        .expect("disabled persistito");
    drop(store);

    let startup = installed(config).expect("restart disabled");
    assert!(startup.diagnostics.is_empty());
    assert!(startup.bundles.is_empty(), "disabled non entra nel runtime");
    let state = startup.store.snapshot().expect("metadata al restart");
    assert_eq!(state.plugins().len(), 1);
    assert!(!state.plugins()[0].enabled);
    assert_eq!(state.plugins()[0].consent, Consent::Granted);
    drop(state);

    let (host, _store) = self::host(config, startup);
    host.open(vault)
        .expect("vault utilizzabile senza il plugin");
    let error = host
        .invoke_user_command(None, COMMAND, serde_json::json!({}), InvokeMode::Apply)
        .expect_err("il provider disabled non è pubblicato");
    assert!(matches!(error, PluginError::UnknownCommand(_)));
    assert!(host.close().is_empty());
}

#[test]
fn startup_gate_skips_corrupt_unapproved_blobs_and_diagnoses_the_selected_one() {
    for (enabled, consent) in [
        (true, Consent::Undecided),
        (true, Consent::Denied),
        (false, Consent::Granted),
    ] {
        let dir = tempfile::tempdir().expect("config tempdir");
        let config = root(&dir);
        let plugin = install_with_decision(config, enabled, consent);
        std::fs::write(component(config, &plugin), b"blob corrotto non selezionato")
            .expect("corruzione controllata");
        let inventory_before = std::fs::read(inventory(config)).expect("inventory bytes");

        let startup = installed(config).expect("i metadata restano leggibili");
        assert!(startup.bundles.is_empty());
        assert!(
            startup.diagnostics.is_empty(),
            "il blob non selezionato non va letto: {:?}",
            startup.diagnostics
        );
        assert_eq!(std::fs::read(inventory(config)).unwrap(), inventory_before);
    }

    let dir = tempfile::tempdir().expect("config tempdir");
    let config = root(&dir);
    let plugin = install_with_decision(config, true, Consent::Granted);
    std::fs::write(component(config, &plugin), b"blob corrotto selezionato")
        .expect("corruzione controllata");
    let inventory_before = std::fs::read(inventory(config)).expect("inventory bytes");

    let startup = installed(config).expect("lo store apre");
    assert!(startup.bundles.is_empty());
    assert_eq!(startup.diagnostics.len(), 1);
    let diagnostic = &startup.diagnostics[0];
    assert_eq!(diagnostic.stage, StartupStage::Load);
    assert_eq!(diagnostic.installation, Some(plugin.installation));
    assert_eq!(diagnostic.plugin_id.as_deref(), Some(ID));
    assert!(matches!(&diagnostic.error, InstallError::Integrity(id) if *id == plugin.installation));
    assert_eq!(std::fs::read(inventory(config)).unwrap(), inventory_before);

    let dir = tempfile::tempdir().expect("config tempdir");
    let config = root(&dir);
    let plugin = install_with_decision(config, true, Consent::Granted);
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

    let startup = installed(config).expect("lo store apre");
    assert!(startup.bundles.is_empty());
    assert_eq!(startup.diagnostics.len(), 1);
    let diagnostic = &startup.diagnostics[0];
    assert_eq!(diagnostic.stage, StartupStage::Validate);
    assert_eq!(diagnostic.installation, Some(plugin.installation));
    assert_eq!(diagnostic.plugin_id.as_deref(), Some(ID));
    assert!(matches!(&diagnostic.error, InstallError::Component(_)));
    assert_eq!(std::fs::read(inventory(config)).unwrap(), inventory_before);
}
