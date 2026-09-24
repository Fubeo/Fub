//! Causality for the sync slice (P16.2): version vectors, dedup, tombstones,
//! conservative conflicts.
//!
//! The server stores ciphertext opaquely and never merges destructively:
//! concurrent writes become conflict copies for the UI, settings do
//! last-writer-wins with a log entry. A tombstone never resurrects without a
//! new counter dominating it. Retention (`retention_days` from the parent
//! [`crate::schema::ServiceQuotas`]) prunes tombstones/conflicts, it never
//! deletes live versions early.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// Version vector: `replica_id -> counter`. Replica ids are opaque UUID v4
/// (see [`crate::schema::new_id`]), never derived from [`DocId`](`fub_abi::model::DocId`)
/// paths; a rename keeps the replica stable because the path is an attribute
/// of the op, not the identity of the replica.
pub type VersionVector = BTreeMap<String, u64>;

/// Ordering of two version vectors.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VvOrder {
    Equal,
    /// `a` has every counter `>= b` and at least one `>`.
    Dominates,
    /// `b` dominates `a`.
    Dominated,
    /// Neither dominates: concurrent writes, never auto-merged.
    Concurrent,
}

/// Canonical text form for AAD binding: `replica:counter` pairs sorted by
/// replica (BTreeMap order), joined with `,`. The host client builds the
/// identical string so `aad == "fub-sync/1|replica|doc|vv"` verifies.
pub fn vv_text(vv: &VersionVector) -> String {
    vv.iter()
        .map(|(r, c)| format!("{r}:{c}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// Parse [`vv_text`] back (tolerant: skips malformed pairs).
pub fn parse_vv_text(s: &str) -> VersionVector {
    let mut out = VersionVector::new();
    for pair in s.split(',') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        if let Some((r, c)) = pair.rsplit_once(':') {
            if let Ok(n) = c.trim().parse::<u64>() {
                if !r.trim().is_empty() {
                    out.insert(r.trim().to_string(), n);
                }
            }
        }
    }
    out
}

/// Compare two vectors.
pub fn vv_compare(a: &VersionVector, b: &VersionVector) -> VvOrder {
    let mut a_gt = false;
    let mut b_gt = false;
    let mut keys: BTreeSet<&String> = BTreeSet::new();
    keys.extend(a.keys());
    keys.extend(b.keys());
    // Empty-vs-empty is equal; empty-vs-nonempty is dominated.
    if keys.is_empty() {
        return VvOrder::Equal;
    }
    for k in keys {
        let av = a.get(k).copied().unwrap_or(0);
        let bv = b.get(k).copied().unwrap_or(0);
        if av > bv {
            a_gt = true;
        } else if bv > av {
            b_gt = true;
        }
        if a_gt && b_gt {
            return VvOrder::Concurrent;
        }
    }
    match (a_gt, b_gt) {
        (false, false) => VvOrder::Equal,
        (true, false) => VvOrder::Dominates,
        (false, true) => VvOrder::Dominated,
        (true, true) => VvOrder::Concurrent,
    }
}

/// Merge: per-replica max. Used for `server_vv` advancement.
pub fn vv_merge(a: &VersionVector, b: &VersionVector) -> VersionVector {
    let mut out = a.clone();
    for (r, c) in b {
        let e = out.entry(r.clone()).or_insert(0);
        if *e < *c {
            *e = *c;
        }
    }
    out
}

/// Bump the local counter for `replica`.
pub fn vv_inc(vv: &mut VersionVector, replica: &str) {
    let e = vv.entry(replica.to_string()).or_insert(0);
    *e = e.saturating_add(1);
}

/// Dedup check against the persisted `op_id` set.
pub fn is_duplicate(seen: &BTreeSet<String>, op_id: &str) -> bool {
    seen.contains(op_id)
}

/// Tombstone: a deleted doc stays addressable until retention expires so a
/// late concurrent edit cannot silently resurrect it. Never resurrected
/// without a new counter dominating [`Tombstone::vv`].
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tombstone {
    pub doc_id: String,
    /// Valori come stringhe sul wire (compat numero).
    #[serde(with = "crate::wire::vv_string")]
    pub vv: VersionVector,
    pub ts_ms: u64,
    pub replica_id: String,
}

/// `true` when the incoming vector carries a genuinely new write past the
/// tombstone (dominates it). Concurrent-or-dominated vectors stay buried.
pub fn can_resurrect(tomb: &Tombstone, incoming: &VersionVector) -> bool {
    matches!(vv_compare(incoming, &tomb.vv), VvOrder::Dominates)
}

/// `true` when the tombstone is older than `retention_days`.
pub fn tombstone_expired(tomb: &Tombstone, now_ms: u64, retention_days: u32) -> bool {
    let retention_ms = retention_days as u64 * 24 * 3600 * 1000;
    now_ms.saturating_sub(tomb.ts_ms) > retention_ms
}

/// Conflict copy surfaced to the UI: both sides are preserved server-side as
/// versions, nothing is auto-merged.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncConflict {
    pub doc_id: String,
    pub reason: String,
    pub replicas: Vec<String>,
    pub ts_ms: u64,
}

/// `true` when the conflict record is older than `retention_days`.
pub fn conflict_expired(c: &SyncConflict, now_ms: u64, retention_days: u32) -> bool {
    let retention_ms = retention_days as u64 * 24 * 3600 * 1000;
    now_ms.saturating_sub(c.ts_ms) > retention_ms
}

/// Document family for conflict policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocKind {
    Text,
    Binary,
    Canvas,
    Views,
    Settings,
    Other,
}

