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
use std::path::Path;

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

// ---------------------------------------------------------------------------
// Shares persistence: grants (mirrored into parent `state.acls`), invites
// with optional wrapped-VDK envelopes, owner vault-key envelopes.
// ---------------------------------------------------------------------------

/// Invite + optional wrapped VDK envelope for the invitee. The token and the
/// envelope travel out-of-band to the invitee (EXTERNAL BLOCKER: no
/// production delivery channel exists in this crate; the server only stores
/// the opaque envelope, never key cleartext).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredInvite {
    pub invite: acl::Invite,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrapped_vdk: Option<crate::crypto::WrappedVdk>,
    #[serde(default)]
    pub key_epoch: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncShares {
    #[serde(default)]
    pub grants: BTreeMap<String, ShareAcl>,
    #[serde(default)]
    pub invites: Vec<StoredInvite>,
    #[serde(default)]
    pub keys: BTreeMap<String, crate::crypto::WrappedVdk>,
    /// Owner-authorized epoch persisted with the wrapped VDK.
    #[serde(default)]
    pub key_epochs: BTreeMap<String, u32>,
}

fn shares_path(sync_dir: &Path) -> std::path::PathBuf {
    sync_dir.join("shares.json")
}

fn load_shares(sync_dir: &Path) -> Result<SyncShares, String> {
    let path = shares_path(sync_dir);
    if !path.exists() {
        return Ok(SyncShares::default());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("shares read: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("shares parse: {e}"))
}

fn save_shares(sync_dir: &Path, shares: &SyncShares) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(shares).map_err(|e| format!("shares encode: {e}"))?;
    atomic_write(&shares_path(sync_dir), &bytes).map_err(|e| format!("shares write: {e}"))
}

/// Merge persisted grants into the live parent ACL map (union, highest role
/// wins) so revocation/rotation survive restarts.
fn merge_grants(state: &mut ServiceState, shares: &SyncShares) {
    for (resource, acl) in &shares.grants {
        let live = state.acl_mut(resource);
        for g in &acl.grants {
            match live.role_of(&g.account_id) {
                Some(have) if have >= g.role => {}
                _ => live.grant(&g.account_id, g.role),
            }
        }
    }
}

/// ACL resource for a vault id.
pub fn vault_resource(vault_id: &str) -> String {
    format!("vault:{vault_id}")
}

// ---------------------------------------------------------------------------
// Auth helpers (parent `AccountStore`, exact names).
// ---------------------------------------------------------------------------

fn account_of(state: &ServiceState, auth: Option<&str>) -> Result<String, HttpResponse> {
    // Exact parent hook: `ServiceState::bearer`, one status mapping for both.
    state.bearer(auth)
}

fn unclaimed_vault(
    state: &ServiceState,
    resource: &str,
    shares: &SyncShares,
) -> Result<bool, HttpResponse> {
    let Some(vault_id) = resource.strip_prefix("vault:") else {
        return Ok(false);
    };
    if shares.keys.contains_key(vault_id) {
        return Ok(false);
    }
    let folded =
        versions::load(&sync_dir(&state.data_dir)).map_err(|e| HttpResponse::err(500, &e))?;
    Ok(!folded
        .versions
        .values()
        .flatten()
        .any(|v| v.vault_id == vault_id))
}

fn check_role(
    state: &ServiceState,
    resource: &str,
    account_id: &str,
    need: Role,
) -> Result<(), HttpResponse> {
    let shares = load_shares(&sync_dir(&state.data_dir)).map_err(|e| HttpResponse::err(500, &e))?;
    match state
        .acls
        .get(resource)
        .or_else(|| shares.grants.get(resource))
    {
        Some(acl) => acl::check(acl, account_id, need).map_err(|e| HttpResponse::err(403, &e)),
        None if unclaimed_vault(state, resource, &shares)? => Ok(()),
        None => Err(HttpResponse::err(
            403,
            "vault has no recoverable owner grant",
        )),
    }
}

/// Persist the first owner grant before accepting any vault content. A
/// restarted service must never mistake an existing key or version chain for
/// an unclaimed vault and let the next authenticated writer take ownership.
fn authorize(
    state: &mut ServiceState,
    resource: &str,
    account: &str,
    need: Role,
) -> Result<(), HttpResponse> {
    let dir = sync_dir(&state.data_dir);
    let mut shares = load_shares(&dir).map_err(|e| HttpResponse::err(500, &e))?;
    merge_grants(state, &shares);
    if !state.acls.contains_key(resource) {
        if !unclaimed_vault(state, resource, &shares)? {
            return Err(HttpResponse::err(
                403,
                "vault has no recoverable owner grant",
            ));
        }
        let mut grant = ShareAcl::new(resource);
        grant.grant(account, Role::Owner);
        shares.grants.insert(resource.to_string(), grant.clone());
        save_shares(&dir, &shares).map_err(|e| HttpResponse::err(500, &e))?;
        state.acls.insert(resource.to_string(), grant);
        return Ok(());
    }
    let acl = state.acls.get(resource).expect("just ensured");
    acl::check(acl, account, need).map_err(|e| HttpResponse::err(403, &e))
}

/// Step-up MFA for sensitive ops (invite/revoke): when the caller enrolled
/// TOTP, a fresh `code` is required via the exact parent hook
/// `LoginRateLimit::check_totp` (which wraps `mfa::verify_totp` with window,
/// anti-replay and rate limiting). No TOTP enrolled: the session token
/// suffices (MFA was enforced at login in `main.rs`).
fn step_up_mfa(
    state: &mut ServiceState,
    account_id: &str,
    code: Option<&str>,
) -> Result<(), HttpResponse> {
    // Split dei borrow: il record TOTP è clonato dentro uno scope, così
    // `check_totp` (che prende `&mut logins` + `&mut record` locale) non
    // compete con `state.totps` sullo stesso `&mut state`.
    let mut record = match state.totps.get(account_id) {
        None => return Ok(()),
        Some(record) => record.clone(),
    };
    let code = code
        .filter(|c| !c.trim().is_empty())
        .ok_or_else(|| HttpResponse::err(401, "mfa required"))?;
    let key = format!("sync-stepup:{account_id}");
    match state.logins.check_totp(&mut record, &key, code) {
        Ok(true) => {
            state.totps.insert(account_id.to_string(), record);
            Ok(())
        }
        Ok(false) => Err(HttpResponse::err(401, "bad totp")),
        Err(e) => Err(HttpResponse::err(429, &e)),
    }
}

fn check_wire_protocol(peer: &Option<String>) -> Result<(), HttpResponse> {
    if let Some(p) = peer {
        crate::routing::assert_protocol(p, SYNC_PROTOCOL)
            .map_err(|_| HttpResponse::err(400, "protocol mismatch"))?;
    }
    Ok(())
}

/// Canonical envelope check (Main): recompute `canonical_aad_json` from the
/// op FIELDS and compare structurally with the wire `aad` echo when present.
/// The wire `aad` is NEVER trusted: an op whose echo is the old 4-field pipe
/// form, or whose recomputed canonical form the client cannot reproduce, is a
/// hard 400. Missing `vault_id`/empty vv/rename mismatch are hard rejects.
/// The server is opaque to keys so it cannot `aad_verify`-decrypt; the client
/// MUST `aad_verify` before any apply (see `remote::aad_verify`).
fn check_op_aad(op: &SyncOp) -> Result<crate::crypto::SyncEnvelope, String> {
    if op.op_id.trim().is_empty()
        || op.replica_id.trim().is_empty()
        || op.doc_id.trim().is_empty()
        || op.vault_id.trim().is_empty()
    {
        return Err("bad op identity".to_string());
    }
    if op.vv.is_empty() {
        return Err("empty version vector".to_string());
    }
    if op.nonce_b64.trim().is_empty() || op.ciphertext_b64.trim().is_empty() {
        return Err("empty envelope".to_string());
    }
    // Ciphertext size bound (decode length, not base64 length).
    if op.ciphertext_b64.len() > (versions::MAX_OP_BYTES * 4) / 3 + 64 {
        return Err("op too large".to_string());
    }
    // Rename routing coherence: kind==rename iff both ends present AND equal
    // to the kind payload; non-rename ops must carry no rename ends.
    match &op.kind {
        OpKind::Rename { from, to } => {
            if from.trim().is_empty() || to.trim().is_empty() {
                return Err("bad rename routing".to_string());
            }
            if op.rename_from.as_deref() != Some(from.as_str())
                || op.rename_to.as_deref() != Some(to.as_str())
            {
                return Err("rename routing mismatch".to_string());
            }
            if op.doc_id != *from {
                return Err("rename doc_id must equal rename from".to_string());
            }
        }
        _ => {
            if op.rename_from.is_some() || op.rename_to.is_some() {
                return Err("rename routing mismatch".to_string());
            }
        }
    }
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
    // Structural recompute: the canonical JSON must round-trip through the
    // envelope shape (non-empty, rename-coherent). The wire `aad` echo, when
    // present, must equal the recomputed canonical form byte-for-byte;
    // absent echo is fine (recomputed anyway). Old pipe form never equals
    // canonical JSON, so downgrade attempts fail closed here.
    let canonical = crate::crypto::canonical_aad_json(&envelope);
    if canonical.is_empty() {
        return Err("bad envelope".to_string());
    }
    if !op.aad.trim().is_empty() && op.aad != canonical {
        return Err("aad mismatch: wire aad is not canonical".to_string());
    }
    Ok(envelope)
}

// ---------------------------------------------------------------------------
// Fold: one validated op into SyncState. Returns an optional conflict.
// ---------------------------------------------------------------------------

enum FoldOutcome {
    Applied(Option<ConflictInfo>),
    Held(ConflictInfo),
}

fn fold_op(state: &mut SyncState, op: &SyncOp, now_ms: u64, lww_count: &mut usize) -> FoldOutcome {
    let known_epoch = state.vault_epochs.get(&op.vault_id).copied().unwrap_or(0);
    if op.key_epoch < known_epoch {
        return FoldOutcome::Held(ConflictInfo {
            doc_id: op.doc_id.clone(),
            reason: format!(
                "stale key epoch {} < {} for vault {}: hold, rotate explicitly",
                op.key_epoch, known_epoch, op.vault_id
            ),
            replicas: vec![op.replica_id.clone()],
        });
    }
    if !is_syncable_doc(&op.doc_id) {
        return FoldOutcome::Held(ConflictInfo {
            doc_id: op.doc_id.clone(),
            reason: "device-only category never leaves device".to_string(),
            replicas: vec![op.replica_id.clone()],
        });
    }
    let indexed = match &op.kind {
        OpKind::Rename { to, .. } => to,
        _ => &op.doc_id,
    };
    if latest_any(state, indexed).is_some_and(|version| version.version == u64::MAX) {
        return FoldOutcome::Held(ConflictInfo {
            doc_id: indexed.to_string(),
            reason: "version chain exhausted; requires explicit recovery".into(),
            replicas: vec![op.replica_id.clone()],
        });
    }
    if let OpKind::Rename { from, to } = &op.kind {
        if !is_syncable_doc(from) || !is_syncable_doc(to) {
            return FoldOutcome::Held(ConflictInfo {
                doc_id: op.doc_id.clone(),
                reason: "device-only category never leaves device".to_string(),
                replicas: vec![op.replica_id.clone()],
            });
        }
        if let Some(tomb) = state.tombstones.get(from) {
            if !can_resurrect(tomb, &op.vv) {
                return FoldOutcome::Held(ConflictInfo {
                    doc_id: from.clone(),
                    reason: "rename buried under tombstone".to_string(),
                    replicas: vec![op.replica_id.clone(), tomb.replica_id.clone()],
                });
            }
        }
        for endpoint in [from, to] {
            if let Some(latest) = latest_any(state, endpoint) {
                if vv_compare(&op.vv, &parse_vv_text(&latest.vv_text)) == VvOrder::Concurrent {
                    return FoldOutcome::Held(ConflictInfo {
                        doc_id: endpoint.clone(),
                        reason: "concurrent rename/edit: preserve both versions before retry"
                            .to_string(),
                        replicas: vec![op.replica_id.clone(), latest.replica_id.clone()],
                    });
                }
            }
        }
        state.tombstones.insert(
            from.clone(),
            Tombstone {
                doc_id: from.clone(),
                vv: op.vv.clone(),
                ts_ms: now_ms,
                replica_id: op.replica_id.clone(),
            },
        );
        move_to_trash(state, from, op.vv.clone(), &op.replica_id, now_ms);
        state.vault_epochs.insert(op.vault_id.clone(), op.key_epoch);
        push_version(state, op, to);
        state.server_vv = vv_merge(&state.server_vv, &op.vv);
        return FoldOutcome::Applied(None);
    }
    if op.kind.is_delete() {
        let mut concurrent = None;
        if let Some(latest) = latest_any(state, &op.doc_id) {
            match vv_compare(&op.vv, &parse_vv_text(&latest.vv_text)) {
                VvOrder::Dominated | VvOrder::Equal => return FoldOutcome::Applied(None),
                VvOrder::Concurrent if !latest.deleted => {
                    concurrent = Some(latest.replica_id.clone())
                }
                _ => {}
            }
        }
        state.tombstones.insert(
            op.doc_id.clone(),
            Tombstone {
                doc_id: op.doc_id.clone(),
                vv: op.vv.clone(),
                ts_ms: now_ms,
                replica_id: op.replica_id.clone(),
            },
        );
        move_to_trash(state, &op.doc_id, op.vv.clone(), &op.replica_id, now_ms);
        state.vault_epochs.insert(op.vault_id.clone(), op.key_epoch);
        push_version(state, op, &op.doc_id);
        state.server_vv = vv_merge(&state.server_vv, &op.vv);
        if let Some(other) = concurrent {
            let info = ConflictInfo {
                doc_id: op.doc_id.clone(),
                reason: "concurrent edit/delete: edit retained in encrypted version chain".into(),
                replicas: vec![op.replica_id.clone(), other],
            };
            state.conflicts.push(SyncConflict {
                doc_id: info.doc_id.clone(),
                reason: info.reason.clone(),
                replicas: info.replicas.clone(),
                ts_ms: now_ms,
            });
            return FoldOutcome::Applied(Some(info));
        }
        return FoldOutcome::Applied(None);
    }
    if let Some(tomb) = state.tombstones.get(&op.doc_id) {
        if !can_resurrect(tomb, &op.vv) {
            return FoldOutcome::Held(ConflictInfo {
                doc_id: op.doc_id.clone(),
                reason: format!(
                    "write buried under tombstone by {}: needs a newer counter",
                    tomb.replica_id
                ),
                replicas: vec![op.replica_id.clone(), tomb.replica_id.clone()],
            });
        }
    }
    let latest_snap: Option<(VersionVector, String)> = latest_any(state, &op.doc_id)
        .map(|latest| (parse_vv_text(&latest.vv_text), latest.replica_id.clone()));
    if let Some((latest_vv, latest_replica)) = latest_snap {
        match vv_compare(&op.vv, &latest_vv) {
            VvOrder::Equal | VvOrder::Dominated => return FoldOutcome::Applied(None),
            VvOrder::Dominates => {}
            VvOrder::Concurrent => {
                let kind = doc_kind_for(&op.doc_id);
                state.tombstones.remove(&op.doc_id);
                state.vault_epochs.insert(op.vault_id.clone(), op.key_epoch);
                push_version(state, op, &op.doc_id);
                state.server_vv = vv_merge(&state.server_vv, &op.vv);
                if needs_conflict_copy(kind) {
                    let conflict = SyncConflict {
                        doc_id: op.doc_id.clone(),
                        reason: conflict_reason(kind, &op.replica_id, &latest_replica),
                        replicas: vec![op.replica_id.clone(), latest_replica],
                        ts_ms: now_ms,
                    };
                    let info = ConflictInfo {
                        doc_id: conflict.doc_id.clone(),
                        reason: conflict.reason.clone(),
                        replicas: conflict.replicas.clone(),
                    };
                    state.conflicts.push(conflict);
                    return FoldOutcome::Applied(Some(info));
                }
                *lww_count += 1;
                return FoldOutcome::Applied(None);
            }
        }
    }
    state.tombstones.remove(&op.doc_id);
    state.vault_epochs.insert(op.vault_id.clone(), op.key_epoch);
    push_version(state, op, &op.doc_id);
    state.server_vv = vv_merge(&state.server_vv, &op.vv);
    FoldOutcome::Applied(None)
}

// ---------------------------------------------------------------------------
// HTTP dispatch. The shared route table owns method/path matching; this
// entry point maps its sync variants to their implemented handlers.
// ---------------------------------------------------------------------------

/// Entry point for the parent router: full path (`/v1/sync/push`, ...),
/// `auth` is the raw `Authorization` header value (or None).
pub fn handle(
    state: &mut ServiceState,
    method: &str,
    path: &str,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let (_, query) = split_query(path);
    match crate::routing::route(method, path) {
        crate::routing::Route::SyncPush => handle_push(state, auth, body),
        crate::routing::Route::SyncPull => handle_pull(state, auth, body),
        crate::routing::Route::SyncAck => handle_ack(state, auth, body),
        crate::routing::Route::SyncStatus => handle_status(state, auth, &query),
        crate::routing::Route::SyncVersions => handle_versions(state, auth, &query),
        crate::routing::Route::SyncTrash => handle_trash(state, auth, body),
        crate::routing::Route::SyncRestore => handle_restore(state, auth, body),
        crate::routing::Route::SyncInvite => handle_invite(state, auth, body),
        crate::routing::Route::SyncInviteAccept => handle_invite_accept(state, auth, body),
        crate::routing::Route::SyncRevoke => handle_revoke(state, auth, body),
        crate::routing::Route::SyncVaultKeyStore => handle_vault_key_store(state, auth, body),
        crate::routing::Route::SyncVaultKeyGet => handle_vault_key_get(state, auth, &query),
        _ => HttpResponse::err(404, "unknown sync route"),
    }
}

fn split_query(path: &str) -> (&str, Vec<(String, String)>) {
    match path.find('?') {
        None => (path, Vec::new()),
        Some(i) => {
            let mut out = Vec::new();
            for pair in path[i + 1..].split('&') {
                if pair.is_empty() {
                    continue;
                }
                match pair.find('=') {
                    Some(j) => out.push((pair[..j].to_string(), pair[j + 1..].to_string())),
                    None => out.push((pair.to_string(), String::new())),
                }
            }
            (&path[..i], out)
        }
    }
}

fn query_get<'a>(query: &'a [(String, String)], key: &str) -> Option<&'a str> {
    query
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

