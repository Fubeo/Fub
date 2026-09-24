//! Orchestrazione delle installazioni macchina e del loro lifecycle nei vault.
//!
//! Installazione, consenso agli esatti byte, scelta `enabled` e mount riuscito
//! restano distinti. La revoca firmata è un veto ulteriore, persistito: solo
//! `enabled && Granted && !revoked` propone il mount. Un bundle guasto diventa
//! una diagnosi in `StartupSnapshot::diagnostics` senza nascondere gli altri;
//! [`InstalledPluginManager::limited_startup`] sceglie invece esplicitamente
//! un avvio senza alcun componente e con diagnosi tipizzata.

use std::collections::BTreeMap;
use std::io;
use std::sync::{Arc, Condvar, Mutex};

use crate::budgets::{self, BudgetSnapshot};
use crate::catalog::{self, CatalogEntry, CatalogError, CatalogKind, CatalogTrust, SignedFeed};
use crate::installed::{
    CatalogProvenance, Consent, InstallError, InstalledPlugin, InstalledPluginStore,
    InventorySnapshot,
};
use crate::{LoadError, WasmBundle};
use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::PluginError;
use fub_host::registry::BundleKind;
use fub_host::{
    BundleClaim, BundleInfo, Custody, Host, PreparedFormatSource, StartupBundle, StartupSnapshot,
    StartupSource, StartupValidity,
};
use fub_kernel::Trust;
use serde::Serialize;

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
    /// Provenienza della release verificata nel medesimo commit dell'inventario.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog: Option<CatalogProvenance>,
    /// Il publisher ha ritirato l'esecuzione di questa release.
    pub revoked: bool,
    /// Provenienza del provvedimento di revoca, se presente.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revocation: Option<CatalogProvenance>,
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
    config: Utf8PathBuf,
    state: Custody<ManagerState>,
    validity_turn: Custody<()>,
    catalog_generation: Mutex<u64>,
    operations: Arc<OperationLifecycle>,
}

/// Token della prima fase di arresto, che conserva la validità revocata.
///
/// Il token non attende le aperture startup già in corso: [`Self::finish`]
/// completa esplicitamente la seconda fase, drenandone i lease.
#[must_use = "completare l'arresto con InstalledShutdown::finish()"]
pub struct InstalledShutdown {
    validity: Arc<StartupValidity>,
}

impl InstalledPluginManager {
    /// Apre lo store nella configurazione macchina già scelta dal composition root.
    pub fn open(config: &Utf8Path) -> Result<Self, PluginError> {
        Ok(Self {
            store: InstalledPluginStore::open(config).map_err(plugin_error)?,
            config: config.to_owned(),
            state: Custody::new(
                "installed plugin manager",
                ManagerState {
                    validity: Arc::new(StartupValidity::new()),
                    installations: BTreeMap::new(),
                },
            ),
            validity_turn: Custody::new("installed plugin startup validity", ()),
            operations: Arc::new(OperationLifecycle::new()),
            catalog_generation: Mutex::new(0),
        })
    }

    /// Store autorevole, esposto per integrazioni headless che devono ispezionarlo.
    pub fn store(&self) -> &InstalledPluginStore {
        &self.store
    }

    /// Impedisce nuovi ingressi e aspetta le operazioni già ammesse.
    ///
    /// La validità startup viene revocata senza attendere i lease delle
    /// aperture già in corso; [`InstalledShutdown::finish`] completa il drain.
    pub fn begin_shutdown(&self) -> Result<InstalledShutdown, PluginError> {
        self.operations.shutdown()?;
        let validity = self.replace_validity()?;
        validity.revoke()?;
        Ok(InstalledShutdown { validity })
    }

    /// Arresto compatibile per i chiamanti headless che hanno già chiuso l'host.
    pub fn shutdown(&self) -> Result<(), PluginError> {
        self.begin_shutdown()?.finish()
    }

