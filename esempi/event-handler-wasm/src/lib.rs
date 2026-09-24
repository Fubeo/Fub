//! An inbound handler that records delivered notices and the Guard's denial
//! of vault reads when the manifest declares no read-vault permission.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:event-handler/event-handler",
    generate_all,
});

use std::sync::{LazyLock, Mutex};

use exports::fub::abi::event_handler::Guest as EventHandlerGuest;
use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::events::{Event, EventKind, EventMask, Notice};

static SEEN: LazyLock<Mutex<(usize, usize)>> = LazyLock::new(|| Mutex::new((0, 0)));

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: "demo.event-handler".to_string(),
            name: "Inbound event handler (WASM)".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.2.0".to_string(),
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
        *SEEN.lock().expect("event lock") = (0, 0);
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(_job: String, _payload: String) -> Result<String, PluginError> {
        let (changed, denied) = *SEEN.lock().expect("event lock");
        let closed_before = fub::abi::host_data_read::data_read("vault-closed")?.as_deref()
            == Some(b"seen");
        Ok(format!(
            "{{\"changed\":{changed},\"denied\":{denied},\"closed_before\":{closed_before}}}"
        ))
    }
}

impl EventHandlerGuest for Componente {
    fn subscribed() -> EventMask {
        EventMask {
            kinds: vec![EventKind::DocumentChanged, EventKind::VaultClosed],
            topics: vec![],
            subjects: vec![],
            changes: vec![],
        }
    }

    fn handle(notice: Notice) -> Result<(), PluginError> {
        match notice.event {
            Event::DocumentChanged(changed) => {
                // The WIT symbol is present but the sole Guard refuses this
                // manifest's missing read-vault permission.
                let result = fub::abi::host_vault_read::read_document(&changed.id);
                let mut seen = SEEN.lock().expect("event lock");
                seen.0 += 1;
                if matches!(result, Err(PluginError::PermissionDenied(_))) {
                    seen.1 += 1;
                } else {
                    return Err(PluginError::Internal(fub::abi::text::Text::Literal(
                        "read-vault unexpectedly available".to_string(),
                    )));
                }
            }
            Event::VaultClosed(_) => {
                fub::abi::host_data_write::data_write("vault-closed", b"seen")?;
            }
            _ => {}
        }
        Ok(())
    }
}

export!(Componente);
