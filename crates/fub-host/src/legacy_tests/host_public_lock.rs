use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use crate::registry::Registrar;
use camino::Utf8PathBuf;
use fub_abi::edit::Revision;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::grid::{
    GridApplyRequest, GridCommit, GridProvider, GridSession, GridSurfaceSpec, GridWindow,
    GridWindowRequest,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, Plugin, PluginManifest, QueryRoute,
    ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiNode, ViewUpdate};
use fub_abi::PluginError;
use fub_host::{Bundle, Custody, Host, PreparedFormatSource};
use fub_kernel::{Trust, Workspace};

const PLUGIN: &str = "fub.audit-host-public-lock";
const VIEW: &str = "host-public-lock-view";
const TIMEOUT: Duration = Duration::from_secs(5);

type WorkspaceSlot = Arc<Mutex<Option<Custody<Workspace>>>>;
// `try_write` is a point-in-time observation. macOS can report transient
// contention while the runner finishes a short, unrelated workspace access,
// so wait through the test watchdog before reporting a retained guard.
fn workspace_is_free(workspace: &Custody<Workspace>) -> bool {
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline {
        if let Some(write) = workspace.try_write() {
            drop(write);
            return true;
        }
        std::thread::yield_now();
    }
    false
}

fn vault(extension: &str) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("temporary vault");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 vault path");
    std::fs::write(root.join(format!("Note.{extension}")), "# Note\n").expect("seed note");
    (dir, root)
}

struct ReentrantFormat {
    workspace: WorkspaceSlot,
    free: Arc<AtomicBool>,
}

impl ReentrantFormat {
    fn check_workspace_is_free(&self) -> Result<(), FormatError> {
        let workspace = self.workspace.lock().expect("workspace slot");
        if let Some(workspace) = workspace.as_ref() {
            if !workspace_is_free(workspace) {
                self.free.store(false, Ordering::Release);
                return Err(FormatError::Parse(
                    "Host retained the workspace lock during a format callback".into(),
                ));
            }
        }
        Ok(())
    }
}

impl fub_abi::FormatProvider for ReentrantFormat {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text(
            "host-public-lock-format",
            "Host public lock format",
            &["txt"],
        )
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        _source: &DocumentSource,
        context: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        self.check_workspace_is_free()?;
        Ok(DocumentModel::empty(DocId::new(context.doc_id.clone())))
    }

    fn render_html(
        &self,
        _model: &DocumentModel,
        _options: &RenderOptions,
    ) -> Result<String, FormatError> {
        self.check_workspace_is_free()?;
        Ok("<p>detached</p>".into())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

#[test]
fn host_model_and_preview_release_workspace_before_format_callbacks() {
    let (_dir, root) = vault("txt");
    let workspace = Arc::new(Mutex::new(None));
    let free = Arc::new(AtomicBool::new(true));
    let source_workspace = Arc::clone(&workspace);
    let source_free = Arc::clone(&free);
    let host = Host::without_watcher().with_format_source(Arc::new(move || {
        Ok(PreparedFormatSource::from_provider(Box::new(
            ReentrantFormat {
                workspace: Arc::clone(&source_workspace),
                free: Arc::clone(&source_free),
            },
        )))
    }));

    host.open(&root).expect("vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");
    *workspace.lock().expect("workspace slot") =
        Some(host.debug_workspace(None).expect("workspace"));

    let id = DocId::new("Note.txt");
    host.read_model(None, &id)
        .expect("model callback re-enters");
    host.render_preview(None, &id)
        .expect("preview callback re-enters");
    assert!(
        free.load(Ordering::Acquire),
        "a format callback retained Custody<Workspace>"
    );
    assert!(host.close().is_empty(), "host closes cleanly");
}

struct ReentrantView {
    workspace: WorkspaceSlot,
    free: Arc<AtomicBool>,
}

impl ReentrantView {
    fn check_workspace_is_free(&self) {
        let workspace = self.workspace.lock().expect("workspace slot");
        if let Some(workspace) = workspace.as_ref() {
            if !workspace_is_free(workspace) {
                self.free.store(false, Ordering::Release);
            }
        }
    }
}

impl ViewProvider for ReentrantView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(VIEW, "Host lock probe", ViewSurface::Main)]
    }

    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        self.check_workspace_is_free();
        ViewInterests::default()
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("probe"))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: fub_abi::ui::UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}

