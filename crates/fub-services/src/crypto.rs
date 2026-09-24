//! # Crittografia con librerie consolidate (P16.4)
//!
//! - KDF: PBKDF2-HMAC-SHA256, parametri **versionati** (`ver=1`, 210_000
//!   iterazioni, sale unico 16 B per credenziale). [`derive_kek`].
//! - AEAD: AES-256-GCM, nonce casuale 96 bit **per cifratura e per chiave**,
//!   AAD canonica che lega protocollo, vault, epoch, op, replica, doc, kind,
//!   vettore e rename routing.
//! - Confronti di segreti in tempo costante (`subtle::ConstantTimeEq`).
//! - La password account NON deriva mai la chiave dati: la chiave vault (VDK,
//!   32 B casuali) è avvolta esplicitamente da una KEK fornita dall'utente
//!   ([`wrap_vdk`]/[`unwrap_vdk`]); recupero/rotazione/revoca espliciti.
//! - Hash legacy esistenti non usati come primitive: vietato dal contratto.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ring::{aead, pbkdf2};
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;
use subtle::ConstantTimeEq;

/// Versione corrente dei parametri KDF (persistita: rotazioni future = ver+1).
pub const KDF_VERSION: u32 = 1;
/// Iterazioni PBKDF2-HMAC-SHA256 per `ver=1`.
pub const KDF_ITERATIONS_V1: u32 = 210_000;
/// Lunghezza sale (16 B unici per credenziale).
pub const SALT_LEN: usize = 16;
/// Chiave dati vault (VDK): 32 B casuali, mai derivati dalla password.
pub const VDK_LEN: usize = 32;

/// Sale + parametri versionati persistiti accanto all'hash/wrap.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KdfParams {
    pub ver: u32,
    pub iterations: u32,
    pub salt_b64: String,
}

impl KdfParams {
    /// Nuovi parametri `ver=1` con sale unico da CSPRNG (`ring::rand`).
    pub fn fresh() -> Result<Self, String> {
        use ring::rand::{SecureRandom, SystemRandom};
        let rng = SystemRandom::new();
        let mut salt = [0u8; SALT_LEN];
        rng.fill(&mut salt)
            .map_err(|_| "rng unavailable".to_string())?;
        Ok(Self {
            ver: KDF_VERSION,
            iterations: KDF_ITERATIONS_V1,
            salt_b64: B64.encode(salt),
        })
    }

    fn salt(&self) -> Result<Vec<u8>, String> {
        B64.decode(&self.salt_b64)
            .map_err(|_| "bad salt encoding".to_string())
    }
}

/// Deriva 32 B di chiave da passphrase + parametri (PBKDF2-HMAC-SHA256).
pub fn derive_kek(passphrase: &str, params: &KdfParams) -> Result<[u8; 32], String> {
    let salt = params.salt()?;
    let iters = NonZeroU32::new(params.iterations)
        .ok_or_else(|| "kdf iterations must be nonzero".to_string())?;
    let mut out = [0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        iters,
        &salt,
        passphrase.as_bytes(),
        &mut out,
    );
    Ok(out)
}

/// Verifica in tempo costante che la passphrase ri-derivi `expected`.
pub fn verify_kek(
    passphrase: &str,
    params: &KdfParams,
    expected: &[u8; 32],
) -> Result<bool, String> {
    let got = derive_kek(passphrase, params)?;
    Ok(bool::from(got.as_slice().ct_eq(expected.as_slice())))
}

/// Nonce casuale 96 bit per cifratura (mai riuso con la stessa chiave).
fn fresh_nonce() -> Result<[u8; 12], String> {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut n = [0u8; 12];
    rng.fill(&mut n)
        .map_err(|_| "rng unavailable".to_string())?;
    Ok(n)
}

/// Cifra `plaintext` con `key32` + `aad`: torna `(nonce_b64, ciphertext_b64)`.
///
/// AAD lega metadati e versione protocollo: manomissione = `decrypt` fallisce.
pub fn seal(
    key32: &[u8; 32],
    aad_text: &str,
    plaintext: &[u8],
) -> Result<(String, String), String> {
    // `LessSafeKey` + `Nonce::assume_unique_for_key`: il nonce è casuale 96 bit
    // generato qui per ogni cifratura, quindi unico per chiave per costruzione
    // (la semantica che `SealingKey`+sequenza avrebbe imposto a mano).
    let nonce_bytes = fresh_nonce()?;
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key32).map_err(|_| "bad aead key".to_string())?,
    );
    let mut buf = plaintext.to_vec();
    let aad = aead::Aad::from(aad_text.as_bytes());
    key.seal_in_place_append_tag(nonce, aad, &mut buf)
        .map_err(|_| "seal failed".to_string())?;
    Ok((B64.encode(nonce_bytes), B64.encode(&buf)))
}

