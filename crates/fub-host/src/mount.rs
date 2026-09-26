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
use fub_abi::format::FormatDescriptor;
use fub_abi::settings::SettingSpec;
use fub_abi::text::StringCatalog;
use fub_abi::traits::HostNetwork;
use fub_abi::traits::{Plugin, PluginManifest};
use fub_features::{HostWiring, OfficialFeature};
#[cfg(feature = "search")]
use fub_features::{SearchIndex, SEARCH_ID};
#[cfg(feature = "versioning")]
use fub_features::{VersionStore, VersioningHandler};
use fub_format_markdown::{MarkdownExport, MarkdownImport, MarkdownProvider};
use fub_importers as importers;
use fub_kernel::storage::VaultStorage;
#[cfg(feature = "search")]
use fub_kernel::RegistryError;
use fub_kernel::{
    FormatRegistry, MachineSettings, RootedFsStorage, SystemLocale, Trust, ViewStates, Workspace,
};

use crate::registry::{Bundle, BundleRegistry, OnlyProviders, Registrar};
use crate::settings::{
    catalog_assembled, core_catalog_assembled, core_settings, disabled_plugins, settings_assembled,
    CORE_ID,
};

const MARKDOWN_ID: &str = "fub.markdown";

pub struct Mounted {
    pub workspace: Workspace,
    pub registry: BundleRegistry,
    pub format_resources: Vec<Box<dyn std::any::Any + Send + Sync>>,
    /// I provider di formato esterni rifiutati al montaggio, uno per rifiuto.
    pub format_diagnostics: Vec<fub_abi::PluginError>,
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

