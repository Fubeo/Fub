//! # MFA TOTP RFC6238 con anti-replay e rate limiting (P16.3, F40)
//!
//! Segreto 20 B (base64 sul wire), codice a 6 cifre con finestra 30 s ±1
//! passo, confronto in tempo costante, rigetto del contatore già usato
//! (anti-replay) e limite di 5 tentativi falliti / 5 minuti per account.
//! Segreto e contatore si persistono con l'account ([`TotpState`]).

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

/// Il secondo fattore di un account, persistito con l'account.
///
/// `active` è quello che login e step-up chiedono; `pending` è un segreto
/// appena mostrato che diventa attivo soltanto quando l'utente ne prova il
/// possesso con un codice. Attivarlo subito chiuderebbe fuori chi perde la
/// risposta dell'iscrizione prima di averlo salvato.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TotpState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<TotpRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<TotpRecord>,
}

impl TotpState {
    pub fn is_empty(&self) -> bool {
        self.active.is_none() && self.pending.is_none()
    }
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

/// Sotto questa soglia la mappa dei fallimenti non si pota: poche chiavi
/// costano meno di una scansione.
const PRUNE_FLOOR: usize = 1024;
/// Chiavi ricordate al massimo, anche dentro la finestra: oltre, un nome nuovo
/// non si ricorda (lo ferma il limite globale di [`crate::abuse`]) e la
/// memoria resta limitata qualunque sia la pioggia di nomi.
pub const MAX_KEYS: usize = 65_536;

/// Un limite di fallimenti per chiave: 5 (o `max_fails`) in 5 minuti. Le
/// chiavi sono quelle di [`LoginLimits`] o l'account di un passo MFA.
///
/// Il nome lo sceglie chi chiama, anche quando nessun account lo porta: le
/// finestre scadute si potano, o una pioggia di nomi sempre nuovi farebbe
/// crescere la mappa senza fine. La potatura scatta quando la mappa raddoppia,
/// quindi costa O(1) ammortizzato per fallimento.
#[derive(Clone, Debug)]
pub struct LoginRateLimit {
    fails: BTreeMap<String, (u32, u64)>,
    /// La dimensione della mappa a cui scatta la prossima potatura.
    prune_at: usize,
    /// I fallimenti nella finestra che bloccano la chiave.
    max_fails: u32,
}

impl Default for LoginRateLimit {
    fn default() -> Self {
        Self::with_max_fails(MAX_FAILS)
    }
}

impl LoginRateLimit {
    pub fn new() -> Self {
        Self::default()
    }

    /// Un limite che blocca la chiave dopo `max_fails` fallimenti in 5 minuti.
    pub fn with_max_fails(max_fails: u32) -> Self {
        Self {
            fails: BTreeMap::new(),
            prune_at: 0,
            max_fails,
        }
    }

    /// `true` se la chiave è attualmente bloccata.
    pub fn blocked(&self, key: &str, at_ms: u64) -> bool {
        matches!(self.fails.get(key), Some((n, first)) if *n >= self.max_fails && at_ms.saturating_sub(*first) < WINDOW_MS)
    }

    /// Registra un fallimento; la finestra riparte dopo la scadenza.
    pub fn note_fail(&mut self, key: &str, at_ms: u64) {
        match self.fails.get_mut(key) {
            Some((n, first)) if at_ms.saturating_sub(*first) < WINDOW_MS => {
                *n = n.saturating_add(1);
            }
            Some(entry) => *entry = (1, at_ms),
            None => {
                if self.fails.len() >= self.prune_at {
                    self.fails
                        .retain(|_, (_, first)| at_ms.saturating_sub(*first) < WINDOW_MS);
                    self.prune_at = (self.fails.len() * 2).max(PRUNE_FLOOR);
                }
                if self.fails.len() < MAX_KEYS {
                    self.fails.insert(key.to_string(), (1, at_ms));
                }
            }
        }
    }

