//! Orchestrazione delle installazioni macchina e del loro lifecycle nei vault.

use std::collections::BTreeMap;
use std::io;
use std::sync::{Arc, Condvar, Mutex};

use camino::Utf8Path;
use fub_abi::PluginError;
use fub_host::registry::BundleKind;
use fub_host::{
    BundleClaim, BundleInfo, Custody, Host, StartupBundle, StartupSnapshot, StartupSource,
    StartupValidity,
};
use fub_kernel::Trust;
use serde::Serialize;

use crate::installed::{
    Consent, InstallError, InstalledPlugin, InstalledPluginStore, InventorySnapshot,
};
use crate::{LoadError, WasmBundle};

/// Vista serializzabile di un'installazione e del suo stato runtime nel vault scelto.
#[derive(Clone, Debug, Serialize)]
pub struct InstalledPluginInfo {
    /// Metadati condivisi con l'inventario runtime dei bundle.
    #[serde(flatten)]
    pub bundle: BundleInfo,
    /// Identità monotona dell'installazione, trasportata come stringa JSON.
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub installation: u64,
    /// Versione dichiarata dagli esatti byte installati.
    pub version: String,
    /// Scelta persistente di abilitazione, distinta dal mount riuscito.
    pub enabled: bool,
    /// Consenso all'esecuzione degli esatti byte installati.
    pub consent: Consent,
    /// Il vault scelto conosce questo bundle con il claim dell'installazione.
    pub runtime_known: bool,
}

struct InstallationState {
    claim: BundleClaim,
    turn: Custody<()>,
}

struct ManagerState {
    validity: Arc<StartupValidity>,
    installations: BTreeMap<u64, Arc<InstallationState>>,
}

#[derive(Default)]
struct OperationState {
    stopping: bool,
    active: usize,
}

struct OperationLifecycle {
    state: Mutex<OperationState>,
    drained: Condvar,
}

struct Operation {
    lifecycle: Arc<OperationLifecycle>,
}

impl OperationLifecycle {
    fn new() -> Self {
        Self {
            state: Mutex::new(OperationState::default()),
            drained: Condvar::new(),
        }
    }

    fn enter(self: &Arc<Self>) -> Result<Operation, PluginError> {
        let mut state = self.state.lock().map_err(|_| manager_poisoned())?;
        if state.stopping {
            return Err(PluginError::Cancelled(
                "la gestione dei componenti si sta chiudendo".into(),
            ));
        }
        state.active = state
            .active
            .checked_add(1)
            .ok_or_else(|| PluginError::Internal("troppe operazioni componenti attive".into()))?;
        Ok(Operation {
            lifecycle: Arc::clone(self),
        })
    }

    fn shutdown(&self) -> Result<(), PluginError> {
        let mut state = self.state.lock().map_err(|_| manager_poisoned())?;
        state.stopping = true;
        while state.active != 0 {
            state = self.drained.wait(state).map_err(|_| manager_poisoned())?;
        }
        Ok(())
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        let Ok(mut state) = self.lifecycle.state.lock() else {
            return;
        };
        state.active = state.active.saturating_sub(1);
        if state.active == 0 {
            self.lifecycle.drained.notify_all();
        }
    }
}

/// Possiede l'inventario installato, i claim runtime e i turni delle decisioni.
pub struct InstalledPluginManager {
    store: InstalledPluginStore,
    state: Custody<ManagerState>,
    validity_turn: Custody<()>,
    operations: Arc<OperationLifecycle>,
}

impl InstalledPluginManager {
    /// Apre lo store nella configurazione macchina già scelta dal composition root.
    pub fn open(config: &Utf8Path) -> Result<Self, PluginError> {
        Ok(Self {
            store: InstalledPluginStore::open(config).map_err(plugin_error)?,
            state: Custody::new(
                "installed plugin manager",
                ManagerState {
                    validity: Arc::new(StartupValidity::new()),
                    installations: BTreeMap::new(),
                },
            ),
            validity_turn: Custody::new("installed plugin startup validity", ()),
            operations: Arc::new(OperationLifecycle::new()),
        })
    }

