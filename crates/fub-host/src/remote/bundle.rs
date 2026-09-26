//! Sync bundle (P16): `SyncBundle` + `SyncPlugin` + job `sync.pass`.
//!
//! Catena command → job registry → run → apply, stessa authority Desktop/CLI:
//! - `SyncCommands::invoke` (sotto workspace lock) SOLO valida e accoda
//!   `host.spawn_job(JobSpec{job:"sync.pass", payload})`, poi torna subito.
//! - `SyncPlugin::run_job("sync.pass", payload, host: &mut dyn HostApi)`
//!   gira FUORI dal lock via JobHost: legge outbox/cursori dallo state-dir
//!   TRUSTED del bundle, parla HTTP via `HostNetwork::fetch` del job-host,
//!   applica via porte locali reali (`VaultWrite::write_document_bytes` con
//!   CAS raw, `write_document`/`apply_edit`+`document_revision`,
//!   `VaultStructure::create/rename/trash_document`, `VaultRead`,
//!   `HostQuery::query_index`, `SettingsRead`, `ViewState*`, `DataRead/Write`,
//!   `HostCommands::run_command`). Mai rete sotto lock, mai secondo Host,
//!   mai downcast/global, mai nuovo canale JSON universale.
//! - Byte non-testo e note-con-BOM: `write_document_bytes` CAS raw-vs-raw;
//!   `None` = create-only atomico; `Conflict` = niente scritto, niente eventi.
//! - Ack solo dopo deposito + stato durevole (outbox drain + cursor fsync).
//!
//! Costruttori definitivi (Main monta con lo stato del vault nella
//! configurazione della sua istanza, [`super::vault_state_dir`], e con il
//! token della macchina, [`super::TokenSource`]; `None` = MissingConfiguration
//! esplicito): `SyncBundle::new(root).with_token(token)`,
//! `bundle.plugin()/commands()/runner()`, `SyncPlugin::new(root)`,
//! `SyncRunner::new(root)`,
//! `SyncCommands::boxed()` (stateless), `SyncViews::boxed()` (stateless).
//! Job payload = solo op/ID/parametri validati, mai path root o segreti.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use fub_abi::command::Args;
use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use fub_abi::net::{HttpHeader, HttpMethod, HttpRequest};
use fub_abi::settings::SettingValue;
use fub_abi::traits::{HostApi, Plugin};
use fub_abi::traits::{IndexQuery, IndexResult, Page};
use fub_abi::{PluginError, PluginManifest};

use super::commands::{
    SyncCommands, SYNC_ACCEPT, SYNC_INVITE, SYNC_PAUSE, SYNC_PULL_NOW, SYNC_PUSH_NOW, SYNC_REKEY,
    SYNC_RESTORE_VERSION, SYNC_RESUME, SYNC_RETRY_CONFLICT, SYNC_REVOKE,
};
use super::views::{SyncViews, SYNC_CONFLICTS_VIEW, SYNC_STATUS_VIEW, SYNC_VERSIONS_VIEW};

/// Direction is explicit for this process. Read-only consumes server writes
/// without ever uploading local changes; mirror publishes local changes but
/// never applies server writes to the local vault.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ReplicationMode {
    Bidirectional,
    ReadOnly,
    Mirror,
}

impl ReplicationMode {
    fn configured() -> Result<Self, PluginError> {
        match std::env::var("FUB_SYNC_MODE") {
            Err(std::env::VarError::NotPresent) => Ok(Self::Bidirectional),
            Ok(value) if value == "bidirectional" => Ok(Self::Bidirectional),
            Ok(value) if value == "read-only" => Ok(Self::ReadOnly),
            Ok(value) if value == "mirror" => Ok(Self::Mirror),
            _ => Err(PluginError::BadArgs(
                "FUB_SYNC_MODE must be bidirectional, read-only or mirror".into(),
            )),
        }
    }
    fn can_push(self) -> bool {
        self != Self::ReadOnly
    }
    fn can_pull(self) -> bool {
        self != Self::Mirror
    }
}
/// Job entry point served by the sync runner.
pub const SYNC_PASS_JOB: &str = "sync.pass";

