//! Il ponte nativo delle cartelle condivise su mobile (P14/F37).
//!
//! Il webview non attesta niente: un grant, un permesso o un path che arriva
//! dall'IPC è una domanda. La risposta la dà il codice nativo, raggiunto da qui
//! con `run_mobile_plugin`: `FubTreePlugin.kt` su Android (SAF,
//! `ACTION_OPEN_DOCUMENT_TREE`) e `FubTreePlugin.swift` su iOS (picker
//! `.folder` e bookmark). Il plugin non registra comandi propri e nessuna
//! capability lo nomina: il webview non lo chiama, lo chiamano soltanto i
//! comandi `mobile_*` di `lib.rs`, che restano l'unica superficie IPC.
//!
//! I due sistemi non danno la stessa cosa, e il contratto lo dice:
//!
//! - **iOS** risolve il bookmark in un path vero, con l'accesso
//!   security-scoped aperto finché il vault resta montato. Il kernel ci lavora
//!   come su ogni cartella: scrittura atomica per rinomina, quindi CAS, quindi
//!   lettura e scrittura.
//! - **Android** dà un albero `content://`, che non è un path: il kernel, che
//!   lavora su handle `cap-std`, non ci entra. La cartella condivisa si apre
//!   **come copia** dentro il vault privato, per gesto esplicito, in una
//!   sottocartella nuova: niente si sovrascrive e l'originale resta com'è.
//!
//! Sul desktop il plugin non esiste e ogni domanda risponde `Unserved`: le
//! regole pure qui sotto le esercitano i test.
#![cfg_attr(not(mobile), allow(dead_code))]

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::PluginError;

use crate::mobile::{MobileGrantPlatform, MobilePermissionState, MobileTreeGrant};

/// Il nome del plugin nativo: la classe Kotlin e il simbolo Swift lo seguono.
pub const PLUGIN: &str = "fub-tree";

/// Tetto della copia da Android: oltre, la copia si ferma e lo dice, e ciò che
/// è già copiato resta nella cartella nuova (che non sostituisce niente).
pub const COPY_MAX_FILES: u64 = 20_000;
pub const COPY_MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Il grant che il picker nativo restituisce, prima della validazione Rust.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Picked {
    /// `null` = la persona ha chiuso il picker senza scegliere.
    pub uri: Option<String>,
    pub display_name: Option<String>,
    pub persisted: bool,
    pub read_write: bool,
    pub bookmark: Option<String>,
}

/// Dal picker nativo al grant del registro: la piattaforma la decide la build,
/// non il webview, e il grant passa la stessa validazione di ogni altro.
pub fn grant_from_picked(
    platform: MobileGrantPlatform,
    picked: Picked,
) -> Result<Option<MobileTreeGrant>, PluginError> {
    let Some(uri) = picked.uri else {
        return Ok(None);
    };
    let grant = MobileTreeGrant {
        platform,
        uri,
        display_name: picked.display_name,
        persisted: picked.persisted,
        read_write: picked.read_write,
        bookmark_b64: picked.bookmark,
    };
    crate::mobile::validate_tree_grant(&grant)?;
    Ok(Some(grant))
}

/// La risposta di `verify`: una delle parole note, ogni altra è `unknown`.
pub fn permission_from(word: &str) -> MobilePermissionState {
    match word {
        "granted" => MobilePermissionState::Granted,
        "denied" => MobilePermissionState::Denied,
        "revoked" => MobilePermissionState::Revoked,
        _ => MobilePermissionState::Unknown,
    }
}

/// Il backend del grant garantisce il CAS del kernel? Lo decide la
/// piattaforma, mai un booleano dell'IPC: iOS consegna un path vero, Android
/// un albero SAF senza rinomina atomica.
pub fn backend_cas(grant: &MobileTreeGrant) -> bool {
    grant.platform == MobileGrantPlatform::Ios
}

/// Il path che iOS consegna per un bookmark: assoluto, senza `..`, una
/// directory. Un path relativo o con risalite non diventa un vault.
pub fn accept_shared_root(path: &str) -> Result<Utf8PathBuf, PluginError> {
    let root = Utf8PathBuf::from(path);
    let climbs = root
        .components()
        .any(|part| matches!(part, camino::Utf8Component::ParentDir));
    if !root.is_absolute() || climbs || path.contains('\0') {
        return Err(PluginError::BadArgs(fub_abi::text::Text::key(
            "host.mobile.shared_path",
        )));
    }
    Ok(root)
}

