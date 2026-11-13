//! Pull, ack e stato di una replica.

use super::*;

pub(super) fn admit_pull(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> Result<VaultWork, HttpResponse> {
    let account = account_of(state, auth)?;
    let req: PullRequest =
        serde_json::from_slice(body).map_err(|_| HttpResponse::err(400, "bad pull body"))?;
    if !valid_replica_id(&req.replica_id) {
        return Err(HttpResponse::err(400, "invalid replica_id"));
    }
    if req.vault_id.trim().is_empty() {
        return Err(HttpResponse::err(400, "missing vault_id"));
    }
    check_wire_protocol(&req.protocol)?;
    let resource = vault_resource(&req.vault_id);
    check_role(state, &resource, &account, Role::Reader)?;
    Ok(VaultWork {
        scope: scope_of(state, account, &req.vault_id)?,
        vault_id: req.vault_id.clone(),
        job: VaultJob::Pull(req),
    })
}

pub(super) fn run_pull(scope: &VaultScope, req: PullRequest) -> HttpResponse {
    let folded = match load_folded(&scope.dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    let shares = match load_shares(&scope.sync_dir) {
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

pub(super) fn admit_ack(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> Result<VaultWork, HttpResponse> {
    let account = account_of(state, auth)?;
    let req: AckRequest =
        serde_json::from_slice(body).map_err(|_| HttpResponse::err(400, "bad ack body"))?;
    if !valid_replica_id(&req.replica_id) {
        return Err(HttpResponse::err(400, "invalid replica_id"));
    }
    if req.vault_id.trim().is_empty() {
        return Err(HttpResponse::err(400, "missing vault_id"));
    }
    let resource = vault_resource(&req.vault_id);
    check_role(state, &resource, &account, Role::Reader)?;
    Ok(VaultWork {
        scope: scope_of(state, account, &req.vault_id)?,
        vault_id: req.vault_id.clone(),
        job: VaultJob::Ack(req),
    })
}

pub(super) fn run_ack(scope: &VaultScope, req: AckRequest) -> HttpResponse {
    match queue::ack_ops(&scope.dir, &req.replica_id, &req.ack) {
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

pub(super) fn admit_status(
    state: &mut ServiceState,
    auth: Option<&str>,
    query: &[(String, String)],
) -> Result<VaultWork, HttpResponse> {
    let account = account_of(state, auth)?;
    let vault_id = query_get(query, "vault_id").unwrap_or("");
    if vault_id.is_empty() {
        return Err(HttpResponse::err(400, "missing vault_id"));
    }
    let resource = vault_resource(vault_id);
    check_role(state, &resource, &account, Role::Reader)?;
    let replica_id = query_get(query, "replica_id").unwrap_or("").to_string();
    if !valid_replica_id(&replica_id) {
        return Err(HttpResponse::err(400, "invalid replica_id"));
    }
    Ok(VaultWork {
        scope: scope_of(state, account, vault_id)?,
        vault_id: vault_id.to_string(),
        job: VaultJob::Status { replica_id },
    })
}

pub(super) fn run_status(scope: &VaultScope, replica_id: String) -> HttpResponse {
    let dir = &scope.dir;
    let folded = match load_folded(dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    let pending = match queue::load_ops(dir, &replica_id) {
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
