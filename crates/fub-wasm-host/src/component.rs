//! Componente WASM, proxy del plugin e bundle montabile.
//!
//! Plugin e provider di uno stesso montaggio condividono esplicitamente una
//! sola istanza tramite [`BundleMount`]. Il bundle non conserva più «l'ultima
//! istanza» fra chiamate: non esiste quindi uno stato temporale implicito che un
//! secondo montaggio o una chiamata fuori sequenza possa sovrascrivere.

use std::sync::{Arc, Mutex};

use camino::Utf8Path;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fub_abi::model::DocumentModel;
use fub_abi::traits::{CommandProvider, HostApi, Plugin, PluginManifest};
use fub_abi::{FormatError, PluginError};
use fub_host::registry::{Bundle, BundleMount, Registrar, RegistrationReport};
use fub_kernel::Trust;
use wasmtime::component::types::ComponentItem;
use wasmtime::component::{Component as WasmtimeComponent, InstancePre, Linker, ResourceType};
use wasmtime::{Engine, Store};

use crate::borrow::{with_guest, State};
use crate::contract::exports::fub::abi::command as w_command;
use crate::contract::exports::fub::abi::format as w_format;
use crate::contract::exports::fub::abi::plugin as w_plugin;
use crate::guest::add_to_linker;
use crate::translate as tr;
/// Famiglie del contratto effettivamente collegate da questo host.
const FAMILIES_SERVED: &[&str] = &[
    "fub:abi/host-env",
    "fub:abi/host-vault-read",
    "fub:abi/host-data-read",
    "fub:abi/host-data-write",
    "fub:abi/host-events",
];
const HOST_FAMILY_PREFIX: &str = "fub:abi/host-";
const FORMAT_INTERFACE: &str = "fub:abi/format";
const FORMAT_EXPORT: &str = "fub:abi/format@0.1.1";

fn is_supported_format_export(name: &str) -> bool {
    name == FORMAT_INTERFACE
        || name == FORMAT_EXPORT
        || name
            .strip_prefix(FORMAT_INTERFACE)
            .is_some_and(|version| version.starts_with('@') && version.len() > 1)
}

fn resolve_format_indices<T, E>(
    export_present: bool,
    resolve: impl FnOnce() -> Result<T, E>,
) -> Result<Option<T>, LoadError>
where
    E: std::fmt::Display,
{
    match resolve() {
        Ok(indices) => Ok(Some(indices)),
        Err(error) if export_present => Err(LoadError::Compilation(format!("{error:#}"))),
        Err(_) => Ok(None),
    }
}

/// Errori che possono verificarsi prima che un componente WASM diventi un
/// bundle montabile.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    /// Il file del componente non è leggibile.
    #[error("il componente non si legge: {0}")]
    Read(#[from] std::io::Error),
    /// I byte non descrivono un componente valido o Wasmtime non riesce a
    /// compilarlo/linkarlo.
    #[error("il componente non si compila: {0}")]
    Compilation(String),
    /// Il componente importa una famiglia `host-*` del contratto che questo
    /// host non implementa.
    #[error("il componente importa famiglie che questo host non serve: {0}")]
    UnservedFamilies(String),
    /// Manca l'export obbligatorio `fub:abi/plugin`.
    #[error("il componente non esporta `fub:abi/plugin`: non è un plugin ({0})")]
    NotAPlugin(String),
    /// L'istanza non nasce oppure il suo manifest non è traducibile nel
    /// contratto dell'host.
    #[error("il componente non si istanzia: {0}")]
    Instantiation(String),
}

/// Un `.wasm` compilato e pronto a produrre istanze indipendenti.
pub struct Component {
    pre: InstancePre<State>,
    indices: w_plugin::GuestIndices,
    command_indices: Option<w_command::GuestIndices>,
    format_indices: Option<w_format::GuestIndices>,
}

impl Component {
    /// Carica e compila un componente dal filesystem.
    pub fn from_file(path: &Utf8Path) -> Result<Self, LoadError> {
        Self::from_bytes(&std::fs::read(path)?)
    }

