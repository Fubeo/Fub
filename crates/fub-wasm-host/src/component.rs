//! Componente WASM, proxy del plugin e bundle montabile.
//!
//! Plugin e provider di uno stesso montaggio condividono esplicitamente una
//! sola istanza tramite [`BundleMount`]. Il bundle non conserva più «l'ultima
//! istanza» fra chiamate: non esiste quindi uno stato temporale implicito che un
//! secondo montaggio o una chiamata fuori sequenza possa sovrascrivere.

use std::cell::RefCell;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
thread_local! {
    static ACTIVE_INSTANCES: RefCell<Vec<*const ()>> = const { RefCell::new(Vec::new()) };
}

pub(crate) struct InstanceGuard {
    identity: *const (),
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        ACTIVE_INSTANCES.with(|active| {
            let mut active = active.borrow_mut();
            if let Some(index) = active
                .iter()
                .rposition(|identity| *identity == self.identity)
            {
                active.remove(index);
            }
        });
    }
}

pub(crate) fn enter_instance(identity: *const ()) -> Result<InstanceGuard, ()> {
    ACTIVE_INSTANCES.with(|active| {
        let mut active = active.borrow_mut();
        if active.contains(&identity) {
            return Err(());
        }
        active.push(identity);
        Ok(InstanceGuard { identity })
    })
}

pub(crate) fn instance_identity(inner: &Mutex<Instance>) -> *const () {
    inner as *const Mutex<Instance> as *const ()
}

