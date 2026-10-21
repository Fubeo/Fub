//! # Controllo degli abusi davanti alle KDF (STR-04)
//!
//! Registrazione, login e gate password dei siti sono raggiungibili senza
//! autenticazione e costano una PBKDF2 da 210 000 round. Senza un limite che
//! chi chiama non sceglie, otto richieste concorrenti con nomi casuali
//! tenevano occupati tutti i worker. Qui vivono i tre presìdi, tutti fuori dal
//! lock dello stato:
//!
//! - [`RateBuckets`]: token bucket per **origine** (l'IP del peer, o il client
//!   dichiarato da un proxy fidato) e uno **globale**, consultati prima di
//!   qualunque KDF. La mappa delle origini ha un tetto: oltre, le origini nuove
//!   condividono un solo secchio.
//! - [`KdfGate`]: semaforo non bloccante sul numero di KDF concorrenti; chi
//!   non trova posto riceve `503` subito, e i worker restano liberi per le
//!   richieste autenticate.
//! - [`client_origin`]: la politica sui proxy. `X-Forwarded-For` vale soltanto
//!   quando il peer è un proxy elencato in `trusted_proxies`; altrimenti
//!   l'header del client non conta.

use std::collections::BTreeMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};

use parking_lot::Mutex;

/// KDF concorrenti al massimo: meno dei worker, perché sync e publish
/// autenticati trovino sempre un worker libero.
pub const MAX_CONCURRENT_KDF: usize = 2;
/// Secchio di un'origine: raffica e ricarica al secondo.
pub const ORIGIN_BURST: f64 = 30.0;
pub const ORIGIN_REFILL_PER_S: f64 = 1.0;
/// Secchio globale (tutte le origini insieme).
pub const GLOBAL_BURST: f64 = 120.0;
pub const GLOBAL_REFILL_PER_S: f64 = 10.0;
/// Origini ricordate al massimo; oltre, le nuove condividono [`OVERFLOW`].
pub const MAX_ORIGINS: usize = 4096;
/// Il secchio delle origini che non trovano posto nella mappa.
pub const OVERFLOW: &str = "overflow";

/// Semaforo non bloccante sulle KDF concorrenti.
#[derive(Debug)]
pub struct KdfGate {
    busy: AtomicUsize,
    max: usize,
}

/// Un posto nel [`KdfGate`], restituito quando cade.
#[derive(Debug)]
pub struct KdfPermit<'a>(&'a KdfGate);

impl Drop for KdfPermit<'_> {
    fn drop(&mut self) {
        self.0.busy.fetch_sub(1, Ordering::AcqRel);
    }
}

impl KdfGate {
    pub const fn new(max: usize) -> Self {
        Self {
            busy: AtomicUsize::new(0),
            max,
        }
    }

    /// Un posto, se c'è; `None` senza attendere.
    pub fn try_enter(&self) -> Option<KdfPermit<'_>> {
        let mut busy = self.busy.load(Ordering::Acquire);
        loop {
            if busy >= self.max {
                return None;
            }
            match self.busy.compare_exchange_weak(
                busy,
                busy + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Some(KdfPermit(self)),
                Err(now) => busy = now,
            }
        }
    }

    /// KDF in corso adesso.
    pub fn busy(&self) -> usize {
        self.busy.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy, Debug)]
struct Bucket {
    tokens: f64,
    at_ms: u64,
}

impl Bucket {
    fn full(burst: f64, at_ms: u64) -> Self {
        Self {
            tokens: burst,
            at_ms,
        }
    }

    fn refill(&mut self, burst: f64, per_s: f64, at_ms: u64) {
        let elapsed = at_ms.saturating_sub(self.at_ms) as f64 / 1000.0;
        self.tokens = (self.tokens + elapsed * per_s).min(burst);
        self.at_ms = at_ms;
    }
}

/// Token bucket per origine e globale. Un tentativo consuma un gettone da
/// tutti e due, o da nessuno.
#[derive(Debug, Default)]
pub struct RateBuckets {
    origins: BTreeMap<String, Bucket>,
    global: Option<Bucket>,
}

impl RateBuckets {
    pub fn new() -> Self {
        Self::default()
    }

    /// `true` se l'origine (e il servizio intero) hanno ancora un gettone; in
    /// quel caso lo consuma.
    pub fn admit(&mut self, origin: &str, at_ms: u64) -> bool {
        let global = self
            .global
            .get_or_insert_with(|| Bucket::full(GLOBAL_BURST, at_ms));
        global.refill(GLOBAL_BURST, GLOBAL_REFILL_PER_S, at_ms);
        if global.tokens < 1.0 {
            return false;
        }
        let key = if self.origins.contains_key(origin) {
            origin
        } else {
            if self.origins.len() >= MAX_ORIGINS {
                // Un secchio pieno non ricorda niente: si può dimenticare.
                self.origins.retain(|_, bucket| {
                    bucket.refill(ORIGIN_BURST, ORIGIN_REFILL_PER_S, at_ms);
                    bucket.tokens < ORIGIN_BURST
                });
            }
            if self.origins.len() >= MAX_ORIGINS {
                OVERFLOW
            } else {
                origin
            }
        };
        let bucket = self
            .origins
            .entry(key.to_string())
            .or_insert_with(|| Bucket::full(ORIGIN_BURST, at_ms));
        bucket.refill(ORIGIN_BURST, ORIGIN_REFILL_PER_S, at_ms);
        if bucket.tokens < 1.0 {
            return false;
        }
        bucket.tokens -= 1.0;
        if let Some(global) = self.global.as_mut() {
            global.tokens -= 1.0;
        }
        true
    }

