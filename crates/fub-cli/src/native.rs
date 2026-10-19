//! Dove i browser cercano l'host nativo del clipper, e come ci si scrive.
//!
//! Ogni browser legge il manifest di `local.fub.clipper` da un posto suo: una
//! cartella `NativeMessagingHosts` del profilo su Linux e macOS, una chiave di
//! registro di `HKEY_CURRENT_USER` che punta al file su Windows. Il manifest
//! dei browser Chromium nomina l'origine `chrome-extension://ID/`, quello di
//! Firefox l'id dell'estensione: un id della forma sbagliata non apre niente,
//! quindi non si scrive.
//!
//! Si scrive soltanto per l'utente (mai per tutto il sistema) e soltanto dove
//! il browser c'è già, a meno che l'utente lo nomini. Un file che esiste e
//! che non è un manifest di questo host non si tocca: si dice.

use std::path::{Path, PathBuf};

use fub_host::automation::NM_HOST_NAME;

/// Le famiglie di manifest.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Family {
    Chromium,
    Firefox,
}

/// Un browser che sa leggere l'host.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Browser {
    Chrome,
    Chromium,
    Edge,
    Brave,
    Vivaldi,
    Firefox,
}

impl Browser {
    pub const ALL: [Browser; 6] = [
        Browser::Chrome,
        Browser::Chromium,
        Browser::Edge,
        Browser::Brave,
        Browser::Vivaldi,
        Browser::Firefox,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Browser::Chrome => "chrome",
            Browser::Chromium => "chromium",
            Browser::Edge => "edge",
            Browser::Brave => "brave",
            Browser::Vivaldi => "vivaldi",
            Browser::Firefox => "firefox",
        }
    }

    pub fn parse(name: &str) -> Option<Browser> {
        let name = name.trim().to_ascii_lowercase();
        Browser::ALL.into_iter().find(|b| b.name() == name)
    }

    pub fn family(self) -> Family {
        match self {
            Browser::Firefox => Family::Firefox,
            _ => Family::Chromium,
        }
    }
}

/// Il sistema per cui si calcolano i posti.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Linux,
    Mac,
    Windows,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Mac
        } else {
            Os::Linux
        }
    }
}

/// Le cartelle dell'utente da cui partono i posti.
pub struct Dirs {
    pub home: PathBuf,
    /// `%APPDATA%` e `%LOCALAPPDATA%`, soltanto su Windows.
    pub app_data: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
    /// Dove la CLI tiene i suoi file: su Windows ci vanno i manifest, a cui
    /// la chiave di registro punta.
    pub config: PathBuf,
}

/// Il posto di un browser.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub browser: Browser,
    /// La cartella del profilo: se non c'è, il browser non è installato.
    pub root: PathBuf,
    pub manifest: PathBuf,
    /// Su Windows, la chiave di `HKEY_CURRENT_USER` il cui valore predefinito
    /// è il percorso del manifest.
    pub registry: Option<String>,
}

/// Il posto di `browser` su `os`, se ha senso lì.
pub fn target(browser: Browser, os: Os, dirs: &Dirs) -> Option<Target> {
    let file = format!("{NM_HOST_NAME}.json");
    match os {
        Os::Linux => {
            let config = dirs.home.join(".config");
            let root = match browser {
                Browser::Chrome => config.join("google-chrome"),
                Browser::Chromium => config.join("chromium"),
                Browser::Edge => config.join("microsoft-edge"),
                Browser::Brave => config.join("BraveSoftware").join("Brave-Browser"),
                Browser::Vivaldi => config.join("vivaldi"),
                Browser::Firefox => dirs.home.join(".mozilla"),
            };
            let folder = match browser {
                Browser::Firefox => "native-messaging-hosts",
                _ => "NativeMessagingHosts",
            };
            Some(Target {
                browser,
                manifest: root.join(folder).join(file),
                root,
                registry: None,
            })
        }
        Os::Mac => {
            let support = dirs.home.join("Library").join("Application Support");
            let root = match browser {
                Browser::Chrome => support.join("Google").join("Chrome"),
                Browser::Chromium => support.join("Chromium"),
                Browser::Edge => support.join("Microsoft Edge"),
                Browser::Brave => support.join("BraveSoftware").join("Brave-Browser"),
                Browser::Vivaldi => support.join("Vivaldi"),
                Browser::Firefox => support.join("Mozilla"),
            };
            Some(Target {
                browser,
                manifest: root.join("NativeMessagingHosts").join(file),
                root,
                registry: None,
            })
        }
        Os::Windows => {
            let local = dirs.local_app_data.as_ref()?;
            let (root, key) = match browser {
                Browser::Chrome => (
                    local.join("Google").join("Chrome"),
                    r"Software\Google\Chrome\NativeMessagingHosts",
                ),
                Browser::Chromium => (
                    local.join("Chromium"),
                    r"Software\Chromium\NativeMessagingHosts",
                ),
                Browser::Edge => (
                    local.join("Microsoft").join("Edge"),
                    r"Software\Microsoft\Edge\NativeMessagingHosts",
                ),
                Browser::Brave => (
                    local.join("BraveSoftware").join("Brave-Browser"),
                    r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
                ),
                // Vivaldi legge le chiavi di Chrome.
                Browser::Vivaldi => (
                    local.join("Vivaldi"),
                    r"Software\Google\Chrome\NativeMessagingHosts",
                ),
                Browser::Firefox => (
                    dirs.app_data.as_ref()?.join("Mozilla"),
                    r"Software\Mozilla\NativeMessagingHosts",
                ),
            };
            Some(Target {
                browser,
                root,
                manifest: dirs
                    .config
                    .join("native-messaging")
                    .join(browser.name())
                    .join(file),
                registry: Some(format!(r"HKCU\{key}\{NM_HOST_NAME}")),
            })
        }
    }
}

