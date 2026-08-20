//! **La radice di un vault è assoluta, e lo diventa entrando.**
//!
//! Una radice relativa non è una cartella: è una cartella *più* la cartella di
//! lavoro del processo. Il `Vault` ci appende `.fub` e `.trash` a ogni domanda,
//! e con lui le impostazioni, l'organizzazione, le bozze, l'anagrafe e il
//! registro derivano lì il proprio path: se la radice fosse relativa sarebbero
//! sei file che si spostano insieme alla cartella di lavoro, e dopo un
//! `set_current_dir` il vault rileggerebbe l'indice da un'altra parte di dove
//! l'ha scritto.
//!
//! **Perché la prova non muove la cartella di lavoro.** Sarebbe la
//! dimostrazione più letterale e sarebbe sbagliata due volte: `set_current_dir`
//! è del *processo*, e i banchi di uno stesso binario girano in parallelo nello
//! stesso processo — un solo test che la sposta avvelena tutti gli altri. E
//! soprattutto misurerebbe la conseguenza invece della proprietà: ciò che si
//! vuole non è «dopo questo `set_current_dir` non è successo niente», è **che
//! non ci sia niente da spostare**. Un path assoluto non si muove per
//! definizione, e i banchi qui sotto provano quello.

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_kernel::storage::{DirEntry, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, MemStorage, Vault, Workspace};

/// Un supporto che **annota ogni path che gli passa davanti** e per il resto è
/// il supporto in memoria.
///
/// È la cucitura che rende osservabile ciò che altrimenti non lo sarebbe: i sei
/// store del workspace tengono i propri path privati, e l'unico posto in cui li
/// pronunciano tutti è il supporto.
struct AnnotatingStorage {
    inner: MemStorage,
    seen: Arc<Mutex<Vec<Utf8PathBuf>>>,
}

impl AnnotatingStorage {
    fn new() -> (Arc<Self>, Arc<Mutex<Vec<Utf8PathBuf>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        (
            Arc::new(AnnotatingStorage {
                inner: MemStorage::new(),
                seen: Arc::clone(&seen),
            }),
            seen,
        )
    }

    fn annotate(&self, path: &Utf8Path) {
        self.seen
            .lock()
            .expect("annotations")
            .push(path.to_owned());
    }
}

impl VaultStorage for AnnotatingStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.annotate(path);
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<fub_kernel::storage::Stat> {
        self.annotate(path);
        self.inner.write(path, bytes)
    }
    fn update(
        &self,
        path: &Utf8Path,
        merge: fub_kernel::storage::Merge<'_>,
    ) -> std::io::Result<()> {
        self.annotate(path);
        self.inner.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.annotate(path);
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.annotate(from);
        self.annotate(to);
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.annotate(from);
        self.annotate(to);
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.annotate(path);
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.annotate(dir);
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.annotate(path);
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.annotate(dir);
        self.inner.remove_empty_dir(dir)
    }
}

/// Un nome relativo che non esiste sul disco, e non deve: la radice si rende
/// assoluta **senza chiedere al filesystem**, che è la differenza fra rendere
/// assoluto e canonicalizzare.
const RELATIVE: &str = "a-relative-vault";

/// La radice assoluta che ci si aspetta, calcolata come la calcolerebbe
/// chiunque legga un path relativo: appesa alla cartella di lavoro di adesso.
/// chiunque legga un path relativo: appesa alla cartella di lavoro di adesso.
fn expected() -> Utf8PathBuf {
    let cwd = std::env::current_dir().expect("working directory");
    Utf8PathBuf::from_path_buf(cwd)
        .expect("working directory UTF-8")
        .join(RELATIVE)
}

/// **Un `Vault` costruito su un nome relativo tiene una radice assoluta.**
///
/// È il costruttore, non il chiamante, a fissarla: `Vault::on` è l'unica riga
/// che costruisce il campo, quindi non esiste un `Vault` la cui radice sia una
/// ricetta invece di una cartella.
#[test]
fn a_vault_on_a_relative_name_keeps_an_absolute_root() {
    let vault =
        Vault::on(RELATIVE, Arc::new(MemStorage::new())).expect("the vault opens");
    assert!(
        vault.root().is_absolute(),
        "the root stayed relative: {}",
        vault.root()
    );
    assert_eq!(
        vault.root(),
        expected(),
        "and it is the one appended to the working directory, not another folder"
    );
}

/// **Nessuno dei sei store del workspace nomina un path relativo.**
///
/// L'assunto che rende questo banco più forte di sei `assert` sui sei store:
/// tutti e sei derivano il proprio path dalla stessa `root`, e l'unico posto in
/// cui lo *pronunciano* è il supporto. Chi aggiungerà il settimo store non deve
/// ricordarsi di niente — o il suo path finisce qui dentro assoluto, o questo
/// banco diventa rosso.
///
/// Il conto minimo non è una decorazione: senza, un workspace che non toccasse
/// mai il supporto renderebbe l'asserzione vera su un insieme vuoto, cioè verde
/// per la ragione opposta a quella che si vuole.
#[test]
fn no_workspace_store_names_a_relative_path() {
    let (storage, seen) = AnnotatingStorage::new();
    let ws = Workspace::on(
        RELATIVE,
        FormatRegistry::new(),
        storage,
        MachineSettings::in_memory(),
    )
    .expect("the vault opens");
    assert!(
        ws.root().is_absolute(),
        "the workspace root stayed relative: {}",
        ws.root()
    );

    // Far parlare gli store che al montaggio non hanno ancora niente da dire:
    // il registro scrive solo quando succede qualcosa, il cestino solo quando
    // lo si guarda.
    let _ = ws.list_trash();

    let seen = seen.lock().expect("annotations").clone();
    assert!(
        seen.len() >= 3,
        "the storage has not seen enough paths for the assertion to say \
         anything: {seen:?}"
    );
    let relative: Vec<&Utf8PathBuf> = seen.iter().filter(|p| !p.is_absolute()).collect();
    assert!(
        relative.is_empty(),
        "{} path(s) out of {} are relative, and will move with the process's \
         working directory: {relative:?}",
        relative.len(),
        seen.len()
    );
    let expected = expected();
    assert!(
        seen.iter().all(|p| p.starts_with(&expected)),
        "and they are all inside the expected root {expected}: {seen:?}"
    );
}