/// Composition root dello slice sync (wiring Main): la TRUSTED `state_root`
/// del vault catturata una volta alla costruzione ([`super::vault_state_dir`]),
/// mai da env, cwd, payload JSON o settings per-chiamata. `None` = esplicito
/// `MissingConfiguration` su ogni op, mai path inventato.
pub struct SyncBundle {
    state_root: Option<camino::Utf8PathBuf>,
    token: super::TokenSource,
}

impl SyncBundle {
    /// Costruttore definitivo: Main passa la root trusted (o `None`).
    pub fn new(state_root: Option<camino::Utf8PathBuf>) -> Self {
        Self {
            state_root,
            token: super::TokenSource::environment(),
        }
    }

    /// Da dove i passaggi leggono il token; di serie soltanto l'ambiente.
    pub fn with_token(mut self, token: super::TokenSource) -> Self {
        self.token = token;
        self
    }

    pub fn commands(&self) -> SyncCommands {
        SyncCommands
    }

    pub fn runner(&self) -> SyncRunner {
        SyncRunner {
            state_root: self.state_root.clone(),
            token: self.token.clone(),
        }
    }

    pub fn plugin(&self) -> SyncPlugin {
        SyncPlugin {
            state_root: self.state_root.clone(),
            token: self.token.clone(),
        }
    }

    pub fn views(&self) -> SyncViews {
        SyncViews::new(self.state_root.clone())
    }

    fn manifest_inner(&self) -> PluginManifest {
        super::networked_manifest("fub.sync", "Sync").speaking(
            crate::settings::CORE_DEFAULT_LOCALE,
            super::views::catalog(),
        )
    }
}

impl crate::registry::Bundle for SyncBundle {
    fn manifest(&self) -> PluginManifest {
        self.manifest_inner()
    }

    fn trust(&self) -> fub_kernel::Trust {
        fub_kernel::Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(self.plugin())
    }

    fn register(&self, registrar: &mut crate::registry::Registrar<'_>) -> Vec<String> {
        let mut failures = Vec::new();
        if let Err(error) = registrar.register_view_provider(Box::new(self.views())) {
            failures.push(format!("sync views NOT registered: {error}"));
            return failures;
        }
        if let Err(error) = registrar.register_command_provider(Box::new(self.commands())) {
            failures.push(format!("sync commands NOT registered: {error}"));
        }
        failures
    }
}

/// Job-body plugin proprietario di `sync.pass` per il dispatcher dei job.
/// Eredita la TRUSTED root dal bundle; `run_job` delega al runner radicato.
pub struct SyncPlugin {
    state_root: Option<camino::Utf8PathBuf>,
    token: super::TokenSource,
}

impl SyncPlugin {
    /// Costruttore lato bundle (vedi [`SyncBundle::plugin`]).
    pub fn new(state_root: Option<camino::Utf8PathBuf>) -> Self {
        Self {
            state_root,
            token: super::TokenSource::environment(),
        }
    }

    pub fn job_name() -> &'static str {
        SYNC_PASS_JOB
    }

    /// Corpo `Plugin::run_job`: payload solo op/ID/parametri validati.
    pub fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        if job != SYNC_PASS_JOB {
            return Err(PluginError::UnknownJob(job.to_string().into()));
        }
        SyncRunner {
            state_root: self.state_root.clone(),
            token: self.token.clone(),
        }
        .run_job(&payload, host)
    }
}

impl Plugin for SyncPlugin {
    fn manifest(&self) -> PluginManifest {
        super::networked_manifest("fub.sync", "Sync").speaking(
            crate::settings::CORE_DEFAULT_LOCALE,
            super::views::catalog(),
        )
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        SyncPlugin::run_job(self, job, payload, host)
    }
}

