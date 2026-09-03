//! `ARCH-001`: i confini staccati di comandi e servizi, provati da `Custody`.
//!
//! Questi banchi completano quelli storici di `concurrency.rs` in quattro
//! direzioni: chiedono **entrambi** i prestiti (`try_read` e `try_write`),
//! attraversano sia `Host` sia `JobHost`, e provano il ripristino dopo un
//! errore normale e dopo un panico convertito dal boundary del kernel.
//!
//! # Staleness
//!
//! Un comando preparato non porta fuori dal lock uno snapshot da applicare in
//! seguito: il suo `CommandOutcome` viene finalizzato soltanto dopo il ritorno.
//! Il writer turn resta posseduto fra prepare e finalize, quindi retire e
//! replace del provider — che richiedono lo stesso turno esclusivo — non
//! possono attraversare `CommandProvider::invoke`. Le mutazioni compiute da
//! una capacità lecita durante la callback sono invece parte della stessa
//! operazione e sono compatibili per costruzione.
//!
//! Un servizio è ancora più stretto: il valore JSON restituito non viene mai
//! applicato al workspace. Il finalize ripristina soltanto pila, flag e coda
//! degli eventi; anche qui il writer turn serializza retire/replace del
//! provider. Non esiste quindi un payload di servizio obsoleto da committare o
//! un riferimento estratto da reinserire. La seconda chiamata dopo errore e
//! panico prova che pila e flag sono stati effettivamente ripristinati.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandScope, CommandSpec, InvokeMode};
use fub_abi::model::DocId;
use fub_abi::traits::{
    CommandProvider, HostApi, HostCommands, HostServices, PluginManifest, ServiceProvider,
};
use fub_abi::PluginError;
use fub_host::{Custody, Host, JobHost, NoWatcher};
use fub_kernel::{Trust, Workspace};

const COMMAND_OWNER: &str = "fub.audit-command-boundary";
const COMMAND: &str = "fub.audit-command-boundary.invoke";
const SERVICE_OWNER: &str = "fub.audit-service-boundary";
const SERVICE: &str = "fub.audit-service-boundary";
const CALLER: &str = "fub.audit-boundary-caller";
const TIMEOUT: Duration = Duration::from_secs(10);

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault() -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 vault path");
    std::fs::write(root.join("Note 0.md"), "# Note 0\n").expect("seed note");
    Vault { _dir: dir, root }
}

fn open(vault: &Vault) -> (Host, Custody<Workspace>) {
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&vault.root).expect("the vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");
    let workspace = host.debug_workspace(None).expect("debug custody");
    (host, workspace)
}

#[derive(Clone, Copy, Debug)]
struct LockObservation {
    read: bool,
    write: bool,
}

/// Stato condiviso col provider soltanto per il banco. L'`Option` viene
/// svuotata a chiamata conclusa: il provider vive dentro il workspace e non
/// deve lasciare un ciclo `Workspace -> provider -> Custody -> Workspace`.
struct BlockingBoundary {
    workspace: Mutex<Option<Custody<Workspace>>>,
    entered: mpsc::SyncSender<LockObservation>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl BlockingBoundary {
    fn exercise(&self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        // Il segnale viene mandato *dopo* una vera re-entry. Riceverlo prova
        // quindi progresso osservabile, non la sola entrata nella callback.
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal(
                "boundary re-entry returned the wrong document".into(),
            ));
        }

        let workspace = self
            .workspace
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .expect("the probe custody is installed")
            .clone();

        // `try_write` comprende il writer turn. La callback gira sul thread
        // che possiede quel turn, dove esso è intenzionalmente rientrante:
        // l'esito misura quindi il vero RwLock e non la serializzazione fra
        // writer. Con una read-guard residua fallisce `write`; con una
        // write-guard residua falliscono entrambi.
        let read = workspace.try_read();
        let read_progressed = read.is_some();
        drop(read);
        let write = workspace.try_write();
        let write_progressed = write.is_some();
        drop(write);

