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
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};

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
/// Hard upper bound for the JSON manifest read from an installed theme.
pub const MAX_THEME_MANIFEST_BYTES: u64 = 64 * 1024;
/// Hard upper bound for each CSS sheet or optional skin.
pub const MAX_THEME_CSS_BYTES: u64 = 4 * 1024 * 1024;

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
        motion: vec![
            fub_abi::theme::ThemeMotion::Opacity,
            fub_abi::theme::ThemeMotion::Transform,
        ],
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
        let id_hint = dir.file_name().unwrap_or_default().to_string();
        let root = canonical_theme_root(dir, &id_hint)?;
        let manifest_path = root.join("manifest.json");
        let raw = read_theme_text(
            &manifest_path,
            &root,
            &id_hint,
            MAX_THEME_MANIFEST_BYTES,
            true,
        )?
        .expect("required manifest was checked by read_theme_text");
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
        let motion: std::collections::BTreeSet<_> = manifest.motion.iter().collect();
        if manifest.motion.len() != 2
            || motion.len() != 2
            || !manifest
                .motion
                .contains(&fub_abi::theme::ThemeMotion::Opacity)
            || !manifest
                .motion
                .contains(&fub_abi::theme::ThemeMotion::Transform)
        {
            return Err(ThemeError::Malformed(
                "motion must declare exactly opacity and transform".into(),
            ));
        }
        let expected_namespace = format!("theme://{}/", manifest.id);
        if manifest.asset_namespace != expected_namespace {
            return Err(ThemeError::Malformed(format!(
                "asset namespace `{}` does not equal `{expected_namespace}`",
                manifest.asset_namespace
            )));
        }
        check_id(&manifest.id)?;
        // Check every well-known bundle file before any later copy/read. Missing
        // sheets and skin remain allowed here; read_theme/list_themes decide
        // whether a requested light is actually loadable.
        for name in ["sheet-dark.css", "sheet-light.css", "skin.css"] {
            let _ = open_regular(
                &root.join(name),
                &root,
                &manifest.id,
                MAX_THEME_CSS_BYTES,
                false,
            )?;
        }
        validate_asset_limits(&root, &manifest.id)?;
        Ok(ThemeBundle {
            manifest,
            trust: fub_kernel::Trust::default(),
        })
    }
}
/// Metadati di un tema installato che la shell può davvero caricare.
///
/// L'inventario non espone il path della macchina e non include temi il cui
/// manifest è valido ma ha un foglio mancante o illeggibile. I cancelli CSS
/// restano della shell: qui si verifica solo che il trasporto possa fornire
/// i file dichiarati.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ThemeInfo {
    pub manifest: ThemeManifest,
}

