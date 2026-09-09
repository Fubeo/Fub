//! Il flush reale del runner e dei lotti watcher non mantiene Custody.
//! La fabbrica installa la fixture prima dell'apertura; solo flush è armato.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute};
use fub_abi::PluginError;
use fub_host::{
    Custody, ExternalChange, ExternalSync, Host, NoWatcher, VaultWatcher, WatcherFactory,
};
use fub_kernel::Workspace;

const OWNER: &str = "fub.audit-runtime-flush";
const WATCHDOG: Duration = Duration::from_secs(10);

struct Observation {
    read: bool,
    write: bool,
    thread: String,
}

struct Probe {
    armed: AtomicBool,
    workspace: Mutex<Option<Custody<Workspace>>>,
    entered: mpsc::Sender<Observation>,
    release: Mutex<mpsc::Receiver<()>>,
    completed: mpsc::Sender<bool>,
}

struct FlushIndex(Arc<Probe>);

impl IndexProvider for FlushIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }
    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn on_documents_indexed(&mut self, _: &[DocumentModel]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn on_documents_removed(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn reconcile(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn query(&self, _: IndexQuery) -> Result<IndexResult, PluginError> {
        unreachable!("flush probe has no query routes")
    }
    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if !self.0.armed.swap(false, Ordering::SeqCst) {
            return Ok(());
        }
        let workspace = self.0.workspace.lock().unwrap().as_ref().unwrap().clone();
        let read = workspace.try_read().is_some();
        let write = workspace.try_write().is_some();
        self.0
            .entered
            .send(Observation {
                read,
                write,
                thread: std::thread::current()
                    .name()
                    .unwrap_or("unnamed")
                    .to_owned(),
            })
            .expect("flush observer remains alive");
        self.0
            .release
            .lock()
            .unwrap()
            .recv_timeout(WATCHDOG)
            .expect("reader releases the real flush callback");
        let reentered = read
            && write
            && host.data_write("flushed", b"yes").is_ok()
            && matches!(host.data_read("flushed"), Ok(Some(bytes)) if bytes == b"yes");
        self.0
            .completed
            .send(reentered)
            .expect("flush completion receiver");
        if reentered {
            Ok(())
        } else {
            Err(PluginError::Internal(
                "runtime flush held custody or denied re-entry".into(),
            ))
        }
    }
}

struct InstallingWatcher(Arc<Probe>);

impl WatcherFactory for InstallingWatcher {
    fn start(
        &self,
        root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        *self.0.workspace.lock().unwrap() = Some(workspace.clone());
        {
            let mut ws = workspace.write().map_err(|error| error.to_string())?;
            ws.register_core_feature(OWNER, OWNER)
                .map_err(|error| error.to_string())?;
            ws.register_index_provider(OWNER, Box::new(FlushIndex(self.0.clone())))
                .map_err(|error| error.to_string())?;
        }
        NoWatcher.start(root, workspace, watching)
    }
}

enum Path {
    Runner,
    WatcherBatch,
    WatcherCatchUp,
}

fn exercise(path: Path) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 root");
    std::fs::write(root.join("Initial.md"), "# Initial\n").expect("seed actual document");
    let (entered, observations) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (completed, completions) = mpsc::channel();
    let is_runner = matches!(path, Path::Runner);
    let probe = Arc::new(Probe {
        armed: AtomicBool::new(is_runner),
        workspace: Mutex::new(None),
        entered,
        release: Mutex::new(released),
        completed,
    });
    let host = Host::new().with_watcher(Box::new(InstallingWatcher(probe.clone())));
    if !is_runner {
        host.open(&root).expect("open vault");
        host.wait_indexed(None)
            .expect("runner finishes before arming watcher probe");
        std::fs::write(root.join("External.md"), "# External\n").expect("real external change");
        probe.armed.store(true, Ordering::SeqCst);
    }
    let (done_tx, done_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let result = match path {
            Path::Runner => host.open(&root).and_then(|_| host.wait_indexed(None)),
            Path::WatcherBatch | Path::WatcherCatchUp => {
                let workspace = host.debug_workspace(None).expect("opened workspace");
                let mut watcher = ExternalSync::new(workspace);
                match path {
                    Path::WatcherBatch => {
                        watcher.batch(&[ExternalChange::Touched(root.join("External.md"))])
                    }
                    Path::WatcherCatchUp => watcher.catch_up(),
                    Path::Runner => unreachable!(),
                }
                Ok(())
            }
        };
        done_tx.send((host, result)).unwrap();
    });
    let observation = observations
        .recv_timeout(WATCHDOG)
        .expect("runtime reaches IndexProvider::flush");
    let workspace = probe.workspace.lock().unwrap().as_ref().unwrap().clone();
    let reader_workspace = workspace.clone();
    let reader = std::thread::spawn(move || reader_workspace.try_read().is_some());
    let reader_progressed = reader.join().expect("independent reader completes");
    release
        .send(())
        .expect("flush is waiting for reader completion");
    let reentered = completions
        .recv_timeout(WATCHDOG)
        .expect("flush capability re-entry returns");
    let (host, result) = done_rx
        .recv_timeout(WATCHDOG)
        .expect("runtime operation completes");
    worker.join().expect("runtime caller does not panic");
    probe.workspace.lock().unwrap().take();
    result.expect("runtime operation succeeds");
    assert!(
        observation.read && observation.write,
        "runtime flush inherited workspace custody"
    );
    assert!(
        reader_progressed,
        "independent reader could not progress during runtime flush"
    );
    assert!(
        reentered,
        "flush could not use its real host data capability"
    );
    if is_runner {
        assert!(
            observation.thread.starts_with("fub-job-"),
            "the opening runner must execute this flush, got {}",
            observation.thread
        );
    }
    assert!(
        workspace.try_write().is_some(),
        "flush finalized and released its turn"
    );
    assert!(host.close().is_empty(), "normal shutdown remains clean");
}

#[test]
fn opening_runner_flush_releases_custody_and_allows_host_reentry() {
    exercise(Path::Runner);
}

#[test]
fn watcher_batch_flush_releases_custody_and_allows_host_reentry() {
    exercise(Path::WatcherBatch);
}

#[test]
fn watcher_catch_up_flush_releases_custody_and_allows_host_reentry() {
    exercise(Path::WatcherCatchUp);
}
