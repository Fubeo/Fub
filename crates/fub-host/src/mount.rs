//! Composition root del workspace: qui esiste una sola tabella di bundle per
//! app, CLI ed headless.
//!
//! Ogni provider ha lo stesso proprietario dichiarato dal registry. Core,
//! manutenzione e trasferimento Markdown sono quindi bundle distinti; le
//! dipendenze fra feature sono manifest, non ordine accidentale dell'inventario.

use std::sync::Arc;

#[cfg(feature = "versioning")]
use crate::custody::Custody;
use camino::Utf8Path;
use fub_abi::settings::SettingSpec;
use fub_abi::text::StringCatalog;
use fub_abi::traits::{Plugin, PluginManifest};
#[cfg(feature = "blocks")]
use fub_features::{
    DiagramRenderer, DiagramRule, HighlightRule, MathRenderer, MathRule, BLOCKS_ID,
};
#[cfg(feature = "search")]
use fub_features::{SearchIndex, SEARCH_ID};
#[cfg(feature = "versioning")]
use fub_features::{VersionStore, VersioningHandler, VERSIONING_ID};
use fub_format_markdown::{MarkdownExport, MarkdownImport, MarkdownProvider};
#[cfg(feature = "search")]
use fub_kernel::RegistryError;
use fub_kernel::{FormatRegistry, MachineSettings, SystemLocale, Trust, ViewStates, Workspace};

use crate::registry::{Bundle, BundleRegistry, OnlyProviders, Registrar};
#[cfg(feature = "versioning")]
use crate::settings::versioning_settings;
use crate::settings::{
    catalog_assembled, core_catalog_assembled, core_settings, disabled_plugins, CORE_ID,
};

const MARKDOWN_ID: &str = "fub.markdown";
const COMMANDS_SERVICE: &str = "fub.commands";
const TRASH_ID: &str = "fub.trash";

pub struct Mounted {
    pub workspace: Workspace,
    pub registry: BundleRegistry,
    #[cfg(feature = "versioning")]
    pub versions: Option<VersionStore>,
}

fn assemble_after_registry<T>(
    workspace: &mut Workspace,
    registry: &mut BundleRegistry,
    assemble: impl FnOnce(&mut Workspace, &mut BundleRegistry) -> Result<T, String>,
) -> Result<T, String> {
    match assemble(workspace, registry) {
        Ok(assembled) => Ok(assembled),
        Err(error) => {
            for cleanup in registry.close(workspace) {
                tracing::error!(
                    target: "fub.host",
                    "partial mount rollback failed: {cleanup}"
                );
            }
            Err(error)
        }
    }
}

/// Bundle nativo ufficiale: manifest core, provider posseduti dal kernel.
struct CoreBundle {
    id: &'static str,
    name: &'static str,
    settings: Vec<SettingSpec>,
    default_locale: &'static str,
    strings: Vec<StringCatalog>,
    provides: Vec<&'static str>,
    requires: Vec<&'static str>,
    #[allow(clippy::type_complexity)]
    register: Box<dyn Fn(&mut Registrar<'_>) -> Vec<String> + Send + Sync>,
}

impl CoreBundle {
    fn new(
        id: &'static str,
        name: &'static str,
        register: impl Fn(&mut Registrar<'_>) -> Vec<String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            id,
            name,
            settings: Vec::new(),
            default_locale: "",
            strings: Vec::new(),
            provides: Vec::new(),
            requires: Vec::new(),
            register: Box::new(register),
        }
    }

    fn configuring(mut self, settings: Vec<SettingSpec>) -> Self {
        self.settings = settings;
        self
    }

    fn speaking(mut self, default_locale: &'static str, strings: Vec<StringCatalog>) -> Self {
        self.default_locale = default_locale;
        self.strings = strings;
        self
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

impl Bundle for CoreBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.name)
            .configuring(self.settings.clone())
            .speaking(self.default_locale, self.strings.clone())
            .providing(&self.provides)
            .requiring(&self.requires)
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        (self.register)(registrar)
    }
}

