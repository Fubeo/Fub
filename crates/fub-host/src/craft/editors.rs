//! Gli editor esterni delle app Craft: dove sono installati e come si chiamano.
//!
//! [`EDITORS`] è la tabella delle sette app che Fub conosce: che cosa aprono,
//! come si chiama il loro programma, su quali sistemi tengono una finestra
//! sola e come si parla con l'app aperta. [`detect`] cerca dove sono
//! installate su questa macchina, [`find`] fa lo stesso con una cache di 30
//! secondi, perché il menu «Apri con» non rifaccia le ricerche a ogni clic.
//!
//! Questo modulo **non avvia niente**: guarda i metadati dei file, segue un
//! link simbolico una volta e legge `installed.json` del launcher con un tetto
//! di [`MAX_INSTALLED_JSON`]. Non chiede mai a una shell né al `PATH` di
//! sistema dove sta un programma per nome nudo: un programma conta solo se sta
//! in uno dei posti scritti qui, o in quello che la persona ha scritto in
//! `craft.editor-paths`. L'ambiente vero si legge solo in
//! [`Env::from_process`]; tutto il resto lavora sull'[`Env`] che riceve, così i
//! test provano le regole di Linux, macOS e Windows su qualunque sistema.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Il tetto di `installed.json`: un file più grande vale un file che non c'è.
pub const MAX_INSTALLED_JSON: u64 = 1024 * 1024;

/// Quanto vale una ricerca di [`find`] prima di rifarla.
pub const FIND_TTL: Duration = Duration::from_secs(30);

/// Il prefisso dell'id Flatpak delle app Craft: `ai.storyteller.{id}`.
pub const FLATPAK_PREFIX: &str = "ai.storyteller.";

/// Un sistema operativo, per le regole dei percorsi e per l'istanza singola.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Os {
    Linux,
    Windows,
    MacOs,
}

impl Os {
    /// Il sistema su cui gira Fub. Gli unix che non sono macOS seguono le
    /// regole di Linux.
    pub fn current() -> Os {
        if cfg!(target_os = "windows") {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::MacOs
        } else {
            Os::Linux
        }
    }
}

/// Come un'app aperta riconosce chi le parla.
///
/// Solo [`Auth::Token`] apre un canale (D-2): un canale con [`Auth::None`]
/// lo potrebbe usare qualunque programma della macchina, e [`Auth::Key`] ha
/// un formato che nessuno ha documentato. Sono dati della tabella e basta.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Auth {
    /// Nessuna autenticazione: il canale non si usa mai.
    None,
    /// Un token scelto da chi avvia l'app; `env` è la variabile d'ambiente in
    /// cui l'app lo legge, se il passo la nomina.
    Token { env: Option<&'static str> },
    /// Una «chiave» dal formato non noto: il canale non si usa mai.
    Key,
}

/// La cornice dei messaggi sul canale di controllo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    /// Un oggetto JSON per riga.
    Line,
    /// JSON-RPC 2.0.
    JsonRpc2,
}

/// Il canale di controllo di un'app, come lo descrive il passo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Control {
    /// Il metodo che apre un file nell'app aperta, se il passo lo nomina.
    pub method: Option<&'static str>,
    pub protocol: Protocol,
    pub auth: Auth,
    /// Se si sa su quale porta l'app ascolta.
    pub port_known: bool,
}

impl Control {
    /// Se Fub può usare questo canale: un metodo, un token e una porta nota.
    /// Il `match` è esaustivo perché un'autenticazione nuova debba decidere.
    pub fn usable(&self) -> bool {
        let auth = match self.auth {
            Auth::Token { .. } => true,
            Auth::None | Auth::Key => false,
        };
        auth && self.method.is_some() && self.port_known
    }
}

/// Un'app Craft che Fub conosce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Editor {
    /// L'id, lo stesso di `CraftApp::id` per le app che hanno un formato.
    pub id: &'static str,
    /// Il nome da mostrare, e quello delle cartelle e degli AppImage.
    pub name: &'static str,
    /// Le estensioni che l'app apre, minuscole e senza il punto.
    pub opens: &'static [&'static str],
    /// Il programma con l'interfaccia, senza `.exe`.
    pub gui: &'static str,
    /// Il programma a riga di comando che fa le anteprime, se l'app lo ha.
    pub cli: Option<&'static str>,
    /// I sistemi su cui l'app tiene una finestra sola e passa il file a quella.
    pub single_instance: &'static [Os],
    pub control: Control,
}

const NO_CHANNEL: Control = Control {
    method: None,
    protocol: Protocol::Line,
    auth: Auth::None,
    port_known: false,
};

/// Le app che Fub conosce, dal passo («Le app che Fub conosce» del piano N7).
pub const EDITORS: &[Editor] = &[
    Editor {
        id: "vectorcraft",
        name: "VectorCraft",
        opens: &["vectorcraft", "drawcraft", "svg", "ai", "eps", "pdf"],
        gui: "vectorcraft",
        cli: Some("vectorcraft-cli"),
        single_instance: &[],
        control: Control {
            method: Some("app.open"),
            protocol: Protocol::Line,
            auth: Auth::None,
            port_known: false,
        },
    },
    Editor {
        id: "photocraft",
        name: "PhotoCraft",
        opens: &[
            "pcraft", "psd", "psb", "tif", "tiff", "png", "jpg", "jpeg", "kra", "xcf", "ora",
        ],
        gui: "photocraft",
        cli: Some("photocraft-cli"),
        single_instance: &[Os::Linux, Os::Windows],
        control: Control {
            method: Some("app.open"),
            protocol: Protocol::Line,
            auth: Auth::Token { env: None },
            port_known: false,
        },
    },
    Editor {
        id: "lightcraft",
        name: "LightCraft",
        opens: &[
            "cr3", "cr2", "nef", "arw", "raf", "dng", "orf", "rw2", "heic", "jpg", "jpeg",
        ],
        gui: "lightcraft",
        cli: Some("lightcraft-cli"),
        single_instance: &[],
        control: NO_CHANNEL,
    },
    Editor {
        id: "pdfcraft",
        name: "PdfCraft",
        opens: &["pdf"],
        gui: "pdfcraft",
        cli: Some("pdfcraft-cli"),
        single_instance: &[Os::Linux, Os::Windows],
        control: Control {
            method: Some("ui.open"),
            protocol: Protocol::JsonRpc2,
            auth: Auth::Token { env: None },
            port_known: false,
        },
    },
    Editor {
        id: "figcraft",
        name: "FigCraft",
        opens: &["figcraft", "fig"],
        gui: "figcraft",
        cli: Some("figcraft-cli"),
        single_instance: &[],
        control: NO_CHANNEL,
    },
    Editor {
        id: "gridcraft",
        name: "GridCraft",
        opens: &["xlsx", "csv", "tsv"],
        gui: "gridcraft",
        cli: None,
        single_instance: &[],
        control: Control {
            method: Some("app.open"),
            protocol: Protocol::Line,
            auth: Auth::Token {
                env: Some("GRIDCRAFT_CONTROL_TOKEN"),
            },
            port_known: false,
        },
    },
    Editor {
        id: "wordcraft",
        name: "WordCraft",
        opens: &["docx", "odt", "rtf", "doc"],
        gui: "wordcraft",
        cli: Some("wordcraft-cli"),
        single_instance: &[],
        control: Control {
            method: Some("engine.execute"),
            protocol: Protocol::Line,
            auth: Auth::Key,
            port_known: false,
        },
    },
];