/// L'id è di un'estensione Chromium (32 lettere `a`–`p`) o di Firefox?
pub fn id_family(id: &str) -> Family {
    if id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
        Family::Chromium
    } else {
        Family::Firefox
    }
}

/// Il manifest per `family`.
pub fn manifest(family: Family, host_binary: &Path, extension_id: &str) -> serde_json::Value {
    let mut value = serde_json::json!({
        "name": NM_HOST_NAME,
        "description": "Fub clipper native host (stdio, solo capture v1)",
        "path": host_binary.to_string_lossy(),
        "type": "stdio",
    });
    match family {
        Family::Chromium => {
            value["allowed_origins"] =
                serde_json::json!([format!("chrome-extension://{extension_id}/")])
        }
        Family::Firefox => value["allowed_extensions"] = serde_json::json!([extension_id]),
    }
    value
}

/// Il file è un manifest di questo host (o non c'è)? Un file d'altri, o che
/// non si legge, non si sovrascrive e non si cancella.
pub fn ours_or_absent(path: &Path) -> Result<bool, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(str::to_string))
            .is_some_and(|name| name == NM_HOST_NAME)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

/// Scrive `bytes` in `path` passando da un file accanto: chi legge vede il
/// manifest vecchio o il nuovo, mai metà.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("percorso senza cartella")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs() -> Dirs {
        Dirs {
            home: PathBuf::from("/home/ada"),
            app_data: Some(PathBuf::from(r"C:\Users\ada\AppData\Roaming")),
            local_app_data: Some(PathBuf::from(r"C:\Users\ada\AppData\Local")),
            config: PathBuf::from("/home/ada/.config/fub"),
        }
    }

    #[test]
    fn every_browser_has_its_place_on_each_system() {
        let d = dirs();
        let chrome = target(Browser::Chrome, Os::Linux, &d).unwrap();
        assert_eq!(
            chrome.manifest,
            PathBuf::from(
                "/home/ada/.config/google-chrome/NativeMessagingHosts/local.fub.clipper.json"
            )
        );
        let firefox = target(Browser::Firefox, Os::Linux, &d).unwrap();
        assert_eq!(
            firefox.manifest,
            PathBuf::from("/home/ada/.mozilla/native-messaging-hosts/local.fub.clipper.json")
        );
        let mac = target(Browser::Firefox, Os::Mac, &d).unwrap();
        assert!(mac.manifest.ends_with(
            "Library/Application Support/Mozilla/NativeMessagingHosts/local.fub.clipper.json"
        ));
        let win = target(Browser::Edge, Os::Windows, &d).unwrap();
        assert_eq!(
            win.registry.as_deref(),
            Some(r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\local.fub.clipper")
        );
        assert!(win.manifest.starts_with("/home/ada/.config/fub"));
        let no_local = Dirs {
            local_app_data: None,
            ..dirs()
        };
        assert_eq!(target(Browser::Chrome, Os::Windows, &no_local), None);
    }

    #[test]
    fn the_id_says_which_manifest_it_opens() {
        assert_eq!(
            id_family("abcdefghijklmnopabcdefghijklmnop"),
            Family::Chromium
        );
        assert_eq!(id_family("clipper@fub.local"), Family::Firefox);
        assert_eq!(
            id_family("abcdefghijklmnopabcdefghijklmnoz"),
            Family::Firefox
        );
        let m = manifest(
            Family::Chromium,
            Path::new("/opt/fub/fub-clipper-host"),
            "x",
        );
        assert_eq!(m["allowed_origins"][0], "chrome-extension://x/");
        assert!(m.get("allowed_extensions").is_none());
        let m = manifest(
            Family::Firefox,
            Path::new("/opt/fub/fub-clipper-host"),
            "x@y",
        );
        assert_eq!(m["allowed_extensions"][0], "x@y");
    }

    #[test]
    fn a_file_of_someone_else_is_not_ours() {
        let dir = std::env::temp_dir().join(format!("fub-native-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("m.json");
        assert_eq!(ours_or_absent(&path), Ok(true));
        std::fs::write(&path, br#"{"name":"altro.host"}"#).unwrap();
        assert_eq!(ours_or_absent(&path), Ok(false));
        write_atomic(&path, br#"{"name":"local.fub.clipper"}"#).unwrap();
        assert_eq!(ours_or_absent(&path), Ok(true));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
