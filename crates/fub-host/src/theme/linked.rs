//! Il tema collegato (modalità sviluppatore): una cartella di chi scrive un
//! tema che Fub legge **al suo posto**, senza copiarla in `themes/`, e che
//! rimonta a ogni salvataggio.
//!
//! Le porte sono quelle dell'installazione da cartella
//! ([`check_theme_folder`](super::check_theme_folder)): la radice canonica e
//! senza link, lo stato del catalogo rifiutato, [`ThemeBundle::load`] col suo
//! manifest, i suoi limiti e la sua serie riservata, poi il fascio di
//! [`discover::theme_payload`] con le stesse letture senza link e gli stessi
//! limiti. Un id uguale a quello di un tema installato è una collisione: il
//! tema collegato non lo copre, e il motivo si dice.
//!
//! Chi guarda la cartella e chi tiene il collegamento sta in
//! [`crate::theme_watch`]; qui si decide soltanto che cosa la cartella è,
//! adesso.

use super::folder::refusal;
use super::install::reject_catalog_state;
use super::*;

/// Che cosa è adesso la cartella collegata.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ThemeLinkState {
    /// Passa le porte, e il suo id non è di un tema installato: compare fra i
    /// temi con la fiducia `development`.
    Ready,
    /// La cartella non c'è più, o non è più una cartella.
    Missing,
    /// La cartella non è un tema che Fub legge, e perché: gli stessi rifiuti
    /// tipizzati dell'installazione da cartella.
    Refused { refusal: ThemeFolderRefusal },
    /// Un tema installato ha lo stesso id: il collegato non lo copre.
    Collision,
    /// Il disco non ha lasciato leggere la cartella. `error` è il guasto così
    /// com'è, per il log e per chi copia la diagnosi: mai da mostrare.
    Unreadable { error: PluginError },
}

/// Il tema collegato com'è adesso: la cartella, l'id e il nome dell'ultimo
/// manifest letto (restano quelli di prima se il manifest di adesso non si
/// legge), lo stato e, nell'evento di un salvataggio (`fub://theme-changed`),
/// i file salvati, relativi alla cartella.
///
/// `watched` dice se un osservatore vivo guarda la cartella: `false` vuol dire
/// che i salvataggi non arrivano (la cartella non è pronta, il sistema non ha
/// più osservatori, l'host non ne ha uno), e Aspetto lo dice con cosa fare.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct ThemeLink {
    pub folder: String,
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(flatten)]
    pub state: ThemeLinkState,
    pub changed: Vec<String>,
    pub watched: bool,
}

/// Com'è andato «Collega una cartella…» (`Host::link_theme_folder`).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ThemeFolderLink {
    /// La persona ha chiuso la finestra di scelta: niente è cambiato.
    Cancelled,
    /// La cartella è collegata (al posto di quella di prima, se c'era) e
    /// guardata; il tema compare fra i temi con la fiducia `development`.
    Linked { link: ThemeLink },
    /// La cartella non si collega, e `link.state` dice perché (non è mai
    /// `ready`): il collegamento di prima, se c'era, resta com'era.
    Refused { link: ThemeLink },
}

/// Quanti file salvati porta al più un evento: bastano a dire «dopo il
/// salvataggio di skin.css», e un salvataggio di cento file non gonfia l'IPC.
pub const MAX_LINK_CHANGED: usize = 8;

/// Legge la cartella collegata con le porte dell'installazione: lo stato, e il
/// manifest quando si legge (anche se poi l'id collide).
pub(crate) fn read_link(
    config_dir: Option<&Utf8Path>,
    folder: &Utf8Path,
) -> (ThemeLinkState, Option<ThemeManifest>) {
    match std::fs::symlink_metadata(folder) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return (ThemeLinkState::Missing, None)
        }
        Ok(metadata) if !metadata.is_dir() && !metadata.file_type().is_symlink() => {
            return (ThemeLinkState::Missing, None)
        }
        _ => {}
    }
    let name = folder.file_name().unwrap_or_default().to_string();
    let root = match canonical_theme_root(folder, &name) {
        Ok(root) => root,
        Err(error) => return (state_of(error, folder), None),
    };
    match std::fs::symlink_metadata(root.join("manifest.json")) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return (
                ThemeLinkState::Refused {
                    refusal: ThemeFolderRefusal::NotATheme,
                },
                None,
            )
        }
        _ => {}
    }
    let manifest = match load_linked(&root) {
        Ok(manifest) => manifest,
        Err(error) => return (state_of(error, &root), None),
    };
    // Ogni luce dichiarata ha il suo foglio, come per l'elenco dei temi
    // installati ([`list_themes`]): un tema senza non si offre.
    let sheets = manifest
        .lights
        .iter()
        .try_for_each(|&light| discover::light_sheet(&root, &manifest, light).map(drop));
    if let Err(error) = sheets {
        return (state_of(error, &root), Some(manifest));
    }
    if installed_already(config_dir, &manifest.id) {
        return (ThemeLinkState::Collision, Some(manifest));
    }
    (ThemeLinkState::Ready, Some(manifest))
}

