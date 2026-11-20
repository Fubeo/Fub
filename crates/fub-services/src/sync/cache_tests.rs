//! Test dello stato in memoria: il disco resta l'autorità, una scrittura
//! fallita o interrotta lascia il valore di prima, le pagine riprese dal
//! cursore sono quelle contate da capo, e richieste concorrenti convergono.

use super::*;
use std::collections::BTreeMap;
use std::sync::Arc;

const VAULT: &str = "vault-cache";

fn op(replica: &str, count: u64, doc_id: &str) -> SyncOp {
    let vv = BTreeMap::from([(replica.to_string(), count)]);
    let mut op = SyncOp {
        op_id: format!("op-{replica}-{count}"),
        replica_id: replica.to_string(),
        doc_id: doc_id.to_string(),
        kind: OpKind::Update,
        vv,
        ciphertext_b64: format!("Q1Q6{count:08}"),
        nonce_b64: "bm9uY2U=".to_string(),
        aad: String::new(),
        ts_ms: 1_700_000_000_000 + count,
        vault_id: VAULT.to_string(),
        key_epoch: 0,
        rename_from: None,
        rename_to: None,
    };
    let envelope = check_op_aad(&op).unwrap();
    op.aad = crate::crypto::canonical_aad_json(&envelope);
    op
}

struct Bench {
    dir: tempfile::TempDir,
    state: Option<ServiceState>,
    auth: String,
}

impl Bench {
    fn new(name: &str) -> Self {
        let dir = tempfile::Builder::new()
            .prefix(&format!("fub-sync-cache-{name}-"))
            .tempdir()
            .unwrap();
        let mut state = ServiceState::open(Some(dir.path().to_path_buf())).unwrap();
        let account = state
            .accounts
            .create_account("cache-user", "correct-horse-99")
            .unwrap();
        let token = state.accounts.issue_session_token(&account).unwrap();
        Self {
            dir,
            state: Some(state),
            auth: format!("Bearer {token}"),
        }
    }

    fn state(&mut self) -> &mut ServiceState {
        self.state.as_mut().expect("service open")
    }

    /// Un riavvio: il processo nuovo non ha niente in memoria.
    fn restart(&mut self) {
        // Il lease della data dir si rilascia col vecchio stato.
        drop(self.state.take());
        cache::forget_all();
        let mut state = ServiceState::open(Some(self.dir.path().to_path_buf())).unwrap();
        let (account, _) = state.accounts.password_hash_of("cache-user").unwrap();
        let token = state.accounts.issue_session_token(&account).unwrap();
        self.state = Some(state);
        self.auth = format!("Bearer {token}");
    }

    fn vault_dir(&self) -> PathBuf {
        vault_dir(&schema::sync_dir(self.dir.path()), VAULT)
    }

    fn call(&mut self, path: &str, body: serde_json::Value) -> (u16, serde_json::Value) {
        let auth = self.auth.clone();
        let response = handle(
            self.state(),
            "POST",
            path,
            Some(&auth),
            &serde_json::to_vec(&body).unwrap(),
        );
        let value = serde_json::from_slice(&response.body).unwrap_or(serde_json::Value::Null);
        (response.status, value)
    }

    fn push(&mut self, replica: &str, ops: &[SyncOp]) -> (u16, serde_json::Value) {
        self.call(
            "/v1/sync/push",
            serde_json::json!({ "protocol": SYNC_PROTOCOL, "replica_id": replica, "ops": ops }),
        )
    }

    fn pull_page(
        &mut self,
        offset: Option<u64>,
        snapshot: &serde_json::Value,
    ) -> serde_json::Value {
        let mut req = serde_json::json!({
            "protocol": SYNC_PROTOCOL, "replica_id": "replica-z", "vault_id": VAULT,
            "since_vv": {},
        });
        if let Some(offset) = offset {
            req["offset"] = serde_json::json!(offset.to_string());
            req["snapshot_vv"] = snapshot.clone();
        }
        let (status, page) = self.call("/v1/sync/pull", req);
        assert_eq!(status, 200, "{page}");
        page
    }