use camino::Utf8Path;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::edit::TextEdit;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, LinkInsert, LinkRewrite,
    ParseContext, RenderOptions,
};
use fub_abi::grid::{
    validate_grid_source, GridApplyRequest, GridCommit, GridInvalidation, GridProvider,
    GridSession, GridSurfaceSpec, GridWindow, GridWindowRequest,
};
use fub_abi::model::{DocumentModel, TaskMarker};
use fub_abi::traits::{
    abi_compatible, CommandProvider, HostApi, Plugin, PluginManifest, ReadApi, ViewInstance,
    ViewInterests, ViewProvider, ViewSpec,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::{FormatError, PluginError, Revision};
use fub_host::registry::{Bundle, BundleMount, Registrar, RegistrationReport};
use fub_kernel::Trust;
use wasmtime::component::types::ComponentItem;
use wasmtime::component::{Component as WasmtimeComponent, InstancePre, Linker, ResourceType, Val};
use wasmtime::{Engine, Store};

use crate::borrow::{with_guest, with_read_guest, State};
use crate::contract::exports::fub::abi::command as w_command;
use crate::contract::exports::fub::abi::event_handler as w_event_handler;
use crate::contract::exports::fub::abi::format as w_format;
use crate::contract::exports::fub::abi::format_edits as w_format_edits;
use crate::contract::exports::fub::abi::format_links as w_format_links;
use crate::contract::exports::fub::abi::grid as w_grid;
use crate::contract::exports::fub::abi::index as w_index;
use crate::contract::exports::fub::abi::plugin as w_plugin;
use crate::contract::exports::fub::abi::view as w_view;
use crate::guest::add_to_linker;
use crate::inbound::{event_handler_from_inner, index_provider_from_inner};
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
const FORMAT_LINKS_INTERFACE: &str = "fub:abi/format-links";
const FORMAT_LINKS_EXPORT: &str = "fub:abi/format-links@0.2.0";
const FORMAT_EDITS_INTERFACE: &str = "fub:abi/format-edits";
const FORMAT_EDITS_EXPORT: &str = "fub:abi/format-edits@0.2.0";
const FORMAT_EXPORT: &str = "fub:abi/format@0.2.0";
const VIEW_INTERFACE: &str = "fub:abi/view";
const VIEW_EXPORT: &str = "fub:abi/view@0.2.0";
const GRID_INTERFACE: &str = "fub:abi/grid";
const GRID_EXPORT: &str = "fub:abi/grid@0.2.0";
const INDEX_INTERFACE: &str = "fub:abi/index";
const INDEX_EXPORT: &str = "fub:abi/index@0.2.0";
const EVENT_HANDLER_INTERFACE: &str = "fub:abi/event-handler";
const EVENT_HANDLER_EXPORT: &str = "fub:abi/event-handler@0.2.0";
const COMMAND_INTERFACE: &str = "fub:abi/command";
const COMMAND_EXPORT: &str = "fub:abi/command@0.2.0";
/// Interfacce che `plugin-world` esporta e che questo host non collega: un
/// componente che le esporta viene rifiutato al caricamento, come chi importa
/// una famiglia non servita, invece di montarsi con metà del suo lavoro ignorata.
const EXPORTS_UNSERVED: &[&str] = &[
    "fub:abi/syntax",
    "fub:abi/renderer",
    "fub:abi/service",
    "fub:abi/importer",
    "fub:abi/exporter",
];

/// `name` è `interface`, con o senza versione (`fub:abi/syntax@0.2.0`).
fn names_interface(name: &str, interface: &str) -> bool {
    name == interface
        || (name.starts_with(interface) && name.as_bytes().get(interface.len()) == Some(&b'@'))
}
fn compatible_export_version(name: &str, interface: &str) -> bool {
    let Some(version) = name
        .strip_prefix(interface)
        .and_then(|v| v.strip_prefix('@'))
    else {
        return false;
    };
    // Export names carry a complete, numeric semver. The compatibility
    // decision itself remains in fub-abi, so this host has one ABI policy.
    let complete = version.split('.').count() == 3
        && version
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    complete && abi_compatible(version)
}

fn select_supported_export<'a, I>(names: I, interface: &str, canonical: &str) -> Option<&'a str>
where
    I: IntoIterator<Item = &'a str>,
{
    let names = names.into_iter().collect::<Vec<_>>();
    if let Some(name) = names.iter().copied().find(|name| *name == canonical) {
        return Some(name);
    }
    if let Some(name) = names.iter().copied().find(|name| *name == interface) {
        return Some(name);
    }
    let mut compatible = names
        .into_iter()
        .filter(|name| compatible_export_version(name, interface))
        .collect::<Vec<_>>();
    // Sorting only validated names makes fallback deterministic.
    compatible.sort_unstable();
    compatible.pop()
}

#[cfg(test)]
fn is_supported_format_export(name: &str) -> bool {
    select_supported_export([name], FORMAT_INTERFACE, FORMAT_EXPORT).is_some()
}

fn unsupported_versioned_export(name: &str, interface: &str) -> bool {
    name.starts_with(interface)
        && name.as_bytes().get(interface.len()) == Some(&b'@')
        && !compatible_export_version(name, interface)
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
    /// L'export di un'interfaccia ABI usa una versione non canonica o non compatibile.
    #[error("export ABI non supportato: {0}")]
    UnsupportedExport(String),
    /// Il componente importa una famiglia `host-*` del contratto che questo
    /// host non implementa.
    #[error("il componente importa famiglie che questo host non serve: {0}")]
    UnservedFamilies(String),
    /// Il componente esporta interfacce del contratto che questo host non
    /// collega: nessun adapter le chiamerebbe, e montarlo le ignorerebbe.
    #[error("il componente esporta interfacce che questo host non collega: {0}")]
    UnservedExports(String),
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
    format_links_indices: Option<w_format_links::GuestIndices>,
    format_edits_indices: Option<w_format_edits::GuestIndices>,
    grid_indices: Option<w_grid::GuestIndices>,
    view_indices: Option<w_view::GuestIndices>,
    index_indices: Option<w_index::GuestIndices>,
    event_handler_indices: Option<w_event_handler::GuestIndices>,
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
        let unserved: Vec<String> = component
            .component_type()
            .exports(&engine)
            .map(|(name, _)| name.to_string())
            .filter(|name| {
                EXPORTS_UNSERVED
                    .iter()
                    .any(|interface| names_interface(name, interface))
            })
            .collect();
        if !unserved.is_empty() {
            return Err(LoadError::UnservedExports(unserved.join(", ")));
        }
        cap_the_rest(&mut linker, &engine, &component)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;
        if let Some(name) = component
            .component_type()
            .exports(&engine)
            .map(|(name, _)| name)
            .find(|name| {
                unsupported_versioned_export(name, FORMAT_INTERFACE)
                    || unsupported_versioned_export(name, COMMAND_INTERFACE)
                    || unsupported_versioned_export(name, FORMAT_LINKS_INTERFACE)
                    || unsupported_versioned_export(name, FORMAT_EDITS_INTERFACE)
                    || unsupported_versioned_export(name, VIEW_INTERFACE)
                    || unsupported_versioned_export(name, INDEX_INTERFACE)
                    || unsupported_versioned_export(name, GRID_INTERFACE)
                    || unsupported_versioned_export(name, EVENT_HANDLER_INTERFACE)
            })
        {
            return Err(LoadError::UnsupportedExport(name.to_owned()));
        }
        let pre = linker
            .instantiate_pre(&component)
            .map_err(|error| LoadError::Compilation(format!("{error:#}")))?;
        let format_export_present = select_supported_export(
            component
                .component_type()
                .exports(&engine)
                .map(|(name, _)| name),
            FORMAT_INTERFACE,
            FORMAT_EXPORT,
        )
        .is_some();
        let format_links_export_present = select_supported_export(
            component
                .component_type()
                .exports(&engine)
                .map(|(name, _)| name),
            FORMAT_LINKS_INTERFACE,
            FORMAT_LINKS_EXPORT,
        )
        .is_some();
        let format_edits_export_present = select_supported_export(
            component
                .component_type()
                .exports(&engine)
                .map(|(name, _)| name),
            FORMAT_EDITS_INTERFACE,
            FORMAT_EDITS_EXPORT,
        )
        .is_some();
        let view_export_present = select_supported_export(
            component
                .component_type()
                .exports(&engine)
                .map(|(name, _)| name),
            VIEW_INTERFACE,
            VIEW_EXPORT,
        )
        .is_some();
        let index_export_present = select_supported_export(
            component
                .component_type()
                .exports(&engine)
                .map(|(name, _)| name),
            INDEX_INTERFACE,
            INDEX_EXPORT,
        )
        .is_some();
        let event_handler_export_present = select_supported_export(
            component
                .component_type()
                .exports(&engine)
                .map(|(name, _)| name),
            EVENT_HANDLER_INTERFACE,
            EVENT_HANDLER_EXPORT,
        )
        .is_some();
        let grid_export_present = select_supported_export(
            component
                .component_type()
                .exports(&engine)
                .map(|(name, _)| name),
            GRID_INTERFACE,
            GRID_EXPORT,
        )
        .is_some();
        let command_export_present = select_supported_export(
            component
                .component_type()
                .exports(&engine)
                .map(|(name, _)| name),
            COMMAND_INTERFACE,
            COMMAND_EXPORT,
        )
        .is_some();
        let indices = w_plugin::GuestIndices::new(&pre)
            .map_err(|error| LoadError::NotAPlugin(format!("{error:#}")))?;
        let command_indices = resolve_format_indices(command_export_present, || {
            w_command::GuestIndices::new(&pre)
        })?;
        let format_indices =
            resolve_format_indices(format_export_present, || w_format::GuestIndices::new(&pre))?;
        let format_links_indices = resolve_format_indices(format_links_export_present, || {
            w_format_links::GuestIndices::new(&pre)
        })?;
        let format_edits_indices = resolve_format_indices(format_edits_export_present, || {
            w_format_edits::GuestIndices::new(&pre)
        })?;
        let grid_indices =
            resolve_format_indices(grid_export_present, || w_grid::GuestIndices::new(&pre))?;
        let view_indices =
            resolve_format_indices(view_export_present, || w_view::GuestIndices::new(&pre))?;
        let index_indices =
            resolve_format_indices(index_export_present, || w_index::GuestIndices::new(&pre))?;
        let event_handler_indices = resolve_format_indices(event_handler_export_present, || {
            w_event_handler::GuestIndices::new(&pre)
        })?;
        Ok(Self {
            pre,
            indices,
            command_indices,
            format_indices,
            format_links_indices,
            format_edits_indices,
            grid_indices,
            view_indices,
            index_indices,
            event_handler_indices,
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
        let format_links = match &self.format_links_indices {
            Some(indices) => Some(
                indices
                    .load(&mut store, &instance)
                    .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?,
            ),
            None => None,
        };
        let format_edits = match &self.format_edits_indices {
            Some(indices) => Some(
                indices
                    .load(&mut store, &instance)
                    .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?,
            ),
            None => None,
        };
        let grid = match &self.grid_indices {
            Some(indices) => Some(
                indices
                    .load(&mut store, &instance)
                    .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?,
            ),
            None => None,
        };
        let view = match &self.view_indices {
            Some(indices) => Some(
                indices
                    .load(&mut store, &instance)
                    .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?,
            ),
            None => None,
        };
        let index = match &self.index_indices {
            Some(indices) => Some(
                indices
                    .load(&mut store, &instance)
                    .map_err(|error| LoadError::Instantiation(format!("{error:#}")))?,
            ),
            None => None,
        };
        let event_handler = match &self.event_handler_indices {
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
                format_links,
                format_edits,
                grid,
                view,
                index,
                event_handler,
            },
        })
    }
}

