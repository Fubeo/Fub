//! Test delle versioni autenticate: AAD, persistenza, ripresa e pagine.

use super::*;
use crate::crypto::{aad_verify, seal};
use std::collections::BTreeMap;

const VAULT: &str = "vault-aad-persistence";
const KEY: [u8; 32] = [43; 32];

fn sealed_op(kind: OpKind, doc_id: &str, count: u64, plaintext: &[u8]) -> SyncOp {
    let vv = BTreeMap::from([("replica-a".to_string(), count)]);
    sealed_op_in(VAULT, "replica-a", vv, kind, doc_id, plaintext)
}

fn sealed_op_in(
    vault_id: &str,
    replica_id: &str,
    vv: VersionVector,
    kind: OpKind,
    doc_id: &str,
    plaintext: &[u8],
) -> SyncOp {
    let count = vv[replica_id];
    let (rename_from, rename_to) = match &kind {
        OpKind::Rename { from, to } => (Some(from.clone()), Some(to.clone())),
        _ => (None, None),
    };
    let mut op = SyncOp {
        op_id: if vault_id == VAULT && replica_id == "replica-a" {
            format!("op-{count}")
        } else {
            format!("op-{vault_id}-{replica_id}-{count}")
        },
        replica_id: replica_id.to_string(),
        doc_id: doc_id.to_string(),
        kind,
        vv,
        ciphertext_b64: String::new(),
        nonce_b64: String::new(),
        aad: String::new(),
        ts_ms: 1_700_000_000_000 + count,
        vault_id: vault_id.to_string(),
        key_epoch: 2,
        rename_from,
        rename_to,
    };
    let envelope = crate::crypto::SyncEnvelope {
        protocol: SYNC_PROTOCOL.to_string(),
        vault_id: op.vault_id.clone(),
        key_epoch: op.key_epoch,
        op_id: op.op_id.clone(),
        replica_id: op.replica_id.clone(),
        doc_id: op.doc_id.clone(),
        kind: op.kind.as_str().to_string(),
        vv: op.vv.clone(),
        ts_ms: op.ts_ms,
        rename_from: op.rename_from.clone(),
        rename_to: op.rename_to.clone(),
    };
    op.aad = crate::crypto::canonical_aad_json(&envelope);
    (op.nonce_b64, op.ciphertext_b64) = seal(&KEY, &op.aad, plaintext).unwrap();
    op
}

