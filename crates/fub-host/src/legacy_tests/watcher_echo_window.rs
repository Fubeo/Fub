//! Il rilevatore nella finestra fra il disco e la memoria (IMP-1805).
//!
//! Da quando un salvataggio scrive il disco **fuori** dal prestito esclusivo
//! (`PreparedDocumentWrite::place`) e aggiorna la memoria dopo
//! (`commit_placed_document_*`), c'è un tratto in cui il file ha già il testo
//! nuovo e l'anagrafe ancora quello vecchio. Se in quel tratto il rilevatore
//! guarda il file, confrontandolo con l'anagrafe vecchia lo prenderebbe per una
//! modifica fatta da fuori: un `DocumentChanged` del `Watcher` (il banner di
//! conflitto nel client, la bozza tenuta), un doppione o un cestino fantasma
//! per una rinomina.
//!
//! Non succede per due ragioni, e qui si provano insieme. Il rilevatore
//! **applica** sotto il turno di scrittura (`apply_batch_prepared`), che chi
//! salva tiene dalla preparazione alla consegna degli eventi: arriva dopo il
//! commit. E il kernel scarta un piano fatto su un'anagrafe che nel frattempo
//! è cambiata (`prepare_sync_path_prepared` confronta la voce fotografata con
//! quella di adesso).
//!
//! Il disco finto consegna l'evento **dentro** la scrittura durevole, dopo che
//! il file è cambiato: il lotto del rilevatore parte in un altro thread, fa i
//! suoi piani sotto prestito condiviso (la memoria è ancora quella vecchia) e
//! si mette in fila per il turno. Solo allora la scrittura torna.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::InvokeMode;
use fub_abi::edit::WriteBase;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::{Event, Notice};
use fub_kernel::storage::{
    ConditionalWrite, DirEntry, FileIdentity, Merge, RootedFsStorage, Stat, VaultStorage,
};
use fub_kernel::Workspace;

use crate::custody::Custody;
use crate::mount::VaultStorageSource;
use crate::{Delivery, EventSink, ExternalChange, ExternalSync, Host, NoWatcher};

/// Quanto si aspetta, al più, che il lotto del rilevatore arrivi in fila per
/// il turno: oltre, il banco non ha provato la finestra e lo dice.
const QUEUED_WITHIN: Duration = Duration::from_secs(10);

/// Cosa consegnare alla prossima scrittura durevole di un certo tipo.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Op {
    Write,
    Rename,
}