pub fn mount(
    root: &Utf8Path,
    machine: Arc<MachineSettings>,
    view_states: Arc<ViewStates>,
    system_locale: Arc<SystemLocale>,
    levels: &fub_kernel::log::Levels,
) -> Result<Mounted, String> {
    let mut formats = FormatRegistry::new();
    formats
        .register(MarkdownProvider::boxed())
        .map_err(|error| format!("format provider conflict: {error}"))?;

    let mut ws = Workspace::with_machine_settings(root, formats, machine)
        .map_err(|error| error.to_string())?
        .with_view_states(view_states)
        .with_system_locale(system_locale);

    #[cfg(feature = "http-client")]
    ws.set_network(Arc::new(crate::net::UreqNetwork::new()));

    #[cfg(feature = "versioning")]
    let store: Custody<Option<VersionStore>> = Custody::empty("the version store");

    // I primi tre sono infrastruttura dell'host e non sono spegnibili. Prima
    // erano provider di maintenance/markdown registrati dall'interno di
    // `fub.core`: il kernel vedeva un owner diverso da quello che il registry
    // poteva smontare, quindi rollback e unmount non potevano essere atomici.
    let mut bundles: Vec<Arc<dyn Bundle>> = vec![
        Arc::new(
            CoreBundle::new(CORE_ID, "Fub", |_| Vec::new())
                .configuring(core_settings())
                .speaking(
                    crate::settings::CORE_DEFAULT_LOCALE,
                    core_catalog_assembled(),
                ),
        ),
        Arc::new(CoreBundle::new(
            fub_kernel::maintenance::MAINTENANCE_ID,
            "Maintenance",
            register_maintenance,
        )),
        Arc::new(CoreBundle::new(
            MARKDOWN_ID,
            "Markdown",
            register_markdown_transfer,
        )),
        Arc::new(crate::theme::ThemeBundle::series()),
    ];

    for feature in fub_features::every_official_feature() {
        #[allow(unused_mut)]
        let mut irregular: Option<CoreBundle> = None;

        #[cfg(feature = "search")]
        if feature.id == SEARCH_ID {
            irregular = Some(
                CoreBundle::new(feature.id, feature.name, register_search)
                    .configuring(fub_features::search::settings()),
            );
        }

        #[cfg(feature = "versioning")]
        if feature.id == VERSIONING_ID {
            let store = store.clone();
            let view = feature.view;
            let commands = feature.commands;
            irregular = Some(
                CoreBundle::new(feature.id, feature.name, move |registrar| {
                    register_versioning(registrar, &store, view, commands)
                })
                .configuring(versioning_settings()),
            );
        }

        #[cfg(feature = "blocks")]
        if feature.id == BLOCKS_ID {
            irregular = Some(CoreBundle::new(feature.id, feature.name, register_blocks));
        }

        let bundle = if let Some(bundle) = irregular {
            bundle
        } else if feature.view.is_some() || feature.commands.is_some() {
            let view = feature.view;
            let commands = feature.commands;
            let id = feature.id;
            CoreBundle::new(id, feature.name, move |registrar| {
                let mut failures = Vec::new();
                if let Some(build) = view {
                    failures.extend(register_view(registrar, build()));
                }
                if let Some(build) = commands {
                    failures.extend(register_commands(registrar, build()));
                }
                failures
            })
        } else {
            return Err(format!(
                "feature '{}' is in the inventory but the mount table does not know what it registers",
                feature.id
            ));
        };

        let mut bundle = bundle.speaking("it", catalog_assembled(feature.id, (feature.catalog)()));
        // `fub.trash` invoca `trash.restore`/`trash.empty`, che appartengono al
        // bundle dei comandi. Il service marker è una dipendenza di montaggio:
        // il provider vero resta il registro comandi e l'atomicità garantisce
        // che il marker non sopravviva a una registrazione fallita.
        if feature.id == COMMANDS_SERVICE {
            bundle = bundle.providing(COMMANDS_SERVICE);
        }
        if feature.id == TRASH_ID {
            bundle = bundle.requiring(COMMANDS_SERVICE);
        }
        bundles.push(Arc::new(bundle));
    }

    let mut registry = BundleRegistry::new();
    for bundle in &bundles {
        registry.remember(Arc::clone(bundle));
    }

    let versions = assemble_after_registry(&mut ws, &mut registry, |ws, registry| {
        // Il core deve esistere prima di leggere `plugins.disabled` e i livelli.
        registry
            .enable(ws, CORE_ID)
            .map_err(|error| format!("core bundle won't mount: {error}"))?;
        crate::settings::apply_log_levels(ws, levels);

        // Questi provider sono infrastruttura sempre disponibile: in particolare i
        // comandi di manutenzione non possono sparire proprio nel vault da riparare.
        for id in [fub_kernel::maintenance::MAINTENANCE_ID, MARKDOWN_ID] {
            registry
                .enable(ws, id)
                .map_err(|error| format!("mandatory bundle `{id}` won't mount: {error}"))?;
        }

        let disabled = disabled_plugins(ws);
        let selected = bundles
            .iter()
            .map(|bundle| bundle.manifest().id)
            .filter(|id| {
                id != CORE_ID
                    && id != fub_kernel::maintenance::MAINTENANCE_ID
                    && id != MARKDOWN_ID
                    && !disabled.contains(id)
            })
            .collect::<Vec<_>>();

        for (id, error) in registry.enable_in_dependency_order(ws, selected) {
            tracing::error!(target: "fub.host", "bundle `{id}` not mounted: {error}");
        }

        for warning in ws.settings_warnings() {
            tracing::warn!(target: "fub.host", "settings: {warning}");
        }
        for warning in ws.organization_warnings() {
            tracing::warn!(target: "fub.host", "organization: {warning}");
        }
        for warning in ws.doc_data_warnings() {
            tracing::warn!(target: "fub.host", "per-document state: {warning}");
        }
        for kind in ws.undrawn_kinds() {
            tracing::warn!(target: "fub.host", "`{kind}` has no renderer: will degrade to generic rendering");
        }

        #[cfg(feature = "versioning")]
        {
            store
                .read()
                .map_err(|error| error.to_string())
                .map(|slot| slot.clone())
        }
        #[cfg(not(feature = "versioning"))]
        {
            Ok(())
        }
    })?;
    #[cfg(not(feature = "versioning"))]
    let () = versions;

    Ok(Mounted {
        workspace: ws,
        registry,
        #[cfg(feature = "versioning")]
        versions,
    })
}