pub struct SyncRunner {
    state_root: Option<camino::Utf8PathBuf>,
    token: super::TokenSource,
}

impl SyncRunner {
    pub fn new(state_root: Option<camino::Utf8PathBuf>) -> Self {
        Self {
            state_root,
            token: super::TokenSource::environment(),
        }
    }

    fn require_root(&self) -> Result<&camino::Utf8Path, PluginError> {
        self.state_root
            .as_deref()
            .ok_or_else(|| PluginError::BadArgs("sync not configured".into()))
    }

    /// Corpo del job `sync.pass`: payload `{op, vault_id?, doc?, version?}`
    /// solo — parametri validati, mai path. Esegue il passo reale
    /// sull'`HostApi` del job (fetch via `HostNetwork`, snapshot via
    /// data-space, apply via porte locali con CAS), mai nel percorso del
    /// comando sincrono.
    pub fn run_job(
        &self,
        payload: &serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let root = self.require_root()?;
        let root = root.as_std_path().to_path_buf();
        let args = Args::new(payload);
        let op = args
            .text("op")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("pass");
        match op {
            "push" | "pull" | "pass" => {
                let vault_id = args
                    .text("vault_id")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                run_pass_on(&root, &self.token, host, vault_id.as_deref(), op)
            }
            "pause" => {
                pause_policy(&root, host, true)?;
                Ok(serde_json::json!({"paused": true}))
            }
            "resume" => {
                pause_policy(&root, host, false)?;
                Ok(serde_json::json!({"paused": false}))
            }
            "retry" => {
                let doc = args
                    .text("doc")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| PluginError::BadArgs("sync.pass retry needs doc".into()))?;
                if !super::is_syncable_entry(doc) {
                    return Err(PluginError::BadArgs("sync retry path excluded".into()));
                }
                let _lock = JobLock::acquire(&root)?;
                match host.document_revision(&DocId::new(doc.to_string())) {
                    Ok(_) => mark_retry(&root, doc)?,
                    Err(PluginError::NotFound(_)) => clear_conflict(&root, doc)?,
                    Err(e) => return Err(e),
                }
                Ok(serde_json::json!({"retried": doc}))
            }
            "restore" => {
                let doc = args
                    .text("doc")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| PluginError::BadArgs("sync.pass restore needs doc".into()))?;
                let version = args
                    .text("version")
                    .and_then(|text| text.parse::<u64>().ok())
                    .filter(|version| *version > 0)
                    .ok_or_else(|| {
                        PluginError::BadArgs("sync.pass restore needs a version".into())
                    })?;
                request_restore(&root, &self.token, host, doc, version)
            }
            "invite" | "accept" | "revoke" | "rekey" => {
                run_share_action(&root, &self.token, host, op, payload)
            }
            _ => Err(PluginError::BadArgs(
                format!("unknown sync.pass op: {op}").into(),
            )),
        }
    }
}

/// Le tre view dichiarate servite da [`SyncViews`], per il montaggio Main.
pub const SYNC_VIEWS: [&str; 3] = [SYNC_STATUS_VIEW, SYNC_VERSIONS_VIEW, SYNC_CONFLICTS_VIEW];

/// Commands served by [`SyncCommands`] for integration registration.
pub const SYNC_COMMAND_IDS: [&str; 10] = [
    SYNC_PUSH_NOW,
    SYNC_PULL_NOW,
    SYNC_PAUSE,
    SYNC_RESUME,
    SYNC_RETRY_CONFLICT,
    SYNC_RESTORE_VERSION,
    SYNC_INVITE,
    SYNC_ACCEPT,
    SYNC_REVOKE,
    SYNC_REKEY,
];

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

