//! Grid WASM component: the byte protocol of the `grid` family, over the
//! lines of a UTF-8 source (`lines.rs`).

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "example:grid/grid",
    generate_all,
});

mod lines;

use exports::fub::abi::plugin::{Guest as PluginGuest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::text::Text;

const PLUGIN_ID: &str = "example.grid";

fn literal(value: impl Into<String>) -> Text {
    Text::Literal(value.into())
}

fn bad(error: impl std::fmt::Display) -> PluginError {
    PluginError::BadArgs(literal(error.to_string()))
}

fn conflict(error: impl std::fmt::Display) -> PluginError {
    PluginError::Conflict(literal(error.to_string()))
}

fn not_found(error: impl std::fmt::Display) -> PluginError {
    PluginError::NotFound(literal(error.to_string()))
}

struct Component;

impl PluginGuest for Component {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: PLUGIN_ID.to_owned(),
            name: "Canonical grid component".to_owned(),
            version: "0.1.0".to_owned(),
            abi_version: "0.2.0".to_owned(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec!["example.grid:grid".to_owned()],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: String::new(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        lines::reset();
        Ok(())
    }

    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Err(PluginError::UnknownJob(literal(job)))
    }
}

export!(Component);
