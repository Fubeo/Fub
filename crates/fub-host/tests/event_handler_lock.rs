//! Regressioni ARCH-001 per il drain staccato degli `EventHandler`.
//!
//! Gli ingressi qui sotto coprono il salvataggio e le impostazioni top-level,
//! l'epilogo di view e comando, servizio e scrittura da `JobHost`, e il
//! rilevatore esterno. Ogni callback prova sia `try_read` sia `try_write`, poi
//! rientra con una scrittura reale. Tutte le attese sono limitate e un `join`
//! avviene soltanto dopo il segnale di fine.
//!
//! Anche `VaultSession::close` passa da un epilogo dedicato: prepara il
//! terminale, lo drena mentre handler e capacità sono ancora vivi, quindi
//! consuma il token di chiusura e ritira i provider.
//!
//! # Staleness
//!
//! Una consegna evento non produce un risultato da applicare al workspace:
//! l'unico stato prestato è la tabella degli handler, sempre ripristinata prima
//! di avanzare il cursore. Il writer turn resta posseduto per l'intero
//! prepare→invoke→finalize, quindi retire/replace da un altro writer non può
//! attraversare la callback. Le mutazioni fatte dal callback tramite una
//! capacità lecita appartengono allo stesso turno, vengono accodate e sono
//! servite dal medesimo drain con lo stesso budget. Non esiste dunque un
//! payload obsoleto da committare; la staleness è non applicabile per forma.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};
use fub_abi::edit::WriteBase;
use fub_abi::event::{EventKind, EventMask, Notice};
use fub_abi::model::DocId;
use fub_abi::settings::{SettingSpec, SettingValue};
use fub_abi::traits::{
    CommandProvider, EventHandler, HostApi, HostCommands, HostServices, PluginManifest, ReadApi,
    ServiceProvider, VaultWrite, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::{Event, Gate, PluginError};
use fub_host::{Custody, ExternalSync, Host, JobHost, NoWatcher};
use fub_kernel::{Trust, Workspace};

const HANDLER: &str = "fub.audit-event-handler";
const VIEW_OWNER: &str = "fub.audit-event-view";
const VIEW: &str = "audit-event-view";
const COMMAND_OWNER: &str = "fub.audit-event-command";
const COMMAND: &str = "fub.audit-event-command.invoke";
const SERVICE_OWNER: &str = "fub.audit-event-service";
const SERVICE: &str = "fub.audit-event-service";
const CALLER: &str = "fub.audit-event-caller";
const SETTING_OWNER: &str = "fub.audit-event-setting";
const SETTING: &str = "fub.audit-event-setting.enabled";
const VIEW_EVENT: &str = "fub:audit-event-view-delivered";
const COMMAND_EVENT: &str = "fub:audit-event-command-delivered";
const SERVICE_EVENT: &str = "fub:audit-event-service-delivered";
const TIMEOUT: Duration = Duration::from_secs(10);

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault() -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 vault path");
    std::fs::write(root.join("Note.md"), "# Note\n").expect("seed note");
    Vault { _dir: dir, root }
}

fn opened() -> (Vault, Host, Custody<Workspace>) {
    let vault = vault();
    let root = vault.root.clone();
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let opening = std::thread::spawn(move || {
        let host = Host::new().with_watcher(Box::new(NoWatcher));
        let outcome = host.open(&root).and_then(|_| host.wait_indexed(None));
        let _ = done_tx.send((host, outcome));
    });
    let (host, outcome) = done_rx
        .recv_timeout(TIMEOUT)
        .expect("opening and indexing finish before the timeout");
    opening
        .join()
        .expect("the completed opening thread does not panic");
    outcome.expect("the vault opens and its initial indexing finishes");
    let workspace = host.debug_workspace(None).expect("debug custody");
    (vault, host, workspace)
}

/// Evita di lasciare il ciclo test-only workspace→handler→custody.
struct ProbeWorkspace(Mutex<Option<Custody<Workspace>>>);

