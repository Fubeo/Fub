//! Il disco: lock, raccolta dell'albero autorevole, letture e scritture di file
//! regolari, permessi privati, sync e path canonici, identificatori di transazione.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use camino::{Utf8Path, Utf8PathBuf};

use super::recovery::RecoveryRecord;
use super::{validate_relative_path, SnapshotError, LOCK_SUFFIX, TRANSACTION_SEQUENCE};

pub(super) fn acquire_lock(root: &Utf8Path) -> Result<File, SnapshotError> {
    let parent = root
        .parent()
        .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
    let name = root
        .file_name()
        .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
    let path = parent.join(format!(".{name}{LOCK_SUFFIX}"));
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(path.as_std_path())
        .map_err(|source| io_error("open snapshot lock", &path, source))?;
    file.lock()
        .map_err(|source| io_error("acquire snapshot lock", &path, source))?;
    Ok(file)
}

pub(super) fn collect_authoritative(
    root: &Utf8Path,
    directory: &Utf8Path,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), SnapshotError> {
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(directory.as_std_path())
        .map_err(|source| io_error("enumerate vault", directory, source))?;
    for item in read_dir {
        let item = item.map_err(|source| io_error("read vault entry", directory, source))?;
        entries.push(item.path());
    }
    entries.sort();
    for path in entries {
        let metadata = symlink_metadata_path(&path)?;
        let relative = path
            .strip_prefix(root.as_std_path())
            .map_err(|_| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        let relative = normalize_path(relative)?;
        if metadata.is_dir() {
            if is_derived_directory(root, &relative)? {
                continue;
            }
            let child = Utf8PathBuf::from_path_buf(path)
                .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
            collect_authoritative(root, &child, files)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(SnapshotError::UnsupportedFile(relative));
        }
        if is_derived_file(&relative) {
            continue;
        }
        let child = Utf8PathBuf::from_path_buf(path)
            .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        let bytes = read_regular_file(&child)?;
        files.insert(relative, bytes);
    }
    Ok(())
}

pub(super) fn validate_payload_tree(
    directory: &Utf8Path,
    relative: &str,
    expected: &BTreeSet<&str>,
) -> Result<(), SnapshotError> {
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(directory.as_std_path())
        .map_err(|source| io_error("enumerate snapshot payload", directory, source))?;
    for item in read_dir {
        let item = item.map_err(|source| io_error("read snapshot payload", directory, source))?;
        entries.push(item.path());
    }
    entries.sort();
    for path in entries {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        let child_relative = if relative.is_empty() {
            name.to_owned()
        } else {
            format!("{relative}/{name}")
        };
        validate_relative_path(&child_relative)?;
        let metadata = symlink_metadata_path(&path)?;
        if metadata.is_dir() {
            let child = Utf8PathBuf::from_path_buf(path)
                .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
            validate_payload_tree(&child, &child_relative, expected)?;
        } else if metadata.is_file() {
            if !expected.contains(child_relative.as_str()) {
                return Err(SnapshotError::UnexpectedEntry(child_relative));
            }
        } else {
            return Err(SnapshotError::UnsupportedFile(child_relative));
        }
    }
    Ok(())
}

pub(super) fn normalize_path(path: &Path) -> Result<String, SnapshotError> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(component) = component else {
            return Err(SnapshotError::InvalidPath(
                path.to_string_lossy().into_owned(),
            ));
        };
        let component = component
            .to_str()
            .ok_or_else(|| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        if component.is_empty() {
            return Err(SnapshotError::InvalidPath(
                path.to_string_lossy().into_owned(),
            ));
        }
        parts.push(component);
    }
    if parts.is_empty() {
        return Err(SnapshotError::InvalidPath(
            path.to_string_lossy().into_owned(),
        ));
    }
    Ok(parts.join("/"))
}

