use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::edit::{EditRequest, Revision, TextEdit, WriteBase};
use fub_abi::event::{EventKind, EventMask, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EventHandler, HostApi, HostCommands, IndexLoss, IndexProvider, IndexQuery, IndexResult,
    PluginManifest, QueryRoute, VaultEntry, VaultStructure, VaultWrite,
};
use fub_abi::{Event, FormatError, FormatProvider, PluginError};
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, Host, JobHost, NoWatcher};
use fub_kernel::journal::JournalOp;
use fub_kernel::maintenance::{Maintenance, MAINTENANCE_ID, VAULT_REBUILD_INDEX};
use fub_kernel::{FormatRegistry, Subscription, Trust, Workspace};

const INDEX_FEED_LOCK_PLUGIN: &str = "fub.audit-index-feed";
const EDIT_FEED_LOCK_PLUGIN: &str = "fub.audit-index-edit-feed";
const CREATE_FEED_LOCK_PLUGIN: &str = "fub.audit-index-create-feed";
const RESTORE_FEED_LOCK_PLUGIN: &str = "fub.audit-index-restore-feed";
const RENAME_FEED_LOCK_PLUGIN: &str = "fub.audit-index-rename";
const RENAME_BACKLINK_LOCK_PLUGIN: &str = "fub.audit-rename-backlink";

const REBUILD_LOCK_PLUGIN: &str = "fub.audit-rebuild-lock";
struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault() -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Note 0.md"), "# Note 0\n").expect("seed note");
    Vault { _dir: dir, root }
}

struct IndexFeedLockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl IndexProvider for IndexFeedLockProbe {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, _: &[DocumentModel]) -> Vec<IndexLoss> {
        self.entered.send(()).expect("index feed probe receiver");
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .expect("index feed probe released");
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
        Err(PluginError::Unserved("feed-only probe".into()))
    }

    fn up_to_date(&self, _: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }
}
#[derive(Debug, PartialEq, Eq)]
enum RenameCallback {
    Removal,
    Feed,
}

struct RenameIndexProbe {
    workspace: Custody<Workspace>,
    observed: std::sync::mpsc::SyncSender<(RenameCallback, bool, bool)>,
}

impl RenameIndexProbe {
    fn observe(&self, callback: RenameCallback) {
        let read = self.workspace.try_read();
        let read_free = read.is_some();
        drop(read);
        let write = self.workspace.try_write();
        let write_free = write.is_some();
        drop(write);
        self.observed
            .send((callback, read_free, write_free))
            .expect("rename observation receiver");
    }
}

impl IndexProvider for RenameIndexProbe {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, _: &[DocumentModel]) -> Vec<IndexLoss> {
        self.observe(RenameCallback::Feed);
        Vec::new()
    }

    fn on_documents_removed(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        self.observe(RenameCallback::Removal);
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
        Err(PluginError::Unserved("rename-only probe".into()))
    }

    fn up_to_date(&self, _: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BacklinkStage {
    Parse,
    BeforeWrite,
    Index,
}

type WorkspaceSlot = Arc<Mutex<Option<Custody<Workspace>>>>;

fn observe_backlink_stage(
    workspace: &WorkspaceSlot,
    observed: &std::sync::mpsc::SyncSender<(BacklinkStage, bool, bool)>,
    stage: BacklinkStage,
) {
    let workspace = workspace
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .expect("backlink probe workspace installed")
        .clone();
    let read = workspace.try_read();
    let read_free = read.is_some();
    drop(read);
    let write = workspace.try_write();
    let write_free = write.is_some();
    drop(write);
    observed
        .send((stage, read_free, write_free))
        .expect("backlink observation receiver");
}

struct BacklinkFormatProbe {
    armed: Arc<AtomicBool>,
    workspace: WorkspaceSlot,
    observed: std::sync::mpsc::SyncSender<(BacklinkStage, bool, bool)>,
    markdown: MarkdownProvider,
}

impl FormatProvider for BacklinkFormatProbe {
    fn descriptor(&self) -> FormatDescriptor {
        self.markdown.descriptor()
    }

    fn capabilities(&self) -> FormatCapabilities {
        self.markdown.capabilities()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        context: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        if self.armed.load(Ordering::SeqCst) && context.doc_id == "Backlink.md" {
            observe_backlink_stage(&self.workspace, &self.observed, BacklinkStage::Parse);
        }
        self.markdown.parse(source, context)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        options: &RenderOptions,
    ) -> Result<String, FormatError> {
        self.markdown.render_html(model, options)
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        self.markdown.serialize(model)
    }
}

struct BacklinkIndexProbe {
    workspace: WorkspaceSlot,
    observed: std::sync::mpsc::SyncSender<(BacklinkStage, bool, bool)>,
}

impl IndexProvider for BacklinkIndexProbe {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, models: &[DocumentModel]) -> Vec<IndexLoss> {
        if models
            .iter()
            .any(|model| model.id.as_str() == "Backlink.md")
        {
            observe_backlink_stage(&self.workspace, &self.observed, BacklinkStage::Index);
        }
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
        Err(PluginError::Unserved("backlink-only probe".into()))
    }

    fn up_to_date(&self, _: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }
}

