//! **I temi come bundle** (§29.4): una pelle dichiarata da un
//! [`ThemeManifest`], installata nella cartella di configurazione della
//! macchina e montata dalla stessa porta dei componenti — il
//! [`BundleRegistry`].
//!
//! Un tema non è un componente: non ha provider, non dichiara permessi e non
//! offre comandi. Ma è montato **dalla stessa porta**, e questa è la scelta:
//! il §9.3 dice che un bundle è «un plugin e i provider che registra», e un
//! tema è l'angolo estremo di quella definizione — un plugin **senza** provider
//! e senza permessi, che esiste per dare un proprietario dichiarato al foglio
//! che la shell disegna. La riga «cosa registri» è vuota, ma la strada — la
//! versione del contratto, la dichiarazione, l'attivazione, i provider — è la
//! stessa dei componenti, e con lei le due cose che il §29.4 chiede: il tema di
//! serie passa dalla stessa porta del tema di terzi (niente seconda porta), e
//! l'interruttore dei componenti (`plugins.disabled`) vale anche per lui.
//!
//! # Il contratto del manifest, e dove si applica
//!
//! Un tema dichiara la versione del contratto **per la pelle**, non per il
//! codice: [`THEME_ENGINE`]. È l'analogo dell'`abi_version` di un plugin, e come
//! quello si verifica **prima** di qualunque altra cosa — prima di
//! `remember`, prima dell'inventario — e chi non la rispetta è respinto con la
//! stessa forma del [`BundleError::Abi`]: non è un difetto del tema, è un tema
//! che parla un contratto che questo host non serve.
//!
//! La seconda porta è **i permessi**: un tema non ne dichiara, e un manifest
//! che ne porta uno è rifiutato per nome. Un tema con permessi sarebbe un tema
//! che non è solo una pelle — e la pelle non può chiedere di leggere il vault
//! a nome suo.
//!
//! La terza è la **forma**: id che è anche una cartella (un solo componente di
//! path, senza `.`/`..`), almeno una luce, e un `asset_namespace` che sta
//! davvero sotto `theme://…`. I cancelli *CSS* veri — che il foglio non tocchi
//! fuori dalla propria pasta, che la sintassi regga — girano al montaggio nella
//! shell, che è l'unica che ha un renderer; qui si valida ciò che è valido
//! senza renderer: manifest, struttura e namespace.
//!
//! # L'installazione è una cartella, e atomica
//!
//! Un tema installato è `<config>/themes/<id>/` (vedi
//! [`themes_dir`](crate::config::themes_dir)): il manifest `manifest.json`
//! accanto al foglio, alla pelle e agli asset. Si installa **una cartella alla
//! volta** — l'archivio `.zip`/`.tar` non è nel grafo delle dipendenze
//! (decisione 0001) e un parser scritto a mano è peggio della feature che
//! risparmia — e si installa **atomica**: prima si valida tutto (manifest,
//! porte, id) e si copia in una cartella temporanea `themes/.tmp-…`, poi un
//! `rename` la pubblica con il nome giusto. Un errore in qualunque passo lascia
//! al più una cartella temporanea, che l'errore stesso rimuove; l'id della
//! destinazione non esiste mai «a metà». Le due difese di chi installa sono il
//! **traversal** (un file della cartella che punta fuori, o un link simbolico)
//! e la **collisione** (un id che c'è già: `AlreadyExists`, e non si tocca
//! niente).

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::theme::{ThemeEngine, ThemeLight, ThemeManifest, THEME_ENGINE};
use fub_abi::traits::{Plugin, PluginManifest};
use fub_abi::PluginError;

use crate::registry::{BundleKind, OnlyProviders};

/// L'id del tema di serie. È l'unico id che l'host conosce per nome, per le
/// stesse ragioni per cui conosce [`CORE_ID`](crate::settings::CORE_ID): è
/// l'id di ciò che è **dell'host** e non può essere installato o disinstallato
/// da un tema di terze parti. Il manifest qui sotto è la costante del §29.4, ed
/// è il gemello di quello che il banco di `fub-abi` tiene fermo.
pub const SERIES_ID: &str = "fub.serie";