    /// Store autorevole, esposto per integrazioni headless che devono ispezionarlo.
    pub fn store(&self) -> &InstalledPluginStore {
        &self.store
    }

    /// Impedisce nuovi ingressi e aspetta operazioni e aperture già ammesse.
    pub fn shutdown(&self) -> Result<(), PluginError> {
        self.operations.shutdown()?;
        self.replace_and_invalidate_validity()
    }

    /// Ammette un'operazione prima di accodarla su un executor esterno.
    pub fn begin_operation(self: &Arc<Self>) -> Result<InstalledOperation, PluginError> {
        Ok(InstalledOperation {
            manager: Arc::clone(self),
            _admission: self.operations.enter()?,
        })
    }

    /// Elenca ogni record persistito senza leggere, compilare o eseguire il guest.
    pub fn list(
        &self,
        host: &Host,
        vault: Option<&str>,
    ) -> Result<Vec<InstalledPluginInfo>, PluginError> {
        let _operation = self.operations.enter()?;
        self.list_inner(host, vault)
    }

    fn list_inner(
        &self,
        host: &Host,
        vault: Option<&str>,
    ) -> Result<Vec<InstalledPluginInfo>, PluginError> {
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        snapshot
            .plugins()
            .iter()
            .map(|plugin| {
                let state = self.installation_state(plugin.installation)?;
                self.info(host, vault, plugin, &state.claim)
            })
            .collect()
    }

    /// Valida e installa una sorgente scelta esplicitamente, senza montarla.
    pub fn install(&self, source: &Utf8Path) -> Result<InstalledPluginInfo, PluginError> {
        let _operation = self.operations.enter()?;
        self.install_inner(source)
    }

    fn install_inner(&self, source: &Utf8Path) -> Result<InstalledPluginInfo, PluginError> {
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        let installed = self
            .store
            .install(&snapshot, source)
            .map_err(plugin_error)?;
        self.installation_state(installed.installation)?;
        Ok(metadata_info(&installed, false, false))
    }

    /// Persiste la scelta enabled e riconcilia soltanto l'istanza posseduta.
    pub fn set_enabled(
        &self,
        host: &Host,
        installation: u64,
        enabled: bool,
    ) -> Result<Vec<PluginError>, PluginError> {
        let _operation = self.operations.enter()?;
        self.set_enabled_inner(host, installation, enabled)
    }

    /// Variante legacy per id: delega solo quando il runtime appartiene al manager.
    pub fn set_enabled_by_id(
        &self,
        host: &Host,
        vault: Option<&str>,
        id: &str,
        enabled: bool,
    ) -> Result<Option<Vec<PluginError>>, PluginError> {
        let _operation = self.operations.enter()?;
        self.set_enabled_by_id_inner(host, vault, id, enabled)
    }

    fn set_enabled_by_id_inner(
        &self,
        host: &Host,
        vault: Option<&str>,
        id: &str,
        enabled: bool,
    ) -> Result<Option<Vec<PluginError>>, PluginError> {
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        let Some(installed) = snapshot
            .plugins()
            .iter()
            .find(|plugin| plugin.manifest.id == id)
        else {
            return Ok(None);
        };
        let state = self.installation_state(installed.installation)?;
        let _turn = state.turn.write_turn();
        if !host.bundle_is_owned(vault, id, &state.claim)? {
            return Ok(None);
        }
        self.set_enabled_for_state(host, installed.installation, enabled, &state)
            .map(Some)
    }

    fn set_enabled_inner(
        &self,
        host: &Host,
        installation: u64,
        enabled: bool,
    ) -> Result<Vec<PluginError>, PluginError> {
        let state = self.installation_state(installation)?;
        let _turn = state.turn.write_turn();
        self.set_enabled_for_state(host, installation, enabled, &state)
    }

    fn set_enabled_for_state(
        &self,
        host: &Host,
        installation: u64,
        enabled: bool,
        state: &InstallationState,
    ) -> Result<Vec<PluginError>, PluginError> {
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        let before = installed_from(&snapshot, installation)?.clone();
        let changed = before.enabled != enabled;
        if changed {
            self.store
                .set_enabled(&snapshot, installation, enabled)
                .map_err(plugin_error)?;
        }
        let mut after = before;
        after.enabled = enabled;
        if changed {
            if let Err(error) = self.replace_and_invalidate_validity() {
                return Ok(vec![error]);
            }
        }
        Ok(self.reconcile(host, &after, state))
    }