#[test]
fn durable_first_update_and_rename_retain_authenticated_envelopes() {
    let dir = std::env::temp_dir().join(format!("fub-sync-aad-{}", schema::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut state = ServiceState::open(Some(dir.clone())).unwrap();
    let account = state
        .accounts
        .create_account("aad-restart", "correct-horse-99")
        .unwrap();
    let token = state.accounts.issue_session_token(&account).unwrap();
    let auth = format!("Bearer {token}");
    let first = sealed_op(OpKind::Update, "notes/source.md", 1, b"first update");
    let rename = sealed_op(
        OpKind::Rename {
            from: "notes/source.md".to_string(),
            to: "notes/destination.md".to_string(),
        },
        "notes/source.md",
        2,
        b"rename contents",
    );
    let push = PushRequest {
        protocol: Some(SYNC_PROTOCOL.to_string()),
        replica_id: "replica-a".to_string(),
        ops: vec![first.clone(), rename.clone()],
    };
    let response = handle(
        &mut state,
        "POST",
        "/v1/sync/push",
        Some(&auth),
        &serde_json::to_vec(&push).unwrap(),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let result: PushResponse = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(result.ack, vec![first.op_id.clone(), rename.op_id.clone()]);

    drop(state);
    let mut state = ServiceState::open(Some(dir.clone())).unwrap();
    let pull = PullRequest {
        protocol: Some(SYNC_PROTOCOL.to_string()),
        replica_id: "replica-b".to_string(),
        vault_id: VAULT.to_string(),
        since_vv: BTreeMap::new(),
        offset: None,
        snapshot_vv: BTreeMap::new(),
    };
    let response = handle(
        &mut state,
        "POST",
        "/v1/sync/pull",
        Some(&auth),
        &serde_json::to_vec(&pull).unwrap(),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let result: PullResponse = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(result.ops.len(), 2);
    for (original, plaintext) in [
        (&first, b"first update".as_slice()),
        (&rename, b"rename contents".as_slice()),
    ] {
        let pulled = result
            .ops
            .iter()
            .find(|op| op.op_id == original.op_id)
            .unwrap();
        assert_eq!(pulled.kind, original.kind);
        assert_eq!(pulled.doc_id, original.doc_id);
        assert_eq!(pulled.rename_from, original.rename_from);
        assert_eq!(pulled.rename_to, original.rename_to);
        assert_eq!(pulled.aad, original.aad);
        let envelope = check_op_aad(pulled).unwrap();
        assert_eq!(
            aad_verify(&KEY, &envelope, &pulled.nonce_b64, &pulled.ciphertext_b64).unwrap(),
            plaintext
        );
    }
    let status = handle(
        &mut state,
        "GET",
        &format!("/v1/sync/status?vault_id={VAULT}&replica_id=replica-a"),
        Some(&auth),
        &[],
    );
    assert_eq!(status.status, 200);
    let status: serde_json::Value = serde_json::from_slice(&status.body).unwrap();
    assert_eq!(status["server_vv"]["replica-a"], "2");
    let response = handle(
        &mut state,
        "GET",
        &format!("/v1/sync/versions?vault_id={VAULT}&doc_id=notes/destination.md"),
        Some(&auth),
        &[],
    );
    assert_eq!(response.status, 200);
    let versions: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(versions["versions"][0]["op_id"], rename.op_id);
    let encoded = handle(
        &mut state,
        "GET",
        &format!("/v1/sync/versions?vault_id={VAULT}&doc_id=notes%2Fdestination.md"),
        Some(&auth),
        &[],
    );
    assert_eq!(encoded.status, 200);
    let encoded_versions: serde_json::Value = serde_json::from_slice(&encoded.body).unwrap();
    assert_eq!(encoded_versions["versions"][0]["op_id"], rename.op_id);
    assert_eq!(
        handle(
            &mut state,
            "GET",
            &format!("/v1/sync/versions?vault_id={VAULT}&doc_id=notes%GG"),
            Some(&auth),
            &[],
        )
        .status,
        400
    );
    let restore = serde_json::json!({ "doc_id": "notes/source.md", "vault_id": VAULT });
    let response = handle(
        &mut state,
        "POST",
        "/v1/sync/restore",
        Some(&auth),
        &serde_json::to_vec(&restore).unwrap(),
    );
    assert_eq!(response.status, 200);
    let source: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(source["source_op_id"], first.op_id);
    assert_eq!(source["requires_fresh_push"], true);

    // Simulate a pre-migration chain without kind: neither pull nor push
    // may guess an AAD or replace the original state file.
    let path = versions::state_path(&vault_dir(&schema::sync_dir(&dir), VAULT));
    let mut raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    raw["versions"]["notes/source.md"][0]
        .as_object_mut()
        .unwrap()
        .remove("kind");
    let old_bytes = serde_json::to_vec(&raw).unwrap();
    std::fs::write(&path, &old_bytes).unwrap();
    let response = handle(
        &mut state,
        "POST",
        "/v1/sync/pull",
        Some(&auth),
        &serde_json::to_vec(&pull).unwrap(),
    );
    assert_eq!(response.status, 500);
    let response = handle(
        &mut state,
        "POST",
        "/v1/sync/push",
        Some(&auth),
        &serde_json::to_vec(&push).unwrap(),
    );
    assert_eq!(response.status, 500);
    assert_eq!(std::fs::read(&path).unwrap(), old_bytes);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn wrapped_key_first_provision_is_private_and_rotation_is_conditional() {
    let dir = std::env::temp_dir().join(format!("fub-sync-key-{}", schema::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut state = ServiceState::open(Some(dir.clone())).unwrap();
    let owner = state
        .accounts
        .create_account("key-provision-owner", "correct-horse-99")
        .unwrap();
    let stranger = state
        .accounts
        .create_account("key-provision-stranger", "correct-horse-99")
        .unwrap();
    let owner_auth = format!(
        "Bearer {}",
        state.accounts.issue_session_token(&owner).unwrap()
    );
    let stranger_auth = format!(
        "Bearer {}",
        state.accounts.issue_session_token(&stranger).unwrap()
    );
    let get_path = format!("/v1/sync/vault-key?vault_id={VAULT}");
    assert_eq!(
        handle(&mut state, "GET", &get_path, Some(&owner_auth), &[]).status,
        404
    );

    let old =
        crate::crypto::wrap_vdk_with_kek(&KEY, &KEY, crate::crypto::KdfParams::fresh().unwrap())
            .unwrap();
    let old_body = serde_json::json!({ "vault_id": VAULT, "wrapped": old });
    let response = handle(
        &mut state,
        "POST",
        "/v1/sync/vault-key",
        Some(&owner_auth),
        &serde_json::to_vec(&old_body).unwrap(),
    );
    assert_eq!(response.status, 200);
    drop(state);

    let mut state = ServiceState::open(Some(dir.clone())).unwrap();
    assert_eq!(
        handle(&mut state, "GET", &get_path, Some(&stranger_auth), &[]).status,
        403
    );
    let response = handle(&mut state, "GET", &get_path, Some(&owner_auth), &[]);
    assert_eq!(response.status, 200);
    let stored: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(stored["wrapped"], old_body["wrapped"]);
    let next = crate::crypto::wrap_vdk_with_kek(
        &KEY,
        &[44; 32],
        crate::crypto::KdfParams::fresh().unwrap(),
    )
    .unwrap();
    let next_body = serde_json::json!({ "vault_id": VAULT, "wrapped": next });
    assert_eq!(
        handle(
            &mut state,
            "POST",
            "/v1/sync/vault-key",
            Some(&owner_auth),
            &serde_json::to_vec(&next_body).unwrap()
        )
        .status,
        409
    );
    let next_body = serde_json::json!({
        "vault_id": VAULT,
        "wrapped": next_body["wrapped"],
        "expected_wrapped_hash": stored["wrapped_hash"],
        "key_epoch": stored["key_epoch"].as_u64().unwrap_or(0) + 1,
    });
    assert_eq!(
        handle(
            &mut state,
            "POST",
            "/v1/sync/vault-key",
            Some(&owner_auth),
            &serde_json::to_vec(&next_body).unwrap()
        )
        .status,
        200
    );
    let response = handle(&mut state, "GET", &get_path, Some(&owner_auth), &[]);
    let stored: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(stored["wrapped"], next_body["wrapped"]);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn pull_continuation_exhausts_snapshot_without_skipping_or_advancing_early() {
    let dir = std::env::temp_dir().join(format!("fub-sync-pages-{}", schema::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut state = ServiceState::open(Some(dir.clone())).unwrap();
    let owner = state
        .accounts
        .create_account("pull-page-owner", "correct-horse-99")
        .unwrap();
    let auth = format!(
        "Bearer {}",
        state.accounts.issue_session_token(&owner).unwrap()
    );
    let seed = sealed_op(OpKind::Create, "notes/paged-00000.md", 1, b"first");
    let push = PushRequest {
        protocol: Some(SYNC_PROTOCOL.to_string()),
        replica_id: "replica-a".to_string(),
        ops: vec![seed.clone()],
    };
    assert_eq!(
        handle(
            &mut state,
            "POST",
            "/v1/sync/push",
            Some(&auth),
            &serde_json::to_vec(&push).unwrap()
        )
        .status,
        200
    );
    let mut folded = SyncState::default();
    for index in 0..=PULL_MAX_OPS {
        let doc = format!("notes/paged-{index:05}.md");
        let op = if index == 0 {
            seed.clone()
        } else {
            sealed_op(OpKind::Create, &doc, index as u64 + 1, b"content")
        };
        versions::push_version(&mut folded, &op, &doc);
    }
    folded
        .server_vv
        .insert("replica-a".to_string(), PULL_MAX_OPS as u64 + 1);
    versions::save(&vault_dir(&sync_dir_of(&state), VAULT), &folded).unwrap();

    let mut request = PullRequest {
        protocol: Some(SYNC_PROTOCOL.to_string()),
        replica_id: "replica-b".to_string(),
        vault_id: VAULT.to_string(),
        since_vv: BTreeMap::new(),
        offset: None,
        snapshot_vv: BTreeMap::new(),
    };
    let response = handle(
        &mut state,
        "POST",
        "/v1/sync/pull",
        Some(&auth),
        &serde_json::to_vec(&request).unwrap(),
    );
    assert_eq!(response.status, 200);
    let first: PullResponse = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(first.ops.len(), PULL_MAX_OPS);
    assert!(first.truncated);
    assert_eq!(first.next_offset, Some(PULL_MAX_OPS as u64));
    let wire: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(
        wire["next_offset"],
        serde_json::json!(PULL_MAX_OPS.to_string())
    );

    request.offset = first.next_offset;
    request.snapshot_vv = first.server_vv.clone();
    let response = handle(
        &mut state,
        "POST",
        "/v1/sync/pull",
        Some(&auth),
        &serde_json::to_vec(&request).unwrap(),
    );
    assert_eq!(response.status, 200);
    let last: PullResponse = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(last.ops.len(), 1);
    assert!(!last.truncated);
    assert_eq!(last.next_offset, None);
    assert!(!first.ops.iter().any(|op| op.op_id == last.ops[0].op_id));

    folded
        .server_vv
        .insert("replica-a".to_string(), PULL_MAX_OPS as u64 + 2);
    versions::save(&vault_dir(&sync_dir_of(&state), VAULT), &folded).unwrap();
    assert_eq!(
        handle(
            &mut state,
            "POST",
            "/v1/sync/pull",
            Some(&auth),
            &serde_json::to_vec(&request).unwrap()
        )
        .status,
        409
    );
    std::fs::remove_dir_all(dir).unwrap();
}

pub(super) fn bearer(state: &mut ServiceState, name: &str) -> (String, String) {
    let account = state
        .accounts
        .create_account(name, "correct-horse-99")
        .unwrap();
    let token = state.accounts.issue_session_token(&account).unwrap();
    (account, format!("Bearer {token}"))
}

fn post(
    state: &mut ServiceState,
    path: &str,
    auth: &str,
    body: &impl Serialize,
) -> (u16, serde_json::Value) {
    let response = handle(
        state,
        "POST",
        path,
        Some(auth),
        &serde_json::to_vec(body).unwrap(),
    );
    let value = serde_json::from_slice(&response.body).unwrap_or_default();
    (response.status, value)
}

fn pull_request(vault_id: &str, replica_id: &str) -> PullRequest {
    PullRequest {
        protocol: Some(SYNC_PROTOCOL.to_string()),
        replica_id: replica_id.to_string(),
        vault_id: vault_id.to_string(),
        since_vv: BTreeMap::new(),
        offset: None,
        snapshot_vv: BTreeMap::new(),
    }
}

fn pulled_ids(value: &serde_json::Value) -> BTreeSet<String> {
    value["ops"]
        .as_array()
        .unwrap()
        .iter()
        .map(|op| op["op_id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn two_vaults_with_the_same_doc_id_never_share_a_chain() {
    let dir = std::env::temp_dir().join(format!("fub-sync-vaults-{}", schema::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut state = ServiceState::open(Some(dir.clone())).unwrap();
    let (_, alice) = bearer(&mut state, "vault-alice");
    let (_, bob) = bearer(&mut state, "vault-bob");
    let vv = |pairs: &[(&str, u64)]| -> VersionVector {
        pairs.iter().map(|(id, n)| (id.to_string(), *n)).collect()
    };
    let op = |vault: &str, replica: &str, counters: &[(&str, u64)], kind, doc: &str| {
        sealed_op_in(vault, replica, vv(counters), kind, doc, b"bytes")
    };
    // Alice cancella il suo `notes/same.md` e scrive un vettore che
    // domina i contatori futuri della replica di Bob.
    let alice_ops = vec![
        op(
            "vault-a",
            "replica-a",
            &[("replica-a", 1)],
            OpKind::Create,
            "notes/same.md",
        ),
        op(
            "vault-a",
            "replica-a",
            &[("replica-a", 2)],
            OpKind::Delete,
            "notes/same.md",
        ),
        op(
            "vault-a",
            "replica-a",
            &[("replica-a", 3), ("replica-b", 100)],
            OpKind::Create,
            "notes/other.md",
        ),
    ];
    let push = PushRequest {
        protocol: Some(SYNC_PROTOCOL.to_string()),
        replica_id: "replica-a".to_string(),
        ops: alice_ops.clone(),
    };
    let (status, body) = post(&mut state, "/v1/sync/push", &alice, &push);
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["ack"].as_array().unwrap().len(), 3);

    // Gli stessi nomi nel vault di Bob: né la tombstone né il vettore di
    // Alice li trattengono o li scartano.
    let bob_ops = vec![
        op(
            "vault-b",
            "replica-b",
            &[("replica-b", 1)],
            OpKind::Create,
            "notes/same.md",
        ),
        op(
            "vault-b",
            "replica-b",
            &[("replica-b", 2)],
            OpKind::Create,
            "notes/other.md",
        ),
    ];
    let bob_ids: BTreeSet<String> = bob_ops.iter().map(|op| op.op_id.clone()).collect();
    let push = PushRequest {
        protocol: Some(SYNC_PROTOCOL.to_string()),
        replica_id: "replica-b".to_string(),
        ops: bob_ops,
    };
    let (status, body) = post(&mut state, "/v1/sync/push", &bob, &push);
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["conflicts"], serde_json::json!([]));
    let (status, body) = post(
        &mut state,
        "/v1/sync/pull",
        &bob,
        &pull_request("vault-b", "replica-b"),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(pulled_ids(&body), bob_ids);
    assert!(body["server_vv"].get("replica-a").is_none());
    let (status, body) = post(
        &mut state,
        "/v1/sync/pull",
        &alice,
        &pull_request("vault-a", "replica-a"),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        pulled_ids(&body),
        alice_ops.iter().map(|op| op.op_id.clone()).collect()
    );

    // La coda di una replica sta nel suo vault: Alice non la svuota
    // nominando il proprio.
    let status_path = "/v1/sync/status?vault_id=vault-b&replica_id=replica-b";
    let pending = |state: &mut ServiceState| {
        let response = handle(state, "GET", status_path, Some(&bob), &[]);
        assert_eq!(response.status, 200);
        let value: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
        value["pending"].as_u64().unwrap()
    };
    assert_eq!(pending(&mut state), 2);
    let ack = serde_json::json!({
        "replica_id": "replica-b", "vault_id": "vault-a", "ack": bob_ids,
    });
    let (status, body) = post(&mut state, "/v1/sync/ack", &alice, &ack);
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["removed"], 0);
    assert_eq!(pending(&mut state), 2);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_single_vault_legacy_state_is_adopted_and_a_mixed_one_stops_sync() {
    let legacy_service = |label: &str, folded: &SyncState, wal: &[SyncOp]| {
        let dir = std::env::temp_dir().join(format!("fub-sync-{label}-{}", schema::new_id()));
        let root = sync_dir(&dir);
        versions::save(&root, folded).unwrap();
        if !wal.is_empty() {
            queue::append_ops(&root, "replica-a", wal).unwrap();
        }
        let mut state = ServiceState::open(Some(dir.clone())).unwrap();
        let (owner, auth) = bearer(&mut state, label);
        let mut grant = ShareAcl::new(&vault_resource(VAULT));
        grant.grant(&owner, Role::Owner);
        let shares = SyncShares {
            grants: BTreeMap::from([(vault_resource(VAULT), grant)]),
            ..SyncShares::default()
        };
        save_shares(&root, &shares).unwrap();
        (dir, root, state, auth)
    };
    let op = sealed_op(OpKind::Create, "notes/legacy.md", 1, b"legacy");
    let mut single = SyncState::default();
    versions::push_version(&mut single, &op, "notes/legacy.md");
    single.server_vv = op.vv.clone();

    // Un solo vault: stato e coda passano nella sua cartella.
    let (dir, root, mut state, auth) =
        legacy_service("legacy-single", &single, std::slice::from_ref(&op));
    let (status, body) = post(
        &mut state,
        "/v1/sync/pull",
        &auth,
        &pull_request(VAULT, "replica-b"),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(pulled_ids(&body), BTreeSet::from([op.op_id.clone()]));
    let partition = vault_dir(&root, VAULT);
    assert!(!versions::state_path(&root).exists());
    assert!(!queue::queue_path(&root, "replica-a").exists());
    assert!(versions::state_path(&partition).exists());
    assert_eq!(queue::load_ops(&partition, "replica-a").unwrap().len(), 1);
    std::fs::remove_dir_all(dir).unwrap();

    // Due vault nello stesso stato: nessuna separazione per tentativi,
    // il sync si ferma e lo stato resta com'era.
    let mut mixed = single.clone();
    let other = sealed_op_in(
        "vault-other",
        "replica-b",
        BTreeMap::from([("replica-b".to_string(), 1)]),
        OpKind::Create,
        "notes/legacy.md",
        b"other",
    );
    versions::push_version(&mut mixed, &other, "notes/legacy.md");
    let (dir, root, mut state, auth) = legacy_service("legacy-mixed", &mixed, &[]);
    let before = std::fs::read(versions::state_path(&root)).unwrap();
    let (status, _) = post(
        &mut state,
        "/v1/sync/pull",
        &auth,
        &pull_request(VAULT, "replica-b"),
    );
    assert_eq!(status, 500);
    assert_eq!(std::fs::read(versions::state_path(&root)).unwrap(), before);
    assert!(!vault_dir(&root, VAULT).exists());
    std::fs::remove_dir_all(dir).unwrap();

    // Nessun vault: lo stato si mette da parte, non si cancella.
    let (dir, root, mut state, auth) = legacy_service("legacy-empty", &SyncState::default(), &[]);
    let (status, body) = post(
        &mut state,
        "/v1/sync/pull",
        &auth,
        &pull_request(VAULT, "replica-b"),
    );
    assert_eq!(status, 200, "{body}");
    assert!(!versions::state_path(&root).exists());
    assert!(root.join(LEGACY_STATE_ASIDE).exists());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn history_yields_to_the_quota_but_never_what_it_still_serves() {
    let mut folded = SyncState::default();
    let mut count = 0;
    let mut put = |folded: &mut SyncState, kind: OpKind, doc: &str| {
        count += 1;
        let op = sealed_op(kind, doc, count, &[b'x'; 512]);
        if op.kind.is_delete() {
            move_to_trash(folded, doc, op.vv.clone(), &op.replica_id, op.ts_ms);
        }
        versions::push_version(folded, &op, doc);
    };
    put(&mut folded, OpKind::Create, "notes/plain.md");
    for _ in 0..3 {
        put(&mut folded, OpKind::Update, "notes/plain.md");
    }
    for _ in 0..3 {
        put(&mut folded, OpKind::Update, "notes/conflict.md");
    }
    put(&mut folded, OpKind::Create, "notes/trashed.md");
    put(&mut folded, OpKind::Update, "notes/trashed.md");
    put(&mut folded, OpKind::Delete, "notes/trashed.md");
    folded.conflicts.push(SyncConflict {
        doc_id: "notes/conflict.md".to_string(),
        reason: "concurrent edit".to_string(),
        replicas: vec!["replica-a".to_string(), "replica-b".to_string()],
        ts_ms: 1,
    });
    let chain = |folded: &SyncState, doc: &str| -> Vec<u64> {
        folded.versions[doc].iter().map(|v| v.version).collect()
    };
    let total = versions::stored_bytes(&folded);
    assert_eq!(versions::fit_history(&mut folded, total), total);
    let one = folded.versions["notes/plain.md"][0].ciphertext_b64.len() as u64
        + folded.versions["notes/plain.md"][0].nonce_b64.len() as u64;
    // The oldest history goes first, and only as much as needed.
    assert_eq!(versions::fit_history(&mut folded, total - 1), total - one);
    assert_eq!(chain(&folded, "notes/plain.md"), vec![2, 3, 4]);
    assert_eq!(chain(&folded, "notes/trashed.md"), vec![1, 2, 3]);
    // Nothing left to yield: the latest version, an open conflict's
    // chain and the version the trash restores stay, over budget.
    let left = versions::fit_history(&mut folded, 0);
    assert_eq!(left, versions::stored_bytes(&folded));
    assert!(left > 0);
    assert_eq!(chain(&folded, "notes/plain.md"), vec![4]);
    assert_eq!(chain(&folded, "notes/conflict.md"), vec![1, 2, 3]);
    assert_eq!(chain(&folded, "notes/trashed.md"), vec![2, 3]);
}
