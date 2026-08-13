//! **Correggere una maiuscola non è né cancellare né sovrascrivere.**
//!
//! `nota.md` → `Nota.md` è la rinomina che il nome non sa giudicare: le due
//! stringhe sono diverse, e se il posto che nominano sia uno o due lo decide il
//! **filesystem**, non chi guarda. Da qui i due errori opposti che questo banco
//! tiene fermi, e che sono lo stesso errore visto dai due lati:
//!
//! - dove i due nomi sono **lo stesso file** (APFS, NTFS), una guardia che
//!   chiede «esiste già qualcosa lì?» trova sé stessa e risponde di no alla
//!   rinomina — e la bozza non salvata, che è l'unica copia di ciò che l'utente
//!   ha scritto, resta orfana sotto la chiave vecchia mentre il documento si è
//!   mosso;
//! - dove i due nomi sono **due file** (ext4), saltare quella guardia perché
//!   «tanto sarà lo stesso file» ne seppellisce uno.
//!
//! La domanda giusta è una sola e non è sul nome: *questo path è lo stesso file
//! di quello?* — e la risponde il supporto, che è l'unico a saperlo
//! ([`VaultStorage::same_file`]).
//!
//! Il fs insensibile è un **doppio** e non una macchina, per la ragione scritta
//! accanto al gemello in `kernel/src/docdata.rs`: la macchina su cui il difetto
//! vive non è quella su cui gira la CI, quindi la proprietà o si scrive contro
//! un supporto così o non si scrive affatto. Chi invece risponde alla domanda
//! *sul disco vero* — l'identità di inode e volume — ha il suo terzo banco qui
//! sotto, su `FsStorage`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::DocId;
use fub_kernel::storage::{DirEntry, FsStorage, Fusione, MemStorage, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, KernelError, MachineSettings, Workspace};
use fub_testkit::TestoDiProva;

/// Un supporto che **non distingue il caso**, come APFS e NTFS: due nomi che
/// differiscono solo per una maiuscola sono lo stesso posto — e lo dice anche
/// quando gli si chiede l'identità, che è l'unica riga per cui questo doppio
/// esiste.
#[derive(Default)]
struct SenzaCaso(MemStorage, AtomicBool);

impl SenzaCaso {
    fn giu(path: &Utf8Path) -> Utf8PathBuf {
        Utf8PathBuf::from(path.as_str().to_lowercase())
    }

    fn occupa_se_richiesto(&self, path: &Utf8Path) -> std::io::Result<()> {
        if self.1.swap(false, Ordering::SeqCst) {
            self.0.write(&Self::giu(path), b"concorrente")?;
        }
        Ok(())
    }
}

impl VaultStorage for SenzaCaso {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.0.read(&Self::giu(path))
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<fub_kernel::storage::Stat> {
        self.0.write(&Self::giu(path), bytes)
    }
    fn update(&self, path: &Utf8Path, fondi: Fusione<'_>) -> std::io::Result<()> {
        self.0.update(&Self::giu(path), fondi)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.0.append(&Self::giu(path), bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.occupa_se_richiesto(to)?;
        self.0.rename(&Self::giu(from), &Self::giu(to))
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.occupa_se_richiesto(to)?;
        self.0.rename_no_replace(&Self::giu(from), &Self::giu(to))
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.0.remove(&Self::giu(path))
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.0.list(&Self::giu(dir))
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.0.stat(&Self::giu(path))
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.0.remove_empty_dir(&Self::giu(dir))
    }
    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        Self::giu(a) == Self::giu(b)
    }
}

fn doc(name: &str) -> DocId {
    DocId::new(name)
}

fn workspace(storage: Arc<dyn VaultStorage>) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(TestoDiProva::per_estensione("md").boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::on("/vault", registry, storage, MachineSettings::in_memory())
        .expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex");
    ws
}

/// Il lato «lo stesso file»: la destinazione occupata **era la sorgente**, e la
/// bozza deve seguire il documento invece di restare indietro.
#[test]
fn su_un_fs_insensibile_la_bozza_segue_la_correzione_di_una_maiuscola() {
    let storage = Arc::new(SenzaCaso::default());
    storage
        .write(Utf8Path::new("/vault/nota.md"), b"il testo salvato")
        .expect("scritto");
    let mut ws = workspace(storage.clone());
    ws.save_draft(&doc("nota.md"), "il buffer sporco", None)
        .expect("bozza scritta");

    ws.rename_document(&doc("nota.md"), &doc("Nota.md"))
        .expect("una maiuscola non è una collisione");

    let bozze = ws.drafts().expect("lette");
    assert_eq!(bozze.drafts.len(), 1, "nessuna bozza si è persa per strada");
    assert_eq!(
        bozze.drafts[0].doc,
        doc("Nota.md"),
        "la bozza dice il nome nuovo: sotto quello vecchio non la visita più \
         nessuno, ed è l'unica copia di ciò che l'utente stava scrivendo"
    );
    assert_eq!(bozze.drafts[0].text, "il buffer sporco");
}

