//! # Client remoto sync: base comune HTTP + replica + E2EE (P16, F36)
//!
//! Modulo parent (ServicesOwner): base URL, token, replica-id, redazione,
//! AAD canonica mirror di `fub-services`, assert `GET /v1/hello`. Il
//! discendente SyncSlice possiede `sync.rs` (coordinatore + `SyncClient`) e
//! lo costruisce su questi helper. Solo `ureq` (sincrono, già in host);
//! nessuna dipendenza da `fub-services` né da `fub-features` (Main).
//!
//! Conformità reale col backend (non solo nomi nei commenti): la busta
//! canonica è costruita qui campo-per-campo come in
//! `fub_services::crypto::{SyncEnvelope, canonical_aad_json, aad_verify}` —
//! stesse chiavi JSON ordinate, stessa stringa AAD, stesso protocollo. Il
//! wire non è rilasciato: qualunque divergenza è rifiuto duro, mai fallback.
//!
//! Integrazione per Main (al freeze, file condivisi intoccati qui):
//! ```rust,ignore
//! #[cfg(feature = "http-client")]
//! pub mod remote;
//! ```
//! in `crates/fub-host/src/lib.rs`, più `ring 0.17`, `base64 0.22`,
//! `uuid 1.24/v4` in `[dependencies]` di `fub-host` (già in Cargo.lock).

/// Sotto-moduli del discendente SyncSlice (coordinatore + meccanica replica
/// + provider views/commands/bundle che Main registra come oggetti).
pub mod bundle;
pub mod commands;
pub mod sync;
pub mod views;
/// Il manifest di un bundle di core che parla con i servizi Fub: i permessi
/// di [`PluginPermissions::core`](fub_abi::PluginPermissions::core) più
/// `fub:network`, che `core()` non dà a nessuno e che sync e pubblicazione
/// senza di lui si vedevano negare dalla Guard a ogni richiesta.
///
/// Senza elenco di host, cioè *qualunque host*: l'endpoint non è scritto nel
/// bundle ma lo sceglie chi usa la macchina (`FUB_SERVICES_URL`, o le
/// impostazioni della macchina `sync.server_url` e `publish.server_url`, che un
/// vault non può scrivere), e può cambiare mentre il vault è aperto, mentre il
/// manifest si legge al montaggio. Il recinto sta nel codice, che si connette
/// soltanto all'endpoint validato da [`validate_base_url`], e nella Guard, che
/// ripete la regola sullo schema (HTTPS, o HTTP verso il loopback esplicito).
/// Chi non vuole che parlino con la rete spegne l'interruttore del permesso
/// ([`permission_key`](fub_abi::settings::permission_key)), come per ogni
/// altro plugin.
pub(crate) fn networked_manifest(id: &str, name: &str) -> fub_abi::PluginManifest {
    let mut manifest = fub_abi::PluginManifest::core(id, name);
    manifest
        .permissions
        .granted
        .set(fub_abi::options::permission::NETWORK, true);
    manifest
}

/// Versione wire attesa dal server (`GET /v1/hello`).
pub const SYNC_PROTOCOL: &str = "fub-sync/1";

/// KDF vault lato host (mirror di `fub_services::crypto`, senza dipendenza
/// dal server): PBKDF2-HMAC-SHA256 ver=1, 210_000 iterazioni, sale unico
/// 16 B. La KEK deriva dalla passphrase vault ESPLICITA (file/stdin, mai
/// password account, mai riuso automatico); la VDK resta 32 B casuali
/// avvolti (`wrap_vault_key`) con AAD `fub-vdk-wrap|v1`.
pub const VAULT_KDF_VERSION: u32 = 1;
pub const VAULT_KDF_ITERATIONS_V1: u32 = 210_000;
pub const VAULT_SALT_LEN: usize = 16;
pub const VAULT_VDK_LEN: usize = 32;

/// Parametri KDF versionati persistiti accanto al wrap (nomi wire = backend
/// `KdfParams`: `ver`, `iterations`, `salt_b64`).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct VaultKdfParams {
    pub ver: u32,
    pub iterations: u32,
    pub salt_b64: String,
}

/// VDK avvolta persistibile (nomi wire = backend `WrappedVdk`).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WrappedVaultKey {
    pub kdf: VaultKdfParams,
    pub nonce_b64: String,
    pub wrap_b64: String,
}

fn vault_b64_salt(salt_b64: &str) -> Result<Vec<u8>, String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    B64.decode(salt_b64)
        .map_err(|_| "bad salt encoding".to_string())
}

/// Nuovi parametri `ver=1` con sale unico da CSPRNG (`ring::rand`).
pub fn vault_kdf_fresh() -> Result<VaultKdfParams, String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut salt = [0u8; VAULT_SALT_LEN];
    rng.fill(&mut salt)
        .map_err(|_| "rng unavailable".to_string())?;
    Ok(VaultKdfParams {
        ver: VAULT_KDF_VERSION,
        iterations: VAULT_KDF_ITERATIONS_V1,
        salt_b64: B64.encode(salt),
    })
}

/// Deriva 32 B di KEK da passphrase + parametri (PBKDF2-HMAC-SHA256).
pub fn derive_vault_kek(passphrase: &str, params: &VaultKdfParams) -> Result<[u8; 32], String> {
    use std::num::NonZeroU32;
    let salt = vault_b64_salt(&params.salt_b64)?;
    let iters = NonZeroU32::new(params.iterations)
        .ok_or_else(|| "kdf iterations must be nonzero".to_string())?;
    let mut out = [0u8; 32];
    ring::pbkdf2::derive(
        ring::pbkdf2::PBKDF2_HMAC_SHA256,
        iters,
        &salt,
        passphrase.as_bytes(),
        &mut out,
    );
    Ok(out)
}

