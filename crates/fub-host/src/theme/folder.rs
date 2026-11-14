//! Installare un tema dalla cartella di chi lo scrive (modalità sviluppatore):
//! la lettura senza scrivere, coi rifiuti tipizzati, e l'installazione coi
//! byte controllati.
//!
//! Chi può chiederlo lo decide l'host (`Host::check_theme_folder`), e la
//! cartella la sceglie la persona nella finestra nativa dell'app: qui non
//! arriva mai un path scritto dalla webview.

use super::install::{
    create_staging, installed_theme, publish_staging, reject_catalog_state, swap_theme,
    sweep_dropped, themes_root, Installed,
};
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

/// Ciò che di una luce cambia, come lo chiede il cancello della shell: il
/// foglio e gli asset che il foglio o la pelle nominano, per nome (il
/// cancello ne controlla solo la presenza). La pelle e i byte degli asset che
/// il cancello legge sono gli stessi per ogni luce, e viaggiano una volta sola
/// in [`ThemeFolderCheck::Ready`].
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct ThemeFolderLight {
    pub light: ThemeLight,
    pub sheet: Option<String>,
    pub named: Vec<String>,
}

/// La cartella scelta, letta **senza installarla**.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ThemeFolderCheck {
    /// La persona ha chiuso la finestra di scelta: niente è letto.
    Cancelled,
    /// La cartella passa le porte dell'host: il manifest, la pelle, i byte
    /// degli asset che il cancello della shell legge (i file dei caratteri e il
    /// set di icone), ciò che cambia per ogni luce dichiarata e l'impronta dei
    /// byte ([`theme_tree_digest`]). `folder` è il path scelto, da mostrare.
    Ready {
        folder: String,
        manifest: Box<ThemeManifest>,
        skin: Option<String>,
        assets: std::collections::BTreeMap<String, Vec<u8>>,
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
        error @ (ThemeError::AlreadyInstalled(_)
        | ThemeError::Io(_)
        | ThemeError::Disk { .. }
        | ThemeError::Changed(_)) => return Err(error),
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
    match read_folder(&root, folder.clone()) {
        Ok(ready) => Ok(ready),
        Err(error) => Ok(refused(refusal(error, &root)?)),
    }
}

/// Il resto della lettura, su una radice canonica che ha un manifest. Le
/// parti del fascio sono quelle del tema installato
/// ([`discover::theme_payload`]), lette una volta sola per tutte le luci: la
/// pelle, i byte degli asset che il cancello della shell legge davvero e, in
/// una sola visita, i nomi degli altri.
///
/// L'impronta si prende prima e dopo: le letture qui sotto non passano da lei,
/// e una cartella che cambia nel mezzo darebbe un fascio di byte diversi da
/// quelli dell'impronta. Due impronte uguali dicono che il fascio letto è
/// quello dei byte che l'installazione chiederà.
fn read_folder(root: &Utf8Path, folder: String) -> Result<ThemeFolderCheck, ThemeError> {
    reject_catalog_state(root)?;
    let digest = theme_tree_digest(root)?;
    let manifest = ThemeBundle::load(root)?.manifest;
    if manifest.id == SERIES_ID {
        return Err(ThemeError::InvalidId(SERIES_ID.to_string()));
    }
    let namespace = manifest.asset_namespace.as_str();
    let read = discover::shell_assets(&manifest);
    let (assets, present) = asset_listing(root, namespace, &read)?;
    let skin = discover::theme_skin(root, &manifest.id)?;
    let lights = manifest
        .lights
        .iter()
        .map(|&light| {
            let sheet = discover::light_sheet(root, &manifest, light)?;
            let named = referenced_assets(sheet.as_deref(), skin.as_deref(), namespace)
                .into_iter()
                .filter(|name| present.contains(name) && !read.contains(name))
                .collect();
            Ok(ThemeFolderLight {
                light,
                sheet,
                named,
            })
        })
        .collect::<Result<Vec<_>, ThemeError>>()?;
    if theme_tree_digest(root)? != digest {
        return Err(ThemeError::Changed(root.to_string()));
    }
    Ok(ThemeFolderCheck::Ready {
        folder,
        manifest: Box::new(manifest),
        skin,
        assets,
        lights,
        digest,
    })
}

