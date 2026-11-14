//! Installare un tema dalla cartella di chi lo scrive (modalità sviluppatore):
//! la lettura senza scrivere, coi rifiuti tipizzati, e l'installazione coi
//! byte controllati.
//!
//! Chi può chiederlo lo decide l'host (`Host::check_theme_folder`), e la
//! cartella la sceglie la persona nella finestra nativa dell'app: qui non
//! arriva mai un path scritto dalla webview.

use super::install::{install_theme_internal, FolderPublish, FolderStop};
use super::*;

/// Perché la cartella scelta non è un tema che Fub installa, con i campi che
/// servono a dirlo. Sono i rifiuti delle porte di [`ThemeBundle::load`] e
/// dell'installazione, decisi dagli stessi byte: la shell li dice con le sue
/// parole.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum ThemeFolderRefusal {
    /// Nella cartella non c'è `manifest.json`.
    NotATheme,
    /// Il manifest dichiara un motore che questo host non serve.
    Engine { declared: String },
    /// Il manifest dichiara dei permessi: un tema non ne ha.
    Permissions,
    /// L'id del manifest non è un nome sicuro.
    InvalidId { id: String },
    /// L'id è quello del tema di serie, riservato.
    Series,
    /// Un link simbolico, o un file che esce dalla cartella. `path` è
    /// relativo alla cartella quando ci sta dentro.
    Traversal { path: String },
    /// Un file che è stato del catalogo scritto da Fub (il puntatore alla
    /// versione, le generazioni): non viaggia con un tema.
    CatalogState { file: String },
    /// Il manifest non è un manifest di tema, un foglio dichiarato manca, un
    /// limite è superato. `detail` è il motivo dell'host così com'è.
    Malformed { detail: String },
}

/// Il fascio di una luce come lo chiede il cancello della shell. I byte
/// viaggiano solo per gli asset che il cancello legge (i file dei caratteri e
/// il set di icone); degli altri basta il nome, perché il cancello ne
/// controlla solo la presenza.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct ThemeFolderLight {
    pub light: ThemeLight,
    pub sheet: Option<String>,
    pub skin: Option<String>,
    pub assets: std::collections::BTreeMap<String, Vec<u8>>,
    pub named: Vec<String>,
}

/// La cartella scelta, letta **senza installarla**.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ThemeFolderCheck {
    /// La persona ha chiuso la finestra di scelta: niente è letto.
    Cancelled,
    /// La cartella passa le porte dell'host: il manifest, il fascio di ogni
    /// luce dichiarata e l'impronta dei byte ([`theme_tree_digest`]).
    /// `folder` è il path scelto, da mostrare.
    Ready {
        folder: String,
        manifest: Box<ThemeManifest>,
        lights: Vec<ThemeFolderLight>,
        digest: String,
    },
    /// La cartella non è un tema installabile, e perché.
    Refused {
        folder: String,
        refusal: ThemeFolderRefusal,
    },
}

/// Il rifiuto tipizzato di un errore delle porte, o l'errore stesso quando
/// non è un rifiuto della cartella (il disco, la cartella cambiata).
fn refusal(error: ThemeError, root: &Utf8Path) -> Result<ThemeFolderRefusal, ThemeError> {
    Ok(match error {
        ThemeError::Engine { declared, .. } => ThemeFolderRefusal::Engine { declared },
        ThemeError::Permissions { .. } => ThemeFolderRefusal::Permissions,
        ThemeError::InvalidId(id) if id == SERIES_ID => ThemeFolderRefusal::Series,
        ThemeError::InvalidId(id) => ThemeFolderRefusal::InvalidId { id },
        ThemeError::Traversal { path, .. } => {
            let relative = Utf8Path::new(&path)
                .strip_prefix(root)
                .ok()
                .map(Utf8Path::as_str)
                .filter(|relative| !relative.is_empty())
                .map(str::to_owned);
            ThemeFolderRefusal::Traversal {
                path: relative.unwrap_or(path),
            }
        }
        ThemeError::CatalogState { file } => ThemeFolderRefusal::CatalogState { file },
        ThemeError::Malformed(detail) => ThemeFolderRefusal::Malformed { detail },
        error @ (ThemeError::AlreadyInstalled(_) | ThemeError::Io(_) | ThemeError::Changed(_)) => {
            return Err(error)
        }
    })
}

/// Legge e valida la cartella di un tema senza scrivere niente: le porte di
/// [`ThemeBundle::load`], lo stato del catalogo, la serie riservata, il
/// fascio di ogni luce. Un rifiuto della cartella è
/// [`ThemeFolderCheck::Refused`]; `Err` resta per il disco e per la cartella
/// che cambia mentre la si legge ([`ThemeError::Changed`]: l'impronta si
/// prende prima e dopo).
pub fn check_theme_folder(source: &Utf8Path) -> Result<ThemeFolderCheck, ThemeError> {
    let folder = source.to_string();
    let refused = |refusal| ThemeFolderCheck::Refused {
        folder: folder.clone(),
        refusal,
    };
    let source_id = source.file_name().unwrap_or_default().to_string();
    let root = match canonical_theme_root(source, &source_id) {
        Ok(root) => root,
        Err(error) => return Ok(refused(refusal(error, source)?)),
    };
    match std::fs::symlink_metadata(root.join("manifest.json")) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(refused(ThemeFolderRefusal::NotATheme))
        }
        _ => {}
    }
    match read_folder(&root) {
        Ok((manifest, lights, digest)) => Ok(ThemeFolderCheck::Ready {
            folder,
            manifest: Box::new(manifest),
            lights,
            digest,
        }),
        Err(error) => Ok(refused(refusal(error, &root)?)),
    }
}

