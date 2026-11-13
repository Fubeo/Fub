//! Prove HTTP del binario: le rotte servite su un socket vero, con i limiti
//! del front-end e l'ordine dei lock.

use super::*;
use fub_services::sync::{OpKind, SyncOp};
use serde_json::{json, Value};

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        // Un nome univoco, non l'ora: su Windows l'orologio è grossolano, e
        // due test paralleli finivano nella stessa cartella, che il primo a
        // finire cancellava sotto l'altro.
        let path =
            std::env::temp_dir().join(format!("fub-services-sync-http-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// Exercise the same accept -> parser -> dispatcher -> HTTP writer path as
// the loopback binary, rather than invoking sync::handle directly.
fn exchange_raw(state: &Arc<Mutex<ServiceState>>, dir: &Path, request: &[u8]) -> Vec<u8> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let state = Arc::clone(state);
    let dir = dir.to_path_buf();
    let server = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        serve(stream, Instant::now(), &state, &dir);
    });
    let mut client = TcpStream::connect(addr).unwrap();
    client.write_all(request).unwrap();
    client.shutdown(std::net::Shutdown::Write).unwrap();
    let mut bytes = Vec::new();
    client.read_to_end(&mut bytes).unwrap();
    server.join().unwrap();
    bytes
}

fn exchange(state: &Arc<Mutex<ServiceState>>, dir: &Path, request: &[u8]) -> (u16, Value) {
    let bytes = exchange_raw(state, dir, request);
    let boundary = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap();
    let head = std::str::from_utf8(&bytes[..boundary]).unwrap();
    assert!(
        head.contains("\r\ncontent-type: application/json\r\n"),
        "{head}"
    );
    let length: usize = head
        .lines()
        .find_map(|line| line.strip_prefix("content-length: "))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(length, bytes.len() - boundary - 4, "{head}");
    let status = head
        .lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes[boundary + 4..]).unwrap(),
    )
}

fn request(
    state: &Arc<Mutex<ServiceState>>,
    dir: &Path,
    method: &str,
    path: &str,
    auth: Option<&str>,
    body: Value,
) -> (u16, Value) {
    let body = if method == "GET" {
        Vec::new()
    } else {
        serde_json::to_vec(&body).unwrap()
    };
    let header = format!(
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\n{}Content-Length: {}\r\n\r\n",
        auth.map(|a| format!("Authorization: {a}\r\n"))
            .unwrap_or_default(),
        body.len()
    );
    let mut wire = header.into_bytes();
    wire.extend_from_slice(&body);
    exchange(state, dir, &wire)
}

/// STR-06: l'isolamento si configura con la regola di ogni altra
/// amministrazione del sito. Sito assente o record corrotto negano senza
/// scrivere; un Admin persistito nel record passa prima e dopo il riavvio.
#[test]
fn isolation_denies_missing_or_corrupt_sites_and_honours_persisted_admins() {
    use fub_services::acl::Role;
    use fub_services::publish::site;
    let dir = TempDir::new();
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    let bearer = |state: &Arc<Mutex<ServiceState>>, name: &str| {
        let mut state = state.lock();
        let id = state
            .accounts
            .create_account(name, "correct-horse-99")
            .unwrap();
        let token = state.accounts.issue_session_token(&id).unwrap();
        (id, format!("Bearer {token}"))
    };
    let (alice, _) = bearer(&state, "alice");
    let (bob, bob_auth) = bearer(&state, "bob");
    let (_, mallory) = bearer(&state, "mallory");
    let isolate = |state: &Arc<Mutex<ServiceState>>, auth: &str, site: &str| {
        request(
            state,
            &dir.0,
            "POST",
            "/v1/publish/isolation",
            Some(auth),
            json!({ "site_id": site, "mode": "isolated-origin", "origin": "evil.test" }),
        )
    };

    let (status, body) = isolate(&state, &mallory, "futuro");
    assert_ne!(status, 200, "{body}");
    assert!(
        !dir.0.join("sites/futuro").exists(),
        "nothing is pre-seeded"
    );

    std::fs::create_dir_all(dir.0.join("sites/rotto")).unwrap();
    std::fs::write(dir.0.join("sites/rotto/record.json"), b"{ not json").unwrap();
    let (status, body) = isolate(&state, &mallory, "rotto");
    assert_ne!(status, 200, "{body}");
    assert!(!dir.0.join("sites/rotto/isolation.json").exists());

    let mut record = site::create_site(&dir.0, "blog", &alice, None).unwrap();
    record.collaborator_roles.insert(bob.clone(), Role::Admin);
    site::save_record(&dir.0, &record).unwrap();
    assert_eq!(isolate(&state, &bob_auth, "blog").0, 200);
    assert_eq!(isolate(&state, &mallory, "blog").0, 403);
    drop(state);
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    assert_eq!(
        isolate(&state, &bob_auth, "blog").0,
        200,
        "the role survives a restart"
    );
}

