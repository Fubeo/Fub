//! Il manager attraversa store, sorgente startup e lifecycle reale dell'host.

mod common;

use std::sync::{mpsc, Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::InvokeMode;
use fub_abi::traits::{Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_host::registry::Registrar;
use fub_host::{
    Bundle, BundleRegistry, Host, NoWatcher, OnlyProviders, StartupSnapshot, StartupSource,
    StartupValidity,
};
use fub_kernel::Trust;
use fub_wasm_host::installed::Consent;
use fub_wasm_host::managed::InstalledPluginManager;

const ID: &str = "demo.ping";
const COUNT: &str = "demo.ping:conta";

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("vault tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("vault utf8");
        std::fs::write(root.join("Nota.md"), "# Una nota\n").expect("nota fixture");
        Self { _dir: dir, root }
    }
}

fn root(dir: &tempfile::TempDir) -> &Utf8Path {
    Utf8Path::from_path(dir.path()).expect("config utf8")
}

fn installed_blob(config: &Utf8Path) -> Utf8PathBuf {
    let mut blobs = std::fs::read_dir(config.join("wasm-plugins/components"))
        .expect("component directory")
        .map(|entry| {
            Utf8PathBuf::from_path_buf(entry.expect("component entry").path())
                .expect("component path utf8")
        })
        .filter(|path| path.extension() == Some("wasm"));
    let blob = blobs.next().expect("one installed blob");
    assert!(blobs.next().is_none(), "fixture has one installed blob");
    blob
}

fn managed_host(source: Arc<InstalledPluginManager>) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1)
        .with_startup_source(source)
}

fn invoke_count(host: &Host) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    host.invoke_user_command(None, COUNT, serde_json::json!({}), InvokeMode::Apply)
}

