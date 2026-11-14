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

    let themes_root = themes_root(config_dir, &theme.manifest.id)?;
    sweep_dropped(&themes_root);
    let dest = themes_root.path.join(&theme.manifest.id);
    match themes_root.dir.symlink_metadata(&theme.manifest.id) {
        Ok(_) => return Err(ThemeError::AlreadyInstalled(theme.manifest.id.clone())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(ThemeError::Io(format!("{dest}: {error}"))),
    }

    let (staging_name, _) = create_staging(&themes_root)?;
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
        publish_staging(&staging, &dest, &theme.manifest.id)
    })();
    if result.is_err() {
        let _ = themes_root.dir.remove_dir_all(&staging_name);
    }
    result.map(|()| dest)
}

pub fn install_theme(config_dir: &Utf8Path, source: &Utf8Path) -> Result<Utf8PathBuf, ThemeError> {
    install_theme_internal(config_dir, source, None)
}

/// La cartella `themes/` aperta come radice, creata se manca. `id` serve solo
/// a dire di chi è l'errore: la radice si apre anche prima di sapere quale
/// tema ci entrerà ([`super::install_theme_from_folder`]).
pub(super) fn themes_root(
    config_dir: &Utf8Path,
    id: &str,
) -> Result<files::ThemesRoot, ThemeError> {
    if let Some(root) = open_themes_root(config_dir, id)? {
        return Ok(root);
    }
    let themes_dir = crate::config::themes_dir(config_dir);
    std::fs::create_dir_all(&themes_dir).map_err(|and| ThemeError::disk(&themes_dir, and))?;
    open_themes_root(config_dir, id)?
        .ok_or_else(|| ThemeError::Io(format!("{themes_dir}: no themes root")))
}

/// Prenota una cartella temporanea **dentro** `themes/`, con un nome che non
/// può collidere: `create_dir` è la prenotazione atomica, e nessuna rimozione
/// preventiva può seguire un link simbolico o cancellare il lavoro altrui.
/// Torna il nome e il momento che lo distingue.
pub(super) fn create_staging(
    themes_root: &files::ThemesRoot,
) -> Result<(String, u128), ThemeError> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let staging_name = format!("{STAGING_PREFIX}{}-{stamp}", std::process::id());
    themes_root
        .dir
        .create_dir(&staging_name)
        .map_err(|and| ThemeError::disk(themes_root.path.join(&staging_name), and))?;
    Ok((staging_name, stamp))
}

/// Pubblica la staging sotto l'id con un `rename`, atomico. Se nel frattempo
/// sotto l'id è comparso qualcosa, è [`ThemeError::AlreadyInstalled`].
pub(super) fn publish_staging(
    staging: &Utf8Path,
    dest: &Utf8Path,
    id: &str,
) -> Result<(), ThemeError> {
    match std::fs::rename(staging, dest) {
        Ok(()) => Ok(()),
        Err(and) => match std::fs::symlink_metadata(dest) {
            Ok(_) => Err(ThemeError::AlreadyInstalled(id.to_owned())),
            Err(_) => Err(ThemeError::disk(dest, and)),
        },
    }
}

/// Un tema installato sotto l'id, visto dalla sua radice.
pub(super) enum Installed {
    /// Il puntatore del catalogo dice che è revocato.
    Revoked,
    /// Si può sostituire; `version` è quella che si legge, se si legge.
    Live { version: Option<String> },
    /// Non si sa che cosa sia, e non si tocca.
    Blocked(ThemeBlock),
}

/// Che cosa c'è sotto l'id, in `dest`, senza seguire link: chi chiama ha già
/// fermato un link simbolico al posto della cartella.
///
/// Una radice che non è una cartella, o una cartella senza puntatore, è un
/// tema che si può sostituire anche quando il suo manifest non si legge: la
/// persona lo vede nella domanda («Sostituisci», senza versione) e decide
/// lei. Un puntatore del catalogo che non si legge (rotto, o che non si
/// lascia aprire) invece ferma: potrebbe dire «revocato», e sostituire quel
/// tema cancellerebbe la revoca. Lo stesso per una cartella che non si
/// risolve dentro `themes/`.
pub(super) fn installed_theme(dest: &Utf8Path, id: &str, is_dir: bool) -> Installed {
    if !is_dir {
        return Installed::Live { version: None };
    }
    let root = match canonical_theme_root(dest, id) {
        Ok(root) => root,
        Err(ThemeError::Traversal { .. }) => return Installed::Blocked(ThemeBlock::Link),
        Err(_) => return Installed::Blocked(ThemeBlock::Layout),
    };
    let dir = match read_theme_pointer(&root, id) {
        Ok(Some(pointer)) if pointer.revoked => return Installed::Revoked,
        Ok(Some(pointer)) => selected_theme_dir(&root, id, &pointer).ok(),
        Ok(None) => Some(root),
        Err(_) => return Installed::Blocked(ThemeBlock::Pointer),
    };
    let version = dir
        .and_then(|dir| ThemeBundle::load(&dir).ok())
        .map(|theme| theme.manifest.version);
    Installed::Live { version }
}

