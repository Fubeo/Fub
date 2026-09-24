//! Strict synchronous wire types and optional status transport for P16.
//! The single durable writer and all HostApi vault mutations live in
//! `bundle`; this module defines the backend-compatible envelopes.
//! Canonical AAD binds protocol, vault, epoch, kind, routing and vector.
//! Network errors never expose response bodies, query strings or secrets.

use fub_abi::PluginError;

/// Wire protocol asserted against `GET /v1/hello` (hard error, no fallback).
pub const SYNC_PROTOCOL: &str = super::SYNC_PROTOCOL;

/// Canonical wire op envelope: field names match
/// `fub-services::sync::SyncOp` exactly, including `vault_id`, `key_epoch`,
/// `rename_from`/`rename_to`. `aad` is a transport echo of the canonical
/// AAD — recomputed locally on both ends, never trusted.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireOp {
    pub op_id: String,
    pub replica_id: String,
    pub doc_id: String,
    pub kind: WireKind,
    /// Valori come stringhe sul wire (compat numero, mirror backend).
    #[serde(with = "super::vv_string")]
    pub vv: std::collections::BTreeMap<String, u64>,
    pub ciphertext_b64: String,
    pub nonce_b64: String,
    #[serde(default)]
    pub aad: String,
    /// Millisecondi UNIX: restano number (VersionRef.ts precedent).
    pub ts_ms: u64,
    pub vault_id: String,
    pub key_epoch: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_to: Option<String>,
}

/// `create|update|delete|tombstone|rename` on the wire (snake_case).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WireKind {
    Create,
    Update,
    Delete,
    Tombstone,
    Rename { from: String, to: String },
}

impl WireKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            WireKind::Create => "create",
            WireKind::Update => "update",
            WireKind::Delete => "delete",
            WireKind::Tombstone => "tombstone",
            WireKind::Rename { .. } => "rename",
        }
    }

    pub fn is_delete(&self) -> bool {
        matches!(self, WireKind::Delete | WireKind::Tombstone)
    }
}

impl WireOp {
    /// Canonical envelope for AAD recompute + verify (mirrors
    /// `fub_services::crypto::SyncEnvelope` field-for-field).
    pub fn envelope(&self) -> super::SyncEnvelope {
        super::SyncEnvelope {
            protocol: SYNC_PROTOCOL.to_string(),
            vault_id: self.vault_id.clone(),
            key_epoch: self.key_epoch,
            op_id: self.op_id.clone(),
            replica_id: self.replica_id.clone(),
            doc_id: self.doc_id.clone(),
            kind: self.kind.as_str().to_string(),
            vv: self.vv.clone(),
            ts_ms: self.ts_ms,
            rename_from: self.rename_from.clone(),
            rename_to: self.rename_to.clone(),
        }
    }

    /// Structural validation BEFORE any crypto: new fields present, rename
    /// coherence, non-empty identity. Old 4-field pipe `aad` can never pass
    /// the canonical recompute below, so downgrade fails closed.
    pub fn check_shape(&self) -> Result<(), String> {
        if self.op_id.trim().is_empty()
            || self.replica_id.trim().is_empty()
            || self.doc_id.trim().is_empty()
            || self.vault_id.trim().is_empty()
        {
            return Err("protocol: bad op identity".to_string());
        }
        if self.vv.is_empty() {
            return Err("protocol: empty version vector".to_string());
        }
        match &self.kind {
            WireKind::Rename { from, to } => {
                if from.trim().is_empty() || to.trim().is_empty() {
                    return Err("protocol: bad rename routing".to_string());
                }
                if self.rename_from.as_deref() != Some(from.as_str())
                    || self.rename_to.as_deref() != Some(to.as_str())
                {
                    return Err("protocol: rename routing mismatch".to_string());
                }
                if self.doc_id != *from {
                    return Err("protocol: rename doc_id must equal rename from".to_string());
                }
            }
            _ => {
                if self.rename_from.is_some() || self.rename_to.is_some() {
                    return Err("protocol: rename routing mismatch".to_string());
                }
            }
        }
        Ok(())
    }
}

