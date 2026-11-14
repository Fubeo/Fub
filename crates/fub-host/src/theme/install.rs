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
    mut folder: Option<&mut FolderPublish<'_>>,
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
    let replace = folder.as_ref().is_some_and(|folder| folder.replace);
    let present = match themes_root.dir.symlink_metadata(&theme.manifest.id) {
        Ok(_) if !replace => return Err(ThemeError::AlreadyInstalled(theme.manifest.id.clone())),
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(ThemeError::Traversal {
                id: theme.manifest.id.clone(),
                path: dest.to_string(),
            })
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(ThemeError::Malformed(format!(
                "theme root `{dest}` is not a directory"
            )))
        }
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(ThemeError::Io(format!("{dest}: {error}"))),
    };

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
        if let Some(folder) = folder.as_deref() {
            // Gli stessi byte che la shell ha controllato: se la cartella è
            // cambiata dopo il controllo, niente si pubblica.
            if theme_tree_digest(&staging)? != folder.digest {
                return Err(ThemeError::Changed(source_root.to_string()));
            }
        }
        if present {
            let lost = swap_theme(&themes_root, &staging_name, &theme.manifest.id, stamp)?;
            return match lost {
                None => Ok(()),
                Some(error) => {
                    if let Some(folder) = folder.as_deref_mut() {
                        folder.old_lost = true;
                    }
                    Err(error)
                }
            };
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
    install_theme_internal(config_dir, source, None, None)
}

/// Come pubblica un'installazione da cartella: i byte attesi (il `digest` di
/// [`check_theme_folder`]) e se un tema con lo stesso id si sostituisce.
/// `old_lost` torna vero solo se la sostituzione ha tolto il vecchio e non è
/// riuscita a rimetterlo.
struct FolderPublish<'a> {
    digest: &'a str,
    replace: bool,
    old_lost: bool,
}

// Uno scambio guastato apposta, per i test dell'unico esito che il disco non
// sa produrre a comando: la sostituzione che non riesce a rimettere il
// vecchio. `1` ferma la pubblicazione del nuovo, `2` anche il ritorno del
// vecchio. Esiste solo nei test di unità.
#[cfg(test)]
thread_local! {
    static SWAP_FAULT: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

fn swap_fault(step: u8) -> io::Result<()> {
    #[cfg(test)]
    if SWAP_FAULT.with(std::cell::Cell::get) >= step {
        return Err(io::Error::other("swap fault injected by the test"));
    }
    let _ = step;
    Ok(())
}

/// Mette la staging al posto del tema installato con lo stesso id, senza mai
/// perderlo: il vecchio si sposta da parte (una cartella `.tmp-` che la
/// scansione salta), il nuovo prende il suo nome, e solo allora il vecchio si
/// cancella. Se il nuovo non entra il vecchio torna al suo posto e l'errore è
/// `Err`. `Ok(Some(_))` è il caso che resta: il nuovo non è entrato e il
/// vecchio non è tornato. Il vecchio non è perso: resta nella cartella da
/// parte dentro `themes/`, e l'errore dice dove, perché il chiamante lo dica.
fn swap_theme(
    themes_root: &files::ThemesRoot,
    staging_name: &str,
    id: &str,
    stamp: u128,
) -> Result<Option<ThemeError>, ThemeError> {
    let dest = themes_root.path.join(id);
    let staging = themes_root.path.join(staging_name);
    let aside_name = format!("{STAGING_PREFIX}old-{}-{stamp}", std::process::id());
    let aside = themes_root.path.join(&aside_name);
    std::fs::rename(&dest, &aside).map_err(|and| ThemeError::Io(format!("{dest}: {and}")))?;
    let published = swap_fault(1).and_then(|()| std::fs::rename(&staging, &dest));
    match published {
        Ok(()) => {
            // Il nuovo è pubblicato: il vecchio da parte si toglie, e se non
            // si toglie resta una `.tmp-` che la scansione salta.
            let _ = themes_root.dir.remove_dir_all(&aside_name);
            Ok(None)
        }
        Err(and) => {
            let failed = ThemeError::Io(format!("{dest}: {and}"));
            match swap_fault(2).and_then(|()| std::fs::rename(&aside, &dest)) {
                Ok(()) => Err(failed),
                Err(back) => Ok(Some(ThemeError::Io(format!(
                    "{dest}: {and}; the previous theme could not go back ({back}) and is kept in {aside}"
                )))),
            }
        }
    }
}

/// La cartella di chi scrive un tema, letta **senza installarla**: il
/// manifest, il fascio di ogni luce dichiarata (come [`read_theme`] lo dà per
/// un tema installato) e l'impronta dei byte ([`theme_tree_digest`]).
///
/// Serve alla shell per far girare i suoi cancelli CSS prima che niente
/// arrivi in `themes/`: l'installazione ([`install_theme_from_folder`]) chiede
/// poi la stessa impronta, e pubblica solo se i byte copiati sono ancora
/// quelli controllati.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ThemeFolderCheck {
    pub manifest: ThemeManifest,
    pub payloads: Vec<ThemePayload>,
    pub digest: String,
}