/// Scarta la VDK (verifica AAD + forma; copie già scaricate restano).
pub fn unwrap_vault_key(
    wrapped: &WrappedVaultKey,
    kek: &[u8; 32],
) -> Result<[u8; VAULT_VDK_LEN], String> {
    let mut key = [0u8; 32];
    key.copy_from_slice(kek);
    let aad = format!("fub-vdk-wrap|v{}", wrapped.kdf.ver);
    let plain = open_aead(&key, &aad, &wrapped.nonce_b64, &wrapped.wrap_b64)?;
    plain.try_into().map_err(|_| "bad vdk length".to_string())
}

/// Nonce casuale 96 bit per cifratura (mai riuso con la stessa chiave).
fn vault_fresh_nonce() -> Result<[u8; 12], String> {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut n = [0u8; 12];
    rng.fill(&mut n)
        .map_err(|_| "rng unavailable".to_string())?;
    Ok(n)
}

fn seal_aead(
    key32: &[u8; 32],
    aad_text: &str,
    plaintext: &[u8],
) -> Result<(String, String), String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let nonce_bytes = vault_fresh_nonce()?;
    let nonce = ring::aead::Nonce::assume_unique_for_key(nonce_bytes);
    let key = ring::aead::LessSafeKey::new(
        ring::aead::UnboundKey::new(&ring::aead::AES_256_GCM, key32)
            .map_err(|_| "bad aead key".to_string())?,
    );
    let mut buf = plaintext.to_vec();
    key.seal_in_place_append_tag(nonce, ring::aead::Aad::from(aad_text.as_bytes()), &mut buf)
        .map_err(|_| "seal failed".to_string())?;
    Ok((B64.encode(nonce_bytes), B64.encode(&buf)))
}

fn open_aead(
    key32: &[u8; 32],
    aad_text: &str,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<Vec<u8>, String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let nonce_bytes: [u8; 12] = B64
        .decode(nonce_b64)
        .map_err(|_| "bad nonce encoding".to_string())?
        .try_into()
        .map_err(|_| "bad nonce length".to_string())?;
    let nonce = ring::aead::Nonce::assume_unique_for_key(nonce_bytes);
    let mut buf = B64
        .decode(ciphertext_b64)
        .map_err(|_| "bad ciphertext encoding".to_string())?;
    let key = ring::aead::LessSafeKey::new(
        ring::aead::UnboundKey::new(&ring::aead::AES_256_GCM, key32)
            .map_err(|_| "bad aead key".to_string())?,
    );
    let plain = key
        .open_in_place(nonce, ring::aead::Aad::from(aad_text.as_bytes()), &mut buf)
        .map_err(|_| "open failed: tampered or wrong key".to_string())?;
    Ok(plain.to_vec())
}

/// Errore tipizzato dell'autorità remota (non una stringa da parsare).
///
/// `MissingConfiguration` = nessun endpoint configurato (né env esplicito
/// né setting `sync.server_url`): la CLI lo mappa a exit 2 senza parsare
/// testi, l'host a `PluginError::BadArgs`. Mai loopback implicito.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RemoteError {
    MissingConfiguration,
    BadEndpoint(String),
}

impl std::fmt::Display for RemoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RemoteError::MissingConfiguration => write!(f, "sync not configured"),
            RemoteError::BadEndpoint(detail) => write!(f, "bad endpoint: {detail}"),
        }
    }
}

impl RemoteError {
    /// Exit code F36: configurazione mancante/errata = 2 (usage).
    pub fn exit_code(&self) -> i32 {
        2
    }

    pub fn to_plugin_error(&self) -> fub_abi::PluginError {
        match self {
            RemoteError::MissingConfiguration => {
                fub_abi::PluginError::BadArgs("sync not configured".into())
            }
            RemoteError::BadEndpoint(detail) => {
                fub_abi::PluginError::BadArgs(format!("bad endpoint: {detail}").into())
            }
        }
    }
}

/// Base URL del backend (solo esplicita): env `FUB_SERVICES_URL` se non vuota,
/// altrimenti il valore del setting `sync.server_url` passato dal chiamante
/// (coordinatore/CLI, letto via `Host::query_index(Settings)`). Entrambi
/// vuoti = `MissingConfiguration` tipizzato, MAI loopback implicito (Main):
/// un default silenzioso nasconderebbe un servizio non configurato.
/// Endpoint esplicito per i chiamanti privi di accesso ai setting.
pub fn services_base() -> Result<String, RemoteError> {
    resolve_base("")
}

/// Risolutore stretto: env esplicito oppure setting `sync.server_url`
/// esplicito; entrambi vuoti = `RemoteError::MissingConfiguration`
/// (il chiamante lo mappa in `PluginError::BadArgs`, CLI exit 2).
/// Il pairing resta legato al servizio: la stessa coppia
/// (vault-pairing, replica) non si reinterpreta mai su un endpoint diverso
/// senza un re-pairing esplicito (vedi `check_endpoint_binding`).
pub fn resolve_base(setting_url: &str) -> Result<String, RemoteError> {
    if let Ok(url) = std::env::var("FUB_SERVICES_URL") {
        if !url.trim().is_empty() {
            return validate_base_url(&url).map_err(RemoteError::BadEndpoint);
        }
    }
    let trimmed = setting_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(RemoteError::MissingConfiguration);
    }
    validate_base_url(trimmed).map_err(RemoteError::BadEndpoint)
}

