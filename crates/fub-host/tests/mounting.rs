//! Presidi del lifecycle dei bundle: ABI, attivazione, registrazione atomica,
//! dipendenze, permessi e teardown.

use std::sync::{Arc, Mutex};

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
use fub_host::registry::{Bundle, BundleError, BundleRegistry, OnlyProviders};
use fub_kernel::{Trust, Workspace};
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

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        let mut failures = Vec::new();
        if let Err(error) =
            ws.register_command_provider(self.id, Box::new(GreetingProvider(self.id)))
        {
            failures.push(format!("command: {error}"));
        }
        if let Err(error) = ws.register_event_handler(
            self.id,
            Box::new(EventRecorder {
                id: self.id,
                journal: self.journal.clone(),
            }),
        ) {
            failures.push(format!("handler: {error}"));
        }
        if self.loses_a_piece {
            if let Err(error) =
                ws.register_command_provider(self.id, Box::new(GreetingProvider(self.id)))
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

    fn register(&self, _ws: &mut Workspace) -> Vec<String> {
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

    fn register(&self, _ws: &mut Workspace) -> Vec<String> {
        Vec::new()
    }
}

#[test]
fn a_bundle_that_speaks_a_other_contract_not_is_mounts() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpy::new("test.future", &journal).speaking("0.2.0");
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
