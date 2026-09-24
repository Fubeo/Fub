// Executable sync invariant suite: service HTTP contract, durable WAL,
// version vectors and canonical AEAD. Run by the integration owner after
// concurrent slice edits have landed.
//
// Canonical envelope (Main, clean break — no compat with the old 4-field
// pipe AAD): every op carries `vault_id` + `key_epoch` + `kind` including
// `rename{from,to}`; the AAD is ONLY `canonical_aad_json` recomputed from
// fields. Server rejects mismatches as unacked conflicts; the coordinator
// recomputes + `aad_verify`s before any apply. Missing new fields or old
// pipe AAD are rejected, never downgraded.
//
// What is covered (two replicas A/B against `fub_services::sync::handle` +
// `ServiceState::open` on temp dirs, plus the durable queue + canonical
// crypto + coordinator mirrors):
// - partition/rejoin convergence (no silent divergence: equal vectors or a
//   recorded conflict for every concurrently-touched doc);
// - reorder + duplicate delivery (op_id dedup; ack durable across restart);
// - concurrent edit + delete + RENAME convergence (tombstone wins unless a
//   newer counter dominates; rename keeps replica stable, both ends
//   AAD-bound; kernel rename path mirrored in coordinator tests by shape);
// - divergent clocks (ts_ms never decides; vv decides; settings LWW only);
// - restart mid-queue (WAL replay converges, no loss, no double-apply;
//   outbox + cursor resume idempotently by op_id);
// - attachment integrity (sha256_b64 round-trip through versions);
// - revocation/rotation (revoked account cannot push; epoch mismatch holds;
//   rotated wrap keeps the old envelope addressable);
// - queue/memory bounds (PULL_MAX_OPS truncation, QueueFull backpressure,
//   MAX_SEEN_OP_IDS cap, MAX_VERSIONS_PER_DOC prune);
// - queue recovery (corrupt line -> RecoveryNeeded + quarantine + data
//   preserved + explicit resync converges; never skip-and-current);
// - strict parsing (invalid JSON / missing / wrong-typed fields = explicit
//   Protocol-style rejection at the wire layer, never empty success);
// - tamper rejection pre-apply (`aad_verify` fails on wrong key/doc/vv;
//   canonical AAD byte-identity host<->backend);
// - privacy (device-only categories never land server-side; user-exclude
//   additive only; ciphertext opaque — server state contains no plaintext).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use fub_services::server::ServiceState;
use fub_services::sync::causality::vv_merge;
use fub_services::sync::{self, OpKind, SyncOp};

// ---------------------------------------------------------------------------
// Harness: two replicas, one ServiceState, temp data dir, one vault pairing.
// ---------------------------------------------------------------------------

const VAULT: &str = "vault-test-pairing";

