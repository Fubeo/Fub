//! Installare, aggiornare, revocare e disinstallare un tema, e la copia
//! dell'albero.

use super::*;

/// Installa un tema da una cartella, **atomico**: valida prima, copia in una
/// cartella temporanea dentro `themes/`, poi un `rename` la pubblica. Un
/// errore in qualunque passo non lascia né il tema a metà né la destinazione
/// toccata.
///
/// La cartella sorgente è l'**albero** del tema: il suo `manifest.json`, il
/// foglio, la pelle, gli asset. Non viene copiata la cartella in sé (il nome
/// della sorgente non conta; l'id del manifest è l'unico nome), ma ciò che sta
/// dentro. Le difese, in ordine:
///
/// 1. l'id viene dal **manifest già validato** (via [`ThemeBundle::load`] o,
///    per chi ha la cartella, da qui sotto) — chi installa non inventa un id
///    dalla sorgente;
/// 2. il tema di serie è riservato: non si installa e non si disinstalla;
/// 3. la destinazione non deve esistere (collisione: il tema è già installato);
/// 4. la copia rifiuta i link simbolici e un file che, per path canonico,
///    esce dalla cartella (traversal);
/// 5. la pubblicazione è un `rename` dentro la stessa filesystem: atomico.
fn install_theme_internal(
    config_dir: &Utf8Path,
    source: &Utf8Path,
    checked: Option<(&str, &str, &str, &serde_json::Value)>,
) -> Result<Utf8PathBuf, ThemeError> {
    let source_id = source.file_name().unwrap_or_default().to_string();
    let source_root = canonical_theme_root(source, &source_id)?;
    let theme = ThemeBundle::load(&source_root)?;
    if let Some((_, _, _, provenance)) = checked {
        provenance_generation(provenance)?;
    }
    if let Some((expected_id, expected_version, _, _)) = checked {
        if theme.manifest.id != expected_id || theme.manifest.version != expected_version {
            return Err(ThemeError::Malformed(format!(
                "signed theme identity {}@{} differs from staged {}@{}",
                expected_id, expected_version, theme.manifest.id, theme.manifest.version,
            )));
        }
    }
    if theme.manifest.id == SERIES_ID {
        return Err(ThemeError::InvalidId(SERIES_ID.to_string()));
    }

    let themes_dir = crate::config::themes_dir(config_dir);
    std::fs::create_dir_all(&themes_dir)
        .map_err(|and| ThemeError::Io(format!("{}: {and}", themes_dir)))?;
    let themes_root = open_themes_root(config_dir, &theme.manifest.id)?
        .ok_or_else(|| ThemeError::Io(format!("{}: no themes root", themes_dir)))?;
    let dest = themes_root.path.join(&theme.manifest.id);
    match themes_root.dir.symlink_metadata(&theme.manifest.id) {
        Ok(_) => return Err(ThemeError::AlreadyInstalled(theme.manifest.id.clone())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(ThemeError::Io(format!("{dest}: {error}"))),
    }

    // Una cartella temporanea **dentro** `themes/`, con un nome che non può
    // collidere. `create_dir` è la prenotazione atomica: nessuna rimozione
    // preventiva può seguire un link simbolico o cancellare il lavoro altrui.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let staging_name = format!("{STAGING_PREFIX}{}-{stamp}", std::process::id());
    themes_root
        .dir
        .create_dir(&staging_name)
        .map_err(|and| ThemeError::Io(format!("{}: {and}", themes_dir.join(&staging_name))))?;
    let staging = themes_root.path.join(&staging_name);

    let result = (|| {
        copy_tree(&source_root, &staging, &source_root)?;
        // Il manifest già letto è quello che la copia ha portato: la forma si
        // convalida di nuovo **dentro** la staging, così la pubblicazione
        // dichiara ciò che ha davvero copiato.
        let published = ThemeBundle::load(&staging)?;
        if published.manifest.id != theme.manifest.id {
            return Err(ThemeError::Malformed(format!(
                "manifest id `{}` differs from `{}`",
                published.manifest.id, theme.manifest.id
            )));
        }
        if let Some((_, _, expected_digest, provenance)) = checked {
            if theme_tree_digest(&staging)? != expected_digest {
                return Err(ThemeError::Malformed(
                    "staged theme digest differs from signed catalog".into(),
                ));
            }
            write_theme_pointer(
                &staging,
                &ThemePointer {
                    version: 1,
                    generation: String::new(),
                    provenance: Some(provenance.clone()),
                    previous: None,
                    revoked: false,
                    revocation_generation: None,
                    revocation_provenance: None,
                },
            )?;
        }
        match std::fs::rename(&staging, &dest) {
            Ok(()) => Ok(()),
            Err(and) => match std::fs::symlink_metadata(&dest) {
                Ok(_) => Err(ThemeError::AlreadyInstalled(theme.manifest.id.clone())),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    Err(ThemeError::Io(format!("{}: {and}", dest)))
                }
                Err(_) => Err(ThemeError::Io(format!("{}: {and}", dest))),
            },
        }
    })();
    if result.is_err() {
        let _ = themes_root.dir.remove_dir_all(&staging_name);
    }
    result.map(|()| dest)
}

