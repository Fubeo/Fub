//! Backend del cestino di sistema. La policy e il commit appartengono al
//! `Workspace`: questo modulo non rimuove documenti dagli indici e non offre
//! una seconda implementazione del cestino interno.

use std::io;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::DocId;

use crate::storage::FsStorage;

/// Il backend sposta un file e restituisce il path effettivo. Un errore deve
/// lasciare la sorgente intatta: il chiamante lo verifica prima del fallback.
pub trait OsTrashBackend: Send + Sync {
    fn move_file_to_os_trash(&self, abs: &Utf8Path) -> io::Result<Utf8PathBuf>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FallbackReason {
    Unsupported,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrashVia {
    Os,
    InternalFallback { reason: FallbackReason },
}

/// Esito tipizzato della scelta esplicita del cestino di sistema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsTrashReceipt {
    pub id: DocId,
    pub via: TrashVia,
    pub dest: Utf8PathBuf,
    pub size: u64,
}

#[cfg(target_os = "linux")]
fn trash_base() -> io::Result<Utf8PathBuf> {
    let base = match std::env::var("XDG_DATA_HOME") {
        Ok(xdg) if !xdg.is_empty() => Utf8PathBuf::from(xdg),
        _ => {
            let home = std::env::var("HOME")
                .map_err(|_| io::Error::new(io::ErrorKind::Unsupported, "HOME non disponibile"))?;
            Utf8PathBuf::from(home).join(".local/share")
        }
    };
    if !base.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cartella dati XDG non assoluta",
        ));
    }
    Ok(base.join("Trash"))
}

#[cfg(target_os = "linux")]
fn deletion_date(secs: u64) -> String {
    let (y, m, d) = fub_abi::locale::civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

#[cfg(target_os = "linux")]
fn escaped_trash_path(path: &Utf8Path) -> String {
    use std::fmt::Write;
    let mut result = String::new();
    for byte in path.as_str().bytes() {
        if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
            result.push(char::from(byte));
        } else {
            write!(result, "%{byte:02X}").expect("scrittura in String");
        }
    }
    result
}

#[cfg(target_os = "linux")]
fn linux_move_to_trash(abs: &Utf8Path) -> io::Result<Utf8PathBuf> {
    move_to_trash_in(&trash_base()?, abs)
}

/// La mossa nel cestino freedesktop che sta in `base`.
///
/// Il file esce dal vault con [`FsStorage`], senza passare dal supporto del
/// vault, e non lascia niente accanto a dove stava: `rename_no_replace` è
/// `renameat2` con `RENAME_NOREPLACE`, che non prende lock, e dove il
/// filesystem non la offre il lock del ripiego è quello della **destinazione**,
/// nel cestino del sistema. Un backend che spostasse con [`FsStorage`] su
/// Windows lascerebbe invece `.<nome>.lock` nella cartella della nota, perché
/// lì la mossa serializza la sorgente con il protocollo stabile: là il passo
/// dentro il vault va fatto con il supporto del vault, che il suo lock lo
/// toglie al rilascio.
#[cfg(target_os = "linux")]
fn move_to_trash_in(base: &Utf8Path, abs: &Utf8Path) -> io::Result<Utf8PathBuf> {
    use crate::storage::VaultStorage as _;
    use std::io::Write;

    let files = base.join("files");
    let info = base.join("info");
    std::fs::create_dir_all(files.as_std_path())?;
    std::fs::create_dir_all(info.as_std_path())?;
    let name = abs
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "nome del file assente"))?;
    let stamp = deletion_date(crate::time::now_unix());
    let source = escaped_trash_path(abs);
    for n in 0..10_000 {
        let candidate = if n == 0 {
            name.to_owned()
        } else {
            format!("{name}.{n}")
        };
        let dest = files.join(&candidate);
        let info_path = info.join(format!("{candidate}.trashinfo"));
        let mut record = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(info_path.as_std_path())
        {
            Ok(record) => record,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let result: io::Result<Utf8PathBuf> = (|| {
            write!(
                record,
                "[Trash Info]\nPath={source}\nDeletionDate={stamp}\n"
            )?;
            record.sync_all()?;
            FsStorage.rename_no_replace(abs, &dest)?;
            Ok(dest)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(info_path.as_std_path());
        }
        match result {
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            other => return other,
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "cestino OS pieno",
    ))
}

impl OsTrashBackend for FsStorage {
    fn move_file_to_os_trash(&self, abs: &Utf8Path) -> io::Result<Utf8PathBuf> {
        #[cfg(target_os = "linux")]
        {
            linux_move_to_trash(abs)
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = abs;
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "backend OS non disponibile",
            ))
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    /// **Il cestino del sistema non lascia lock nel vault.** La mossa esce dal
    /// vault con [`FsStorage`], fuori dal supporto che il proprio lock lo
    /// toglie: qui si guarda che non ne prenda nessuno accanto alla nota. Il
    /// ramo di Windows non ha un backend (risponde `Unsupported` e il
    /// workspace ripiega sul cestino del vault): lo presidia
    /// `tests/no_lock_left_behind.rs`.
    #[test]
    fn the_system_trash_leaves_no_lock_beside_the_note() {
        let vault = tempfile::tempdir().unwrap();
        let system = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(vault.path()).unwrap();
        let base = Utf8Path::from_path(system.path()).unwrap().join("Trash");
        std::fs::create_dir(root.join("Note")).unwrap();
        std::fs::write(root.join("Note/Nota.md"), b"testo").unwrap();

        let dest = move_to_trash_in(&base, &root.join("Note/Nota.md")).unwrap();

        assert_eq!(dest, base.join("files/Nota.md"));
        assert_eq!(std::fs::read(&dest).unwrap(), b"testo");
        let left: Vec<_> = std::fs::read_dir(root.join("Note"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert!(
            left.is_empty(),
            "il cestino del sistema ha lasciato {left:?}"
        );
    }
}
