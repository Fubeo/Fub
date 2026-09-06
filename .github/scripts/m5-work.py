"""Temporary, branch-only development patch. Removed before the final PR."""
from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        if new in text:
            return
        raise RuntimeError(f"Expected source not found in {path}: {old[:100]}")
    if text.count(old) != 1:
        raise RuntimeError(f"Ambiguous replacement in {path}")
    p.write_text(text.replace(old, new, 1))


component = "crates/fub-wasm-host/src/component.rs"
replace(component, "use std::sync::{Arc, Mutex};", "use std::sync::{Arc, Mutex, Weak};")
replace(component, "last: Mutex<Option<Arc<Mutex<Instance>>>>,", "last: Mutex<Option<Weak<Mutex<Instance>>>>,")
replace(component, "*last = Some(Arc::clone(&inner));", "*last = Some(Arc::downgrade(&inner));")
replace(component, "self.last.lock().map(|mut u| u.take())", "self.last.lock().map(|mut u| u.take().and_then(|instance| instance.upgrade()))")
replace(component,
    "// La copia che `register` verrà a prendere fra un passo. Un\n                // `plugin()` senza il `register()` che lo segue la lascia qui e\n                // la fa buttare dal prossimo: è un `Arc` in più che vive quanto\n                // il bundle, non una perdita.",
    "// Un riferimento debole: se l'attivazione fallisce, il plugin\n                // restituito viene scartato e l'istanza muore subito, anche\n                // quando il bundle resta nell'inventario dei conosciuti.")
replace(component,
    "pub fn from_file(path: &Utf8Path, trust: Trust) -> Result<Self, LoadError> {\n        let component = Component::from_file(path)?;",
    "pub fn from_file(path: &Utf8Path, trust: Trust) -> Result<Self, LoadError> {\n        Self::from_bytes(&std::fs::read(path)?, trust)\n    }\n\n    /// Legge il manifest dai byte che verranno installati, senza riaprire il file.\n    pub fn from_bytes(bytes: &[u8], trust: Trust) -> Result<Self, LoadError> {\n        let component = Component::from_bytes(bytes)?;")
replace("crates/fub-wasm-host/src/lib.rs", "mod component;", "mod component;\nmod directory;")
replace("crates/fub-wasm-host/src/lib.rs", "pub use component::{", "pub use directory::{ComponentDirectory, DiscoveryReport, MAX_COMPONENT_BYTES};\n\npub use component::{")
replace("crates/fub-wasm-host/Cargo.toml", "[dev-dependencies]\nfub-testkit.workspace = true\ntempfile.workspace = true", "tempfile.workspace = true\n\n[dev-dependencies]\nfub-testkit.workspace = true")