/// Il prefisso delle cartelle temporanee d'installazione dentro `themes/`
/// (vedi [`install_theme`]).
///
/// È una costante e non una stringa scritta due volte perché la scansione
/// ([`discover_themes`]) e l'installazione devono riconoscere la stessa cosa:
/// un prefisso in due punti è un prefisso che può divergere, e la divergenza
/// sarebbe un residuo di crash esposto come «tema rotto». Il nome è una
/// iniziale di nascosto, e `check_id` la respinge: un tema non può chiamarsi
/// così, quindi il prefisso è riservato all'installatore.
pub(crate) const STAGING_PREFIX: &str = ".tmp-";

/// Il manifest del tema di serie: la costante che il §29.4 chiede, identica al
/// campione pinato dal banco di `fub_abi::theme` (id, nome, versione, motore,
/// luci e namespace fissati lì).
/// Il manifest del tema di serie, identico al campione pinato dal banco di
/// `fub_abi::theme` (id, nome, versione, motore, luci e namespace fissati lì).
///
/// È una funzione e non una costante perché [`ThemeManifest`] porta `String` e
/// `Vec`: il confronto col campione del banco resta possibile, ed è il banco
/// che lo fa.
pub fn series_manifest() -> ThemeManifest {
    ThemeManifest {
        id: SERIES_ID.to_string(),
        name: "Fub di serie".to_string(),
        version: "1.0.0".to_string(),
        engine: ThemeEngine::Theme1,
        lights: vec![ThemeLight::Dark, ThemeLight::Light],
        asset_namespace: "theme://fub.serie/".to_string(),
    }
}

/// Perché un tema non è installabile o non è montabile, come lo vede chi ha
/// chiesto di installarlo o di accenderlo (§12.2).
///
/// Ogni variante vuol dire «non c'è, e non ha lasciato niente dietro», con la
/// stessa disciplina di [`BundleError`]. Le prime quattro sono le porte del
/// manifest e si decidono **prima** di toccare il disco; le altre tre sono i
/// guasti del disco (o della struttura della cartella) e portano un path, per
/// chi deve andarci a guardare.
#[derive(Debug)]
pub enum ThemeError {
    /// Il manifest dichiara un motore diverso da [`THEME_ENGINE`]: un tema che
    /// questo host non serve, respinto prima di ogni altro passo.
    Engine { id: String, declared: String },
    /// Il manifest è illeggibile o non è un [`ThemeManifest`] valido.
    Malformed(String),
    /// Il manifest dichiara dei permessi: la forma di un tema non li prevede.
    Permissions { id: String },
    /// L'id non è un componente di path sicuro (vuoto, `.`/`..`, slash,
    /// iniziale punto), o è un id riservato all'host.
    InvalidId(String),
    /// La cartella sorgente contiene un path che esce dalla cartella, o un link
    /// simbolico: un tema non può installare niente fuori dal proprio albero.
    Traversal { id: String, path: String },
    /// Un tema con questo id è già installato.
    AlreadyInstalled(String),
    /// Il disco ha detto di no: leggere, scrivere, rinominare.
    Io(String),
}

impl std::fmt::Display for ThemeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ThemeError::Engine { id, declared } => write!(
                f,
                "`{id}` speaks theme contract `{declared}`, but this host \
                 speaks `{THEME_ENGINE}`: will not install"
            ),
            ThemeError::Malformed(and) => write!(f, "malformed theme manifest: {and}"),
            ThemeError::Permissions { id } => write!(
                f,
                "`{id}` declares permissions, but a theme has none: will not install"
            ),
            ThemeError::InvalidId(and) => write!(f, "invalid theme id: {and}"),
            ThemeError::Traversal { id, path } => write!(
                f,
                "`{id}` contains `{path}`, which escapes the theme folder: will not install"
            ),
            ThemeError::AlreadyInstalled(and) => {
                write!(f, "theme already installed: {and}")
            }
            ThemeError::Io(and) => write!(f, "I/O error: {and}"),
        }
    }
}

impl std::error::Error for ThemeError {}

