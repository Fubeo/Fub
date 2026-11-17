//! Sync slice (P16): durable replication with version vectors, E2EE-opaque
//! storage, conservative conflicts, selection, versions/restore, invites.
//!
//! The server stores ciphertext opaquely and never sees plaintext. Every op
//! authenticates the canonical JSON `SyncEnvelope` (vault, epoch, kind,
//! rename endpoints, identity, vector and timestamp); the client verifies
//! AEAD before applying any pulled bytes.
//!
//! Parent hooks called here without redefinition (exact names):
//! - `auth::AccountStore::verify_session_token` (bearer),
//! - `mfa::verify_totp` + `LoginRateLimit::check_totp` (step-up on
//!   invite/revoke when the caller enrolled TOTP; session tokens already
//!   imply MFA passed at login in `main.rs`),
//! - `acl::{ShareAcl, Role, check}` + `new_invite`/`accept_invite`,
//! - `schema::{new_id, now_ms, sync_dir, atomic_write, is_device_only,
//!   ServiceQuotas}`,
//! - `routing::{SYNC_PROTOCOL, assert_protocol}`,
//! - `crypto::{WrappedVdk, KDF_VERSION}` for the vault-key envelope (the
//!   server stores the envelope opaquely and never holds KEK/VDK cleartext —
//!   user-supplied vault passphrase, exercised in
//!   `tests/sync_invariants.rs`; see the vault-key handlers below).
//!
//! Replica identity: `replica_id` is an opaque UUID v4
//! ([`crate::schema::new_id`]), persisted client-side and never derived from
//! a path; a rename keeps the replica stable because the path is an
//! attribute of the op, not the identity of the replica.
//!
//! Layout under `<data>/sync/`: `shares.json` holds grants, invites and
//! wrapped keys indexed by vault; every vault has its own
//! `vaults/<sha256(vault_id)>/` with the folded `state.json` and the replica
//! queues. Chains, tombstones, trash, server vector, dedup set and quota are
//! per vault, so two vaults that share a `doc_id` never meet. State written
//! by an older version straight into `sync/` is adopted when it holds a
//! single vault; a state mixing vaults stops sync until the operator
//! recovers it (see [`vault_dir`]).
//!
//! A replica is NOT a backup: versions/tombstones/conflicts expire by
//! `retention_days`; restore is a new write, never a resurrection of an old
//! vector.
//!
//! The parent router and this entry point use the same typed route table in
//! [`crate::routing`]; unsupported method/path pairs remain 404.

pub mod causality;
pub mod queue;
pub mod versions;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::acl::{self, Role, ShareAcl};
use crate::routing::SYNC_PROTOCOL;
use crate::schema::{self, atomic_write, sync_dir};
use crate::server::{HttpResponse, ServiceState};

use causality::{
    can_resurrect, conflict_reason, doc_kind_for, is_duplicate, needs_conflict_copy, parse_vv_text,
    vv_compare, vv_inc, vv_merge, SyncConflict, Tombstone, VersionVector, VvOrder,
};
use versions::{
    latest_any, move_to_trash, push_version, restore_from_trash, DocVersion, SyncState,
};

mod auth;
mod dispatch;
mod fold;
mod history;
mod pull;
mod push;
mod shares;
mod sharing;
mod vault_state;

use auth::{account_of, authorize, check_op_aad, check_role, check_wire_protocol, step_up_mfa};
pub use dispatch::{admit, handle, vault_dir, vault_of_request, Admission, VaultWork};
use dispatch::{
    decode_query_value, query_get, scope_of, sync_dir_of, valid_replica_id, vault_dir_of, VaultJob,
    VaultScope,
};
use fold::{fold_op, FoldOutcome};
use history::{admit_restore, admit_trash, admit_versions, run_restore, run_trash, run_versions};
use pull::{admit_ack, admit_pull, admit_status, run_ack, run_pull, run_status};
use push::{admit_push, op_from_version, run_push};
use shares::{load_shares, merge_grants, save_shares};
pub use shares::{vault_resource, StoredInvite, SyncShares};
use sharing::{
    handle_invite, handle_invite_accept, handle_revoke, handle_vault_key_get,
    handle_vault_key_store,
};
pub use vault_state::LEGACY_STATE_ASIDE;
use vault_state::{adopt_legacy, already_folded, cap_seen, load_folded};

