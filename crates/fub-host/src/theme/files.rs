//! Le aperture sicure dentro la cartella dei temi: la radice come capability,
//! niente link simbolici, la lettura limitata e l'id di un tema.

use super::*;

/// Capability opened for the installed-theme root.
///
/// `path` is only the diagnostic/canonical name. Filesystem operations that
/// remove or enumerate entries use `dir`, so replacing `config/themes` after
/// this handle is opened cannot redirect those operations to another tree.
pub(super) struct ThemesRoot {
    pub(super) path: Utf8PathBuf,
    pub(super) dir: cap_std::fs::Dir,
    #[cfg(unix)]
    identity: std::fs::Metadata,
}

pub(super) fn open_themes_root(
    config_dir: &Utf8Path,
    id: &str,
) -> Result<Option<ThemesRoot>, ThemeError> {
    let themes = crate::config::themes_dir(config_dir);
    let metadata = match std::fs::symlink_metadata(&themes) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(ThemeError::Io(format!("{themes}: {error}"))),
    };
    if metadata.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: themes.to_string(),
        });
    }
    if !metadata.is_dir() {
        return Err(ThemeError::Malformed(format!(
            "themes root `{themes}` is not a directory"
        )));
    }

    let parent = themes.parent().unwrap_or(&themes);
    let canonical_parent = Utf8PathBuf::from_path_buf(
        parent
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{parent}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    let canonical = Utf8PathBuf::from_path_buf(
        themes
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{themes}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if !canonical.starts_with(&canonical_parent) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }

    // Open the root without following its final symlink/reparse point. The
    // second metadata/canonical check closes the ordinary path-based race
    // around this open; the capability remains the authority afterwards.
    let (dir, identity) = match open_directory_nofollow(&themes) {
        Ok(opened) => opened,
        Err(error) => {
            if std::fs::symlink_metadata(&themes)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
            {
                return Err(ThemeError::Traversal {
                    id: id.to_string(),
                    path: themes.to_string(),
                });
            }
            return Err(ThemeError::Io(format!("{themes}: {error}")));
        }
    };
    let after = std::fs::symlink_metadata(&themes)
        .map_err(|error| ThemeError::Io(format!("{themes}: {error}")))?;
    if after.file_type().is_symlink() || !after.is_dir() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: themes.to_string(),
        });
    }
    let current = Utf8PathBuf::from_path_buf(
        themes
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{themes}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if current != canonical {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: current.to_string(),
        });
    }
    #[cfg(unix)]
    {
        let canonical_metadata = std::fs::metadata(&canonical)
            .map_err(|error| ThemeError::Io(format!("{canonical}: {error}")))?;
        if !same_file(&identity, &canonical_metadata) {
            return Err(ThemeError::Traversal {
                id: id.to_string(),
                path: themes.to_string(),
            });
        }
    }
    #[cfg(not(unix))]
    let _ = identity;
    Ok(Some(ThemesRoot {
        path: canonical,
        dir,
        #[cfg(unix)]
        identity,
    }))
}

pub(super) fn verify_themes_root(root: &ThemesRoot, id: &str) -> Result<(), ThemeError> {
    let metadata = std::fs::symlink_metadata(&root.path)
        .map_err(|error| ThemeError::Io(format!("{}: {error}", root.path)))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: root.path.to_string(),
        });
    }
    let canonical = Utf8PathBuf::from_path_buf(
        root.path
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{}: {error}", root.path)))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if canonical != root.path {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }
    #[cfg(unix)]
    {
        let canonical_metadata = std::fs::metadata(&canonical)
            .map_err(|error| ThemeError::Io(format!("{canonical}: {error}")))?;
        if !same_file(&root.identity, &canonical_metadata) {
            return Err(ThemeError::Traversal {
                id: id.to_string(),
                path: root.path.to_string(),
            });
        }
    }
    Ok(())
}

pub(super) fn canonical_theme_root(dir: &Utf8Path, id: &str) -> Result<Utf8PathBuf, ThemeError> {
    let before = std::fs::symlink_metadata(dir)
        .map_err(|error| ThemeError::Io(format!("{dir}: {error}")))?;
    if before.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: dir.to_string(),
        });
    }
    if !before.is_dir() {
        return Err(ThemeError::Malformed(format!(
            "theme root `{dir}` is not a directory"
        )));
    }

    let parent = dir.parent().unwrap_or(dir);
    let canonical_parent = Utf8PathBuf::from_path_buf(
        parent
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{parent}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    let canonical = Utf8PathBuf::from_path_buf(
        dir.canonicalize()
            .map_err(|error| ThemeError::Io(format!("{dir}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if !canonical.starts_with(&canonical_parent) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }
    let after = std::fs::symlink_metadata(dir)
        .map_err(|error| ThemeError::Io(format!("{dir}: {error}")))?;
    if after.file_type().is_symlink() || !after.is_dir() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: dir.to_string(),
        });
    }
    let canonical_metadata = std::fs::metadata(&canonical)
        .map_err(|error| ThemeError::Io(format!("{canonical}: {error}")))?;
    if !same_file(&before, &canonical_metadata) || !same_file(&after, &canonical_metadata) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: dir.to_string(),
        });
    }
    Ok(canonical)
}