fn clear_conflict(root: &Path, doc: &str) -> Result<(), PluginError> {
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

fn run_share_action(
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
            let docs = collect_job_docs(
                host,
                &state.user_exclude,
                &BTreeMap::new(),
                &BTreeSet::new(),
                &[],
            )?;
            if docs
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

fn percent_encode(value: &str) -> String {
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

fn store_versions(root: &Path, response: &serde_json::Value) -> Result<(), PluginError> {
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
    let docs = if do_push {
        collect_job_docs(
            host,
            &state.user_exclude,
            &cursor.synced,
            &blocked_docs,
            &queued,
        )?
    } else {
        Vec::new()
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
        last_error: if held > 0 {
            Some(format!("{held} remote operations held; no ack"))
        } else {
            None
        },
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
        "pending": snapshot.pending,
    }))
}

/// Advisory lock on a stable inode. The kernel releases it after a crash,
/// while a concurrent writer cannot pass `try_lock`; never unlink the inode
/// on drop (unlink/recreate would admit a second independent lock).
struct JobLock {
    _file: std::fs::File,
}

impl JobLock {
    fn acquire(root: &Path) -> Result<Self, PluginError> {
        std::fs::create_dir_all(root)
            .map_err(|_| PluginError::Io("sync state root unavailable".into()))?;
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("sync-pass.lock"))
            .map_err(|_| PluginError::Io("sync lock unavailable".into()))?;
        file.try_lock().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => {
                PluginError::Cancelled("sync already running".into())
            }
            std::fs::TryLockError::Error(_) => {
                PluginError::Io("sync advisory lock unavailable".into())
            }
        })?;
        Ok(Self { _file: file })
    }
}

/// Stato durevole del job (file atomici sotto la root TRUSTED).
struct JobState {
    root: PathBuf,
    replica_id: String,
    vault_id: String,
    key_epoch: u32,
    user_exclude: Vec<String>,
}

impl JobState {
    fn open(root: &Path, scope: Option<&str>, host: &dyn HostApi) -> Result<Self, PluginError> {
        let replica_id = read_or_create_id(root, "replica-id")?;
        let vault_id = super::load_or_create_vault_pairing(root, scope)
            .map_err(|_| PluginError::Io("sync vault pairing unavailable".into()))?;
        let key_epoch = super::load_key_epoch(root)
            .map_err(|_| PluginError::Io("sync key epoch corrupt or unreadable".into()))?;
        let user_exclude = match host.setting(super::SETTING_EXCLUDE) {
            Ok(SettingValue::List(values)) => super::parse_user_exclude(&values),
            Err(PluginError::NotFound(_)) => Vec::new(),
            Ok(_) => {
                return Err(PluginError::BadArgs(
                    "sync exclude setting has wrong type".into(),
                ))
            }
            Err(e) => return Err(e),
        };
        Ok(Self {
            root: root.to_path_buf(),
            replica_id,
            vault_id,
            key_epoch,
            user_exclude,
        })
    }
}

fn read_or_create_id(root: &Path, name: &str) -> Result<String, PluginError> {
    match read_id_file(root, name) {
        Ok(id) => Ok(id),
        Err(PluginError::BadArgs(_)) if !root.join(name).exists() => {
            let id = super::new_replica_id();
            super::atomic_state_write(root, name, id.as_bytes())?;
            Ok(id)
        }
        Err(e) => Err(e),
    }
}

