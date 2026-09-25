//! # Configurazione condivisa: quote, retention, regioni, percorsi (P16.3/P17.1)
//!
//! Quote e retention sono **applicate dal server**, configurabili via
//! `services.json` + env `FUB_SERVICES_DATA_DIR`. Regioni: `["local"]` finché
//! non esiste un deployment reale — nessun'altra regione si dichiara.
//!
//! Separazione device-vs-condiviso: [`SYNC_EXCLUDE`] elenca le categorie che
//! non lasciano mai il dispositivo (cache, bozze, stato macchina, segreti,
//! codice plugin). La selezione sync e il manifest publish la onorano entrambe.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Categorie che non lasciano mai il dispositivo (P16.5).
///
/// Sincronizzare una lista plugin non equivale ad autorizzare codice su un
/// nuovo dispositivo; tema, cache, bozze e segreti restano locali.
pub const SYNC_EXCLUDE: &[&str] = &[
    "cache",
    "drafts",
    "device",
    "plugins.code",
    "theme",
    "secrets",
];

/// Quote e conservazione applicate dal server (P16.3, P17.1).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServiceQuotas {
    /// Byte totali per vault remoto (default 256 MiB).
    pub max_vault_bytes: u64,
    /// Byte per singolo asset (default 64 MiB).
    pub max_asset_bytes: u64,
    /// Siti pubblicabili per account (default 16).
    pub max_sites: u16,
    /// Giorni di conservazione di tombstone/versioni/cestino (default 30).
    pub retention_days: u32,
    /// Regioni dichiarate. Solo `local` senza deployment reale.
    pub regions: Vec<String>,
}

impl Default for ServiceQuotas {
    fn default() -> Self {
        Self {
            max_vault_bytes: 256 * 1024 * 1024,
            max_asset_bytes: 64 * 1024 * 1024,
            max_sites: 16,
            retention_days: 30,
            regions: vec!["local".to_string()],
        }
    }
}

fn default_loopback() -> bool {
    true
}

/// Configurazione del servizio, da `services.json` nella data dir.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServicesConfig {
    #[serde(default)]
    pub quotas: ServiceQuotas,
    /// HTTP in chiaro solo su loopback ed esplicito (sviluppo). Produzione =
    /// TLS terminato davanti (blocco esterno documentato in lib.rs).
    #[serde(default = "default_loopback")]
    pub allow_loopback_http: bool,
}

impl Default for ServicesConfig {
    fn default() -> Self {
        Self {
            quotas: ServiceQuotas::default(),
            allow_loopback_http: true,
        }
    }
}

/// Millisecondi UNIX (orologio di parete del server).
pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Nuovo id opaco (UUID v4): replica, op, account, siti. MAI derivato da path.
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Data dir: env `FUB_SERVICES_DATA_DIR` o `./services-data`.
pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("FUB_SERVICES_DATA_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    PathBuf::from("services-data")
}

/// Sotto-cartella della coda sync durevole + stato repliche.
pub fn sync_dir(base: &Path) -> PathBuf {
    base.join("sync")
}

/// Sotto-cartella dei siti (staging + live + versioni).
pub fn sites_dir(base: &Path) -> PathBuf {
    base.join("sites")
}

/// Registro account nella data dir.
pub fn accounts_path(base: &Path) -> PathBuf {
    base.join("accounts.json")
}

/// File di configurazione nella data dir.
pub fn config_path(base: &Path) -> PathBuf {
    base.join("services.json")
}

/// Scrittura atomica (tmp + rename + fsync dir): code durevoli, ack durevoli.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    // Lo fsync passa dallo handle che ha scritto: su Windows `FlushFileBuffers`
    // rifiuta un handle aperto in sola lettura.
    let mut file = fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&tmp, path)?;
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// `true` se la categoria non deve mai lasciare il dispositivo.
pub fn is_device_only(category: &str) -> bool {
    SYNC_EXCLUDE.contains(&category)
}