/// L'app con questo id, se Fub la conosce.
pub fn editor(id: &str) -> Option<&'static Editor> {
    EDITORS.iter().find(|editor| editor.id == id)
}

/// Se `editor` apre un file con questa estensione. Un punto davanti non conta
/// (`.JPG`), e le maiuscole nemmeno: le estensioni della tabella sono ASCII.
pub fn opens(editor: &Editor, extension: &str) -> bool {
    let extension = extension.strip_prefix('.').unwrap_or(extension);
    editor
        .opens
        .iter()
        .any(|known| known.eq_ignore_ascii_case(extension))
}

/// I posti della macchina in cui si cercano le app. [`Env::from_process`]
/// legge quelli veri; un test ne costruisce uno su una cartella finta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Env {
    /// La cartella di casa (`HOME`, `USERPROFILE` su Windows), se c'è.
    pub home: Option<PathBuf>,
    pub os: Os,
    /// Il `PATH` di sistema. Nessuna regola lo usa per cercare un programma:
    /// sta qui perché chi avvia un programma sappia in che ambiente lo fa.
    pub path: Vec<PathBuf>,
    /// La cartella dei dati locali, dove sta `artcraft-launcher/installed.json`.
    pub local_data: Option<PathBuf>,
    /// `%ProgramFiles%` su Windows.
    pub program_files: Option<PathBuf>,
    /// `%LOCALAPPDATA%` su Windows.
    pub local_app_data: Option<PathBuf>,
    /// Le cartelle `flatpak/app` in cui si cercano i Flatpak, nell'ordine.
    pub flatpak_roots: Vec<PathBuf>,
    /// La radice dei percorsi di sistema (`/usr/bin`, `/Applications`): `/`
    /// fuori dai test.
    pub root: PathBuf,
}

impl Env {
    /// I posti veri di questa macchina, dalle variabili d'ambiente del
    /// processo. Una variabile vuota o con un percorso relativo vale una
    /// variabile che non c'è.
    pub fn from_process() -> Env {
        let os = Os::current();
        let var = |name: &str| {
            std::env::var_os(name)
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
        };
        let home = match os {
            Os::Windows => var("USERPROFILE").or_else(|| var("HOME")),
            Os::Linux | Os::MacOs => var("HOME"),
        };
        let local_app_data = var("LOCALAPPDATA");
        let local_data = match os {
            Os::Windows => local_app_data.clone(),
            Os::MacOs => home
                .as_ref()
                .map(|home| home.join("Library").join("Application Support")),
            Os::Linux => var("XDG_DATA_HOME")
                .or_else(|| home.as_ref().map(|home| home.join(".local").join("share"))),
        };
        let mut flatpak_roots = Vec::new();
        if os == Os::Linux {
            if let Some(home) = &home {
                flatpak_roots.push(home.join(".local/share/flatpak/app"));
            }
            flatpak_roots.push(PathBuf::from("/var/lib/flatpak/app"));
        }
        let path = std::env::var_os("PATH")
            .map(|value| std::env::split_paths(&value).collect())
            .unwrap_or_default();
        Env {
            home,
            os,
            path,
            local_data,
            program_files: var("ProgramFiles"),
            local_app_data,
            flatpak_roots,
            root: PathBuf::from("/"),
        }
    }
}

/// Come si avvia il programma con l'interfaccia di un'app trovata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Launch {
    /// Un programma da avviare col suo percorso.
    Program(PathBuf),
    /// Un Flatpak, col suo id (`ai.storyteller.vectorcraft`).
    Flatpak(String),
    /// Un pacchetto `.app` di macOS.
    MacApp(PathBuf),
}

/// Dove Fub ha trovato il programma con l'interfaccia.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum How {
    /// Una riga di `craft.editor-paths`.
    Setting,
    /// `installed.json` del launcher.
    Launcher,
    /// Un posto di sistema o della cartella di casa (`/usr/bin`,
    /// `~/.local/bin`, `/Applications`, `Program Files`).
    Standard,
    /// Un AppImage in `~/Applications` o `~/AppImages`.
    AppImage,
    /// Un Flatpak dell'utente o del sistema.
    Flatpak,
    /// Non installata: nessun programma con l'interfaccia.
    Missing,
}

/// Un'app di [`EDITORS`] con ciò che si è trovato di lei.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub id: &'static str,
    /// Il programma con l'interfaccia; `None` è «Non installata».
    pub gui: Option<Launch>,
    /// Il programma a riga di comando, per le app che ne hanno uno.
    pub cli: Option<PathBuf>,
    /// Dove si è trovato `gui`.
    pub how: How,
}

impl Found {
    /// Se l'app si può aprire.
    pub fn installed(&self) -> bool {
        self.gui.is_some()
    }
}

