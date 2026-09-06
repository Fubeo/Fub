//! Il binario conosce la sorgente, non gli id dei componenti installati.
mod common;
use camino::Utf8PathBuf;
use fub_abi::{traits::ViewInstance, PluginError};
use fub_host::{Host, NoWatcher};
use fub_wasm_host::{ComponentDirectory, WasmSource};

#[test]
fn discovery_is_not_consent_and_removal_preserves_plugin_data() {
    let component = common::component("vault-view-wasm", "vault_view_wasm", "");
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    let config = root.join("config");
    let vault = root.join("vault");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(vault.join("Nota.md"), "# Nota\n").unwrap();
    let mut packages = ComponentDirectory::new(&config);
    let manifest = packages.install(&component).unwrap();
    let id = manifest.id.as_str();
    let view = ViewInstance::only("demo.vault-view:documents");
    let host = Host::new()
        .with_config_dir(&config)
        .with_watcher(Box::new(NoWatcher))
        .with_bundle_source(Box::new(WasmSource));
    host.open(&vault).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| {
        assert!(session.bundles().read().unwrap().knows(id));
        assert!(!session.bundles().read().unwrap().ids().contains(&id));
        assert!(matches!(
            session.workspace().read().unwrap().render_view(&view),
            Err(PluginError::UnknownView(_))
        ));
    })
    .unwrap();
    assert!(host.set_plugin_enabled(None, id, true).unwrap().is_empty());
    host.with_session(None, |session| {
        assert!(session
            .workspace()
            .read()
            .unwrap()
            .render_view(&view)
            .is_ok())
    })
    .unwrap();
    assert!(host.close().is_empty());
    // Anche la preferenza "abilitato" nel vault non costituisce consenso.
    host.open(&vault).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| {
        assert!(!session.bundles().read().unwrap().ids().contains(&id))
    })
    .unwrap();
    assert!(host.set_plugin_enabled(None, id, true).unwrap().is_empty());
    assert!(host.set_plugin_enabled(None, id, false).unwrap().is_empty());
    assert!(host.close().is_empty());
    let user_data = vault.join(".fub/plugins").join(id).join("keep.bin");
    std::fs::create_dir_all(user_data.parent().unwrap()).unwrap();
    std::fs::write(&user_data, b"dati autorevoli").unwrap();
    packages.remove(id).unwrap();
    assert_eq!(std::fs::read(&user_data).unwrap(), b"dati autorevoli");
    host.open(&vault).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| {
        assert!(!session.bundles().read().unwrap().knows(id))
    })
    .unwrap();
    assert!(host.close().is_empty());
}