/// Conflict entry of a push response (`{doc_id, reason, replicas}`).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WireConflict {
    pub doc_id: String,
    pub reason: String,
    #[serde(default)]
    pub replicas: Vec<String>,
}

/// `SyncApi::push` result: `{ack, conflicts, server_vv}`.
#[derive(Clone, Debug)]
pub struct PushOutcome {
    pub ack: Vec<String>,
    pub conflicts: Vec<WireConflict>,
    pub server_vv: std::collections::BTreeMap<String, u64>,
}

/// `SyncApi::pull` result: `{ops, server_vv, truncated}`.
#[derive(Clone, Debug)]
pub struct PullOutcome {
    pub ops: Vec<WireOp>,
    pub server_vv: std::collections::BTreeMap<String, u64>,
    pub truncated: bool,
}

/// `SyncApi::status` result (mirrors `GET /v1/sync/status` JSON keys).
/// Counts STAY numbers (small, never identities); `server_vv` values are
/// strings (compat numero).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SyncStatus {
    pub replica_id: String,
    #[serde(default, with = "super::vv_string")]
    pub server_vv: std::collections::BTreeMap<String, u64>,
    #[serde(default)]
    pub docs: usize,
    #[serde(default)]
    pub pending: usize,
    #[serde(default)]
    pub conflicts: usize,
    #[serde(default)]
    pub tombstones: usize,
    #[serde(default)]
    pub trash: usize,
}

/// Per-file status row for the panel (string-contract: `doc_id, state,
/// local_counter, server_counter` as decimal strings, `detail` optional;
/// `ts` numbers stay numbers). Counters are identities -> u64_string.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncStatusEntry {
    pub doc_id: String,
    pub state: String,
    #[serde(with = "super::u64_string")]
    pub local_counter: u64,
    #[serde(with = "super::u64_string")]
    pub server_counter: u64,
    pub detail: Option<String>,
}

/// Version row for the panel (string-contract: `version` as decimal string,
/// `ts_ms` stays number, `vv_text` canonical text).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SyncVersionRow {
    pub doc_id: String,
    #[serde(with = "super::u64_string")]
    pub version: u64,
    pub hash: String,
    pub ts_ms: u64,
    pub vv_text: String,
}

/// Headless-facing error with F36 exit-code mapping (`0/2/3/4/5`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SyncClientError {
    MissingConfiguration,
    Transport(String),
    Protocol(String),
    Rejected {
        status: u16,
        body: String,
    },
    Paused,
    Busy(String),
    RecoveryNeeded {
        quarantined: usize,
        preserved: usize,
    },
    QueueFull {
        pending: usize,
    },
    Held {
        doc_id: String,
        reason: String,
    },
    MissingCredentials,
}

impl SyncClientError {
    /// F36 exit code: 0 ok (unused here), 2 usage, 3 transport/auth, 4
    /// protocol/missing-credentials, 5 rejected/paused/held/backpressure.
    pub fn exit_code(&self) -> i32 {
        match self {
            SyncClientError::MissingConfiguration => 2,
            SyncClientError::Transport(_) => 3,
            SyncClientError::Protocol(_) => 4,
            SyncClientError::MissingCredentials => 4,
            SyncClientError::Rejected { .. } => 5,
            SyncClientError::Paused => 5,
            SyncClientError::Busy(_) => 5,
            SyncClientError::RecoveryNeeded { .. } => 5,
            SyncClientError::QueueFull { .. } => 5,
            SyncClientError::Held { .. } => 5,
        }
    }

