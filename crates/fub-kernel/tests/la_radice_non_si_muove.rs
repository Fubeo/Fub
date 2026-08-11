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
struct SupportoCheAnnota {
    inner: MemStorage,
    visti: Arc<Mutex<Vec<Utf8PathBuf>>>,
}

impl SupportoCheAnnota {
    fn nuovo() -> (Arc<Self>, Arc<Mutex<Vec<Utf8PathBuf>>>) {
        let visti = Arc::new(Mutex::new(Vec::new()));
        (
            Arc::new(SupportoCheAnnota {
                inner: MemStorage::new(),
                visti: Arc::clone(&visti),
            }),
            visti,
        )
    }

    fn annota(&self, path: &Utf8Path) {
        self.visti
            .lock()
            .expect("annotazioni")
            .push(path.to_owned());
    }
}

impl VaultStorage for SupportoCheAnnota {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.annota(path);
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.annota(path);
        self.inner.write(path, bytes)
    }
    fn update(
        &self,
        path: &Utf8Path,
        fondi: fub_kernel::storage::Fusione<'_>,
    ) -> std::io::Result<()> {
        self.annota(path);
        self.inner.update(path, fondi)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.annota(path);
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.annota(from);
        self.annota(to);
        self.inner.rename(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.annota(path);
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.annota(dir);
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.annota(path);
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.annota(dir);
        self.inner.remove_empty_dir(dir)
    }
}

/// Un nome relativo che non esiste sul disco, e non deve: la radice si rende
/// assoluta **senza chiedere al filesystem**, che è la differenza fra rendere
/// assoluto e canonicalizzare.
const RELATIVA: &str = "un-vault-relativo";

/// La radice assoluta che ci si aspetta, calcolata come la calcolerebbe
/// chiunque legga un path relativo: appesa alla cartella di lavoro di adesso.
fn attesa() -> Utf8PathBuf {
    let cwd = std::env::current_dir().expect("cartella di lavoro");
    Utf8PathBuf::from_path_buf(cwd)
        .expect("cartella di lavoro UTF-8")
        .join(RELATIVA)
}

/// **Un `Vault` costruito su un nome relativo tiene una radice assoluta.**
///
/// È il costruttore, non il chiamante, a fissarla: `Vault::on` è l'unica riga
/// che costruisce il campo, quindi non esiste un `Vault` la cui radice sia una
/// ricetta invece di una cartella.
#[test]
fn un_vault_su_un_nome_relativo_tiene_una_radice_assoluta() {
    let vault = Vault::on(RELATIVA, Arc::new(MemStorage::new()));
    assert!(
        vault.root().is_absolute(),
        "la radice è restata relativa: {}",
        vault.root()
    );
    assert_eq!(
        vault.root(),
        attesa(),
        "ed è quella data appesa alla cartella di lavoro, non un'altra cartella"
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
fn nessuno_store_del_workspace_nomina_un_path_relativo() {
    let (storage, visti) = SupportoCheAnnota::nuovo();
    let ws = Workspace::on(
        RELATIVA,
        FormatRegistry::new(),
        storage,
        MachineSettings::in_memory(),
    );
    assert!(
        ws.root().is_absolute(),
        "la radice del workspace è restata relativa: {}",
        ws.root()
    );

    // Far parlare gli store che al montaggio non hanno ancora niente da dire:
    // il registro scrive solo quando succede qualcosa, il cestino solo quando
    // lo si guarda.
    let _ = ws.list_trash();

    let visti = visti.lock().expect("annotazioni").clone();
    assert!(
        visti.len() >= 3,
        "il supporto non ha visto abbastanza path perché l'asserzione dica \
         qualcosa: {visti:?}"
    );
    let relativi: Vec<&Utf8PathBuf> = visti.iter().filter(|p| !p.is_absolute()).collect();
    assert!(
        relativi.is_empty(),
        "{} path su {} sono relativi, e si sposteranno con la cartella di \
         lavoro del processo: {relativi:?}",
        relativi.len(),
        visti.len()
    );
    let attesa = attesa();
    assert!(
        visti.iter().all(|p| p.starts_with(&attesa)),
        "e stanno tutti dentro la radice attesa {attesa}: {visti:?}"
    );
}