/// Vincola una coppia (vault-pairing, replica) all'endpoint che l'ha creata:
/// il file `<state_dir>/endpoint-binding` registra la base normalizzata al
/// primo uso; un endpoint diverso richiede re-pairing esplicito (cancella il
/// binding) invece di reinterpretare cursor/credential altrui.
pub fn check_endpoint_binding(state_dir: &std::path::Path, base: &str) -> Result<(), RemoteError> {
    let path = state_dir.join("endpoint-binding");
    let current = base.trim().trim_end_matches('/').to_string();
    // Solo NotFound = assenza (primo uso): PermissionDenied, corruzione e IO
    // sono errori tipizzati PRIMA di rete/credenziali, mai Ok fail-open.
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => {
            return Err(RemoteError::BadEndpoint(format!(
                "endpoint binding unreadable: {}",
                e.kind()
            )))
        }
    };
    let bound = raw.trim().trim_end_matches('/');
    if bound == current {
        Ok(())
    } else {
        Err(RemoteError::BadEndpoint(
            "endpoint changed: re-pair explicitly before sync".to_string(),
        ))
    }
}

/// Registra il binding endpoint dopo un hello riuscito.
pub fn store_endpoint_binding(state_dir: &std::path::Path, base: &str) -> Result<(), String> {
    let current = validate_base_url(base)?;
    check_endpoint_binding(state_dir, &current).map_err(|e| e.to_string())?;
    atomic_state_write(state_dir, "endpoint-binding", current.as_bytes()).map_err(|e| e.to_string())
}

/// Scrittura autorevole: file temporaneo univoco, fsync prima e dopo rename.
pub fn atomic_state_write(
    root: &std::path::Path,
    name: &str,
    bytes: &[u8],
) -> Result<(), fub_abi::PluginError> {
    use std::io::Write;
    let path = root.join(name);
    std::fs::create_dir_all(root)
        .map_err(|e| fub_abi::PluginError::Io(format!("sync state mkdir: {e}").into()))?;
    let tmp = root.join(format!(".{name}.{}.tmp", new_replica_id()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| fub_abi::PluginError::Io(format!("sync state create: {e}").into()))?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| fub_abi::PluginError::Io(format!("sync state flush: {e}").into()))?;
        std::fs::rename(&tmp, &path)
            .map_err(|e| fub_abi::PluginError::Io(format!("sync state commit: {e}").into()))?;
        sync_dir(root)
            .map_err(|e| fub_abi::PluginError::Io(format!("sync state dir flush: {e}").into()))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Rende durevole l'elenco di una cartella dopo una rename o una rimozione.
///
/// Su Windows una cartella non si apre come file (`File::open` risponde
/// «accesso negato»): la rename resta quella ordinaria, il limite di
/// piattaforma della decisione 0202 che vale anche per gli snapshot del kernel.
pub(crate) fn sync_dir(dir: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        std::fs::symlink_metadata(dir).map(drop)
    }
    #[cfg(not(windows))]
    {
        std::fs::File::open(dir)?.sync_all()
    }
}

pub fn new_replica_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn job_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn fresh_vdk() -> Result<[u8; VAULT_VDK_LEN], fub_abi::PluginError> {
    use ring::rand::SecureRandom;
    let mut key = [0u8; VAULT_VDK_LEN];
    ring::rand::SystemRandom::new()
        .fill(&mut key)
        .map_err(|_| fub_abi::PluginError::Internal("sync rng unavailable".into()))?;
    Ok(key)
}

pub fn wrap_for_passphrase(
    passphrase: &str,
    vdk: &[u8; VAULT_VDK_LEN],
) -> Result<WrappedVaultKey, fub_abi::PluginError> {
    let params = vault_kdf_fresh().map_err(|e| fub_abi::PluginError::Internal(e.into()))?;
    let kek = derive_vault_kek(passphrase, &params)
        .map_err(|e| fub_abi::PluginError::Internal(e.into()))?;
    let (nonce_b64, wrap_b64) = seal_aead(&kek, "fub-vdk-wrap|v1", vdk)
        .map_err(|e| fub_abi::PluginError::Internal(e.into()))?;
    Ok(WrappedVaultKey {
        kdf: params,
        nonce_b64,
        wrap_b64,
    })
}

pub fn unwrap_for_passphrase(
    passphrase: &str,
    value: &serde_json::Value,
) -> Result<[u8; VAULT_VDK_LEN], fub_abi::PluginError> {
    let wrapped: WrappedVaultKey = serde_json::from_value(value.clone())
        .map_err(|_| fub_abi::PluginError::BadArgs("invalid vault key envelope".into()))?;
    if wrapped.kdf.ver != VAULT_KDF_VERSION
        || wrapped.kdf.iterations != VAULT_KDF_ITERATIONS_V1
        || vault_b64_salt(&wrapped.kdf.salt_b64)
            .map(|v| v.len())
            .unwrap_or(0)
            != VAULT_SALT_LEN
    {
        return Err(fub_abi::PluginError::BadArgs(
            "unsupported vault key derivation".into(),
        ));
    }
    let kek = derive_vault_kek(passphrase, &wrapped.kdf)
        .map_err(|_| fub_abi::PluginError::BadArgs("invalid vault key derivation".into()))?;
    unwrap_vault_key(&wrapped, &kek)
        .map_err(|_| fub_abi::PluginError::PermissionDenied("vault key unavailable".into()))
}

pub fn load_vault_passphrase_from_env() -> Result<String, fub_abi::PluginError> {
    sync::load_vault_passphrase().map_err(|e| e.to_plugin_error())
}