#[test]
fn a_new_site_drops_an_orphan_isolation_sidecar() {
    use fub_services::publish::site;
    let dir = TempDir::new();
    std::fs::create_dir_all(dir.0.join("sites/nuovo")).unwrap();
    std::fs::write(
        dir.0.join("sites/nuovo/isolation.json"),
        br#"{"mode":"isolated-origin","origin":"evil.test"}"#,
    )
    .unwrap();
    site::create_site(&dir.0, "nuovo", "owner", None).unwrap();
    assert!(!dir.0.join("sites/nuovo/isolation.json").exists());
}

/// STR-04: nomi sempre nuovi non azzerano il limite. Dopo la raffica
/// dell'origine il login risponde 429 senza calcolare una KDF, e le
/// richieste autenticate restano servite.
#[test]
fn random_login_names_run_out_of_the_origin_budget_before_any_kdf() {
    let dir = TempDir::new();
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    let bearer = {
        let mut state = state.lock();
        let id = state
            .accounts
            .create_account("legit", "correct-horse-99")
            .unwrap();
        format!(
            "Bearer {}",
            state.accounts.issue_session_token(&id).unwrap()
        )
    };
    // La raffica è già stata spesa da questa origine (lo stesso conto di
    // trenta login falliti), senza aspettare trenta KDF.
    {
        let state = state.lock();
        let mut buckets = state.abuse.buckets.lock();
        let now = fub_services::schema::now_ms();
        while buckets.admit("127.0.0.1", now) {}
    }
    let (status, body) = request(
        &state,
        &dir.0,
        "POST",
        "/v1/account/login",
        None,
        json!({ "name": "nome-sempre-nuovo", "password": "qualunque-123" }),
    );
    assert_eq!(
        (status, body["error"].as_str()),
        (429, Some("rate limited"))
    );
    let (status, _) = request(
        &state,
        &dir.0,
        "POST",
        "/v1/account/register",
        None,
        json!({ "name": "altro-nome", "password": "correct-horse-99" }),
    );
    assert_eq!(status, 429);
    assert_eq!(state.lock().abuse.kdf.busy(), 0);
    let (status, _) = request(
        &state,
        &dir.0,
        "GET",
        "/v1/sync/status?vault_id=v",
        Some(&bearer),
        json!(null),
    );
    assert_ne!(status, 429, "authenticated routes are not throttled");
}

#[test]
fn registration_obeys_the_policy_and_the_global_account_cap() {
    let dir = TempDir::new();
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    state.lock().config.registration = fub_services::schema::Registration::Closed;
    let register = |name: &str| {
        request(
            &state,
            &dir.0,
            "POST",
            "/v1/account/register",
            None,
            json!({ "name": name, "password": "correct-horse-99" }),
        )
    };
    assert_eq!(register("admin").0, 201, "the first account bootstraps");
    assert_eq!(register("secondo").1["error"], "registration closed");
    {
        let mut state = state.lock();
        state.config.registration = fub_services::schema::Registration::Open;
        state.config.quotas.max_accounts = 2;
    }
    assert_eq!(register("secondo").0, 201);
    assert_eq!(register("terzo").1["error"], "account quota exceeded");
}

