//! C-04: toggle e chiusura chiamano il teardown fuori dalle due custodie.
//! Il mount della fixture precede l'armamento: questa prova non certifica mount.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    CommandProvider, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, Plugin,
    PluginManifest, QueryRoute,
};
use fub_abi::{Event, PluginError};
use fub_host::registry::{Bundle, BundleRegistry, Registrar};
use fub_host::{Custody, Host, NoWatcher};
use fub_kernel::{Trust, Workspace};

const FIRST: &str = "fub.audit-teardown-first";
const SECOND: &str = "fub.audit-teardown-second";
const WATCHDOG: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Deactivate,
    Flush,
    Close,
}

#[derive(Clone, Copy, Debug)]
enum Fault {
    None,
    Error(Stage),
    Panic(Stage),
}

struct Observation {
    id: &'static str,
    stage: Stage,
    workspace_read: bool,
    workspace_write: bool,
    registry_read: bool,
    registry_write: bool,
}

struct Probe {
    armed: AtomicBool,
    // La fixture stacca esplicitamente questo riferimento per evitare cicli.
    workspace: Mutex<Option<Custody<Workspace>>>,
    registry: Mutex<Option<Custody<BundleRegistry>>>,
    entered: mpsc::Sender<Observation>,
    release: Mutex<mpsc::Receiver<()>>,
    fault: Fault,
}

impl Probe {
    fn call(
        &self,
        id: &'static str,
        stage: Stage,
        host: &mut dyn HostApi,
    ) -> Result<(), PluginError> {
        if !self.armed.load(Ordering::SeqCst) {
            return Ok(());
        }
        let workspace = self.workspace.lock().unwrap().as_ref().unwrap().clone();
        let registry = self.registry.lock().unwrap().as_ref().unwrap().clone();
        let workspace_read = workspace.try_read().is_some();
        let workspace_write = workspace.try_write().is_some();
        let registry_read = registry.try_read().is_some();
        let registry_write = registry.try_write().is_some();
        self.entered
            .send(Observation {
                id,
                stage,
                workspace_read,
                workspace_write,
                registry_read,
                registry_write,
            })
            .expect("the observer is alive");
        self.release
            .lock()
            .unwrap()
            .recv_timeout(WATCHDOG)
            .expect("the independent reader releases this callback");
        if !(workspace_read && workspace_write && registry_read && registry_write) {
            // Una regressione viene riportata senza tentare una re-entry morta.
            return Err(PluginError::Internal("teardown retained custody".into()));
        }
        let key = format!("teardown-{stage:?}");
        host.data_write(&key, id.as_bytes())?;
        assert_eq!(host.data_read(&key)?, Some(id.as_bytes().to_vec()));
        match self.fault {
            Fault::Error(at) if at == stage => {
                Err(PluginError::Internal("teardown probe error".into()))
            }
            Fault::Panic(at) if at == stage => panic!("teardown probe panic"),
            _ => Ok(()),
        }
    }
}

struct ProbeBundle {
    id: &'static str,
    probe: Arc<Probe>,
}

impl Bundle for ProbeBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.id)
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(ProbePlugin {
            id: self.id,
            probe: self.probe.clone(),
        })
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        registrar
            .register_command_provider(Box::new(ProbeCommand(self.id)))
            .expect("register command");
        registrar
            .register_index_provider(Box::new(ProbeIndex {
                id: self.id,
                probe: self.probe.clone(),
            }))
            .expect("register index");
        Vec::new()
    }
}

struct ProbePlugin {
    id: &'static str,
    probe: Arc<Probe>,
}

impl Plugin for ProbePlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.id)
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.probe.call(self.id, Stage::Deactivate, host)
    }
}

struct ProbeCommand(&'static str);

impl CommandProvider for ProbeCommand {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(format!("{}.probe", self.0), "Probe")]
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

struct ProbeIndex {
    id: &'static str,
    probe: Arc<Probe>,
}

impl IndexProvider for ProbeIndex {
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

    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.probe.call(self.id, Stage::Flush, host)
    }

    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.probe.call(self.id, Stage::Close, host)
    }

    fn query(&self, _: IndexQuery) -> Result<IndexResult, PluginError> {
        unreachable!("the probe declares no query route")
    }
}

