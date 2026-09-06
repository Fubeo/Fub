//! Adattatore della directory alla porta di discovery dell'host.
use crate::ComponentDirectory;
use camino::Utf8Path;
use fub_abi::PluginError;
use fub_host::{Bundle, BundleDiscovery, BundleSource};
use std::sync::Arc;

/// Scopre componenti di comunità senza attivarli o promuoverne la fiducia.
#[derive(Debug, Default)]
pub struct WasmSource;
impl BundleSource for WasmSource {
    fn discover(&self, config_dir: &Utf8Path) -> Result<BundleDiscovery, PluginError> {
        let found = ComponentDirectory::new(config_dir).discover()?;
        Ok(BundleDiscovery {
            bundles: found
                .components
                .into_iter()
                .map(|bundle| Arc::new(bundle) as Arc<dyn Bundle>)
                .collect(),
            errors: found.errors,
        })
    }
}
