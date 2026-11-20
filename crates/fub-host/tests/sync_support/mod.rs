//! Il banco comune dei test di sync end-to-end: host vero e servizio vero,
//! nello stesso processo.
//!
//! Il client di rete non finge risposte: inoltra ogni richiesta a
//! `fub_services::sync::handle` su uno stato in una cartella temporanea, come
//! farebbe il server. Conta le richieste per rotta e sa simulare i due guasti
//! che contano per la ripresa: la risposta persa dopo che il server ha già
//! scritto, e un op del pull che non si autentica.
//!
//! Ogni binario che lo usa tiene **un test solo**: le variabili
//! `FUB_SERVICES_*` e `FUB_SYNC_*` sono del processo, e due test paralleli se
//! le contenderebbero.
#![allow(dead_code)]

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::net::{HttpHeader, HttpMethod, HttpRequest, HttpResponse};
use fub_abi::settings::SettingValue;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::Host;
use fub_services::server::ServiceState;

pub const SYNC_URL: &str = "https://sync.example.test";

/// Il servizio di sync nello stesso processo, dietro la porta di rete.
pub struct InProcess {
    pub state: Mutex<ServiceState>,
    /// Gli op arrivati con un push accettato o no, nell'ordine.
    pub pushed: Mutex<Vec<serde_json::Value>>,
    /// Ogni richiesta vista: metodo e path senza query.
    pub requests: Mutex<Vec<(String, String)>>,
    /// La prossima richiesta che comincia con questo path arriva al servizio,
    /// che la esegue, ma la risposta si perde: il client vede un guasto.
    pub lose_response: Mutex<Option<String>>,
    /// Nel prossimo pull, l'op a questo indice arriva col cifrato guastato.
    pub tamper_pull_op: Mutex<Option<usize>>,
}

impl InProcess {
    pub fn new(service: ServiceState) -> Arc<Self> {
        Arc::new(InProcess {
            state: Mutex::new(service),
            pushed: Mutex::new(Vec::new()),
            requests: Mutex::new(Vec::new()),
            lose_response: Mutex::new(None),
            tamper_pull_op: Mutex::new(None),
        })
    }

    /// Quante richieste da adesso in poi: si azzera il registro.
    pub fn take_requests(&self) -> Vec<(String, String)> {
        std::mem::take(&mut self.requests.lock().unwrap())
    }
}

/// Quante richieste di `requests` vanno a `path` (senza query).
pub fn count(requests: &[(String, String)], path: &str) -> usize {
    requests.iter().filter(|(_, seen)| seen == path).count()
}

impl HostNetwork for InProcess {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        let path = request
            .url
            .strip_prefix(SYNC_URL)
            .unwrap_or_else(|| panic!("unexpected endpoint {}", request.url));
        let method = match request.method {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Delete => "DELETE",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Head => "HEAD",
        };
        let bare = path.split('?').next().unwrap_or(path).to_string();
        self.requests
            .lock()
            .unwrap()
            .push((method.to_string(), bare.clone()));
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
        let lost = {
            let mut lose = self.lose_response.lock().unwrap();
            if lose
                .as_deref()
                .is_some_and(|prefix| bare.starts_with(prefix))
            {
                lose.take();
                true
            } else {
                false
            }
        };
        if lost {
            return Err(PluginError::Io(
                "connessione caduta dopo la scrittura".into(),
            ));
        }
        let mut body = response.body;
        if bare == "/v1/sync/pull" && response.status == 200 {
            if let Some(at) = self.tamper_pull_op.lock().unwrap().take() {
                let mut parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
                let op = &mut parsed["ops"][at];
                assert!(op.is_object(), "no pulled op at {at} to tamper with");
                // Un altro cifrato valido in base64: l'autenticazione fallisce.
                op["ciphertext_b64"] = serde_json::Value::String("AAAAAAAAAAAAAAAAAAAAAA==".into());
                body = serde_json::to_vec(&parsed).unwrap();
            }
        }
        Ok(HttpResponse {
            status: response.status,
            headers: vec![HttpHeader {
                name: "content-type".into(),
                value: response.content_type.into(),
            }],
            body,
        })
    }
}

pub fn json_header() -> HttpHeader {
    HttpHeader {
        name: "content-type".into(),
        value: "application/json".into(),
    }
}

pub fn utf8_dir() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, path)
}

/// Un vault con questi file.
///
/// I file nascono con la data di un'ora fa, come in un vault vero: l'indice non
/// tiene l'impronta di un file la cui data è troppo vicina alla lettura
/// (*racily clean*), e il banco non deve dipendere da quanto è veloce la
/// macchina.
pub fn vault(files: &[(&str, &[u8])]) -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = utf8_dir();
    let an_hour_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    for (name, bytes) in files {
        let path = root.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, bytes).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .and_then(|file| file.set_modified(an_hour_ago))
            .unwrap();
    }
    let root = root.canonicalize_utf8().expect("canonical");
    (dir, root)
}