/// Il tetto di una richiesta a `wasi:random`: un guest che vuole un seme o una
/// chiave chiede decine di byte, e una lunghezza da gigabyte è un guasto da
/// fermare prima di allocarla, non da servire.
const WASI_RANDOM_LIMIT: u64 = 64 * 1024;

/// `len` byte dal generatore crittografico del sistema, o una trap se la
/// richiesta supera [`WASI_RANDOM_LIMIT`] o il sistema non ne dà.
fn wasi_random_bytes(len: u64) -> wasmtime::Result<Vec<u8>> {
    use ring::rand::SecureRandom;
    if len > WASI_RANDOM_LIMIT {
        return Err(wasmtime::Error::msg(format!(
            "get-random-bytes: {len} byte richiesti, il limite è {WASI_RANDOM_LIMIT}"
        )));
    }
    let mut bytes = vec![0u8; len as usize];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| wasmtime::Error::msg("il sistema non ha dato byte casuali"))?;
    Ok(bytes)
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
        if name == "wasi:random/random@0.2.3" {
            // Il caso **sicuro** che WASI promette, dal generatore del sistema:
            // un guest che ci fa un uuid o una chiave non deve ricevere sempre
            // gli stessi byte (I70). Nessun'altra porta di WASI si apre.
            let mut instance = linker.instance(name)?;
            instance.func_new("get-random-bytes", |_, params, results| {
                let Some(Val::U64(len)) = params.first() else {
                    return Err(wasmtime::Error::msg(
                        "get-random-bytes: argomento non valido",
                    ));
                };
                results[0] = Val::List(wasi_random_bytes(*len)?.into_iter().map(Val::U8).collect());
                Ok(())
            })?;
            instance.func_new("get-random-u64", |_, _, results| {
                let bytes = wasi_random_bytes(8)?;
                let mut word = [0u8; 8];
                word.copy_from_slice(&bytes);
                results[0] = Val::U64(u64::from_le_bytes(word));
                Ok(())
            })?;
            continue;
        }
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

