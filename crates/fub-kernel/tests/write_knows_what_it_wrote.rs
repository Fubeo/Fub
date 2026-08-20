//! **La scrittura sa già che cosa ha scritto, e chi la sente rientrare la
//! riconosce come propria** (difetti 0179 e 0196).
//!
//! Sono due momenti della stessa scrittura, e prima di questo file nessuno dei
//! due era presidiato:
//!
//! 1. **subito dopo.** `touch_entry` ristatava il file appena scritto per
//!    prenderne dimensione e data, che i byte posati dicevano già. Costava una
//!    syscall per salvataggio, e in cambio apriva una finestra: se in quel
//!    momento un altro processo toglieva il file, l'anagrafe *toglieva la voce*
//!    di un documento che aveva appena risposto `Ok` e per cui era già uscito
//!    un `DocumentChanged`;
//! 2. **poco dopo.** Un salvataggio del kernel è una rename, una rename è un
//!    evento del filesystem, e il lotto del rilevatore riportava dentro il
//!    documento appena scritto — riletto, riparsato, reingerito, con un
//!    `DocumentChanged` a nome del rilevatore su una modifica che l'utente
//!    aveva appena fatto lui. Su ogni salvataggio di ogni nota.
//!
//! # Qui non si cronometra niente
//!
//! Un tempo su una macchina condivisa non è un segnale: si contano **le
//! operazioni**. Il supporto di prova annota le `read` e le `stats` per path, e
//! il provider di formato conta le proprie `parse_count`, che è il solo modo di
//! distinguere «non ha reingerito» da «ha reingerito una cosa uguale».
//!
//! # Il caso in cui non si riconosce, e va tenuto
//!
//! Il riconoscimento è **per impronta** e non per `mtime + size`. Il secondo è
//! il criterio dell'anagrafe (§14.1) e sarebbe costato una `stats` invece di una
//! lettura, ma sbaglia nel verso caro: una scrittura altrui nello stesso
//! millisecondo e della stessa lunghezza passerebbe per «immutato», e l'indice
//! resterebbe fermo su un documento vecchio. Per questo l'ultimo banco di
//! questo file guarda dall'altra parte — ciò che *è* cambiato da fuori deve
//! continuare a entrare — ed è la metà che rende il presidio un presidio invece

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::error::FormatError;
use fub_abi::event::{Event, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexQuery, IndexResult, VaultEntry};
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, FsStorage, Merge, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Subscription, Workspace};

/// Il disco vero, con un quaderno accanto: **quali path si sono letti e quali
/// si sono statati**.
///
/// Il disco vero e non `MemStorage` perché le due porte del rilevatore
/// (`plan_sync`, `sync_path`) chiedono al filesystem se il path esiste: su un
/// supporto in memoria non ci sarebbe niente da sincronizzare, e il banco
/// sarebbe verde per la ragione sbagliata.
struct CountingStorage {
    inner: FsStorage,
    reads: Mutex<Vec<Utf8PathBuf>>,
    stats: Mutex<Vec<Utf8PathBuf>>,
    /// Il path che **sparisce nell'istante dopo essere stato scritto**: è la
    /// finestra del difetto 0179, presa invece che aspettata.
    vanishes: Mutex<Option<Utf8PathBuf>>,
}

impl CountingStorage {
    fn new() -> Arc<Self> {
        Arc::new(CountingStorage {
            inner: FsStorage,
            reads: Mutex::new(Vec::new()),
            stats: Mutex::new(Vec::new()),
            vanishes: Mutex::new(None),
        })
    }

    fn reads_at(&self, path: &Utf8Path) -> usize {
        count(&self.reads, path)
    }

    fn stats_at(&self, path: &Utf8Path) -> usize {
        count(&self.stats, path)
    }

    fn reset(&self) {
        self.reads.lock().expect("reads lock").clear();
        self.stats.lock().expect("stats lock").clear();
    }
}

fn count(log: &Mutex<Vec<Utf8PathBuf>>, path: &Utf8Path) -> usize {
    log.lock()
        .expect("log lock")
        .iter()
        .filter(|p| p.as_path() == path)
        .count()
}

impl VaultStorage for CountingStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.reads.lock().expect("reads lock").push(path.into());
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        let stat = self.inner.write(path, bytes)?;
        if self.vanishes.lock().expect("vanish lock").as_deref() == Some(path) {
            self.inner.remove(path)?;
        }
        Ok(stat)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.stats.lock().expect("stats lock").push(path.into());
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// Un `.txt` che conta quante volte gli è stato chiesto di parsare.
struct CountingFormat(Arc<AtomicUsize>);

