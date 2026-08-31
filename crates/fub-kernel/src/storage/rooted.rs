use std::io::{self, Write as _};
use std::path::Path;

use camino::{Utf8Path, Utf8PathBuf};
use cap_std::fs::{Dir, Metadata, OpenOptions};
use cap_std::{ambient_authority, AmbientAuthority};

use super::{
    same_parent_resolution_name, temp_name, ConditionalWrite, DirEntry, EntryKind, FileIdentity,
    Merge, Stat, VaultStorage,
};

/// Filesystem di produzione ancorato alla directory aperta al mount.
///
/// `root` resta soltanto il namespace logico usato dal kernel. Le operazioni
/// reali non lo riaprono mai: lo trasformano in un path relativo e passano da
/// `Dir`, quindi sostituire il nome ambientale della root dopo il mount non può
/// reindirizzare letture o scritture fuori dal capability originario.
pub struct RootedFsStorage {
    root: Utf8PathBuf,
    dir: Dir,
}

impl std::fmt::Debug for RootedFsStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RootedFsStorage")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl RootedFsStorage {
    pub fn open(root: &Utf8Path) -> io::Result<Self> {
        Self::open_with_authority(root, ambient_authority())
    }

    fn open_with_authority(root: &Utf8Path, authority: AmbientAuthority) -> io::Result<Self> {
        let dir = Dir::open_ambient_dir(root.as_std_path(), authority)?;
        let storage = Self {
            root: root.to_owned(),
            dir,
        };
        Ok(storage)
    }

    /// Verifica il capability *dopo* averlo aperto: directory e scrivibilità
    /// appartengono all'handle, non al nome ambientale che potrebbe cambiare.
    fn verify_mount_handle(&self) -> io::Result<()> {
        let metadata = self.dir.dir_metadata()?;
        if !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                format!("la radice {} non è una cartella", self.root),
            ));
        }
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        for _ in 0..32 {
            let probe = format!(
                ".fub-mount-probe-{}-{}",
                std::process::id(),
                super::TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            );
            match self.dir.open_with(&probe, &options) {
                Ok(file) => {
                    drop(file);
                    return self.dir.remove_file(&probe);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        format!("non si ha permesso di scrivere su {}", self.root),
                    ));
                }
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "non si trova un nome libero per la sonda di mount",
        ))
    }

    fn rel<'a>(&self, path: &'a Utf8Path) -> io::Result<&'a Path> {
        let relative = path.strip_prefix(&self.root).map_err(|_| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("{path} è fuori dalla root montata {}", self.root),
            )
        })?;
        if relative.as_str().is_empty() {
            Ok(Path::new("."))
        } else {
            Ok(relative.as_std_path())
        }
    }

    fn rel_buf(&self, path: &Utf8Path) -> io::Result<std::path::PathBuf> {
        Ok(self.rel(path)?.to_owned())
    }

    fn identity(&self, path: &Utf8Path) -> io::Result<FileIdentity> {
        #[cfg(unix)]
        {
            use cap_std::fs::MetadataExt;
            let metadata = self.dir.metadata(self.rel(path)?)?;
            Ok(FileIdentity {
                volume: metadata.dev(),
                file: metadata.ino(),
            })
        }
        #[cfg(windows)]
        {
            use std::mem::MaybeUninit;
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::{
                GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            };
            let file = self.dir.open(self.rel(path)?)?;
            let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
            // SAFETY: l'handle resta vivo e il puntatore indica storage valido.
            let ok =
                unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, info.as_mut_ptr()) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: un ritorno non-zero inizializza la struttura.
            let info = unsafe { info.assume_init() };
            Ok(FileIdentity {
                volume: info.dwVolumeSerialNumber as u64,
                file: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
            })
        }
    }

    fn create_parent(&self, path: &Utf8Path) -> io::Result<()> {
        let Some(parent) = path.parent() else {
            return Ok(());
        };
        if parent == self.root || parent.as_str().is_empty() {
            return Ok(());
        }
        let rel = self.rel(parent)?;
        self.dir.create_dir_all(rel)
    }

    fn stat_metadata(metadata: &Metadata, kind: EntryKind) -> Stat {
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|time| time.into_std().duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or(0);
        Stat {
            kind,
            size: if kind == EntryKind::File {
                metadata.len()
            } else {
                0
            },
            mtime,
        }
    }

    fn stat_following(&self, path: &Utf8Path) -> io::Result<Stat> {
        if path == self.root {
            let metadata = self.dir.dir_metadata()?;
            return Ok(Self::stat_metadata(&metadata, EntryKind::Dir));
        }
        let metadata = self.dir.metadata(self.rel(path)?)?;
        let kind = if metadata.is_dir() {
            EntryKind::Dir
        } else if metadata.is_file() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        Ok(Self::stat_metadata(&metadata, kind))
    }

    fn unsafe_write_target(&self, path: &Utf8Path) -> io::Result<bool> {
        let rel = self.rel(path)?;
        let metadata = match self.dir.symlink_metadata(rel) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        if metadata.file_type().is_symlink() {
            return Ok(true);
        }
        if metadata.is_file() && self.link_count(path, &metadata)? != 1 {
            return Ok(true);
        }
        Ok(!metadata.is_file())
    }

    fn link_count(&self, path: &Utf8Path, metadata: &Metadata) -> io::Result<u64> {
        #[cfg(unix)]
        {
            use cap_std::fs::MetadataExt;
            let _ = path;
            Ok(metadata.nlink())
        }
        #[cfg(windows)]
        {
            use std::mem::MaybeUninit;
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::{
                GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            };
            let _ = metadata;
            let file = self.dir.open(self.rel(path)?)?;
            let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
            // SAFETY: `info` è storage valido per la syscall e l'handle resta
            // vivo per l'intera chiamata.
            let ok =
                unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, info.as_mut_ptr()) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: un ritorno non-zero inizializza la struttura.
            Ok(unsafe { info.assume_init() }.nNumberOfLinks as u64)
        }
    }

    fn sync_dir(&self, dir: &Utf8Path) {
        let opened = if dir == self.root {
            self.dir.try_clone()
        } else {
            self.rel(dir).and_then(|rel| self.dir.open_dir(rel))
        };
        if let Ok(dir) = opened {
            let _ = dir.into_std_file().sync_all();
        }
    }

    fn sync_parents(&self, from: &Utf8Path, to: Option<&Utf8Path>) {
        let mut seen = Vec::with_capacity(2);
        for path in std::iter::once(from).chain(to) {
            if let Some(parent) = path.parent() {
                if !seen.iter().any(|known: &Utf8PathBuf| known == parent) {
                    seen.push(parent.to_owned());
                    self.sync_dir(parent);
                }
            }
        }
    }

    fn write_inner(&self, path: &Utf8Path, bytes: &[u8], durable: bool) -> io::Result<Stat> {
        self.create_parent(path)?;
        if self.unsafe_write_target(path)? {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("scrittura rifiutata su symlink, hardlink o target non regolare: {path}"),
            ));
        }
        let rel = self.rel_buf(path)?;
        let name = path.file_name().unwrap_or("senza-nome");
        let parent = path.parent().unwrap_or(&self.root);
        let permissions = self.dir.metadata(&rel).ok().map(|m| m.permissions());

        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let (tmp, mut file) = {
            let mut opened = None;
            for _ in 0..64 {
                let tmp_abs = parent.join(temp_name(name));
                let tmp = self.rel_buf(&tmp_abs)?;
                match self.dir.open_with(&tmp, &options) {
                    Ok(file) => {
                        opened = Some((tmp, file));
                        break;
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error),
                }
            }
            opened.ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!("non si trova un temporaneo libero accanto a {path}"),
                )
            })?
        };
        let result = (|| {
            file.write_all(bytes)?;
            if let Some(permissions) = permissions {
                file.set_permissions(permissions)?;
            }
            if durable {
                file.sync_all()?;
            }
            let metadata = file.metadata()?;
            let stat = Self::stat_metadata(&metadata, EntryKind::File);
            drop(file);
            // Ricontrolla subito prima della pubblicazione: un target diventato
            // nel frattempo symlink/hardlink/non-regolare non viene staccato.
            if self.unsafe_write_target(path)? {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("target cambiato durante la scrittura: {path}"),
                ));
            }
            self.dir.rename(&tmp, &self.dir, &rel)?;
            if durable {
                self.sync_parents(path, None);
            }
            Ok(stat)
        })();
        if result.is_err() {
            let _ = self.dir.remove_file(&tmp);
        }
        result
    }

    fn with_lock<T>(&self, path: &Utf8Path, f: impl FnOnce() -> io::Result<T>) -> io::Result<T> {
        self.create_parent(path)?;
        let parent = path.parent().unwrap_or(&self.root);
        let name = path.file_name().unwrap_or("senza-nome");
        let lock_abs = parent.join(format!(".{name}.lock"));
        let lock_rel = self.rel_buf(&lock_abs)?;
        let mut options = OpenOptions::new();
        options.write(true).create(true);
        let lock = self.dir.open_with(&lock_rel, &options)?.into_std();
        // `File::lock` è disponibile dal MSRV 1.89. Per il backend di
        // produzione il lock è parte della promessa CAS: se non si può
        // acquisire, l'operazione fallisce invece di degradare in best-effort.
        lock.lock()?;
        f()
    }

    fn current_bytes(&self, path: &Utf8Path) -> io::Result<Option<Vec<u8>>> {
        match self.read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
}