pub(crate) struct Interfaces {
    plugin: w_plugin::Guest,
    commands: Option<w_command::Guest>,
    format: Option<w_format::Guest>,
    pub(crate) format_links: Option<w_format_links::Guest>,
    pub(crate) format_edits: Option<w_format_edits::Guest>,
    grid: Option<w_grid::Guest>,
    view: Option<w_view::Guest>,
    pub(crate) index: Option<w_index::Guest>,
    pub(crate) event_handler: Option<w_event_handler::Guest>,
}

pub(crate) struct Instance {
    pub(crate) store: Store<State>,
    pub(crate) interfaces: Interfaces,
}

pub(crate) fn call<R>(
    inner: &Mutex<Instance>,
    host: &mut dyn HostApi,
    call: impl FnOnce(&Interfaces, &mut Store<State>) -> Result<R, PluginError>,
) -> Result<R, PluginError> {
    let _guard = enter_instance(instance_identity(inner))
        .map_err(|_| PluginError::Internal("re-entrant component call".into()))?;
    let mut inner = inner
        .lock()
        .map_err(|_| PluginError::Internal("component instance is poisoned".into()))?;
    let Instance { store, interfaces } = &mut *inner;
    let interfaces = &*interfaces;
    with_guest(store, host, |store| call(interfaces, store))
}

fn call_read<R>(
    inner: &Mutex<Instance>,
    host: &dyn ReadApi,
    call: impl FnOnce(&Interfaces, &mut Store<State>) -> Result<R, PluginError>,
) -> Result<R, PluginError> {
    let _guard = enter_instance(instance_identity(inner))
        .map_err(|_| PluginError::Internal("re-entrant component call".into()))?;
    let mut inner = inner
        .lock()
        .map_err(|_| PluginError::Internal("component instance is poisoned".into()))?;
    let Instance { store, interfaces } = &mut *inner;
    let interfaces = &*interfaces;
    with_read_guest(store, host, |store| call(interfaces, store))
}
fn grid_call<R>(
    inner: &Mutex<Instance>,
    call: impl FnOnce(&w_grid::Guest, &mut Store<State>) -> Result<R, PluginError>,
) -> Result<R, PluginError> {
    let _guard = enter_instance(instance_identity(inner))
        .map_err(|_| PluginError::Internal("re-entrant component call".into()))?;
    let mut inner = inner
        .lock()
        .map_err(|_| PluginError::Internal("component instance is poisoned".into()))?;
    let Instance { store, interfaces } = &mut *inner;
    let grid = interfaces
        .grid
        .as_ref()
        .ok_or_else(|| PluginError::Internal("il componente non esporta `fub:abi/grid`".into()))?;
    crate::limits::renew(&mut *store);
    call(grid, store)
}

