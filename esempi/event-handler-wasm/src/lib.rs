//! Guest che esporta la porta canonica `event-handler` inbound, non ancora
//! supportata dal runtime WASM.
//!
//! Il gestore è intenzionalmente vuoto: il test monta il componente e dimostra
//! che nessun evento raggiunge questa porta differita.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:event-handler/event-handler",
    generate_all,
});
use exports::fub::abi::event_handler::Guest as EventHandlerGuest;
use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::events::{EventMask, Notice};

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: "demo.event-handler".to_string(),
            name: "Deferred EventHandler (WASM)".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.1.1".to_string(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "it".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(_job: String, _payload: String) -> Result<String, PluginError> {
        Ok("{}".to_string())
    }
}

impl EventHandlerGuest for Componente {
    fn subscribed() -> EventMask {
        EventMask {
            kinds: vec![],
            topics: vec![],
            subjects: vec![],
            changes: vec![],
        }
    }

    fn handle(_notice: Notice) -> Result<(), PluginError> {
        Ok(())
    }
}

export!(Componente);
