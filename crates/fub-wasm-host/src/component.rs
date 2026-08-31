//! Componente WASM, proxy del plugin e bundle montabile.
//!
//! Plugin e provider di uno stesso montaggio condividono esplicitamente una
//! sola istanza tramite [`BundleMount`]. Il bundle non conserva più «l'ultima
//! istanza» fra chiamate: non esiste quindi uno stato temporale implicito che un
//! secondo montaggio o una chiamata fuori sequenza possa sovrascrivere.

use std::sync::{Arc, Mutex};

use camino::Utf8Path;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::traits::{CommandProvider, HostApi, Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_host::registry::{Bundle, BundleMount, RegistrationReport};
use fub_kernel::{Trust, Workspace};
use wasmtime::component::types::ComponentItem;
use wasmtime::component::{Component as WasmtimeComponent, InstancePre, Linker, ResourceType};
use wasmtime::{Engine, Store};

use crate::borrow::{with_guest, State};
use crate::contract::exports::fub::abi::command as w_command;
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

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("il componente non si legge: {0}")]
    Read(#[from] std::io::Error),
    #[error("il componente non si compila: {0}")]
    Compilation(String),
    #[error("il componente importa famiglie che questo host non serve: {0}")]
    UnservedFamilies(String),
    #[error("il componente non esporta `fub:abi/plugin`: non è un plugin ({0})")]
    NotAPlugin(String),
    #[error("il componente non si istanzia: {0}")]
    Instantiation(String),
}

/// Un `.wasm` compilato e pronto a produrre istanze indipendenti.
pub struct Component {
    pre: InstancePre<State>,
    indices: w_plugin::GuestIndices,
    command_indices: Option<w_command::GuestIndices>,
}

impl Component {
    pub fn from_file(path: &Utf8Path) -> Result<Self, LoadError> {
        Self::from_bytes(&std::fs::read(path)?)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, LoadError> {
        let engine = crate::limits::engine();
        let component = WasmtimeComponent::new(&engine, bytes)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;
        Self::load(engine, component)
    }

    fn load(engine: Engine, component: WasmtimeComponent) -> Result<Self, LoadError> {
        let mut linker: Linker<State> = Linker::new(&engine);
        add_to_linker(&mut linker)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;

        let missing: Vec<String> = component
            .component_type()
            .imports(&engine)
            .map(|(name, _)| name.to_string())
            .filter(|name| name.starts_with(HOST_FAMILY_PREFIX))
            .filter(|name| !FAMILIES_SERVED.iter().any(|served| name.starts_with(served)))
            .collect();
        if !missing.is_empty() {
            return Err(LoadError::UnservedFamilies(missing.join(", ")));
        }
        cap_the_rest(&mut linker, &engine, &component)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;

        let pre = linker
            .instantiate_pre(&component)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;
        let indices = w_plugin::GuestIndices::new(&pre)
            .map_err(|error| LoadError::NotAPlugin(format!("{error:#}")))?;
        let command_indices = w_command::GuestIndices::new(&pre).ok();
        Ok(Self {
            pre,
            indices,
            command_indices,
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
        Ok(Instance {
            store,
            interfaces: Interfaces { plugin, commands },
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
        if FAMILIES_SERVED.iter().any(|served| name.starts_with(served)) {
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
        let component = Component::from_file(path)?;
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
        let specs = commands
            .call_commands(&mut *store)
            .map_err(|error| format!("comandi non dichiarati: il componente è caduto: {error:#}"))?;
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
    fn register(&self, _ws: &mut Workspace) -> Vec<String> {
        vec!["WASM providers require a prepared bundle mount".to_string()]
    }

    /// Crea **una** istanza e consegna due proprietari espliciti dello stesso
    /// `Arc`: il plugin e la closure che registra i provider.
    fn prepare(&self) -> BundleMount<'_> {
        let instance = match self.component.instantiate() {
            Ok(instance) => instance,
            Err(error) => {
                return BundleMount::new(
                    Box::new(FailedPlugin {
                        manifest: self.manifest.clone(),
                        error: error.to_string(),
                    }),
                    |_| RegistrationReport::complete(),
                );
            }
        };

        let inner = Arc::new(Mutex::new(instance));
        let plugin = Box::new(WasmPlugin {
            inner: Arc::clone(&inner),
        });
        let id = self.manifest.id.clone();
        BundleMount::new(plugin, move |ws| {
            let specs = match Self::declared_commands(&inner) {
                Ok(specs) => specs,
                Err(error) => return RegistrationReport::failed(error),
            };
            if specs.is_empty() {
                return RegistrationReport::complete();
            }

            let provider = WasmCommandProvider { inner, specs };
            match ws.register_command_provider(&id, Box::new(provider)) {
                Ok(()) => RegistrationReport::complete(),
                Err(error) => {
                    RegistrationReport::failed(format!("comandi non registrati: {error}"))
                }
            }
        })
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
