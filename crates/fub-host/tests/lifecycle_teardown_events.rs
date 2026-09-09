//! Il teardown mantiene l'ordine degli eventi senza richiamare un handler
//! dentro `Plugin::deactivate`, neppure tramite una capacità host annidata.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::event::{EventKind, EventMask, Notice};
use fub_abi::traits::{EventHandler, HostApi, Plugin, PluginManifest};
use fub_abi::{Event, PluginError};
use fub_host::registry::{Bundle, BundleRegistry};
use fub_host::{Custody, Host, NoWatcher};
use fub_kernel::{Trust, Workspace};

const EMITTER: &str = "fub.audit-teardown-emitter";
const OBSERVER: &str = "fub.audit-teardown-observer";
const TOPIC: &str = "fub:audit-teardown-event";

#[derive(Debug)]
struct Delivery {
    owner: &'static str,
    inside_deactivate: bool,
    workspace_read: bool,
    workspace_write: bool,
    registry_read: bool,
    registry_write: bool,
    capability_live: bool,
}

struct State {
    inside_deactivate: AtomicBool,
    workspace: Mutex<Option<Custody<Workspace>>>,
    registry: Mutex<Option<Custody<BundleRegistry>>>,
    deliveries: Mutex<Vec<Delivery>>,
}

struct ObservingHandler {
    owner: &'static str,
    state: Arc<State>,
}

impl EventHandler for ObservingHandler {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::Custom])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if !matches!(&notice.event, Event::Custom { topic, .. } if topic == TOPIC) {
            return Ok(());
        }
        let workspace = self
            .state
            .workspace
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .clone();
        let registry = self
            .state
            .registry
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .clone();
        let workspace_read = workspace.try_read().is_some();
        let workspace_write = workspace.try_write().is_some();
        let registry_read = registry.try_read().is_some();
        let registry_write = registry.try_write().is_some();
        let capability_live = workspace_read
            && workspace_write
            && registry_read
            && registry_write
            && host
                .data_write("teardown-event", self.owner.as_bytes())
                .is_ok()
            && host.data_read("teardown-event")? == Some(self.owner.as_bytes().to_vec());
        self.state.deliveries.lock().unwrap().push(Delivery {
            owner: self.owner,
            inside_deactivate: self.state.inside_deactivate.load(Ordering::SeqCst),
            workspace_read,
            workspace_write,
            registry_read,
            registry_write,
            capability_live,
        });
        Ok(())
    }
}

struct Emitter(Arc<State>);

impl Plugin for Emitter {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(EMITTER, EMITTER)
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.0.inside_deactivate.store(true, Ordering::SeqCst);
        host.emit(Event::Custom {
            topic: TOPIC.into(),
            payload: serde_json::Value::Null,
        });
        // Anche l'epilogo di una capacità successiva deve lasciare l'evento
        // accodato fino al ritorno della callback esterna.
        let result = host.data_write("deactivated", b"yes");
        self.0.inside_deactivate.store(false, Ordering::SeqCst);
        result
    }
}

struct EmitterBundle(Arc<State>);

impl Bundle for EmitterBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(EMITTER, EMITTER)
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Emitter(self.0.clone()))
    }

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        ws.register_event_handler(
            EMITTER,
            Box::new(ObservingHandler {
                owner: EMITTER,
                state: self.0.clone(),
            }),
        )
        .expect("register the emitter's own handler");
        Vec::new()
    }
}

fn exercise(close: bool) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 root");
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).expect("open vault");
    host.wait_indexed(None)
        .expect("startup completes before fixture mount");
    let workspace = host.debug_workspace(None).expect("workspace custody");
    let registry = host
        .in_session(None, |session| Ok(session.bundles().clone()))
        .expect("registry custody");
    let state = Arc::new(State {
        inside_deactivate: AtomicBool::new(false),
        workspace: Mutex::new(Some(workspace.clone())),
        registry: Mutex::new(Some(registry.clone())),
        deliveries: Mutex::new(Vec::new()),
    });
    {
        let mut ws = workspace.write().unwrap();
        // Registrato per primo, l'osservatore indipendente sopravvive al
        // teardown dell'emettitore anche durante la chiusura inversa.
        ws.register_core_feature(OBSERVER, OBSERVER)
            .expect("declare observer");
        ws.register_event_handler(
            OBSERVER,
            Box::new(ObservingHandler {
                owner: OBSERVER,
                state: state.clone(),
            }),
        )
        .expect("register independent observer");
        registry
            .write()
            .unwrap()
            .mount(&EmitterBundle(state.clone()), &mut ws)
            .expect("mount emitter fixture");
    }
    let errors = if close {
        host.close()
    } else {
        host.set_plugin_enabled(None, EMITTER, false)
            .expect("disable emitter")
    };
    state.workspace.lock().unwrap().take();
    state.registry.lock().unwrap().take();
    assert!(errors.is_empty(), "teardown completes: {errors:?}");
    let deliveries = state.deliveries.lock().unwrap();
    assert_eq!(
        deliveries
            .iter()
            .filter(|delivery| delivery.owner == OBSERVER)
            .count(),
        1,
        "the independent observer receives the event once: {deliveries:?}"
    );
    assert_eq!(
        deliveries
            .iter()
            .filter(|delivery| delivery.owner == EMITTER)
            .count(),
        usize::from(close),
        "close drains before retiring the owner; disable drains after unmount: {deliveries:?}"
    );
    for delivery in deliveries.iter() {
        assert!(
            !delivery.inside_deactivate,
            "event re-entered guest callback: {delivery:?}"
        );
        assert!(
            delivery.workspace_read
                && delivery.workspace_write
                && delivery.registry_read
                && delivery.registry_write,
            "handler retained a custody guard: {delivery:?}"
        );
        assert!(
            delivery.capability_live,
            "handler lost its real host capability: {delivery:?}"
        );
    }
    drop(deliveries);
    assert!(workspace.read().unwrap().trust_of(EMITTER).is_none());
    assert!(host.close().is_empty());
}

#[test]
fn close_delivers_deactivation_event_before_retiring_the_owners_handler() {
    exercise(true);
}

#[test]
fn disable_defers_deactivation_event_until_after_unmount() {
    exercise(false);
}