impl VaultStorage for RootedFsStorage {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
        self.dir.read(self.rel(path)?)
    }

    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.write_inner(path, bytes, true)
    }

    fn write_derived(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.write_inner(path, bytes, false)
    }

    fn write_if_unchanged(
        &self,
        path: &Utf8Path,
        expected: Option<&[u8]>,
        bytes: &[u8],
    ) -> io::Result<ConditionalWrite> {
        self.with_lock(path, || {
            let current = self.current_bytes(path)?;
            if current.as_deref() != expected {
                return Ok(ConditionalWrite::Changed);
            }
            self.write(path, bytes).map(ConditionalWrite::Written)
        })
    }

    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.with_lock(path, || {
            let current = self.current_bytes(path)?;
            if let Some(bytes) = merge(current.as_deref())? {
                self.write(path, &bytes)?;
            }
            Ok(())
        })
    }

    fn update_derived(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.with_lock(path, || {
            let current = self.current_bytes(path)?;
            if let Some(bytes) = merge(current.as_deref())? {
                self.write_derived(path, &bytes)?;
            }
            Ok(())
        })
    }

    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        self.create_parent(path)?;
        let mut options = OpenOptions::new();
        options.append(true).create(true);
        let mut file = self.dir.open_with(self.rel(path)?, &options)?;
        file.write_all(bytes)
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.create_parent(to)?;
        self.dir.rename(self.rel(from)?, &self.dir, self.rel(to)?)?;
        self.sync_parents(from, Some(to));
        Ok(())
    }

    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.create_parent(to)?;
        let from_rel = self.rel_buf(from)?;
        let to_rel = self.rel_buf(to)?;
        if let Err(error) = self.dir.hard_link(&from_rel, &self.dir, &to_rel) {
            if error.kind() == io::ErrorKind::AlreadyExists
                && same_parent_resolution_name(from, to)
                && self.same_file(from, to)
            {
                return self.rename(from, to);
            }
            return Err(error);
        }
        self.dir.remove_file(&from_rel)?;
        self.sync_parents(from, Some(to));
        Ok(())
    }

    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        self.dir.remove_file(self.rel(path)?)?;
        self.sync_parents(path, None);
        Ok(())
    }

    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
        let read = if dir == self.root {
            self.dir.entries()?
        } else {
            self.dir.read_dir(self.rel(dir)?)?
        };
        let mut out = Vec::new();
        for entry in read {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_str().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "nome non rappresentabile in UTF-8",
                )
            })?;
            let path = dir.join(name);
            let file_type = entry.file_type()?;
            let kind = if file_type.is_dir() {
                EntryKind::Dir
            } else if file_type.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            let stat = if kind == EntryKind::Other {
                Stat {
                    kind,
                    size: 0,
                    mtime: 0,
                }
            } else {
                Self::stat_metadata(&entry.metadata()?, kind)
            };
            out.push(DirEntry { path, stat });
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn stat(&self, path: &Utf8Path) -> io::Result<Stat> {
        self.stat_following(path)
    }

    fn exists(&self, path: &Utf8Path) -> bool {
        if path == self.root {
            self.dir.dir_metadata().is_ok()
        } else {
            self.rel(path).is_ok_and(|rel| self.dir.exists(rel))
        }
    }

    fn file_identity(&self, path: &Utf8Path) -> io::Result<Option<FileIdentity>> {
        self.identity(path).map(Some)
    }

    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        if a == b {
            return true;
        }
        matches!((self.identity(a), self.identity(b)), (Ok(a), Ok(b)) if a == b)
    }

    fn mount_fence(&self, root: &Utf8Path) -> io::Result<()> {
        if root != self.root {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("root inattesa: {root}; montata: {}", self.root),
            ));
        }
        self.verify_mount_handle()
    }

    fn root_validates(&self, root: &Utf8Path) -> io::Result<()> {
        self.mount_fence(root)
    }

    fn remove_dir_all(&self, dir: &Utf8Path) -> io::Result<()> {
        self.dir.remove_dir_all(self.rel(dir)?)?;
        self.sync_parents(dir, None);
        Ok(())
    }

    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        self.dir.remove_dir(self.rel(dir)?)?;
        self.sync_parents(dir, None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn cooperative_cas_has_exactly_one_winner() {
        let temp = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(temp.path().to_owned()).unwrap();
        let a = Arc::new(RootedFsStorage::open(&root).unwrap());
        let b = Arc::new(RootedFsStorage::open(&root).unwrap());
        let path = root.join("cas.txt");
        a.write(&path, b"base").unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let run = |storage: Arc<RootedFsStorage>, value: &'static [u8], barrier: Arc<Barrier>| {
            let path = path.clone();
            std::thread::spawn(move || {
                barrier.wait();
                storage
                    .write_if_unchanged(&path, Some(b"base"), value)
                    .unwrap()
            })
        };
        let left = run(Arc::clone(&a), b"left", Arc::clone(&barrier));
        let right = run(Arc::clone(&b), b"right", Arc::clone(&barrier));
        barrier.wait();
        let outcomes = [left.join().unwrap(), right.join().unwrap()];
        assert_eq!(
            outcomes
                .iter()
                .filter(|o| matches!(o, ConditionalWrite::Written(_)))
                .count(),
            1
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|o| matches!(o, ConditionalWrite::Changed))
                .count(),
            1
        );
        let final_bytes = a.read(&path).unwrap();
        assert!(final_bytes == b"left" || final_bytes == b"right");
    }

    #[cfg(unix)]
    #[test]
    fn replacing_the_ambient_root_does_not_move_the_capability() {
        use std::os::unix::fs::symlink;
        let parent = tempfile::tempdir().unwrap();
        let parent = Utf8PathBuf::from_path_buf(parent.path().to_owned()).unwrap();
        let root = parent.join("vault");
        let moved = parent.join("vault-originale");
        let outside = parent.join("fuori");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let storage = RootedFsStorage::open(&root).unwrap();
        std::fs::rename(&root, &moved).unwrap();
        symlink(&outside, &root).unwrap();

        storage.write(&root.join("prova.txt"), b"dentro").unwrap();
        assert_eq!(std::fs::read(moved.join("prova.txt")).unwrap(), b"dentro");
        assert!(!outside.join("prova.txt").exists());
    }
}
