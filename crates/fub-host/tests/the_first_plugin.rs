//! **Il primo plugin vero** (criterio M4): un componente che vive solo per
//! contratto — manifest, attivazione, provider, job — e che si monta e si
//! smonta per intero, senza un solo ramo cablato nel kernel.
//!
//! Fino a qui i plugin di prova erano `OnlyProviders`: un manifest e basta,
//! perché ciò che si provava era il montaggio. Questo è l'altro estremo — un
//! `Plugin` che fa le quattro cose che il capitolo 7 promette a chi ne scrive
//! uno vero, e le fa tutte e quattro **davanti a un host che le governa**:
//!
//! - `manifest` dichiara i permessi (§7.3): il ping legge il vault, e lo dice.
//! - `activate` fa il lavoro del plugin che non ha bisogno di permessi: segna
//!   l'istante in cui si è acceso (l'orologio è una capacità senza permesso).
//! - il **comando** arriva dal quarto passo del montaggio, `Bundle::register`:
//!   è lì che un bundle registra i propri provider, perché l'`HostApi` non ha
//!   metodi `register_*` (decisione 0013) — l'attivazione non può e non deve
//!   registrare, può solo fare. Il comando è di sola lettura, come si conviene
//!   a un ping, e la lettura è ciò che il permesso `read-vault` governa.
//! - `run_job` è il corpo di un job vero: gira sul pool del §9.3, si racconta
//!   con `report_progress` (§10.3) e legge il vault con le stesse capacità del
//!   comando.
//!
//! Il commiato — «dopo lo smontaggio il comando non esiste più» — non sta nel
//! `deactivate` del plugin: sta in `Workspace::deactivate_plugin`, che il
//! `BundleRegistry::unmount` chiama **dopo** il commiato (decisione 0031). Il
//! `deactivate` riceve l'host ancora vivo e i propri provider ancora registrati,
//! e lo prova segnando il commiato; a togliere i provider è il kernel, che è
//! l'unico che li possiede. Ciò che il test osserva è il contratto intero:
//! montato → il comando c'è e risponde; smontato → `UnknownCommand`.
//!
//! La seconda prova è il cancello del §7.3 visto dal lato di chi lo attraversa:
//! lo **stesso** plugin, montato con un manifest senza `read-vault`, si monta
//! lo stesso (l'attivazione non ne ha bisogno), ma la prima lettura — dal
//! comando e dal job — riceve `PermissionDenied`. È la stessa porta che
//! `every_structural_capability_is_refused_by_the_same_gate` presidia dal lato
//! delle famiglie, qui provata dal lato del permesso dichiarato.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::event::{Actor, Event};
use fub_abi::model::DocId;
use fub_abi::options::permission;
use fub_abi::settings::{permission_key, SettingValue};
use fub_abi::traits::{
    CommandProvider, HostApi, JobProgress, JobSpec, Plugin, PluginManifest, PluginPermissions,
};
use fub_abi::PluginError;
use fub_host::registry::Bundle;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust, Workspace};

const ID: &str = "demo.ping";
const COMMAND: &str = "demo.ping:ping";

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        Vault { _dir: dir, root }
    }
}

type Journal = Arc<Mutex<Vec<String>>>;

fn lines(journal: &Journal) -> Vec<String> {
    journal.lock().unwrap().clone()
}

/// Un host headless con un vault aperto e il bundle di prova montato.
///
/// `permissions` sceglie il manifest: con o senza `read-vault`. Nel caso
/// positivo il test simula anche l'**approvazione esplicita dell'utente** dopo
/// il mount: dichiarare una capacità non equivale più a concederla.
fn bench(v: &Vault, permissions: bool) -> (Host, Subscription, Journal) {
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None).expect("the opener finished");
    let events = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("open");
    let journal: Journal = Arc::default();
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(
                &BundleDemoPing {
                    journal: journal.clone(),
                    permissions,
                },
                &mut ws,
            )
            .expect("the bundle mounts");
        if permissions {
            ws.set_setting(
                &permission_key(ID, permission::READ_VAULT),
                SettingValue::Toggle(true),
            )
            .expect("the user explicitly approves read-vault");
        }
    })
    .expect("open");
    (host, events, journal)
}

fn ask(host: &Host, job: &str) -> fub_abi::traits::JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(ID, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload: serde_json::json!(null),
            })
        })
        .expect("enqueued")
    })
    .expect("open")
}

fn outcome(events: &Subscription) -> (String, Result<serde_json::Value, PluginError>) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        match events.recv_timeout(Duration::from_millis(200)) {
            Ok(notice) => {
                if let Event::JobDone { job, result, .. } = notice.event {
                    return (job, result);
                }
            }
            Err(_) => continue,
        }
    }
    panic!("no job ever returned: nobody drains the queue");
}

struct PingProvider;

impl CommandProvider for PingProvider {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(COMMAND, "Demo plugin ping")]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let text = host.read_document(&DocId::new("Nota.md"))?;
        Ok(CommandOutcome::notify(format!(
            "pong: {} characters in Nota.md",
            text.chars().count()
        )))
    }
}

