//! Gli aiuti del job e le azioni dei comandi: pausa e ritenti, segreti,
//! condivisioni, ripristino di una versione e versioni salvate.

use super::*;

// ---------------------------------------------------------------------------
// Helpers del job (solo bundle/runner): root TRUSTED, mai payload/env/cwd.
// ---------------------------------------------------------------------------

/// Policy pausa: UNICA autorità = setting `sync.paused` (persistito); il
/// flag-file è solo specchio operativo crash-safe rivalutato a ogni tick.
pub(crate) fn pause_policy(
    root: &Path,
    host: &mut dyn HostApi,
    paused: bool,
) -> Result<(), PluginError> {
    host.set_setting(super::SETTING_PAUSED, SettingValue::Toggle(paused))?;
    let flag = root.join("sync-paused");
    if paused {
        super::atomic_state_write(root, "sync-paused", b"paused\n")?;
    } else if flag.exists() {
        std::fs::remove_file(&flag).map_err(|_| PluginError::Io("sync resume failed".into()))?;
        super::sync_dir(root).map_err(|_| PluginError::Io("sync resume flush failed".into()))?;
    }
    Ok(())
}

/// Explicit retry releases a held conflict and reschedules the current
/// document as a new operation. A missing source keeps its synced marker so
/// the next pass can emit a tombstone instead.
pub(crate) fn mark_retry(state_dir: &Path, doc: &str) -> Result<(), PluginError> {
    clear_conflict(state_dir, doc)?;
    let mut cursor = read_cursor(state_dir)?;
    cursor.synced.remove(doc);
    write_cursor(state_dir, &cursor)
}

pub(super) fn clear_conflict(root: &Path, doc: &str) -> Result<(), PluginError> {
    let mut conflicts = read_conflicts(root)?;
    if conflicts.iter().any(|row| row.doc_id == doc) {
        conflicts.retain(|row| row.doc_id != doc);
        super::atomic_state_write(
            root,
            "conflicts.json",
            &serde_json::to_vec(&conflicts)
                .map_err(|_| PluginError::Internal("sync conflict encode".into()))?,
        )?;
    }
    Ok(())
}

/// Secrets never enter job payloads, command history or URLs. The caller
/// explicitly names a file for invite tokens / MFA codes / invitee KEKs.
fn secret_from_file(name: &str) -> Result<String, PluginError> {
    let path = std::env::var(name)
        .map_err(|_| PluginError::BadArgs(format!("{name} is required").into()))?;
    let metadata = std::fs::metadata(&path)
        .map_err(|_| PluginError::PermissionDenied("sync secret file unavailable".into()))?;
    if !metadata.is_file() || metadata.len() > 4_096 {
        return Err(PluginError::BadArgs(
            "sync secret file must be a small regular file".into(),
        ));
    }
    #[cfg(unix)]
    let group_or_other_bits = {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o077 != 0
    };
    #[cfg(unix)]
    if group_or_other_bits {
        return Err(PluginError::PermissionDenied(
            "sync secret file must be owner-only".into(),
        ));
    }
    let value = std::fs::read_to_string(&path)
        .map_err(|_| PluginError::PermissionDenied("sync secret file unreadable".into()))?;
    let value = value.trim_end_matches(['\r', '\n']).to_string();
    if value.is_empty() {
        return Err(PluginError::BadArgs("sync secret file empty".into()));
    }
    Ok(value)
}

fn share_connection(
    root: &Path,
    token: &super::TokenSource,
    host: &mut dyn HostApi,
) -> Result<(String, String, JobState), PluginError> {
    let base = super::resolve_endpoint(host)?;
    super::check_endpoint_binding(root, &base).map_err(|e| e.to_plugin_error())?;
    let token = token
        .load()
        .ok_or_else(|| PluginError::PermissionDenied("missing credentials".into()))?;
    let state = JobState::open(root, None, host)?;
    let hello = http_get(host, &base, &format!("Bearer {token}"), "/v1/hello")?;
    if hello.get("protocol").and_then(|v| v.as_str()) != Some(super::SYNC_PROTOCOL) {
        return Err(PluginError::Internal("sync protocol mismatch".into()));
    }
    super::store_endpoint_binding(root, &base)
        .map_err(|_| PluginError::Io("sync endpoint binding failed".into()))?;
    Ok((base, format!("Bearer {token}"), state))
}