        self.entered
            .send(LockObservation {
                read: read_progressed,
                write: write_progressed,
            })
            .map_err(|_| PluginError::Internal("boundary receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| PluginError::Internal("boundary probe was not released".into()))?;
        Ok(())
    }

    fn detach_workspace(&self) {
        self.workspace
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }
}

struct BlockingCommand(Arc<BlockingBoundary>);

impl CommandProvider for BlockingCommand {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(COMMAND, "Detached command probe")
            .with_scope(CommandScope::read_only())]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        self.0.exercise(host)?;
        Ok(CommandOutcome::done())
    }
}

struct BlockingService(Arc<BlockingBoundary>);

impl ServiceProvider for BlockingService {
    fn call(
        &self,
        _: &str,
        _: &str,
        _: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        self.0.exercise(host)?;
        Ok(serde_json::json!({ "status": "ok" }))
    }
}

fn boundary(workspace: &Custody<Workspace>) -> (
    Arc<BlockingBoundary>,
    mpsc::Receiver<LockObservation>,
    mpsc::SyncSender<()>,
) {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    (
        Arc::new(BlockingBoundary {
            workspace: Mutex::new(Some(workspace.clone())),
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }),
        entered_rx,
        release_tx,
    )
}

fn register_command(workspace: &Custody<Workspace>, provider: Box<dyn CommandProvider>) {
    let mut ws = workspace.write().expect("the vault is alive");
    ws.register_core_feature(COMMAND_OWNER, "Audit command boundary")
        .expect("command owner declares");
    ws.register_command_provider(COMMAND_OWNER, provider)
        .expect("command provider registers");
    ws.register_core_feature(CALLER, "Audit boundary caller")
        .expect("caller declares");
}

fn register_service(workspace: &Custody<Workspace>, provider: Box<dyn ServiceProvider>) {
    let mut ws = workspace.write().expect("the vault is alive");
    ws.register_plugin(
        PluginManifest::core(SERVICE_OWNER, "Audit service boundary").providing(&[SERVICE]),
        Trust::Core,
    )
    .expect("service owner declares");
    ws.register_service_provider(SERVICE_OWNER, provider)
        .expect("service provider registers");
    ws.register_core_feature(CALLER, "Audit boundary caller")
        .expect("caller declares");
}

/// Esegue una callback bloccabile senza affidarsi a `join` come timeout.
/// `join` viene chiamato soltanto dopo che il canale ha certificato la fine.
fn run_blocked<T: Send + 'static>(
    workspace: &Custody<Workspace>,
    entered: mpsc::Receiver<LockObservation>,
    release: mpsc::SyncSender<()>,
    call: impl FnOnce() -> Result<T, PluginError> + Send + 'static,
) -> (LockObservation, Result<T, PluginError>) {
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let thread = std::thread::spawn(move || {
        let outcome = call();
        let _ = done_tx.send(outcome);
    });

    let observation = entered
        .recv_timeout(TIMEOUT)
        .expect("callback re-entry completes before the timeout");
    let foreign_reader = workspace.try_read();
    let foreign_read_progressed = foreign_reader.is_some();
    drop(foreign_reader);

    // Si rilascia prima di ogni assert: anche una regressione non lascia il
    // thread del provider sospeso dietro al banco.
    release.send(()).expect("release boundary callback");
    let outcome = done_rx
        .recv_timeout(TIMEOUT)
        .expect("callback and finalize complete before the timeout");
    thread.join().expect("call thread does not panic");

    assert!(
        foreign_read_progressed,
        "a foreign reader could not enter Custody<Workspace> while the callback was active"
    );
    (observation, outcome)
}

fn assert_both_guards_released(observation: LockObservation) {
    assert!(
        observation.read,
        "the callback retained a write guard on Custody<Workspace>"
    );
    assert!(
        observation.write,
        "the callback retained a read or write guard on Custody<Workspace>"
    );
}

