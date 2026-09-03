//! Il `WatcherFactory` è codice scelto da chi monta l'host: durante `start`
//! deve poter osservare e usare il workspace senza trovare un prestito del
//! `Custody`, e un suo errore o panico non deve lasciare una mezza sessione.
//!
//! La fabbrica è immutabile per la vita dell'`Host` e l'apertura resta
//! proprietaria del writer turn: non esiste quindi un owner sostituibile fra
//! prepare e finalize. Le mutazioni sincrone fatte dalla fabbrica sono
//! compatibili e vengono viste dalla scansione successiva; un fallimento
//! scarta l'intero workspace non ancora pubblicato. Questa è la regola di
//! staleness della porta, non una generazione aggiuntiva senza consumatori.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::PluginError;
use fub_host::{Custody, Host, VaultWatcher, WatcherFactory};
use fub_kernel::Workspace;

const TIMEOUT: Duration = Duration::from_secs(10);

struct Live(Arc<AtomicBool>);

impl VaultWatcher for Live {
    fn is_watching(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy)]
enum FirstCall {
    Succeeds,
    Errors,
    Panics,
}

struct Probe {
    first: FirstCall,
    calls: AtomicUsize,
    reentries: AtomicUsize,
    workspaces: Mutex<Vec<Custody<Workspace>>>,
}

impl Probe {
    fn new(first: FirstCall) -> Self {
        Self {
            first,
            calls: AtomicUsize::new(0),
            reentries: AtomicUsize::new(0),
            workspaces: Mutex::new(Vec::new()),
        }
    }

    fn assert_released(workspace: &Custody<Workspace>) {
        let read = workspace
            .try_read()
            .expect("WatcherFactory::start must not inherit a read or write lock");
        drop(read);
        let write = workspace
            .try_write()
            .expect("WatcherFactory::start must not inherit a read or write lock");
        drop(write);
    }
}

impl WatcherFactory for Probe {
    fn start(
        &self,
        _root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        Self::assert_released(&workspace);

        // `start` riceve il `Custody` come capacità lecita. Prendere davvero
        // entrambe le guardie (non soltanto provarle) rende il progresso
        // osservabile e il timeout esterno trasforma un'eventuale regressione
        // in un fallimento finito.
        let root = workspace
            .read()
            .map_err(|error| error.to_string())?
            .root()
            .to_path_buf();
        let open = !workspace
            .write()
            .map_err(|error| error.to_string())?
            .is_closed();
        assert!(!root.as_str().is_empty() && open);
        self.reentries.fetch_add(1, Ordering::SeqCst);

        self.workspaces
            .lock()
            .expect("probe workspace list")
            .push(workspace);

        // Una fabbrica reale alza la bandiera durante l'avvio. I rami di
        // fallimento verificano che sia l'host a ritirarla quando nessun
        // `VaultWatcher` viene restituito e quindi nessun `Drop` la possiede.
        watching.store(true, Ordering::Relaxed);
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        if call == 0 {
            match self.first {
                FirstCall::Succeeds => {}
                FirstCall::Errors => return Err("watcher refused to start".to_string()),
                FirstCall::Panics => panic!("watcher start panic"),
            }
        }

        Ok(Box::new(Live(watching)))
    }
}

fn root() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 tempdir");
    std::fs::write(root.join("note.md"), "# Note\n").expect("seed note");
    (dir, root)
}

fn open_with_timeout(host: Arc<Host>, root: Utf8PathBuf) -> Result<(), PluginError> {
    let (done, completed) = channel();
    let call = std::thread::spawn(move || {
        let result = host.open(&root).and_then(|_| host.wait_indexed(None));
        let _ = done.send(result);
    });
    let result = completed
        .recv_timeout(TIMEOUT)
        .unwrap_or_else(|error| match error {
            RecvTimeoutError::Timeout => panic!("opening deadlocked inside WatcherFactory::start"),
            RecvTimeoutError::Disconnected => panic!("opening thread disappeared"),
        });
    call.join().expect("opening thread joins");
    result
}

