//! **Il primo sync di un vault funziona, e il rekey cambia davvero chiave**
//! (#516): host vero e servizio vero, nello stesso processo.
//!
//! Il client di rete non finge risposte: inoltra ogni richiesta a
//! `fub_services::sync::handle` su uno stato in una cartella temporanea, come
//! farebbe il server. Così il contratto dell'epoca della chiave è provato ai
//! due capi insieme: il servizio assegna la prima epoca, il client la adotta e
//! la salva prima di sigillare.
//!
//! Un test solo, e non uno per caso: le variabili `FUB_SERVICES_*` e
//! `FUB_SYNC_*` sono del processo, e due test paralleli se le contenderebbero.
#![cfg(feature = "http-client")]

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::net::{HttpHeader, HttpMethod, HttpRequest, HttpResponse};
use fub_abi::settings::SettingValue;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::Host;
use fub_services::server::ServiceState;

const SYNC_URL: &str = "https://sync.example.test";
const PASSPHRASE_A: &str = "passphrase del primo dispositivo, lunga abbastanza";
const PASSPHRASE_B: &str = "passphrase del secondo dispositivo, diversa dalla prima";

/// Il servizio di sync nello stesso processo, dietro la porta di rete.
struct InProcess {
    state: Mutex<ServiceState>,
    /// Gli op arrivati con un push accettato o no, nell'ordine.
    pushed: Mutex<Vec<serde_json::Value>>,
}

impl HostNetwork for InProcess {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        let path = request
            .url
            .strip_prefix(SYNC_URL)
            .unwrap_or_else(|| panic!("unexpected endpoint {}", request.url));
        if path == "/v1/hello" {
            return Ok(HttpResponse {
                status: 200,
                headers: vec![json_header()],
                body: serde_json::to_vec(&fub_services::routing::Hello::current()).unwrap(),
            });
        }
        let authorization = request
            .headers
            .iter()
            .find(|header| header.name.eq_ignore_ascii_case("authorization"))
            .map(|header| header.value.clone());
        let method = match request.method {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Delete => "DELETE",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Head => "HEAD",
        };
        let body = request.body.unwrap_or_default();
        if path == "/v1/sync/push" {
            let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let ops = parsed["ops"].as_array().cloned().unwrap_or_default();
            self.pushed.lock().unwrap().extend(ops);
        }
        let response = fub_services::sync::handle(
            &mut self.state.lock().unwrap(),
            method,
            path,
            authorization.as_deref(),
            &body,
        );
        Ok(HttpResponse {
            status: response.status,
            headers: vec![HttpHeader {
                name: "content-type".into(),
                value: response.content_type.into(),
            }],
            body: response.body,
        })
    }
}

fn json_header() -> HttpHeader {
    HttpHeader {
        name: "content-type".into(),
        value: "application/json".into(),
    }
}

fn utf8_dir() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, path)
}

fn vault(files: &[(&str, &str)]) -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = utf8_dir();
    for (name, text) in files {
        std::fs::write(root.join(name), text).unwrap();
    }
    let root = root.canonicalize_utf8().expect("canonical");
    (dir, root)
}