struct DemoPing {
    journal: Journal,
}

impl Plugin for DemoPing {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(ID, "Demo Ping")
            .granting(PluginPermissions::of(&[permission::READ_VAULT]))
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let now = host.now_unix_millis();
        self.journal
            .lock()
            .unwrap()
            .push(format!("activated at {now}"));
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.journal.lock().unwrap().push("stopped".to_string());
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        _payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        match job {
            "ping" => {
                host.report_progress(JobProgress {
                    done: 1,
                    total: Some(1),
                    label: Some("reading Nota.md".to_string()),
                });
                let text = host.read_document(&DocId::new("Nota.md"))?;
                Ok(serde_json::json!({
                    "note": "Nota.md",
                    "characters": text.chars().count(),
                }))
            }
            other => Err(PluginError::UnknownJob(other.into())),
        }
    }
}

struct BundleDemoPing {
    journal: Journal,
    permissions: bool,
}

impl Bundle for BundleDemoPing {
    fn manifest(&self) -> PluginManifest {
        let mut manifest = PluginManifest::new(ID, "Demo Ping");
        if self.permissions {
            manifest = manifest.granting(PluginPermissions::of(&[permission::READ_VAULT]));
        }
        manifest
    }

    fn trust(&self) -> Trust {
        Trust::Community
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(DemoPing {
            journal: self.journal.clone(),
        })
    }

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        let mut warnings = Vec::new();
        if let Err(and) = ws.register_command_provider(ID, Box::new(PingProvider)) {
            warnings.push(format!("command: {and}"));
        }
        warnings
    }
}

#[test]
fn a_plugin_live_for_contract_is_mounts_lives_and_is_unmounts() {
    let v = Vault::new();
    let (host, events, journal) = bench(&v, true);

    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        assert!(
            ws.commands().iter().any(|c| c.id == COMMAND),
            "the plugin command is in the registry"
        );
        let info = ws
            .plugins()
            .into_iter()
            .find(|p| p.id == ID)
            .expect("the plugin is in the §7.6 inventory");
        assert!(
            info.permissions.enabled(permission::READ_VAULT),
            "the manifest declares `read-vault` and the inventory shows it"
        );
        assert!(
            s.bundles().read().unwrap().ids().contains(&ID),
            "the registry owns the bundle"
        );
    })
    .expect("open");

    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let outcome = ws
            .invoke_command(
                COMMAND,
                serde_json::json!(null),
                InvokeMode::Apply,
                Actor::User,
            )
            .expect("the ping responds");
        let message = outcome.notify.expect("the ping says something");
        assert!(
            message.as_literal().is_some_and(|m| m.contains("pong")),
            "the ping responds pong: {message:?}"
        );
    })
    .expect("open");

    ask(&host, "ping");
    let (job, result) = outcome(&events);
    assert_eq!(job, "ping");
    let value = result.expect("the job succeeded");
    assert_eq!(value["note"], "Nota.md");
    assert!(
        value["characters"].as_u64().unwrap() > 0,
        "the job really read: {value}"
    );

    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let errors = s.bundles().write().unwrap().unmount(&mut ws, ID);
        assert!(errors.is_empty(), "nothing went wrong: {errors:?}");
        assert!(
            !ws.commands().iter().any(|c| c.id == COMMAND),
            "the command is no longer there"
        );
        let error = ws
            .invoke_command(
                COMMAND,
                serde_json::json!(null),
                InvokeMode::Apply,
                Actor::User,
            )
            .expect_err("the command no longer exists");
        assert!(
            matches!(error, PluginError::UnknownCommand(_)),
            "it is an unknown command: {error}"
        );
    })
    .expect("open");

    let lines = lines(&journal);
    assert_eq!(lines.len(), 2, "activation and farewell: {lines:?}");
    assert!(
        lines[0].starts_with("activated at"),
        "activation happened: {lines:?}"
    );
    assert_eq!(lines[1], "stopped", "the farewell was called");

    host.close();
}

#[test]
fn a_plugin_without_the_permission_sees_close_the_gate() {
    let v = Vault::new();
    let (host, events, _journal) = bench(&v, false);

    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let error = ws
            .invoke_command(
                COMMAND,
                serde_json::json!(null),
                InvokeMode::Apply,
                Actor::User,
            )
            .expect_err("without `read-vault` the ping cannot read");
        assert!(
            matches!(&error, PluginError::PermissionDenied(t)
                if t.as_literal().is_some_and(|m| m.contains("non ha dichiarato il permesso"))),
            "it is the permission that closes: {error}"
        );
    })
    .expect("open");

    ask(&host, "ping");
    let (job, result) = outcome(&events);
    assert_eq!(job, "ping");
    let error = result.expect_err("the job without permission cannot read");
    assert!(
        matches!(&error, PluginError::PermissionDenied(t)
            if t.as_literal().is_some_and(|m| m.contains("non ha dichiarato il permesso"))),
        "it is the permission that closes for the job too: {error}"
    );

    host.close();
}