    /// Gli op_id di un pull completo, pagina dopo pagina; `restart_between`
    /// dimentica la memoria prima di ogni pagina (niente cursore).
    fn pull_ids(&mut self, restart_between: bool) -> (Vec<String>, usize) {
        let mut ids = Vec::new();
        let mut pages = 0;
        let mut offset = None;
        let mut snapshot = serde_json::json!({});
        loop {
            if restart_between {
                cache::forget_all();
            }
            let page = self.pull_page(offset, &snapshot);
            pages += 1;
            for op in page["ops"].as_array().unwrap() {
                ids.push(op["op_id"].as_str().unwrap().to_string());
            }
            if page["truncated"] != true {
                return (ids, pages);
            }
            snapshot = page["server_vv"].clone();
            offset = Some(page["next_offset"].as_str().unwrap().parse().unwrap());
        }
    }
}

/// Una scrittura dello stato che fallisce lascia il valore di prima anche
/// in memoria: la richiesta seguente non vede l'op che non è stato salvato.
/// L'op era già nella coda durevole: il push seguente lo ripiega, niente si
/// perde.
#[cfg(unix)]
#[test]
fn a_failed_state_write_leaves_the_previous_state_in_memory_too() {
    use std::os::unix::fs::PermissionsExt;
    let mut bench = Bench::new("scrittura-fallita");
    let (status, body) = bench.push("replica-a", &[op("replica-a", 1, "notes/a.md")]);
    assert_eq!(status, 200, "{body}");
    let dir = bench.vault_dir();
    assert!(cache::cached(&dir), "the saved state stays in memory");

    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    let probe = dir.join(".probe");
    let writable = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    let failed = bench.push("replica-a", &[op("replica-a", 2, "notes/b.md")]);
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    if writable {
        // Da root la cartella resta scrivibile: niente da provare.
        return;
    }
    assert_eq!(failed.0, 500, "{}", failed.1);

    let (ids, _) = bench.pull_ids(false);
    assert_eq!(ids, vec!["op-replica-a-1"], "nothing unsaved is served");
    let (status, body) = bench.push("replica-a", &[op("replica-a", 3, "notes/c.md")]);
    assert_eq!(status, 200, "{body}");
    let (ids, _) = bench.pull_ids(false);
    assert_eq!(
        ids,
        vec!["op-replica-a-1", "op-replica-a-2", "op-replica-a-3"],
        "the queued op is replayed, none is lost"
    );
}

/// Un crash a metà del salvataggio lascia il temporaneo e il file di prima:
/// al riavvio lo stato è quello di prima, il temporaneo non conta nella
/// quota e non disturba i salvataggi seguenti. Un crash fra la coda e lo
/// stato lascia la coda avanti: il push dopo il riavvio la ripiega.
#[test]
fn a_crash_mid_write_restarts_from_the_previous_state() {
    let mut bench = Bench::new("crash");
    let (status, body) = bench.push(
        "replica-a",
        &[
            op("replica-a", 1, "notes/a.md"),
            op("replica-a", 2, "notes/b.md"),
        ],
    );
    assert_eq!(status, 200, "{body}");
    let dir = bench.vault_dir();
    let before = std::fs::read(versions::state_path(&dir)).unwrap();
    let queue_before = queue::vault_queue_bytes(&dir);
    // Il temporaneo di una scrittura interrotta: nome come `atomic_write`,
    // contenuto troncato a metà.
    let stray = dir.join(format!(".state.json.{}.0.0.tmp", std::process::id()));
    std::fs::write(&stray, &before[..before.len() / 2]).unwrap();
    // E l'op che la coda aveva già scritto quando lo stato non era salvato.
    queue::append_ops(&dir, "replica-a", &[op("replica-a", 3, "notes/c.md")]).unwrap();

    bench.restart();
    assert_eq!(std::fs::read(versions::state_path(&dir)).unwrap(), before);
    assert!(queue::vault_queue_bytes(&dir) > queue_before);
    let (ids, _) = bench.pull_ids(false);
    assert_eq!(ids, vec!["op-replica-a-1", "op-replica-a-2"]);
    let (status, body) = bench.push("replica-a", &[op("replica-a", 4, "notes/d.md")]);
    assert_eq!(status, 200, "{body}");
    let (ids, _) = bench.pull_ids(false);
    assert_eq!(
        ids,
        vec![
            "op-replica-a-1",
            "op-replica-a-2",
            "op-replica-a-3",
            "op-replica-a-4"
        ]
    );
    assert!(
        stray.exists(),
        "a stray temp file is left alone, never read"
    );
}