/// Legge e valida la cartella di un tema senza scrivere niente: le porte di
/// [`ThemeBundle::load`], la serie riservata, il fascio di ogni luce.
/// L'impronta si prende prima e dopo la lettura: se la cartella cambia mentre
/// la si legge, l'esito è [`ThemeError::Changed`] e non un fascio che non
/// corrisponde all'impronta.
pub fn check_theme_folder(source: &Utf8Path) -> Result<ThemeFolderCheck, ThemeError> {
    let source_id = source.file_name().unwrap_or_default().to_string();
    let root = canonical_theme_root(source, &source_id)?;
    let digest = theme_tree_digest(&root)?;
    let manifest = ThemeBundle::load(&root)?.manifest;
    if manifest.id == SERIES_ID {
        return Err(ThemeError::InvalidId(SERIES_ID.to_string()));
    }
    let payloads = manifest
        .lights
        .iter()
        .map(|light| discover::theme_payload(&root, manifest.clone(), *light))
        .collect::<Result<Vec<_>, _>>()?;
    if theme_tree_digest(&root)? != digest {
        return Err(ThemeError::Changed(root.to_string()));
    }
    Ok(ThemeFolderCheck {
        manifest,
        payloads,
        digest,
    })
}

/// Com'è andata un'installazione da cartella (`install_theme_from_folder`).
///
/// Un rifiuto della cartella (manifest assente, link simbolico, limiti, byte
/// cambiati dopo il controllo) è un errore tipizzato, e qui non c'è; anche una
/// sostituzione che si ferma rimettendo il vecchio al suo posto è un errore,
/// perché il disco è com'era. Qui ci sono i tre esiti che chi disegna deve
/// dire in modo diverso: installato; un tema con lo stesso id c'è già, e
/// niente è stato toccato; la sostituzione non ha pubblicato il nuovo e non è
/// riuscita a rimettere il vecchio.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ThemeFolderInstall {
    /// Il tema è in `<config>/themes/<id>/`; `replaced` dice se ne ha preso
    /// il posto di uno con lo stesso id.
    Installed {
        id: String,
        name: String,
        version: String,
        replaced: bool,
    },
    /// Un tema con questo id è già installato: la cartella nuova è già passata
    /// dalle porte di [`install_theme`], e niente è stato toccato.
    /// `installed_version` è `null` quando quello installato non si legge più.
    Collision {
        id: String,
        name: String,
        version: String,
        installed_version: Option<String>,
    },
    /// Il nuovo non è entrato e il vecchio non è tornato al suo nome: `error`
    /// dice perché, e dove il vecchio è rimasto (dentro `themes/`, da parte).
    /// La cartella sorgente resta dov'è.
    ReplaceFailed {
        id: String,
        name: String,
        version: String,
        error: PluginError,
    },
}