    /// Carica e compila un componente dai suoi byte.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, LoadError> {
        let engine = crate::limits::engine();
        let component = WasmtimeComponent::new(&engine, bytes)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;
        Self::load(engine, component)
    }

    fn load(engine: Engine, component: WasmtimeComponent) -> Result<Self, LoadError> {
        let mut linker: Linker<State> = Linker::new(&engine);
        add_to_linker(&mut linker).map_err(|error| LoadError::Compilation(format!("{error:#}")))?;

        let missing: Vec<String> = component
            .component_type()
            .imports(&engine)
            .map(|(name, _)| name.to_string())
            .filter(|name| name.starts_with(HOST_FAMILY_PREFIX))
            .filter(|name| {
                !FAMILIES_SERVED
                    .iter()
                    .any(|served| name.starts_with(served))
            })
            .collect();
        if !missing.is_empty() {
            return Err(LoadError::UnservedFamilies(missing.join(", ")));
        }
        cap_the_rest(&mut linker, &engine, &component)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;
        let format_export_present = component
            .component_type()
            .exports(&engine)
            .any(|(name, _)| is_supported_format_export(name));
        let pre = linker
            .instantiate_pre(&component)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;
        let indices = w_plugin::GuestIndices::new(&pre)
            .map_err(|error| LoadError::NotAPlugin(format!("{error:#}")))?;
        let command_indices = w_command::GuestIndices::new(&pre).ok();
        let format_indices =
            resolve_format_indices(format_export_present, || w_format::GuestIndices::new(&pre))?;
        Ok(Self {
            pre,
            indices,
            command_indices,
            format_indices,
        })
    }

    fn instantiate(&self) -> Result<Instance, LoadError> {
        let mut store = Store::new(self.pre.engine(), State::empty());
        crate::limits::arm(&mut store);
        let instance = self
            .pre
            .instantiate(&mut store)
            .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?;
        let plugin = self
            .indices
            .load(&mut store, &instance)
            .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?;
        let commands = match &self.command_indices {
            Some(indices) => Some(
                indices
                    .load(&mut store, &instance)
                    .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?,
            ),
            None => None,
        };
        let format = match &self.format_indices {
            Some(indices) => Some(
                indices
                    .load(&mut store, &instance)
                    .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?,
            ),
            None => None,
        };
        Ok(Instance {
            store,
            interfaces: Interfaces {
                plugin,
                commands,
                format,
            },
        })
    }
}

/// Tappa con trap gli import non serviti dal contratto, senza aprire WASI sul
/// sistema operativo dell'host.
fn cap_the_rest(
    linker: &mut Linker<State>,
    engine: &Engine,
    component: &WasmtimeComponent,
) -> wasmtime::Result<()> {
    let ty = component.component_type();
    for (name, item) in ty.imports(engine) {
        if FAMILIES_SERVED
            .iter()
            .any(|served| name.starts_with(served))
        {
            continue;
        }
        let ComponentItem::ComponentInstance(interface) = item else {
            continue;
        };
        let mut functions = Vec::new();
        let mut resources = Vec::new();
        for (entry, item) in interface.exports(engine) {
            match item {
                ComponentItem::ComponentFunc(_) => functions.push(entry.to_string()),
                ComponentItem::Resource(_) => resources.push(entry.to_string()),
                _ => {}
            }
        }
        let mut instance = linker.instance(name)?;
        for resource in resources {
            instance.resource(&resource, ResourceType::host::<()>(), |_, _| Ok(()))?;
        }
        for function in functions {
            let label = format!("{name}#{function}");
            instance.func_new(&function, move |_, _, _| {
                Err(wasmtime::Error::msg(format!(
                    "this host does not serve `{label}`"
                )))
            })?;
        }
    }
    Ok(())
}

struct Interfaces {
    plugin: w_plugin::Guest,
    commands: Option<w_command::Guest>,
    format: Option<w_format::Guest>,
}

struct Instance {
    store: Store<State>,
    interfaces: Interfaces,
}

fn call<R>(
    inner: &Mutex<Instance>,
    host: &mut dyn HostApi,
    call: impl FnOnce(&Interfaces, &mut Store<State>) -> Result<R, PluginError>,
) -> Result<R, PluginError> {
    let mut inner = inner
        .lock()
        .map_err(|_| PluginError::Internal("component instance is poisoned".into()))?;
    let Instance { store, interfaces } = &mut *inner;
    let interfaces = &*interfaces;
    with_guest(store, host, |store| call(interfaces, store))
}

fn failure(error: wasmtime::Error) -> PluginError {
    if error.downcast_ref::<wasmtime::Trap>() == Some(&wasmtime::Trap::Interrupt) {
        return PluginError::Internal(
            "il componente non ha risposto entro il tempo concesso ed è stato fermato".into(),
        );
    }
    PluginError::Internal(format!("il componente è caduto: {error:#}").into())
}

/// Proxy `Plugin` sopra una singola istanza WASM.
pub struct WasmPlugin {
    inner: Arc<Mutex<Instance>>,
}