struct ViewPlugin;

impl Plugin for ViewPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(PLUGIN, "Host public view lock probe")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

struct ViewBundle {
    workspace: WorkspaceSlot,
    free: Arc<AtomicBool>,
}

impl Bundle for ViewBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(PLUGIN, "Host public view lock probe")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(ViewPlugin)
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        registrar
            .register_view_provider(Box::new(ReentrantView {
                workspace: Arc::clone(&self.workspace),
                free: Arc::clone(&self.free),
            }))
            .expect("view provider registers");
        Vec::new()
    }
}

#[test]
fn host_view_interests_releases_workspace_before_provider_callback() {
    let (_dir, root) = vault("md");
    let workspace = Arc::new(Mutex::new(None));
    let free = Arc::new(AtomicBool::new(true));
    let host = Host::without_watcher();
    host.open(&root).expect("vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");
    host.mount_bundle(
        None,
        Arc::new(ViewBundle {
            workspace: Arc::clone(&workspace),
            free: Arc::clone(&free),
        }),
    )
    .expect("view bundle mounts");
    *workspace.lock().expect("workspace slot") =
        Some(host.debug_workspace(None).expect("workspace"));

    host.view_interests(None, &ViewInstance::only(VIEW))
        .expect("interests callback re-enters");
    assert!(
        free.load(Ordering::Acquire),
        "view interests retained Custody<Workspace>"
    );
    assert!(host.close().is_empty(), "host closes cleanly");
}

struct JobPlugin {
    entered: Option<mpsc::SyncSender<()>>,
    release: Option<Arc<Mutex<mpsc::Receiver<()>>>>,
}

impl Plugin for JobPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(PLUGIN, "Host public job lifecycle probe")
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
        _host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        match job {
            "block" => {
                self.entered
                    .as_ref()
                    .expect("blocking probe sender")
                    .send(())
                    .expect("blocking probe receiver");
                self.release
                    .as_ref()
                    .expect("blocking probe receiver")
                    .lock()
                    .expect("release receiver")
                    .recv()
                    .expect("release signal");
                Ok(serde_json::json!({"released": true}))
            }
            "panic" => panic!("planned public invoke panic"),
            _ => Err(PluginError::UnknownJob(job.into())),
        }
    }
}

struct JobBundle {
    entered: Option<mpsc::SyncSender<()>>,
    release: Option<Arc<Mutex<mpsc::Receiver<()>>>>,
}

impl Bundle for JobBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(PLUGIN, "Host public job lifecycle probe")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(JobPlugin {
            entered: self.entered.clone(),
            release: self.release.as_ref().map(Arc::clone),
        })
    }

    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        Vec::new()
    }
}