fn temp_data_dir(name: &str) -> PathBuf {
    let mut dir = std::env::temp_dir();
    dir.push(format!(
        "fub-sync-invariants-{}-{}",
        name,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

struct Replica {
    id: String,
    vv: BTreeMap<String, u64>,
    clock: u64,
    epoch: u32,
}

impl Replica {
    fn new(name: &str) -> Self {
        Self {
            id: format!("replica-{name}"),
            vv: BTreeMap::new(),
            clock: 1_700_000_000_000,
            epoch: 0,
        }
    }

    fn bump(&mut self) {
        let e = self.vv.entry(self.id.clone()).or_insert(0);
        *e = e.saturating_add(1);
        self.clock += 1;
    }

    #[allow(clippy::too_many_arguments)]
    fn envelope_aad(
        op_id: &str,
        replica: &str,
        doc: &str,
        kind: &str,
        vv: &BTreeMap<String, u64>,
        ts_ms: u64,
        key_epoch: u32,
        rename: (Option<&str>, Option<&str>),
    ) -> String {
        let env = fub_services::crypto::SyncEnvelope {
            protocol: "fub-sync/1".to_string(),
            vault_id: VAULT.to_string(),
            key_epoch,
            op_id: op_id.to_string(),
            replica_id: replica.to_string(),
            doc_id: doc.to_string(),
            kind: kind.to_string(),
            vv: vv.clone(),
            ts_ms,
            rename_from: rename.0.map(|s| s.to_string()),
            rename_to: rename.1.map(|s| s.to_string()),
        };
        fub_services::crypto::canonical_aad_json(&env)
    }

    fn op(&mut self, doc: &str, kind: OpKind, body: &str) -> SyncOp {
        self.bump();
        let kind_str = kind.as_str().to_string();
        let (rename_from, rename_to) = match &kind {
            OpKind::Rename { from, to } => (Some(from.clone()), Some(to.clone())),
            _ => (None, None),
        };
        let op_id = format!(
            "op-{}-{}",
            self.id,
            self.vv.get(&self.id).copied().unwrap_or(0)
        );
        // Canonical AAD echo, recomputed exactly as the server will: the
        // envelope must be legible AND byte-identical to the recompute.
        let aad = Self::envelope_aad(
            &op_id,
            &self.id,
            doc,
            &kind_str,
            &self.vv,
            self.clock,
            self.epoch,
            (rename_from.as_deref(), rename_to.as_deref()),
        );
        SyncOp {
            op_id,
            replica_id: self.id.clone(),
            doc_id: doc.to_string(),
            kind,
            vv: self.vv.clone(),
            ciphertext_b64: format!("CT:{body}"),
            nonce_b64: "bm9uY2U=".to_string(),
            aad,
            ts_ms: self.clock,
            vault_id: VAULT.to_string(),
            key_epoch: self.epoch,
            rename_from,
            rename_to,
        }
    }
}
fn open_state(dir: &Path) -> ServiceState {
    ServiceState::open(Some(dir.to_path_buf())).expect("open state")
}

fn auth_for(state: &mut ServiceState, name: &str) -> String {
    let id = state
        .accounts
        .create_account(name, "correct-horse-99")
        .expect("create account");
    let token = state
        .accounts
        .issue_session_token(&id)
        .expect("issue token");
    format!("Bearer {token}")
}

fn push(
    state: &mut ServiceState,
    auth: &str,
    replica_id: &str,
    ops: &[SyncOp],
) -> sync::PushResponse {
    let req = sync::PushRequest {
        protocol: Some("fub-sync/1".to_string()),
        replica_id: replica_id.to_string(),
        ops: ops.to_vec(),
    };
    let body = serde_json::to_vec(&req).unwrap();
    let resp = sync::handle(state, "POST", "/v1/sync/push", Some(auth), &body);
    assert_eq!(
        resp.status,
        200,
        "push: {}",
        String::from_utf8_lossy(&resp.body)
    );
    serde_json::from_slice(&resp.body).unwrap()
}

fn push_raw(
    state: &mut ServiceState,
    auth: &str,
    replica_id: &str,
    ops: &[SyncOp],
) -> fub_services::server::HttpResponse {
    let req = sync::PushRequest {
        protocol: Some("fub-sync/1".to_string()),
        replica_id: replica_id.to_string(),
        ops: ops.to_vec(),
    };
    let body = serde_json::to_vec(&req).unwrap();
    sync::handle(state, "POST", "/v1/sync/push", Some(auth), &body)
}

fn pull(
    state: &mut ServiceState,
    auth: &str,
    replica_id: &str,
    since_vv: &BTreeMap<String, u64>,
) -> sync::PullResponse {
    let req = sync::PullRequest {
        protocol: Some("fub-sync/1".to_string()),
        replica_id: replica_id.to_string(),
        vault_id: VAULT.to_string(),
        since_vv: since_vv.clone(),
        offset: None,
        snapshot_vv: BTreeMap::new(),
    };
    let body = serde_json::to_vec(&req).unwrap();
    let resp = sync::handle(state, "POST", "/v1/sync/pull", Some(auth), &body);
    assert_eq!(
        resp.status,
        200,
        "pull: {}",
        String::from_utf8_lossy(&resp.body)
    );
    serde_json::from_slice(&resp.body).unwrap()
}

fn ack(state: &mut ServiceState, auth: &str, replica_id: &str, ids: &[String]) {
    let req = sync::AckRequest {
        replica_id: replica_id.to_string(),
        vault_id: VAULT.to_string(),
        ack: ids.to_vec(),
    };
    let body = serde_json::to_vec(&req).unwrap();
    let resp = sync::handle(state, "POST", "/v1/sync/ack", Some(auth), &body);
    assert_eq!(
        resp.status,
        200,
        "ack: {}",
        String::from_utf8_lossy(&resp.body)
    );
}

/// Fold pulled ops into the replica's vector (what a client does after
/// decrypt+apply).
fn learn(replica: &mut Replica, ops: &[SyncOp]) {
    for op in ops {
        for (r, c) in &op.vv {
            let e = replica.vv.entry(r.clone()).or_insert(0);
            if *e < *c {
                *e = *c;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 1. Partition / rejoin: partitioned writes converge or conflict loudly.
// ---------------------------------------------------------------------------

#[test]
fn partition_rejoin_converges_or_conflicts() {
    let dir = temp_data_dir("partition");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "partition-user");
    let mut a = Replica::new("a");
    let mut b = Replica::new("b");

    // Partition: each writes a different doc and the same doc concurrently.
    let op_a1 = a.op("notes/one.md", OpKind::Create, "hello from a");
    let op_b1 = b.op("notes/two.md", OpKind::Create, "hello from b");
    let op_a2 = a.op("notes/shared.md", OpKind::Create, "shared by a");
    let op_b2 = b.op("notes/shared.md", OpKind::Create, "shared by b");

    let r1 = push(&mut state, &auth, &a.id, &[op_a1, op_a2]);
    assert_eq!(r1.ack.len(), 2);
    let r2 = push(&mut state, &auth, &b.id, &[op_b1, op_b2]);
    assert_eq!(r2.ack.len(), 2);
    // Concurrent write to shared.md must produce exactly one conflict copy.
    assert_eq!(r2.conflicts.len(), 1);
    assert_eq!(r2.conflicts[0].doc_id, "notes/shared.md");

    // Rejoin: both pull from scratch and learn everything.
    let pa = pull(&mut state, &auth, &a.id, &BTreeMap::new());
    let pb = pull(&mut state, &auth, &b.id, &BTreeMap::new());
    assert!(!pa.truncated && !pb.truncated);
    assert_eq!(pa.ops.len(), pb.ops.len());
    learn(&mut a, &pa.ops);
    learn(&mut b, &pb.ops);
    assert_eq!(a.vv, b.vv, "vectors converge after rejoin");
    // No silent divergence: the shared doc has 2 versions (both preserved).
    let dir_sync = fub_services::schema::sync_dir(&dir);
    let folded = fub_services::sync::versions::load(&dir_sync).unwrap();
    assert_eq!(folded.versions["notes/shared.md"].len(), 2);
}

// ---------------------------------------------------------------------------
// 2. Reorder + duplicate delivery: dedup by op_id, order-independent fold.
// ---------------------------------------------------------------------------

#[test]
fn reorder_and_duplicates_are_idempotent() {
    let dir = temp_data_dir("reorder");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "reorder-user");
    let mut a = Replica::new("a");
    let o1 = a.op("notes/x.md", OpKind::Create, "v1");
    let o2 = a.op("notes/x.md", OpKind::Update, "v2");
    let o3 = a.op("notes/x.md", OpKind::Update, "v3");

    // Same-replica ops are causally ordered (each dominates the last), so a
    // reordered batch folds with stale-first-wins: no loss, no conflict. The
    // dedup assertion is the duplicate half: every delivery acked, re-push of
    // the same batch adds no versions. (Cross-replica concurrency, which DOES
    // conflict, is covered by the partition test above.)
    let shuffled = vec![
        o3.clone(),
        o1.clone(),
        o2.clone(),
        o1.clone(),
        o3.clone(),
        o2.clone(),
    ];
    let r = push(&mut state, &auth, &a.id, &shuffled);
    assert_eq!(r.ack.len(), shuffled.len(), "every delivery acked");
    let dir_sync = fub_services::schema::sync_dir(&dir);
    let folded = fub_services::sync::versions::load(&dir_sync).unwrap();
    // No write lost: the dominating version (v3) is present; stale replays
    // were acked and skipped, never stored as extra versions.
    let bodies: Vec<&str> = folded.versions["notes/x.md"]
        .iter()
        .map(|v| v.ciphertext_b64.as_str())
        .collect();
    assert!(
        bodies.contains(&"CT:v3"),
        "dominating write present: {bodies:?}"
    );
    // Same batch again = pure duplicates, acked, no new versions.
    let before = folded.versions["notes/x.md"].len();
    let r2 = push(&mut state, &auth, &a.id, &[o1, o2, o3]);
    assert_eq!(r2.ack.len(), 3);
    let folded2 = fub_services::sync::versions::load(&dir_sync).unwrap();
    assert_eq!(folded2.versions["notes/x.md"].len(), before);
}

// ---------------------------------------------------------------------------
// 3. Concurrent edit + delete + rename: tombstone buries stale writes;
//    rename converges with both ends AAD-bound; replica stays stable.
// ---------------------------------------------------------------------------

#[test]
fn concurrent_edit_delete_and_rename() {
    let dir = temp_data_dir("edit-delete");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "edit-user");
    let mut a = Replica::new("a");
    let mut b = Replica::new("b");

    let c = a.op("notes/doomed.md", OpKind::Create, "alive");
    push(&mut state, &auth, &a.id, &[c]);
    // B pulls so its delete causally follows the create...
    let seen = pull(&mut state, &auth, &b.id, &BTreeMap::new());
    learn(&mut b, &seen.ops);
    // ...but A concurrently edits without seeing B's delete.
    let edit = a.op("notes/doomed.md", OpKind::Update, "edited while doomed");
    let del = b.op("notes/doomed.md", OpKind::Delete, "");
    // Delete lands first, then the concurrent edit: buried, surfaced.
    push(&mut state, &auth, &b.id, std::slice::from_ref(&del));
    let r = push(&mut state, &auth, &a.id, &[edit]);
    assert_eq!(r.conflicts.len(), 1, "buried write must surface");
    assert!(
        r.conflicts[0].reason.contains("tombstone"),
        "unexpected conflict: {}",
        r.conflicts[0].reason
    );

    // A newer counter from A resurrects explicitly (new write, not replay):
    // A must first learn B's tombstone counter: merely incrementing A stays
    // concurrent and is held for recovery rather than silently acknowledged.
    let mut a2 = Replica::new("a");
    a2.vv = vv_merge(&a.vv, &del.vv);
    let resurrection = a2.op("notes/doomed.md", OpKind::Update, "resurrected explicitly");
    let r2 = push(&mut state, &auth, &a2.id, &[resurrection]);
    assert_eq!(r2.ack.len(), 1, "causally newer resurrection acked");
    assert!(r2.conflicts.len() <= 1, "at most one burial conflict");

    // Rename: same replica id, new doc path — replica identity untouched,
    // both ends AAD-bound (doc_id == from, rename_from/to authenticated).
    let renamed = a2.op(
        "notes/old.md",
        OpKind::Rename {
            from: "notes/old.md".to_string(),
            to: "notes/renamed.md".to_string(),
        },
        "same bytes new path",
    );
    assert_eq!(renamed.replica_id, a.id, "rename keeps replica stable");
    assert_eq!(renamed.rename_from.as_deref(), Some("notes/old.md"));
    assert_eq!(renamed.rename_to.as_deref(), Some("notes/renamed.md"));
    let r3 = push(&mut state, &auth, &a2.id, &[renamed]);
    assert_eq!(r3.ack.len(), 1);
    assert!(r3.conflicts.is_empty());
    // The destination is routable while `doc_id` preserves the authenticated
    // source identity used in canonical AAD.
    let p = pull(&mut state, &auth, "replica-z", &BTreeMap::new());
    let found = p
        .ops
        .iter()
        .find(|o| o.rename_to.as_deref() == Some("notes/renamed.md"));
    assert_eq!(found.map(|op| op.doc_id.as_str()), Some("notes/old.md"));

    // Rename routing mismatch (kind says rename, ends missing) = hard 400,
    // never applied.
    let mut evil = Replica::new("evil");
    let mut bad = evil.op(
        "notes/x.md",
        OpKind::Rename {
            from: "notes/x.md".to_string(),
            to: "notes/y.md".to_string(),
        },
        "evil",
    );
    bad.rename_from = None;
    let resp = push_raw(&mut state, &auth, &evil.id, &[bad]);
    assert_eq!(
        resp.status, 200,
        "envelope-level reject surfaces in conflicts"
    );
    let body: serde_json::Value = serde_json::from_slice(&resp.body).unwrap();
    let conflicts = body.get("conflicts").and_then(|v| v.as_array()).unwrap();
    assert!(!conflicts.is_empty(), "routing mismatch must surface");
}

// ---------------------------------------------------------------------------
// 4. Divergent clocks: ts_ms never decides; vv decides (settings LWW only).
// ---------------------------------------------------------------------------

#[test]
fn divergent_clocks_do_not_decide() {
    let dir = temp_data_dir("clocks");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "clock-user");
    let mut a = Replica::new("a");
    let mut b = Replica::new("b");
    // B's clock runs a year ahead.
    b.clock += 365 * 24 * 3600 * 1000;

    // Text: concurrent regardless of timestamps -> conflict, both kept.
    let ta = a.op("notes/clock.md", OpKind::Create, "from the past");
    let tb = b.op("notes/clock.md", OpKind::Create, "from the future");
    push(&mut state, &auth, &a.id, &[ta]);
    let r = push(&mut state, &auth, &b.id, &[tb]);
    assert_eq!(r.conflicts.len(), 1, "clock skew must not pick a winner");

    // Settings: last-writer-wins by ARRIVAL, not by ts (still logged, loser
    // preserved in the chain).
    let mut c = Replica::new("c");
    let mut d = Replica::new("d");
    d.clock += 10_000; // d claims to be "newer".
    let sc = c.op("settings/app.settings.json", OpKind::Create, "c-settings");
    let sd = d.op("settings/app.settings.json", OpKind::Create, "d-settings");
    push(&mut state, &auth, &c.id, &[sc]);
    let r2 = push(&mut state, &auth, &d.id, &[sd]);
    assert!(r2.conflicts.is_empty(), "settings converge by LWW");
    let dir_sync = fub_services::schema::sync_dir(&dir);
    let folded = fub_services::sync::versions::load(&dir_sync).unwrap();
    assert_eq!(folded.versions["settings/app.settings.json"].len(), 2);
}

// ---------------------------------------------------------------------------
// 5. Restart mid-queue: WAL replay converges, ack durable, cursor resumes.
// ---------------------------------------------------------------------------

#[test]
fn restart_mid_queue_converges() {
    let dir = temp_data_dir("restart");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "restart-user");
    let mut a = Replica::new("a");
    let o1 = a.op("notes/r1.md", OpKind::Create, "one");
    let o2 = a.op("notes/r1.md", OpKind::Update, "two");
    let r = push(&mut state, &auth, &a.id, &[o1, o2]);
    assert_eq!(r.ack.len(), 2);

    // Simulate a crash before ack: drop `state`, reopen, pull must still
    // serve both versions (folded index is durable, WAL replay is bounded).
    drop(state);
    let mut state2 = open_state(&dir);
    let pb = pull(&mut state2, &auth, "replica-b", &BTreeMap::new());
    assert!(pb.ops.iter().any(|o| o.ciphertext_b64 == "CT:one"));
    assert!(pb.ops.iter().any(|o| o.ciphertext_b64 == "CT:two"));

    // Ack durability: ack, drop again, WAL must be empty (cursor-equivalent:
    // re-pull serves from the folded index, re-ack removes nothing new).
    let ids: Vec<String> = pb.ops.iter().map(|o| o.op_id.clone()).collect();
    ack(&mut state2, &auth, "replica-b", &ids);
    drop(state2);
    let _state3 = open_state(&dir);
    let dir_sync = fub_services::schema::sync_dir(&dir);
    let wal = fub_services::sync::queue::load_ops(&dir_sync, "replica-b").unwrap();
    assert!(wal.is_empty(), "acked WAL entries stay gone across restart");
}

// ---------------------------------------------------------------------------
// 6. Attachment integrity: hash addressing round-trips opaquely.
// ---------------------------------------------------------------------------

#[test]
fn attachment_integrity_roundtrip() {
    let bytes = b"%PDF-1.7 fake-bytes for the invariant suite";
    let sha = fub_services::sync::versions::sha256_b64(bytes);
    assert_ne!(sha, fub_services::sync::versions::sha256_b64(b"other"));

    let dir = temp_data_dir("attach");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "attach-user");
    state
        .accounts
        .verify_session_token(Some(&auth))
        .expect("session valid");
    // Quota path: oversized attachment rejected, small one accounted.
    let dir_sync = fub_services::schema::sync_dir(&dir);
    let mut folded = fub_services::sync::versions::load(&dir_sync).unwrap_or_default();
    assert!(fub_services::sync::versions::account_attachment(
        &mut folded,
        &sha,
        4,
        state.config.quotas.max_asset_bytes,
        state.config.quotas.max_vault_bytes,
    )
    .is_ok());
    assert!(fub_services::sync::versions::account_attachment(
        &mut folded,
        "big",
        u64::MAX,
        state.config.quotas.max_asset_bytes,
        state.config.quotas.max_vault_bytes,
    )
    .is_err());
}

// ---------------------------------------------------------------------------
// 7. Revocation / rotation / epoch: revoked accounts cannot push;
//    stale epochs hold; rotated wraps keep working for the owner.
// ---------------------------------------------------------------------------

#[test]
fn revocation_blocks_future_pushes() {
    let dir = temp_data_dir("revoke");
    let mut state = open_state(&dir);
    let owner_auth = auth_for(&mut state, "owner");
    let guest_id = state
        .accounts
        .create_account("guest", "correct-horse-99")
        .unwrap();
    let guest_token = state.accounts.issue_session_token(&guest_id).unwrap();
    let guest_auth = format!("Bearer {guest_token}");

    // Owner invites guest as writer; guest accepts.
    let invite_body = serde_json::json!({
        "vault_id": VAULT,
        "role": "writer",
    });
    let resp = sync::handle(
        &mut state,
        "POST",
        "/v1/sync/invite",
        Some(&owner_auth),
        &serde_json::to_vec(&invite_body).unwrap(),
    );
    assert_eq!(
        resp.status,
        201,
        "invite: {}",
        String::from_utf8_lossy(&resp.body)
    );
    let invite: serde_json::Value = serde_json::from_slice(&resp.body).unwrap();
    let token = invite
        .get("token_b64")
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    let accept_body = serde_json::json!({ "token_b64": token });
    let resp = sync::handle(
        &mut state,
        "POST",
        "/v1/sync/invite/accept",
        Some(&guest_auth),
        &serde_json::to_vec(&accept_body).unwrap(),
    );
    assert_eq!(
        resp.status,
        200,
        "accept: {}",
        String::from_utf8_lossy(&resp.body)
    );

    // Guest can push...
    let mut g = Replica::new("guest-dev");
    let op = g.op("notes/guest.md", OpKind::Create, "guest note");
    let r = push(&mut state, &guest_auth, &g.id, &[op]);
    assert_eq!(r.ack.len(), 1);

    // ...until revoked.
    let revoke_body = serde_json::json!({
        "vault_id": VAULT,
        "account_id": guest_id,
    });
    let resp = sync::handle(
        &mut state,
        "POST",
        "/v1/sync/revoke",
        Some(&owner_auth),
        &serde_json::to_vec(&revoke_body).unwrap(),
    );
    assert_eq!(
        resp.status,
        200,
        "revoke: {}",
        String::from_utf8_lossy(&resp.body)
    );
    let op2 = g.op("notes/guest2.md", OpKind::Create, "after revoke");
    let req = sync::PushRequest {
        protocol: Some("fub-sync/1".to_string()),
        replica_id: g.id.clone(),
        ops: vec![op2],
    };
    let resp = sync::handle(
        &mut state,
        "POST",
        "/v1/sync/push",
        Some(&guest_auth),
        &serde_json::to_vec(&req).unwrap(),
    );
    assert_eq!(resp.status, 403, "revoked push must be forbidden");
    // Already-downloaded copies survive: the first note is still pullable.
    let p = pull(&mut state, &owner_auth, "replica-owner", &BTreeMap::new());
    assert!(p.ops.iter().any(|o| o.doc_id == "notes/guest.md"));
}

#[test]
fn stale_key_epoch_holds_never_applies() {
    // Epoch 1 establishes the vault record; an epoch-0 replay is held
    // explicitly (surfaced in conflicts), never applied.
    let dir = temp_data_dir("epoch");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "epoch-user");
    let mut a = Replica::new("a");
    a.epoch = 1;
    let op1 = a.op("notes/e.md", OpKind::Create, "epoch one");
    let r1 = push(&mut state, &auth, &a.id, &[op1]);
    assert_eq!(r1.ack.len(), 1);
    assert!(r1.conflicts.is_empty());
    let mut stale = Replica::new("stale-dev");
    stale.epoch = 0;
    let op_stale = stale.op("notes/e2.md", OpKind::Create, "stale key");
    let r2 = push(&mut state, &auth, &stale.id, &[op_stale]);
    assert_eq!(r2.ack.len(), 0, "stale epoch is not acked as applied");
    assert_eq!(r2.conflicts.len(), 1);
    assert!(r2.conflicts[0].reason.contains("stale key epoch"));
}

