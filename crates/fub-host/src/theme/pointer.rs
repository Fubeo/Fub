//! Il puntatore alla versione installata, le generazioni conservate e
//! l'impronta dell'albero di un tema.

use super::*;

pub(super) const POINTER_FILE: &str = ".fub-current.json";

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThemePointer {
    pub(super) version: u32,
    pub(super) generation: String,
    #[serde(default)]
    pub(super) provenance: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) previous: Option<ThemeVersion>,
    #[serde(default)]
    pub(super) revoked: bool,
    #[serde(default)]
    pub(super) revocation_generation: Option<String>,
    #[serde(default)]
    pub(super) revocation_provenance: Option<serde_json::Value>,
}

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThemeVersion {
    pub(super) generation: String,
    pub(super) provenance: Option<serde_json::Value>,
}

fn check_generation(name: &str) -> Result<(), ThemeError> {
    if name.is_empty()
        || name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        Ok(())
    } else {
        Err(ThemeError::Malformed(
            "invalid theme generation pointer".into(),
        ))
    }
}

/// `root` è già canonica ([`canonical_theme_root`]): il controllo di fuga
/// confronta il path canonico del puntatore con lei.
pub(super) fn read_theme_pointer(
    root: &Utf8Path,
    id: &str,
) -> Result<Option<ThemePointer>, ThemeError> {
    let path = root.join(POINTER_FILE);
    let Some(mut file) = open_regular(&path, root, id, MAX_THEME_MANIFEST_BYTES, false)? else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| ThemeError::Io(format!("{path}: {e}")))?;
    let pointer: ThemePointer = serde_json::from_slice(&bytes)
        .map_err(|e| ThemeError::Malformed(format!("{path}: {e}")))?;
    if pointer.version != 1 {
        return Err(ThemeError::Malformed(format!(
            "unsupported theme pointer version {}",
            pointer.version
        )));
    }
    check_generation(&pointer.generation)?;
    if let Some(previous) = &pointer.previous {
        check_generation(&previous.generation)?;
    }
    Ok(Some(pointer))
}

pub(super) fn write_theme_pointer(
    root: &Utf8Path,
    pointer: &ThemePointer,
) -> Result<(), ThemeError> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| ThemeError::Io(e.to_string()))?
        .as_nanos();
    let temp = root.join(format!(".fub-current-{}-{stamp}.json", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| ThemeError::Io(format!("{temp}: {e}")))?;
        let bytes =
            serde_json::to_vec(pointer).map_err(|e| ThemeError::Malformed(e.to_string()))?;
        file.write_all(&bytes)
            .map_err(|e| ThemeError::Io(format!("{temp}: {e}")))?;
        file.sync_all()
            .map_err(|e| ThemeError::Io(format!("{temp}: {e}")))?;
        std::fs::rename(&temp, root.join(POINTER_FILE))
            .map_err(|e| ThemeError::Io(format!("{root}: {e}")))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// `root` è già canonica, come per [`read_theme_pointer`].
pub(super) fn publish_theme_pointer(
    root: &Utf8Path,
    pointer: &ThemePointer,
    expected: Option<&ThemePointer>,
) -> Result<(), ThemeError> {
    let path = root.join(POINTER_FILE);
    let id = root.file_name().unwrap_or("(theme)");
    fub_kernel::storage::update_atomic(
        &path,
        || read_theme_pointer(root, id).map_err(|e| e.to_string()),
        |current| {
            if current.as_ref() != expected {
                return Err(
                    "theme pointer changed concurrently; retry against the new generation".into(),
                );
            }
            *current = Some(pointer.clone());
            serde_json::to_vec(pointer).map_err(|e| e.to_string())
        },
    )
    .map(|_| ())
    .map_err(ThemeError::Io)
}

fn tree_paths(dir: &Utf8Path, paths: &mut Vec<Utf8PathBuf>) -> Result<(), ThemeError> {
    for entry in std::fs::read_dir(dir).map_err(|e| ThemeError::Io(format!("{dir}: {e}")))? {
        let entry = entry.map_err(|e| ThemeError::Io(format!("{dir}: {e}")))?;
        let path = Utf8PathBuf::from_path_buf(entry.path())
            .map_err(|p| ThemeError::Io(format!("non-UTF-8 theme path: {}", p.display())))?;
        let kind = entry
            .file_type()
            .map_err(|e| ThemeError::Io(format!("{path}: {e}")))?;
        if kind.is_symlink() {
            return Err(ThemeError::Traversal {
                id: "(digest)".into(),
                path: path.to_string(),
            });
        }
        if kind.is_dir() {
            tree_paths(&path, paths)?;
        } else if kind.is_file() {
            paths.push(path);
        } else {
            return Err(ThemeError::Malformed(format!("{path}: not a regular file")));
        }
    }
    Ok(())
}

/// SHA256 over a sorted, length-framed copy of every file in a theme tree.
/// The exact same function checks both source and staged bytes before publish.
pub fn theme_tree_digest(root: &Utf8Path) -> Result<String, ThemeError> {
    let id = root.file_name().unwrap_or("(digest)");
    let canonical = canonical_theme_root(root, id)?;
    validate_asset_limits(&canonical, id)?;
    let mut paths = Vec::new();
    tree_paths(&canonical, &mut paths)?;
    let mut named = paths
        .into_iter()
        .map(|path| {
            let relative = path
                .strip_prefix(&canonical)
                .expect("enumerated beneath root");
            let mut components = Vec::new();
            for component in relative.components() {
                let part = component.as_str();
                if part.contains('\\') {
                    return Err(ThemeError::Malformed(format!(
                        "{path}: ambiguous theme path"
                    )));
                }
                components.push(part.to_owned());
            }
            Ok((components.join("/"), path))
        })
        .collect::<Result<Vec<_>, ThemeError>>()?;
    named.sort_by(|left, right| left.0.cmp(&right.0));
    let mut digest = ring::digest::Context::new(&ring::digest::SHA256);
    digest.update(b"fub-theme-tree-v1\0");
    for (index, (relative, path)) in named.iter().enumerate() {
        if index > 0 && named[index - 1].0 == *relative {
            return Err(ThemeError::Malformed(format!(
                "duplicate theme path {relative}"
            )));
        }
        let mut file = open_regular(path, &canonical, id, MAX_THEME_ASSET_BYTES, true)?
            .ok_or_else(|| ThemeError::Malformed(format!("{path}: disappeared")))?;
        let size = file
            .metadata()
            .map_err(|e| ThemeError::Io(format!("{path}: {e}")))?
            .len();
        digest.update(&(relative.len() as u64).to_le_bytes());
        digest.update(relative.as_bytes());
        digest.update(&size.to_le_bytes());
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|e| ThemeError::Io(format!("{path}: {e}")))?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
    }
    let bytes = digest.finish();
    let mut hex = String::with_capacity(71);
    hex.push_str("sha256:");
    for byte in bytes.as_ref() {
        use std::fmt::Write as _;
        write!(hex, "{byte:02x}").expect("hex");
    }
    Ok(hex)
}
