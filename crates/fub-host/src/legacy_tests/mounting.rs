//! Presidi del lifecycle dei bundle: ABI, attivazione, registrazione atomica,
//! dipendenze, permessi e teardown.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::event::{Event, EventKind, EventMask, Notice};
use fub_abi::options::permission;
use fub_abi::settings::{permission_key, SettingScope, SettingSource, SettingValue};
use fub_abi::traits::{
    CommandProvider, EventHandler, HostApi, IndexQuery, IndexResult, Plugin, PluginManifest,
    PluginPermissions,
};
use fub_abi::PluginError;
use fub_format_markdown::MarkdownProvider;
use fub_host::registry::{Bundle, BundleError, BundleRegistry, OnlyProviders, Registrar};
use fub_kernel::Trust;
use fub_testkit::{Bench, Mounted};

fn vault() -> Mounted {
    Bench::new().with_format(MarkdownProvider::boxed()).mounts()
}

type Journal = Arc<Mutex<Vec<String>>>;

fn lines(journal: &Journal) -> Vec<String> {
    journal.lock().unwrap().clone()
}

struct Spy {
    id: &'static str,
    journal: Journal,
    not_is_activates: bool,
}

impl Plugin for Spy {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.id)
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.journal
            .lock()
            .unwrap()
            .push(format!("{}: activating", self.id));
        if self.not_is_activates {
            return Err(PluginError::Internal("I will not activate".into()));
        }
        Ok(())
    }

    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let host_live = host.data_write("addio", b"1").is_ok();
        let provider_live = host
            .run_command(&format!("{}.greet", self.id), serde_json::json!({}))
            .is_ok();
        self.journal.lock().unwrap().push(format!(
            "{}: stopping (host={host_live}, provider={provider_live})",
            self.id
        ));
        Ok(())
    }
}

struct GreetingProvider(&'static str);

impl CommandProvider for GreetingProvider {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(format!("{}.greet", self.0), "Greet")]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Ok(CommandOutcome::notify("hello"))
    }
}

struct EventRecorder {
    id: &'static str,
    journal: Journal,
}

impl EventHandler for EventRecorder {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::VaultClosed])
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        if matches!(notice.event, Event::VaultClosed { .. }) {
            self.journal
                .lock()
                .unwrap()
                .push(format!("{}: vault closing", self.id));
        }
        Ok(())
    }
}

struct BundleSpy {
    id: &'static str,
    journal: Journal,
    abi: String,
    not_is_activates: bool,
    loses_a_piece: bool,
}

impl BundleSpy {
    fn new(id: &'static str, journal: &Journal) -> Self {
        Self {
            id,
            journal: journal.clone(),
            abi: fub_abi::traits::ABI_VERSION.to_string(),
            not_is_activates: false,
            loses_a_piece: false,
        }
    }

    fn speaking(mut self, abi: &str) -> Self {
        self.abi = abi.to_string();
        self
    }

    fn that_not_is_activates(mut self) -> Self {
        self.not_is_activates = true;
        self
    }

    /// Registra correttamente comando e handler, poi tenta di registrare di
    /// nuovo lo stesso comando. Il quarto passo fallisce **dopo** aver lasciato
    /// provider nel kernel: è il caso che prova il rollback transazionale.
    fn that_leaves_back_a_piece(mut self) -> Self {
        self.loses_a_piece = true;
        self
    }
}

impl Bundle for BundleSpy {
    fn manifest(&self) -> PluginManifest {
        let mut manifest = PluginManifest::core(self.id, self.id);
        manifest.abi_version = self.abi.clone();
        manifest
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Spy {
            id: self.id,
            journal: self.journal.clone(),
            not_is_activates: self.not_is_activates,
        })
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        let mut failures = Vec::new();
        if let Err(error) = registrar.register_command_provider(Box::new(GreetingProvider(self.id)))
        {
            failures.push(format!("command: {error}"));
        }
        if let Err(error) = registrar.register_event_handler(Box::new(EventRecorder {
            id: self.id,
            journal: self.journal.clone(),
        })) {
            failures.push(format!("handler: {error}"));
        }
        if self.loses_a_piece {
            if let Err(error) =
                registrar.register_command_provider(Box::new(GreetingProvider(self.id)))
            {
                failures.push(format!("command: {error}"));
            }
        }
        failures
    }
}