impl FormatProvider for CountingFormat {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("test.counting", "Counting text (test)", &["txt"])
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        self.0.fetch_add(1, Ordering::Relaxed);
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }
    fn render_html(&self, m: &DocumentModel, _or: &RenderOptions) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

struct Bench {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    storage: Arc<CountingStorage>,
    parse: Arc<AtomicUsize>,
    ws: Workspace,
    rx: Subscription,
}

impl Bench {
    /// Una nota già indicizzata, i contatori a zero e la coda degli eventi
    /// vuota: da qui in poi tutto ciò che si conta è del salvataggio.
    fn new() -> Bench {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("UTF-8 path");
        std::fs::write(root.join("nota.txt"), "first\n").expect("seed");

        let storage = CountingStorage::new();
        let parse: Arc<AtomicUsize> = Arc::default();
        let mut registry = FormatRegistry::new();
        registry
            .register(Box::new(CountingFormat(parse.clone())))
            .expect("no extension conflict");
        let mut ws = Workspace::on(
            &root,
            registry,
            storage.clone(),
            MachineSettings::in_memory(),
        )
        .expect("vault opens successfully");
        ws.reindex().expect("initial scan");
        let rx = ws.bus().subscribe();
        storage.reset();
        parse.store(0, Ordering::Relaxed);
        Bench {
            _dir: dir,
            root,
            storage,
            parse,
            ws,
            rx,
        }
    }

    fn notes(&self) -> Utf8PathBuf {
        self.root.join("nota.txt")
    }

    fn parse_count(&self) -> usize {
        self.parse.load(Ordering::Relaxed)
    }

    fn events(&self) -> Vec<Notice> {
        let mut seen = Vec::new();
        while let Ok(n) = self.rx.try_recv() {
            seen.push(n);
        }
        seen
    }

    fn entry(&self) -> Option<VaultEntry> {
        let IndexResult::Entries(page) = self
            .ws
            .query_index(IndexQuery::Entries {
                of_kind: None,
                within: None,
                page: None,
            })
            .expect("kernel serves the entry store")
        else {
            panic!("expected entry store");
        };
        page.items.into_iter().find(|and| and.id.as_str() == "nota.txt")
    }
}

/// **Un salvataggio non torna a chiedere al disco cosa ha appena scritto**
/// (difetto 0179).
///
/// Zero letture e zero `stats` sul path della nota, e l'anagrafe che ne esce non
/// è un'approssimazione: dimensione e data sono **le stesse** che il
/// filesystem darebbe, perché vengono dal descrittore ancora aperto della
/// scrittura. Quella coincidenza è ciò che l'assenza della `stats` non può
/// costare — un'anagrafe con una data inventata farebbe rileggere l'intero
#[test]
fn a_save_does_not_ask_the_disk_what_it_just_wrote() {
    let mut bench = Bench::new();
    let notes = bench.notes();

    bench
        .ws
        .write_document(&DocId::new("nota.txt"), "second\n", WriteBase::Dictated)
        .expect("save succeeds");

    assert_eq!(
        bench.storage.stats_at(&notes),
        0,
        "the write re-stat'd the file it had just placed: size and date are \
         known from the written bytes, and asking again opens the window where \
         another process might have already removed that file (0179)"
    );
    assert_eq!(
        bench.storage.reads_at(&notes),
        0,
        "the write re-read what it had written"
    );

    let entry = bench.entry().expect("the note is in the entry store");
    let real = std::fs::metadata(&notes).expect("the note is on disk");
    assert_eq!(entry.size, "second\n".len() as u64);
    assert_eq!(
        entry.mtime,
        real.modified()
            .expect("the filesystem knows the date")
            .duration_since(std::time::UNIX_EPOCH)
            .expect("after 1970")
            .as_millis() as u64,
        "the entry store carries a date that is not the file's: on the next \
         opening no entry would match, and the entire vault would be re-read"
    );
}

