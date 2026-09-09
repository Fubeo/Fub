//! Declaration callbacks and rejected provider destructors run without Custody.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::traits::{CommandProvider, HostApi, PluginManifest};
use fub_abi::PluginError;
use fub_host::registry::{Bundle, BundleRegistry, OnlyProviders, Registrar};
use fub_host::Custody;
use fub_kernel::workspace::PreparedRegistration;
use fub_kernel::{RegistryError, Trust, Workspace};

const OWNER: &str = "fub.registration-probe";

struct Probe {
    workspace: Arc<Mutex<Option<Custody<Workspace>>>>,
    registry: Option<Arc<Mutex<Option<Custody<BundleRegistry>>>>>,
    calls: Arc<AtomicUsize>,
    dropped_without_guard: Arc<AtomicBool>,
    rendezvous: Option<(mpsc::SyncSender<()>, Mutex<mpsc::Receiver<()>>)>,
    panic: bool,
    panic_in_drop: bool,
}

impl CommandProvider for Probe {
    fn commands(&self) -> Vec<CommandSpec> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        assert!(
            self.workspace
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .try_write()
                .is_some(),
            "declaration re-entry"
        );
        if let Some(registry) = &self.registry {
            assert!(
                registry
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .try_write()
                    .is_some(),
                "registry declaration re-entry"
            );
        }
        if let Some((entered, release)) = &self.rendezvous {
            entered.send(()).unwrap();
            release.lock().unwrap().recv().unwrap();
        }
        assert!(!self.panic, "declaration failed");
        vec![CommandSpec::new("probe.command", "Probe")]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        _: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Ok(CommandOutcome::done())
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        let available = self
            .workspace
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|workspace| workspace.try_write().is_some());
        let registry_available = self.registry.as_ref().is_none_or(|registry| {
            registry
                .lock()
                .unwrap()
                .as_ref()
                .is_none_or(|registry| registry.try_write().is_some())
        });
        self.dropped_without_guard
            .store(available && registry_available, Ordering::SeqCst);
        assert!(!self.panic_in_drop, "provider drop failed");
    }
}

fn workspace() -> (tempfile::TempDir, Custody<Workspace>) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    let workspace = Workspace::new(&root, Default::default()).unwrap();
    (dir, Custody::new("registration test", workspace))
}

fn probe(workspace: &Custody<Workspace>) -> Probe {
    Probe {
        workspace: Arc::new(Mutex::new(Some(workspace.clone()))),
        registry: None,
        calls: Arc::new(AtomicUsize::new(0)),
        dropped_without_guard: Arc::new(AtomicBool::new(false)),
        rendezvous: None,
        panic: false,
        panic_in_drop: false,
    }
}

struct ProbeBundle {
    workspace: Custody<Workspace>,
    registry: Arc<Mutex<Option<Custody<BundleRegistry>>>>,
    dropped_without_guard: Arc<AtomicBool>,
}

impl Bundle for ProbeBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(OWNER, "Probe")
    }

    fn plugin(&self) -> Box<dyn fub_abi::traits::Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        let provider = Probe {
            workspace: Arc::new(Mutex::new(Some(self.workspace.clone()))),
            registry: Some(self.registry.clone()),
            calls: Arc::new(AtomicUsize::new(0)),
            dropped_without_guard: self.dropped_without_guard.clone(),
            rendezvous: None,
            panic: false,
            panic_in_drop: false,
        };
        registrar
            .register_command_provider(Box::new(provider))
            .err()
            .map(|error| vec![error.to_string()])
            .unwrap_or_default()
    }
}

