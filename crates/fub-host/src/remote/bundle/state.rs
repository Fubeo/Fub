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
    write_outbox(&state.root, &rows)
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
    write_outbox(&state.root, &remaining)
}

/// Riscrive la coda intera, atomica: niente riga JSONL troncata dopo un
/// calo di corrente.
pub(super) fn write_outbox(root: &Path, rows: &[serde_json::Value]) -> Result<(), PluginError> {
    let mut bytes = Vec::new();
    for row in rows {
        serde_json::to_writer(&mut bytes, row)
            .map_err(|_| PluginError::Internal("sync outbox encode failed".into()))?;
        bytes.push(b'\n');
    }
    if bytes.len() > 256 * 1024 * 1024 {
        return Err(PluginError::Io("sync outbox exceeds 256 MiB cap".into()));
    }
    super::atomic_state_write(root, "outbox.jsonl", &bytes)
}

/// Il file della chiave accettata con un invito.
pub(super) const ACCEPTED_KEY_FILE: &str = "accepted-key.json";

/// La chiave accettata con un invito, legata alla sua epoca.
///
/// `accept` la scrive come `{"key_epoch": N, "wrapped": {…}}`; i client di
/// prima scrivevano la busta nuda, senza epoca (`epoch: None`).
pub(super) struct AcceptedKey {
    pub(super) epoch: Option<u32>,
    pub(super) wrapped: serde_json::Value,
}

pub(super) fn accepted_key_json(epoch: u32, wrapped: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({"key_epoch": epoch, "wrapped": wrapped})
}

pub(super) fn read_accepted_key(root: &Path) -> Result<Option<AcceptedKey>, PluginError> {
    let bytes = match std::fs::read(root.join(ACCEPTED_KEY_FILE)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(PluginError::Io("sync accepted key unreadable".into())),
    };
    let corrupt = || PluginError::Io("sync accepted key corrupt; recovery required".into());
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| corrupt())?;
    let bound = value
        .as_object()
        .filter(|fields| fields.len() == 2 && fields.contains_key("wrapped"))
        .and_then(|fields| fields.get("key_epoch"));
    Ok(Some(match bound {
        Some(epoch) => AcceptedKey {
            epoch: Some(
                epoch
                    .as_u64()
                    .and_then(|value| u32::try_from(value).ok())
                    .ok_or_else(corrupt)?,
            ),
            wrapped: value["wrapped"].clone(),
        },
        None => AcceptedKey {
            epoch: None,
            wrapped: value,
        },
    }))
}

/// Il nome della chiave accettata messa da parte all'epoca `epoch`.
pub(super) fn prior_accepted_key_file(epoch: u32) -> String {
    format!("prior-accepted-key-{epoch}.json")
}

/// Mette da parte la chiave accettata quando il server ne serve un'altra
/// (dopo un rekey, o una chiave creata da capo): non si sigilla più con lei,
/// ma resta in [`prior_accepted_key_file`] come busta nuda per riaprire le
/// versioni storiche di quell'epoca. Una copia già presente non si
/// sovrascrive: la nuova prende un nome unico accanto.
pub(super) fn retire_accepted_key(root: &Path, epoch: u32) -> Result<(), PluginError> {
    let Some(accepted) = read_accepted_key(root)? else {
        return Ok(());
    };
    let mut name = prior_accepted_key_file(epoch);
    if root.join(&name).exists() {
        name = format!(
            "prior-accepted-key-{epoch}-{}.json",
            super::new_replica_id()
        );
    }
    // La busta nuda, come `prior-key-<epoca>.json`: `Value` si scrive sempre.
    super::atomic_state_write(root, &name, accepted.wrapped.to_string().as_bytes())?;
    std::fs::remove_file(root.join(ACCEPTED_KEY_FILE))
        .and_then(|()| super::sync_dir(root))
        .map_err(|e| PluginError::Io(format!("sync accepted key retire: {e}").into()))
}

