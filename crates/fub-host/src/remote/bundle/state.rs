//! Lo stato del job su disco, in file atomici sotto la radice: id,
//! cursore, op applicati, outbox e chiave del vault.

use super::*;

// --- state_helpers (file atomici sotto root TRUSTED) ---

pub(super) fn read_id_file(root: &Path, name: &str) -> Result<String, PluginError> {
    let raw = std::fs::read_to_string(root.join(name)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            PluginError::BadArgs("sync not configured".into())
        } else {
            PluginError::Io(format!("sync state read: {e}").into())
        }
    })?;
    let id = raw.trim().to_string();
    if id.is_empty() {
        return Err(PluginError::BadArgs("sync not configured".into()));
    }
    if uuid::Uuid::parse_str(&id).is_err() {
        return Err(PluginError::Io("sync replica identity corrupt".into()));
    }
    Ok(id)
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct JobCursor {
    #[serde(with = "super::vv_string")]
    pub(super) server_vv: BTreeMap<String, u64>,
    pub(super) applied: BTreeSet<String>,
    #[serde(default)]
    pub(super) synced: BTreeMap<String, Revision>,
}

pub(super) fn read_cursor(root: &Path) -> Result<JobCursor, PluginError> {
    let bytes = match std::fs::read(root.join("cursor.json")) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(JobCursor::default()),
        Err(_) => return Err(PluginError::Io("sync cursor unreadable".into())),
    };
    serde_json::from_slice(&bytes)
        .map_err(|_| PluginError::Io("sync cursor corrupt; recovery required".into()))
}

pub(super) fn write_cursor(root: &Path, cursor: &JobCursor) -> Result<(), PluginError> {
    let bytes = serde_json::to_vec(cursor)
        .map_err(|_| PluginError::Internal("sync cursor encoding failed".into()))?;
    super::atomic_state_write(root, "cursor.json", &bytes)
}

pub(super) fn mark_applied(root: &Path, op_id: &str) -> Result<(), PluginError> {
    let mut cursor = read_cursor(root)?;
    cursor.applied.insert(op_id.to_string());
    write_cursor(root, &cursor)
}

pub(super) fn mark_synced(
    root: &Path,
    doc_id: &str,
    revision: Revision,
) -> Result<(), PluginError> {
    let mut cursor = read_cursor(root)?;
    cursor.synced.insert(doc_id.to_string(), revision);
    write_cursor(root, &cursor)
}

pub(super) fn advance_cursor(
    root: &Path,
    server_vv: &BTreeMap<String, u64>,
) -> Result<(), PluginError> {
    let mut cursor = read_cursor(root)?;
    for (replica, counter) in server_vv {
        let current = cursor.server_vv.entry(replica.clone()).or_insert(0);
        *current = (*current).max(*counter);
    }
    write_cursor(root, &cursor)
}

pub(super) fn read_outbox(root: &Path) -> Result<Vec<serde_json::Value>, PluginError> {
    if std::fs::metadata(root.join("outbox.jsonl")).is_ok_and(|info| info.len() > 256 * 1024 * 1024)
    {
        return Err(PluginError::Io(
            "sync outbox exceeds 256 MiB cap; recovery required".into(),
        ));
    }
    let text = match std::fs::read_to_string(root.join("outbox.jsonl")) {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(PluginError::Io("sync outbox unreadable".into())),
    };
    let mut rows = Vec::new();
    for line in text.lines() {
        if line.len() > 10 * 1024 * 1024 {
            return Err(PluginError::Io(
                "sync outbox entry exceeds 10 MiB cap; recovery required".into(),
            ));
        }
        let row: serde_json::Value = serde_json::from_str(line)
            .map_err(|_| PluginError::Io("sync outbox corrupt; recovery required".into()))?;
        if !row.as_object().is_some_and(|fields| {
            fields.len() == 2 && fields.contains_key("op") && fields.contains_key("revision")
        }) {
            return Err(PluginError::Io(
                "sync outbox schema unknown; recovery required".into(),
            ));
        }
        let op: super::sync::WireOp =
            serde_json::from_value(row.get("op").cloned().unwrap_or_default()).map_err(|_| {
                PluginError::Io("sync outbox operation corrupt; recovery required".into())
            })?;
        op.check_shape().map_err(|_| {
            PluginError::Io("sync outbox routing corrupt; recovery required".into())
        })?;
        if !super::is_syncable_entry(&op.doc_id)
            || op.aad != super::canonical_aad_json(&op.envelope())
        {
            return Err(PluginError::Io(
                "sync outbox authentication metadata corrupt; recovery required".into(),
            ));
        }
        let revision: Option<Revision> = serde_json::from_value(
            row.get("revision")
                .ok_or_else(|| {
                    PluginError::Io("sync outbox revision missing; recovery required".into())
                })?
                .clone(),
        )
        .map_err(|_| PluginError::Io("sync outbox revision corrupt; recovery required".into()))?;
        if op.kind.is_delete() != revision.is_none() {
            return Err(PluginError::Io(
                "sync outbox operation/revision mismatch; recovery required".into(),
            ));
        }
        rows.push(row);
    }
    if rows.len() > super::sync::OUTBOX_MAX {
        return Err(PluginError::Io(
            "sync outbox count exceeds cap; recovery required".into(),
        ));
    }
    Ok(rows)
}