pub fn is_syncable_entry(path: &str) -> bool {
    sync::is_syncable_path(path)
}

pub fn resolve_endpoint(
    host: &dyn fub_abi::traits::HostApi,
) -> Result<String, fub_abi::PluginError> {
    let setting = match host.setting(SETTING_SERVER_URL) {
        Ok(fub_abi::settings::SettingValue::Text(url)) => url.to_string(),
        Ok(_) => String::new(),
        Err(fub_abi::PluginError::NotFound(_)) => String::new(),
        Err(e) => return Err(e),
    };
    resolve_base(&setting).map_err(|e| e.to_plugin_error())
}

/// Il file in cui `fub-cli login` salva il token dei servizi, nella cartella
/// di configurazione della macchina.
pub const TOKEN_FILE: &str = "services-token";

/// Il tetto di un file di segreto: un token è una riga, non un documento.
const MAX_SECRET_FILE: u64 = 4_096;

/// Da dove si legge il token bearer dei servizi. In ordine: il file indicato
/// da `FUB_SERVICES_TOKEN_FILE`, la variabile `FUB_SERVICES_TOKEN`, e il file
/// che `fub-cli login` ha salvato nella configurazione della macchina
/// ([`TOKEN_FILE`]). Mai argv, log o history (F36, P16.4).
///
/// Il terzo è ciò che rende sync e pubblicazione usabili dall'app, che non ha
/// un ambiente da cui ricevere segreti: con le sole variabili il token c'era
/// per la CLI e mancava sempre al desktop. Si legge soltanto se è un file
/// regolare, non un collegamento, e su Unix leggibile dal solo proprietario,
/// cioè come `login` lo scrive; altrimenti resta fuori, e lo dice il log.
#[derive(Clone, Debug, Default)]
pub struct TokenSource {
    machine_file: Option<std::path::PathBuf>,
}

impl TokenSource {
    /// Soltanto l'ambiente: un host senza cartella di configurazione.
    pub fn environment() -> Self {
        Self::default()
    }

    /// L'ambiente, poi il token salvato nella configurazione della macchina.
    pub fn machine(config_root: Option<&camino::Utf8Path>) -> Self {
        Self {
            machine_file: config_root.map(|root| root.join(TOKEN_FILE).into_std_path_buf()),
        }
    }

    /// Il token, se una delle tre fonti ne ha uno.
    pub fn load(&self) -> Option<String> {
        if let Ok(path) = std::env::var("FUB_SERVICES_TOKEN_FILE") {
            if !path.trim().is_empty() {
                if let Ok(raw) = std::fs::read_to_string(path.trim()) {
                    let token = raw.trim().to_string();
                    if !token.is_empty() {
                        return Some(token);
                    }
                }
            }
        }
        let from_env = std::env::var("FUB_SERVICES_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        from_env.or_else(|| self.machine_file.as_deref().and_then(owner_only_secret))
    }
}

/// Il contenuto di un file di segreto scritto come lo scrive `login`: regolare,
/// non un collegamento, piccolo e, su Unix, del solo proprietario.
fn owner_only_secret(path: &std::path::Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_SECRET_FILE {
        tracing::warn!(target: "fub.host", "token dei servizi ignorato: non è un file regolare");
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            tracing::warn!(
                target: "fub.host",
                "token dei servizi ignorato: leggibile da altri oltre al proprietario"
            );
            return None;
        }
    }
    let token = std::fs::read_to_string(path).ok()?.trim().to_string();
    (!token.is_empty()).then_some(token)
}

/// Lo stato di sync di **un** vault su questa macchina:
/// `<config>/sync/vaults/<chiave>/`, dove la chiave viene dallo SHA-256 della
/// radice canonica del vault. Abbinamento, replica, outbox, cursore, conflitti
/// e binding dell'endpoint sono del vault e non della macchina: con una
/// cartella sola due vault condividevano identità remota e coda (I51).
///
/// Per percorso e non per un identificativo scritto dentro il vault, apposta:
/// una copia della cartella si porterebbe dietro l'identità, e due repliche
/// con lo stesso `replica-id` scriverebbero contatori che si contraddicono.
/// Un vault spostato riparte come replica nuova, da abbinare di nuovo; lo
/// stato del percorso vecchio resta dov'era e nessuno lo cancella.
pub fn vault_state_dir(
    config_root: &camino::Utf8Path,
    vault_root: &camino::Utf8Path,
) -> camino::Utf8PathBuf {
    let digest = ring::digest::digest(&ring::digest::SHA256, vault_root.as_str().as_bytes());
    let key: String = digest.as_ref()[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    config_root.join("sync").join("vaults").join(key)
}

/// Log strutturato allowlist (Main): niente testo libero con segreti.
///
/// NON redigere testo libero con finestra fissa (difetti del vecchio
/// `redacted`: tagliava chiave+24 byte lasciando il suffisso del segreto,
/// non copriva JSON/`Bearer`/case, panico al confine UTF-8). I log portano
/// SOLO questi campi tipizzati — metodo, path base (mai query), status,
/// contatori e motivi di hold — mai corpi, header, token o buste.
#[derive(Clone, Debug)]
pub struct SyncLogEvent {
    pub method: &'static str,
    pub path_base: String,
    pub status: Option<u16>,
    pub detail: SyncLogDetail,
}

/// Dettaglio senza segreti: solo conteggi e nomi di campo.
#[derive(Clone, Debug)]
pub enum SyncLogDetail {
    Transport,
    Protocol,
    Rejected,
    Pushed { count: usize },
    Pulled { count: usize },
    Applied { count: usize },
    Held { reason: &'static str },
}

impl std::fmt::Display for SyncLogEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let status = match self.status {
            Some(s) => format!(" -> {s}"),
            None => String::new(),
        };
        let detail = match &self.detail {
            SyncLogDetail::Transport => "transport".to_string(),
            SyncLogDetail::Protocol => "protocol".to_string(),
            SyncLogDetail::Rejected => "rejected".to_string(),
            SyncLogDetail::Pushed { count } => format!("pushed {count}"),
            SyncLogDetail::Pulled { count } => format!("pulled {count}"),
            SyncLogDetail::Applied { count } => format!("applied {count}"),
            SyncLogDetail::Held { reason } => format!("held: {reason}"),
        };
        write!(
            f,
            "{} {}{}: {}",
            self.method, self.path_base, status, detail
        )
    }
}