/// La chiave dell'epoca `epoch` servita dal server, aperta su questo
/// dispositivo.
///
/// Una chiave accettata con un invito vale soltanto per la sua epoca: dopo un
/// rekey è quella vecchia, e sigillare con lei renderebbe illeggibili i nuovi
/// op per chi ha la chiave nuova. Il file legato a un'altra epoca si ignora;
/// quello dei client di prima, senza epoca, resta il ripiego quando la busta
/// del server non si apre con questa passphrase (invito con un'altra
/// passphrase), mai la prima scelta.
fn served_vault_key(
    root: &Path,
    passphrase: &str,
    body: &serde_json::Value,
    epoch: u32,
) -> Result<[u8; 32], PluginError> {
    let accepted = read_accepted_key(root)?;
    if let Some(AcceptedKey {
        epoch: Some(bound),
        wrapped,
    }) = &accepted
    {
        if *bound == epoch {
            return super::unwrap_for_passphrase(passphrase, wrapped);
        }
    }
    let served = body
        .get("wrapped")
        .ok_or_else(|| PluginError::Internal("sync vault key missing envelope".into()))?;
    match super::unwrap_for_passphrase(passphrase, served) {
        Ok(vdk) => Ok(vdk),
        Err(error) => match accepted {
            Some(AcceptedKey {
                epoch: None,
                wrapped,
            }) => super::unwrap_for_passphrase(passphrase, &wrapped),
            _ => Err(error),
        },
    }
}

/// Adotta l'epoca servita dal server e la salva prima di sigillare.
///
/// Gli op già in coda sigillati con un'altra epoca (i client di prima
/// sigillavano il primo passaggio con zero mentre il server assegnava uno) si
/// risigillano con la stessa chiave e la nuova epoca: stesso `op_id`, stesso
/// vettore, stesso istante, solo AAD, nonce e cifrato nuovi. Se uno non si apre
/// con questa chiave la coda resta com'è, intatta, e l'errore lo dice: niente
/// op perso o riscritto a metà. La coda si riscrive prima del file
/// dell'epoca, così un'interruzione in mezzo si riprende al passaggio dopo.
pub(super) fn adopt_key_epoch(
    state: &mut JobState,
    vdk: &[u8; 32],
    epoch: u32,
) -> Result<(), PluginError> {
    let rows = read_outbox(&state.root)?;
    let mut resealed = Vec::with_capacity(rows.len());
    let mut changed = false;
    for mut row in rows {
        let op: super::sync::WireOp = serde_json::from_value(row["op"].clone()).map_err(|_| {
            PluginError::Io("sync outbox operation corrupt; recovery required".into())
        })?;
        if op.key_epoch != epoch {
            let plain = super::aad_verify(vdk, &op.envelope(), &op.nonce_b64, &op.ciphertext_b64)
                .map_err(|_| unserved_outbox())?;
            let mut envelope = op.envelope();
            envelope.key_epoch = epoch;
            let (nonce_b64, ciphertext_b64) = super::encrypt_envelope(vdk, &envelope, &plain)
                .map_err(|_| PluginError::Internal("sync reseal failed".into()))?;
            row["op"]["key_epoch"] = epoch.into();
            row["op"]["aad"] = super::canonical_aad_json(&envelope).into();
            row["op"]["nonce_b64"] = nonce_b64.into();
            row["op"]["ciphertext_b64"] = ciphertext_b64.into();
            changed = true;
        }
        resealed.push(row);
    }
    if changed {
        write_outbox(&state.root, &resealed)?;
    }
    super::atomic_state_write(&state.root, "key-epoch", epoch.to_string().as_bytes())?;
    state.key_epoch = epoch;
    Ok(())
}

/// Coda sigillata con una chiave che il server non serve: si tiene com'è, e
/// l'errore lo dice nella lingua di chi guarda.
fn unserved_outbox() -> PluginError {
    PluginError::Conflict(fub_abi::text::Text::key("host.sync.outbox_unserved_key"))
}