/// Bundle minimale per provare l'ordinamento tramite `requires`/`provides`.
struct DependencyBundle {
    id: &'static str,
    provides: Vec<&'static str>,
    requires: Vec<&'static str>,
}

impl DependencyBundle {
    fn new(id: &'static str) -> Self {
        Self {
            id,
            provides: Vec::new(),
            requires: Vec::new(),
        }
    }

    fn providing(mut self, service: &'static str) -> Self {
        self.provides.push(service);
        self
    }

    fn requiring(mut self, service: &'static str) -> Self {
        self.requires.push(service);
        self
    }
}

impl Bundle for DependencyBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.id)
            .providing(&self.provides)
            .requiring(&self.requires)
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

/// Un bundle esterno che chiede una sola capacità. Il manifest **chiede**;
/// l'host decide se quella richiesta è stata approvata.
struct PermissionBundle;

impl PermissionBundle {
    const ID: &'static str = "com.acme.reader";
}

impl Bundle for PermissionBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(Self::ID, "Reader")
            .granting(PluginPermissions::of(&[permission::READ_VAULT]))
    }

    fn trust(&self) -> Trust {
        Trust::Community
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        Vec::new()
    }
}

struct PanickingPrepareBundle(&'static str);

impl Bundle for PanickingPrepareBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(self.0, self.0)
            .granting(PluginPermissions::of(&[permission::READ_VAULT]))
    }

    fn trust(&self) -> Trust {
        Trust::Community
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        Vec::new()
    }

    fn prepare(&self) -> fub_host::registry::BundleMount<'_> {
        panic!("deterministic preparation panic")
    }
}

#[test]
fn a_bundle_that_speaks_a_other_contract_not_is_mounts() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let (major, rest) = fub_abi::traits::ABI_VERSION
        .split_once('.')
        .expect("complete ABI version");
    let (minor, _) = rest.split_once('.').expect("ABI minor and patch");
    let future_minor = minor.parse::<u64>().expect("numeric ABI minor") + 1;
    let bundle =
        BundleSpy::new("test.future", &journal).speaking(&format!("{major}.{future_minor}.0"));
    let error = registry
        .mount(&bundle, &mut ws)
        .expect_err("a minor version newer than the host is not served");

    assert!(matches!(error, BundleError::Abi { .. }));
    assert!(ws.plugins().is_empty());
    assert!(ws.commands().is_empty());
    assert!(lines(&journal).is_empty());
    assert!(registry.ids().is_empty());
}

#[test]
fn a_activate_that_fails_not_leaves_a_plugin_declared() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpy::new("test.broken", &journal).that_not_is_activates();
    let error = registry
        .mount(&bundle, &mut ws)
        .expect_err("a failed activate is a bundle that does not exist");

    assert!(matches!(error, BundleError::Activation { .. }));
    assert_eq!(lines(&journal), vec!["test.broken: activating"]);
    assert!(ws.plugins().is_empty());
    assert!(ws.commands().is_empty());
    assert!(registry.ids().is_empty());
}

#[test]
fn a_prepare_panic_is_typed_and_leaves_no_residue_before_a_valid_mount() {
    const ID: &str = "com.acme.panicking-prepare";
    const VALID: &str = "test.valid-after-prepare-panic";
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let error = registry
        .mount(&PanickingPrepareBundle(ID), &mut ws)
        .expect_err("a preparation panic must become a mount error");

    assert!(
        matches!(
            error,
            BundleError::Preparation { ref id, ref error }
                if id == ID && error.contains("deterministic preparation panic")
        ),
        "preparation must retain its typed root cause: {error}"
    );
    assert!(ws.plugins().is_empty(), "declaration must be withdrawn");
    assert!(ws.commands().is_empty(), "providers must not remain");
    assert!(registry.ids().is_empty(), "nothing may be mounted");
    let key = permission_key(ID, permission::READ_VAULT);
    let entries = match ws
        .query_index(IndexQuery::Settings {
            plugin: Some(ID.to_string()),
        })
        .expect("settings query")
    {
        IndexResult::Settings(entries) => entries,
        other => panic!("settings query answered off-topic: {other:?}"),
    };
    assert!(
        entries.into_iter().all(|entry| entry.spec.key != key),
        "the default-deny created before prepare must be rolled back"
    );

    registry
        .mount(&BundleSpy::new(VALID, &journal), &mut ws)
        .expect("the registry and workspace remain reusable");
    assert_eq!(registry.ids(), vec![VALID]);
    let errors = registry.close(&mut ws);
    assert!(
        errors.is_empty(),
        "valid bundle teardown failed: {errors:?}"
    );
    assert!(ws.is_closed());
    assert!(ws.plugins().is_empty());
    assert!(registry.ids().is_empty());
    assert!(lines(&journal)
        .iter()
        .any(|line| line.contains("stopping (host=true, provider=true)")));
}