#[test]
fn a_site_password_attempt_spends_the_origin_budget() {
    use fub_services::publish::site;
    let dir = TempDir::new();
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    let hash = fub_services::publish::guard::hash_site_password("site-secret").unwrap();
    site::create_site(&dir.0, "chiuso", "owner", Some(hash)).unwrap();
    {
        let state = state.lock();
        let mut buckets = state.abuse.buckets.lock();
        let now = fub_services::schema::now_ms();
        while buckets.admit("127.0.0.1", now) {}
    }
    let wire =
        b"GET /s/chiuso/ HTTP/1.1\r\nHost: localhost\r\nx-fub-site-password: tentativo\r\n\r\n";
    let bytes = exchange_raw(&state, &dir.0, wire);
    assert!(
        bytes.starts_with(b"HTTP/1.1 429"),
        "{}",
        String::from_utf8_lossy(&bytes)
    );
}

/// STR-05: un commit che aspetta (o lavora) sul proprio sito non tiene il
/// lock globale. Con il lock di `blog` occupato, come durante uno
/// staging lento, un altro account fa login e sync subito.
#[test]
fn a_stalled_vault_does_not_stop_other_vaults_or_logins() {
    let dir = TempDir::new();
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    let (slow, other) = {
        let mut state = state.lock();
        let a = state
            .accounts
            .create_account("lento", "correct-horse-99")
            .unwrap();
        let b = state
            .accounts
            .create_account("altro", "correct-horse-99")
            .unwrap();
        (
            format!("Bearer {}", state.accounts.issue_session_token(&a).unwrap()),
            format!("Bearer {}", state.accounts.issue_session_token(&b).unwrap()),
        )
    };
    let stalled = Arc::clone(&state.lock().vault_locks).of("fermo");
    let held = stalled.lock();
    let waiting = {
        let state = Arc::clone(&state);
        let dir = dir.0.clone();
        std::thread::spawn(move || {
            request(
                &state,
                &dir,
                "GET",
                "/v1/sync/status?vault_id=fermo&replica_id=r1",
                Some(&slow),
                json!(null),
            )
        })
    };
    std::thread::sleep(Duration::from_millis(50));
    let started = Instant::now();
    let (status, body) = request(
        &state,
        &dir.0,
        "POST",
        "/v1/account/login",
        None,
        json!({ "name": "altro", "password": "correct-horse-99" }),
    );
    assert_eq!(status, 200, "{body}");
    let (status, body) = request(
        &state,
        &dir.0,
        "GET",
        "/v1/sync/status?vault_id=libero&replica_id=r2",
        Some(&other),
        json!(null),
    );
    assert_eq!(status, 200, "{body}");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!waiting.is_finished(), "the stalled vault still waits");
    drop(held);
    let (status, body) = waiting.join().unwrap();
    assert_eq!(status, 200, "{body}");
}

#[test]
fn admitted_vault_work_runs_without_the_global_state() {
    let dir = TempDir::new();
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    let token = {
        let mut state = state.lock();
        let a = state
            .accounts
            .create_account("solo", "correct-horse-99")
            .unwrap();
        format!("Bearer {}", state.accounts.issue_session_token(&a).unwrap())
    };
    let admission = fub_services::sync::admit(
        &mut state.lock(),
        "GET",
        "/v1/sync/status?vault_id=v&replica_id=r",
        Some(&token),
        b"",
    );
    let fub_services::sync::Admission::Vault(work) = admission else {
        panic!("status is vault work");
    };
    assert_eq!(work.vault_id(), "v");
    let _global = state.lock();
    assert_eq!(work.run().status, 200);
}