/// La coda scritta da fuori della memoria (lo stesso crash, ma senza
/// riavvio: lo stato è ancora in memoria) si ripiega lo stesso: il conteggio
/// in memoria vale solo per il file che ha contato.
#[test]
fn a_queue_changed_behind_the_memory_is_replayed() {
    let mut bench = Bench::new("coda-da-fuori");
    let (status, body) = bench.push("replica-a", &[op("replica-a", 1, "notes/a.md")]);
    assert_eq!(status, 200, "{body}");
    let dir = bench.vault_dir();
    let queue_file = queue::queue_path(&dir, "replica-a");
    {
        let vault = VaultState::open(&dir).unwrap();
        let memo = vault.queue(&queue_file, "replica-a").unwrap();
        assert_eq!((memo.pending, memo.folded), (1, true));
    }
    queue::append_ops(&dir, "replica-a", &[op("replica-a", 2, "notes/b.md")]).unwrap();
    assert!(VaultState::open(&dir)
        .unwrap()
        .queue(&queue_file, "replica-a")
        .is_none());
    let (status, body) = bench.push("replica-a", &[op("replica-a", 3, "notes/c.md")]);
    assert_eq!(status, 200, "{body}");
    let (ids, _) = bench.pull_ids(false);
    assert_eq!(
        ids,
        vec!["op-replica-a-1", "op-replica-a-2", "op-replica-a-3"]
    );

    // L'ack riscrive la coda e il conteggio la segue: il push dopo non la
    // rilegge.
    let (status, body) = bench.call(
        "/v1/sync/ack",
        serde_json::json!({
            "replica_id": "replica-a", "vault_id": VAULT,
            "ack": ["op-replica-a-1", "op-replica-a-2"],
        }),
    );
    assert_eq!(status, 200, "{body}");
    let vault = VaultState::open(&dir).unwrap();
    let memo = vault.queue(&queue_file, "replica-a").unwrap();
    assert_eq!(
        (memo.pending, memo.folded),
        (1, true),
        "the ack keeps the count"
    );
    assert_eq!(
        memo.bytes,
        queue::measured_bytes(&queue::load_ops(&dir, "replica-a").unwrap()).unwrap()
    );
}

/// Il disco vince sulla memoria: uno stato riscritto da fuori (dal
/// salvataggio pubblico o a mano) è quello che la richiesta seguente vede.
#[test]
fn the_state_on_disk_wins_over_the_memory() {
    let mut bench = Bench::new("disco-vince");
    let (status, body) = bench.push(
        "replica-a",
        &[
            op("replica-a", 1, "notes/a.md"),
            op("replica-a", 2, "notes/b.md"),
        ],
    );
    assert_eq!(status, 200, "{body}");
    let dir = bench.vault_dir();
    assert!(cache::cached(&dir));

    let mut folded = versions::load(&dir).unwrap();
    folded.versions.remove("notes/a.md");
    versions::save(&dir, &folded).unwrap();
    assert_eq!(bench.pull_ids(false).0, vec!["op-replica-a-2"]);

    // A mano, sul posto (stesso inode), con un contenuto diverso.
    folded.versions.clear();
    std::fs::write(
        versions::state_path(&dir),
        serde_json::to_vec_pretty(&folded).unwrap(),
    )
    .unwrap();
    assert!(bench.pull_ids(false).0.is_empty());
}