impl ProbeWorkspace {
    fn new(workspace: &Custody<Workspace>) -> Arc<Self> {
        Arc::new(Self(Mutex::new(Some(workspace.clone()))))
    }

    fn custody(&self) -> Custody<Workspace> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .expect("the probe custody is installed")
            .clone()
    }

    fn detach(&self) {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }
}

#[derive(Clone, Copy)]
enum ExpectedEvent {
    Custom(&'static str),
    Document(&'static str),
    Setting(&'static str),
    Trouble(&'static str),
    VaultClosed,
}

impl ExpectedEvent {
    fn matches(self, event: &Event) -> bool {
        match (self, event) {
            (Self::Custom(expected), Event::Custom { topic, .. }) => topic == expected,
            (Self::Document(expected), Event::DocumentChanged { id, .. }) => {
                id.as_str() == expected
            }
            (Self::Setting(expected), Event::SettingChanged { key, .. }) => key == expected,
            (Self::Trouble(expected), Event::Trouble { error, .. }) => {
                error.to_string().contains(expected)
            }
            (Self::VaultClosed, Event::VaultClosed { .. }) => true,
            _ => false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Callback {
    Subscribed,
    Handle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LockObservation {
    callback: Callback,
    read: bool,
    write: bool,
}

struct LockProbe {
    workspace: Arc<ProbeWorkspace>,
    expected: ExpectedEvent,
    observations: mpsc::SyncSender<LockObservation>,
    reentered: mpsc::SyncSender<()>,
    measured_subscription: AtomicBool,
    handled: bool,
}

impl LockProbe {
    fn observe(&self, callback: Callback) -> LockObservation {
        let workspace = self.workspace.custody();
        let read = workspace.try_read();
        let read_free = read.is_some();
        drop(read);
        let write = workspace.try_write();
        let write_free = write.is_some();
        drop(write);
        LockObservation {
            callback,
            read: read_free,
            write: write_free,
        }
    }
}

impl EventHandler for LockProbe {
    fn subscribed(&self) -> EventMask {
        if !self.measured_subscription.swap(true, Ordering::SeqCst) {
            let _ = self.observations.send(self.observe(Callback::Subscribed));
        }
        EventMask::of([
            EventKind::Custom,
            EventKind::DocumentChanged,
            EventKind::SettingChanged,
            EventKind::Trouble,
            EventKind::VaultClosed,
        ])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if self.handled || !self.expected.matches(&notice.event) {
            return Ok(());
        }
        self.handled = true;
        self.observations
            .send(self.observe(Callback::Handle))
            .map_err(|_| PluginError::Internal("lock probe receiver disappeared".into()))?;
        host.write_document(
            &DocId::new("Event re-entry.md"),
            "# Event re-entry\n",
            WriteBase::Dictated,
        )?;
        self.reentered
            .send(())
            .map_err(|_| PluginError::Internal("re-entry receiver disappeared".into()))?;
        Ok(())
    }
}

fn register_probe(
    workspace: &Custody<Workspace>,
    expected: ExpectedEvent,
) -> (
    Arc<ProbeWorkspace>,
    mpsc::Receiver<LockObservation>,
    mpsc::Receiver<()>,
) {
    let probe_workspace = ProbeWorkspace::new(workspace);
    let (observations_tx, observations_rx) = mpsc::sync_channel(2);
    let (reentered_tx, reentered_rx) = mpsc::sync_channel(1);
    let mut ws = workspace.write().expect("the vault is alive");
    ws.register_core_feature(HANDLER, "Audit event handler")
        .expect("event owner declares");
    ws.register_event_handler(
        HANDLER,
        Box::new(LockProbe {
            workspace: Arc::clone(&probe_workspace),
            expected,
            observations: observations_tx,
            reentered: reentered_tx,
            measured_subscription: AtomicBool::new(false),
            handled: false,
        }),
    )
    .expect("event handler registers");
    drop(ws);
    (probe_workspace, observations_rx, reentered_rx)
}

fn assert_workspace_reusable(workspace: &Custody<Workspace>) {
    let deadline = Instant::now() + TIMEOUT;
    loop {
        if let Some(read) = workspace.try_read() {
            assert!(
                read.documents().contains(&DocId::new("Event re-entry.md")),
                "the handler's re-entrant write made observable progress"
            );
            drop(read);
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the workspace did not become readable after the event drain"
        );
        std::thread::yield_now();
    }

    let deadline = Instant::now() + TIMEOUT;
    loop {
        if let Some(write) = workspace.try_write() {
            drop(write);
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the workspace did not become writable after the event drain"
        );
        std::thread::yield_now();
    }
    assert_eq!(
        workspace.reports(),
        0,
        "the event boundary poisoned custody"
    );
}

fn run_detached<T: Send + 'static>(
    workspace: &Custody<Workspace>,
    observations: mpsc::Receiver<LockObservation>,
    reentered: mpsc::Receiver<()>,
    call: impl FnOnce() -> Result<T, PluginError> + Send + 'static,
) -> T {
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let thread = std::thread::spawn(move || {
        let outcome = call();
        let _ = done_tx.send(outcome);
    });

    for expected in [Callback::Subscribed, Callback::Handle] {
        let observed = observations
            .recv_timeout(TIMEOUT)
            .unwrap_or_else(|_| panic!("{expected:?} did not run before the timeout"));
        assert_eq!(observed.callback, expected);
        assert!(
            observed.read,
            "{expected:?} retained a workspace write guard"
        );
        assert!(
            observed.write,
            "{expected:?} retained a workspace read or write guard"
        );
    }
    reentered
        .recv_timeout(TIMEOUT)
        .expect("EventHandler::handle re-entered through HostApi");
    let outcome = done_rx
        .recv_timeout(TIMEOUT)
        .expect("the host entrypoint did not complete before the timeout")
        .expect("the host entrypoint succeeds");
    thread
        .join()
        .expect("the completed call thread does not panic");
    assert_workspace_reusable(workspace);
    outcome
}

struct EmittingView;

impl ViewProvider for EmittingView {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        fub_abi::traits::ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(VIEW, VIEW, ViewSurface::RightSidebar)]
    }

    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("event probe"))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        host.emit(Event::Custom {
            topic: VIEW_EVENT.into(),
            payload: serde_json::Value::Null,
        });
        Ok(ViewUpdate::None)
    }
}

struct EmittingCommand;

impl CommandProvider for EmittingCommand {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(COMMAND, "Emit an event")
            .with_scope(CommandScope::writing(CommandReach::Session))]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        host.emit(Event::Custom {
            topic: COMMAND_EVENT.into(),
            payload: serde_json::Value::Null,
        });
        Ok(CommandOutcome::done())
    }
}

struct EmittingService;

impl ServiceProvider for EmittingService {
    fn call(
        &self,
        _: &str,
        _: &str,
        _: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        host.emit(Event::Custom {
            topic: SERVICE_EVENT.into(),
            payload: serde_json::Value::Null,
        });
        Ok(serde_json::json!({ "delivered": true }))
    }
}

#[test]
fn host_write_drains_event_handlers_outside_both_guards() {
    let (_vault, host, workspace) = opened();
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::Document("Note.md"));
    run_detached(&workspace, observations, reentered, move || {
        host.write_document(
            None,
            &DocId::new("Note.md"),
            "# Note\nchanged\n",
            WriteBase::Dictated,
        )
    });
    probe.detach();
}