fn assert_workspace_reusable(workspace: &Custody<Workspace>) {
    let deadline = Instant::now() + TIMEOUT;
    loop {
        if let Some(read) = workspace.try_read() {
            assert!(
                read.read_source(&DocId::new("Note 0.md"))
                    .expect("the note remains readable")
                    .contains("Note 0"),
                "the recovered workspace reads the seeded note"
            );
            drop(read);
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the workspace did not become readable after callback cleanup"
        );
        std::thread::yield_now();
    }

    let deadline = Instant::now() + TIMEOUT;
    loop {
        if let Some(write) = workspace.try_write() {
            drop(write);
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the workspace did not become writable after callback cleanup"
        );
        std::thread::yield_now();
    }
    assert_eq!(
        workspace.reports(),
        0,
        "a provider panic outside the guard must not poison the custody"
    );
}

#[test]
fn host_command_releases_both_workspace_guards_and_reenters() {
    let vault = vault();
    let (host, workspace) = open(&vault);
    let (boundary, entered, release) = boundary(&workspace);
    register_command(&workspace, Box::new(BlockingCommand(boundary.clone())));

    let (observation, outcome) = run_blocked(&workspace, entered, release, move || {
        host.invoke_user_command(None, COMMAND, serde_json::Value::Null, InvokeMode::Apply)
    });
    boundary.detach_workspace();

    assert_both_guards_released(observation);
    outcome.expect("the top-level command completes");
    assert_workspace_reusable(&workspace);
}

#[test]
fn job_host_nested_command_uses_the_same_detached_boundary() {
    let vault = vault();
    let (_host, workspace) = open(&vault);
    let (boundary, entered, release) = boundary(&workspace);
    register_command(&workspace, Box::new(BlockingCommand(boundary.clone())));

    let workspace_for_call = workspace.clone();
    let (observation, outcome) = run_blocked(&workspace, entered, release, move || {
        let mut job = JobHost::new(workspace_for_call, CALLER);
        job.run_command(COMMAND, serde_json::Value::Null)
    });
    boundary.detach_workspace();

    assert_both_guards_released(observation);
    outcome.expect("the JobHost command completes");
    assert_workspace_reusable(&workspace);
}

#[test]
fn job_host_calls_service_directly_outside_both_workspace_guards() {
    let vault = vault();
    let (_host, workspace) = open(&vault);
    let (boundary, entered, release) = boundary(&workspace);
    register_service(&workspace, Box::new(BlockingService(boundary.clone())));

    let workspace_for_call = workspace.clone();
    let (observation, outcome) = run_blocked(&workspace, entered, release, move || {
        let mut job = JobHost::new(workspace_for_call, CALLER);
        job.call_service(SERVICE, "probe", serde_json::Value::Null)
    });
    boundary.detach_workspace();

    assert_both_guards_released(observation);
    assert_eq!(
        outcome.expect("the direct service call completes"),
        serde_json::json!({ "status": "ok" })
    );
    assert_workspace_reusable(&workspace);
}

#[derive(Clone, Copy)]
enum FirstFailure {
    Error,
    Panic,
}

struct RecoveringCommand {
    failure: FirstFailure,
    calls: AtomicUsize,
}

impl CommandProvider for RecoveringCommand {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(COMMAND, "Recovering command probe")
            .with_scope(CommandScope::read_only())]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            match self.failure {
                FirstFailure::Error => {
                    return Err(PluginError::BadArgs(
                        "errore intenzionale del comando".into(),
                    ));
                }
                FirstFailure::Panic => panic!("panic intenzionale del comando"),
            }
        }
        host.read_document(&DocId::new("Note 0.md"))?;
        Ok(CommandOutcome::done())
    }
}

struct RecoveringService {
    failure: FirstFailure,
    calls: AtomicUsize,
}

impl ServiceProvider for RecoveringService {
    fn call(
        &self,
        _: &str,
        _: &str,
        _: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            match self.failure {
                FirstFailure::Error => {
                    return Err(PluginError::BadArgs(
                        "errore intenzionale del servizio".into(),
                    ));
                }
                FirstFailure::Panic => panic!("panic intenzionale del servizio"),
            }
        }
        host.read_document(&DocId::new("Note 0.md"))?;
        Ok(serde_json::json!({ "recovered": true }))
    }
}