/// Toglie una voce di `themes/` per nome, cartella o file che sia: un tema
/// sostituito può non essere stato una cartella.
pub(super) fn remove_entry(themes_root: &files::ThemesRoot, name: &str) -> io::Result<()> {
    let metadata = themes_root.dir.symlink_metadata(name)?;
    if metadata.is_dir() {
        themes_root.dir.remove_dir_all(name)
    } else {
        themes_root.dir.remove_file(name)
    }
}

/// I nomi, nella radice della cartella di un tema, che sono stato del catalogo
/// scritto da Fub e non parte del tema: il puntatore alla versione
/// ([`POINTER_FILE`]), le sue copie temporanee e le generazioni conservate.
/// [`read_theme`] segue il puntatore: copiato da una cartella, sceglierebbe lui
/// che cosa si monta, o porterebbe una revoca finta.
pub(super) fn reject_catalog_state(root: &Utf8Path) -> Result<(), ThemeError> {
    let entries =
        std::fs::read_dir(root).map_err(|and| ThemeError::Io(format!("{root}: {and}")))?;
    for entry in entries {
        let entry = entry.map_err(|and| ThemeError::Io(format!("{root}: {and}")))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".generations" || name.starts_with(".fub-current") {
            return Err(ThemeError::CatalogState {
                file: name.into_owned(),
            });
        }
    }
    Ok(())
}

/// Il prefisso di un tema sostituito che non si è lasciato cancellare: resta
/// sotto [`STAGING_PREFIX`] (la scansione lo salta) e si spazza alla prossima
/// installazione ([`sweep_dropped`]). Diverso da `.tmp-old-`, la copia che una
/// sostituzione fallita ha lasciato da parte e che non si cancella mai da sola:
/// è l'unica copia del tema vecchio.
pub(super) const DROP_PREFIX: &str = ".tmp-drop-";

/// Toglie i temi sostituiti rimasti da un'installazione precedente
/// ([`DROP_PREFIX`]), cartelle o file; un link si toglie come link, senza
/// seguirlo. Un guasto si scrive nel log e non ferma l'installazione.
pub(super) fn sweep_dropped(themes_root: &files::ThemesRoot) {
    let Ok(entries) = themes_root.dir.entries() else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(DROP_PREFIX) {
            continue;
        }
        if let Err(error) = remove_entry(themes_root, &name) {
            tracing::warn!(
                target: "fub.host",
                "{}: a replaced theme could not be removed: {error}",
                themes_root.path.join(&name)
            );
        }
    }
}