/// Perché un'installazione da cartella non tocca ciò che c'è già nella
/// cartella dei temi di Fub: non è un tema che si possa sostituire, e
/// nemmeno un posto dove scrivere. Non è un difetto della cartella scelta.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeBlock {
    /// Il tema installato con lo stesso id ha il file della versione scritto
    /// dal catalogo, e non si legge (rotto, o non si lascia aprire): potrebbe
    /// dire «revocato», e sostituirlo cancellerebbe la revoca.
    Pointer,
    /// Un link simbolico (o un path che si risolve fuori) al posto della
    /// cartella dei temi o del tema installato: Fub non scrive attraverso un
    /// link.
    Link,
    /// La cartella dei temi, o il tema installato, non è una cartella che Fub
    /// sa leggere.
    Layout,
}

/// Com'è andata un'installazione da cartella ([`install_theme_from_folder`]).
///
/// Ogni esito che chi disegna deve dire in modo diverso ha la sua variante, coi
/// campi per dirlo: niente arriva come frase dell'host da interpretare.
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
    /// Ciò che c'è nella cartella dei temi di Fub non si tocca: `why` dice
    /// perché, `path` è dove (la cartella dei temi o il tema installato), da
    /// mostrare. Niente è stato toccato; il tema da installare è quello del
    /// controllo, che la shell conosce già.
    Blocked { why: ThemeBlock, path: String },
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
    /// Le porte dell'installazione hanno rifiutato i byte controllati: è un
    /// rifiuto della cartella come quelli del controllo, e niente è scritto.
    Refused { refusal: ThemeFolderRefusal },
    /// La cartella non ha più i byte del controllo: niente è scritto, e va
    /// controllata di nuovo.
    Changed,
    /// Non c'è un controllo con questa impronta da installare: un controllo
    /// più recente ha preso il suo posto, o è già stato usato o scartato.
    /// Niente è scritto. Lo decide l'host (`Host::install_theme_from_folder`).
    Unchecked,
    /// Il disco non ha lasciato scrivere, e niente è cambiato: con `replace`
    /// il tema installato è com'era. `cause` è il perché da dire; `error` è il
    /// guasto così com'è, per il log e per chi copia la diagnosi.
    Failed {
        cause: DiskCause,
        error: PluginError,
    },
}

