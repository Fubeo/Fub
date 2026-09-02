//! Le query degli indici esterni attraversano il planner senza tenere
//! `Custody<Workspace>`, sia dalla porta top-level sia dal proxy dei job.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    HostApi, HostQuery, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryKind, QueryRoute,
};
use fub_abi::PluginError;
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, Host, JobHost, NoWatcher};
use fub_kernel::{FormatRegistry, Workspace};

const PLUGIN: &str = "fub.audit-query-lock";
const TIMEOUT: Duration = Duration::from_secs(10);

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault() -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Note 0.md"), "# Note 0\n\nalpha\n").expect("seed note");
    Vault { _dir: dir, root }
}

fn query() -> IndexQuery {
    IndexQuery::Custom {
        ns: PLUGIN.into(),
        query: serde_json::json!({ "probe": "workspace-lock" }),
    }
}

fn settings_query() -> IndexQuery {
    IndexQuery::Settings { plugin: None }
}

fn answer(value: serde_json::Value) -> IndexResult {
    IndexResult::Custom(value)
}

fn indexed_workspace(vault: &Vault) -> Custody<Workspace> {
    let mut formats = FormatRegistry::new();
    formats
        .register(MarkdownProvider::boxed())
        .expect("no extension conflict");
    let mut workspace = Workspace::new(&vault.root, formats).expect("the vault opens");
    workspace.reindex().expect("indexing finishes");
    Custody::new("the open vault", workspace)
}

macro_rules! inert_index_lifecycle {
    () => {
        fn activate(
            &mut self,
            _: &mut dyn HostApi,
        ) -> std::result::Result<(), PluginError> {
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

        fn flush(
            &mut self,
            _: &mut dyn HostApi,
        ) -> std::result::Result<(), PluginError> {
            Ok(())
        }

        fn close(
            &mut self,
            _: &mut dyn HostApi,
        ) -> std::result::Result<(), PluginError> {
            Ok(())
        }
    };
}

macro_rules! custom_index_contract {
    () => {
        fn routes(&self) -> Vec<QueryRoute> {
            vec![QueryRoute::Query(QueryKind::Custom(PLUGIN.into()))]
        }

        inert_index_lifecycle!();
    };
}

struct BlockingCustomIndex {
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl IndexProvider for BlockingCustomIndex {
    custom_index_contract!();

    fn query(
        &self,
        request: IndexQuery,
    ) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, crate::query());
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("query probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| PluginError::Internal("query probe was not released".into()))?;
        Ok(answer(serde_json::json!({ "source": "old" })))
    }
}

struct BlockingSettingsIndex {
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl IndexProvider for BlockingSettingsIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Settings)]
    }

    inert_index_lifecycle!();

    fn query(
        &self,
        request: IndexQuery,
    ) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, settings_query());
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("settings probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| PluginError::Internal("settings probe was not released".into()))?;
        Ok(IndexResult::Settings(Vec::new()))
    }
}

struct FixedCustomIndex {
    value: serde_json::Value,
}

impl IndexProvider for FixedCustomIndex {
    custom_index_contract!();

    fn query(
        &self,
        request: IndexQuery,
    ) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, crate::query());
        Ok(answer(self.value.clone()))
    }
}

struct ErrorThenSuccessIndex {
    calls: AtomicUsize,
}

impl IndexProvider for ErrorThenSuccessIndex {
    custom_index_contract!();

    fn query(
        &self,
        request: IndexQuery,
    ) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, crate::query());
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(PluginError::BadArgs("errore intenzionale del provider".into()));
        }
        Ok(answer(serde_json::json!({ "recovered": "error" })))
    }
}

struct PanicThenSuccessIndex {
    calls: AtomicUsize,
}

impl IndexProvider for PanicThenSuccessIndex {
    custom_index_contract!();

    fn query(
        &self,
        request: IndexQuery,
    ) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, crate::query());
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            panic!("panic intenzionale della query");
        }
        Ok(answer(serde_json::json!({ "recovered": "panic" })))
    }
}

struct ReentrantCustomIndex {
    reenter: mpsc::SyncSender<()>,
    resumed: Mutex<mpsc::Receiver<std::result::Result<(), PluginError>>>,
}