pub fn install_theme(config_dir: &Utf8Path, source: &Utf8Path) -> Result<Utf8PathBuf, ThemeError> {
    install_theme_internal(config_dir, source, None)
}

pub fn install_theme_checked(
    config_dir: &Utf8Path,
    source: &Utf8Path,
    expected_id: &str,
    expected_version: &str,
    expected_digest: &str,
    provenance: serde_json::Value,
) -> Result<Utf8PathBuf, ThemeError> {
    install_theme_internal(
        config_dir,
        source,
        Some((expected_id, expected_version, expected_digest, &provenance)),
    )
}

fn provenance_generation(provenance: &serde_json::Value) -> Result<u64, ThemeError> {
    provenance
        .get("generation")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| {
            ThemeError::Malformed(
                "signed theme provenance requires a decimal-string generation".into(),
            )
        })
}

/// The pointer is published with one rename after the immutable generation
/// has been copied and verified. Readers observe the old or the new tree.
pub fn update_theme(
    config_dir: &Utf8Path,
    source: &Utf8Path,
    expected_id: &str,
    expected_version: &str,
    expected_digest: &str,
    provenance: serde_json::Value,
) -> Result<Utf8PathBuf, ThemeError> {
    check_id(expected_id)?;
    if expected_id == SERIES_ID {
        return Err(ThemeError::InvalidId(expected_id.into()));
    }
    let source_id = source.file_name().unwrap_or_default();
    let source_root = canonical_theme_root(source, source_id)?;
    let manifest = ThemeBundle::load(&source_root)?.manifest;
    if manifest.id != expected_id || manifest.version != expected_version {
        return Err(ThemeError::Malformed(
            "signed theme identity differs from source manifest".into(),
        ));
    }
    let root = crate::config::themes_dir(config_dir).join(expected_id);
    let root = canonical_theme_root(&root, expected_id)?;
    let previous_pointer = read_theme_pointer(&root, expected_id)?;
    let current_dir = match &previous_pointer {
        Some(pointer) => selected_theme_dir(&root, expected_id, pointer)?,
        None => root.clone(),
    };
    let current_version = ThemeBundle::load(&current_dir)?.manifest.version;
    if current_version == expected_version {
        return Err(ThemeError::Malformed(
            "signed theme update must select a different version".into(),
        ));
    }
    let old = previous_pointer.clone().unwrap_or(ThemePointer {
        version: 1,
        generation: String::new(),
        provenance: None,
        previous: None,
        revoked: false,
        revocation_generation: None,
        revocation_provenance: None,
    });
    let next_generation = provenance_generation(&provenance)?;
    if let Some(current) = &old.provenance {
        let current_generation = provenance_generation(current)?;
        if next_generation < current_generation {
            return Err(ThemeError::Malformed(
                "catalog generation predates installed theme".into(),
            ));
        }
    }
    if old.revoked {
        let revoked_at = old
            .revocation_generation
            .as_deref()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| ThemeError::Malformed("revoked theme has no valid generation".into()))?;
        if next_generation <= revoked_at {
            return Err(ThemeError::Malformed(
                "catalog generation does not supersede revocation".into(),
            ));
        }
    }
    let versions = root.join(".generations");
    match std::fs::create_dir(&versions) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(ThemeError::Io(format!("{versions}: {e}"))),
    }
    if canonical_theme_root(&versions, expected_id)? != versions {
        return Err(ThemeError::Traversal {
            id: expected_id.into(),
            path: versions.to_string(),
        });
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| ThemeError::Io(e.to_string()))?
        .as_nanos();
    let generation = format!("{}-{stamp}", std::process::id());
    let staged = versions.join(&generation);
    std::fs::create_dir(&staged).map_err(|e| ThemeError::Io(format!("{staged}: {e}")))?;
    let result = (|| {
        copy_tree(&source_root, &staged, &source_root)?;
        let staged_theme = ThemeBundle::load(&staged)?;
        if staged_theme.manifest.id != expected_id
            || staged_theme.manifest.version != expected_version
        {
            return Err(ThemeError::Malformed(
                "staged theme identity changed during copy".into(),
            ));
        }
        if theme_tree_digest(&staged)? != expected_digest {
            return Err(ThemeError::Malformed(
                "staged theme digest differs from signed catalog".into(),
            ));
        }
        publish_theme_pointer(
            &root,
            &ThemePointer {
                version: 1,
                generation: generation.clone(),
                provenance: Some(provenance),
                previous: Some(ThemeVersion {
                    generation: old.generation,
                    provenance: old.provenance,
                }),
                revoked: false,
                revocation_generation: old.revocation_generation,
                revocation_provenance: old.revocation_provenance,
            },
            previous_pointer.as_ref(),
        )
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staged);
    }
    result.map(|()| staged)
}

