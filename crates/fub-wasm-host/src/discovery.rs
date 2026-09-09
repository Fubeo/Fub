//! Discovery esplicita dei componenti per gli host nativi.
//!
//! La directory è scelta dall'host, non dal manifest e non dal vault. Scoprire
//! non è attivare: ABI, dichiarazione e permessi restano del mount comune.

use std::io;

use camino::{Utf8Path, Utf8PathBuf};
use fub_kernel::Trust;

use crate::{LoadError, WasmBundle};

/// Un candidato trovato su disco, con il proprio esito di caricamento.
///
/// Un componente guasto non nasconde gli altri. Il chiamante deve presentare
/// gli errori prima di scegliere quali bundle passare al registry.
#[derive(Debug)]
pub struct DiscoveredPlugin {
    /// Percorso del file, relativo alla stessa base della directory ricevuta.
    pub path: Utf8PathBuf,
    /// Componente caricato, non ancora autorizzato né montato.
    pub bundle: Result<WasmBundle, LoadError>,
}

/// Scopre i file regolari `.wasm` direttamente dentro `directory`.
///
/// L'ordine è lessicografico per percorso. Sottodirectory, link simbolici e
/// file con altre estensioni vengono ignorati; una directory assente è vuota.
/// Gli errori di lettura della directory restano errori, non inventari vuoti.
/// Il chiamante deve scegliere una directory sotto il proprio controllo:
/// questa scansione non protegge da sostituzioni concorrenti dei file.
///
/// Ogni bundle riceve [`Trust::Community`], mai la fiducia dichiarata dal
/// componente. Il manifest viene letto in sandbox, senza un host del vault.
/// La verifica ABI e la dichiarazione passano poi da
/// [`fub_host::BundleRegistry::mount`]. Qui non si registra né si attiva nulla.
/// In particolare, scoprire due file con lo stesso id non sceglie un vincitore:
/// il chiamante deve rifiutare il duplicato prima di `remember`.
pub fn discover(directory: &Utf8Path) -> io::Result<Vec<DiscoveredPlugin>> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension() != Some(std::ffi::OsStr::new("wasm")) {
            continue;
        }
        let path = Utf8PathBuf::from_path_buf(path).map_err(|path| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("percorso del componente non UTF-8: {}", path.display()),
            )
        })?;
        paths.push(path);
    }
    paths.sort();
    Ok(paths
        .into_iter()
        .map(|path| DiscoveredPlugin {
            bundle: WasmBundle::from_file(&path, Trust::Community),
            path,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_directory_is_empty_but_a_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(dir.path()).unwrap();
        assert!(discover(&root.join("absent")).unwrap().is_empty());
        let file = root.join("not-a-directory");
        std::fs::write(&file, b"file").unwrap();
        assert!(discover(&file).is_err());
    }

    #[test]
    fn only_direct_regular_wasm_files_are_candidates_in_stable_order() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(dir.path()).unwrap();
        std::fs::write(root.join("z.wasm"), b"invalid").unwrap();
        std::fs::write(root.join("a.wasm"), b"invalid").unwrap();
        std::fs::write(root.join("download.wasm.part"), b"partial").unwrap();
        std::fs::write(root.join("README.md"), b"notes").unwrap();
        std::fs::create_dir(root.join("nested.wasm")).unwrap();
        std::fs::write(root.join("nested.wasm/hidden.wasm"), b"invalid").unwrap();
        let found = discover(root).unwrap();
        assert_eq!(
            found
                .iter()
                .map(|candidate| candidate.path.file_name().unwrap())
                .collect::<Vec<_>>(),
            ["a.wasm", "z.wasm"]
        );
        assert!(found.iter().all(|candidate| candidate.bundle.is_err()));
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_are_not_candidates() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(dir.path()).unwrap();
        std::fs::write(root.join("source"), b"invalid").unwrap();
        std::os::unix::fs::symlink(root.join("source"), root.join("link.wasm")).unwrap();
        assert!(discover(root).unwrap().is_empty());
    }
}