fn close_with_timeout(host: Arc<Host>) -> Vec<PluginError> {
    let (done, completed) = channel();
    let call = std::thread::spawn(move || {
        let _ = done.send(host.close());
    });
    let result = completed
        .recv_timeout(TIMEOUT)
        .unwrap_or_else(|error| match error {
            RecvTimeoutError::Timeout => panic!("closing deadlocked after WatcherFactory::start"),
            RecvTimeoutError::Disconnected => panic!("closing thread disappeared"),
        });
    call.join().expect("closing thread joins");
    result
}

#[test]
fn watcher_start_has_no_workspace_lock_and_can_take_both_guards() {
    let (_dir, root) = root();
    let probe = Arc::new(Probe::new(FirstCall::Succeeds));
    let host = Arc::new(Host::new().with_watcher(Box::new(ArcProbe(Arc::clone(&probe)))));

    open_with_timeout(Arc::clone(&host), root).expect("vault opens");

    assert_eq!(probe.calls.load(Ordering::SeqCst), 1);
    assert_eq!(probe.reentries.load(Ordering::SeqCst), 1);
    assert!(host.is_watching(None));
    assert!(close_with_timeout(host).is_empty());
}

#[test]
fn watcher_start_error_leaves_no_session_and_the_host_can_retry() {
    let (_dir, root) = root();
    let probe = Arc::new(Probe::new(FirstCall::Errors));
    let host = Arc::new(Host::new().with_watcher(Box::new(ArcProbe(Arc::clone(&probe)))));

    let error = open_with_timeout(Arc::clone(&host), root.clone()).expect_err("start fails");
    assert_eq!(
        error,
        PluginError::Io("watcher refused to start".to_string().into())
    );
    assert!(
        host.debug_workspace(None).is_err(),
        "no partial session remains"
    );
    let abandoned = probe
        .workspaces
        .lock()
        .expect("probe workspace list")
        .first()
        .expect("failed workspace was recorded")
        .clone();
    Probe::assert_released(&abandoned);
    assert!(
        !abandoned
            .read()
            .expect("failed workspace remains readable")
            .watch_flag()
            .load(Ordering::Relaxed),
        "the failed start must roll back its watching flag"
    );

    open_with_timeout(Arc::clone(&host), root).expect("the same host retries");
    assert_eq!(probe.calls.load(Ordering::SeqCst), 2);
    assert_eq!(probe.reentries.load(Ordering::SeqCst), 2);
    assert!(close_with_timeout(host).is_empty());
}

#[test]
fn watcher_start_panic_is_contained_and_the_host_can_retry() {
    let (_dir, root) = root();
    let probe = Arc::new(Probe::new(FirstCall::Panics));
    let host = Arc::new(Host::new().with_watcher(Box::new(ArcProbe(Arc::clone(&probe)))));

    let error = open_with_timeout(Arc::clone(&host), root.clone()).expect_err("panic is caught");
    assert!(matches!(error, PluginError::Internal(_)), "{error:?}");
    assert!(error.to_string().contains("watcher start panic"));
    assert!(
        host.debug_workspace(None).is_err(),
        "no partial session remains"
    );
    let abandoned = probe
        .workspaces
        .lock()
        .expect("probe workspace list")
        .first()
        .expect("failed workspace was recorded")
        .clone();
    Probe::assert_released(&abandoned);
    assert!(
        !abandoned
            .read()
            .expect("failed workspace remains readable")
            .watch_flag()
            .load(Ordering::Relaxed),
        "the panicking start must roll back its watching flag"
    );

    open_with_timeout(Arc::clone(&host), root).expect("the same host retries after the panic");
    assert_eq!(probe.calls.load(Ordering::SeqCst), 2);
    assert_eq!(probe.reentries.load(Ordering::SeqCst), 2);
    assert!(close_with_timeout(host).is_empty());
}