/// Decifra verificando AAD; fallisce su manomissione/nonce/chiave errati.
pub fn open(
    key32: &[u8; 32],
    aad_text: &str,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<Vec<u8>, String> {
    let nonce_bytes: [u8; 12] = B64
        .decode(nonce_b64)
        .map_err(|_| "bad nonce encoding".to_string())?
        .try_into()
        .map_err(|_| "bad nonce length".to_string())?;
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
    let mut buf = B64
        .decode(ciphertext_b64)
        .map_err(|_| "bad ciphertext encoding".to_string())?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key32).map_err(|_| "bad aead key".to_string())?,
    );
    let aad = aead::Aad::from(aad_text.as_bytes());
    let plain = key
        .open_in_place(nonce, aad, &mut buf)
        .map_err(|_| "open failed: tampered or wrong key".to_string())?;
    Ok(plain.to_vec())
}
/// Busta AAD canonica tipizzata (P16, Main): autentica TUTTI i campi decisivi.
///
/// `canonical_aad_json` + `aad_verify` are the only supported operation
/// format. The older pipe-delimited AAD omitted vault, epoch, op id, kind and
/// rename routing; malformed or old wire envelopes are rejected, never
/// silently downgraded.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SyncEnvelope {
    pub protocol: String,
    pub vault_id: String,
    pub key_epoch: u32,
    pub op_id: String,
    pub replica_id: String,
    pub doc_id: String,
    pub kind: String,
    /// Valori come stringhe decimali sul wire (`wire::vv_string`): oltre 2^53
    /// un `number` JS perderebbe bit; in lettura si accetta anche il numero.
    #[serde(with = "crate::wire::vv_string")]
    pub vv: std::collections::BTreeMap<String, u64>,
    /// Millisecondi UNIX: restano number anche qui (stessa regola `ts_ms`:
    /// aritmetica, mai oltre 2^53; l'AAD li lega comunque byte-identici).
    pub ts_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_to: Option<String>,
}