/// Le righe di `craft.editor-paths` che valgono: `id=percorso` o
/// `id-cli=percorso`, con un id della tabella e un percorso assoluto. Per lo
/// stesso programma vince l'ultima riga.
#[derive(Debug, Default)]
struct Overrides {
    gui: Vec<(&'static str, PathBuf)>,
    cli: Vec<(&'static str, PathBuf)>,
}

impl Overrides {
    fn parse(lines: &[String]) -> Overrides {
        let mut out = Overrides::default();
        for line in lines {
            let Some((name, path)) = line.split_once('=') else {
                continue;
            };
            let (name, path) = (name.trim(), PathBuf::from(path.trim()));
            if !path.is_absolute() {
                continue;
            }
            if let Some(editor) = EDITORS.iter().find(|editor| editor.gui == name) {
                out.gui.retain(|(id, _)| *id != editor.id);
                out.gui.push((editor.id, path));
            } else if let Some(editor) = EDITORS.iter().find(|editor| editor.cli == Some(name)) {
                out.cli.retain(|(id, _)| *id != editor.id);
                out.cli.push((editor.id, path));
            }
        }
        out
    }

    fn gui(&self, id: &str) -> Option<&Path> {
        self.gui
            .iter()
            .find(|(known, _)| *known == id)
            .map(|(_, path)| path.as_path())
    }

    fn cli(&self, id: &str) -> Option<&Path> {
        self.cli
            .iter()
            .find(|(known, _)| *known == id)
            .map(|(_, path)| path.as_path())
    }
}

/// Dove sono installate le app di [`EDITORS`], una riga per app e nell'ordine
/// della tabella.
///
/// Per il programma con l'interfaccia, il primo che c'è fra: la riga di
/// `craft.editor-paths` (`overrides`), `installed.json` del launcher, i posti
/// del sistema di `env`. Per la riga di comando: la riga di
/// `craft.editor-paths`, poi accanto al programma trovato, poi `~/.local/bin`
/// (Linux e macOS). Un percorso che non è un programma (sparito, una
/// cartella, senza il bit di esecuzione su unix) non conta, e si passa al
/// posto dopo.
pub fn detect(env: &Env, overrides: &[String]) -> Vec<Found> {
    let overrides = Overrides::parse(overrides);
    let launcher = launcher_entries(env);
    EDITORS
        .iter()
        .map(|editor| detect_one(env, editor, &overrides, &launcher))
        .collect()
}

fn detect_one(
    env: &Env,
    editor: &'static Editor,
    overrides: &Overrides,
    launcher: &[(String, PathBuf)],
) -> Found {
    let from_setting = overrides
        .gui(editor.id)
        .and_then(|path| as_launch(env, path))
        .map(|launch| (launch, How::Setting));
    let from_launcher = || {
        launcher
            .iter()
            .filter(|(id, _)| id == editor.id)
            .find_map(|(_, path)| as_launch(env, path))
            .map(|launch| (launch, How::Launcher))
    };
    let (gui, how) = match from_setting
        .or_else(from_launcher)
        .or_else(|| standard(env, editor))
    {
        Some((launch, how)) => (Some(launch), how),
        None => (None, How::Missing),
    };
    let cli = editor.cli.and_then(|cli| {
        overrides
            .cli(editor.id)
            .filter(|path| is_program(env, path))
            .map(Path::to_path_buf)
            .or_else(|| beside(env, gui.as_ref(), cli))
            .or_else(|| in_local_bin(env, cli))
    });
    Found {
        id: editor.id,
        gui,
        cli,
        how,
    }
}

/// Un percorso scritto dalla persona o dal launcher come programma da avviare:
/// un `.app` su macOS, altrimenti un file eseguibile.
fn as_launch(env: &Env, path: &Path) -> Option<Launch> {
    if env.os == Os::MacOs && is_mac_app(path) {
        return Some(Launch::MacApp(path.to_path_buf()));
    }
    is_program(env, path).then(|| Launch::Program(path.to_path_buf()))
}

/// I posti di sistema e della cartella di casa, nell'ordine del sistema.
fn standard(env: &Env, editor: &Editor) -> Option<(Launch, How)> {
    match env.os {
        Os::Linux => {
            let mut programs = vec![env.root.join("usr/bin").join(editor.gui)];
            if let Some(home) = &env.home {
                programs.push(home.join(".local/bin").join(editor.gui));
            }
            programs
                .into_iter()
                .find(|path| is_program(env, path))
                .map(|path| (Launch::Program(path), How::Standard))
                .or_else(|| {
                    appimage(env, editor).map(|path| (Launch::Program(path), How::AppImage))
                })
                .or_else(|| flatpak(env, editor).map(|id| (Launch::Flatpak(id), How::Flatpak)))
        }
        Os::MacOs => {
            let bundle = format!("{}.app", editor.name);
            let mut apps = vec![env.root.join("Applications").join(&bundle)];
            if let Some(home) = &env.home {
                apps.push(home.join("Applications").join(&bundle));
            }
            apps.into_iter()
                .find(|path| is_mac_app(path))
                .map(|path| (Launch::MacApp(path), How::Standard))
        }
        Os::Windows => {
            let exe = format!("{}.exe", editor.gui);
            [
                env.local_app_data
                    .as_ref()
                    .map(|base| base.join("Programs")),
                env.program_files.clone(),
            ]
            .into_iter()
            .flatten()
            .map(|base| base.join("ArtCraft").join(editor.name).join(&exe))
            .find(|path| is_program(env, path))
            .map(|path| (Launch::Program(path), How::Standard))
        }
    }
}

/// Un AppImage in `~/Applications` o `~/AppImages` il cui nome comincia col
/// nome dell'app o col suo id così come sono scritti, seguiti da `-`, `_` o
/// `.`, e finisce con `.AppImage` o `.appimage`. Il nome della riga di comando
/// (`VectorCraft-cli-…`) non è l'app. Fra più AppImage della stessa app vince
/// il nome più grande in ordine di byte: una scelta stabile, che non legge le
/// versioni (`-1.2` viene dopo `-1.10`).
fn appimage(env: &Env, editor: &Editor) -> Option<PathBuf> {
    let home = env.home.as_ref()?;
    for folder in ["Applications", "AppImages"] {
        let Ok(entries) = fs::read_dir(home.join(folder)) else {
            continue;
        };
        let best = entries
            .filter_map(Result::ok)
            .filter(|entry| is_appimage_name(editor, entry.file_name().as_encoded_bytes()))
            .map(|entry| entry.path())
            .filter(|path| is_program(env, path))
            .max_by(|a, b| {
                a.as_os_str()
                    .as_encoded_bytes()
                    .cmp(b.as_os_str().as_encoded_bytes())
            });
        if best.is_some() {
            return best;
        }
    }
    None
}

fn is_appimage_name(editor: &Editor, name: &[u8]) -> bool {
    let suffix = [b".AppImage".as_slice(), b".appimage".as_slice()]
        .into_iter()
        .any(|suffix| name.ends_with(suffix));
    if !suffix {
        return false;
    }
    [editor.name, editor.id].into_iter().any(|prefix| {
        let Some(rest) = name.strip_prefix(prefix.as_bytes()) else {
            return false;
        };
        let Some((&separator, after)) = rest.split_first() else {
            return false;
        };
        let cli = [b"cli".as_slice(), b"CLI".as_slice(), b"Cli".as_slice()]
            .into_iter()
            .any(|word| after.starts_with(word));
        matches!(separator, b'-' | b'_' | b'.') && !cli
    })
}

/// Il Flatpak `ai.storyteller.{id}`, cercato come cartella nelle radici di
/// `env` (prima l'utente, poi il sistema) senza avviare `flatpak`.
fn flatpak(env: &Env, editor: &Editor) -> Option<String> {
    let id = format!("{FLATPAK_PREFIX}{}", editor.id);
    env.flatpak_roots
        .iter()
        .any(|root| is_dir_once(&root.join(&id)))
        .then_some(id)
}

/// La riga di comando accanto al programma con l'interfaccia trovato: nella
/// stessa cartella, o in `Contents/MacOS` di un `.app`. Un Flatpak non ha una
/// cartella accanto.
fn beside(env: &Env, gui: Option<&Launch>, cli: &str) -> Option<PathBuf> {
    let candidate = match gui? {
        Launch::Program(path) => {
            let name = match env.os {
                Os::Windows => format!("{cli}.exe"),
                Os::Linux | Os::MacOs => cli.to_string(),
            };
            path.parent()?.join(name)
        }
        Launch::MacApp(bundle) => bundle.join("Contents/MacOS").join(cli),
        Launch::Flatpak(_) => return None,
    };
    is_program(env, &candidate).then_some(candidate)
}

fn in_local_bin(env: &Env, cli: &str) -> Option<PathBuf> {
    if env.os == Os::Windows {
        return None;
    }
    let path = env.home.as_ref()?.join(".local/bin").join(cli);
    is_program(env, &path).then_some(path)
}

/// Le righe di `installed.json` del launcher: `(id, percorso)`, con un
/// percorso assoluto. Un file che manca, troppo grande o rotto non dà righe.
fn launcher_entries(env: &Env) -> Vec<(String, PathBuf)> {
    let Some(base) = &env.local_data else {
        return Vec::new();
    };
    let path = base.join("artcraft-launcher").join("installed.json");
    let Some(bytes) = read_capped(&path, MAX_INSTALLED_JSON) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    collect_launcher(&value, None, 0, &mut out);
    out
}

/// Le forme che si accettano: un array di voci, una voce sola (`{ "id",
/// "path" }`), un oggetto con una voce, un percorso o un array per id
/// (`{ "vectorcraft": { "path": … } }`, `{ "vectorcraft": "/opt/…" }`,
/// `{ "apps": [ … ] }`). Una voce ha l'`id` e un percorso fra `path`, `exe` ed
/// `executable`. La profondità è di due livelli: un file del launcher non ne
/// ha di più.
fn collect_launcher(
    value: &serde_json::Value,
    key: Option<&str>,
    depth: usize,
    out: &mut Vec<(String, PathBuf)>,
) {
    use serde_json::Value;
    if depth > 2 {
        return;
    }
    match value {
        Value::Array(items) => {
            for item in items {
                collect_launcher(item, None, depth + 1, out);
            }
        }
        Value::Object(map) => {
            let id = map.get("id").and_then(Value::as_str).or(key);
            let path = ["path", "exe", "executable"]
                .into_iter()
                .find_map(|field| map.get(field).and_then(Value::as_str));
            match (id, path) {
                (Some(id), Some(path)) => push_launcher(id, path, out),
                _ if map.contains_key("id") => {}
                _ => {
                    for (key, item) in map {
                        collect_launcher(item, Some(key), depth + 1, out);
                    }
                }
            }
        }
        Value::String(path) => {
            if let Some(id) = key {
                push_launcher(id, path, out);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn push_launcher(id: &str, path: &str, out: &mut Vec<(String, PathBuf)>) {
    let path = PathBuf::from(path);
    if editor(id).is_some() && path.is_absolute() {
        out.push((id.to_string(), path));
    }
}

/// I byte di un file non più grande di `cap`; `None` se manca, se non è un
/// file o se è più grande.
fn read_capped(path: &Path, cap: u64) -> Option<Vec<u8>> {
    let file = fs::File::open(path).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() || meta.len() > cap {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(cap + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= cap).then_some(bytes)
}

/// Che cosa c'è a `path`, seguendo un link simbolico una volta sola: un link
/// che punta a un altro link non conta.
fn metadata_once(path: &Path) -> Option<fs::Metadata> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.file_type().is_symlink() {
        return Some(meta);
    }
    let target = fs::read_link(path).ok()?;
    let target = match target.is_absolute() {
        true => target,
        false => path.parent()?.join(target),
    };
    let meta = fs::symlink_metadata(target).ok()?;
    (!meta.file_type().is_symlink()).then_some(meta)
}

fn is_dir_once(path: &Path) -> bool {
    metadata_once(path).is_some_and(|meta| meta.is_dir())
}

/// Un `.app` di macOS: una cartella col nome che finisce in `.app`.
fn is_mac_app(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "app") && is_dir_once(path)
}

/// Un programma: un file (dopo un link al più) e, su unix e per un `env` che
/// non è Windows, con un bit di esecuzione.
fn is_program(env: &Env, path: &Path) -> bool {
    let Some(meta) = metadata_once(path) else {
        return false;
    };
    meta.is_file() && (env.os == Os::Windows || executable(&meta))
}

#[cfg(unix)]
fn executable(meta: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable(_meta: &fs::Metadata) -> bool {
    true
}

/// Una ricerca di [`detect`] tenuta per [`FIND_TTL`], per lo stesso `Env` e
/// le stesse righe di `craft.editor-paths`: un cambio dell'impostazione è una
/// chiave nuova, quindi la ricerca si rifà subito.
#[derive(Debug, Default)]
pub struct FindCache {
    slot: Mutex<Option<Cached>>,
}

#[derive(Debug)]
struct Cached {
    at: Instant,
    env: Env,
    overrides: Vec<String>,
    found: Vec<Found>,
}

impl FindCache {
    pub fn new() -> FindCache {
        FindCache::default()
    }

    /// La ricerca per `env` e `overrides` all'ora `now`: quella tenuta se è
    /// della stessa chiave e non è più vecchia di [`FIND_TTL`], altrimenti una
    /// nuova, che prende il suo posto.
    pub fn get(&self, env: &Env, overrides: &[String], now: Instant) -> Vec<Found> {
        let mut slot = self
            .slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = slot.as_ref() {
            let fresh = now
                .checked_duration_since(cached.at)
                .is_some_and(|age| age < FIND_TTL);
            if fresh && cached.env == *env && cached.overrides == overrides {
                return cached.found.clone();
            }
        }
        let found = detect(env, overrides);
        *slot = Some(Cached {
            at: now,
            env: env.clone(),
            overrides: overrides.to_vec(),
            found: found.clone(),
        });
        found
    }

    /// Dimentica la ricerca tenuta.
    pub fn clear(&self) {
        let mut slot = self
            .slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = None;
    }
}

fn process_cache() -> &'static FindCache {
    static CACHE: OnceLock<FindCache> = OnceLock::new();
    CACHE.get_or_init(FindCache::new)
}

/// [`detect`] con la cache del processo: la stessa risposta per 30 secondi,
/// finché `env` e `overrides` non cambiano.
pub fn find(env: &Env, overrides: &[String]) -> Vec<Found> {
    process_cache().get(env, overrides, Instant::now())
}

/// Dimentica la ricerca della cache del processo, per chi sa che qualcosa è
/// cambiato sul disco (un'app appena installata).
pub fn forget() {
    process_cache().clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn fake(os: Os) -> (tempfile::TempDir, Env) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("root");
        let home = dir.path().join("home");
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&home).expect("home");
        let env = Env {
            home: Some(home.clone()),
            os,
            path: vec![root.join("usr/bin")],
            local_data: Some(home.join(".local/share")),
            program_files: Some(root.join("Program Files")),
            local_app_data: Some(home.join("AppData/Local")),
            flatpak_roots: vec![
                home.join(".local/share/flatpak/app"),
                root.join("var/lib/flatpak/app"),
            ],
            root,
        };
        (dir, env)
    }

    fn write(path: &Path, mode: u32) -> PathBuf {
        fs::create_dir_all(path.parent().expect("parent")).expect("dir");
        fs::write(path, b"#!/bin/sh\n").expect("write");
        #[cfg(unix)]
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("mode");
        #[cfg(not(unix))]
        let _ = mode;
        path.to_path_buf()
    }

    fn program(path: &Path) -> PathBuf {
        write(path, 0o755)
    }

    fn found<'a>(all: &'a [Found], id: &str) -> &'a Found {
        all.iter()
            .find(|found| found.id == id)
            .expect("una riga per app")
    }

    fn lines(items: &[&str]) -> Vec<String> {
        items.iter().map(|line| line.to_string()).collect()
    }

    // -- la tabella -------------------------------------------------------

    #[test]
    fn the_table_has_seven_apps_with_distinct_ids_and_something_to_open() {
        assert_eq!(EDITORS.len(), 7);
        let ids: BTreeSet<_> = EDITORS.iter().map(|editor| editor.id).collect();
        assert_eq!(ids.len(), EDITORS.len(), "due righe con lo stesso id");
        for editor in EDITORS {
            assert!(!editor.opens.is_empty(), "{} non apre niente", editor.id);
            assert_eq!(editor.gui, editor.id);
            for ext in editor.opens {
                assert!(!ext.starts_with('.'), "{ext}");
                assert!(ext
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()));
            }
            if let Some(cli) = editor.cli {
                assert_eq!(cli, format!("{}-cli", editor.id));
            }
        }
        let with_cli: BTreeSet<_> = EDITORS
            .iter()
            .filter(|editor| editor.cli.is_some())
            .map(|editor| editor.id)
            .collect();
        assert_eq!(
            with_cli,
            BTreeSet::from([
                "vectorcraft",
                "photocraft",
                "lightcraft",
                "pdfcraft",
                "figcraft",
                "wordcraft",
            ])
        );
    }