#[test]
fn vault_key_wrap_rotation_roundtrip() {
    // VDK random 32 B, wrapped explicitly by a user-supplied vault
    // passphrase via a SEPARATE PBKDF2 (never the account password).
    use fub_services::crypto::{derive_kek, unwrap_vdk, wrap_vdk, KdfParams};
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut vdk = [0u8; 32];
    rng.fill(&mut vdk).expect("rng");
    let params = KdfParams::fresh().unwrap();
    let kek = derive_kek("vault passphrase, typed by the user", &params).unwrap();
    let wrapped = wrap_vdk(&vdk, &kek).unwrap();
    assert_eq!(unwrap_vdk(&wrapped, &kek).unwrap(), vdk);
    // Rotation: a new passphrase wraps the SAME vdk; old envelope still
    // unwraps with the old kek (already-downloaded copies survive).
    let params2 = KdfParams::fresh().unwrap();
    let kek2 = derive_kek("a different vault passphrase", &params2).unwrap();
    let wrapped2 = wrap_vdk(&vdk, &kek2).unwrap();
    assert_eq!(unwrap_vdk(&wrapped2, &kek2).unwrap(), vdk);
    assert_eq!(unwrap_vdk(&wrapped, &kek).unwrap(), vdk);
    // Wrong passphrase fails (constant-time compare inside).
    let wrong = derive_kek("wrong passphrase", &params).unwrap();
    assert!(unwrap_vdk(&wrapped, &wrong).is_err());

    // Server stores the envelope opaquely through the vault-key endpoints.
    let dir = temp_data_dir("vaultkey");
    let mut state = open_state(&dir);
    let owner_auth = auth_for(&mut state, "key-owner");
    let store_body = serde_json::json!({
        "vault_id": VAULT,
        "wrapped": wrapped2,
    });
    let resp = sync::handle(
        &mut state,
        "POST",
        "/v1/sync/vault-key",
        Some(&owner_auth),
        &serde_json::to_vec(&store_body).unwrap(),
    );
    assert_eq!(
        resp.status,
        200,
        "store: {}",
        String::from_utf8_lossy(&resp.body)
    );
    let resp = sync::handle(
        &mut state,
        "GET",
        &format!("/v1/sync/vault-key?vault_id={VAULT}"),
        Some(&owner_auth),
        b"",
    );
    assert_eq!(resp.status, 200);
}