fn is_derived_directory(root: &Utf8Path, path: &str) -> Result<bool, SnapshotError> {
    let Some(rest) = path.strip_prefix(".fub/data/plugins/") else {
        return Ok(false);
    };
    let Some(plugin) = rest.split('/').next().filter(|plugin| !plugin.is_empty()) else {
        return Ok(false);
    };
    let marker = root
        .join(".fub/data/plugins")
        .join(plugin)
        .join(crate::workspace::PLUGIN_CACHE_MARK);
    match symlink_metadata(&marker) {
        Ok(metadata) => Ok(metadata.is_file()),
        Err(SnapshotError::Io { source, .. }) if source.kind() == io::ErrorKind::NotFound => {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

fn is_derived_file(path: &str) -> bool {
    path == ".fub/data/entries.json"
}

pub(super) fn create_private_directory(path: &Utf8Path) -> io::Result<()> {
    fs::create_dir(path.as_std_path())?;
    set_private_directory_permissions(path)
}

pub(super) fn create_private_directory_all(path: &Utf8Path) -> io::Result<()> {
    fs::create_dir_all(path.as_std_path())?;
    set_private_directory_permissions(path)
}

fn set_private_directory_permissions(path: &Utf8Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path.as_std_path(), fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

fn set_private_file_permissions(file: &File, path: &Utf8Path) -> io::Result<()> {
    let _ = path;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
    }
    #[cfg(not(unix))]
    {
        let _ = (file, path);
        Ok(())
    }
}

pub(super) fn read_regular_file(path: &Utf8Path) -> Result<Vec<u8>, SnapshotError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options
        .open(path.as_std_path())
        .map_err(|source| io_error("open snapshot payload", path, source))?;
    if !file
        .metadata()
        .map_err(|source| io_error("stat snapshot payload handle", path, source))?
        .is_file()
    {
        return Err(SnapshotError::UnsupportedFile(path.to_string()));
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|source| io_error("read snapshot payload", path, source))?;
    Ok(bytes)
}

pub(super) fn write_regular_file(path: &Utf8Path, bytes: &[u8]) -> Result<(), SnapshotError> {
    if let Ok(metadata) = fs::symlink_metadata(path.as_std_path()) {
        if !metadata.is_file() {
            return Err(SnapshotError::UnsupportedFile(path.to_string()));
        }
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(path.as_std_path())
        .map_err(|source| io_error("create snapshot payload", path, source))?;
    if let Err(source) = set_private_file_permissions(&file, path)
        .and_then(|_| file.write_all(bytes))
        .and_then(|_| file.sync_all())
    {
        let _ = fs::remove_file(path.as_std_path());
        return Err(io_error("write snapshot payload", path, source));
    }
    Ok(())
}

pub(super) fn persist_record(
    path: &Utf8Path,
    record: &RecoveryRecord,
) -> Result<(), SnapshotError> {
    let bytes = serde_json::to_vec(record)
        .map_err(|error| SnapshotError::Serialization(error.to_string()))?;
    let parent = path
        .parent()
        .ok_or_else(|| SnapshotError::InvalidArtifact(path.to_owned()))?;
    let name = path
        .file_name()
        .ok_or_else(|| SnapshotError::InvalidArtifact(path.to_owned()))?;
    let temporary = parent.join(format!(".{name}.tmp-{}", transaction_id()));
    if let Err(error) = write_regular_file(&temporary, &bytes) {
        let _ = remove_file_if_exists(&temporary);
        return Err(error);
    }
    if let Err(source) = crate::storage::atomic_replace(&temporary, path) {
        let _ = remove_file_if_exists(&temporary);
        return Err(io_error("publish snapshot recovery record", path, source));
    }
    sync_parent(parent)?;
    Ok(())
}

pub(super) fn remove_file_if_exists(path: &Utf8Path) -> Result<(), SnapshotError> {
    match fs::remove_file(path.as_std_path()) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_error("remove snapshot recovery record", path, source)),
    }
}

pub(super) fn remove_dir_if_exists(path: &Utf8Path) -> Result<(), SnapshotError> {
    match fs::remove_dir_all(path.as_std_path()) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_error(
            "remove snapshot transaction directory",
            path,
            source,
        )),
    }
}

