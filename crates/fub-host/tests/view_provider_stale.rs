//! Staleness e ripristino del protocollo prepare/call/finalize delle view.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::event::{EventKind, EventMask, Notice};
use fub_abi::traits::{
    EventHandler, HostApi, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::{Event, PluginError};
use fub_host::{Custody, Host, NoWatcher};
use fub_kernel::Workspace;

const PLUGIN: &str = "fub.audit-view-stale";
const OTHER_PLUGIN: &str = "fub.audit-view-other";
const HANDLER: &str = "fub.audit-view-handler";
const VIEW: &str = "audit-view-stale";
const OTHER_VIEW: &str = "audit-view-other";
const EVENT: &str = "fub.audit-view-stale:called";
const TIMEOUT: Duration = Duration::from_secs(10);

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault() -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Note.md"), "# Note\n").expect("seed note");
    Vault { _dir: dir, root }
}

fn open(vault: &Vault) -> Host {
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&vault.root).expect("the vault opens");
    host
}

fn spec(view: &str) -> ViewSpec {
    ViewSpec::new(view, view, ViewSurface::RightSidebar)
}

struct FixedView {
    view: &'static str,
    text: &'static str,
}

impl ViewProvider for FixedView {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        fub_abi::traits::ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![spec(self.view)]
    }

    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        Ok(UiNode::text(self.text))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        _: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}

struct BlockingRender {
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl ViewProvider for BlockingRender {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        fub_abi::traits::ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![spec(VIEW)]
    }

    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("render probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| PluginError::Internal("render probe was not released".into()))?;
        Ok(UiNode::text("old"))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        _: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        unreachable!()
    }
}

struct BlockingAction {
    workspace: Custody<Workspace>,
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl ViewProvider for BlockingAction {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        fub_abi::traits::ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![spec(VIEW)]
    }

    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("old"))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        _: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if self.workspace.try_read().is_none() {
            return Err(PluginError::Internal(
                "a workspace read lock remained during the action".into(),
            ));
        }
        self.workspace
            .try_write()
            .ok_or_else(|| {
                PluginError::Internal("a workspace write lock remained during the action".into())
            })?
            .replace_view_provider(
                PLUGIN,
                Box::new(FixedView {
                    view: VIEW,
                    text: "new",
                }),
            )
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("action probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| PluginError::Internal("action probe was not released".into()))?;
        Ok(ViewUpdate::None)
    }
}

fn declare_and_register(host: &Host, provider: Box<dyn ViewProvider>) {
    let workspace = host.debug_workspace(None).expect("debug custody");
    let mut workspace = workspace.write().expect("the vault is alive");
    workspace
        .register_core_feature(PLUGIN, "Audit view staleness")
        .expect("view declares");
    workspace
        .register_view_provider(PLUGIN, provider)
        .expect("view registers");
}

fn assert_stale<T: std::fmt::Debug>(outcome: Result<T, PluginError>) {
    assert!(
        matches!(&outcome, Err(PluginError::Conflict(message))
            if message.to_string().contains("registrazione della view")),
        "the retired view provider result must not escape: {outcome:?}"
    );
}

#[test]
fn a_render_from_a_replaced_view_provider_is_rejected_as_stale() {
    let vault = vault();
    let host = open(&vault);
    let workspace = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    declare_and_register(
        &host,
        Box::new(BlockingRender {
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }),
    );

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let outcome = host.render_view(None, &ViewInstance::only(VIEW));
        let _ = done_tx.send((host, outcome));
    });
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("old provider is rendering");
    assert!(
        workspace.try_read().is_some(),
        "no workspace read lock remains during render"
    );
    workspace
        .try_write()
        .expect("no workspace write lock remains during render")
        .replace_view_provider(
            PLUGIN,
            Box::new(FixedView {
                view: VIEW,
                text: "new",
            }),
        )
        .expect("replacement registers");
    release_tx.send(()).expect("old provider returns");

    let (host, stale) = done_rx
        .recv_timeout(TIMEOUT)
        .expect("render thread finishes");
    drop(call);
    assert_stale(stale);

    let prepared_error = workspace
        .read()
        .expect("the vault is alive")
        .prepare_view_render(&ViewInstance::only(VIEW))
        .expect("the replacement render prepares");
    workspace
        .write()
        .expect("the vault is alive")
        .replace_view_provider(
            PLUGIN,
            Box::new(FixedView {
                view: VIEW,
                text: "newest",
            }),
        )
        .expect("the provider is replaced again");
    let provider_error = workspace
        .read()
        .expect("the vault is alive")
        .finish_view_render(
            prepared_error,
            Err(PluginError::BadArgs("intentional render error".into())),
        );
    assert!(
        matches!(&provider_error, Err(PluginError::BadArgs(message))
            if message.to_string() == "intentional render error"),
        "replacement must not mask the provider error: {provider_error:?}"
    );
    assert_eq!(
        host.render_view(None, &ViewInstance::only(VIEW))
            .expect("the replacement renders"),
        UiNode::text("newest")
    );
}

#[test]
fn an_action_from_a_replaced_view_provider_is_rejected_as_stale() {
    let vault = vault();
    let host = open(&vault);
    let workspace = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    declare_and_register(
        &host,
        Box::new(BlockingAction {
            workspace: workspace.clone(),
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }),
    );

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let outcome = host.view_action(None, &ViewInstance::only(VIEW), UiAction::new("old"));
        let _ = done_tx.send((host, outcome));
    });
    entered_rx
        .recv_timeout(TIMEOUT)
        .expect("old provider is handling the action");
    assert!(
        workspace.try_read().is_some(),
        "no workspace read lock remains during the action"
    );
    release_tx.send(()).expect("old provider returns");

    let (host, stale) = done_rx
        .recv_timeout(TIMEOUT)
        .expect("action thread finishes");
    drop(call);
    assert_stale(stale);
    assert_eq!(
        host.view_action(None, &ViewInstance::only(VIEW), UiAction::new("new"),)
        .expect("the replacement handles actions"),
        ViewUpdate::None
    );
}