#[derive(Debug)]
struct RestoreObservation {
    read_free: bool,
    write_free: bool,
    fact_before_callback: bool,
    handler_deferred: bool,
    newer_write: Result<(), PluginError>,
}

struct RestoreReentryProbe {
    workspace: Custody<Workspace>,
    root: Utf8PathBuf,
    events: Arc<Mutex<Subscription>>,
    observed: std::sync::mpsc::SyncSender<RestoreObservation>,
    handled: Arc<AtomicBool>,
    called: bool,
}

impl IndexProvider for RestoreReentryProbe {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, models: &[DocumentModel]) -> Vec<IndexLoss> {
        if self.called || models.iter().all(|model| model.id.as_str() != "Note 0.md") {
            return Vec::new();
        }
        self.called = true;
        let events: Vec<_> = self
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .try_iter()
            .map(|notice| notice.event)
            .collect();
        let fact = events
            .iter()
            .position(|event| {
                matches!(event, Event::DocumentChanged { id, .. } if id.as_str() == "Note 0.md")
            });
        let index = events
            .iter()
            .position(|event| matches!(event, Event::IndexUpdated));
        let read = self.workspace.try_read();
        let read_free = read.is_some();
        drop(read);
        let write = self.workspace.try_write();
        let write_free = write.is_some();
        drop(write);
        let newer_write = std::fs::write(self.root.join("Note 0.md"), "# Newer from re-entry\n")
            .map_err(|error| PluginError::Internal(error.to_string().into()));
        let handler_deferred = !self.handled.load(Ordering::SeqCst);
        let _ = self.observed.send(RestoreObservation {
            read_free,
            write_free,
            fact_before_callback: matches!((fact, index), (Some(fact), Some(index)) if fact < index),
            handler_deferred,
            newer_write: newer_write.map(drop),
        });
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
        Err(PluginError::Unserved("feed-only restore probe".into()))
    }

    fn up_to_date(&self, _: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }
}

struct RestoreDrainProbe {
    handled: Arc<AtomicBool>,
    delivered: std::sync::mpsc::SyncSender<()>,
    done: bool,
}

impl EventHandler for RestoreDrainProbe {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::DocumentChanged])
    }

    fn handle(&mut self, notice: &Notice, _: &mut dyn HostApi) -> Result<(), PluginError> {
        if !self.done
            && matches!(
                &notice.event,
                Event::DocumentChanged { id, .. } if id.as_str() == "Note 0.md"
            )
        {
            self.done = true;
            self.handled.store(true, Ordering::SeqCst);
            self.delivered
                .send(())
                .map_err(|_| PluginError::Internal("restore drain probe disappeared".into()))?;
        }
        Ok(())
    }
}