    /// Ammette un'operazione prima di accodarla su un executor esterno.
    pub fn begin_operation(self: &Arc<Self>) -> Result<InstalledOperation, PluginError> {
        Ok(InstalledOperation {
            manager: Arc::clone(self),
            _admission: self.operations.enter()?,
        })
    }
    /// Adatta la modalità limitata alla porta startup esistente dell'host:
    /// la scelta è per apertura, non modifica enabled né consenso persistiti.
    pub fn limited_startup(self: &Arc<Self>, reason: impl Into<String>) -> Arc<dyn StartupSource> {
        Arc::new(LimitedStartup {
            manager: Arc::clone(self),
            reason: reason.into(),
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
    /// Contatori aggregati: per-call timeout e memoria lineare non sono quote di processo.
    pub fn process_budgets(&self) -> Result<BudgetSnapshot, PluginError> {
        let _operation = self.operations.enter()?;
        Ok(budgets::snapshot())
    }

    /// Cerca solo dentro un feed Ed25519 verificato: non accede alla rete.
    pub fn catalog_search(
        &self,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        needle: &str,
    ) -> Result<Vec<CatalogEntry>, CatalogError> {
        let _operation = self.operations.enter()?;
        let mut generation = self
            .catalog_generation
            .lock()
            .map_err(|_| manager_poisoned())?;
        let payload = catalog::verify_feed(trust, feed, now_ms)?;
        require_generation(*generation, payload.generation)?;
        require_recorded_generation(&self.store.snapshot()?, payload.generation)?;
        *generation = payload.generation;
        Ok(catalog::search(&payload, needle)
            .into_iter()
            .cloned()
            .collect())
    }

    /// Installa byte consegnati dalla shell, selezionati da una voce firmata.
    /// Non scarica e non monta: digest, dimensione, manifest e CAS sono obbligatori.
    pub fn catalog_install(
        &self,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        id: &str,
        version: &str,
        bytes: &[u8],
    ) -> Result<InstalledPluginInfo, CatalogError> {
        let _operation = self.operations.enter()?;
        let mut generation = self
            .catalog_generation
            .lock()
            .map_err(|_| manager_poisoned())?;
        let payload = catalog::verify_feed(trust, feed, now_ms)?;
        require_generation(*generation, payload.generation)?;
        let entry = select_entry(&payload, CatalogKind::Plugin, id, version)?;
        let snapshot = self.store.snapshot()?;
        require_recorded_generation(&snapshot, payload.generation)?;
        let installed = catalog::install_entry(
            &self.store,
            &snapshot,
            entry,
            bytes,
            provenance(feed, &payload, entry),
        )?;
        self.installation_state(installed.installation)?;
        *generation = payload.generation;
        Ok(metadata_info(&installed, false, false))
    }

    /// Aggiorna e ritira i proxy della release precedente; i byte nuovi
    /// conservano `enabled` ma non il consenso. La vista restituita è metadata-
    /// only (`mounted=false`): usare `list(host, vault)` per lo stato del vault.
    /// Gli errori di teardown dopo il commit sono restituiti separatamente.
    #[allow(clippy::too_many_arguments)]
    pub fn catalog_update(
        &self,
        host: &Host,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        installation: u64,
        version: &str,
        bytes: &[u8],
    ) -> Result<(InstalledPluginInfo, Vec<PluginError>), CatalogError> {
        let _operation = self.operations.enter()?;
        self.catalog_update_inner(host, trust, feed, now_ms, installation, version, bytes)
    }

    /// Rollback esplicito: il chiamante consegna i byte precedenti salvati e
    /// una voce della versione precedente nel feed firmato corrente.
    #[allow(clippy::too_many_arguments)]
    pub fn catalog_rollback(
        &self,
        host: &Host,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        installation: u64,
        prior_version: &str,
        prior_bytes: &[u8],
    ) -> Result<(InstalledPluginInfo, Vec<PluginError>), CatalogError> {
        let _operation = self.operations.enter()?;
        self.catalog_update_inner(
            host,
            trust,
            feed,
            now_ms,
            installation,
            prior_version,
            prior_bytes,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn catalog_update_inner(
        &self,
        host: &Host,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        installation: u64,
        version: &str,
        bytes: &[u8],
    ) -> Result<(InstalledPluginInfo, Vec<PluginError>), CatalogError> {
        let mut generation = self
            .catalog_generation
            .lock()
            .map_err(|_| manager_poisoned())?;
        let payload = catalog::verify_feed(trust, feed, now_ms)?;
        require_generation(*generation, payload.generation)?;
        let state = self.installation_state(installation)?;
        let _turn = state.turn.write_turn();
        let snapshot = self.store.snapshot()?;
        require_recorded_generation(&snapshot, payload.generation)?;
        let before = installed_from(&snapshot, installation)?.clone();
        let entry = select_entry(&payload, CatalogKind::Plugin, &before.manifest.id, version)?;
        let updated = catalog::update_entry(
            &self.store,
            &snapshot,
            &before,
            entry,
            bytes,
            provenance(feed, &payload, entry),
        )?;
        *generation = payload.generation;
        let mut diagnostics = Vec::new();
        if let Err(error) = self.replace_and_invalidate_validity() {
            diagnostics.push(error);
        }
        diagnostics.extend(self.retire_runtime(host, &before, &state));
        Ok((metadata_info(&updated, false, false), diagnostics))
    }

    /// Richiede una voce di revoca firmata prima di disabilitare e smontare.
    /// Non elimina né blob né dati utente.
    pub fn catalog_revoke(
        &self,
        host: &Host,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        installation: u64,
    ) -> Result<Vec<PluginError>, CatalogError> {
        let _operation = self.operations.enter()?;
        let mut generation = self
            .catalog_generation
            .lock()
            .map_err(|_| manager_poisoned())?;
        let payload = catalog::verify_feed(trust, feed, now_ms)?;
        require_generation(*generation, payload.generation)?;
        let state = self.installation_state(installation)?;
        let _turn = state.turn.write_turn();
        let snapshot = self.store.snapshot()?;
        require_recorded_generation(&snapshot, payload.generation)?;
        let before = installed_from(&snapshot, installation)?.clone();
        let revoked_entry = payload
            .entries
            .iter()
            .find(|entry| {
                entry.kind == CatalogKind::Plugin && entry.id == before.manifest.id && entry.revoked
            })
            .ok_or_else(|| {
                CatalogError::Unavailable(format!(
                    "revoca non firmata per `{}`",
                    before.manifest.id
                ))
            })?;
        if before
            .revocation
            .as_ref()
            .is_some_and(|prior| payload.generation < prior.generation)
        {
            return Err(CatalogError::Stale(
                "revoca più vecchia di quella installata".into(),
            ));
        }
        catalog::revoke(
            &self.store,
            &snapshot,
            installation,
            provenance(feed, &payload, revoked_entry),
        )?;
        *generation = payload.generation;
        let mut after = before.clone();
        after.enabled = false;
        after.revoked = true;
        let mut diagnostics = Vec::new();
        if before.enabled {
            if let Err(error) = self.replace_and_invalidate_validity() {
                diagnostics.push(error);
            }
        }
        diagnostics.extend(self.retire_runtime(host, &before, &state));
        Ok(diagnostics)
    }

    /// Installa l'albero tema scelto, verificando feed e contenuto prima della
    /// pubblicazione atomica dell'host. Nessun download implicito.
    pub fn catalog_install_theme(
        &self,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        id: &str,
        version: &str,
        source: &Utf8Path,
    ) -> Result<Utf8PathBuf, CatalogError> {
        let _operation = self.operations.enter()?;
        let mut generation = self
            .catalog_generation
            .lock()
            .map_err(|_| manager_poisoned())?;
        let payload = catalog::verify_feed(trust, feed, now_ms)?;
        require_generation(*generation, payload.generation)?;
        require_recorded_generation(&self.store.snapshot()?, payload.generation)?;
        let entry = select_entry(&payload, CatalogKind::Theme, id, version)?;
        let signed = serde_json::to_value(provenance(feed, &payload, entry))
            .map_err(|error| CatalogError::Unreadable(error.to_string()))?;
        let installed = catalog::install_theme_entry(&self.config, entry, source, signed)?;
        *generation = payload.generation;
        Ok(installed)
    }

    /// Sostituisce un tema solo dopo la verifica della sua staging completa.
    pub fn catalog_update_theme(
        &self,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        id: &str,
        version: &str,
        source: &Utf8Path,
    ) -> Result<Utf8PathBuf, CatalogError> {
        let _operation = self.operations.enter()?;
        self.catalog_update_theme_inner(trust, feed, now_ms, id, version, source)
    }

    /// Rollback del tema: albero precedente salvato, voce firmata della release
    /// precedente nel feed corrente; mai una riscrittura silenziosa.
    pub fn catalog_rollback_theme(
        &self,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        id: &str,
        prior_version: &str,
        prior_source: &Utf8Path,
    ) -> Result<Utf8PathBuf, CatalogError> {
        let _operation = self.operations.enter()?;
        self.catalog_update_theme_inner(trust, feed, now_ms, id, prior_version, prior_source)
    }

    fn catalog_update_theme_inner(
        &self,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        id: &str,
        version: &str,
        source: &Utf8Path,
    ) -> Result<Utf8PathBuf, CatalogError> {
        let mut generation = self
            .catalog_generation
            .lock()
            .map_err(|_| manager_poisoned())?;
        let payload = catalog::verify_feed(trust, feed, now_ms)?;
        require_generation(*generation, payload.generation)?;
        require_recorded_generation(&self.store.snapshot()?, payload.generation)?;
        let entry = select_entry(&payload, CatalogKind::Theme, id, version)?;
        let signed = serde_json::to_value(provenance(feed, &payload, entry))
            .map_err(|error| CatalogError::Unreadable(error.to_string()))?;
        let updated = catalog::update_theme_entry(&self.config, entry, source, signed)?;
        *generation = payload.generation;
        Ok(updated)
    }

    /// Revoca firmata della superficie tema: la shell non leggerà più il
    /// bundle; preferenze e file della persona rimangono intatti.
    pub fn catalog_revoke_theme(
        &self,
        trust: &CatalogTrust,
        feed: &SignedFeed,
        now_ms: u64,
        id: &str,
    ) -> Result<(), CatalogError> {
        let _operation = self.operations.enter()?;
        let mut generation = self
            .catalog_generation
            .lock()
            .map_err(|_| manager_poisoned())?;
        let payload = catalog::verify_feed(trust, feed, now_ms)?;
        require_generation(*generation, payload.generation)?;
        require_recorded_generation(&self.store.snapshot()?, payload.generation)?;
        let revoked_entry = payload
            .entries
            .iter()
            .find(|entry| entry.kind == CatalogKind::Theme && entry.id == id && entry.revoked)
            .ok_or_else(|| CatalogError::Unavailable(format!("revoca tema `{id}` non firmata")))?;
        let signed = serde_json::to_value(provenance(feed, &payload, revoked_entry))
            .map_err(|error| CatalogError::Unreadable(error.to_string()))?;
        fub_host::theme::set_theme_revoked_with_provenance(&self.config, id, signed)?;
        *generation = payload.generation;
        Ok(())
    }

    /// Provenienza nel puntatore di generazione dell'host, separata dagli
    /// asset firmati e preservata insieme al cambio di release.
    pub fn catalog_theme_provenance(
        &self,
        id: &str,
    ) -> Result<Option<CatalogProvenance>, CatalogError> {
        let _operation = self.operations.enter()?;
        fub_host::theme::theme_catalog_provenance(&self.config, id)?
            .map(|value| {
                serde_json::from_value(value)
                    .map_err(|error| CatalogError::Unreadable(error.to_string()))
            })
            .transpose()
    }

    /// Provenienza della revoca firmata persistita nello stesso puntatore
    /// atomico del tema; assente se nessun feed ha ritirato il bundle.
    pub fn catalog_theme_revocation(
        &self,
        id: &str,
    ) -> Result<Option<CatalogProvenance>, CatalogError> {
        let _operation = self.operations.enter()?;
        fub_host::theme::theme_revocation_provenance(&self.config, id)?
            .map(|value| {
                serde_json::from_value(value)
                    .map_err(|error| CatalogError::Unreadable(error.to_string()))
            })
            .transpose()
    }

    /// Diagnostica fail-closed della revoca: `true` anche se un puntatore è
    /// danneggiato o non leggibile, mai "attivo" per errore di I/O.
    pub fn catalog_theme_revoked(&self, id: &str) -> Result<bool, CatalogError> {
        let _operation = self.operations.enter()?;
        Ok(fub_host::theme::theme_revoked(&self.config, id))
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

    /// Prepara un avvio in modalità limitata: nessun componente viene montato.
    ///
    /// Lo snapshot torna con `bundles` e `formats` vuoti e un singolo
    /// [`PluginError::Cancelled`] in `diagnostics` che cita `reason` e il
    /// numero di installazioni saltate. La recovery dello startup esistente
    /// resta invariata e va letta insieme a questo: in
    /// [`StartupSource::prepare`] un bundle guasto diventa una diagnosi che
    /// non nasconde gli altri, qui invece si salta tutto esplicitamente e lo
    /// si dichiara in una sola diagnosi.
    ///
    /// Gli stati restano quattro e distinti — installazione (record
    /// persistito), consenso sugli esatti byte, scelta `enabled`, mount
    /// riuscito — e restano leggibili da `list`/`info` senza che questa
    /// chiamata cambi alcuna firma: la modalità limitata non riscrive
    /// l'inventario, sospende soltanto il mount per questa apertura.
    pub fn prepare_limited(&self, reason: &str) -> Result<StartupSnapshot, PluginError> {
        let _operation = self.operations.enter()?;
        let validity: Arc<StartupValidity> = Arc::clone(&self.state.read()?.validity);
        let lease = validity.acquire()?;
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        let skipped = snapshot.plugins().len();
        Ok(StartupSnapshot {
            bundles: Vec::new(),
            formats: PreparedFormatSource::empty(),
            diagnostics: vec![PluginError::Cancelled(
                format!("modalità limitata ({reason}): {skipped} installazioni saltate").into(),
            )],
            validity: Some(validity),
            lease: Some(lease),
        })
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

    fn replace_validity(&self) -> Result<Arc<StartupValidity>, PluginError> {
        let _turn = self.validity_turn.write_turn();
        let mut state = self.state.write()?;
        Ok(std::mem::replace(
            &mut state.validity,
            Arc::new(StartupValidity::new()),
        ))
    }

    fn replace_and_invalidate_validity(&self) -> Result<(), PluginError> {
        let _turn = self.validity_turn.write_turn();
        self.replace_validity()?.invalidate()
    }

    /// Una release aggiornata non deve mai riattivare il `KnownBundle` con gli
    /// stessi claim ma i byte vecchi: smonta, poi dimentica il proxy precedente.
    fn retire_runtime(
        &self,
        host: &Host,
        installed: &InstalledPlugin,
        state: &InstallationState,
    ) -> Vec<PluginError> {
        let mut errors = Vec::new();
        for vault in host.vaults() {
            let vault = Some(vault.as_str());
            match host.bundle_is_owned(vault, &installed.manifest.id, &state.claim) {
                Ok(true) => {}
                Ok(false) => continue,
                Err(error) => {
                    errors.push(error);
                    continue;
                }
            }
            match host.set_bundle_active(vault, &installed.manifest.id, &state.claim, false) {
                Ok(mut teardown) => errors.append(&mut teardown),
                Err(error) => errors.push(error),
            }
            match host.is_bundle_active(vault, &installed.manifest.id, &state.claim) {
                Ok(false) => {
                    if let Err(error) =
                        host.forget_bundle(vault, &installed.manifest.id, &state.claim)
                    {
                        errors.push(error);
                    }
                }
                Ok(true) => errors.push(PluginError::Conflict(
                    format!(
                        "release precedente `{}` ancora attiva nel vault",
                        installed.manifest.id
                    )
                    .into(),
                )),
                Err(error) => errors.push(error),
            }
        }
        errors
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
                if let Err(error) =
                    host.remember_claimed_bundle(vault, Arc::clone(bundle), &state.claim)
                {
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
fn require_generation(seen: u64, candidate: u64) -> Result<(), CatalogError> {
    if candidate < seen {
        return Err(CatalogError::Stale(format!(
            "generazione {candidate} precedente alla generazione verificata {seen}"
        )));
    }
    Ok(())
}

fn require_recorded_generation(
    snapshot: &InventorySnapshot,
    candidate: u64,
) -> Result<(), CatalogError> {
    let seen = snapshot
        .plugins()
        .iter()
        .flat_map(|plugin| {
            [plugin.catalog.as_ref(), plugin.revocation.as_ref()]
                .into_iter()
                .flatten()
                .map(|provenance| provenance.generation)
        })
        .max()
        .unwrap_or_default();
    require_generation(seen, candidate)
}

fn select_entry<'a>(
    payload: &'a catalog::CatalogPayload,
    kind: CatalogKind,
    id: &str,
    version: &str,
) -> Result<&'a CatalogEntry, CatalogError> {
    if payload
        .entries
        .iter()
        .any(|entry| entry.kind == kind && entry.id == id && entry.revoked)
    {
        return Err(CatalogError::Unavailable(format!("voce `{id}` revocata")));
    }
    let mut entries = payload
        .entries
        .iter()
        .filter(|entry| entry.kind == kind && entry.id == id && entry.version == version);
    let entry = entries.next().ok_or_else(|| {
        CatalogError::Unavailable(format!("voce `{id}` versione `{version}` assente"))
    })?;
    if entries.next().is_some() {
        return Err(CatalogError::Unreadable(format!(
            "voce `{id}` versione `{version}` ambigua"
        )));
    }
    Ok(entry)
}

fn provenance(
    feed: &SignedFeed,
    payload: &catalog::CatalogPayload,
    entry: &CatalogEntry,
) -> CatalogProvenance {
    CatalogProvenance {
        key_id: feed.key_id.clone(),
        generation: payload.generation,
        publisher: entry.provenance.clone(),
        url: entry.url.clone(),
        license: entry.license.clone(),
        compatible: entry.compatible.clone(),
    }
}

impl InstalledShutdown {
    /// Attende il rilascio dei lease startup acquisiti prima della revoca.
    pub fn finish(self) -> Result<(), PluginError> {
        self.validity.drain();
        Ok(())
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

struct LimitedStartup {
    manager: Arc<InstalledPluginManager>,
    reason: String,
}

impl StartupSource for LimitedStartup {
    fn prepare(&self) -> Result<StartupSnapshot, PluginError> {
        self.manager.prepare_limited(&self.reason)
    }
}

impl StartupSource for InstalledPluginManager {
    fn prepare(&self) -> Result<StartupSnapshot, PluginError> {
        let _operation = self.operations.enter()?;
        let validity: Arc<StartupValidity> = Arc::clone(&self.state.read()?.validity);
        let lease = validity.acquire()?;
        let snapshot = self.store.snapshot().map_err(plugin_error)?;
        let mut bundles = Vec::new();
        let mut formats = PreparedFormatSource::empty();
        let mut diagnostics = Vec::new();
        for installed in snapshot
            .plugins()
            .iter()
            .filter(|installed| installed.requested_at_startup())
        {
            let state = self.installation_state(installed.installation)?;
            match self.load_bundle(installed) {
                Ok(bundle) => {
                    let opening = Arc::new(bundle.prepare_opening());
                    match opening.format_provider() {
                        Ok(Some(provider)) => {
                            formats = formats.with_provider(provider);
                        }
                        Ok(None) => {}
                        Err(mut error) => {
                            let message = error.message().to_string();
                            *error.message_mut() = format!(
                                "plugin `{}` (installazione {}), provider di formato: {message}",
                                installed.manifest.id, installed.installation,
                            )
                            .into();
                            diagnostics.push(error);
                        }
                    }
                    bundles.push(StartupBundle::new(opening, true, state.claim.clone()));
                }
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
            formats,
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
        catalog: installed.catalog.clone(),
        revoked: installed.revoked,
        revocation: installed.revocation.clone(),
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
        LoadError::Compilation(message) | LoadError::UnsupportedExport(message) => {
            PluginError::BadArgs(message.into())
        }
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