pub(super) fn run_share_action(
    root: &Path,
    token: &super::TokenSource,
    host: &mut dyn HostApi,
    action: &str,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, PluginError> {
    let _lock = JobLock::acquire(root)?;
    if action == "rekey" {
        if ReplicationMode::configured()? != ReplicationMode::Bidirectional {
            return Err(PluginError::BadArgs(
                "rekey needs bidirectional mode".into(),
            ));
        }
        check_external_overlap(host)?;
    }
    let (base, auth, state) = share_connection(root, token, host)?;
    match action {
        "invite" => {
            let role = payload
                .get("role")
                .and_then(|v| v.as_str())
                .filter(|role| matches!(*role, "reader" | "writer" | "admin"))
                .ok_or_else(|| PluginError::BadArgs("sync invite needs role".into()))?;
            let vdk = ensure_job_vdk(&base, &auth, &state, host)?;
            let passphrase = match std::env::var("FUB_SYNC_INVITE_PASSPHRASE_FILE") {
                Ok(_) => secret_from_file("FUB_SYNC_INVITE_PASSPHRASE_FILE")?,
                Err(_) => super::load_vault_passphrase_from_env()?,
            };
            let wrapped = super::wrap_for_passphrase(&passphrase, &vdk)?;
            let code = if std::env::var_os("FUB_SYNC_MFA_CODE_FILE").is_some() {
                Some(secret_from_file("FUB_SYNC_MFA_CODE_FILE")?)
            } else {
                None
            };
            http_post(
                host,
                &base,
                &auth,
                "/v1/sync/invite",
                &serde_json::json!({
                    "vault_id": state.vault_id, "role": role, "code": code,
                    "wrapped_vdk": wrapped,
                }),
            )
        }
        "accept" => {
            let token = secret_from_file("FUB_SYNC_INVITE_TOKEN_FILE")?;
            let reply = http_post(
                host,
                &base,
                &auth,
                "/v1/sync/invite/accept",
                &serde_json::json!({"token_b64": token}),
            )?;
            let vault = reply
                .get("resource")
                .and_then(|v| v.as_str())
                .and_then(|value| value.strip_prefix("vault:"))
                .filter(|value| {
                    !value.is_empty()
                        && value
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
                })
                .ok_or_else(|| PluginError::Internal("sync invite resource invalid".into()))?;
            let wrapped = reply
                .get("wrapped_vdk")
                .filter(|value| !value.is_null())
                .ok_or_else(|| {
                    PluginError::Conflict(
                        "invite has no wrapped vault key; request a new key-bearing invite".into(),
                    )
                })?;
            let passphrase = super::load_vault_passphrase_from_env()?;
            super::unwrap_for_passphrase(&passphrase, wrapped)?;
            let epoch = reply
                .get("key_epoch")
                .and_then(|v| v.as_u64())
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| PluginError::Internal("sync invite epoch missing".into()))?;
            if vault != state.vault_id {
                if !read_outbox(root)?.is_empty() || !read_cursor(root)?.synced.is_empty() {
                    return Err(PluginError::Conflict(
                        "invite vault differs from an active local pairing".into(),
                    ));
                }
                super::atomic_state_write(root, "vault-pairing", vault.as_bytes())?;
            }
            super::atomic_state_write(
                root,
                "accepted-key.json",
                &serde_json::to_vec(wrapped)
                    .map_err(|_| PluginError::Internal("sync invite key encode failed".into()))?,
            )?;
            super::atomic_state_write(root, "key-epoch", epoch.to_string().as_bytes())?;
            Ok(serde_json::json!({"accepted": vault, "role": reply["role"], "key_epoch": epoch}))
        }
        "revoke" => {
            let account_id = payload
                .get("account_id")
                .and_then(|v| v.as_str())
                .filter(|value| {
                    !value.is_empty()
                        && value.len() <= 128
                        && value
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                })
                .ok_or_else(|| PluginError::BadArgs("sync revoke needs account_id".into()))?;
            let code = if std::env::var_os("FUB_SYNC_MFA_CODE_FILE").is_some() {
                Some(secret_from_file("FUB_SYNC_MFA_CODE_FILE")?)
            } else {
                None
            };
            let mut result = http_post(
                host,
                &base,
                &auth,
                "/v1/sync/revoke",
                &serde_json::json!({"vault_id": state.vault_id,
                    "account_id": account_id, "code": code}),
            )?;
            result["rekey_required"] = serde_json::Value::Bool(true);
            Ok(result)
        }
        "rekey" => {
            if !read_outbox(root)?.is_empty() || !read_conflicts(root)?.is_empty() {
                return Err(PluginError::Conflict(
                    "sync rekey needs drained outbox and resolved conflicts".into(),
                ));
            }
            let status_path = format!(
                "/v1/sync/status?vault_id={}&replica_id={}",
                percent_encode(&state.vault_id),
                percent_encode(&state.replica_id)
            );
            let status = http_get(host, &base, &auth, &status_path)?;
            // Il passaggio salta un file troppo grande; la nuova chiave invece
            // deve cifrare tutto, quindi qui quel file ferma il rekey.
            let Collected { docs, too_large } = collect_job_docs(
                host,
                &state.user_exclude,
                &BTreeMap::new(),
                &BTreeSet::new(),
                &[],
            )?;
            if !too_large.is_empty()
                || docs
                    .iter()
                    .any(|doc| doc.bytes.len() > super::sync::MAX_DOC_BYTES)
                || status["entries_truncated"].as_bool() != Some(false)
            {
                return Err(PluginError::Conflict(
                    "sync rekey needs all files present and under the single-op cap".into(),
                ));
            }
            let present: BTreeSet<&str> = docs.iter().map(|doc| doc.id.as_str()).collect();
            let entries = status["entries"]
                .as_array()
                .ok_or_else(|| PluginError::Internal("sync rekey status missing entries".into()))?;
            if entries.iter().any(|entry| {
                entry["state"].as_str() == Some("conflict")
                    || entry["state"].as_str() == Some("synced")
                        && !entry["doc_id"]
                            .as_str()
                            .is_some_and(|id| present.contains(id))
            }) {
                return Err(PluginError::Conflict(
                    "sync rekey requires a complete local replica".into(),
                ));
            }
            let key_path = format!(
                "/v1/sync/vault-key?vault_id={}",
                percent_encode(&state.vault_id)
            );
            let previous = http_get(host, &base, &auth, &key_path)?;
            let hash = previous["wrapped_hash"]
                .as_str()
                .ok_or_else(|| PluginError::Internal("sync current key hash missing".into()))?;
            let old_epoch = previous["key_epoch"]
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(|| PluginError::Internal("sync current epoch missing".into()))?;
            if old_epoch != state.key_epoch {
                return Err(PluginError::Conflict(
                    "sync key epoch changed; refresh before rekey".into(),
                ));
            }
            // Preserve the old wrapped envelope for owner-only historical
            // recovery; the service never sees the plaintext VDK.
            let backup_name = format!("prior-key-{old_epoch}.json");
            if !root.join(&backup_name).exists() {
                super::atomic_state_write(
                    root,
                    &backup_name,
                    &serde_json::to_vec(&previous["wrapped"])
                        .map_err(|_| PluginError::Internal("sync old key encode failed".into()))?,
                )?;
            }
            let mut cursor = read_cursor(root)?;
            cursor.synced.clear();
            write_cursor(root, &cursor)?;
            let next = old_epoch
                .checked_add(1)
                .ok_or_else(|| PluginError::Conflict("sync key epoch exhausted".into()))?;
            let passphrase = super::load_vault_passphrase_from_env()?;
            let vdk = super::fresh_vdk()?;
            let wrapped = super::wrap_for_passphrase(&passphrase, &vdk)?;
            let result = http_post(
                host,
                &base,
                &auth,
                "/v1/sync/vault-key",
                &serde_json::json!({
                    "vault_id": state.vault_id, "wrapped": wrapped,
                    "expected_wrapped_hash": hash, "key_epoch": next,
                }),
            )?;
            if result["key_epoch"].as_u64() != Some(u64::from(next)) {
                return Err(PluginError::Internal("sync rekey epoch mismatch".into()));
            }
            super::atomic_state_write(root, "key-epoch", next.to_string().as_bytes())?;
            Ok(
                serde_json::json!({"key_epoch": next, "republish_required": true,
                "old_key_retained_locally": true}),
            )
        }
        _ => Err(PluginError::BadArgs("unknown sync share action".into())),
    }
}

