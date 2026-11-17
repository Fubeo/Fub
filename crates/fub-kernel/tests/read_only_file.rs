//! **Un file in sola lettura non si sovrascrive** (PA T59).
//!
//! La scrittura atomica crea un temporaneo accanto al file e lo rinomina
//! sopra: la rename chiede il permesso della cartella, non quello del file.
//! Senza un controllo esplicito, su Linux e macOS un file `0444` veniva
//! sostituito, e su Windows il rifiuto arrivava come un I/O qualunque. Qui si
//! prova, sui due supporti su disco e attraverso il workspace, che:
//!
//! - il file in sola lettura dà `PermissionDenied` col suo nome;
//! - i byte restano, e accanto non resta nessun temporaneo;
//! - un file scrivibile e un file nuovo si scrivono come prima;
//! - il permesso tolto dopo l'apertura vale al salvataggio.
//!
//! I file si mettono in sola lettura con `set_readonly(true)` di std, che su
//! Unix toglie i tre bit di scrittura e su Windows mette l'attributo. Alla fine
//! la sola lettura si toglie, perché su Windows la cartella temporanea non si
//! cancellerebbe.

use std::io;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::PluginError;
use fub_kernel::{FsStorage, RootedFsStorage, VaultStorage};

/// Una cartella temporanea che, quando se ne va, rimette scrivibili i file che
/// il test ha messo in sola lettura.
struct Dir {
    _temp: tempfile::TempDir,
    root: Utf8PathBuf,
    locked: Vec<Utf8PathBuf>,
}

impl Dir {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(temp.path().to_owned()).expect("utf8");
        Dir {
            _temp: temp,
            root,
            locked: Vec::new(),
        }
    }

    fn file(&self, name: &str, bytes: &[u8]) -> Utf8PathBuf {
        let path = self.root.join(name);
        std::fs::write(&path, bytes).expect("writes the fixture");
        path
    }

    fn lock(&mut self, path: &Utf8Path) {
        set_read_only(path, true);
        self.locked.push(path.to_owned());
    }

    /// I nomi della cartella, per vedere che non è rimasto un temporaneo.
    fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&self.root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| !name.ends_with(".lock"))
            .collect();
        names.sort();
        names
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        for path in &self.locked {
            if path.exists() {
                set_read_only(path, false);
            }
        }
    }
}

fn set_read_only(path: &Utf8Path, read_only: bool) {
    let mut permissions = std::fs::metadata(path).unwrap().permissions();
    // Su Unix `set_readonly(false)` dà la scrittura a tutti: va bene per una
    // cartella temporanea che sta per essere cancellata.
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(read_only);
    std::fs::set_permissions(path, permissions).unwrap();
}

#[track_caller]
fn assert_refused(result: io::Result<impl std::fmt::Debug>, path: &Utf8Path) {
    let error = result.expect_err("a read-only file is not overwritten");
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied, "{error}");
    assert!(
        error.to_string().contains(path.as_str()),
        "the message names the file: {error}"
    );
}

/// Il giro intero su un supporto aperto sulla cartella del test.
fn exercise(open: impl FnOnce(&Utf8Path) -> Box<dyn VaultStorage>) {
    let mut dir = Dir::new();
    let storage = open(&dir.root);
    let locked = dir.file("Sola lettura.md", b"prima\n");
    dir.lock(&locked);
    let before = dir.names();

    assert_refused(storage.write(&locked, b"dopo\n"), &locked);
    assert_refused(storage.write_derived(&locked, b"dopo\n"), &locked);
    assert_eq!(
        std::fs::read(&locked).unwrap(),
        b"prima\n",
        "the bytes stay"
    );
    assert_eq!(dir.names(), before, "no temporary is left beside it");
    assert!(
        std::fs::metadata(&locked).unwrap().permissions().readonly(),
        "the file stays read-only"
    );

    // Il compare-and-swap passa dalla stessa scrittura.
    assert_refused(
        storage.write_if_unchanged(&locked, Some(b"prima\n"), b"dopo\n"),
        &locked,
    );
    assert_eq!(std::fs::read(&locked).unwrap(), b"prima\n");

    // Un file scrivibile e un file nuovo si scrivono come prima.
    let writable = dir.file("Scrivibile.md", b"prima\n");
    storage
        .write(&writable, b"dopo\n")
        .expect("a writable file");
    assert_eq!(std::fs::read(&writable).unwrap(), b"dopo\n");
    let new = dir.root.join("Nuovo.md");
    storage.write(&new, b"nuovo\n").expect("a new file");
    assert_eq!(std::fs::read(&new).unwrap(), b"nuovo\n");

    // Il permesso tolto dopo una scrittura riuscita vale alla successiva.
    dir.lock(&writable);
    assert_refused(storage.write(&writable, b"ancora\n"), &writable);
    assert_eq!(std::fs::read(&writable).unwrap(), b"dopo\n");

    // E ridato, si torna a scrivere.
    set_read_only(&writable, false);
    storage
        .write(&writable, b"ancora\n")
        .expect("writable again");
    assert_eq!(std::fs::read(&writable).unwrap(), b"ancora\n");
}

#[test]
fn il_supporto_ancorato_rifiuta_il_file_in_sola_lettura() {
    exercise(|root| Box::new(RootedFsStorage::open(root).expect("opens the root")));
}

#[test]
fn il_supporto_ambientale_rifiuta_il_file_in_sola_lettura() {
    exercise(|_| Box::new(FsStorage));
}

/// Attraverso il workspace il rifiuto arriva al contratto come
/// `PermissionDenied`, non come `Io`: è ciò che la shell legge per dire «il
/// file è in sola lettura» e non riprovare a ogni battuta.
#[test]
fn il_rifiuto_arriva_al_contratto_come_permesso_negato() {
    let mut dir = Dir::new();
    let storage = RootedFsStorage::open(&dir.root).expect("opens the root");
    let locked = dir.file("Nota.md", b"prima\n");
    dir.lock(&locked);
    let source = storage.write(&locked, b"dopo\n").expect_err("refused");
    let plugin: PluginError = fub_kernel::KernelError::Io {
        path: locked.clone(),
        source,
    }
    .into();
    let PluginError::PermissionDenied(text) = &plugin else {
        panic!("a typed refusal, not {plugin:?}");
    };
    assert_eq!(
        text.to_string(),
        format!("il file è in sola lettura: {locked}")
    );

    // Gli altri permessi negati del sistema restano `Io`.
    let other: PluginError = fub_kernel::KernelError::Io {
        path: "Cartella".into(),
        source: io::Error::from(io::ErrorKind::PermissionDenied),
    }
    .into();
    assert!(matches!(other, PluginError::Io(_)), "{other:?}");
}