/// Un file segreto come lo vuole il client: del solo proprietario.
fn owner_only(path: &Utf8Path, text: &str) {
    std::fs::write(path, format!("{text}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
}

/// Un dispositivo: configurazione sua, vault suo, stesso servizio.
struct Device {
    host: Host,
    config: Utf8PathBuf,
    vault: Utf8PathBuf,
    _dirs: [tempfile::TempDir; 2],
}

impl Device {
    fn new(network: &Arc<InProcess>, token: &str, files: &[(&str, &str)]) -> Self {
        let (config_dir, config) = utf8_dir();
        owner_only(&config.join(fub_host::remote::TOKEN_FILE), token);
        let (vault_dir, vault) = vault(files);
        let host = Host::without_watcher()
            .with_config_dir(&config)
            .with_network(network.clone());
        host.open(&vault).expect("vault opens");
        host.wait_indexed(Some(vault.as_str())).expect("indexed");
        host.set_setting_for_user(
            Some(vault.as_str()),
            "sync.server_url",
            SettingValue::Text(SYNC_URL.into()),
        )
        .expect("server url");
        Device {
            host,
            config,
            vault,
            _dirs: [config_dir, vault_dir],
        }
    }

    fn job(&self, payload: serde_json::Value) -> Result<serde_json::Value, PluginError> {
        self.host
            .invoke_job(Some(self.vault.as_str()), "fub.sync", "sync.pass", payload)
    }

    fn pass(&self, what: &str) -> serde_json::Value {
        self.job(serde_json::json!({"op": "pass"}))
            .unwrap_or_else(|error| panic!("{what}: {error:?}"))
    }

    /// Scrive una nota dall'host, come la CLI: l'indice la vede subito.
    fn write(&self, name: &str, text: &str) {
        self.host
            .write_document(
                Some(self.vault.as_str()),
                &fub_abi::model::DocId::new(name),
                text,
                fub_abi::edit::WriteBase::Dictated,
            )
            .unwrap_or_else(|error| panic!("write {name}: {error:?}"));
    }

    fn state(&self, name: &str) -> Option<String> {
        let dir = fub_host::remote::vault_state_dir(&self.config, &self.vault);
        std::fs::read_to_string(dir.join(name)).ok()
    }

    fn outbox_len(&self) -> usize {
        self.state("outbox.jsonl")
            .map(|text| text.lines().count())
            .unwrap_or(0)
    }
}

fn set_passphrase(value: &str) {
    // SAFETY: l'unico test di questo binario; i job girano mentre lo
    // aspettiamo, mai insieme a questo cambio.
    unsafe { std::env::set_var("FUB_SERVICES_VAULT_PASSPHRASE", value) };
}

/// La chiave che il servizio serve ora per `vault_id`, aperta con `passphrase`.
fn served_key(
    network: &InProcess,
    auth: &str,
    vault_id: &str,
    passphrase: &str,
) -> (u32, [u8; 32]) {
    let response = fub_services::sync::handle(
        &mut network.state.lock().unwrap(),
        "GET",
        &format!("/v1/sync/vault-key?vault_id={vault_id}"),
        Some(auth),
        b"",
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let body: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
    let epoch = u32::try_from(body["key_epoch"].as_u64().unwrap()).unwrap();
    let vdk = fub_host::remote::unwrap_for_passphrase(passphrase, &body["wrapped"]).unwrap();
    (epoch, vdk)
}

/// Il testo in chiaro dell'ultimo op spinto per `doc`, aperto con `vdk`.
fn open_last_push(
    network: &InProcess,
    doc: &str,
    vdk: &[u8; 32],
) -> (u32, Result<Vec<u8>, String>) {
    let pushed = network.pushed.lock().unwrap();
    let raw = pushed
        .iter()
        .rev()
        .find(|op| op["doc_id"].as_str() == Some(doc))
        .unwrap_or_else(|| panic!("no push for {doc}"))
        .clone();
    let op: fub_host::remote::sync::WireOp = serde_json::from_value(raw).unwrap();
    let plain =
        fub_host::remote::aad_verify(vdk, &op.envelope(), &op.nonce_b64, &op.ciphertext_b64);
    (op.key_epoch, plain)
}

#[test]
fn the_first_pass_and_a_rekey_seal_with_the_served_key() {
    assert_eq!(
        fub_host::remote::INITIAL_KEY_EPOCH,
        fub_services::sync::INITIAL_KEY_EPOCH,
        "client and service agree on the first epoch"
    );
    for name in [
        "FUB_SERVICES_URL",
        "FUB_SERVICES_TOKEN",
        "FUB_SERVICES_TOKEN_FILE",
        "FUB_SERVICES_VAULT_PASSPHRASE_FILE",
        "FUB_SYNC_MODE",
        "FUB_SYNC_EXTERNAL_OVERLAP",
        "FUB_SYNC_INVITE_PASSPHRASE_FILE",
        "FUB_SYNC_INVITE_TOKEN_FILE",
        "FUB_SYNC_MFA_CODE_FILE",
    ] {
        // SAFETY: l'unico test di questo binario, prima di ogni host e thread.
        unsafe { std::env::remove_var(name) };
    }
    let (_data_dir, data) = utf8_dir();
    let mut service = ServiceState::open(Some(data.clone().into_std_path_buf())).expect("service");
    let owner = service
        .accounts
        .create_account("proprietaria", "correct-horse-99")
        .expect("account");
    let token = service.accounts.issue_session_token(&owner).expect("token");
    let auth = format!("Bearer {token}");
    let network = Arc::new(InProcess {
        state: Mutex::new(service),
        pushed: Mutex::new(Vec::new()),
    });

    // 1. Primo passaggio di un vault nuovo: il servizio crea la chiave
    //    all'epoca uno e il client sigilla con quella, non con zero.
    set_passphrase(PASSPHRASE_A);
    let a = Device::new(&network, &token, &[("Prima.md", "# Prima\n")]);
    a.pass("the first pass of a new vault succeeds");
    assert_eq!(
        a.state("key-epoch").as_deref(),
        Some("1"),
        "the epoch is saved"
    );
    assert_eq!(a.outbox_len(), 0, "the first push is acknowledged");
    let vault_id = a.state("vault-pairing").expect("pairing");
    let (epoch, vdk_a) = served_key(&network, &auth, &vault_id, PASSPHRASE_A);
    assert_eq!(epoch, 1);
    let (sealed_at, plain) = open_last_push(&network, "Prima.md", &vdk_a);
    assert_eq!(sealed_at, 1);
    assert_eq!(plain.as_deref(), Ok("# Prima\n".as_bytes()));
    a.write("Prima.md", "# Prima, di nuovo\n");
    a.pass("the next pass keeps working");
    assert_eq!(a.outbox_len(), 0);
    let (sealed_at, plain) = open_last_push(&network, "Prima.md", &vdk_a);
    assert_eq!(sealed_at, 1);
    assert_eq!(plain.as_deref(), Ok("# Prima, di nuovo\n".as_bytes()));

    // 2. Un secondo dispositivo con un'altra passphrase entra con un invito:
    //    la chiave del servizio non si apre da lì, quella accettata sì.
    let (_secrets_dir, secrets) = utf8_dir();
    owner_only(&secrets.join("invite-passphrase"), PASSPHRASE_B);
    // SAFETY: vedi `set_passphrase`.
    unsafe {
        std::env::set_var(
            "FUB_SYNC_INVITE_PASSPHRASE_FILE",
            secrets.join("invite-passphrase").as_str(),
        )
    };
    let invite = a
        .job(serde_json::json!({"op": "invite", "role": "writer"}))
        .expect("invite");
    unsafe { std::env::remove_var("FUB_SYNC_INVITE_PASSPHRASE_FILE") };
    owner_only(
        &secrets.join("invite-token"),
        invite["token_b64"].as_str().expect("token"),
    );
    // SAFETY: vedi `set_passphrase`.
    unsafe {
        std::env::set_var(
            "FUB_SYNC_INVITE_TOKEN_FILE",
            secrets.join("invite-token").as_str(),
        )
    };
    set_passphrase(PASSPHRASE_B);
    let b = Device::new(&network, &token, &[]);
    let accepted = b.job(serde_json::json!({"op": "accept"})).expect("accept");
    assert_eq!(accepted["key_epoch"], 1);
    b.pass("the invited device pulls with the accepted key");
    assert_eq!(
        std::fs::read_to_string(b.vault.join("Prima.md")).unwrap(),
        "# Prima, di nuovo\n"
    );

    // 3. Rekey dal secondo dispositivo, poi un passaggio: i nuovi op si
    //    aprono con la chiave nuova, non con quella dell'invito.
    let rekeyed = b.job(serde_json::json!({"op": "rekey"})).expect("rekey");
    assert_eq!(rekeyed["key_epoch"], 2);
    b.write("Dopo.md", "# Dopo il rekey\n");
    b.pass("the pass after a rekey succeeds");
    assert_eq!(b.state("key-epoch").as_deref(), Some("2"));
    let (epoch, vdk_new) = served_key(&network, &auth, &vault_id, PASSPHRASE_B);
    assert_eq!(epoch, 2);
    assert_ne!(vdk_new, vdk_a, "the rekey made a fresh key");
    let (sealed_at, plain) = open_last_push(&network, "Dopo.md", &vdk_new);
    assert_eq!(sealed_at, 2);
    assert_eq!(
        plain.as_deref(),
        Ok("# Dopo il rekey\n".as_bytes()),
        "a note written after the rekey is sealed with the new key"
    );
    let (_, old) = open_last_push(&network, "Dopo.md", &vdk_a);
    assert!(old.is_err(), "the revoked key no longer opens new notes");
    b.pass("a second pass after the rekey also works");
}