    pub fn to_plugin_error(&self) -> PluginError {
        match self {
            SyncClientError::MissingConfiguration => {
                PluginError::BadArgs("sync not configured".into())
            }
            SyncClientError::Transport(e) => PluginError::Io(e.clone().into()),
            SyncClientError::Protocol(e) => PluginError::Internal(e.clone().into()),
            SyncClientError::MissingCredentials => {
                PluginError::PermissionDenied("missing credentials".to_string().into())
            }
            SyncClientError::Rejected { status, body } => match status {
                401 | 403 | 429 => PluginError::PermissionDenied(body.clone().into()),
                404 => PluginError::NotFound(body.clone().into()),
                409 => PluginError::Conflict(body.clone().into()),
                _ => PluginError::Io(format!("sync rejected ({status}): {body}").into()),
            },
            SyncClientError::Paused => PluginError::Cancelled("sync paused".to_string().into()),
            SyncClientError::Busy(e) => PluginError::Cancelled(e.clone().into()),
            SyncClientError::RecoveryNeeded {
                quarantined,
                preserved,
            } => PluginError::Io(
                format!("sync recovery needed: {quarantined} quarantined, {preserved} preserved")
                    .into(),
            ),
            SyncClientError::QueueFull { pending } => {
                PluginError::Io(format!("sync queue full: {pending} pending").into())
            }
            SyncClientError::Held { doc_id, reason } => {
                PluginError::Conflict(format!("sync held {doc_id}: {reason}").into())
            }
        }
    }
}

impl std::fmt::Display for SyncClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncClientError::MissingConfiguration => write!(f, "sync not configured"),
            SyncClientError::Transport(e) => write!(f, "sync transport: {e}"),
            SyncClientError::Protocol(e) => write!(f, "sync protocol: {e}"),
            SyncClientError::MissingCredentials => write!(f, "missing credentials"),
            SyncClientError::Rejected { status, body } => {
                write!(f, "sync rejected ({status}): {body}")
            }
            SyncClientError::Paused => write!(f, "sync paused"),
            SyncClientError::Busy(e) => write!(f, "sync busy: {e}"),
            SyncClientError::RecoveryNeeded {
                quarantined,
                preserved,
            } => write!(
                f,
                "sync recovery needed: {quarantined} quarantined, {preserved} preserved"
            ),
            SyncClientError::QueueFull { pending } => {
                write!(f, "sync queue full: {pending} pending")
            }
            SyncClientError::Held { doc_id, reason } => {
                write!(f, "sync held {doc_id}: {reason}")
            }
        }
    }
}

/// Raw-document ceiling: base64 + AEAD tag + AAD + JSONL framing must fit
/// the server's 10 MiB queue line. No chunk protocol is negotiated here;
/// reject locally BEFORE encrypting, queuing or transferring a larger file.
pub const MAX_DOC_BYTES: usize = 7 * 1024 * 1024;
/// Max outbox entries before backpressure (authority: QueueFull, never drop).
pub const OUTBOX_MAX: usize = 50_000;

/// Wire transport for status/push/pull/ack. The bundle job owns durable
/// scheduling and every HostApi mutation; this client never writes a vault
/// document.
pub struct SyncClient {
    base: String,
    token: Option<String>,
    /// This device's replica id: opaque UUID v4, persisted under the state
    /// dir (`<state>/sync/replica-id`), never derived from a path. Stable
    /// across reopens; a rename keeps it stable (path is an attribute).
    pub replica_id: String,
    /// Stable vault pairing from the trusted state root, shared by the job.
    pub vault_id: String,
    /// VDK epoch from that same trusted root; mismatch holds older ops.
    pub key_epoch: u32,
    state_dir: std::path::PathBuf,
}

impl SyncClient {
    pub fn new(
        base: String,
        token: Option<String>,
        replica_id: String,
        vault_id: String,
        key_epoch: u32,
        state_dir: std::path::PathBuf,
    ) -> Self {
        Self {
            base,
            token,
            replica_id,
            vault_id,
            key_epoch,
            state_dir,
        }
    }