#[cfg(feature = "search")]
fn register_search(registrar: &mut Registrar<'_>) -> Vec<String> {
    let index = match registrar.search_data_dir().and_then(|dir| {
        SearchIndex::open(&dir)
            .map_err(|error| fub_abi::PluginError::Internal(error.to_string().into()))
    }) {
        Ok(index) => index,
        Err(error) => return vec![format!("search index unavailable: {error}")],
    };
    let settings = index.settings_handler();
    match registrar.register_index_provider(Box::new(index)) {
        Ok(()) => match registrar.register_event_handler(Box::new(settings)) {
            Ok(()) => Vec::new(),
            Err(error) => vec![format!(
                "search index: field weights will not update while vault is open: {error}"
            )],
        },
        // L'indice è registrato ma ha perso le impronte: reindex lo ricostruisce.
        // È l'unico degrado esplicitamente recuperabile del mount nativo.
        Err(RegistryError::Activate(error)) => {
            tracing::warn!(target: "fub.host", "{SEARCH_ID}: footprints not found, reindexing: {error}");
            Vec::new()
        }
        Err(error) => vec![format!("search index NOT registered: {error}")],
    }
}

#[cfg(feature = "versioning")]
fn register_versioning(
    registrar: &mut Registrar<'_>,
    external_store: &Custody<Option<VersionStore>>,
    view: Option<fn() -> Box<dyn fub_abi::ViewProvider>>,
    commands: Option<fn() -> Box<dyn fub_abi::traits::CommandProvider>>,
) -> Vec<String> {
    if !matches!(
        registrar.setting(crate::settings::VERSIONING_ENABLED),
        Ok(fub_abi::settings::SettingValue::Toggle(true))
    ) {
        return Vec::new();
    }

    let opened = match registrar.with_host(VersionStore::open) {
        Ok(opened) => opened,
        Err(error) => return vec![format!("versioning unavailable: {error}")],
    };
    let hook_store = opened.clone();
    if let Err(error) =
        registrar.register_event_handler(Box::new(VersioningHandler::new(opened.clone())))
    {
        return vec![format!("versioning not registered: {error}")];
    }
    if let Err(error) = registrar.set_before_write_hook(Arc::new(move |host, id| {
        VersioningHandler::new(hook_store.clone()).photograph_if_unversioned(host, id)
    })) {
        return vec![format!("versioning hook not registered: {error}")];
    }

    let mut failures = Vec::new();
    if let Some(build) = view {
        failures.extend(register_view(registrar, build()));
    }
    if let Some(build) = commands {
        failures.extend(register_commands(registrar, build()));
    }
    if !failures.is_empty() {
        return failures;
    }

    // La metà esterna viene pubblicata solo quando tutti i provider sono
    // entrati: un rollback non lascia un `VersionStore` che finga un bundle vivo.
    match external_store.write() {
        Ok(mut slot) => {
            *slot = Some(opened);
            Vec::new()
        }
        Err(error) => vec![format!("versioning not composed: {error}")],
    }
}