impl Plugin for WasmPlugin {
    fn manifest(&self) -> PluginManifest {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return PluginManifest::new("", ""),
        };
        let Instance { store, interfaces } = &mut *inner;
        crate::limits::renew(&mut *store);
        match interfaces.plugin.call_manifest(&mut *store) {
            Ok(manifest) => {
                tr::from_manifest(manifest).unwrap_or_else(|_| PluginManifest::new("", ""))
            }
            Err(_) => PluginManifest::new("", ""),
        }
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        call(&self.inner, host, |interfaces, store| {
            interfaces
                .plugin
                .call_activate(store)
                .map_err(failure)?
                .map_err(tr::from_error)
        })
    }

    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        call(&self.inner, host, |interfaces, store| {
            interfaces
                .plugin
                .call_deactivate(store)
                .map_err(failure)?
                .map_err(tr::from_error)
        })
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let payload = tr::to_json(&payload);
        call(&self.inner, host, |interfaces, store| {
            let answer = interfaces
                .plugin
                .call_run_job(store, job, &payload)
                .map_err(failure)?
                .map_err(tr::from_error)?;
            tr::from_json(&answer)
        })
    }
}

/// Proxy `CommandProvider` sulla **stessa** istanza del `WasmPlugin` montato.
pub struct WasmCommandProvider {
    inner: Arc<Mutex<Instance>>,
    specs: Vec<CommandSpec>,
}

impl CommandProvider for WasmCommandProvider {
    fn commands(&self) -> Vec<CommandSpec> {
        self.specs.clone()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let args = tr::to_json(&args);
        let mode = tr::to_invoke_mode(mode);
        call(&self.inner, host, |interfaces, store| {
            let commands = interfaces.commands.as_ref().ok_or_else(|| {
                PluginError::Internal("il componente non esporta `fub:abi/command`".into())
            })?;
            let outcome = commands
                .call_invoke(store, command, &args, mode)
                .map_err(failure)?
                .map_err(tr::from_error)?;
            tr::from_command_outcome(outcome)
        })
    }
}

/// Proxy `FormatProvider` sopra una singola istanza WASM.
pub struct WasmFormatProvider {
    inner: Arc<Mutex<Instance>>,
    descriptor: FormatDescriptor,
    capabilities: FormatCapabilities,
}

impl FormatProvider for WasmFormatProvider {
    fn descriptor(&self) -> FormatDescriptor {
        self.descriptor.clone()
    }

    fn capabilities(&self) -> FormatCapabilities {
        self.capabilities.clone()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let source_wit = tr::to_document_source(source);
        let ctx_wit = tr::to_parse_context(ctx);
        let mut instance = self
            .inner
            .lock()
            .map_err(|_| FormatError::Parse("component instance is poisoned".into()))?;
        let Instance { store, interfaces } = &mut *instance;
        crate::limits::renew(&mut *store);
        let format = interfaces.format.as_ref().ok_or_else(|| {
            FormatError::Parse("il componente non esporta `fub:abi/format`".into())
        })?;
        let model = format
            .call_parse(&mut *store, &source_wit, &ctx_wit)
            .map_err(|error| FormatError::Parse(format!("il componente è caduto: {error:#}")))?
            .map_err(tr::from_format_error)?;
        crate::model::from_document(model, ctx, source)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        let model_wit = crate::model::to_document(model.clone())
            .map_err(|error| FormatError::Render(error.to_string()))?;
        let opts_wit = tr::to_render_options(opts);
        let mut instance = self
            .inner
            .lock()
            .map_err(|_| FormatError::Render("component instance is poisoned".into()))?;
        let Instance { store, interfaces } = &mut *instance;
        crate::limits::renew(&mut *store);
        let format = interfaces.format.as_ref().ok_or_else(|| {
            FormatError::Render("il componente non esporta `fub:abi/format`".into())
        })?;
        format
            .call_render_html(&mut *store, &model_wit, &opts_wit)
            .map_err(|error| FormatError::Render(format!("il componente è caduto: {error:#}")))?
            .map_err(tr::from_format_error)
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        let model_wit = crate::model::to_document(model.clone())
            .map_err(|error| FormatError::Serialize(error.to_string()))?;
        let mut instance = self
            .inner
            .lock()
            .map_err(|_| FormatError::Serialize("component instance is poisoned".into()))?;
        let Instance { store, interfaces } = &mut *instance;
        crate::limits::renew(&mut *store);
        let format = interfaces.format.as_ref().ok_or_else(|| {
            FormatError::Serialize("il componente non esporta `fub:abi/format`".into())
        })?;
        format
            .call_serialize(&mut *store, &model_wit)
            .map_err(|error| FormatError::Serialize(format!("il componente è caduto: {error:#}")))?
            .map_err(tr::from_format_error)
    }
}
/// Componente montabile dalla stessa porta dei bundle nativi.
pub struct WasmBundle {
    component: Component,
    manifest: PluginManifest,
    trust: Trust,
}

