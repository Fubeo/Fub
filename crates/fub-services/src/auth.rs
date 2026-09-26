//! # Account: registrazione, password, sessioni, dispositivi (P16.3)
//!
//! Password con PBKDF2-HMAC-SHA256 versionata ([`crypto::KdfParams`]); token di
//! sessione opachi 32 B base64url via `Authorization: Bearer` (mai in argv/log).
//! Cancellazione remota = revoca lato server; la copia locale resta (P16.3).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64U;
use base64::Engine;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::crypto::{derive_kek, KdfParams};
use crate::schema::{accounts_path, atomic_write, now_ms};

/// Perché un bearer non vale. Lo status HTTP si sceglie sulla variante, mai
/// sul testo del messaggio (I73): [`TokenRejection::status`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenRejection {
    /// Nessun token, o un header vuoto.
    Missing,
    /// Un token che non corrisponde a nessuna sessione.
    Bad,
    /// La sessione c'era, ed è scaduta.
    Expired,
    /// La sessione nomina un account che non c'è più.
    UnknownAccount,
    /// L'account è stato cancellato.
    AccountDeleted,
}

impl TokenRejection {
    /// Il codice nel corpo della risposta (`{"error": …}`).
    pub fn code(self) -> &'static str {
        match self {
            TokenRejection::Missing => "missing credentials",
            TokenRejection::Bad => "bad token",
            TokenRejection::Expired => "token expired",
            TokenRejection::UnknownAccount => "unknown account",
            TokenRejection::AccountDeleted => "account deleted",
        }
    }

    /// `401` quando basta autenticarsi di nuovo, `403` quando l'account
    /// stesso non è più servibile.
    pub fn status(self) -> u16 {
        match self {
            TokenRejection::Missing | TokenRejection::Bad | TokenRejection::Expired => 401,
            TokenRejection::UnknownAccount | TokenRejection::AccountDeleted => 403,
        }
    }
}

impl std::fmt::Display for TokenRejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

/// Hash persistito della password account (mai la chiave dati).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PasswordHash {
    pub kdf: KdfParams,
    pub hash_b64: String,
}

/// Dispositivo registrato (P16.3: dispositivi multipli per account).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub created_ms: u64,
}

/// Account persistito.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub pw: PasswordHash,
    pub devices: Vec<Device>,
    pub created_ms: u64,
    /// Cancellato remoto: sessioni revocate, copie locali altrui intatte.
    pub deleted: bool,
}

/// Sessione opaca (token 32 B casuali, scadenza 30 giorni).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionToken {
    pub token_b64: String,
    pub account_id: String,
    pub created_ms: u64,
    pub expires_ms: u64,
}

/// Registro account persistito in `<data>/accounts.json` (scrittura atomica).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AccountStore {
    pub accounts: BTreeMap<String, Account>,
    pub by_name: BTreeMap<String, String>,
    pub sessions: BTreeMap<String, SessionToken>,
    #[serde(skip)]
    pub path: PathBuf,
}

impl AccountStore {
    /// Carica (o crea vuoto) dalla data dir.
    pub fn load(data_dir: &Path) -> Result<Self, String> {
        let path = accounts_path(data_dir);
        if !path.exists() {
            return Ok(Self {
                path,
                ..Default::default()
            });
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("accounts read: {e}"))?;
        let mut store: AccountStore =
            serde_json::from_slice(&bytes).map_err(|e| format!("accounts parse: {e}"))?;
        store.path = path;
        Ok(store)
    }

