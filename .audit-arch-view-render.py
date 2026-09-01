from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


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
                state = "line"
                i += 2
                continue
            if c == "/" and n == "*":
                state = "block"
                block_depth = 1
                i += 2
                continue
            if c == '"':
                state = "string"
                i += 1
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return i + 1
            i += 1
            continue
        if state == "line":
            if c == "\n":
                state = "code"
            i += 1
            continue
        if state == "block":
            if c == "/" and n == "*":
                block_depth += 1
                i += 2
                continue
            if c == "*" and n == "/":
                block_depth -= 1
                i += 2
                if block_depth == 0:
                    state = "code"
                continue
            i += 1
            continue
        if state == "string":
            if c == "\\":
                i += 2
                continue
            if c == '"':
                state = "code"
            i += 1
            continue
    raise SystemExit("unterminated Rust block")


def replace_function(text: str, marker: str, replacement: str, label: str) -> str:
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    start = text.index(marker)
    end = rust_block_end(text, start)
    return text[:start] + replacement + text[end:]


def insert_after_function(text: str, marker: str, insertion: str, label: str) -> str:
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    start = text.index(marker)
    end = rust_block_end(text, start)
    return text[:end] + insertion + text[end:]


# Provider registry: a view stays registered while its provider can be borrowed
# independently from the Workspace lock. Renderers take a shared provider lock;
# actions take an exclusive provider lock.
path = Path("crates/fub-kernel/src/providers.rs")
text = path.read_text()
text = replace_once(
    text,
    "use std::sync::Arc;",
    "use std::sync::{Arc, RwLock};",
    "providers import",
)
text = replace_once(
    text,
    "    pub(crate) provider: Box<dyn ViewProvider>,",
    "    pub(crate) provider: Arc<RwLock<Box<dyn ViewProvider>>>,",
    "registered view provider storage",
)
text = replace_once(
    text,
    "            .map(|(at, v)| (at, declared_specs(v.provider.as_ref())))",
    "            .map(|(at, v)| {\n                let provider = v\n                    .provider\n                    .read()\n                    .unwrap_or_else(|poisoned| poisoned.into_inner());\n                (at, declared_specs(provider.as_ref()))\n            })",
    "refresh view specs",
)
path.write_text(text)


# Kernel orchestration: detach render_view into prepare -> call -> finalize.
path = Path("crates/fub-kernel/src/workspace.rs")
text = path.read_text()

prepared_view = r'''

/// Un render di [`ViewProvider`] risolto sotto lock e invocabile senza tenere
/// `Custody<Workspace>`. Il provider resta registrato tramite un `Arc`; il lock
/// qui è del solo provider, non del workspace, e consente render concorrenti.
pub struct PreparedViewRender {
    owner: String,
    view: String,
    instance: ViewInstance,
    trust: Trust,
    provider: Arc<RwLock<Box<dyn ViewProvider>>>,
}

impl PreparedViewRender {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn instance_id(&self) -> &str {
        &self.instance.instance
    }

    /// Esegue soltanto il codice esterno del provider. Le letture richieste dal
    /// provider passano dal proxy host e prendono il workspace per capacità.
    pub fn invoke(&self, host: &dyn ReadApi) -> std::result::Result<UiNode, PluginError> {
        let provider = self
            .provider
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        crate::safety::calling(&self.owner, Gate::ViewRender, &self.view, || {
            provider.render_view(&self.instance, host)
        })
    }
}
'''
impl_start = text.index("impl PreparedService {")
impl_end = rust_block_end(text, impl_start)
text = text[:impl_end] + prepared_view + text[impl_end:]

text = replace_once(
    text,
    "        self.providers.views.push(RegisteredView {\n            id: plugin,\n            specs,\n            provider,\n            trust,\n        });",
    "        self.providers.views.push(RegisteredView {\n            id: plugin,\n            specs,\n            provider: Arc::new(RwLock::new(provider)),\n            trust,\n        });",
    "mount view provider",
)

render_replacement = r'''    pub fn prepare_view_render(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<PreparedViewRender, PluginError> {
        let at = self.view_owner(&instance.view)?;
        let registered = &self.providers.views[at];
        self.check_params(at, instance)?;
        Ok(PreparedViewRender {
            owner: registered.id.clone(),
            view: instance.view.clone(),
            instance: instance.clone(),
            trust: registered.trust,
            provider: Arc::clone(&registered.provider),
        })
    }

    /// Applica il confine di fiducia e la localizzazione dopo che il provider è
    /// tornato. Nessun codice del provider viene eseguito in questa fase.
    pub fn finish_view_render(
        &self,
        prepared: PreparedViewRender,
        outcome: std::result::Result<UiNode, PluginError>,
    ) -> std::result::Result<UiNode, PluginError> {
        let mut tree = outcome.map_err(|and| self.localized(&prepared.owner, and))?;
        guard_ui(prepared.trust, &tree)?;
        self.localize(&prepared.owner, &mut tree);
        Ok(tree)
    }

    pub fn render_view(&self, instance: &ViewInstance) -> std::result::Result<UiNode, PluginError> {
        let prepared = self.prepare_view_render(instance)?;
        let owner = prepared.owner().to_string();
        let instance_id = prepared.instance_id().to_string();
        let host = self.read_host_for_view(&owner, Some(instance_id.as_str()));
        let outcome = prepared.invoke(&host);
        self.finish_view_render(prepared, outcome)
    }'''