pub(super) fn sync_tree(path: &Utf8Path) -> Result<(), SnapshotError> {
    let metadata = symlink_metadata(path)?;
    if !metadata.is_dir() {
        return Err(SnapshotError::InvalidArtifact(path.to_owned()));
    }
    set_private_directory_permissions(path)
        .map_err(|source| io_error("set private snapshot directory", path, source))?;
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(path.as_std_path())
        .map_err(|source| io_error("enumerate directory for sync", path, source))?;
    for item in read_dir {
        let item = item.map_err(|source| io_error("read directory for sync", path, source))?;
        entries.push(item.path());
    }
    entries.sort();
    for child in entries {
        let child = Utf8PathBuf::from_path_buf(child)
            .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        let metadata = symlink_metadata(&child)?;
        if metadata.is_dir() {
            sync_tree(&child)?;
        } else if !metadata.is_file() {
            return Err(SnapshotError::UnsupportedFile(child.to_string()));
        }
    }
    sync_dir(path)
}

fn sync_dir(path: &Utf8Path) -> Result<(), SnapshotError> {
    #[cfg(windows)]
    {
        // Windows does not expose a durable directory handle through
        // `File::open`; directory moves retain the ordinary `fs::rename`
        // durability guarantee. Only record/file replacement uses the
        // write-through storage primitive. This is the platform limitation
        // recorded by decision 0202; preserve real metadata errors, but do
        // not turn unsupported directory fsync into a false failure.
        let metadata = symlink_metadata(path)?;
        if !metadata.is_dir() {
            return Err(SnapshotError::InvalidArtifact(path.to_owned()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let file = File::open(path.as_std_path())
            .map_err(|source| io_error("open directory for sync", path, source))?;
        file.sync_all()
            .map_err(|source| io_error("sync directory", path, source))
    }
}

pub(super) fn sync_parent(path: &Utf8Path) -> Result<(), SnapshotError> {
    sync_dir(path)
}

pub(super) fn symlink_metadata(path: &Utf8Path) -> Result<std::fs::Metadata, SnapshotError> {
    symlink_metadata_path(path.as_std_path())
}

fn symlink_metadata_path(path: &Path) -> Result<std::fs::Metadata, SnapshotError> {
    fs::symlink_metadata(path).map_err(|source| SnapshotError::Io {
        operation: "stat snapshot path".into(),
        path: path.to_string_lossy().into_owned(),
        source,
    })
}

fn absolute_utf8(path: &Utf8Path) -> Result<Utf8PathBuf, SnapshotError> {
    let absolute = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|source| io_error("resolve snapshot root", path, source))
            .and_then(|cwd| {
                Utf8PathBuf::from_path_buf(cwd)
                    .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))
            })?
            .join(path)
    };
    Ok(absolute)
}

fn canonicalize_utf8(path: &Utf8Path, operation: &str) -> Result<Utf8PathBuf, SnapshotError> {
    let canonical = path
        .canonicalize()
        .map_err(|source| io_error(operation, path, source))?;
    Utf8PathBuf::from_path_buf(canonical)
        .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))
}

pub(super) fn canonical_apply_root(root: &Utf8Path) -> Result<Utf8PathBuf, SnapshotError> {
    let metadata = symlink_metadata(root)?;
    if !metadata.is_dir() {
        return Err(SnapshotError::InvalidRoot(root.to_owned()));
    }
    let absolute = absolute_utf8(root)?;
    canonicalize_utf8(&absolute, "canonicalize snapshot root")
}

pub(super) fn recovery_root(root: &Utf8Path) -> Result<Utf8PathBuf, SnapshotError> {
    let absolute = absolute_utf8(root)?;
    match fs::metadata(absolute.as_std_path()) {
        Ok(metadata) if metadata.is_dir() => {
            canonicalize_utf8(&absolute, "canonicalize recovery root")
        }
        Ok(_) => Err(SnapshotError::InvalidRoot(root.to_owned())),
        Err(source) if source.kind() == io::ErrorKind::NotFound => {
            let parent = absolute
                .parent()
                .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
            let name = absolute
                .file_name()
                .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
            Ok(canonicalize_utf8(parent, "canonicalize recovery parent")?.join(name))
        }
        Err(source) => Err(io_error("stat recovery root", &absolute, source)),
    }
}
pub(super) fn valid_transaction_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub(super) fn transaction_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = TRANSACTION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{now:x}-{}-{sequence:x}", std::process::id())
}

pub(super) fn io_error(operation: &str, path: &Utf8Path, source: io::Error) -> SnapshotError {
    SnapshotError::Io {
        operation: operation.into(),
        path: path.to_string(),
        source,
    }
}
