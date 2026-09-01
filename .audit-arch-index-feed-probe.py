from pathlib import Path

Path('crates/fub-host/tests/audit_index_feed.rs').write_text(r'''use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, PluginManifest, QueryRoute,
    VaultEntry,
};
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};
use fub_kernel::Trust;

const INDEX_FEED_LOCK_PLUGIN: &str = "fub.audit-index-feed";

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
    let reader_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_read().is_some())
            .join()
            .expect("reader probe finishes")
    };
    release_tx.send(()).expect("release index feed");
    let outcome = call.join().expect("write thread does not panic");

    assert!(
        reader_progressed,
        "Host::write_document held Custody<Workspace> across IndexProvider::on_documents_indexed"
    );
    outcome.expect("write completes after index feed");
}
''')