#[test]
fn an_index_feed_runs_without_holding_the_workspace_lock() {
    let v = vault();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None)
        .expect("the initial indexing finishes before the write probe");
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_plugin(
            PluginManifest::new(INDEX_FEED_LOCK_PLUGIN, "Audit detached index feed"),
            Trust::Community,
        )
        .expect("index owner declares");
        w.register_index_provider(
            INDEX_FEED_LOCK_PLUGIN,
            Box::new(IndexFeedLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("index probe registers");
    }

    let call = std::thread::spawn(move || {
        host.write_document(
            None,
            &DocId::new("Note 0.md"),
            "# Note 0\nchanged by index feed probe\n",
            WriteBase::Dictated,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("IndexProvider::on_documents_indexed entered");
    let reader_progressed = ws.try_read().is_some();
    release_tx.send(()).expect("release index feed");
    let outcome = call.join().expect("write thread does not panic");

    assert!(
        reader_progressed,
        "Host::write_document held Custody<Workspace> across IndexProvider::on_documents_indexed"
    );
    outcome.expect("write completes after index feed");
}
#[test]
fn rename_remove_and_feed_callbacks_run_without_the_workspace_lock() {
    let v = vault();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None)
        .expect("the initial indexing finishes before the rename probe");
    let workspace = host.debug_workspace(None).expect("debug custody");
    let (observed_tx, observed_rx) = std::sync::mpsc::sync_channel(2);
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_core_feature(RENAME_FEED_LOCK_PLUGIN, "Audit detached rename indexes")
            .expect("rename owner declares");
        ws.register_index_provider(
            RENAME_FEED_LOCK_PLUGIN,
            Box::new(RenameIndexProbe {
                workspace: workspace.clone(),
                observed: observed_tx,
            }),
        )
        .expect("rename probe registers");
    }

    JobHost::new(workspace, RENAME_FEED_LOCK_PLUGIN)
        .rename_document(&DocId::new("Note 0.md"), &DocId::new("Renamed.md"))
        .expect("rename completes");

    let removal = observed_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("remove callback observed");
    let feed = observed_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("feed callback observed");
    assert_eq!(removal, (RenameCallback::Removal, true, true));
    assert_eq!(feed, (RenameCallback::Feed, true, true));
    assert!(v.root.join("Renamed.md").exists());
}

#[test]
fn rename_backlink_callbacks_can_reenter_without_the_workspace_lock() {
    let v = vault();
    std::fs::write(v.root.join("Backlink.md"), "# Backlink\n[[Note 0]]\n").expect("seed backlink");
    let armed = Arc::new(AtomicBool::new(false));
    let workspace_slot: WorkspaceSlot = Arc::new(Mutex::new(None));
    let (observed_tx, observed_rx) = std::sync::mpsc::sync_channel(3);
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(BacklinkFormatProbe {
            armed: Arc::clone(&armed),
            workspace: Arc::clone(&workspace_slot),
            observed: observed_tx.clone(),
            markdown: MarkdownProvider::new(),
        }))
        .expect("probe format registers");
    let mut workspace = Workspace::new(&v.root, formats).expect("workspace opens");
    workspace.reindex().expect("seed documents index");
    workspace
        .register_core_feature(
            RENAME_BACKLINK_LOCK_PLUGIN,
            "Audit detached backlink rewrite",
        )
        .expect("rename caller declares");
    let workspace = Custody::new("rename backlink workspace", workspace);
    *workspace_slot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(workspace.clone());
    {
        let mut ws = workspace.write().expect("workspace is alive");
        ws.set_before_write_hook(Some((RENAME_BACKLINK_LOCK_PLUGIN.to_string(), {
            let workspace_slot = Arc::clone(&workspace_slot);
            let observed = observed_tx.clone();
            Arc::new(move |host, id| {
                let source = host.read_document(id)?;
                if !source.contains("[[Note 0]]") {
                    return Err(PluginError::Internal(
                        "before-write re-entry read the wrong backlink source".into(),
                    ));
                }
                observe_backlink_stage(&workspace_slot, &observed, BacklinkStage::BeforeWrite);
                Ok(())
            })
        })));
        ws.register_index_provider(
            RENAME_BACKLINK_LOCK_PLUGIN,
            Box::new(BacklinkIndexProbe {
                workspace: Arc::clone(&workspace_slot),
                observed: observed_tx,
            }),
        )
        .expect("backlink index probe registers");
    }
    armed.store(true, Ordering::SeqCst);

    JobHost::new(workspace, RENAME_BACKLINK_LOCK_PLUGIN)
        .rename_document(&DocId::new("Note 0.md"), &DocId::new("Renamed.md"))
        .expect("rename and backlink rewrite complete");

    for expected in [
        BacklinkStage::Parse,
        BacklinkStage::BeforeWrite,
        BacklinkStage::Index,
    ] {
        assert_eq!(
            observed_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("backlink callback observed"),
            (expected, true, true)
        );
    }
    assert_eq!(
        std::fs::read_to_string(v.root.join("Backlink.md")).unwrap(),
        "# Backlink\n[[Renamed]]\n"
    );
}

