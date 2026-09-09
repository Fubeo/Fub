//! Un componente che deve poter leggere già durante l'attivazione.
//!
//! Le varianti negative cambiano il manifest o il teardown, non l'host.
//! Il contatore permette di distinguere una nuova istanza da una riattivata.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:lifecycle/lifecycle",
    generate_all,
});

use exports::fub::abi::command::{
    CommandEffect, CommandEffectReveal, CommandOutcome, CommandReach, CommandScope, CommandSpec,
    InvokeMode,
};
use exports::fub::abi::plugin::{PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::model::Span;
use fub::abi::options::OptionEntry;
use fub::abi::text::Text;

const ID: &str = "demo.lifecycle";
const COMMAND: &str = "demo.lifecycle:conta";
const NOTE: &str = "Nota.md";

// Il component model serializza gli ingressi nella stessa istanza.
static mut ACTIVATIONS: u32 = 0;

struct Component;

impl exports::fub::abi::plugin::Guest for Component {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: ID.to_string(),
            name: "Demo lifecycle WASM".to_string(),
            version: "0.0.0".to_string(),
            abi_version: if cfg!(feature = "abi-incompatibile") {
                "99.0.0"
            } else {
                "0.1.1"
            }
            .to_string(),
            permissions: PluginPermissions {
                granted: if cfg!(feature = "senza-permessi") {
                    vec![]
                } else {
                    vec![OptionEntry {
                        key: "fub:read-vault".to_string(),
                        value: "true".to_string(),
                    }]
                },
            },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "it".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        fub::abi::host_vault_read::read_document(NOTE)?;
        unsafe {
            ACTIVATIONS += 1;
        }
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        if cfg!(feature = "trap-deactivate") {
            panic!("prova del teardown interrotto");
        }
        // Non azzerare il contatore: una nuova istanza deve dimostrarlo da sé.
        Ok(())
    }

    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Err(PluginError::UnknownJob(Text::Literal(job)))
    }
}

impl exports::fub::abi::command::Guest for Component {
    fn commands() -> Vec<CommandSpec> {
        vec![CommandSpec {
            id: COMMAND.to_string(),
            title: Text::Literal("Conta attraverso WASM".to_string()),
            description: Text::Literal("Legge Nota.md con la capability host.".to_string()),
            keybinding: None,
            params: vec![],
            scope: CommandScope {
                writes: false,
                reach: CommandReach::Document,
                reversible: false,
            },
        }]
    }

    fn invoke(
        command: String,
        _args: String,
        _mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        if command != COMMAND {
            return Err(PluginError::UnknownCommand(Text::Literal(command)));
        }
        let text = fub::abi::host_vault_read::read_document(NOTE)?;
        let activations = unsafe { ACTIVATIONS };
        Ok(CommandOutcome {
            notify: Some(Text::Literal(format!(
                "attivazioni={activations}; caratteri={}",
                text.chars().count()
            ))),
            effect: CommandEffect::Reveal(CommandEffectReveal {
                doc: NOTE.to_string(),
                span: Span {
                    start: 0,
                    end: text.len() as u64,
                },
            }),
            undo: None,
            partial: None,
        })
    }
}

export!(Component);