/// Esegue due chiamate sullo stesso provider, fermandosi fra le due per
/// verificare il workspace. Anche i banchi di errore hanno così un timeout:
/// una regressione che si trasformasse in deadlock produce un rosso finito.
fn two_calls_with_cleanup<T: std::fmt::Debug + Send + 'static>(
    workspace: &Custody<Workspace>,
    mut call: impl FnMut() -> Result<T, PluginError> + Send + 'static,
) -> (PluginError, T) {
    let (first_tx, first_rx) = mpsc::sync_channel(1);
    let (continue_tx, continue_rx) = mpsc::sync_channel(1);
    let (second_tx, second_rx) = mpsc::sync_channel(1);
    let thread = std::thread::spawn(move || {
        let _ = first_tx.send(call());
        if continue_rx.recv_timeout(TIMEOUT).is_ok() {
            let _ = second_tx.send(call());
        }
    });

    let failed = first_rx
        .recv_timeout(TIMEOUT)
        .expect("the failing callback completes before the timeout")
        .expect_err("the first provider call fails");
    assert_workspace_reusable(workspace);
    continue_tx.send(()).expect("allow the recovery call");
    let recovered = second_rx
        .recv_timeout(TIMEOUT)
        .expect("the recovery callback completes before the timeout")
        .expect("the same provider succeeds after cleanup");
    thread.join().expect("recovery thread does not panic");
    assert_workspace_reusable(workspace);
    (failed, recovered)
}

fn command_recovers_after(failure: FirstFailure) -> PluginError {
    let vault = vault();
    let (host, workspace) = open(&vault);
    register_command(
        &workspace,
        Box::new(RecoveringCommand {
            failure,
            calls: AtomicUsize::new(0),
        }),
    );

    let (failed, _) = two_calls_with_cleanup(&workspace, move || {
        host.invoke_user_command(None, COMMAND, serde_json::Value::Null, InvokeMode::Apply)
    });
    failed
}

fn service_recovers_after(failure: FirstFailure) -> PluginError {
    let vault = vault();
    let (_host, workspace) = open(&vault);
    register_service(
        &workspace,
        Box::new(RecoveringService {
            failure,
            calls: AtomicUsize::new(0),
        }),
    );
    let mut job = JobHost::new(workspace.clone(), CALLER);

    let (failed, recovered) = two_calls_with_cleanup(&workspace, move || {
        job.call_service(SERVICE, "probe", serde_json::Value::Null)
    });
    assert_eq!(recovered, serde_json::json!({ "recovered": true }));
    failed
}

#[test]
fn a_command_error_propagates_and_the_next_call_still_works() {
    let failed = command_recovers_after(FirstFailure::Error);
    assert!(
        matches!(&failed, PluginError::BadArgs(message)
            if message.to_string().contains("errore intenzionale del comando")),
        "the normal provider error must propagate: {failed:?}"
    );
}

#[test]
fn a_command_panic_is_converted_and_the_next_call_still_works() {
    let failed = command_recovers_after(FirstFailure::Panic);
    assert!(
        matches!(&failed, PluginError::Internal(message)
            if message.to_string().contains(COMMAND_OWNER)
                && message.to_string().contains(COMMAND)
                && message.to_string().contains("panic intenzionale del comando")),
        "the command panic must become a qualified provider error: {failed:?}"
    );
}

#[test]
fn a_service_error_propagates_and_the_next_call_still_works() {
    let failed = service_recovers_after(FirstFailure::Error);
    assert!(
        matches!(&failed, PluginError::BadArgs(message)
            if message.to_string().contains("errore intenzionale del servizio")),
        "the normal service error must propagate: {failed:?}"
    );
}

#[test]
fn a_service_panic_is_converted_and_the_next_call_still_works() {
    let failed = service_recovers_after(FirstFailure::Panic);
    assert!(
        matches!(&failed, PluginError::Internal(message)
            if message.to_string().contains(SERVICE_OWNER)
                && message.to_string().contains(SERVICE)
                && message.to_string().contains("panic intenzionale del servizio")),
        "the service panic must become a qualified provider error: {failed:?}"
    );
}