/// Un file segreto come lo vuole il client: del solo proprietario.
pub fn owner_only(path: &Utf8Path, text: &str) {
    std::fs::write(path, format!("{text}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
}

/// Toglie dal processo le variabili che il client legge: ogni test parte da
/// un ambiente pulito.
pub fn clear_sync_env() {
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
        // SAFETY: l'unico test del binario, prima di ogni host e thread.
        unsafe { std::env::remove_var(name) };
    }
}

pub fn set_passphrase(value: &str) {
    // SAFETY: l'unico test del binario; i job girano mentre lo aspettiamo,
    // mai insieme a questo cambio.
    unsafe { std::env::set_var("FUB_SERVICES_VAULT_PASSPHRASE", value) };
}

/// Un dispositivo: configurazione sua, vault suo, stesso servizio.
pub struct Device {
    pub host: Host,
    pub config: Utf8PathBuf,
    pub vault: Utf8PathBuf,
    network: Arc<InProcess>,
    _dirs: [tempfile::TempDir; 2],
}

impl Device {
    pub fn new(network: &Arc<InProcess>, token: &str, files: &[(&str, &[u8])]) -> Self {
        let (config_dir, config) = utf8_dir();
        owner_only(&config.join(fub_host::remote::TOKEN_FILE), token);
        let (vault_dir, vault) = vault(files);
        let host = open_host(network, &config, &vault);
        Device {
            host,
            config,
            vault,
            network: network.clone(),
            _dirs: [config_dir, vault_dir],
        }
    }

    /// Chiude l'app e la riapre sulla stessa configurazione e sullo stesso
    /// vault: in mezzo, `between` cambia il disco come farebbe un altro
    /// programma.
    pub fn reopen(&mut self, between: impl FnOnce(&Utf8Path)) {
        let errors = self.host.close();
        assert!(errors.is_empty(), "close: {errors:?}");
        between(&self.vault);
        self.host = open_host(&self.network, &self.config, &self.vault);
    }

    pub fn job(&self, payload: serde_json::Value) -> Result<serde_json::Value, PluginError> {
        self.host
            .invoke_job(Some(self.vault.as_str()), "fub.sync", "sync.pass", payload)
    }

    pub fn pass(&self, what: &str) -> serde_json::Value {
        self.job(serde_json::json!({"op": "pass"}))
            .unwrap_or_else(|error| panic!("{what}: {error:?}"))
    }

    /// Scrive una nota dall'host, come la CLI: l'indice la vede subito.
    pub fn write(&self, name: &str, text: &str) {
        self.host
            .write_document(
                Some(self.vault.as_str()),
                &fub_abi::model::DocId::new(name),
                text,
                fub_abi::edit::WriteBase::Dictated,
            )
            .unwrap_or_else(|error| panic!("write {name}: {error:?}"));
    }

    pub fn state_dir(&self) -> Utf8PathBuf {
        fub_host::remote::vault_state_dir(&self.config, &self.vault)
    }

    pub fn state(&self, name: &str) -> Option<String> {
        std::fs::read_to_string(self.state_dir().join(name)).ok()
    }

    pub fn outbox_len(&self) -> usize {
        self.state("outbox.jsonl")
            .map(|text| text.lines().count())
            .unwrap_or(0)
    }
}

fn open_host(network: &Arc<InProcess>, config: &Utf8Path, vault: &Utf8Path) -> Host {
    let host = Host::without_watcher()
        .with_config_dir(config)
        .with_network(network.clone());
    host.open(vault).expect("vault opens");
    host.wait_indexed(Some(vault.as_str())).expect("indexed");
    host.set_setting_for_user(
        Some(vault.as_str()),
        "sync.server_url",
        SettingValue::Text(SYNC_URL.into()),
    )
    .expect("server url");
    host
}

/// La chiave che il servizio serve ora per `vault_id`, aperta con `passphrase`.
pub fn served_key(
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
pub fn open_last_push(
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

/// Un account sul servizio e il suo token di sessione.
pub fn service_with_account() -> (tempfile::TempDir, ServiceState, String) {
    let (data_dir, data) = utf8_dir();
    let mut service = ServiceState::open(Some(data.into_std_path_buf())).expect("service");
    let owner = service
        .accounts
        .create_account("proprietaria", "correct-horse-99")
        .expect("account");
    let token = service.accounts.issue_session_token(&owner).expect("token");
    (data_dir, service, token)
}

/// Fa entrare `joiner` nel vault di `owner` con un invito, con un'altra
/// passphrase: lascia impostata quella di `joiner`.
pub fn join_with_invite(
    owner: &Device,
    owner_passphrase: &str,
    joiner: &Device,
    joiner_passphrase: &str,
) -> serde_json::Value {
    let (_secrets_dir, secrets) = utf8_dir();
    owner_only(&secrets.join("invite-passphrase"), joiner_passphrase);
    set_passphrase(owner_passphrase);
    // SAFETY: vedi `set_passphrase`.
    unsafe {
        std::env::set_var(
            "FUB_SYNC_INVITE_PASSPHRASE_FILE",
            secrets.join("invite-passphrase").as_str(),
        )
    };
    let invite = owner
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
    set_passphrase(joiner_passphrase);
    let accepted = joiner
        .job(serde_json::json!({"op": "accept"}))
        .expect("accept");
    unsafe { std::env::remove_var("FUB_SYNC_INVITE_TOKEN_FILE") };
    accepted
}