/// Il fascio trasferito alla shell per una luce già scelta.
///
/// `assets` è un inventario di nomi, non un accesso al filesystem: il loader
/// della shell controlla che ogni URL resti nel namespace del manifest prima
/// di montare il CSS.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ThemePayload {
    pub manifest: ThemeManifest,
    pub light: ThemeLight,
    pub sheet: String,
    pub skin: Option<String>,
    pub assets: std::collections::BTreeMap<String, Vec<u8>>,
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

    fn register(&self, _registrar: &mut crate::registry::Registrar<'_>) -> Vec<String> {
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
        match ThemeBundle::load(&canonical) {
            Ok(theme) => ok.push(theme),
            Err(error) => errors.push(error),
        }
    }
    (ok, errors)
}
/// Elenca soltanto i temi installati per cui ogni luce dichiarata ha un foglio
/// leggibile. Il catalogo legge solo i metadati dei file, mai i loro byte.
pub fn list_themes(config_dir: &Utf8Path) -> Vec<ThemeInfo> {
    let (themes, _) = discover_themes(config_dir);
    themes
        .into_iter()
        .filter_map(|theme| {
            let manifest = theme.manifest.clone();
            let dir = installed_theme_dir(config_dir, &manifest.id).ok()?;
            let loadable = manifest.lights.iter().all(|light| {
                open_regular(
                    &sheet_path(&dir, *light),
                    &dir,
                    &manifest.id,
                    MAX_THEME_CSS_BYTES,
                    true,
                )
                .map(|file| file.is_some())
                .unwrap_or(false)
            });
            loadable.then_some(ThemeInfo { manifest })
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
    Ok(canonical)
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
    if !theme.manifest.lights.contains(&light) {
        return Err(ThemeError::Malformed(format!(
            "theme `{id}` does not offer requested light"
        )));
    }
    let sheet_path = sheet_path(&dir, light);
    let sheet = read_theme_text(&sheet_path, &dir, id, MAX_THEME_CSS_BYTES, true)?
        .ok_or_else(|| ThemeError::Malformed(format!("missing sheet `{sheet_path}`")))?;
    let skin_path = dir.join("skin.css");
    let skin = read_theme_text(&skin_path, &dir, id, MAX_THEME_CSS_BYTES, false)?;
    let needed = referenced_assets(&sheet, skin.as_deref(), &theme.manifest.asset_namespace);
    let assets = asset_inventory(&dir, &theme.manifest.asset_namespace, &needed)?;
    Ok(ThemePayload {
        manifest: theme.manifest,
        light,
        sheet,
        skin,
        assets,
    })
}

fn sheet_path(dir: &Utf8Path, light: ThemeLight) -> Utf8PathBuf {
    let name = match light {
        ThemeLight::Dark => "sheet-dark.css",
        ThemeLight::Light => "sheet-light.css",
    };
    dir.join(name)
}
fn referenced_assets(
    sheet: &str,
    skin: Option<&str>,
    namespace: &str,
) -> std::collections::BTreeSet<String> {
    let mut urls = std::collections::BTreeSet::new();
    for css in [Some(sheet), skin] {
        let Some(css) = css else { continue };
        let chars: Vec<char> = css.chars().collect();
        let mut index = 0;
        while index < chars.len() {
            if chars[index..].starts_with(&['/', '*']) {
                index = css_skip_comment(&chars, index);
                continue;
            }
            if chars[index] == '\'' || chars[index] == '"' {
                index = css_skip_quoted(&chars, index).unwrap_or(chars.len());
                continue;
            }
            let Some((name, next)) = css_identifier(&chars, index) else {
                index += 1;
                continue;
            };
            let open = css_skip_trivia(&chars, next, chars.len());
            let name = name.to_ascii_lowercase();
            if chars.get(open).copied() == Some('(') {
                if name == "url" {
                    if let Some((value, after)) = css_url_at(&chars, open) {
                        if value.starts_with(namespace) {
                            urls.insert(value);
                        }
                        index = after;
                        continue;
                    }
                } else if css_image_set_name(&name) {
                    css_collect_image_set(&chars, open, namespace, &mut urls);
                    if let Some(close) = css_function_close(&chars, open) {
                        index = close + 1;
                        continue;
                    }
                }
            }
            index = next;
        }
    }
    urls
}

fn css_skip_comment(chars: &[char], start: usize) -> usize {
    let mut index = start.saturating_add(2);
    while index + 1 < chars.len() {
        if chars[index] == '*' && chars[index + 1] == '/' {
            return index + 2;
        }
        index += 1;
    }
    chars.len()
}

fn css_decode_escape(chars: &[char], start: usize) -> (String, usize) {
    let mut index = start.saturating_add(1);
    if index >= chars.len() {
        return (String::new(), index);
    }
    let hex_start = index;
    while index < chars.len() && index - hex_start < 6 && chars[index].is_ascii_hexdigit() {
        index += 1;
    }
    if index > hex_start {
        let mut code = 0_u32;
        for character in &chars[hex_start..index] {
            code = code * 16
                + character
                    .to_digit(16)
                    .expect("is_ascii_hexdigit implies to_digit succeeds");
        }
        if index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        let value = if code == 0 || code > 0x10ffff {
            '\u{fffd}'
        } else {
            char::from_u32(code).unwrap_or('\u{fffd}')
        };
        return (value.to_string(), index);
    }
    if matches!(chars[index], '\n' | '\r' | '\u{000c}') {
        return (String::new(), index + 1);
    }
    (chars[index].to_string(), index + 1)
}

fn css_skip_quoted(chars: &[char], start: usize) -> Option<usize> {
    let quote = *chars.get(start)?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let mut index = start + 1;
    while index < chars.len() {
        if chars[index] == '\\' {
            index = css_decode_escape(chars, index).1;
        } else if chars[index] == quote {
            return Some(index + 1);
        } else {
            index += 1;
        }
    }
    None
}

fn css_identifier(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut value = String::new();
    let mut index = start;
    while index < chars.len() {
        let character = chars[index];
        if character == '\\' {
            let (decoded, next) = css_decode_escape(chars, index);
            value.push_str(&decoded);
            index = next;
        } else if character == '-'
            || character == '_'
            || character.is_ascii_alphanumeric()
            || !character.is_ascii()
        {
            value.push(character);
            index += 1;
        } else {
            break;
        }
    }
    (!value.is_empty()).then_some((value, index))
}

fn css_skip_trivia(chars: &[char], start: usize, end: usize) -> usize {
    let mut index = start;
    while index < end {
        if chars[index].is_whitespace() {
            index += 1;
        } else if index + 1 < end && chars[index] == '/' && chars[index + 1] == '*' {
            index = css_skip_comment(chars, index).min(end);
        } else {
            break;
        }
    }
    index
}

fn css_function_close(chars: &[char], open: usize) -> Option<usize> {
    let mut depth = 1_u32;
    let mut index = open + 1;
    while index < chars.len() {
        if index + 1 < chars.len() && chars[index] == '/' && chars[index + 1] == '*' {
            index = css_skip_comment(chars, index);
        } else if chars[index] == '\'' || chars[index] == '"' {
            index = css_skip_quoted(chars, index)?;
        } else if chars[index] == '\\' {
            index = css_decode_escape(chars, index).1;
        } else if chars[index] == '(' {
            depth += 1;
            index += 1;
        } else if chars[index] == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
            index += 1;
        } else {
            index += 1;
        }
    }
    None
}

fn css_string(chars: &[char], start: usize, end: usize) -> String {
    chars[start..end].iter().collect()
}

fn css_trim_range(chars: &[char], start: usize, end: usize) -> (usize, usize) {
    let mut value_start = start;
    let mut value_end = end;
    while value_start < value_end && chars[value_start].is_whitespace() {
        value_start += 1;
    }
    while value_end > value_start && chars[value_end - 1].is_whitespace() {
        value_end -= 1;
    }
    (value_start, value_end)
}

fn css_url_at(chars: &[char], open: usize) -> Option<(String, usize)> {
    let close = css_function_close(chars, open)?;
    let mut cursor = css_skip_trivia(chars, open + 1, close);
    if cursor >= close {
        return Some((String::new(), close + 1));
    }
    if chars[cursor] == '\'' || chars[cursor] == '"' {
        let quote = chars[cursor];
        let quote_end = css_skip_quoted(chars, cursor)?;
        if quote_end > close || chars.get(quote_end.saturating_sub(1)) != Some(&quote) {
            return None;
        }
        let (value_start, value_end) = css_trim_range(chars, cursor + 1, quote_end - 1);
        let value = decode_css_escapes(&css_string(chars, value_start, value_end))
            .trim()
            .to_string();
        cursor = css_skip_trivia(chars, quote_end, close);
        return (cursor == close).then_some((value, close + 1));
    }
    let value_start = cursor;
    while cursor < close {
        if chars[cursor] == '\\' {
            cursor = css_decode_escape(chars, cursor).1;
        } else {
            cursor += 1;
        }
    }
    let (value_start, value_end) = css_trim_range(chars, value_start, cursor);
    let value = decode_css_escapes(&css_string(chars, value_start, value_end))
        .trim()
        .to_string();
    Some((value, close + 1))
}

fn css_image_set_name(name: &str) -> bool {
    matches!(name, "image-set" | "-webkit-image-set")
}

fn css_top_level_ranges(chars: &[char], start: usize, end: usize) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut depth = 0_u32;
    let mut piece = start;
    let mut index = start;
    while index < end {
        if index + 1 < end && chars[index] == '/' && chars[index + 1] == '*' {
            index = css_skip_comment(chars, index).min(end);
        } else if chars[index] == '\'' || chars[index] == '"' {
            index = css_skip_quoted(chars, index).unwrap_or(end).min(end);
        } else if chars[index] == '\\' {
            index = css_decode_escape(chars, index).1.min(end);
        } else if chars[index] == '(' {
            depth += 1;
            index += 1;
        } else if chars[index] == ')' {
            depth = depth.saturating_sub(1);
            index += 1;
        } else if chars[index] == ',' && depth == 0 {
            ranges.push((piece, index));
            piece = index + 1;
            index += 1;
        } else {
            index += 1;
        }
    }
    ranges.push((piece, end));
    ranges
}

