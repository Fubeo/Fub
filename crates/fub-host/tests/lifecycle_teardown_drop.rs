//! I distruttori nativi sono codice esterno: nessuna custodia può attraversarli.
//! Un panic di Drop non autorizza a saltare i disposer successivi.

use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::event::{EventKind, EventMask, Notice};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    CommandProvider, DataRead, DataWrite, EventHandler, HostApi, IndexLoss, IndexProvider,
    IndexQuery, IndexResult, Plugin, PluginManifest, QueryRoute,
};
use fub_abi::PluginError;
use fub_host::registry::{Bundle, BundleRegistry};
use fub_host::{Custody, Host, JobHost, NoWatcher};
use fub_kernel::{Trust, Workspace};

const OWNER: &str = "fub.audit-drop-owner";
const OBSERVER: &str = "fub.audit-drop-observer";
const WATCHDOG: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Resource {
    Index,
    FirstHandler,
    SecondHandler,
    Command,
}

#[derive(Debug)]
struct Entered {
    resource: Resource,
    workspace_read: bool,
    workspace_write: bool,
    registry_read: bool,
    registry_write: bool,
    owner_declared: bool,
}

struct Probe {
    workspace: Mutex<Option<Custody<Workspace>>>,
    registry: Mutex<Option<Custody<BundleRegistry>>>,
    entered: mpsc::Sender<Entered>,
    release: Mutex<mpsc::Receiver<()>>,
    completed: mpsc::Sender<bool>,
    panic_at: Option<Resource>,
}

impl Probe {
    fn drop_resource(&self, resource: Resource) {
        let workspace = self.workspace.lock().unwrap().as_ref().unwrap().clone();
        let registry = self.registry.lock().unwrap().as_ref().unwrap().clone();
        let (workspace_read, owner_declared) = workspace
            .try_read()
            .map(|ws| (true, ws.trust_of(OWNER).is_some()))
            .unwrap_or((false, false));
        let workspace_write = workspace.try_write().is_some();
        let registry_read = registry.try_read().is_some();
        let registry_write = registry.try_write().is_some();
        self.entered
            .send(Entered {
                resource,
                workspace_read,
                workspace_write,
                registry_read,
                registry_write,
                owner_declared,
            })
            .expect("drop observer remains alive");
        self.release
            .lock()
            .unwrap()
            .recv_timeout(WATCHDOG)
            .expect("independent reader releases the destructor");
        let mut host = JobHost::new(workspace, OBSERVER);
        let key = format!("disposed-{resource:?}");
        let capability_live = workspace_read
            && workspace_write
            && registry_read
            && registry_write
            && host.data_write(&key, b"yes").is_ok()
            && matches!(host.data_read(&key), Ok(Some(bytes)) if bytes == b"yes");
        self.completed
            .send(capability_live)
            .expect("drop completion observer remains alive");
        if self.panic_at == Some(resource) {
            panic!("teardown drop probe: {resource:?}");
        }
    }
}

struct DropHandler {
    resource: Resource,
    probe: Arc<Probe>,
}

impl Drop for DropHandler {
    fn drop(&mut self) {
        self.probe.drop_resource(self.resource);
    }
}

impl EventHandler for DropHandler {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::Custom])
    }

    fn handle(&mut self, _: &Notice, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

struct DropCommand(Arc<Probe>);

impl Drop for DropCommand {
    fn drop(&mut self) {
        self.0.drop_resource(Resource::Command);
    }
}

impl CommandProvider for DropCommand {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(format!("{OWNER}.probe"), "Drop probe")]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        _: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Ok(CommandOutcome::notify("probe"))
    }
}

struct DropIndex(Arc<Probe>);

impl Drop for DropIndex {
    fn drop(&mut self) {
        self.0.drop_resource(Resource::Index);
    }
}

impl IndexProvider for DropIndex {
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
    fn flush(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn query(&self, _: IndexQuery) -> Result<IndexResult, PluginError> {
        unreachable!("drop fixture declares no query route")
    }
}

struct EmptyPlugin;

impl Plugin for EmptyPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(OWNER, OWNER)
    }
    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn deactivate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

struct DropBundle(Arc<Probe>);