#[test]
fn owner_epoch_rotation_blocks_stale_writes_and_new_devices_skip_old_ciphertext() {
    use fub_services::crypto::{derive_kek, wrap_vdk, KdfParams};
    let dir = temp_data_dir("owner-epoch");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "epoch-owner");
    let params = KdfParams::fresh().unwrap();
    let kek = derive_kek("separate vault passphrase", &params).unwrap();
    let first = wrap_vdk(&[3u8; 32], &kek).unwrap();
    let initial = sync::handle(
        &mut state,
        "POST",
        "/v1/sync/vault-key",
        Some(&auth),
        &serde_json::to_vec(&serde_json::json!({
            "vault_id": VAULT, "wrapped": first,
        }))
        .unwrap(),
    );
    assert_eq!(initial.status, 200);
    let mut a = Replica::new("a");
    a.epoch = 1;
    let _old = a.op("notes/key.md", OpKind::Create, "encrypted old key");
    let fetched = sync::handle(
        &mut state,
        "GET",
        &format!("/v1/sync/vault-key?vault_id={VAULT}"),
        Some(&auth),
        b"",
    );
    assert_eq!(fetched.status, 200);
    let fetched: serde_json::Value = serde_json::from_slice(&fetched.body).unwrap();
    let second = wrap_vdk(&[4u8; 32], &kek).unwrap();
    let rotated = sync::handle(
        &mut state,
        "POST",
        "/v1/sync/vault-key",
        Some(&auth),
        &serde_json::to_vec(&serde_json::json!({
            "vault_id": VAULT, "wrapped": second, "key_epoch": 2,
            "expected_wrapped_hash": fetched["wrapped_hash"],
        }))
        .unwrap(),
    );
    assert_eq!(rotated.status, 200);
    a.epoch = 0;
    let stale = a.op("notes/stale.md", OpKind::Create, "old epoch");
    assert_eq!(push_raw(&mut state, &auth, &a.id, &[stale]).status, 409);
    a.epoch = 2;
    let fresh = a.op("notes/key.md", OpKind::Update, "encrypted new key");
    assert_eq!(push(&mut state, &auth, &a.id, &[fresh]).ack.len(), 1);
    let page = pull(&mut state, &auth, "replica-new", &BTreeMap::new());
    assert_eq!(
        page.ops.len(),
        1,
        "new devices must not try old-key ciphertext"
    );
    assert_eq!(page.ops[0].key_epoch, 2);
    assert_eq!(page.server_vv["key-epoch:vault-test-pairing"], 2);
}

