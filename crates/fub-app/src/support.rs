//! Helper per la superficie IPC: demo, diagnostica e recupero configurazione.
//! La demo resta nella cartella di configurazione della macchina; l'host
//! mantiene le sessioni e `lib.rs` ne espone le operazioni alla UI con wrapper sottili.

use crate::document_windows::{self, DocumentWindows};
use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::PluginError;
use fub_host::support::{
    self, ConfigReport, DemoOpened, ExportConsent, RecoverAction, RecoverOutcome, SupportPreview,
};
use fub_host::Host;
use tauri::State;

/// La cartella di configurazione servita da questo host.
///
/// `Host` non espone `config_dir` oltre i percorsi derivati (`log_path`,
/// `*_path`): la demo e il recovery la ricevono da `fub_host::config_dir()`,
/// la stessa scelta del bootstrap — una volta sola, nessun secondo parere.
fn config_dir() -> Option<Utf8PathBuf> {
    fub_host::config_dir()
}

/// Il nome con cui l'host conosce una radice: la forma canonica quando la
/// cartella esiste. Le finestre documento si confrontano con quella (su Windows
/// `\\?\C:\…`, su macOS `/private/var/…`), non col path costruito qui.
fn host_key(root: &Utf8Path) -> String {
    std::fs::canonicalize(root.as_std_path())
        .ok()
        .and_then(|path| Utf8PathBuf::from_path_buf(path).ok())
        .unwrap_or_else(|| root.to_owned())
        .to_string()
}

/// La radice demo di questa installazione, anche quando la demo non e` aperta.
pub fn demo_root() -> Option<String> {
    support::demo_root(config_dir().as_deref()).map(|root| host_key(&root))
}

/// Apre la demo isolata (`<config>/demo-vault`) e dice da dove si veniva.
pub fn open_demo(
    host: State<Host>,
    windows: State<DocumentWindows>,
) -> Result<DemoOpened, PluginError> {
    let dir = config_dir();
    let root = support::demo_root(dir.as_deref()).ok_or_else(|| {
        PluginError::Unserved("demo non disponibile senza una cartella di configurazione".into())
    })?;
    let opened = document_windows::with_vault_transition(&host, &windows, &host_key(&root), || {
        support::open_demo(&host, dir.as_deref())
    });
    crate::for_the_shell(&host, None, opened)
}

/// Il risultato della chiusura: gli eventuali errori di flush e il vault
/// ancora corrente dopo l'operazione, non un percorso che la UI deve riaprire.
#[derive(serde::Serialize)]
pub struct DemoClosed {
    pub errors: Vec<PluginError>,
    pub current: Option<String>,
}

/// Chiude la demo e torna al vault precedente quando e` ancora aperto.
pub fn close_demo(
    host: State<Host>,
    windows: State<DocumentWindows>,
    return_to: Option<String>,
) -> Result<DemoClosed, PluginError> {
    let Some(dir) = config_dir() else {
        return Err(PluginError::Unserved(
            "demo non disponibile senza una cartella di configurazione".into(),
        ));
    };
    let root = host_key(&dir.join(support::DEMO_DIR_NAME));
    let prev = return_to.map(Utf8PathBuf::from);
    let closed = document_windows::with_vault_transition(&host, &windows, &root, || {
        let errors = support::close_demo(&host, dir.as_path(), prev.as_deref())?;
        Ok(DemoClosed {
            errors,
            current: host.current().map(|path| path.to_string()),
        })
    });
    crate::for_the_shell(&host, None, closed)
}

/// Azzera la demo (solo `<config>/demo-vault`, mai un vault utente).
pub fn reset_demo(
    host: State<Host>,
    windows: State<DocumentWindows>,
) -> Result<String, PluginError> {
    let Some(dir) = config_dir() else {
        return Err(PluginError::Unserved(
            "demo non disponibile senza una cartella di configurazione".into(),
        ));
    };
    let root = host_key(&dir.join(support::DEMO_DIR_NAME));
    let reset = document_windows::with_vault_transition(&host, &windows, &root, || {
        support::reset_demo(&host, dir.as_path()).map(|root| host_key(&root))
    });
    crate::for_the_shell(&host, None, reset)
}

/// Diagnostica tipizzata dell'apertura corrente.
pub fn startup_diagnostics(
    host: State<Host>,
    vault: Option<String>,
) -> Result<Vec<PluginError>, PluginError> {
    host.startup_diagnostics(vault.as_deref())
}

/// Anteprima di supporto redatta dal core: conteggi e code, mai note.
pub fn support_preview(
    host: State<Host>,
    vault: Option<String>,
    log_lines: Option<usize>,
) -> Result<SupportPreview, PluginError> {
    support::collect_preview(
        &host,
        vault.as_deref(),
        config_dir().as_deref(),
        log_lines.unwrap_or(40).min(200),
    )
}