#[test]
fn desktop_choice_is_authoritative_across_disable_remove_and_restart() {
    let config = tempfile::tempdir().expect("config tempdir");
    let vault = Vault::new();
    let manager = Arc::new(InstalledPluginManager::open(root(&config)).expect("manager opens"));
    let installed = manager
        .install(&common::ping(""))
        .expect("component installs");
    assert!(!installed.enabled);
    assert_eq!(installed.consent, Consent::Undecided);
    assert!(!installed.bundle.mounted);
    assert!(!installed.runtime_known);

    let host = managed_host(Arc::clone(&manager));
    host.open(&vault.root).expect("vault opens");
    host.wait_indexed(None).expect("opening finishes");
    assert!(manager
        .set_enabled_by_id(&host, Some(vault.root.as_str()), ID, true)
        .expect("legacy ownership resolution succeeds")
        .is_none());
    assert!(
        !manager
            .store()
            .snapshot()
            .expect("legacy resolution does not mutate inventory")
            .plugins()[0]
            .enabled
    );
    assert!(manager
        .set_enabled(&host, installed.installation, true)
        .expect("enabled persists")
        .is_empty());
    let undecided = manager
        .list(&host, Some(vault.root.as_str()))
        .expect("metadata lists");
    assert!(undecided[0].enabled);
    assert!(!undecided[0].runtime_known);
    assert!(!undecided[0].bundle.mounted);

    assert!(manager
        .set_consent(&host, installed.installation, Consent::Granted)
        .expect("consent persists and mounts")
        .is_empty());
    let mounted = manager
        .list(&host, Some(vault.root.as_str()))
        .expect("mounted metadata lists");
    assert!(mounted[0].runtime_known);
    assert!(mounted[0].bundle.mounted);
    let denied = invoke_count(&host).expect_err("default-deny rejects vault reading");
    assert!(matches!(denied, PluginError::PermissionDenied(_)));
    let permission =
        fub_abi::settings::permission_key(ID, fub_abi::options::permission::READ_VAULT);
    host.set_setting_for_user(
        Some(vault.root.as_str()),
        &permission,
        fub_abi::settings::SettingValue::Toggle(true),
    )
    .expect("the user grants the declared capability through the host port");
    invoke_count(&host).expect("the same mounted plugin can use the granted capability");

    assert!(manager
        .set_enabled(&host, installed.installation, false)
        .expect("disable tears down")
        .is_empty());
    let disabled = manager
        .list(&host, Some(vault.root.as_str()))
        .expect("disabled metadata lists");
    assert!(!disabled[0].enabled);
    assert!(disabled[0].runtime_known);
    assert!(!disabled[0].bundle.mounted);
    assert!(matches!(
        invoke_count(&host),
        Err(PluginError::UnknownCommand(_))
    ));
    let remembered = host
        .bundles(Some(vault.root.as_str()))
        .expect("runtime inventory reads");
    let remembered = remembered
        .iter()
        .find(|bundle| bundle.id == ID)
        .expect("disabled installation remains known");
    assert!(!remembered.mounted);

    assert!(manager
        .set_enabled_by_id(&host, Some(vault.root.as_str()), ID, true)
        .expect("legacy ownership resolution succeeds")
        .expect("the disabled installed claim remains the legacy owner")
        .is_empty());
    let restored = manager
        .list(&host, Some(vault.root.as_str()))
        .expect("restored metadata lists");
    assert!(restored[0].enabled);
    assert!(restored[0].runtime_known);
    assert!(restored[0].bundle.mounted);
    invoke_count(&host).expect("the remembered bundle mounts again");

    assert!(manager
        .set_enabled(&host, installed.installation, false)
        .expect("restored installation disables")
        .is_empty());
    let plugin_data = vault.root.join(".fub/plugins/demo.ping/authoritative.bin");
    std::fs::create_dir_all(plugin_data.parent().expect("plugin data parent"))
        .expect("plugin data directory");
    std::fs::write(&plugin_data, b"authoritative plugin data").expect("plugin data write");
    assert!(manager
        .remove(&host, installed.installation)
        .expect("disabled installation removes")
        .is_empty());
    assert!(manager
        .list(&host, Some(vault.root.as_str()))
        .expect("empty metadata lists")
        .is_empty());
    assert!(!host
        .bundles(Some(vault.root.as_str()))
        .expect("runtime inventory reads after removal")
        .iter()
        .any(|bundle| bundle.id == ID));
    assert_eq!(
        std::fs::read(&plugin_data).expect("plugin data remains"),
        b"authoritative plugin data"
    );
    assert!(host.close().is_empty());
    manager.shutdown().expect("manager drains");

    let restarted =
        Arc::new(InstalledPluginManager::open(root(&config)).expect("manager restarts"));
    let restarted_host = managed_host(Arc::clone(&restarted));
    restarted_host.open(&vault.root).expect("vault reopens");
    restarted_host
        .wait_indexed(None)
        .expect("restart opening finishes");
    assert!(restarted
        .list(&restarted_host, Some(vault.root.as_str()))
        .expect("restart metadata lists")
        .is_empty());
    assert_eq!(
        std::fs::read(plugin_data).expect("plugin data survives restart"),
        b"authoritative plugin data"
    );
}