/// Lo stato del catalogo rifiutato, il manifest con le porte di
/// [`ThemeBundle::load`], la serie riservata.
fn load_linked(root: &Utf8Path) -> Result<ThemeManifest, ThemeError> {
    reject_catalog_state(root)?;
    let manifest = ThemeBundle::load(root)?.manifest;
    if manifest.id == SERIES_ID {
        return Err(ThemeError::InvalidId(SERIES_ID.to_string()));
    }
    Ok(manifest)
}

fn state_of(error: ThemeError, root: &Utf8Path) -> ThemeLinkState {
    match refusal(error, root) {
        Ok(refusal) => ThemeLinkState::Refused { refusal },
        Err(error) => ThemeLinkState::Unreadable {
            error: error.into(),
        },
    }
}

/// C'è già qualcosa sotto `themes/<id>`? Un tema installato, anche rotto, o
/// ciò che ne ha preso il posto: il collegato non lo copre.
fn installed_already(config_dir: Option<&Utf8Path>, id: &str) -> bool {
    let Some(config_dir) = config_dir else {
        return false;
    };
    std::fs::symlink_metadata(crate::config::themes_dir(config_dir).join(id)).is_ok()
}

/// Il tema collegato com'è adesso, coi nomi del manifest se si legge.
pub fn theme_link(config_dir: Option<&Utf8Path>, folder: &Utf8Path) -> ThemeLink {
    let (state, manifest) = read_link(config_dir, folder);
    ThemeLink {
        folder: folder.to_string(),
        id: manifest.as_ref().map(|manifest| manifest.id.clone()),
        name: manifest.map(|manifest| manifest.name),
        state,
        changed: Vec::new(),
        watched: false,
    }
}

/// La riga del catalogo del tema collegato, con la fiducia `development`, se
/// la cartella è pronta.
pub fn linked_theme_info(config_dir: Option<&Utf8Path>, folder: &Utf8Path) -> Option<ThemeInfo> {
    match read_link(config_dir, folder) {
        (ThemeLinkState::Ready, Some(manifest)) => Some(ThemeInfo {
            manifest,
            trust: "development",
        }),
        _ => None,
    }
}

/// Una luce del tema collegato, se la cartella collegata porta l'id chiesto:
/// `None` quando l'id è di un altro (chi chiama legge i temi installati), un
/// errore quando è suo ma la cartella non regge adesso.
pub fn read_linked_theme(
    config_dir: Option<&Utf8Path>,
    folder: &Utf8Path,
    id: &str,
    light: ThemeLight,
) -> Option<Result<ThemePayload, ThemeError>> {
    let name = folder.file_name().unwrap_or_default().to_string();
    let root = canonical_theme_root(folder, &name).ok()?;
    let manifest = load_linked(&root).ok()?;
    if manifest.id != id || installed_already(config_dir, id) {
        return None;
    }
    Some(discover::theme_payload(&root, manifest, light))
}

/// Decide un collegamento nuovo: la cartella si legge con le porte, e se è
/// pronta `record` la scrive **sotto il lucchetto del suo id**
/// ([`lock_theme`]), lo stesso dell'installazione e della revoca. Così
/// un'installazione con lo stesso id non passa fra il controllo della
/// collisione e la scrittura del collegamento.
pub(crate) fn link_folder<E>(
    config_dir: Option<&Utf8Path>,
    folder: &Utf8Path,
    record: impl FnOnce() -> Result<(), E>,
) -> Result<(ThemeLink, bool), E> {
    let first = theme_link(config_dir, folder);
    let (ThemeLinkState::Ready, Some(id)) = (&first.state, first.id.clone()) else {
        return Ok((first, false));
    };
    let _guard = config_dir.map(|config_dir| lock_theme(config_dir, &id));
    let link = theme_link(config_dir, folder);
    if link.state != ThemeLinkState::Ready {
        return Ok((link, false));
    }
    record()?;
    Ok((link, true))
}