#[test]
fn who_stops_has_again_the_host_and_the_own_provider() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpy::new("test.one", &journal);
    registry.mount(&bundle, &mut ws).expect("mounts");
    assert_eq!(registry.ids(), vec!["test.one"]);
    assert!(registry
        .body("test.one")
        .is_some_and(|plugin| plugin.manifest().id == "test.one"));

    let errors = registry.unmount(&mut ws, "test.one");
    assert!(errors.is_empty(), "nothing went wrong: {errors:?}");
    assert_eq!(
        lines(&journal),
        vec![
            "test.one: activating".to_string(),
            "test.one: stopping (host=true, provider=true)".to_string(),
        ]
    );
    assert!(ws.plugins().is_empty() && ws.commands().is_empty());
    assert!(registry.body("test.one").is_none());
}

#[test]
fn closing_stops_bundles_in_reverse_while_they_are_still_intact() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    ws.register_core_feature("test.manual", "Manual")
        .expect("declared");
    for id in ["test.one", "test.two"] {
        let bundle = BundleSpy::new(id, &journal);
        registry.mount(&bundle, &mut ws).expect("mounts");
    }
    journal.lock().unwrap().clear();

    let errors = registry.close(&mut ws);
    assert!(errors.is_empty(), "nothing went wrong: {errors:?}");
    assert_eq!(
        lines(&journal),
        vec![
            "test.one: vault closing".to_string(),
            "test.two: vault closing".to_string(),
            "test.two: stopping (host=true, provider=true)".to_string(),
            "test.one: stopping (host=true, provider=true)".to_string(),
        ]
    );
    assert!(ws.is_closed());
    assert!(ws.plugins().is_empty());
    assert!(registry.ids().is_empty());
}

#[test]
fn external_permissions_are_opt_in_and_the_approval_is_machine_local() {
    let mut ws = vault();
    let mut registry = BundleRegistry::new();
    registry.remember(Arc::new(PermissionBundle));
    registry
        .enable(&mut ws, PermissionBundle::ID)
        .expect("the bundle mounts without receiving the requested capability");

    let key = permission_key(PermissionBundle::ID, permission::READ_VAULT);
    let entry = match ws
        .query_index(IndexQuery::Settings {
            plugin: Some(PermissionBundle::ID.to_string()),
        })
        .expect("settings query")
    {
        IndexResult::Settings(entries) => entries
            .into_iter()
            .find(|entry| entry.spec.key == key)
            .expect("permission setting"),
        other => panic!("settings query answered off-topic: {other:?}"),
    };
    assert_eq!(entry.spec.scope, SettingScope::Machine);
    assert_eq!(entry.source, SettingSource::Machine);
    assert_eq!(entry.value, SettingValue::Toggle(false));

    ws.with_host(PermissionBundle::ID, |host| {
        assert!(matches!(
            host.list_documents(None),
            Err(PluginError::PermissionDenied(_))
        ));
    });

    // Questo è l'opt-in: la persona davanti alla shell muove la chiave
    // sintetica. Il guard la rilegge subito, senza riavvio.
    ws.set_setting(&key, SettingValue::Toggle(true))
        .expect("the user grants the permission");
    ws.with_host(PermissionBundle::ID, |host| {
        host.list_documents(None)
            .expect("the explicitly approved read is available");
    });

    // Spegnere e riaccendere non trasforma l'approvazione in un nuovo default:
    // il valore di macchina resta una decisione esplicita e non viene riscritto
    // dal default-deny del montaggio successivo.
    assert!(registry.unmount(&mut ws, PermissionBundle::ID).is_empty());
    registry
        .enable(&mut ws, PermissionBundle::ID)
        .expect("remounts with the existing approval");
    let entry = match ws
        .query_index(IndexQuery::Settings {
            plugin: Some(PermissionBundle::ID.to_string()),
        })
        .expect("settings query")
    {
        IndexResult::Settings(entries) => entries
            .into_iter()
            .find(|entry| entry.spec.key == key)
            .expect("permission setting"),
        other => panic!("settings query answered off-topic: {other:?}"),
    };
    assert_eq!(entry.source, SettingSource::Machine);
    assert_eq!(entry.value, SettingValue::Toggle(true));
    ws.with_host(PermissionBundle::ID, |host| {
        host.list_documents(None)
            .expect("the machine-local approval survives the remount");
    });
}

