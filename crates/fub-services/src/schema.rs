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
    /// Vault di cui un account può essere proprietario (default 16). Manca
    /// nei `services.json` scritti prima che esistesse.
    #[serde(default = "default_max_vaults")]
    pub max_vaults: u16,
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
            max_vaults: default_max_vaults(),
            retention_days: 30,
            regions: vec!["local".to_string()],
        }
    }
}

fn default_max_vaults() -> u16 {
    16
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

/// Legge un file che può mancare: `None` soltanto se non c'è. Ogni altro
/// guasto risale col suo tipo — un registro che il disco non sa dire non è un
/// registro vuoto, e il salvataggio successivo lo cancellerebbe. È la
/// differenza che `Path::exists` non fa: per lui un errore vale «assente».
pub fn read_if_present(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Crea un file nuovo leggibile dal solo proprietario: `create_new` (un nome
/// già presente, symlink compreso, è un errore e non si segue) e, su Unix,
/// `0600` fin dalla nascita, qualunque sia la umask del processo.
pub fn create_private(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Crea `dir` e gli antenati mancanti, quelli nuovi del solo proprietario
/// (`0700` su Unix).
pub fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)
}

/// Un nome temporaneo che due scritture dello stesso registro non condividono:
/// processo, contatore del processo e nanosecondi.
fn unique_tmp(path: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!(".{name}.{}.{seq}.{nanos}.tmp", std::process::id()))
}

/// Scrittura atomica (tmp + rename + fsync dir): code durevoli, ack durevoli.
///
/// Il temporaneo ha un nome unico, nasce con `create_new` e del solo
/// proprietario: i registri contengono hash, grant e buste, e nessuno degli
/// altri utenti della macchina li legge nemmeno per l'istante della scrittura.
/// Un errore toglie il temporaneo e lascia il file di prima.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    if let Some(parent) = path.parent() {
        create_private_dir(parent)?;
    }
    let tmp = unique_tmp(path);
    let result = (|| {
        // Lo fsync passa dallo handle che ha scritto: su Windows
        // `FlushFileBuffers` rifiuta un handle aperto in sola lettura.
        let mut file = create_private(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_config_written_before_max_vaults_still_loads() {
        let config: ServicesConfig = serde_json::from_str(
            r#"{"quotas":{"max_vault_bytes":1,"max_asset_bytes":1,"max_sites":2,
                "retention_days":3,"regions":["local"]}}"#,
        )
        .unwrap();
        assert_eq!(config.quotas.max_sites, 2);
        assert_eq!(
            config.quotas.max_vaults,
            ServiceQuotas::default().max_vaults
        );
    }
}