#[test]
fn declaration_allows_reentry_and_concurrent_progress_then_commits_without_callback() {
    let (_dir, workspace) = workspace();
    workspace
        .write()
        .unwrap()
        .register_plugin(PluginManifest::core(OWNER, "Probe"), Trust::Core)
        .unwrap();
    let permit = workspace
        .read()
        .unwrap()
        .registration_permit(OWNER)
        .unwrap();
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let mut provider = probe(&workspace);
    let calls = provider.calls.clone();
    let provider_workspace = provider.workspace.clone();
    provider.rendezvous = Some((entered_tx, Mutex::new(release_rx)));
    let worker = std::thread::spawn(move || PreparedRegistration::commands(Box::new(provider)));
    entered_rx.recv().unwrap();
    // The blocked declaration is real external code; a second writer progresses.
    assert!(workspace.try_write().is_some());
    release_tx.send(()).unwrap();
    let mut prepared = worker.join().unwrap().unwrap();
    workspace
        .write()
        .unwrap()
        .commit_registration(&permit, &mut prepared)
        .unwrap();
    // Release the probe's custody clone: mounted providers must not keep the
    // test workspace alive through a reference cycle.
    provider_workspace.lock().unwrap().take();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(workspace.read().unwrap().commands().len(), 1);
    assert!(matches!(
        workspace
            .write()
            .unwrap()
            .commit_registration(&permit, &mut prepared),
        Err(RegistryError::RegistrationPhase(_))
    ));
}

#[test]
fn guarded_mount_and_unmount_leave_callbacks_and_provider_drop_outside_guards() {
    let (_dir, workspace) = workspace();
    let registry = Custody::new("bundle registry test", BundleRegistry::new());
    let provider_registry = Arc::new(Mutex::new(Some(registry.clone())));
    let dropped_without_guard = Arc::new(AtomicBool::new(false));
    BundleRegistry::remember_guarded(
        &registry,
        Arc::new(ProbeBundle {
            workspace: workspace.clone(),
            registry: provider_registry.clone(),
            dropped_without_guard: dropped_without_guard.clone(),
        }),
    )
    .unwrap();

    BundleRegistry::enable_guarded(&registry, &workspace, OWNER).unwrap();
    assert_eq!(workspace.read().unwrap().commands().len(), 1);
    assert!(BundleRegistry::unmount_guarded(&registry, &workspace, OWNER).is_empty());
    assert!(dropped_without_guard.load(Ordering::SeqCst));
    assert!(workspace.read().unwrap().commands().is_empty());
    provider_registry.lock().unwrap().take();
}

#[test]
fn rejected_commit_keeps_provider_until_guard_is_released() {
    let (_dir, workspace) = workspace();
    let provider = probe(&workspace);
    let dropped = provider.dropped_without_guard.clone();
    let mut prepared = PreparedRegistration::commands(Box::new(provider)).unwrap();
    workspace
        .write()
        .unwrap()
        .register_plugin(PluginManifest::core(OWNER, "Probe"), Trust::Core)
        .unwrap();
    let permit = workspace
        .read()
        .unwrap()
        .registration_permit(OWNER)
        .unwrap();
    workspace.write().unwrap().deactivate_plugin(OWNER).unwrap();
    {
        let mut guard = workspace.write().unwrap();
        assert!(matches!(
            guard.commit_registration(&permit, &mut prepared),
            Err(RegistryError::RegistrationPhase(_))
        ));
        assert!(!dropped.load(Ordering::SeqCst));
        assert!(guard.commands().is_empty());
    }
    drop(prepared);
    assert!(dropped.load(Ordering::SeqCst));
}

#[test]
fn a_registration_permit_is_bound_to_workspace_and_declaration_generation() {
    let (_first_dir, first) = workspace();
    let (_second_dir, second) = workspace();
    for workspace in [&first, &second] {
        workspace
            .write()
            .unwrap()
            .register_plugin(PluginManifest::core(OWNER, "Probe"), Trust::Core)
            .unwrap();
    }
    let old = first.read().unwrap().registration_permit(OWNER).unwrap();

    let mut cross_workspace = PreparedRegistration::commands(Box::new(probe(&second))).unwrap();
    assert!(matches!(
        second
            .write()
            .unwrap()
            .commit_registration(&old, &mut cross_workspace),
        Err(RegistryError::RegistrationPhase(_))
    ));
    drop(cross_workspace);

    first.write().unwrap().deactivate_plugin(OWNER).unwrap();
    first
        .write()
        .unwrap()
        .register_plugin(PluginManifest::core(OWNER, "Probe again"), Trust::Core)
        .unwrap();
    let mut stale_generation = PreparedRegistration::commands(Box::new(probe(&first))).unwrap();
    assert!(matches!(
        first
            .write()
            .unwrap()
            .commit_registration(&old, &mut stale_generation),
        Err(RegistryError::RegistrationPhase(_))
    ));
}