fn exercise(close: bool, fault: Fault) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 root");
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).expect("open vault");
    host.wait_indexed(None)
        .expect("finish startup before installing probes");
    let workspace = host.debug_workspace(None).expect("workspace custody");
    let registry = host
        .in_session(None, |session| Ok(session.bundles().clone()))
        .expect("registry custody");
    let events = workspace.read().unwrap().bus().subscribe();
    let (entered, observations) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let probe = Arc::new(Probe {
        armed: AtomicBool::new(false),
        workspace: Mutex::new(Some(workspace.clone())),
        registry: Mutex::new(Some(registry.clone())),
        entered,
        release: Mutex::new(released),
        fault,
    });
    let owners = if close {
        vec![FIRST, SECOND]
    } else {
        vec![FIRST]
    };
    for &id in &owners {
        let mut ws = workspace.write().unwrap();
        registry
            .write()
            .unwrap()
            .mount(
                &ProbeBundle {
                    id,
                    probe: probe.clone(),
                },
                &mut ws,
            )
            .expect("mount fixture before arming");
    }
    probe.armed.store(true, Ordering::SeqCst);
    let (done_tx, done_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let result = if close {
            Ok(host.close())
        } else {
            host.set_plugin_enabled(None, FIRST, false)
        };
        done_tx.send((host, result)).unwrap();
    });
    let count = if close { 8 } else { 3 };
    let mut journal = Vec::new();
    let mut all_free = true;
    for _ in 0..count {
        let observation = observations
            .recv_timeout(WATCHDOG)
            .expect("each callback is reached, even after an earlier failure");
        all_free &= observation.workspace_read
            && observation.workspace_write
            && observation.registry_read
            && observation.registry_write;
        journal.push((observation.id, observation.stage));
        // La callback è ancora ferma su release: il progresso del reader è
        // una relazione causale a canali, non un'inferenza da un timeout.
        let other_workspace = workspace.clone();
        let reader = std::thread::spawn(move || other_workspace.try_read().is_some());
        let reader_free = reader.join().expect("reader does not panic");
        release.send(()).expect("callback still waiting");
        all_free &= reader_free;
    }
    let (host, outcome) = done_rx
        .recv_timeout(WATCHDOG)
        .expect("teardown finalizes after every callback");
    worker
        .join()
        .expect("callback panics are contained by production");
    probe.armed.store(false, Ordering::SeqCst);
    probe.workspace.lock().unwrap().take();
    probe.registry.lock().unwrap().take();
    let errors = outcome.expect("host operation completes");
    assert!(
        all_free,
        "workspace or registry guard survived into {journal:?}"
    );
    match fault {
        Fault::None => assert!(errors.is_empty(), "clean teardown: {errors:?}"),
        _ => assert!(
            errors
                .iter()
                .any(|error| error.to_string().contains("teardown probe")),
            "callback fault must be reported: {fault:?}: {errors:?}"
        ),
    }
    let ws = workspace.read().expect("workspace is not poisoned");
    for id in owners {
        assert!(ws.trust_of(id).is_none(), "declaration survived for {id}");
        assert!(!ws
            .commands()
            .iter()
            .any(|command| command.id == format!("{id}.probe")));
        assert!(!registry.read().unwrap().ids().contains(&id));
        let stages: Vec<_> = journal
            .iter()
            .filter(|(owner, _)| *owner == id)
            .map(|(_, stage)| *stage)
            .collect();
        let expected = if close {
            vec![Stage::Flush, Stage::Deactivate, Stage::Flush, Stage::Close]
        } else {
            vec![Stage::Deactivate, Stage::Flush, Stage::Close]
        };
        assert_eq!(stages, expected, "teardown order for {id}");
    }
    if close {
        assert!(ws.is_closed());
        let deactivated: Vec<_> = journal
            .iter()
            .filter(|(_, stage)| *stage == Stage::Deactivate)
            .map(|(id, _)| *id)
            .collect();
        assert_eq!(deactivated, [SECOND, FIRST]);
    }
    drop(ws);
    assert!(
        workspace.try_write().is_some(),
        "no poisoned guard or leaked turn"
    );
    assert!(host.close().is_empty(), "repeated close is harmless");
    if close {
        assert_eq!(
            events
                .try_iter()
                .filter(|notice| matches!(notice.event, Event::VaultClosed { .. }))
                .count(),
            1
        );
    }
}

#[test]
fn disable_detaches_deactivate_and_index_teardown_with_reader_progress() {
    exercise(false, Fault::None);
}

#[test]
fn close_detaches_all_callbacks_and_preserves_reverse_order_once() {
    exercise(true, Fault::None);
}

#[test]
fn teardown_errors_and_panics_do_not_skip_cleanup_or_poison_custody() {
    for close in [false, true] {
        for stage in [Stage::Deactivate, Stage::Flush, Stage::Close] {
            for fault in [Fault::Error(stage), Fault::Panic(stage)] {
                exercise(close, fault);
            }
        }
    }
}