/// Il rebuild attraversa lo stesso driver staccato sia dall'ingresso utente sia
/// da `HostApi::run_command`: il canale vede l'indice sul primo e parser+indice
/// sul secondo, con entrambe le guardie disponibili dentro ogni callback.
#[test]
fn rebuild_callbacks_are_detached_on_top_level_and_nested_paths() {
    let v = vault();
    std::fs::write(v.root.join("Backlink.md"), "# Backlink\n[[Note 0]]\n")
        .expect("seed rebuild document");
    let armed = Arc::new(AtomicBool::new(true));
    let workspace_slot: WorkspaceSlot = Arc::new(Mutex::new(None));
    let (observed_tx, observed_rx) = std::sync::mpsc::sync_channel(3);

    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None)
        .expect("the initial indexing finishes");
    let top_level = host.debug_workspace(None).expect("debug custody");
    *workspace_slot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(top_level.clone());
    {
        let mut ws = top_level.write().expect("the vault is alive");
        ws.register_core_feature(REBUILD_LOCK_PLUGIN, "Audit detached rebuild")
            .expect("index owner declares");
        ws.register_index_provider(
            REBUILD_LOCK_PLUGIN,
            Box::new(BacklinkIndexProbe {
                workspace: Arc::clone(&workspace_slot),
                observed: observed_tx.clone(),
            }),
        )
        .expect("top-level index probe registers");
    }

    host.invoke_user_command(
        None,
        VAULT_REBUILD_INDEX,
        serde_json::Value::Null,
        InvokeMode::Apply,
    )
    .expect("top-level rebuild completes");
    assert_eq!(
        observed_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("top-level index callback observed"),
        (BacklinkStage::Index, true, true)
    );
    assert!(host.close().is_empty(), "top-level host closes cleanly");

    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(BacklinkFormatProbe {
            armed,
            workspace: Arc::clone(&workspace_slot),
            observed: observed_tx.clone(),
            markdown: MarkdownProvider::new(),
        }))
        .expect("nested format probe registers");
    let mut nested = Workspace::new(&v.root, formats).expect("nested workspace opens");
    nested
        .register_plugin(
            PluginManifest::core(MAINTENANCE_ID, "Manutenzione")
                .speaking("it", fub_kernel::maintenance::catalog()),
            Trust::Core,
        )
        .expect("maintenance declares");
    nested
        .register_command_provider(MAINTENANCE_ID, Box::new(Maintenance))
        .expect("maintenance registers");
    nested
        .register_core_feature(REBUILD_LOCK_PLUGIN, "Audit nested rebuild")
        .expect("nested caller declares");
    let nested = Custody::new("nested rebuild workspace", nested);
    *workspace_slot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(nested.clone());
    nested
        .write()
        .expect("nested workspace is alive")
        .register_index_provider(
            REBUILD_LOCK_PLUGIN,
            Box::new(BacklinkIndexProbe {
                workspace: Arc::clone(&workspace_slot),
                observed: observed_tx,
            }),
        )
        .expect("nested index probe registers");

    JobHost::new(nested, REBUILD_LOCK_PLUGIN)
        .run_command(VAULT_REBUILD_INDEX, serde_json::Value::Null)
        .expect("nested rebuild completes");
    for expected in [BacklinkStage::Parse, BacklinkStage::Index] {
        assert_eq!(
            observed_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("nested rebuild callback observed"),
            (expected, true, true)
        );
    }
}