/// Path base per i log (mai la query: `?password=`/`?site_id=` non escono).
pub fn log_path_base(path: &str) -> &str {
    match path.find('?') {
        Some(i) => &path[..i],
        None => path,
    }
}

/// Compat: il vecchio `redacted(line)` è vietato (finestra fissa = leak).
/// Resta come alias che IGNORA l'input e non lo registra mai: chi logga usa
/// [`SyncLogEvent`]. Chiamarlo con un corpo è un errore di chiamata, non un
/// filtro.
#[deprecated(note = "log SyncLogEvent instead: fixed-window redaction leaks secret suffixes")]
pub fn redacted(_line: &str) -> String {
    String::from("<unlogged>")
}

// ---------------------------------------------------------------------------
// Lettori dei setting sync registrati da Main (scope macchina, anche senza
// vault): `sync.server_url`, `sync.paused`, `sync.exclude`. Porta esistente =
// `Host::query_index(IndexQuery::Settings)`; niente autorità doppie.
// ---------------------------------------------------------------------------

/// Chiavi dei setting sync (mirror di `fub_host::settings`, senza dipendenza
/// dal modulo condiviso: il nome è il contratto, non il simbolo).
pub const SETTING_SERVER_URL: &str = "sync.server_url";
pub const SETTING_PAUSED: &str = "sync.paused";
pub const SETTING_EXCLUDE: &str = "sync.exclude";

/// Legge i tre setting sync dalle righe `Settings` (scope macchina incluso).
/// Righe assenti o tipo errato = default (vuoto/false/vuoto), mai errore.
pub fn read_sync_settings(entries: &[fub_abi::settings::SettingEntry]) -> SyncSettings {
    let mut out = SyncSettings::default();
    for entry in entries {
        match entry.spec.key.as_str() {
            SETTING_SERVER_URL => {
                if let Some(text) = entry.value.as_text() {
                    out.server_url = text.trim().to_string();
                }
            }
            SETTING_PAUSED => {
                if let Some(paused) = entry.value.as_toggle() {
                    out.paused = paused;
                }
            }
            SETTING_EXCLUDE => {
                if let Some(list) = entry.value.as_list() {
                    out.user_exclude = parse_user_exclude(list);
                }
            }
            _ => {}
        }
    }
    out
}

/// Valori sync risolti: `server_url` vuoto = non configurato (il chiamante
/// usa `resolve_base`, mai loopback implicito); `paused` = policy persistita
/// (l'operatività resta al flag-file crash-safe del coordinatore, che la
/// rivaluta a ogni tick); `user_exclude` = ADDITIVO alle esclusioni di
/// sicurezza obbligatorie, mai sostitutivo.
#[derive(Clone, Debug, Default)]
pub struct SyncSettings {
    pub server_url: String,
    pub paused: bool,
    pub user_exclude: Vec<String>,
}

/// Parser bounded delle esclusioni utente (cap 64 voci, 256 caratteri
/// ciascuna): oltre = troncato, mai allocazione illimitata da setting.
pub fn parse_user_exclude(list: &[String]) -> Vec<String> {
    list.iter()
        .take(64)
        .map(|item| item.trim().chars().take(256).collect::<String>())
        .filter(|item| !item.is_empty())
        .collect()
}

/// `true` se il doc è escluso dalle liste utente (prefisso-cartella o
/// estensione `.ext`, case-insensitive). Le categorie device-only restano
/// sempre escluse altrove (`is_syncable_doc` server + coordinatore).
pub fn is_user_excluded(user_exclude: &[String], doc_id: &str) -> bool {
    let lower = doc_id.to_ascii_lowercase();
    let first = lower.split('/').next().unwrap_or("");
    let filename = lower.rsplit('/').next().unwrap_or("");
    let category = if first == "attachments"
        || [".png", ".jpg", ".jpeg", ".pdf", ".mp3", ".mp4", ".zip"]
            .iter()
            .any(|ext| filename.ends_with(ext))
    {
        "attachments"
    } else if first == "config-shared" || lower.ends_with(".shared.json") {
        "config-shared"
    } else {
        "notes"
    };
    user_exclude.iter().any(|rule| {
        let rule = rule.trim().to_ascii_lowercase();
        if rule.is_empty() {
            return false;
        }
        if let Some(ext) = rule.strip_prefix("ext:").or_else(|| rule.strip_prefix('.')) {
            let ext = ext.trim_start_matches('.');
            return !ext.is_empty() && filename.ends_with(&format!(".{ext}"));
        }
        if let Some(prefix) = rule.strip_prefix("prefix:") {
            return !prefix.is_empty() && lower.starts_with(prefix);
        }
        if rule.contains('/') || rule.contains('.') {
            return lower.starts_with(&rule);
        }
        rule == category
    })
}

// ---------------------------------------------------------------------------
// Busta AAD canonica — mirror di `fub_services::crypto` (P16, Main).
// ---------------------------------------------------------------------------