pub fn theme_catalog_provenance(
    config_dir: &Utf8Path,
    id: &str,
) -> Result<Option<serde_json::Value>, ThemeError> {
    check_id(id)?;
    let root = canonical_theme_root(&crate::config::themes_dir(config_dir).join(id), id)?;
    Ok(read_theme_pointer(&root, id)?.and_then(|pointer| pointer.provenance))
}

pub fn theme_revocation_provenance(
    config_dir: &Utf8Path,
    id: &str,
) -> Result<Option<serde_json::Value>, ThemeError> {
    check_id(id)?;
    let root = canonical_theme_root(&crate::config::themes_dir(config_dir).join(id), id)?;
    Ok(read_theme_pointer(&root, id)?.and_then(|pointer| pointer.revocation_provenance))
}

pub fn theme_revoked(config_dir: &Utf8Path, id: &str) -> bool {
    canonical_theme_root(&crate::config::themes_dir(config_dir).join(id), id)
        .and_then(|root| read_theme_pointer(&root, id))
        .map(|pointer| pointer.is_some_and(|pointer| pointer.revoked))
        .unwrap_or(true)
}

pub fn set_theme_revoked(config_dir: &Utf8Path, id: &str, revoked: bool) -> Result<(), ThemeError> {
    check_id(id)?;
    let root = canonical_theme_root(&crate::config::themes_dir(config_dir).join(id), id)?;
    let previous_pointer = read_theme_pointer(&root, id)?;
    let mut pointer = previous_pointer.clone().unwrap_or(ThemePointer {
        version: 1,
        generation: String::new(),
        provenance: None,
        previous: None,
        revoked: false,
        revocation_generation: None,
        revocation_provenance: None,
    });
    if !revoked && pointer.revocation_generation.is_some() {
        return Err(ThemeError::Malformed(
            "signed revocation cannot be cleared without a newer release".into(),
        ));
    }
    pointer.revoked = revoked;
    publish_theme_pointer(&root, &pointer, previous_pointer.as_ref())
}

pub fn set_theme_revoked_with_provenance(
    config_dir: &Utf8Path,
    id: &str,
    provenance: serde_json::Value,
) -> Result<(), ThemeError> {
    check_id(id)?;
    let incoming = provenance_generation(&provenance)?;
    let root = canonical_theme_root(&crate::config::themes_dir(config_dir).join(id), id)?;
    let previous_pointer = read_theme_pointer(&root, id)?;
    let mut pointer = previous_pointer.clone().unwrap_or(ThemePointer {
        version: 1,
        generation: String::new(),
        provenance: None,
        previous: None,
        revoked: false,
        revocation_generation: None,
        revocation_provenance: None,
    });
    if let Some(current) = &pointer.provenance {
        if incoming < provenance_generation(current)? {
            return Err(ThemeError::Malformed(
                "revocation predates installed theme".into(),
            ));
        }
    }
    if let Some(previous) = &pointer.revocation_generation {
        let previous = previous
            .parse::<u64>()
            .map_err(|_| ThemeError::Malformed("invalid revocation generation".into()))?;
        if incoming < previous {
            return Err(ThemeError::Malformed("older revocation generation".into()));
        }
    }
    pointer.revoked = true;
    pointer.revocation_generation = Some(incoming.to_string());
    pointer.revocation_provenance = Some(provenance);
    publish_theme_pointer(&root, &pointer, previous_pointer.as_ref())
}