/// Installa la cartella che [`check_theme_folder`] ha letto, coi suoi byte:
/// `checked` è quel controllo (la cartella, l'impronta e il manifest letti).
///
/// Prima la destinazione, con una sola sonda e senza scrivere niente: la
/// collisione, la revoca e ciò che blocca ([`ThemeFolderInstall::Blocked`])
/// si dicono col manifest del controllo, che è quello dei byte controllati.
/// Poi la sorgente si legge **una volta**: la copia nella staging (una
/// cartella temporanea dentro `themes/`) e l'impronta si fanno nello stesso
/// passaggio ([`copy_tree_digest`]), e se l'impronta non è quella del
/// controllo niente si pubblica ([`ThemeFolderInstall::Changed`]). Le porte si
/// ripassano sulla staging: sono i byte che si pubblicano.
///
/// Con `replace` un tema con lo stesso id si sostituisce senza toglierlo
/// prima: uno scambio di nomi mette la staging al posto del vecchio. Se il
/// nuovo si ferma il vecchio resta (o torna) dov'era
/// ([`ThemeFolderInstall::Failed`]); [`ThemeFolderInstall::ReplaceFailed`] è
/// solo il caso in cui il vecchio non riesce a tornare.
///
/// Ogni fermata è un esito tipizzato. Un errore prima che l'impronta torni
/// (la sorgente che non si legge più, un link comparso) si confronta di nuovo
/// con l'impronta: se la cartella non ha più quei byte l'esito è
/// [`ThemeFolderInstall::Changed`], non il rifiuto di byte che nessuno ha
/// controllato.
pub fn install_theme_from_folder(
    config_dir: &Utf8Path,
    checked: &CheckedThemeFolder,
    replace: bool,
) -> ThemeFolderInstall {
    let manifest = &*checked.manifest;
    let id = manifest.id.as_str();
    let themes_root = match themes_root(config_dir, id) {
        Ok(root) => root,
        Err(error) => {
            let themes = crate::config::themes_dir(config_dir);
            return blocked(error, &themes).unwrap_or_else(|error| failed(error, &themes));
        }
    };
    sweep_dropped(&themes_root);
    let dest = themes_root.path.join(id);
    let present = match themes_root.dir.symlink_metadata(id) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return ThemeFolderInstall::Blocked {
                why: ThemeBlock::Link,
                path: dest.to_string(),
            }
        }
        Ok(metadata) => Some(metadata.is_dir()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return failed(ThemeError::Io(format!("{dest}: {error}")), &dest),
    };
    if let Some(is_dir) = present {
        match installed_theme(&dest, id, is_dir) {
            Installed::Blocked(why) => {
                return ThemeFolderInstall::Blocked {
                    why,
                    path: dest.to_string(),
                }
            }
            Installed::Revoked => return outcome(manifest, Outcome::Revoked),
            Installed::Live { version } if !replace => {
                return outcome(manifest, Outcome::Collision(version))
            }
            Installed::Live { .. } => {}
        }
    }

    let source = checked.source.as_path();
    let source_root = match canonical_theme_root(source, source.file_name().unwrap_or_default()) {
        Ok(root) => root,
        Err(error) => return stopped(error, source, &checked.digest),
    };
    let (staging_name, stamp) = match create_staging(&themes_root) {
        Ok(staging) => staging,
        Err(error) => return failed(error, &themes_root.path),
    };
    let staging = themes_root.path.join(&staging_name);
    let result = match copy_tree_digest(&source_root, &staging) {
        Ok(copied) if copied == checked.digest => {
            publish_folder(&themes_root, &staging_name, stamp, manifest, present)
        }
        Ok(_) => ThemeFolderInstall::Changed,
        Err(error) => stopped(error, source, &checked.digest),
    };
    if !matches!(result, ThemeFolderInstall::Installed { .. }) {
        let _ = themes_root.dir.remove_dir_all(&staging_name);
    }
    result
}

/// Gli esiti che nominano il tema da installare.
enum Outcome {
    Installed { replaced: bool },
    Collision(Option<String>),
    Revoked,
}

fn outcome(manifest: &ThemeManifest, outcome: Outcome) -> ThemeFolderInstall {
    let (id, name, version) = (
        manifest.id.clone(),
        manifest.name.clone(),
        manifest.version.clone(),
    );
    match outcome {
        Outcome::Installed { replaced } => ThemeFolderInstall::Installed {
            id,
            name,
            version,
            replaced,
        },
        Outcome::Collision(installed_version) => ThemeFolderInstall::Collision {
            id,
            name,
            version,
            installed_version,
        },
        Outcome::Revoked => ThemeFolderInstall::Revoked { id, name, version },
    }
}

/// Pubblica la staging che ha i byte controllati: le porte sulla staging,
/// poi il `rename` (`present` è `None`) o lo scambio col tema che la sonda ha
/// trovato.
fn publish_folder(
    themes_root: &files::ThemesRoot,
    staging_name: &str,
    stamp: u128,
    manifest: &ThemeManifest,
    present: Option<bool>,
) -> ThemeFolderInstall {
    let staging = themes_root.path.join(staging_name);
    let gates = ThemeBundle::load(&staging).and_then(|theme| {
        // L'impronta è quella del controllo, quindi il manifest anche: il
        // confronto resta come difesa, non come caso.
        if theme.manifest != *manifest {
            return Err(ThemeError::Changed(staging.to_string()));
        }
        // La cartella di chi scrive un tema non porta lo stato del catalogo:
        // il puntatore e le generazioni li scrive solo Fub.
        reject_catalog_state(&staging)
    });
    if let Err(error) = gates {
        return failed(error, &staging);
    }
    let id = manifest.id.as_str();
    if present.is_none() {
        let dest = themes_root.path.join(id);
        return match publish_staging(&staging, &dest, id) {
            Ok(()) => outcome(manifest, Outcome::Installed { replaced: false }),
            // Un tema comparso sotto l'id fra la sonda e la pubblicazione: è
            // una collisione, di un tema che non si è potuto leggere.
            Err(ThemeError::AlreadyInstalled(_)) => outcome(manifest, Outcome::Collision(None)),
            Err(error) => failed(error, &staging),
        };
    }
    match swap_theme(themes_root, staging_name, id, stamp) {
        Ok(None) => outcome(manifest, Outcome::Installed { replaced: true }),
        Ok(Some((error, kept))) => ThemeFolderInstall::ReplaceFailed {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            kept,
            error: error.into(),
        },
        Err(error) => failed(error, &staging),
    }
}

