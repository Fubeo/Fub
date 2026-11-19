//! IMP-1805, IMP-4806: nessuna operazione tiene il prestito esclusivo del vault
//! per il tempo di una scrittura su disco.
//!
//! Sull'app dei tester il prestito esclusivo restava preso 11–44 s: ogni
//! salvataggio, ogni link riscritto da una rinomina o da uno spostamento, la
//! riga del registro e i dati di una rinomina fatta ad app chiusa facevano il
//! loro `fsync` **dentro** il prestito, e con il disco occupato da altro un
//! `fsync` dura secondi. Intanto ogni lettura del vault aspettava.
//!
//! La macchina sotto carico non si riproduce in un test, il disco lento sì:
//! uno storage che fa durare ogni scrittura durevole [`DURABLE`]. La misura è il
//! tempo **dentro** il prestito ([`Custody::longest_hold`]), non la durata
//! dell'operazione, quindi non dipende da quanto è carica la macchina: una sola
//! scrittura dentro il prestito lo porta oltre la soglia del log
//! ([`BUDGET`]), e senza scritture dentro resta di pochi millisecondi.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::InvokeMode;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_kernel::storage::{
    ConditionalWrite, DirEntry, FileIdentity, Merge, RootedFsStorage, Stat, VaultStorage,
};

use crate::custody::Custody;
use crate::mount::VaultStorageSource;
use crate::{Host, NoWatcher};

/// Quanto dura una scrittura durevole sul disco finto: più della soglia, così
/// che una sola, fatta dentro il prestito, basti a farlo vedere.
const DURABLE: Duration = Duration::from_millis(300);

/// La soglia oltre la quale [`Custody`] scrive nel log che il vault è rimasto
/// fermo: il prestito non ci deve arrivare.
const BUDGET: Duration = Duration::from_millis(250);

/// Le note del vault di prova: centinaia, come nel brief del difetto.
const NOTES: usize = 300;

/// Le note che citano `Progetto`, nel corpo **e** in una proprietà: poche,
/// perché ognuna è una scrittura lenta da riscrivere.
const CITING: usize = 4;

/// Il disco finto: ogni scrittura durevole aspetta [`DURABLE`] quando è armato.
struct SlowDisk {
    armed: Arc<AtomicBool>,
}

struct Slow {
    inner: RootedFsStorage,
    armed: Arc<AtomicBool>,
}

impl Slow {
    fn durable(&self) {
        if self.armed.load(Ordering::Acquire) {
            std::thread::sleep(DURABLE);
        }
    }
}

impl VaultStorageSource for SlowDisk {
    fn open(&self, root: &Utf8Path) -> io::Result<Arc<dyn VaultStorage>> {
        Ok(Arc::new(Slow {
            inner: RootedFsStorage::open(root)?,
            armed: Arc::clone(&self.armed),
        }))
    }
}

impl VaultStorage for Slow {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn read_pieces(&self, path: &Utf8Path, piece: &mut dyn FnMut(&[u8])) -> io::Result<()> {
        self.inner.read_pieces(path, piece)
    }
    fn read_at(&self, path: &Utf8Path, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        self.inner.read_at(path, offset, len)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.durable();
        self.inner.write(path, bytes)
    }
    fn write_if_unchanged(
        &self,
        path: &Utf8Path,
        expected: Option<&[u8]>,
        bytes: &[u8],
    ) -> io::Result<ConditionalWrite> {
        self.durable();
        self.inner.write_if_unchanged(path, expected, bytes)
    }
    fn write_derived(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.durable();
        self.inner.write_derived(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.durable();
        self.inner.update(path, merge)
    }
    fn update_derived(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.durable();
        self.inner.update_derived(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        self.durable();
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.durable();
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.durable();
        self.inner.rename_no_replace(from, to)
    }
    fn move_in_no_replace(&self, outside: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.durable();
        self.inner.move_in_no_replace(outside, to)
    }
    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        self.durable();
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
    fn real_path(&self, path: &Utf8Path) -> io::Result<Utf8PathBuf> {
        self.inner.real_path(path)
    }
    fn exists(&self, path: &Utf8Path) -> bool {
        self.inner.exists(path)
    }
    fn file_identity(&self, path: &Utf8Path) -> io::Result<Option<FileIdentity>> {
        self.inner.file_identity(path)
    }
    fn change_stamp(&self, path: &Utf8Path) -> io::Result<Option<u64>> {
        self.inner.change_stamp(path)
    }
    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        self.inner.same_file(a, b)
    }
    fn mount_fence(&self, root: &Utf8Path) -> io::Result<()> {
        self.inner.mount_fence(root)
    }
    fn root_validates(&self, root: &Utf8Path) -> io::Result<()> {
        self.inner.root_validates(root)
    }
    fn is_left_behind(&self, stat: &Stat) -> bool {
        self.inner.is_left_behind(stat)
    }
    fn remove_dir_all(&self, dir: &Utf8Path) -> io::Result<()> {
        self.durable();
        self.inner.remove_dir_all(dir)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
    fn create_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        self.inner.create_dir(dir)
    }
}

/// Trecento schede in catena; le prime [`CITING`] citano `Progetto` nel corpo
/// e nella proprietà `progetto`.
fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).expect("utf8");
    std::fs::create_dir_all(root.join("Clienti")).expect("cartella");
    std::fs::write(root.join("Progetto.md"), "# Progetto\n").expect("progetto");
    for n in 0..NOTES {
        let next = (n + 1) % NOTES;
        let body = if n < CITING {
            format!(
                "---\nprogetto: \"[[Progetto]]\"\nstato: da fare\n---\n\n# Scheda {n}\n\n\
                 Vedi [[Scheda {next}]] e [[Progetto]].\n"
            )
        } else {
            format!("---\nstato: da fare\n---\n\n# Scheda {n}\n\nVedi [[Scheda {next}]].\n")
        };
        std::fs::write(root.join(format!("Scheda {n}.md")), body).expect("scheda");
    }
    (dir, root)
}