/// Il nome della cartella che riceve la copia: dal nome mostrato, ripulito,
/// e mai una cartella che c'è già (` 2`, ` 3`, …). `exists` è iniettato per
/// provarlo senza disco.
pub fn copy_destination(
    private_root: &Utf8Path,
    display_name: Option<&str>,
    exists: impl Fn(&Utf8Path) -> bool,
) -> Utf8PathBuf {
    let cleaned: String = display_name
        .unwrap_or("")
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    let base = if cleaned.is_empty() {
        "Cartella condivisa"
    } else {
        cleaned
    };
    let base: String = base.chars().take(80).collect();
    let mut candidate = private_root.join(&base);
    let mut n = 2;
    while exists(&candidate) {
        candidate = private_root.join(format!("{base} {n}"));
        n += 1;
    }
    candidate
}

/// L'esito della copia nativa.
#[derive(Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Copied {
    pub files: u64,
    pub bytes: u64,
    /// `true` se un tetto ha fermato la copia: la cartella nuova è parziale.
    pub truncated: bool,
    /// File che il provider non ha dato da leggere: elencati, non persi in
    /// silenzio.
    #[serde(default)]
    pub skipped: Vec<String>,
}

#[cfg(mobile)]
pub use native::*;

#[cfg(mobile)]
mod native {
    use super::*;
    use std::sync::Mutex;
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::{Manager, Wry};

    #[cfg(target_os = "ios")]
    tauri::ios_plugin_binding!(init_plugin_fub_tree);

    /// Il plugin nativo e la cartella condivisa che iOS ha aperto adesso.
    pub struct TreeAccess {
        handle: PluginHandle<Wry>,
        shared: Mutex<Option<Utf8PathBuf>>,
    }

    pub fn init() -> TauriPlugin<Wry> {
        Builder::new(PLUGIN)
            .setup(|app, api| {
                #[cfg(target_os = "android")]
                let handle = api.register_android_plugin("dev.fub.app", "FubTreePlugin")?;
                #[cfg(target_os = "ios")]
                let handle = api.register_ios_plugin(init_plugin_fub_tree)?;
                app.manage(TreeAccess {
                    handle,
                    shared: Mutex::new(None),
                });
                Ok(())
            })
            .build()
    }

    const PLATFORM: MobileGrantPlatform = if cfg!(target_os = "ios") {
        MobileGrantPlatform::Ios
    } else {
        MobileGrantPlatform::Android
    };

    fn native_failed(error: impl std::fmt::Display) -> PluginError {
        PluginError::Io(fub_abi::text::Text::message(
            "host.mobile.native_failed",
            vec![fub_abi::text::Arg::text("reason", error.to_string())],
        ))
    }

    impl TreeAccess {
        fn call<T: serde::de::DeserializeOwned>(
            &self,
            command: &str,
            payload: serde_json::Value,
        ) -> Result<T, PluginError> {
            self.handle
                .run_mobile_plugin(command, payload)
                .map_err(native_failed)
        }

        pub fn pick(&self) -> Result<Option<MobileTreeGrant>, PluginError> {
            let picked: Picked = self.call("pick", serde_json::json!({}))?;
            grant_from_picked(PLATFORM, picked)
        }

        pub fn verify(&self, grant: &MobileTreeGrant) -> MobilePermissionState {
            if crate::mobile::validate_tree_grant(grant).is_err() || grant.platform != PLATFORM {
                return MobilePermissionState::Denied;
            }
            #[derive(serde::Deserialize)]
            struct Answer {
                state: String,
            }
            match self.call::<Answer>("verify", grant_payload(grant)) {
                Ok(answer) => permission_from(&answer.state),
                Err(_) => MobilePermissionState::Unknown,
            }
        }

        /// iOS: apre l'accesso security-scoped e ricorda il path, il solo che
        /// `open_vault` accetta oltre al privato. Android non ha un path.
        pub fn open_shared(&self, grant: &MobileTreeGrant) -> Result<Utf8PathBuf, PluginError> {
            if !backend_cas(grant) || grant.platform != PLATFORM {
                return Err(PluginError::Unserved(fub_abi::text::Text::key(
                    "host.mobile.copy_only",
                )));
            }
            crate::mobile::validate_tree_grant(grant)?;
            #[derive(serde::Deserialize)]
            struct Answer {
                path: String,
            }
            let answer: Answer = self.call("access", grant_payload(grant))?;
            let root = accept_shared_root(&answer.path)?;
            *self.shared.lock().map_err(|_| native_failed("lock"))? = Some(root.clone());
            Ok(root)
        }

