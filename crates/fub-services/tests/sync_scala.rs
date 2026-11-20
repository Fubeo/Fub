// Misura del server di sync su una storia lunga (audit PERF-01).
//
// Il test è `#[ignore]`: non prova un comportamento, misura. Si lancia così:
//
//     cargo test -p fub-services --release --test sync_scala -- --ignored --nocapture
//
// Costruisce un vault con 10.000 versioni (2.000 note × 5 versioni, testi
// cifrati da ~4 KB in base64, come una nota vera di qualche pagina) e misura:
// - il push di un op su quella storia (con l'ack che il client manda subito);
// - il pull completo da zero, pagina dopo pagina, come fa il client;
// - lo stato (`/v1/sync/status`);
// - una coda che cresce: push da un op senza ack (la coda `.jsonl` della
//   replica si allunga a ogni push).

use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, Instant};

use fub_services::server::ServiceState;
use fub_services::sync::{self, OpKind, SyncOp};

const VAULT: &str = "vault-scala";
const DOCS: usize = 2_000;
const VERSIONS_PER_DOC: usize = 5;
const CIPHERTEXT_BYTES: usize = 4_096;

struct Replica {
    id: String,
    vv: BTreeMap<String, u64>,
    clock: u64,
}

impl Replica {
    fn new(name: &str) -> Self {
        Self {
            id: format!("replica-{name}"),
            vv: BTreeMap::new(),
            clock: 1_700_000_000_000,
        }
    }

    fn op(&mut self, doc: &str, seed: u64) -> SyncOp {
        let counter = self.vv.entry(self.id.clone()).or_insert(0);
        *counter += 1;
        self.clock += 1;
        let op_id = format!("op-{}-{}", self.id, self.vv[&self.id]);
        let kind = OpKind::Update;
        let env = fub_services::crypto::SyncEnvelope {
            protocol: "fub-sync/1".to_string(),
            vault_id: VAULT.to_string(),
            key_epoch: 0,
            op_id: op_id.clone(),
            replica_id: self.id.clone(),
            doc_id: doc.to_string(),
            kind: kind.as_str().to_string(),
            vv: self.vv.clone(),
            ts_ms: self.clock,
            rename_from: None,
            rename_to: None,
        };
        SyncOp {
            op_id,
            replica_id: self.id.clone(),
            doc_id: doc.to_string(),
            kind,
            vv: self.vv.clone(),
            ciphertext_b64: ciphertext(seed),
            nonce_b64: "bm9uY2Utbm9uY2Utbm9uY2U=".to_string(),
            aad: fub_services::crypto::canonical_aad_json(&env),
            ts_ms: self.clock,
            vault_id: VAULT.to_string(),
            key_epoch: 0,
            rename_from: None,
            rename_to: None,
        }
    }
}

/// Base64 pseudo-casuale e deterministico: un testo cifrato non si comprime.
fn ciphertext(seed: u64) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    (0..CIPHERTEXT_BYTES)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            ALPHABET[(x % 64) as usize] as char
        })
        .collect()
}

fn open_state(dir: &Path) -> ServiceState {
    let mut state = ServiceState::open(Some(dir.to_path_buf())).expect("open state");
    state.config.quotas.max_vault_bytes = 4 * 1024 * 1024 * 1024;
    state
}

fn auth_for(state: &mut ServiceState, name: &str) -> String {
    let id = state
        .accounts
        .create_account(name, "correct-horse-99")
        .expect("create account");
    let token = state.accounts.issue_session_token(&id).expect("token");
    format!("Bearer {token}")
}

fn post(state: &mut ServiceState, auth: &str, path: &str, body: &serde_json::Value) -> Vec<u8> {
    let resp = sync::handle(
        state,
        "POST",
        path,
        Some(auth),
        &serde_json::to_vec(body).unwrap(),
    );
    assert_eq!(
        resp.status,
        200,
        "{path}: {}",
        String::from_utf8_lossy(&resp.body)
    );
    resp.body
}

fn push(state: &mut ServiceState, auth: &str, replica: &str, ops: &[SyncOp]) -> Vec<String> {
    let body = post(
        state,
        auth,
        "/v1/sync/push",
        &serde_json::json!({ "protocol": "fub-sync/1", "replica_id": replica, "ops": ops }),
    );
    let resp: sync::PushResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(resp.ack.len(), ops.len());
    resp.ack
}

fn ack(state: &mut ServiceState, auth: &str, replica: &str, ids: &[String]) {
    post(
        state,
        auth,
        "/v1/sync/ack",
        &serde_json::json!({ "replica_id": replica, "vault_id": VAULT, "ack": ids }),
    );
}

