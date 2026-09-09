//! Il percorso nativo di M5: sorgenti, directory, mount comune e rimozione.
//! Nessun componente precostruito e nessun salto se manca il target WASM.

mod common;

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::model::{DocId, Span};
use fub_abi::PluginError;
use fub_host::{Bundle, BundleError, BundleRegistry, Host, NoWatcher};
use fub_kernel::{Trust, Workspace};
use fub_testkit::Bench;
use fub_wasm_host::{discover, WasmBundle};

const ID: &str = "demo.lifecycle";
const COMMAND: &str = "demo.lifecycle:conta";
const NOTE: &str = "# Caffè ☕\n";

fn component(feature: &str) -> Utf8PathBuf {
    common::component("lifecycle-wasm", "lifecycle_wasm", feature)
}

fn install(directory: &Utf8Path, feature: &str) -> Utf8PathBuf {
    let source = component(feature);
    std::fs::create_dir_all(directory).unwrap();
    let pending = directory.join("plugin.wasm.part");
    let installed = directory.join("plugin.wasm");
    std::fs::copy(source, &pending).unwrap();
    std::fs::rename(pending, &installed).unwrap();
    installed
}

fn discovered(directory: &Utf8Path) -> WasmBundle {
    let mut candidates = discover(directory).expect("directory leggibile");
    assert_eq!(candidates.len(), 1);
    let bundle = candidates.pop().unwrap().bundle.expect("componente valido");
    assert_eq!(bundle.manifest().id, ID);
    assert_eq!(bundle.trust(), Trust::Community);
    bundle
}

fn with_workspace<R>(host: &Host, f: impl FnOnce(&mut Workspace, &mut BundleRegistry) -> R) -> R {
    host.with_session(None, |session| {
        let mut ws = session.workspace().write().unwrap();
        let mut registry = session.bundles().write().unwrap();
        f(&mut ws, &mut registry)
    })
    .expect("vault aperto")
}

fn assert_command(ws: &mut Workspace) {
    let outcome = ws
        .invoke_command(
            COMMAND,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("il comando attraversa WASM e legge il vault");
    assert_eq!(
        outcome.notify.unwrap().as_literal(),
        Some(format!("attivazioni=1; caratteri={}", NOTE.chars().count()).as_str())
    );
    assert_eq!(
        outcome.effect,
        CommandEffect::Reveal {
            doc: DocId::new("Nota.md"),
            span: Span {
                start: 0,
                end: NOTE.len(),
            },
        }
    );
}

fn assert_absent(ws: &mut Workspace, registry: &BundleRegistry) {
    assert!(!registry.ids().contains(&ID));
    assert!(registry.body(ID).is_none());
    assert!(!ws.plugins().iter().any(|plugin| plugin.id == ID));
    assert!(!ws.commands().iter().any(|command| command.id == COMMAND));
    assert!(matches!(
        ws.invoke_command(
            COMMAND,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User
        ),
        Err(PluginError::UnknownCommand(_))
    ));
}

#[test]
fn installed_component_is_discovered_invoked_reopened_and_removed() {
    let temp = tempfile::tempdir().unwrap();
    let root = Utf8Path::from_path(temp.path()).unwrap();
    let vault = root.join("vault");
    let plugins = root.join("plugins");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(vault.join("Nota.md"), NOTE).unwrap();
    let installed = install(&plugins, "");
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);

    // Riaprire ricostruisce l'inventario dalla directory, non da un bundle
    // cablato o da una copia dell'istanza della sessione precedente.
    for _ in 0..2 {
        host.open(&vault).unwrap();
        host.wait_indexed(None).unwrap();
        let bundle = Arc::new(discovered(&plugins));
        let released = with_workspace(&host, |ws, registry| {
            assert_absent(ws, registry);
            assert!(!registry.knows(ID));
            registry.remember(bundle.clone());
            assert_absent(ws, registry);
            for _ in 0..2 {
                registry.enable(ws, ID).unwrap();
                assert_command(ws);
                assert!(registry.unmount(ws, ID).is_empty());
                assert_absent(ws, registry);
                assert!(registry.knows(ID), "spento non significa dimenticato");
            }
            // La chiusura deve smontare anche un plugin ancora attivo.
            registry.enable(ws, ID).unwrap();
            assert_command(ws);
            Arc::downgrade(&registry.body(ID).expect("plugin attivo"))
        });
        host.close();
        assert!(
            released.upgrade().is_none(),
            "la sessione rilascia il plugin"
        );
    }

    // La rimozione avviene a sessione chiusa. Non cancella dati del plugin o
    // documenti; alla riapertura il componente non deve ricomparire.
    std::fs::remove_file(installed).unwrap();
    assert!(discover(&plugins).unwrap().is_empty());
    host.open(&vault).unwrap();
    host.wait_indexed(None).unwrap();
    with_workspace(&host, |ws, registry| {
        assert_absent(ws, registry);
        assert!(!registry.knows(ID));
    });
    host.close();
    assert_eq!(
        std::fs::read_to_string(vault.join("Nota.md")).unwrap(),
        NOTE
    );
}