fn valid_replica_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Query values are URL-encoded by clients. A malformed escape is an error,
/// never a literal document id that accidentally addresses another record.
fn decode_query_value(raw: &str) -> Option<String> {
    fn hex(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }
    let bytes = raw.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                decoded.push((hex(*bytes.get(i + 1)?)? << 4) | hex(*bytes.get(i + 2)?)?);
                i += 3;
            }
            b'+' => {
                decoded.push(b' ');
                i += 1;
            }
            b => {
                decoded.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(decoded).ok()
}

fn sync_dir_of(state: &ServiceState) -> std::path::PathBuf {
    let dir = sync_dir(&state.data_dir);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn load_folded(dir: &Path) -> Result<SyncState, HttpResponse> {
    versions::load(dir).map_err(|e| HttpResponse::err(500, &e))
}

fn cap_seen(state: &mut SyncState) {
    if state.seen_op_ids.len() <= MAX_SEEN_OP_IDS {
        return;
    }
    // Version chains are also a durable dedup index for their own op IDs.
    // Keep the separate fast-path set bounded even across >200k live docs.
    let live: BTreeSet<String> = state
        .versions
        .values()
        .flat_map(|chain| chain.iter().map(|v| v.op_id.clone()))
        .collect();
    state.seen_op_ids = state
        .seen_op_ids
        .intersection(&live)
        .take(MAX_SEEN_OP_IDS)
        .cloned()
        .collect();
}

fn already_folded(state: &SyncState, op: &SyncOp) -> bool {
    let doc = match &op.kind {
        OpKind::Rename { to, .. } => to,
        _ => &op.doc_id,
    };
    is_duplicate(&state.seen_op_ids, &op.op_id)
        || state
            .versions
            .get(doc)
            .is_some_and(|chain| chain.iter().any(|version| version.op_id == op.op_id))
}

fn handle_push(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let req: PushRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad push body"),
    };
    if !valid_replica_id(&req.replica_id) {
        return HttpResponse::err(400, "invalid replica_id");
    }
    if let Err(r) = check_wire_protocol(&req.protocol) {
        return r;
    }
    if req.ops.len() > PUSH_MAX_OPS {
        return HttpResponse::err(413, "push too large");
    }
    // Vault scope for ACL: per-op `vault_id` (canonical envelope). Mixed-vault
    // batches are rejected hard: one push = one vault.
    let mut vault_ids = std::collections::BTreeSet::new();
    for op in &req.ops {
        if !op.vault_id.trim().is_empty() {
            vault_ids.insert(op.vault_id.clone());
        }
    }
    if vault_ids.len() > 1 {
        return HttpResponse::err(400, "mixed vault batch");
    }
    let vault_id = vault_ids
        .into_iter()
        .next()
        .unwrap_or_else(|| "default".to_string());
    let resource = vault_resource(&vault_id);
    if let Err(r) = authorize(state, &resource, &account, Role::Writer) {
        return r;
    }
    let dir = sync_dir_of(state);
    let now = schema::now_ms();
    let mut folded = match load_folded(&dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    let shares = match load_shares(&dir) {
        Ok(shares) => shares,
        Err(e) => return HttpResponse::err(500, &e),
    };
    for op in &req.ops {
        if shares.keys.contains_key(&op.vault_id)
            && shares.key_epochs.get(&op.vault_id).copied().unwrap_or(0) != op.key_epoch
        {
            return HttpResponse::json(
                409,
                &serde_json::json!({"error": "key epoch does not match owner-authorized vault key"}),
            );
        }
        if op.replica_id != req.replica_id {
            return HttpResponse::err(400, "replica identity mismatch");
        }
    }
    for (vault, epoch) in &shares.key_epochs {
        folded.vault_epochs.insert(vault.clone(), *epoch);
    }
    // Crash recovery: replay WAL entries never folded (bounded; ops already
    // seen are skipped by dedup below). Queue corruption surfaces as
    // RecoveryNeeded (500 + explicit code), never skip-and-current.
    let mut lww_count: usize = 0;
    match queue::load_ops(&dir, &req.replica_id) {
        Err(queue::QueueError::RecoveryNeeded {
            quarantined,
            preserved,
        }) => {
            return HttpResponse::json(
                500,
                &serde_json::json!({
                    "error": "recovery needed",
                    "quarantined": quarantined,
                    "preserved": preserved,
                }),
            );
        }
        Err(queue::QueueError::Io(e)) => return HttpResponse::err(500, &e),
        Err(queue::QueueError::QueueFull { .. }) => {
            return HttpResponse::err(500, "sync WAL recovery needs intervention");
        }
        Ok(wal) => {
            for op in wal {
                if already_folded(&folded, &op) {
                    continue;
                }
                if let Err(e) = check_op_aad(&op) {
                    return HttpResponse::err(
                        500,
                        &format!("sync WAL recovery needs intervention: {e}"),
                    );
                }
                if !is_syncable_doc(&op.doc_id) {
                    return HttpResponse::err(500, "sync WAL recovery needs intervention");
                }
                match fold_op(&mut folded, &op, now, &mut lww_count) {
                    FoldOutcome::Applied(_) => {
                        folded.seen_op_ids.insert(op.op_id.clone());
                    }
                    FoldOutcome::Held(info) => {
                        return HttpResponse::json(
                            409,
                            &serde_json::json!({
                                "error": "sync WAL contains held operation",
                                "op_id": op.op_id,
                                "conflict": info,
                            }),
                        );
                    }
                }
            }
        }
    }
    // Durable WAL first (fsync per batch), then fold, then save index.
    let mut ack = Vec::with_capacity(req.ops.len());
    let mut conflicts = Vec::new();
    let mut fresh: Vec<SyncOp> = Vec::new();
    for op in &req.ops {
        if already_folded(&folded, op) {
            ack.push(op.op_id.clone()); // duplicate delivery: ack, skip.
            continue;
        }
        if let Err(e) = check_op_aad(op) {
            conflicts.push(ConflictInfo {
                doc_id: op.doc_id.clone(),
                reason: e,
                replicas: vec![op.replica_id.clone()],
            });
            continue;
        }
        fresh.push(op.clone());
    }
    // Simulate the fold BEFORE writing the WAL. Held operations have no
    // durable queue entry to poison crash recovery. The WAL contains exactly
    // the accepted operations and is fsynced before the folded index.
    let mut accepted = Vec::new();
    for op in &fresh {
        if already_folded(&folded, op) {
            ack.push(op.op_id.clone());
            continue;
        }
        match fold_op(&mut folded, op, now, &mut lww_count) {
            FoldOutcome::Applied(info) => {
                if let Some(info) = info {
                    conflicts.push(info);
                }
                folded.seen_op_ids.insert(op.op_id.clone());
                ack.push(op.op_id.clone());
                let indexed = match &op.kind {
                    OpKind::Rename { to, .. } => to,
                    _ => &op.doc_id,
                };
                if folded
                    .versions
                    .get(indexed)
                    .and_then(|chain| chain.last())
                    .is_some_and(|version| version.op_id == op.op_id)
                {
                    accepted.push(op);
                }
            }
            FoldOutcome::Held(info) => conflicts.push(info),
        }
    }
    if !accepted.is_empty() {
        let lines: Vec<String> = match accepted
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(lines) => lines,
            Err(_) => return HttpResponse::err(500, "sync operation encode failed"),
        };
        let batch_bytes = lines
            .iter()
            .fold(0u64, |sum, line| sum.saturating_add(line.len() as u64 + 1));
        let stored_bytes = folded
            .attachments
            .values()
            .copied()
            .fold(0u64, u64::saturating_add)
            .saturating_add(queue::queue_bytes(&dir, &req.replica_id));
        if state.config.quotas.max_vault_bytes > 0
            && stored_bytes.saturating_add(batch_bytes) > state.config.quotas.max_vault_bytes
        {
            return HttpResponse::err(413, "vault quota exceeded");
        }
        if let Err(e) = queue::append_lines(&dir, &req.replica_id, &lines) {
            match e {
                queue::QueueError::QueueFull { pending } => {
                    return HttpResponse::json(
                        507,
                        &serde_json::json!({
                            "error": "queue full", "pending": pending,
                            "resync": "drain via pull+ack before pushing",
                        }),
                    );
                }
                queue::QueueError::RecoveryNeeded {
                    quarantined,
                    preserved,
                } => {
                    return HttpResponse::json(
                        500,
                        &serde_json::json!({
                            "error": "recovery needed", "quarantined": quarantined,
                            "preserved": preserved,
                        }),
                    );
                }
                queue::QueueError::Io(msg) => return HttpResponse::err(500, &msg),
            }
        }
    }
    // Structured allowlist log: method + path-base + status only. The event
    // itself is the signal (a push folded); doc_id/replica are vault
    // identifiers and never loggable per the allowlist policy.
    if lww_count > 0 {
        eprintln!("{}", crate::server::log_line("POST", "/v1/sync/push", 200));
    }
    cap_seen(&mut folded);
    versions::prune_retention(&mut folded, now, state.config.quotas.retention_days);
    if let Err(e) = versions::save(&dir, &folded) {
        return HttpResponse::err(500, &e);
    }
    // Backpressure, never silent drop: a full authority queue reports
    // QueueFull so the caller resyncs explicitly instead of reading current.
    match queue::enforce_cap(&dir, &req.replica_id, &state.config.quotas, now) {
        Err(queue::QueueError::QueueFull { pending }) => {
            return HttpResponse::json(
                507,
                &serde_json::json!({
                    "error": "queue full",
                    "pending": pending,
                    "resync": "drain via pull+ack before pushing",
                }),
            );
        }
        Err(queue::QueueError::RecoveryNeeded {
            quarantined,
            preserved,
        }) => {
            return HttpResponse::json(
                500,
                &serde_json::json!({
                    "error": "recovery needed",
                    "quarantined": quarantined,
                    "preserved": preserved,
                }),
            );
        }
        Err(queue::QueueError::Io(e)) => return HttpResponse::err(500, &e),
        Ok(_) => {}
    }
    HttpResponse::json(
        200,
        &PushResponse {
            ack,
            conflicts,
            server_vv: folded.server_vv,
        },
    )
}