/// L'errore di un tema arriva a chi l'ha chiesto nella lingua del confine.
///
/// Le porte del manifest hanno un `kind` loro perché chi disegna deve poter
/// dire «è il tema» e non «hai sbagliato a chiedere»: il motore è un
/// [`Unserved`](PluginError::Unserved) (come il
/// [`BundleError::Abi`] → [`Unserved`](PluginError::Unserved) dei componenti),
/// la forma è un [`BadArgs`](PluginError::BadArgs), i permessi sono un
/// [`PermissionDenied`](PluginError::PermissionDenied), e i guasti del disco
/// restano quel che sono — [`AlreadyExists`](PluginError::AlreadyExists) per la
/// collisione, [`Io`](PluginError::Io) per il resto.
impl From<ThemeError> for PluginError {
    fn from(and: ThemeError) -> Self {
        match and {
            ThemeError::Engine { .. } => PluginError::Unserved(and.to_string().into()),
            ThemeError::Permissions { .. } => PluginError::PermissionDenied(and.to_string().into()),
            ThemeError::Malformed(_) | ThemeError::InvalidId(_) | ThemeError::Traversal { .. } => {
                PluginError::BadArgs(and.to_string().into())
            }
            ThemeError::AlreadyInstalled(_) => PluginError::AlreadyExists(and.to_string().into()),
            ThemeError::Io(_) => PluginError::Io(and.to_string().into()),
        }
    }
}

/// Un tema come bundle: il manifest letto e la cartella da cui è arrivato.
///
/// Il plugin è **solo i provider** — anzi, nessun provider: un tema non offre
/// nulla di eseguibile, e `OnlyProviders` è la forma di un bundle che non ne
/// ha. La fiducia è quella del default ([`Trust::Community`]) per un tema di
/// terze e [`Trust::Core`] per quello di serie, che è una feature ufficiale:
/// la stessa regola delle feature ufficiali in [`mount`](crate::mount).
pub struct ThemeBundle {
    manifest: ThemeManifest,
    trust: fub_kernel::Trust,
}

impl ThemeBundle {
    /// Il tema di serie: un valore, come [`CoreBundle`](crate::mount) — stessa
    /// regola delle feature ufficiali, che sono valori e non implementazioni.
    pub fn series() -> Self {
        ThemeBundle {
            manifest: series_manifest(),
            trust: fub_kernel::Trust::Core,
        }
    }

    /// Legge la cartella di un tema installato e valida le tre porte del
    /// manifest, **in questo ordine**: il motore (letto come stringa grezza,
    /// prima di deserializzare, così un tema-2 produce l'errore nominato e non
    /// un «unknown variant» di serde), i permessi (rifiutati per nome), la
    /// forma (deserializzazione piena + id sicuro + luci non vuote + namespace
    /// sotto `theme://`).
    pub fn load(dir: &Utf8Path) -> Result<Self, ThemeError> {
        let raw = std::fs::read_to_string(dir.join("manifest.json")).map_err(|and| {
            ThemeError::Malformed(format!("{}: {and}", dir.join("manifest.json")))
        })?;
        let value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|and| ThemeError::Malformed(format!("not JSON: {and}")))?;
        let id = value
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| ThemeError::Malformed("missing `id`".into()))?
            .to_string();
        let declared = value
            .get("engine")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(THEME_ENGINE);
        if declared != THEME_ENGINE {
            return Err(ThemeError::Engine {
                id,
                declared: declared.to_string(),
            });
        }
        if value.get("permissions").is_some() {
            return Err(ThemeError::Permissions { id });
        }
        let manifest: ThemeManifest =
            serde_json::from_value(value).map_err(|and| ThemeError::Malformed(format!("{and}")))?;
        if manifest.lights.is_empty() {
            return Err(ThemeError::Malformed("no lights declared".into()));
        }
        if !manifest.asset_namespace.starts_with("theme://") {
            return Err(ThemeError::Malformed(format!(
                "asset namespace `{}` is not under `theme://`",
                manifest.asset_namespace
            )));
        }
        check_id(&manifest.id)?;
        Ok(ThemeBundle {
            manifest,
            trust: fub_kernel::Trust::default(),
        })
    }
}

impl crate::registry::Bundle for ThemeBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(self.manifest.id.clone(), self.manifest.name.clone())
    }

    fn trust(&self) -> fub_kernel::Trust {
        self.trust
    }

    fn kind(&self) -> BundleKind {
        BundleKind::Theme
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, _ws: &mut fub_kernel::Workspace) -> Vec<String> {
        Vec::new()
    }
}

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
    let mut entries: Vec<_> = match std::fs::read_dir(&themes) {
        Ok(entries) => entries
            .flatten()
            .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.path()).ok())
            .collect(),
        // La cartella non c'è ancora: nessun tema, nessun errore.
        Err(_) => return (Vec::new(), Vec::new()),
    };
    entries.sort();

    let mut ok = Vec::new();
    let mut errors = Vec::new();
    for entry in entries {
        if entry.is_dir() {
            // Una cartella `.tmp-…` è una staging d'installazione, non un
            // tema: se il processo è morto a metà, resta lì fino alla
            // prossima installazione che la riusa (vedi [`install_theme`]).
            // Dirla «tema rotto» sarebbe gridare per un crash, e un tema che
            // non si chiama così non può usare il prefisso: `check_id` lo
            // respinge (iniziale `.`).
            if entry
                .file_name()
                .is_some_and(|name| name.starts_with(STAGING_PREFIX))
            {
                continue;
            }
            match ThemeBundle::load(&entry) {
                Ok(theme) => ok.push(theme),
                Err(and) => errors.push(and),
            }
        }
    }
    (ok, errors)
}