    /// Built from explicit endpoint (env `FUB_SERVICES_URL` else
    /// `sync.server_url` setting) + token from file/stdin env + durable
    /// identity files. No endpoint configured = `RemoteError` (exit 2, never
    /// implicit loopback); missing token = `MissingCredentials`. The
    /// (vault-pairing, replica) pair is bound to the endpoint that created
    /// it (`check_endpoint_binding`): a changed endpoint requires explicit
    /// re-pairing, never silent reinterpretation of cursor/credentials.
    /// Pass the already-read `sync.server_url` setting value (empty = not
    /// configurato); l'orchestrazione passa esclusivamente dal job del bundle.
    pub fn from_env(
        state_dir: std::path::PathBuf,
        vault_scope: Option<&str>,
        setting_url: &str,
    ) -> Result<Self, SyncClientError> {
        let base = super::resolve_base(setting_url).map_err(|e| match e {
            super::RemoteError::MissingConfiguration => SyncClientError::MissingConfiguration,
            super::RemoteError::BadEndpoint(detail) => {
                SyncClientError::Protocol(format!("bad endpoint: {detail}"))
            }
        })?;
        super::check_endpoint_binding(&state_dir, &base).map_err(|e| match e {
            super::RemoteError::MissingConfiguration => SyncClientError::MissingConfiguration,
            super::RemoteError::BadEndpoint(detail) => {
                SyncClientError::Protocol(format!("bad endpoint: {detail}"))
            }
        })?;
        let token = super::load_token().ok_or(SyncClientError::MissingCredentials)?;
        let replica_id = load_or_create_replica_id(&state_dir)?;
        let vault_id = super::load_or_create_vault_pairing(&state_dir, vault_scope)
            .map_err(SyncClientError::Transport)?;
        let key_epoch = super::load_key_epoch(&state_dir).map_err(SyncClientError::Transport)?;
        Ok(Self::new(
            base,
            Some(token),
            replica_id,
            vault_id,
            key_epoch,
            state_dir,
        ))
    }

    /// `SyncApi::status` + hello assert: protocol mismatch = hard error.
    pub fn status(&self) -> Result<SyncStatus, SyncClientError> {
        let token = self.token()?;
        let (hello_status, hello_body) =
            super::get(&self.base, "/v1/hello", Some(token)).map_err(SyncClientError::Transport)?;
        if hello_status != 200 {
            // Allowlist log: method + path-base + status only. The body is
            // never logged (may carry server text); status is the signal.
            let _event = super::SyncLogEvent {
                method: "GET",
                path_base: "/v1/hello".to_string(),
                status: Some(hello_status),
                detail: super::SyncLogDetail::Rejected,
            };
            return Err(SyncClientError::Rejected {
                status: hello_status,
                body: String::new(),
            });
        }
        super::assert_hello(&hello_body).map_err(SyncClientError::Protocol)?;
        // Record the endpoint binding after a successful hello (re-pairing
        // authority: cursor/credentials are never reinterpreted elsewhere).
        super::store_endpoint_binding(&self.state_dir, &self.base)
            .map_err(SyncClientError::Transport)?;
        let path = format!(
            "/v1/sync/status?replica_id={}&vault_id={}",
            self.replica_id, self.vault_id
        );
        let value = self.get_json(&path)?;
        parse_status(&value)
    }

    /// `SyncApi::push`: `{replica_id, vault_id, ops[]} -> {ack, conflicts,
    /// server_vv}`. Strict parse: missing/wrong-typed fields = Protocol.
    pub fn push(&self, ops: &[WireOp]) -> Result<PushOutcome, SyncClientError> {
        let payload = serde_json::json!({
            "protocol": SYNC_PROTOCOL,
            "replica_id": self.replica_id,
            "vault_id": self.vault_id,
            "ops": ops,
        });
        let value = self.post("/v1/sync/push", &payload)?;
        parse_push(&value)
    }

    /// `SyncApi::pull`: `{replica_id, vault_id, since_vv} -> {ops,
    /// server_vv, truncated}`. Strict parse.
    pub fn pull(
        &self,
        since_vv: &std::collections::BTreeMap<String, u64>,
    ) -> Result<PullOutcome, SyncClientError> {
        let payload = serde_json::json!({
            "protocol": SYNC_PROTOCOL,
            "replica_id": self.replica_id,
            "vault_id": self.vault_id,
            "since_vv": since_vv.iter().map(|(id, value)| (id, value.to_string()))
                .collect::<std::collections::BTreeMap<_, _>>(),
        });
        let value = self.post("/v1/sync/pull", &payload)?;
        parse_pull(&value)
    }

