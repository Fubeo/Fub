//! Un provider non implementato è nominato prima di istanziare, non ignorato.
mod common;
use fub_wasm_host::{Component, LoadError};

#[test]
fn format_index_and_event_handlers_are_explicitly_refused() {
    for (feature, interface) in [
        ("format", "format"),
        ("index", "index"),
        ("events", "event-handler"),
    ] {
        let path = common::component("provider-probe-wasm", "provider_probe_wasm", feature);
        let error = Component::from_file(&path)
            .err()
            .expect("provider privo di proxy");
        assert!(matches!(error, LoadError::UnservedProviders(_)), "{error}");
        assert!(
            error
                .to_string()
                .contains(&format!("fub:abi/{interface}@0.1.1")),
            "{error}"
        );
    }
}