fn register_view(
    registrar: &mut Registrar<'_>,
    provider: Box<dyn fub_abi::ViewProvider>,
) -> Vec<String> {
    match registrar.register_view_provider(provider) {
        Ok(()) => Vec::new(),
        Err(error) => vec![format!("view not registered: {error}")],
    }
}

fn register_maintenance(registrar: &mut Registrar<'_>) -> Vec<String> {
    register_commands(registrar, Box::new(fub_kernel::maintenance::Maintenance))
}

fn register_markdown_transfer(registrar: &mut Registrar<'_>) -> Vec<String> {
    let mut failures = Vec::new();
    if let Err(error) = registrar.register_import_provider(MarkdownImport::boxed()) {
        failures.push(format!("markdown import not registered: {error}"));
    }
    if let Err(error) = registrar.register_export_provider(MarkdownExport::boxed()) {
        failures.push(format!("markdown export not registered: {error}"));
    }
    failures
}

fn register_commands(
    registrar: &mut Registrar<'_>,
    provider: Box<dyn fub_abi::traits::CommandProvider>,
) -> Vec<String> {
    match registrar.register_command_provider(provider) {
        Ok(()) => Vec::new(),
        Err(error) => vec![format!("commands not registered: {error}")],
    }
}

#[cfg(feature = "blocks")]
fn register_blocks(registrar: &mut Registrar<'_>) -> Vec<String> {
    let mut failures = Vec::new();
    for rule in [
        Box::new(DiagramRule) as Box<dyn fub_abi::custom::SyntaxRule>,
        Box::new(MathRule),
        Box::new(HighlightRule),
    ] {
        if let Err(error) = registrar.register_syntax_rule(rule) {
            failures.push(format!("syntax rule not grafted: {error}"));
        }
    }
    for renderer in [
        Box::new(DiagramRenderer) as Box<dyn fub_abi::custom::CustomRenderer>,
        Box::new(MathRenderer),
    ] {
        if let Err(error) = registrar.register_custom_renderer(renderer) {
            failures.push(format!("renderer not registered: {error}"));
        }
    }
    failures
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
    use fub_abi::traits::{CommandProvider, HostApi};
    use fub_abi::PluginError;

    use super::*;

    const FIRST: &str = "test.mount-first";
    const SECOND: &str = "test.mount-second";
    const ROOT_ERROR: &str = "the mandatory bundle did not mount";

    #[derive(Default)]
    struct Lifecycle {
        activated: AtomicUsize,
        deactivated: AtomicUsize,
    }

    struct ProbePlugin {
        id: &'static str,
        lifecycle: Arc<Lifecycle>,
        activation_fails: bool,
        deactivation_fails: bool,
    }

    impl Plugin for ProbePlugin {
        fn manifest(&self) -> PluginManifest {
            PluginManifest::core(self.id, self.id)
        }

        fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
            self.lifecycle.activated.fetch_add(1, Ordering::SeqCst);
            if self.activation_fails {
                Err(PluginError::Internal("activation failed".into()))
            } else {
                Ok(())
            }
        }

        fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
            self.lifecycle.deactivated.fetch_add(1, Ordering::SeqCst);
            if self.deactivation_fails {
                Err(PluginError::Internal("cleanup failed".into()))
            } else {
                Ok(())
            }
        }
    }

    struct ProbeCommands(&'static str);

    impl CommandProvider for ProbeCommands {
        fn commands(&self) -> Vec<CommandSpec> {
            vec![CommandSpec::new(format!("{}.command", self.0), "Probe")]
        }

        fn invoke(
            &self,
            _command: &str,
            _args: serde_json::Value,
            _mode: InvokeMode,
            _host: &mut dyn HostApi,
        ) -> Result<CommandOutcome, PluginError> {
            Ok(CommandOutcome::notify("called"))
        }
    }

    struct ProbeBundle {
        id: &'static str,
        lifecycle: Arc<Lifecycle>,
        activation_fails: bool,
        deactivation_fails: bool,
    }

    impl ProbeBundle {
        fn new(id: &'static str, lifecycle: Arc<Lifecycle>) -> Self {
            Self {
                id,
                lifecycle,
                activation_fails: false,
                deactivation_fails: false,
            }
        }

        fn failing_activation(mut self) -> Self {
            self.activation_fails = true;
            self
        }

        fn failing_deactivation(mut self) -> Self {
            self.deactivation_fails = true;
            self
        }
    }

    impl Bundle for ProbeBundle {
        fn manifest(&self) -> PluginManifest {
            PluginManifest::core(self.id, self.id)
        }

        fn trust(&self) -> Trust {
            Trust::Core
        }

        fn plugin(&self) -> Box<dyn Plugin> {
            Box::new(ProbePlugin {
                id: self.id,
                lifecycle: Arc::clone(&self.lifecycle),
                activation_fails: self.activation_fails,
                deactivation_fails: self.deactivation_fails,
            })
        }

        fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
            registrar
                .register_command_provider(Box::new(ProbeCommands(self.id)))
                .err()
                .map(|error| vec![error.to_string()])
                .unwrap_or_default()
        }
    }

    fn workspace() -> (tempfile::TempDir, Workspace) {
        let directory = tempfile::tempdir().expect("temporary vault");
        let root = camino::Utf8PathBuf::from_path_buf(directory.path().to_path_buf())
            .expect("temporary path is UTF-8");
        let mut formats = FormatRegistry::new();
        formats
            .register(MarkdownProvider::boxed())
            .expect("the Markdown format registers once");
        let workspace = Workspace::new(&root, formats).expect("temporary vault opens");
        (directory, workspace)
    }

    #[test]
    fn a_fatal_post_registry_error_rolls_back_every_prior_bundle_once() {
        let (_directory, mut workspace) = workspace();
        let first = Arc::new(Lifecycle::default());
        let second = Arc::new(Lifecycle::default());
        let mut registry = BundleRegistry::new();
        registry.remember(Arc::new(
            ProbeBundle::new(FIRST, Arc::clone(&first)).failing_deactivation(),
        ));
        registry.remember(Arc::new(
            ProbeBundle::new(SECOND, Arc::clone(&second)).failing_activation(),
        ));

        let error =
            assemble_after_registry(&mut workspace, &mut registry, |workspace, registry| {
                registry
                    .enable(workspace, FIRST)
                    .map_err(|error| error.to_string())?;
                registry
                    .enable(workspace, SECOND)
                    .map_err(|_| ROOT_ERROR.to_owned())
            })
            .expect_err("the later mandatory bundle fails");

        assert_eq!(error, ROOT_ERROR, "cleanup must not replace the root error");
        assert_eq!(first.activated.load(Ordering::SeqCst), 1);
        assert_eq!(first.deactivated.load(Ordering::SeqCst), 1);
        assert_eq!(second.activated.load(Ordering::SeqCst), 1);
        assert_eq!(second.deactivated.load(Ordering::SeqCst), 0);
        assert!(workspace.is_closed());
        assert!(
            workspace.plugins().is_empty(),
            "declarations survived rollback"
        );
        assert!(
            workspace.commands().is_empty(),
            "providers survived rollback"
        );
        assert!(registry.ids().is_empty(), "bundle bodies survived rollback");

        assert!(registry.close(&mut workspace).is_empty());
        assert_eq!(
            first.deactivated.load(Ordering::SeqCst),
            1,
            "a closed partial mount must not tear down twice"
        );
    }

    #[test]
    fn a_successful_post_registry_assembly_transfers_live_bundles_to_mounted_state() {
        let (_directory, mut workspace) = workspace();
        let first = Arc::new(Lifecycle::default());
        let second = Arc::new(Lifecycle::default());
        let mut registry = BundleRegistry::new();
        registry.remember(Arc::new(ProbeBundle::new(FIRST, Arc::clone(&first))));
        registry.remember(Arc::new(ProbeBundle::new(SECOND, Arc::clone(&second))));

        let assembled =
            assemble_after_registry(&mut workspace, &mut registry, |workspace, registry| {
                registry
                    .enable(workspace, FIRST)
                    .map_err(|error| error.to_string())?;
                registry
                    .enable(workspace, SECOND)
                    .map_err(|error| error.to_string())?;
                Ok(17)
            })
            .expect("both mandatory bundles mount");

        assert_eq!(assembled, 17);
        assert_eq!(first.deactivated.load(Ordering::SeqCst), 0);
        assert_eq!(second.deactivated.load(Ordering::SeqCst), 0);
        assert_eq!(workspace.plugins().len(), 2);
        assert_eq!(workspace.commands().len(), 2);
        assert_eq!(registry.ids(), vec![FIRST, SECOND]);

        assert!(
            registry.close(&mut workspace).is_empty(),
            "normal close succeeds"
        );
        assert_eq!(first.deactivated.load(Ordering::SeqCst), 1);
        assert_eq!(second.deactivated.load(Ordering::SeqCst), 1);
        assert!(workspace.plugins().is_empty());
        assert!(workspace.commands().is_empty());
        assert!(registry.ids().is_empty());
    }
}