#[test]
fn warnings_from_organization_are_forwarded_to_the_mount() {
    let config_dir = tempfile::tempdir().expect("tempdir");
    let config = camino::Utf8PathBuf::from_path_buf(config_dir.path().to_path_buf()).expect("utf8");
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("a note");
    std::fs::create_dir_all(root.join(".fub")).expect("the vault folder");
    std::fs::write(
        root.join(".fub").join("workspace.json"),
        "{ \"icons\": {,} }",
    )
    .expect("an unreadable sidecar");

    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_config_dir(&config);
    host.open(&root)
        .expect("a broken sidecar does not prevent opening");
    let ws = host.debug_workspace(None).expect("a vault is open");

    assert!(
        ws.read()
            .expect("the vault is not poisoned")
            .organization_warnings()
            .is_empty(),
        "mount must consume organization warnings"
    );

    let refuse = ws
        .read()
        .expect("the vault is not poisoned")
        .set_icon("Nota.md", Some("📌".into()))
        .expect_err("cannot write to what has not been read");
    assert!(
        refuse.contains("non lo sovrascrive"),
        "the sidecar was supposed to be unreadable: {refuse}"
    );
}

#[test]
fn a_bundle_that_loses_a_piece_is_rolled_back_entirely() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    registry.remember(Arc::new(
        BundleSpy::new("test.losing", &journal).that_leaves_back_a_piece(),
    ));
    let error = registry
        .enable(&mut ws, "test.losing")
        .expect_err("a partial registration must roll back the whole bundle");

    assert!(
        matches!(error, BundleError::Registration { .. }),
        "the fourth mount phase must report a registration failure: {error}"
    );
    assert!(
        registry.ids().is_empty(),
        "registry must own no partial bundle"
    );
    assert!(ws.plugins().is_empty(), "declaration must be withdrawn");
    assert!(
        ws.commands().is_empty(),
        "registered providers must be withdrawn"
    );
    assert_eq!(
        lines(&journal),
        vec![
            "test.losing: activating".to_string(),
            "test.losing: stopping (host=true, provider=true)".to_string(),
        ],
        "rollback deactivates while host and already-registered providers are alive"
    );
}

#[test]
fn dependency_order_does_not_depend_on_inventory_order() {
    const SERVICE: &str = "test.service";
    let mut ws = vault();
    let mut registry = BundleRegistry::new();

    // Deliberatamente al contrario: consumer prima, provider dopo.
    registry.remember(Arc::new(
        DependencyBundle::new("test.consumer").requiring(SERVICE),
    ));
    registry.remember(Arc::new(
        DependencyBundle::new("test.provider").providing(SERVICE),
    ));

    let failures = registry.enable_in_dependency_order(&mut ws, ["test.consumer", "test.provider"]);

    assert!(
        failures.is_empty(),
        "dependencies should resolve: {failures:?}"
    );
    assert_eq!(
        registry.ids(),
        vec!["test.provider", "test.consumer"],
        "the provider mounts first even though the inventory named it second"
    );
}

#[test]
fn a_whole_bundle_leaves_no_lines_in_the_log() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    registry.remember(Arc::new(BundleSpy::new("test.whole", &journal)));
    let (outcome, log) =
        fub_kernel::log::captured_default(|| registry.enable(&mut ws, "test.whole"));
    outcome.expect("mounts");

    assert!(
        !log.iter().any(|row| row.contains("test.whole")),
        "a complete mount has nothing to warn about: {log:?}"
    );
}

fn opens_with_startup_bundles(
    bundles: impl IntoIterator<Item = fub_host::StartupBundle>,
) -> (tempfile::TempDir, fub_host::Host) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("a note");
    let source: Arc<dyn fub_host::StartupSource> =
        Arc::new(bundles.into_iter().collect::<Vec<_>>());
    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_startup_source(source);
    host.open(&root).expect("startup bundles do not block open");
    (dir, host)
}

