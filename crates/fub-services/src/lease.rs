//! # La data dir ha un solo processo proprietario (STR-01, STR-02)
//!
//! I registri (`accounts.json`, `shares.json`, i record dei siti) si caricano
//! interi in memoria e si riscrivono interi: due processi sulla stessa
//! cartella, anche su porte diverse, si cancellerebbero a vicenda gli account
//! e i grant con l'ultima rename. Il [`DataDirLease`] è un lock esclusivo del
//! sistema operativo su `<data>/.lock`, preso **prima di leggere qualunque
//! stato** e tenuto finché vive il [`crate::server::ServiceState`]: il secondo
//! processo esce con un errore che lo dice.
//!
//! La stessa apertura chiude il confine di riservatezza. Su Unix la cartella
//! è del solo proprietario (`0700`), ogni file e sottocartella dentro di lei
//! anche (`0600`/`0700`, corretti in migrazione quando erano più larghi), e un
//! collegamento simbolico o una voce di un altro utente fanno fallire
//! l'avvio: un confine che non si può garantire non si finge. Su Windows i
//! permessi restano quelli ereditati dalla cartella che l'operatore sceglie
//! (il profilo utente è già privato per default); il lock vale uguale.

use std::fs;
use std::path::{Path, PathBuf};

/// Nome del file di lock dentro la data dir.
pub const LOCK_FILE: &str = ".lock";

/// Lock esclusivo sulla data dir: si rilascia quando si lascia cadere.
#[derive(Debug)]
pub struct DataDirLease {
    _file: fs::File,
    dir: PathBuf,
}

impl DataDirLease {
    /// La cartella che il lease protegge.
    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

/// Crea (o apre) la data dir, ne prende il lock esclusivo e ne verifica il
/// confine di riservatezza. Errore se un altro processo la tiene, se è un
/// collegamento, se non è del proprietario del processo o se i permessi non
/// si possono stringere.
pub fn acquire(dir: &Path) -> Result<DataDirLease, String> {
    crate::schema::create_private_dir(dir).map_err(|e| format!("data dir: {e}"))?;
    let meta = fs::symlink_metadata(dir).map_err(|e| format!("data dir: {e}"))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("data dir: not a plain directory (symlinks are refused)".to_string());
    }
    let lock_path = dir.join(LOCK_FILE);
    if let Ok(meta) = fs::symlink_metadata(&lock_path) {
        if !meta.is_file() {
            return Err("data dir lock: not a regular file".to_string());
        }
    }
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(&lock_path)
        .map_err(|e| format!("data dir lock: {e}"))?;
    match file.try_lock() {
        Ok(()) => {}
        Err(fs::TryLockError::WouldBlock) => {
            return Err(format!(
                "data dir {} is in use by another fub-services process",
                dir.display()
            ));
        }
        Err(fs::TryLockError::Error(e)) => return Err(format!("data dir lock: {e}")),
    }
    #[cfg(unix)]
    confine(dir)?;
    Ok(DataDirLease {
        _file: file,
        dir: dir.to_path_buf(),
    })
}

/// L'utente effettivo del processo, letto dal proprietario di un file appena
/// creato dentro la cartella (niente `libc`: la sola fonte è il filesystem
/// che conta).
#[cfg(unix)]
fn process_uid(dir: &Path) -> Result<u32, String> {
    use std::os::unix::fs::MetadataExt;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let probe = dir.join(format!(".owner-probe.{}.{nanos}", std::process::id()));
    let file = crate::schema::create_private(&probe).map_err(|e| format!("data dir probe: {e}"))?;
    let uid = file.metadata().map(|m| m.uid());
    drop(file);
    let _ = fs::remove_file(&probe);
    uid.map_err(|e| format!("data dir probe: {e}"))
}

#[cfg(unix)]
fn confine(dir: &Path) -> Result<(), String> {
    let uid = process_uid(dir)?;
    confine_entry(dir, uid, true)
}

/// Stringe una voce e, se è una cartella, tutto ciò che contiene. Non segue
/// mai un collegamento: lo rifiuta.
#[cfg(unix)]
fn confine_entry(path: &Path, uid: u32, is_root: bool) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "data dir: {} is a symlink (refused)",
            path.display()
        ));
    }
    if meta.uid() != uid {
        return Err(format!(
            "data dir: {} belongs to another user",
            path.display()
        ));
    }
    let mode = meta.permissions().mode() & 0o7777;
    let wanted = if meta.is_dir() { 0o700 } else { mode & 0o700 };
    if mode & 0o7077 != 0 {
        fs::set_permissions(path, fs::Permissions::from_mode(wanted))
            .map_err(|e| format!("data dir: cannot restrict {}: {e}", path.display()))?;
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| format!("{}: {e}", path.display()))? {
            let entry = entry.map_err(|e| format!("{}: {e}", path.display()))?;
            confine_entry(&entry.path(), uid, false)?;
        }
    } else if is_root {
        return Err("data dir: not a directory".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("fub-services-lease-{tag}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn a_second_lease_on_the_same_dir_is_refused_until_the_first_is_dropped() {
        let dir = temp_dir("twice");
        let first = acquire(&dir).unwrap();
        let second = acquire(&dir);
        assert!(
            second.as_ref().is_err_and(|e| e.contains("in use")),
            "{second:?}"
        );
        drop(first);
        acquire(&dir).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_wide_data_dir_and_its_registries_are_restricted_to_the_owner() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("wide");
        fs::create_dir_all(dir.join("sync")).unwrap();
        fs::write(dir.join("accounts.json"), b"{}").unwrap();
        fs::write(dir.join("sync/shares.json"), b"{}").unwrap();
        for (path, mode) in [
            (dir.clone(), 0o755),
            (dir.join("sync"), 0o777),
            (dir.join("accounts.json"), 0o644),
            (dir.join("sync/shares.json"), 0o666),
        ] {
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
        }
        let _lease = acquire(&dir).unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&dir.join("sync")), 0o700);
        assert_eq!(mode(&dir.join("accounts.json")), 0o600);
        assert_eq!(mode(&dir.join("sync/shares.json")), 0o600);
        assert_eq!(mode(&dir.join(LOCK_FILE)), 0o600);
        drop(_lease);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_or_as_the_data_dir_fails_the_start() {
        let dir = temp_dir("link");
        fs::create_dir_all(&dir).unwrap();
        let elsewhere = temp_dir("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(elsewhere.join("accounts.json"), b"{}").unwrap();
        std::os::unix::fs::symlink(elsewhere.join("accounts.json"), dir.join("accounts.json"))
            .unwrap();
        assert!(acquire(&dir).is_err_and(|e| e.contains("symlink")));
        let linked = temp_dir("linked");
        std::os::unix::fs::symlink(&elsewhere, &linked).unwrap();
        assert!(acquire(&linked).is_err());
        let _ = fs::remove_file(&linked);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&elsewhere);
    }

    #[cfg(unix)]
    #[test]
    fn a_registry_written_under_a_wide_umask_is_still_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("umask");
        let path = dir.join("nested/accounts.json");
        crate::schema::atomic_write(&path, b"{}").unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(&dir.join("nested")), 0o700);
        let leftovers: Vec<_> = fs::read_dir(dir.join("nested"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