/// Busta AAD canonica tipizzata: autentica TUTTI i campi decisivi
/// (protocollo, vault, key epoch, op-id, replica, doc, kind, vv, timestamp,
/// rename-routing). Mirror di `fub_services::crypto::SyncEnvelope`: stesse
/// chiavi, stessa forma canonica. Mai fidarsi della `aad` ricevuta sul wire.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SyncEnvelope {
    pub protocol: String,
    pub vault_id: String,
    pub key_epoch: u32,
    pub op_id: String,
    pub replica_id: String,
    pub doc_id: String,
    pub kind: String,
    /// Valori come stringhe sul wire (compat numero): regola u64-identità.
    #[serde(with = "vv_string")]
    pub vv: std::collections::BTreeMap<String, u64>,
    /// Millisecondi UNIX: restano number (aritmetica, mai oltre 2^53).
    pub ts_ms: u64,
    pub rename_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_from: Option<String>,
}

/// Forma canonica del vettore di versione (chiavi ordinate).
pub fn vv_canonical(vv: &std::collections::BTreeMap<String, u64>) -> String {
    vv.iter()
        .map(|(replica, counter)| format!("{replica}:{counter}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// AAD canonica come JSON a chiavi ordinate. Deve produrre byte-identica la
/// stessa stringa del backend a parità di campi: è la conformità reale.
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
    // Valori vv come stringhe decimali (stessa regola del backend): AAD
    // byte-identica a parità di campi — è la conformità reale.
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

/// Cifra con VDK (32 B) + AAD canonica: `(nonce_b64, ciphertext_b64)`, nonce
/// casuale 96 bit per cifratura (ring AES-256-GCM via LessSafeKey).
pub fn encrypt_envelope(
    vdk: &[u8; 32],
    envelope: &SyncEnvelope,
    plaintext: &[u8],
) -> Result<(String, String), String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    use ring::{aead, rand::SecureRandom};
    let rng = ring::rand::SystemRandom::new();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "rng unavailable".to_string())?;
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, vdk).map_err(|_| "bad aead key".to_string())?,
    );
    let mut buf = plaintext.to_vec();
    let aad = canonical_aad_json(envelope);
    key.seal_in_place_append_tag(nonce, aead::Aad::from(aad.as_bytes()), &mut buf)
        .map_err(|_| "seal failed".to_string())?;
    Ok((B64.encode(nonce_bytes), B64.encode(&buf)))
}

/// Valida la busta e decifra verificando l'AAD RICALCOLATA dai campi — mai
/// quella ricevuta sul wire. Chiamare SEMPRE prima di qualunque
/// apply/delete/rename; mismatch = hold + errore, mai apply.
pub fn aad_verify(
    vdk: &[u8; 32],
    envelope: &SyncEnvelope,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<Vec<u8>, String> {
    if envelope.protocol != SYNC_PROTOCOL {
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
    decrypt_envelope(vdk, envelope, nonce_b64, ciphertext_b64)
}

fn decrypt_envelope(
    vdk: &[u8; 32],
    envelope: &SyncEnvelope,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<Vec<u8>, String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    use ring::aead;
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
        aead::UnboundKey::new(&aead::AES_256_GCM, vdk).map_err(|_| "bad aead key".to_string())?,
    );
    let aad = canonical_aad_json(envelope);
    let plain = key
        .open_in_place(nonce, aead::Aad::from(aad.as_bytes()), &mut buf)
        .map_err(|_| "open failed: tampered or wrong key".to_string())?;
    Ok(plain.to_vec())
}

// Pairing e key epoch sono unici per la root TRUSTED (mai per un path del vault).
pub fn load_or_create_vault_pairing(
    state_dir: &std::path::Path,
    scope: Option<&str>,
) -> Result<String, String> {
    let path = state_dir.join("vault-pairing");
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let id = raw.trim().to_string();
            if !valid_vault_id(&id) || scope.is_some_and(|scope| scope != id) {
                return Err("sync vault pairing mismatch or corrupt".into());
            }
            Ok(id)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let id = scope.map(str::to_string).unwrap_or_else(new_replica_id);
            if !valid_vault_id(&id) {
                return Err("invalid sync vault pairing".into());
            }
            atomic_state_write(state_dir, "vault-pairing", id.as_bytes())
                .map_err(|_| "sync vault pairing write failed".to_string())?;
            Ok(id)
        }
        Err(_) => Err("sync vault pairing unreadable".into()),
    }
}