fn css_collect_image_set(
    chars: &[char],
    open: usize,
    namespace: &str,
    urls: &mut std::collections::BTreeSet<String>,
) {
    let Some(close) = css_function_close(chars, open) else {
        return;
    };
    for (start, end) in css_top_level_ranges(chars, open + 1, close) {
        let cursor = css_skip_trivia(chars, start, end);
        if cursor >= end {
            continue;
        }
        if chars[cursor] == '\'' || chars[cursor] == '"' {
            let quote = chars[cursor];
            let Some(quote_end) = css_skip_quoted(chars, cursor) else {
                continue;
            };
            if quote_end > end || chars.get(quote_end.saturating_sub(1)) != Some(&quote) {
                continue;
            }
            let (value_start, value_end) = css_trim_range(chars, cursor + 1, quote_end - 1);
            let value = decode_css_escapes(&css_string(chars, value_start, value_end))
                .trim()
                .to_string();
            if value.starts_with(namespace) {
                urls.insert(value);
            }
            continue;
        }
        let Some((name, next)) = css_identifier(chars, cursor) else {
            continue;
        };
        if !name.eq_ignore_ascii_case("url") {
            continue;
        }
        let image_open = css_skip_trivia(chars, next, end);
        if chars.get(image_open).copied() != Some('(') {
            continue;
        }
        let Some(image_close) = css_function_close(chars, image_open) else {
            continue;
        };
        if image_close >= end {
            continue;
        }
        if let Some((value, _)) = css_url_at(chars, image_open) {
            if value.starts_with(namespace) {
                urls.insert(value);
            }
        }
    }
}

