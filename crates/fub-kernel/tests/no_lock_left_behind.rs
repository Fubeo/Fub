//! **Fub non lascia lock nella cartella dell'utente.**
//!
//! Il supporto di produzione ([`RootedFsStorage`]) coordina i writer con un
//! compagno `.nota.md.lock` accanto al file. Era stabile per costruzione: non
//! si toglieva mai, e restava accanto a ogni file salvato, cestinato,
//! ripristinato, rinominato o spostato. Il cestino lasciava
//! `Note/.Prova.md.lock` accanto a dove stava la nota, anche dopo il
//! ripristino; un'uscita forzata lasciava `.Foglio.xlsx.lock`. Sono file
//! nascosti di Fub dentro il vault, e chi lo sincronizza (Syncthing, Dropbox,
//! git) o lo guarda con un altro programma li vede.
//!
//! Il detentore toglie il lock al rilascio, e la riapertura toglie quelli che
//! nessuno tiene più. Un lock tenuto adesso — da un altro Fub vivo sullo
//! stesso vault — resta: il suo significato non cambia.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_kernel::{
    ConditionalWrite, FormatRegistry, MachineSettings, RootedFsStorage, VaultStorage, Workspace,
};
use fub_testkit::{restore_document, SampleText};

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture { _dir: dir, root }
    }

    fn put(&self, rel: &str, body: &[u8]) {
        let path = self.root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn storage(&self) -> Arc<RootedFsStorage> {
        Arc::new(RootedFsStorage::open(&self.root).expect("the root opens"))
    }

    fn workspace(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(SampleText::by_extension("md").boxed())
            .expect("no extension conflict");
        let storage: Arc<dyn VaultStorage> = self.storage();
        let mut ws = Workspace::on(&self.root, registry, storage, MachineSettings::in_memory())
            .expect("the vault opens");
        ws.reindex().expect("reindex");
        ws
    }

    /// Ogni compagno di lock nel vault, `.fub/` e `.trash/` compresi, in path
    /// relativo e in ordine.
    fn locks(&self) -> Vec<String> {
        let mut out = Vec::new();
        collect_locks(&self.root, &self.root, &mut out);
        out.sort();
        out
    }
}

fn collect_locks(root: &Utf8Path, dir: &Utf8Path, out: &mut Vec<String>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = Utf8PathBuf::from_path_buf(entry.path()).unwrap();
        if entry.file_type().unwrap().is_dir() {
            collect_locks(root, &path, out);
            continue;
        }
        let name = path.file_name().unwrap();
        if name.starts_with('.') && name.ends_with(".lock") {
            // Con `/` su ogni piattaforma: su Windows `to_string` darebbe `\`.
            let rel = path.strip_prefix(root).unwrap();
            out.push(
                rel.components()
                    .map(|part| part.as_str())
                    .collect::<Vec<_>>()
                    .join("/"),
            );
        }
    }
}

fn no_locks(fx: &Fixture, after: &str) {
    assert_eq!(
        fx.locks(),
        Vec::<String>::new(),
        "{after} ha lasciato dei lock nel vault"
    );
}

#[test]
fn trashing_a_note_leaves_no_lock() {
    let fx = Fixture::new();
    fx.put("Note/Prova cestino.md", b"testo");
    let mut ws = fx.workspace();

    ws.delete_document(&DocId::new("Note/Prova cestino.md"))
        .expect("trash");

    assert!(!fx.root.join("Note/Prova cestino.md").exists());
    no_locks(&fx, "il cestino");
}

#[test]
fn restoring_a_note_leaves_no_lock() {
    let fx = Fixture::new();
    fx.put("Note/Prova cestino.md", b"testo");
    let mut ws = fx.workspace();
    let trashed = ws
        .delete_document(&DocId::new("Note/Prova cestino.md"))
        .expect("trash");

    let restored = restore_document(&mut ws, &trashed, None).expect("restore");

    assert_eq!(restored.as_str(), "Note/Prova cestino.md");
    assert_eq!(
        std::fs::read(fx.root.join("Note/Prova cestino.md")).unwrap(),
        b"testo"
    );
    no_locks(&fx, "il ripristino");
}

#[test]
fn renaming_a_note_leaves_no_lock() {
    let fx = Fixture::new();
    fx.put("Note/Vecchio.md", b"testo");
    let mut ws = fx.workspace();

    ws.rename_document(&DocId::new("Note/Vecchio.md"), &DocId::new("Note/Nuovo.md"))
        .expect("rename");

    assert!(fx.root.join("Note/Nuovo.md").is_file());
    no_locks(&fx, "la rinomina");
}

#[test]
fn moving_a_note_leaves_no_lock() {
    let fx = Fixture::new();
    fx.put("Note/Nota.md", b"testo");
    fx.put("Archivio/Altra.md", b"altro");
    let mut ws = fx.workspace();

    ws.rename_document(&DocId::new("Note/Nota.md"), &DocId::new("Archivio/Nota.md"))
        .expect("move");

    assert!(fx.root.join("Archivio/Nota.md").is_file());
    no_locks(&fx, "lo spostamento");
}