impl Bundle for DropBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(OWNER, OWNER)
    }
    fn trust(&self) -> Trust {
        Trust::Core
    }
    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(EmptyPlugin)
    }
    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        ws.register_index_provider(OWNER, Box::new(DropIndex(self.0.clone())))
            .expect("register index");
        for resource in [Resource::FirstHandler, Resource::SecondHandler] {
            ws.register_event_handler(
                OWNER,
                Box::new(DropHandler {
                    resource,
                    probe: self.0.clone(),
                }),
            )
            .expect("register event handler");
        }
        ws.register_command_provider(OWNER, Box::new(DropCommand(self.0.clone())))
            .expect("register command");
        Vec::new()
    }
}

#[derive(Clone, Copy)]
enum Path {
    Disable,
    Close,
    StaleFlush,
    Incomplete,
}

impl Path {
    fn is_manual(self) -> bool {
        matches!(self, Self::StaleFlush | Self::Incomplete)
    }
}

fn finish_manual(
    workspace: &Custody<Workspace>,
    path: Path,
) -> Result<Vec<PluginError>, PluginError> {
    let mut prepared = workspace
        .write()?
        .prepare_plugin_teardown(OWNER)
        .map_err(|error| PluginError::Internal(error.to_string().into()))?;
    let mut host = JobHost::new(workspace.clone(), OWNER);
    let mut errors;
    if matches!(path, Path::StaleFlush) {
        // Frame esterno teardown, frame interno flush: la finalize interna
        // ripristina quello esterno, che resta vivo fino al ritiro dell'owner.
        let snapshot = workspace.write()?.prepare_index_flush();
        let flush_errors = snapshot.invoke(|id, invoke| {
            let mut host = JobHost::new(workspace.clone(), id);
            invoke(&mut host)
        });
        workspace
            .write()?
            .take_plugin_teardown_indexes(&mut prepared)?;
        let mut flush_errors = flush_errors;
        flush_errors.extend(prepared.invoke_indexes(&mut host));
        // Lo snapshot mantiene l'ultimo handle: il disposer scatta soltanto
        // quando RetiredPlugin viene consumato, dopo aver lasciato il guard.
        let retired = workspace
            .write()?
            .finish_index_flush(snapshot, flush_errors)
            .map_err(|(_, error)| error)?;
        errors = retired.dispose();
    } else {
        workspace
            .write()?
            .take_plugin_teardown_indexes(&mut prepared)?;
        let retired = workspace
            .write()?
            .finish_plugin_teardown(prepared, Vec::new())
            .map_err(|(_, error)| error)?;
        errors = retired.dispose();
        assert!(
            workspace.read()?.trust_of(OWNER).is_some(),
            "incomplete finalization must retain the declaration"
        );
        prepared = workspace
            .write()?
            .prepare_plugin_teardown(OWNER)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        workspace
            .write()?
            .take_plugin_teardown_indexes(&mut prepared)?;
        errors.extend(prepared.invoke_indexes(&mut host));
    }
    let retired = workspace
        .write()?
        .finish_plugin_teardown(prepared, Vec::new())
        .map_err(|(_, error)| error)?;
    errors.extend(retired.dispose());
    Ok(errors)
}