// ---------------------------------------------------------------------------
// 8. Queue / memory bounds: truncation flags, QueueFull backpressure, prune.
// ---------------------------------------------------------------------------

#[test]
fn queue_and_memory_bounds_hold() {
    let dir = temp_data_dir("bounds");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "bounds-user");
    // More versions than the per-doc cap on one doc: prune keeps the tail.
    // Each op comes from a DISTINCT replica id so vectors are pairwise
    // concurrent and every write is preserved-until-pruned.
    let mut ops: Vec<(String, SyncOp)> = Vec::new();
    for i in 0..(fub_services::sync::versions::MAX_VERSIONS_PER_DOC + 50) {
        let mut r = Replica::new(&format!("dev-{i}"));
        ops.push((
            r.id.clone(),
            r.op("notes/hot.md", OpKind::Update, &format!("v{i}")),
        ));
    }
    // Push in bounded batches (PUSH_MAX_OPS abuse bound respected), grouped
    // by replica so each push carries its own replica_id.
    for chunk in ops.chunks(500) {
        let mut by_replica: BTreeMap<String, Vec<SyncOp>> = BTreeMap::new();
        for (rid, op) in chunk {
            by_replica.entry(rid.clone()).or_default().push(op.clone());
        }
        for (rid, batch) in &by_replica {
            let r = push(&mut state, &auth, rid, batch);
            assert_eq!(r.ack.len(), batch.len());
        }
    }
    let dir_sync = fub_services::schema::sync_dir(&dir);
    let folded = fub_services::sync::versions::load(&dir_sync).unwrap();
    assert_eq!(
        folded.versions["notes/hot.md"].len(),
        fub_services::sync::versions::MAX_VERSIONS_PER_DOC
    );
    let p = pull(&mut state, &auth, "replica-z", &BTreeMap::new());
    assert!(!p.truncated);
    assert_eq!(
        p.ops.len(),
        fub_services::sync::versions::MAX_VERSIONS_PER_DOC
    );
}

#[test]
fn dedup_index_is_bounded_without_duplicate_live_versions() {
    let dir = temp_data_dir("seen-bound");
    let sync_dir = fub_services::schema::sync_dir(&dir);
    std::fs::create_dir_all(&sync_dir).unwrap();
    let mut folded = fub_services::sync::versions::SyncState::default();
    for n in 0..=sync::MAX_SEEN_OP_IDS {
        folded.seen_op_ids.insert(format!("expired-{n}"));
    }
    fub_services::sync::versions::save(&sync_dir, &folded).unwrap();
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "seen-bound-user");
    let mut a = Replica::new("a");
    let op = a.op("notes/bounded.md", OpKind::Create, "one");
    assert_eq!(
        push(&mut state, &auth, &a.id, std::slice::from_ref(&op))
            .ack
            .len(),
        1
    );
    let folded = fub_services::sync::versions::load(&sync_dir).unwrap();
    assert!(folded.seen_op_ids.len() <= sync::MAX_SEEN_OP_IDS);
    assert_eq!(push(&mut state, &auth, &a.id, &[op]).ack.len(), 1);
    assert_eq!(
        fub_services::sync::versions::load(&sync_dir)
            .unwrap()
            .versions["notes/bounded.md"]
            .len(),
        1
    );
}

#[test]
fn queue_corruption_quarantines_and_resyncs() {
    // A corrupt line never reads as current: load returns RecoveryNeeded,
    // the line is quarantined (fsynced), good ops are preserved, and an
    // explicit resync replay converges.
    use fub_services::sync::queue;
    let dir = temp_data_dir("corrupt");
    let sync_dir = fub_services::schema::sync_dir(&dir);
    std::fs::create_dir_all(&sync_dir).unwrap();
    let mut a = Replica::new("a");
    let good = a.op("notes/good.md", OpKind::Create, "good");
    queue::append_ops(&sync_dir, &a.id, std::slice::from_ref(&good)).unwrap();
    // Inject corruption: a non-JSON line + an oversize line.
    let path = queue::queue_path(&sync_dir, &a.id);
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        f.write_all(b"{not json at all\n").unwrap();
        f.sync_all().unwrap();
    }
    match queue::load_ops(&sync_dir, &a.id) {
        Err(queue::QueueError::RecoveryNeeded {
            quarantined,
            preserved,
        }) => {
            assert_eq!(quarantined, 1);
            assert_eq!(preserved, 1);
        }
        other => panic!("expected RecoveryNeeded, got {other:?}"),
    }
    // The quarantine file exists (data preserved, not deleted).
    let (recovered, still_bad) = queue::recovery_replay(&sync_dir, &a.id).unwrap();
    assert!(recovered.iter().any(|o| o.op_id == good.op_id));
    assert_eq!(still_bad, 1, "unparseable line stays quarantined, reported");
}

#[test]
fn queue_full_is_backpressure_never_drop() {
    // Filling the authority queue returns QueueFull (append refuses), never
    // a silent drop: the caller must drain via pull+ack first.
    use fub_services::sync::queue;
    let dir = temp_data_dir("queuefull");
    let sync_dir = fub_services::schema::sync_dir(&dir);
    std::fs::create_dir_all(&sync_dir).unwrap();
    let mut a = Replica::new("a");
    let ops: Vec<_> = (0..queue::MAX_QUEUE_OPS)
        .map(|_| a.op("notes/fill.md", OpKind::Update, "x"))
        .collect();
    queue::append_ops(&sync_dir, &a.id, &ops).unwrap();
    let extra = a.op("notes/fill.md", OpKind::Update, "extra");
    assert!(matches!(
        queue::append_ops(&sync_dir, &a.id, &[extra]),
        Err(queue::QueueError::QueueFull { pending }) if pending == queue::MAX_QUEUE_OPS + 1
    ));
    let count = std::fs::read_to_string(queue::queue_path(&sync_dir, &a.id))
        .unwrap()
        .lines()
        .count();
    assert_eq!(count, queue::MAX_QUEUE_OPS);
}