/// La chiave del vault per questo passaggio, con l'epoca adottata.
///
/// L'epoca della prima chiave è [`super::INITIAL_KEY_EPOCH`]; zero nel file
/// `key-epoch` vuol dire «non ancora adottata». Il primo passaggio crea la
/// chiave a quell'epoca e la salva prima di restituirla. Un dispositivo a zero
/// che trova il server all'epoca iniziale la adotta, se la chiave si apre: è
/// il primo passaggio interrotto dopo il caricamento, o il vault di un client
/// di prima. Ogni altra differenza di epoca chiede un invito nuovo.
pub(super) fn ensure_job_vdk(
    base: &str,
    auth: &str,
    state: &mut JobState,
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
            let adopting = state.key_epoch == 0 && epoch == super::INITIAL_KEY_EPOCH;
            if epoch != state.key_epoch && !adopting {
                return Err(PluginError::Conflict(fub_abi::text::Text::key(
                    "host.sync.key_epoch_changed",
                )));
            }
            let vdk = served_vault_key(&state.root, &passphrase, &body, epoch)?;
            if adopting {
                adopt_key_epoch(state, &vdk, epoch)?;
            }
            Ok(vdk)
        }
        Err(PluginError::NotFound(_)) => {
            if !ReplicationMode::configured()?.can_push() {
                return Err(PluginError::NotFound(fub_abi::text::Text::key(
                    "host.sync.read_only_no_key",
                )));
            }
            // Una coda sigillata con una chiave che il server non ha più non
            // si apre con una chiave nuova: si tiene, e non si crea niente.
            if !read_outbox(&state.root)?.is_empty() {
                return Err(unserved_outbox());
            }
            let vdk = super::fresh_vdk()?;
            let wrapped = super::wrap_for_passphrase(&passphrase, &vdk)?;
            let epoch = super::INITIAL_KEY_EPOCH;
            let reply = http_post(
                host,
                base,
                auth,
                "/v1/sync/vault-key",
                &serde_json::json!({
                    "vault_id": state.vault_id, "wrapped": wrapped, "key_epoch": epoch,
                }),
            )?;
            if reply.get("key_epoch").and_then(|v| v.as_u64()) != Some(u64::from(epoch)) {
                return Err(PluginError::Internal(
                    "sync vault key epoch mismatch".into(),
                ));
            }
            retire_accepted_key(&state.root, state.key_epoch)?;
            super::atomic_state_write(&state.root, "key-epoch", epoch.to_string().as_bytes())?;
            state.key_epoch = epoch;
            Ok(vdk)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod key_epoch_tests {
    use super::*;
    use crate::remote::sync::{WireKind, WireOp};
    use fub_sdk::testing::MemoryHost;

    const VDK: [u8; 32] = [9; 32];
    const OTHER: [u8; 32] = [4; 32];
    const PASSPHRASE: &str = "passphrase del vault per i test dell'epoca";

    fn state(root: &Path, key_epoch: u32) -> JobState {
        JobState {
            root: root.to_path_buf(),
            replica_id: "local".into(),
            vault_id: "vault".into(),
            key_epoch,
            user_exclude: Vec::new(),
        }
    }

    /// Una riga di coda come la scrive il passaggio, sigillata con `vdk`.
    fn row(
        vdk: &[u8; 32],
        op_id: &str,
        kind: WireKind,
        epoch: u32,
        plain: &[u8],
        revision: Option<Revision>,
    ) -> serde_json::Value {
        let mut op = WireOp {
            op_id: op_id.into(),
            replica_id: "local".into(),
            doc_id: "n.md".into(),
            kind,
            vv: BTreeMap::from([("local".to_string(), 3)]),
            ciphertext_b64: String::new(),
            nonce_b64: String::new(),
            aad: String::new(),
            ts_ms: 42,
            vault_id: "vault".into(),
            key_epoch: epoch,
            rename_from: None,
            rename_to: None,
        };
        let envelope = op.envelope();
        op.aad = crate::remote::canonical_aad_json(&envelope);
        let (nonce, ciphertext) = crate::remote::encrypt_envelope(vdk, &envelope, plain).unwrap();
        op.nonce_b64 = nonce;
        op.ciphertext_b64 = ciphertext;
        serde_json::json!({"op": op, "revision": revision})
    }

    fn revision() -> Revision {
        let host = MemoryHost::new().with_document("n.md", "testo");
        fub_abi::traits::VaultRead::document_revision(&host, &DocId::new("n.md")).unwrap()
    }

    fn open(row: &serde_json::Value) -> (WireOp, Vec<u8>) {
        let op: WireOp = serde_json::from_value(row["op"].clone()).unwrap();
        let plain =
            crate::remote::aad_verify(&VDK, &op.envelope(), &op.nonce_b64, &op.ciphertext_b64)
                .expect("the row opens with its own epoch");
        (op, plain)
    }

    /// I client di prima sigillavano il primo passaggio con zero mentre il
    /// server assegnava uno: quella coda si risigilla, senza perdere niente.
    #[test]
    fn an_outbox_sealed_at_epoch_zero_is_resealed_when_the_epoch_is_adopted() {
        let dir = tempfile::tempdir().unwrap();
        let mut job = state(dir.path(), 0);
        let rows = [
            row(
                &VDK,
                "op-1",
                WireKind::Update,
                0,
                b"testo",
                Some(revision()),
            ),
            row(&VDK, "op-2", WireKind::Delete, 0, b"", None),
        ];
        write_outbox(dir.path(), &rows).unwrap();

        adopt_key_epoch(&mut job, &VDK, INITIAL_KEY_EPOCH).unwrap();

        assert_eq!(job.key_epoch, INITIAL_KEY_EPOCH);
        assert_eq!(
            crate::remote::load_key_epoch(dir.path()),
            Ok(INITIAL_KEY_EPOCH)
        );
        let resealed = read_outbox(dir.path()).expect("the resealed outbox reads back");
        assert_eq!(resealed.len(), 2);
        for (before, after) in rows.iter().zip(&resealed) {
            for field in ["op_id", "vv", "ts_ms", "doc_id", "kind", "replica_id"] {
                assert_eq!(after["op"][field], before["op"][field], "{field} kept");
            }
            assert_eq!(after["revision"], before["revision"]);
            let (op, plain) = open(after);
            assert_eq!(op.key_epoch, INITIAL_KEY_EPOCH);
            assert_eq!(plain, open(before).1, "same bytes under the new epoch");
        }
    }

    /// Una coda che la chiave servita non apre resta intatta, e l'errore è
    /// tipizzato: nessun op perso, nessuna epoca adottata a metà.
    #[test]
    fn an_outbox_the_served_key_cannot_open_stays_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let mut job = state(dir.path(), 0);
        write_outbox(
            dir.path(),
            &[
                row(&VDK, "op-1", WireKind::Update, 0, b"a", Some(revision())),
                row(&OTHER, "op-2", WireKind::Update, 0, b"b", Some(revision())),
            ],
        )
        .unwrap();
        let before = std::fs::read(dir.path().join("outbox.jsonl")).unwrap();

        let error = adopt_key_epoch(&mut job, &VDK, INITIAL_KEY_EPOCH).unwrap_err();

        assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
        assert_eq!(
            std::fs::read(dir.path().join("outbox.jsonl")).unwrap(),
            before
        );
        assert!(!dir.path().join("key-epoch").exists());
        assert_eq!(job.key_epoch, 0);
    }

    /// La chiave accettata con un invito vale solo per la sua epoca; quella
    /// nuda dei client di prima è il ripiego, non la prima scelta.
    #[test]
    fn an_accepted_key_counts_only_for_its_epoch() {
        let dir = tempfile::tempdir().unwrap();
        let accepted =
            serde_json::to_value(crate::remote::wrap_for_passphrase(PASSPHRASE, &OTHER).unwrap())
                .unwrap();
        let served = serde_json::json!({
            "wrapped": crate::remote::wrap_for_passphrase(PASSPHRASE, &VDK).unwrap(),
        });
        let foreign = serde_json::json!({
            "wrapped": crate::remote::wrap_for_passphrase("un'altra passphrase ancora", &VDK)
                .unwrap(),
        });
        let write = |value: &serde_json::Value| {
            atomic_state_write(
                dir.path(),
                ACCEPTED_KEY_FILE,
                &serde_json::to_vec(value).unwrap(),
            )
            .unwrap()
        };

        write(&accepted_key_json(1, &accepted));
        assert_eq!(
            served_vault_key(dir.path(), PASSPHRASE, &foreign, 1).unwrap(),
            OTHER
        );
        assert_eq!(
            served_vault_key(dir.path(), PASSPHRASE, &served, 2).unwrap(),
            VDK,
            "after a rekey the served key wins over the old accepted one"
        );
        assert!(served_vault_key(dir.path(), PASSPHRASE, &foreign, 2).is_err());

        write(&accepted);
        assert_eq!(
            served_vault_key(dir.path(), PASSPHRASE, &served, 2).unwrap(),
            VDK
        );
        assert_eq!(
            served_vault_key(dir.path(), PASSPHRASE, &foreign, 1).unwrap(),
            OTHER,
            "a legacy accepted key still opens a vault invited with another passphrase"
        );
    }

    /// Al rekey la chiave accettata esce dal passaggio ma resta per lo
    /// storico, come busta nuda; una copia già messa da parte non si perde.
    #[test]
    fn a_retired_accepted_key_is_kept_for_history() {
        let dir = tempfile::tempdir().unwrap();
        let first = serde_json::json!({"busta": 1});
        let second = serde_json::json!({"busta": 2});
        let write = |value: &serde_json::Value| {
            atomic_state_write(
                dir.path(),
                ACCEPTED_KEY_FILE,
                &serde_json::to_vec(value).unwrap(),
            )
            .unwrap()
        };
        retire_accepted_key(dir.path(), 1).expect("nothing to retire is fine");

        write(&accepted_key_json(1, &first));
        retire_accepted_key(dir.path(), 1).unwrap();
        assert!(!dir.path().join(ACCEPTED_KEY_FILE).exists());
        let kept = std::fs::read(dir.path().join(prior_accepted_key_file(1))).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&kept).unwrap(),
            first
        );

        write(&second);
        retire_accepted_key(dir.path(), 1).unwrap();
        let copies = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("prior-accepted-key-1")
            })
            .count();
        assert_eq!(copies, 2, "the earlier copy is not overwritten");
    }
}