/// La destinazione che non si tocca: un link (o un path che esce) è
/// [`ThemeBlock::Link`], una forma che non è una cartella è
/// [`ThemeBlock::Layout`]. Gli altri errori tornano a chi chiama.
fn blocked(error: ThemeError, at: &Utf8Path) -> Result<ThemeFolderInstall, ThemeError> {
    let why = match error {
        ThemeError::Traversal { .. } => ThemeBlock::Link,
        ThemeError::Malformed(_) => ThemeBlock::Layout,
        error => return Err(error),
    };
    Ok(ThemeFolderInstall::Blocked {
        why,
        path: at.to_string(),
    })
}

/// L'esito di un errore **dopo** che i byte controllati sono nella staging (o
/// prima di leggerli, dalla parte della destinazione): niente si confronta di
/// nuovo con la sorgente. Il disco è [`ThemeFolderInstall::Failed`]; un rifiuto
/// delle porte sulla staging è [`ThemeFolderInstall::Refused`], coi path
/// relativi a `root`.
fn failed(error: ThemeError, root: &Utf8Path) -> ThemeFolderInstall {
    match error {
        ThemeError::Changed(_) => ThemeFolderInstall::Changed,
        ThemeError::Disk { cause, .. } => ThemeFolderInstall::Failed {
            cause,
            error: error.into(),
        },
        error => match refusal(error, root) {
            Ok(refusal) => ThemeFolderInstall::Refused { refusal },
            Err(error) => ThemeFolderInstall::Failed {
                cause: DiskCause::Other,
                error: error.into(),
            },
        },
    }
}

/// L'esito di un'installazione che si è fermata leggendo la sorgente, prima
/// che l'impronta tornasse: niente è cambiato. Ogni errore (anche il disco
/// che non legge più la cartella: una cartella tolta o rinominata dopo il
/// controllo) si confronta di nuovo con l'impronta; solo una scrittura
/// rifiutata nella staging ([`ThemeError::Disk`]) no, perché non dice niente
/// della sorgente.
fn stopped(error: ThemeError, source: &Utf8Path, digest: &str) -> ThemeFolderInstall {
    let error = match error {
        ThemeError::Disk { .. } | ThemeError::Changed(_) => error,
        _ if theme_tree_digest(source).ok().as_deref() != Some(digest) => {
            ThemeError::Changed(source.to_string())
        }
        _ => error,
    };
    let root = source
        .canonicalize_utf8()
        .unwrap_or_else(|_| source.to_owned());
    failed(error, &root)
}

/// Il permesso che il controllo di una cartella dà all'installazione: la
/// cartella controllata, se c'è, e una generazione che ogni controllo e ogni
/// scarto fanno avanzare. L'host lo tiene sotto un lucchetto
/// (`Host::install_theme_from_folder`); qui sta la regola, senza tempi.
///
/// Chi prende il permesso ([`Self::take`]) e poi lo vuole rinnovare
/// ([`Self::rearm`], dopo una collisione) può farlo solo se nel frattempo
/// niente ha controllato o scartato: un controllo arrivato durante
/// l'installazione vince, e un «no» detto nel mezzo non torna indietro.
#[derive(Debug, Default)]
pub struct ThemeFolderGrant {
    generation: u64,
    checked: Option<CheckedThemeFolder>,
}

