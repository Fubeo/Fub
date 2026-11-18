//! I valori che la persona scrive nelle impostazioni, quando lo schema dice
//! soltanto «testo»: un fuso orario e l'indirizzo di un server.
//!
//! La specie `Text` accetta qualunque stringa, e `Mars/Olympus` come fuso o
//! `ftp://127.0.0.1` come server di sincronizzazione si salvavano in silenzio
//! (IMP-024, IMP-025). Il cancello è dell'host, che ha il database dei fusi e
//! la regola degli indirizzi: un valore rifiutato non arriva al suo livello, il
//! valore di prima resta, e il motivo esce nella lingua di chi guarda.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::{SettingEntry, SettingValue};
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::PluginError;
use fub_host::Host;

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

fn text(value: &str) -> SettingValue {
    SettingValue::Text(value.into())
}

fn vault_entry(host: &Host, root: &Utf8Path, key: &str) -> SettingEntry {
    let Ok(IndexResult::Settings(entries)) =
        host.query_index(Some(root.as_str()), IndexQuery::Settings { plugin: None })
    else {
        panic!("le impostazioni del vault rispondono")
    };
    entries
        .into_iter()
        .find(|entry| entry.spec.key == key)
        .unwrap_or_else(|| panic!("`{key}` è fra le impostazioni del vault"))
}

fn machine_entry(host: &Host, key: &str) -> SettingEntry {
    host.machine_settings()
        .into_iter()
        .find(|entry| entry.spec.key == key)
        .unwrap_or_else(|| panic!("`{key}` è fra le impostazioni della macchina"))
}

/// Il motivo del rifiuto, già una frase: sul filo JSON un `Text` non risolto
/// sarebbe un oggetto, e la shell scriverebbe `[object Object]`.
fn refusal(result: Result<(), PluginError>) -> String {
    match result {
        Err(PluginError::BadArgs(message)) => message
            .as_literal()
            .unwrap_or_else(|| panic!("il motivo esce risolto: {message:?}"))
            .to_owned(),
        other => panic!("atteso un BadArgs, non {other:?}"),
    }
}

#[test]
fn a_time_zone_that_does_not_exist_is_refused_and_the_previous_one_stays() {
    let (_config_dir, config) = tempdir();
    let (_vault_dir, root) = vault();
    let host = Host::without_watcher().with_config_dir(&config);
    host.open(&root).expect("il vault si apre");
    let key = fub_kernel::locale::TIMEZONE;

    host.set_setting_for_user(Some(root.as_str()), key, text("Europe/Rome"))
        .expect("un fuso IANA si salva");
    assert_eq!(vault_entry(&host, &root, key).value, text("Europe/Rome"));

    for bad in ["Mars/Olympus", "Europe/Roma", "non un fuso"] {
        let why = refusal(host.set_setting_for_user(Some(root.as_str()), key, text(bad)));
        assert!(
            why.contains(bad),
            "il motivo nomina ciò che si è scritto: {why}"
        );
        assert!(
            !why.contains("core.settings"),
            "una frase, non la chiave: {why}"
        );
        assert_eq!(
            vault_entry(&host, &root, key).value,
            text("Europe/Rome"),
            "`{bad}` non sovrascrive il fuso di prima"
        );
    }

    // Vuoto vuol dire «come il sistema», ed è sempre ammesso.
    host.set_setting_for_user(Some(root.as_str()), key, text(""))
        .expect("vuoto torna al sistema");
    assert_eq!(vault_entry(&host, &root, key).value, text(""));
}

#[test]
fn the_refusal_speaks_the_language_of_the_vault() {
    let (_config_dir, config) = tempdir();
    let (_vault_dir, root) = vault();
    let host = Host::without_watcher().with_config_dir(&config);
    host.open(&root).expect("il vault si apre");
    let key = fub_kernel::locale::TIMEZONE;

    host.set_setting_for_user(
        Some(root.as_str()),
        fub_kernel::locale::LANGUAGE,
        text("en"),
    )
    .expect("inglese");
    let english =
        refusal(host.set_setting_for_user(Some(root.as_str()), key, text("Mars/Olympus")));
    assert!(english.contains("is not a known time zone"), "{english}");

    host.set_setting_for_user(
        Some(root.as_str()),
        fub_kernel::locale::LANGUAGE,
        text("it"),
    )
    .expect("italiano");
    let italian =
        refusal(host.set_setting_for_user(Some(root.as_str()), key, text("Mars/Olympus")));
    assert!(
        italian.contains("non è un fuso orario conosciuto"),
        "{italian}"
    );
}

#[test]
fn a_server_that_is_not_an_address_is_refused_and_the_previous_one_stays() {
    let (_config_dir, config) = tempdir();
    let host = Host::without_watcher().with_config_dir(&config);
    for key in [
        fub_host::settings::SYNC_SERVER_URL,
        fub_host::settings::PUBLISH_SERVER_URL,
    ] {
        host.set_setting_for_user(None, key, text("https://fub.example"))
            .expect("un indirizzo https si salva");
        for bad in [
            "non un indirizzo",
            "ftp://127.0.0.1",
            "http://fub.example",
            "https://",
            "https://utente@fub.example",
        ] {
            let why = refusal(host.set_setting_for_user(None, key, text(bad)));
            assert!(
                why.contains(bad),
                "`{key}`: il motivo nomina `{bad}`: {why}"
            );
            assert_eq!(
                machine_entry(&host, key).value,
                text("https://fub.example"),
                "`{key}`: `{bad}` non sovrascrive il server di prima"
            );
        }
        // HTTP verso il loopback esplicito, e vuoto (nessun server), restano.
        host.set_setting_for_user(None, key, text("http://127.0.0.1:8080"))
            .expect("http verso il loopback");
        host.set_setting_for_user(None, key, text(""))
            .expect("vuoto: nessun server");
        assert_eq!(machine_entry(&host, key).value, text(""));
    }
}
