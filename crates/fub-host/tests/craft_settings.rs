//! Le impostazioni delle anteprime Craft, dalla porta dell'utente e da quella
//! di un programma.
//!
//! `craft.cli-previews` è una scelta di macchina che soltanto la persona
//! cambia: un bundle che la scrive riceve `PermissionDenied`, un vault
//! importato che la porta nel suo `.fub/settings.json` non conta, e il
//! vecchio interruttore salvato da una versione di prima si legge «Chiedi la
//! prima volta» senza che il file cambi.
#![cfg(feature = "craft")]

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::{SettingEntry, SettingKind, SettingScope, SettingSource, SettingValue};
use fub_abi::traits::{HostApi, Plugin, PluginManifest, PluginPermissions};
use fub_abi::PluginError;
use fub_format_craft::RenderConsent;
use fub_host::craft::consent;
use fub_host::registry::{Bundle, Registrar};
use fub_host::settings::{
    core_settings, CRAFT_CLI_PREVIEWS, CRAFT_PREVIEW_MAX_MIB, CRAFT_TREE_SHOW_XMP,
    CRAFT_TREE_THUMBNAILS,
};
use fub_host::Host;

const ID: &str = "demo.craft-consent";
const M: u64 = 1024 * 1024;

/// Ciò che il bundle ha visto e ottenuto quando si è acceso.
#[derive(Default)]
struct Seen {
    consent: Option<RenderConsent>,
    max_bytes: Option<u64>,
    wrote_consent: Option<Result<(), PluginError>>,
    #[cfg(feature = "versioning")]
    wrote_versioning: Option<Result<(), PluginError>>,
}

type Shared = Arc<Mutex<Seen>>;

struct Probe {
    seen: Shared,
}

impl Bundle for Probe {
    fn manifest(&self) -> PluginManifest {
        manifest()
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Active {
            seen: Arc::clone(&self.seen),
        })
    }

    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        Vec::new()
    }
}

/// Il permesso di scrivere impostazioni c'è: il rifiuto, se arriva, è della
/// chiave e non del guard.
fn manifest() -> PluginManifest {
    PluginManifest::new(ID, "Demo consenso").granting(PluginPermissions::of(&[
        fub_abi::options::permission::WRITE_SETTINGS,
    ]))
}

struct Active {
    seen: Shared,
}

impl Plugin for Active {
    fn manifest(&self) -> PluginManifest {
        manifest()
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let mut seen = self.seen.lock().expect("seen");
        seen.consent = Some(consent::current(&*host));
        seen.max_bytes = Some(consent::max_bytes(&*host));
        seen.wrote_consent =
            Some(host.set_setting(CRAFT_CLI_PREVIEWS, SettingValue::Text("on".into())));
        #[cfg(feature = "versioning")]
        {
            seen.wrote_versioning = Some(host.set_setting(
                fub_host::settings::VERSIONING_ENABLED,
                SettingValue::Toggle(true),
            ));
        }
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

fn tempdir() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, path)
}

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = tempdir();
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("nota");
    (dir, root)
}

/// Un host con le impostazioni di macchina in `config`.
fn host_on(config: &Utf8Path) -> Host {
    Host::without_watcher().with_config_dir(config)
}

/// Monta il bundle sul vault e restituisce ciò che ha visto.
fn probe(host: &Host, root: &Utf8Path) -> Seen {
    host.open(root).expect("il vault si apre");
    host.wait_indexed(Some(root.as_str())).expect("indicizzato");
    let seen = Shared::default();
    host.mount_bundle(
        Some(root.as_str()),
        Arc::new(Probe {
            seen: Arc::clone(&seen),
        }),
    )
    .expect("il bundle si monta");
    // Il permesso dichiarato lo concede la persona, e vale dall'accensione
    // dopo: il bundle si spegne e si riaccende, e ciò che ha visto è di
    // questa seconda volta.
    host.set_setting_for_user(
        Some(root.as_str()),
        &fub_abi::settings::permission_key(ID, fub_abi::options::permission::WRITE_SETTINGS),
        SettingValue::Toggle(true),
    )
    .expect("la persona concede di scrivere impostazioni");
    host.set_plugin_enabled(Some(root.as_str()), ID, false)
        .expect("il bundle si spegne");
    *seen.lock().expect("seen") = Seen::default();
    host.set_plugin_enabled(Some(root.as_str()), ID, true)
        .expect("il bundle si riaccende");
    let errors = host
        .unmount_bundle(Some(root.as_str()), ID)
        .expect("il bundle si smonta");
    assert!(errors.is_empty(), "{errors:?}");
    let mut guard = seen.lock().expect("seen");
    std::mem::take(&mut *guard)
}

fn entry(host: &Host, key: &str) -> SettingEntry {
    host.machine_settings()
        .into_iter()
        .find(|row| row.spec.key == key)
        .unwrap_or_else(|| panic!("`{key}` è fra le impostazioni della macchina"))
}

fn write_machine_file(config: &Utf8Path, values: serde_json::Value) -> String {
    let text = serde_json::json!({"version": 2, "values": values}).to_string();
    std::fs::write(config.join("settings.json"), &text).expect("settings.json");
    text
}