    /// `SyncApi::ack`: `{replica_id, vault_id, ack[]} -> {acked, removed}`.
    pub fn ack(&self, ack: &[String]) -> Result<Vec<String>, SyncClientError> {
        let payload = serde_json::json!({
            "replica_id": self.replica_id,
            "vault_id": self.vault_id,
            "ack": ack,
        });
        let value = self.post("/v1/sync/ack", &payload)?;
        let acked = super::require_array(&value, "acked").map_err(SyncClientError::Protocol)?;
        let mut out = Vec::with_capacity(acked.len());
        for v in acked {
            out.push(
                v.as_str()
                    .ok_or_else(|| SyncClientError::Protocol("protocol: bad ack id".to_string()))?
                    .to_string(),
            );
        }
        Ok(out)
    }

    fn post(
        &self,
        path: &str,
        payload: &serde_json::Value,
    ) -> Result<serde_json::Value, SyncClientError> {
        let token = self.token()?;
        let (status, body) = super::post_json(&self.base, path, Some(token), payload)
            .map_err(SyncClientError::Transport)?;
        strict_body("POST", path, status, &body)
    }

    fn get_json(&self, path: &str) -> Result<serde_json::Value, SyncClientError> {
        let token = self.token()?;
        let (status, body) =
            super::get(&self.base, path, Some(token)).map_err(SyncClientError::Transport)?;
        strict_body("GET", path, status, &body)
    }

    fn token(&self) -> Result<&str, SyncClientError> {
        self.token
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or(SyncClientError::MissingCredentials)
    }
}

/// Strict response envelope: invalid JSON is already a Protocol error from
/// `parse_json_strict`; non-2xx statuses are Rejected with method+path-base+
/// status only (never full URL/query/secrets).
fn strict_body(
    method: &'static str,
    path: &str,
    status: u16,
    body: &[u8],
) -> Result<serde_json::Value, SyncClientError> {
    // Allowlist log: method + path-base + status only. Bodies are never
    // logged and never embedded in errors (may carry server text/secrets).
    let base = super::log_path_base(path).to_string();
    if !(200..300).contains(&status) {
        let _event = super::SyncLogEvent {
            method,
            path_base: base,
            status: Some(status),
            detail: super::SyncLogDetail::Rejected,
        };
        return Err(SyncClientError::Rejected {
            status,
            body: String::new(),
        });
    }
    super::parse_json_strict(body).map_err(SyncClientError::Protocol)
}