    /// Restituisce un fallimento contato in anticipo: il login conta il
    /// tentativo prima di verificare la password, fuori dal lock, e una
    /// password giusta non è un fallimento.
    pub fn forgive(&mut self, key: &str) {
        if let Some((n, _)) = self.fails.get_mut(key) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                self.fails.remove(key);
            }
        }
    }

    /// Pulisce dopo un login riuscito.
    pub fn note_success(&mut self, key: &str) {
        self.fails.remove(key);
    }

    /// Quante chiavi tiene: la memoria che il limite occupa.
    pub fn tracked(&self) -> usize {
        self.fails.len()
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

/// Fallimenti di un nome, da tutte le origini insieme, che bloccano il nome
/// per le origini dove l'account non è mai entrato. Con 5 per coppia servono
/// almeno 10 origini diverse per arrivarci.
pub const NAME_MAX_FAILS: u32 = 50;
/// Fallimenti di un'origine, su qualunque nome, che bloccano l'origine.
pub const ORIGIN_MAX_FAILS: u32 = 20;
/// Per quanto un'origine dove l'account è entrato resta «conosciuta».
pub const KNOWN_ORIGIN_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// Il limite dei login con password (B21 dell'audit del 2026-10-30).
///
/// Chiavato sul solo nome, chiunque bloccava un account altrui con cinque
/// password sbagliate. Ora i limiti sono tre, e ogni tentativo conta in
/// tutti:
///
/// - (nome, origine): 5 fallimenti in 5 minuti bloccano quel nome da
///   quell'origine, non altrove;
/// - origine: [`ORIGIN_MAX_FAILS`] fallimenti su nomi qualunque bloccano
///   l'origine, così un'origine sola non prova molti nomi;
/// - nome: [`NAME_MAX_FAILS`] fallimenti da tutte le origini insieme bloccano
///   il nome, così molte origini insieme non provano molte password su un
///   account. Un'origine dove l'account è entrato negli ultimi
///   [`KNOWN_ORIGIN_MS`] non subisce questo blocco: chi lo provoca da altrove
///   non chiude fuori il titolare dal suo solito posto.
///
/// L'origine è quella del limite per origine di [`crate::abuse`]: il peer TCP,
/// o il client dichiarato da un proxy fidato.
#[derive(Clone, Debug)]
pub struct LoginLimits {
    pairs: LoginRateLimit,
    names: LoginRateLimit,
    origins: LoginRateLimit,
    /// Coppia → ultimo login riuscito.
    known: BTreeMap<String, u64>,
}

impl Default for LoginLimits {
    fn default() -> Self {
        Self {
            pairs: LoginRateLimit::with_max_fails(MAX_FAILS),
            names: LoginRateLimit::with_max_fails(NAME_MAX_FAILS),
            origins: LoginRateLimit::with_max_fails(ORIGIN_MAX_FAILS),
            known: BTreeMap::new(),
        }
    }
}

/// La chiave di una coppia: la lunghezza dell'origine la separa dal nome,
/// che può contenere qualunque carattere.
fn pair_key(name: &str, origin: &str) -> String {
    format!("{}:{origin}{name}", origin.len())
}

impl LoginLimits {
    pub fn new() -> Self {
        Self::default()
    }

    /// `true` se il login di `name` da `origin` è bloccato adesso.
    pub fn blocked(&self, name: &str, origin: &str, at_ms: u64) -> bool {
        let pair = pair_key(name, origin);
        let known = self
            .known
            .get(&pair)
            .is_some_and(|last| at_ms.saturating_sub(*last) < KNOWN_ORIGIN_MS);
        self.pairs.blocked(&pair, at_ms)
            || self.origins.blocked(origin, at_ms)
            || (!known && self.names.blocked(name, at_ms))
    }

    /// Conta un tentativo come fallito, in tutti e tre i limiti.
    pub fn note_fail(&mut self, name: &str, origin: &str, at_ms: u64) {
        self.pairs.note_fail(&pair_key(name, origin), at_ms);
        self.names.note_fail(name, at_ms);
        self.origins.note_fail(origin, at_ms);
    }

    /// Restituisce un tentativo contato in anticipo che non è fallito.
    pub fn forgive(&mut self, name: &str, origin: &str) {
        self.pairs.forgive(&pair_key(name, origin));
        self.names.forgive(name);
        self.origins.forgive(origin);
    }

    /// Dopo un login riuscito: la coppia riparte da zero e l'origine diventa
    /// conosciuta per l'account. I fallimenti del nome e dell'origine
    /// restano: li ha fatti qualcun altro, o un altro nome.
    pub fn note_success(&mut self, name: &str, origin: &str, at_ms: u64) {
        let pair = pair_key(name, origin);
        self.pairs.note_success(&pair);
        if !self.known.contains_key(&pair) && self.known.len() >= MAX_KEYS {
            self.known
                .retain(|_, last| at_ms.saturating_sub(*last) < KNOWN_ORIGIN_MS);
        }
        if self.known.contains_key(&pair) || self.known.len() < MAX_KEYS {
            self.known.insert(pair, at_ms);
        }
    }

    /// Quante chiavi di fallimento tiene: la memoria che il limite occupa.
    pub fn tracked(&self) -> usize {
        self.pairs.tracked() + self.names.tracked() + self.origins.tracked()
    }
}

/// Firma `verify_totp` attesa dai discendenti (stateless: rate limit a parte).
pub fn verify_totp(record: &mut TotpRecord, code: &str, at_ms: u64) -> Result<bool, String> {
    verify(record, code, at_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_windows_are_pruned_as_new_names_arrive() {
        let mut limit = LoginRateLimit::new();
        for n in 0..PRUNE_FLOOR {
            limit.note_fail(&format!("nome-{n}"), 0);
        }
        assert_eq!(limit.tracked(), PRUNE_FLOOR);
        // Le finestre di prima sono scadute: i nomi nuovi prendono il loro
        // posto invece di aggiungersi.
        for n in 0..PRUNE_FLOOR * 4 {
            limit.note_fail(&format!("altro-{n}"), WINDOW_MS);
        }
        assert_eq!(limit.tracked(), PRUNE_FLOOR * 4);
        assert!(!limit.blocked("altro-0", WINDOW_MS));
    }

    #[test]
    fn live_windows_survive_the_pruning() {
        let mut limit = LoginRateLimit::new();
        for _ in 0..MAX_FAILS {
            limit.note_fail("bersaglio", 0);
        }
        for n in 0..PRUNE_FLOOR * 2 {
            limit.note_fail(&format!("nome-{n}"), 1);
        }
        assert!(limit.blocked("bersaglio", 2), "la potatura non sblocca");
    }

    #[test]
    fn a_forgiven_attempt_does_not_count() {
        let mut limit = LoginRateLimit::new();
        for _ in 0..MAX_FAILS {
            limit.note_fail("nome", 0);
            limit.forgive("nome");
        }
        assert!(!limit.blocked("nome", 0));
        assert_eq!(limit.tracked(), 0);
        for _ in 0..MAX_FAILS {
            limit.note_fail("nome", 0);
        }
        assert!(limit.blocked("nome", 0));
    }

    #[test]
    fn a_pair_blocks_only_its_own_origin() {
        let mut limits = LoginLimits::new();
        for _ in 0..MAX_FAILS {
            limits.note_fail("titolare", "10.0.0.66", 0);
        }
        assert!(limits.blocked("titolare", "10.0.0.66", 1));
        assert!(!limits.blocked("titolare", "10.0.0.1", 1));
        assert!(!limits.blocked("altro", "10.0.0.66", 1));
        // La finestra scade.
        assert!(!limits.blocked("titolare", "10.0.0.66", WINDOW_MS));
    }

    #[test]
    fn many_origins_block_the_name_except_where_the_account_logged_in() {
        let mut limits = LoginLimits::new();
        limits.note_success("titolare", "casa", 0);
        let at = KNOWN_ORIGIN_MS - 10;
        let origins = NAME_MAX_FAILS.div_ceil(MAX_FAILS);
        for n in 0..origins {
            for _ in 0..MAX_FAILS {
                limits.note_fail("titolare", &format!("10.0.1.{n}"), at);
            }
        }
        // Nessuna origine da sola ha superato il suo tetto, ma il nome sì.
        assert!(limits.blocked("titolare", "nuova", at + 1));
        assert!(!limits.blocked("titolare", "casa", at + 1));
        assert!(!limits.blocked("altro", "nuova", at + 1));
        // Un'origine conosciuta da troppo tempo non lo è più.
        assert!(limits.blocked("titolare", "casa", KNOWN_ORIGIN_MS + 1));
    }

    #[test]
    fn one_origin_trying_many_names_is_blocked_on_all() {
        let mut limits = LoginLimits::new();
        limits.note_success("titolare", "ufficio", 0);
        for n in 0..ORIGIN_MAX_FAILS {
            limits.note_fail(&format!("nome-{n}"), "ufficio", 1);
        }
        assert!(limits.blocked("titolare", "ufficio", 2));
        assert!(!limits.blocked("titolare", "casa", 2));
    }

    #[test]
    fn pair_keys_do_not_collide() {
        assert_ne!(pair_key("b:c", "a"), pair_key("c", "a:b"));
    }
}