/// Forma canonica del vettore di versione (`replica:counter,...`, chiavi
/// ordinate: `BTreeMap` itera già in ordine).
pub fn vv_canonical(vv: &std::collections::BTreeMap<String, u64>) -> String {
    vv.iter()
        .map(|(replica, counter)| format!("{replica}:{counter}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// AAD canonica come JSON a chiavi ordinate (`serde_json::Map` è una
/// `BTreeMap`: l'ordine è canonico per costruzione, non per disciplina del
/// chiamante). Lega protocollo, vault, key epoch, op-id, replica, doc, kind,
/// vv canonico, timestamp e rename-routing (presente sse kind == rename).
pub fn canonical_aad_json(envelope: &SyncEnvelope) -> String {
    let mut map = serde_json::Map::new();
    map.insert(
        "doc_id".to_string(),
        serde_json::Value::String(envelope.doc_id.clone()),
    );
    map.insert(
        "key_epoch".to_string(),
        serde_json::Value::from(envelope.key_epoch),
    );
    map.insert(
        "kind".to_string(),
        serde_json::Value::String(envelope.kind.clone()),
    );
    map.insert(
        "op_id".to_string(),
        serde_json::Value::String(envelope.op_id.clone()),
    );
    map.insert(
        "protocol".to_string(),
        serde_json::Value::String(envelope.protocol.clone()),
    );
    if let Some(from) = &envelope.rename_from {
        map.insert(
            "rename_from".to_string(),
            serde_json::Value::String(from.clone()),
        );
    }
    if let Some(to) = &envelope.rename_to {
        map.insert(
            "rename_to".to_string(),
            serde_json::Value::String(to.clone()),
        );
    }
    map.insert(
        "replica_id".to_string(),
        serde_json::Value::String(envelope.replica_id.clone()),
    );
    map.insert("ts_ms".to_string(), serde_json::Value::from(envelope.ts_ms));
    map.insert(
        "vault_id".to_string(),
        serde_json::Value::String(envelope.vault_id.clone()),
    );
    // Valori vv come stringhe decimali (stessa regola del wire): l'AAD resta
    // byte-identica fra backend e host a parità di campi — è la conformità.
    let vv = envelope
        .vv
        .iter()
        .map(|(replica, counter)| {
            (
                replica.clone(),
                serde_json::Value::String(counter.to_string()),
            )
        })
        .collect::<serde_json::Map<String, serde_json::Value>>();
    map.insert("vv".to_string(), serde_json::Value::Object(vv));
    serde_json::Value::Object(map).to_string()
}

/// Valida la busta (rifiuto duro su protocollo/campi/rename incoerenti) e
/// decifra verificando l'AAD RICALCOLATA dai campi — mai la `aad` ricevuta
/// sul wire. Fallisce su manomissione, chiave/epoch errati o busta malformata.
pub fn aad_verify(
    key32: &[u8; 32],
    envelope: &SyncEnvelope,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<Vec<u8>, String> {
    if envelope.protocol != crate::routing::SYNC_PROTOCOL {
        return Err("protocol mismatch".to_string());
    }
    for field in [
        &envelope.vault_id,
        &envelope.op_id,
        &envelope.replica_id,
        &envelope.doc_id,
        &envelope.kind,
    ] {
        if field.trim().is_empty() {
            return Err("bad envelope identity".to_string());
        }
    }
    if envelope.vv.is_empty() {
        return Err("empty version vector".to_string());
    }
    let is_rename = envelope.kind == "rename";
    if is_rename != (envelope.rename_from.is_some() && envelope.rename_to.is_some()) {
        return Err("rename routing mismatch".to_string());
    }
    let aad = canonical_aad_json(envelope);
    open(key32, &aad, nonce_b64, ciphertext_b64)
}
/// Avvolge la VDK (32 B casuali) con una KEK fornita dall'utente.
///
/// La KEK arriva da una passphrase vault **distinta** dalla password account
/// (mai riuso automatico): chi chiama deriva con [`derive_kek`] da parametri
/// separati. Torna JSON persistibile `{kdf, nonce_b64, wrap_b64}`.
pub fn wrap_vdk(vdk: &[u8; VDK_LEN], kek: &[u8; 32]) -> Result<WrappedVdk, String> {
    let params = KdfParams::fresh()?;
    let mut key = [0u8; 32];
    key.copy_from_slice(kek);
    let aad = format!("fub-vdk-wrap|v{}", KDF_VERSION);
    let (nonce_b64, wrap_b64) = seal(&key, &aad, vdk)?;
    Ok(WrappedVdk {
        kdf: params,
        nonce_b64,
        wrap_b64,
    })
}

/// Scarta la VDK avvolta (rotazione/revoca del wrap; le copie già scaricate
/// da altri restano — documentato, P16.8).
pub fn unwrap_vdk(wrapped: &WrappedVdk, kek: &[u8; 32]) -> Result<[u8; VDK_LEN], String> {
    let mut key = [0u8; 32];
    key.copy_from_slice(kek);
    let aad = format!("fub-vdk-wrap|v{}", wrapped.kdf.ver.min(KDF_VERSION));
    let plain = open(&key, &aad, &wrapped.nonce_b64, &wrapped.wrap_b64)?;
    plain.try_into().map_err(|_| "bad vdk length".to_string())
}

/// VDK avvolta e persistibile (il server conserva l'opaco, mai il chiaro).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WrappedVdk {
    pub kdf: KdfParams,
    pub nonce_b64: String,
    pub wrap_b64: String,
}

/// Structural check of a wrapped-VDK envelope (base64 shapes + 12 B nonce).
/// The server is opaque to keys: it validates shape, never cleartext.
pub fn unwrap_vdk_shape_ok(wrapped: &WrappedVdk) -> Result<(), String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    if wrapped.kdf.ver == 0 || wrapped.kdf.ver > KDF_VERSION {
        return Err("bad wrap version".to_string());
    }
    let nonce = B64
        .decode(&wrapped.nonce_b64)
        .map_err(|_| "bad wrap nonce".to_string())?;
    if nonce.len() != 12 {
        return Err("bad wrap nonce length".to_string());
    }
    let wrap = B64
        .decode(&wrapped.wrap_b64)
        .map_err(|_| "bad wrap body".to_string())?;
    if wrap.len() < 16 + VDK_LEN {
        return Err("bad wrap length".to_string());
    }
    Ok(())
}