#[test]
fn a_guarded_save_leaves_no_lock() {
    let fx = Fixture::new();
    fx.put("Nota.md", b"prima");
    let mut ws = fx.workspace();
    let id = DocId::new("Nota.md");
    let base = ws.document_revision(&id).expect("revision");

    ws.write_document(&id, "dopo", WriteBase::DescendsFrom(base))
        .expect("save");

    assert_eq!(std::fs::read(fx.root.join("Nota.md")).unwrap(), b"dopo");
    no_locks(&fx, "il salvataggio");
}

#[test]
fn every_locked_storage_operation_releases_its_file() {
    let fx = Fixture::new();
    let storage = fx.storage();
    let path = fx.root.join("Fogli/Conti.xlsx");

    assert!(matches!(
        storage.write_if_unchanged(&path, None, b"uno"),
        Ok(ConditionalWrite::Written(_))
    ));
    storage
        .update(&path, &mut |_| Ok(Some(b"due".to_vec())))
        .unwrap();
    storage
        .update_derived(&path, &mut |_| Ok(Some(b"tre".to_vec())))
        .unwrap();
    storage
        .rename_no_replace(&path, &fx.root.join("Fogli/Bilancio.xlsx"))
        .unwrap();
    let outside = tempfile::tempdir().unwrap();
    let outside = Utf8PathBuf::from_path_buf(outside.path().join("arrivo.md")).unwrap();
    std::fs::write(&outside, b"da fuori").unwrap();
    storage
        .move_in_no_replace(&outside, &fx.root.join("Arrivo.md"))
        .unwrap();

    no_locks(&fx, "un'operazione sotto lock");
}

/// Un'uscita forzata in mezzo a un salvataggio: il processo muore col lock in
/// mano, il sistema rilascia il lock, il file resta. Lo stesso lascia una
/// versione di Fub che i lock non li toglieva.
#[test]
fn reopening_removes_the_locks_a_dead_instance_left() {
    let fx = Fixture::new();
    fx.put("Fogli/Conti.xlsx", b"PK");
    fx.put("Note/Nota.md", b"testo");
    fx.put("Fogli/.Conti.xlsx.lock", b"");
    fx.put("Note/.Nota.md.lock", b"");
    fx.put("Note/.Sparita.md.lock", b"");

    let _ws = fx.workspace();

    no_locks(&fx, "la riapertura dopo un'uscita forzata");
    assert_eq!(
        std::fs::read(fx.root.join("Fogli/Conti.xlsx")).unwrap(),
        b"PK"
    );
}

/// L'altra metà: un lock tenuto adesso è un salvataggio in corso — di un altro
/// Fub sullo stesso vault — e chi riapre non glielo toglie. Né toglie un file
/// che porta quel nome ma non è un lock di Fub: Fub nel lock non scrive mai.
#[test]
fn reopening_keeps_a_held_lock_and_a_foreign_file() {
    let fx = Fixture::new();
    fx.put("Nota.md", b"testo");
    fx.put(".Nota.md.lock", b"");
    fx.put(".config.lock", b"di un altro programma");
    let held = std::fs::OpenOptions::new()
        .write(true)
        .open(fx.root.join(".Nota.md.lock"))
        .unwrap();
    held.lock().expect("a live instance holds the lock");

    let _ws = fx.workspace();

    assert_eq!(fx.locks(), vec![".Nota.md.lock", ".config.lock"]);
    drop(held);
}

/// Il cestino non si cammina all'apertura: i lock che le versioni vecchie vi
/// hanno lasciato se ne vanno quando lo si svuota.
#[test]
fn emptying_the_trash_removes_the_locks_left_in_it() {
    let fx = Fixture::new();
    fx.put("Nota.md", b"testo");
    let mut ws = fx.workspace();
    ws.delete_document(&DocId::new("Nota.md")).expect("trash");
    fx.put(".trash/.Nota.md.lock", b"");
    fx.put(".trash/.Vecchia.md.lock", b"");

    assert_eq!(ws.empty_trash().expect("empty"), 1);

    no_locks(&fx, "lo svuotamento del cestino");
}

/// La rimozione al rilascio non apre la porta a due writer insieme: chi
/// aspettava sul lock appena tolto se ne accorge e riparte. Ogni incremento
/// deve arrivare, da due handle della stessa radice e da più thread.
#[test]
fn removing_the_lock_keeps_writers_exclusive() {
    const THREADS: usize = 4;
    const ROUNDS: usize = 100;
    let fx = Fixture::new();
    let path = fx.root.join("contatore.txt");
    let storages = [fx.storage(), fx.storage()];
    storages[0].write(&path, b"0").unwrap();

    std::thread::scope(|scope| {
        for thread in 0..THREADS {
            let storage = Arc::clone(&storages[thread % 2]);
            let path = path.clone();
            scope.spawn(move || {
                for _ in 0..ROUNDS {
                    storage
                        .update(&path, &mut |current| {
                            let n: usize = std::str::from_utf8(current.unwrap())
                                .unwrap()
                                .parse()
                                .unwrap();
                            Ok(Some((n + 1).to_string().into_bytes()))
                        })
                        .unwrap();
                }
            });
        }
    });

    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        (THREADS * ROUNDS).to_string()
    );
    no_locks(&fx, "la contesa");
}

