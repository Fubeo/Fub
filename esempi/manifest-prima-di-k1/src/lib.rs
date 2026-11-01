//! Un plugin compilato contro `fub:abi@0.2.0` prima della #285.
//!
//! Il manifest ha gli undici campi di allora, senza i cinque che K1 ha messo
//! in coda. Nel component model un record si controlla campo per campo, quindi
//! l'host di dopo K1 non lo istanzia: è il comportamento voluto finché 0.2.0
//! non è pubblicata, e la regola che ne segue sta nell'ADR 0235. Il resto del
//! plugin è il minimo che compila: nessun permesso, nessun servizio, nessun job.

wit_bindgen::generate!({
    path: "wit",
    world: "esempio:manifest-prima-di-k1/manifest-prima-di-k1",
    generate_all,
});

use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: "example.manifest-prima-di-k1".to_string(),
            name: "Example Manifest Before K1".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.2.0".to_string(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Err(PluginError::UnknownJob(fub::abi::text::Text::Literal(job)))
    }
}

export!(Componente);