    fn save(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| format!("accounts encode: {e}"))?;
        atomic_write(&self.path, &bytes).map_err(|e| format!("accounts write: {e}"))?;
        Ok(())
    }

    fn hash_password(password: &str) -> Result<PasswordHash, String> {
        let kdf = KdfParams::fresh()?;
        let kek = derive_kek(password, &kdf)?;
        Ok(PasswordHash {
            kdf,
            hash_b64: B64U.encode(kek),
        })
    }

    fn check_password(password: &str, pw: &PasswordHash) -> Result<bool, String> {
        let kek = derive_kek(password, &pw.kdf)?;
        let expected = B64U
            .decode(&pw.hash_b64)
            .map_err(|_| "bad password hash".to_string())?;
        if expected.len() != kek.len() {
            return Ok(false);
        }
        Ok(bool::from(kek.as_slice().ct_eq(expected.as_slice())))
    }

    fn random_token() -> Result<String, String> {
        use ring::rand::{SecureRandom, SystemRandom};
        let rng = SystemRandom::new();
        let mut raw = [0u8; 32];
        rng.fill(&mut raw)
            .map_err(|_| "rng unavailable".to_string())?;
        Ok(B64U.encode(raw))
    }

    /// Crea un account (`POST /v1/account/register {name,password}`).
    pub fn create_account(&mut self, name: &str, password: &str) -> Result<String, String> {
        let name = name.trim().to_string();
        if name.is_empty() || name.len() > 128 {
            return Err("bad account name".to_string());
        }
        if password.len() < 8 {
            return Err("password too short (min 8)".to_string());
        }
        if self.by_name.contains_key(&name) {
            return Err("account exists".to_string());
        }
        let id = crate::schema::new_id();
        let pw = Self::hash_password(password)?;
        let now = now_ms();
        self.accounts.insert(
            id.clone(),
            Account {
                id: id.clone(),
                name: name.clone(),
                pw,
                devices: Vec::new(),
                created_ms: now,
                deleted: false,
            },
        );
        self.by_name.insert(name, id.clone());
        self.save()?;
        Ok(id)
    }

    /// Inserisce un account con hash già calcolato (fuori dal lock): il
    /// chiamante valida nome/duplicati in un primo lock breve, calcola la KDF
    /// senza lock, poi inserisce qui in un secondo lock breve.
    pub fn insert_prepared(&mut self, name: &str, pw: PasswordHash) -> Result<String, String> {
        let name = name.trim().to_string();
        if name.is_empty() || name.len() > 128 {
            return Err("bad account name".to_string());
        }
        if self.by_name.contains_key(&name) {
            return Err("account exists".to_string());
        }
        let id = crate::schema::new_id();
        let now = now_ms();
        self.accounts.insert(
            id.clone(),
            Account {
                id: id.clone(),
                name: name.clone(),
                pw,
                devices: Vec::new(),
                created_ms: now,
                deleted: false,
            },
        );
        self.by_name.insert(name, id.clone());
        self.save()?;
        Ok(id)
    }

    /// Snapshot del solo hash per il calcolo PBKDF2 fuori dal lock globale:
    /// `verify_password` resta il percorso semplice, `password_hash_of` +
    /// `check_hash` sono il percorso che non blocca sync/publish durante i
    /// 210k round (il lock copre solo lookup/emissione, mai la KDF).
    pub fn password_hash_of(&self, name: &str) -> Result<(String, PasswordHash), String> {
        let id = self
            .by_name
            .get(name.trim())
            .ok_or_else(|| "unknown account".to_string())?;
        let acc = self
            .accounts
            .get(id)
            .ok_or_else(|| "unknown account".to_string())?;
        if acc.deleted {
            return Err("account deleted".to_string());
        }
        Ok((acc.id.clone(), acc.pw.clone()))
    }

    /// Verifica una password contro uno snapshot di hash (fuori dal lock).
    pub fn check_hash(password: &str, pw: &PasswordHash) -> Result<bool, String> {
        Self::check_password(password, pw)
    }

    /// Prepara un hash da una password in chiaro (fuori dal lock): la KDF
    /// gira sul worker prima di prendere il lock per l'inserimento.
    pub fn prepare_hash(password: &str) -> Result<PasswordHash, String> {
        Self::hash_password(password)
    }

    pub fn verify_password(&self, name: &str, password: &str) -> Result<String, String> {
        let id = self
            .by_name
            .get(name.trim())
            .ok_or_else(|| "unknown account".to_string())?;
        let acc = self
            .accounts
            .get(id)
            .ok_or_else(|| "unknown account".to_string())?;
        if acc.deleted {
            return Err("account deleted".to_string());
        }
        if Self::check_password(password, &acc.pw)? {
            Ok(acc.id.clone())
        } else {
            Err("bad password".to_string())
        }
    }

    /// Emette un token di sessione opaco per `account_id`.
    pub fn issue_session_token(&mut self, account_id: &str) -> Result<String, String> {
        if !self.accounts.contains_key(account_id) {
            return Err("unknown account".to_string());
        }
        let token = Self::random_token()?;
        let now = now_ms();
        self.sessions.insert(
            token.clone(),
            SessionToken {
                token_b64: token.clone(),
                account_id: account_id.to_string(),
                created_ms: now,
                expires_ms: now + 30 * 24 * 3600 * 1000,
            },
        );
        self.save()?;
        Ok(token)
    }

    /// Verifica `Authorization: Bearer <token>` (accetta anche il token nudo):
    /// torna l'`account_id` o un errore tipizzato (mai il segreto nei log).
    pub fn verify_session_token(&self, auth: Option<&str>) -> Result<String, TokenRejection> {
        let raw = auth.ok_or(TokenRejection::Missing)?;
        let token = raw
            .strip_prefix("Bearer ")
            .or_else(|| raw.strip_prefix("bearer "))
            .unwrap_or(raw)
            .trim();
        if token.is_empty() {
            return Err(TokenRejection::Missing);
        }
        let sess = self.sessions.get(token).ok_or(TokenRejection::Bad)?;
        if now_ms() > sess.expires_ms {
            return Err(TokenRejection::Expired);
        }
        let acc = self
            .accounts
            .get(&sess.account_id)
            .ok_or(TokenRejection::UnknownAccount)?;
        if acc.deleted {
            return Err(TokenRejection::AccountDeleted);
        }
        Ok(acc.id.clone())
    }

    /// Registra un dispositivo per l'account.
    pub fn register_device(&mut self, account_id: &str, name: &str) -> Result<Device, String> {
        let acc = self
            .accounts
            .get_mut(account_id)
            .ok_or_else(|| "unknown account".to_string())?;
        let dev = Device {
            id: crate::schema::new_id(),
            name: name.chars().take(128).collect(),
            created_ms: now_ms(),
        };
        acc.devices.push(dev.clone());
        self.save()?;
        Ok(dev)
    }

    /// Cancellazione remota (P16.3): revoca le sessioni, marca eliminato.
    /// La copia locale del vault resta al suo posto (mai cancellata da qui).
    pub fn delete_account(&mut self, account_id: &str) -> Result<(), String> {
        let acc = self
            .accounts
            .get_mut(account_id)
            .ok_or_else(|| "unknown account".to_string())?;
        acc.deleted = true;
        self.sessions.retain(|_, s| s.account_id != account_id);
        self.save()?;
        Ok(())
    }
}