#[derive(serde::Deserialize)]
#[serde(transparent)]
struct ParsedVv(#[serde(with = "super::vv_string")] std::collections::BTreeMap<String, u64>);

fn parse_vv(
    value: &serde_json::Value,
) -> Result<std::collections::BTreeMap<String, u64>, SyncClientError> {
    let raw = value
        .get("server_vv")
        .ok_or_else(|| SyncClientError::Protocol("protocol: missing server_vv".into()))?;
    serde_json::from_value::<ParsedVv>(raw.clone())
        .map(|vv| vv.0)
        .map_err(|_| SyncClientError::Protocol("protocol: invalid server_vv".into()))
}

fn require_count(value: &serde_json::Value, field: &str) -> Result<usize, SyncClientError> {
    super::require_u64(value, field)
        .map_err(SyncClientError::Protocol)
        .and_then(|count| {
            usize::try_from(count)
                .map_err(|_| SyncClientError::Protocol("protocol: count overflow".into()))
        })
}

fn parse_status(value: &serde_json::Value) -> Result<SyncStatus, SyncClientError> {
    Ok(SyncStatus {
        replica_id: super::require_str(value, "replica_id").map_err(SyncClientError::Protocol)?,
        server_vv: parse_vv(value)?,
        docs: require_count(value, "docs")?,
        pending: require_count(value, "pending")?,
        conflicts: require_count(value, "conflicts")?,
        tombstones: require_count(value, "tombstones")?,
        trash: require_count(value, "trash")?,
    })
}

fn parse_push(value: &serde_json::Value) -> Result<PushOutcome, SyncClientError> {
    let ack_arr = super::require_array(value, "ack").map_err(SyncClientError::Protocol)?;
    let mut ack = Vec::with_capacity(ack_arr.len());
    for v in ack_arr {
        ack.push(
            v.as_str()
                .ok_or_else(|| SyncClientError::Protocol("protocol: bad ack id".to_string()))?
                .to_string(),
        );
    }
    let conflicts_arr =
        super::require_array(value, "conflicts").map_err(SyncClientError::Protocol)?;
    let mut conflicts = Vec::with_capacity(conflicts_arr.len());
    for v in conflicts_arr {
        conflicts.push(
            serde_json::from_value::<WireConflict>(v.clone())
                .map_err(|e| SyncClientError::Protocol(format!("protocol: bad conflict: {e}")))?,
        );
    }
    let server_vv = parse_vv(value)?;
    Ok(PushOutcome {
        ack,
        conflicts,
        server_vv,
    })
}

fn parse_pull(value: &serde_json::Value) -> Result<PullOutcome, SyncClientError> {
    let ops_arr = super::require_array(value, "ops").map_err(SyncClientError::Protocol)?;
    let mut ops = Vec::with_capacity(ops_arr.len());
    for v in ops_arr {
        ops.push(
            serde_json::from_value::<WireOp>(v.clone())
                .map_err(|e| SyncClientError::Protocol(format!("protocol: bad op: {e}")))?,
        );
    }
    let server_vv = parse_vv(value)?;
    let truncated = value
        .get("truncated")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| {
            SyncClientError::Protocol("protocol: missing or invalid 'truncated'".to_string())
        })?;
    Ok(PullOutcome {
        ops,
        server_vv,
        truncated,
    })
}

/// Mandatory security exclusions (Main): fixed, never user-removable.
/// Mirrors `fub_services::sync::{is_syncable_doc, DEVICE_PREFIXES}`.
pub fn is_syncable_path(path: &str) -> bool {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains(['\\', '\0'])
        || path.split('/').any(|part| matches!(part, "" | "." | ".."))
    {
        return false;
    }
    let lower = path.to_ascii_lowercase();
    let first = lower.split('/').next().unwrap_or("");
    if matches!(
        first,
        "cache" | "drafts" | "device" | "secrets" | ".fub" | "theme" | "plugins"
    ) {
        return false;
    }
    for prefix in [
        "cache/", "drafts/", "device/", "secrets/", ".fub/", "theme/", "plugins/",
    ] {
        if lower.starts_with(prefix) {
            return false;
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Vault-key lifecycle (VDK at runtime, per parent contract).
// ---------------------------------------------------------------------------

/// Passphrase source: file or environment variable, never argv or logs.
pub fn load_vault_passphrase() -> Result<String, SyncClientError> {
    if let Ok(path) = std::env::var("FUB_SERVICES_VAULT_PASSPHRASE_FILE") {
        if !path.trim().is_empty() {
            let raw = std::fs::read_to_string(path.trim()).map_err(|_| {
                SyncClientError::Transport("vault passphrase file unreadable".into())
            })?;
            let p = raw.trim().to_string();
            if !p.is_empty() {
                return Ok(p);
            }
        }
    }
    std::env::var("FUB_SERVICES_VAULT_PASSPHRASE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or(SyncClientError::MissingCredentials)
}

/// Replica del job: stessa radice trusted `<config>/sync/` del bundle.
pub fn load_or_create_replica_id(state_dir: &std::path::Path) -> Result<String, SyncClientError> {
    let path = state_dir.join("replica-id");
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let id = raw.trim();
            uuid::Uuid::parse_str(id).map_err(|_| SyncClientError::RecoveryNeeded {
                quarantined: 1,
                preserved: 0,
            })?;
            Ok(id.to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let id = super::new_replica_id();
            super::atomic_state_write(state_dir, "replica-id", id.as_bytes()).map_err(|_| {
                SyncClientError::Transport("sync replica state write failed".into())
            })?;
            Ok(id)
        }
        Err(_) => Err(SyncClientError::Transport(
            "sync replica state unreadable".into(),
        )),
    }
}