text = replace_function(text, "    pub fn render_view(&self, instance: &ViewInstance)", render_replacement, "render_view")

interests_replacement = r'''    pub fn view_interests(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<ViewInterests, PluginError> {
        let at = self.view_owner(&instance.view)?;
        let registered = &self.providers.views[at];
        let provider = registered
            .provider
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(provider.interests(instance))
    }'''
text = replace_function(text, "    pub fn view_interests(", interests_replacement, "view_interests")

text = replace_once(
    text,
    "                crate::safety::calling(&registered.id, Gate::ViewAction, &instance.view, || {\n                    registered.provider.on_action(instance, action, &mut host)\n                })",
    "                let mut provider = registered\n                    .provider\n                    .write()\n                    .unwrap_or_else(|poisoned| poisoned.into_inner());\n                crate::safety::calling(&registered.id, Gate::ViewAction, &instance.view, || {\n                    provider.on_action(instance, action, &mut host)\n                })",
    "view_action provider borrow",
)

read_instance = r'''

    /// Variante del proxy di lettura intestata a un esemplare di view. È la
    /// stessa politica di `with_read_host`, con in più la chiave dello stato di
    /// view che solo l'host può timbrare correttamente.
    pub fn with_read_host_instance<R>(
        &self,
        plugin: &str,
        instance: &str,
        f: impl FnOnce(&dyn ReadApi) -> R,
    ) -> R {
        let host = self.read_host_for_view(plugin, Some(instance));
        f(&host)
    }
'''
text = insert_after_function(text, "    pub fn with_read_host<R>(", read_instance, "with_read_host")

write_instance = r'''

    /// Variante del proxy di scrittura intestata a un esemplare di view. Le
    /// capacità restano per-chiamata; cambia soltanto il timbro dello stato di
    /// view.
    pub fn with_host_mode_instance<R>(
        &mut self,
        plugin: &str,
        mode: InvokeMode,
        instance: &str,
        f: impl FnOnce(&mut dyn HostApi) -> R,
    ) -> R {
        let mut host = self.host_for_view(plugin, mode, Some(instance));
        f(&mut host)
    }
'''
text = insert_after_function(text, "    pub fn with_host_mode<R>(", write_instance, "with_host_mode")
path.write_text(text)


# Per-capability proxy: allow the same proxy to carry a view instance stamp.
path = Path("crates/fub-host/src/jobs.rs")
text = path.read_text()
text = replace_once(
    text,
    "    mode: InvokeMode,\n    /// **L'identità che il job non ha**",
    "    mode: InvokeMode,\n    /// L'esemplare di view quando questo proxy serve una callback staccata.\n    /// I job e i provider annidati restano `None`.\n    instance: Option<String>,\n    /// **L'identità che il job non ha**",
    "job host instance field",
)
text = replace_once(
    text,
    "            mode: InvokeMode::Apply,\n            job: None,",
    "            mode: InvokeMode::Apply,\n            instance: None,\n            job: None,",
    "job host constructor",
)
text = replace_once(
    text,
    "            mode,\n            job: None,\n            cancelled: Arc::clone(&self.cancelled),",
    "            mode,\n            instance: None,\n            job: None,\n            cancelled: Arc::clone(&self.cancelled),",
    "provider child host",
)

view_builder = r'''

    /// Intesta il proxy a un esemplare di view. Lo stato di view è una capacità
    /// dell'esemplare, non del plugin in astratto, quindi il timbro viaggia col
    /// proxy e viene applicato a ogni singola acquisizione del workspace.
    pub(crate) fn for_view_instance(mut self, instance: impl Into<String>) -> Self {
        self.instance = Some(instance.into());
        self
    }
'''
text = insert_after_function(text, "    pub fn in_mode(", view_builder, "JobHost::in_mode")

