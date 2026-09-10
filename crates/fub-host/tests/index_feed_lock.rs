use std::sync::Mutex;
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::edit::{EditRequest, Revision, TextEdit, WriteBase};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, PluginManifest, QueryRoute,
    VaultEntry, VaultStructure, VaultWrite,
};
use fub_abi::PluginError;
use fub_features::TRASH_RESTORE;
use fub_host::{Host, JobHost, NoWatcher};
use fub_kernel::Trust;

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
fn a_restore_feed_runs_without_holding_the_workspace_lock() {
    let v = vault();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None)
        .expect("the initial indexing finishes before the restore probe");
    let ws = host.debug_workspace(None).expect("debug custody");
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(RESTORE_FEED_LOCK_PLUGIN, "Audit detached restore feed")
            .expect("restore owner declares");
    }
    let trashed = JobHost::new(ws.clone(), RESTORE_FEED_LOCK_PLUGIN)
        .trash_document(&DocId::new("Note 0.md"))
        .expect("seed note enters trash");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_index_provider(
            RESTORE_FEED_LOCK_PLUGIN,
            Box::new(IndexFeedLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("index probe registers");
    }

    let entry = trashed.clone();
    let call = std::thread::spawn(move || {
        host.invoke_user_command(
            None,
            TRASH_RESTORE,
            serde_json::json!({ "entry": entry.as_str() }),
            InvokeMode::Apply,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("IndexProvider::on_documents_indexed entered for restore");
    let reader_progressed = ws.try_read().is_some();
    release_tx.send(()).expect("release restore index feed");
    let outcome = call.join().expect("restore thread does not panic");

    assert!(
        reader_progressed,
        "CoreCommands::trash.restore held Custody<Workspace> across IndexProvider::on_documents_indexed"
    );
    assert_eq!(
        outcome.expect("restore completes after index feed").effect,
        CommandEffect::Navigate {
            doc: DocId::new("Note 0.md"),
        }
    );
    assert_eq!(
        std::fs::read_to_string(v.root.join("Note 0.md")).unwrap(),
        "# Note 0\n"
    );
}