/// Detect known external-sync marker files through the existing index port.
/// A marker (or an explicit overlap declaration) stops before any vault
/// mutation. Only an explicit per-process acknowledgement permits co-use.
fn check_external_overlap(host: &mut dyn HostApi) -> Result<(), PluginError> {
    let declared = matches!(
        std::env::var("FUB_SYNC_EXTERNAL_OVERLAP").as_deref(),
        Ok("1")
    );
    let mut found = declared;
    if !found {
        let mut offset = 0_u32;
        loop {
            let page = host.query_index(IndexQuery::Entries {
                of_kind: None,
                within: None,
                page: Some(Page::new(offset, 500)),
            })?;
            let IndexResult::Entries(paged) = page else {
                return Err(PluginError::Internal(
                    "sync overlap check expected entries".into(),
                ));
            };
            let count = paged.items.len();
            if paged.items.iter().any(|entry| {
                entry.id.0.split('/').any(|segment| {
                    matches!(
                        segment.to_ascii_lowercase().as_str(),
                        ".stfolder"
                            | ".stignore"
                            | ".dropbox"
                            | ".dropbox.cache"
                            | ".icloud"
                            | ".sync"
                    )
                })
            }) {
                found = true;
                break;
            }
            if count < 500 {
                break;
            }
            offset = offset
                .checked_add(count as u32)
                .ok_or_else(|| PluginError::Io("sync overlap scan overflow".into()))?;
        }
    }
    if found && std::env::var("FUB_SYNC_OVERLAP_ACCEPT").as_deref() != Ok("1") {
        return Err(PluginError::Conflict(
            "external synchronizer overlap detected; sync paused before vault mutation (explicit FUB_SYNC_OVERLAP_ACCEPT=1 required)".into()));
    }
    Ok(())
}
/// Letture breve e coerenti: revisione prima/dopo, mai convertire i byte.
struct JobDoc {
    id: String,
    bytes: Vec<u8>,
    revision: Revision,
}

fn collect_job_docs(
    host: &mut dyn HostApi,
    user_exclude: &[String],
    synced: &BTreeMap<String, Revision>,
    blocked_docs: &BTreeSet<String>,
    queued: &[serde_json::Value],
) -> Result<Vec<JobDoc>, PluginError> {
    let mut out = Vec::new();
    let mut offset: u32 = 0;
    loop {
        let page = host.query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: Some(Page::new(offset, 500)),
        })?;
        let items = match page {
            IndexResult::Entries(paged) => paged.items,
            other => {
                return Err(PluginError::Internal(
                    format!("sync list: expected entries, got {}", other.kind_name()).into(),
                ))
            }
        };
        let n = items.len() as u32;
        for entry in &items {
            let path = entry.id.0.clone();
            if !super::is_syncable_entry(&path) || super::is_user_excluded(user_exclude, &path) {
                continue;
            }
            if blocked_docs.contains(&path)
                || queued
                    .iter()
                    .any(|row| row["op"]["doc_id"].as_str() == Some(&path))
            {
                continue;
            }
            let before = match host.document_revision(&entry.id) {
                Ok(revision) => revision,
                Err(PluginError::NotFound(_)) => continue,
                Err(e) => return Err(e),
            };
            if synced.get(&path) == Some(&before) {
                continue;
            }
            if entry.size > super::sync::MAX_DOC_BYTES as u64 {
                return Err(PluginError::BadArgs(
                    "sync file exceeds 7 MiB single-op cap; no transfer started".into(),
                ));
            }
            match host.read_document_bytes(&entry.id) {
                Ok(bytes) if bytes.len() > super::sync::MAX_DOC_BYTES => {
                    return Err(PluginError::BadArgs(
                        "sync file grew beyond 7 MiB single-op cap".into(),
                    ))
                }
                Ok(bytes) => {
                    if host.document_revision(&entry.id)? != before {
                        return Err(PluginError::Conflict(
                            "sync source changed during collection".into(),
                        ));
                    }
                    out.push(JobDoc {
                        id: path,
                        bytes,
                        revision: before,
                    });
                }
                Err(PluginError::NotFound(_)) => {}
                Err(e) => return Err(e),
            }
        }
        if n < 500 {
            break;
        }
        offset += n;
    }
    Ok(out)
}

fn vv_wire(vv: &BTreeMap<String, u64>) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (k, v) in vv {
        map.insert(k.clone(), serde_json::Value::String(v.to_string()));
    }
    serde_json::Value::Object(map)
}

