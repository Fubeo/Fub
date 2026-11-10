//! I file di configurazione del proprietario e il comando `pairing`.

use crate::cli::{GlobalArgs, PairAction};
use crate::commands::Failure;
use crate::output::envelope_ok;
use crate::output::OutputFormat;
use base64::Engine;

use super::documents::items_len;

pub fn config_path(global: &GlobalArgs, name: &str) -> Result<std::path::PathBuf, Failure> {
    if let Some(dir) = global
        .config_dir
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        return Ok(std::path::PathBuf::from(dir).join(name));
    }
    if let Ok(dir) = std::env::var("FUB_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return Ok(std::path::PathBuf::from(dir).join(name));
        }
    }
    if let Some(dir) = fub_host::config_dir() {
        return Ok(std::path::PathBuf::from(dir.as_str()).join(name));
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return Ok(std::path::PathBuf::from(home)
                .join(".config")
                .join("fub")
                .join(name));
        }
    }
    Err(Failure::local("nessuna config dir"))
}

pub fn load_pairs(global: &GlobalArgs) -> Result<Vec<fub_host::automation::PairEntry>, Failure> {
    let path = config_path(global, "clipper-pairing.json")?;
    // Soltanto un file assente è «nessun abbinamento»: un file che non si
    // legge, letto come vuoto, sarebbe riscritto dal prossimo `pair` con il
    // solo abbinamento nuovo.
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(Failure::local(format!("pairing illeggibile: {e}"))),
    };
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| Failure::local(format!("pairing illeggibile: {e}")))?;
    let pairs = value
        .get("pairs")
        .cloned()
        .unwrap_or(serde_json::Value::Array(Vec::new()));
    serde_json::from_value(pairs).map_err(|e| Failure::local(format!("pairing non valido: {e}")))
}

pub fn save_owner_file(path: &std::path::Path, bytes: &[u8]) -> Result<(), Failure> {
    use std::io::Write;
    let parent = path
        .parent()
        .ok_or_else(|| Failure::bad_args("file senza directory"))?;
    std::fs::create_dir_all(parent).map_err(|e| Failure::local(format!("config dir: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(Failure::new(4, "denied", "secret file è symlink"));
        }
        let meta =
            std::fs::metadata(parent).map_err(|e| Failure::local(format!("config dir: {e}")))?;
        if meta.permissions().mode() & 0o077 != 0 {
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| Failure::local(format!("config dir permessi: {e}")))?;
        }
    }
    use ring::rand::SecureRandom;
    let mut suffix = [0u8; 12];
    ring::rand::SystemRandom::new()
        .fill(&mut suffix)
        .map_err(|_| Failure::local("random non disponibile"))?;
    let suffix = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(suffix);
    let tmp = path.with_extension(format!("tmp-{suffix}"));
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
    };
    #[cfg(not(unix))]
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp);
    let mut file = file.map_err(|e| Failure::local(format!("secret file: {e}")))?;
    let written = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        // Su Windows una cartella non si apre come file: la rename resta
        // quella ordinaria (decisione 0202).
        #[cfg(not(windows))]
        std::fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written.map_err(|e| Failure::local(format!("secret file: {e}")))
}

fn save_pairs(
    global: &GlobalArgs,
    pairs: &[fub_host::automation::PairEntry],
) -> Result<(), Failure> {
    let path = config_path(global, "clipper-pairing.json")?;
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({ "pairs": pairs }))
        .map_err(|e| Failure::local(format!("pairing: {e}")))?;
    save_owner_file(&path, &bytes)
}

pub fn pairing(
    global: &GlobalArgs,
    _format: &OutputFormat,
    action: PairAction,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    match action {
        PairAction::Add {
            extension_id,
            vault,
            folder,
        } => {
            use fub_host::automation::{
                CaptureEnvelope, CaptureMode, CapturePayloadV1, CaptureTarget, CLIPPER_ORIGIN,
            };
            fub_host::automation::validate_envelope(&CaptureEnvelope {
                nonce: "pair-check".to_string(),
                origin: CLIPPER_ORIGIN.to_string(),
                extension_id: Some(extension_id.clone()),
                timestamp_ms: None,
            })
            .map_err(|e| Failure::from_automation(&e))?;
            if folder
                .as_deref()
                .is_some_and(|f| f.starts_with('/') || f.starts_with('\\'))
            {
                return Err(Failure::bad_args("cartella pairing relativa"));
            }
            fub_host::automation::validate_capture_v1(&CapturePayloadV1 {
                v: 1,
                title: "pair-check".to_string(),
                markdown: "pair-check".to_string(),
                source_url: None,
                properties: None,
                target: CaptureTarget {
                    vault: vault.clone(),
                    folder: folder.clone(),
                    note: None,
                    mode: CaptureMode::Create,
                },
            })
            .map_err(|e| Failure::from_automation(&e))?;
            let mut pairs = load_pairs(global)?;
            pairs.retain(|p| {
                !(p.extension_id == extension_id && p.vault == vault && p.folder == folder)
            });
            pairs.push(fub_host::automation::PairEntry {
                extension_id: extension_id.clone(),
                vault: vault.clone(),
                folder: folder.clone(),
            });
            save_pairs(global, &pairs)?;
            print(&envelope_ok(
                serde_json::json!({ "paired": extension_id, "vault": vault, "folder": folder }),
            ));
            Ok(())
        }
        PairAction::List => {
            let pairs = load_pairs(global)?;
            let items: Vec<serde_json::Value> =
                pairs.into_iter().map(|p| serde_json::json!(p)).collect();
            print(&envelope_ok(
                serde_json::json!({ "items": items, "total": items_len(&items) }),
            ));
            Ok(())
        }
        PairAction::Remove { extension_id } => {
            let mut pairs = load_pairs(global)?;
            let before = pairs.len();
            pairs.retain(|p| p.extension_id != extension_id);
            save_pairs(global, &pairs)?;
            print(&envelope_ok(
                serde_json::json!({ "unpaired": extension_id, "removed": before - pairs.len() }),
            ));
            Ok(())
        }
    }
}
