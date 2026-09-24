//! # MFA TOTP RFC6238 con anti-replay e rate limiting (P16.3, F40)
//!
//! Segreto 20 B base32, codice a 6 cifre con finestra 30 s ±1 passo,
//! confronto in tempo costante, rigetto del contatore già usato
//! (anti-replay) e limite di 5 tentativi falliti / 5 minuti per account.

use std::collections::BTreeMap;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ring::hmac;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::schema::now_ms;

const STEP_MS: u64 = 30_000;
const MAX_FAILS: u32 = 5;
const WINDOW_MS: u64 = 5 * 60 * 1000;

/// Segreto TOTP persistito per account (mai nei log: solo `enrolled` si espone).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TotpRecord {
    pub secret_b64: String,
    pub last_counter: Option<u64>,
}

/// Segreto appena generato (mostrato UNA volta all'utente in enrollment).
pub struct TotpSecret {
    pub secret_b64: String,
}

/// Genera un segreto TOTP (20 B casuali).
pub fn generate_secret() -> Result<TotpSecret, String> {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut raw = [0u8; 20];
    rng.fill(&mut raw)
        .map_err(|_| "rng unavailable".to_string())?;
    Ok(TotpSecret {
        secret_b64: B64.encode(raw),
    })
}

fn hotp(secret: &[u8], counter: u64) -> u32 {
    let key = hmac::Key::new(hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, secret);
    let tag = hmac::sign(&key, &counter.to_be_bytes());
    let d = tag.as_ref();
    let off = (d[d.len() - 1] & 0x0f) as usize;
    let n = u32::from_be_bytes([d[off], d[off + 1], d[off + 2], d[off + 3]]) & 0x7fff_ffff;
    n % 1_000_000
}

/// Calcola il codice a 6 cifre per `now_ms` (helper client/test enrollment).
pub fn totp_code(secret_b64: &str, at_ms: u64) -> Result<String, String> {
    let secret = B64
        .decode(secret_b64)
        .map_err(|_| "bad totp secret".to_string())?;
    Ok(format!("{:06}", hotp(&secret, at_ms / STEP_MS)))
}

/// Verifica il codice con finestra ±1 passo e anti-replay.
///
/// Aggiorna `record.last_counter` sul successo; sul fallimento il chiamante
/// registra con [`LoginRateLimit::note_fail`].
pub fn verify(record: &mut TotpRecord, code: &str, at_ms: u64) -> Result<bool, String> {
    let secret = B64
        .decode(&record.secret_b64)
        .map_err(|_| "bad totp secret".to_string())?;
    let digits: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() != 6 {
        return Ok(false);
    }
    let center = at_ms / STEP_MS;
    for delta in [-1i64, 0, 1] {
        let c = center.saturating_add_signed(delta);
        let want = format!("{:06}", hotp(&secret, c));
        if bool::from(want.as_bytes().ct_eq(digits.as_bytes())) {
            if let Some(last) = record.last_counter {
                if c <= last {
                    return Ok(false);
                }
            }
            record.last_counter = Some(c);
            return Ok(true);
        }
    }
    Ok(false)
}

/// Rate limiting login: 5 fallimenti / 5 minuti per chiave (account+ip).
#[derive(Clone, Debug, Default)]
pub struct LoginRateLimit {
    fails: BTreeMap<String, (u32, u64)>,
}

impl LoginRateLimit {
    pub fn new() -> Self {
        Self::default()
    }

    /// `true` se la chiave è attualmente bloccata.
    pub fn blocked(&self, key: &str, at_ms: u64) -> bool {
        matches!(self.fails.get(key), Some((n, first)) if *n >= MAX_FAILS && at_ms.saturating_sub(*first) < WINDOW_MS)
    }

    /// Registra un fallimento; la finestra riparte dopo la scadenza.
    pub fn note_fail(&mut self, key: &str, at_ms: u64) {
        match self.fails.get(key) {
            Some((n, first)) if at_ms.saturating_sub(*first) < WINDOW_MS => {
                self.fails.insert(key.to_string(), (n + 1, *first));
            }
            _ => {
                self.fails.insert(key.to_string(), (1, at_ms));
            }
        }
    }

    /// Pulisce dopo un login riuscito.
    pub fn note_success(&mut self, key: &str) {
        self.fails.remove(key);
    }

    /// Alias con firma `verify_totp`-compatibile per i discendenti:
    /// verifica il codice TOTP con finestra, anti-replay e rate limit.
    pub fn check_totp(
        &mut self,
        record: &mut TotpRecord,
        key: &str,
        code: &str,
    ) -> Result<bool, String> {
        let now = now_ms();
        if self.blocked(key, now) {
            return Err("rate limited".to_string());
        }
        let ok = verify(record, code, now)?;
        if ok {
            self.note_success(key);
        } else {
            self.note_fail(key, now);
        }
        Ok(ok)
    }
}

/// Firma `verify_totp` attesa dai discendenti (stateless: rate limit a parte).
pub fn verify_totp(record: &mut TotpRecord, code: &str, at_ms: u64) -> Result<bool, String> {
    verify(record, code, at_ms)
}
