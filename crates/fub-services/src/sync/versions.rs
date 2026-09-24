//! Remote version chain, trash/restore, attachment accounting (P16.6).
//!
//! A replica is NOT a backup: the version chain exists so a second device can
//! converge and so a mistaken delete can be undone within `retention_days`.
//! It is not a point-in-time restore story — tombstones expire, conflicts
//! expire, and the chain is pruned. Code comments say so where it matters.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::schema::atomic_write;

use super::causality::{
    conflict_expired, parse_vv_text, tombstone_expired, vv_text, SyncConflict, Tombstone,
    VersionVector,
};
use super::{OpKind, SyncOp};

/// Cap so one pathological doc cannot eat the whole disk budget.
pub const MAX_VERSIONS_PER_DOC: usize = 1_000;
/// Per-op ciphertext cap (16 MiB): larger pushes are rejected with 413.
pub const MAX_OP_BYTES: usize = 16 * 1024 * 1024;

/// One link in the remote version chain: the server keeps the ciphertext
/// opaquely (never plaintext), plus addressing metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocVersion {
    /// Op that produced this version (durable replay/ack addressing).
    pub op_id: String,
    /// Chain index. For a rename this is the destination; `kind.from` is
    /// the original authenticated `SyncOp.doc_id` and must be used for AAD.
    pub doc_id: String,
    #[serde(with = "crate::wire::u64_string")]
    pub version: u64,
    pub hash: String,
    /// Millisecondi UNIX: restano number (regola `VersionRef.ts`: aritmetica
    /// `new Date(ts)`, mai oltre 2^53).
    pub ts_ms: u64,
    /// Canonical `vv_text` at write time (AAD-bound, canonical envelope).
    pub vv_text: String,
    /// Opaque ciphertext reference (base64 of the stored bytes).
    pub ciphertext_b64: String,
    pub nonce_b64: String,
    pub replica_id: String,
    pub deleted: bool,
    /// Authenticated operation kind, including both rename endpoints. Older
    /// chains without this field cannot reconstruct the AEAD AAD and must
    /// fail to load instead of guessing from `version` or `deleted`.
    pub kind: OpKind,
    /// Stable vault pairing id and VDK epoch are also authenticated. Missing
    /// legacy fields cannot be inferred safely.
    pub vault_id: String,
    pub key_epoch: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrashEntry {
    pub doc_id: String,
    pub deleted_ms: u64,
    /// Valori come stringhe sul wire (compat numero).
    #[serde(with = "crate::wire::vv_string")]
    pub vv: VersionVector,
    pub replica_id: String,
    /// Last live version, if any, for one-click restore.
    pub last_version: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncState {
    pub versions: BTreeMap<String, Vec<DocVersion>>,
    pub tombstones: BTreeMap<String, Tombstone>,
    pub conflicts: Vec<SyncConflict>,
    /// Trash markers predate this field in some persisted states; an absent
    /// map is safe to interpret as no recorded trash, never as ciphertext.
    #[serde(default)]
    pub trash: BTreeMap<String, TrashEntry>,
    pub seen_op_ids: BTreeSet<String>,
    /// Vettore server: valori come stringhe sul wire (compat numero).
    #[serde(with = "crate::wire::vv_string")]
    pub server_vv: VersionVector,
    /// Attachment bytes addressed (sha -> bytes), for integrity + quota.
    pub attachments: BTreeMap<String, u64>,
    /// Max VDK key epoch observed per vault pairing id. Ops with a lower
    /// epoch are held (stale key), never applied; a higher epoch advances
    /// the record. Epoch mismatch is always an explicit hold, never silent.
    #[serde(default)]
    pub vault_epochs: BTreeMap<String, u32>,
}

/// `<data>/sync/state.json`.
pub fn state_path(sync_dir: &Path) -> PathBuf {
    sync_dir.join("state.json")
}

/// Load or default (missing file = fresh service, not an error).
pub fn load(sync_dir: &Path) -> Result<SyncState, String> {
    let path = state_path(sync_dir);
    if !path.exists() {
        return Ok(SyncState::default());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("sync state read: {e}"))?;
    let state: SyncState =
        serde_json::from_slice(&bytes).map_err(|e| format!("sync state parse: {e}"))?;
    for (doc_id, chain) in &state.versions {
        for version in chain {
            let route_ok = match &version.kind {
                OpKind::Rename { from, to } => {
                    !from.trim().is_empty() && !to.trim().is_empty() && to == doc_id
                }
                _ => true,
            };
            let vv = parse_vv_text(&version.vv_text);
            if version.doc_id != *doc_id
                || !route_ok
                || version.deleted != matches!(version.kind, OpKind::Delete | OpKind::Tombstone)
                || version.op_id.trim().is_empty()
                || version.replica_id.trim().is_empty()
                || version.vault_id.trim().is_empty()
                || version.nonce_b64.trim().is_empty()
                || version.ciphertext_b64.trim().is_empty()
                || vv.is_empty()
                || vv_text(&vv) != version.vv_text
            {
                return Err("sync state has incomplete authenticated version metadata".to_string());
            }
        }
    }
    Ok(state)
}

/// Atomic persist (tmp + rename + fsync).
pub fn save(sync_dir: &Path, state: &SyncState) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| format!("sync state encode: {e}"))?;
    atomic_write(&state_path(sync_dir), &bytes).map_err(|e| format!("sync state write: {e}"))
}