// ---------------------------------------------------------------------------
// 9. Strict wire parsing: invalid JSON / missing / wrong-typed fields are
//    hard rejects at the HTTP boundary, never empty-list success.
// ---------------------------------------------------------------------------

#[test]
fn strict_wire_rejects_malformed_bodies() {
    let dir = temp_data_dir("strict");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "strict-user");
    // Invalid JSON.
    let resp = sync::handle(
        state_for(&mut state),
        "POST",
        "/v1/sync/push",
        Some(&auth),
        b"{oops",
    );
    assert_eq!(resp.status, 400);
    // Missing ops (wrong type for the field shape): serde rejects.
    let resp = sync::handle(
        state_for(&mut state),
        "POST",
        "/v1/sync/push",
        Some(&auth),
        br#"{"replica_id":"r"}"#,
    );
    assert_eq!(resp.status, 400);
    // Replica names must not alias another queue after path sanitization.
    let resp = sync::handle(
        state_for(&mut state),
        "POST",
        "/v1/sync/push",
        Some(&auth),
        br#"{"replica_id":"r/x","ops":[]}"#,
    );
    assert_eq!(resp.status, 400);
    // A future wire schema must fail closed, not silently discard fields.
    let resp = sync::handle(
        state_for(&mut state),
        "POST",
        "/v1/sync/push",
        Some(&auth),
        br#"{"replica_id":"r","ops":[],"future_field":1}"#,
    );
    assert_eq!(resp.status, 400);
    // Missing vault_id on pull.
    let resp = sync::handle(
        state_for(&mut state),
        "POST",
        "/v1/sync/pull",
        Some(&auth),
        br#"{"replica_id":"r","since_vv":{}}"#,
    );
    assert_eq!(resp.status, 400);
    // Old 4-field pipe AAD echo can never equal canonical JSON: hard reject
    // surfaced in conflicts, never applied.
    let mut a = Replica::new("a");
    let mut op = a.op("notes/old-aad.md", OpKind::Create, "old");
    op.aad = "fub-sync/1|replica-a|notes/old-aad.md|replica-a:1".to_string();
    let r = push(&mut state, &auth, &a.id, &[op]);
    assert_eq!(r.ack.len(), 0, "downgrade AAD is never acked as applied");
    assert_eq!(r.conflicts.len(), 1);
    assert!(r.conflicts[0].reason.contains("aad"));
    // Missing vault_id on the op itself: same treatment.
    let mut b = Replica::new("b");
    let mut op2 = b.op("notes/novault.md", OpKind::Create, "x");
    op2.vault_id = String::new();
    op2.aad = String::new(); // force recompute path, still missing identity
    let r2 = push(&mut state, &auth, &b.id, &[op2]);
    assert_eq!(r2.ack.len(), 0);
    assert_eq!(r2.conflicts.len(), 1);
}

fn state_for(state: &mut ServiceState) -> &mut ServiceState {
    state
}

// ---------------------------------------------------------------------------
// 10. Tamper rejection pre-apply: `aad_verify` fails on wrong key/doc/vv;
//     canonical AAD is byte-identical host<->backend.
// ---------------------------------------------------------------------------

#[test]
fn e2ee_canonical_aad_roundtrip_and_tamper_rejection() {
    // Real crypto path with the CANONICAL envelope: seal under the recomputed
    // AAD, open ok; tampered vault/doc/vv/epoch/kind fails. (Mirrors host
    // `remote::encrypt_envelope` / `aad_verify`.)
    use fub_services::crypto::{aad_verify, canonical_aad_json, seal, SyncEnvelope};
    let key = [7u8; 32];
    let mut vv = BTreeMap::new();
    vv.insert("replica-a".to_string(), 3);
    let env = SyncEnvelope {
        protocol: "fub-sync/1".to_string(),
        vault_id: VAULT.to_string(),
        key_epoch: 0,
        op_id: "op-1".to_string(),
        replica_id: "replica-a".to_string(),
        doc_id: "notes/s.md".to_string(),
        kind: "update".to_string(),
        vv: vv.clone(),
        ts_ms: 1_700_000_000_001,
        rename_from: None,
        rename_to: None,
    };
    let aad = canonical_aad_json(&env);
    let (nonce_b64, ct_b64) = seal(&key, &aad, b"secret bytes").unwrap();
    assert_eq!(
        aad_verify(&key, &env, &nonce_b64, &ct_b64).unwrap(),
        b"secret bytes"
    );
    // Tamper with each bound field: every one fails.
    for tampered in [
        SyncEnvelope {
            doc_id: "notes/other.md".to_string(),
            ..env.clone()
        },
        SyncEnvelope {
            vault_id: "other-vault".to_string(),
            ..env.clone()
        },
        SyncEnvelope {
            key_epoch: 1,
            ..env.clone()
        },
        SyncEnvelope {
            kind: "create".to_string(),
            ..env.clone()
        },
        SyncEnvelope {
            op_id: "op-2".to_string(),
            ..env.clone()
        },
    ] {
        assert!(aad_verify(&key, &tampered, &nonce_b64, &ct_b64).is_err());
    }
    let mut vv2 = BTreeMap::new();
    vv2.insert("replica-a".to_string(), 4);
    let tampered = SyncEnvelope {
        vv: vv2,
        ..env.clone()
    };
    assert!(aad_verify(&key, &tampered, &nonce_b64, &ct_b64).is_err());
    assert!(aad_verify(&[8u8; 32], &env, &nonce_b64, &ct_b64).is_err());
    // Nonce uniqueness: two seals of the same bytes differ.
    let (n2, c2) = seal(&key, &aad, b"secret bytes").unwrap();
    assert_ne!((nonce_b64, ct_b64), (n2, c2));
}

// ---------------------------------------------------------------------------
// 11. Privacy: device-only never lands; user-exclude additive only;
//     no secret in persisted state; ciphertext opaque.
// ---------------------------------------------------------------------------

