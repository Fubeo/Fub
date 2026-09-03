//! Il confine di `Plugin::run_job`: il runner chiama il plugin senza trattenere
//! `Custody<Workspace>` e riconsegna sempre il runner e il vault al lavoro
//! successivo, anche quando il plugin restituisce un errore.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::event::{EventKind, EventMask, Notice};
use fub_abi::model::DocId;
use fub_abi::traits::{EventHandler, HostApi, JobSpec, Plugin, PluginManifest};
use fub_abi::{Event, PluginError};
use fub_host::registry::Bundle;
use fub_host::{Custody, Host, NoWatcher};
use fub_kernel::{Subscription, Trust, Workspace};

const PLUGIN: &str = "fub.audit-job-callback";
const EVENT_HANDLER: &str = "fub.audit-job-completion-handler";
const TIMEOUT: Duration = Duration::from_secs(10);
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

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
            "fail" => Err(PluginError::BadArgs("errore intenzionale del job".into())),
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
    let root = vault.root.clone();
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let opening = std::thread::spawn(move || {
        let host = Host::new()
            .with_watcher(Box::new(NoWatcher))
            .with_job_threads(1);
        let outcome = host.open(&root).and_then(|_| host.wait_indexed(None));
        let _ = done_tx.send((host, outcome));
    });
    let (host, outcome) = done_rx
        .recv_timeout(TIMEOUT)
        .expect("opening and indexing finish before the timeout");
    opening
        .join()
        .expect("the completed opening thread does not panic");
    outcome.expect("the vault opens and its initial indexing finishes");
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

