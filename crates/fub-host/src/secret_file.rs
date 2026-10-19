//! I file di segreto della macchina: un token per file, nella cartella di
//! configurazione, leggibile dal solo proprietario. È la forma in cui
//! `fub-cli login` salva il token dei servizi e in cui l'app salva i token dei
//! connettori: chi legge accetta soltanto quella, chi scrive produce soltanto
//! quella.

use std::io::Write;
use std::path::Path;

/// Il tetto di un file di segreto: un token è una riga, non un documento.
const MAX_SECRET_FILE: u64 = 4_096;

/// Il contenuto di un file di segreto scritto come lo scrive `login`: regolare,
/// non un collegamento, piccolo e, su Unix, del solo proprietario.
pub(crate) fn owner_only(path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_SECRET_FILE {
        tracing::warn!(target: "fub.host", "segreto ignorato: non è un file regolare");
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            tracing::warn!(
                target: "fub.host",
                "segreto ignorato: leggibile da altri oltre al proprietario"
            );
            return None;
        }
    }
    let token = std::fs::read_to_string(path).ok()?.trim().to_string();
    (!token.is_empty()).then_some(token)
}

/// Scrive `token` in `path` nella forma che [`owner_only`] accetta: il file
/// temporaneo nasce già del solo proprietario, si porta su disco e prende il
/// posto del precedente con una rename. Un errore lascia il token di prima.
pub(crate) fn write_owner_only(path: &Path, token: &str) -> std::io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("un segreto vuole una cartella"))?;
    std::fs::create_dir_all(dir)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| std::io::Error::other("un segreto vuole un nome"))?;
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(token.as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Toglie il segreto in `path`; uno che non c'è è già tolto.
pub(crate) fn forget(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn what_is_written_is_read_back_and_forgetting_twice_is_fine() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connectors").join("notion.token");
        super::write_owner_only(&path, "segreto").unwrap();
        assert_eq!(super::owner_only(&path).as_deref(), Some("segreto"));
        super::write_owner_only(&path, "nuovo").unwrap();
        assert_eq!(super::owner_only(&path).as_deref(), Some("nuovo"));
        super::forget(&path).unwrap();
        super::forget(&path).unwrap();
        assert_eq!(super::owner_only(&path), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_secret_readable_by_others_is_ignored() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t");
        std::fs::write(&path, "segreto\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(super::owner_only(&path), None);
    }
}