/// **Una cancellazione nell'istante dopo non disfa l'anagrafe** (difetto 0179).
///
/// È la faccia di correttezza, e il comportamento **cambia** rispetto a prima:
/// dove il kernel toglieva la voce, adesso la tiene. È la risposta giusta, e la
/// ragione è l'ordine dei fatti — la scrittura ha risposto `Ok`, il
/// `DocumentChanged` è già uscito, e un'anagrafe che dicesse «quel documento
/// non c'è» contraddirebbe un evento che ha già annunciato il contrario, senza
/// annunciare niente a sua volta. La cancellazione è un fatto **di un altro**,
/// ed entra dalla porta da cui entrano i fatti altrui: il rilevatore, che la
/// riferisce con il suo `EntryRemoved`. Qui sotto se ne vede l'arrivo.
/// riferisce con il suo `EntryRemoved`. Qui sotto se ne vede l'arrivo.
/// riferisce con il suo `EntryRemoved`. Qui sotto se ne vede l'arrivo.
#[test]
fn a_deletion_in_the_instant_after_does_not_undo_the_entry_store() {
    let mut bench = Bench::new();
    let notes = bench.notes();
    *bench.storage.vanishes.lock().expect("vanish lock") = Some(notes.clone());

    bench
        .ws
        .write_document(&DocId::new("nota.txt"), "second\n", WriteBase::Dictated)
        .expect("save succeeds");

    assert!(
        bench.events().iter().any(|n| matches!(
            &n.event,
            Event::DocumentChanged { id, .. } if id.as_str() == "nota.txt"
        )),
        "the write announced the change"
    );
    let entry = bench
        .entry()
        .expect("the entry store keeps what the write announced");
    assert_eq!(
        entry.size,
        "second\n".len() as u64,
        "the entry store describes the written bytes"
    );

    // E il fatto altrui arriva dalla sua porta, con il suo evento.
    *bench.storage.vanishes.lock().expect("vanish lock") = None;
    assert!(
        bench
            .ws
            .sync_path(&notes)
            .expect("synchronization succeeds"),
        "the detector sees that the file is no longer there"
    );
    assert!(bench.entry().is_none(), "and then the entry is gone");
}

/// **L'eco di un salvataggio non si riparsa e non annuncia niente** (difetto
/// 0196), dalla porta preparata — quella del lotto del rilevatore.
#[test]
fn an_echo_of_a_save_is_not_reparsed() {
    let mut bench = Bench::new();
    let notes = bench.notes();
    bench
        .ws
        .write_document(&DocId::new("nota.txt"), "second\n", WriteBase::Dictated)
        .expect("save succeeds");
    bench.storage.reset();
    bench.parse.store(0, Ordering::Relaxed);
    let _ = bench.events();

    // Le due fasi del lotto, come le fa `ExternalSync::batch`.
    let plan = bench.ws.plan_sync(&notes);
    assert!(
        !bench
            .ws
            .sync_path_prepared(&notes, plan)
            .expect("synchronization succeeds"),
        "the document the kernel just wrote came back as if it had changed \
         from outside (0196)"
    );

    assert_eq!(
        bench.parse_count(),
        0,
        "the echo of its own write was re-parsed: this happens on every save \
         of every note"
    );
    assert!(
        bench.events().is_empty(),
        "the echo announced a change on behalf of the detector for a \
         modification the user had just made himself"
    );
    assert!(
        bench.storage.reads_at(&notes) <= 1,
        "recognizing its own bytes costs one file read: {}",
        bench.storage.reads_at(&notes)
    );
}

/// **E lo eredita l'altra porta**, quella che il lotto prende quando il piano
/// non c'è: un file di cui nessuno ha preparato niente non deve costare di più.
#[test]
fn the_echo_is_not_reparsed_even_without_a_plan() {
    let mut bench = Bench::new();
    let notes = bench.notes();
    bench
        .ws
        .write_document(&DocId::new("nota.txt"), "second\n", WriteBase::Dictated)
        .expect("save succeeds");
    bench.storage.reset();
    bench.parse.store(0, Ordering::Relaxed);
    let _ = bench.events();

    assert!(
        !bench
            .ws
            .sync_path(&notes)
            .expect("synchronization succeeds"),
        "nothing changed, and `sync_path` must say so"
    );
    assert_eq!(bench.parse_count(), 0, "and it must not discover this by re-parsing");
    assert!(bench.events().is_empty());
}

/// **Ciò che è cambiato davvero continua a entrare.**
///
/// È la metà che rende il riconoscimento un presidio e non una scorciatoia: se
/// bastasse un `return` all'inizio della sincronizzazione, i tre banchi sopra
/// sarebbero verdi e questo rosso.
#[test]
fn someone_elses_write_still_enters() {
    let mut bench = Bench::new();
    let notes = bench.notes();
    bench
        .ws
        .write_document(&DocId::new("nota.txt"), "second\n", WriteBase::Dictated)
        .expect("save succeeds");
    bench.parse.store(0, Ordering::Relaxed);
    let _ = bench.events();

    std::fs::write(&notes, "from outside\n").expect("external write");
    let plan = bench.ws.plan_sync(&notes);
    assert!(
        bench
            .ws
            .sync_path_prepared(&notes, plan)
            .expect("synchronization succeeds"),
        "a write from another process was mistaken for the kernel's own"
    );
    assert_eq!(bench.parse_count(), 1, "and it was re-parsed, once");
    assert!(
        bench.events().iter().any(|n| matches!(
            &n.event,
            Event::DocumentChanged { id, .. } if id.as_str() == "nota.txt"
        )),
        "and whoever has the buffer open found out"
    );
}