impl IndexProvider for ReentrantCustomIndex {
    custom_index_contract!();

    fn query(
        &self,
        request: IndexQuery,
    ) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, crate::query());
        self.reenter
            .send(())
            .map_err(|_| PluginError::Internal("re-entry receiver disappeared".into()))?;
        self.resumed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| PluginError::Internal("re-entry did not make progress".into()))??;
        Ok(answer(serde_json::json!({ "reentered": true })))
    }
}

fn install_index(workspace: &Custody<Workspace>, index: Box<dyn IndexProvider>) {
    let mut workspace = workspace.write().expect("the vault is alive");
    workspace
        .register_core_feature(PLUGIN, "Audit detached query")
        .expect("query owner declares");
    workspace
        .register_index_provider(PLUGIN, index)
        .expect("query probe registers");
}

fn install_blocking_probe(
    workspace: &Custody<Workspace>,
    entered: mpsc::SyncSender<()>,
    release: mpsc::Receiver<()>,
) {
    install_index(
        workspace,
        Box::new(BlockingCustomIndex {
            entered,
            release: Mutex::new(release),
        }),
    );
}

fn install_replacing_index(workspace: &Custody<Workspace>, index: Box<dyn IndexProvider>) {
    let mut workspace = workspace.write().expect("the vault is alive");
    workspace
        .register_core_feature(PLUGIN, "Audit detached query")
        .expect("query owner declares");
    workspace
        .replace_index_provider(PLUGIN, index)
        .expect("replacement query probe registers");
}

fn assert_workspace_is_free(workspace: &Custody<Workspace>) {
    let read = workspace.try_read();
    assert!(
        read.is_some(),
        "IndexProvider::query held a write guard on Custody<Workspace>"
    );
    drop(read);

    let write = workspace.try_write();
    assert!(
        write.is_some(),
        "IndexProvider::query held a read guard on Custody<Workspace>"
    );
    drop(write);
}

fn assert_result(
    result: std::result::Result<IndexResult, PluginError>,
    expected: serde_json::Value,
) {
    assert_eq!(result.expect("query succeeds"), answer(expected));
}

#[test]
fn host_query_releases_the_workspace_before_index_provider_query() {
    let vault = vault();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&vault.root).expect("the vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");
    let workspace = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    install_blocking_probe(&workspace, entered_tx, release_rx);

    let call = std::thread::spawn(move || host.query_index(None, query()));
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("IndexProvider::query entered");
    assert_workspace_is_free(&workspace);
    release_tx.send(()).expect("release query probe");
    assert_result(
        call.join().expect("query thread does not panic"),
        serde_json::json!({ "source": "old" }),
    );
}

#[test]
fn job_host_query_uses_the_same_detached_planner() {
    let vault = vault();
    let workspace = indexed_workspace(&vault);
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    install_blocking_probe(&workspace, entered_tx, release_rx);
    let job = JobHost::new(workspace.clone(), PLUGIN);

    let call = std::thread::spawn(move || job.query_index(query()));
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("IndexProvider::query entered from JobHost");
    assert_workspace_is_free(&workspace);
    release_tx.send(()).expect("release query probe");
    assert_result(
        call.join().expect("query thread does not panic"),
        serde_json::json!({ "source": "old" }),
    );
}

#[test]
fn a_replaced_workspace_owned_route_is_detached_too() {
    let vault = vault();
    let workspace = indexed_workspace(&vault);
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    install_replacing_index(
        &workspace,
        Box::new(BlockingSettingsIndex {
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }),
    );
    let job = JobHost::new(workspace.clone(), PLUGIN);

    let call = std::thread::spawn(move || job.query_index(settings_query()));
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("replacement provider entered");
    assert_workspace_is_free(&workspace);
    release_tx.send(()).expect("release replacement probe");
    assert_eq!(
        call.join()
            .expect("query thread does not panic")
            .expect("replacement query succeeds"),
        IndexResult::Settings(Vec::new())
    );
}