/// Un restore storico è una nuova scrittura locale CAS; il prossimo passaggio
/// la cifra in una nuova op. L'op vecchia resta immutata e mai ritrasmessa.
pub(crate) fn request_restore(
    root: &Path,
    token: &super::TokenSource,
    host: &mut dyn HostApi,
    doc: &str,
    version: u64,
) -> Result<serde_json::Value, PluginError> {
    if !super::is_syncable_entry(doc) {
        return Err(PluginError::BadArgs("sync restore path excluded".into()));
    }
    if ReplicationMode::configured()? != ReplicationMode::Bidirectional {
        return Err(PluginError::BadArgs(
            "restore needs bidirectional mode for a fresh encrypted write".into(),
        ));
    }
    check_external_overlap(host)?;
    let _lock = JobLock::acquire(root)?;
    let base = super::resolve_endpoint(host)?;
    super::check_endpoint_binding(root, &base).map_err(|e| e.to_plugin_error())?;
    let token = token
        .load()
        .ok_or_else(|| PluginError::PermissionDenied("missing credentials".into()))?;
    let auth = format!("Bearer {token}");
    let state = JobState::open(root, None, host)?;
    let hello = http_get(host, &base, &auth, "/v1/hello")?;
    if hello.get("protocol").and_then(|v| v.as_str()) != Some(super::SYNC_PROTOCOL) {
        return Err(PluginError::Internal("sync protocol mismatch".into()));
    }
    super::store_endpoint_binding(root, &base)
        .map_err(|_| PluginError::Io("sync endpoint binding failed".into()))?;
    let vdk = ensure_job_vdk(&base, &auth, &state, host)?;
    let response = http_post(
        host,
        &base,
        &auth,
        "/v1/sync/restore",
        &serde_json::json!({
            "vault_id": state.vault_id, "doc_id": doc, "version": version.to_string(),
        }),
    )?;
    if response.get("version").and_then(|v| v.as_str()) != Some(version.to_string().as_str())
        || response
            .get("requires_fresh_push")
            .and_then(|v| v.as_bool())
            != Some(true)
    {
        return Err(PluginError::Internal(
            "sync restore response malformed".into(),
        ));
    }
    let raw = response
        .get("source_op")
        .ok_or_else(|| PluginError::Internal("sync restore source missing".into()))?;
    let op: super::sync::WireOp = serde_json::from_value(raw.clone())
        .map_err(|_| PluginError::Internal("sync historical op malformed".into()))?;
    op.check_shape()
        .map_err(|_| PluginError::Internal("sync historical routing malformed".into()))?;
    let selected_doc = match &op.kind {
        super::sync::WireKind::Create | super::sync::WireKind::Update => op.doc_id.as_str(),
        super::sync::WireKind::Rename { to, .. } => to.as_str(),
        _ => "",
    };
    if selected_doc != doc || op.vault_id != state.vault_id {
        return Err(PluginError::Conflict(
            "sync historical version cannot be restored".into(),
        ));
    }
    let historic_key = if op.key_epoch == state.key_epoch {
        vdk
    } else if op.key_epoch < state.key_epoch {
        let old =
            std::fs::read(root.join(format!("prior-key-{}.json", op.key_epoch))).map_err(|_| {
                PluginError::Conflict("sync historical key not available on this device".into())
            })?;
        let wrapped: serde_json::Value = serde_json::from_slice(&old)
            .map_err(|_| PluginError::Io("sync historical wrapped key corrupt".into()))?;
        let passphrase = super::load_vault_passphrase_from_env()?;
        super::unwrap_for_passphrase(&passphrase, &wrapped)?
    } else {
        return Err(PluginError::Conflict(
            "sync historical key epoch is newer than local pairing".into(),
        ));
    };
    let envelope = op.envelope();
    if !op.aad.is_empty() && op.aad != super::canonical_aad_json(&envelope) {
        return Err(PluginError::Conflict("sync historical AAD mismatch".into()));
    }
    let plain = super::aad_verify(&historic_key, &envelope, &op.nonce_b64, &op.ciphertext_b64)
        .map_err(|_| PluginError::Conflict("sync historical authentication failed".into()))?;
    let id = DocId::new(doc.to_string());
    let expected = match host.document_revision(&id) {
        Ok(revision) => Some(revision),
        Err(PluginError::NotFound(_)) => None,
        Err(e) => return Err(e),
    };
    host.write_document_bytes(&id, &plain, expected)?;
    mark_retry(root, doc)?;
    Ok(
        serde_json::json!({"restored": doc, "version": version.to_string(), "requires_fresh_push": true}),
    )
}

pub(super) fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub(super) fn store_versions(root: &Path, response: &serde_json::Value) -> Result<(), PluginError> {
    let rows = response
        .get("versions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| PluginError::Internal("sync versions missing array".into()))?;
    let mut all = read_versions(root)?;
    for value in rows {
        let row: super::views::SnapshotVersion = serde_json::from_value(value.clone())
            .map_err(|_| PluginError::Internal("sync version metadata invalid".into()))?;
        all.retain(|prior| prior.doc_id != row.doc_id || prior.version != row.version);
        all.push(row);
    }
    super::atomic_state_write(
        root,
        "versions.json",
        &serde_json::to_vec(&all)
            .map_err(|_| PluginError::Internal("sync versions encode".into()))?,
    )
}