#[test]
fn a_stalled_publish_does_not_stop_other_tenants() {
    let dir = TempDir::new();
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    let (publisher, other) = {
        let mut state = state.lock();
        let a = state
            .accounts
            .create_account("editore", "correct-horse-99")
            .unwrap();
        let b = state
            .accounts
            .create_account("lettore", "correct-horse-99")
            .unwrap();
        (
            format!("Bearer {}", state.accounts.issue_session_token(&a).unwrap()),
            format!("Bearer {}", state.accounts.issue_session_token(&b).unwrap()),
        )
    };
    let blog = Arc::clone(&state.lock().site_locks).of("blog");
    let held = blog.lock();
    let committing = {
        let state = Arc::clone(&state);
        let dir = dir.0.clone();
        std::thread::spawn(move || {
            let body = json!({ "protocol": "fub-publish/1", "site_id": "blog",
                "manifest": { "site_id": "blog" }, "pages": [], "assets": [] });
            request(
                &state,
                &dir,
                "POST",
                "/v1/publish/commit",
                Some(&publisher),
                body,
            )
        })
    };
    std::thread::sleep(Duration::from_millis(50));
    let started = Instant::now();
    let (status, body) = request(
        &state,
        &dir.0,
        "POST",
        "/v1/account/login",
        None,
        json!({ "name": "lettore", "password": "correct-horse-99" }),
    );
    assert_eq!(status, 200, "{body}");
    let (status, _) = request(
        &state,
        &dir.0,
        "GET",
        "/v1/sync/status?vault_id=v",
        Some(&other),
        json!(null),
    );
    assert_ne!(status, 500);
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(
        !committing.is_finished(),
        "the commit is still waiting on its site"
    );
    drop(held);
    committing.join().unwrap();
}

#[test]
fn every_sync_handler_is_reachable_through_loopback_http() {
    let dir = TempDir::new();
    let mut state = ServiceState::open(Some(dir.0.clone())).unwrap();
    let owner = state
        .accounts
        .create_account("http-owner", "correct-horse-99")
        .unwrap();
    let guest = state
        .accounts
        .create_account("http-guest", "correct-horse-99")
        .unwrap();
    let owner_auth = format!(
        "Bearer {}",
        state.accounts.issue_session_token(&owner).unwrap()
    );
    let guest_auth = format!(
        "Bearer {}",
        state.accounts.issue_session_token(&guest).unwrap()
    );
    let state = Arc::new(Mutex::new(state));
    let vault = "http-vault";
    let doc = "notes/http.md";
    let op = SyncOp {
        op_id: "http-op-1".to_string(),
        replica_id: "http-replica".to_string(),
        doc_id: doc.to_string(),
        kind: OpKind::Create,
        vv: [("http-replica".to_string(), 1)].into(),
        ciphertext_b64: "YQ==".to_string(),
        nonce_b64: "AAAAAAAAAAAAAAAA".to_string(),
        aad: String::new(),
        ts_ms: fub_services::schema::now_ms(),
        vault_id: vault.to_string(),
        key_epoch: 0,
        rename_from: None,
        rename_to: None,
    };
    let push = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/push",
        Some(&owner_auth),
        json!({"protocol":"fub-sync/1","replica_id":"http-replica","ops":[op]}),
    );
    assert_eq!(push.0, 200, "{push:?}");
    assert_eq!(push.1["ack"], json!(["http-op-1"]));
    assert_eq!(push.1["server_vv"]["http-replica"], "1");

    let pull = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/pull",
        Some(&owner_auth),
        json!({"replica_id":"http-peer","vault_id":vault,"since_vv":{}}),
    );
    assert_eq!(pull.0, 200, "{pull:?}");
    assert_eq!(pull.1["ops"][0]["vv"]["http-replica"], "1");
    let ack = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/ack",
        Some(&owner_auth),
        json!({"replica_id":"http-replica","vault_id":vault,"ack":["http-op-1"]}),
    );
    assert_eq!(ack.0, 200, "{ack:?}");
    assert_eq!(ack.1["acked"], json!(["http-op-1"]));

    let status = request(
        &state,
        &dir.0,
        "GET",
        &format!("/v1/sync/status?vault_id={vault}&replica_id=http-replica"),
        Some(&owner_auth),
        Value::Null,
    );
    assert_eq!(status.0, 200, "{status:?}");
    assert_eq!(status.1["server_vv"]["http-replica"], "1");
    let versions = request(
        &state,
        &dir.0,
        "GET",
        &format!("/v1/sync/versions?vault_id={vault}&doc_id=notes%2Fhttp.md"),
        Some(&owner_auth),
        Value::Null,
    );
    assert_eq!(versions.0, 200, "{versions:?}");
    assert_eq!(versions.1["versions"][0]["version"], "1");

    let trash = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/trash",
        Some(&owner_auth),
        json!({"doc_id":doc,"vault_id":vault}),
    );
    assert_eq!(trash.0, 200, "{trash:?}");
    assert_eq!(trash.1["trashed"], doc);
    let restore = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/restore",
        Some(&owner_auth),
        json!({"doc_id":doc,"vault_id":vault}),
    );
    assert_eq!(restore.0, 200, "{restore:?}");
    assert_eq!(restore.1["requires_fresh_push"], true);

    let wrapped = fub_services::crypto::wrap_vdk_with_kek(
        &[7; 32],
        &[9; 32],
        fub_services::crypto::KdfParams::fresh().unwrap(),
    )
    .unwrap();
    let stored = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/vault-key",
        Some(&owner_auth),
        json!({"vault_id":vault,"wrapped":wrapped}),
    );
    assert_eq!(stored.0, 200, "{stored:?}");
    let key = request(
        &state,
        &dir.0,
        "GET",
        &format!("/v1/sync/vault-key?vault_id={vault}"),
        Some(&owner_auth),
        Value::Null,
    );
    assert_eq!(key.0, 200, "{key:?}");
    assert_eq!(key.1["wrapped"], serde_json::to_value(&wrapped).unwrap());
    assert!(key.1["wrapped_hash"].is_string());

    let invite = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/invite",
        Some(&owner_auth),
        json!({"vault_id":vault,"role":"writer"}),
    );
    assert_eq!(invite.0, 201, "{invite:?}");
    let accepted = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/invite/accept",
        Some(&guest_auth),
        json!({"token_b64": invite.1["token_b64"]}),
    );
    assert_eq!(accepted.0, 200, "{accepted:?}");
    assert_eq!(accepted.1["role"], "writer");
    let revoked = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/revoke",
        Some(&owner_auth),
        json!({"vault_id":vault,"account_id":guest}),
    );
    assert_eq!(revoked.0, 200, "{revoked:?}");
    let forbidden = request(
        &state,
        &dir.0,
        "GET",
        &format!("/v1/sync/vault-key?vault_id={vault}"),
        Some(&guest_auth),
        Value::Null,
    );
    assert_eq!(forbidden.0, 403, "{forbidden:?}");
    assert!(forbidden.1["error"].is_string());
}

