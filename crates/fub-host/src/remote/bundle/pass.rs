//! `run_pass_on`: un passaggio di sincronizzazione, dal lock al riepilogo.

use super::*;

/// Passo reale del job `sync.pass` su `&mut dyn HostApi` (JobHost fuori lock):
/// outbox/cursori dallo state-dir TRUSTED, HTTP via `HostNetwork::fetch`,
/// apply via porte locali con CAS raw (`write_document_bytes` per byte/BOM,
/// `write_document`/`apply_edit` per testo, `create/rename/trash`
/// strutturali), ack solo dopo deposito + stato durevole. Stessa authority
/// Desktop/CLI. VDK: invito/chiave via vault-key endpoint con passphrase
/// CLI (file/stdin -> KEK -> unwrap envelope), mai nel payload.
pub(crate) fn run_pass_on(
    root: &Path,
    token: &super::TokenSource,
    host: &mut dyn HostApi,
    vault_scope: Option<&str>,
    direction: &str,
) -> Result<serde_json::Value, PluginError> {
    let paused = match host.setting(super::SETTING_PAUSED) {
        Ok(SettingValue::Toggle(value)) => value,
        Ok(_) | Err(PluginError::NotFound(_)) => false,
        Err(e) => return Err(e),
    };
    if paused || root.join("sync-paused").exists() {
        return Err(PluginError::Cancelled("sync paused".into()));
    }
    let mode = ReplicationMode::configured()?;
    if direction == "push" && !mode.can_push() {
        return Err(PluginError::BadArgs(
            "sync push prohibited in read-only mode".into(),
        ));
    }
    if direction == "pull" && !mode.can_pull() {
        return Err(PluginError::BadArgs(
            "sync pull prohibited in mirror mode".into(),
        ));
    }
    let do_push = mode.can_push() && direction != "pull";
    let do_pull = mode.can_pull() && direction != "push";
    let _lock = JobLock::acquire(root)?;
    let base = super::resolve_endpoint(host)?;
    super::check_endpoint_binding(root, &base).map_err(|e| e.to_plugin_error())?;
    let token = token
        .load()
        .ok_or_else(|| PluginError::PermissionDenied("missing credentials".into()))?;
    let auth = format!("Bearer {token}");
    check_external_overlap(host)?;
    let state = JobState::open(root, vault_scope, host)?;
    let hello = http_get(host, &base, &auth, "/v1/hello")?;
    super::assert_hello(
        &serde_json::to_vec(&hello)
            .map_err(|_| PluginError::Internal("sync hello encode".into()))?,
    )
    .map_err(|_| PluginError::Internal("sync protocol mismatch".into()))?;
    super::store_endpoint_binding(root, &base)
        .map_err(|_| PluginError::Io("sync endpoint binding failed".into()))?;
    let vdk = ensure_job_vdk(&base, &auth, &state, host)?;
    let queued = read_outbox(root)?;
    let cursor = read_cursor(root)?;
    let mut vv = cursor.server_vv.clone();
    for row in &queued {
        let op = row
            .get("op")
            .ok_or_else(|| PluginError::Io("sync outbox malformed".into()))?;
        let queued_op: super::sync::WireOp = serde_json::from_value(op.clone())
            .map_err(|_| PluginError::Io("sync queued op malformed".into()))?;
        if queued_op.replica_id != state.replica_id
            || queued_op.vault_id != state.vault_id
            || queued_op.key_epoch != state.key_epoch
        {
            return Err(PluginError::Conflict(
                "sync queued op belongs to another vault, replica or key epoch".into(),
            ));
        }
        let queued_vv = vv_parse(
            op.get("vv")
                .ok_or_else(|| PluginError::Io("sync outbox vv missing".into()))?,
        )?;
        for (replica, counter) in queued_vv {
            let current = vv.entry(replica).or_insert(0);
            *current = (*current).max(counter);
        }
    }
    let blocked_docs: BTreeSet<String> = read_conflicts(root)?
        .into_iter()
        .map(|conflict| conflict.doc_id)
        .collect();
    let Collected { docs, too_large } = if do_push {
        collect_job_docs(
            host,
            &state.user_exclude,
            &cursor.synced,
            &blocked_docs,
            &queued,
        )?
    } else {
        Collected::default()
    };
    let mut fresh = Vec::new();
    for doc in &docs {
        if doc.bytes.len() > super::sync::MAX_DOC_BYTES {
            return Err(PluginError::BadArgs(
                "sync file exceeds 7 MiB single-op cap; no chunk transfer started".into(),
            ));
        }
        let counter = vv.entry(state.replica_id.clone()).or_insert(0);
        *counter = counter
            .checked_add(1)
            .ok_or_else(|| PluginError::Io("sync counter exhausted".into()))?;
        let envelope = super::SyncEnvelope {
            protocol: super::SYNC_PROTOCOL.to_string(),
            vault_id: state.vault_id.clone(),
            key_epoch: state.key_epoch,
            op_id: super::new_replica_id(),
            replica_id: state.replica_id.clone(),
            doc_id: doc.id.clone(),
            kind: "update".to_string(),
            vv: vv.clone(),
            ts_ms: super::job_now_ms(),
            rename_from: None,
            rename_to: None,
        };
        let (nonce_b64, ciphertext_b64) = super::encrypt_envelope(&vdk, &envelope, &doc.bytes)
            .map_err(|_| PluginError::Internal("sync seal failed".into()))?;
        let op = serde_json::json!({
            "op_id": envelope.op_id, "replica_id": envelope.replica_id,
            "doc_id": envelope.doc_id, "kind": "update",
            "vv": vv_wire(&envelope.vv), "ciphertext_b64": ciphertext_b64,
            "nonce_b64": nonce_b64, "aad": super::canonical_aad_json(&envelope),
            "ts_ms": envelope.ts_ms, "vault_id": envelope.vault_id,
            "key_epoch": envelope.key_epoch,
        });
        if serde_json::to_vec(&op)
            .map_err(|_| PluginError::Internal("sync op encode failed".into()))?
            .len()
            > 10 * 1024 * 1024
        {
            return Err(PluginError::BadArgs(
                "sync op exceeds 10 MiB server queue line cap".into(),
            ));
        }
        fresh.push(serde_json::json!({"op": op, "revision": doc.revision}));
    }
    for doc_id in cursor.synced.keys().filter(|_| do_push) {
        if blocked_docs.contains(doc_id)
            || !super::is_syncable_entry(doc_id)
            || super::is_user_excluded(&state.user_exclude, doc_id)
            || queued
                .iter()
                .any(|row| row["op"]["doc_id"].as_str() == Some(doc_id))
        {
            continue;
        }
        match host.document_revision(&DocId::new(doc_id.clone())) {
            Ok(_) => continue,
            Err(PluginError::NotFound(_)) => {}
            Err(e) => return Err(e),
        }
        let counter = vv.entry(state.replica_id.clone()).or_insert(0);
        *counter = counter
            .checked_add(1)
            .ok_or_else(|| PluginError::Io("sync counter exhausted".into()))?;
        let envelope = super::SyncEnvelope {
            protocol: super::SYNC_PROTOCOL.to_string(),
            vault_id: state.vault_id.clone(),
            key_epoch: state.key_epoch,
            op_id: super::new_replica_id(),
            replica_id: state.replica_id.clone(),
            doc_id: doc_id.clone(),
            kind: "delete".to_string(),
            vv: vv.clone(),
            ts_ms: super::job_now_ms(),
            rename_from: None,
            rename_to: None,
        };
        let (nonce_b64, ciphertext_b64) = super::encrypt_envelope(&vdk, &envelope, b"")
            .map_err(|_| PluginError::Internal("sync tombstone seal failed".into()))?;
        fresh.push(serde_json::json!({"op": {
            "op_id": envelope.op_id, "replica_id": envelope.replica_id,
            "doc_id": envelope.doc_id, "kind": "delete",
            "vv": vv_wire(&envelope.vv), "ciphertext_b64": ciphertext_b64,
            "nonce_b64": nonce_b64, "aad": super::canonical_aad_json(&envelope),
            "ts_ms": envelope.ts_ms, "vault_id": envelope.vault_id,
            "key_epoch": envelope.key_epoch,
        }, "revision": null}));
    }
    append_outbox(&state, &fresh)?;
    let queued = read_outbox(root)?;
    let mut acked = BTreeSet::new();
    let mut push_conflicts = BTreeSet::new();
    let mut batch_start = 0;
    while do_push && batch_start < queued.len() {
        let mut batch_end = batch_start;
        let mut batch_bytes = 0usize;
        while batch_end < queued.len() && batch_end - batch_start < 5_000 {
            let size = serde_json::to_vec(&queued[batch_end]["op"])
                .map_err(|_| PluginError::Internal("sync queued op encode failed".into()))?
                .len();
            if batch_bytes.saturating_add(size) > 32 * 1024 * 1024 && batch_end > batch_start {
                break;
            }
            batch_bytes = batch_bytes.saturating_add(size);
            batch_end += 1;
        }
        let batch = &queued[batch_start..batch_end];
        batch_start = batch_end;
        let ops: Vec<&serde_json::Value> = batch.iter().map(|row| &row["op"]).collect();
        let push_res = http_post(
            host,
            &base,
            &auth,
            "/v1/sync/push",
            &serde_json::json!({
                "protocol": super::SYNC_PROTOCOL, "replica_id": state.replica_id,
                "ops": ops,
            }),
        )?;
        let ack = push_res
            .get("ack")
            .and_then(|v| v.as_array())
            .ok_or_else(|| PluginError::Internal("sync push missing ack".into()))?;
        for id in ack {
            let id = id
                .as_str()
                .ok_or_else(|| PluginError::Internal("sync push bad ack".into()))?;
            if !batch
                .iter()
                .any(|row| row["op"]["op_id"].as_str() == Some(id))
            {
                return Err(PluginError::Internal("sync push unknown ack".into()));
            }
            acked.insert(id.to_string());
        }
        push_conflicts.extend(report_conflicts(root, &push_res)?);
    }
    // Server ack means WAL committed; only then can local queued entries be retired.
    for row in &queued {
        let op = &row["op"];
        if acked.contains(op["op_id"].as_str().unwrap_or("")) {
            let id = op["doc_id"]
                .as_str()
                .ok_or_else(|| PluginError::Io("sync queued doc missing".into()))?;
            if push_conflicts.contains(id) {
                continue;
            }
            let revision: Option<Revision> = serde_json::from_value(row["revision"].clone())
                .map_err(|_| PluginError::Io("sync queued revision invalid".into()))?;
            let doc = DocId::new(id.to_string());
            match (revision, host.document_revision(&doc)) {
                (Some(expected), Ok(_)) | (Some(expected), Err(PluginError::NotFound(_))) => {
                    mark_synced(root, id, expected)?
                }
                (None, Err(PluginError::NotFound(_))) => {
                    let mut cursor = read_cursor(root)?;
                    cursor.synced.remove(id);
                    write_cursor(root, &cursor)?;
                }
                (None, Ok(_)) => {}
                (_, Err(e)) => return Err(e),
            }
        }
    }
    if !acked.is_empty() {
        let mut cursor = read_cursor(root)?;
        for row in &queued {
            let op = &row["op"];
            if acked.contains(op["op_id"].as_str().unwrap_or("")) {
                let vv = vv_parse(&op["vv"])?;
                if let Some(counter) = vv.get(&state.replica_id) {
                    let local = cursor
                        .server_vv
                        .entry(state.replica_id.clone())
                        .or_insert(0);
                    *local = (*local).max(*counter);
                }
            }
        }
        // Persist the sender's counter before retiring its durable outbox.
        // A crash after push but before pull must not reuse the same counter.
        write_cursor(root, &cursor)?;
        let ids: Vec<&str> = acked.iter().map(String::as_str).collect();
        http_post(
            host,
            &base,
            &auth,
            "/v1/sync/ack",
            &serde_json::json!({
                "replica_id": state.replica_id, "vault_id": state.vault_id, "ack": ids,
            }),
        )?;
    }
    drain_outbox(&state, &acked)?;
    let cursor = read_cursor(root)?;
    let mut applied = BTreeSet::new();
    let mut conflicts = 0;
    let mut held = 0;
    let mut pulled = 0usize;
    let mut offset = 0u64;
    let mut version_docs = BTreeSet::new();
    let mut snapshot_vv: Option<BTreeMap<String, u64>> = None;
    let mut restarts = 0u8;
    if do_pull {
        #[allow(clippy::never_loop)]
        loop {
            let mut request = serde_json::json!({
                "protocol": super::SYNC_PROTOCOL, "replica_id": state.replica_id,
                "vault_id": state.vault_id, "since_vv": vv_wire(&cursor.server_vv),
                "offset": offset.to_string(),
            });
            if let Some(ref vv) = snapshot_vv {
                request["snapshot_vv"] = vv_wire(vv);
            }
            let pull_res = match http_post(host, &base, &auth, "/v1/sync/pull", &request) {
                Err(PluginError::Conflict(_)) if snapshot_vv.is_some() && restarts < 3 => {
                    restarts += 1;
                    offset = 0;
                    snapshot_vv = None;
                    continue;
                }
                result => result?,
            };
            let server_vv = vv_parse(
                pull_res
                    .get("server_vv")
                    .ok_or_else(|| PluginError::Internal("sync pull missing server_vv".into()))?,
            )?;
            if let Some(ref expected) = snapshot_vv {
                if *expected != server_vv {
                    return Err(PluginError::Conflict("sync pull snapshot changed".into()));
                }
            } else {
                snapshot_vv = Some(server_vv.clone());
            }
            let ops = pull_res
                .get("ops")
                .and_then(|v| v.as_array())
                .ok_or_else(|| PluginError::Internal("sync pull missing ops".into()))?;
            let truncated = pull_res
                .get("truncated")
                .and_then(|v| v.as_bool())
                .ok_or_else(|| PluginError::Internal("sync pull missing truncated".into()))?;
            pulled += ops.len();
            for op in ops {
                let id = op
                    .get("op_id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| PluginError::Internal("sync pull bad op id".into()))?;
                if read_cursor(root)?.applied.contains(id) {
                    applied.insert(id.to_string()); // crash after durable apply, before ack
                } else {
                    match apply_remote_op(host, &state, &vdk, op)? {
                        ApplyOutcome::Applied { op_id } => {
                            mark_applied(root, &op_id)?;
                            applied.insert(op_id);
                        }
                        ApplyOutcome::Conflict { op_id } => {
                            mark_applied(root, &op_id)?;
                            applied.insert(op_id);
                            conflicts += 1;
                        }
                        ApplyOutcome::Held => held += 1,
                    }
                }
                if applied.contains(id) {
                    if let Some(doc) = op
                        .get("rename_to")
                        .and_then(|v| v.as_str())
                        .or_else(|| op.get("doc_id").and_then(|v| v.as_str()))
                    {
                        if super::is_syncable_entry(doc) {
                            version_docs.insert(doc.to_string());
                        }
                    }
                }
            }
            if !truncated {
                break;
            }
            let next = pull_res
                .get("next_offset")
                .and_then(|v| v.as_str())
                .and_then(|v| v.parse::<u64>().ok())
                .ok_or_else(|| PluginError::Internal("sync pull missing next_offset".into()))?;
            if next <= offset || ops.is_empty() {
                return Err(PluginError::Internal("sync pull did not advance".into()));
            }
            offset = next;
        }
    }
    for doc in version_docs {
        let path = format!(
            "/v1/sync/versions?vault_id={}&doc_id={}",
            state.vault_id,
            percent_encode(&doc)
        );
        store_versions(root, &http_get(host, &base, &auth, &path)?)?;
    }
    if !applied.is_empty() {
        let ids: Vec<&str> = applied.iter().map(String::as_str).collect();
        http_post(
            host,
            &base,
            &auth,
            "/v1/sync/ack",
            &serde_json::json!({
                "replica_id": state.replica_id, "vault_id": state.vault_id, "ack": ids,
            }),
        )?;
    }
    if held == 0 && do_pull {
        advance_cursor(
            root,
            &snapshot_vv
                .ok_or_else(|| PluginError::Internal("sync pull missing snapshot".into()))?,
        )?;
        let mut cursor = read_cursor(root)?;
        cursor.applied.clear();
        write_cursor(root, &cursor)?;
    }
    let status_path = format!(
        "/v1/sync/status?vault_id={}&replica_id={}",
        percent_encode(&state.vault_id),
        percent_encode(&state.replica_id)
    );
    let status = http_get(host, &base, &auth, &status_path)?;
    let mut entries: Vec<super::sync::SyncStatusEntry> = serde_json::from_value(
        status
            .get("entries")
            .cloned()
            .ok_or_else(|| PluginError::Internal("sync status missing entries".into()))?,
    )
    .map_err(|_| PluginError::Internal("sync status entries malformed".into()))?;
    let pending_rows = read_outbox(root)?;
    let mut pending_by_doc = BTreeMap::new();
    for row in &pending_rows {
        let op = &row["op"];
        let doc = op["doc_id"]
            .as_str()
            .ok_or_else(|| PluginError::Io("sync pending doc malformed".into()))?;
        let vv = vv_parse(&op["vv"])?;
        pending_by_doc.insert(
            doc.to_string(),
            vv.get(&state.replica_id).copied().unwrap_or(0),
        );
    }
    for entry in &mut entries {
        if let Some(counter) = pending_by_doc.remove(&entry.doc_id) {
            entry.state = "pending".to_string();
            entry.local_counter = counter;
        } else {
            entry.local_counter = entry.server_counter;
        }
    }
    for (doc_id, local_counter) in pending_by_doc {
        if entries.len() == 5_000 {
            break;
        }
        entries.push(super::sync::SyncStatusEntry {
            doc_id,
            state: "pending".to_string(),
            local_counter,
            server_counter: 0,
            detail: None,
        });
    }
    let log: Vec<super::views::SyncLogRow> = serde_json::from_value(
        status
            .get("log")
            .cloned()
            .ok_or_else(|| PluginError::Internal("sync status missing log".into()))?,
    )
    .map_err(|_| PluginError::Internal("sync status log malformed".into()))?;
    let snapshot = super::views::SyncSnapshot {
        replica_id: state.replica_id.clone(),
        vault_id: state.vault_id.clone(),
        pending: read_outbox(root)?.len(),
        applied: applied.len(),
        conflicts: read_conflicts(root)?,
        versions: read_versions(root)?,
        entries,
        log,
        entries_truncated: status
            .get("entries_truncated")
            .and_then(|v| v.as_bool())
            .ok_or_else(|| PluginError::Internal("sync status truncation missing".into()))?,
        skipped: too_large.iter().take(MAX_SKIPPED_ROWS).cloned().collect(),
        last_error: pass_error(held, &too_large),
        paused: false,
    };
    super::atomic_state_write(
        root,
        "sync-snapshot.json",
        &serde_json::to_vec(&snapshot)
            .map_err(|_| PluginError::Internal("sync snapshot encode".into()))?,
    )?;
    Ok(serde_json::json!({
        "pushed": acked.len(), "pulled": pulled,
        "applied": applied.len(), "conflicts": conflicts, "held": held,
        "too_large": too_large.len(), "pending": snapshot.pending,
    }))
}