fn op_from_version(v: &DocVersion) -> Result<SyncOp, String> {
    // A version is indexed by its destination on rename, but its original
    // source doc_id is authenticated. Never substitute the index key in AAD.
    let (doc_id, rename_from, rename_to) = v.kind.routing(&v.doc_id);
    if v.deleted != matches!(v.kind, OpKind::Delete | OpKind::Tombstone)
        || (v.kind.is_rename() && rename_to.as_deref() != Some(v.doc_id.as_str()))
        || v.vault_id.trim().is_empty()
    {
        return Err("sync state contains inconsistent authenticated op metadata".to_string());
    }
    let vv = parse_vv_text(&v.vv_text);
    if vv.is_empty() || causality::vv_text(&vv) != v.vv_text {
        return Err("sync state contains invalid authenticated version vector".to_string());
    }
    let mut op = SyncOp {
        op_id: v.op_id.clone(),
        replica_id: v.replica_id.clone(),
        doc_id,
        kind: v.kind.clone(),
        vv,
        ciphertext_b64: v.ciphertext_b64.clone(),
        nonce_b64: v.nonce_b64.clone(),
        aad: String::new(),
        ts_ms: v.ts_ms,
        vault_id: v.vault_id.clone(),
        key_epoch: v.key_epoch,
        rename_from,
        rename_to,
    };
    let envelope = check_op_aad(&op)?;
    op.aad = crate::crypto::canonical_aad_json(&envelope);
    Ok(op)
}