#[test]
fn an_index_query_can_reenter_the_host_and_take_a_write_guard() {
    let vault = vault();
    let workspace = indexed_workspace(&vault);
    let (reenter_tx, reenter_rx) = mpsc::sync_channel(1);
    let (resumed_tx, resumed_rx) = mpsc::sync_channel(1);
    install_index(
        &workspace,
        Box::new(ReentrantCustomIndex {
            reenter: reenter_tx,
            resumed: Mutex::new(resumed_rx),
        }),
    );

    let reentry_workspace = workspace.clone();
    let reentry_job = JobHost::new(workspace.clone(), PLUGIN);
    let reentry = std::thread::spawn(move || {
        reenter_rx
            .recv_timeout(TIMEOUT)
            .expect("provider requests re-entry");
        let outcome = reentry_job.query_index(IndexQuery::VaultStatus).map(|_| {
            let workspace = reentry_workspace
                .write()
                .expect("re-entry takes the workspace exclusively");
            let _ = workspace.set_active_document(Some(DocId::new("Note 0.md")));
        });
        let _ = resumed_tx.send(outcome);
    });

    let job = JobHost::new(workspace.clone(), PLUGIN);
    assert_result(
        job.query_index(query()),
        serde_json::json!({ "reentered": true }),
    );
    reentry.join().expect("re-entry thread does not panic");
    assert_workspace_is_free(&workspace);
}

#[test]
fn a_response_from_a_replaced_route_is_rejected_as_stale() {
    let vault = vault();
    let workspace = indexed_workspace(&vault);
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    install_blocking_probe(&workspace, entered_tx, release_rx);
    let job = JobHost::new(workspace.clone(), PLUGIN);

    let call = std::thread::spawn(move || job.query_index(query()));
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("old provider is answering");
    assert_workspace_is_free(&workspace);
    workspace
        .write()
        .expect("routing can change while the callback runs")
        .replace_index_provider(
            PLUGIN,
            Box::new(FixedCustomIndex {
                value: serde_json::json!({ "source": "new" }),
            }),
        )
        .expect("replacement registers");
    release_tx.send(()).expect("old provider returns");

    let stale = call.join().expect("query thread does not panic");
    assert!(
        matches!(&stale, Err(PluginError::Conflict(message))
            if message.to_string().contains("routing degli indici")),
        "the retired provider result must not escape: {stale:?}"
    );
    assert_workspace_is_free(&workspace);

    let current = JobHost::new(workspace.clone(), PLUGIN).query_index(query());
    assert_result(current, serde_json::json!({ "source": "new" }));
}

#[test]
fn a_provider_error_propagates_and_the_next_query_still_works() {
    let vault = vault();
    let workspace = indexed_workspace(&vault);
    install_index(
        &workspace,
        Box::new(ErrorThenSuccessIndex {
            calls: AtomicUsize::new(0),
        }),
    );
    let job = JobHost::new(workspace.clone(), PLUGIN);

    let failed = job.query_index(query());
    assert!(
        matches!(&failed, Err(PluginError::BadArgs(message))
            if message.to_string() == "errore intenzionale del provider"),
        "the provider error must propagate unchanged: {failed:?}"
    );
    assert_workspace_is_free(&workspace);
    assert_result(
        job.query_index(query()),
        serde_json::json!({ "recovered": "error" }),
    );
}

#[test]
fn a_provider_panic_is_contained_and_the_next_query_still_works() {
    let vault = vault();
    let workspace = indexed_workspace(&vault);
    install_index(
        &workspace,
        Box::new(PanicThenSuccessIndex {
            calls: AtomicUsize::new(0),
        }),
    );
    let job = JobHost::new(workspace.clone(), PLUGIN);

    let failed = job.query_index(query());
    assert!(
        matches!(&failed, Err(PluginError::Internal(message))
            if message.to_string().contains(PLUGIN)
                && message.to_string().contains("query")
                && message.to_string().contains("panic intenzionale")),
        "the panic must become a qualified provider error: {failed:?}"
    );
    assert_workspace_is_free(&workspace);
    assert_result(
        job.query_index(query()),
        serde_json::json!({ "recovered": "panic" }),
    );
}