    /// Persiste il consenso e riconcilia soltanto l'istanza posseduta.
    pub fn set_consent(
        &self,
        host: &Host,
        installation: u64,
        consent: Consent,
    ) -> Result<Vec<PluginError>, PluginError> {
        let _operation = self.operations.enter()?;
        self.set_consent_inner(host, installation, consent)
    }

    fn set_consent_inner(
        &self,
        host: &Host,
        installation: u64,
        consent: Consent,
    ) -> Result<Vec<PluginError>, PluginError> {
        let state = self.installation_state(installation)?;
        let _turn = state.turn.write_turn();
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        let before = installed_from(&snapshot, installation)?.clone();
        let changed = before.consent != consent;
        if changed {
            self.store
                .set_consent(&snapshot, installation, consent)
                .map_err(plugin_error)?;
        }
        let mut after = before;
        after.consent = consent;
        if changed {
            if let Err(error) = self.replace_and_invalidate_validity() {
                return Ok(vec![error]);
            }
        }
        Ok(self.reconcile(host, &after, &state))
    }

    /// Smonta e dimentica l'installazione disabilitata prima di ritirarne il record.
    pub fn remove(&self, host: &Host, installation: u64) -> Result<Vec<PluginError>, PluginError> {
        let _operation = self.operations.enter()?;
        self.remove_inner(host, installation)
    }

    fn remove_inner(
        &self,
        host: &Host,
        installation: u64,
    ) -> Result<Vec<PluginError>, PluginError> {
        let state = self.installation_state(installation)?;
        let _turn = state.turn.write_turn();
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        let installed = installed_from(&snapshot, installation)?.clone();
        if installed.enabled {
            return Err(PluginError::PermissionDenied(
                "disabilitare il componente prima di rimuoverlo".into(),
            ));
        }

        self.replace_and_invalidate_validity()?;
        let mut errors = Vec::new();
        for vault in host.vaults() {
            let vault = Some(vault.as_str());
            match host.set_bundle_active(vault, &installed.manifest.id, &state.claim, false) {
                Ok(mut teardown) => errors.append(&mut teardown),
                Err(error) => return Err(error),
            }
            if host.bundle_is_owned(vault, &installed.manifest.id, &state.claim)? {
                host.forget_bundle(vault, &installed.manifest.id, &state.claim)?;
            }
        }

        let removal = self
            .store
            .remove(&snapshot, installation)
            .map_err(plugin_error)?;
        if let Some(error) = removal.cleanup_error {
            errors.push(io_error(error));
        }
        Ok(errors)
    }

    fn installation_state(&self, installation: u64) -> Result<Arc<InstallationState>, PluginError> {
        if let Some(state) = self.state.read()?.installations.get(&installation).cloned() {
            return Ok(state);
        }
        let mut manager = self.state.write()?;
        Ok(manager
            .installations
            .entry(installation)
            .or_insert_with(|| {
                Arc::new(InstallationState {
                    claim: BundleClaim::default(),
                    turn: Custody::new("installed plugin decision", ()),
                })
            })
            .clone())
    }

    fn replace_and_invalidate_validity(&self) -> Result<(), PluginError> {
        let _turn = self.validity_turn.write_turn();
        let previous = {
            let mut state = self.state.write()?;
            std::mem::replace(&mut state.validity, Arc::new(StartupValidity::new()))
        };
        previous.invalidate()
    }