#[derive(Default)]
struct Echo {
    workspace: OnceLock<Custody<Workspace>>,
    /// Il prossimo evento da consegnare, e su quale operazione.
    armed: Mutex<Option<(Op, Vec<ExternalChange>)>>,
    /// Il lotto è arrivato in fila per il turno mentre la scrittura era in
    /// corso: la finestra è stata provata davvero.
    queued_in_window: AtomicBool,
    sync: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Echo {
    fn arm(&self, op: Op, changes: Vec<ExternalChange>) {
        self.queued_in_window.store(false, Ordering::Release);
        *self.armed.lock().unwrap() = Some((op, changes));
    }

    /// Dopo l'operazione sul disco: se è quella armata, consegna l'evento e
    /// aspetta che il rilevatore sia in fila per il turno.
    fn after(&self, op: Op) {
        let changes = {
            let mut armed = self.armed.lock().unwrap();
            match armed.as_ref() {
                Some((armed_op, _)) if *armed_op == op => armed.take().map(|(_, c)| c),
                _ => None,
            }
        };
        let Some(changes) = changes else {
            return;
        };
        let workspace = self.workspace.get().expect("il vault è aperto").clone();
        let watched = workspace.clone();
        let handle = std::thread::spawn(move || {
            ExternalSync::new(watched).batch(&changes);
        });
        let since = Instant::now();
        let mut queued_since: Option<Instant> = None;
        while since.elapsed() < QUEUED_WITHIN && !handle.is_finished() {
            // In fila con continuità: non il passaggio breve di un prestito
            // condiviso, ma l'attesa del turno che chi salva tiene.
            if workspace.queued() > 0 {
                let at = *queued_since.get_or_insert_with(Instant::now);
                if at.elapsed() >= Duration::from_millis(100) {
                    self.queued_in_window.store(true, Ordering::Release);
                    break;
                }
            } else {
                queued_since = None;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        *self.sync.lock().unwrap() = Some(handle);
    }

    /// Aspetta che il lotto consegnato finisca.
    fn join(&self) {
        if let Some(handle) = self.sync.lock().unwrap().take() {
            handle.join().expect("il lotto del rilevatore non pania");
        }
    }
}

struct EchoDisk {
    echo: Arc<Echo>,
}

struct EchoStorage {
    inner: RootedFsStorage,
    echo: Arc<Echo>,
}

impl VaultStorageSource for EchoDisk {
    fn open(&self, root: &Utf8Path) -> io::Result<Arc<dyn VaultStorage>> {
        Ok(Arc::new(EchoStorage {
            inner: RootedFsStorage::open(root)?,
            echo: Arc::clone(&self.echo),
        }))
    }
}

impl VaultStorage for EchoStorage {
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
        let done = self.inner.write(path, bytes);
        self.echo.after(Op::Write);
        done
    }
    fn write_if_unchanged(
        &self,
        path: &Utf8Path,
        expected: Option<&[u8]>,
        bytes: &[u8],
    ) -> io::Result<ConditionalWrite> {
        let done = self.inner.write_if_unchanged(path, expected, bytes);
        self.echo.after(Op::Write);
        done
    }
    fn write_derived(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.inner.write_derived(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.inner.update(path, merge)
    }
    fn update_derived(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.inner.update_derived(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        let done = self.inner.rename(from, to);
        if is_note(to) {
            self.echo.after(Op::Rename);
        }
        done
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        let done = self.inner.rename_no_replace(from, to);
        if is_note(to) {
            self.echo.after(Op::Rename);
        }
        done
    }
    fn move_in_no_replace(&self, outside: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.inner.move_in_no_replace(outside, to)
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
        self.inner.remove_dir_all(dir)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
    fn create_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        self.inner.create_dir(dir)
    }
}

/// Le note del vault, non i file di servizio sotto `.fub/`.
fn is_note(path: &Utf8Path) -> bool {
    path.extension() == Some("md") && !path.components().any(|c| c.as_str() == ".fub")
}

struct Registered {
    output: Mutex<Sender<Notice>>,
}

impl EventSink for Registered {
    fn emit(&self, notice: &Notice, _vault: Option<&str>) -> Delivery {
        let _ = self.output.lock().unwrap().send(notice.clone());
        Delivery::Done
    }
}

struct Bench {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    echo: Arc<Echo>,
    host: Host,
    notices: Receiver<Notice>,
}

fn bench() -> Bench {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).expect("utf8");
    std::fs::create_dir_all(root.join("Clienti")).expect("cartella");
    std::fs::write(root.join("Nota.md"), "# Nota\n\nPrima.\n").expect("nota");
    std::fs::write(root.join("Indice.md"), "# Indice\n\nVedi [[Nota]].\n").expect("indice");
    for n in 0..20 {
        std::fs::write(root.join(format!("Altra {n}.md")), format!("# Altra {n}\n"))
            .expect("altra");
    }
    let echo = Arc::new(Echo::default());
    let (output, notices) = channel();
    let host = Host::new()
        .with_storage(Arc::new(EchoDisk {
            echo: Arc::clone(&echo),
        }))
        .with_watcher(Box::new(NoWatcher))
        .with_sink(Arc::new(Registered {
            output: Mutex::new(output),
        }));
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura finisce");
    let workspace = host
        .with_session(None, |s| s.workspace().clone())
        .expect("il vault è aperto");
    assert!(echo.workspace.set(workspace).is_ok());
    // Gli eventi dell'apertura non sono di questo banco.
    std::thread::sleep(Duration::from_millis(50));
    while notices.try_recv().is_ok() {}
    Bench {
        _dir: dir,
        root,
        echo,
        host,
        notices,
    }
}

/// Ciò che il rilevatore ha detto: nessun evento suo e nessun guasto.
fn assert_no_external_echo(notices: &Receiver<Notice>, what: &str) -> Vec<Notice> {
    std::thread::sleep(Duration::from_millis(50));
    let seen: Vec<Notice> = notices.try_iter().collect();
    let echoes: Vec<&Notice> = seen
        .iter()
        .filter(|n| n.origin.actor == Actor::Watcher || matches!(n.event, Event::Trouble { .. }))
        .collect();
    assert!(
        echoes.is_empty(),
        "{what}: il rilevatore ha preso il nostro gesto per una modifica da fuori: {echoes:?}"
    );
    seen
}

fn documents(host: &Host) -> Vec<String> {
    host.with_session(None, |s| {
        s.workspace()
            .read()
            .expect("lettura")
            .documents()
            .into_iter()
            .map(|id| id.as_str().to_owned())
            .collect()
    })
    .expect("il vault è aperto")
}

#[test]
fn a_save_seen_by_the_watcher_between_disk_and_memory_is_not_an_external_change() {
    let bench = bench();
    let note = bench.root.join("Nota.md");
    let id = DocId::new("Nota.md");

    bench
        .echo
        .arm(Op::Write, vec![ExternalChange::Touched(note.clone())]);
    let revision = bench
        .host
        .write_document(None, &id, "# Nota\n\nDopo.\n", WriteBase::Dictated)
        .expect("il salvataggio riesce");
    bench.echo.join();
    assert!(
        bench.echo.queued_in_window.load(Ordering::Acquire),
        "il lotto del rilevatore non è arrivato in fila durante la scrittura: \
         la finestra non è stata provata"
    );

    let seen = assert_no_external_echo(&bench.notices, "salvare");
    let changed = seen
        .iter()
        .filter(
            |n| matches!(&n.event, Event::DocumentChanged { id, .. } if id.as_str() == "Nota.md"),
        )
        .count();
    assert_eq!(changed, 1, "un salvataggio, un cambiamento: {seen:?}");
    // La revisione resta quella che il salvataggio ha reso: una scrittura che
    // discende da lei passa.
    bench
        .host
        .write_document(
            None,
            &id,
            "# Nota\n\nAncora.\n",
            WriteBase::DescendsFrom(revision),
        )
        .expect("la revisione resa dal salvataggio è quella del vault");
    assert_eq!(
        std::fs::read_to_string(&note).unwrap(),
        "# Nota\n\nAncora.\n"
    );
    bench.host.close();
}

#[test]
fn a_rename_seen_by_the_watcher_between_disk_and_memory_leaves_no_double_or_trash() {
    let bench = bench();
    let from = bench.root.join("Nota.md");
    let to = bench.root.join("Clienti/Nota.md");

    bench.echo.arm(
        Op::Rename,
        vec![
            ExternalChange::Touched(from.clone()),
            ExternalChange::Touched(to.clone()),
        ],
    );
    bench
        .host
        .invoke_user_command(
            None,
            "note.rename",
            serde_json::json!({ "doc": "Nota.md", "to": "Clienti/Nota.md" }),
            InvokeMode::Apply,
        )
        .expect("lo spostamento riesce");
    bench.echo.join();
    assert!(
        bench.echo.queued_in_window.load(Ordering::Acquire),
        "il lotto del rilevatore non è arrivato in fila durante lo spostamento: \
         la finestra non è stata provata"
    );

    let seen = assert_no_external_echo(&bench.notices, "spostare");
    let docs = documents(&bench.host);
    assert_eq!(
        docs.iter()
            .filter(|d| d.as_str() == "Clienti/Nota.md")
            .count(),
        1,
        "la nota spostata c'è una volta: {docs:?}"
    );
    assert!(
        !docs.iter().any(|d| d == "Nota.md"),
        "il vecchio nome non resta: {docs:?}"
    );
    let removed = seen
        .iter()
        .filter(|n| matches!(n.event, Event::DocumentRemoved { .. }))
        .count();
    assert_eq!(removed, 0, "uno spostamento non toglie niente: {seen:?}");
    let trash = bench
        .host
        .with_session(None, |s| {
            s.workspace().read().expect("lettura").list_trash()
        })
        .expect("il vault è aperto")
        .expect("il cestino si legge");
    assert!(trash.is_empty(), "nessun cestino fantasma");
    bench.host.close();
}