#[test]
fn declaration_panic_releases_provider_without_poisoning_workspace() {
    for panic_in_drop in [false, true] {
        let (_dir, workspace) = workspace();
        let mut provider = probe(&workspace);
        provider.panic = true;
        provider.panic_in_drop = panic_in_drop;
        let dropped = provider.dropped_without_guard.clone();
        let result = fub_kernel::safety::external(
            "provider declaration",
            |message| PluginError::Internal(message.into()),
            || PreparedRegistration::commands(Box::new(provider)),
        );
        assert!(matches!(result, Err(PluginError::Internal(_))));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(workspace.write().unwrap().commands().is_empty());
    }
}

struct IndexProbe {
    workspace: Custody<Workspace>,
    routes_calls: Arc<AtomicUsize>,
    closed: Arc<AtomicBool>,
    fail_activation: bool,
}

impl fub_abi::traits::IndexProvider for IndexProbe {
    fn routes(&self) -> Vec<fub_abi::traits::QueryRoute> {
        assert!(self.workspace.try_write().is_some());
        self.routes_calls.fetch_add(1, Ordering::SeqCst);
        vec![fub_abi::traits::QueryRoute::Query(
            fub_abi::traits::QueryKind::Custom(OWNER.into()),
        )]
    }
    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        assert!(self.workspace.try_write().is_some());
        if self.fail_activation {
            Err(PluginError::Internal("lost derived state".into()))
        } else {
            Ok(())
        }
    }
    fn on_documents_indexed(
        &mut self,
        _: &[fub_abi::DocumentModel],
    ) -> Vec<fub_abi::traits::IndexLoss> {
        Vec::new()
    }
    fn on_documents_removed(&mut self, _: &[fub_abi::DocId]) -> Vec<fub_abi::traits::IndexLoss> {
        Vec::new()
    }
    fn reconcile(&mut self, _: &[fub_abi::DocId]) -> Vec<fub_abi::traits::IndexLoss> {
        Vec::new()
    }
    fn flush(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        assert!(self.workspace.try_write().is_some());
        Ok(())
    }
    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        assert!(self.workspace.try_write().is_some());
        self.closed.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn query(
        &self,
        _: fub_abi::traits::IndexQuery,
    ) -> Result<fub_abi::traits::IndexResult, PluginError> {
        Ok(fub_abi::traits::IndexResult::Custom(serde_json::json!(
            "probe"
        )))
    }
}

#[test]
fn index_routes_are_captured_once_and_rejected_activation_is_cleaned_outside_guard() {
    use fub_kernel::workspace::PreparedIndexRegistration;
    let (_dir, workspace) = workspace();
    workspace
        .write()
        .unwrap()
        .register_plugin(PluginManifest::core(OWNER, "Probe"), Trust::Core)
        .unwrap();
    let permit = workspace
        .read()
        .unwrap()
        .registration_permit(OWNER)
        .unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let closed = Arc::new(AtomicBool::new(false));
    let mut prepared = PreparedIndexRegistration::new(Box::new(IndexProbe {
        workspace: workspace.clone(),
        routes_calls: calls.clone(),
        closed: closed.clone(),
        fail_activation: false,
    }))
    .unwrap();
    workspace
        .read()
        .unwrap()
        .admit_index_registration(&permit, &prepared)
        .unwrap();
    let mut host = fub_host::JobHost::new(workspace.clone(), OWNER);
    prepared.activate(&mut host).unwrap();
    // Invalidate the admitted owner before finalize: the stale body must never
    // become reachable and remains available for explicit external cleanup.
    workspace.write().unwrap().deactivate_plugin(OWNER).unwrap();
    assert!(matches!(
        workspace
            .write()
            .unwrap()
            .commit_index_registration(&permit, &mut prepared),
        Err(RegistryError::RegistrationPhase(_))
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(!closed.load(Ordering::SeqCst));
    assert!(prepared.dispose_uncommitted(&mut host).is_empty());
    assert!(closed.load(Ordering::SeqCst));
}