    fn reconcile(
        &self,
        host: &Host,
        installed: &InstalledPlugin,
        state: &InstallationState,
    ) -> Vec<PluginError> {
        let selected = installed.requested_at_startup();
        let bundle = if selected {
            match self.load_bundle(installed) {
                Ok(bundle) => Some(Arc::new(bundle) as Arc<dyn fub_host::Bundle>),
                Err(error) => return vec![error],
            }
        } else {
            None
        };

        let mut errors = Vec::new();
        for vault in host.vaults() {
            let vault = Some(vault.as_str());
            if let Some(bundle) = &bundle {
                if let Err(error) = host.remember_bundle(vault, Arc::clone(bundle), &state.claim) {
                    errors.push(error);
                    continue;
                }
                match host.set_bundle_active(vault, &installed.manifest.id, &state.claim, true) {
                    Ok(mut activation) => errors.append(&mut activation),
                    Err(error) => {
                        errors.push(error);
                        if let Err(error) =
                            host.forget_bundle(vault, &installed.manifest.id, &state.claim)
                        {
                            errors.push(error);
                        }
                    }
                }
            } else {
                match host.set_bundle_active(vault, &installed.manifest.id, &state.claim, false) {
                    Ok(mut teardown) => errors.append(&mut teardown),
                    Err(error) => errors.push(error),
                }
            }
        }
        errors
    }

    fn load_bundle(&self, installed: &InstalledPlugin) -> Result<WasmBundle, PluginError> {
        self.store
            .load(installed)
            .map_err(plugin_error)?
            .validate()
            .map_err(plugin_error)
    }

    fn info(
        &self,
        host: &Host,
        vault: Option<&str>,
        installed: &InstalledPlugin,
        claim: &BundleClaim,
    ) -> Result<InstalledPluginInfo, PluginError> {
        if vault.is_none() {
            return Ok(metadata_info(installed, false, false));
        }
        let runtime_known = host.bundle_is_owned(vault, &installed.manifest.id, claim)?;
        let mounted = host.is_bundle_active(vault, &installed.manifest.id, claim)?;
        Ok(metadata_info(installed, mounted, runtime_known))
    }
}

/// Ammissione owned che resta viva anche mentre l'operazione attende un executor.
pub struct InstalledOperation {
    manager: Arc<InstalledPluginManager>,
    _admission: Operation,
}

impl InstalledOperation {
    /// Elenca i metadata sotto l'ammissione già ottenuta.
    pub fn list(
        &self,
        host: &Host,
        vault: Option<&str>,
    ) -> Result<Vec<InstalledPluginInfo>, PluginError> {
        self.manager.list_inner(host, vault)
    }

    /// Installa la sorgente sotto l'ammissione già ottenuta.
    pub fn install(&self, source: &Utf8Path) -> Result<InstalledPluginInfo, PluginError> {
        self.manager.install_inner(source)
    }

    /// Cambia enabled per identità sotto l'ammissione già ottenuta.
    pub fn set_enabled(
        &self,
        host: &Host,
        installation: u64,
        enabled: bool,
    ) -> Result<Vec<PluginError>, PluginError> {
        self.manager.set_enabled_inner(host, installation, enabled)
    }

    /// Risolve il toggle legacy solo se il runtime appartiene all'installazione.
    pub fn set_enabled_by_id(
        &self,
        host: &Host,
        vault: Option<&str>,
        id: &str,
        enabled: bool,
    ) -> Result<Option<Vec<PluginError>>, PluginError> {
        self.manager
            .set_enabled_by_id_inner(host, vault, id, enabled)
    }

    /// Cambia consenso sotto l'ammissione già ottenuta.
    pub fn set_consent(
        &self,
        host: &Host,
        installation: u64,
        consent: Consent,
    ) -> Result<Vec<PluginError>, PluginError> {
        self.manager.set_consent_inner(host, installation, consent)
    }

    /// Rimuove l'installazione sotto l'ammissione già ottenuta.
    pub fn remove(&self, host: &Host, installation: u64) -> Result<Vec<PluginError>, PluginError> {
        self.manager.remove_inner(host, installation)
    }
}

impl StartupSource for InstalledPluginManager {
    fn prepare(&self) -> Result<StartupSnapshot, PluginError> {
        let _operation = self.operations.enter()?;
        let validity = Arc::clone(&self.state.read()?.validity);
        let lease = validity.acquire()?;
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        let mut bundles = Vec::new();
        let mut diagnostics = Vec::new();
        for installed in snapshot
            .plugins()
            .iter()
            .filter(|installed| installed.requested_at_startup())
        {
            let state = self.installation_state(installed.installation)?;
            match self.load_bundle(installed) {
                Ok(bundle) => bundles.push(StartupBundle::new(
                    Arc::new(bundle),
                    true,
                    state.claim.clone(),
                )),
                Err(mut error) => {
                    let message = error.message().to_string();
                    *error.message_mut() = format!(
                        "plugin `{}` (installazione {}): {message}",
                        installed.manifest.id, installed.installation,
                    )
                    .into();
                    diagnostics.push(error);
                }
            }
        }
        Ok(StartupSnapshot {
            bundles,
            diagnostics,
            validity: Some(validity),
            lease: Some(lease),
        })
    }
}

