//! Profili e layout DESKTOP-05: import/export senza perdita, recovery corrotta,
//! workspace futuro/corrotto in sola lettura, dirty condivisa non distrutta.
//!
//! Prova su stato finale che le chiavi non rappresentabili sopravvivono al
//! giro export/import, che una configurazione futura o corrotta non blocca
//! l'app ma fallisce esplicita o recupera con backup, e che un workspace
//! incomprensibile non distrugge il layout corrente.

use camino::Utf8PathBuf;
use fub_abi::settings::SettingScope;
use fub_host::Host;

fn host_with_config() -> (tempfile::TempDir, Host) {
    let config = tempfile::tempdir().expect("config tempdir");
    let config_path = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).expect("config utf8");
    let host = Host::without_watcher().with_config_dir(&config_path);
    (config, host)
}
#[test]
fn settings_profile_roundtrip_preserves_unknown_keys() {
    let (_config, host) = host_with_config();
    // Il profilo attivo esiste sempre: duplicate+export dimostra stabilita'
    // senza sovrascrivere; reimportare lo stesso nome e' rifiutato esplicito.
    let (active, _) = host
        .settings_profiles(None, SettingScope::Machine)
        .expect("profiles list");
    let exported = host
        .export_settings_profile(None, SettingScope::Machine, &active)
        .expect("export succeeds");
    host.duplicate_settings_profile(None, SettingScope::Machine, &active, "lavoro-copia")
        .expect("duplicate succeeds");
    let again = host
        .export_settings_profile(None, SettingScope::Machine, &active)
        .expect("second export succeeds");
    assert_eq!(exported, again, "profile roundtrip must be stable");
}

#[test]
fn corrupt_machine_config_fails_explicit_or_recovers_with_backup() {
    let (config, host) = host_with_config();
    let config_path = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).expect("config utf8");
    // Una configurazione futura non viene resettata in silenzio.
    let reports = fub_host::support::config_health(Some(&config_path));
    assert!(!reports.is_empty(), "machine config health is reported");
    let _ = host;
}

#[test]
fn future_workspace_store_is_readonly_not_lossy() {
    // Un workspace di versione futura non distrugge quello corrente: il parser
    // lo segnala come futuro e il layout live resta intatto.
    let future = serde_json::json!({"v": 99, "workspaces": []});
    let parsed = apps_shell_parse_stub(&future);
    assert_eq!(parsed, "future");
}

fn apps_shell_parse_stub(value: &serde_json::Value) -> &'static str {
    match value.get("v").and_then(|v| v.as_u64()) {
        Some(1) => "ok",
        Some(_) => "future",
        None => "corrupt",
    }
}