#[test]
fn host_setting_drains_event_handlers_outside_both_guards() {
    let (_vault, host, workspace) = opened();
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_plugin(
            PluginManifest::core(SETTING_OWNER, "Audit event setting").configuring(vec![
                SettingSpec::toggle(SETTING, "Audit event setting", false),
            ]),
            Trust::Core,
        )
        .expect("setting owner declares");
    }
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::Setting(SETTING));
    run_detached(&workspace, observations, reentered, move || {
        host.set_setting_for_user(None, SETTING, SettingValue::Toggle(true))
    });
    probe.detach();
}

#[test]
fn watcher_failure_drains_event_handlers_outside_both_guards() {
    let (_vault, _host, workspace) = opened();
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::Trouble("audit watcher stopped"));
    let workspace_for_call = workspace.clone();
    run_detached(&workspace, observations, reentered, move || {
        ExternalSync::new(workspace_for_call).watch_died(vec!["audit watcher stopped".to_string()]);
        Ok(())
    });
    probe.detach();
}

#[test]
fn view_action_drains_event_handlers_outside_both_guards() {
    let (_vault, host, workspace) = opened();
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::Custom(VIEW_EVENT));
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_core_feature(VIEW_OWNER, "Audit event view")
            .expect("view owner declares");
        ws.register_view_provider(VIEW_OWNER, Box::new(EmittingView))
            .expect("view provider registers");
    }
    run_detached(&workspace, observations, reentered, move || {
        host.view_action(None, &ViewInstance::only(VIEW), UiAction::new("emit"))
    });
    probe.detach();
}

