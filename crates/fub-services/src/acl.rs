//! # ACL condivise: ruoli, share vault, inviti (P16.8, P17.6)
//!
//! Ruoli `Owner > Admin > Writer > Reader`. La revoca toglie l'accesso futuro;
//! le copie già scaricate restano (documentato, mai cancellazione remota
//! silenziosa). Inviti con token opaco e scadenza; la distribuzione della
//! chiave resta operativa (vedi lib.rs), qui si autorizza.

use serde::{Deserialize, Serialize};

use crate::schema::now_ms;

/// Ruolo su una risorsa condivisa (vault remoto o sito).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Reader,
    Writer,
    Admin,
    Owner,
}

impl Role {
    /// `true` se il ruolo copre il livello richiesto.
    pub fn covers(self, need: Role) -> bool {
        self >= need
    }
}

/// ACL di una risorsa condivisa: `resource` = `vault:<id>` o `site:<id>`.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ShareAcl {
    pub resource: String,
    pub grants: Vec<Grant>,
}

/// Singola concessione.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Grant {
    pub account_id: String,
    pub role: Role,
    pub granted_ms: u64,
}

/// Invito pendente con token opaco e scadenza.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Invite {
    pub token_b64: String,
    pub resource: String,
    pub role: Role,
    pub created_ms: u64,
    pub expires_ms: u64,
    pub accepted: bool,
}

impl ShareAcl {
    pub fn new(resource: &str) -> Self {
        Self {
            resource: resource.to_string(),
            grants: Vec::new(),
        }
    }

    /// Concede (o alza) un ruolo. Solo chi ha `Admin` può concedere: il
    /// controllo spetta al chiamante via [`check`] prima di chiamare.
    pub fn grant(&mut self, account_id: &str, role: Role) {
        if let Some(g) = self.grants.iter_mut().find(|g| g.account_id == account_id) {
            if role > g.role {
                g.role = role;
            }
        } else {
            self.grants.push(Grant {
                account_id: account_id.to_string(),
                role,
                granted_ms: now_ms(),
            });
        }
    }

    /// Revoca: niente più accesso futuro. Le copie già scaricate restano.
    pub fn revoke(&mut self, account_id: &str) {
        self.grants.retain(|g| g.account_id != account_id);
    }

    /// Ruolo attuale, se presente.
    pub fn role_of(&self, account_id: &str) -> Option<Role> {
        self.grants
            .iter()
            .find(|g| g.account_id == account_id)
            .map(|g| g.role)
    }
}

/// `Ok(())` se `account_id` copre `need` su `acl`, altrimenti errore tipizzato.
pub fn check(acl: &ShareAcl, account_id: &str, need: Role) -> Result<(), String> {
    match acl.role_of(account_id) {
        Some(role) if role.covers(need) => Ok(()),
        Some(_) => Err("forbidden: role too low".to_string()),
        None => Err("forbidden: no grant".to_string()),
    }
}

impl Invite {
    /// Nuovo invito con scadenza (default 7 giorni).
    pub fn new_invite(resource: &str, role: Role, ttl_ms: u64) -> Result<Self, String> {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64U;
        use base64::Engine;
        use ring::rand::{SecureRandom, SystemRandom};
        let rng = SystemRandom::new();
        let mut raw = [0u8; 32];
        rng.fill(&mut raw)
            .map_err(|_| "rng unavailable".to_string())?;
        let now = now_ms();
        Ok(Self {
            token_b64: B64U.encode(raw),
            resource: resource.to_string(),
            role,
            created_ms: now,
            expires_ms: now + ttl_ms,
            accepted: false,
        })
    }

    /// Accetta l'invito: marca usato e concede il ruolo sull'ACL.
    pub fn accept_invite(&mut self, acl: &mut ShareAcl, account_id: &str) -> Result<(), String> {
        if self.accepted {
            return Err("invite already used".to_string());
        }
        if now_ms() > self.expires_ms {
            return Err("invite expired".to_string());
        }
        if acl.resource != self.resource {
            return Err("invite resource mismatch".to_string());
        }
        self.accepted = true;
        acl.grant(account_id, self.role);
        Ok(())
    }
}

/// Alias con firma attesa dai discendenti.
pub fn new_invite(resource: &str, role: Role, ttl_ms: u64) -> Result<Invite, String> {
    Invite::new_invite(resource, role, ttl_ms)
}

/// Alias con firma attesa dai discendenti.
pub fn accept_invite(
    invite: &mut Invite,
    acl: &mut ShareAcl,
    account_id: &str,
) -> Result<(), String> {
    invite.accept_invite(acl, account_id)
}