fn startup_inventory(host: &fub_host::Host) -> Vec<fub_host::BundleInfo> {
    host.with_session(None, |session| {
        session.bundles().read().expect("registry").inventory()
    })
    .expect("open session")
}

#[test]
fn requested_startup_bundle_is_mounted() {
    const ID: &str = "test.startup.requested";
    let journal: Journal = Arc::default();
    let (_dir, host) = opens_with_startup_bundles([fub_host::StartupBundle::new(
        Arc::new(BundleSpy::new(ID, &journal)),
        true,
        fub_host::BundleClaim::new(),
    )]);

    assert!(startup_inventory(&host)
        .iter()
        .any(|bundle| bundle.id == ID && bundle.mounted));
    assert_eq!(lines(&journal), vec![format!("{ID}: activating")]);

    let errors = host.close();
    assert!(errors.is_empty(), "startup teardown failed: {errors:?}");
}

#[test]
fn unrequested_startup_bundle_stays_known_and_unmounted() {
    const ID: &str = "test.startup.unrequested";
    let journal: Journal = Arc::default();
    let (_dir, host) = opens_with_startup_bundles([fub_host::StartupBundle::new(
        Arc::new(BundleSpy::new(ID, &journal)),
        false,
        fub_host::BundleClaim::new(),
    )]);

    assert!(startup_inventory(&host)
        .iter()
        .any(|bundle| bundle.id == ID && !bundle.mounted));
    assert!(lines(&journal).is_empty());

    let errors = host.close();
    assert!(errors.is_empty(), "startup teardown failed: {errors:?}");
    assert!(lines(&journal).is_empty());
}

#[test]
fn broken_unrequested_neighbor_does_not_block_requested_bundle() {
    const BROKEN: &str = "test.startup.broken-neighbor";
    const REQUESTED: &str = "test.startup.valid-neighbor";
    let broken: Journal = Arc::default();
    let requested: Journal = Arc::default();
    let (_dir, host) = opens_with_startup_bundles([
        fub_host::StartupBundle::new(
            Arc::new(BundleSpy::new(BROKEN, &broken).that_not_is_activates()),
            false,
            fub_host::BundleClaim::new(),
        ),
        fub_host::StartupBundle::new(
            Arc::new(BundleSpy::new(REQUESTED, &requested)),
            true,
            fub_host::BundleClaim::new(),
        ),
    ]);

    let inventory = startup_inventory(&host);
    assert!(inventory
        .iter()
        .any(|bundle| bundle.id == BROKEN && !bundle.mounted));
    assert!(inventory
        .iter()
        .any(|bundle| bundle.id == REQUESTED && bundle.mounted));
    assert!(lines(&broken).is_empty());
    assert_eq!(lines(&requested), vec![format!("{REQUESTED}: activating")]);

    let errors = host.close();
    assert!(
        errors.is_empty(),
        "requested neighbor teardown failed: {errors:?}"
    );
}

#[test]
fn startup_collisions_keep_official_and_first_claims() {
    const CLAIMED: &str = "test.startup.claimed";
    let official_impostor: Journal = Arc::default();
    let first: Journal = Arc::default();
    let second: Journal = Arc::default();
    let (_dir, host) = opens_with_startup_bundles([
        fub_host::StartupBundle::new(
            Arc::new(BundleSpy::new(fub_host::CORE_ID, &official_impostor)),
            true,
            fub_host::BundleClaim::new(),
        ),
        fub_host::StartupBundle::new(
            Arc::new(BundleSpy::new(CLAIMED, &first)),
            true,
            fub_host::BundleClaim::new(),
        ),
        fub_host::StartupBundle::new(
            Arc::new(BundleSpy::new(CLAIMED, &second)),
            true,
            fub_host::BundleClaim::new(),
        ),
    ]);

    let inventory = startup_inventory(&host);
    assert!(inventory
        .iter()
        .any(|bundle| bundle.id == fub_host::CORE_ID && bundle.mounted));
    assert_eq!(
        inventory
            .iter()
            .filter(|bundle| bundle.id == CLAIMED)
            .count(),
        1
    );
    assert!(inventory
        .iter()
        .any(|bundle| bundle.id == CLAIMED && bundle.mounted));
    assert!(lines(&official_impostor).is_empty());
    assert_eq!(lines(&first), vec![format!("{CLAIMED}: activating")]);
    assert!(lines(&second).is_empty());

    let errors = host.close();
    assert!(
        errors.is_empty(),
        "winning claim teardown failed: {errors:?}"
    );
    assert!(lines(&official_impostor).is_empty());
    assert!(lines(&second).is_empty());
}