fn handle_pull(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let req: PullRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad pull body"),
    };
    if !valid_replica_id(&req.replica_id) {
        return HttpResponse::err(400, "invalid replica_id");
    }
    if req.vault_id.trim().is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    if let Err(r) = check_wire_protocol(&req.protocol) {
        return r;
    }
    let resource = vault_resource(&req.vault_id);
    if let Err(r) = check_role(state, &resource, &account, Role::Reader) {
        return r;
    }
    let dir = sync_dir_of(state);
    let folded = match load_folded(&dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    let shares = match load_shares(&dir) {
        Ok(shares) => shares,
        Err(e) => return HttpResponse::err(500, &e),
    };
    let active_epoch = shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0);
    let mut snapshot_vv = folded.server_vv.clone();
    if active_epoch > 0 {
        snapshot_vv.insert(
            format!("key-epoch:{}", req.vault_id),
            u64::from(active_epoch),
        );
    }
    let offset = req.offset.unwrap_or(0);
    if offset > 0 && req.snapshot_vv != snapshot_vv {
        return HttpResponse::err(409, "sync pull snapshot changed: restart at offset zero");
    }
    let mut ops: Vec<SyncOp> = Vec::new();
    let mut matched = 0_u64;
    let mut truncated = false;
    let mut page_bytes = 0usize;
    // BTreeMap key + chain order is stable for a fixed server_vv. Sorting a
    // truncated page after cutting it changes order between pages and can
    // make an offset skip or replay writes.
    'chains: for chain in folded.versions.values() {
        for version in chain {
            if version.vault_id != req.vault_id || version.key_epoch < active_epoch {
                continue;
            }
            let vv = parse_vv_text(&version.vv_text);
            if vv.iter().all(|(replica, counter)| {
                replica.starts_with("key-epoch:")
                    || *counter <= req.since_vv.get(replica).copied().unwrap_or(0)
            }) {
                continue;
            }
            if matched < offset {
                matched += 1;
                continue;
            }
            if ops.len() == PULL_MAX_OPS {
                truncated = true;
                break 'chains;
            }
            let op = match op_from_version(version) {
                Ok(op) => op,
                Err(error) => return HttpResponse::err(500, &error),
            };
            let size = match serde_json::to_vec(&op) {
                Ok(encoded) => encoded.len(),
                Err(_) => return HttpResponse::err(500, "sync pull encode failed"),
            };
            if page_bytes.saturating_add(size) > PULL_MAX_BYTES && !ops.is_empty() {
                truncated = true;
                break 'chains;
            }
            page_bytes = page_bytes.saturating_add(size);
            ops.push(op);
            matched += 1;
        }
    }
    if !truncated && offset > matched {
        return HttpResponse::err(400, "sync pull offset past snapshot");
    }
    HttpResponse::json(
        200,
        &PullResponse {
            ops,
            server_vv: snapshot_vv,
            truncated,
            next_offset: truncated.then_some(matched),
        },
    )
}