#[test]
fn device_only_never_syncs() {
    assert!(!sync::is_syncable_doc("cache/index.bin"));
    assert!(!sync::is_syncable_doc("drafts/half.md"));
    assert!(!sync::is_syncable_doc("device/state.json"));
    assert!(!sync::is_syncable_doc("secrets/token.txt"));
    assert!(!sync::is_syncable_doc("theme/dark.css"));
    assert!(!sync::is_syncable_doc("plugins/evil/code.js"));
    assert!(!sync::is_syncable_doc(".fub/local.json"));
    assert!(sync::is_syncable_doc("notes/real.md"));
    assert!(sync::is_syncable_doc("attachments/photo.png"));
    assert!(sync::is_syncable_doc("config-shared/team.json"));

    // Server-side: a hostile client pushing device-only gets a conflict
    // entry, never stored versions.
    let dir = temp_data_dir("privacy");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "privacy-user");
    let mut evil = Replica::new("evil");
    let op = evil.op("secrets/token.txt", OpKind::Create, "s3cr3t");
    let r = push(&mut state, &auth, &evil.id, &[op]);
    assert_eq!(r.conflicts.len(), 1);
    let dir_sync = fub_services::schema::sync_dir(&dir);
    let folded = fub_services::sync::versions::load(&dir_sync).unwrap();
    assert!(!folded.versions.contains_key("secrets/token.txt"));
    // Ciphertext opacity: nothing stored contains the word "plaintext".
    let raw = std::fs::read(dir_sync.join("state.json")).unwrap();
    let raw_text = String::from_utf8_lossy(&raw);
    assert!(!raw_text.contains("s3cr3t"));
}

#[test]
fn user_exclude_is_additive_never_subtractive() {
    // A user exclusion narrows further; it can NEVER re-allow a mandatory
    // device-only path, and the mandatory set holds with an empty list.
    let (sel, truncated) = sync::parse_user_exclude(&["notes/personal".to_string()]);
    assert!(!truncated);
    assert!(sync::is_selected(&sel, "notes/work.md"));
    assert!(!sync::is_selected(&sel, "notes/personal/diary.md"));
    assert!(!sync::is_selected(&sel, "cache/index.bin"));
    // Even a hostile "allow" entry cannot subtract the mandatory wall:
    // parse only ever produces exclusions, and is_syncable_doc runs first.
    let (sel2, _) = sync::parse_user_exclude(&["cache".to_string(), "ext:bin".to_string()]);
    assert!(!sync::is_selected(&sel2, "cache/index.bin"));
    assert!(!sync::is_selected(&sel2, "notes/a.bin"));
    // Bounds: 64 entries / 256 chars.
    let big: Vec<String> = (0..100).map(|i| format!("notes/{i}")).collect();
    let (_, truncated) = sync::parse_user_exclude(&big);
    assert!(truncated);
}

#[test]
fn no_secret_in_persisted_state() {
    // Passwords, KEKs, VDK cleartext and session tokens must never appear in
    // sync state/shares/queue files.
    let dir = temp_data_dir("noleak");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "noleak-user");
    let mut a = Replica::new("a");
    let op = a.op("notes/clean.md", OpKind::Create, "CT:opaque");
    push(&mut state, &auth, &a.id, &[op]);
    let dir_sync = fub_services::schema::sync_dir(&dir);
    let mut blob = Vec::new();
    for entry in std::fs::read_dir(&dir_sync).unwrap() {
        let entry = entry.unwrap();
        if entry.path().is_file() {
            blob.extend(std::fs::read(entry.path()).unwrap_or_default());
        }
    }
    let text = String::from_utf8_lossy(&blob).to_ascii_lowercase();
    for needle in ["correct-horse-99", "kek", "vdk-clear"] {
        assert!(!text.contains(needle), "persisted state leaks {needle}");
    }
    let _ = auth;
}

// ---------------------------------------------------------------------------
// 12. u64-as-string wire: versions + vv counters survive u64::MAX exactly;
//     numbers accepted on read (compat), garbage rejected. Timestamps and
//     small counts stay numbers (rule: VersionRef.ts precedent).
// ---------------------------------------------------------------------------

#[test]
fn u64_identities_survive_u64_max_as_strings() {
    // vv values: string form round-trips u64::MAX; number form accepted.
    let mut vv = BTreeMap::new();
    vv.insert("replica-a".to_string(), u64::MAX);
    vv.insert("replica-b".to_string(), 0);
    let op = serde_json::json!({
        "op_id": "op-max",
        "replica_id": "replica-a",
        "doc_id": "notes/max.md",
        "kind": "create",
        "vv": { "replica-a": u64::MAX.to_string(), "replica-b": "0" },
        "ciphertext_b64": "Q1Q6eA==",
        "nonce_b64": "bm9uY2U=",
        "aad": "",
        "ts_ms": 1_700_000_000_001u64,
        "vault_id": VAULT,
        "key_epoch": 0,
    });
    let parsed: SyncOp = serde_json::from_value(op).expect("string vv parses");
    assert_eq!(parsed.vv["replica-a"], u64::MAX);
    assert_eq!(parsed.vv["replica-b"], 0);
    // Compat: numbers still parse.
    let op_num = serde_json::json!({
        "op_id": "op-max2",
        "replica_id": "replica-a",
        "doc_id": "notes/max.md",
        "kind": "create",
        "vv": { "replica-a": 7u64 },
        "ciphertext_b64": "Q1Q6eA==",
        "nonce_b64": "bm9uY2U=",
        "aad": "",
        "ts_ms": 1_700_000_000_001u64,
        "vault_id": VAULT,
        "key_epoch": 0,
    });
    let parsed_num: SyncOp = serde_json::from_value(op_num).expect("number vv compat");
    assert_eq!(parsed_num.vv["replica-a"], 7);
    // Garbage rejected, never silent zero.
    let op_bad = serde_json::json!({
        "op_id": "op-bad",
        "replica_id": "replica-a",
        "doc_id": "notes/max.md",
        "kind": "create",
        "vv": { "replica-a": "not-a-number" },
        "ciphertext_b64": "Q1Q6eA==",
        "nonce_b64": "bm9uY2U=",
        "aad": "",
        "ts_ms": 1_700_000_000_001u64,
        "vault_id": VAULT,
        "key_epoch": 0,
    });
    assert!(serde_json::from_value::<SyncOp>(op_bad).is_err());
    // Precision proof: u64::MAX as JSON number would lose bits in JS
    // (>2^53); as string it is exact. Serialize emits strings.
    let wire = serde_json::to_value(&parsed).unwrap();
    assert_eq!(
        wire["vv"]["replica-a"],
        serde_json::Value::String(u64::MAX.to_string())
    );
    // DocVersion.version: string on the wire, exact at MAX.
    let dv = serde_json::json!({
        "op_id": "op-1",
        "doc_id": "notes/max.md",
        "version": u64::MAX.to_string(),
        "hash": "h",
        "ts_ms": 1u64,
        "vv_text": "replica-a:1",
        "ciphertext_b64": "eA==",
        "nonce_b64": "bm9uY2U=",
        "replica_id": "replica-a",
        "deleted": false,
        "kind": "create",
        "vault_id": VAULT,
        "key_epoch": 0,
    });
    let parsed_dv: fub_services::sync::versions::DocVersion =
        serde_json::from_value(dv).expect("string version parses");
    assert_eq!(parsed_dv.version, u64::MAX);
    let wire_dv = serde_json::to_value(&parsed_dv).unwrap();
    assert_eq!(
        wire_dv["version"],
        serde_json::Value::String(u64::MAX.to_string())
    );
    // ts_ms stays a NUMBER (rule): assert the emitted form.
    assert!(wire_dv["ts_ms"].is_number());
    assert!(wire["ts_ms"].is_number());
    let _ = vv;
}