/// Il lato «due file»: su un filesystem che distingue il caso, `Nota.md` è un
/// omonimo vero — e uno che l'anagrafe non conosce, perché è comparso mentre il
/// vault era aperto. Non si sovrascrive.
#[test]
fn su_un_fs_sensibile_un_omonimo_per_caso_non_si_seppellisce() {
    let storage = Arc::new(MemStorage::new());
    storage
        .write(Utf8Path::new("/vault/nota.md"), b"il testo che si sposta")
        .expect("scritto");
    let mut ws = workspace(storage.clone());
    storage
        .write(
            Utf8Path::new("/vault/Nota.md"),
            b"un'altra nota, che nessuno ha ancora indicizzato",
        )
        .expect("scritto");

    let esito = ws.rename_document(&doc("nota.md"), &doc("Nota.md"));

    assert!(
        matches!(esito, Err(KernelError::AlreadyExists(_))),
        "la destinazione è un file diverso, e lo si dice: {esito:?}"
    );
    assert_eq!(
        storage.read(Utf8Path::new("/vault/Nota.md")).expect("c'è"),
        b"un'altra nota, che nessuno ha ancora indicizzato",
        "l'omonimo è ancora il suo contenuto"
    );
    assert_eq!(
        storage.read(Utf8Path::new("/vault/nota.md")).expect("c'è"),
        b"il testo che si sposta",
        "e chi non si è potuto spostare è rimasto dov'era"
    );
}

/// Il controllo della destinazione e la mossa non sono due operazioni: fra le
/// due un altro processo può creare proprio quel file. Il doppio posa la voce
/// concorrente quando il kernel chiede di muovere, cioè dopo la guardia di
/// `rename_document`; soltanto il protocollo no-replace può lasciarla intatta.
#[test]
fn chi_arriva_dopo_la_guardia_non_viene_sovrascritto() {
    let storage = Arc::new(SenzaCaso::default());
    storage
        .write(
            Utf8Path::new("/vault/vecchia.md"),
            b"il testo che si sposta",
        )
        .expect("scritto");
    let mut ws = workspace(storage.clone());
    storage.1.store(true, Ordering::SeqCst);

    let esito = ws.rename_document(&doc("vecchia.md"), &doc("nuova.md"));

    assert!(
        matches!(esito, Err(KernelError::AlreadyExists(_))),
        "la corsa deve fermare la rinomina come ogni collisione: {esito:?}"
    );
    assert_eq!(
        storage.read(Utf8Path::new("/vault/nuova.md")).unwrap(),
        b"concorrente",
        "chi ha occupato la destinazione dopo la guardia resta intatto"
    );
    assert_eq!(
        storage.read(Utf8Path::new("/vault/vecchia.md")).unwrap(),
        b"il testo che si sposta",
        "il documento che non si è potuto muovere resta alla sorgente"
    );
}

/// E la risposta vera, quella che i due doppi sopra imitano: sul disco
/// l'identità è dell'inode e del volume, non del nome. Due nomi dello stesso
/// file — che qui si fabbricano con un hardlink, l'unico modo di averne due su
/// un filesystem sensibile al caso — sono lo stesso file; due file no.
#[test]
fn sul_disco_l_identita_e_dell_inode_e_non_del_nome() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let uno = root.join("uno.md");
    let stesso = root.join("stesso.md");
    let altro = root.join("altro.md");
    std::fs::write(&uno, b"i byte").expect("scritto");
    std::fs::hard_link(&uno, &stesso).expect("secondo nome");
    std::fs::write(&altro, b"i byte").expect("scritto");

    let storage = FsStorage;
    assert!(storage.same_file(&uno, &uno));
    assert!(
        storage.same_file(&uno, &stesso),
        "due nomi, un inode: è lo stesso file"
    );
    assert!(
        !storage.same_file(&uno, &altro),
        "stessi byte non vuol dire stesso file"
    );
    assert!(
        !storage.same_file(&uno, &root.join("mai-esistito.md")),
        "ciò che non c'è non è lo stesso file di ciò che c'è"
    );
}