fn handle_ack(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let req: AckRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad ack body"),
    };
    if !valid_replica_id(&req.replica_id) {
        return HttpResponse::err(400, "invalid replica_id");
    }
    if req.vault_id.trim().is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let resource = vault_resource(&req.vault_id);
    if let Err(r) = check_role(state, &resource, &account, Role::Reader) {
        return r;
    }
    let dir = sync_dir_of(state);
    match queue::ack_ops(&dir, &req.replica_id, &req.ack) {
        Err(queue::QueueError::RecoveryNeeded {
            quarantined,
            preserved,
        }) => HttpResponse::json(
            500,
            &serde_json::json!({
                "error": "recovery needed",
                "quarantined": quarantined,
                "preserved": preserved,
            }),
        ),
        Err(queue::QueueError::QueueFull { pending }) => HttpResponse::json(
            507,
            &serde_json::json!({ "error": "queue full", "pending": pending }),
        ),
        Err(queue::QueueError::Io(e)) => HttpResponse::err(500, &e),
        Ok(removed) => HttpResponse::json(
            200,
            &AckResponse {
                acked: req.ack,
                removed,
            },
        ),
    }
}

fn handle_status(
    state: &mut ServiceState,
    auth: Option<&str>,
    query: &[(String, String)],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let vault_id = query_get(query, "vault_id").unwrap_or("");
    if vault_id.is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let resource = vault_resource(vault_id);
    if let Err(r) = check_role(state, &resource, &account, Role::Reader) {
        return r;
    }
    let replica_id = query_get(query, "replica_id").unwrap_or("").to_string();
    if !valid_replica_id(&replica_id) {
        return HttpResponse::err(400, "invalid replica_id");
    }
    let dir = sync_dir_of(state);
    let folded = match load_folded(&dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    // Aggregate vectors, trash and tombstones are not vault-partitioned.
    // Never expose them under an ACL for only one of several vaults.
    if folded
        .versions
        .values()
        .flatten()
        .any(|v| v.vault_id != vault_id)
    {
        return HttpResponse::err(409, "sync status requires vault-partitioned state");
    }
    let pending = match queue::load_ops(&dir, &replica_id) {
        Ok(ops) => ops.len(),
        Err(_) => return HttpResponse::err(500, "sync queue recovery needed"),
    };
    // This is the authoritative server-side view. The host overlays its
    // durable local cursor/outbox, rather than inventing server file states.
    let mut entries = Vec::new();
    let mut recent: BTreeMap<(u64, String), serde_json::Value> = BTreeMap::new();
    for (doc_id, chain) in &folded.versions {
        if let Some(latest) = chain.last() {
            let vv = parse_vv_text(&latest.vv_text);
            let conflicted = folded.conflicts.iter().any(|c| c.doc_id == *doc_id);
            entries.push(serde_json::json!({
                "doc_id": doc_id,
                "state": if conflicted { "conflict" } else if latest.deleted { "deleted" } else { "synced" },
                "local_counter": "0",
                "server_counter": vv.get(&replica_id).copied().unwrap_or(0).to_string(),
                "detail": if conflicted { Some("concurrent versions preserved") } else { None },
            }));
        }
        for version in chain {
            recent.insert(
                (version.ts_ms, version.op_id.clone()),
                serde_json::json!({
                    "doc_id": doc_id, "kind": version.kind.as_str(), "ts_ms": version.ts_ms,
                }),
            );
            if recent.len() > 50 {
                recent.pop_first();
            }
        }
    }
    let truncated = entries.len() > 5_000;
    entries.truncate(5_000);
    let log: Vec<_> = recent.into_values().rev().collect();
    HttpResponse::json(
        200,
        &serde_json::json!({
            "replica_id": replica_id,
            "server_vv": folded.server_vv.iter().map(|(id, count)| (id.clone(), count.to_string())).collect::<BTreeMap<_, _>>(),
            "docs": folded.versions.len(), "pending": pending,
            "conflicts": folded.conflicts.len(), "tombstones": folded.tombstones.len(),
            "trash": folded.trash.len(), "entries": entries, "log": log,
            "entries_truncated": truncated,
        }),
    )
}

/// Version chain per doc for the UI (`syncVersionRow` serde names exactly:
/// `doc_id, version, hash, ts_ms, vv_text`).
fn handle_versions(
    state: &mut ServiceState,
    auth: Option<&str>,
    query: &[(String, String)],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let vault_id = query_get(query, "vault_id").unwrap_or("");
    if vault_id.is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let resource = vault_resource(vault_id);
    if let Err(r) = check_role(state, &resource, &account, Role::Reader) {
        return r;
    }
    let Some(doc_id) = query_get(query, "doc_id").filter(|id| !id.is_empty()) else {
        return HttpResponse::err(400, "missing doc_id");
    };
    let Some(doc_id) = decode_query_value(doc_id) else {
        return HttpResponse::err(400, "bad encoded doc_id");
    };
    if doc_id.is_empty() {
        return HttpResponse::err(400, "missing doc_id");
    }
    let dir = sync_dir_of(state);
    let folded = match load_folded(&dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    if folded.versions.get(&doc_id).is_some_and(|chain| {
        chain.iter().any(|v| v.vault_id == vault_id) && chain.iter().any(|v| v.vault_id != vault_id)
    }) {
        return HttpResponse::err(409, "versions require a single-vault document chain");
    }
    let versions: Vec<serde_json::Value> = folded
        .versions
        .get(&doc_id)
        .map(|chain| {
            chain
                .iter()
                .filter(|v| v.vault_id == vault_id)
                .map(|v| {
                    serde_json::json!({
                        "doc_id": v.doc_id,
                        "op_id": v.op_id,
                        "version": v.version.to_string(),
                        "hash": v.hash,
                        "ts_ms": v.ts_ms,
                        "vv_text": v.vv_text,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    HttpResponse::json(
        200,
        &serde_json::json!({
            "doc_id": doc_id,
            "versions": versions,
            "in_trash": folded.trash.contains_key(&doc_id)
                && folded.versions.get(&doc_id).is_some_and(|chain|
                    !chain.is_empty() && chain.iter().all(|v| v.vault_id == vault_id)),
        }),
    )
}

fn handle_trash(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct TrashReq {
        doc_id: String,
        vault_id: String,
    }
    let req: TrashReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad trash body"),
    };
    if req.vault_id.trim().is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let resource = vault_resource(&req.vault_id);
    if let Err(r) = authorize(state, &resource, &account, Role::Writer) {
        return r;
    }
    let dir = sync_dir_of(state);
    let mut folded = match load_folded(&dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    // Trash is still keyed only by doc_id. Reject absent or mixed-vault
    // chains rather than changing another vault's marker.
    if !folded
        .versions
        .get(&req.doc_id)
        .is_some_and(|chain| !chain.is_empty() && chain.iter().all(|v| v.vault_id == req.vault_id))
    {
        return HttpResponse::err(409, "trash requires a single-vault version chain");
    }
    let now = schema::now_ms();
    // Trash without content: snapshot the current server vector so a later
    // restore is still a new write, never an old vector replayed.
    let mut vv = folded.server_vv.clone();
    vv_inc(&mut vv, "server");
    move_to_trash(&mut folded, &req.doc_id, vv, &account, now);
    if let Err(e) = versions::save(&dir, &folded) {
        return HttpResponse::err(500, &e);
    }
    HttpResponse::json(200, &serde_json::json!({ "trashed": req.doc_id }))
}

fn handle_restore(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct RestoreReq {
        doc_id: String,
        vault_id: String,
        #[serde(default)]
        version: Option<String>,
    }
    let req: RestoreReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad restore body"),
    };
    if req.vault_id.trim().is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let requested_version = match req.version.as_deref() {
        Some(raw) => match raw.parse::<u64>() {
            Ok(version) if version > 0 && raw == version.to_string() => Some(version),
            _ => return HttpResponse::err(400, "bad restore version"),
        },
        None => None,
    };
    let resource = vault_resource(&req.vault_id);
    if let Err(r) = authorize(state, &resource, &account, Role::Writer) {
        return r;
    }
    let dir = sync_dir_of(state);
    let mut folded = match load_folded(&dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    if !folded
        .versions
        .get(&req.doc_id)
        .is_some_and(|chain| !chain.is_empty() && chain.iter().all(|v| v.vault_id == req.vault_id))
    {
        return HttpResponse::err(409, "restore requires a single-vault version chain");
    }
    if let Some(version) = requested_version {
        let Some(source) = folded.versions.get(&req.doc_id).and_then(|chain| {
            chain
                .iter()
                .find(|entry| entry.version == version && !entry.deleted)
        }) else {
            return HttpResponse::err(404, "restore source version expired");
        };
        let op = match op_from_version(source) {
            Ok(op) => op,
            Err(e) => return HttpResponse::err(500, &e),
        };
        // No server mutation: the caller decrypts and CAS-writes locally,
        // then publishes a fresh encrypted op with a new vector.
        return HttpResponse::json(
            200,
            &serde_json::json!({
                "restored": req.doc_id, "version": version.to_string(),
                "source_op": op, "requires_fresh_push": true,
            }),
        );
    }
    let Some(trash) = folded.trash.get(&req.doc_id) else {
        return HttpResponse::err(404, "not in trash");
    };
    let Some(source) = trash.last_version.and_then(|version| {
        folded
            .versions
            .get(&req.doc_id)?
            .iter()
            .find(|v| v.version == version && !v.deleted)
    }) else {
        return HttpResponse::err(409, "restore source version expired; trash left intact");
    };
    let source_op_id = source.op_id.clone();
    match restore_from_trash(&mut folded, &req.doc_id) {
        Err(e) => HttpResponse::err(404, &e),
        Ok(version) => {
            // A replica is not a backup: restore only drops the trash marker.
            // The client must push a FRESH op with a bumped counter carrying
            // the restored bytes; the old vector is never replayed.
            if let Err(e) = versions::save(&dir, &folded) {
                return HttpResponse::err(500, &e);
            }
            HttpResponse::json(
                200,
                &serde_json::json!({
                    "restored": req.doc_id,
                    "last_version": version.map(|n| n.to_string()),
                    "source_op_id": source_op_id,
                    "requires_fresh_push": true,
                }),
            )
        }
    }
}

fn handle_invite(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct InviteReq {
        #[serde(default)]
        vault_id: Option<String>,
        #[serde(default)]
        resource: Option<String>,
        role: Role,
        #[serde(default)]
        ttl_ms: Option<u64>,
        #[serde(default)]
        code: Option<String>,
        #[serde(default)]
        wrapped_vdk: Option<crate::crypto::WrappedVdk>,
    }
    let req: InviteReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad invite body"),
    };
    if let Role::Owner = req.role {
        // Ownership transfers out-of-band, never by self-serve invite.
        return HttpResponse::err(403, "cannot invite owner");
    }
    let resource = req
        .resource
        .unwrap_or_else(|| vault_resource(req.vault_id.as_deref().unwrap_or("default")));
    if let Err(r) = authorize(state, &resource, &account, Role::Admin) {
        return r;
    }
    if let Err(r) = step_up_mfa(state, &account, req.code.as_deref()) {
        return r;
    }
    // Validate an attached wrapped-VDK envelope structurally (opaque to the
    // server: current KDF version, well-formed base64, 12 B nonce). The
    // envelope is produced client-side with `crypto::wrap_vdk` from the
    // explicit vault passphrase — never the account password.
    if let Some(w) = &req.wrapped_vdk {
        if w.kdf.ver != crate::crypto::KDF_VERSION {
            return HttpResponse::err(400, "stale wrap version");
        }
        if crate::crypto::unwrap_vdk_shape_ok(w).is_err() {
            return HttpResponse::err(400, "bad wrapped vdk");
        }
    }
    let dir = sync_dir_of(state);
    let mut shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    merge_grants(state, &shares);
    let vault = resource.strip_prefix("vault:").unwrap_or("");
    let key_epoch = shares.key_epochs.get(vault).copied().unwrap_or(0);
    let ttl = req.ttl_ms.unwrap_or(7 * 24 * 3600 * 1000);
    let invite = match acl::new_invite(&resource, req.role, ttl) {
        Ok(i) => i,
        Err(e) => return HttpResponse::err(500, &e),
    };
    let reply = serde_json::json!({
        "token_b64": invite.token_b64,
        "resource": invite.resource,
        "role": invite.role,
        "expires_ms": invite.expires_ms,
    });
    shares.invites.push(StoredInvite {
        invite,
        wrapped_vdk: req.wrapped_vdk,
        key_epoch,
    });
    if let Err(e) = save_shares(&dir, &shares) {
        return HttpResponse::err(500, &e);
    }
    HttpResponse::json(201, &reply)
}

fn handle_invite_accept(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct AcceptReq {
        token_b64: String,
    }
    let req: AcceptReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad accept body"),
    };
    let dir = sync_dir_of(state);
    let mut shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    merge_grants(state, &shares);
    let pos = shares
        .invites
        .iter()
        .position(|s| s.invite.token_b64 == req.token_b64 && !s.invite.accepted);
    let pos = match pos {
        Some(p) => p,
        None => return HttpResponse::err(404, "invite not found"),
    };
    let wrapped = shares.invites[pos].wrapped_vdk.clone();
    let resource = shares.invites[pos].invite.resource.clone();
    let vault = resource.strip_prefix("vault:").unwrap_or("");
    if shares.invites[pos].key_epoch != shares.key_epochs.get(vault).copied().unwrap_or(0) {
        return HttpResponse::err(410, "invite key epoch expired; request a new invite");
    }
    {
        let stored = &mut shares.invites[pos];
        let acl = state.acl_mut(&stored.invite.resource.clone());
        if let Err(e) = acl::accept_invite(&mut stored.invite, acl, &account) {
            return HttpResponse::err(410, &e);
        }
    }
    // Mirror the grant durably so restarts keep it.
    for (resource, live) in &state.acls {
        shares.grants.insert(resource.clone(), live.clone());
    }
    if let Err(e) = save_shares(&dir, &shares) {
        return HttpResponse::err(500, &e);
    }
    HttpResponse::json(
        200,
        &serde_json::json!({
            "resource": shares.invites[pos].invite.resource,
            "role": shares.invites[pos].invite.role,
            // The invitee's wrapped VDK envelope when the inviter attached
            // one; the client unwraps it locally with `crypto::unwrap_vdk`
            // from the out-of-band passphrase. No envelope = the inviter
            // delivers the key by another explicit channel (external).
            "wrapped_vdk": wrapped,
            "key_epoch": shares.invites[pos].key_epoch,
        }),
    )
}

fn handle_revoke(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct RevokeReq {
        #[serde(default)]
        vault_id: Option<String>,
        #[serde(default)]
        resource: Option<String>,
        account_id: String,
        #[serde(default)]
        code: Option<String>,
    }
    let req: RevokeReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad revoke body"),
    };
    let resource = req
        .resource
        .unwrap_or_else(|| vault_resource(req.vault_id.as_deref().unwrap_or("default")));
    if let Err(r) = authorize(state, &resource, &account, Role::Admin) {
        return r;
    }
    if let Err(r) = step_up_mfa(state, &account, req.code.as_deref()) {
        return r;
    }
    let dir = sync_dir_of(state);
    let mut shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    merge_grants(state, &shares);
    state.acl_mut(&resource).revoke(&req.account_id);
    for (res, live) in &state.acls {
        shares.grants.insert(res.clone(), live.clone());
    }
    if let Err(e) = save_shares(&dir, &shares) {
        return HttpResponse::err(500, &e);
    }
    // Revocation removes FUTURE access only: copies the revoked account
    // already downloaded survive. There is no remote wipe, by design.
    HttpResponse::json(
        200,
        &serde_json::json!({
            "revoked": req.account_id,
            "resource": resource,
            "note": "already-downloaded copies survive revocation; no remote wipe",
        }),
    )
}

/// Store the owner's wrapped-VDK envelope (opaque). Rotation = store a new
/// envelope produced client-side with `crypto::wrap_vdk`; the old envelope
/// is dropped, but copies already downloaded under it survive (documented,
/// P16.8).
fn handle_vault_key_store(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct KeyReq {
        vault_id: String,
        wrapped: crate::crypto::WrappedVdk,
        /// Required only to replace an existing envelope: compare-and-swap
        /// prevents a stale writer from silently rotating another key.
        #[serde(default)]
        expected_wrapped_hash: Option<String>,
        #[serde(default)]
        key_epoch: Option<u32>,
    }
    let req: KeyReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad vault-key body"),
    };
    if req.vault_id.trim().is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let resource = vault_resource(&req.vault_id);
    if let Err(r) = authorize(state, &resource, &account, Role::Owner) {
        return r;
    }
    if req.wrapped.kdf.ver != crate::crypto::KDF_VERSION {
        return HttpResponse::err(400, "stale wrap version");
    }
    if crate::crypto::unwrap_vdk_shape_ok(&req.wrapped).is_err() {
        return HttpResponse::err(400, "bad wrapped vdk");
    }
    let dir = sync_dir_of(state);
    let mut shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    if let Some(existing) = shares.keys.get(&req.vault_id) {
        let existing_bytes = match serde_json::to_vec(existing) {
            Ok(bytes) => bytes,
            Err(e) => return HttpResponse::err(500, &format!("vault key encode: {e}")),
        };
        let new_bytes = match serde_json::to_vec(&req.wrapped) {
            Ok(bytes) => bytes,
            Err(e) => return HttpResponse::err(500, &format!("vault key encode: {e}")),
        };
        if existing_bytes == new_bytes
            && req
                .key_epoch
                .unwrap_or_else(|| shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0))
                == shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0)
        {
            return HttpResponse::json(
                200,
                &serde_json::json!({ "stored": req.vault_id,
                "key_epoch": shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0) }),
            );
        }
        if req.expected_wrapped_hash.as_deref()
            != Some(versions::sha256_b64(&existing_bytes).as_str())
        {
            return HttpResponse::err(
                409,
                "vault key exists; rotation requires current wrapped hash",
            );
        }
    }
    let old_epoch = shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0);
    let requested_epoch = req.key_epoch.unwrap_or_else(|| {
        if shares.keys.contains_key(&req.vault_id) {
            old_epoch
        } else {
            1
        }
    });
    if shares.keys.contains_key(&req.vault_id) {
        if old_epoch.checked_add(1) != Some(requested_epoch) {
            return HttpResponse::err(409, "key rotation requires the next explicit epoch");
        }
    } else if requested_epoch != 0 && requested_epoch != 1 {
        return HttpResponse::err(409, "initial vault key must start at epoch zero");
    }
    shares.keys.insert(req.vault_id.clone(), req.wrapped);
    shares
        .key_epochs
        .insert(req.vault_id.clone(), requested_epoch);
    if let Err(e) = save_shares(&dir, &shares) {
        return HttpResponse::err(500, &e);
    }
    HttpResponse::json(
        200,
        &serde_json::json!({ "stored": req.vault_id,
        "key_epoch": requested_epoch }),
    )
}