fn decode_css_escapes(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '\\' {
            output.push(chars[index]);
            index += 1;
            continue;
        }
        index += 1;
        if index >= chars.len() {
            break;
        }
        let hex_start = index;
        while index < chars.len() && index - hex_start < 6 && chars[index].is_ascii_hexdigit() {
            index += 1;
        }
        if index > hex_start {
            let mut code = 0_u32;
            for character in &chars[hex_start..index] {
                code = code * 16
                    + character
                        .to_digit(16)
                        .expect("is_ascii_hexdigit implies to_digit succeeds");
            }
            if index < chars.len() && chars[index].is_whitespace() {
                index += 1;
            }
            output.push(
                char::from_u32(if code == 0 || code > 0x10ffff {
                    0xfffd
                } else {
                    code
                })
                .expect("validated Unicode scalar value"),
            );
        } else if matches!(chars[index], '\n' | '\r' | '\u{000c}') {
            index += 1;
        } else {
            output.push(chars[index]);
            index += 1;
        }
    }
    output
}

fn asset_inventory(
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
const MAX_THEME_ASSET_BYTES: u64 = 64 * 1024 * 1024;
const MAX_THEME_ASSET_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

fn validate_asset_limits(root: &Utf8Path, id: &str) -> Result<(), ThemeError> {
    let mut count = 0_u64;
    let mut total = 0_u64;
    validate_asset_limits_in(root, root, id, &mut count, &mut total)?;
    Ok(())
}

fn validate_asset_limits_in(
    root: &Utf8Path,
    dir: &Utf8Path,
    id: &str,
    count: &mut u64,
    total: &mut u64,
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
            validate_asset_limits_in(root, &path, id, count, total)?;
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

/// Capability opened for the installed-theme root.
///
/// `path` is only the diagnostic/canonical name. Filesystem operations that
/// remove or enumerate entries use `dir`, so replacing `config/themes` after
/// this handle is opened cannot redirect those operations to another tree.
struct ThemesRoot {
    path: Utf8PathBuf,
    dir: cap_std::fs::Dir,
    identity: std::fs::Metadata,
}

fn open_themes_root(config_dir: &Utf8Path, id: &str) -> Result<Option<ThemesRoot>, ThemeError> {
    let themes = crate::config::themes_dir(config_dir);
    let metadata = match std::fs::symlink_metadata(&themes) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(ThemeError::Io(format!("{themes}: {error}"))),
    };
    if metadata.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: themes.to_string(),
        });
    }
    if !metadata.is_dir() {
        return Err(ThemeError::Malformed(format!(
            "themes root `{themes}` is not a directory"
        )));
    }

    let parent = themes.parent().unwrap_or(&themes);
    let canonical_parent = Utf8PathBuf::from_path_buf(
        parent
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{parent}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    let canonical = Utf8PathBuf::from_path_buf(
        themes
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{themes}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if !canonical.starts_with(&canonical_parent) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }

    // Open the root without following its final symlink/reparse point. The
    // second metadata/canonical check closes the ordinary path-based race
    // around this open; the capability remains the authority afterwards.
    let (dir, identity) = match open_directory_nofollow(&themes) {
        Ok(opened) => opened,
        Err(error) => {
            if std::fs::symlink_metadata(&themes)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
            {
                return Err(ThemeError::Traversal {
                    id: id.to_string(),
                    path: themes.to_string(),
                });
            }
            return Err(ThemeError::Io(format!("{themes}: {error}")));
        }
    };
    let after = std::fs::symlink_metadata(&themes)
        .map_err(|error| ThemeError::Io(format!("{themes}: {error}")))?;
    if after.file_type().is_symlink() || !after.is_dir() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: themes.to_string(),
        });
    }
    let current = Utf8PathBuf::from_path_buf(
        themes
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{themes}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if current != canonical {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: current.to_string(),
        });
    }
    let canonical_metadata = std::fs::metadata(&canonical)
        .map_err(|error| ThemeError::Io(format!("{canonical}: {error}")))?;
    #[cfg(unix)]
    if !same_file(&identity, &canonical_metadata) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: themes.to_string(),
        });
    }
    Ok(Some(ThemesRoot {
        path: canonical,
        dir,
        identity,
    }))
}