struct PhasedAction {
    calls: usize,
}

impl ViewProvider for PhasedAction {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        fub_abi::traits::ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![spec(VIEW)]
    }

    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("phased"))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        self.calls += 1;
        host.emit(Event::Custom {
            topic: EVENT.into(),
            payload: serde_json::json!({ "call": self.calls }),
        });
        match self.calls {
            1 => Err(PluginError::BadArgs("intentional action error".into())),
            2 => panic!("intentional action panic"),
            _ => Ok(ViewUpdate::None),
        }
    }
}

struct CountEvents(Arc<AtomicUsize>);

impl EventHandler for CountEvents {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::Custom])
    }

    fn handle(&mut self, notice: &Notice, _: &mut dyn HostApi) -> Result<(), PluginError> {
        if matches!(&notice.event, Event::Custom { topic, .. } if topic == EVENT) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
        Ok(())
    }
}

#[test]
fn action_error_and_panic_drain_events_and_leave_the_provider_reusable() {
    let vault = vault();
    let host = open(&vault);
    let seen = Arc::new(AtomicUsize::new(0));
    let workspace = host.debug_workspace(None).expect("debug custody");
    {
        let mut workspace = workspace.write().expect("the vault is alive");
        for (id, name) in [
            (PLUGIN, "Audit view staleness"),
            (HANDLER, "Audit view handler"),
        ] {
            workspace
                .register_core_feature(id, name)
                .expect("feature declares");
        }
        workspace
            .register_event_handler(HANDLER, Box::new(CountEvents(Arc::clone(&seen))))
            .expect("handler registers");
        workspace
            .register_view_provider(PLUGIN, Box::new(PhasedAction { calls: 0 }))
            .expect("view registers");
    }

    let error = host.view_action(None, &ViewInstance::only(VIEW), UiAction::new("error"));
    assert!(matches!(error, Err(PluginError::BadArgs(_))));
    assert_eq!(seen.load(Ordering::SeqCst), 1, "error events are drained");

    let panic = host.view_action(None, &ViewInstance::only(VIEW), UiAction::new("panic"));
    assert!(
        matches!(&panic, Err(PluginError::Internal(message))
            if message.to_string().contains("panico")),
        "the callback boundary must convert the panic: {panic:?}"
    );
    assert_eq!(seen.load(Ordering::SeqCst), 2, "panic events are drained");

    assert_eq!(
        host.view_action(None, &ViewInstance::only(VIEW), UiAction::new("success"),)
        .expect("the provider remains reusable"),
        ViewUpdate::None
    );
    assert_eq!(seen.load(Ordering::SeqCst), 3);
    assert!(workspace.try_read().is_some(), "no read lock remains");
    assert!(workspace.try_write().is_some(), "no write lock remains");
}

#[test]
fn refresh_invalidates_only_its_own_prepared_view() {
    let vault = vault();
    let host = open(&vault);
    declare_and_register(
        &host,
        Box::new(FixedView {
            view: VIEW,
            text: "current",
        }),
    );
    let workspace = host.debug_workspace(None).expect("debug custody");
    let prepared = workspace
        .read()
        .expect("the vault is alive")
        .prepare_view_render(&ViewInstance::only(VIEW))
        .expect("render prepares");

    {
        let mut workspace = workspace.write().expect("the vault is alive");
        workspace
            .register_core_feature(OTHER_PLUGIN, "Unrelated view")
            .expect("other view declares");
        workspace
            .register_view_provider(
                OTHER_PLUGIN,
                Box::new(FixedView {
                    view: OTHER_VIEW,
                    text: "other",
                }),
            )
            .expect("unrelated view registers");
    }
    assert_eq!(
        workspace
            .read()
            .expect("the vault is alive")
            .finish_view_render(prepared, Ok(UiNode::text("current")))
            .expect("an unrelated registration is compatible"),
        UiNode::text("current")
    );

    let prepared_error = workspace
        .read()
        .expect("the vault is alive")
        .prepare_view_render(&ViewInstance::only(VIEW))
        .expect("render prepares again");
    workspace
        .write()
        .expect("the vault is alive")
        .refresh_specs(PLUGIN)
        .expect("the provider refreshes its declaration");
    let provider_error = workspace
        .read()
        .expect("the vault is alive")
        .finish_view_render(
            prepared_error,
            Err(PluginError::BadArgs("intentional render error".into())),
        );
    assert!(
        matches!(&provider_error, Err(PluginError::BadArgs(message))
            if message.to_string() == "intentional render error"),
        "a concurrent refresh must not mask the provider error: {provider_error:?}"
    );

    let prepared_stale = workspace
        .read()
        .expect("the vault is alive")
        .prepare_view_render(&ViewInstance::only(VIEW))
        .expect("render prepares a third time");
    workspace
        .write()
        .expect("the vault is alive")
        .refresh_specs(PLUGIN)
        .expect("the provider refreshes its declaration again");
    let stale = workspace
        .read()
        .expect("the vault is alive")
        .finish_view_render(prepared_stale, Ok(UiNode::text("obsolete")));
    assert_stale(stale);
}