/// Wire op envelope. Field names are the contract: changing one breaks the
/// host client (`crates/fub-host/src/remote/sync.rs`), which mirrors them.
///
/// Canonical form (Main): `vault_id` + `key_epoch` + `kind` including
/// `rename{from,to}` are authenticated by the canonical AAD
/// (`crypto::canonical_aad_json` recomputed server-side from these fields —
/// the wire `aad` is NEVER trusted). Ops missing the new fields, or carrying
/// the old 4-field pipe AAD, are rejected hard: no silent downgrade.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncOp {
    pub op_id: String,
    pub replica_id: String,
    pub doc_id: String,
    pub kind: OpKind,
    /// Valori come stringhe sul wire (`wire::vv_string`), compat numero.
    #[serde(with = "crate::wire::vv_string")]
    pub vv: VersionVector,
    pub ciphertext_b64: String,
    pub nonce_b64: String,
    /// Legacy transport echo of the canonical AAD. NEVER trusted: the server
    /// recomputes `canonical_aad_json` from the fields above and rejects on
    /// mismatch. Missing on new ops is fine (recomputed anyway).
    #[serde(default)]
    pub aad: String,
    /// Millisecondi UNIX: restano number (mai oltre 2^53 fino al 2255, e la UI
    /// ci fa aritmetica `new Date(ts)` come `VersionRef.ts` del contratto).
    pub ts_ms: u64,
    pub vault_id: String,
    /// VDK key epoch: ops from another epoch are held, never applied.
    pub key_epoch: u32,
    /// Rename routing: present iff `kind == rename` (`from` -> `to`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_to: Option<String>,
}

/// `create|update|delete|tombstone|rename` on the wire (snake_case).
/// `rename` carries `rename_from`/`rename_to`; `doc_id` is the source, `to`
/// the destination (both authenticated in the canonical AAD).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    Create,
    Update,
    Delete,
    Tombstone,
    Rename { from: String, to: String },
}

impl OpKind {
    pub fn is_delete(&self) -> bool {
        matches!(self, OpKind::Delete | OpKind::Tombstone)
    }
    pub fn is_rename(&self) -> bool {
        matches!(self, OpKind::Rename { .. })
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            OpKind::Create => "create",
            OpKind::Update => "update",
            OpKind::Delete => "delete",
            OpKind::Tombstone => "tombstone",
            OpKind::Rename { .. } => "rename",
        }
    }
    /// `(from, to)` for renames; `doc_id` otherwise. Both ends are AAD-bound.
    pub fn routing(&self, doc_id: &str) -> (String, Option<String>, Option<String>) {
        match self {
            OpKind::Rename { from, to } => (from.clone(), Some(from.clone()), Some(to.clone())),
            _ => (doc_id.to_string(), None, None),
        }
    }
}

/// `POST /v1/sync/push {replica_id, ops[]}` (+ optional `protocol`, asserted
/// when present; per-op `aad` always asserts `fub-sync/1`).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PushRequest {
    #[serde(default)]
    pub protocol: Option<String>,
    pub replica_id: String,
    pub ops: Vec<SyncOp>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PushResponse {
    pub ack: Vec<String>,
    pub conflicts: Vec<ConflictInfo>,
    #[serde(with = "crate::wire::vv_string")]
    pub server_vv: VersionVector,
}

/// Conflict copy surfaced to the UI (both sides preserved server-side).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConflictInfo {
    pub doc_id: String,
    pub reason: String,
    pub replicas: Vec<String>,
}

/// `POST /v1/sync/pull {replica_id, vault_id, since_vv}`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequest {
    #[serde(default)]
    pub protocol: Option<String>,
    pub replica_id: String,
    /// Stable vault pairing id: pull only serves this vault's versions.
    pub vault_id: String,
    #[serde(default, with = "crate::wire::vv_string")]
    pub since_vv: VersionVector,
    /// Continuation offset within the unchanged snapshot; absent = first page.
    #[serde(default, with = "crate::wire::opt_u64_string")]
    pub offset: Option<u64>,
    /// Vector observed on page one. Later pages reject a changed snapshot.
    #[serde(default, with = "crate::wire::vv_string")]
    pub snapshot_vv: VersionVector,
}

/// `{ops[], server_vv, truncated}`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PullResponse {
    pub ops: Vec<SyncOp>,
    #[serde(with = "crate::wire::vv_string")]
    pub server_vv: VersionVector,
    pub truncated: bool,
    /// Next offset within the same snapshot (decimal string on the wire).
    #[serde(
        default,
        with = "crate::wire::opt_u64_string",
        skip_serializing_if = "Option::is_none"
    )]
    pub next_offset: Option<u64>,
}

/// `POST /v1/sync/ack {replica_id, vault_id, ack[]}`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AckRequest {
    pub replica_id: String,
    /// Vault scope for the ACL check (ack drains that vault's queue view).
    #[serde(default = "default_vault_scope")]
    pub vault_id: String,
    pub ack: Vec<String>,
}

