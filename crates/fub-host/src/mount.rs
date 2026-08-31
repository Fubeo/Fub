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

use crate::registry::{Bundle, BundleRegistry, OnlyProviders};
use crate::settings::{
    catalog_assembled, core_catalog_assembled, core_settings, disabled_plugins, CORE_ID,
};
#[cfg(feature = "versioning")]
use crate::settings::{versioning_enabled, versioning_settings};

const MARKDOWN_ID: &str = "fub.markdown";
const COMMANDS_SERVICE: &str = "fub.commands";
const TRASH_ID: &str = "fub.trash";

pub struct Mounted {
    pub workspace: Workspace,
    pub registry: BundleRegistry,
    #[cfg(feature = "versioning")]
    pub versions: Option<VersionStore>,
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
    register: Box<dyn Fn(&mut Workspace) -> Vec<String> + Send + Sync>,
}

impl CoreBundle {
    fn new(
        id: &'static str,
        name: &'static str,
        register: impl Fn(&mut Workspace) -> Vec<String> + Send + Sync + 'static,
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

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        (self.register)(ws)
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
                CoreBundle::new(feature.id, feature.name, move |ws| {
                    register_versioning(ws, &store, view, commands)
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
            CoreBundle::new(id, feature.name, move |ws| {
                let mut failures = Vec::new();
                if let Some(build) = view {
                    failures.extend(register_view(ws, id, build()));
                }
                if let Some(build) = commands {
                    failures.extend(register_commands(ws, id, build()));
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

    // Il core deve esistere prima di leggere `plugins.disabled` e i livelli.
    registry
        .enable(&mut ws, CORE_ID)
        .map_err(|error| format!("core bundle won't mount: {error}"))?;
    crate::settings::apply_log_levels(&ws, levels);

    // Questi provider sono infrastruttura sempre disponibile: in particolare i
    // comandi di manutenzione non possono sparire proprio nel vault da riparare.
    for id in [fub_kernel::maintenance::MAINTENANCE_ID, MARKDOWN_ID] {
        registry
            .enable(&mut ws, id)
            .map_err(|error| format!("mandatory bundle `{id}` won't mount: {error}"))?;
    }

    let disabled = disabled_plugins(&ws);
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

    for (id, error) in registry.enable_in_dependency_order(&mut ws, selected) {
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
    let versions = store.read().map_err(|error| error.to_string())?.clone();
    Ok(Mounted {
        workspace: ws,
        registry,
        #[cfg(feature = "versioning")]
        versions,
    })
}

#[cfg(feature = "search")]
fn register_search(ws: &mut Workspace) -> Vec<String> {
    let index = match ws
        .plugin_data_dir(SEARCH_ID)
        .and_then(|dir| SearchIndex::open(&dir))
    {
        Ok(index) => index,
        Err(error) => return vec![format!("search index unavailable: {error}")],
    };
    let settings = index.settings_handler();
    match ws.register_index_provider(SEARCH_ID, Box::new(index)) {
        Ok(()) => match ws.register_event_handler(SEARCH_ID, Box::new(settings)) {
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
    ws: &mut Workspace,
    external_store: &Custody<Option<VersionStore>>,
    view: Option<fn() -> Box<dyn fub_abi::ViewProvider>>,
    commands: Option<fn() -> Box<dyn fub_abi::traits::CommandProvider>>,
) -> Vec<String> {
    if !versioning_enabled(ws) {
        return Vec::new();
    }

    let opened = match ws.with_host(VERSIONING_ID, VersionStore::open) {
        Ok(opened) => opened,
        Err(error) => return vec![format!("versioning unavailable: {error}")],
    };
    let hook_store = opened.clone();
    if let Err(error) = ws.register_event_handler(
        VERSIONING_ID,
        Box::new(VersioningHandler::new(opened.clone())),
    ) {
        return vec![format!("versioning not registered: {error}")];
    }
    ws.set_before_write_hook(Some((
        VERSIONING_ID.to_string(),
        Arc::new(move |host, id| {
            VersioningHandler::new(hook_store.clone()).photograph_if_unversioned(host, id)
        }),
    )));

    let mut failures = Vec::new();
    if let Some(build) = view {
        failures.extend(register_view(ws, VERSIONING_ID, build()));
    }
    if let Some(build) = commands {
        failures.extend(register_commands(ws, VERSIONING_ID, build()));
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
    ws: &mut Workspace,
    id: &str,
    provider: Box<dyn fub_abi::ViewProvider>,
) -> Vec<String> {
    match ws.register_view_provider(id, provider) {
        Ok(()) => Vec::new(),
        Err(error) => vec![format!("view not registered: {error}")],
    }
}

fn register_maintenance(ws: &mut Workspace) -> Vec<String> {
    register_commands(
        ws,
        fub_kernel::maintenance::MAINTENANCE_ID,
        Box::new(fub_kernel::maintenance::Maintenance),
    )
}

fn register_markdown_transfer(ws: &mut Workspace) -> Vec<String> {
    let mut failures = Vec::new();
    if let Err(error) = ws.register_import_provider(MARKDOWN_ID, MarkdownImport::boxed()) {
        failures.push(format!("markdown import not registered: {error}"));
    }
    if let Err(error) = ws.register_export_provider(MARKDOWN_ID, MarkdownExport::boxed()) {
        failures.push(format!("markdown export not registered: {error}"));
    }
    failures
}

fn register_commands(
    ws: &mut Workspace,
    id: &str,
    provider: Box<dyn fub_abi::traits::CommandProvider>,
) -> Vec<String> {
    match ws.register_command_provider(id, provider) {
        Ok(()) => Vec::new(),
        Err(error) => vec![format!("commands not registered: {error}")],
    }
}

#[cfg(feature = "blocks")]
fn register_blocks(ws: &mut Workspace) -> Vec<String> {
    let mut failures = Vec::new();
    for rule in [
        Box::new(DiagramRule) as Box<dyn fub_abi::custom::SyntaxRule>,
        Box::new(MathRule),
        Box::new(HighlightRule),
    ] {
        if let Err(error) = ws.register_syntax_rule(BLOCKS_ID, rule) {
            failures.push(format!("syntax rule not grafted: {error}"));
        }
    }
    for renderer in [
        Box::new(DiagramRenderer) as Box<dyn fub_abi::custom::CustomRenderer>,
        Box::new(MathRenderer),
    ] {
        if let Err(error) = ws.register_custom_renderer(BLOCKS_ID, renderer) {
            failures.push(format!("renderer not registered: {error}"));
        }
    }
    failures
}