struct ArcProbe(Arc<Probe>);

impl WatcherFactory for ArcProbe {
    fn start(
        &self,
        root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        self.0.start(root, workspace, watching)
    }
}

struct WaitingWriter {
    watching: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl VaultWatcher for WaitingWriter {
    fn is_watching(&self) -> bool {
        self.watching.load(Ordering::Relaxed)
    }
}

impl Drop for WaitingWriter {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.take() {
            worker.join().expect("waiting watcher worker joins");
        }
        self.watching.store(false, Ordering::Relaxed);
    }
}

/// Il primo watcher parte davvero e il suo worker entra nella coda dei writer;
/// poi la fabbrica rende fallibile il passo host immediatamente successivo.
/// La seconda chiamata è sana, così lo stesso `Host` prova anche il riuso.
struct FailsAfterStart {
    calls: Arc<AtomicUsize>,
    worker_finished: Arc<AtomicBool>,
    flags: Arc<Mutex<Vec<Arc<AtomicBool>>>>,
}

impl WatcherFactory for FailsAfterStart {
    fn start(
        &self,
        _root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        watching.store(true, Ordering::Relaxed);
        self.flags
            .lock()
            .expect("watch flags")
            .push(Arc::clone(&watching));
        if self.calls.fetch_add(1, Ordering::SeqCst) > 0 {
            return Ok(Box::new(Live(watching)));
        }

        let worker_workspace = workspace.clone();
        let worker_finished = Arc::clone(&self.worker_finished);
        let (waiting_tx, waiting_rx) = std::sync::mpsc::sync_channel(1);
        let worker = std::thread::spawn(move || {
            assert!(
                worker_workspace.try_write().is_none(),
                "the opening writer turn must still exclude another writer"
            );
            waiting_tx.send(()).expect("worker announces its wait");
            let result = worker_workspace.write();
            worker_finished.store(true, Ordering::SeqCst);
            drop(result);
        });
        waiting_rx
            .recv_timeout(TIMEOUT)
            .expect("the watcher worker reaches the writer turn");

        // Il test avvelena deliberatamente il workspace **dopo** che il
        // watcher è stato costruito. La prossima `workspace.write()?` di
        // `Host::mounts` fallisce e attiva il rollback dell'apertura. Il
        // catch è solo il fixture che produce il veleno; il boundary della
        // callback WatcherFactory resta `safety::external` nel codice host.
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = workspace.write().expect("fixture takes a reentrant write");
            panic!("poison after watcher start");
        }));
        assert!(poisoned.is_err(), "the fixture poisoned the workspace");

        Ok(Box::new(WaitingWriter {
            watching,
            worker: Some(worker),
        }))
    }
}

#[test]
fn a_post_start_error_releases_the_opening_turn_before_joining_a_waiting_writer() {
    let (_dir, root) = root();
    let calls = Arc::new(AtomicUsize::new(0));
    let worker_finished = Arc::new(AtomicBool::new(false));
    let flags = Arc::new(Mutex::new(Vec::new()));
    let host = Arc::new(Host::new().with_watcher(Box::new(FailsAfterStart {
        calls: Arc::clone(&calls),
        worker_finished: Arc::clone(&worker_finished),
        flags: Arc::clone(&flags),
    })));

    let error = open_with_timeout(Arc::clone(&host), root.clone())
        .expect_err("the post-start workspace write fails");
    assert!(matches!(error, PluginError::Internal(_)), "{error:?}");
    assert!(
        worker_finished.load(Ordering::SeqCst),
        "rollback released the turn before joining the watcher worker"
    );
    assert!(
        host.debug_workspace(None).is_err(),
        "no partial session remains"
    );
    assert!(
        !flags.lock().expect("watch flags")[0].load(Ordering::Relaxed),
        "the abandoned running watcher flag was reset"
    );

    open_with_timeout(Arc::clone(&host), root).expect("the same host retries with a fresh vault");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(close_with_timeout(host).is_empty());
}