/// **Anche `.fub/` si pulisce all'apertura.** Il supporto del vault vi prende i
/// suoi lock come accanto a una nota — impostazioni, anagrafe, bozze, sidecar
/// del cestino, stato per documento dei plugin — e un'uscita forzata in mezzo
/// a una di quelle scritture lascia il compagno a terra. La scansione non entra
/// in `.fub/`, perché non è contenuto dell'utente; la pulizia sì, con lo stesso
/// criterio: vuoto e non tenuto da nessuno.
///
/// Restano un lock tenuto adesso, un file non vuoto che porta quel nome e ciò
/// che sta nello spazio di un plugin fuori dagli spazi per documento: può
/// essere la cartella di un motore nativo, e l'indice di ricerca vi tiene i
/// lock di tantivy, stabili per costruzione.
#[test]
fn reopening_removes_the_locks_left_in_the_service_folder() {
    let fx = Fixture::new();
    fx.put("Nota.md", b"testo");
    for left in [
        ".fub/.settings.json.lock",
        ".fub/.journal.jsonl.lock",
        ".fub/data/.entries.json.lock",
        ".fub/data/trash/.Nota.2026-01-01T00-00-00.md.json.lock",
        ".fub/drafts/.bozza.json.lock",
        ".fub/plugins/acme/doc/Nota.md/.annotazioni.json.lock",
        ".fub/plugins/acme/doc~trash/Vecchia.md/.annotazioni.json.lock",
        ".fub/data/plugins/acme/.anteprima.json.lock",
        ".fub/.altro-fub.json.lock",
        ".fub/plugins/fub.search/index/.tantivy-writer.lock",
        ".fub/plugins/fub.search/index/.tantivy-meta.lock",
    ] {
        fx.put(left, b"");
    }
    fx.put(".fub/.config.lock", b"di un altro programma");
    let held = std::fs::OpenOptions::new()
        .write(true)
        .open(fx.root.join(".fub/.altro-fub.json.lock"))
        .unwrap();
    held.lock().expect("a live instance holds the lock");

    let _ws = fx.workspace();

    assert_eq!(
        fx.locks(),
        vec![
            ".fub/.altro-fub.json.lock",
            ".fub/.config.lock",
            ".fub/plugins/fub.search/index/.tantivy-meta.lock",
            ".fub/plugins/fub.search/index/.tantivy-writer.lock",
        ]
    );
    drop(held);
}

/// Il cestino del sistema dove Fub non ne ha un backend: risponde
/// `Unsupported`, come [`fub_kernel::FsStorage`] su Windows e su macOS.
struct NoSystemTrash;

impl fub_kernel::os_trash::OsTrashBackend for NoSystemTrash {
    fn move_file_to_os_trash(&self, _: &Utf8Path) -> std::io::Result<Utf8PathBuf> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "nessun cestino del sistema",
        ))
    }
}

fn trash_through_the_system(
    ws: &mut Workspace,
    doc: &DocId,
    backend: &dyn fub_kernel::os_trash::OsTrashBackend,
) -> fub_kernel::os_trash::OsTrashReceipt {
    let completed = ws
        .prepare_document_deletion(doc)
        .expect("prepare")
        .invoke_os(backend)
        .expect("move");
    let committed = ws
        .commit_os_document_deletion(completed)
        .unwrap_or_else(|_| panic!("commit"));
    ws.finish_os_document_deletion(committed.invoke())
        .unwrap_or_else(|_| panic!("finish"))
}

/// **Il cestino del sistema non lascia lock accanto alla nota.** Dove il
/// backend non c'è la nota va nel cestino del vault, con il supporto del
/// vault: è la strada di Windows, e qui si prova su ogni sistema.
#[test]
fn the_system_trash_fallback_leaves_no_lock() {
    let fx = Fixture::new();
    fx.put("Note/Nota.md", b"testo");
    let mut ws = fx.workspace();

    let receipt = trash_through_the_system(&mut ws, &DocId::new("Note/Nota.md"), &NoSystemTrash);

    assert!(matches!(
        receipt.via,
        fub_kernel::os_trash::TrashVia::InternalFallback { .. }
    ));
    assert!(!fx.root.join("Note/Nota.md").exists());
    no_locks(&fx, "il cestino del sistema, ripiegato su quello del vault");
}

/// La stessa prova con il backend vero, dove non sposta fuori dal vault: su
/// Linux sposterebbe nel cestino dell'utente, e lì la presidia il test di
/// `os_trash.rs` con una cartella temporanea.
#[cfg(not(target_os = "linux"))]
#[test]
fn the_system_trash_of_this_platform_leaves_no_lock() {
    let fx = Fixture::new();
    fx.put("Note/Nota.md", b"testo");
    let mut ws = fx.workspace();

    trash_through_the_system(&mut ws, &DocId::new("Note/Nota.md"), &fub_kernel::FsStorage);

    assert!(!fx.root.join("Note/Nota.md").exists());
    no_locks(&fx, "il cestino del sistema");
}