/// Un id di tema è sicuro come **componente di cartella**: un solo pezzo, non
/// vuoto, senza `.`/`..`, senza slash, senza iniziali di nascosto. È la forma
/// minima dell'identità di un tema installato — `config/themes/<id>/` — e la
/// strada che installa e disinstalla si fidano che non possa uscire dalla
/// cartella dei temi.
fn check_id(id: &str) -> Result<(), ThemeError> {
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
pub fn install_theme(config_dir: &Utf8Path, source: &Utf8Path) -> Result<Utf8PathBuf, ThemeError> {
    let theme = ThemeBundle::load(source)?;
    if theme.manifest.id == SERIES_ID {
        return Err(ThemeError::InvalidId(SERIES_ID.to_string()));
    }

    let themes_dir = crate::config::themes_dir(config_dir);
    let dest = themes_dir.join(&theme.manifest.id);
    if dest.exists() {
        return Err(ThemeError::AlreadyInstalled(theme.manifest.id.clone()));
    }
    std::fs::create_dir_all(&themes_dir)
        .map_err(|and| ThemeError::Io(format!("{}: {and}", themes_dir)))?;

    // Una cartella temporanea **dentro** `themes/`, con un nome che non può
    // collidere (l'id viene da una cartella con un manifest valido, ma un
    // installatore si difende anche dai propri errori). La si nomina con il
    // processo e un contatore globale, così due installazioni in parallelo non
    // si pestano i piedi.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let staging = themes_dir.join(format!("{STAGING_PREFIX}{}-{stamp}", std::process::id()));
    if staging.exists() {
        std::fs::remove_dir_all(&staging)
            .map_err(|and| ThemeError::Io(format!("{}: {and}", staging)))?;
    }
    std::fs::create_dir(&staging).map_err(|and| ThemeError::Io(format!("{}: {and}", staging)))?;

    let result = (|| {
        let source_root = source
            .canonicalize()
            .map_err(|and| ThemeError::Io(format!("{}: {and}", source)))?;
        let source_root = Utf8PathBuf::from_path_buf(source_root)
            .map_err(|and| ThemeError::Io(format!("non-UTF-8 source: {}", and.display())))?;
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
        match std::fs::rename(&staging, &dest) {
            Ok(()) => Ok(()),
            Err(and) => {
                if dest.exists() {
                    Err(ThemeError::AlreadyInstalled(theme.manifest.id.clone()))
                } else {
                    Err(ThemeError::Io(format!("{}: {and}", dest)))
                }
            }
        }
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result.map(|()| dest)
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
    let dest = crate::config::themes_dir(config_dir).join(id);
    if !dest.exists() {
        return Err(ThemeError::Io(format!("{}: no such theme", dest)));
    }
    std::fs::remove_dir_all(&dest).map_err(|and| ThemeError::Io(format!("{}: {and}", dest)))
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
        let from = Utf8PathBuf::from_path_buf(entry.path())
            .map_err(|and| ThemeError::Io(format!("non-UTF-8 path: {}", and.display())))?;
        let rel = from
            .strip_prefix(source_root)
            .expect("ogni voce sta dentro la radice che la enumera");
        let to = dest_root.join(rel);
        if file_type.is_dir() {
            std::fs::create_dir(&to).map_err(|and| ThemeError::Io(format!("{}: {and}", to)))?;
            copy_tree(source_root, dest_root, &from)?;
        } else {
            let canonical = from
                .canonicalize()
                .map_err(|and| ThemeError::Io(format!("{}: {and}", from)))?;
            if !canonical.starts_with(source_root) {
                return Err(ThemeError::Traversal {
                    id: "(install)".into(),
                    path: from.to_string(),
                });
            }
            std::fs::copy(&from, &to)
                .map_err(|and| ThemeError::Io(format!("{} -> {}: {and}", from, to)))?;
        }
    }
    Ok(())
}