pub(crate) fn failure(error: wasmtime::Error) -> PluginError {
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

/// Proxy `GridProvider` sopra la stessa istanza del `WasmPlugin` montato.
pub struct WasmGridProvider {
    inner: Arc<Mutex<Instance>>,
    specs: Vec<GridSurfaceSpec>,
}

fn grid_response_error(error: impl std::fmt::Display) -> PluginError {
    PluginError::Internal(format!("malformed grid provider response: {error}").into())
}

fn validate_grid_session_response(
    session: &GridSession,
    expected: &Revision,
    operation: &str,
) -> Result<(), PluginError> {
    session.validate().map_err(grid_response_error)?;
    if &session.revision != expected {
        return Err(grid_response_error(format!(
            "grid {operation} returned an unexpected revision"
        )));
    }
    Ok(())
}

fn validate_grid_window_response(
    window: &GridWindow,
    request: &GridWindowRequest,
) -> Result<(), PluginError> {
    window.validate().map_err(grid_response_error)?;
    if window.revision != request.revision
        || window.sheet != request.sheet
        || window.row_start != request.row_start
        || window.column_start != request.column_start
    {
        return Err(grid_response_error(
            "grid window does not match its request",
        ));
    }
    if window.rows.len() != request.row_count as usize
        || window.columns.len() != request.column_count as usize
    {
        return Err(grid_response_error(
            "grid window axes do not match the requested dimensions",
        ));
    }
    let mut rows = HashSet::with_capacity(window.rows.len());
    for (offset, row) in window.rows.iter().enumerate() {
        if row.id.is_empty()
            || !rows.insert(&row.id)
            || row.index
                != request
                    .row_start
                    .checked_add(offset as u32)
                    .ok_or_else(|| grid_response_error("grid row index overflows"))?
        {
            return Err(grid_response_error("grid window has invalid row metadata"));
        }
    }
    let mut columns = HashSet::with_capacity(window.columns.len());
    for (offset, column) in window.columns.iter().enumerate() {
        if column.id.is_empty()
            || !columns.insert(&column.id)
            || column.index
                != request
                    .column_start
                    .checked_add(offset as u32)
                    .ok_or_else(|| grid_response_error("grid column index overflows"))?
        {
            return Err(grid_response_error(
                "grid window has invalid column metadata",
            ));
        }
    }
    let mut cells = HashSet::with_capacity(window.cells.len());
    for cell in &window.cells {
        if cell.key.sheet != window.sheet
            || !rows.contains(&cell.key.row)
            || !columns.contains(&cell.key.column)
            || !cells.insert(cell.key.clone())
        {
            return Err(grid_response_error(
                "grid window has invalid cell coordinates",
            ));
        }
    }
    Ok(())
}

fn validate_grid_commit_response(
    commit: &GridCommit,
    request: &GridApplyRequest,
) -> Result<(), PluginError> {
    commit.validate().map_err(grid_response_error)?;
    if commit.revision == request.revision {
        return Err(PluginError::Conflict(
            "grid provider commit did not advance revision".into(),
        ));
    }
    if usize::try_from(commit.edit.from).is_err() || usize::try_from(commit.edit.to).is_err() {
        return Err(grid_response_error(
            "grid source diff offset overflows usize",
        ));
    }
    let changed: HashSet<_> = request
        .patches
        .iter()
        .map(|patch| patch.cell.clone())
        .collect();
    match &commit.invalidation {
        GridInvalidation::All => {}
        GridInvalidation::Cells(cells) => {
            let invalidated: HashSet<_> = cells.iter().cloned().collect();
            if !changed.is_subset(&invalidated) {
                return Err(grid_response_error(
                    "grid commit does not invalidate every changed cell",
                ));
            }
        }
    }
    Ok(())
}

impl GridProvider for WasmGridProvider {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        self.specs.clone()
    }

    fn open(
        &mut self,
        surface: &str,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError> {
        validate_grid_source(source)?;
        if Revision::of(source) != revision {
            return Err(PluginError::Conflict(
                "grid source does not match its declared revision".into(),
            ));
        }
        let revision_wit = tr::to_grid_revision(&revision);
        let session = grid_call(&self.inner, |grid, store| {
            grid.call_open(store, surface, source, &revision_wit)
                .map_err(failure)?
                .map_err(tr::from_error)
        })?;
        let session = tr::from_grid_session(session).map_err(grid_response_error)?;
        validate_grid_session_response(&session, &revision, "open")?;
        Ok(session)
    }

    fn window(
        &mut self,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        request.validate()?;
        let request_wit = tr::to_grid_window_request(&request);
        let window = grid_call(&self.inner, |grid, store| {
            grid.call_window(store, instance, &request_wit)
                .map_err(failure)?
                .map_err(tr::from_error)
        })?;
        let window = tr::from_grid_window(window).map_err(grid_response_error)?;
        validate_grid_window_response(&window, &request)?;
        Ok(window)
    }

    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        request.validate()?;
        let request_wit = tr::to_grid_apply_request(&request);
        let commit = grid_call(&self.inner, |grid, store| {
            grid.call_apply(store, instance, &request_wit)
                .map_err(failure)?
                .map_err(tr::from_error)
        })?;
        let commit = tr::from_grid_commit(commit).map_err(grid_response_error)?;
        validate_grid_commit_response(&commit, &request)?;
        Ok(commit)
    }

    fn reload(
        &mut self,
        instance: &str,
        expected: Revision,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError> {
        validate_grid_source(source)?;
        if Revision::of(source) != revision {
            return Err(PluginError::Conflict(
                "grid source does not match its declared revision".into(),
            ));
        }
        let expected_wit = tr::to_grid_revision(&expected);
        let revision_wit = tr::to_grid_revision(&revision);
        let session = grid_call(&self.inner, |grid, store| {
            grid.call_reload(store, instance, &expected_wit, source, &revision_wit)
                .map_err(failure)?
                .map_err(tr::from_error)
        })?;
        let session = tr::from_grid_session(session).map_err(grid_response_error)?;
        validate_grid_session_response(&session, &revision, "reload")?;
        Ok(session)
    }

    fn close(&mut self, instance: &str) -> Result<(), PluginError> {
        grid_call(&self.inner, |grid, store| {
            grid.call_close(store, instance)
                .map_err(failure)?
                .map_err(tr::from_error)
        })
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        grid_call(&self.inner, |grid, store| {
            grid.call_shutdown(store)
                .map_err(failure)?
                .map_err(tr::from_error)
        })
    }
}

/// L'interruttore di un provider di formato WASM: acceso finché il plugin è
/// scelto, **spento per sempre** quando viene disabilitato, revocato, rimosso o
/// aggiornato.
///
/// Il `FormatRegistry` di un vault aperto è fisso per la vita del workspace:
/// il provider resta lì, e senza interruttore il parser di un plugin ritirato
/// continuerebbe a girare fino alla riapertura. Spento, ogni chiamata fallisce
/// con un errore di formato: il codice del plugin non gira più. Un plugin
/// riacceso torna a servire il formato alla prossima apertura, con un'istanza
/// nuova; questa ha visto il suo `deactivate`.
#[derive(Clone, Debug, Default)]
pub(crate) struct FormatSwitch(Arc<std::sync::atomic::AtomicBool>);

impl FormatSwitch {
    /// Spegne il provider. Non si riaccende.
    pub(crate) fn retire(&self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Qualcuno oltre a chi lo tiene nel registro lo vede ancora? Un provider
    /// lasciato cadere con la sua sessione non ha più niente da spegnere.
    pub(crate) fn is_held(&self) -> bool {
        Arc::strong_count(&self.0) > 1
    }

    fn served(&self) -> Result<(), String> {
        if self.0.load(std::sync::atomic::Ordering::SeqCst) {
            Err(
                "provider di formato ritirato: il plugin è stato disabilitato, revocato, \
                 rimosso o aggiornato; torna a servire alla prossima apertura del vault"
                    .into(),
            )
        } else {
            Ok(())
        }
    }
}

/// Proxy `FormatProvider` sopra una singola istanza WASM.
pub struct WasmFormatProvider {
    inner: Arc<Mutex<Instance>>,
    descriptor: FormatDescriptor,
    capabilities: FormatCapabilities,
    switch: FormatSwitch,
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
        self.switch.served().map_err(FormatError::Parse)?;
        let source_wit = tr::to_document_source(source);
        let ctx_wit = tr::to_parse_context(ctx);
        let _guard = enter_instance(instance_identity(self.inner.as_ref()))
            .map_err(|_| FormatError::Parse("re-entrant component call".into()))?;
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
        self.switch.served().map_err(FormatError::Render)?;
        let model_wit = crate::model::to_document(model.clone())
            .map_err(|error| FormatError::Render(error.to_string()))?;
        let opts_wit = tr::to_render_options(opts);
        let _guard = enter_instance(instance_identity(self.inner.as_ref()))
            .map_err(|_| FormatError::Render("re-entrant component call".into()))?;
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
        self.switch.served().map_err(FormatError::Serialize)?;
        let model_wit = crate::model::to_document(model.clone())
            .map_err(|error| FormatError::Serialize(error.to_string()))?;
        let _guard = enter_instance(instance_identity(self.inner.as_ref()))
            .map_err(|_| FormatError::Serialize("re-entrant component call".into()))?;
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

    fn rewrite_links(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
        rewrites: &[LinkRewrite],
    ) -> Result<Option<Vec<TextEdit>>, FormatError> {
        self.switch.served().map_err(FormatError::Parse)?;
        crate::format_links::call_rewrite_links(&self.inner, source, ctx, rewrites)
    }

    fn format_link(
        &self,
        ctx: &ParseContext,
        link: &LinkInsert,
    ) -> Result<Option<String>, FormatError> {
        self.switch.served().map_err(FormatError::Parse)?;
        crate::format_links::call_format_link(&self.inner, ctx, link)
    }

    fn set_task_state(
        &self,
        source: &DocumentSource,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Option<Vec<TextEdit>>, FormatError> {
        self.switch.served().map_err(FormatError::Parse)?;
        crate::format_links::call_set_task_state(&self.inner, source, marker, done)
    }
}
/// Proxy `ViewProvider` sopra la stessa istanza WASM.
pub struct WasmViewProvider {
    inner: Arc<Mutex<Instance>>,
    specs: Vec<ViewSpec>,
}

impl WasmViewProvider {
    fn try_interests(&self, instance: &ViewInstance) -> Result<ViewInterests, PluginError> {
        let wit_instance = tr::to_view_instance(instance)?;
        let _guard = enter_instance(instance_identity(&self.inner))
            .map_err(|_| PluginError::Internal("re-entrant component call".into()))?;
        let mut locked = self
            .inner
            .lock()
            .map_err(|_| PluginError::Internal("component instance is poisoned".into()))?;
        let Instance { store, interfaces } = &mut *locked;
        let view = interfaces.view.as_ref().ok_or_else(|| {
            PluginError::Internal("il componente non esporta `fub:abi/view`".into())
        })?;
        crate::limits::renew(&mut *store);
        let interests = view
            .call_interests(&mut *store, &wit_instance)
            .map_err(failure)?;
        tr::from_view_interests(interests)
    }
}

impl ViewProvider for WasmViewProvider {
    fn views(&self) -> Vec<ViewSpec> {
        self.specs.clone()
    }

    /// Il trait risponde un valore e non un esito, e la domanda arriva sul
    /// thread dell'host mentre registra la view: un guest che cade qui — trap,
    /// tempo scaduto, memoria finita — non può portarsi dietro il processo.
    /// Il guasto diventa «nessun interesse»: la view resta disegnabile, e
    /// `render_view`, che un esito ce l'ha, dirà cosa non va.
    fn interests(&self, instance: &ViewInstance) -> ViewInterests {
        self.try_interests(instance).unwrap_or_else(|error| {
            tracing::warn!(
                target: "fub.wasm",
                view = %instance.view,
                %error,
                "interessi della view non disponibili: nessun aggiornamento automatico"
            );
            ViewInterests::default()
        })
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let wit_instance = tr::to_view_instance(instance)?;
        call_read(&self.inner, host, |interfaces, store| {
            let view = interfaces.view.as_ref().ok_or_else(|| {
                PluginError::Internal("il componente non esporta `fub:abi/view`".into())
            })?;
            let tree = view
                .call_render_view(store, &wit_instance)
                .map_err(failure)?
                .map_err(tr::from_error)?;
            crate::ui::from_tree(tree)
        })
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        let wit_instance = tr::to_view_instance(instance)?;
        let wit_action = crate::ui::to_action(&action)?;
        call(&self.inner, host, |interfaces, store| {
            let view = interfaces.view.as_ref().ok_or_else(|| {
                PluginError::Internal("il componente non esporta `fub:abi/view`".into())
            })?;
            let update = view
                .call_on_action(store, &wit_instance, &wit_action)
                .map_err(failure)?
                .map_err(tr::from_error)?;
            crate::ui::from_update(update)
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

    fn declared_views(inner: &Mutex<Instance>) -> Result<Vec<ViewSpec>, String> {
        let mut instance = inner
            .lock()
            .map_err(|_| "component instance is poisoned".to_string())?;
        let Instance { store, interfaces } = &mut *instance;
        let Some(view) = interfaces.view.as_ref() else {
            return Ok(Vec::new());
        };
        crate::limits::renew(&mut *store);
        let specs = view
            .call_views(&mut *store)
            .map_err(|error| format!("view non dichiarate: il componente è caduto: {error:#}"))?;
        specs
            .into_iter()
            .map(tr::from_view_spec)
            .collect::<Result<_, _>>()
            .map_err(|error| format!("view non traducibili: {error}"))
    }
    fn declared_grids(inner: &Mutex<Instance>) -> Result<Vec<GridSurfaceSpec>, String> {
        let mut instance = inner
            .lock()
            .map_err(|_| "component instance is poisoned".to_string())?;
        let Instance { store, interfaces } = &mut *instance;
        let Some(grid) = interfaces.grid.as_ref() else {
            return Ok(Vec::new());
        };
        crate::limits::renew(&mut *store);
        let surfaces = grid
            .call_surfaces(&mut *store)
            .map_err(|error| format!("grid non dichiarate: il componente è caduto: {error:#}"))?;
        let mut supported = Vec::new();
        for surface in surfaces {
            if let Some(surface) = tr::from_optional_grid_surface(surface)
                .map_err(|error| format!("grid non traducibili: {error}"))?
            {
                supported.push(surface);
            }
        }
        Ok(supported)
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
        switch: FormatSwitch,
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
            switch,
        })))
    }

    /// Prepara il provider di formato opzionale e ne congela i metadati.
    pub fn format_provider(&self) -> Result<Option<Box<dyn FormatProvider>>, PluginError> {
        let instance = self
            .component
            .instantiate()
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        Self::format_provider_from_inner(Arc::new(Mutex::new(instance)), FormatSwitch::default())
    }

    fn grid_provider_from_inner(
        inner: Arc<Mutex<Instance>>,
    ) -> Result<Option<Box<dyn GridProvider>>, PluginError> {
        let specs =
            Self::declared_grids(&inner).map_err(|error| PluginError::Internal(error.into()))?;
        if specs.is_empty() {
            return Ok(None);
        }
        Ok(Some(Box::new(WasmGridProvider { inner, specs })))
    }

    /// Prepara il provider grid opzionale e ne congela il binding negoziato.
    pub fn grid_provider(&self) -> Result<Option<Box<dyn GridProvider>>, PluginError> {
        let instance = self
            .component
            .instantiate()
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        Self::grid_provider_from_inner(Arc::new(Mutex::new(instance)))
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
        // Comandi, view e griglie si chiedono qui, dopo `Plugin::activate`,
        // come fa un bundle nativo che li registra dal suo passo: un
        // componente che li costruisce in `activate` li dichiara pieni.
        let command_specs = match WasmBundle::declared_commands(&inner) {
            Ok(specs) => specs,
            Err(error) => return RegistrationReport::failed(error),
        };
        let view_specs = match WasmBundle::declared_views(&inner) {
            Ok(specs) => specs,
            Err(error) => return RegistrationReport::failed(error),
        };
        let grid_specs = match WasmBundle::declared_grids(&inner) {
            Ok(specs) => specs,
            Err(error) => return RegistrationReport::failed(error),
        };
        // Inbound declarations run here — after `Plugin::activate`, on the
        // same thread that registers — so a trapped component fails with the
        // declaration error, not a poisoned-instance activation error.
        let index_provider = match index_provider_from_inner(Arc::clone(&inner)) {
            Ok(provider) => provider,
            Err(error) => return RegistrationReport::failed(error),
        };
        let event_handler = match event_handler_from_inner(Arc::clone(&inner)) {
            Ok(handler) => handler,
            Err(error) => return RegistrationReport::failed(error),
        };
        if !grid_specs.is_empty() {
            let provider = WasmGridProvider {
                inner: Arc::clone(&inner),
                specs: grid_specs,
            };
            if let Err(error) = registrar.register_grid_provider(Box::new(provider)) {
                return RegistrationReport::failed(format!("grid non registrato: {error}"));
            }
        }
        if !command_specs.is_empty() {
            let provider = WasmCommandProvider {
                inner: Arc::clone(&inner),
                specs: command_specs,
            };
            if let Err(error) = registrar.register_command_provider(Box::new(provider)) {
                return RegistrationReport::failed(format!("comandi non registrati: {error}"));
            }
        }
        if !view_specs.is_empty() {
            let provider = WasmViewProvider {
                inner: Arc::clone(&inner),
                specs: view_specs,
            };
            if let Err(error) = registrar.register_view_provider(Box::new(provider)) {
                return RegistrationReport::failed(format!("view non registrate: {error}"));
            }
        }
        if let Some(provider) = index_provider {
            if let Err(error) = registrar.register_index_provider(Box::new(provider)) {
                return RegistrationReport::failed(format!("indice non registrato: {error}"));
            }
        }
        if let Some(handler) = event_handler {
            if let Err(error) = registrar.register_event_handler(Box::new(handler)) {
                return RegistrationReport::failed(format!("eventi non registrati: {error}"));
            }
        }
        RegistrationReport::complete()
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
    /// Il provider di formato di questa apertura, dietro `switch`: chi lo
    /// prepara tiene l'interruttore per spegnerlo quando il plugin si ritira.
    pub(crate) fn format_provider(
        &self,
        switch: FormatSwitch,
    ) -> Result<Option<Box<dyn FormatProvider>>, PluginError> {
        let inner = self
            .instance
            .as_ref()
            .map(Arc::clone)
            .map_err(|error| PluginError::Internal(error.clone().into()))?;
        WasmBundle::format_provider_from_inner(inner, switch)
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
    use super::{
        enter_instance, is_supported_format_export, resolve_format_indices,
        select_supported_export, unsupported_versioned_export, wasi_random_bytes, FORMAT_EXPORT,
        FORMAT_INTERFACE, WASI_RANDOM_LIMIT,
    };
    use std::sync::Mutex;

    /// `wasi:random` dà la lunghezza chiesta e byte che cambiano: prima dava
    /// sempre gli stessi otto, a qualunque lunghezza (I70).
    #[test]
    fn wasi_random_serves_the_requested_length_and_never_repeats() {
        assert_eq!(wasi_random_bytes(0).unwrap().len(), 0);
        let first = wasi_random_bytes(32).unwrap();
        let second = wasi_random_bytes(32).unwrap();
        assert_eq!(first.len(), 32);
        assert_ne!(first, second, "two draws of 32 bytes do not coincide");
        assert_eq!(
            wasi_random_bytes(WASI_RANDOM_LIMIT).unwrap().len(),
            64 * 1024
        );
        assert!(wasi_random_bytes(WASI_RANDOM_LIMIT + 1).is_err());
    }
    #[test]
    fn instance_guard_rejects_reentry_and_cleans_up_nested_instances() {
        let first = Mutex::new(());
        let second = Mutex::new(());
        let first_id = &first as *const Mutex<()> as *const ();
        let second_id = &second as *const Mutex<()> as *const ();

        let first_guard = enter_instance(first_id).expect("first entry should succeed");
        assert!(enter_instance(first_id).is_err());
        let second_guard = enter_instance(second_id).expect("nested distinct entry should succeed");
        drop(second_guard);
        assert!(enter_instance(first_id).is_err());
        drop(first_guard);
        assert!(enter_instance(first_id).is_ok());
    }
    #[test]
    fn format_export_accepts_only_canonical_compatible_versions() {
        assert!(is_supported_format_export(FORMAT_EXPORT));
        assert!(is_supported_format_export("fub:abi/format"));
        assert!(is_supported_format_export("fub:abi/format@0.1.0"));
        assert!(is_supported_format_export("fub:abi/format@0.1.2"));
        assert!(is_supported_format_export("fub:abi/format@0.2.0"));
        assert!(!is_supported_format_export("fub:abi/format@1.1.1"));
        assert!(!is_supported_format_export("fub:abi/format@9.9.9"));
        assert!(!is_supported_format_export("fub:abi/format@"));
        assert!(!is_supported_format_export("fub:abi/format@0.1"));
        assert!(!is_supported_format_export("fub:abi/format@0.1.x"));
        assert!(!is_supported_format_export("fub:abi/format@0.1.1.extra"));
        assert!(!is_supported_format_export("fub:abi/formatting@0.1.1"));
        assert!(!is_supported_format_export("fub:abi/format-extra@0.1.1"));
        assert!(unsupported_versioned_export(
            "fub:abi/format@9.9.9",
            FORMAT_INTERFACE
        ));
        assert!(!unsupported_versioned_export(
            "fub:abi/format@0.1.2",
            FORMAT_INTERFACE
        ));
        assert!(!is_supported_format_export("foreign:fub/abi/format@0.1.1"));
    }

    #[test]
    fn export_fallback_is_deterministic_and_prefers_canonical() {
        let names = [
            "fub:abi/format@0.1.0",
            "fub:abi/format@0.1.2",
            "fub:abi/format@9.9.9",
            "fub:abi/format@0.2.0",
        ];
        assert_eq!(
            select_supported_export(names, FORMAT_INTERFACE, FORMAT_EXPORT),
            Some("fub:abi/format@0.2.0")
        );
        assert_eq!(
            select_supported_export(
                ["fub:abi/format@0.1.0", "fub:abi/format@0.1.1"],
                FORMAT_INTERFACE,
                FORMAT_EXPORT
            ),
            Some("fub:abi/format@0.1.1")
        );
        assert_eq!(
            select_supported_export(
                ["fub:abi/format@9.9.9", "fub:abi/format@0.3.0"],
                FORMAT_INTERFACE,
                FORMAT_EXPORT
            ),
            None
        );
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