/// Una cartella di tema passata dal controllo: dove sta, l'impronta dei byte
/// che la shell ha visto, il manifest letto da quei byte e a quale domanda il
/// permesso risponde.
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedThemeFolder {
    pub source: Utf8PathBuf,
    pub digest: String,
    pub manifest: Box<ThemeManifest>,
    /// Dopo una collisione il permesso vale solo per «Sostituisci»
    /// (`replace`), una volta.
    pub replace_only: bool,
}

impl ThemeFolderGrant {
    /// Scarta il permesso e apre una generazione nuova: torna il suo numero,
    /// che chi sta per controllare passa a [`Self::grant`].
    pub fn forget(&mut self) -> u64 {
        self.generation += 1;
        self.checked = None;
        self.generation
    }

    /// Dà il permesso a una cartella controllata, solo se la generazione è
    /// ancora quella di [`Self::forget`]: un controllo o uno scarto arrivati
    /// mentre si leggeva vincono. Torna se il permesso è dato.
    pub fn grant(&mut self, generation: u64, checked: CheckedThemeFolder) -> bool {
        if self.generation != generation {
            return false;
        }
        self.checked = Some(checked);
        true
    }

    /// Prende il permesso se `digest` è il suo, e lo consuma. Un'impronta
    /// diversa non lo tocca. Torna anche la generazione, per [`Self::rearm`].
    pub fn take(&mut self, digest: &str) -> Option<(u64, CheckedThemeFolder)> {
        if self.checked.as_ref()?.digest != digest {
            return None;
        }
        self.checked
            .take()
            .map(|checked| (self.generation, checked))
    }

    /// Rimette il permesso preso da [`Self::take`], solo per «Sostituisci», se
    /// la generazione non è cambiata. Torna se è rimesso.
    pub fn rearm(&mut self, generation: u64, checked: CheckedThemeFolder) -> bool {
        self.grant(
            generation,
            CheckedThemeFolder {
                replace_only: true,
                ..checked
            },
        )
    }
}

#[cfg(test)]
mod grant_tests {
    use super::*;

    fn checked() -> CheckedThemeFolder {
        CheckedThemeFolder {
            source: Utf8PathBuf::from("/cartella"),
            digest: "sha256:aa".into(),
            manifest: Box::new(series_manifest()),
            replace_only: false,
        }
    }

    /// Un «no» (o un controllo nuovo) detto mentre l'installazione è in volo
    /// vince sulla collisione che arriva dopo: il permesso non torna.
    #[test]
    fn a_forget_during_an_install_wins_over_the_rearm() {
        let mut grant = ThemeFolderGrant::default();
        let generation = grant.forget();
        assert!(grant.grant(generation, checked()));
        let (taken, pending) = grant.take("sha256:aa").expect("the checked folder");
        grant.forget();
        assert!(!grant.rearm(taken, pending));
        assert_eq!(grant.take("sha256:aa"), None);
    }

    /// Senza niente nel mezzo la collisione rinnova il permesso, solo per
    /// «Sostituisci».
    #[test]
    fn a_collision_rearms_the_grant_for_replace_only() {
        let mut grant = ThemeFolderGrant::default();
        let generation = grant.forget();
        assert!(grant.grant(generation, checked()));
        let (taken, pending) = grant.take("sha256:aa").unwrap();
        assert!(grant.rearm(taken, pending));
        let (_, again) = grant.take("sha256:aa").unwrap();
        assert!(again.replace_only);
    }

    /// Un controllo che finisce dopo un altro controllo (o uno scarto) non
    /// prende il loro posto; un'impronta diversa non tocca il permesso.
    #[test]
    fn a_stale_check_does_not_grant_and_a_wrong_digest_does_not_take() {
        let mut grant = ThemeFolderGrant::default();
        let slow = grant.forget();
        let fast = grant.forget();
        assert!(grant.grant(fast, checked()));
        assert!(!grant.grant(
            slow,
            CheckedThemeFolder {
                digest: "sha256:bb".into(),
                ..checked()
            }
        ));
        assert_eq!(grant.take("sha256:bb"), None);
        assert!(grant.take("sha256:aa").is_some());
    }
}