#[test]
fn metadata_and_unapproved_choices_never_load_a_corrupt_guest() {
    let config = tempfile::tempdir().expect("config tempdir");
    let manager = Arc::new(InstalledPluginManager::open(root(&config)).expect("manager opens"));
    let installed = manager
        .install(&common::ping(""))
        .expect("component installs");
    std::fs::write(installed_blob(root(&config)), b"altered after installation")
        .expect("installed blob is altered");
    let host = Host::new().with_watcher(Box::new(NoWatcher));

    let listed = manager
        .list(&host, None)
        .expect("metadata does not load bytes");
    assert!(!listed[0].bundle.mounted);
    assert!(!listed[0].runtime_known);
    assert!(manager
        .set_enabled(&host, installed.installation, true)
        .expect("enabled without consent does not load bytes")
        .is_empty());
    let startup = manager
        .prepare()
        .expect("unapproved startup remains metadata-only");
    assert!(startup.bundles.is_empty());
    assert!(startup.diagnostics.is_empty());
    drop(startup);

    let errors = manager
        .set_consent(&host, installed.installation, Consent::Granted)
        .expect("committed consent reports later validation failure");
    assert!(matches!(errors.as_slice(), [PluginError::Conflict(_)]));
    let persisted = manager.store().snapshot().expect("choice remains readable");
    assert!(persisted.plugins()[0].enabled);
    assert_eq!(persisted.plugins()[0].consent, Consent::Granted);
    let selected = manager
        .prepare()
        .expect("one broken selected record is a typed diagnostic");
    assert!(selected.bundles.is_empty());
    assert!(matches!(
        selected.diagnostics.as_slice(),
        [PluginError::Conflict(_)]
    ));
}

struct OfficialCollision;

impl Bundle for OfficialCollision {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(ID, "Official Ping")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        Vec::new()
    }
}

#[test]
fn an_installed_collision_never_replaces_or_routes_the_official_identity() {
    let config = tempfile::tempdir().expect("config tempdir");
    let vault = Vault::new();
    let manager = Arc::new(InstalledPluginManager::open(root(&config)).expect("manager opens"));
    let installed = manager
        .install(&common::ping(""))
        .expect("component installs");
    let host = managed_host(Arc::clone(&manager));
    host.open(&vault.root).expect("vault opens");
    host.wait_indexed(None).expect("opening finishes");
    host.with_session(Some(vault.root.as_str()), |session| {
        BundleRegistry::remember_guarded(session.bundles(), Arc::new(OfficialCollision))
    })
    .expect("vault remains open")
    .expect("official identity is remembered");

    assert!(manager
        .set_enabled(&host, installed.installation, true)
        .expect("enabled persists without touching official")
        .is_empty());
    let errors = manager
        .set_consent(&host, installed.installation, Consent::Granted)
        .expect("consent persists and collision is reported");
    assert!(matches!(errors.as_slice(), [PluginError::AlreadyExists(_)]));
    assert!(manager
        .set_enabled_by_id(&host, Some(vault.root.as_str()), ID, false)
        .expect("legacy ownership query succeeds")
        .is_none());

    let runtime = host
        .bundles(Some(vault.root.as_str()))
        .expect("runtime inventory reads");
    let official = runtime
        .iter()
        .find(|bundle| bundle.id == ID)
        .expect("official identity remains");
    assert_eq!(official.name, "Official Ping");
    assert_eq!(official.trust, Trust::Core);
    let metadata = manager
        .list(&host, Some(vault.root.as_str()))
        .expect("installed collision remains metadata");
    assert!(!metadata[0].runtime_known);
    assert!(!metadata[0].bundle.mounted);
    assert!(metadata[0].enabled);
    assert_eq!(metadata[0].consent, Consent::Granted);
}

#[test]
fn a_failed_activation_leaves_no_claim_provider_or_instance() {
    let config = tempfile::tempdir().expect("config tempdir");
    let vault = Vault::new();
    let manager = Arc::new(InstalledPluginManager::open(root(&config)).expect("manager opens"));
    let installed = manager
        .install(&common::ping("fallisce-attivazione"))
        .expect("valid component installs before consent");
    let host = managed_host(Arc::clone(&manager));
    host.open(&vault.root).expect("vault opens");
    host.wait_indexed(None).expect("opening finishes");
    assert!(manager
        .set_enabled(&host, installed.installation, true)
        .expect("enabled persists")
        .is_empty());
    let errors = manager
        .set_consent(&host, installed.installation, Consent::Granted)
        .expect("committed consent reports runtime failure");
    assert!(!errors.is_empty());

    let listed = manager
        .list(&host, Some(vault.root.as_str()))
        .expect("metadata survives failed mount");
    assert!(listed[0].enabled);
    assert_eq!(listed[0].consent, Consent::Granted);
    assert!(!listed[0].runtime_known);
    assert!(!listed[0].bundle.mounted);
    assert!(!host
        .bundles(Some(vault.root.as_str()))
        .expect("runtime inventory reads")
        .iter()
        .any(|bundle| bundle.id == ID));
    assert!(matches!(
        invoke_count(&host),
        Err(PluginError::UnknownCommand(_))
    ));
}