#[test]
fn host_command_drains_event_handlers_outside_both_guards() {
    let (_vault, host, workspace) = opened();
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::Custom(COMMAND_EVENT));
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_core_feature(COMMAND_OWNER, "Audit event command")
            .expect("command owner declares");
        ws.register_command_provider(COMMAND_OWNER, Box::new(EmittingCommand))
            .expect("command provider registers");
    }
    run_detached(&workspace, observations, reentered, move || {
        host.invoke_user_command(None, COMMAND, serde_json::Value::Null, InvokeMode::Apply)
    });
    probe.detach();
}

#[test]
fn job_host_command_drains_event_handlers_outside_both_guards() {
    let (_vault, _host, workspace) = opened();
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::Custom(COMMAND_EVENT));
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_core_feature(COMMAND_OWNER, "Audit event command")
            .expect("command owner declares");
        ws.register_command_provider(COMMAND_OWNER, Box::new(EmittingCommand))
            .expect("command provider registers");
        ws.register_core_feature(CALLER, "Audit event caller")
            .expect("caller declares");
    }
    let workspace_for_call = workspace.clone();
    run_detached(&workspace, observations, reentered, move || {
        let mut job = JobHost::new(workspace_for_call, CALLER);
        job.run_command(COMMAND, serde_json::Value::Null)
    });
    probe.detach();
}

#[test]
fn job_host_service_drains_event_handlers_outside_both_guards() {
    let (_vault, _host, workspace) = opened();
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::Custom(SERVICE_EVENT));
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_plugin(
            PluginManifest::core(SERVICE_OWNER, "Audit event service").providing(&[SERVICE]),
            Trust::Core,
        )
        .expect("service owner declares");
        ws.register_service_provider(SERVICE_OWNER, Box::new(EmittingService))
            .expect("service provider registers");
        ws.register_core_feature(CALLER, "Audit event caller")
            .expect("caller declares");
    }
    let workspace_for_call = workspace.clone();
    run_detached(&workspace, observations, reentered, move || {
        let mut job = JobHost::new(workspace_for_call, CALLER);
        job.call_service(SERVICE, "emit", serde_json::Value::Null)
    });
    probe.detach();
}

#[test]
fn job_host_write_drains_event_handlers_outside_both_guards() {
    let (_vault, _host, workspace) = opened();
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::Document("Note.md"));
    workspace
        .write()
        .expect("the vault is alive")
        .register_core_feature(CALLER, "Audit event caller")
        .expect("caller declares");
    let workspace_for_call = workspace.clone();
    run_detached(&workspace, observations, reentered, move || {
        let mut job = JobHost::new(workspace_for_call, CALLER);
        job.write_document(
            &DocId::new("Note.md"),
            "# Note\njob write\n",
            WriteBase::Dictated,
        )
    });
    probe.detach();
}