struct BlockingStartupSource {
    calls: AtomicUsize,
    validity: Arc<fub_host::StartupValidity>,
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
    bundle: Arc<dyn Bundle>,
    claim: fub_host::BundleClaim,
}

impl fub_host::StartupSource for BlockingStartupSource {
    fn prepare(&self) -> Result<fub_host::StartupSnapshot, PluginError> {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            return Ok(fub_host::StartupSnapshot::new(Vec::new()));
        }
        let lease = self.validity.acquire()?;
        self.entered.send(()).expect("the opening is observed");
        self.release
            .lock()
            .expect("release channel")
            .recv()
            .expect("the opening is released");
        Ok(fub_host::StartupSnapshot {
            bundles: vec![fub_host::StartupBundle::new(
                Arc::clone(&self.bundle),
                true,
                self.claim.clone(),
            )],
            formats: fub_host::PreparedFormatSource::empty(),
            diagnostics: Vec::new(),
            validity: Some(Arc::clone(&self.validity)),
            lease: Some(lease),
        })
    }
}

struct CancelledStartupSource;

impl fub_host::StartupSource for CancelledStartupSource {
    fn prepare(&self) -> Result<fub_host::StartupSnapshot, PluginError> {
        Err(PluginError::Cancelled("startup cancelled".into()))
    }
}

struct DiagnosticStartupSource;

impl fub_host::StartupSource for DiagnosticStartupSource {
    fn prepare(&self) -> Result<fub_host::StartupSnapshot, PluginError> {
        Ok(fub_host::StartupSnapshot {
            bundles: Vec::new(),
            formats: fub_host::PreparedFormatSource::empty(),
            diagnostics: vec![PluginError::Io("diagnostic".into())],
            validity: None,
            lease: None,
        })
    }
}
struct StartupFormatSource {
    signalled: Arc<AtomicUsize>,
}

impl fub_host::StartupSource for StartupFormatSource {
    fn prepare(&self) -> Result<fub_host::StartupSnapshot, PluginError> {
        Ok(fub_host::StartupSnapshot {
            bundles: Vec::new(),
            formats: fub_host::PreparedFormatSource::from_provider(MarkdownProvider::boxed())
                .retain(PanicOnDrop)
                .retain(SignalOnDrop(Arc::clone(&self.signalled))),
            diagnostics: Vec::new(),
            validity: None,
            lease: None,
        })
    }
}

#[test]
fn independent_format_error_cleans_startup_formats_before_returning() {
    let (_dir, root) = test_root();
    let signalled = Arc::new(AtomicUsize::new(0));
    let expected = PluginError::Io("independent format failure".into());
    let independent_error = expected.clone();
    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_startup_source(Arc::new(StartupFormatSource {
            signalled: Arc::clone(&signalled),
        }))
        .with_format_source(Arc::new(move || Err(independent_error.clone())));

    let error = match host.open(&root) {
        Err(error) => error,
        Ok(_) => panic!("independent source fails"),
    };
    assert_eq!(error, expected);
    assert_eq!(
        signalled.load(Ordering::SeqCst),
        1,
        "cleanup continues after a prepared resource destructor panics"
    );
    assert!(host.vaults().is_empty(), "failed open publishes no session");
}

struct PanicOnDrop;

impl Drop for PanicOnDrop {
    fn drop(&mut self) {
        panic!("injected retained resource drop panic");
    }
}

struct SignalOnDrop(Arc<AtomicUsize>);

