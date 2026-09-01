from pathlib import Path


def rust_block_end(text: str, start: int) -> int:
    brace = text.find("{", start)
    if brace < 0:
        raise SystemExit("opening brace not found")
    depth = 0
    i = brace
    state = "code"
    block_depth = 0
    while i < len(text):
        c = text[i]
        n = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if c == "/" and n == "/":
                state = "line"; i += 2; continue
            if c == "/" and n == "*":
                state = "block"; block_depth = 1; i += 2; continue
            if c == '"':
                state = "string"; i += 1; continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return i + 1
            i += 1; continue
        if state == "line":
            if c == "\n": state = "code"
            i += 1; continue
        if state == "block":
            if c == "/" and n == "*":
                block_depth += 1; i += 2; continue
            if c == "*" and n == "/":
                block_depth -= 1; i += 2
                if block_depth == 0: state = "code"
                continue
            i += 1; continue
        if state == "string":
            if c == "\\": i += 2; continue
            if c == '"': state = "code"
            i += 1; continue
    raise SystemExit("unterminated Rust block")


def replace_function(text: str, marker: str, replacement: str, label: str) -> str:
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    start = text.index(marker)
    end = rust_block_end(text, start)
    return text[:start] + replacement + text[end:]


def insert_after_impl(text: str, marker: str, insertion: str, label: str) -> str:
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    start = text.index(marker)
    end = rust_block_end(text, start)
    return text[:end] + insertion + text[end:]


# Kernel prepare/call/finalize for mutable ViewProvider::on_action.
path = Path("crates/fub-kernel/src/workspace.rs")
text = path.read_text()
prepared = r'''

/// Un'azione di [`ViewProvider`] risolta sotto lock e invocabile senza tenere
/// `Custody<Workspace>`. Il frame di provider resta logicamente aperto fino al
/// finalize, mentre l'esclusione sulla mutabilità riguarda il solo provider.
pub struct PreparedViewAction {
    owner: String,
    view: String,
    instance: ViewInstance,
    action: Option<UiAction>,
    trust: Trust,
    provider: Arc<RwLock<Box<dyn ViewProvider>>>,
    previous_provider_call: bool,
}

impl PreparedViewAction {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn instance_id(&self) -> &str {
        &self.instance.instance
    }

    /// Esegue soltanto il codice esterno. Il provider ha il proprio lock; il
    /// workspace viene ripreso dal proxy soltanto per la singola capacità che
    /// la callback usa.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let action = self
            .action
            .take()
            .expect("a prepared view action is invoked exactly once");
        let mut provider = self
            .provider
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        crate::safety::calling(&self.owner, Gate::ViewAction, &self.view, || {
            provider.on_action(&self.instance, action, host)
        })
    }
}
'''
text = insert_after_impl(text, "impl PreparedViewRender {", prepared, "PreparedViewRender")

replacement = r'''    /// Prepara un'azione di view senza eseguire codice del provider. Il flag di
    /// provider-call viene aperto qui e chiuso in `finish_view_action`, così gli
    /// eventi prodotti dalla callback non possono rientrare nel suo frame.
    pub fn prepare_view_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
    ) -> std::result::Result<PreparedViewAction, PluginError> {
        let at = self.view_owner(&instance.view)?;
        self.check_params(at, instance)?;
        let (owner, trust, provider) = {
            let registered = &self.providers.views[at];
            (
                registered.id.clone(),
                registered.trust,
                Arc::clone(&registered.provider),
            )
        };
        let previous_provider_call = self.dispatch.enter_provider_call();
        Ok(PreparedViewAction {
            owner,
            view: instance.view.clone(),
            instance: instance.clone(),
            action: Some(action),
            trust,
            provider,
            previous_provider_call,
        })
    }

    /// Chiude il frame aperto da `prepare_view_action` e riproduce l'epilogo
    /// del vecchio percorso: ripristino flag, errore localizzato, trust gate,
    /// localizzazione e soltanto alla fine consegna degli eventi accodati.
    pub fn finish_view_action(
        &mut self,
        prepared: PreparedViewAction,
        outcome: std::result::Result<ViewUpdate, PluginError>,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let mut update = outcome.map_err(|and| self.localized(&prepared.owner, and))?;
        let tree = match &update {
            ViewUpdate::Replace { root } => Some(root),
            ViewUpdate::Patch { node, .. } => Some(node),
            ViewUpdate::None
            | ViewUpdate::Navigate { .. }
            | ViewUpdate::Reveal { .. }
            | ViewUpdate::RunSearch { .. }
            | ViewUpdate::Custom { .. } => None,
        };
        if let Some(tree) = tree {
            guard_ui(prepared.trust, tree)?;
        }
        self.localize(&prepared.owner, &mut update);
        self.dispatch_pending();
        Ok(update)
    }

    /// Compatibilità per i chiamanti diretti del kernel. L'host di processo usa
    /// le tre fasi separatamente, perché solo lui possiede `Custody<Workspace>`.
    pub fn view_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let mut prepared = self.prepare_view_action(instance, action)?;
        let owner = prepared.owner().to_string();
        let instance_id = prepared.instance_id().to_string();
        let outcome = {
            let mut host = self.host_for_view(&owner, InvokeMode::Apply, Some(&instance_id));
            prepared.invoke(&mut host)
        };
        self.finish_view_action(prepared, outcome)
    }'''
