from pathlib import Path

p = Path('crates/fub-host/tests/concurrency.rs')
s = p.read_text()
s = s.replace(
    'use fub_abi::model::DocId;',
    'use fub_abi::model::{DocId, DocumentModel};',
    1,
)
s = s.replace(
    '    CommandProvider, HostApi, PluginManifest, ReadApi, ServiceProvider, ViewInstance, ViewProvider,\n    ViewSpec, ViewSurface,\n',
    '    CommandProvider, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, PluginManifest,\n    QueryRoute, ReadApi, ServiceProvider, VaultEntry, ViewInstance, ViewProvider, ViewSpec, ViewSurface,\n',
    1,
)
marker = '\nconst BEFORE_WRITE_LOCK_PLUGIN: &str = "fub.audit-before-write";\n'
assert marker in s
probe = r'''
const INDEX_FEED_LOCK_PLUGIN: &str = "fub.audit-index-feed";

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
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(INDEX_FEED_LOCK_PLUGIN, "Audit detached index feed")
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
'''
s = s.replace(marker, '\n' + probe + marker, 1)
p.write_text(s)