#[test]
fn shutdown_drains_a_permit_admitted_before_executor_queueing() {
    let config = tempfile::tempdir().expect("config tempdir");
    let manager = Arc::new(InstalledPluginManager::open(root(&config)).expect("manager opens"));
    let permit = manager.begin_operation().expect("operation admitted");
    let (started_tx, started_rx) = mpsc::sync_channel(0);
    let (done_tx, done_rx) = mpsc::sync_channel(0);
    let shutting_down = Arc::clone(&manager);
    let shutdown = std::thread::spawn(move || {
        started_tx.send(()).expect("shutdown starts");
        done_tx
            .send(shutting_down.shutdown())
            .expect("shutdown result observed");
    });
    started_rx.recv().expect("shutdown thread entered");

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match manager.begin_operation() {
            Err(PluginError::Cancelled(_)) => break,
            Ok(extra) => drop(extra),
            Err(error) => panic!("unexpected admission error: {error}"),
        }
        assert!(
            std::time::Instant::now() < deadline,
            "shutdown did not close admission"
        );
        std::thread::yield_now();
    }
    assert!(
        matches!(done_rx.try_recv(), Err(mpsc::TryRecvError::Empty)),
        "shutdown completed while an admitted permit was queued"
    );
    drop(permit);
    done_rx
        .recv()
        .expect("shutdown completes after permit drop")
        .expect("shutdown succeeds");
    shutdown.join().expect("shutdown thread does not panic");
    assert!(matches!(
        manager.begin_operation(),
        Err(PluginError::Cancelled(_))
    ));
}