reading_replacement = r'''    fn reading<R>(&self, f: impl FnOnce(&dyn ReadApi) -> R) -> Result<R, PluginError> {
        let ws = self.workspace.read()?;
        if let Some(instance) = self.instance.as_deref() {
            Ok(ws.with_read_host_instance(&self.plugin, instance, f))
        } else {
            Ok(ws.with_read_host(&self.plugin, f))
        }
    }'''
text = replace_function(text, "    fn reading<R>(", reading_replacement, "JobHost::reading")

writing_replacement = r'''    fn writing<R>(&self, f: impl FnOnce(&mut dyn HostApi) -> R) -> Result<R, PluginError> {
        let mut ws = self.workspace.write()?;
        if let Some(instance) = self.instance.as_deref() {
            Ok(ws.with_host_mode_instance(&self.plugin, self.mode, instance, f))
        } else {
            Ok(ws.with_host_mode(&self.plugin, self.mode, f))
        }
    }'''
text = replace_function(text, "    fn writing<R>(", writing_replacement, "JobHost::writing")

text = text.replace(
    "/// Un job non disegna una view, quindi **non ha uno stato di vista**: leggere\n/// torna `None` (che è il caso normale di chi non ha mai salvato) e scrivere è\n/// l'errore che il contratto dichiara. Non è una mutilazione di questo host: è\n/// la stessa riga che vale per un `EventHandler` e per un comando, scritta qui\n/// perché qui la si legge.",
    "/// Un job normale non disegna una view e quindi non ha uno stato di view.\n/// Lo stesso proxy, quando serve una callback di view staccata dal workspace,\n/// porta invece `instance`: in quel caso queste due capacità ricevono il timbro\n/// dell'esemplare. Comandi, servizi e job annidati non lo ereditano.",
    1,
)
path.write_text(text)


# Host boundary: prepare under a read guard, call through the per-capability
# proxy with no Workspace guard, then finalize under a fresh read guard.
path = Path("crates/fub-host/src/session.rs")
text = path.read_text()
host_render = r'''    pub fn render_view(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
    ) -> Result<UiNode, PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        let prepared = {
            let ws = workspace.read()?;
            ws.prepare_view_render(instance)?
        };
        let detached = JobHost::new(workspace.clone(), prepared.owner().to_string())
            .for_view_instance(prepared.instance_id().to_string());
        let outcome = prepared.invoke(&detached);
        let ws = workspace.read()?;
        ws.finish_view_render(prepared, outcome)
    }'''
text = replace_function(text, "    pub fn render_view(\n", host_render, "Host::render_view")
path.write_text(text)


# Deterministic regression: the provider has already re-entered through ReadApi
# and is still blocked in render_view; at that exact point a writer must acquire
# the workspace immediately.
path = Path("crates/fub-host/tests/concurrency.rs")
text = path.read_text()
anchor = "/// Una view che pania mentre disegna.\nstruct Explodes;"
if text.count(anchor) != 1:
    raise SystemExit("view render test anchor not unique")
probe = r'''const VIEW_RENDER_LOCK_PLUGIN: &str = "fub.audit-view-render";
const VIEW_RENDER_LOCK_VIEW: &str = "audit-view-render";

struct ViewRenderLockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl ViewProvider for ViewRenderLockProbe {
    fn interests(
        &self,
        instance: &ViewInstance,
    ) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|spec| spec.id == instance.view)
            .map(|spec| fub_abi::traits::ViewInterests {
                refresh: spec.refresh,
                follows: spec.follows,
            })
            .unwrap_or_default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: VIEW_RENDER_LOCK_VIEW.into(),
            title: "Audit detached render".into(),
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

    fn render_view(&self, _: &ViewInstance, host: &dyn ReadApi) -> Result<UiNode, PluginError> {
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal(
                "view render re-entry returned the wrong note".into(),
            ));
        }
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("view render probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| PluginError::Internal("view render probe was not released".into()))?;
        Ok(UiNode::text("ok"))
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

#[test]
fn a_view_render_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(VIEW_RENDER_LOCK_PLUGIN, "Audit view render")
            .expect("view declares");
        w.register_view_provider(
            VIEW_RENDER_LOCK_PLUGIN,
            Box::new(ViewRenderLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("view registers");
    }

    let call = std::thread::spawn(move || {
        host.render_view(None, &ViewInstance::only(VIEW_RENDER_LOCK_VIEW))
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("view entered after a successful ReadApi re-entry");
    let writer_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_write().is_some())
            .join()
            .expect("writer probe finishes")
    };
    release_tx.send(()).expect("release view provider");
    let outcome = call.join().expect("render thread does not panic");

    assert!(
        writer_progressed,
        "Host::render_view held Custody<Workspace> across ViewProvider::render_view"
    );
    outcome.expect("view render completes through its per-capability read host");
}

'''
text = text.replace(anchor, probe + anchor, 1)
path.write_text(text)