/// Pull completo da zero, come il client: offset e vettore della prima pagina.
fn pull_all(state: &mut ServiceState, auth: &str, replica: &str) -> (usize, usize) {
    let mut offset: Option<u64> = None;
    let mut snapshot = serde_json::json!({});
    let mut ops = 0;
    let mut pages = 0;
    loop {
        let mut req = serde_json::json!({
            "protocol": "fub-sync/1", "replica_id": replica, "vault_id": VAULT,
            "since_vv": {},
        });
        if let Some(offset) = offset {
            req["offset"] = serde_json::json!(offset.to_string());
            req["snapshot_vv"] = snapshot.clone();
        }
        let body = post(state, auth, "/v1/sync/pull", &req);
        let page: serde_json::Value = serde_json::from_slice(&body).unwrap();
        pages += 1;
        ops += page["ops"].as_array().unwrap().len();
        if page["truncated"] != true {
            return (ops, pages);
        }
        snapshot = page["server_vv"].clone();
        offset = Some(page["next_offset"].as_str().unwrap().parse().unwrap());
    }
}

fn status(state: &mut ServiceState, auth: &str, replica: &str) {
    let path = format!("/v1/sync/status?vault_id={VAULT}&replica_id={replica}");
    let resp = sync::handle(state, "GET", &path, Some(auth), b"");
    assert_eq!(resp.status, 200);
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

#[test]
#[ignore = "misura: cargo test -p fub-services --release --test sync_scala -- --ignored --nocapture"]
fn misura_una_storia_di_diecimila_versioni() {
    let dir = tempfile::Builder::new()
        .prefix("fub-sync-scala-")
        .tempdir()
        .unwrap();
    let mut state = open_state(dir.path());
    let auth = auth_for(&mut state, "scala");
    let mut a = Replica::new("a");

    let started = Instant::now();
    let mut seed = 0u64;
    for round in 0..VERSIONS_PER_DOC {
        for batch in (0..DOCS).step_by(500) {
            let ops: Vec<SyncOp> = (batch..batch + 500)
                .map(|doc| {
                    seed += 1;
                    a.op(&format!("notes/nota-{doc:05}.md"), seed)
                })
                .collect();
            let acked = push(&mut state, &auth, &a.id, &ops);
            ack(&mut state, &auth, &a.id, &acked);
        }
        eprintln!("  giro {round}: {:.0} ms", ms(started.elapsed()));
    }
    let build = started.elapsed();
    let state_file = sync::versions::state_path(&sync::vault_dir(
        &fub_services::schema::sync_dir(dir.path()),
        VAULT,
    ));
    let state_bytes = std::fs::metadata(&state_file).unwrap().len();

    const PUSHES: usize = 50;
    let started = Instant::now();
    for i in 0..PUSHES {
        seed += 1;
        let op = a.op(&format!("notes/nota-{:05}.md", i * 37 % DOCS), seed);
        let acked = push(&mut state, &auth, &a.id, &[op]);
        ack(&mut state, &auth, &a.id, &acked);
    }
    let push_each = started.elapsed() / PUSHES as u32;

    const PULLS: usize = 3;
    let started = Instant::now();
    let mut pulled = (0, 0);
    for _ in 0..PULLS {
        pulled = pull_all(&mut state, &auth, "replica-b");
    }
    let pull_each = started.elapsed() / PULLS as u32;
    assert_eq!(pulled.0, DOCS * VERSIONS_PER_DOC + PUSHES);

    const STATUSES: usize = 20;
    let started = Instant::now();
    for _ in 0..STATUSES {
        status(&mut state, &auth, &a.id);
    }
    let status_each = started.elapsed() / STATUSES as u32;

    // Coda che cresce: un vault piccolo, push da un op senza ack.
    let queue_dir = tempfile::Builder::new()
        .prefix("fub-sync-scala-coda-")
        .tempdir()
        .unwrap();
    let mut queued = open_state(queue_dir.path());
    let auth_q = auth_for(&mut queued, "coda");
    let mut c = Replica::new("c");
    const QUEUED: usize = 2_000;
    let started = Instant::now();
    let mut first = Duration::ZERO;
    let mut last = Duration::ZERO;
    for i in 0..QUEUED {
        let op = c.op(&format!("notes/coda-{:03}.md", i % 200), i as u64);
        let t = Instant::now();
        push(&mut queued, &auth_q, &c.id, &[op]);
        if i < 100 {
            first += t.elapsed();
        }
        if i >= QUEUED - 100 {
            last += t.elapsed();
        }
    }
    let queue_total = started.elapsed();

    eprintln!(
        "MISURA sync, {} versioni, state.json {:.1} MB",
        DOCS * VERSIONS_PER_DOC,
        state_bytes as f64 / 1e6
    );
    eprintln!("  costruzione (20 push da 500 + ack): {:.0} ms", ms(build));
    eprintln!(
        "  push di un op + ack:                {:.1} ms",
        ms(push_each)
    );
    eprintln!(
        "  pull completo ({} pagine, {} op):  {:.1} ms",
        pulled.1,
        pulled.0,
        ms(pull_each)
    );
    eprintln!(
        "  status:                             {:.1} ms",
        ms(status_each)
    );
    eprintln!(
        "  coda senza ack, {QUEUED} push: {:.0} ms (primi 100: {:.2} ms/push, ultimi 100: {:.2} ms/push)",
        ms(queue_total),
        ms(first) / 100.0,
        ms(last) / 100.0
    );
}
