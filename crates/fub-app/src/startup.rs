//! Composizione dei componenti WASM installati per l'avvio desktop.
//!
//! Inventario e runtime restano due proprietari distinti: questo modulo legge
//! una fotografia dello store, seleziona i soli record autorizzati e consegna
//! all'host bundle già validati. Lo store resta al composition root e non viene
//! riaperto né ricostruito dall'host.

use std::sync::Arc;

use camino::Utf8Path;
use fub_host::StartupBundle;
use fub_wasm_host::installed::{InstallError, InstalledPluginStore};

/// Fase precisa in cui un candidato installato non ha raggiunto il runtime.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartupStage {
    /// Apertura della capability della directory canonica.
    Open,
    /// Lettura dell'inventario autorevole.
    Snapshot,
    /// Lettura o verifica del digest del blob selezionato.
    Load,
    /// Validazione attiva del componente e del manifest.
    Validate,
}

/// Diagnosi strutturata di un errore reale dello store o di un candidato.
#[derive(Debug)]
pub struct StartupDiagnostic {
    /// Fase che possiede l'errore.
    pub stage: StartupStage,
    /// Identità dell'installazione, assente per errori dell'intero store.
    pub installation: Option<u64>,
    /// Id dichiarato, assente quando l'inventario non è disponibile.
    pub plugin_id: Option<String>,
    /// Errore originale, preservato senza tradurlo in testo.
    pub error: InstallError,
}

impl StartupDiagnostic {
    fn store(stage: StartupStage, error: InstallError) -> Self {
        Self {
            stage,
            installation: None,
            plugin_id: None,
            error,
        }
    }

    fn plugin(
        stage: StartupStage,
        installation: u64,
        plugin_id: String,
        error: InstallError,
    ) -> Self {
        Self {
            stage,
            installation: Some(installation),
            plugin_id: Some(plugin_id),
            error,
        }
    }
}

/// Parti desktop tenute separate dopo aver letto l'inventario una sola volta.
pub struct InstalledStartup {
    /// Store aperto che l'applicazione conserva separatamente dall'host.
    pub store: InstalledPluginStore,
    /// Soli bundle selezionati e validati da consegnare all'host.
    pub bundles: Vec<StartupBundle>,
    /// Fallimenti opzionali dei singoli candidati selezionati.
    pub diagnostics: Vec<StartupDiagnostic>,
}

/// Apre lo store canonico e prepara soltanto i componenti richiesti all'avvio.
///
/// Il filtro `requested_at_startup` precede sia la lettura del blob sia la
/// validazione attiva. Un record disabled, denied o undecided resta quindi
/// soltanto metadata, anche se il suo eseguibile è illeggibile o corrotto.
pub fn installed(config_dir: &Utf8Path) -> Result<InstalledStartup, StartupDiagnostic> {
    let store = InstalledPluginStore::open(config_dir)
        .map_err(|error| StartupDiagnostic::store(StartupStage::Open, error))?;
    let snapshot = store
        .snapshot()
        .map_err(|error| StartupDiagnostic::store(StartupStage::Snapshot, error))?;
    let mut bundles = Vec::new();
    let mut diagnostics = Vec::new();

    for plugin in snapshot
        .plugins()
        .iter()
        .filter(|plugin| plugin.requested_at_startup())
    {
        let installation = plugin.installation;
        let plugin_id = plugin.manifest.id.clone();
        let loaded = match store.load(plugin) {
            Ok(loaded) => loaded,
            Err(error) => {
                diagnostics.push(StartupDiagnostic::plugin(
                    StartupStage::Load,
                    installation,
                    plugin_id,
                    error,
                ));
                continue;
            }
        };
        match loaded.validate() {
            Ok(bundle) => bundles.push(StartupBundle::new(Arc::new(bundle), true)),
            Err(error) => diagnostics.push(StartupDiagnostic::plugin(
                StartupStage::Validate,
                installation,
                plugin_id,
                error,
            )),
        }
    }

    Ok(InstalledStartup {
        store,
        bundles,
        diagnostics,
    })
}
