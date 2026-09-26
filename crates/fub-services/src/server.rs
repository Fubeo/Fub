//! # Stato del servizio e risposte HTTP tipizzate (comune a sync/publish)
//!
//! `ServiceState` tiene data dir + config + registro account (persistito).
//! `HttpResponse` è `{status, content_type, body}`: il `main.rs` lo scrive sul
//! socket, gli handler lo costruiscono. `redact` depura i segreti dai log.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::auth::AccountStore;
use crate::schema::{config_path, data_dir, ServicesConfig};

/// Risposta tipizzata di un handler (`sync::handle`, `publish::handle` ...).
#[derive(Clone, Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn json<T: Serialize>(status: u16, value: &T) -> Self {
        let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
        Self {
            status,
            content_type: "application/json",
            body,
        }
    }

    pub fn html(status: u16, body: Vec<u8>) -> Self {
        Self {
            status,
            content_type: "text/html; charset=utf-8",
            body,
        }
    }

    pub fn text(status: u16, msg: &str) -> Self {
        Self {
            status,
            content_type: "text/plain; charset=utf-8",
            body: msg.as_bytes().to_vec(),
        }
    }

    pub fn err(status: u16, code: &str) -> Self {
        Self::json(status, &serde_json::json!({ "error": code }))
    }

    /// Testo di stato HTTP per lo status numerico.
    pub fn status_text(&self) -> &'static str {
        match self.status {
            200 => "OK",
            201 => "Created",
            400 => "Bad Request",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            408 => "Request Timeout",
            409 => "Conflict",
            414 => "Request-URI Too Long",
            417 => "Expectation Failed",
            422 => "Unprocessable Entity",
            429 => "Too Many Requests",
            431 => "Request Header Fields Too Large",
            500 => "Internal Server Error",
            503 => "Service Unavailable",
            _ => "OK",
        }
    }
}

/// Stato condiviso del servizio (un'istanza per processo binario).
pub struct ServiceState {
    pub data_dir: PathBuf,
    pub config: ServicesConfig,
    pub accounts: AccountStore,
    /// Rate limiting login (chiave `account`).
    pub logins: crate::mfa::LoginRateLimit,
    /// ACL per risorsa (`vault:<id>`, `site:<id>`).
    pub acls: BTreeMap<String, crate::acl::ShareAcl>,
    /// TOTP per account (segreti mai nei log).
    pub totps: BTreeMap<String, crate::mfa::TotpRecord>,
}

impl ServiceState {
    /// Apre/crea la data dir e carica config + account.
    pub fn open(dir: Option<PathBuf>) -> Result<Self, String> {
        let data_dir = dir.unwrap_or_else(data_dir);
        std::fs::create_dir_all(&data_dir).map_err(|e| format!("data dir: {e}"))?;
        let config = {
            let path = config_path(&data_dir);
            if path.exists() {
                let bytes = std::fs::read(&path).map_err(|e| format!("config read: {e}"))?;
                serde_json::from_slice(&bytes).map_err(|e| format!("config parse: {e}"))?
            } else {
                ServicesConfig::default()
            }
        };
        let accounts = AccountStore::load(&data_dir)?;
        Ok(Self {
            data_dir,
            config,
            accounts,
            logins: crate::mfa::LoginRateLimit::new(),
            acls: BTreeMap::new(),
            totps: BTreeMap::new(),
        })
    }

    /// ACL della risorsa (creata vuota se assente).
    pub fn acl_mut(&mut self, resource: &str) -> &mut crate::acl::ShareAcl {
        self.acls
            .entry(resource.to_string())
            .or_insert_with(|| crate::acl::ShareAcl::new(resource))
    }

    /// Verifica il bearer e torna l'`account_id` (errore tipizzato, mai log).
    pub fn bearer(&self, auth: Option<&str>) -> Result<String, HttpResponse> {
        self.accounts
            .verify_session_token(auth)
            .map_err(|rejection| HttpResponse::err(rejection.status(), rejection.code()))
    }
}

/// Log strutturato allowlist (Main): niente testo libero con segreti.
///
/// Il vecchio `redact` a finestra fissa è vietato (taglia chiave+24 byte,
/// leak del suffisso, JSON/Bearer/case non coperti, panic UTF-8). I log del
/// servizio registrano SOLO metodo + path base (mai query) + status: mai
/// corpi, header, token o buste. Chi logga costruisce la riga da questi tre
/// campi, mai da valori di richiesta.
pub fn log_line(method: &str, path: &str, status: u16) -> String {
    let base = match path.find('?') {
        Some(i) => &path[..i],
        None => path,
    };
    format!("{method} {base} -> {status}")
}

/// Compat: `redact` a finestra fissa non filtra più (leak del suffisso).
/// Resta come alias che non registra mai l'input. Chi logga usa `log_line`.
#[deprecated(
    note = "log log_line(method, path-base, status) instead: fixed-window redaction leaks"
)]
pub fn redact(_value: &str) -> String {
    String::from("<unlogged>")
}

/// Corpo di login/register decodificato senza mai registrarlo.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Credentials {
    pub name: String,
    pub password: String,
}

pub fn parse_credentials(body: &[u8]) -> Result<Credentials, HttpResponse> {
    serde_json::from_slice(body).map_err(|_| HttpResponse::err(400, "bad credentials body"))
}