fn valid_vault_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub fn load_key_epoch(state_dir: &std::path::Path) -> Result<u32, String> {
    match std::fs::read_to_string(state_dir.join("key-epoch")) {
        Ok(value) => value
            .trim()
            .parse()
            .map_err(|_| "sync key epoch corrupt".to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(_) => Err("sync key epoch unreadable".into()),
    }
}

// ---------------------------------------------------------------------------
// Trasporto HTTP indurito (ureq sincrono, Main).
// ---------------------------------------------------------------------------

/// Timeout assoluti (non rinnovati per byte: slowloris non trattiene il
/// client). Connect 10 s, totale 30 s.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const TOTAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// Tetto corpi in lettura: 64 MiB (come il server).
const MAX_BODY: u64 = 64 * 1024 * 1024;

/// Valida la base URL: HTTPS sempre ok; HTTP solo verso loopback esplicito.
/// Rifiuta userinfo, query, fragment e host vuoti. Torna la base normalizzata.
pub fn validate_base_url(base: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("empty base url".to_string());
    }
    let (scheme, rest) = match base.find("://") {
        Some(i) => (base[..i].to_ascii_lowercase(), base[i + 3..].to_string()),
        None => return Err("bad base url: missing scheme".to_string()),
    };
    if rest.contains(['?', '#', '@']) {
        return Err("bad base url: no credentials/query/fragment".to_string());
    }
    let authority = rest.split('/').next().unwrap_or("");
    let host_only = if let Some(host) = authority.strip_prefix('[') {
        let (address, port) = host
            .split_once(']')
            .ok_or_else(|| "bad base url: invalid IPv6 host".to_string())?;
        if !port.is_empty() && (!port.starts_with(':') || port[1..].parse::<u16>().is_err()) {
            return Err("bad base url: invalid port".to_string());
        }
        address
    } else {
        let (host, port) = authority.rsplit_once(':').unwrap_or((authority, ""));
        if !port.is_empty() && port.parse::<u16>().is_err() {
            return Err("bad base url: invalid port".to_string());
        }
        host
    };
    if host_only.trim().is_empty() {
        return Err("bad base url: empty host".to_string());
    }
    match scheme.as_str() {
        "https" => Ok(base),
        "http" => {
            if matches!(host_only, "127.0.0.1" | "::1" | "localhost") {
                Ok(base)
            } else {
                Err("http only for loopback".to_string())
            }
        }
        _ => Err("bad base url: https or loopback http only".to_string()),
    }
}

fn sync_agent() -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .timeout_global(Some(TOTAL_TIMEOUT))
        // Mai seguire redirect con credenziali: il server non ne emette, e un
        // 3xx verso un altro host porterebbe il bearer fuori recinto.
        .max_redirects(0)
        .max_redirects_will_error(true)
        // Gli status HTTP restano nella risposta (non Err): il chiamante
        // conserva status e specie tipizzata (401/403/404/409/...).
        .http_status_as_error(false)
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                .build(),
        )
        .build();
    ureq::Agent::new_with_config(config)
}

/// Errore di trasporto con metodo + path base + specie: mai URL completa,
/// mai query, mai segreti (il token non entra mai nei messaggi).
fn transport_error(method: &str, path: &str, error: &ureq::Error) -> String {
    let base = match path.find('?') {
        Some(i) => &path[..i],
        None => path,
    };
    match error {
        ureq::Error::StatusCode(status) => {
            format!("{method} {base}: http status {status}")
        }
        ureq::Error::Timeout(_) => {
            format!("{method} {base}: timeout")
        }
        ureq::Error::TooManyRedirects => {
            format!("{method} {base}: redirect refused")
        }
        other => {
            let kind = match other {
                ureq::Error::HostNotFound => "dns",
                ureq::Error::ConnectionFailed => "connection failed",
                ureq::Error::Tls(_) => "tls",
                _ => "transport",
            };
            format!("{method} {base}: {kind}")
        }
    }
}

fn run_request(
    method: &str,
    base: &str,
    path: &str,
    token: Option<&str>,
    payload: Option<&[u8]>,
) -> Result<(u16, Vec<u8>), String> {
    let base = validate_base_url(base)?;
    // Il path non deve portare query con segreti al server sync... la query è
    // ammessa solo per chiavi non sensibili (`replica_id`, `site_id`,
    // `doc_id`); `?password=` qui è rifiutato fail-closed.
    if path.contains("password=") {
        return Err(format!(
            "{method} {}: secrets never in query",
            log_path(path)
        ));
    }
    let url = format!("{base}{path}");
    let agent = sync_agent();
    let mut builder = ureq::http::Request::builder().method(method).uri(&url);
    if payload.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(token) = token {
        // Il token vive solo nell'header in memoria, mai nei log/errori.
        let value = format!("Bearer {token}");
        builder = builder.header("authorization", value.as_str());
    }
    let body: &[u8] = payload.unwrap_or(&[]);
    let req = builder
        .body(body)
        .map_err(|_| format!("{} {}: bad request", method, log_path(path)))?;
    let mut response = agent
        .run(req)
        .map_err(|e| transport_error(method, path, &e))?;
    let status = response.status().as_u16();
    let bytes = response
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_vec()
        .map_err(|_| format!("{} {}: body too large", method, log_path(path)))?;
    Ok((status, bytes))
}

/// Path base per log/errori (mai la query).
fn log_path(path: &str) -> &str {
    match path.find('?') {
        Some(i) => &path[..i],
        None => path,
    }
}

/// POST JSON sincrono con bearer opzionale. Torna `(status, body)` con status
/// reale SEMPRE conservato (401/409/... non diventano `Err` di trasporto).
/// Errori di trasporto = `Err` senza URL completa, query o segreti.
pub fn post_json(
    base: &str,
    path: &str,
    token: Option<&str>,
    payload: &serde_json::Value,
) -> Result<(u16, Vec<u8>), String> {
    let body = serde_json::to_vec(payload).map_err(|e| format!("encode: {e}"))?;
    run_request("POST", base, path, token, Some(&body))
}

/// GET sincrono con bearer opzionale. Torna `(status, body)`.
pub fn get(base: &str, path: &str, token: Option<&str>) -> Result<(u16, Vec<u8>), String> {
    run_request("GET", base, path, token, None)
}

/// Parsing JSON stretto: corpo invalido = errore `Protocol`, mai `Null`.
/// I chiamanti (SyncClient/PublishClient) lo usano al posto di
/// `from_slice(...).unwrap_or(Null)`.
pub fn parse_json_strict(body: &[u8]) -> Result<serde_json::Value, String> {
    serde_json::from_slice(body).map_err(|e| format!("protocol: bad json body: {e}"))
}

