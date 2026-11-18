//! Trovare e leggere i temi installati: la scoperta, l'elenco, la cartella
//! scelta e `read_theme`.

use super::*;

/// Le cartelle che sembrano temi installati dentro `config/themes/`.
///
/// Ogni sottocartella con un `manifest.json` leggibile è un tema; una
/// sottocartella **senza** manifest non è un tema — non è un errore (può
/// essere il residuo di un'installazione interrotta da un crash, che si toglie
/// a mano) — ed è saltata. Chi chiama decide cosa farne degli errori: il
/// manifest di un tema rotto **è** un tema rotto, e va detto, non nascosto.
///
/// L'ordine è lessicografico e non è un caso: l'inventario della shell non
/// deve dipendere dall'ordine di lettura del filesystem.
pub fn discover_themes(config_dir: &Utf8Path) -> (Vec<ThemeBundle>, Vec<ThemeError>) {
    let themes = crate::config::themes_dir(config_dir);
    let root_id = themes.file_name().unwrap_or("themes");
    let root = match open_themes_root(config_dir, root_id) {
        Ok(Some(root)) => root,
        // La cartella non c'è ancora: nessun tema, nessun errore.
        Ok(None) => return (Vec::new(), Vec::new()),
        Err(error) => return (Vec::new(), vec![error]),
    };

    let mut entries = Vec::new();
    let read_dir = match root.dir.entries() {
        Ok(entries) => entries,
        Err(error) => {
            return (
                Vec::new(),
                vec![ThemeError::Io(format!("{}: {error}", root.path))],
            )
        }
    };
    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                return (
                    Vec::new(),
                    vec![ThemeError::Io(format!("{}: {error}", root.path))],
                )
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                return (
                    Vec::new(),
                    vec![ThemeError::Io(format!("{}: {error}", root.path))],
                )
            }
        };
        let name = match entry.file_name().into_string() {
            Ok(name) => name,
            // Keep the previous inventory contract: names that cannot be
            // represented as UTF-8 are not addressable theme ids.
            Err(_) => continue,
        };
        entries.push((name, file_type.is_dir(), file_type.is_symlink()));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));

    let mut ok = Vec::new();
    let mut errors = Vec::new();
    for (name, is_dir, is_symlink) in entries {
        // Una cartella `.tmp-…` è una staging d'installazione, non un tema.
        if name.starts_with(STAGING_PREFIX) {
            continue;
        }
        let entry = root.path.join(&name);
        if is_symlink {
            errors.push(ThemeError::Traversal {
                id: name,
                path: entry.to_string(),
            });
            continue;
        }
        if !is_dir {
            continue;
        }
        if let Err(error) = verify_themes_root(&root, &name) {
            errors.push(error);
            continue;
        }
        let canonical = match canonical_theme_root(&entry, &name) {
            Ok(canonical) => canonical,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        if !canonical.starts_with(&root.path) {
            errors.push(ThemeError::Traversal {
                id: name,
                path: canonical.to_string(),
            });
            continue;
        }
        match installed_theme_dir(config_dir, &name).and_then(|dir| ThemeBundle::load(&dir)) {
            Ok(theme) => ok.push(theme),
            Err(error) => errors.push(error),
        }
    }
    (ok, errors)
}
/// Elenca soltanto i temi installati per cui ogni luce dichiarata ha un foglio
/// leggibile. Il catalogo legge solo i metadati dei file, mai i loro byte.
///
/// Per un tema che eredita (`extends`) il foglio di una luce può mancare (lo
/// dà la serie); se c'è, deve essere leggibile come per ogni altro tema.
pub fn list_themes(config_dir: &Utf8Path) -> Vec<ThemeInfo> {
    let (themes, _) = discover_themes(config_dir);
    themes
        .into_iter()
        .filter_map(|theme| {
            let manifest = theme.manifest.clone();
            let dir = installed_theme_dir(config_dir, &manifest.id).ok()?;
            let required = manifest.extends.is_none();
            let loadable = manifest.lights.iter().all(|light| {
                match open_regular(
                    &sheet_path(&dir, *light),
                    &dir,
                    &manifest.id,
                    MAX_THEME_CSS_BYTES,
                    required,
                ) {
                    Ok(Some(_)) => true,
                    Ok(None) => !required,
                    Err(_) => false,
                }
            });
            loadable.then_some(ThemeInfo {
                manifest,
                trust: "community",
            })
        })
        .collect()
}