// Uno scambio guastato apposta, per i test dell'unico esito che il disco non
// sa produrre a comando: la sostituzione che non riesce a rimettere il
// vecchio. `1` ferma la pubblicazione del nuovo, `2` anche il ritorno del
// vecchio. `DROP_FAULT` ferma la cancellazione del vecchio dopo uno scambio
// riuscito. Esistono solo nei test di unità.
#[cfg(test)]
thread_local! {
    static SWAP_FAULT: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
    static DROP_FAULT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn swap_fault(step: u8) -> io::Result<()> {
    #[cfg(test)]
    if SWAP_FAULT.with(std::cell::Cell::get) >= step {
        return Err(io::Error::new(
            io::ErrorKind::StorageFull,
            "swap fault injected by the test",
        ));
    }
    let _ = step;
    Ok(())
}

fn drop_fault() -> io::Result<()> {
    #[cfg(test)]
    if DROP_FAULT.with(std::cell::Cell::get) {
        return Err(io::Error::other("drop fault injected by the test"));
    }
    Ok(())
}

/// Mette la staging al posto del tema installato con lo stesso id, senza mai
/// perderlo: il vecchio si sposta da parte (una cartella `.tmp-old-` che la
/// scansione salta), il nuovo prende il suo nome, e solo allora il vecchio si
/// cancella. Se il nuovo non entra il vecchio torna al suo posto e l'errore è
/// `Err`. `Ok(Some((errore, nome)))` è il caso che resta: il nuovo non è
/// entrato e il vecchio non è tornato. Il vecchio non è perso: resta nella
/// cartella da parte dentro `themes/`, e `nome` è il suo nome lì dentro,
/// perché il chiamante lo dica.
pub(super) fn swap_theme(
    themes_root: &files::ThemesRoot,
    staging_name: &str,
    id: &str,
    stamp: u128,
) -> Result<Option<(ThemeError, String)>, ThemeError> {
    let dest = themes_root.path.join(id);
    let staging = themes_root.path.join(staging_name);
    let aside_name = format!("{STAGING_PREFIX}old-{}-{stamp}", std::process::id());
    let aside = themes_root.path.join(&aside_name);
    std::fs::rename(&dest, &aside).map_err(|and| ThemeError::disk(&dest, and))?;
    let published = swap_fault(1).and_then(|()| std::fs::rename(&staging, &dest));
    match published {
        Ok(()) => {
            // Il nuovo è pubblicato: il vecchio da parte si toglie. Se non si
            // toglie lo si dice nel log, e cambia nome perché la prossima
            // installazione lo spazzi: una `.tmp-old-` resta solo quando è
            // l'unica copia del vecchio.
            let removed = drop_fault().and_then(|()| remove_entry(themes_root, &aside_name));
            if let Err(error) = removed {
                tracing::warn!(
                    target: "fub.host",
                    "{aside}: the replaced theme could not be removed: {error}"
                );
                let dropped = format!("{DROP_PREFIX}{}-{stamp}", std::process::id());
                if let Err(error) = themes_root
                    .dir
                    .rename(&aside_name, &themes_root.dir, &dropped)
                {
                    tracing::warn!(
                        target: "fub.host",
                        "{aside}: the replaced theme could not be set aside for removal: {error}"
                    );
                }
            }
            Ok(None)
        }
        Err(and) => {
            let cause = DiskCause::of(&and);
            match swap_fault(2).and_then(|()| std::fs::rename(&aside, &dest)) {
                Ok(()) => Err(ThemeError::disk(&dest, and)),
                Err(back) => Ok(Some((
                    ThemeError::Disk {
                        cause,
                        detail: format!(
                            "{dest}: {and}; the previous theme could not go back ({back}) and is kept in {aside}"
                        ),
                    },
                    aside_name,
                ))),
            }
        }
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
    let _guard = lock_theme(config_dir, expected_id);
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
    let _guard = lock_theme(config_dir, id);
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
    let _guard = lock_theme(config_dir, id);
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
    let _guard = lock_theme(config_dir, id);
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
            std::fs::create_dir(&to).map_err(|and| ThemeError::disk(&to, and))?;
            copy_tree(source_root, dest_root, &from)?;
            continue;
        }
        let bytes = read_theme_bytes(&from, source_root, "(install)", MAX_THEME_ASSET_BYTES, true)?
            .ok_or_else(|| ThemeError::Malformed(format!("missing theme asset `{from}`")))?;
        let mut destination = create_nofollow(&to).map_err(|and| ThemeError::disk(&to, and))?;
        destination
            .write_all(&bytes)
            .map_err(|and| ThemeError::disk(&to, and))?;
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

    /// Il giro della shell senza l'host: controlla la cartella, poi la
    /// installa coi byte del controllo.
    fn install_checked(config: &Utf8Path, root: &Utf8Path, replace: bool) -> ThemeFolderInstall {
        let ThemeFolderCheck::Ready {
            digest, manifest, ..
        } = check_theme_folder(root).unwrap()
        else {
            panic!("the folder passes the check");
        };
        let checked = CheckedThemeFolder {
            source: root.to_owned(),
            digest,
            manifest,
            replace_only: false,
        };
        install_theme_from_folder(config, &checked, replace)
    }

    fn installed_skin(config: &Utf8Path) -> String {
        std::fs::read_to_string(crate::config::themes_dir(config).join("acme.carta/skin.css"))
            .unwrap()
    }

    fn replace_with_fault(fault: u8) -> (tempfile::TempDir, ThemeFolderInstall) {
        let config_dir = tempfile::tempdir().unwrap();
        let config = Utf8PathBuf::from_path_buf(config_dir.path().to_path_buf()).unwrap();
        let (_old_dir, old) = folder("0.3.2", ".old {}\n");
        let (_new_dir, new) = folder("0.4.0", ".new {}\n");
        install_checked(&config, &old, false);
        SWAP_FAULT.with(|cell| cell.set(fault));
        let result = install_checked(&config, &new, true);
        SWAP_FAULT.with(|cell| cell.set(0));
        (config_dir, result)
    }

    /// Il nuovo non entra (il disco è pieno): il vecchio torna al suo nome,
    /// l'esito dice il perché tipizzato, e in `themes/` non resta niente oltre
    /// al vecchio.
    #[test]
    fn a_swap_that_fails_puts_the_old_theme_back() {
        let (config_dir, result) = replace_with_fault(1);
        let config = Utf8Path::from_path(config_dir.path()).unwrap();
        assert!(
            matches!(
                result,
                ThemeFolderInstall::Failed {
                    cause: DiskCause::Full,
                    ..
                }
            ),
            "{result:?}"
        );
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
        let ThemeFolderInstall::ReplaceFailed {
            id,
            version,
            kept,
            error,
            ..
        } = result
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
        // Il nome tipizzato, relativo a `themes/`: è ciò che la shell dice.
        assert_eq!(kept, aside);
        assert!(!kept.contains('/'), "{kept}");
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

    fn themes_entries(config: &Utf8Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(crate::config::themes_dir(config))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }

    /// La classe di un errore del sistema, non la sua frase.
    #[test]
    fn a_disk_error_says_its_cause() {
        let of = |kind| DiskCause::of(&io::Error::from(kind));
        assert_eq!(of(io::ErrorKind::StorageFull), DiskCause::Full);
        assert_eq!(of(io::ErrorKind::QuotaExceeded), DiskCause::Full);
        assert_eq!(of(io::ErrorKind::PermissionDenied), DiskCause::Denied);
        assert_eq!(of(io::ErrorKind::ReadOnlyFilesystem), DiskCause::Denied);
        assert_eq!(of(io::ErrorKind::Other), DiskCause::Other);
        #[cfg(target_os = "linux")]
        assert_eq!(
            DiskCause::of(&io::Error::from_raw_os_error(28)),
            DiskCause::Full,
            "ENOSPC"
        );
    }

    /// Il nuovo è entrato ma il vecchio da parte non si lascia cancellare: non
    /// resta in silenzio come `.tmp-old-` (il nome dell'unica copia di una
    /// sostituzione fallita), cambia nome in `.tmp-drop-`, e la prossima
    /// installazione lo spazza. Una `.tmp-old-` invece resta: niente la
    /// cancella da solo.
    #[test]
    fn a_replaced_theme_that_cannot_be_removed_is_swept_by_the_next_install() {
        let config_dir = tempfile::tempdir().unwrap();
        let config = Utf8PathBuf::from_path_buf(config_dir.path().to_path_buf()).unwrap();
        let (_old_dir, old) = folder("0.3.2", ".old {}\n");
        let (_new_dir, new) = folder("0.4.0", ".new {}\n");
        install_checked(&config, &old, false);
        let kept = crate::config::themes_dir(&config).join(".tmp-old-1-2");
        std::fs::create_dir(&kept).unwrap();
        std::fs::write(kept.join("skin.css"), ".kept {}\n").unwrap();

        DROP_FAULT.with(|cell| cell.set(true));
        let result = install_checked(&config, &new, true);
        DROP_FAULT.with(|cell| cell.set(false));
        assert!(
            matches!(result, ThemeFolderInstall::Installed { replaced: true, .. }),
            "{result:?}"
        );
        assert_eq!(installed_skin(&config), ".new {}\n");
        let names = themes_entries(&config);
        assert_eq!(names.len(), 3, "{names:?}");
        assert!(names[0].starts_with(DROP_PREFIX), "{names:?}");
        assert_eq!(
            &names[1..],
            &[".tmp-old-1-2".to_string(), "acme.carta".to_string()]
        );

        let (_other_dir, other) = folder("0.4.0", ".other {}\n");
        std::fs::write(
            other.join("manifest.json"),
            std::fs::read_to_string(other.join("manifest.json"))
                .unwrap()
                .replace("acme.carta", "acme.lino"),
        )
        .unwrap();
        install_theme(&config, &other).unwrap();
        assert_eq!(
            themes_entries(&config),
            vec![
                ".tmp-old-1-2".to_string(),
                "acme.carta".to_string(),
                "acme.lino".to_string()
            ]
        );
    }
}