struct PanicsOnDrop;

impl VaultWatcher for PanicsOnDrop {
    fn is_watching(&self) -> bool {
        true
    }
}

impl Drop for PanicsOnDrop {
    fn drop(&mut self) {
        panic!("watcher drop panic");
    }
}

struct DropPanicFactory;

impl WatcherFactory for DropPanicFactory {
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        watching.store(true, Ordering::Relaxed);
        Ok(Box::new(PanicsOnDrop))
    }
}

#[test]
fn a_panicking_watcher_drop_does_not_skip_close_and_the_host_can_reopen() {
    let (_dir, root) = root();
    let host = Arc::new(Host::new().with_watcher(Box::new(DropPanicFactory)));
    open_with_timeout(Arc::clone(&host), root.clone()).expect("vault opens");
    let workspace = host.debug_workspace(None).expect("debug custody");

    let errors = close_with_timeout(Arc::clone(&host));
    assert_eq!(errors.len(), 1, "only the watcher destructor failed");
    assert!(errors[0].to_string().contains("watcher drop panic"));
    assert!(
        workspace
            .read()
            .expect("closed workspace remains readable")
            .is_closed(),
        "the watcher panic skipped workspace close"
    );
    assert!(
        !workspace
            .read()
            .expect("closed workspace remains readable")
            .watch_flag()
            .load(Ordering::Relaxed),
        "the host reset the flag even though the watcher destructor panicked"
    );
    Probe::assert_released(&workspace);

    open_with_timeout(Arc::clone(&host), root).expect("the same host reopens after drop panic");
    let errors = close_with_timeout(host);
    assert_eq!(
        errors.len(),
        1,
        "the retry closes with the same contained defect"
    );
    assert!(errors[0].to_string().contains("watcher drop panic"));
}

struct PanicsOnStatus {
    watching: Arc<AtomicBool>,
}

impl VaultWatcher for PanicsOnStatus {
    fn is_watching(&self) -> bool {
        panic!("watcher status panic");
    }
}

impl Drop for PanicsOnStatus {
    fn drop(&mut self) {
        self.watching.store(false, Ordering::Relaxed);
    }
}

struct StatusPanicFactory;

impl WatcherFactory for StatusPanicFactory {
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        watching.store(true, Ordering::Relaxed);
        Ok(Box::new(PanicsOnStatus { watching }))
    }
}

#[test]
fn a_panicking_watcher_status_falls_back_to_false_and_cleanup_still_runs() {
    let (_dir, root) = root();
    let host = Arc::new(Host::new().with_watcher(Box::new(StatusPanicFactory)));
    open_with_timeout(Arc::clone(&host), root).expect("vault opens");
    let workspace = host.debug_workspace(None).expect("debug custody");
    assert!(
        workspace
            .read()
            .expect("open workspace is readable")
            .watch_flag()
            .load(Ordering::Relaxed),
        "the fixture starts as watching"
    );

    let host_for_status = Arc::clone(&host);
    let (done, completed) = channel();
    let call = std::thread::spawn(move || {
        let result = host_for_status.is_watching(None);
        let _ = done.send(result);
    });
    let reported = completed
        .recv_timeout(TIMEOUT)
        .expect("the contained status panic returns before the timeout");
    assert!(!reported, "a panicking status must conservatively be false");
    call.join()
        .expect("VaultWatcher::is_watching did not unwind through the host");

    assert!(close_with_timeout(host).is_empty());
    assert!(
        workspace
            .read()
            .expect("closed workspace remains readable")
            .is_closed(),
        "status panic skipped workspace close"
    );
    assert!(
        !workspace
            .read()
            .expect("closed workspace remains readable")
            .watch_flag()
            .load(Ordering::Relaxed),
        "status panic skipped watcher cleanup"
    );
    Probe::assert_released(&workspace);
}
