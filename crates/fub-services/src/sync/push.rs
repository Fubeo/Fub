//! Il push: ammissione, applicazione degli op e l'op ricostruito da una
//! versione.

use super::*;

pub(super) fn admit_push(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> Result<VaultWork, HttpResponse> {
    let account = account_of(state, auth)?;
    let req: PushRequest =
        serde_json::from_slice(body).map_err(|_| HttpResponse::err(400, "bad push body"))?;
    if !valid_replica_id(&req.replica_id) {
        return Err(HttpResponse::err(400, "invalid replica_id"));
    }
    check_wire_protocol(&req.protocol)?;
    if req.ops.len() > PUSH_MAX_OPS {
        return Err(HttpResponse::err(413, "push too large"));
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
        return Err(HttpResponse::err(400, "mixed vault batch"));
    }
    let vault_id = vault_ids
        .into_iter()
        .next()
        .unwrap_or_else(|| "default".to_string());
    let resource = vault_resource(&vault_id);
    authorize(state, &resource, &account, Role::Writer)?;
    Ok(VaultWork {
        scope: scope_of(state, account, &vault_id)?,
        vault_id,
        job: VaultJob::Push(req),
    })
}

pub(super) fn run_push(scope: &VaultScope, req: PushRequest) -> HttpResponse {
    let dir = &scope.dir;
    let now = schema::now_ms();
    let mut folded = match load_folded(dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    let shares = match load_shares(&scope.sync_dir) {
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
    match queue::load_ops(dir, &req.replica_id) {
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
        // The quota measures what the vault holds: the version chain (the
        // fold above already added this batch), every replica queue and the
        // batch about to join one. Old history yields first; what is left
        // is refused before anything is written.
        let budget = scope.quotas.max_vault_bytes;
        if budget > 0 {
            let queued = queue::vault_queue_bytes(dir).saturating_add(batch_bytes);
            let stored = versions::fit_history(&mut folded, budget.saturating_sub(queued));
            if stored.saturating_add(queued) > budget {
                return HttpResponse::err(413, "vault quota exceeded");
            }
        }
        if let Err(e) = queue::append_lines(dir, &req.replica_id, &lines) {
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
    versions::prune_retention(&mut folded, now, scope.quotas.retention_days);
    if let Err(e) = versions::save(dir, &folded) {
        return HttpResponse::err(500, &e);
    }
    // Backpressure, never silent drop: a full authority queue reports
    // QueueFull so the caller resyncs explicitly instead of reading current.
    match queue::enforce_cap(dir, &req.replica_id, &scope.quotas, now) {
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

pub(super) fn op_from_version(v: &DocVersion) -> Result<SyncOp, String> {
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