fn default_vault_scope() -> String {
    "default".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AckResponse {
    pub acked: Vec<String>,
    pub removed: usize,
}

/// Durata massima di un invito (30 giorni).
pub const MAX_INVITE_TTL_MS: u64 = 30 * 24 * 3600 * 1000;
/// Inviti pendenti per risorsa.
pub const MAX_PENDING_INVITES: usize = 64;

/// Cap on ops returned by one pull; a continuation offset advances the page
/// while the snapshot vector is unchanged.
pub const PULL_MAX_OPS: usize = 5_000;
/// A binary-heavy pull page stays below the client's 64 MiB response cap.
pub const PULL_MAX_BYTES: usize = 32 * 1024 * 1024;
/// Cap on ops accepted by one push (abuse bound; above = 413).
pub const PUSH_MAX_OPS: usize = 10_000;
/// Cap on the fast-path dedup set. A pruned id in a live version chain is
/// still found by `already_folded`; deleted/compacted versions are dominated
/// by the remaining version-vector watermark.
pub const MAX_SEEN_OP_IDS: usize = 200_000;
/// Selection over doc ids (USER exclusions only — `sync.exclude`).
///
/// Mandatory security exclusions ([`crate::schema::SYNC_EXCLUDE`] +
/// [`DEVICE_PREFIXES`]) are enforced in [`is_syncable_doc`] and can NEVER be
/// removed by this list. The user list is ADDITIVE: it only narrows further.
/// Bounded at parse time (64 entries, 256 chars each — see
/// [`parse_user_exclude`]).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SyncSelection {
    #[serde(default)]
    pub include_ext: Vec<String>,
    #[serde(default)]
    pub exclude_ext: Vec<String>,
    #[serde(default)]
    pub include_prefix: Vec<String>,
    #[serde(default)]
    pub exclude_prefix: Vec<String>,
    #[serde(default)]
    pub include_category: Vec<String>,
    #[serde(default)]
    pub exclude_category: Vec<String>,
}

/// Max user-exclusion entries / chars per entry (abuse bound).
pub const MAX_USER_EXCLUDE_ENTRIES: usize = 64;
pub const MAX_USER_EXCLUDE_CHARS: usize = 256;

/// Parse the `sync.exclude` user list (category or `prefix:`/`ext:`-style
/// entries are matched case-insensitively against doc paths). Over-long
/// lists are truncated with an explicit flag; entries are additive to the
/// mandatory exclusions, never subtractive. Returns `(selection, truncated)`.
pub fn parse_user_exclude(entries: &[String]) -> (SyncSelection, bool) {
    let mut sel = SyncSelection::default();
    let mut truncated = entries.len() > MAX_USER_EXCLUDE_ENTRIES;
    for entry in entries.iter().take(MAX_USER_EXCLUDE_ENTRIES) {
        let e = entry.trim().to_ascii_lowercase();
        if e.is_empty() {
            continue;
        }
        let e = e.chars().take(MAX_USER_EXCLUDE_CHARS).collect::<String>();
        if e.len() < entry.trim().len() {
            truncated = true;
        }
        if let Some(rest) = e.strip_prefix("ext:") {
            sel.exclude_ext
                .push(rest.trim_start_matches('.').to_string());
        } else if let Some(rest) = e.strip_prefix("prefix:") {
            sel.exclude_prefix.push(rest.to_string());
        } else if e.contains('/') || e.contains('.') {
            sel.exclude_prefix.push(e);
        } else {
            sel.exclude_category.push(e);
        }
    }
    (sel, truncated)
}

/// Category of a doc id by path shape. The server never sees plaintext, so
/// this keys off the `doc_id` only; the client applies the same predicate
/// before encrypting. Mandatory security categories (device-only) can NEVER
/// be allow-listed back by the user `sync.exclude` list.
pub fn category_of(doc_id: &str) -> &'static str {
    let lower = doc_id.to_ascii_lowercase();
    let first = lower.split('/').next().unwrap_or("");
    // Device-only first: these never leave the device, whatever else matches.
    // Mandatory (Main): no setting, no user list, no caller can remove these.
    if matches!(
        first,
        "cache" | "drafts" | "device" | "secrets" | ".fub" | "theme" | "plugins"
    ) {
        return match first {
            "cache" => "cache",
            "drafts" => "drafts",
            "device" | ".fub" => "device",
            "secrets" => "secrets",
            "theme" => "theme",
            _ => "plugins.code",
        };
    }
    if first == "attachments"
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".pdf")
        || lower.ends_with(".mp3")
        || lower.ends_with(".mp4")
        || lower.ends_with(".zip")
    {
        return "attachments";
    }
    if first == "config-shared" || lower.ends_with(".shared.json") {
        return "config-shared";
    }
    "notes"
}

/// Path prefixes that never sync (defense in depth under the category check).
pub const DEVICE_PREFIXES: &[&str] = &[
    "cache/", "drafts/", "device/", "secrets/", ".fub/", "theme/", "plugins/",
];