    #[test]
    fn the_ids_of_the_formats_are_in_the_table() {
        for app in [
            fub_format_craft::CraftApp::VectorCraft,
            fub_format_craft::CraftApp::PhotoCraft,
            fub_format_craft::CraftApp::FigCraft,
        ] {
            assert!(editor(app.id()).is_some(), "{}", app.id());
        }
    }

    #[test]
    fn only_a_token_channel_is_usable_and_none_is_today() {
        for editor in EDITORS {
            let token = matches!(editor.control.auth, Auth::Token { .. });
            if editor.control.usable() {
                assert!(token, "{}", editor.id);
            }
            // Nessuna porta è nota nel passo: nessun canale si usa in N7.
            assert!(!editor.control.usable(), "{}", editor.id);
        }
        let auth = |id: &str| editor(id).expect("app").control.auth;
        assert_eq!(auth("vectorcraft"), Auth::None);
        assert_eq!(auth("wordcraft"), Auth::Key);
        assert_eq!(
            auth("gridcraft"),
            Auth::Token {
                env: Some("GRIDCRAFT_CONTROL_TOKEN")
            }
        );
        let pdf = editor("pdfcraft").expect("app");
        assert_eq!(pdf.control.protocol, Protocol::JsonRpc2);
        assert_eq!(pdf.control.method, Some("ui.open"));
        assert_eq!(pdf.single_instance, &[Os::Linux, Os::Windows]);
    }