fn verify_themes_root(root: &ThemesRoot, id: &str) -> Result<(), ThemeError> {
    let metadata = std::fs::symlink_metadata(&root.path)
        .map_err(|error| ThemeError::Io(format!("{}: {error}", root.path)))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: root.path.to_string(),
        });
    }
    let canonical = Utf8PathBuf::from_path_buf(
        root.path
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{}: {error}", root.path)))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if canonical != root.path {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }
    let canonical_metadata = std::fs::metadata(&canonical)
        .map_err(|error| ThemeError::Io(format!("{canonical}: {error}")))?;
    #[cfg(unix)]
    if !same_file(&root.identity, &canonical_metadata) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: root.path.to_string(),
        });
    }
    Ok(())
}

fn canonical_theme_root(dir: &Utf8Path, id: &str) -> Result<Utf8PathBuf, ThemeError> {
    let before = std::fs::symlink_metadata(dir)
        .map_err(|error| ThemeError::Io(format!("{dir}: {error}")))?;
    if before.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: dir.to_string(),
        });
    }
    if !before.is_dir() {
        return Err(ThemeError::Malformed(format!(
            "theme root `{dir}` is not a directory"
        )));
    }

    let parent = dir.parent().unwrap_or(dir);
    let canonical_parent = Utf8PathBuf::from_path_buf(
        parent
            .canonicalize()
            .map_err(|error| ThemeError::Io(format!("{parent}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    let canonical = Utf8PathBuf::from_path_buf(
        dir.canonicalize()
            .map_err(|error| ThemeError::Io(format!("{dir}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if !canonical.starts_with(&canonical_parent) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }
    let after = std::fs::symlink_metadata(dir)
        .map_err(|error| ThemeError::Io(format!("{dir}: {error}")))?;
    if after.file_type().is_symlink() || !after.is_dir() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: dir.to_string(),
        });
    }
    let canonical_metadata = std::fs::metadata(&canonical)
        .map_err(|error| ThemeError::Io(format!("{canonical}: {error}")))?;
    if !same_file(&before, &canonical_metadata) || !same_file(&after, &canonical_metadata) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: dir.to_string(),
        });
    }
    Ok(canonical)
}

