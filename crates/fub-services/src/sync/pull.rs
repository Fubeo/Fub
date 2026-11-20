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
    let mut vault = match open_vault(&scope.dir) {
        Ok(vault) => vault,
        Err(response) => return response,
    };
    let shares = match load_shares(&scope.sync_dir) {
        Ok(shares) => shares,
        Err(e) => return HttpResponse::err(500, &e),
    };
    let active_epoch = shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0);
    let folded = vault.state();
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
    let cursor_key = |offset: u64| PullCursorKey {
        since_vv: req.since_vv.clone(),
        vault_id: req.vault_id.clone(),
        active_epoch,
        offset,
    };
    // The previous page of this snapshot left a cursor where it stopped: the
    // page resumes there instead of counting `offset` matches from the start
    // (a full pull was quadratic in the history). Without the cursor (a
    // restart, another process, an old page) the count from the start still
    // gives the same page: the offset stays the protocol, the cursor only
    // finds it faster.
    let resume = if offset > 0 {
        vault.pull_cursor(&cursor_key(offset))
    } else {
        None
    };
    let mut matched = if resume.is_some() { offset } else { 0 };
    let chains: Box<dyn Iterator<Item = (&String, &Vec<DocVersion>)>> = match &resume {
        Some(cursor) => Box::new(folded.versions.range::<str, _>((
            std::ops::Bound::Included(cursor.doc_key.as_str()),
            std::ops::Bound::Unbounded,
        ))),
        None => Box::new(folded.versions.iter()),
    };
    let mut ops: Vec<Vec<u8>> = Vec::new();
    let mut stop: Option<PullCursor> = None;
    let mut page_bytes = 0usize;
    // BTreeMap key + chain order is stable for a fixed server_vv. Sorting a
    // truncated page after cutting it changes order between pages and can
    // make an offset skip or replay writes.
    'chains: for (doc_key, chain) in chains {
        let skip = match &resume {
            Some(cursor) if cursor.doc_key == *doc_key => cursor.index,
            _ => 0,
        };
        for (index, version) in chain.iter().enumerate().skip(skip) {
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
            let here = || PullCursor {
                doc_key: doc_key.clone(),
                index,
            };
            if ops.len() == PULL_MAX_OPS {
                stop = Some(here());
                break 'chains;
            }
            let op = match op_from_parsed_version(version, vv) {
                Ok(op) => op,
                Err(error) => return HttpResponse::err(500, &error),
            };
            // Encoded once: the size check and the response use the same bytes.
            let encoded = match serde_json::to_vec(&op) {
                Ok(encoded) => encoded,
                Err(_) => return HttpResponse::err(500, "sync pull encode failed"),
            };
            if page_bytes.saturating_add(encoded.len()) > PULL_MAX_BYTES && !ops.is_empty() {
                stop = Some(here());
                break 'chains;
            }
            page_bytes = page_bytes.saturating_add(encoded.len());
            ops.push(encoded);
            matched += 1;
        }
    }
    let truncated = stop.is_some();
    if !truncated && offset > matched {
        return HttpResponse::err(400, "sync pull offset past snapshot");
    }
    if let Some(cursor) = stop {
        vault.set_pull_cursor(cursor_key(matched), cursor);
    }
    match pull_body(
        &ops,
        &PullTail {
            server_vv: snapshot_vv,
            truncated,
            next_offset: truncated.then_some(matched),
        },
    ) {
        Ok(body) => HttpResponse {
            status: 200,
            content_type: "application/json",
            body,
        },
        Err(_) => HttpResponse::err(500, "sync pull encode failed"),
    }
}

/// [`PullResponse`] without its ops: the ops arrive already encoded.
#[derive(Serialize)]
pub(super) struct PullTail {
    #[serde(with = "crate::wire::vv_string")]
    pub(super) server_vv: VersionVector,
    pub(super) truncated: bool,
    #[serde(
        with = "crate::wire::opt_u64_string",
        skip_serializing_if = "Option::is_none"
    )]
    pub(super) next_offset: Option<u64>,
}

/// The bytes of a [`PullResponse`] whose ops are already JSON: the same
/// fields, in the same order, as serializing the response whole.
pub(super) fn pull_body(ops: &[Vec<u8>], tail: &PullTail) -> serde_json::Result<Vec<u8>> {
    let tail = serde_json::to_vec(tail)?;
    let size = ops.iter().map(|op| op.len() + 1).sum::<usize>() + tail.len() + 10;
    let mut body = Vec::with_capacity(size);
    body.extend_from_slice(b"{\"ops\":[");
    for (i, op) in ops.iter().enumerate() {
        if i > 0 {
            body.push(b',');
        }
        body.extend_from_slice(op);
    }
    body.extend_from_slice(b"],");
    // `tail` is a JSON object: its fields follow the ops.
    body.extend_from_slice(&tail[1..]);
    Ok(body)
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
    match queue::ack_ops_counted(&scope.dir, &req.replica_id, &req.ack) {
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
        Ok(acked) => {
            if let Some(acked) = acked {
                // The rewritten queue keeps only ops already counted: the
                // count in memory follows it, so the next push does not
                // read the queue again.
                cache::note_queue_rewrite(
                    &scope.dir,
                    &queue::queue_path(&scope.dir, &req.replica_id),
                    &req.replica_id,
                    acked.pending,
                    acked.bytes,
                );
            }
            HttpResponse::json(
                200,
                &AckResponse {
                    acked: req.ack,
                    removed: acked.map_or(0, |acked| acked.removed),
                },
            )
        }
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
    let mut vault = match open_vault(dir) {
        Ok(vault) => vault,
        Err(response) => return response,
    };
    let queue_file = queue::queue_path(dir, &replica_id);
    let pending = match vault.queue(&queue_file, &replica_id) {
        Some(memo) => memo.pending,
        None => match queue::load_ops(dir, &replica_id) {
            Ok(ops) => {
                if let (Ok(bytes), Ok(stamp)) =
                    (queue::measured_bytes(&ops), cache::stamp_of(&queue_file))
                {
                    vault.set_queue(
                        &replica_id,
                        cache::QueueMemo {
                            stamp,
                            pending: ops.len(),
                            bytes,
                            // Counted, not proven folded: push still replays.
                            folded: false,
                        },
                    );
                }
                ops.len()
            }
            Err(_) => return HttpResponse::err(500, "sync queue recovery needed"),
        },
    };
    let folded = vault.state();
    let conflicted: BTreeSet<&str> = folded
        .conflicts
        .iter()
        .map(|conflict| conflict.doc_id.as_str())
        .collect();
    // This is the authoritative server-side view. The host overlays its
    // durable local cursor/outbox, rather than inventing server file states.
    let mut entries = Vec::new();
    let mut recent: BTreeMap<(u64, String), serde_json::Value> = BTreeMap::new();
    for (doc_id, chain) in &folded.versions {
        if let Some(latest) = chain.last() {
            let vv = parse_vv_text(&latest.vv_text);
            let conflicted = conflicted.contains(doc_id.as_str());
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