/// Export del rapporto dopo consenso esplicito (anteprima vista + destinazione).
/// Consenso, canonicalizzazione e vault esclusi (demo compresa) li decide
/// l'host, per ogni chiamante.
pub fn support_export(
    host: State<Host>,
    preview: SupportPreview,
    consent: ExportConsent,
) -> Result<String, PluginError> {
    support::export_preview(&host, &preview, &consent)
}

/// Stato dei tre file di macchina (sano/assente/illeggibile/futuro).
pub fn config_health() -> Vec<ConfigReport> {
    support::config_health(config_dir().as_deref())
}

/// Recovery di un file di macchina con backup obbligatorio del precedente.
/// Quali file sono recuperabili lo decide l'host.
pub fn recover_config(path: String, action: RecoverAction) -> Result<RecoverOutcome, PluginError> {
    support::recover_config_file(config_dir().as_deref(), Utf8Path::new(&path), action)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le finestre documento si confrontano con la chiave dell'host: una radice
    /// nominata in un'altra forma (su macOS `/var`, su Windows senza `\\?\`)
    /// sembrerebbe un altro vault, e chiudere la demo verrebbe rifiutato.
    #[test]
    fn the_transition_names_the_demo_as_the_host_knows_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let raw = Utf8PathBuf::from_path_buf(dir.path().join("demo-vault")).unwrap();
        std::fs::create_dir(&raw).unwrap();
        let host = Host::without_watcher();
        let opened = host.open(&raw).unwrap();
        assert_eq!(host_key(&raw), opened.root);
        assert!(host
            .vaults()
            .iter()
            .any(|vault| vault.as_str() == host_key(&raw)));
    }

    #[test]
    fn future_machine_schema_is_never_reset() {
        let dir = tempfile::tempdir().expect("config tempdir");
        let config = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let path = config.join("settings.json");
        let future = br#"{"version":99,"private":"preserve me"}"#;
        std::fs::write(&path, future).unwrap();
        assert!(matches!(
            support::recover_config_file(Some(&config), &path, RecoverAction::ResetEmpty),
            Err(PluginError::BadArgs(_))
        ));
        assert_eq!(std::fs::read(&path).unwrap(), future);
    }

    #[test]
    fn serde_support_mirror_uses_the_ipc_discriminants_and_fields() {
        use fub_host::support::{
            ConfigFileKind, ConfigStatus, DiagnosticSummary, MachineSummary, VaultSummary,
        };
        use serde_json::{json, to_value};
        let opened = DemoOpened {
            root: "/demo".into(),
            previous: Some("/vault".into()),
        };
        assert_eq!(
            to_value(opened).unwrap(),
            json!({"root":"/demo","previous":"/vault"})
        );
        let closed = DemoClosed {
            errors: vec![],
            current: Some("/vault".into()),
        };
        assert_eq!(
            to_value(closed).unwrap(),
            json!({"errors":[],"current":"/vault"})
        );
        let preview = SupportPreview {
            v: 1,
            at: 42,
            fub: "1.0".into(),
            vault: Some(VaultSummary {
                root: "/demo".into(),
                watching: true,
                startup_diagnostics: vec![DiagnosticSummary {
                    kind: "cancelled".into(),
                    help: "help.cancelled".into(),
                }],
            }),
            machine: MachineSummary {
                settings_keys: vec!["locale.language".into()],
                known_vaults: 2,
                log_path: None,
            },
            log_tail: vec![],
            note: "redacted".into(),
        };
        assert_eq!(
            to_value(preview).unwrap(),
            json!({
                "v":1,"at":42,"fub":"1.0",
                "vault":{"root":"/demo","watching":true,
                    "startup_diagnostics":[{"kind":"cancelled","help":"help.cancelled"}]},
                "machine":{"settings_keys":["locale.language"],"known_vaults":2,"log_path":null},
                "log_tail":[],"note":"redacted"
            })
        );
        assert_eq!(
            to_value(ConfigFileKind::ViewState).unwrap(),
            json!("view_state")
        );
        assert_eq!(
            to_value(ConfigStatus::FutureVersion {
                found: "9007199254740993".into(),
                supported: 1
            })
            .unwrap(),
            json!({"kind":"future_version","found":"9007199254740993","supported":1})
        );
        assert_eq!(
            to_value(RecoverAction::RestoreBackup {
                backup: "/backup".into()
            })
            .unwrap(),
            json!({"restore_backup":{"backup":"/backup"}})
        );
        assert_eq!(
            to_value(RecoverAction::BackupOnly).unwrap(),
            json!("backup_only")
        );
        assert_eq!(
            to_value(RecoverAction::ResetEmpty).unwrap(),
            json!("reset_empty")
        );
        assert_eq!(
            to_value(RecoverOutcome {
                backup: None,
                detail: "ok".into(),
                restart_required: true
            })
            .unwrap(),
            json!({"backup":null,"detail":"ok","restart_required":true})
        );
        assert_eq!(
            to_value(ExportConsent {
                acknowledged_preview: true,
                include_log: false,
                destination: "/report.json".into()
            })
            .unwrap(),
            json!({"acknowledged_preview":true,"include_log":false,"destination":"/report.json"})
        );
    }
}