Path("crates/fub-wasm-host/src/directory.rs").write_text(r'''//! Componenti installati: byte su disco, non fiducia né attivazione.
//!
//! Questa directory contiene soltanto pacchetti installati. Non è lo storage
//! autorevole `.fub/plugins/`: rimuovere un componente non rimuove i suoi dati.
//! La directory è amministrata dall'utente della macchina; un componente non
//! riceve mai una capacità per modificarla.

use std::io::{Read, Write};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::traits::{abi_compatible, PluginManifest};
use fub_abi::PluginError;
use fub_host::Bundle;
use fub_kernel::Trust;

use crate::WasmBundle;

/// Dimensione massima del pacchetto prima della compilazione: 64 MiB.
pub const MAX_COMPONENT_BYTES: u64 = 64 * 1024 * 1024;

/// Componenti validi e rifiuti nominati: un pacchetto guasto non nasconde gli altri.
#[derive(Debug, Default)]
#[must_use]
pub struct DiscoveryReport {
    /// Componenti validati, ancora spenti e sempre di comunità.
    pub components: Vec<WasmBundle>,
    /// Pacchetti rifiutati, con il loro percorso nel messaggio.
    pub errors: Vec<PluginError>,
}

/// La directory `components/` di una configurazione macchina.
#[derive(Debug)]
pub struct ComponentDirectory {
    root: Utf8PathBuf,
}

impl ComponentDirectory {
    /// Sceglie la configurazione senza creare o modificare alcun file.
    pub fn new(config_dir: &Utf8Path) -> Self {
        Self { root: config_dir.join("components") }
    }

    /// Posizione dei pacchetti; distinta dallo storage dei plugin nel vault.
    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// Legge e valida un pacchetto senza installarlo né concedergli capacità.
    pub fn inspect(source: &Utf8Path) -> Result<PluginManifest, PluginError> {
        let bytes = read_package(source)?;
        Ok(checked_bundle(&bytes)?.manifest())
    }

    /// Installa i byte già validati con pubblicazione atomica e senza sostituzioni.
    ///
    /// Il manifest viene eseguito in sandbox senza host; ABI, identità e import
    /// sono verificati prima di scrivere. Installare non significa attivare.
    /// Per aggiornare un pacchetto va prima spento e rimosso quello precedente.
    pub fn install(&self, source: &Utf8Path) -> Result<PluginManifest, PluginError> {
        let bytes = read_package(source)?;
        let manifest = checked_bundle(&bytes)?.manifest();
        std::fs::create_dir_all(&self.root).map_err(io_error)?;
        check_directory(&self.root)?;
        let path = self.root.join(package_name(&manifest.id)?);
        let mut staged = tempfile::Builder::new()
            .prefix(".install-")
            .suffix(".tmp")
            .tempfile_in(&self.root)
            .map_err(io_error)?;
        staged.write_all(&bytes).map_err(io_error)?;
        staged.as_file().sync_all().map_err(io_error)?;
        staged.persist_noclobber(&path).map_err(|error| io_error(error.error))?;
        Ok(manifest)
    }

    /// Scopre pacchetti in ordine di nome, senza registrarli o attivarli.
    pub fn discover(&self) -> Result<DiscoveryReport, PluginError> {
        match std::fs::symlink_metadata(&self.root) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(DiscoveryReport::default());
            }
            Err(error) => return Err(io_error(error)),
            Ok(_) => check_directory(&self.root)?,
        }
        let mut paths = std::fs::read_dir(&self.root)
            .map_err(io_error)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(io_error)?;
        paths.sort();
        let mut report = DiscoveryReport::default();
        for path in paths {
            if path.extension().and_then(|s| s.to_str()) != Some("wasm") {
                continue;
            }
            let result = (|| {
                let path = Utf8PathBuf::from_path_buf(path.clone()).map_err(|_| {
                    PluginError::BadArgs("il percorso del componente non è UTF-8".into())
                })?;
                let bundle = checked_bundle(&read_package(&path)?)?;
                if path.file_name() != Some(package_name(&bundle.manifest().id)?.as_str()) {
                    return Err(PluginError::BadArgs(
                        "il nome del pacchetto non corrisponde all'identità del manifest".into(),
                    ));
                }
                Ok(bundle)
            })();
            match result {
                Ok(bundle) => report.components.push(bundle),
                Err(error) => report.errors.push(PluginError::BadArgs(
                    format!("{}: {error}", path.display()).into(),
                )),
            }
        }
        Ok(report)
    }

    /// Rimuove soltanto il pacchetto installato, mai lo storage dei plugin.
    ///
    /// Operazione offline: il chiamante deve aver disattivato il componente e
    /// chiuso le sessioni che lo conoscevano. Un file rimosso non può revocare
    /// istanze già caricate in un altro processo. La discovery successiva non
    /// lo trova più; nessun pacchetto è aggiornato sotto un'istanza in uso.
    pub fn remove(&mut self, id: &str) -> Result<(), PluginError> {
        let name = package_name(id)?;
        check_directory(&self.root)?;
        std::fs::remove_file(self.root.join(name)).map_err(io_error)
    }
}

fn read_package(source: &Utf8Path) -> Result<Vec<u8>, PluginError> {
    let metadata = std::fs::symlink_metadata(source).map_err(io_error)?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_COMPONENT_BYTES {
        return Err(PluginError::BadArgs(
            "il componente deve essere un file regolare non oltre 64 MiB, non un link".into(),
        ));
    }
    // Il tetto si applica anche se il file cresce dopo la lettura dei metadata.
    let mut bytes = Vec::new();
    std::fs::File::open(source)
        .map_err(io_error)?
        .take(MAX_COMPONENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_COMPONENT_BYTES {
        return Err(PluginError::BadArgs("il componente supera 64 MiB".into()));
    }
    Ok(bytes)
}

fn checked_bundle(bytes: &[u8]) -> Result<WasmBundle, PluginError> {
    let bundle = WasmBundle::from_bytes(bytes, Trust::Community)
        .map_err(|error| PluginError::BadArgs(error.to_string().into()))?;
    let manifest = bundle.manifest();
    package_name(&manifest.id)?;
    if !abi_compatible(&manifest.abi_version) {
        return Err(PluginError::Unserved(
            format!("{}: ABI incompatibile {}", manifest.id, manifest.abi_version).into(),
        ));
    }
    Ok(bundle)
}

fn package_name(id: &str) -> Result<String, PluginError> {
    // Il prefisso evita anche i nomi di dispositivo di Windows (CON, AUX, ...).
    // È una regola del pacchetto, non una nuova grammatica nel contratto ABI.
    if id.is_empty() || id.len() > 128 || id == "." || id == ".."
        || !id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_'))
        || id == "fub" || id.starts_with("fub.")
    {
        return Err(PluginError::BadArgs(
            format!("identità del pacchetto non ammessa: {id:?}").into(),
        ));
    }
    Ok(format!("component-{id}.wasm"))
}

fn check_directory(root: &Utf8Path) -> Result<(), PluginError> {
    if !std::fs::symlink_metadata(root).map_err(io_error)?.file_type().is_dir() {
        return Err(PluginError::BadArgs("components deve essere una directory reale, non un link".into()));
    }
    Ok(())
}

fn io_error(error: std::io::Error) -> PluginError {
    let message = error.to_string().into();
    match error.kind() {
        std::io::ErrorKind::NotFound => PluginError::NotFound(message),
        std::io::ErrorKind::AlreadyExists => PluginError::AlreadyExists(message),
        std::io::ErrorKind::PermissionDenied => PluginError::PermissionDenied(message),
        _ => PluginError::Io(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_identity_cannot_escape_or_impersonate_the_core() {
        for id in ["", ".", "..", "../other", "/tmp/a", r"a\b", "a:b", "fub", "fub.search"] {
            assert!(package_name(id).is_err(), "{id}");
        }
        assert_eq!(package_name("demo.ping").unwrap(), "component-demo.ping.wasm");
        assert_eq!(package_name("CON").unwrap(), "component-CON.wasm");
    }
}
''')