fn open_directory_nofollow(path: &Utf8Path) -> io::Result<(cap_std::fs::Dir, std::fs::Metadata)> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let flags = rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::DIRECTORY;
        options.custom_flags(flags.bits() as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    let identity = file.metadata()?;
    Ok((cap_std::fs::Dir::from_std_file(file), identity))
}

fn open_nofollow(path: &Utf8Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let flags = (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits();
        options.custom_flags(flags as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}
fn create_nofollow(path: &Utf8Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

fn open_regular(
    path: &Utf8Path,
    root: &Utf8Path,
    id: &str,
    limit: u64,
    required: bool,
) -> Result<Option<File>, ThemeError> {
    let before = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound && !required => return Ok(None),
        Err(error) => return Err(ThemeError::Io(format!("{path}: {error}"))),
    };
    if before.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: path.to_string(),
        });
    }
    if !before.is_file() {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` is not a regular file"
        )));
    }
    if before.len() > limit {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` exceeds {limit} bytes"
        )));
    }

    let file = match open_nofollow(path) {
        Ok(file) => file,
        Err(error) => {
            if let Ok(metadata) = std::fs::symlink_metadata(path) {
                if metadata.file_type().is_symlink() {
                    return Err(ThemeError::Traversal {
                        id: id.to_string(),
                        path: path.to_string(),
                    });
                }
            }
            return Err(ThemeError::Io(format!("{path}: {error}")));
        }
    };
    let descriptor_metadata = file
        .metadata()
        .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?;
    if !descriptor_metadata.is_file() {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` is not a regular file"
        )));
    }
    if descriptor_metadata.len() > limit {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` exceeds {limit} bytes"
        )));
    }
    let canonical = Utf8PathBuf::from_path_buf(
        path.canonicalize()
            .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?,
    )
    .map_err(|path| ThemeError::Io(format!("non-UTF-8 path: {}", path.display())))?;
    if !canonical.starts_with(root) {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: canonical.to_string(),
        });
    }
    let canonical_metadata = std::fs::metadata(&canonical)
        .map_err(|error| ThemeError::Io(format!("{canonical}: {error}")))?;
    let after = std::fs::symlink_metadata(path)
        .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?;
    if after.file_type().is_symlink() {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: path.to_string(),
        });
    }
    if !after.is_file() {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` is not a regular file"
        )));
    }
    if !same_file(&descriptor_metadata, &canonical_metadata)
        || !same_file(&descriptor_metadata, &after)
    {
        return Err(ThemeError::Traversal {
            id: id.to_string(),
            path: path.to_string(),
        });
    }
    Ok(Some(file))
}

fn read_theme_bytes(
    path: &Utf8Path,
    root: &Utf8Path,
    id: &str,
    limit: u64,
    required: bool,
) -> Result<Option<Vec<u8>>, ThemeError> {
    let Some(file) = open_regular(path, root, id, limit, required)? else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?;
    if bytes.len() as u64 > limit {
        return Err(ThemeError::Malformed(format!(
            "theme file `{path}` exceeds {limit} bytes"
        )));
    }
    Ok(Some(bytes))
}

fn read_theme_text(
    path: &Utf8Path,
    root: &Utf8Path,
    id: &str,
    limit: u64,
    required: bool,
) -> Result<Option<String>, ThemeError> {
    let Some(bytes) = read_theme_bytes(path, root, id, limit, required)? else {
        return Ok(None);
    };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|error| ThemeError::Malformed(format!("{path}: invalid UTF-8: {error}")))
}

#[cfg(unix)]
fn same_file(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_file(_left: &std::fs::Metadata, _right: &std::fs::Metadata) -> bool {
    true
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
    let source_id = source.file_name().unwrap_or_default().to_string();
    let source_root = canonical_theme_root(source, &source_id)?;
    let theme = ThemeBundle::load(&source_root)?;
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
