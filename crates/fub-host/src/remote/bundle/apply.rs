//! I conflitti salvati e l'applicazione di un op remoto al vault, con la
//! copia di conflitto.

use super::*;

pub(super) fn read_conflicts(
    root: &Path,
) -> Result<Vec<super::views::SnapshotConflict>, PluginError> {
    match std::fs::read(root.join("conflicts.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| PluginError::Io("sync conflicts corrupt; recovery required".into())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err(PluginError::Io("sync conflicts unreadable".into())),
    }
}

fn store_conflict(
    root: &Path,
    conflict: super::views::SnapshotConflict,
) -> Result<(), PluginError> {
    let mut conflicts = read_conflicts(root)?;
    if !conflicts
        .iter()
        .any(|old| old.doc_id == conflict.doc_id && old.reason == conflict.reason)
    {
        conflicts.push(conflict);
        super::atomic_state_write(
            root,
            "conflicts.json",
            &serde_json::to_vec(&conflicts)
                .map_err(|_| PluginError::Internal("sync conflict encode".into()))?,
        )?;
    }
    Ok(())
}

pub(super) fn report_conflicts(
    root: &Path,
    push_res: &serde_json::Value,
) -> Result<BTreeSet<String>, PluginError> {
    let conflicts = push_res
        .get("conflicts")
        .and_then(|v| v.as_array())
        .ok_or_else(|| PluginError::Internal("sync push missing conflicts".into()))?;
    let mut blocked = BTreeSet::new();
    for conflict in conflicts {
        let row: super::views::SnapshotConflict = serde_json::from_value(conflict.clone())
            .map_err(|_| PluginError::Internal("sync push invalid conflict".into()))?;
        blocked.insert(row.doc_id.clone());
        store_conflict(root, row)?;
    }
    Ok(blocked)
}

pub(super) fn read_versions(
    root: &Path,
) -> Result<Vec<super::views::SnapshotVersion>, PluginError> {
    match std::fs::read(root.join("versions.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| PluginError::Io("sync versions corrupt; recovery required".into())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err(PluginError::Io("sync versions unreadable".into())),
    }
}

pub(super) enum ApplyOutcome {
    Applied { op_id: String },
    Conflict { op_id: String },
    Held,
}

/// Apply di un'op remota VERIFICATA: shape -> epoch -> AAD ricalcolata (mai
/// wire) -> `aad_verify` -> CAS raw (`write_document_bytes`) o testo CAS.
/// Deletes/renames via comandi kernel; binari senza porta = hold (qui la
/// porta ESISTE: `write_document_bytes`, quindi nessun hold finale).
pub(super) fn apply_remote_op(
    host: &mut dyn HostApi,
    state: &JobState,
    vdk: &[u8; 32],
    value: &serde_json::Value,
) -> Result<ApplyOutcome, PluginError> {
    use super::sync::{WireKind, WireOp};
    let op: WireOp = serde_json::from_value(value.clone())
        .map_err(|_| PluginError::Internal("sync pull malformed op".into()))?;
    op.check_shape()
        .map_err(|_| PluginError::Internal("sync pull malformed routing".into()))?;
    if op.vault_id != state.vault_id
        || op.key_epoch != state.key_epoch
        || !super::is_syncable_entry(&op.doc_id)
        || super::is_user_excluded(&state.user_exclude, &op.doc_id)
    {
        return Ok(ApplyOutcome::Held);
    }
    let envelope = op.envelope();
    if !op.aad.is_empty() && op.aad != super::canonical_aad_json(&envelope) {
        return Err(PluginError::Conflict("sync AAD mismatch".into()));
    }
    let plain = super::aad_verify(vdk, &envelope, &op.nonce_b64, &op.ciphertext_b64)
        .map_err(|_| PluginError::Conflict("sync authentication failed".into()))?;
    let id = DocId::new(op.doc_id.clone());
    let cursor = read_cursor(&state.root)?;
    let prior = cursor.synced.get(&op.doc_id);
    let current = match host.document_revision(&id) {
        Ok(revision) => Some(revision),
        Err(PluginError::NotFound(_)) => None,
        Err(e) => return Err(e),
    };
    if op.replica_id == state.replica_id {
        if read_conflicts(&state.root)?
            .iter()
            .any(|conflict| conflict.doc_id == op.doc_id)
        {
            return Ok(ApplyOutcome::Held);
        }
        // Already committed from this replica: a newer local edit or delete
        // must be sent next pass, never overwritten by our own older upload.
        if current.as_ref() != prior {
            return Ok(ApplyOutcome::Applied { op_id: op.op_id });
        }
    }
    if let WireKind::Rename { from, to } = &op.kind {
        if !super::is_syncable_entry(to) || super::is_user_excluded(&state.user_exclude, to) {
            return Ok(ApplyOutcome::Held);
        }
        let to_id = DocId::new(to.clone());
        if current.is_none() {
            let to_revision = match host.document_revision(&to_id) {
                Ok(revision) => Some(revision),
                Err(PluginError::NotFound(_)) => None,
                Err(e) => return Err(e),
            };
            if let Some(revision) = to_revision {
                let bytes = host.read_document_bytes(&to_id)?;
                if host.document_revision(&to_id)? != revision {
                    return Ok(ApplyOutcome::Held);
                }
                if bytes == plain && (prior.is_some() || cursor.synced.get(to) == Some(&revision)) {
                    let mut cursor = read_cursor(&state.root)?;
                    cursor.synced.remove(from);
                    cursor.synced.insert(to.clone(), revision);
                    write_cursor(&state.root, &cursor)?;
                    return Ok(ApplyOutcome::Applied { op_id: op.op_id });
                }
            }
            return Ok(ApplyOutcome::Held);
        }
        if current.as_ref() != prior {
            return Ok(ApplyOutcome::Held);
        }
        // L'operazione porta anche i byte autenticati: prima si applicano al
        // nome di partenza, con la revisione appena confrontata come base, poi
        // si rinomina. Se la rinomina fallisce il contenuto è già quello giusto
        // e la ripresa ha da fare solo lo spostamento.
        if let Some(revision) = current.as_ref() {
            let bytes = host.read_document_bytes(&id)?;
            if host.document_revision(&id)? != *revision {
                return Ok(ApplyOutcome::Held);
            }
            if bytes != plain {
                match host.write_document_bytes(&id, &plain, Some(revision.clone())) {
                    Ok(written) => mark_synced(&state.root, &op.doc_id, written)?,
                    Err(PluginError::Conflict(_)) | Err(PluginError::AlreadyExists(_)) => {
                        return Ok(ApplyOutcome::Held)
                    }
                    Err(e) => return Err(e),
                }
            }
        }
        match host.rename_document(&DocId::new(from.clone()), &to_id) {
            Ok(()) => {
                let mut cursor = read_cursor(&state.root)?;
                cursor.synced.remove(from);
                cursor
                    .synced
                    .insert(to.clone(), host.document_revision(&to_id)?);
                write_cursor(&state.root, &cursor)?;
                return Ok(ApplyOutcome::Applied { op_id: op.op_id });
            }
            Err(PluginError::Conflict(_)) | Err(PluginError::AlreadyExists(_)) => {
                return Ok(ApplyOutcome::Held)
            }
            Err(e) => return Err(e),
        }
    }
    if op.kind.is_delete() {
        if current.is_none() {
            return Ok(ApplyOutcome::Applied { op_id: op.op_id });
        }
        if current.as_ref() != prior {
            return Ok(ApplyOutcome::Held);
        }
        // La revisione confrontata sopra è quella che si cestina: se un
        // salvataggio locale la supera fra il controllo e il cestino, la nota
        // resta e l'operazione remota si trattiene.
        let Some(revision) = current.as_ref() else {
            return Ok(ApplyOutcome::Held);
        };
        match host.trash_document_if(&id, revision) {
            Ok(_) => {}
            Err(PluginError::Conflict(_)) | Err(PluginError::NotFound(_)) => {
                return Ok(ApplyOutcome::Held)
            }
            Err(e) => return Err(e),
        }
        let mut cursor = read_cursor(&state.root)?;
        cursor.synced.remove(&op.doc_id);
        write_cursor(&state.root, &cursor)?;
        return Ok(ApplyOutcome::Applied { op_id: op.op_id });
    }
    if !matches!(op.kind, WireKind::Create | WireKind::Update) {
        return Err(PluginError::Internal("sync unknown operation kind".into()));
    }
    if let Some(revision) = &current {
        let bytes = host.read_document_bytes(&id)?;
        if host.document_revision(&id)? != *revision {
            return Ok(ApplyOutcome::Held);
        }
        if bytes == plain {
            mark_synced(&state.root, &op.doc_id, revision.clone())?;
            return Ok(ApplyOutcome::Applied { op_id: op.op_id });
        }
    }
    if current.is_some() && current.as_ref() != prior {
        // The remote version is deposited in a deterministic, create-only
        // sibling. Never replace a locally divergent original.
        let copy = conflict_copy_id(&op.doc_id, &op.op_id)?;
        let deposited = match host.write_document_bytes(&copy, &plain, None) {
            Ok(_) => true,
            Err(PluginError::AlreadyExists(_)) | Err(PluginError::Conflict(_)) => {
                host.read_document_bytes(&copy)? == plain
            }
            Err(e) => return Err(e),
        };
        if !deposited {
            return Ok(ApplyOutcome::Held);
        }
        store_conflict(
            &state.root,
            super::views::SnapshotConflict {
                doc_id: op.doc_id.clone(),
                reason: "divergent local revision; remote bytes preserved in conflict copy".into(),
                replicas: vec![op.replica_id.clone()],
            },
        )?;
        Ok(ApplyOutcome::Conflict { op_id: op.op_id })
    } else {
        match host.write_document_bytes(&id, &plain, current) {
            Ok(revision) => {
                mark_synced(&state.root, &op.doc_id, revision)?;
                Ok(ApplyOutcome::Applied { op_id: op.op_id })
            }
            Err(PluginError::Conflict(_)) | Err(PluginError::AlreadyExists(_)) => {
                Ok(ApplyOutcome::Held)
            }
            Err(e) => Err(e),
        }
    }
}

/// Il nome della copia di conflitto: accanto all'originale, deterministico
/// sull'op, con l'estensione dell'originale in coda.
///
/// L'estensione si cerca nel **nome** del file, non nel path: in
/// `Progetti.2024/nota` il punto è della cartella, e la copia che lo usasse
/// finirebbe in una cartella nuova, lontana dal file in conflitto. Un nome che
/// comincia col punto (`.gitignore`) non ha estensione.
pub(super) fn conflict_copy_id(doc_id: &str, op_id: &str) -> Result<DocId, PluginError> {
    let name_start = doc_id.rfind('/').map_or(0, |slash| slash + 1);
    let (stem, suffix) = match doc_id[name_start..].rfind('.') {
        Some(dot) if dot > 0 => doc_id.split_at(name_start + dot),
        _ => (doc_id, ""),
    };
    let digest = ring::digest::digest(&ring::digest::SHA256, op_id.as_bytes());
    let mut digest_name = String::with_capacity(24);
    use std::fmt::Write as _;
    for byte in digest.as_ref().iter().take(12) {
        write!(&mut digest_name, "{byte:02x}")
            .map_err(|_| PluginError::Internal("sync conflict name failed".into()))?;
    }
    Ok(DocId::new(format!(
        "{stem}.sync-conflict-{digest_name}{suffix}"
    )))
}