/// Campo stringa obbligatorio: assente o tipo errato = errore `Protocol`,
/// mai default silenzioso.
pub fn require_str(value: &serde_json::Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("protocol: missing or invalid '{field}'"))
}

/// Campo u64 obbligatorio: assente o tipo errato = errore `Protocol`.
pub fn require_u64(value: &serde_json::Value, field: &str) -> Result<u64, String> {
    value
        .get(field)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("protocol: missing or invalid '{field}'"))
}

/// Campo bool obbligatorio: assente o tipo errato = errore `Protocol`.
pub fn require_bool(value: &serde_json::Value, field: &str) -> Result<bool, String> {
    value
        .get(field)
        .and_then(|v| v.as_bool())
        .ok_or_else(|| format!("protocol: missing or invalid '{field}'"))
}

/// Campo array obbligatorio: assente o tipo errato = errore `Protocol`.
pub fn require_array<'a>(
    value: &'a serde_json::Value,
    field: &str,
) -> Result<&'a Vec<serde_json::Value>, String> {
    value
        .get(field)
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("protocol: missing or invalid '{field}'"))
}

/// Campo oggetto obbligatorio: assente o tipo errato = errore `Protocol`.
pub fn require_object<'a>(
    value: &'a serde_json::Value,
    field: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>, String> {
    value
        .get(field)
        .and_then(|v| v.as_object())
        .ok_or_else(|| format!("protocol: missing or invalid '{field}'"))
}

/// Verifica `GET /v1/hello`: protocol mismatch = errore duro (no fallback).
pub fn assert_hello(body: &[u8]) -> Result<(), String> {
    let hello: serde_json::Value = parse_json_strict(body)?;
    let protocol = require_str(&hello, "protocol")?;
    if protocol == SYNC_PROTOCOL {
        Ok(())
    } else {
        Err(format!(
            "protocol mismatch: got {protocol}, want {SYNC_PROTOCOL}"
        ))
    }
}

/// `BTreeMap<String, u64>` con valori come stringhe sul wire (compat numero):
/// mirror di `fub_services::wire::vv_string` senza dipendenza dal server.
pub mod vv_string {
    use std::collections::BTreeMap;

    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum NumberOrString {
        Number(u64),
        String(String),
    }

    impl NumberOrString {
        fn parse(self) -> Result<u64, std::num::ParseIntError> {
            match self {
                NumberOrString::Number(n) => Ok(n),
                NumberOrString::String(s) => s.trim().parse(),
            }
        }
    }

    pub fn serialize<S: serde::Serializer>(
        v: &BTreeMap<String, u64>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(Some(v.len()))?;
        for (k, n) in v {
            map.serialize_entry(k, &n.to_string())?;
        }
        map.end()
    }

    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        d: D,
    ) -> Result<BTreeMap<String, u64>, D::Error> {
        let raw: BTreeMap<String, NumberOrString> = serde::Deserialize::deserialize(d)?;
        raw.into_iter()
            .map(|(k, v)| v.parse().map_err(serde::de::Error::custom).map(|n| (k, n)))
            .collect()
    }
}

/// `u64` identità come stringa sul wire (compat numero).
pub mod u64_string {
    pub fn serialize<S: serde::Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(v)
    }

    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(untagged)]
        enum One {
            Number(u64),
            String(String),
        }
        match serde::Deserialize::deserialize(d)? {
            One::Number(n) => Ok(n),
            One::String(s) => s.trim().parse().map_err(serde::de::Error::custom),
        }
    }
}

#[cfg(test)]
mod state_write_tests {
    /// Lo stato della sync si scrive e si sostituisce anche dove una cartella
    /// non si apre come file (Windows), senza lasciare temporanei.
    #[test]
    fn sync_state_is_written_replaced_and_leaves_no_temporary() {
        let dir = tempfile::tempdir().unwrap();
        super::atomic_state_write(dir.path(), "cursor", b"1").unwrap();
        super::atomic_state_write(dir.path(), "cursor", b"2").unwrap();
        assert_eq!(std::fs::read(dir.path().join("cursor")).unwrap(), b"2");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        super::sync_dir(dir.path()).unwrap();
    }
}

#[cfg(test)]
mod machine_state_tests {
    use camino::Utf8Path;

    /// Il token salvato da `login` vale solo com'è scritto da `login`: un
    /// file del solo proprietario, non un collegamento.
    #[cfg(unix)]
    #[test]
    fn the_saved_token_is_read_only_when_it_is_the_owners_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(super::TOKEN_FILE);
        std::fs::write(&path, "segreto\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(super::owner_only_secret(&path).as_deref(), Some("segreto"));

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        assert_eq!(
            super::owner_only_secret(&path),
            None,
            "readable by the group"
        );

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert_eq!(super::owner_only_secret(&link), None, "a symlink");
        assert_eq!(super::owner_only_secret(dir.path()), None, "a directory");
    }

    /// Ogni vault ha la sua cartella di stato, sempre la stessa per lo stesso
    /// percorso, dentro la configurazione della macchina.
    #[test]
    fn every_vault_has_its_own_stable_sync_state() {
        let config = Utf8Path::new("/config");
        let a = super::vault_state_dir(config, Utf8Path::new("/vaults/a"));
        let b = super::vault_state_dir(config, Utf8Path::new("/vaults/b"));
        assert_ne!(a, b);
        assert_eq!(
            a,
            super::vault_state_dir(config, Utf8Path::new("/vaults/a"))
        );
        assert!(a.starts_with("/config/sync/vaults"), "{a}");
        assert_eq!(a.file_name().map(str::len), Some(32), "{a}");
    }
}