/// Append a version, pruning to [`MAX_VERSIONS_PER_DOC`] (oldest dropped).
/// Returns the new version number.
pub fn push_version(state: &mut SyncState, op: &SyncOp, indexed_doc_id: &str) -> u64 {
    let chain = state
        .versions
        .entry(indexed_doc_id.to_string())
        .or_default();
    let version = chain.last().map(|v| v.version + 1).unwrap_or(1);
    chain.push(DocVersion {
        op_id: op.op_id.clone(),
        doc_id: indexed_doc_id.to_string(),
        version,
        hash: sha256_b64(op.ciphertext_b64.as_bytes()),
        ts_ms: op.ts_ms,
        vv_text: super::causality::vv_text(&op.vv),
        ciphertext_b64: op.ciphertext_b64.clone(),
        nonce_b64: op.nonce_b64.clone(),
        replica_id: op.replica_id.clone(),
        deleted: matches!(op.kind, OpKind::Delete | OpKind::Tombstone),
        kind: op.kind.clone(),
        vault_id: op.vault_id.clone(),
        key_epoch: op.key_epoch,
    });
    if chain.len() > MAX_VERSIONS_PER_DOC {
        let drop_n = chain.len() - MAX_VERSIONS_PER_DOC;
        chain.drain(..drop_n);
    }
    version
}

/// Latest live (non-deleted) version, if any.
pub fn latest_live<'a>(state: &'a SyncState, doc_id: &str) -> Option<&'a DocVersion> {
    state
        .versions
        .get(doc_id)?
        .iter()
        .rev()
        .find(|v| !v.deleted)
}

/// Latest version of any kind.
pub fn latest_any<'a>(state: &'a SyncState, doc_id: &str) -> Option<&'a DocVersion> {
    state.versions.get(doc_id)?.last()
}

/// Move `doc_id` to trash (records last live version for restore).
pub fn move_to_trash(
    state: &mut SyncState,
    doc_id: &str,
    vv: VersionVector,
    replica_id: &str,
    now_ms: u64,
) {
    let last_version = latest_live(state, doc_id).map(|v| v.version);
    state.trash.insert(
        doc_id.to_string(),
        TrashEntry {
            doc_id: doc_id.to_string(),
            deleted_ms: now_ms,
            vv,
            replica_id: replica_id.to_string(),
            last_version,
        },
    );
}

