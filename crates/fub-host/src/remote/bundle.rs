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

// I moduli figli chiamano il resto di `remote` come `super::…`, scritto quando
// stavano qui: questi nomi rendono quei percorsi validi anche da un livello sotto.
use super::{
    aad_verify, assert_hello, atomic_state_write, canonical_aad_json, check_endpoint_binding,
    encrypt_envelope, fresh_vdk, is_syncable_entry, is_user_excluded, job_now_ms,
    load_vault_passphrase_from_env, new_replica_id, resolve_endpoint, store_endpoint_binding, sync,
    sync_dir, unwrap_for_passphrase, views, vv_string, wrap_for_passphrase, SyncEnvelope,
    TokenSource, SETTING_PAUSED, SYNC_PROTOCOL,
};

mod actions;
mod apply;
mod pass;
mod state;

use actions::{clear_conflict, percent_encode, run_share_action, store_versions};
pub(crate) use actions::{mark_retry, pause_policy, request_restore};
#[cfg(test)]
use apply::conflict_copy_id;
use apply::{apply_remote_op, read_conflicts, read_versions, report_conflicts, ApplyOutcome};
pub(crate) use pass::run_pass_on;
use state::{
    advance_cursor, append_outbox, drain_outbox, ensure_job_vdk, mark_applied, mark_synced,
    read_cursor, read_id_file, read_outbox, write_cursor,
};

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

/// Quanti file lasciati fuori la vista di stato nomina uno per uno.
const MAX_SKIPPED_ROWS: usize = 500;

