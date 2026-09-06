//! Discovery iniettata dalla composizione: il kernel non conosce i backend.
use crate::Bundle;
use camino::Utf8Path;
use fub_abi::PluginError;
use std::sync::Arc;

/// Esito della discovery: pacchetti validi e rifiuti indipendenti.
#[derive(Default)]
#[must_use]
pub struct BundleDiscovery {
    /// Bundle conosciuti, non attivati e privi di autorizzazione implicita.
    pub bundles: Vec<Arc<dyn Bundle>>,
    /// Rifiuti nominati che non devono nascondere gli altri pacchetti.
    pub errors: Vec<PluginError>,
}

/// Porta locale della composizione, non un'estensione del contratto ABI.
///
/// La sorgente può validare un pacchetto ma non decide se attivarlo. Ogni
/// apertura ricostruisce l'inventario: trovare byte non equivale a fidarsi.
pub trait BundleSource: Send + Sync {
    /// Scopre i bundle della configurazione macchina, senza montarli.
    fn discover(&self, config_dir: &Utf8Path) -> Result<BundleDiscovery, PluginError>;
}