/// Installa un tema dalla cartella di chi lo scrive, con le porte di
/// [`install_theme`] e in più l'impronta: `digest` è quello di
/// [`check_theme_folder`], e la copia si pubblica solo se ha ancora quei byte
/// ([`ThemeError::Changed`] altrimenti). La collisione si dice **prima** di
/// toccare il disco.
///
/// Con `replace` un tema con lo stesso id si sostituisce senza toglierlo
/// prima: la copia nuova si prepara e si verifica accanto, poi uno scambio di
/// nomi la mette al posto del vecchio. Se il nuovo si ferma il vecchio resta
/// (o torna) dov'era, ed è un errore; [`ThemeFolderInstall::ReplaceFailed`] è
/// solo il caso in cui il vecchio non riesce a tornare.
///
/// Chi può chiederlo (la modalità sviluppatore) lo decide l'host, non questa
/// funzione: vedi `Host::install_theme_from_folder`.
pub fn install_theme_from_folder(
    config_dir: &Utf8Path,
    source: &Utf8Path,
    replace: bool,
    digest: &str,
) -> Result<ThemeFolderInstall, ThemeError> {
    let source_id = source.file_name().unwrap_or_default().to_string();
    let source_root = canonical_theme_root(source, &source_id)?;
    let manifest = ThemeBundle::load(&source_root)?.manifest;
    if manifest.id == SERIES_ID {
        return Err(ThemeError::InvalidId(SERIES_ID.to_string()));
    }
    let ThemeManifest {
        id, name, version, ..
    } = manifest;
    let present = match open_themes_root(config_dir, &id)? {
        None => false,
        Some(root) => match root.dir.symlink_metadata(&id) {
            Ok(_) => true,
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(error) => {
                return Err(ThemeError::Io(format!(
                    "{}: {error}",
                    crate::config::themes_dir(config_dir).join(&id)
                )))
            }
        },
    };
    if present && !replace {
        let installed_version = list_themes(config_dir)
            .into_iter()
            .find(|theme| theme.manifest.id == id)
            .map(|theme| theme.manifest.version);
        return Ok(ThemeFolderInstall::Collision {
            id,
            name,
            version,
            installed_version,
        });
    }
    let mut publish = FolderPublish {
        digest,
        replace,
        old_lost: false,
    };
    match install_theme_internal(config_dir, &source_root, None, Some(&mut publish)) {
        Ok(_) => Ok(ThemeFolderInstall::Installed {
            id,
            name,
            version,
            replaced: present,
        }),
        Err(error) if publish.old_lost => Ok(ThemeFolderInstall::ReplaceFailed {
            id,
            name,
            version,
            error: error.into(),
        }),
        Err(error) => Err(error),
    }
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
        None,
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

#[cfg(test)]
mod folder_swap_tests {
    use super::*;

    fn folder(version: &str, skin: &str) -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        std::fs::write(
            root.join("manifest.json"),
            format!(
                r#"{{"id": "acme.carta", "name": "Carta", "version": "{version}", "engine": "theme-2", "lights": ["light", "dark"], "asset_namespace": "theme://acme.carta/", "motion": ["opacity", "transform"]}}"#
            ),
        )
        .unwrap();
        std::fs::write(root.join("sheet-light.css"), "body { color: #333; }\n").unwrap();
        std::fs::write(root.join("sheet-dark.css"), "body { color: #ddd; }\n").unwrap();
        std::fs::write(root.join("skin.css"), skin).unwrap();
        (dir, root)
    }

    fn installed_skin(config: &Utf8Path) -> String {
        std::fs::read_to_string(crate::config::themes_dir(config).join("acme.carta/skin.css"))
            .unwrap()
    }

    fn replace_with_fault(
        fault: u8,
    ) -> (tempfile::TempDir, Result<ThemeFolderInstall, ThemeError>) {
        let config_dir = tempfile::tempdir().unwrap();
        let config = Utf8PathBuf::from_path_buf(config_dir.path().to_path_buf()).unwrap();
        let (_old_dir, old) = folder("0.3.2", ".old {}\n");
        let (_new_dir, new) = folder("0.4.0", ".new {}\n");
        let old_digest = theme_tree_digest(&old).unwrap();
        install_theme_from_folder(&config, &old, false, &old_digest).unwrap();
        let new_digest = theme_tree_digest(&new).unwrap();
        SWAP_FAULT.with(|cell| cell.set(fault));
        let result = install_theme_from_folder(&config, &new, true, &new_digest);
        SWAP_FAULT.with(|cell| cell.set(0));
        (config_dir, result)
    }

    /// Il nuovo non entra: il vecchio torna al suo nome, è un errore, e in
    /// `themes/` non resta niente oltre al vecchio.
    #[test]
    fn a_swap_that_fails_puts_the_old_theme_back() {
        let (config_dir, result) = replace_with_fault(1);
        let config = Utf8Path::from_path(config_dir.path()).unwrap();
        assert!(matches!(result, Err(ThemeError::Io(_))), "{result:?}");
        assert_eq!(installed_skin(config), ".old {}\n");
        let names: Vec<_> = std::fs::read_dir(crate::config::themes_dir(config))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec!["acme.carta".to_string()]);
    }

    /// Il nuovo non entra e il vecchio non torna: è `ReplaceFailed`, l'errore
    /// dice dove il vecchio è rimasto, e lì c'è davvero.
    #[test]
    fn a_swap_that_cannot_put_the_old_theme_back_says_where_it_is() {
        let (config_dir, result) = replace_with_fault(2);
        let config = Utf8Path::from_path(config_dir.path()).unwrap();
        let Ok(ThemeFolderInstall::ReplaceFailed {
            id, version, error, ..
        }) = result
        else {
            panic!("expected ReplaceFailed, got {result:?}");
        };
        assert_eq!((id.as_str(), version.as_str()), ("acme.carta", "0.4.0"));
        let themes = crate::config::themes_dir(config);
        assert!(!themes.join("acme.carta").exists());
        let aside = std::fs::read_dir(&themes)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .find(|name| name.starts_with(&format!("{STAGING_PREFIX}old-")))
            .expect("the old theme is set aside");
        assert!(format!("{error:?}").contains(&aside), "{error:?}");
        assert_eq!(
            std::fs::read_to_string(themes.join(&aside).join("skin.css")).unwrap(),
            ".old {}\n"
        );
        assert!(
            list_themes(config).is_empty(),
            "the copy set aside is not a theme"
        );
    }
}