fn exercise(path: Path, panic_at: Option<Resource>) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 root");
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).expect("open vault");
    host.wait_indexed(None).expect("finish startup");
    let workspace = host.debug_workspace(None).expect("workspace custody");
    let registry = host
        .in_session(None, |session| Ok(session.bundles().clone()))
        .expect("registry custody");
    let (entered, observations) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (completed, completions) = mpsc::channel();
    let probe = Arc::new(Probe {
        workspace: Mutex::new(Some(workspace.clone())),
        registry: Mutex::new(Some(registry.clone())),
        entered,
        release: Mutex::new(released),
        completed,
        panic_at,
    });
    {
        let mut ws = workspace.write().unwrap();
        // Questa capacità indipendente resta viva durante il teardown inverso.
        ws.register_core_feature(OBSERVER, OBSERVER)
            .expect("declare observer");
        if path.is_manual() {
            ws.register_core_feature(OWNER, OWNER)
                .expect("declare manual owner");
            assert!(DropBundle(probe.clone()).register(&mut ws).is_empty());
        } else {
            registry
                .write()
                .unwrap()
                .mount(&DropBundle(probe.clone()), &mut ws)
                .expect("mount drop fixture");
        }
    }
    let (done_tx, done_rx) = mpsc::channel();
    let callback_workspace = workspace.clone();
    let worker = std::thread::spawn(move || {
        let outcome = match path {
            Path::Close => Ok(host.close()),
            Path::Disable => host.set_plugin_enabled(None, OWNER, false),
            Path::StaleFlush | Path::Incomplete => finish_manual(&callback_workspace, path),
        };
        done_tx.send((host, outcome)).unwrap();
    });
    let mut journal = Vec::new();
    let mut readers_progressed = true;
    let mut reentered = true;
    for _ in 0..4 {
        let observation = observations
            .recv_timeout(WATCHDOG)
            .expect("every destructor runs despite earlier panics");
        let other_workspace = workspace.clone();
        let reader = std::thread::spawn(move || other_workspace.try_read().is_some());
        readers_progressed &= reader.join().expect("independent reader completes");
        release
            .send(())
            .expect("destructor remains suspended until reader finishes");
        reentered &= completions
            .recv_timeout(WATCHDOG)
            .expect("drop re-entry completes");
        journal.push(observation);
    }
    let (host, result) = done_rx.recv_timeout(WATCHDOG).expect("teardown finalizes");
    worker
        .join()
        .expect("production contains destructor panics");
    probe.workspace.lock().unwrap().take();
    probe.registry.lock().unwrap().take();
    let errors = result.expect("host operation completes");
    if panic_at.is_some() {
        assert!(
            errors
                .iter()
                .any(|error| error.to_string().contains("teardown drop probe")),
            "destructor panic must be reported: {errors:?}"
        );
    } else if !path.is_manual() {
        assert!(errors.is_empty(), "clean destruction: {errors:?}");
    }
    if path.is_manual() {
        assert_eq!(
            errors
                .iter()
                .filter(|error| matches!(error, PluginError::Conflict(_)))
                .count(),
            1,
            "stale/incomplete finalization reports its typed conflict: {errors:?}"
        );
        assert_eq!(
            errors.len(),
            1 + usize::from(panic_at.is_some()),
            "only the conflict and injected Drop fault are expected: {errors:?}"
        );
    }
    assert!(
        readers_progressed,
        "reader blocked during destruction: {journal:?}"
    );
    assert!(
        reentered,
        "independent host capability failed during destruction: {journal:?}"
    );
    for observation in &journal {
        assert!(
            observation.workspace_read
                && observation.workspace_write
                && observation.registry_read
                && observation.registry_write,
            "external destructor retained custody: {observation:?}"
        );
        assert_eq!(
            observation.owner_declared,
            observation.resource == Resource::Index,
            "index disposes before retirement; other providers after finalize: {observation:?}"
        );
    }
    for resource in [
        Resource::Index,
        Resource::FirstHandler,
        Resource::SecondHandler,
        Resource::Command,
    ] {
        assert_eq!(
            journal
                .iter()
                .filter(|entry| entry.resource == resource)
                .count(),
            1,
            "each resource is destroyed exactly once: {journal:?}"
        );
    }
    let first_handler = journal
        .iter()
        .position(|entry| entry.resource == Resource::FirstHandler)
        .unwrap();
    let second_handler = journal
        .iter()
        .position(|entry| entry.resource == Resource::SecondHandler)
        .unwrap();
    assert!(
        first_handler < second_handler,
        "a first handler's panic must not skip the next: {journal:?}"
    );
    assert!(workspace.try_write().is_some(), "workspace remains healthy");
    assert!(registry.try_write().is_some(), "registry remains healthy");
    assert!(workspace.read().unwrap().trust_of(OWNER).is_none());
    assert!(host.close().is_empty());
}

#[test]
fn disable_and_close_drop_providers_outside_custody_with_reader_and_host_progress() {
    for path in [Path::Disable, Path::Close] {
        exercise(path, None);
    }
}

#[test]
fn index_and_handler_drop_panics_do_not_skip_later_disposers() {
    for path in [Path::Disable, Path::Close] {
        for resource in [Resource::Index, Resource::FirstHandler] {
            exercise(path, Some(resource));
        }
    }
}

#[test]
fn stale_flush_snapshot_drops_its_last_index_handle_outside_custody() {
    for panic_at in [None, Some(Resource::Index)] {
        exercise(Path::StaleFlush, panic_at);
    }
}

#[test]
fn incomplete_teardown_returns_its_indexes_for_detached_destruction() {
    for panic_at in [None, Some(Resource::Index)] {
        exercise(Path::Incomplete, panic_at);
    }
}
