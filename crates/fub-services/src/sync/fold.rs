//! Il fold di un op validato dentro `SyncState`, con l'eventuale conflitto.

use super::*;

// ---------------------------------------------------------------------------
// Fold: one validated op into SyncState. Returns an optional conflict.
// ---------------------------------------------------------------------------

pub(super) enum FoldOutcome {
    Applied(Option<ConflictInfo>),
    Held(ConflictInfo),
}

pub(super) fn fold_op(
    state: &mut SyncState,
    op: &SyncOp,
    now_ms: u64,
    lww_count: &mut usize,
) -> FoldOutcome {
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