fn text(value: &str) -> SettingValue {
    SettingValue::Text(value.into())
}

#[test]
fn the_four_settings_are_of_the_machine_and_the_consent_is_not_for_programs() {
    let specs = core_settings();
    let spec = |key: &str| {
        specs
            .iter()
            .find(|spec| spec.key == key)
            .unwrap_or_else(|| panic!("`{key}` è dichiarata"))
            .clone()
    };

    let cli = spec(CRAFT_CLI_PREVIEWS);
    let SettingKind::Choice { default, options } = &cli.kind else {
        panic!("craft.cli-previews è una scelta: {:?}", cli.kind);
    };
    assert_eq!(default, "ask");
    let values: Vec<&str> = options.iter().map(|option| option.value.as_str()).collect();
    assert_eq!(values, ["ask", "on", "off"]);
    assert!(!cli.program_writable, "il consenso lo dà solo la persona");

    let mib = spec(CRAFT_PREVIEW_MAX_MIB);
    match mib.kind {
        SettingKind::Number { default, min, max } => {
            assert_eq!(default, 64.0);
            assert_eq!(min, Some(1.0));
            assert_eq!(max, Some(4096.0));
        }
        other => panic!("craft.preview-max-mib è un numero: {other:?}"),
    }
    assert_eq!(
        spec(CRAFT_TREE_THUMBNAILS).kind.default_value(),
        SettingValue::Toggle(false)
    );
    assert_eq!(
        spec(CRAFT_TREE_SHOW_XMP).kind.default_value(),
        SettingValue::Toggle(true)
    );

    let group = cli.group.clone();
    for key in [
        CRAFT_CLI_PREVIEWS,
        CRAFT_PREVIEW_MAX_MIB,
        CRAFT_TREE_THUMBNAILS,
        CRAFT_TREE_SHOW_XMP,
    ] {
        let spec = spec(key);
        assert_eq!(spec.scope, SettingScope::Machine, "{key}");
        assert_eq!(spec.group, group, "{key}: nello stesso gruppo");
    }
}

#[test]
fn the_person_chooses_on_and_the_choice_is_read() {
    let (_config_dir, config) = tempdir();
    let host = host_on(&config);
    host.set_setting_for_user(None, CRAFT_CLI_PREVIEWS, text("on"))
        .expect("la persona accende le anteprime");
    assert_eq!(entry(&host, CRAFT_CLI_PREVIEWS).value, text("on"));
    host.set_setting_for_user(None, CRAFT_PREVIEW_MAX_MIB, SettingValue::Number(256.0))
        .expect("e alza il peso");

    let (_vault_dir, root) = vault();
    let seen = probe(&host, &root);
    assert_eq!(seen.consent, Some(RenderConsent::On));
    assert_eq!(seen.max_bytes, Some(256 * M));

    // Con il vault aperto la porta della persona scrive ancora la macchina.
    host.set_setting_for_user(Some(root.as_str()), CRAFT_CLI_PREVIEWS, text("off"))
        .expect("e le spegne");
    let written: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(config.join("settings.json")).expect("il file della macchina"),
    )
    .expect("json");
    assert_eq!(written["values"][CRAFT_CLI_PREVIEWS], "off", "{written}");
    assert!(
        !root.join(".fub").join("settings.json").exists()
            || !std::fs::read_to_string(root.join(".fub").join("settings.json"))
                .expect("il file del vault")
                .contains(CRAFT_CLI_PREVIEWS),
        "nel vault non finisce"
    );

    // Azzerarla torna a chiedere.
    host.reset_setting_for_user(Some(root.as_str()), CRAFT_CLI_PREVIEWS)
        .expect("la persona la azzera");
    assert_eq!(entry(&host, CRAFT_CLI_PREVIEWS).value, text("ask"));
}

#[test]
fn a_bundle_that_writes_the_consent_is_refused() {
    let (_config_dir, config) = tempdir();
    let host = host_on(&config);
    let (_vault_dir, root) = vault();
    let seen = probe(&host, &root);

    match seen.wrote_consent {
        Some(Err(PluginError::PermissionDenied(why))) => {
            let why = why.to_string();
            assert!(why.contains(CRAFT_CLI_PREVIEWS), "{why}");
            assert!(why.contains("not declared writable"), "{why}");
        }
        other => panic!("un programma non dà il consenso: {other:?}"),
    }
    // Il controllo: lo stesso bundle, con lo stesso permesso, scrive una
    // chiave che un programma può scrivere.
    #[cfg(feature = "versioning")]
    assert!(
        matches!(seen.wrote_versioning, Some(Ok(()))),
        "{:?}",
        seen.wrote_versioning
    );
    assert_eq!(seen.consent, Some(RenderConsent::Ask));
    assert_eq!(entry(&host, CRAFT_CLI_PREVIEWS).value, text("ask"));
    assert_eq!(
        entry(&host, CRAFT_CLI_PREVIEWS).source,
        SettingSource::Default
    );
}

