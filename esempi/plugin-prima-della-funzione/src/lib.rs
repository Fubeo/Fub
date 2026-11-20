//! Un plugin compilato contro `fub:abi@0.2.0` prima che l'interfaccia `plugin`
//! avesse `run-job`, la sua ultima funzione (#289).
//!
//! Il resto del contratto è quello congelato: il manifest ha i sedici campi
//! dell'host, e la sola differenza è una funzione in meno nell'interfaccia
//! esportata. Il plugin è il minimo che compila: nessun permesso, nessun
//! servizio.

wit_bindgen::generate!({
    path: "wit",
    world: "esempio:plugin-prima-della-funzione/plugin-prima-della-funzione",
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
            id: "example.plugin-prima-della-funzione".to_string(),
            name: "Example Plugin Before The New Function".to_string(),
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
}

export!(Componente);
