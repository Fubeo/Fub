//! Il ritiro legacy del kernel non deve lasciare un corpo fantasma nel registry.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::{HostApi, Plugin, PluginError, PluginManifest};
use fub_host::registry::{Bundle, BundleRegistry};
use fub_host::{Custody, Host, NoWatcher};
use fub_kernel::{Trust, Workspace};

const OWNER: &str = "fub.audit-missing-owner";

#[derive(Default)]
struct Probe {
    workspace: Mutex<Option<Custody<Workspace>>>,
    registry: Mutex<Option<Custody<BundleRegistry>>>,
    deactivated: AtomicUsize,
    dropped: AtomicUsize,
    free: AtomicBool,
    panic_on_drop: bool,
}

struct Body(Arc<Probe>);

impl Plugin for Body {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(OWNER, OWNER)
    }
    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn deactivate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        self.0.deactivated.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

impl Drop for Body {
    fn drop(&mut self) {
        let workspace = self.0.workspace.lock().unwrap().as_ref().unwrap().clone();
        let registry = self.0.registry.lock().unwrap().as_ref().unwrap().clone();
        self.0.free.store(
            workspace.try_read().is_some()
                && workspace.try_write().is_some()
                && registry.try_read().is_some()
                && registry.try_write().is_some(),
            Ordering::SeqCst,
        );
        self.0.dropped.fetch_add(1, Ordering::SeqCst);
        if self.0.panic_on_drop {
            panic!("missing owner disposer");
        }
    }
}

struct FixtureBundle(Arc<Probe>);

impl Bundle for FixtureBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(OWNER, OWNER)
    }
    fn trust(&self) -> Trust {
        Trust::Core
    }
    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Body(self.0.clone()))
    }
    fn register(&self, _: &mut Workspace) -> Vec<String> {
        Vec::new()
    }
}

#[test]
fn a_missing_owner_releases_its_body_without_an_authorized_host() {
    for panic_on_drop in [false, true] {
        exercise(false, panic_on_drop);
    }
}

#[test]
fn a_busy_owner_keeps_its_body_until_the_provider_frame_finishes() {
    exercise(true, false);
}

fn exercise(busy: bool, panic_on_drop: bool) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let workspace = host.debug_workspace(None).unwrap();
    let registry = host.in_session(None, |s| Ok(s.bundles().clone())).unwrap();
    let probe = Arc::new(Probe {
        workspace: Mutex::new(Some(workspace.clone())),
        registry: Mutex::new(Some(registry.clone())),
        panic_on_drop,
        ..Probe::default()
    });
    {
        let mut ws = workspace.write().unwrap();
        registry
            .write()
            .unwrap()
            .mount(&FixtureBundle(probe.clone()), &mut ws)
            .unwrap();
    }
    let prepared = if busy {
        Some(
            workspace
                .write()
                .unwrap()
                .prepare_plugin_teardown(OWNER)
                .unwrap(),
        )
    } else {
        assert!(workspace
            .write()
            .unwrap()
            .deactivate_plugin(OWNER)
            .unwrap()
            .is_empty());
        None
    };
    let errors = host.set_plugin_enabled(None, OWNER, false).unwrap();
    assert!(!errors.is_empty(), "missing or busy owner must be reported");
    if let Some(prepared) = prepared {
        assert_eq!(probe.dropped.load(Ordering::SeqCst), 0);
        assert!(registry.read().unwrap().ids().contains(&OWNER));
        let finalized = {
            workspace
                .write()
                .unwrap()
                .finish_plugin_teardown(prepared, Vec::new())
        };
        let retired = finalized.map_err(|(_, error)| error).unwrap();
        assert!(matches!(
            retired.dispose().as_slice(),
            [PluginError::Conflict(_)]
        ));
        assert!(host
            .set_plugin_enabled(None, OWNER, false)
            .unwrap()
            .is_empty());
    }
    assert_eq!(probe.deactivated.load(Ordering::SeqCst), usize::from(busy));
    assert_eq!(probe.dropped.load(Ordering::SeqCst), 1);
    assert!(
        probe.free.load(Ordering::SeqCst),
        "disposer retains no guard"
    );
    assert!(!registry.read().unwrap().ids().contains(&OWNER));
    assert!(workspace.read().unwrap().trust_of(OWNER).is_none());
    probe.workspace.lock().unwrap().take();
    probe.registry.lock().unwrap().take();
    assert!(host.close().is_empty());
}