/// Lo stato si scrive compatto; uno indentato scritto da una versione
/// precedente si legge uguale.
#[test]
fn an_indented_state_still_loads_and_new_writes_are_compact() {
    let mut bench = Bench::new("compatto");
    let (status, body) = bench.push("replica-a", &[op("replica-a", 1, "notes/a.md")]);
    assert_eq!(status, 200, "{body}");
    let dir = bench.vault_dir();
    let path = versions::state_path(&dir);
    let compact = std::fs::read(&path).unwrap();
    assert!(!compact.contains(&b'\n'), "written compact");
    let folded = versions::load(&dir).unwrap();
    std::fs::write(&path, serde_json::to_vec_pretty(&folded).unwrap()).unwrap();
    bench.restart();
    let reread = versions::load(&dir).unwrap();
    assert_eq!(
        serde_json::to_vec(&reread).unwrap(),
        compact,
        "same schema, field by field"
    );
    assert_eq!(bench.pull_ids(false).0, vec!["op-replica-a-1"]);
}

/// Le pagine riprese dal cursore in memoria sono quelle contate da capo,
/// nello stesso ordine, senza buchi né doppioni; un vettore cambiato fra le
/// pagine fa ricominciare come prima.
#[test]
fn pages_resumed_from_the_cursor_equal_pages_counted_from_the_start() {
    let mut bench = Bench::new("pagine");
    let total = PULL_MAX_OPS * 2 + 123;
    let mut count = 0u64;
    for batch in [4_000usize, 4_000, total - 8_000] {
        let ops: Vec<SyncOp> = (0..batch)
            .map(|_| {
                count += 1;
                op(
                    "replica-a",
                    count,
                    &format!("notes/n-{:03}.md", count % 997),
                )
            })
            .collect();
        let (status, body) = bench.push("replica-a", &ops);
        assert_eq!(status, 200, "{body}");
    }
    let (resumed, pages) = bench.pull_ids(false);
    let (counted, _) = bench.pull_ids(true);
    assert_eq!(pages, 3);
    assert_eq!(resumed.len(), total);
    assert_eq!(resumed, counted);
    let unique: BTreeSet<&String> = resumed.iter().collect();
    assert_eq!(unique.len(), total);

    let first = bench.pull_page(None, &serde_json::json!({}));
    let (status, body) = bench.push("replica-b", &[op("replica-b", 1, "notes/z.md")]);
    assert_eq!(status, 200, "{body}");
    let (status, _) = bench.call(
        "/v1/sync/pull",
        serde_json::json!({
            "protocol": SYNC_PROTOCOL, "replica_id": "replica-z", "vault_id": VAULT,
            "since_vv": {}, "offset": first["next_offset"], "snapshot_vv": first["server_vv"],
        }),
    );
    assert_eq!(status, 409);
}

/// Il corpo del pull montato dagli op già codificati è byte per byte quello
/// della risposta serializzata intera.
#[test]
fn the_assembled_pull_body_is_the_serialized_response() {
    let ops = vec![
        op("replica-a", 1, "notes/a.md"),
        op("replica-a", 2, "notes/b.md"),
    ];
    let vv = BTreeMap::from([("replica-a".to_string(), 2), ("key-epoch:v".to_string(), 3)]);
    for (ops, next_offset) in [(ops.clone(), Some(7)), (ops, None), (Vec::new(), None)] {
        let encoded: Vec<Vec<u8>> = ops
            .iter()
            .map(|op| serde_json::to_vec(op).unwrap())
            .collect();
        let assembled = pull::pull_body(
            &encoded,
            &pull::PullTail {
                server_vv: vv.clone(),
                truncated: next_offset.is_some(),
                next_offset,
            },
        )
        .unwrap();
        let whole = serde_json::to_vec(&PullResponse {
            ops,
            server_vv: vv.clone(),
            truncated: next_offset.is_some(),
            next_offset,
        })
        .unwrap();
        assert_eq!(
            String::from_utf8(assembled).unwrap(),
            String::from_utf8(whole).unwrap()
        );
    }
}