fn open_directory_nofollow(path: &Utf8Path) -> io::Result<(cap_std::fs::Dir, std::fs::Metadata)> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let flags = rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::DIRECTORY;
        options.custom_flags(flags.bits() as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    let identity = file.metadata()?;
    Ok((cap_std::fs::Dir::from_std_file(file), identity))
}

fn open_nofollow(path: &Utf8Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let flags = (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits();
        options.custom_flags(flags as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}
pub(super) fn create_nofollow(path: &Utf8Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

pub(super) fn open_regular(
    path: &Utf8Path,
    root: &Utf8Path,
    id: &str,
    limit: u64,
    required: bool,
) -> Result<Option<File>, ThemeError> {
    let before = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound && !required => return Ok(None),
        Err(error) => return Err(ThemeError::Io(format!("{path}: {error}"))),
    };
    if before.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: path.to_string(),
        });
    }
    if !before.is_file() {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` is not a regular file"
        )));
    }
    if before.len() > limit {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` exceeds {limit} bytes"
        )));
    }

    let file = match open_nofollow(path) {
        Ok(file) => file,
        Err(error) => {
            if let Ok(metadata) = std::fs::symlink_metadata(path) {
                if metadata.file_type().is_symlink() {
                    return Err(ThemeError::Traversal {
                        id: id.to_string(),
                        path: path.to_string(),
                    });
                }
            }
            return Err(ThemeError::Io(format!("{path}: {error}")));
        }
    };
    let descriptor_metadata = file
        .metadata()
        .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?;
    if !descriptor_metadata.is_file() {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` is not a regular file"
        )));
    }
    if descriptor_metadata.len() > limit {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` exceeds {limit} bytes"
        )));
    }
    let canonical = Utf8PathBuf::from_path_buf(
        path.canonicalize()
            .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if !canonical.starts_with(root) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }
    let canonical_metadata = std::fs::metadata(&canonical)
        .map_err(|error| ThemeError::Io(format!("{canonical}: {error}")))?;
    let after = std::fs::symlink_metadata(path)
        .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?;
    if after.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: path.to_string(),
        });
    }
    if !after.is_file() {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` is not a regular file"
        )));
    }
    if !same_file(&descriptor_metadata, &canonical_metadata)
        || !same_file(&descriptor_metadata, &after)
    {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: path.to_string(),
        });
    }
    Ok(Some(file))
}

pub(super) fn read_theme_bytes(
    path: &Utf8Path,
    root: &Utf8Path,
    id: &str,
    limit: u64,
    required: bool,
) -> Result<Option<Vec<u8>>, ThemeError> {
    let Some(file) = open_regular(path, root, id, limit, required)? else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?;
    if bytes.len() as u64 > limit {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` exceeds {limit} bytes"
        )));
    }
    Ok(Some(bytes))
}

pub(super) fn read_theme_text(
    path: &Utf8Path,
    root: &Utf8Path,
    id: &str,
    limit: u64,
    required: bool,
) -> Result<Option<String>, ThemeError> {
    let Some(bytes) = read_theme_bytes(path, root, id, limit, required)? else {
        return Ok(None);
    };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|error| ThemeError::Malformed(format!("{path}: invalid UTF-8: {error}")))
}

#[cfg(unix)]
fn same_file(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_file(_left: &std::fs::Metadata, _right: &std::fs::Metadata) -> bool {
    true
}

/// Un id di tema è sicuro come **componente di cartella**: un solo pezzo, non
/// vuoto, senza `.`/`..`, senza slash, senza iniziali di nascosto. È la forma
/// minima dell'identità di un tema installato — `config/themes/<id>/` — e la
/// strada che installa e disinstalla si fidano che non possa uscire dalla
/// cartella dei temi.
pub(super) fn check_id(id: &str) -> Result<(), ThemeError> {
    let valid = !id.is_empty()
        && id != "."
        && id != ".."
        && !id.contains('/')
        && !id.contains('\\')
        && !id.starts_with('.');
    if valid {
        Ok(())
    } else {
        Err(ThemeError::InvalidId(id.to_string()))
    }
}
