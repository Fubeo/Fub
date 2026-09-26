//! **Sync e pubblicazione parlano davvero con la rete**, passando dalla Guard
//! come ogni plugin (I59), e **lo stato di sync è del vault** (I51).
//!
//! I bundle sono montati sull'host vero, con la politica vera davanti al job:
//! `MemoryHost` non passa dalla Guard, ed è così che un manifest senza
//! `fub:network` era arrivato fin qui con i test verdi. Il client di rete è
//! finto e risponde `503` a tutto: basta a dire che la richiesta è partita,
//! verso l'endpoint configurato e con il token salvato da `login`.
//!
//! Un test solo, e non uno per caso: le variabili `FUB_SERVICES_*` sono del
//! processo, e due test paralleli se le contenderebbero.
#![cfg(feature = "http-client")]

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::net::{HttpRequest, HttpResponse};
use fub_abi::settings::SettingValue;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::Host;

/// Il token che `fub-cli login` avrebbe salvato nella configurazione.
const TOKEN: &str = "token-della-macchina";
const PUBLISH_URL: &str = "https://publish.example.test";
const SYNC_URL: &str = "https://sync.example.test";

/// Una richiesta vista dal client di rete: dove andava e con quale bearer.
#[derive(Clone, Debug, PartialEq)]
struct Seen {
    url: String,
    authorization: Option<String>,
}

#[derive(Default)]
struct Recording(Mutex<Vec<Seen>>);

impl Recording {
    fn seen(&self) -> Vec<Seen> {
        self.0.lock().unwrap().clone()
    }
}

impl HostNetwork for Recording {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        let authorization = request
            .headers
            .iter()
            .find(|header| header.name.eq_ignore_ascii_case("authorization"))
            .map(|header| header.value.clone());
        self.0.lock().unwrap().push(Seen {
            url: request.url,
            authorization,
        });
        Ok(HttpResponse {
            status: 503,
            headers: Vec::new(),
            body: Vec::new(),
        })
    }
}

fn utf8_dir() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, path)
}

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = utf8_dir();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    let root = root.canonicalize_utf8().expect("canonical");
    (dir, root)
}

/// Il token come lo scrive `login`: un file del solo proprietario.
fn save_machine_token(config: &Utf8Path) {
    let path = config.join(fub_host::remote::TOKEN_FILE);
    std::fs::write(&path, format!("{TOKEN}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
}

fn set(host: &Host, vault: &Utf8Path, key: &str, value: SettingValue) {
    host.set_setting_for_user(Some(vault.as_str()), key, value)
        .unwrap_or_else(|error| panic!("setting {key}: {error}"));
}

fn pass(
    host: &Host,
    vault: &Utf8Path,
    plugin: &str,
    job: &str,
    payload: serde_json::Value,
) -> PluginError {
    host.invoke_job(Some(vault.as_str()), plugin, job, payload)
        .expect_err("the fake network answers 503 to everything")
}

/// La coppia di sync di un vault: la cartella di stato che il bundle ha usato.
fn pairing(config: &Utf8Path, vault: &Utf8Path) -> String {
    let dir = fub_host::remote::vault_state_dir(config, vault);
    std::fs::read_to_string(dir.join("vault-pairing"))
        .unwrap_or_else(|error| panic!("no pairing under {dir}: {error}"))
}

#[test]
fn sync_and_publish_reach_the_network_through_the_guard() {
    // SAFETY: l'unico test di questo binario, prima di ogni host e thread.
    for name in [
        "FUB_SERVICES_URL",
        "FUB_SERVICES_TOKEN",
        "FUB_SERVICES_TOKEN_FILE",
        "FUB_SYNC_MODE",
        "FUB_SYNC_EXTERNAL_OVERLAP",
    ] {
        unsafe { std::env::remove_var(name) };
    }
    let (_config_dir, config) = utf8_dir();
    save_machine_token(&config);
    let (_a_dir, a) = vault();
    let (_b_dir, b) = vault();
    let network = Arc::new(Recording::default());
    let host = Host::without_watcher()
        .with_config_dir(&config)
        .with_network(network.clone());
    host.open(&a).expect("vault A opens");
    host.wait_indexed(Some(a.as_str())).expect("A indexed");
    set(
        &host,
        &a,
        "publish.server_url",
        SettingValue::Text(PUBLISH_URL.into()),
    );
    set(
        &host,
        &a,
        "sync.server_url",
        SettingValue::Text(SYNC_URL.into()),
    );

    // Pubblicazione: la Guard lascia passare, la richiesta arriva alla rete.
    let error = pass(
        &host,
        &a,
        "fub.publish",
        "publish.pass",
        serde_json::json!({"site_id": "blog", "op": "dry-run"}),
    );
    assert!(
        matches!(&error, PluginError::Io(message) if message.as_literal().is_some_and(|m| m.contains("503"))),
        "publish should fail on the server's 503, not before the network: {error:?}"
    );
    assert_eq!(
        network.seen(),
        [Seen {
            url: format!("{PUBLISH_URL}/v1/publish/dry-run"),
            authorization: Some(format!("Bearer {TOKEN}")),
        }],
        "the request goes to the configured endpoint with the machine's token"
    );

    // Sync: stessa cosa, sul saluto al server.
    let error = pass(
        &host,
        &a,
        "fub.sync",
        "sync.pass",
        serde_json::json!({"op": "pass"}),
    );
    assert!(
        matches!(&error, PluginError::Io(message) if message.as_literal().is_some_and(|m| m.contains("503"))),
        "sync should fail on the server's 503, not before the network: {error:?}"
    );
    assert_eq!(
        network.seen().last(),
        Some(&Seen {
            url: format!("{SYNC_URL}/v1/hello"),
            authorization: Some(format!("Bearer {TOKEN}")),
        })
    );

    // Un secondo vault ha un abbinamento suo: niente identità remota o coda
    // in comune con il primo (I51).
    host.open(&b).expect("vault B opens");
    host.wait_indexed(Some(b.as_str())).expect("B indexed");
    let error = pass(
        &host,
        &b,
        "fub.sync",
        "sync.pass",
        serde_json::json!({"op": "pass"}),
    );
    assert!(
        matches!(&error, PluginError::Io(message) if message.as_literal().is_some_and(|m| m.contains("503"))),
        "vault B should reach the network with its own state: {error:?}"
    );
    assert_ne!(
        pairing(&config, &a),
        pairing(&config, &b),
        "two vaults must not share a sync pairing"
    );
    assert!(
        !config.join("sync").join("vault-pairing").exists(),
        "no machine-wide pairing is written any more"
    );

    // Spegnere il permesso ferma la pubblicazione alla Guard, prima della rete.
    let before = network.seen().len();
    set(
        &host,
        &a,
        &fub_abi::settings::permission_key("fub.publish", fub_abi::options::permission::NETWORK),
        SettingValue::Toggle(false),
    );
    let error = pass(
        &host,
        &a,
        "fub.publish",
        "publish.pass",
        serde_json::json!({"site_id": "blog", "op": "dry-run"}),
    );
    assert!(
        matches!(&error, PluginError::PermissionDenied(_)),
        "a denied network permission stops publish: {error:?}"
    );
    assert_eq!(network.seen().len(), before, "nothing reached the network");
}