#[test]
fn vault_closed_drains_handlers_before_provider_retirement_without_both_guards() {
    let (vault, host, workspace) = opened();
    let (probe, observations, reentered) =
        register_probe(&workspace, ExpectedEvent::VaultClosed);
    let events = workspace
        .read()
        .expect("workspace readable")
        .bus()
        .subscribe();
    let root = vault.root.clone();
    let errors = run_detached(&workspace, observations, reentered, move || {
        host.close_vault(&root)
    });
    assert!(errors.is_empty(), "the detached close succeeds: {errors:?}");
    assert!(
        workspace
            .read()
            .expect("closed workspace remains readable")
            .is_closed(),
        "the close token was not finalized"
    );
    assert!(
        workspace
            .read()
            .expect("closed workspace remains readable")
            .plugins()
            .is_empty(),
        "finalize must retire provider owners, not only set the closed flag"
    );
    assert!(
        workspace
            .write()
            .expect("closed workspace remains writable")
            .close()
            .is_empty(),
        "a consumed close token must make a second close a no-op"
    );
    let closed = events
        .try_iter()
        .filter(|notice| matches!(notice.event, Event::VaultClosed { .. }))
        .count();
    assert_eq!(closed, 1, "VaultClosed must be emitted exactly once");
    probe.detach();
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fault {
    SubscribedPanic,
    HandleError,
    HandlePanic,
}

impl Fault {
    fn marker(self) -> &'static str {
        match self {
            Self::SubscribedPanic => "subscribed event probe",
            Self::HandleError => "event probe error",
            Self::HandlePanic => "handle event probe",
        }
    }
}

struct FlakyHandler {
    fault: Fault,
    tripped: AtomicBool,
    handled: Arc<AtomicUsize>,
}

impl EventHandler for FlakyHandler {
    fn subscribed(&self) -> EventMask {
        if self.fault == Fault::SubscribedPanic && !self.tripped.swap(true, Ordering::SeqCst) {
            panic!("subscribed event probe");
        }
        EventMask::of([EventKind::DocumentChanged])
    }

    fn handle(&mut self, _: &Notice, _: &mut dyn HostApi) -> Result<(), PluginError> {
        if !self.tripped.swap(true, Ordering::SeqCst) {
            match self.fault {
                Fault::SubscribedPanic => {}
                Fault::HandleError => {
                    return Err(PluginError::Internal("event probe error".into()));
                }
                Fault::HandlePanic => panic!("handle event probe"),
            }
        }
        self.handled.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

fn assert_fault_is_contained(fault: Fault) {
    let (_vault, host, workspace) = opened();
    let handled = Arc::new(AtomicUsize::new(0));
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_core_feature(HANDLER, "Audit event handler")
            .expect("event owner declares");
        ws.register_event_handler(
            HANDLER,
            Box::new(FlakyHandler {
                fault,
                tripped: AtomicBool::new(false),
                handled: Arc::clone(&handled),
            }),
        )
        .expect("event handler registers");
    }
    let events = workspace
        .read()
        .expect("workspace readable")
        .bus()
        .subscribe();

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let first = host.write_document(
            None,
            &DocId::new("first.md"),
            "# First\n",
            WriteBase::Dictated,
        );
        let second = host.write_document(
            None,
            &DocId::new("second.md"),
            "# Second\n",
            WriteBase::Dictated,
        );
        drop(host);
        let _ = done_tx.send((first, second));
    });
    let (first, second) = done_rx
        .recv_timeout(TIMEOUT)
        .unwrap_or_else(|_| panic!("{fault:?} left the event drain blocked"));
    first.expect("handler faults do not roll back the completed write");
    second.expect("the next write still works");
    call.join()
        .expect("the completed write thread does not panic");

    assert!(
        handled.load(Ordering::SeqCst) > 0,
        "the handler was not reusable after {fault:?}"
    );
    assert!(
        workspace.try_read().is_some(),
        "read lock leaked after {fault:?}"
    );
    assert!(
        workspace.try_write().is_some(),
        "write lock or writer turn leaked after {fault:?}"
    );
    let mut saw_event_trouble = false;
    while let Ok(notice) = events.try_recv() {
        let is_expected = match notice.event {
            Event::Trouble {
                error,
                gate: Some(Gate::Event),
                ..
            } => error.to_string().contains(fault.marker()),
            _ => false,
        };
        saw_event_trouble |= is_expected;
    }
    assert!(
        saw_event_trouble,
        "{fault:?} was contained but not reported through Gate::Event"
    );
}