text = replace_function(text, "    pub fn view_action(\n", replacement, "Workspace::view_action")
path.write_text(text)


# Host owns the writer turn across prepare/call/finalize, but drops the RwLock
# while the callback runs. Readers progress; provider re-entry writes are
# reentrant on the same writer turn.
path = Path("crates/fub-host/src/session.rs")
text = path.read_text()
host_replacement = r'''    pub fn view_action(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
        action: UiAction,
    ) -> Result<ViewUpdate, PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        let _turn = workspace.write_turn();
        let mut prepared = {
            let mut ws = workspace.write()?;
            ws.prepare_view_action(instance, action)?
        };
        let mut detached = JobHost::new(workspace.clone(), prepared.owner().to_string())
            .for_view_instance(prepared.instance_id().to_string());
        let outcome = prepared.invoke(&mut detached);
        let mut ws = workspace.write()?;
        ws.finish_view_action(prepared, outcome)
    }'''
text = replace_function(text, "    pub fn view_action(\n", host_replacement, "Host::view_action")
path.write_text(text)


# Deterministic re-entry/concurrency regression.
path = Path("crates/fub-host/tests/concurrency.rs")
text = path.read_text()
anchor = "/// Una view che pania mentre disegna.\nstruct Explodes;"
if text.count(anchor) != 1:
    raise SystemExit("view action test anchor not unique")
probe = r'''const VIEW_ACTION_LOCK_PLUGIN: &str = "fub.audit-view-action";
const VIEW_ACTION_LOCK_VIEW: &str = "audit-view-action";

struct ViewActionLockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl ViewProvider for ViewActionLockProbe {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        fub_abi::traits::ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: VIEW_ACTION_LOCK_VIEW.into(),
            title: "Audit detached action".into(),
            surface: ViewSurface::RightSidebar,
            refresh: Default::default(),
            follows: Default::default(),
            params: Vec::new(),
            icon: None,
            order: 0,
            open_by_default: false,
            preferred_size: None,
            closable: true,
        }]
    }

    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("action probe"))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal(
                "view action re-entry returned the wrong note".into(),
            ));
        }
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("view action probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| PluginError::Internal("view action probe was not released".into()))?;
        Ok(ViewUpdate::None)
    }
}

#[test]
fn a_view_action_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(VIEW_ACTION_LOCK_PLUGIN, "Audit view action")
            .expect("view declares");
        w.register_view_provider(
            VIEW_ACTION_LOCK_PLUGIN,
            Box::new(ViewActionLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("view registers");
    }

    let call = std::thread::spawn(move || {
        host.view_action(
            None,
            &ViewInstance::only(VIEW_ACTION_LOCK_VIEW),
            UiAction::new("probe"),
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("view action entered after a successful HostApi re-entry");
    let (reader_tx, reader_rx) = std::sync::mpsc::sync_channel(1);
    let reader = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let acquired = ws.read().is_ok();
            let _ = reader_tx.send(acquired);
        })
    };
    let reader_progressed = reader_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or(false);
    release_tx.send(()).expect("release view action provider");
    reader.join().expect("reader probe finishes");
    let outcome = call.join().expect("view action thread does not panic");

    assert!(
        reader_progressed,
        "Host::view_action held Custody<Workspace> across ViewProvider::on_action"
    );
    assert_eq!(
        outcome.expect("view action completes through its per-capability host"),
        ViewUpdate::None
    );
}

'''
path.write_text(text.replace(anchor, probe + anchor, 1))