fn handle_vault_key_get(
    state: &mut ServiceState,
    auth: Option<&str>,
    query: &[(String, String)],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let vault_id = query_get(query, "vault_id").unwrap_or("");
    if vault_id.is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let resource = vault_resource(vault_id);
    if let Err(r) = check_role(state, &resource, &account, Role::Reader) {
        return r;
    }
    let dir = sync_dir_of(state);
    let shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    match shares.keys.get(vault_id) {
        None => HttpResponse::err(404, "no vault key"),
        Some(w) => {
            let encoded = match serde_json::to_vec(w) {
                Ok(bytes) => bytes,
                Err(e) => return HttpResponse::err(500, &format!("vault key encode: {e}")),
            };
            HttpResponse::json(
                200,
                &serde_json::json!({
                    "wrapped": w,
                    "wrapped_hash": versions::sha256_b64(&encoded),
                    "key_epoch": shares.key_epochs.get(vault_id).copied().unwrap_or(0),
                }),
            )
        }
    }
}

#[cfg(test)]
mod authenticated_version_tests {
    use super::*;
    use crate::crypto::{aad_verify, seal};
    use std::collections::BTreeMap;

    const VAULT: &str = "vault-aad-persistence";
    const KEY: [u8; 32] = [43; 32];

    fn sealed_op(kind: OpKind, doc_id: &str, count: u64, plaintext: &[u8]) -> SyncOp {
        let vv = BTreeMap::from([("replica-a".to_string(), count)]);
        let (rename_from, rename_to) = match &kind {
            OpKind::Rename { from, to } => (Some(from.clone()), Some(to.clone())),
            _ => (None, None),
        };
        let mut op = SyncOp {
            op_id: format!("op-{count}"),
            replica_id: "replica-a".to_string(),
            doc_id: doc_id.to_string(),
            kind,
            vv,
            ciphertext_b64: String::new(),
            nonce_b64: String::new(),
            aad: String::new(),
            ts_ms: 1_700_000_000_000 + count,
            vault_id: VAULT.to_string(),
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
        let path = versions::state_path(&schema::sync_dir(&dir));
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

        let old = crate::crypto::wrap_vdk(&KEY, &KEY).unwrap();
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
        let next = crate::crypto::wrap_vdk(&KEY, &[44; 32]).unwrap();
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
        versions::save(&sync_dir_of(&state), &folded).unwrap();

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
        versions::save(&sync_dir_of(&state), &folded).unwrap();
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
}