#[test]
fn an_imported_vault_that_carries_the_consent_changes_nothing() {
    let (_config_dir, config) = tempdir();
    let host = host_on(&config);
    let (_vault_dir, root) = vault();
    std::fs::create_dir_all(root.join(".fub")).expect(".fub");
    std::fs::write(
        root.join(".fub").join("settings.json"),
        serde_json::json!({"version": 1, "values": {
            CRAFT_CLI_PREVIEWS: "on",
            CRAFT_PREVIEW_MAX_MIB: 4096,
        }})
        .to_string(),
    )
    .expect("settings del vault");

    let seen = probe(&host, &root);
    assert_eq!(
        seen.consent,
        Some(RenderConsent::Ask),
        "il vault non decide"
    );
    assert_eq!(seen.max_bytes, Some(64 * M));
    assert_eq!(entry(&host, CRAFT_CLI_PREVIEWS).value, text("ask"));
}

#[test]
fn an_old_switch_and_a_rotten_value_read_as_ask_and_the_file_stays() {
    for old in [
        serde_json::json!(true),
        serde_json::json!(false),
        serde_json::json!("forse"),
    ] {
        let (_config_dir, config) = tempdir();
        let before = write_machine_file(&config, serde_json::json!({ CRAFT_CLI_PREVIEWS: old }));
        let host = host_on(&config);

        assert_eq!(
            std::fs::read_to_string(config.join("settings.json")).expect("il file"),
            before,
            "{old}: aprire non riscrive il file"
        );
        let row = entry(&host, CRAFT_CLI_PREVIEWS);
        assert_eq!(row.value, text("ask"), "{old}");
        assert_eq!(row.source, SettingSource::Default, "{old}");

        let (_vault_dir, root) = vault();
        let seen = probe(&host, &root);
        assert_eq!(seen.consent, Some(RenderConsent::Ask), "{old}");
        // Il file è cambiato per il permesso del bundle, non per il valore
        // vecchio: quello resta com'era, nessuna migrazione.
        let after: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(config.join("settings.json")).expect("il file"),
        )
        .expect("json");
        assert_eq!(after["values"][CRAFT_CLI_PREVIEWS], old, "{after}");
    }
}

#[test]
fn the_weight_outside_one_to_4096_is_refused() {
    let (_config_dir, config) = tempdir();
    let host = host_on(&config);
    for bad in [0.0, 5000.0, -1.0] {
        let refused =
            host.set_setting_for_user(None, CRAFT_PREVIEW_MAX_MIB, SettingValue::Number(bad));
        assert!(refused.is_err(), "{bad} MiB: {refused:?}");
    }
    assert!(host
        .set_setting_for_user(None, CRAFT_PREVIEW_MAX_MIB, text("64"))
        .is_err());
    assert!(host
        .set_setting_for_user(None, CRAFT_CLI_PREVIEWS, text("forse"))
        .is_err());
    assert_eq!(
        entry(&host, CRAFT_PREVIEW_MAX_MIB).value,
        SettingValue::Number(64.0),
        "il valore di prima resta"
    );

    // Anche con il vault aperto, dalla stessa porta.
    let (_vault_dir, root) = vault();
    host.open(&root).expect("il vault si apre");
    for bad in [0.0, 5000.0, -1.0] {
        assert!(
            host.set_setting_for_user(
                Some(root.as_str()),
                CRAFT_PREVIEW_MAX_MIB,
                SettingValue::Number(bad),
            )
            .is_err(),
            "{bad} MiB col vault"
        );
    }
}

#[test]
fn current_and_max_bytes_follow_every_value() {
    for (value, expected) in [
        ("ask", RenderConsent::Ask),
        ("on", RenderConsent::On),
        ("off", RenderConsent::Off),
    ] {
        let (_config_dir, config) = tempdir();
        let host = host_on(&config);
        host.set_setting_for_user(None, CRAFT_CLI_PREVIEWS, text(value))
            .expect(value);
        let (_vault_dir, root) = vault();
        assert_eq!(probe(&host, &root).consent, Some(expected), "{value}");
    }

    for (mib, bytes) in [
        (1.0, M),
        (64.0, 64 * M),
        (100.0, 100 * M),
        (4096.0, 4096 * M),
    ] {
        let (_config_dir, config) = tempdir();
        let host = host_on(&config);
        host.set_setting_for_user(None, CRAFT_PREVIEW_MAX_MIB, SettingValue::Number(mib))
            .expect("un peso dentro");
        let (_vault_dir, root) = vault();
        assert_eq!(probe(&host, &root).max_bytes, Some(bytes), "{mib} MiB");
    }

    // Un peso fuori scritto a mano nel file non passa lo schema: vale quello
    // di partenza, non il numero rotto.
    for rotten in [
        serde_json::json!(0),
        serde_json::json!(9000),
        serde_json::json!("tanto"),
    ] {
        let (_config_dir, config) = tempdir();
        write_machine_file(
            &config,
            serde_json::json!({ CRAFT_PREVIEW_MAX_MIB: rotten }),
        );
        let host = host_on(&config);
        let (_vault_dir, root) = vault();
        assert_eq!(probe(&host, &root).max_bytes, Some(64 * M), "{rotten}");
    }
}
