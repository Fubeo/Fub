//! Il tema come bundle: il manifest di serie, `ThemeError`, `ThemeBundle`
//! con il suo `Bundle`, e ciò che arriva alla shell (`ThemeInfo`, `ThemePayload`).

use super::*;

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
        settings: Vec::new(),
        extends: None,
        fonts: Vec::new(),
        icons: None,
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
    /// Il manifest dichiara un motore che non è fra i [`ThemeEngine`]
    /// conosciuti: un tema che questo host non serve, respinto prima di ogni
    /// altro passo.
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
                 speaks {}: will not install",
                ThemeEngine::ALL
                    .map(|engine| format!("`{}`", engine.as_str()))
                    .join(", ")
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
    pub(super) manifest: ThemeManifest,
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
    /// prima di deserializzare, così un motore sconosciuto produce l'errore
    /// nominato e non un «unknown variant» di serde), i permessi (rifiutati per
    /// nome), la forma (deserializzazione piena + id sicuro + luci non vuote +
    /// namespace sotto `theme://` + impostazioni dichiarabili + la base di
    /// `extends`, e un tema che eredita deve portare almeno un file).
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
        if ThemeEngine::parse(declared).is_none() {
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
        check_settings(&manifest)?;
        check_extends(&manifest)?;
        check_fonts(&manifest)?;
        // Check every well-known bundle file before any later copy/read. Missing
        // sheets and skin remain allowed here; read_theme/list_themes decide
        // whether a requested light is actually loadable.
        let mut brings = 0_u64;
        for name in ["sheet-dark.css", "sheet-light.css", "skin.css"] {
            if open_regular(
                &root.join(name),
                &root,
                &manifest.id,
                MAX_THEME_CSS_BYTES,
                false,
            )?
            .is_some()
            {
                brings += 1;
            }
        }
        brings += validate_asset_limits(&root, &manifest.id)?;
        check_font_files(&root, &manifest)?;
        check_icons(&root, &manifest)?;
        // Un tema che eredita e non porta niente — né fogli, né pelle, né un
        // asset (caratteri, icone) — è la serie con un altro nome: si dice
        // all'autore, invece di installare un doppione.
        if manifest.extends.is_some() && brings == 0 {
            return Err(ThemeError::Malformed(format!(
                "theme `{}` extends `{SERIES_ID}` but changes nothing: \
                 it brings no sheet, no skin and no asset",
                manifest.id
            )));
        }
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
    /// The core series is bundled by the host; installed bundles remain community code.
    pub trust: &'static str,
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
    /// Il foglio di questa luce. È `None` solo per un tema che eredita
    /// (`extends`) e non porta il foglio di questa luce: la shell usa allora
    /// quello di serie, della stessa luce e dello stesso contrasto.
    pub sheet: Option<String>,
    pub skin: Option<String>,
    pub assets: std::collections::BTreeMap<String, Vec<u8>>,
}

impl crate::registry::Bundle for ThemeBundle {
    fn manifest(&self) -> PluginManifest {
        let settings = self
            .manifest
            .settings
            .iter()
            .map(|setting| setting_spec(&self.manifest, setting))
            .collect();
        PluginManifest::new(self.manifest.id.clone(), self.manifest.name.clone())
            .configuring(settings)
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