#[test]
fn an_edit_feed_runs_without_holding_the_workspace_lock() {
    let v = vault();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None)
        .expect("the initial indexing finishes before the edit probe");
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(EDIT_FEED_LOCK_PLUGIN, "Audit detached edit feed")
            .expect("edit owner declares");
        w.register_index_provider(
            EDIT_FEED_LOCK_PLUGIN,
            Box::new(IndexFeedLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("index probe registers");
    }

    let mut job = JobHost::new(ws.clone(), EDIT_FEED_LOCK_PLUGIN);
    let call = std::thread::spawn(move || {
        job.apply_edit(
            &DocId::new("Note 0.md"),
            EditRequest::new(
                Revision::of("# Note 0\n"),
                vec![TextEdit::insert("# Note 0".len(), " edited")],
            ),
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("IndexProvider::on_documents_indexed entered for edit");
    let reader_progressed = ws.try_read().is_some();
    release_tx.send(()).expect("release edit index feed");
    let outcome = call.join().expect("edit thread does not panic");

    assert!(
        reader_progressed,
        "JobHost::apply_edit held Custody<Workspace> across IndexProvider::on_documents_indexed"
    );
    outcome.expect("edit completes after index feed");
    assert_eq!(
        std::fs::read_to_string(v.root.join("Note 0.md")).unwrap(),
        "# Note 0 edited\n"
    );
}

#[test]
fn a_create_feed_runs_without_holding_the_workspace_lock() {
    let v = vault();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None)
        .expect("the initial indexing finishes before the create probe");
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(CREATE_FEED_LOCK_PLUGIN, "Audit detached create feed")
            .expect("create owner declares");
        w.register_index_provider(
            CREATE_FEED_LOCK_PLUGIN,
            Box::new(IndexFeedLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("index probe registers");
    }

    let mut job = JobHost::new(ws.clone(), CREATE_FEED_LOCK_PLUGIN);
    let call =
        std::thread::spawn(move || job.create_document(&DocId::new("Created.md"), "# Created\n"));
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("IndexProvider::on_documents_indexed entered for create");
    let reader_progressed = ws.try_read().is_some();
    release_tx.send(()).expect("release create index feed");
    let outcome = call.join().expect("create thread does not panic");

    assert!(
        reader_progressed,
        "JobHost::create_document held Custody<Workspace> across IndexProvider::on_documents_indexed"
    );
    outcome.expect("create completes after index feed");
    assert_eq!(
        std::fs::read_to_string(v.root.join("Created.md")).unwrap(),
        "# Created\n"
    );
}

#[test]
fn a_restore_feed_is_reentry_safe_and_finishes_once() {
    let v = vault();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None)
        .expect("the initial indexing finishes before the restore probe");
    let workspace = host.debug_workspace(None).expect("debug custody");
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_core_feature(RESTORE_FEED_LOCK_PLUGIN, "Audit detached restore feed")
            .expect("restore owner declares");
    }
    let trash = JobHost::new(workspace.clone(), RESTORE_FEED_LOCK_PLUGIN)
        .trash_document(&DocId::new("Note 0.md"))
        .expect("seed note enters trash");
    let events = Arc::new(Mutex::new(
        workspace
            .read()
            .expect("the vault is alive")
            .bus()
            .subscribe(),
    ));
    let handled = Arc::new(AtomicBool::new(false));
    let (observed_tx, observed_rx) = std::sync::mpsc::sync_channel(1);
    let (delivered_tx, delivered_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_event_handler(
            RESTORE_FEED_LOCK_PLUGIN,
            Box::new(RestoreDrainProbe {
                handled: Arc::clone(&handled),
                delivered: delivered_tx,
                done: false,
            }),
        )
        .expect("restore event probe registers");
        ws.register_index_provider(
            RESTORE_FEED_LOCK_PLUGIN,
            Box::new(RestoreReentryProbe {
                workspace: workspace.clone(),
                root: v.root.clone(),
                events: Arc::clone(&events),
                observed: observed_tx,
                handled: Arc::clone(&handled),
                called: false,
            }),
        )
        .expect("restore index probe registers");
    }
    events
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .try_iter()
        .for_each(drop);

    let workspace_for_restore = workspace.clone();
    let (done_tx, done_rx) = std::sync::mpsc::sync_channel(1);
    let worker = std::thread::spawn(move || {
        let outcome = JobHost::new(workspace_for_restore, RESTORE_FEED_LOCK_PLUGIN)
            .restore_document(&trash, None);
        let _ = done_tx.send(outcome);
    });
    let observation = observed_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("restore index callback completes its re-entry");
    assert!(
        observation.read_free && observation.write_free,
        "{observation:?}"
    );
    assert!(observation.fact_before_callback, "{observation:?}");
    assert!(observation.handler_deferred, "{observation:?}");
    observation
        .newer_write
        .expect("the index callback writes a newer target");
    assert_eq!(
        done_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("restore finalizer completes")
            .expect("restore succeeds"),
        DocId::new("Note 0.md")
    );
    worker.join().expect("restore thread does not panic");
    delivered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("the recovered provider frame drains the outer fact");
    assert_eq!(
        std::fs::read_to_string(v.root.join("Note 0.md")).unwrap(),
        "# Newer from re-entry\n",
        "the stale outer feed does not overwrite the re-entrant write"
    );
    let restored = workspace
        .read()
        .expect("the vault is alive")
        .journal()
        .expect("journal is readable")
        .records
        .into_iter()
        .filter(|record| matches!(record.op, JournalOp::Restored { .. }))
        .count();
    assert_eq!(restored, 1, "the restore journal fact is appended once");
}