fn run(host: &Host, command: &str, args: serde_json::Value) {
    host.invoke_user_command(None, command, args, InvokeMode::Apply)
        .unwrap_or_else(|error| panic!("`{command}`: {error}"));
}

fn workspace(host: &Host) -> Custody<fub_kernel::Workspace> {
    host.with_session(None, |s| s.workspace().clone())
        .expect("il vault è aperto")
}

/// Fa `gesture` col disco lento e dice se il prestito esclusivo è rimasto
/// sotto la soglia.
fn within_budget(host: &Host, armed: &AtomicBool, what: &str, gesture: impl FnOnce()) {
    let workspace = workspace(host);
    workspace.forget_longest_hold();
    armed.store(true, Ordering::Release);
    gesture();
    armed.store(false, Ordering::Release);
    let longest = workspace.longest_hold();
    assert!(
        longest < BUDGET,
        "{what}: il vault è rimasto in prestito esclusivo {longest:?} \
         (soglia {BUDGET:?}, una scrittura lenta dura {DURABLE:?})"
    );
}

fn text(root: &Utf8Path, name: &str) -> String {
    std::fs::read_to_string(root.join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

#[test]
fn a_slow_disk_never_holds_the_vault_beyond_the_threshold() {
    let (_dir, root) = vault();
    let armed = Arc::new(AtomicBool::new(false));
    let host = Host::new()
        .with_storage(Arc::new(SlowDisk {
            armed: Arc::clone(&armed),
        }))
        .with_watcher(Box::new(NoWatcher));
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura finisce");
    host.set_pinned(None, "Scheda 250.md", true)
        .expect("la scheda si appunta");

    // I salvataggi: la scrittura e la riga del registro.
    within_budget(&host, &armed, "salvare", || {
        for n in 100..103 {
            let id = DocId::new(format!("Scheda {n}.md"));
            host.write_document(
                None,
                &id,
                &format!("# Scheda {n}\n\nCambiata.\n"),
                WriteBase::Dictated,
            )
            .expect("il salvataggio riesce");
        }
    });
    assert_eq!(text(&root, "Scheda 101.md"), "# Scheda 101\n\nCambiata.\n");

    // Lo spostamento di più note: ognuna riscrive il link della precedente.
    within_budget(&host, &armed, "spostare note", || {
        for n in 10..13 {
            run(
                &host,
                "note.rename",
                serde_json::json!({
                    "doc": format!("Scheda {n}.md"),
                    "to": format!("Clienti/Scheda {n}.md"),
                }),
            );
        }
    });
    assert!(root.join("Clienti/Scheda 11.md").exists());
    assert!(text(&root, "Scheda 9.md").contains("Scheda 10"));

    // La rinomina che riscrive i link, nel corpo e nelle proprietà.
    within_budget(&host, &armed, "rinominare con i link", || {
        run(
            &host,
            "note.rename",
            serde_json::json!({ "doc": "Progetto.md", "to": "Progetto Grande.md" }),
        );
    });
    for n in 0..CITING {
        let scheda = text(&root, &format!("Scheda {n}.md"));
        assert!(
            scheda.contains("progetto: \"[[Progetto Grande]]\"")
                && scheda.contains("e [[Progetto Grande]]."),
            "la scheda {n} non segue la rinomina:\n{scheda}"
        );
    }

    // Tanti cambi fatti da fuori, una rinomina ad app chiusa di una nota
    // appuntata, e la ricostruzione dell'indice che la riconosce.
    for n in 200..240 {
        std::fs::write(
            root.join(format!("Scheda {n}.md")),
            format!("# Scheda {n}\n\nDa fuori.\n"),
        )
        .expect("cambio da fuori");
    }
    std::fs::rename(
        root.join("Scheda 250.md"),
        root.join("Clienti/Scheda 250.md"),
    )
    .expect("rinomina da fuori");
    within_budget(&host, &armed, "ricostruire l'indice", || {
        run(&host, "vault.rebuild-index", serde_json::Value::Null);
    });
    let pinned = workspace(&host)
        .read()
        .expect("lettura")
        .organization()
        .pinned;
    assert_eq!(
        pinned,
        vec!["Clienti/Scheda 250.md".to_string()],
        "l'appunto segue la rinomina fatta ad app chiusa"
    );
    host.close();
}