#[test]
fn host_unmount_waits_for_inflight_job_and_invoke_contains_panic() {
    let (_dir, root) = vault("md");
    let host = Arc::new(Host::without_watcher().with_job_threads(1));
    host.open(&root).expect("vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");

    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    host.mount_bundle(
        None,
        Arc::new(JobBundle {
            entered: Some(entered_tx),
            release: Some(Arc::new(Mutex::new(release_rx))),
        }),
    )
    .expect("job bundle mounts");

    let job = host
        .spawn_job(None, PLUGIN, "block", serde_json::Value::Null)
        .expect("blocking job queues");
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("blocking job enters the runner");

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let unmount_host = Arc::clone(&host);
    let unmount = std::thread::spawn(move || {
        let result = unmount_host.unmount_bundle(None, PLUGIN);
        done_tx.send(result).expect("unmount result receiver");
    });
    assert!(
        done_rx.recv_timeout(Duration::from_millis(100)).is_err(),
        "unmount returned while the plugin job was still inside"
    );
    release_tx.send(()).expect("blocking job releases");
    let errors = done_rx
        .recv_timeout(TIMEOUT)
        .expect("unmount completes after job release")
        .expect("unmount call succeeds");
    unmount.join().expect("unmount thread does not panic");
    assert!(
        errors.is_empty(),
        "unmount has no lifecycle errors: {errors:?}"
    );

    // The public synchronous API uses the same panic boundary as the worker
    // path, rather than unwinding into its caller.
    host.mount_bundle(
        None,
        Arc::new(JobBundle {
            entered: None,
            release: None,
        }),
    )
    .expect("panic probe remounts");
    let panic = host.invoke_job(None, PLUGIN, "panic", serde_json::Value::Null);
    assert!(
        matches!(panic, Err(PluginError::Internal(_))),
        "panic escaped: {panic:?}"
    );
    host.cancel_job(None, job)
        .expect("finished job cancellation is harmless");
    assert!(host.close().is_empty(), "host closes cleanly");
}

const PUBLIC_LIFECYCLE_PLUGIN: &str = "fub.audit-public-unmount-lifecycle";

#[derive(Clone)]
struct LifecycleProbe(Arc<Mutex<Vec<&'static str>>>);

impl LifecycleProbe {
    fn record(&self, event: &'static str) {
        self.0.lock().expect("lifecycle journal").push(event);
    }
}

struct LifecycleIndex(LifecycleProbe);

impl Drop for LifecycleIndex {
    fn drop(&mut self) {
        self.0.record("index-drop");
    }
}

impl IndexProvider for LifecycleIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, _documents: &[DocumentModel]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn on_documents_removed(&mut self, _documents: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _documents: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.0.record("index-flush");
        Ok(())
    }

    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.0.record("index-close");
        Ok(())
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        unreachable!("lifecycle index declares no query route")
    }
}

struct LifecycleGrid {
    probe: LifecycleProbe,
    panic_on_shutdown: bool,
}

impl Drop for LifecycleGrid {
    fn drop(&mut self) {
        self.probe.record("grid-drop");
    }
}

impl GridProvider for LifecycleGrid {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec::new(
            "fub.audit-public-unmount-grid",
            "fub.audit-public-unmount-format",
        )]
    }

    fn open(
        &mut self,
        _surface: &str,
        _source: &str,
        _revision: Revision,
    ) -> Result<GridSession, PluginError> {
        unreachable!("lifecycle grid is not opened")
    }

    fn window(
        &mut self,
        _instance: &str,
        _request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        unreachable!("lifecycle grid is not opened")
    }

    fn apply(
        &mut self,
        _instance: &str,
        _request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        unreachable!("lifecycle grid is not opened")
    }

    fn reload(
        &mut self,
        _instance: &str,
        _expected: Revision,
        _source: &str,
        _revision: Revision,
    ) -> Result<GridSession, PluginError> {
        unreachable!("lifecycle grid is not opened")
    }

    fn close(&mut self, _instance: &str) -> Result<(), PluginError> {
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        self.probe.record("grid-shutdown");
        if self.panic_on_shutdown {
            panic!("public grid shutdown panic");
        }
        Ok(())
    }
}

struct LifecyclePlugin {
    probe: LifecycleProbe,
    entered: Option<mpsc::SyncSender<()>>,
    release: Option<Arc<Mutex<mpsc::Receiver<()>>>>,
}

impl Drop for LifecyclePlugin {
    fn drop(&mut self) {
        self.probe.record("plugin-drop");
    }
}