/// Il runner prende brevemente il workspace per consegnare code ed esiti.
/// Una singola `try_write` misurerebbe quindi lo scheduler, non il confine del
/// provider. Entrambe le guardie devono invece diventare disponibili entro un
/// intervallo molto più corto del timeout della callback bloccata.
fn both_guards_become_available(workspace: &Custody<Workspace>, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    let mut read_seen = false;
    let mut write_seen = false;
    while std::time::Instant::now() < deadline {
        let read = workspace.try_read();
        read_seen |= read.is_some();
        drop(read);

        let write = workspace.try_write();
        write_seen |= write.is_some();
        drop(write);

        if read_seen && write_seen {
            return true;
        }
        std::thread::yield_now();
    }
    false
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EventCallback {
    Subscribed,
    Handle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct EventObservation {
    callback: EventCallback,
    read: bool,
    write: bool,
}

struct CompletionWorkspace(Mutex<Option<Custody<Workspace>>>);

impl CompletionWorkspace {
    fn custody(&self) -> Custody<Workspace> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .expect("the completion workspace is installed")
            .clone()
    }

    fn detach(&self) {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }
}

struct CompletionHandler {
    workspace: Arc<CompletionWorkspace>,
    observations: mpsc::SyncSender<EventObservation>,
    reentered: mpsc::SyncSender<()>,
    measured_subscription: AtomicBool,
}

impl CompletionHandler {
    fn observe(&self, callback: EventCallback) -> EventObservation {
        let workspace = self.workspace.custody();
        let read = workspace.try_read();
        let read_free = read.is_some();
        drop(read);
        let write = workspace.try_write();
        let write_free = write.is_some();
        drop(write);
        EventObservation {
            callback,
            read: read_free,
            write: write_free,
        }
    }
}

impl EventHandler for CompletionHandler {
    fn subscribed(&self) -> EventMask {
        if !self.measured_subscription.swap(true, Ordering::SeqCst) {
            let _ = self
                .observations
                .send(self.observe(EventCallback::Subscribed));
        }
        EventMask::of([EventKind::JobDone])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if !matches!(notice.event, Event::JobDone { .. }) {
            return Ok(());
        }
        self.observations
            .send(self.observe(EventCallback::Handle))
            .map_err(|_| {
                PluginError::Internal("the event completion observer disappeared".into())
            })?;
        host.write_document(
            &DocId::new("Event completion re-entry.md"),
            "# Event completion re-entry\n",
            WriteBase::Dictated,
        )?;
        self.reentered.send(()).map_err(|_| {
            PluginError::Internal("the event completion observer disappeared".into())
        })?;
        Ok(())
    }
}

#[test]
fn job_completion_drains_event_handlers_outside_both_guards_and_allows_reentry() {
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
        .expect("the job is blocked before its completion is delivered");

    let probe_workspace = Arc::new(CompletionWorkspace(Mutex::new(Some(workspace.clone()))));
    let (callback_tx, callback_rx) = mpsc::sync_channel(2);
    let (reentered_tx, reentered_rx) = mpsc::sync_channel(1);
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_core_feature(EVENT_HANDLER, "Audit job completion handler")
            .expect("the event handler owner declares");
        ws.register_event_handler(
            EVENT_HANDLER,
            Box::new(CompletionHandler {
                workspace: Arc::clone(&probe_workspace),
                observations: callback_tx,
                reentered: reentered_tx,
                measured_subscription: AtomicBool::new(false),
            }),
        )
        .expect("the event handler registers");
    }

    release.send(()).expect("the job callback is released");
    for expected in [EventCallback::Subscribed, EventCallback::Handle] {
        let observed = callback_rx
            .recv_timeout(TIMEOUT)
            .unwrap_or_else(|_| panic!("{expected:?} did not run before the timeout"));
        assert_eq!(observed.callback, expected);
        assert!(observed.read, "{expected:?} retained a write guard");
        assert!(
            observed.write,
            "{expected:?} retained a workspace read or write guard"
        );
    }
    reentered_rx
        .recv_timeout(TIMEOUT)
        .expect("the JobDone handler re-enters through HostApi");
    let (job, result) = outcome(&events);
    assert_eq!(job, "probe-lock");
    result.expect("the job succeeds after detached completion delivery");
    assert!(
        workspace
            .read()
            .expect("workspace reusable")
            .documents()
            .contains(&DocId::new("Event completion re-entry.md")),
        "the handler's re-entry made observable progress"
    );
    assert!(
        both_guards_become_available(&workspace, TIMEOUT),
        "the completion drain left a workspace lock behind"
    );
    probe_workspace.detach();
    assert!(host.close().is_empty(), "the completed runner closes cleanly");
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
    let guards_available = both_guards_become_available(&workspace, PROBE_TIMEOUT);
    release.send(()).expect("release the job callback");
    let (job, result) = outcome(&events);
    let reusable = both_guards_become_available(&workspace, TIMEOUT);
    host.close();

    assert!(
        guards_available,
        "the runner retained a workspace read-lock or write-lock across Plugin::run_job"
    );
    assert_eq!(job, "probe-lock");
    assert_eq!(
        result.expect("the detached job callback succeeds"),
        serde_json::json!({ "reentered": true })
    );
    assert!(reusable, "the job left a lock behind");
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
    let guards_after_error = both_guards_become_available(&workspace, TIMEOUT);

    ask(&host, "recover");
    let (next_job, next_result) = outcome(&events);
    let guards_after_recovery = both_guards_become_available(&workspace, TIMEOUT);
    host.close();

    assert_eq!(job, "fail");
    assert!(
        matches!(&result, Err(PluginError::BadArgs(message))
            if *message == "errore intenzionale del job"),
        "the job error changed at the runner boundary: {result:?}"
    );
    assert!(
        guards_after_error,
        "an ordinary job error left a workspace guard held"
    );
    assert_eq!(next_job, "recover");
    assert_eq!(
        next_result.expect("the runner accepts the job after an ordinary error"),
        serde_json::json!({ "source": "# Nota\n" })
    );
    assert!(
        guards_after_recovery,
        "the recovered job left the workspace unusable"
    );
}