impl Drop for SignalOnDrop {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

fn test_root() -> (tempfile::TempDir, camino::Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("a note");
    (dir, root)
}

#[test]
fn cancelled_startup_source_never_publishes() {
    let (_dir, root) = test_root();
    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_startup_source(Arc::new(CancelledStartupSource));

    assert!(matches!(
        host.open(&root),
        Err(PluginError::Cancelled(message)) if message == "startup cancelled"
    ));
    assert!(host.vaults().is_empty());
}

#[test]
fn startup_diagnostics_are_queryable_as_typed_errors() {
    let (_dir, root) = test_root();
    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_startup_source(Arc::new(DiagnosticStartupSource));
    host.open(&root)
        .expect("diagnostic source does not block open");

    let diagnostics = host.startup_diagnostics(None).expect("open session");
    assert!(matches!(
        diagnostics.as_slice(),
        [PluginError::Io(message)] if *message == "diagnostic"
    ));
    assert!(host.close().is_empty());
}

#[test]
fn retained_resource_drop_panic_does_not_stop_later_resources_or_close() {
    let (_dir, root) = test_root();
    let signalled = Arc::new(AtomicUsize::new(0));
    let later = Arc::clone(&signalled);
    let source: Arc<dyn fub_host::FormatSource> = Arc::new(move || {
        Ok(fub_host::PreparedFormatSource::empty()
            .retain(PanicOnDrop)
            .retain(SignalOnDrop(Arc::clone(&later))))
    });
    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_format_source(source);
    host.open(&root).expect("format source opens");

    let errors = host.close();
    assert_eq!(signalled.load(Ordering::SeqCst), 1);
    assert!(
        errors
            .iter()
            .any(|error| matches!(error, PluginError::Internal(message)
                if message.to_string().contains("retained format resource"))),
        "drop panic must be reported while close continues: {errors:?}"
    );
}

#[test]
fn mount_failure_preserves_primary_error_and_drops_later_resources() {
    let (_dir, root) = test_root();
    let signalled = Arc::new(AtomicUsize::new(0));
    let later = Arc::clone(&signalled);
    let source: Arc<dyn fub_host::FormatSource> = Arc::new(move || {
        Ok(fub_host::PreparedFormatSource::empty()
            .retain(PanicOnDrop)
            .retain(SignalOnDrop(Arc::clone(&later))))
    });
    // La radice, per il supporto del vault, è un file: il kernel rifiuta di
    // montarla dopo che le risorse dei formati sono già state preparate.
    let memory = Arc::new(fub_kernel::MemStorage::new());
    fub_kernel::storage::VaultStorage::write(&*memory, &root, b"not a folder")
        .expect("the root is a file in memory");
    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_storage(Arc::new(SharedMemory(memory)))
        .with_format_source(source);

    let error = match host.open(&root) {
        Err(error) => error,
        Ok(_) => panic!("a root that is not a folder fails the mount"),
    };
    assert!(
        matches!(&error, PluginError::Internal(message)
            if message.to_string().contains("not a directory")),
        "the primary mount error must remain visible: {error}"
    );
    assert!(
        error.to_string().contains("disposal failed"),
        "the drop panic is reported after the primary error: {error}"
    );
    assert_eq!(signalled.load(Ordering::SeqCst), 1);
    assert!(host.vaults().is_empty());
}

/// Lo stesso supporto in memoria a ogni apertura.
struct SharedMemory(Arc<fub_kernel::MemStorage>);

impl fub_host::mount::VaultStorageSource for SharedMemory {
    fn open(
        &self,
        _root: &camino::Utf8Path,
    ) -> std::io::Result<Arc<dyn fub_kernel::storage::VaultStorage>> {
        Ok(Arc::clone(&self.0) as Arc<dyn fub_kernel::storage::VaultStorage>)
    }
}

#[test]
fn invalidation_waits_for_the_old_opening_lease_and_stale_publication_rolls_back() {
    const ID: &str = "test.startup.stale";
    let stable_dir = tempfile::tempdir().expect("stable tempdir");
    let stable_root =
        camino::Utf8PathBuf::from_path_buf(stable_dir.path().to_path_buf()).expect("utf8");
    std::fs::write(stable_root.join("Nota.md"), "# Stable\n").expect("a stable note");
    let dir = tempfile::tempdir().expect("stale tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Stale\n").expect("a stale note");
    let journal: Journal = Arc::default();
    let validity = Arc::new(fub_host::StartupValidity::new());
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let source: Arc<dyn fub_host::StartupSource> = Arc::new(BlockingStartupSource {
        calls: AtomicUsize::new(0),
        validity: Arc::clone(&validity),
        entered: entered_tx,
        release: Mutex::new(release_rx),
        bundle: Arc::new(BundleSpy::new(ID, &journal)),
        claim: fub_host::BundleClaim::new(),
    });
    let host = Arc::new(
        fub_host::Host::new()
            .with_watcher(Box::new(fub_host::NoWatcher))
            .with_startup_source(source),
    );
    host.open(&stable_root).expect("open stable vault");
    let opening_host = Arc::clone(&host);
    let opening = std::thread::spawn(move || opening_host.open(&root));
    entered_rx.recv().expect("snapshot lease is held");

    validity.revoke().expect("revocation marks startup invalid");
    assert!(
        matches!(validity.acquire(), Err(PluginError::Conflict(_))),
        "revocation rejects a new opening while the old lease remains"
    );
    let draining = Arc::clone(&validity);
    let drain = std::thread::spawn(move || draining.drain());
    std::thread::yield_now();
    assert!(
        !drain.is_finished(),
        "draining cannot finish while the old opening owns its lease"
    );
    assert!(
        !host
            .bundles(Some(stable_root.as_str()))
            .expect("the existing workspace remains available")
            .is_empty(),
        "lease draining does not hold workspace, registry or sessions custody"
    );

    release_tx.send(()).expect("release old prepare");
    let outcome = opening.join().expect("opening thread does not panic");
    assert!(
        matches!(outcome, Err(PluginError::Conflict(_))),
        "the invalid snapshot must not publish: {:?}",
        outcome.err()
    );
    drain.join().expect("draining thread does not panic");
    assert_eq!(
        host.vaults().len(),
        1,
        "only the previously published session remains"
    );
    assert_eq!(
        lines(&journal),
        vec![
            format!("{ID}: activating"),
            format!("{ID}: vault closing"),
            format!("{ID}: stopping (host=true, provider=true)"),
        ],
        "shutdown drains only after the old opening completed teardown"
    );
    assert!(host.close().is_empty());
}

#[test]
fn runtime_claims_cannot_replace_or_be_mutated_through_another_identity() {
    const ID: &str = "test.runtime.claimed";
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("a note");
    let host = fub_host::Host::new().with_watcher(Box::new(fub_host::NoWatcher));
    host.open(&root).expect("open vault");
    let journal: Journal = Arc::default();
    let owner = fub_host::BundleClaim::new();
    let other = fub_host::BundleClaim::new();

    host.remember_claimed_bundle(None, Arc::new(BundleSpy::new(ID, &journal)), &owner)
        .expect("owner remembers its runtime bundle");
    host.remember_claimed_bundle(
        None,
        Arc::new(BundleSpy::new(ID, &Journal::default())),
        &owner,
    )
    .expect("the same claim is already-known success");
    assert!(host.bundle_is_owned(None, ID, &owner).unwrap());
    assert!(!host.bundle_is_owned(None, ID, &other).unwrap());
    assert!(matches!(
        host.remember_claimed_bundle(
            None,
            Arc::new(BundleSpy::new(ID, &Journal::default())),
            &other,
        ),
        Err(PluginError::AlreadyExists(_))
    ));
    assert!(matches!(
        host.set_bundle_active(None, ID, &other, true),
        Err(PluginError::AlreadyExists(_))
    ));
    assert!(host
        .set_bundle_active(None, ID, &other, false)
        .expect("another claim has no owned instance")
        .is_empty());

    host.set_bundle_active(None, ID, &owner, true)
        .expect("owner mounts");
    assert!(host.is_bundle_active(None, ID, &owner).unwrap());
    assert!(matches!(
        host.set_plugin_enabled(None, ID, false),
        Err(PluginError::BadArgs(_))
    ));
    assert!(
        host.is_bundle_active(None, ID, &owner).unwrap(),
        "the native preference path cannot bypass source ownership"
    );
    assert!(matches!(
        host.forget_bundle(None, ID, &owner),
        Err(PluginError::Conflict(_))
    ));
    host.set_bundle_active(None, ID, &owner, false)
        .expect("owner unmounts");
    assert!(matches!(
        host.forget_bundle(None, ID, &other),
        Err(PluginError::AlreadyExists(_))
    ));
    host.forget_bundle(None, ID, &owner)
        .expect("owner forgets its unmounted bundle");
    assert!(!host.bundle_is_owned(None, ID, &owner).unwrap());

    let collision = fub_host::BundleClaim::new();
    assert!(matches!(
        host.remember_claimed_bundle(
            None,
            Arc::new(BundleSpy::new("fub.stats", &Journal::default())),
            &collision,
        ),
        Err(PluginError::AlreadyExists(_))
    ));
    assert!(host
        .set_plugin_enabled(None, "fub.stats", false)
        .expect("an unclaimed official keeps its native toggle")
        .is_empty());
    host.set_plugin_enabled(None, "fub.stats", true)
        .expect("restore official feature");
    assert!(host.close().is_empty());
}