/// Più richieste sullo stesso vault, come le serve il binario (lock del
/// vault, ammissione sotto il lock globale, lavoro fuori): scritture e
/// letture concorrenti convergono, e lo stato in memoria è quello del disco.
#[test]
fn concurrent_requests_on_one_vault_converge_with_the_disk() {
    let mut bench = Bench::new("concorrenza");
    let dir = bench.vault_dir();
    let auth = bench.auth.clone();
    let state = Arc::new(parking_lot::Mutex::new(bench.state.take().unwrap()));
    let request =
        |state: &Arc<parking_lot::Mutex<ServiceState>>, method: &str, path: &str, body: &[u8]| {
            let vault_id = vault_of_request(method, path, body).unwrap();
            let lock = state.lock().vault_locks.of(&vault_id);
            let _vault = lock.lock();
            let admission = admit(&mut state.lock(), method, path, Some(&auth), body);
            match admission {
                Admission::Done(response) => response,
                Admission::Vault(work) => work.run(),
            }
        };
    const WRITERS: usize = 4;
    const PUSHES: u64 = 25;
    std::thread::scope(|scope| {
        for writer in 0..WRITERS {
            let state = Arc::clone(&state);
            let request = &request;
            scope.spawn(move || {
                let replica = format!("replica-{writer}");
                for count in 1..=PUSHES {
                    let doc = format!("notes/{writer}-{}.md", count % 5);
                    let body = serde_json::to_vec(&serde_json::json!({
                        "protocol": SYNC_PROTOCOL, "replica_id": replica,
                        "ops": [op(&replica, count, &doc)],
                    }))
                    .unwrap();
                    let response = request(&state, "POST", "/v1/sync/push", &body);
                    assert_eq!(
                        response.status,
                        200,
                        "{}",
                        String::from_utf8_lossy(&response.body)
                    );
                    if count % 5 == 0 {
                        let ids: Vec<String> = (count - 4..=count)
                            .map(|n| format!("op-{replica}-{n}"))
                            .collect();
                        let body = serde_json::to_vec(&serde_json::json!({
                            "replica_id": replica, "vault_id": VAULT, "ack": ids,
                        }))
                        .unwrap();
                        assert_eq!(request(&state, "POST", "/v1/sync/ack", &body).status, 200);
                    }
                }
            });
        }
        for reader in 0..2 {
            let state = Arc::clone(&state);
            let request = &request;
            scope.spawn(move || {
                let mut seen = 0usize;
                for _ in 0..40 {
                    let body = serde_json::to_vec(&serde_json::json!({
                        "protocol": SYNC_PROTOCOL, "replica_id": format!("reader-{reader}"),
                        "vault_id": VAULT, "since_vv": {},
                    }))
                    .unwrap();
                    let response = request(&state, "POST", "/v1/sync/pull", &body);
                    assert_eq!(response.status, 200);
                    let page: PullResponse = serde_json::from_slice(&response.body).unwrap();
                    assert!(page.ops.len() >= seen, "a later pull never sees less");
                    seen = page.ops.len();
                    let path =
                        format!("/v1/sync/status?vault_id={VAULT}&replica_id=reader-{reader}");
                    assert_eq!(request(&state, "GET", &path, b"").status, 200);
                }
            });
        }
    });
    let cached = {
        let vault = VaultState::open(&dir).unwrap();
        serde_json::to_vec(vault.state()).unwrap()
    };
    cache::forget(&dir);
    let disk = versions::load(&dir).unwrap();
    assert_eq!(serde_json::to_vec(&disk).unwrap(), cached);
    let versions: usize = disk.versions.values().map(Vec::len).sum();
    assert_eq!(versions, WRITERS * PUSHES as usize);
    for writer in 0..WRITERS {
        assert!(queue::load_ops(&dir, &format!("replica-{writer}"))
            .unwrap()
            .is_empty());
    }
}