/// Il limite dei login ricorda soltanto nomi che un account può portare,
/// conta il tentativo prima della verifica e lo restituisce a una
/// password giusta.
#[test]
fn login_limit_remembers_only_names_an_account_can_have() {
    let dir = TempDir::new();
    let mut state = ServiceState::open(Some(dir.0.clone())).unwrap();
    state
        .accounts
        .create_account("limite", "correct-horse-99")
        .unwrap();
    let state = Arc::new(Mutex::new(state));
    let login = |name: &str, password: &str| {
        request(
            &state,
            &dir.0,
            "POST",
            "/v1/account/login",
            None,
            json!({ "name": name, "password": password }),
        )
    };

    let long = "n".repeat(fub_services::auth::MAX_ACCOUNT_NAME + 1);
    assert_eq!(login(&long, "qualunque").0, 401);
    assert_eq!(
        state.lock().logins.tracked(),
        0,
        "un nome impossibile non pesa"
    );

    assert_eq!(login("limite", "sbagliata-123").0, 401);
    assert_eq!(state.lock().logins.tracked(), 1);
    let (status, body) = login("limite", "correct-horse-99");
    assert_eq!(status, 200, "{body}");
    assert_eq!(state.lock().logins.tracked(), 0);

    let now = fub_services::schema::now_ms();
    for _ in 0..5 {
        state.lock().logins.note_fail("limite", now);
    }
    assert_eq!(login("limite", "correct-horse-99").0, 429);
}

