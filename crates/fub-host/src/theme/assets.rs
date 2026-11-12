//! Gli asset di un tema: l'inventario di quelli citati e i limiti di numero
//! e di misura.

use super::*;

pub(super) fn asset_inventory(
    root: &Utf8Path,
    namespace: &str,
    needed: &std::collections::BTreeSet<String>,
) -> Result<std::collections::BTreeMap<String, Vec<u8>>, ThemeError> {
    let mut assets = std::collections::BTreeMap::new();
    collect_assets(root, root, namespace, needed, &mut assets)?;
    Ok(assets)
}

fn collect_assets(
    root: &Utf8Path,
    dir: &Utf8Path,
    namespace: &str,
    needed: &std::collections::BTreeSet<String>,
    assets: &mut std::collections::BTreeMap<String, Vec<u8>>,
) -> Result<(), ThemeError> {
    let entries =
        std::fs::read_dir(dir).map_err(|error| ThemeError::Io(format!("{}: {error}", dir)))?;
    for entry in entries {
        let entry = entry.map_err(|error| ThemeError::Io(format!("{}: {error}", dir)))?;
        let file_type = entry
            .file_type()
            .map_err(|error| ThemeError::Io(format!("{}: {error}", dir)))?;
        if file_type.is_symlink() {
            return Err(ThemeError::Traversal {
                id: root.file_name().unwrap_or_default().to_string(),
                path: entry.path().to_string_lossy().into_owned(),
            });
        }
        if !file_type.is_dir() && !file_type.is_file() {
            return Err(ThemeError::Malformed(format!(
                "theme asset `{}` is not a regular file",
                entry.path().to_string_lossy()
            )));
        }
        let path = Utf8PathBuf::from_path_buf(entry.path())
            .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
        if file_type.is_dir() {
            collect_assets(root, &path, namespace, needed, assets)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .expect("asset path stays below its theme root");
        let relative = relative.to_string().replace('\\', "/");
        if matches!(
            relative.as_str(),
            "manifest.json" | "skin.css" | "sheet-dark.css" | "sheet-light.css"
        ) {
            continue;
        }
        let name = format!("{namespace}{relative}");
        if !needed.contains(&name) {
            continue;
        }
        let bytes = read_theme_bytes(
            &path,
            root,
            root.file_name().unwrap_or_default(),
            MAX_THEME_ASSET_BYTES,
            true,
        )?
        .expect("required asset was checked by read_theme_bytes");
        assets.insert(name, bytes);
    }
    Ok(())
}
const MAX_THEME_ASSETS: u64 = 1024;
pub(super) const MAX_THEME_ASSET_BYTES: u64 = 64 * 1024 * 1024;
const MAX_THEME_ASSET_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

/// Controlla i limiti degli asset e dice quanti ne porta davvero il tema.
///
/// Il conto restituito lascia fuori ciò che scrive l'host e non l'autore: il
/// puntatore della versione installata ([`POINTER_FILE`]) e le versioni
/// conservate (`.generations/`). I limiti restano contati come prima.
pub(super) fn validate_asset_limits(root: &Utf8Path, id: &str) -> Result<u64, ThemeError> {
    let mut count = 0_u64;
    let mut total = 0_u64;
    let mut authored = 0_u64;
    validate_asset_limits_in(root, root, id, &mut count, &mut total, &mut authored)?;
    Ok(authored)
}

fn validate_asset_limits_in(
    root: &Utf8Path,
    dir: &Utf8Path,
    id: &str,
    count: &mut u64,
    total: &mut u64,
    authored: &mut u64,
) -> Result<(), ThemeError> {
    let entries =
        std::fs::read_dir(dir).map_err(|error| ThemeError::Io(format!("{}: {error}", dir)))?;
    for entry in entries {
        let entry = entry.map_err(|error| ThemeError::Io(format!("{}: {error}", dir)))?;
        let metadata = std::fs::symlink_metadata(entry.path())
            .map_err(|error| ThemeError::Io(format!("{}: {error}", dir)))?;
        if metadata.file_type().is_symlink() {
            return Err(ThemeError::Traversal {
                id: id.to_string(),
                path: entry.path().to_string_lossy().into_owned(),
            });
        }
        if !metadata.is_dir() && !metadata.is_file() {
            return Err(ThemeError::Malformed(format!(
                "theme asset `{}` is not a regular file",
                entry.path().to_string_lossy()
            )));
        }
        let path = Utf8PathBuf::from_path_buf(entry.path())
            .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
        if metadata.is_dir() {
            validate_asset_limits_in(root, &path, id, count, total, authored)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .expect("asset path stays below its theme root")
            .to_string()
            .replace('\\', "/");
        if matches!(
            relative.as_str(),
            "manifest.json" | "skin.css" | "sheet-dark.css" | "sheet-light.css"
        ) {
            continue;
        }
        if relative != POINTER_FILE && !relative.starts_with(".generations/") {
            *authored += 1;
        }
        *count += 1;
        if *count > MAX_THEME_ASSETS {
            return Err(ThemeError::Malformed(format!(
                "theme `{id}` declares more than {MAX_THEME_ASSETS} assets"
            )));
        }
        let size = metadata.len();
        if size > MAX_THEME_ASSET_BYTES {
            return Err(ThemeError::Malformed(format!(
                "asset `{relative}` exceeds {MAX_THEME_ASSET_BYTES} bytes"
            )));
        }
        *total = total.saturating_add(size);
        if *total > MAX_THEME_ASSET_TOTAL_BYTES {
            return Err(ThemeError::Malformed(format!(
                "theme assets exceed {MAX_THEME_ASSET_TOTAL_BYTES} bytes"
            )));
        }
    }
    Ok(())
}