/// Il resto della lettura, su una radice canonica che ha un manifest.
fn read_folder(
    root: &Utf8Path,
) -> Result<(ThemeManifest, Vec<ThemeFolderLight>, String), ThemeError> {
    let root = root.to_owned();
    install::reject_catalog_state(&root)?;
    let digest = theme_tree_digest(&root)?;
    let manifest = ThemeBundle::load(&root)?.manifest;
    if manifest.id == SERIES_ID {
        return Err(ThemeError::InvalidId(SERIES_ID.to_string()));
    }
    let read: std::collections::BTreeSet<String> = manifest
        .fonts
        .iter()
        .map(|font| format!("{}{}", manifest.asset_namespace, font.file))
        .chain(
            manifest
                .icons
                .iter()
                .map(|file| format!("{}{file}", manifest.asset_namespace)),
        )
        .collect();
    let lights = manifest
        .lights
        .iter()
        .map(|light| {
            let payload = discover::theme_payload(&root, manifest.clone(), *light)?;
            let (assets, named): (
                std::collections::BTreeMap<_, _>,
                std::collections::BTreeMap<_, _>,
            ) = payload
                .assets
                .into_iter()
                .partition(|(name, _)| read.contains(name));
            Ok(ThemeFolderLight {
                light: payload.light,
                sheet: payload.sheet,
                skin: payload.skin,
                assets,
                named: named.into_keys().collect(),
            })
        })
        .collect::<Result<Vec<_>, ThemeError>>()?;
    if theme_tree_digest(&root)? != digest {
        return Err(ThemeError::Changed(root.to_string()));
    }
    Ok((manifest, lights, digest))
}

/// Com'è andata un'installazione da cartella ([`install_theme_from_folder`]).
///
/// Una sostituzione che si ferma rimettendo il vecchio al suo posto è un
/// errore, perché il disco è com'era; anche la cartella cambiata dopo il
/// controllo. Qui ci sono gli esiti che chi disegna deve dire in modo diverso.
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
    /// Un tema con questo id è già installato, e niente è stato toccato.
    /// `installed_version` è `null` quando quello installato non si legge più.
    Collision {
        id: String,
        name: String,
        version: String,
        installed_version: Option<String>,
    },
    /// Il tema installato con questo id è revocato dal catalogo: non si
    /// sostituisce con una cartella, e niente è stato toccato.
    Revoked {
        id: String,
        name: String,
        version: String,
    },
    /// Il nuovo non è entrato e il vecchio non è tornato al suo nome. `kept`
    /// è il nome della cartella, dentro `themes/`, dove il vecchio è rimasto
    /// (una `.tmp-old-…` che la scansione salta e che niente cancella da
    /// solo): è ciò che la shell dice, con le sue parole. `error` è il guasto
    /// del disco così com'è, per il log e per chi copia la diagnosi. La
    /// cartella sorgente resta dov'è.
    ReplaceFailed {
        id: String,
        name: String,
        version: String,
        kept: String,
        error: PluginError,
    },
}

/// Installa la cartella che [`check_theme_folder`] ha letto, coi suoi byte:
/// `digest` è l'impronta di quel controllo, e la copia si pubblica solo se ha
/// ancora quei byte. Una sola lettura della sorgente e una sola sonda della
/// destinazione ([`install_theme_internal`]): la collisione e la revoca si
/// dicono **prima** di copiare.
///
/// Con `replace` un tema con lo stesso id si sostituisce senza toglierlo
/// prima: la copia nuova si prepara e si verifica accanto, poi uno scambio di
/// nomi la mette al posto del vecchio. Se il nuovo si ferma il vecchio resta
/// (o torna) dov'era, ed è un errore; [`ThemeFolderInstall::ReplaceFailed`] è
/// solo il caso in cui il vecchio non riesce a tornare.
///
/// Le porte sono deterministiche sui byte: se un rifiuto arriva qui e la
/// cartella non ha più l'impronta che le ha passate, l'esito è
/// [`ThemeError::Changed`], non il rifiuto di byte che nessuno ha controllato.
pub fn install_theme_from_folder(
    config_dir: &Utf8Path,
    source: &Utf8Path,
    replace: bool,
    digest: &str,
) -> Result<ThemeFolderInstall, ThemeError> {
    let mut publish = FolderPublish::new(digest, replace);
    let result = install_theme_internal(config_dir, source, None, Some(&mut publish));
    let changed = |error: ThemeError| match error {
        ThemeError::Io(_) | ThemeError::Changed(_) => error,
        _ if theme_tree_digest(source).ok().as_deref() != Some(digest) => {
            ThemeError::Changed(source.to_string())
        }
        _ => error,
    };
    let Some(ThemeManifest {
        id, name, version, ..
    }) = publish.manifest
    else {
        return Err(changed(
            result.expect_err("the manifest is read before anything else"),
        ));
    };
    match (result, publish.stopped, publish.kept) {
        (_, Some(FolderStop::Collision { installed_version }), _) => {
            Ok(ThemeFolderInstall::Collision {
                id,
                name,
                version,
                installed_version,
            })
        }
        (_, Some(FolderStop::Revoked), _) => Ok(ThemeFolderInstall::Revoked { id, name, version }),
        (Ok(_), None, _) => Ok(ThemeFolderInstall::Installed {
            id,
            name,
            version,
            replaced: publish.replaced,
        }),
        (Err(error), None, Some(kept)) => Ok(ThemeFolderInstall::ReplaceFailed {
            id,
            name,
            version,
            kept,
            error: error.into(),
        }),
        (Err(error), None, None) => Err(changed(error)),
    }
}
