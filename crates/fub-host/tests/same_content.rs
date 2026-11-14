//! La domanda «c'è già questo contenuto nel vault?» dall'host: il vault aperto
//! risponde con il file che ha quei byte, anche con un altro nome, e dice di no
//! quando nessun file li ha. I casi di dettaglio (limiti, cestino, collegamenti)
//! stanno nei test del kernel, `fub-kernel/tests/same_content.rs`.

use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::DocId;
use fub_host::mount::VaultStorageSource;
use fub_host::resources::{ResourceReuse, ResourceWrite, ResourceWriteReceipt};
use fub_host::Host;
use fub_kernel::same_content::SameContent;
use fub_kernel::storage::{DirEntry, FileIdentity, Merge, RootedFsStorage, Stat, VaultStorage};

fn vault(files: &[(&str, &[u8])]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    for (rel, bytes) in files {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    (dir, root)
}

#[test]
fn the_open_vault_finds_the_same_bytes_under_another_name() {
    let (_dir, root) = vault(&[
        ("Note/originale.md", b"# Titolo\n"),
        ("Scritti/altro.md", b"# Altro, piu lungo\n"),
    ]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    let found = SameContent::Found {
        id: DocId::new("Note/originale.md"),
    };
    assert_eq!(
        host.same_content(
            Some(root.as_str()),
            &DocId::new("Arrivi/nuova.md"),
            b"# Titolo\n"
        )
        .unwrap(),
        found
    );
    // Il vault corrente (`None`) risponde come quello nominato.
    assert_eq!(
        host.same_content(None, &DocId::new("Arrivi/nuova.md"), b"# Titolo\n")
            .unwrap(),
        found
    );
}

#[test]
fn a_vault_just_opened_already_knows_its_files() {
    // La scansione installa l'anagrafe prima che il vault si possa usare: chi
    // chiede subito dopo l'apertura, senza aspettare l'indicizzazione, ha una
    // risposta e non «l'indice non è pronto». È ciò che rende definitiva la
    // prima risposta che la lavagna riceve (`depositOrReuse`).
    let (_dir, root) = vault(&[
        ("Note/originale.md", b"# Titolo\n"),
        ("Scritti/altro.md", b"# Altro, piu lungo\n"),
    ]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    assert_eq!(
        host.same_content(None, &DocId::new("Arrivi/nuova.md"), b"# Titolo\n")
            .unwrap(),
        SameContent::Found {
            id: DocId::new("Note/originale.md"),
        }
    );
    host.wait_indexed(None).unwrap();
}

#[test]
fn the_same_size_with_other_bytes_is_not_the_same_content() {
    let (_dir, root) = vault(&[("Note/originale.md", b"# Titolo\n")]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    // Il controllo positivo: i byte giusti trovano il file, così il no che segue
    // non è un no qualunque. Stessa misura di `# Titolo\n`, un carattere diverso.
    assert_eq!(
        host.same_content(
            Some(root.as_str()),
            &DocId::new("Arrivi/nuova.md"),
            b"# Titolo\n"
        )
        .unwrap(),
        SameContent::Found {
            id: DocId::new("Note/originale.md"),
        }
    );
    assert_eq!(
        host.same_content(
            Some(root.as_str()),
            &DocId::new("Arrivi/nuova.md"),
            b"# Titolx\n"
        )
        .unwrap(),
        SameContent::NotFound
    );
}

/// Un deposito di un file nuovo, con o senza riuso (D-3 (b)): la ricevuta.
fn deposit(
    host: &Host,
    root: &Utf8PathBuf,
    id: &str,
    bytes: &[u8],
    reuse: ResourceReuse,
) -> ResourceWriteReceipt {
    host.resource_write(Some(root.as_str()), &DocId::new(id), bytes, None, reuse)
        .unwrap()
}

#[test]
fn a_file_deposited_in_the_session_is_found_the_second_time() {
    let (_dir, root) = vault(&[("Note/nota.md", b"# Nota\n")]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let png = b"\x89PNG\r\n\x1a\nuna foto depositata adesso";

    // La prima volta il vault non ha questi byte: si scrive.
    let first = deposit(
        &host,
        &root,
        "attachments/foto.png",
        png,
        ResourceReuse::SameContent,
    );
    assert!(!first.reused, "{first:?}");
    assert_eq!(first.id, DocId::new("attachments/foto.png"));

    // La seconda, nella stessa sessione, l'indice vivo lo conosce già: niente
    // `foto 1.png`.
    let second = deposit(
        &host,
        &root,
        "attachments/foto 1.png",
        png,
        ResourceReuse::SameContent,
    );
    assert!(second.reused, "{second:?}");
    assert_eq!(second.id, DocId::new("attachments/foto.png"));
    assert!(!root.join("attachments/foto 1.png").exists());
}

#[test]
fn only_a_file_of_the_same_type_is_the_same_content() {
    let (_dir, root) = vault(&[("vuota.md", b""), ("nota.md", b"ciao\n")]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    // Il controllo positivo: stessa estensione, maiuscole a parte, si ritrova.
    let same_type = deposit(
        &host,
        &root,
        "copia.MD",
        b"ciao\n",
        ResourceReuse::SameContent,
    );
    assert!(same_type.reused, "{same_type:?}");
    assert_eq!(same_type.id, DocId::new("nota.md"));

    // Un `.txt` con i byte di una nota non è quella nota.
    let txt = deposit(
        &host,
        &root,
        "nota.txt",
        b"ciao\n",
        ResourceReuse::SameContent,
    );
    assert!(!txt.reused, "{txt:?}");
    assert_eq!(txt.id, DocId::new("nota.txt"));

    // Un file vuoto non si ritrova mai, nemmeno fra quelli del suo tipo.
    let csv = deposit(&host, &root, "dati.csv", b"", ResourceReuse::SameContent);
    assert!(!csv.reused, "{csv:?}");
    assert_eq!(csv.id, DocId::new("dati.csv"));
    let empty_md = deposit(&host, &root, "altra.md", b"", ResourceReuse::SameContent);
    assert!(!empty_md.reused, "{empty_md:?}");
}

/// Un disco radicato che **conta** le letture a pezzi di un file e, alla prima,
/// esegue un gancio: il modo di cambiare il vault corrente a metà di una
/// domanda, fra i candidati presi e le impronte riportate.
struct Watched {
    inner: RootedFsStorage,
    suffix: &'static str,
    reads: Arc<AtomicUsize>,
    hook: Hook,
    failing: Arc<AtomicBool>,
}

type Hook = Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>;

impl VaultStorage for Watched {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn read_pieces(&self, path: &Utf8Path, piece: &mut dyn FnMut(&[u8])) -> io::Result<()> {
        let watched = path.as_str().ends_with(self.suffix);
        if watched && self.failing.load(Ordering::SeqCst) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "letto male di proposito",
            ));
        }
        self.inner.read_pieces(path, piece)?;
        if watched {
            self.reads.fetch_add(1, Ordering::SeqCst);
            let hook = self.hook.lock().expect("il gancio di prova").take();
            if let Some(hook) = hook {
                hook();
            }
        }
        Ok(())
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.inner.write(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.inner.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> io::Result<Stat> {
        self.inner.stat(path)
    }
    fn stat_no_follow(&self, path: &Utf8Path) -> io::Result<Stat> {
        self.inner.stat_no_follow(path)
    }
    fn file_identity(&self, path: &Utf8Path) -> io::Result<Option<FileIdentity>> {
        self.inner.file_identity(path)
    }
    fn change_stamp(&self, path: &Utf8Path) -> io::Result<Option<u64>> {
        self.inner.change_stamp(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// Ogni vault montato su un [`Watched`], con lo stesso contatore e lo stesso
/// gancio.
struct WatchedDisk {
    suffix: &'static str,
    reads: Arc<AtomicUsize>,
    hook: Hook,
    failing: Arc<AtomicBool>,
}

impl VaultStorageSource for WatchedDisk {
    fn open(&self, root: &Utf8Path) -> io::Result<Arc<dyn VaultStorage>> {
        Ok(Arc::new(Watched {
            inner: RootedFsStorage::open(root)?,
            suffix: self.suffix,
            reads: Arc::clone(&self.reads),
            hook: Arc::clone(&self.hook),
            failing: Arc::clone(&self.failing),
        }))
    }
}

/// Scrive un file e lo porta nel passato: l'impronta di un file appena scritto
/// non si impara (*racily clean*), e il test guarda il vault, non il tempo.
fn aged(root: &Utf8Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, bytes).unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(SystemTime::now() - Duration::from_secs(3600))
        .unwrap();
}

#[test]
fn the_fingerprints_learned_go_to_the_vault_that_was_asked() {
    // Nel vault A un candidato della stessa misura con altri byte, che
    // l'indicizzazione non è riuscita a leggere: la domanda ne calcola
    // l'impronta, e la impara. Il vault B non ha quel file.
    let (_a_dir, a) = vault(&[]);
    aged(&a, "Foto/candidato.png", b"PNG di prova: AAAA");
    let (_b_dir, b) = vault(&[("Note/nota.md", b"# Nota\n")]);
    let reads = Arc::new(AtomicUsize::new(0));
    let hook: Hook = Arc::new(Mutex::new(None));
    let failing = Arc::new(AtomicBool::new(true));
    let host = Arc::new(Host::without_watcher().with_storage(Arc::new(WatchedDisk {
        suffix: "Foto/candidato.png",
        reads: Arc::clone(&reads),
        hook: Arc::clone(&hook),
        failing: Arc::clone(&failing),
    })));
    host.open(&b).unwrap();
    host.wait_indexed(Some(b.as_str())).unwrap();
    host.open(&a).unwrap();
    host.wait_indexed(Some(a.as_str())).unwrap();
    assert_eq!(host.current(), Some(a.clone()));
    failing.store(false, Ordering::SeqCst);

    // A metà del confronto il vault corrente diventa B. Il gancio tiene una
    // copia debole dell'host: il supporto vive dentro l'host stesso.
    let weak = Arc::downgrade(&host);
    let b_root = b.clone();
    *hook.lock().unwrap() = Some(Box::new(move || {
        if let Some(host) = weak.upgrade() {
            host.set_current(&b_root).unwrap();
        }
    }));
    reads.store(0, Ordering::SeqCst);
    let wanted = b"PNG di prova: BBBB";
    assert_eq!(
        host.same_content(None, &DocId::new("Arrivi/nuova.png"), wanted)
            .unwrap(),
        SameContent::NotFound
    );
    assert_eq!(reads.load(Ordering::SeqCst), 1, "il candidato si legge una volta");
    assert_eq!(host.current(), Some(b.clone()), "il gancio ha cambiato vault");

    // L'impronta è arrivata ad A, che l'aveva chiesta: la seconda domanda la
    // conosce, vede che è un'altra, e non rilegge il file.
    assert_eq!(
        host.same_content(Some(a.as_str()), &DocId::new("Arrivi/nuova.png"), wanted)
            .unwrap(),
        SameContent::NotFound
    );
    assert_eq!(
        reads.load(Ordering::SeqCst),
        1,
        "l'impronta imparata è andata a un altro vault"
    );
}