impl std::fmt::Debug for WasmBundle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WasmBundle")
            .field("id", &self.manifest.id)
            .field("version", &self.manifest.version)
            .field("abi", &self.manifest.abi_version)
            .field("trust", &self.trust)
            .finish()
    }
}

impl WasmBundle {
    /// Carica il componente e legge subito il manifest, prima del montaggio.
    pub fn from_file(path: &Utf8Path, trust: Trust) -> Result<Self, LoadError> {
        Self::from_bytes(&std::fs::read(path)?, trust)
    }

    /// Compila e legge il manifest degli esatti byte ricevuti, senza riaprire
    /// un percorso che potrebbe essere cambiato dopo la verifica.
    pub fn from_bytes(bytes: &[u8], trust: Trust) -> Result<Self, LoadError> {
        let component = Component::from_bytes(bytes)?;
        let manifest = {
            let mut instance = component.instantiate()?;
            let manifest = instance
                .interfaces
                .plugin
                .call_manifest(&mut instance.store)
                .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?;
            tr::from_manifest(manifest)
                .map_err(|error| LoadError::Instantiation(format!("manifest: {error}")))?
        };
        Ok(Self {
            component,
            manifest,
            trust,
        })
    }

    fn declared_commands(inner: &Mutex<Instance>) -> Result<Vec<CommandSpec>, String> {
        let mut instance = inner
            .lock()
            .map_err(|_| "component instance is poisoned".to_string())?;
        let Instance { store, interfaces } = &mut *instance;
        let Some(commands) = interfaces.commands.as_ref() else {
            return Ok(Vec::new());
        };
        crate::limits::renew(&mut *store);
        let specs = commands.call_commands(&mut *store).map_err(|error| {
            format!("comandi non dichiarati: il componente è caduto: {error:#}")
        })?;
        Ok(specs.into_iter().map(tr::from_command_spec).collect())
    }

    fn instantiate_plugin(&self) -> Box<dyn Plugin> {
        match self.component.instantiate() {
            Ok(instance) => Box::new(WasmPlugin {
                inner: Arc::new(Mutex::new(instance)),
            }),
            Err(error) => Box::new(FailedPlugin {
                manifest: self.manifest.clone(),
                error: error.to_string(),
            }),
        }
    }
    fn format_provider_from_inner(
        inner: Arc<Mutex<Instance>>,
    ) -> Result<Option<Box<dyn FormatProvider>>, PluginError> {
        let mut locked = inner
            .lock()
            .map_err(|_| PluginError::Internal("component instance is poisoned".into()))?;
        let Instance { store, interfaces } = &mut *locked;
        let format = match interfaces.format.as_ref() {
            Some(format) => format,
            None => return Ok(None),
        };
        crate::limits::renew(&mut *store);
        let descriptor = format
            .call_descriptor(&mut *store)
            .map_err(failure)
            .map(tr::from_format_descriptor)?;
        crate::limits::renew(&mut *store);
        let capabilities = format
            .call_capabilities(&mut *store)
            .map_err(failure)
            .and_then(tr::from_format_capabilities)?;
        drop(locked);
        Ok(Some(Box::new(WasmFormatProvider {
            inner,
            descriptor,
            capabilities,
        })))
    }

    /// Prepara il provider di formato opzionale e ne congela i metadati.
    pub fn format_provider(&self) -> Result<Option<Box<dyn FormatProvider>>, PluginError> {
        let instance = self
            .component
            .instantiate()
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        Self::format_provider_from_inner(Arc::new(Mutex::new(instance)))
    }

    pub(crate) fn prepare_opening(self) -> WasmOpeningBundle {
        let instance = self
            .component
            .instantiate()
            .map(|instance| Arc::new(Mutex::new(instance)))
            .map_err(|error| error.to_string());
        WasmOpeningBundle {
            instance,
            manifest: self.manifest,
            trust: self.trust,
        }
    }
}

fn bundle_mount(
    instance: Result<Arc<Mutex<Instance>>, String>,
    manifest: PluginManifest,
) -> BundleMount<'static> {
    let inner = match instance {
        Ok(inner) => inner,
        Err(error) => {
            return BundleMount::new(Box::new(FailedPlugin { manifest, error }), |_| {
                RegistrationReport::complete()
            });
        }
    };
    let plugin = Box::new(WasmPlugin {
        inner: Arc::clone(&inner),
    });
    BundleMount::new(plugin, move |registrar| {
        let specs = match WasmBundle::declared_commands(&inner) {
            Ok(specs) => specs,
            Err(error) => return RegistrationReport::failed(error),
        };
        if specs.is_empty() {
            return RegistrationReport::complete();
        }

        let provider = WasmCommandProvider { inner, specs };
        match registrar.register_command_provider(Box::new(provider)) {
            Ok(()) => RegistrationReport::complete(),
            Err(error) => RegistrationReport::failed(format!("comandi non registrati: {error}")),
        }
    })
}