fn installed_theme_dir(config_dir: &Utf8Path, id: &str) -> Result<Utf8PathBuf, ThemeError> {
    let themes_dir = crate::config::themes_dir(config_dir);
    let themes_root = open_themes_root(config_dir, id)?
        .ok_or_else(|| ThemeError::Io(format!("{}: no themes root", themes_dir)))?;
    let dir = themes_root.path.join(id);
    let canonical = canonical_theme_root(&dir, id)?;
    if !canonical.starts_with(&themes_root.path) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }
    match read_theme_pointer(&canonical, id)? {
        Some(pointer) if pointer.revoked => {
            Err(ThemeError::Malformed(format!("theme `{id}` is revoked")))
        }
        Some(pointer) => selected_theme_dir(&canonical, id, &pointer),
        None => Ok(canonical),
    }
}

pub(super) fn selected_theme_dir(
    root: &Utf8Path,
    id: &str,
    pointer: &ThemePointer,
) -> Result<Utf8PathBuf, ThemeError> {
    if pointer.generation.is_empty() {
        return Ok(root.to_owned());
    }
    let versions = root.join(".generations");
    if canonical_theme_root(&versions, id)? != versions {
        return Err(ThemeError::Traversal {
            id: id.into(),
            path: versions.to_string(),
        });
    }
    let generation = versions.join(&pointer.generation);
    canonical_theme_root(&generation, id)
}

/// Legge una luce di un tema installato senza accettare path dal chiamante.
pub fn read_theme(
    config_dir: &Utf8Path,
    id: &str,
    light: ThemeLight,
) -> Result<ThemePayload, ThemeError> {
    check_id(id)?;
    if id == SERIES_ID {
        return Err(ThemeError::InvalidId(id.to_string()));
    }
    let dir = installed_theme_dir(config_dir, id)?;
    let theme = ThemeBundle::load(&dir)?;
    if theme.manifest.id != id {
        return Err(ThemeError::Malformed(format!(
            "theme folder `{id}` contains manifest `{}`",
            theme.manifest.id
        )));
    }
    theme_payload(&dir, theme.manifest, light)
}

/// Il fascio di una luce di un tema installato, da una cartella già validata
/// ([`ThemeBundle::load`]). Le sue parti (il foglio della luce, la pelle, gli
/// asset che la shell legge da sé) sono le stesse che legge la cartella di chi
/// scrive un tema prima di installarla
/// ([`check_theme_folder`](super::check_theme_folder)): una regola sola.
pub(super) fn theme_payload(
    dir: &Utf8Path,
    manifest: ThemeManifest,
    light: ThemeLight,
) -> Result<ThemePayload, ThemeError> {
    let sheet = light_sheet(dir, &manifest, light)?;
    let skin = theme_skin(dir, &manifest.id)?;
    let mut needed =
        referenced_assets(sheet.as_deref(), skin.as_deref(), &manifest.asset_namespace);
    needed.extend(shell_assets(&manifest));
    let assets = asset_inventory(dir, &manifest.asset_namespace, &needed)?;
    Ok(ThemePayload {
        manifest,
        light,
        sheet,
        skin,
        assets,
    })
}

/// Il foglio di una luce che il tema offre. Senza `extends` il foglio di ogni
/// luce offerta è d'obbligo; con `extends` può mancare, e la shell userà
/// quello di serie.
pub(super) fn light_sheet(
    dir: &Utf8Path,
    manifest: &ThemeManifest,
    light: ThemeLight,
) -> Result<Option<String>, ThemeError> {
    let id = manifest.id.as_str();
    if !manifest.lights.contains(&light) {
        return Err(ThemeError::Malformed(format!(
            "theme `{id}` does not offer requested light"
        )));
    }
    let required = manifest.extends.is_none();
    let sheet_path = sheet_path(dir, light);
    let sheet = read_theme_text(&sheet_path, dir, id, MAX_THEME_CSS_BYTES, required)?;
    if required && sheet.is_none() {
        return Err(ThemeError::Malformed(format!(
            "missing sheet `{sheet_path}`"
        )));
    }
    Ok(sheet)
}

/// La pelle del tema (`skin.css`), facoltativa e uguale per ogni luce.
pub(super) fn theme_skin(dir: &Utf8Path, id: &str) -> Result<Option<String>, ThemeError> {
    read_theme_text(&dir.join("skin.css"), dir, id, MAX_THEME_CSS_BYTES, false)
}

/// Gli asset che la shell legge da sé e che nessun CSS nomina: i file dei
/// caratteri (la regola `@font-face` la scrive la shell) e il set di icone.
/// Viaggiano col fascio sempre.
pub(super) fn shell_assets(manifest: &ThemeManifest) -> std::collections::BTreeSet<String> {
    let namespace = manifest.asset_namespace.as_str();
    manifest
        .fonts
        .iter()
        .map(|font| format!("{namespace}{}", font.file))
        .chain(
            manifest
                .icons
                .iter()
                .map(|file| format!("{namespace}{file}")),
        )
        .collect()
}