    #[test]
    fn opens_ignores_the_case_and_a_leading_dot() {
        let photo = editor("photocraft").expect("app");
        assert!(opens(photo, "jpg"));
        assert!(opens(photo, "JPG"));
        assert!(opens(photo, ".JPG"));
        assert!(opens(photo, "PCraft"));
        assert!(!opens(photo, "..jpg"));
        assert!(!opens(photo, "md"));
        assert!(!opens(photo, ""));
        assert!(!opens(photo, "jp"));
        let vector = editor("vectorcraft").expect("app");
        assert!(opens(vector, "PDF"));
        assert!(!opens(vector, "JPG"));
    }

    #[test]
    fn this_module_never_starts_a_program() {
        let source = include_str!("editors.rs");
        let production = source
            .split("#[cfg(test)]\nmod tests")
            .next()
            .expect("sorgente");
        for word in ["Command", "process::", "spawn", "TcpStream", "UdpSocket"] {
            assert!(!production.contains(word), "editors.rs usa `{word}`");
        }
    }

    // -- Linux --------------------------------------------------------------

    #[test]
    fn nothing_installed_is_missing_for_every_app() {
        let (_dir, env) = fake(Os::Linux);
        let all = detect(&env, &[]);
        assert_eq!(all.len(), EDITORS.len());
        for (found, editor) in all.iter().zip(EDITORS) {
            assert_eq!(found.id, editor.id);
            assert_eq!(found.gui, None);
            assert_eq!(found.cli, None);
            assert_eq!(found.how, How::Missing);
            assert!(!found.installed());
        }
    }