pub(super) fn append_outbox(
    state: &JobState,
    fresh: &[serde_json::Value],
) -> Result<(), PluginError> {
    if fresh.is_empty() {
        return Ok(());
    }
    let mut rows = read_outbox(&state.root)?;
    if rows.len().saturating_add(fresh.len()) > super::sync::OUTBOX_MAX {
        return Err(PluginError::Io("sync queue full".into()));
    }
    rows.extend_from_slice(fresh);
    let mut bytes = Vec::new();
    for row in &rows {
        serde_json::to_writer(&mut bytes, row)
            .map_err(|_| PluginError::Internal("sync outbox encode failed".into()))?;
        bytes.push(b'\n');
    }
    if bytes.len() > 256 * 1024 * 1024 {
        return Err(PluginError::Io("sync outbox exceeds 256 MiB cap".into()));
    }
    // Atomic replacement avoids a torn final JSONL record after power loss.
    super::atomic_state_write(&state.root, "outbox.jsonl", &bytes)
}

pub(super) fn drain_outbox(state: &JobState, acked: &BTreeSet<String>) -> Result<(), PluginError> {
    if acked.is_empty() {
        return Ok(());
    }
    let rows = read_outbox(&state.root)?;
    let mut remaining = Vec::new();
    for row in rows {
        if !acked.contains(row["op"]["op_id"].as_str().unwrap_or("")) {
            remaining.push(row);
        }
    }
    let mut bytes = Vec::new();
    for row in remaining {
        serde_json::to_writer(&mut bytes, &row)
            .map_err(|_| PluginError::Internal("sync outbox encode failed".into()))?;
        bytes.push(b'\n');
    }
    super::atomic_state_write(&state.root, "outbox.jsonl", &bytes)
}

pub(super) fn ensure_job_vdk(
    base: &str,
    auth: &str,
    state: &JobState,
    host: &mut dyn HostApi,
) -> Result<[u8; 32], PluginError> {
    let passphrase = super::load_vault_passphrase_from_env()?;
    let path = format!("/v1/sync/vault-key?vault_id={}", state.vault_id);
    match http_get(host, base, auth, &path) {
        Ok(body) => {
            let epoch = body
                .get("key_epoch")
                .and_then(|v| v.as_u64())
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| PluginError::Internal("sync vault key epoch missing".into()))?;
            if epoch != state.key_epoch {
                return Err(PluginError::Conflict(
                    "sync vault key epoch changed; re-pair with a fresh invite before applying"
                        .into(),
                ));
            }
            let wrapped = match std::fs::read(state.root.join("accepted-key.json")) {
                Ok(bytes) => serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|_| {
                    PluginError::Io("sync accepted key corrupt; recovery required".into())
                })?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    body.get("wrapped").cloned().ok_or_else(|| {
                        PluginError::Internal("sync vault key missing envelope".into())
                    })?
                }
                Err(_) => return Err(PluginError::Io("sync accepted key unreadable".into())),
            };
            super::unwrap_for_passphrase(&passphrase, &wrapped)
        }
        Err(PluginError::NotFound(_)) => {
            if !ReplicationMode::configured()?.can_push() {
                return Err(PluginError::NotFound(
                    "read-only sync cannot initialize a vault key".into(),
                ));
            }
            let vdk = super::fresh_vdk()?;
            let wrapped = super::wrap_for_passphrase(&passphrase, &vdk)?;
            http_post(
                host,
                base,
                auth,
                "/v1/sync/vault-key",
                &serde_json::json!({"vault_id": state.vault_id, "wrapped": wrapped}),
            )?;
            Ok(vdk)
        }
        Err(e) => Err(e),
    }
}