/// Il secondo fattore è un fatto persistito dell'account: sopravvive al
/// riavvio, si attiva soltanto con un codice che prova il segreto, e un
/// token di sessione da solo non lo sostituisce. I login falliti, qualunque
/// nome portino, non consumano i tentativi TOTP di nessuno.
#[test]
fn mfa_survives_a_restart_and_a_session_token_alone_cannot_replace_it() {
    let dir = TempDir::new();
    let mut state = ServiceState::open(Some(dir.0.clone())).unwrap();
    let alice = state
        .accounts
        .create_account("alice", "correct-horse-99")
        .unwrap();
    let state = Arc::new(Mutex::new(state));
    let login = |state: &Arc<Mutex<ServiceState>>, code: Option<String>| {
        request(
            state,
            &dir.0,
            "POST",
            "/v1/account/login",
            None,
            json!({ "name": "alice", "password": "correct-horse-99", "code": code }),
        )
    };
    let (status, body) = login(&state, None);
    assert_eq!(status, 200, "{body}");
    let bearer = format!("Bearer {}", body["token"].as_str().unwrap());
    let mfa = |state: &Arc<Mutex<ServiceState>>, body: Value| {
        request(state, &dir.0, "POST", "/v1/mfa/verify", Some(&bearer), body)
    };

    let (status, body) = mfa(&state, json!({ "enroll": true }));
    assert_eq!(status, 201, "{body}");
    let secret = body["secret_b64"].as_str().unwrap().to_string();
    assert_eq!(
        login(&state, None).0,
        200,
        "un'iscrizione non confermata non chiude fuori nessuno"
    );
    let now = fub_services::schema::now_ms();
    let code = |at: u64| fub_services::mfa::totp_code(&secret, at).unwrap();
    let (status, body) = mfa(&state, json!({ "code": code(now) }));
    assert_eq!(status, 200, "{body}");

    // Il riavvio vero: il primo processo lascia la data dir prima che il
    // secondo la apra (il lease è esclusivo).
    drop(state);
    let restarted = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    let (status, body) = login(&restarted, None);
    assert_eq!(
        (status, body["error"].as_str()),
        (401, Some("mfa required")),
        "il riavvio non spegne il secondo fattore: {body}"
    );
    let (status, body) = mfa(&restarted, json!({ "enroll": true }));
    assert_eq!(
        (status, body["error"].as_str()),
        (401, Some("mfa required")),
        "il token da solo non rimpiazza il segreto: {body}"
    );
    assert_eq!(
        login(&restarted, Some(code(now))).0,
        401,
        "il codice della conferma non si rigioca dopo il riavvio"
    );

    for name in [format!("login:{alice}"), alice.clone()] {
        for _ in 0..5 {
            request(
                &restarted,
                &dir.0,
                "POST",
                "/v1/account/login",
                None,
                json!({ "name": name, "password": "sbagliata-123" }),
            );
        }
    }
    let (status, body) = login(&restarted, Some(code(now + 30_000)));
    assert_eq!(status, 200, "{body}");
}

#[test]
fn sync_http_rejects_unauthorized_unmatched_and_oversized_requests() {
    let dir = TempDir::new();
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    for (method, path) in [
        ("POST", "/v1/sync/push"),
        ("POST", "/v1/sync/pull"),
        ("POST", "/v1/sync/ack"),
        ("GET", "/v1/sync/status"),
        ("GET", "/v1/sync/versions"),
        ("POST", "/v1/sync/trash"),
        ("POST", "/v1/sync/restore"),
        ("POST", "/v1/sync/invite"),
        ("POST", "/v1/sync/invite/accept"),
        ("POST", "/v1/sync/revoke"),
        ("POST", "/v1/sync/vault-key"),
        ("GET", "/v1/sync/vault-key"),
    ] {
        let (status, body) = request(&state, &dir.0, method, path, None, json!({}));
        assert_eq!(status, 401, "{method} {path}: {body}");
        assert!(body["error"].is_string(), "{method} {path}: {body}");
    }
    for (method, path) in [
        ("GET", "/v1/sync/push"),
        ("POST", "/v1/sync/status"),
        ("POST", "/v1/sync/missing"),
        ("GET", "/v1/sync/invite"),
    ] {
        let (status, body) = request(&state, &dir.0, method, path, None, json!({}));
        assert_eq!(status, 404, "{method} {path}: {body}");
        assert_eq!(body["error"], "unknown route");
    }
    let oversized =
        b"POST /v1/sync/invite HTTP/1.1\r\nHost: localhost\r\nContent-Length: 65537\r\n\r\n";
    let (status, body) = exchange(&state, &dir.0, oversized);
    assert_eq!(status, 413);
    assert_eq!(body["error"], "body too large");
    assert!(
        exchange_raw(&state, &dir.0, oversized).starts_with(b"HTTP/1.1 413 Content Too Large\r\n")
    );
    let duplicate = b"POST /v1/sync/invite HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}";
    let (status, body) = exchange(&state, &dir.0, duplicate);
    assert_eq!(status, 400);
    assert_eq!(body["error"], "duplicate content-length");
    let oversized_pull =
        b"POST /v1/sync/pull HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1048577\r\n\r\n";
    let (status, body) = exchange(&state, &dir.0, oversized_pull);
    assert_eq!(status, 413);
    assert_eq!(body["error"], "body too large");
    let get_with_body =
        b"GET /v1/sync/status HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}";
    let (status, body) = exchange(&state, &dir.0, get_with_body);
    assert_eq!(status, 400);
    assert_eq!(body["error"], "body not allowed");
    let mut state_guard = state.lock();
    let owner = state_guard
        .accounts
        .create_account("http-negative", "correct-horse-99")
        .unwrap();
    let auth = format!(
        "Bearer {}",
        state_guard.accounts.issue_session_token(&owner).unwrap()
    );
    drop(state_guard);
    let (status, body) = request(
        &state,
        &dir.0,
        "POST",
        "/v1/sync/invite",
        Some(&auth),
        json!({"role":"unrecognized"}),
    );
    assert_eq!(status, 400);
    assert_eq!(body["error"], "bad invite body");
}