impl Plugin for LifecyclePlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(PUBLIC_LIFECYCLE_PLUGIN, "Public unmount lifecycle probe")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.probe.record("plugin-deactivate");
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        _payload: serde_json::Value,
        _host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        if job != "block" {
            return Err(PluginError::UnknownJob(job.into()));
        }
        self.entered
            .as_ref()
            .expect("lifecycle entered sender")
            .send(())
            .expect("lifecycle entered receiver");
        self.release
            .as_ref()
            .expect("lifecycle release receiver")
            .lock()
            .expect("lifecycle release lock")
            .recv()
            .expect("lifecycle release signal");
        Ok(serde_json::Value::Null)
    }
}

struct LifecycleBundle {
    probe: LifecycleProbe,
    entered: mpsc::SyncSender<()>,
    release: Arc<Mutex<mpsc::Receiver<()>>>,
}

impl Bundle for LifecycleBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(PUBLIC_LIFECYCLE_PLUGIN, "Public unmount lifecycle probe")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(LifecyclePlugin {
            probe: self.probe.clone(),
            entered: Some(self.entered.clone()),
            release: Some(Arc::clone(&self.release)),
        })
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        registrar
            .register_index_provider(Box::new(LifecycleIndex(self.probe.clone())))
            .expect("lifecycle index registers");
        registrar
            .register_grid_provider(Box::new(LifecycleGrid {
                probe: self.probe.clone(),
                panic_on_shutdown: true,
            }))
            .expect("lifecycle grid registers");
        Vec::new()
    }
}

#[test]
fn public_unmount_waits_and_completes_grid_index_and_disposal_after_grid_panic() {
    let (_dir, root) = vault("md");
    let host = Arc::new(Host::without_watcher().with_job_threads(1));
    host.open(&root).expect("vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");

    let journal = Arc::new(Mutex::new(Vec::new()));
    let probe = LifecycleProbe(Arc::clone(&journal));
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    host.mount_bundle(
        None,
        Arc::new(LifecycleBundle {
            probe,
            entered: entered_tx,
            release: Arc::new(Mutex::new(release_rx)),
        }),
    )
    .expect("lifecycle bundle mounts");
    host.spawn_job(
        None,
        PUBLIC_LIFECYCLE_PLUGIN,
        "block",
        serde_json::Value::Null,
    )
    .expect("blocking job queues");
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("blocking job enters runner");

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let unmount_host = Arc::clone(&host);
    let unmount = std::thread::spawn(move || {
        done_tx
            .send(unmount_host.unmount_bundle(None, PUBLIC_LIFECYCLE_PLUGIN))
            .expect("unmount result receiver");
    });
    assert!(
        done_rx.recv_timeout(Duration::from_millis(100)).is_err(),
        "public unmount returned before the in-flight job finished"
    );
    release_tx.send(()).expect("blocking job releases");
    let errors = done_rx
        .recv_timeout(TIMEOUT)
        .expect("public unmount finishes")
        .expect("public unmount call succeeds");
    unmount.join().expect("unmount thread does not panic");
    assert!(
        errors
            .iter()
            .any(|error| error.to_string().contains("public grid shutdown panic")),
        "grid shutdown panic is aggregated: {errors:?}"
    );

    let journal = journal.lock().expect("lifecycle journal").clone();
    for event in [
        "plugin-deactivate",
        "grid-shutdown",
        "index-flush",
        "index-close",
        "index-drop",
        "grid-drop",
        "plugin-drop",
    ] {
        assert_eq!(
            journal.iter().filter(|entry| **entry == event).count(),
            1,
            "{event} runs exactly once: {journal:?}"
        );
    }
    let position = |event| {
        journal
            .iter()
            .position(|entry| *entry == event)
            .expect("lifecycle event present")
    };
    assert!(
        position("plugin-deactivate") < position("grid-shutdown")
            && position("grid-shutdown") < position("index-flush")
            && position("index-flush") < position("index-close")
            && position("index-close") < position("index-drop")
            && position("index-drop") < position("grid-drop")
            && position("grid-drop") < position("plugin-drop"),
        "public unmount preserves complete teardown order: {journal:?}"
    );
    assert!(host.close().is_empty(), "host closes after public unmount");
}