    fn providing(mut self, services: &[&'static str]) -> Self {
        self.provides.extend_from_slice(services);
        self
    }

    fn requiring(mut self, services: &[&'static str]) -> Self {
        self.requires.extend_from_slice(services);
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

/// Native transfer bundle: each importer/exporter and the conversion commands
/// share one owner, with the explicitly restricted network manifest.
struct ImportersBundle;

impl Bundle for ImportersBundle {
    fn manifest(&self) -> PluginManifest {
        importers::manifest()
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        importers::ImportPlugin::boxed()
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        let mut failures = Vec::new();
        for provider in importers::import_providers() {
            if let Err(error) = registrar.register_import_provider(provider) {
                failures.push(format!("import provider not registered: {error}"));
            }
        }
        for provider in importers::export_providers() {
            if let Err(error) = registrar.register_export_provider(provider) {
                failures.push(format!("export provider not registered: {error}"));
            }
        }
        if let Err(error) =
            registrar.register_command_provider(Box::new(importers::command_provider()))
        {
            failures.push(format!("import commands not registered: {error}"));
        }
        failures
    }
}

/// Chi apre il **supporto** di un vault (§15.1) per conto dell'host: il disco
/// ancorato alla radice di serie; in memoria, o che fallisce la mossa che si
/// vuole studiare, nei banchi. È la porta di [`Host::with_storage`](crate::Host::with_storage):
/// un host che monta su un supporto che non è il disco non ha nessun altro
/// canale verso il vault.
pub trait VaultStorageSource: Send + Sync {
    /// Il supporto su cui aprire il vault in `root`, che è già assoluta.
    fn open(&self, root: &Utf8Path) -> std::io::Result<Arc<dyn VaultStorage>>;
}

/// Il disco, ancorato alla cartella aperta al mount
/// ([`RootedFsStorage`]): il supporto di serie di ogni host.
pub struct RootedDisk;

impl VaultStorageSource for RootedDisk {
    fn open(&self, root: &Utf8Path) -> std::io::Result<Arc<dyn VaultStorage>> {
        Ok(Arc::new(RootedFsStorage::open(root)?))
    }
}

/// Il client di rete di serie: `ureq` se questo binario ha il filo verso fuori
/// (`http-client`), nessuno altrimenti — e allora un `fetch` risponde
/// `Unserved`, non un errore di permesso.
pub(crate) fn default_network() -> Option<Arc<dyn HostNetwork>> {
    #[cfg(feature = "http-client")]
    {
        Some(Arc::new(crate::net::UreqNetwork::new()))
    }
    #[cfg(not(feature = "http-client"))]
    {
        None
    }
}

pub fn mount(
    root: &Utf8Path,
    machine: Arc<MachineSettings>,
    view_states: Arc<ViewStates>,
    system_locale: Arc<SystemLocale>,
    levels: &fub_kernel::log::Levels,
) -> Result<Mounted, String> {
    let root = fub_kernel::vault::root_absolute(root);
    let storage = RootedDisk
        .open(&root)
        .map_err(|source| fub_kernel::KernelError::InvalidRoot {
            path: root.clone(),
            source,
        })
        .map_err(|error| error.to_string())?;
    mount_with_formats(
        &root,
        storage,
        machine,
        view_states,
        system_locale,
        levels,
        crate::PreparedFormatSource::empty(),
        #[cfg(feature = "http-client")]
        None,
        default_network(),
        Arc::new(fub_kernel::time::SystemClock),
    )
}

fn mount_error_with_resource_disposal(
    primary: String,
    resources: crate::format_source::FormatResources,
) -> String {
    let disposal_errors = crate::format_source::dispose_format_resources(resources);
    disposal_errors.into_iter().fold(primary, |message, error| {
        format!("{message}; retained format resource disposal failed: {error}")
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn mount_with_formats(
    root: &Utf8Path,
    storage: Arc<dyn VaultStorage>,
    machine: Arc<MachineSettings>,
    view_states: Arc<ViewStates>,
    system_locale: Arc<SystemLocale>,
    levels: &fub_kernel::log::Levels,
    prepared_formats: crate::PreparedFormatSource,
    #[cfg(feature = "http-client")] config_root: Option<&Utf8Path>,
    network: Option<Arc<dyn HostNetwork>>,
    clock: Arc<dyn fub_kernel::time::Clock>,
) -> Result<Mounted, String> {
    let (providers, resources) = prepared_formats.into_parts();
    let mut format_resources = Some(resources);
    let mut formats = FormatRegistry::new();
    for provider in [
        MarkdownProvider::boxed(),
        fub_format_canvas::CanvasProvider::boxed(),
        fub_format_base::BaseProvider::boxed(),
    ] {
        if let Err(error) = formats.register(provider) {
            return Err(mount_error_with_resource_disposal(
                format!("format provider conflict: {error}"),
                format_resources.take().unwrap_or_default(),
            ));
        }
    }
    if let Err(error) = formats.register_source(FormatDescriptor::text(
        fub_format_sheet::FORMAT_ID,
        "Fub Sheet",
        &["fubsheet"],
    )) {
        return Err(mount_error_with_resource_disposal(
            format!("source format conflict: {error}"),
            format_resources.take().unwrap_or_default(),
        ));
    }
    // Un provider esterno che rivendica un'estensione già presa è rifiutato da
    // solo: il vault si apre coi formati che aveva, e il rifiuto resta nella
    // diagnostica di apertura invece di far cadere l'intero vault.
    let mut format_diagnostics = Vec::new();
    for provider in providers {
        if let Err(error) = formats.register(provider) {
            format_diagnostics.push(fub_abi::PluginError::AlreadyExists(
                format!("provider di formato rifiutato: {error}").into(),
            ));
        }
    }

    let mut ws = match Workspace::on(root, formats, storage, machine) {
        Ok(ws) => ws
            .with_view_states(view_states)
            .with_system_locale(system_locale)
            .with_clock(clock),
        Err(error) => {
            return Err(mount_error_with_resource_disposal(
                error.to_string(),
                format_resources.take().unwrap_or_default(),
            ))
        }
    };

    if let Some(network) = network {
        ws.set_network(network);
    }
    if let Err(error) = ws.reserve_host_commands(&crate::session::HOST_COMMANDS) {
        return Err(mount_error_with_resource_disposal(
            error.to_string(),
            format_resources.take().unwrap_or_default(),
        ));
    }

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
        Arc::new(
            CoreBundle::new(
                fub_kernel::maintenance::MAINTENANCE_ID,
                "Maintenance",
                register_maintenance,
            )
            // Senza il catalogo i titoli dei comandi di manutenzione uscivano
            // come chiavi grezze (`cmd.vault.rebuild-index.title`) in palette
            // e CLI: il catalogo esisteva, nessuno lo presentava al kernel.
            .speaking(
                crate::settings::CORE_DEFAULT_LOCALE,
                fub_kernel::maintenance::catalog(),
            ),
        ),
        Arc::new(CoreBundle::new(
            MARKDOWN_ID,
            "Markdown",
            register_markdown_transfer,
        )),
        Arc::new(ImportersBundle),
        Arc::new(crate::theme::ThemeBundle::series()),
        Arc::new(CoreBundle::new(
            fub_format_sheet::index::SHEET_ID,
            "Fub Sheet",
            |registrar| {
                let mut errors = match registrar.register_grid_provider(Box::new(
                    fub_format_sheet::grid::SheetGridProvider::new(),
                )) {
                    Ok(()) => Vec::new(),
                    Err(error) => vec![format!("sheet grid NOT registered: {error}")],
                };
                match registrar
                    .register_index_provider(Box::new(fub_format_sheet::index::SheetIndex))
                {
                    Ok(()) => errors,
                    Err(error) => {
                        errors.push(format!("sheet index NOT registered: {error}"));
                        errors
                    }
                }
            },
        )),
    ];

    // Ogni feature ufficiale si monta con lo stesso ciclo: ciò che registra, le
    // impostazioni, i servizi forniti e richiesti e il collegamento che solo
    // l'host sa fare sono campi della sua riga d'inventario, non rami per id.
    let wirings = FeatureWirings {
        #[cfg(feature = "versioning")]
        versions: store.clone(),
    };
    for feature in fub_features::every_official_feature() {
        if feature.registers_nothing() {
            return Err(mount_error_with_resource_disposal(
                format!(
                    "feature '{}' is in the inventory but declares nothing to register",
                    feature.id
                ),
                format_resources.take().unwrap_or_default(),
            ));
        }
        let wirings = wirings.clone();
        let bundle = CoreBundle::new(feature.id, feature.name, move |registrar| {
            register_feature(registrar, feature, &wirings)
        })
        .configuring(settings_assembled(feature))
        .speaking(
            crate::settings::CORE_DEFAULT_LOCALE,
            catalog_assembled(feature),
        )
        .providing(feature.provides)
        .requiring(feature.requires);
        bundles.push(Arc::new(bundle));
    }

    #[cfg(feature = "http-client")]
    {
        // Lo stato di sync è del vault, il token della macchina.
        let token = crate::remote::TokenSource::machine(config_root);
        bundles.push(Arc::new(
            crate::remote::bundle::SyncBundle::new(
                config_root.map(|config| crate::remote::vault_state_dir(config, root)),
            )
            .with_token(token.clone()),
        ));
        bundles.push(Arc::new(
            crate::publish::commands::PublishBundle::new(
                config_root.map(crate::publish::scoped_state_dir),
            )
            .with_token(token),
        ));
    }

    let mut registry = BundleRegistry::new();
    for bundle in &bundles {
        registry.remember(Arc::clone(bundle));
    }

    let versions = match assemble_after_registry(&mut ws, &mut registry, |ws, registry| {
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
    }) {
        Ok(versions) => versions,
        Err(error) => {
            return Err(mount_error_with_resource_disposal(
                error,
                format_resources.take().unwrap_or_default(),
            ))
        }
    };
    #[cfg(not(feature = "versioning"))]
    let () = versions;

    Ok(Mounted {
        workspace: ws,
        registry,
        format_resources: format_resources.take().unwrap_or_default(),
        format_diagnostics,
        #[cfg(feature = "versioning")]
        versions,
    })
}

/// Ciò che l'host tiene per i collegamenti che le feature dichiarano.
#[derive(Clone)]
struct FeatureWirings {
    /// La metà esterna del versioning: la legge chi apre le sessioni.
    #[cfg(feature = "versioning")]
    versions: Custody<Option<VersionStore>>,
}

/// Registra una feature ufficiale da ciò che la sua riga dichiara.
///
/// Prima il collegamento dell'host, poi i provider nell'ordine indice, regole,
/// renderer, view e comandi. Un collegamento che fallisce ferma la feature
/// prima dei provider: il registro annulla ciò che era entrato.
fn register_feature(
    registrar: &mut Registrar<'_>,
    feature: &OfficialFeature,
    #[cfg_attr(not(feature = "versioning"), allow(unused_variables))] wirings: &FeatureWirings,
) -> Vec<String> {
    #[cfg(feature = "versioning")]
    let mut opened_versions = None;
    match feature.wiring {
        HostWiring::None => {}
        #[cfg(feature = "search")]
        HostWiring::SearchIndex => {
            let failures = register_search(registrar);
            if !failures.is_empty() {
                return failures;
            }
        }
        #[cfg(feature = "versioning")]
        HostWiring::VersionStore => match open_versioning(registrar) {
            Ok(opened) => opened_versions = Some(opened),
            Err(failure) => return vec![failure],
        },
        #[allow(unreachable_patterns)]
        unwired => {
            return vec![format!(
                "this host was built without the {unwired:?} wiring that the feature declares"
            )]
        }
    }

    let mut failures = Vec::new();
    if let Some(build) = feature.index {
        if let Err(error) = registrar.register_index_provider(build()) {
            failures.push(format!("index not registered: {error}"));
        }
    }
    if let Some(build) = feature.syntax {
        for rule in build() {
            if let Err(error) = registrar.register_syntax_rule(rule) {
                failures.push(format!("syntax rule not grafted: {error}"));
            }
        }
    }
    if let Some(build) = feature.renderers {
        for renderer in build() {
            if let Err(error) = registrar.register_custom_renderer(renderer) {
                failures.push(format!("renderer not registered: {error}"));
            }
        }
    }
    if let Some(build) = feature.view {
        failures.extend(register_view(registrar, build()));
    }
    if let Some(build) = feature.commands {
        let commands = build();
        // Il ripristino scrive, e la preimmagine la fotografa il gancio che
        // l'interruttore spegne: spento, si legge e non si ripristina.
        #[cfg(feature = "versioning")]
        let commands: Box<dyn fub_abi::traits::CommandProvider> = if opened_versions.is_some() {
            Box::new(SwitchedRestore(commands))
        } else {
            commands
        };
        failures.extend(register_commands(registrar, commands));
    }

    #[cfg(feature = "versioning")]
    if let Some(opened) = opened_versions {
        if failures.is_empty() {
            failures.extend(publish_versions(&wirings.versions, opened));
        }
    }
    failures
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

/// Apre lo store delle versioni e registra handler e hook prima della
/// scrittura.
///
/// Lo store si apre anche con l'interruttore spento: la storia già registrata
/// resta leggibile, com'è scritto nella descrizione dell'impostazione. Spento
/// vuol dire che **non ne nasce di nuova**, e lo decidono handler e gancio a
/// ogni scrittura, leggendo l'impostazione in quel momento: riaccenderlo non
/// chiede di riaprire il vault.
#[cfg(feature = "versioning")]
fn open_versioning(registrar: &mut Registrar<'_>) -> Result<VersionStore, String> {
    let opened = registrar
        .with_host(VersionStore::open)
        .map_err(|error| format!("versioning unavailable: {error}"))?;
    let hook_store = opened.clone();
    registrar
        .register_event_handler(Box::new(SwitchedVersioning(VersioningHandler::new(
            opened.clone(),
        ))))
        .map_err(|error| format!("versioning not registered: {error}"))?;
    registrar
        .set_before_write_hook(Arc::new(move |host, id| {
            if !versioning_on(host) {
                return Ok(());
            }
            VersioningHandler::new(hook_store.clone()).photograph_before_write(host, id)
        }))
        .map_err(|error| format!("versioning hook not registered: {error}"))?;
    Ok(opened)
}

/// L'interruttore del versioning, letto adesso. Il default è quello dello
/// schema: acceso.
#[cfg(feature = "versioning")]
fn versioning_on(host: &dyn fub_abi::traits::ReadApi) -> bool {
    host.setting(crate::settings::VERSIONING_ENABLED)
        .ok()
        .and_then(|value| value.as_toggle())
        .unwrap_or(true)
}

/// Il campionatore dietro l'interruttore. Spento, la storia già registrata
/// segue le sue note, rinominate o cancellate, e non ne nasce di nuova: niente
/// fotografie dalle modifiche, niente passata di riconciliazione dopo un
/// `Overflow`, che fotografa.
#[cfg(feature = "versioning")]
struct SwitchedVersioning(VersioningHandler);

#[cfg(feature = "versioning")]
impl fub_abi::traits::EventHandler for SwitchedVersioning {
    fn subscribed(&self) -> fub_abi::EventMask {
        self.0.subscribed()
    }

    fn handle(
        &mut self,
        notice: &fub_abi::Notice,
        host: &mut dyn fub_abi::traits::HostApi,
    ) -> Result<(), fub_abi::PluginError> {
        use fub_abi::Event;
        let records = matches!(
            notice.event,
            Event::DocumentChanged { .. } | Event::EntryChanged { .. } | Event::Overflow { .. }
        );
        if records && !versioning_on(host) {
            return Ok(());
        }
        self.0.handle(notice, host)
    }
}

/// I comandi del versioning dietro l'interruttore. Il ripristino sostituisce
/// la nota, e con il versioning spento nessuno fotograferebbe ciò che
/// sostituisce: rifiuta, e dice come riaverlo, invece di perderlo.
#[cfg(feature = "versioning")]
struct SwitchedRestore(Box<dyn fub_abi::traits::CommandProvider>);

#[cfg(feature = "versioning")]
impl fub_abi::traits::CommandProvider for SwitchedRestore {
    fn commands(&self) -> Vec<fub_abi::CommandSpec> {
        self.0.commands()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: fub_abi::InvokeMode,
        host: &mut dyn fub_abi::traits::HostApi,
    ) -> Result<fub_abi::CommandOutcome, fub_abi::PluginError> {
        if !versioning_on(host) {
            return Err(fub_abi::PluginError::Unserved(fub_abi::text::Text::key(
                crate::settings::VERSIONING_OFF_RESTORE,
            )));
        }
        self.0.invoke(command, args, mode, host)
    }
}

/// La metà esterna viene pubblicata solo quando tutti i provider sono entrati:
/// un rollback non lascia un `VersionStore` che finga un bundle vivo.
#[cfg(feature = "versioning")]
fn publish_versions(
    external_store: &Custody<Option<VersionStore>>,
    opened: VersionStore,
) -> Vec<String> {
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