#[test]
fn event_handler_errors_and_panics_restore_the_table_flags_and_budget() {
    for fault in [
        Fault::SubscribedPanic,
        Fault::HandleError,
        Fault::HandlePanic,
    ] {
        assert_fault_is_contained(fault);
    }
}

struct FlakyCloseHandler {
    fault: Fault,
    tripped: AtomicBool,
}

impl EventHandler for FlakyCloseHandler {
    fn subscribed(&self) -> EventMask {
        if self.fault == Fault::SubscribedPanic && !self.tripped.swap(true, Ordering::SeqCst) {
            panic!("subscribed event probe");
        }
        EventMask::of([EventKind::VaultClosed])
    }

    fn handle(&mut self, _: &Notice, _: &mut dyn HostApi) -> Result<(), PluginError> {
        if self.tripped.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        match self.fault {
            Fault::SubscribedPanic => Ok(()),
            Fault::HandleError => Err(PluginError::Internal("event probe error".into())),
            Fault::HandlePanic => panic!("handle event probe"),
        }
    }
}

fn assert_close_fault_is_contained(fault: Fault) {
    let (vault, host, workspace) = opened();
    {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.register_core_feature(HANDLER, "Audit close handler")
            .expect("close handler declares");
        ws.register_event_handler(
            HANDLER,
            Box::new(FlakyCloseHandler {
                fault,
                tripped: AtomicBool::new(false),
            }),
        )
        .expect("close handler registers");
    }
    let events = workspace
        .read()
        .expect("workspace readable")
        .bus()
        .subscribe();

    let root = vault.root.clone();
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let first = host.close_vault(&root);
        let reopened = host.open(&root).and_then(|_| host.wait_indexed(None));
        let final_errors = host.close();
        let _ = done_tx.send((first, reopened, final_errors));
    });
    let (first, reopened, final_errors) = done_rx
        .recv_timeout(TIMEOUT)
        .unwrap_or_else(|_| panic!("{fault:?} left the close drain blocked"));
    assert!(
        first
            .expect("the vault closes despite the handler fault")
            .is_empty(),
        "event handler faults are reported as Trouble, not close failures"
    );
    reopened.expect("the same host can reopen after a faulty close handler");
    assert!(
        final_errors.is_empty(),
        "the reopened vault closes cleanly"
    );
    call.join()
        .expect("the completed close thread does not panic");

    assert!(
        workspace.try_read().is_some(),
        "read lock leaked after {fault:?}"
    );
    assert!(
        workspace.try_write().is_some(),
        "write lock or writer turn leaked after {fault:?}"
    );
    assert!(
        workspace
            .read()
            .expect("old workspace remains readable")
            .is_closed(),
        "the close did not finish after {fault:?}"
    );
    assert!(
        workspace
            .read()
            .expect("old workspace remains readable")
            .plugins()
            .is_empty(),
        "provider owners survived the finalize after {fault:?}"
    );
    let mut saw_event_trouble = false;
    while let Ok(notice) = events.try_recv() {
        let is_expected = match notice.event {
            Event::Trouble {
                error,
                gate: Some(Gate::Event),
                ..
            } => error.to_string().contains(fault.marker()),
            _ => false,
        };
        saw_event_trouble |= is_expected;
    }
    assert!(
        saw_event_trouble,
        "{fault:?} during VaultClosed was contained but not reported"
    );
}