        /// La cartella condivisa che questa sessione ha aperto, se c'è.
        pub fn shared_root(&self) -> Option<Utf8PathBuf> {
            self.shared.lock().ok().and_then(|root| root.clone())
        }

        /// Chiude l'accesso security-scoped del path aperto (iOS).
        pub fn close_shared(&self) {
            let closed = self.shared.lock().ok().and_then(|mut root| root.take());
            if let Some(root) = closed {
                let _ = self.call::<serde_json::Value>(
                    "release",
                    serde_json::json!({ "path": root.as_str() }),
                );
            }
        }

        /// Android: copia l'albero in una cartella nuova del vault privato.
        pub fn copy_into(
            &self,
            grant: &MobileTreeGrant,
            private_root: &Utf8Path,
        ) -> Result<(Utf8PathBuf, Copied), PluginError> {
            crate::mobile::validate_tree_grant(grant)?;
            if grant.platform != PLATFORM {
                return Err(PluginError::BadArgs(fub_abi::text::Text::key(
                    "host.mobile.shared_path",
                )));
            }
            std::fs::create_dir_all(private_root).map_err(native_failed)?;
            let dest = copy_destination(private_root, grant.display_name.as_deref(), |path| {
                path.exists()
            });
            let mut payload = grant_payload(grant);
            payload["dest"] = serde_json::json!(dest.as_str());
            payload["maxFiles"] = serde_json::json!(COPY_MAX_FILES);
            payload["maxBytes"] = serde_json::json!(COPY_MAX_BYTES);
            let copied: Copied = self.call("copy", payload)?;
            Ok((dest, copied))
        }
    }

    fn grant_payload(grant: &MobileTreeGrant) -> serde_json::Value {
        serde_json::json!({
            "uri": grant.uri,
            "readWrite": grant.read_write,
            "bookmark": grant.bookmark_b64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picked(uri: Option<&str>) -> Picked {
        Picked {
            uri: uri.map(str::to_string),
            display_name: Some("Appunti".into()),
            persisted: true,
            read_write: true,
            bookmark: None,
        }
    }

    #[test]
    fn a_closed_picker_is_no_grant_and_a_file_uri_is_refused() {
        assert!(
            grant_from_picked(MobileGrantPlatform::Android, picked(None))
                .unwrap()
                .is_none()
        );
        let tree = "content://com.android.externalstorage.documents/tree/primary%3AAppunti";
        let grant = grant_from_picked(MobileGrantPlatform::Android, picked(Some(tree)))
            .unwrap()
            .unwrap();
        assert_eq!(grant.uri, tree);
        let file = "content://com.android.externalstorage.documents/document/primary%3Aa.md";
        assert!(grant_from_picked(MobileGrantPlatform::Android, picked(Some(file))).is_err());
        // iOS senza bookmark non è un grant.
        assert!(grant_from_picked(MobileGrantPlatform::Ios, picked(Some("file:///x/"))).is_err());
    }

    #[test]
    fn only_ios_mounts_in_place_and_only_absolute_paths() {
        let mut grant = MobileTreeGrant {
            platform: MobileGrantPlatform::Ios,
            uri: "file:///private/var/Appunti/".into(),
            display_name: None,
            persisted: true,
            read_write: true,
            bookmark_b64: Some("Ym9va21hcms=".into()),
        };
        assert!(backend_cas(&grant));
        grant.platform = MobileGrantPlatform::Android;
        assert!(!backend_cas(&grant));
        assert!(accept_shared_root("/private/var/mobile/Appunti").is_ok());
        assert!(accept_shared_root("Appunti").is_err());
        assert!(accept_shared_root("/private/../etc").is_err());
    }

    #[test]
    fn the_copy_never_lands_on_an_existing_folder() {
        let root = Utf8Path::new("/sandbox/vaults/Vault");
        let taken = [root.join("Appunti"), root.join("Appunti 2")];
        let dest = copy_destination(root, Some("Appunti"), |p| taken.iter().any(|t| t == p));
        assert_eq!(dest, root.join("Appunti 3"));
        let dest = copy_destination(root, Some("../a/b:c"), |_| false);
        assert_eq!(dest, root.join("-a-b-c"));
        let dest = copy_destination(root, Some(" .. "), |_| false);
        assert_eq!(dest, root.join("Cartella condivisa"));
    }

    #[test]
    fn unknown_answers_are_not_a_permission() {
        assert_eq!(permission_from("granted"), MobilePermissionState::Granted);
        assert_eq!(permission_from("revoked"), MobilePermissionState::Revoked);
        assert_eq!(permission_from("sure"), MobilePermissionState::Unknown);
    }
}
