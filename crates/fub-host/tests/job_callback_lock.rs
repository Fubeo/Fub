//! Il confine di `Plugin::run_job`: il runner chiama il plugin senza trattenere
//! `Custody<Workspace>` e riconsegna sempre il runner e il vault al lavoro
//! successivo, anche quando il plugin restituisce un errore.

use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::traits::{HostApi, HostEvents, JobSpec, Plugin, PluginManifest};
use fub_abi::{Event, PluginError};
use fub_host::registry::Bundle;
use fub_host::{Custody, Host, NoWatcher};
use fub_kernel::{Subscription, Trust, Workspace};

const PLUGIN: &str = "fub.audit-job-callback";
const TIMEOUT: Duration = Duration::from_secs(10);

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault() -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 vault path");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("seed note");
    Vault { _dir: dir, root }
}

struct JobProbe {
    entered: mpsc::SyncSender<()>,
    release: Arc<Mutex<mpsc::Receiver<()>>>,
}

impl Plugin for JobProbe {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(PLUGIN, "Audit job callback")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        _payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        match job {
            "probe-lock" => {
                // È una re-entry reale: il `JobHost` deve poter prendere e
                // rilasciare una guardia propria prima che il probe si fermi.
                let source = host.read_document(&DocId::new("Nota.md"))?;
                if source != "# Nota\n" {
                    return Err(PluginError::Internal(
                        "la re-entry del job ha letto una nota inattesa".into(),
                    ));
                }
                self.entered.send(()).map_err(|_| {
                    PluginError::Internal("il ricevitore del probe job è scomparso".into())
                })?;
                self.release
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .recv_timeout(TIMEOUT)
                    .map_err(|_| {
                        PluginError::Internal("il probe job non è stato liberato".into())
                    })?;
                Ok(serde_json::json!({ "reentered": true }))
            }
            "fail" => Err(PluginError::BadArgs(
                "errore intenzionale del job".into(),
            )),
            "recover" => Ok(serde_json::json!({
                "source": host.read_document(&DocId::new("Nota.md"))?
            })),
            other => Err(PluginError::UnknownJob(other.into())),
        }
    }
}

struct JobProbeBundle {
    entered: mpsc::SyncSender<()>,
    release: Arc<Mutex<mpsc::Receiver<()>>>,
}

impl Bundle for JobProbeBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(PLUGIN, "Audit job callback")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(JobProbe {
            entered: self.entered.clone(),
            release: Arc::clone(&self.release),
        })
    }

    fn register(&self, _workspace: &mut Workspace) -> Vec<String> {
        Vec::new()
    }
}

struct Bench {
    host: Host,
    events: Subscription,
    workspace: Custody<Workspace>,
    entered: mpsc::Receiver<()>,
    release: mpsc::SyncSender<()>,
}

fn bench(vault: &Vault) -> Bench {
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&vault.root).expect("the vault opens");
    host.wait_indexed(None)
        .expect("initial indexing finishes before the job probe");
    let workspace = host.debug_workspace(None).expect("debug custody");
    let events = workspace
        .read()
        .expect("the vault is alive")
        .bus()
        .subscribe();
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    host.with_session(None, |session| {
        let mut workspace = session.workspace().write().expect("the vault is alive");
        session
            .bundles()
            .write()
            .expect("the bundle registry is alive")
            .mount(
                &JobProbeBundle {
                    entered: entered_tx,
                    release: Arc::new(Mutex::new(release_rx)),
                },
                &mut workspace,
            )
            .expect("the job probe mounts");
    })
    .expect("an open session exists");
    Bench {
        host,
        events,
        workspace,
        entered: entered_rx,
        release: release_tx,
    }
}

fn ask(host: &Host, job: &str) {
    host.with_session(None, |session| {
        let mut workspace = session.workspace().write().expect("the vault is alive");
        workspace
            .with_host(PLUGIN, |host| {
                host.spawn_job(JobSpec {
                    job: job.into(),
                    payload: serde_json::Value::Null,
                })
            })
            .expect("the job is queued");
    })
    .expect("an open session exists");
}

fn outcome(events: &Subscription) -> (String, Result<serde_json::Value, PluginError>) {
    let deadline = std::time::Instant::now() + TIMEOUT;
    while std::time::Instant::now() < deadline {
        if let Ok(notice) = events.recv_timeout(Duration::from_millis(100)) {
            if let Event::JobDone { job, result, .. } = notice.event {
                return (job, result);
            }
        }
    }
    panic!("the queued job did not produce an outcome before the timeout");
}

#[test]
fn run_job_releases_both_workspace_guards_and_can_reenter_the_host() {
    let vault = vault();
    let Bench {
        host,
        events,
        workspace,
        entered,
        release,
    } = bench(&vault);

    ask(&host, "probe-lock");
    entered
        .recv_timeout(TIMEOUT)
        .expect("Plugin::run_job re-enters through JobHost and then blocks");
    let read_available = workspace.try_read().is_some();
    let write_available = workspace.try_write().is_some();
    release.send(()).expect("release the job callback");
    let (job, result) = outcome(&events);
    let reusable_read = workspace.try_read().is_some();
    let reusable_write = workspace.try_write().is_some();
    host.close();

    assert!(
        read_available,
        "the runner retained a workspace write-lock across Plugin::run_job"
    );
    assert!(
        write_available,
        "the runner retained a workspace read-lock across Plugin::run_job"
    );
    assert_eq!(job, "probe-lock");
    assert_eq!(
        result.expect("the detached job callback succeeds"),
        serde_json::json!({ "reentered": true })
    );
    assert!(reusable_read && reusable_write, "the job left a lock behind");
}

#[test]
fn a_job_error_propagates_and_the_next_job_reuses_the_workspace() {
    let vault = vault();
    let Bench {
        host,
        events,
        workspace,
        entered: _,
        release: _,
    } = bench(&vault);

    ask(&host, "fail");
    let (job, result) = outcome(&events);
    let read_after_error = workspace.try_read().is_some();
    let write_after_error = workspace.try_write().is_some();

    ask(&host, "recover");
    let (next_job, next_result) = outcome(&events);
    let read_after_recovery = workspace.try_read().is_some();
    let write_after_recovery = workspace.try_write().is_some();
    host.close();

    assert_eq!(job, "fail");
    assert!(
        matches!(&result, Err(PluginError::BadArgs(message))
            if *message == "errore intenzionale del job"),
        "the job error changed at the runner boundary: {result:?}"
    );
    assert!(
        read_after_error && write_after_error,
        "an ordinary job error left a workspace guard held"
    );
    assert_eq!(next_job, "recover");
    assert_eq!(
        next_result.expect("the runner accepts the job after an ordinary error"),
        serde_json::json!({ "source": "# Nota\n" })
    );
    assert!(
        read_after_recovery && write_after_recovery,
        "the recovered job left the workspace unusable"
    );
}
