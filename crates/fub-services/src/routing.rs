//! # Instradamento versionato: `fub-sync/1` + `fub-publish/1` (P16/P17)
//!
//! Ogni chiamata remota dichiara la versione: mismatch = errore duro, nessun
//! fallback silenzioso. `GET /v1/hello` riporta entrambe le versioni e
//! l'identità del server.

use serde::{Deserialize, Serialize};

/// Versione wire del protocollo sync.
pub const SYNC_PROTOCOL: &str = "fub-sync/1";
/// Versione wire del protocollo publish.
pub const PUBLISH_PROTOCOL: &str = "fub-publish/1";
/// Identità server riportata da `GET /v1/hello`.
pub const SERVER_IDENT: &str = "fub-services/0.1.0";

/// Rotte tipizzate del servizio.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    Hello,
    AccountRegister,
    AccountLogin,
    MfaVerify,
    SyncPush,
    SyncPull,
    SyncAck,
    SyncStatus,
    SyncVersions,
    SyncTrash,
    SyncRestore,
    SyncInvite,
    SyncInviteAccept,
    SyncRevoke,
    SyncVaultKeyStore,
    SyncVaultKeyGet,
    PublishDryRun,
    PublishCommit,
    PublishUnpublish,
    PublishRollback,
    PublishStatus,
    PublishSiteAdmin,
    /// Configurazione isolamento custom-JS di un sito (parent, sidecar).
    PublishIsolation,
    /// `GET /s/<site>/...`: contenuto statico pubblicato (con gate password).
    StaticSite {
        site: String,
        rest: String,
    },
    Unknown,
}

/// Toglie la query (`?site_id=...`) prima del match: le rotte si confrontano
/// sul path, i parametri restano all'handler (`publish::handle` li rilegge).
fn base_path(path: &str) -> &str {
    match path.find('?') {
        Some(i) => &path[..i],
        None => path,
    }
}

/// `method + path` -> rotta (`/v1/...` o `/s/...`).
pub fn route(method: &str, path: &str) -> Route {
    let base = base_path(path);
    match (method, base) {
        ("GET", "/v1/hello") => Route::Hello,
        ("POST", "/v1/account/register") => Route::AccountRegister,
        ("POST", "/v1/account/login") => Route::AccountLogin,
        ("POST", "/v1/mfa/verify") => Route::MfaVerify,
        ("POST", "/v1/sync/push") => Route::SyncPush,
        ("POST", "/v1/sync/pull") => Route::SyncPull,
        ("POST", "/v1/sync/ack") => Route::SyncAck,
        ("GET", "/v1/sync/status") => Route::SyncStatus,
        ("GET", "/v1/sync/versions") => Route::SyncVersions,
        ("POST", "/v1/sync/trash") => Route::SyncTrash,
        ("POST", "/v1/sync/restore") => Route::SyncRestore,
        ("POST", "/v1/sync/invite") => Route::SyncInvite,
        ("POST", "/v1/sync/invite/accept") => Route::SyncInviteAccept,
        ("POST", "/v1/sync/revoke") => Route::SyncRevoke,
        ("POST", "/v1/sync/vault-key") => Route::SyncVaultKeyStore,
        ("GET", "/v1/sync/vault-key") => Route::SyncVaultKeyGet,
        ("POST", "/v1/publish/dry-run") => Route::PublishDryRun,
        ("POST", "/v1/publish/commit") => Route::PublishCommit,
        ("POST", "/v1/publish/unpublish") => Route::PublishUnpublish,
        ("POST", "/v1/publish/rollback") => Route::PublishRollback,
        ("GET", "/v1/publish/status") => Route::PublishStatus,
        ("POST", "/v1/publish/site") => Route::PublishSiteAdmin,
        ("POST", "/v1/publish/isolation") => Route::PublishIsolation,
        ("GET", p) if p.starts_with("/s/") => {
            let tail = &p[3..];
            let (site, rest) = match tail.find('/') {
                Some(i) => (tail[..i].to_string(), tail[i..].to_string()),
                None => (tail.to_string(), "/".to_string()),
            };
            Route::StaticSite { site, rest }
        }
        _ => Route::Unknown,
    }
}

/// Forma di `GET /v1/hello`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hello {
    pub protocol: String,
    pub publish_protocol: String,
    pub server: String,
}

impl Hello {
    pub fn current() -> Self {
        Self {
            protocol: SYNC_PROTOCOL.to_string(),
            publish_protocol: PUBLISH_PROTOCOL.to_string(),
            server: SERVER_IDENT.to_string(),
        }
    }
}

/// Errore duro su mismatch di versione: nessuna negoziazione silenziosa.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    #[error("protocol mismatch: got {got}, want {want}")]
    Mismatch { got: String, want: &'static str },
}

/// `client_protocol` deve valere `want`, altrimenti [`ProtocolError`].
pub fn assert_protocol(client_protocol: &str, want: &'static str) -> Result<(), ProtocolError> {
    if client_protocol == want {
        Ok(())
    } else {
        Err(ProtocolError::Mismatch {
            got: client_protocol.to_string(),
            want,
        })
    }
}