/// Cosa il passaggio non ha potuto fare, per la vista di stato: le op remote
/// trattenute e i file che non stanno in una sola op.
fn pass_error(held: usize, too_large: &[String]) -> Option<String> {
    let mut parts = Vec::new();
    if held > 0 {
        parts.push(format!("{held} remote operations held; no ack"));
    }
    if let Some(first) = too_large.first() {
        let more = too_large.len() - 1;
        parts.push(if more == 0 {
            format!("{first} exceeds the 7 MiB single-op cap; not synced")
        } else {
            format!("{first} and {more} more exceed the 7 MiB single-op cap; not synced")
        });
    }
    (!parts.is_empty()).then(|| parts.join("; "))
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

/// I documenti da spedire, e quelli che non stanno in una sola op.
///
/// Un file oltre il limite resta fuori **da solo**: fermare il passaggio per
/// lui fermerebbe anche push e pull di tutto il resto del vault, finché
/// qualcuno non lo toglie. Non sparisce in silenzio: il passaggio lo conta e
/// la vista di stato lo nomina.
#[derive(Default)]
struct Collected {
    docs: Vec<JobDoc>,
    too_large: Vec<String>,
}

fn collect_job_docs(
    host: &mut dyn HostApi,
    user_exclude: &[String],
    synced: &BTreeMap<String, Revision>,
    blocked_docs: &BTreeSet<String>,
    queued: &[serde_json::Value],
) -> Result<Collected, PluginError> {
    let mut out = Vec::new();
    let mut too_large = Vec::new();
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
            // La dimensione prima dell'impronta: un file che resta fuori non
            // si legge per intero a ogni passaggio solo per saperlo.
            if entry.size > super::sync::MAX_DOC_BYTES as u64 {
                too_large.push(path);
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
            match host.read_document_bytes(&entry.id) {
                Ok(bytes) if bytes.len() > super::sync::MAX_DOC_BYTES => too_large.push(path),
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
    Ok(Collected {
        docs: out,
        too_large,
    })
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

#[cfg(test)]
mod collect_tests {
    use super::{collect_job_docs, pass_error};
    use crate::remote::sync::MAX_DOC_BYTES;
    use fub_sdk::testing::MemoryHost;
    use std::collections::{BTreeMap, BTreeSet};

    /// Un video nel vault non ferma la sync delle note: resta fuori da solo, e
    /// il passaggio lo sa.
    #[test]
    fn a_file_over_the_cap_waits_alone() {
        let mut host = MemoryHost::new()
            .with_document("Nota.md", "# Nota\n")
            .with_binary_document("video.mp4", &vec![0; MAX_DOC_BYTES + 1])
            .with_binary_document("foto.png", &vec![0; MAX_DOC_BYTES]);
        let collected =
            collect_job_docs(&mut host, &[], &BTreeMap::new(), &BTreeSet::new(), &[]).unwrap();
        let sent: Vec<&str> = collected.docs.iter().map(|doc| doc.id.as_str()).collect();
        assert_eq!(sent, ["Nota.md", "foto.png"]);
        assert_eq!(collected.too_large, ["video.mp4"]);
        assert_eq!(host.reads_on("video.mp4"), (0, 0));
    }

    #[test]
    fn the_status_names_what_was_left_behind() {
        assert_eq!(pass_error(0, &[]), None);
        assert_eq!(
            pass_error(0, &["video.mp4".into()]).as_deref(),
            Some("video.mp4 exceeds the 7 MiB single-op cap; not synced")
        );
        assert_eq!(
            pass_error(2, &["a.mp4".into(), "b.mp4".into()]).as_deref(),
            Some(
                "2 remote operations held; no ack; \
                 a.mp4 and 1 more exceed the 7 MiB single-op cap; not synced"
            )
        );
    }
}

#[cfg(test)]
mod conflict_copy_tests {
    use super::conflict_copy_id;

    fn copy(doc_id: &str) -> String {
        let id = conflict_copy_id(doc_id, "op-1").unwrap().to_string();
        let digest = id
            .split(".sync-conflict-")
            .nth(1)
            .unwrap()
            .get(..24)
            .unwrap()
            .to_string();
        id.replace(&digest, "H")
    }

    #[test]
    fn the_copy_stays_beside_the_original() {
        assert_eq!(copy("note/idea.md"), "note/idea.sync-conflict-H.md");
        assert_eq!(copy("idea.md"), "idea.sync-conflict-H.md");
        assert_eq!(copy("a/b.tar.gz"), "a/b.tar.sync-conflict-H.gz");
        // Il punto della cartella non è un'estensione del file.
        assert_eq!(
            copy("Progetti.2024/nota"),
            "Progetti.2024/nota.sync-conflict-H"
        );
        assert_eq!(
            copy("Progetti.2024/.gitignore"),
            "Progetti.2024/.gitignore.sync-conflict-H"
        );
        assert_eq!(copy("LICENSE"), "LICENSE.sync-conflict-H");
    }

    #[test]
    fn the_same_op_names_the_same_copy() {
        assert_eq!(
            conflict_copy_id("a.md", "op-1").unwrap(),
            conflict_copy_id("a.md", "op-1").unwrap()
        );
        assert_ne!(
            conflict_copy_id("a.md", "op-1").unwrap(),
            conflict_copy_id("a.md", "op-2").unwrap()
        );
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

#[cfg(test)]
mod apply_tests {
    use super::*;
    use crate::remote::sync::{WireKind, WireOp};
    use fub_abi::traits::{VaultRead, VaultWrite};
    use fub_sdk::testing::MemoryHost;

    const VDK: [u8; 32] = [7; 32];

    fn state(root: &Path) -> JobState {
        JobState {
            root: root.to_path_buf(),
            replica_id: "local".into(),
            vault_id: "vault".into(),
            key_epoch: 1,
            user_exclude: Vec::new(),
        }
    }

    fn op(kind: WireKind, doc_id: &str, plain: &[u8]) -> serde_json::Value {
        let (rename_from, rename_to) = match &kind {
            WireKind::Rename { from, to } => (Some(from.clone()), Some(to.clone())),
            _ => (None, None),
        };
        let mut op = WireOp {
            op_id: "op-1".into(),
            replica_id: "remote".into(),
            doc_id: doc_id.into(),
            kind,
            vv: BTreeMap::from([("remote".to_string(), 1)]),
            ciphertext_b64: String::new(),
            nonce_b64: String::new(),
            aad: String::new(),
            ts_ms: 1,
            vault_id: "vault".into(),
            key_epoch: 1,
            rename_from,
            rename_to,
        };
        let envelope = op.envelope();
        op.aad = crate::remote::canonical_aad_json(&envelope);
        let (nonce, ciphertext) = crate::remote::encrypt_envelope(&VDK, &envelope, plain).unwrap();
        op.nonce_b64 = nonce;
        op.ciphertext_b64 = ciphertext;
        serde_json::to_value(op).unwrap()
    }

    /// Una rinomina remota porta i byte nuovi: il ricevente li applica, non
    /// conserva i vecchi sotto il nome nuovo dichiarandoli sincronizzati.
    #[test]
    fn a_remote_rename_applies_its_payload_before_it_is_acknowledged() {
        let dir = tempfile::tempdir().unwrap();
        let mut host = MemoryHost::new().with_document("a.md", "vecchio");
        let revision = host.document_revision(&DocId::new("a.md")).unwrap();
        mark_synced(dir.path(), "a.md", revision).unwrap();
        let value = op(
            WireKind::Rename {
                from: "a.md".into(),
                to: "b.md".into(),
            },
            "a.md",
            b"nuovo",
        );
        let outcome = apply_remote_op(&mut host, &state(dir.path()), &VDK, &value).unwrap();
        assert!(matches!(outcome, ApplyOutcome::Applied { .. }));
        assert_eq!(host.read_document(&DocId::new("b.md")).unwrap(), "nuovo");
        assert!(host.read_document(&DocId::new("a.md")).is_err());
        let cursor = read_cursor(dir.path()).unwrap();
        assert_eq!(
            cursor.synced.get("b.md"),
            Some(&host.document_revision(&DocId::new("b.md")).unwrap())
        );
        assert!(!cursor.synced.contains_key("a.md"));
    }

    /// Un delete remoto su una nota ancora ferma alla revisione sincronizzata
    /// la cestina; su una già modificata in locale resta trattenuto.
    #[test]
    fn a_remote_delete_trashes_only_the_synced_revision() {
        let dir = tempfile::tempdir().unwrap();
        let mut host = MemoryHost::new().with_document("n.md", "uno");
        let id = DocId::new("n.md");
        mark_synced(dir.path(), "n.md", host.document_revision(&id).unwrap()).unwrap();
        let value = op(WireKind::Delete, "n.md", b"");
        host.write_document_bytes(&id, b"due", Some(host.document_revision(&id).unwrap()))
            .unwrap();
        let held = apply_remote_op(&mut host, &state(dir.path()), &VDK, &value).unwrap();
        assert!(matches!(held, ApplyOutcome::Held));
        assert_eq!(host.read_document(&id).unwrap(), "due");

        mark_synced(dir.path(), "n.md", host.document_revision(&id).unwrap()).unwrap();
        let applied = apply_remote_op(&mut host, &state(dir.path()), &VDK, &value).unwrap();
        assert!(matches!(applied, ApplyOutcome::Applied { .. }));
        assert!(host.read_document(&id).is_err());
    }
}