#[test]
fn publish_admin_body_limits_and_roles_survive_restart() {
    let dir = TempDir::new();
    let mut service = ServiceState::open(Some(dir.0.clone())).unwrap();
    let owner = service
        .accounts
        .create_account("site-owner", "correct-horse-99")
        .unwrap();
    let admin = service
        .accounts
        .create_account("site-admin", "correct-horse-99")
        .unwrap();
    let owner_auth = format!(
        "Bearer {}",
        service.accounts.issue_session_token(&owner).unwrap()
    );
    let admin_auth = format!(
        "Bearer {}",
        service.accounts.issue_session_token(&admin).unwrap()
    );
    let state = Arc::new(Mutex::new(service));
    let path = "/v1/publish/site";
    assert_eq!(
        request(&state, &dir.0, "GET", path, Some(&owner_auth), Value::Null).0,
        404
    );
    assert_eq!(
        request(
            &state,
            &dir.0,
            "POST",
            path,
            None,
            json!({"protocol":"fub-publish/1","site_id":"journal"})
        )
        .0,
        401
    );

    let oversized = format!(
        "POST {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: {owner_auth}\r\nContent-Length: {}\r\n\r\n",
        SMALL_BODY + 1
    );
    assert_eq!(exchange(&state, &dir.0, oversized.as_bytes()).0, 413);
    let malformed = format!(
        "POST {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: {owner_auth}\r\nContent-Length: 1\r\n\r\n{{"
    );
    assert_eq!(exchange(&state, &dir.0, malformed.as_bytes()).0, 400);
    assert!(!fub_services::publish::site::site_dir(&dir.0, "journal").exists());

    let created = request(
        &state,
        &dir.0,
        "POST",
        path,
        Some(&owner_auth),
        json!({"protocol":"fub-publish/1","site_id":"journal",
            "grant":{"account_id":admin,"role":"admin"}}),
    );
    assert_eq!(created.0, 200, "{created:?}");
    drop(state);
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    let change = json!({"protocol":"fub-publish/1","site_id":"journal","theme_css":"theme.css"});
    assert_eq!(
        request(
            &state,
            &dir.0,
            "POST",
            path,
            Some(&admin_auth),
            change.clone()
        )
        .0,
        200
    );
    let downgraded = request(
        &state,
        &dir.0,
        "POST",
        path,
        Some(&owner_auth),
        json!({"protocol":"fub-publish/1","site_id":"journal",
            "grant":{"account_id":admin,"role":"writer"}}),
    );
    assert_eq!(downgraded.0, 200, "{downgraded:?}");
    drop(state);
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    assert_eq!(
        request(
            &state,
            &dir.0,
            "POST",
            path,
            Some(&admin_auth),
            change.clone()
        )
        .0,
        403
    );
    let revoked = request(
        &state,
        &dir.0,
        "POST",
        path,
        Some(&owner_auth),
        json!({"protocol":"fub-publish/1","site_id":"journal","revoke":admin}),
    );
    assert_eq!(revoked.0, 200, "{revoked:?}");
    drop(state);
    let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
    assert_eq!(
        request(&state, &dir.0, "POST", path, Some(&admin_auth), change).0,
        403
    );
    let record = fub_services::publish::site::load_record(&dir.0, "journal").unwrap();
    assert_eq!(record.theme_css.as_deref(), Some("theme.css"));
}