    /// Origini ricordate adesso (per le prove sulla memoria).
    pub fn len(&self) -> usize {
        self.origins.len()
    }

    pub fn is_empty(&self) -> bool {
        self.origins.is_empty()
    }
}

/// I presìdi di un processo: vivono accanto allo stato, non dentro il suo lock.
#[derive(Debug)]
pub struct Abuse {
    pub kdf: KdfGate,
    pub buckets: Mutex<RateBuckets>,
}

impl Default for Abuse {
    fn default() -> Self {
        Self {
            kdf: KdfGate::new(MAX_CONCURRENT_KDF),
            buckets: Mutex::new(RateBuckets::new()),
        }
    }
}

/// Perché una richiesta che costerebbe una KDF non parte.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// L'origine o il servizio hanno finito i gettoni: `429`.
    RateLimited,
    /// Tutte le KDF concorrenti sono occupate: `503`.
    Busy,
}

impl Refusal {
    pub fn status(self) -> u16 {
        match self {
            Refusal::RateLimited => 429,
            Refusal::Busy => 503,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Refusal::RateLimited => "rate limited",
            Refusal::Busy => "busy, retry later",
        }
    }
}

impl Abuse {
    /// Ammette una richiesta da `origin` che sta per calcolare una KDF: prima
    /// i gettoni, poi un posto nel semaforo.
    pub fn enter(&self, origin: &str, at_ms: u64) -> Result<KdfPermit<'_>, Refusal> {
        if !self.buckets.lock().admit(origin, at_ms) {
            return Err(Refusal::RateLimited);
        }
        self.kdf.try_enter().ok_or(Refusal::Busy)
    }
}

/// L'origine di una richiesta: il peer, oppure — soltanto se il peer è un
/// proxy fidato — l'ultimo indirizzo di `X-Forwarded-For` che non è a sua
/// volta un proxy fidato. Un header che non si legge come IP non sposta
/// niente: resta il peer.
pub fn client_origin(
    peer: Option<IpAddr>,
    forwarded_for: Option<&str>,
    trusted_proxies: &[String],
) -> String {
    let trusted = |ip: &IpAddr| {
        trusted_proxies
            .iter()
            .any(|t| t.parse::<IpAddr>().ok() == Some(*ip))
    };
    let Some(peer) = peer else {
        return "unknown".to_string();
    };
    if !trusted(&peer) {
        return peer.to_string();
    }
    let Some(chain) = forwarded_for else {
        return peer.to_string();
    };
    for hop in chain.rsplit(',') {
        match hop.trim().parse::<IpAddr>() {
            Ok(ip) if trusted(&ip) => continue,
            Ok(ip) => return ip.to_string(),
            Err(_) => return peer.to_string(),
        }
    }
    peer.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_kdf_gate_never_admits_more_than_its_size() {
        let gate = KdfGate::new(2);
        let a = gate.try_enter().unwrap();
        let _b = gate.try_enter().unwrap();
        assert!(gate.try_enter().is_none());
        drop(a);
        assert!(gate.try_enter().is_some());
    }

    #[test]
    fn random_origins_keep_the_map_bounded_and_the_global_bucket_holds() {
        let mut buckets = RateBuckets::new();
        let mut admitted = 0;
        for i in 0..(MAX_ORIGINS * 3) {
            if buckets.admit(&format!("10.0.{}.{}", i / 256, i % 256), 0) {
                admitted += 1;
            }
        }
        assert!(buckets.len() <= MAX_ORIGINS + 1);
        assert_eq!(
            admitted, GLOBAL_BURST as usize,
            "the global burst caps everyone"
        );
        // Il tempo ricarica: dopo un secondo passano di nuovo dieci tentativi.
        let later = (0..100)
            .filter(|i| buckets.admit(&format!("10.9.0.{i}"), 1000))
            .count();
        assert_eq!(later, GLOBAL_REFILL_PER_S as usize);
    }

    #[test]
    fn one_origin_runs_out_before_the_others() {
        let mut buckets = RateBuckets::new();
        let own = (0..100).filter(|_| buckets.admit("1.2.3.4", 0)).count();
        assert_eq!(own, ORIGIN_BURST as usize);
        assert!(buckets.admit("5.6.7.8", 0));
    }

    #[test]
    fn forwarded_for_counts_only_behind_a_trusted_proxy() {
        let proxy: IpAddr = "127.0.0.1".parse().unwrap();
        let none: Vec<String> = Vec::new();
        let trusted = vec!["127.0.0.1".to_string()];
        assert_eq!(
            client_origin(Some(proxy), Some("9.9.9.9"), &none),
            "127.0.0.1"
        );
        assert_eq!(
            client_origin(Some(proxy), Some("9.9.9.9"), &trusted),
            "9.9.9.9"
        );
        assert_eq!(
            client_origin(Some(proxy), Some("6.6.6.6, 9.9.9.9, 127.0.0.1"), &trusted),
            "9.9.9.9",
            "the client cannot choose its origin by prepending hops"
        );
        assert_eq!(
            client_origin(Some(proxy), Some("garbage"), &trusted),
            "127.0.0.1"
        );
    }
}