/// Stato preparato per una singola apertura: plugin e provider condividono
/// esattamente l'istanza conservata qui.
pub(crate) struct WasmOpeningBundle {
    instance: Result<Arc<Mutex<Instance>>, String>,
    manifest: PluginManifest,
    trust: Trust,
}

impl WasmOpeningBundle {
    pub(crate) fn format_provider(&self) -> Result<Option<Box<dyn FormatProvider>>, PluginError> {
        let inner = self
            .instance
            .as_ref()
            .map(Arc::clone)
            .map_err(|error| PluginError::Internal(error.clone().into()))?;
        WasmBundle::format_provider_from_inner(inner)
    }
}

impl Bundle for WasmBundle {
    fn manifest(&self) -> PluginManifest {
        self.manifest.clone()
    }

    fn trust(&self) -> Trust {
        self.trust
    }

    /// Costruzione isolata, senza effetti collaterali sul bundle. Il registry
    /// usa `prepare`; questo metodo resta valido per i clienti del trait che
    /// vogliono solo un corpo `Plugin`.
    fn plugin(&self) -> Box<dyn Plugin> {
        self.instantiate_plugin()
    }

    /// La registrazione WASM richiede l'istanza preparata insieme al plugin.
    /// Una chiamata diretta non può quindi fabbricare correttamente i provider.
    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        vec!["WASM providers require a prepared bundle mount".to_string()]
    }

    /// Crea **una** istanza e consegna due proprietari espliciti dello stesso
    /// `Arc`: il plugin e la closure che registra i provider.
    fn prepare(&self) -> BundleMount<'_> {
        let instance = self
            .component
            .instantiate()
            .map(|instance| Arc::new(Mutex::new(instance)))
            .map_err(|error| error.to_string());
        bundle_mount(instance, self.manifest.clone())
    }
}

impl Bundle for WasmOpeningBundle {
    fn manifest(&self) -> PluginManifest {
        self.manifest.clone()
    }

    fn trust(&self) -> Trust {
        self.trust
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        match &self.instance {
            Ok(inner) => Box::new(WasmPlugin {
                inner: Arc::clone(inner),
            }),
            Err(error) => Box::new(FailedPlugin {
                manifest: self.manifest.clone(),
                error: error.clone(),
            }),
        }
    }

    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        vec!["WASM providers require a prepared bundle mount".to_string()]
    }

    fn prepare(&self) -> BundleMount<'_> {
        bundle_mount(self.instance.clone(), self.manifest.clone())
    }
}
/// Plugin che rappresenta un'istanza che non è mai nata: fallisce in activate
/// così il montaggio resta atomico e restituisce la causa originale.
struct FailedPlugin {
    manifest: PluginManifest,
    error: String,
}

impl Plugin for FailedPlugin {
    fn manifest(&self) -> PluginManifest {
        self.manifest.clone()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Err(PluginError::Internal(self.error.clone().into()))
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        _job: &str,
        _payload: serde_json::Value,
        _host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        Err(PluginError::Internal(self.error.clone().into()))
    }
}

#[cfg(test)]
mod tests {
    use super::{is_supported_format_export, resolve_format_indices, FORMAT_EXPORT};

    #[test]
    fn format_export_matches_identity_across_versions() {
        assert!(is_supported_format_export(FORMAT_EXPORT));
        assert!(is_supported_format_export("fub:abi/format"));
        assert!(is_supported_format_export("fub:abi/format@0.1.2"));
        assert!(is_supported_format_export("fub:abi/format@9.9.9"));
        assert!(!is_supported_format_export("fub:abi/format@"));
        assert!(!is_supported_format_export("fub:abi/formatting@0.1.1"));
        assert!(!is_supported_format_export("fub:abi/format-extra@0.1.1"));
        assert!(!is_supported_format_export("foreign:fub/abi/format@0.1.1"));
    }

    #[test]
    fn malformed_format_indices_fail_only_when_identity_is_present() {
        assert!(resolve_format_indices(true, || -> Result<(), &str> { Err("malformed") }).is_err());
        assert_eq!(
            resolve_format_indices(false, || -> Result<(), &str> { Err("not exported") }).unwrap(),
            None
        );
    }
}