/// Family by path heuristic (extension + folder); the server never sees
/// plaintext, so policy keys off the `doc_id` shape only.
pub fn doc_kind_for(doc_id: &str) -> DocKind {
    let lower = doc_id.to_ascii_lowercase();
    if lower.ends_with(".settings.json") || lower.contains("settings/") {
        return DocKind::Settings;
    }
    if lower.ends_with(".canvas.json") || lower.contains("canvas/") {
        return DocKind::Canvas;
    }
    if lower.ends_with(".view.json") || lower.contains("views/") {
        return DocKind::Views;
    }
    if lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".txt")
        || lower.ends_with(".sheet.json")
    {
        return DocKind::Text;
    }
    if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".pdf")
        || lower.ends_with(".mp3")
        || lower.ends_with(".mp4")
        || lower.contains("attachments/")
    {
        return DocKind::Binary;
    }
    DocKind::Other
}

/// Conservative policy: every concurrent write needs a conflict copy EXCEPT
/// settings, which are last-writer-wins with a log entry (still no data loss:
/// the losing version stays in the version chain).
pub fn needs_conflict_copy(kind: DocKind) -> bool {
    !matches!(kind, DocKind::Settings)
}

/// Human-readable reason stored in [`SyncConflict::reason`] and returned in
/// `POST /v1/sync/push -> {conflicts: [{doc_id, reason, replicas}]}`.
pub fn conflict_reason(kind: DocKind, local_replica: &str, remote_replica: &str) -> String {
    let family = match kind {
        DocKind::Text => "text",
        DocKind::Binary => "binary",
        DocKind::Canvas => "canvas",
        DocKind::Views => "views",
        DocKind::Settings => "settings",
        DocKind::Other => "doc",
    };
    format!("concurrent {family} write by {local_replica} and {remote_replica}: kept both, no auto-merge")
}

#[cfg(test)]
mod unit {
    // Unit checks live here for reviewers; the invariant suite prepared for
    // Main is `crates/fub-services/tests/sync_invariants.rs` (not executed
    // during concurrency).
    use super::*;

    #[test]
    fn vv_text_roundtrip_is_canonical() {
        let mut vv = VersionVector::new();
        vv.insert("b".to_string(), 2);
        vv.insert("a".to_string(), 1);
        assert_eq!(vv_text(&vv), "a:1,b:2");
        assert_eq!(parse_vv_text("a:1,b:2"), vv);
    }
}
