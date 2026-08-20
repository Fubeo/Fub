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
use fub_kernel::storage::{DirEntry, FsStorage, Merge, MemStorage, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, KernelError, MachineSettings, Workspace};
use fub_testkit::SampleText;

/// Un supporto che **non distingue il caso**, come APFS e NTFS: due nomi che
/// differiscono solo per una maiuscola sono lo stesso posto — e lo dice anche
/// quando gli si chiede l'identità, che è l'unica riga per cui questo doppio
/// esiste.
#[derive(Default)]
struct WithoutCase(MemStorage, AtomicBool);

impl WithoutCase {
    fn down(path: &Utf8Path) -> Utf8PathBuf {
        Utf8PathBuf::from(path.as_str().to_lowercase())
    }

    fn occupies_if_requested(&self, path: &Utf8Path) -> std::io::Result<()> {
        if self.1.swap(false, Ordering::SeqCst) {
            self.0.write(&Self::down(path), b"concorrente")?;
        }
        Ok(())
    }
}

impl VaultStorage for WithoutCase {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.0.read(&Self::down(path))
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<fub_kernel::storage::Stat> {
        self.0.write(&Self::down(path), bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        self.0.update(&Self::down(path), merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.0.append(&Self::down(path), bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.occupies_if_requested(to)?;
        self.0.rename(&Self::down(from), &Self::down(to))
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.occupies_if_requested(to)?;
        self.0.rename_no_replace(&Self::down(from), &Self::down(to))
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.0.remove(&Self::down(path))
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.0.list(&Self::down(dir))
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.0.stat(&Self::down(path))
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.0.remove_empty_dir(&Self::down(dir))
    }
    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        Self::down(a) == Self::down(b)
    }
}

fn doc(name: &str) -> DocId {
    DocId::new(name)
}

fn workspace(storage: Arc<dyn VaultStorage>) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleText::by_extension("md").boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::on("/vault", registry, storage, MachineSettings::in_memory())
        .expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex");
    ws
}

/// Il lato «lo stesso file»: la destinazione occupata **era la sorgente**, e la
/// bozza deve seguire il documento invece di restare indietro.
#[test]
fn on_a_case_insensitive_fs_the_draft_follows_the_case_correction() {
    let storage = Arc::new(WithoutCase::default());
    storage
        .write(Utf8Path::new("/vault/nota.md"), b"il testo salvato")
        .expect("scritto");
    let mut ws = workspace(storage.clone());
    ws.save_draft(&doc("nota.md"), "il buffer sporco", None)
        .expect("bozza scritta");

    ws.rename_document(&doc("nota.md"), &doc("Nota.md"))
        .expect("una maiuscola non è una collisione");

    let drafts = ws.drafts().expect("lette");
    assert_eq!(drafts.drafts.len(), 1, "nessuna bozza si è persa per strada");
    assert_eq!(
        drafts.drafts[0].doc,
        doc("Nota.md"),
        "la bozza dice il nome nuovo: sotto quello vecchio non la visita più \
         nessuno, ed è l'unica copia di ciò che l'utente stava scrivendo"
    );
    assert_eq!(drafts.drafts[0].text, "il buffer sporco");
}

/// Il lato «due file»: su un filesystem che distingue il caso, `Nota.md` è un
/// omonimo vero — e uno che l'anagrafe non conosce, perché è comparso mentre il
/// vault era aperto. Non si sovrascrive.
#[test]
fn on_a_case_sensitive_fs_a_coincidental_homonym_is_not_buried() {
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

    let outcome = ws.rename_document(&doc("nota.md"), &doc("Nota.md"));

    assert!(
        matches!(outcome, Err(KernelError::AlreadyExists(_))),
        "la destinazione è un file diverso, e lo si dice: {outcome:?}"
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
fn whoever_arrives_after_the_guard_is_not_overwritten() {
    let storage = Arc::new(WithoutCase::default());
    storage
        .write(
            Utf8Path::new("/vault/vecchia.md"),
            b"il testo che si sposta",
        )
        .expect("scritto");
    let mut ws = workspace(storage.clone());
    storage.1.store(true, Ordering::SeqCst);

    let outcome = ws.rename_document(&doc("vecchia.md"), &doc("nuova.md"));

    assert!(
        matches!(outcome, Err(KernelError::AlreadyExists(_))),
        "la corsa deve fermare la rinomina come ogni collisione: {outcome:?}"
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
fn on_disk_identity_belongs_to_the_inode_not_the_name() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let one = root.join("uno.md");
    let same = root.join("stesso.md");
    let other = root.join("altro.md");
    std::fs::write(&one, b"i byte").expect("scritto");
    std::fs::hard_link(&one, &same).expect("secondo nome");
    std::fs::write(&other, b"i byte").expect("scritto");

    let storage = FsStorage;
    assert!(storage.same_file(&one, &one));
    assert!(
        storage.same_file(&one, &same),
        "due nomi, un inode: è lo stesso file"
    );
    assert!(
        !storage.same_file(&one, &other),
        "stessi byte non vuol dire stesso file"
    );
    assert!(
        !storage.same_file(&one, &root.join("mai-esistito.md")),
        "ciò che non c'è non è lo stesso file di ciò che c'è"
    );
}