fn static_request(
    state: &Arc<Mutex<ServiceState>>,
    dir: &Path,
    path: &str,
    host: &str,
    headers: &str,
) -> (u16, Vec<u8>) {
    let wire = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{headers}\r\n");
    let bytes = exchange_raw(state, dir, wire.as_bytes());
    let boundary = bytes.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let status = std::str::from_utf8(&bytes[..boundary])
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    (status, bytes[boundary + 4..].to_vec())
}

#[test]
fn static_site_password_uses_header_and_domain_requires_provisioning() {
    let dir = TempDir::new();
    let mut service = ServiceState::open(Some(dir.0.clone())).unwrap();
    let owner = service
        .accounts
        .create_account("static-owner", "correct-horse-99")
        .unwrap();
    let owner_auth = format!(
        "Bearer {}",
        service.accounts.issue_session_token(&owner).unwrap()
    );
    let state = Arc::new(Mutex::new(service));
    let created = request(
        &state,
        &dir.0,
        "POST",
        "/v1/publish/site",
        Some(&owner_auth),
        json!({"protocol":"fub-publish/1","site_id":"web",
            "password":"site-secret",
            "tls":{"domain":"example.test","path_prefix":"/notes/","provisioned":false}}),
    );
    assert_eq!(created.0, 200, "{created:?}");
    let mut record = fub_services::publish::site::load_record(&dir.0, "web").unwrap();
    record.live_version = Some(1);
    fub_services::publish::site::save_record(&dir.0, &record).unwrap();
    let live = fub_services::publish::site::public_base_path(&dir.0, "web");
    std::fs::create_dir_all(&live).unwrap();
    std::fs::write(live.join(".fub-cache-epoch"), b"1").unwrap();
    std::fs::write(live.join("index.html"), b"<h1>site</h1>").unwrap();

    assert_eq!(
        static_request(&state, &dir.0, "/s/web/", "localhost", "").0,
        401
    );
    assert_eq!(
        static_request(
            &state,
            &dir.0,
            "/s/web/?password=site-secret",
            "localhost",
            ""
        )
        .0,
        400
    );
    assert_eq!(
        static_request(
            &state,
            &dir.0,
            "/s/web/?password=site-secret",
            "localhost",
            "X-Fub-Site-Password: site-secret\r\n"
        )
        .0,
        400
    );
    assert_eq!(
        static_request(
            &state,
            &dir.0,
            "/s/web/",
            "localhost",
            "X-Fub-Site-Password: wrong\r\n"
        )
        .0,
        401
    );
    assert_eq!(
        static_request(
            &state,
            &dir.0,
            "/s/web/",
            "localhost",
            "X-Fub-Site-Password: site-secret\r\nX-Fub-Site-Password: wrong\r\n"
        )
        .0,
        400
    );
    let canonical = static_request(
        &state,
        &dir.0,
        "/s/web/",
        "localhost",
        "X-Fub-Site-Password: site-secret\r\n",
    );
    assert_eq!(canonical.0, 200);
    assert_eq!(canonical.1, b"<h1>site</h1>");
    assert_eq!(
        static_request(
            &state,
            &dir.0,
            "/s/web/",
            "example.test",
            "X-Fub-Site-Password: site-secret\r\n"
        )
        .0,
        403
    );

    // Only the external operator can mark a domain provisioned; the
    // administration request accepts intent with provisioned=false.
    record.tls.as_mut().unwrap().provisioned = true;
    fub_services::publish::site::save_record(&dir.0, &record).unwrap();
    let domain = static_request(
        &state,
        &dir.0,
        "/s/web/",
        "example.test",
        "X-Fub-Site-Password: site-secret\r\n",
    );
    assert_eq!(domain.0, 200);
    assert_eq!(domain.1, canonical.1);
}