fn vv_parse(value: &serde_json::Value) -> Result<BTreeMap<String, u64>, PluginError> {
    let map = value
        .as_object()
        .ok_or_else(|| PluginError::Internal("sync pull: bad server_vv".into()))?;
    let mut out = BTreeMap::new();
    for (k, v) in map {
        let n = if let Some(n) = v.as_u64() {
            n
        } else if let Some(s) = v.as_str() {
            s.trim()
                .parse::<u64>()
                .map_err(|_| PluginError::Internal("sync pull: bad vv counter".into()))?
        } else {
            return Err(PluginError::Internal("sync pull: bad vv counter".into()));
        };
        out.insert(k.clone(), n);
    }
    Ok(out)
}

fn http_post(
    host: &dyn HostApi,
    base: &str,
    auth: &str,
    path: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, PluginError> {
    let bytes = serde_json::to_vec(body)
        .map_err(|_| PluginError::Internal("sync request encode".into()))?;
    http_request(host, base, auth, path, HttpMethod::Post, Some(bytes))
}

fn http_get(
    host: &dyn HostApi,
    base: &str,
    auth: &str,
    path: &str,
) -> Result<serde_json::Value, PluginError> {
    http_request(host, base, auth, path, HttpMethod::Get, None)
}

fn http_request(
    host: &dyn HostApi,
    base: &str,
    auth: &str,
    path: &str,
    method: HttpMethod,
    body: Option<Vec<u8>>,
) -> Result<serde_json::Value, PluginError> {
    if !path.starts_with("/v1/")
        || path.contains(['#', '\r', '\n'])
        || path.to_ascii_lowercase().contains("password=")
    {
        return Err(PluginError::BadArgs("invalid sync request path".into()));
    }
    let mut headers = vec![HttpHeader::new("authorization", auth)];
    if body.is_some() {
        headers.push(HttpHeader::new("content-type", "application/json"));
    }
    let response = host
        .fetch(HttpRequest {
            url: format!("{base}{path}"),
            method,
            headers,
            body,
        })
        .map_err(|e| match e {
            PluginError::PermissionDenied(_) => {
                PluginError::PermissionDenied("sync network denied".into())
            }
            PluginError::BadArgs(_) => PluginError::BadArgs("sync URL denied".into()),
            PluginError::Unserved(_) => PluginError::Unserved("sync network unavailable".into()),
            PluginError::Cancelled(_) => PluginError::Cancelled("sync request cancelled".into()),
            _ => PluginError::Io("sync transport failed".into()),
        })?;
    if !(200..300).contains(&response.status) {
        let path_base = path.split('?').next().unwrap_or(path);
        let detail = format!("sync {path_base} -> {}", response.status);
        return Err(match response.status {
            401 | 403 | 429 => PluginError::PermissionDenied(detail.into()),
            404 => PluginError::NotFound(detail.into()),
            409 => PluginError::Conflict(detail.into()),
            _ => PluginError::Io(detail.into()),
        });
    }
    serde_json::from_slice(&response.body)
        .map_err(|_| PluginError::Internal("sync invalid JSON response".into()))
}

fn read_conflicts(root: &Path) -> Result<Vec<super::views::SnapshotConflict>, PluginError> {
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

fn report_conflicts(
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

fn read_versions(root: &Path) -> Result<Vec<super::views::SnapshotVersion>, PluginError> {
    match std::fs::read(root.join("versions.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| PluginError::Io("sync versions corrupt; recovery required".into())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err(PluginError::Io("sync versions unreadable".into())),
    }
}

enum ApplyOutcome {
    Applied { op_id: String },
    Conflict { op_id: String },
    Held,
}

/// Apply di un'op remota VERIFICATA: shape -> epoch -> AAD ricalcolata (mai
/// wire) -> `aad_verify` -> CAS raw (`write_document_bytes`) o testo CAS.
/// Deletes/renames via comandi kernel; binari senza porta = hold (qui la
/// porta ESISTE: `write_document_bytes`, quindi nessun hold finale).
fn apply_remote_op(
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
        host.trash_document(&id)?;
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
        let (stem, ext) = op
            .doc_id
            .rsplit_once('.')
            .map_or((op.doc_id.as_str(), ""), |(stem, ext)| (stem, ext));
        let digest = ring::digest::digest(&ring::digest::SHA256, op.op_id.as_bytes());
        let mut digest_name = String::with_capacity(24);
        use std::fmt::Write as _;
        for byte in digest.as_ref().iter().take(12) {
            write!(&mut digest_name, "{byte:02x}")
                .map_err(|_| PluginError::Internal("sync conflict name failed".into()))?;
        }
        let suffix = if ext.is_empty() {
            String::new()
        } else {
            format!(".{ext}")
        };
        let copy = DocId::new(format!("{stem}.sync-conflict-{digest_name}{suffix}"));
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

// --- state_helpers (file atomici sotto root TRUSTED) ---

fn read_id_file(root: &Path, name: &str) -> Result<String, PluginError> {
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
struct JobCursor {
    #[serde(with = "super::vv_string")]
    server_vv: BTreeMap<String, u64>,
    applied: BTreeSet<String>,
    #[serde(default)]
    synced: BTreeMap<String, Revision>,
}

fn read_cursor(root: &Path) -> Result<JobCursor, PluginError> {
    let bytes = match std::fs::read(root.join("cursor.json")) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(JobCursor::default()),
        Err(_) => return Err(PluginError::Io("sync cursor unreadable".into())),
    };
    serde_json::from_slice(&bytes)
        .map_err(|_| PluginError::Io("sync cursor corrupt; recovery required".into()))
}

fn write_cursor(root: &Path, cursor: &JobCursor) -> Result<(), PluginError> {
    let bytes = serde_json::to_vec(cursor)
        .map_err(|_| PluginError::Internal("sync cursor encoding failed".into()))?;
    super::atomic_state_write(root, "cursor.json", &bytes)
}

fn mark_applied(root: &Path, op_id: &str) -> Result<(), PluginError> {
    let mut cursor = read_cursor(root)?;
    cursor.applied.insert(op_id.to_string());
    write_cursor(root, &cursor)
}

fn mark_synced(root: &Path, doc_id: &str, revision: Revision) -> Result<(), PluginError> {
    let mut cursor = read_cursor(root)?;
    cursor.synced.insert(doc_id.to_string(), revision);
    write_cursor(root, &cursor)
}

fn advance_cursor(root: &Path, server_vv: &BTreeMap<String, u64>) -> Result<(), PluginError> {
    let mut cursor = read_cursor(root)?;
    for (replica, counter) in server_vv {
        let current = cursor.server_vv.entry(replica.clone()).or_insert(0);
        *current = (*current).max(*counter);
    }
    write_cursor(root, &cursor)
}

fn read_outbox(root: &Path) -> Result<Vec<serde_json::Value>, PluginError> {
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

fn append_outbox(state: &JobState, fresh: &[serde_json::Value]) -> Result<(), PluginError> {
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

fn drain_outbox(state: &JobState, acked: &BTreeSet<String>) -> Result<(), PluginError> {
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

fn ensure_job_vdk(
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

#[cfg(test)]
mod recovery_tests {
    use super::JobLock;

    #[test]
    fn sync_writer_lock_excludes_concurrent_jobs_and_recovers_after_drop() {
        let dir = tempfile::tempdir().unwrap();
        let first = JobLock::acquire(dir.path()).unwrap();
        assert!(
            JobLock::acquire(dir.path()).is_err(),
            "two writers must never enter"
        );
        drop(first);
        let second = JobLock::acquire(dir.path()).expect("released lock is recoverable");
        assert!(
            dir.path().join("sync-pass.lock").exists(),
            "stable lock inode must stay"
        );
        drop(second);
    }
}
