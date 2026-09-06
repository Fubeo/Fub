//! Componenti installati: byte su disco, non fiducia né attivazione.
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
        Self {
            root: config_dir.join("components"),
        }
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
        staged
            .persist_noclobber(&path)
            .map_err(|error| io_error(error.error))?;
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
            format!(
                "{}: ABI incompatibile {}",
                manifest.id, manifest.abi_version
            )
            .into(),
        ));
    }
    Ok(bundle)
}

fn package_name(id: &str) -> Result<String, PluginError> {
    // Il prefisso evita anche i nomi di dispositivo di Windows (CON, AUX, ...).
    // È una regola del pacchetto, non una nuova grammatica nel contratto ABI.
    if id.is_empty()
        || id.len() > 128
        || id == "."
        || id == ".."
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_'))
        || id == "fub"
        || id.starts_with("fub.")
    {
        return Err(PluginError::BadArgs(
            format!("identità del pacchetto non ammessa: {id:?}").into(),
        ));
    }
    Ok(format!("component-{id}.wasm"))
}

fn check_directory(root: &Utf8Path) -> Result<(), PluginError> {
    if !std::fs::symlink_metadata(root)
        .map_err(io_error)?
        .file_type()
        .is_dir()
    {
        return Err(PluginError::BadArgs(
            "components deve essere una directory reale, non un link".into(),
        ));
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
        for id in [
            "",
            ".",
            "..",
            "../other",
            "/tmp/a",
            r"a\b",
            "a:b",
            "fub",
            "fub.search",
        ] {
            assert!(package_name(id).is_err(), "{id}");
        }
        assert_eq!(
            package_name("demo.ping").unwrap(),
            "component-demo.ping.wasm"
        );
        assert_eq!(package_name("CON").unwrap(), "component-CON.wasm");
    }
}
