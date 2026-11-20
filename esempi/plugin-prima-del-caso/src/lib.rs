//! Un plugin compilato contro `fub:abi@0.2.0` prima che l'`enum
//! component-kind` avesse `data`, il suo ultimo caso (#289).
//!
//! Il resto del contratto è quello congelato: il manifest ha i sedici campi
//! dell'host, e la sola differenza è un caso in meno in un `enum` che
//! l'interfaccia esportata restituisce. Il plugin è il minimo che compila:
//! nessun permesso, nessun servizio, nessun job.

wit_bindgen::generate!({
    path: "wit",
    world: "esempio:plugin-prima-del-caso/plugin-prima-del-caso",
    generate_all,
});

use exports::fub::abi::plugin::{
    ComponentKind, Delivery, Guest, PluginManifest, PluginPermissions,
};
use fub::abi::errors::PluginError;

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: "example.plugin-prima-del-caso".to_string(),
            name: "Example Plugin Before The New Case".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.2.0".to_string(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "".to_string(),
            timers: vec![],
            uses: vec![],
            kind: ComponentKind::Service,
            delivery: Delivery::Included,
            ui: vec![],
            group: None,
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