fn installed_from(
    snapshot: &InventorySnapshot,
    installation: u64,
) -> Result<&InstalledPlugin, PluginError> {
    snapshot
        .plugins()
        .iter()
        .find(|plugin| plugin.installation == installation)
        .ok_or_else(|| PluginError::NotFound(format!("installazione {installation}").into()))
}

fn metadata_info(
    installed: &InstalledPlugin,
    mounted: bool,
    runtime_known: bool,
) -> InstalledPluginInfo {
    InstalledPluginInfo {
        bundle: BundleInfo {
            id: installed.manifest.id.clone(),
            name: installed.manifest.name.clone(),
            mounted,
            kind: BundleKind::Component,
            trust: Trust::Community,
            permissions: installed.manifest.permissions.granted.clone(),
        },
        installation: installed.installation,
        version: installed.manifest.version.clone(),
        enabled: installed.enabled,
        consent: installed.consent,
        runtime_known,
    }
}

fn plugin_error(error: InstallError) -> PluginError {
    match error {
        InstallError::Io(error) => io_error(error),
        InstallError::Operation { operation, source } => {
            let kind = source.kind();
            let message = format!("{operation}: {source}");
            io_kind_error(kind, message)
        }
        InstallError::Component(error) => load_error(error),
        InstallError::Json(error) => {
            PluginError::BadArgs(format!("inventario dei componenti non leggibile: {error}").into())
        }
        InstallError::Schema(version) => PluginError::BadArgs(
            format!("schema inventario componenti {version} non supportato").into(),
        ),
        InstallError::Invalid(message) => PluginError::BadArgs(message.into()),
        InstallError::Abi(version) => {
            PluginError::BadArgs(format!("ABI `{version}` non supportata").into())
        }
        InstallError::AlreadyInstalled {
            id,
            installed,
            candidate,
        } => PluginError::AlreadyExists(
            format!(
                "plugin `{id}` già installato alla versione `{installed}`; candidato `{candidate}`"
            )
            .into(),
        ),
        InstallError::Conflict => {
            PluginError::Conflict("inventario dei componenti cambiato".into())
        }
        InstallError::Missing(installation) => {
            PluginError::NotFound(format!("installazione {installation}").into())
        }
        InstallError::Integrity(installation) => PluginError::Conflict(
            format!("byte dell'installazione {installation} non più integri").into(),
        ),
    }
}

fn load_error(error: LoadError) -> PluginError {
    match error {
        LoadError::Read(error) => io_error(error),
        LoadError::Compilation(message) => PluginError::BadArgs(message.into()),
        LoadError::UnservedFamilies(message) => PluginError::BadArgs(message.into()),
        LoadError::NotAPlugin(message) => PluginError::BadArgs(message.into()),
        LoadError::Instantiation(message) => PluginError::BadArgs(message.into()),
    }
}

fn io_error(error: io::Error) -> PluginError {
    let kind = error.kind();
    io_kind_error(kind, error.to_string())
}

fn io_kind_error(kind: io::ErrorKind, message: String) -> PluginError {
    match kind {
        io::ErrorKind::PermissionDenied => PluginError::PermissionDenied(message.into()),
        io::ErrorKind::NotFound => PluginError::NotFound(message.into()),
        io::ErrorKind::AlreadyExists => PluginError::AlreadyExists(message.into()),
        io::ErrorKind::InvalidInput | io::ErrorKind::InvalidData => {
            PluginError::BadArgs(message.into())
        }
        _ => PluginError::Io(message.into()),
    }
}

fn manager_poisoned() -> PluginError {
    PluginError::Internal("lifecycle della gestione componenti avvelenato".into())
}