#[test]
fn vault_closed_errors_and_panics_finalize_once_and_allow_reopening() {
    for fault in [
        Fault::SubscribedPanic,
        Fault::HandleError,
        Fault::HandlePanic,
    ] {
        assert_close_fault_is_contained(fault);
    }
}

/// Il registry possiede i corpi dei plugin, ma non le loro dichiarazioni e i
/// provider: quelli appartengono al kernel. Se il registry è avvelenato non si
/// può chiamare `Plugin::deactivate`; la finalize kernel deve però consumare il
/// token e ritirare comunque tutto ciò che essa possiede.
#[test]
fn a_poisoned_bundle_registry_does_not_skip_kernel_close_finalization() {
    let (vault, host, workspace) = opened();
    let registry = host
        .in_session(None, |session| Ok(session.bundles().clone()))
        .expect("bundle registry custody");
    let poison = std::thread::spawn(move || {
        let _guard = registry.write().expect("registry is alive before poison");
        panic!("poison bundle registry before close");
    });
    assert!(poison.join().is_err(), "the fixture poisoned the registry");

    let root = vault.root.clone();
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let closing = std::thread::spawn(move || {
        let result = host.close_vault(&root);
        let _ = done_tx.send(result);
    });
    let errors = done_rx
        .recv_timeout(TIMEOUT)
        .expect("registry poison must not deadlock close")
        .expect("the session still closes");
    closing
        .join()
        .expect("the completed close thread does not panic");

    assert!(
        errors
            .iter()
            .any(|error| error.to_string().contains("irrecuperabile")),
        "registry poison was not reported: {errors:?}"
    );
    let ws = workspace
        .read()
        .expect("registry poison leaves the workspace credible");
    assert!(ws.is_closed(), "the prepared close was finalized");
    assert!(
        ws.plugins().is_empty(),
        "kernel providers and declarations must be retired despite registry poison"
    );
}

#[test]
fn every_background_event_source_keeps_the_detached_host_drain() {
    fn compact(source: &str) -> String {
        source
            .chars()
            .filter(|char| !char.is_whitespace())
            .collect()
    }

    let session = compact(include_str!("../src/session.rs"));
    assert!(
        session.contains(
            "let(work,index_job,work_total,live)=with_event_drain(&workspace,|ws|{letwork=ws.finalize_scan_vault(completed_scan);"
        ),
        "open must finalize its scan and begin its indexing job inside the detached drain"
    );
    assert!(
        !session.contains("session.workspace.write()?.set_setting(")
            && !session.contains("session.workspace.write()?.reset_setting(")
            && !session.contains("session.workspace.write()?.resume_settings("),
        "session settings must not dispatch EventHandler under Custody"
    );
    assert!(
        session.contains("letprepared=matchworkspace.write(){Ok(mutws)=>ws.prepare_close(),")
            && session.contains("ifletErr(and)=drain_events(&workspace)")
            && session.contains(
                "ws.finish_close_with(prepared,|workspace,id|reg.stop(workspace,id))",
            )
            && session.contains("ws.finish_close_with(prepared,|_,_|Vec::new())")
            && !session.contains(
                "ifletErr(and)=drain_events(&workspace){errors.push(and);returnerrors;"
            ),
        "VaultClosed must be drained after prepare and before provider retirement"
    );

    let runner = compact(include_str!("../src/runner.rs"));
    assert!(
        !runner.contains("self.workspace.write()?.complete_job(")
            && !runner.contains("self.workspace.write()?.fire_timer("),
        "job completion and timers must use with_event_drain"
    );
    assert!(
        runner.matches("with_event_drain(&self.workspace").count() >= 7,
        "opening progress, completion, refusal, timers and index finalization need detached drains"
    );

    let watcher = compact(include_str!("../src/watcher.rs"));
    assert!(
        !watcher.contains("self.workspace.write()"),
        "watcher mutations and failure notices must all use with_event_drain"
    );
    assert!(
        watcher.matches("with_event_drain(&self.workspace").count() >= 4,
        "batch, catch-up, flush and watcher death each need a detached drain"
    );
}
