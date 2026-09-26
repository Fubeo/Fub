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
/// Watchdog for the writer in the detached-callback regression. The callback
/// is released only after this result arrives, so a retained workspace guard
/// deterministically turns into a failed assertion instead of a test hang.
const WRITER_LIMIT: Duration = Duration::from_secs(2);

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
        fn activate(&mut self, _: &mut dyn HostApi) -> std::result::Result<(), PluginError> {
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

        fn flush(&mut self, _: &mut dyn HostApi) -> std::result::Result<(), PluginError> {
            Ok(())
        }

        fn close(&mut self, _: &mut dyn HostApi) -> std::result::Result<(), PluginError> {
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

    fn query(&self, request: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, query());
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

    fn query(&self, request: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
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

    fn query(&self, request: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, query());
        Ok(answer(self.value.clone()))
    }
}

struct ErrorThenSuccessIndex {
    calls: AtomicUsize,
}

impl IndexProvider for ErrorThenSuccessIndex {
    custom_index_contract!();

    fn query(&self, request: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, query());
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(PluginError::BadArgs(
                "errore intenzionale del provider".into(),
            ));
        }
        Ok(answer(serde_json::json!({ "recovered": "error" })))
    }
}

struct PanicThenSuccessIndex {
    calls: AtomicUsize,
}

impl IndexProvider for PanicThenSuccessIndex {
    custom_index_contract!();

    fn query(&self, request: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, query());
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

    fn query(&self, request: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        assert_eq!(request, query());
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

    // A non-blocking write also observes the independent writer-turn queue,
    // so it can report contention even when no Workspace guard is alive.
    // Let a real writer queue normally: it must complete while the provider
    // is suspended, which directly proves that no read guard crosses the call.
    let probe = workspace.clone();
    let (completed_tx, completed_rx) = mpsc::sync_channel(1);
    let writer = std::thread::spawn(move || {
        let result = probe.write().map(drop);
        completed_tx
            .send(result)
            .expect("workspace writer result is observed");
    });
    completed_rx
        .recv_timeout(WRITER_LIMIT)
        .expect("IndexProvider::query held a read guard on Custody<Workspace>")
        .expect("workspace remains writable");
    writer.join().expect("workspace writer does not panic");
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

/// `query_index` must not hold the host's session registry while a provider
/// answers: opening or closing a vault waits for that registry exclusively, and
/// a waiting writer blocks every new reader — including the provider itself
/// when it calls back into the host. Here a second vault must open while the
/// provider is suspended.
#[test]
fn host_query_releases_the_sessions_before_index_provider_query() {
    let vault = vault();
    let second = self::vault();
    let host = std::sync::Arc::new(Host::new().with_watcher(Box::new(NoWatcher)));
    host.open(&vault.root).expect("the vault opens");
    host.wait_indexed(None).expect("opening indexing finishes");
    let workspace = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    install_blocking_probe(&workspace, entered_tx, release_rx);

    let querying = std::sync::Arc::clone(&host);
    let call = std::thread::spawn(move || querying.query_index(None, query()));
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("IndexProvider::query entered");

    let (opened_tx, opened_rx) = mpsc::sync_channel(1);
    let opening = std::sync::Arc::clone(&host);
    let second_root = second.root.clone();
    let opener = std::thread::spawn(move || {
        let _ = opened_tx.send(opening.open(&second_root).map(drop));
    });
    let opened = opened_rx.recv_timeout(WRITER_LIMIT);

    release_tx.send(()).expect("release query probe");
    let query_result = call.join().expect("query thread does not panic");
    opener.join().expect("opener does not panic");
    assert!(
        opened.is_ok(),
        "a second vault did not open within {WRITER_LIMIT:?} while \
         IndexProvider::query was suspended: query_index held the sessions"
    );
    opened
        .expect("open completion was observed")
        .expect("the second vault opens");
    assert_result(query_result, serde_json::json!({ "source": "old" }));
}

/// The production query path must release `Custody<Workspace>` before entering
/// an external reader/provider callback. The callback stays suspended after
/// its entry signal; an independent workspace writer then has a bounded
/// opportunity to acquire the lock and complete a real mutation. If the query
/// path retains an internal read guard, the writer misses `WRITER_LIMIT` and
/// this assertion fails.
#[test]
fn host_query_allows_a_writer_while_index_provider_is_suspended() {
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
        .expect("IndexProvider::query entered before the writer probe");

    let (writer_tx, writer_rx) = mpsc::sync_channel(1);
    let writer_workspace = workspace.clone();
    let writer = std::thread::spawn(move || {
        let result = writer_workspace.write().map(|workspace| {
            workspace.set_active_document(Some(DocId::new("Note 0.md")));
        });
        writer_tx
            .send(result)
            .expect("writer completion receiver remains alive");
    });
    let writer_completion = writer_rx.recv_timeout(WRITER_LIMIT);

    // Always release and join before asserting. A failing implementation may
    // unblock the writer only once the callback returns; cleanup must still
    // let the test report the retained guard instead of leaking a thread.
    release_tx
        .send(())
        .expect("release suspended index provider");
    let query_result = call.join().expect("query thread does not panic");
    writer.join().expect("writer thread does not panic");

    assert!(
        writer_completion.is_ok(),
        "writer did not complete within {WRITER_LIMIT:?} while \
         IndexProvider::query was suspended: the callback retained a \
         Custody<Workspace> guard"
    );
    writer_completion
        .expect("writer completion was observed")
        .expect("workspace writer succeeds while the provider is suspended");

    assert_result(query_result, serde_json::json!({ "source": "old" }));
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
            if *message == "errore intenzionale del provider"),
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