    #[test]
    fn linux_finds_usr_bin_before_local_bin_and_the_cli_beside() {
        let (_dir, env) = fake(Os::Linux);
        let home = env.home.clone().expect("home");
        let usr = program(&env.root.join("usr/bin/vectorcraft"));
        program(&home.join(".local/bin/vectorcraft"));
        let cli = program(&env.root.join("usr/bin/vectorcraft-cli"));
        let local = program(&home.join(".local/bin/photocraft"));
        let local_cli = program(&home.join(".local/bin/figcraft-cli"));
        let all = detect(&env, &[]);
        let vector = found(&all, "vectorcraft");
        assert_eq!(vector.gui, Some(Launch::Program(usr)));
        assert_eq!(vector.how, How::Standard);
        assert_eq!(vector.cli, Some(cli));
        let photo = found(&all, "photocraft");
        assert_eq!(photo.gui, Some(Launch::Program(local)));
        assert_eq!(photo.cli, None);
        // La riga di comando sola, in ~/.local/bin, senza l'app.
        let fig = found(&all, "figcraft");
        assert_eq!(fig.gui, None);
        assert_eq!(fig.cli, Some(local_cli));
        // Un'app senza riga di comando non ne cerca una.
        program(&home.join(".local/bin/gridcraft"));
        program(&home.join(".local/bin/gridcraft-cli"));
        let grid = detect(&env, &[]);
        assert_eq!(found(&grid, "gridcraft").cli, None);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_without_the_execute_bit_or_a_folder_does_not_count() {
        let (_dir, env) = fake(Os::Linux);
        let home = env.home.clone().expect("home");
        write(&env.root.join("usr/bin/vectorcraft"), 0o644);
        fs::create_dir_all(home.join(".local/bin/vectorcraft")).expect("dir");
        write(&home.join("Applications/VectorCraft-1.0.AppImage"), 0o644);
        let all = detect(&env, &[]);
        assert_eq!(found(&all, "vectorcraft").gui, None);
    }

    #[test]
    fn linux_finds_an_appimage_by_name_or_id_without_folding_the_case() {
        let (_dir, env) = fake(Os::Linux);
        let home = env.home.clone().expect("home");
        let old = program(&home.join("Applications/VectorCraft-1.2.AppImage"));
        let new = program(&home.join("Applications/VectorCraft-1.10.AppImage"));
        program(&home.join("Applications/VectorCraft-cli-9.AppImage"));
        program(&home.join("Applications/VectorCraftNotes.AppImage"));
        let fig = program(&home.join("AppImages/figcraft_2.0_x86_64.appimage"));
        program(&home.join("Applications/PHOTOCRAFT-1.AppImage"));
        program(&home.join("Applications/photocraft-1.zip"));
        let all = detect(&env, &[]);
        let vector = found(&all, "vectorcraft");
        assert_eq!(vector.how, How::AppImage);
        // L'ordine dei byte: "1.2" viene dopo "1.10".
        assert_eq!(vector.gui, Some(Launch::Program(old)));
        assert_ne!(vector.gui, Some(Launch::Program(new)));
        assert_eq!(found(&all, "figcraft").gui, Some(Launch::Program(fig)));
        assert_eq!(found(&all, "photocraft").gui, None);
    }

    #[test]
    fn linux_finds_a_flatpak_once_even_if_user_and_system_have_it() {
        let (_dir, env) = fake(Os::Linux);
        for root in &env.flatpak_roots {
            fs::create_dir_all(root.join("ai.storyteller.figcraft")).expect("flatpak");
        }
        fs::create_dir_all(env.flatpak_roots[1].join("ai.storyteller.pdfcraft")).expect("pdf");
        // Un file con quel nome non è un Flatpak installato.
        fs::write(env.flatpak_roots[0].join("ai.storyteller.wordcraft"), b"").expect("file");
        let all = detect(&env, &[]);
        let fig = found(&all, "figcraft");
        assert_eq!(
            fig.gui,
            Some(Launch::Flatpak("ai.storyteller.figcraft".into()))
        );
        assert_eq!(fig.how, How::Flatpak);
        assert_eq!(fig.cli, None);
        assert_eq!(
            found(&all, "pdfcraft").gui,
            Some(Launch::Flatpak("ai.storyteller.pdfcraft".into()))
        );
        assert_eq!(found(&all, "wordcraft").gui, None);
    }

    #[test]
    fn without_home_only_the_system_places_count() {
        let (dir, mut env) = fake(Os::Linux);
        let home = dir.path().join("home");
        program(&home.join(".local/bin/vectorcraft"));
        program(&home.join("Applications/PhotoCraft-1.AppImage"));
        let usr = program(&env.root.join("usr/bin/figcraft"));
        env.home = None;
        env.local_data = None;
        let all = detect(&env, &[]);
        assert_eq!(found(&all, "vectorcraft").gui, None);
        assert_eq!(found(&all, "photocraft").gui, None);
        assert_eq!(found(&all, "figcraft").gui, Some(Launch::Program(usr)));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_followed_once() {
        let (dir, env) = fake(Os::Linux);
        let real = program(&dir.path().join("opt/vc/vectorcraft"));
        fs::create_dir_all(env.root.join("usr/bin")).expect("bin");
        symlink(&real, env.root.join("usr/bin/vectorcraft")).expect("link");
        // photocraft → link → file: due salti, non conta.
        let photo = program(&dir.path().join("opt/pc/photocraft"));
        symlink(&photo, dir.path().join("opt/pc/hop")).expect("hop");
        symlink(
            dir.path().join("opt/pc/hop"),
            env.root.join("usr/bin/photocraft"),
        )
        .expect("link");
        // Un link relativo si risolve dalla sua cartella.
        program(&env.root.join("usr/bin/real-fig"));
        symlink("real-fig", env.root.join("usr/bin/figcraft")).expect("relative");
        // Un link verso niente.
        symlink(dir.path().join("gone"), env.root.join("usr/bin/pdfcraft")).expect("broken");
        let all = detect(&env, &[]);
        assert_eq!(
            found(&all, "vectorcraft").gui,
            Some(Launch::Program(env.root.join("usr/bin/vectorcraft")))
        );
        assert_eq!(found(&all, "photocraft").gui, None);
        assert!(found(&all, "figcraft").installed());
        assert_eq!(found(&all, "pdfcraft").gui, None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn paths_with_spaces_and_not_utf8_bytes_work() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let (dir, mut env) = fake(Os::Linux);
        let odd = dir
            .path()
            .join(OsString::from_vec(b"casa di \xff prova".to_vec()));
        fs::create_dir_all(&odd).expect("home");
        env.home = Some(odd.clone());
        let image = odd
            .join("Applications")
            .join(OsString::from_vec(b"VectorCraft-\xfe.AppImage".to_vec()));
        program(&image);
        let spaced = program(&dir.path().join("Le mie app/photo craft"));
        let line = format!("photocraft = {} ", spaced.display());
        let all = detect(&env, &[line]);
        assert_eq!(found(&all, "vectorcraft").gui, Some(Launch::Program(image)));
        assert_eq!(found(&all, "photocraft").gui, Some(Launch::Program(spaced)));
    }

    // -- craft.editor-paths -----------------------------------------------

    #[test]
    fn the_setting_wins_and_bad_lines_are_dropped() {
        let (dir, env) = fake(Os::Linux);
        program(&env.root.join("usr/bin/vectorcraft"));
        let mine = program(&dir.path().join("opt/vc/vectorcraft"));
        let mine_cli = program(&dir.path().join("opt/other/vc-cli"));
        let first = program(&dir.path().join("opt/a/photocraft"));
        let last = program(&dir.path().join("opt/b/photocraft"));
        let all = detect(
            &env,
            &lines(&[
                &format!("vectorcraft={}", mine.display()),
                &format!("vectorcraft-cli={}", mine_cli.display()),
                &format!("photocraft={}", first.display()),
                &format!("photocraft={}", last.display()),
                "figcraft=relative/figcraft",
                &format!("{}", dir.path().join("opt/a/photocraft").display()),
                &format!("unknown={}", first.display()),
                &format!("gridcraft-cli={}", first.display()),
                "",
                "=",
            ]),
        );
        let vector = found(&all, "vectorcraft");
        assert_eq!(vector.gui, Some(Launch::Program(mine)));
        assert_eq!(vector.how, How::Setting);
        assert_eq!(vector.cli, Some(mine_cli));
        let photo = found(&all, "photocraft");
        assert_eq!(photo.gui, Some(Launch::Program(last)));
        assert_eq!(found(&all, "figcraft").gui, None);
        assert_eq!(found(&all, "gridcraft").cli, None);
        assert_eq!(found(&all, "gridcraft").gui, None);
    }

    #[test]
    fn a_setting_that_points_at_nothing_falls_back_to_the_search() {
        let (dir, env) = fake(Os::Linux);
        let usr = program(&env.root.join("usr/bin/vectorcraft"));
        let gone = dir.path().join("opt/vc/vectorcraft");
        let all = detect(&env, &[format!("vectorcraft={}", gone.display())]);
        let vector = found(&all, "vectorcraft");
        assert_eq!(vector.gui, Some(Launch::Program(usr)));
        assert_eq!(vector.how, How::Standard);
    }

    // -- installed.json -----------------------------------------------------

    fn launcher_file(env: &Env, body: &[u8]) {
        let path = env
            .local_data
            .as_ref()
            .expect("dati")
            .join("artcraft-launcher/installed.json");
        fs::create_dir_all(path.parent().expect("parent")).expect("dir");
        fs::write(path, body).expect("write");
    }

    #[test]
    fn installed_json_as_an_array_or_an_object() {
        let (dir, env) = fake(Os::Linux);
        let vc = program(&dir.path().join("launcher/vc/vectorcraft"));
        let pc = program(&dir.path().join("launcher/pc/photocraft"));
        let pc_cli = program(&dir.path().join("launcher/pc/photocraft-cli"));
        let fc = program(&dir.path().join("launcher/fc/figcraft"));
        let body = serde_json::json!([
            { "id": "vectorcraft", "path": vc },
            { "id": "photocraft", "exe": pc },
            { "id": "nonsense", "path": fc },
            { "id": "figcraft", "path": "relative/figcraft" },
        ]);
        launcher_file(&env, body.to_string().as_bytes());
        let all = detect(&env, &[]);
        assert_eq!(
            found(&all, "vectorcraft").gui,
            Some(Launch::Program(vc.clone()))
        );
        assert_eq!(found(&all, "vectorcraft").how, How::Launcher);
        assert_eq!(found(&all, "photocraft").gui, Some(Launch::Program(pc)));
        assert_eq!(found(&all, "photocraft").cli, Some(pc_cli));
        assert_eq!(found(&all, "figcraft").gui, None);

        let body = serde_json::json!({
            "apps": [ { "id": "figcraft", "executable": fc } ],
            "vectorcraft": vc,
        });
        launcher_file(&env, body.to_string().as_bytes());
        let all = detect(&env, &[]);
        assert_eq!(
            found(&all, "figcraft").gui,
            Some(Launch::Program(fc.clone()))
        );
        assert_eq!(found(&all, "vectorcraft").gui, Some(Launch::Program(vc)));

        let body = serde_json::json!({ "pdfcraft": { "path": fc } });
        launcher_file(&env, body.to_string().as_bytes());
        // Il file esiste ma si chiama figcraft: per il launcher è PdfCraft.
        assert!(found(&detect(&env, &[]), "pdfcraft").installed());
    }

    #[test]
    fn a_broken_huge_or_stale_installed_json_is_like_none() {
        let (dir, env) = fake(Os::Linux);
        let usr = program(&env.root.join("usr/bin/vectorcraft"));
        let vc = program(&dir.path().join("launcher/vectorcraft"));
        launcher_file(&env, b"{ \"id\": \"vectorcraft\", \"path\": ");
        assert_eq!(found(&detect(&env, &[]), "vectorcraft").how, How::Standard);

        let entry = format!(
            "{{\"id\":\"vectorcraft\",\"path\":{:?}}}",
            vc.display().to_string()
        );
        let mut huge = format!("[{entry}");
        while (huge.len() as u64) <= MAX_INSTALLED_JSON {
            huge.push_str(&format!(",{entry}"));
        }
        huge.push(']');
        launcher_file(&env, huge.as_bytes());
        assert_eq!(found(&detect(&env, &[]), "vectorcraft").how, How::Standard);

        let gone = dir.path().join("launcher/gone/vectorcraft");
        launcher_file(
            &env,
            serde_json::json!([{ "id": "vectorcraft", "path": gone }])
                .to_string()
                .as_bytes(),
        );
        let vector = detect(&env, &[]);
        assert_eq!(
            found(&vector, "vectorcraft").gui,
            Some(Launch::Program(usr))
        );

        launcher_file(&env, b"42");
        assert_eq!(found(&detect(&env, &[]), "vectorcraft").how, How::Standard);
    }

    #[test]
    fn the_setting_beats_the_launcher_and_the_launcher_beats_the_system() {
        let (dir, env) = fake(Os::Linux);
        program(&env.root.join("usr/bin/vectorcraft"));
        let launched = program(&dir.path().join("launcher/vectorcraft"));
        let mine = program(&dir.path().join("mine/vectorcraft"));
        launcher_file(
            &env,
            serde_json::json!([{ "id": "vectorcraft", "path": launched }])
                .to_string()
                .as_bytes(),
        );
        let all = detect(&env, &[]);
        assert_eq!(
            found(&all, "vectorcraft").gui,
            Some(Launch::Program(launched))
        );
        let all = detect(&env, &[format!("vectorcraft={}", mine.display())]);
        assert_eq!(found(&all, "vectorcraft").gui, Some(Launch::Program(mine)));
    }

    // -- macOS e Windows ----------------------------------------------------

    #[test]
    fn macos_finds_the_app_bundle_and_the_cli_inside() {
        let (_dir, env) = fake(Os::MacOs);
        let home = env.home.clone().expect("home");
        let system = env.root.join("Applications/VectorCraft.app");
        fs::create_dir_all(&system).expect("app");
        fs::create_dir_all(home.join("Applications/VectorCraft.app")).expect("app");
        let cli = program(&system.join("Contents/MacOS/vectorcraft-cli"));
        let user = home.join("Applications/FigCraft.app");
        fs::create_dir_all(&user).expect("app");
        let local_cli = program(&home.join(".local/bin/figcraft-cli"));
        // Un file che si chiama .app non è un pacchetto.
        program(&env.root.join("Applications/PhotoCraft.app"));
        // Linux su macOS non vale.
        program(&env.root.join("usr/bin/pdfcraft"));
        let all = detect(&env, &[]);
        let vector = found(&all, "vectorcraft");
        assert_eq!(vector.gui, Some(Launch::MacApp(system)));
        assert_eq!(vector.how, How::Standard);
        assert_eq!(vector.cli, Some(cli));
        let fig = found(&all, "figcraft");
        assert_eq!(fig.gui, Some(Launch::MacApp(user)));
        assert_eq!(fig.cli, Some(local_cli));
        assert_eq!(found(&all, "photocraft").gui, None);
        assert_eq!(found(&all, "pdfcraft").gui, None);
    }

    #[test]
    fn macos_takes_an_app_bundle_from_the_setting() {
        let (dir, env) = fake(Os::MacOs);
        let bundle = dir.path().join("Altrove/Vector Craft.app");
        fs::create_dir_all(&bundle).expect("app");
        let all = detect(&env, &[format!("vectorcraft={}", bundle.display())]);
        assert_eq!(found(&all, "vectorcraft").gui, Some(Launch::MacApp(bundle)));
    }

    #[test]
    fn windows_finds_local_programs_before_program_files() {
        let (_dir, env) = fake(Os::Windows);
        let local = env.local_app_data.clone().expect("local");
        let files = env.program_files.clone().expect("files");
        let mine = write(
            &local.join("Programs/ArtCraft/VectorCraft/vectorcraft.exe"),
            0o644,
        );
        write(&files.join("ArtCraft/VectorCraft/vectorcraft.exe"), 0o644);
        let cli = write(
            &local.join("Programs/ArtCraft/VectorCraft/vectorcraft-cli.exe"),
            0o644,
        );
        let grid = write(&files.join("ArtCraft/GridCraft/gridcraft.exe"), 0o644);
        // Senza `.exe` non è il programma di Windows.
        write(&files.join("ArtCraft/PhotoCraft/photocraft"), 0o755);
        // ~/.local/bin non è un posto di Windows.
        program(
            &env.home
                .clone()
                .expect("home")
                .join(".local/bin/figcraft-cli"),
        );
        let all = detect(&env, &[]);
        let vector = found(&all, "vectorcraft");
        assert_eq!(vector.gui, Some(Launch::Program(mine)));
        assert_eq!(vector.cli, Some(cli));
        assert_eq!(found(&all, "gridcraft").gui, Some(Launch::Program(grid)));
        assert_eq!(found(&all, "photocraft").gui, None);
        assert_eq!(found(&all, "figcraft").cli, None);
    }

    // -- la cache -------------------------------------------------------------

    #[test]
    fn the_cache_holds_for_thirty_seconds_and_a_new_setting_is_a_new_search() {
        let (dir, env) = fake(Os::Linux);
        let cache = FindCache::new();
        let start = Instant::now();
        assert!(!found(&cache.get(&env, &[], start), "vectorcraft").installed());
        let usr = program(&env.root.join("usr/bin/vectorcraft"));
        // Entro i 30 secondi la risposta è quella tenuta.
        let soon = start + Duration::from_secs(29);
        assert!(!found(&cache.get(&env, &[], soon), "vectorcraft").installed());
        // Un cambio di craft.editor-paths si vede subito.
        let mine = program(&dir.path().join("mine/vectorcraft"));
        let setting = vec![format!("vectorcraft={}", mine.display())];
        assert_eq!(
            found(&cache.get(&env, &setting, soon), "vectorcraft").gui,
            Some(Launch::Program(mine))
        );
        // E tornare indietro è un'altra ricerca, che ora vede /usr/bin.
        assert_eq!(
            found(&cache.get(&env, &[], soon), "vectorcraft").gui,
            Some(Launch::Program(usr.clone()))
        );
        fs::remove_file(&usr).expect("rm");
        let later = soon + Duration::from_secs(10);
        assert!(found(&cache.get(&env, &[], later), "vectorcraft").installed());
        let expired = soon + FIND_TTL;
        assert!(!found(&cache.get(&env, &[], expired), "vectorcraft").installed());
        program(&usr);
        cache.clear();
        assert!(found(&cache.get(&env, &[], expired), "vectorcraft").installed());
    }

    #[test]
    fn find_answers_like_detect() {
        let (_dir, env) = fake(Os::Linux);
        program(&env.root.join("usr/bin/photocraft"));
        let lines = vec![format!(
            "figcraft={}",
            env.root.join("usr/bin/photocraft").display()
        )];
        forget();
        assert_eq!(find(&env, &lines), detect(&env, &lines));
        forget();
    }

    #[test]
    fn from_process_gives_absolute_places() {
        let env = Env::from_process();
        assert_eq!(env.os, Os::current());
        assert_eq!(env.root, PathBuf::from("/"));
        for path in env
            .home
            .iter()
            .chain(&env.local_data)
            .chain(&env.flatpak_roots)
        {
            assert!(path.is_absolute(), "{}", path.display());
        }
    }
}
