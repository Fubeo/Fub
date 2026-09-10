use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::edit::{EditRequest, Revision, TextEdit, WriteBase};
use fub_abi::event::{EventKind, EventMask, Notice};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EventHandler, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, PluginManifest,
    QueryRoute, VaultEntry, VaultStructure, VaultWrite,
};
use fub_abi::{Event, PluginError};
use fub_host::{Custody, Host, JobHost, NoWatcher};
use fub_kernel::journal::JournalOp;
use fub_kernel::{Subscription, Trust, Workspace};

const INDEX_FEED_LOCK_PLUGIN: &str = "fub.audit-index-feed";
const EDIT_FEED_LOCK_PLUGIN: &str = "fub.audit-index-edit-feed";
const CREATE_FEED_LOCK_PLUGIN: &str = "fub.audit-index-create-feed";
const RESTORE_FEED_LOCK_PLUGIN: &str = "fub.audit-index-restore-feed";

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