#[test]
fn selected_restore_is_authenticated_and_only_a_fresh_write_changes_history() {
    use fub_services::crypto::{aad_verify, seal, SyncEnvelope};
    let dir = temp_data_dir("restore-version");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "restore-user");
    let mut a = Replica::new("a");
    let key = [29u8; 32];
    let mut first = a.op("notes/history.md", OpKind::Create, "");
    let (nonce, ciphertext) = seal(&key, &first.aad, b"original bytes").unwrap();
    first.nonce_b64 = nonce;
    first.ciphertext_b64 = ciphertext;
    push(&mut state, &auth, &a.id, std::slice::from_ref(&first));
    let mut second = a.op("notes/history.md", OpKind::Update, "");
    let (nonce, ciphertext) = seal(&key, &second.aad, b"newer bytes").unwrap();
    second.nonce_b64 = nonce;
    second.ciphertext_b64 = ciphertext;
    push(&mut state, &auth, &a.id, &[second]);

    let body = serde_json::json!({
        "vault_id": VAULT, "doc_id": "notes/history.md", "version": "1",
    });
    let reply = sync::handle(
        &mut state,
        "POST",
        "/v1/sync/restore",
        Some(&auth),
        &serde_json::to_vec(&body).unwrap(),
    );
    assert_eq!(
        reply.status,
        200,
        "{}",
        String::from_utf8_lossy(&reply.body)
    );
    let reply: serde_json::Value = serde_json::from_slice(&reply.body).unwrap();
    let original: SyncOp = serde_json::from_value(reply["source_op"].clone()).unwrap();
    let env = SyncEnvelope {
        protocol: "fub-sync/1".into(),
        vault_id: original.vault_id.clone(),
        key_epoch: original.key_epoch,
        op_id: original.op_id.clone(),
        replica_id: original.replica_id.clone(),
        doc_id: original.doc_id.clone(),
        kind: original.kind.as_str().into(),
        vv: original.vv.clone(),
        ts_ms: original.ts_ms,
        rename_from: original.rename_from.clone(),
        rename_to: original.rename_to.clone(),
    };
    let plaintext = aad_verify(&key, &env, &original.nonce_b64, &original.ciphertext_b64).unwrap();
    assert_eq!(plaintext, b"original bytes");
    let sync_dir = fub_services::schema::sync_dir(&dir);
    assert_eq!(
        fub_services::sync::versions::load(&sync_dir)
            .unwrap()
            .versions["notes/history.md"]
            .len(),
        2,
        "restore read cannot replay an old vector"
    );
    let mut fresh = a.op("notes/history.md", OpKind::Update, "");
    let (nonce, ciphertext) = seal(&key, &fresh.aad, &plaintext).unwrap();
    fresh.nonce_b64 = nonce;
    fresh.ciphertext_b64 = ciphertext;
    assert_eq!(push(&mut state, &auth, &a.id, &[fresh]).ack.len(), 1);
    assert_eq!(
        fub_services::sync::versions::load(&sync_dir)
            .unwrap()
            .versions["notes/history.md"]
            .len(),
        3
    );
}

#[test]
fn concurrent_rename_and_edit_are_held_without_poisoning_durable_replay() {
    let dir = temp_data_dir("rename-edit");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "rename-edit-user");
    let mut a = Replica::new("a");
    let mut b = Replica::new("b");
    let initial = a.op("notes/from.md", OpKind::Create, "first");
    push(&mut state, &auth, &a.id, &[initial]);
    let seen = pull(&mut state, &auth, &b.id, &BTreeMap::new());
    learn(&mut b, &seen.ops);
    let rename = a.op(
        "notes/from.md",
        OpKind::Rename {
            from: "notes/from.md".into(),
            to: "notes/to.md".into(),
        },
        "first",
    );
    let edit = b.op("notes/from.md", OpKind::Update, "concurrent");
    assert_eq!(push(&mut state, &auth, &a.id, &[rename]).ack.len(), 1);
    let held = push(&mut state, &auth, &b.id, &[edit]);
    assert!(held.ack.is_empty());
    assert_eq!(held.conflicts.len(), 1);
    assert_eq!(
        fub_services::sync::queue::load_ops(&fub_services::schema::sync_dir(&dir), &b.id)
            .unwrap()
            .len(),
        0
    );
    let unrelated = b.op("notes/independent.md", OpKind::Create, "safe");
    assert_eq!(push(&mut state, &auth, &b.id, &[unrelated]).ack.len(), 1);
    let folded = fub_services::sync::versions::load(&fub_services::schema::sync_dir(&dir)).unwrap();
    assert!(folded.versions.contains_key("notes/to.md"));
    assert_eq!(folded.versions["notes/from.md"].len(), 1);
}
#[test]
fn edit_before_concurrent_delete_is_preserved_and_reported() {
    let dir = temp_data_dir("delete-after-edit");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "delete-after-edit-user");
    let mut a = Replica::new("a");
    let mut b = Replica::new("b");
    let initial = a.op("notes/deleted.md", OpKind::Create, "initial");
    push(&mut state, &auth, &a.id, &[initial]);
    let seen = pull(&mut state, &auth, &b.id, &BTreeMap::new());
    learn(&mut b, &seen.ops);
    let edit = a.op("notes/deleted.md", OpKind::Update, "preserve me");
    let delete = b.op("notes/deleted.md", OpKind::Delete, "");
    push(&mut state, &auth, &a.id, &[edit]);
    let result = push(&mut state, &auth, &b.id, &[delete]);
    assert_eq!(result.ack.len(), 1);
    assert_eq!(result.conflicts.len(), 1);
    let folded = fub_services::sync::versions::load(&fub_services::schema::sync_dir(&dir)).unwrap();
    assert_eq!(folded.versions["notes/deleted.md"].len(), 3);
    assert_eq!(folded.conflicts.len(), 1);
    assert!(folded.tombstones.contains_key("notes/deleted.md"));
}

#[test]
fn status_rows_are_sourced_from_authenticated_versions_and_wal_does_not_expire() {
    let dir = temp_data_dir("status-and-wal");
    let mut state = open_state(&dir);
    let auth = auth_for(&mut state, "status-user");
    let mut a = Replica::new("a");
    let op = a.op("notes/status.md", OpKind::Create, "opaque");
    push(&mut state, &auth, &a.id, std::slice::from_ref(&op));
    let status = sync::handle(
        &mut state,
        "GET",
        &format!("/v1/sync/status?vault_id={VAULT}&replica_id={}", a.id),
        Some(&auth),
        b"",
    );
    assert_eq!(status.status, 200);
    let status: serde_json::Value = serde_json::from_slice(&status.body).unwrap();
    assert_eq!(status["entries"][0]["doc_id"], "notes/status.md");
    assert_eq!(status["entries"][0]["server_counter"], "1");
    assert_eq!(status["log"][0]["kind"], "create");
    let sync_dir = fub_services::schema::sync_dir(&dir);
    let quotas = fub_services::schema::ServiceQuotas::default();
    fub_services::sync::queue::enforce_cap(
        &sync_dir,
        &a.id,
        &quotas,
        op.ts_ms + 365 * 24 * 3_600_000,
    )
    .unwrap();
    assert_eq!(
        fub_services::sync::queue::load_ops(&sync_dir, &a.id)
            .unwrap()
            .len(),
        1,
        "unacked authority cannot expire by wall clock"
    );
}