/// Disinstalla un tema installato: toglie `<config>/themes/<id>/` e basta.
///
/// Le difese sono le stesse dell'installazione, al contrario:
///
/// 1. l'id passa da [`check_id`] — chi disinstalla non può scrivere un path a
///    mano, o `<id>` diventerebbe una strada che esce da `themes/`;
/// 2. il tema di serie è riservato, come all'installazione;
/// 3. un id che non è installato è un errore: «niente da togliere» e «l'ho
///    tolto» sono due risposte diverse, e la seconda non deve essere detta
///    quando non è vera.
pub fn uninstall_theme(config_dir: &Utf8Path, id: &str) -> Result<(), ThemeError> {
    check_id(id)?;
    if id == SERIES_ID {
        return Err(ThemeError::InvalidId(SERIES_ID.to_string()));
    }
    let themes_dir = crate::config::themes_dir(config_dir);
    let Some(root) = open_themes_root(config_dir, id)? else {
        return Err(ThemeError::Io(format!(
            "{}: no such theme",
            themes_dir.join(id)
        )));
    };
    verify_themes_root(&root, id)?;

    let metadata = root.dir.symlink_metadata(id).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            ThemeError::Io(format!("{}: no such theme", themes_dir.join(id)))
        } else {
            ThemeError::Io(format!("{}: {error}", themes_dir.join(id)))
        }
    })?;
    if metadata.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: themes_dir.join(id).to_string(),
        });
    }
    if !metadata.is_dir() {
        return Err(ThemeError::Malformed(format!(
            "theme root `{}` is not a directory",
            themes_dir.join(id)
        )));
    }

    // Keep the path fence for diagnostics and for callers that inspect the
    // tree concurrently; the actual recursive removal is relative to the
    // opened capability, never an ambient path.
    let dest = root.path.join(id);
    let canonical = canonical_theme_root(&dest, id)?;
    if !canonical.starts_with(&root.path) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }
    root.dir
        .remove_dir_all(id)
        .map_err(|error| ThemeError::Io(format!("{}: {error}", themes_dir.join(id))))
}

/// Copia l'albero di `source` dentro `dest`, rifiutando un file che esce
/// dall'albero (traversal) o un link simbolico (che è un traversal in potenza:
/// la sua destinazione può stare ovunque, e il rifiuto è il solo presidio che
/// non dipenda da chi l'ha creato).
///
/// Il confronto è sui path **canonici**: la radice è già `canonicalize()`
/// (nessun `..` può uscire, perché il sistema le ha risolte tutte), e ogni
/// file è ri-canonicalizzato e controllato che stia **dentro** la radice. Un
/// link simbolico che punta dentro sarebbe fermato da questa stessa regola (il
/// suo path canonico sta dentro), ma un link è comunque rifiutato per nome:
/// il contenuto di un tema deve essere **files**, non riferimenti a file.
fn copy_tree(
    source_root: &Utf8Path,
    dest_root: &Utf8Path,
    root: &Utf8Path,
) -> Result<(), ThemeError> {
    let entries =
        std::fs::read_dir(root).map_err(|and| ThemeError::Io(format!("{}: {and}", root)))?;
    for entry in entries {
        let entry = entry.map_err(|and| ThemeError::Io(format!("{}: {and}", root)))?;
        let file_type = entry
            .file_type()
            .map_err(|and| ThemeError::Io(format!("{}: {and}", root)))?;
        if file_type.is_symlink() {
            return Err(ThemeError::Traversal {
                id: "(install)".into(),
                path: entry.path().to_string_lossy().into_owned(),
            });
        }
        if !file_type.is_dir() && !file_type.is_file() {
            return Err(ThemeError::Malformed(format!(
                "theme asset `{}` is not a regular file",
                entry.path().to_string_lossy()
            )));
        }
        let from = Utf8PathBuf::from_path_buf(entry.path())
            .map_err(|and| ThemeError::Io(format!("non-UTF-8 path: {}", and.display())))?;
        let rel = from
            .strip_prefix(source_root)
            .expect("ogni voce sta dentro la radice che la enumera");
        let to = dest_root.join(rel);
        if file_type.is_dir() {
            std::fs::create_dir(&to).map_err(|and| ThemeError::Io(format!("{}: {and}", to)))?;
            copy_tree(source_root, dest_root, &from)?;
            continue;
        }
        let bytes = read_theme_bytes(&from, source_root, "(install)", MAX_THEME_ASSET_BYTES, true)?
            .ok_or_else(|| ThemeError::Malformed(format!("missing theme asset `{from}`")))?;
        let mut destination =
            create_nofollow(&to).map_err(|and| ThemeError::Io(format!("{}: {and}", to)))?;
        destination
            .write_all(&bytes)
            .map_err(|and| ThemeError::Io(format!("{}: {and}", to)))?;
    }
    Ok(())
}
