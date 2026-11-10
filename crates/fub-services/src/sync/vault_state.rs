//! Lo stato di un vault su disco: l'adozione dello stato di una versione
//! precedente, il caricamento e gli op già visti.

use super::*;

/// Dove finisce uno stato precedente che non contiene alcun vault.
pub const LEGACY_STATE_ASIDE: &str = "state.pre-vaults.json";

/// Adotta lo stato di una versione precedente, scritto direttamente in
/// `sync/` e condiviso da tutti i vault.
///
/// - Un solo vault fra catene e code: code, quarantene e stato passano nella
///   sua cartella, lo stato per ultimo, così un'interruzione riprende da capo.
/// - Nessun vault: lo stato si mette da parte in [`LEGACY_STATE_ASIDE`].
/// - Più vault: catene, tombstone e cestino sono già mescolati e non si
///   separano per tentativi. Il sync resta fermo finché l'operatore non
///   recupera lo stato; niente viene riscritto o cancellato.
pub(super) fn adopt_legacy(sync_dir: &Path) -> Result<(), String> {
    let legacy = versions::state_path(sync_dir);
    // `try_exists`, non `exists`: le rename qui sotto sostituiscono la
    // destinazione, e uno stat fallito letto come «non c'è» le farebbe
    // passare sopra uno stato vero.
    let present = |path: &Path| {
        path.try_exists()
            .map_err(|e| format!("legacy sync state stat: {e}"))
    };
    if !present(&legacy)? {
        return Ok(());
    }
    let state = versions::load(sync_dir)?;
    let mut vaults: BTreeSet<String> = state
        .versions
        .values()
        .flatten()
        .map(|version| version.vault_id.clone())
        .collect();
    let mut queues = Vec::new();
    let entries = std::fs::read_dir(sync_dir).map_err(|e| format!("sync dir read: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("sync dir entry: {e}"))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.starts_with("queue-") || !name.ends_with(".jsonl") {
            continue;
        }
        if !name.contains(".corrupt-") {
            let text = std::fs::read_to_string(entry.path())
                .map_err(|e| format!("legacy sync queue read: {e}"))?;
            for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
                let op: SyncOp = serde_json::from_str(line).map_err(|_| {
                    "legacy sync queue has an unreadable line: operator recovery required"
                        .to_string()
                })?;
                vaults.insert(op.vault_id);
            }
        }
        queues.push(entry.path());
    }
    let mut vaults = vaults.into_iter();
    let vault_id = match (vaults.next(), vaults.next()) {
        (Some(vault_id), None) => vault_id,
        (Some(_), Some(_)) => {
            return Err(
                "sync state predates vault partitions and mixes vaults: operator recovery required"
                    .to_string(),
            )
        }
        (None, _) => {
            let aside = sync_dir.join(LEGACY_STATE_ASIDE);
            if present(&aside)? {
                return Err(
                    "legacy sync state already set aside: operator recovery required".to_string(),
                );
            }
            return std::fs::rename(&legacy, &aside).map_err(|e| format!("legacy sync state: {e}"));
        }
    };
    let target = vault_dir(sync_dir, &vault_id);
    std::fs::create_dir_all(&target).map_err(|e| format!("vault sync dir: {e}"))?;
    let adopted = versions::state_path(&target);
    let clash = |to: &Path| {
        if present(to)? {
            return Err("legacy sync state clashes with a vault partition".to_string());
        }
        Ok(())
    };
    clash(&adopted)?;
    for path in &queues {
        let to = target.join(path.file_name().expect("read_dir entry has a name"));
        clash(&to)?;
        std::fs::rename(path, &to).map_err(|e| format!("legacy sync queue move: {e}"))?;
    }
    std::fs::rename(&legacy, &adopted).map_err(|e| format!("legacy sync state move: {e}"))?;
    for dir in [target.as_path(), sync_dir] {
        if let Ok(dir) = std::fs::File::open(dir) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

pub(super) fn load_folded(dir: &Path) -> Result<SyncState, HttpResponse> {
    versions::load(dir).map_err(|e| HttpResponse::err(500, &e))
}

pub(super) fn cap_seen(state: &mut SyncState) {
    if state.seen_op_ids.len() <= MAX_SEEN_OP_IDS {
        return;
    }
    // Version chains are also a durable dedup index for their own op IDs.
    // Keep the separate fast-path set bounded even across >200k live docs.
    let live: BTreeSet<String> = state
        .versions
        .values()
        .flat_map(|chain| chain.iter().map(|v| v.op_id.clone()))
        .collect();
    state.seen_op_ids = state
        .seen_op_ids
        .intersection(&live)
        .take(MAX_SEEN_OP_IDS)
        .cloned()
        .collect();
}

pub(super) fn already_folded(state: &SyncState, op: &SyncOp) -> bool {
    let doc = match &op.kind {
        OpKind::Rename { to, .. } => to,
        _ => &op.doc_id,
    };
    is_duplicate(&state.seen_op_ids, &op.op_id)
        || state
            .versions
            .get(doc)
            .is_some_and(|chain| chain.iter().any(|version| version.op_id == op.op_id))
}
