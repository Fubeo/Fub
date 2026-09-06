//! Installazione e ciclo reale: il pacchetto viene compilato, non simulato.
mod common;

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::event::Actor;
use fub_abi::PluginError;
use fub_host::{Bundle, Host, NoWatcher};
use fub_kernel::Trust;
use fub_wasm_host::{ComponentDirectory, WasmBundle, MAX_COMPONENT_BYTES};
use std::sync::OnceLock;

fn bytes() -> &'static [u8] {
    static BYTES: OnceLock<Vec<u8>> = OnceLock::new();
    BYTES.get_or_init(|| std::fs::read(common::ping("")).unwrap())
}

fn root(dir: &tempfile::TempDir) -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap()
}

#[test]
fn install_discover_invoke_disable_remove_and_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let root = root(&dir);
    let source = root.join("download.wasm");
    std::fs::write(&source, bytes()).unwrap();
    let mut packages = ComponentDirectory::new(&root.join("config"));
    let manifest = packages.install(&source).unwrap();
    std::fs::remove_file(&source).unwrap();
    let mut found = packages.discover().unwrap();
    assert!(found.errors.is_empty(), "{:?}", found.errors);
    assert_eq!(found.components.len(), 1);
    let bundle = found.components.pop().unwrap();
    assert_eq!(bundle.manifest(), manifest);
    assert_eq!(bundle.trust(), Trust::Community);

    let vault = root.join("vault");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(vault.join("Nota.md"), "# Nota\n").unwrap();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&vault).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| {
        let mut ws = session.workspace().write().unwrap();
        let mut registry = session.bundles().write().unwrap();
        assert!(!ws.plugins().iter().any(|p| p.id == manifest.id));
        registry.mount(&bundle, &mut ws).unwrap();
        let command = format!("{}:conta", manifest.id);
        let result = ws
            .invoke_command(
                &command,
                serde_json::json!({}),
                InvokeMode::Apply,
                Actor::User,
            )
            .unwrap();
        assert_eq!(result.notify.unwrap().as_literal(), Some("7 caratteri"));
        assert!(registry.unmount(&mut ws, &manifest.id).is_empty());
        assert!(!registry.ids().contains(&manifest.id.as_str()));
        assert!(matches!(
            ws.invoke_command(
                &command,
                serde_json::json!({}),
                InvokeMode::Apply,
                Actor::User
            ),
            Err(PluginError::UnknownCommand(_))
        ));
        // Riaprire il componente crea una nuova istanza, non una registrazione morta.
        registry.mount(&bundle, &mut ws).unwrap();
        assert!(registry.unmount(&mut ws, &manifest.id).is_empty());
    })
    .unwrap();
    host.close();
    drop(host);
    drop(bundle);
    packages.remove(&manifest.id).unwrap();
    assert!(packages.discover().unwrap().components.is_empty());
    assert_eq!(
        std::fs::read_to_string(vault.join("Nota.md")).unwrap(),
        "# Nota\n"
    );
}

#[test]
fn corrupt_and_duplicate_installs_never_replace_valid_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let root = root(&dir);
    let source = root.join("download.wasm");
    let packages = ComponentDirectory::new(&root.join("config"));
    std::fs::write(&source, b"not wasm").unwrap();
    assert!(packages.install(&source).is_err());
    assert!(!packages.root().exists());
    std::fs::write(&source, bytes()).unwrap();
    packages.install(&source).unwrap();
    assert!(matches!(
        packages.install(&source),
        Err(PluginError::AlreadyExists(_))
    ));
    let installed = std::fs::read_dir(packages.root())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(std::fs::read(installed).unwrap(), bytes());
    assert_eq!(std::fs::read_dir(packages.root()).unwrap().count(), 1);
}

#[test]
fn discovery_names_corruption_without_hiding_valid_components() {
    let dir = tempfile::tempdir().unwrap();
    let root = root(&dir);
    let source = root.join("download.wasm");
    std::fs::write(&source, bytes()).unwrap();
    let packages = ComponentDirectory::new(&root);
    packages.install(&source).unwrap();
    std::fs::write(packages.root().join("broken.wasm"), b"broken").unwrap();
    let report = packages.discover().unwrap();
    assert_eq!(report.components.len(), 1);
    assert_eq!(report.errors.len(), 1);
    assert!(report.errors[0].to_string().contains("broken.wasm"));
}

#[test]
fn an_oversized_package_is_rejected_before_compilation() {
    let dir = tempfile::tempdir().unwrap();
    let source = root(&dir).join("huge.wasm");
    std::fs::File::create(&source)
        .unwrap()
        .set_len(MAX_COMPONENT_BYTES + 1)
        .unwrap();
    assert!(matches!(
        ComponentDirectory::inspect(&source),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn discarding_a_plugin_before_registration_releases_its_instance() {
    let bundle = WasmBundle::from_bytes(bytes(), Trust::Community).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root(&dir)).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| {
        let mut ws = session.workspace().write().unwrap();
        ws.register_plugin(bundle.manifest(), Trust::Community)
            .unwrap();
        let plugin = bundle.plugin();
        drop(plugin);
        let warnings = bundle.register(&mut ws);
        assert!(
            warnings
                .iter()
                .any(|warning| warning.starts_with("no instance")),
            "{warnings:?}"
        );
        assert!(!ws
            .commands()
            .iter()
            .any(|command| command.id.starts_with("demo.ping:")));
    })
    .unwrap();
    host.close();
}

#[cfg(unix)]
#[test]
fn symbolic_links_are_not_component_packages() {
    let dir = tempfile::tempdir().unwrap();
    let root = root(&dir);
    let source = root.join("real.wasm");
    let link = root.join("link.wasm");
    std::fs::write(&source, bytes()).unwrap();
    std::os::unix::fs::symlink(&source, &link).unwrap();
    assert!(ComponentDirectory::inspect(&link).is_err());
    assert_eq!(std::fs::read(&source).unwrap(), bytes());
}