/// `true` unless the doc is device-only. Both category
/// ([`crate::schema::is_device_only`]) and path prefix are checked.
pub fn is_syncable_doc(doc_id: &str) -> bool {
    if schema::is_device_only(category_of(doc_id)) {
        return false;
    }
    let lower = doc_id.to_ascii_lowercase();
    if DEVICE_PREFIXES.iter().any(|p| lower.starts_with(p)) {
        return false;
    }
    true
}

fn ext_of(doc_id: &str) -> String {
    doc_id
        .rsplit('/')
        .next()
        .unwrap_or(doc_id)
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Apply [`SyncSelection`] on top of [`is_syncable_doc`].
pub fn is_selected(sel: &SyncSelection, doc_id: &str) -> bool {
    if !is_syncable_doc(doc_id) {
        return false;
    }
    let lower = doc_id.to_ascii_lowercase();
    let cat = category_of(doc_id);
    if !sel.include_category.is_empty() && !sel.include_category.iter().any(|c| c == cat) {
        return false;
    }
    if sel.exclude_category.iter().any(|c| c == cat) {
        return false;
    }
    if !sel.include_prefix.is_empty()
        && !sel
            .include_prefix
            .iter()
            .any(|p| lower.starts_with(&p.to_ascii_lowercase()))
    {
        return false;
    }
    if sel
        .exclude_prefix
        .iter()
        .any(|p| lower.starts_with(&p.to_ascii_lowercase()))
    {
        return false;
    }
    let ext = ext_of(doc_id);
    if !sel.include_ext.is_empty()
        && !sel
            .include_ext
            .iter()
            .any(|e| e.to_ascii_lowercase() == ext)
    {
        return false;
    }
    if sel
        .exclude_ext
        .iter()
        .any(|e| e.to_ascii_lowercase() == ext)
    {
        return false;
    }
    true
}

#[cfg(test)]
mod authenticated_version_tests;

#[cfg(test)]
mod vault_scope_tests {
    use super::vault_of_request;

    /// Il lock si prende sul vault che l'ammissione ricaverà dalla stessa
    /// richiesta.
    #[test]
    fn the_vault_lock_follows_the_vault_the_request_names() {
        let of = |method, path, body: &str| vault_of_request(method, path, body.as_bytes());
        assert_eq!(
            of("GET", "/v1/sync/status?vault_id=v&replica_id=r", "").as_deref(),
            Some("v")
        );
        assert_eq!(
            of("POST", "/v1/sync/pull", r#"{"vault_id":"v"}"#).as_deref(),
            Some("v")
        );
        assert_eq!(of("POST", "/v1/sync/ack", "{}").as_deref(), Some("default"));
        assert_eq!(
            of(
                "POST",
                "/v1/sync/push",
                r#"{"ops":[{"vault_id":""},{"vault_id":"w"}]}"#
            )
            .as_deref(),
            Some("w")
        );
        assert_eq!(
            of("POST", "/v1/sync/push", r#"{"ops":[]}"#).as_deref(),
            Some("default")
        );
        assert_eq!(
            of("POST", "/v1/sync/revoke", r#"{"resource":"vault:x"}"#).as_deref(),
            Some("x")
        );
        assert_eq!(
            of("POST", "/v1/sync/invite", r#"{"resource":"site:s"}"#),
            None
        );
        assert_eq!(of("POST", "/v1/sync/pull", "non json"), None);
    }
}

#[cfg(all(test, unix))]
mod unreachable_state_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// Uno stato che il disco non sa dire non è uno stato vuoto: caricato
    /// vuoto, il salvataggio della richiesta successiva avrebbe cancellato
    /// catene, condivisioni e code del vault.
    #[test]
    fn an_unreachable_sync_dir_is_an_error_not_an_empty_state() {
        let dir = std::env::temp_dir().join(format!("fub-services-sync-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        versions::save(&dir, &versions::SyncState::default()).unwrap();
        save_shares(&dir, &SyncShares::default()).unwrap();
        std::fs::write(queue::queue_path(&dir, "replica-a"), b"").unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o600)).unwrap();
        let reachable = std::fs::metadata(versions::state_path(&dir)).is_ok();
        let state = versions::load(&dir).map(drop);
        let shares = load_shares(&dir).map(drop);
        let ops = queue::load_ops(&dir, "replica-a").map(drop);
        let adopted = adopt_legacy(&dir);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        // Da root la cartella si attraversa lo stesso: non c'è niente da provare.
        if !reachable {
            assert!(state.is_err(), "{state:?}");
            assert!(shares.is_err(), "{shares:?}");
            assert!(ops.is_err(), "{ops:?}");
            assert!(adopted.is_err(), "{adopted:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