struct BlockingSource {
    manager: Arc<InstalledPluginManager>,
    prepared: Mutex<Option<mpsc::SyncSender<Arc<StartupValidity>>>>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl StartupSource for BlockingSource {
    fn prepare(&self) -> Result<StartupSnapshot, PluginError> {
        let snapshot = self.manager.prepare()?;
        let validity = Arc::clone(
            snapshot
                .validity
                .as_ref()
                .expect("manager snapshots carry validity"),
        );
        self.prepared
            .lock()
            .map_err(|_| PluginError::Internal("canale prepared avvelenato".into()))?
            .take()
            .expect("prepare is called once")
            .send(validity)
            .map_err(|_| PluginError::Cancelled("banco staleness chiuso".into()))?;
        self.release
            .lock()
            .map_err(|_| PluginError::Internal("canale release avvelenato".into()))?
            .recv()
            .map_err(|_| PluginError::Cancelled("banco staleness chiuso".into()))?;
        Ok(snapshot)
    }
}

#[test]
fn a_committed_disable_invalidates_an_opening_snapshot_without_retry() {
    let config = tempfile::tempdir().expect("config tempdir");
    let vault = Vault::new();
    let manager = Arc::new(InstalledPluginManager::open(root(&config)).expect("manager opens"));
    let installed = manager
        .install(&common::ping(""))
        .expect("component installs");
    let second = manager
        .install(&common::component("eventi-wasm", "eventi_wasm", ""))
        .expect("second component installs");
    let empty_host = Host::new().with_watcher(Box::new(NoWatcher));
    assert!(manager
        .set_enabled(&empty_host, installed.installation, true)
        .expect("enabled persists")
        .is_empty());
    assert!(manager
        .set_consent(&empty_host, installed.installation, Consent::Granted)
        .expect("consent persists")
        .is_empty());
    assert!(manager
        .set_enabled(&empty_host, second.installation, true)
        .expect("second component is enabled")
        .is_empty());

    let (prepared_tx, prepared_rx) = mpsc::sync_channel(0);
    let (release_tx, release_rx) = mpsc::sync_channel(0);
    let source = Arc::new(BlockingSource {
        manager: Arc::clone(&manager),
        prepared: Mutex::new(Some(prepared_tx)),
        release: Mutex::new(release_rx),
    });
    let host = Arc::new(
        Host::new()
            .with_watcher(Box::new(NoWatcher))
            .with_job_threads(1)
            .with_startup_source(source),
    );
    let opening_host = Arc::clone(&host);
    let opening_root = vault.root.clone();
    let opening = std::thread::spawn(move || opening_host.open(&opening_root));
    let old_validity = prepared_rx.recv().expect("old snapshot prepared");
    let (disable_started_tx, disable_started_rx) = mpsc::sync_channel(0);
    let (disable_done_tx, disable_done_rx) = mpsc::sync_channel(0);
    let disabling_manager = Arc::clone(&manager);
    let disabling_host = Arc::clone(&host);
    let installation = installed.installation;
    let disabling = std::thread::spawn(move || {
        disable_started_tx.send(()).expect("disable starts");
        let result = disabling_manager.set_enabled(&disabling_host, installation, false);
        disable_done_tx
            .send(result)
            .expect("disable result observed");
    });
    disable_started_rx.recv().expect("disable thread entered");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match old_validity.acquire() {
            Err(PluginError::Conflict(_)) => break,
            Ok(lease) => drop(lease),
            Err(error) => panic!("unexpected validity error: {error}"),
        }
        assert!(
            std::time::Instant::now() < deadline,
            "disable did not invalidate the old token"
        );
        std::thread::yield_now();
    }
    let (second_started_tx, second_started_rx) = mpsc::sync_channel(0);
    let (second_done_tx, second_done_rx) = mpsc::sync_channel(0);
    let second_manager = Arc::clone(&manager);
    let second_host = Arc::clone(&host);
    let second_installation = second.installation;
    let second_disabling = std::thread::spawn(move || {
        second_started_tx.send(()).expect("second disable starts");
        let result = second_manager.set_enabled(&second_host, second_installation, false);
        second_done_tx
            .send(result)
            .expect("second disable result observed");
    });
    second_started_rx
        .recv()
        .expect("second disable thread entered");
    loop {
        let snapshot = manager
            .store()
            .snapshot()
            .expect("inventory remains readable");
        let second_enabled = snapshot
            .plugins()
            .iter()
            .find(|plugin| plugin.installation == second.installation)
            .expect("second installation remains")
            .enabled;
        if !second_enabled {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "second disable did not persist"
        );
        std::thread::yield_now();
    }
    std::thread::yield_now();
    assert!(
        matches!(second_done_rx.try_recv(), Err(mpsc::TryRecvError::Empty)),
        "a later validity rotation completed while the previous token was draining"
    );
    assert!(
        matches!(disable_done_rx.try_recv(), Err(mpsc::TryRecvError::Empty)),
        "disable completed before the old opening released its lease"
    );
    release_tx.send(()).expect("opening released");
    let error = opening
        .join()
        .expect("opening thread does not panic")
        .err()
        .expect("invalidated opening is not published or retried");
    assert!(matches!(error, PluginError::Conflict(_)));
    assert!(disable_done_rx
        .recv()
        .expect("disable reports after rollback")
        .expect("disable succeeds")
        .is_empty());
    assert!(second_done_rx
        .recv()
        .expect("second disable reports after the old lease is released")
        .expect("second disable succeeds")
        .is_empty());
    disabling.join().expect("disable thread does not panic");
    second_disabling
        .join()
        .expect("second disable thread does not panic");
    assert!(host.vaults().is_empty());
    assert!(
        !manager
            .store()
            .snapshot()
            .expect("inventory remains readable")
            .plugins()[0]
            .enabled
    );
}