Path("crates/fub-wasm-host/tests/installed_components.rs").write_text(r'''//! Installazione e ciclo reale: il pacchetto viene compilato, non simulato.
mod common;

use std::sync::OnceLock;
use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::event::Actor;
use fub_abi::PluginError;
use fub_host::{Bundle, Host, NoWatcher};
use fub_kernel::Trust;
use fub_wasm_host::{ComponentDirectory, WasmBundle, MAX_COMPONENT_BYTES};

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
        let result = ws.invoke_command(&command, serde_json::json!({}), InvokeMode::Apply, Actor::User).unwrap();
        assert_eq!(result.notify.unwrap().as_literal(), Some("7 caratteri"));
        assert!(registry.unmount(&mut ws, &manifest.id).is_empty());
        assert!(!registry.ids().contains(&manifest.id.as_str()));
        assert!(matches!(ws.invoke_command(&command, serde_json::json!({}), InvokeMode::Apply, Actor::User), Err(PluginError::UnknownCommand(_))));
        // Riaprire il componente crea una nuova istanza, non una registrazione morta.
        registry.mount(&bundle, &mut ws).unwrap();
        assert!(registry.unmount(&mut ws, &manifest.id).is_empty());
    }).unwrap();
    host.close();
    drop(host);
    drop(bundle);
    packages.remove(&manifest.id).unwrap();
    assert!(packages.discover().unwrap().components.is_empty());
    assert_eq!(std::fs::read_to_string(vault.join("Nota.md")).unwrap(), "# Nota\n");
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
    assert!(matches!(packages.install(&source), Err(PluginError::AlreadyExists(_))));
    let installed = std::fs::read_dir(packages.root()).unwrap().next().unwrap().unwrap().path();
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
    std::fs::File::create(&source).unwrap().set_len(MAX_COMPONENT_BYTES + 1).unwrap();
    assert!(matches!(ComponentDirectory::inspect(&source), Err(PluginError::BadArgs(_))));
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
        ws.register_plugin(bundle.manifest(), Trust::Community).unwrap();
        let plugin = bundle.plugin();
        drop(plugin);
        let warnings = bundle.register(&mut ws);
        assert!(warnings.iter().any(|warning| warning.starts_with("no instance")), "{warnings:?}");
        assert!(!ws.commands().iter().any(|command| command.id.starts_with("demo.ping:")));
    }).unwrap();
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
''')