/// Restore from trash: returns the version to re-publish, if known.
/// The caller must push a fresh op with a bumped counter — restore never
/// reuses the old vector (a replica is not a backup: restore is a new write).
pub fn restore_from_trash(state: &mut SyncState, doc_id: &str) -> Result<Option<u64>, String> {
    match state.trash.remove(doc_id) {
        None => Err("not in trash".to_string()),
        Some(entry) => Ok(entry.last_version),
    }
}

/// Prune expired tombstones + conflicts + trash by `retention_days`.
/// Returns `(tombstones, conflicts, trash)` removed counts.
pub fn prune_retention(
    state: &mut SyncState,
    now_ms: u64,
    retention_days: u32,
) -> (usize, usize, usize) {
    let before_t = state.tombstones.len();
    state
        .tombstones
        .retain(|_, t| !tombstone_expired(t, now_ms, retention_days));
    let before_c = state.conflicts.len();
    state
        .conflicts
        .retain(|c| !conflict_expired(c, now_ms, retention_days));
    let retention_ms = retention_days as u64 * 24 * 3600 * 1000;
    let before_tr = state.trash.len();
    state.trash.retain(|_, e| {
        if retention_ms == 0 {
            return true;
        }
        now_ms.saturating_sub(e.deleted_ms) <= retention_ms
    });
    (
        before_t - state.tombstones.len(),
        before_c - state.conflicts.len(),
        before_tr - state.trash.len(),
    )
}

/// Attachment accounting: record `sha -> bytes`, enforcing
/// `max_asset_bytes` per asset and `max_vault_bytes` in total.
pub fn account_attachment(
    state: &mut SyncState,
    sha: &str,
    bytes: u64,
    max_asset_bytes: u64,
    max_vault_bytes: u64,
) -> Result<(), String> {
    if max_asset_bytes > 0 && bytes > max_asset_bytes {
        return Err("attachment too large".to_string());
    }
    let mut total: u64 = state.attachments.values().sum();
    let prev = state.attachments.get(sha).copied().unwrap_or(0);
    total = total.saturating_sub(prev).saturating_add(bytes);
    if max_vault_bytes > 0 && total > max_vault_bytes {
        return Err("vault quota exceeded".to_string());
    }
    state.attachments.insert(sha.to_string(), bytes);
    Ok(())
}

/// Streaming sha256-equivalent integrity helper: the server never needs the
/// plaintext, but pull responses carry the stored hash so the client can
/// verify attachment bytes end-to-end. Here we only hash opaque bytes with a
/// non-cryptographic FNV-free hasher — no, we hash with `ring::digest SHA256`
/// (consolidated library, no invented primitive).
pub fn sha256_b64(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let digest = ring::digest::digest(&ring::digest::SHA256, bytes);
    B64.encode(digest.as_ref())
}

/// Allowlist-log auditor: asserts a log file contains ONLY structured
/// `METHOD path-base -> status` lines (method + path-base + status, never
/// bodies/identifiers/secrets). Any line that is not exactly that shape is
/// reported. Used by the invariant tests to prove no doc_id/replica/body
/// ever reaches logs.
pub fn find_non_allowlist_log_lines(log_path: &Path) -> Result<Vec<String>, String> {
    if !log_path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(log_path).map_err(|e| format!("log read: {e}"))?;
    let mut bad = Vec::new();
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|e| format!("log read: {e}"))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Allowlist shape: `METHOD /path-base -> NNN` with METHOD uppercase
        // alpha, path-base starting with `/` and no query, status 3 digits.
        let ok = match line.split_once(' ') {
            Some((method, rest)) => {
                let method_ok =
                    !method.is_empty() && method.bytes().all(|b| b.is_ascii_uppercase());
                match rest.rsplit_once(" -> ") {
                    Some((base, status)) => {
                        method_ok
                            && base.starts_with('/')
                            && !base.contains(['?', '#', '@'])
                            && status.len() == 3
                            && status.bytes().all(|b| b.is_ascii_digit())
                    }
                    None => false,
                }
            }
            None => false,
        };
        if !ok {
            bad.push(format!("<non-allowlist line, {} bytes>", line.len()));
        }
    }
    Ok(bad)
}