#[test]
fn incompatible_abi_is_rejected_before_activation_or_declaration() {
    let temp = tempfile::tempdir().unwrap();
    let plugins = Utf8Path::from_path(temp.path()).unwrap();
    install(plugins, "abi-incompatibile");
    let bundle = discovered(plugins);
    // Non c'è Nota.md: se activate venisse chiamato, otterremmo un errore di
    // lettura anziché il rifiuto ABI del primo passo.
    let mut ws = Bench::new().mounts();
    let mut registry = BundleRegistry::new();
    assert!(matches!(
        registry.mount(&bundle, &mut ws),
        Err(BundleError::Abi { id, declared }) if id == ID && declared == "99.0.0"
    ));
    assert_absent(&mut ws, &registry);
    assert_eq!(bundle.register(&mut ws), ["no live instance to register"]);
}

#[test]
fn denied_activation_releases_the_instance_even_while_the_bundle_is_known() {
    let temp = tempfile::tempdir().unwrap();
    let plugins = Utf8Path::from_path(temp.path()).unwrap();
    install(plugins, "senza-permessi");
    let bundle = Arc::new(discovered(plugins));
    let mut ws = Bench::new().mounts();
    ws.write("Nota.md", NOTE);
    ws.reindex().unwrap();
    let mut registry = BundleRegistry::new();
    registry.remember(bundle.clone());
    for _ in 0..2 {
        assert!(matches!(
            registry.enable(&mut ws, ID),
            Err(BundleError::Activation {
                error: PluginError::PermissionDenied(_),
                ..
            })
        ));
        assert_absent(&mut ws, &registry);
        assert!(registry.knows(ID));
        // Regressione: con `last: Arc`, register trovava ancora l'istanza del
        // mount fallito e tentava di registrarne i comandi senza proprietario.
        assert_eq!(bundle.register(&mut ws), ["no live instance to register"]);
    }
}

#[test]
fn a_dropped_plugin_cannot_leave_an_instance_for_a_later_registration() {
    let bundle = WasmBundle::from_file(&component(""), Trust::Community).unwrap();
    let mut ws = Bench::new().mounts();
    drop(bundle.plugin());
    assert_eq!(bundle.register(&mut ws), ["no live instance to register"]);
}

#[test]
fn a_teardown_trap_still_removes_the_declaration_and_commands() {
    let bundle =
        Arc::new(WasmBundle::from_file(&component("trap-deactivate"), Trust::Community).unwrap());
    let mut ws = Bench::new().mounts();
    ws.write("Nota.md", NOTE);
    ws.reindex().unwrap();
    let mut registry = BundleRegistry::new();
    registry.remember(bundle);
    for _ in 0..2 {
        registry.enable(&mut ws, ID).unwrap();
        assert_command(&mut ws);
        let errors = registry.unmount(&mut ws, ID);
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert!(matches!(errors[0], PluginError::Internal(_)));
        assert_absent(&mut ws, &registry);
    }
}

#[test]
fn a_broken_component_does_not_hide_a_valid_neighbor() {
    let temp = tempfile::tempdir().unwrap();
    let plugins = Utf8Path::from_path(temp.path()).unwrap();
    install(plugins, "");
    std::fs::write(plugins.join("broken.wasm"), b"not a component").unwrap();
    let candidates = discover(plugins).unwrap();
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].path.file_name(), Some("broken.wasm"));
    assert!(candidates[0].bundle.is_err());
    assert_eq!(candidates[1].bundle.as_ref().unwrap().manifest().id, ID);
}
