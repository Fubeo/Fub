//! **La riapertura tiepida**: un vault chiuso e riaperto senza che nessuno
//! l'abbia toccato non rilegge una sola nota (#521).
//!
//! Il kernel salta un documento solo se **tutti** gli indici registrati dicono
//! di averlo (`IndexProvider::up_to_date` è un'intersezione): basta un indice
//! di serie che lasci il default «mandami tutto» per far rileggere e
//! rianalizzare l'intero vault a ogni apertura
//! (`docs/misure/2026-11-20-riapertura-tiepida.md`). Questo presidio monta
//! l'host con le funzionalità di serie, su un disco vero che conta le
//! letture, e guarda le tre cose che contano per chi usa Fub:
//!
//! - la seconda apertura non legge nessuna nota, e le risposte (promemoria,
//!   ricerca, ciò che le basi leggono) sono quelle della prima;
//! - una nota cambiata ad app chiusa — stessa misura, altro contenuto — si
//!   rilegge, e torna con il promemoria nuovo;
//! - un file dei promemoria rotto o di un altro schema non blocca niente: si
//!   rilegge tutto e i promemoria sono quelli giusti.
//!
//! In più l'anagrafe (#524): una riapertura di un vault fermo non la
//! riscrive.

use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{Excerpts, IndexQuery, IndexResult, Page, PropertySelect};
use fub_features::tasks::reminders::{ReminderList, RemindersQuery};
use fub_host::mount::VaultStorageSource;
use fub_host::Host;
use fub_kernel::storage::{
    ConditionalWrite, DirEntry, FileIdentity, Merge, RootedFsStorage, Stat, VaultStorage,
};

// ---- Il disco che conta ----

/// Ciò che il disco ha visto, condiviso fra tutti i vault montati.
#[derive(Default)]
struct Seen {
    /// I file **del vault** (fuori da `.fub/`) letti, come path relativi.
    reads: Mutex<Vec<String>>,
    /// Le scritture dell'anagrafe (`.fub/data/entries.json`), di ogni specie.
    anagrafe_writes: AtomicUsize,
}

impl Seen {
    fn reset(&self) {
        self.reads.lock().unwrap().clear();
        self.anagrafe_writes.store(0, Ordering::SeqCst);
    }
    /// I file del vault letti, una volta ciascuno. Il `.gitignore` della
    /// radice non conta: lo legge la scansione a ogni apertura per sapere cosa
    /// non guardare, ed è un file, non una nota da rianalizzare.
    fn reads(&self) -> Vec<String> {
        let mut reads = self.reads.lock().unwrap().clone();
        reads.retain(|rel| rel != ".gitignore");
        reads.sort();
        reads.dedup();
        reads
    }
    fn anagrafe_writes(&self) -> usize {
        self.anagrafe_writes.load(Ordering::SeqCst)
    }
}

/// Un disco radicato vero che delega **ogni** metodo, anche quelli con un
/// default nel tratto: un default al posto dell'implementazione del disco
/// vero cambierebbe il comportamento che il presidio deve guardare.
struct Counting {
    inner: RootedFsStorage,
    root: Utf8PathBuf,
    seen: Arc<Seen>,
}

impl Counting {
    /// Il path relativo alla radice, se `path` è un file del vault e non un
    /// derivato sotto `.fub/`. Per componenti, non come stringa (su Windows
    /// la radice è un path verbatim).
    fn of_vault(&self, path: &Utf8Path) -> Option<String> {
        let rel = path.strip_prefix(&self.root).unwrap_or(path);
        if rel.components().any(|c| c.as_str() == ".fub") {
            return None;
        }
        Some(
            rel.components()
                .map(|c| c.as_str())
                .collect::<Vec<_>>()
                .join("/"),
        )
    }
    fn read_of(&self, path: &Utf8Path) {
        if let Some(rel) = self.of_vault(path) {
            self.seen.reads.lock().unwrap().push(rel);
        }
    }
    fn write_of(&self, path: &Utf8Path) {
        if path.ends_with(".fub/data/entries.json") {
            self.seen.anagrafe_writes.fetch_add(1, Ordering::SeqCst);
        }
    }
}

impl VaultStorage for Counting {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
        self.read_of(path);
        self.inner.read(path)
    }
    fn read_at(&self, path: &Utf8Path, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        self.read_of(path);
        self.inner.read_at(path, offset, len)
    }
    fn read_pieces(&self, path: &Utf8Path, piece: &mut dyn FnMut(&[u8])) -> io::Result<()> {
        self.read_of(path);
        self.inner.read_pieces(path, piece)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.write_of(path);
        self.inner.write(path, bytes)
    }
    fn write_if_unchanged(
        &self,
        path: &Utf8Path,
        expected: Option<&[u8]>,
        bytes: &[u8],
    ) -> io::Result<ConditionalWrite> {
        self.write_of(path);
        self.inner.write_if_unchanged(path, expected, bytes)
    }
    fn write_derived(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.write_of(path);
        self.inner.write_derived(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.write_of(path);
        self.inner.update(path, merge)
    }
    fn update_derived(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
        self.write_of(path);
        self.inner.update_derived(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        self.write_of(path);
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        self.inner.rename_no_replace(from, to)
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
    fn remove_abandoned_lock(&self, path: &Utf8Path) -> io::Result<bool> {
        self.inner.remove_abandoned_lock(path)
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

struct CountingDisk(Arc<Seen>);

impl VaultStorageSource for CountingDisk {
    fn open(&self, root: &Utf8Path) -> io::Result<Arc<dyn VaultStorage>> {
        Ok(Arc::new(Counting {
            inner: RootedFsStorage::open(root)?,
            root: root.to_owned(),
            seen: Arc::clone(&self.0),
        }))
    }
}

/// Un host nuovo, come un'app appena lanciata, sul disco che conta.
fn host(seen: &Arc<Seen>) -> Host {
    Host::without_watcher().with_storage(Arc::new(CountingDisk(Arc::clone(seen))))
}

// ---- Il vault ----

const ORA: &str = "- [ ] Chiamare Mario ⏰ 2026-11-13 09:30\n";
const DOPO: &str = "- [ ] Chiamare Luigi ⏰ 2026-11-14 10:45\n";

const BASE: &str = "filters: 'tipo == \"progetto\"'\n\
views:\n  - {name: Tutti, type: table}\nproperties: []\n";

const DISEGNO: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect x="10" y="10" width="40" height="30" fill="#c33"/><text x="10" y="80">Lavagna</text></svg>"##;

/// Scrive un file e lo porta `ago` nel passato: l'impronta di un file appena
/// scritto non si impara (*racily clean*), e il presidio guarda il vault, non
/// l'orologio.
fn aged(root: &Utf8Path, rel: &str, bytes: &str, ago: Duration) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, bytes).unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(SystemTime::now() - ago)
        .unwrap();
}

const HOUR: Duration = Duration::from_secs(3600);

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    aged(
        &root,
        "Progetti/casa.md",
        &format!("---\ntipo: progetto\n---\n# Casa\n\n{ORA}- [ ] Senza ora\n"),
        HOUR,
    );
    aged(
        &root,
        "Progetti/orto.md",
        "---\ntipo: progetto\n---\n# Orto\n\n- [ ] Seminare ⏰ 2026-11-20 07:00\n",
        HOUR,
    );
    aged(
        &root,
        "Diario/lunedi.md",
        "# Lunedì\n\nUna giornata di pioggia e di carciofi.\n",
        HOUR,
    );
    for i in 0..12 {
        aged(
            &root,
            &format!("Archivio/nota-{i:02}.md"),
            &format!("# Nota {i}\n\nTesto qualunque numero {i}.\n"),
            HOUR,
        );
    }
    aged(&root, "Viste/progetti.base", BASE, HOUR);
    aged(&root, "Disegni/schizzo.svg", DISEGNO, HOUR);
    (dir, root)
}

// ---- Le risposte ----

/// Ciò che chi usa Fub vede dagli indici: i promemoria, la ricerca, e ciò che
/// le basi leggono (i documenti con le proprietà).
#[derive(Debug, PartialEq)]
struct Answers {
    reminders: Vec<(String, String, String)>,
    search: Vec<String>,
    documents: serde_json::Value,
}

fn reminders(host: &Host) -> Vec<(String, String, String)> {
    let result = host
        .query_index(None, RemindersQuery::between(None, None).to_index_query())
        .expect("reminders answer");
    ReminderList::from_index_result(result)
        .expect("reminders shape")
        .reminders
        .into_iter()
        .map(|r| (r.doc.to_string(), r.when, r.text))
        .collect()
}

fn search(host: &Host, terms: &str) -> Vec<String> {
    match host.query_index(
        None,
        IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms(terms))),
            sort: None,
            select: PropertySelect::None,
            page: Some(Page::first(50)),
            excerpts: Excerpts::default(),
        },
    ) {
        Ok(IndexResult::Documents(hits)) => {
            let mut docs: Vec<String> = hits.items.into_iter().map(|h| h.doc.to_string()).collect();
            docs.sort();
            docs
        }
        other => panic!("{other:?}"),
    }
}

fn documents(host: &Host) -> serde_json::Value {
    match host.query_index(
        None,
        IndexQuery::Documents {
            matching: QueryExpr::all(),
            sort: None,
            select: PropertySelect::All,
            page: Some(Page::first(100)),
            excerpts: Excerpts::default(),
        },
    ) {
        Ok(IndexResult::Documents(page)) => {
            let mut items: Vec<serde_json::Value> = page
                .items
                .iter()
                .map(|hit| serde_json::to_value(hit).unwrap())
                .collect();
            items.sort_by_key(|item| item.to_string());
            serde_json::Value::Array(items)
        }
        other => panic!("{other:?}"),
    }
}

fn answers(host: &Host) -> Answers {
    Answers {
        reminders: reminders(host),
        search: search(host, "carciofi"),
        documents: documents(host),
    }
}

/// Una sessione dell'app, dall'avvio all'uscita: apre il vault in un host
/// nuovo, aspetta l'indicizzazione, prende le risposte e chiude.
///
/// Restituisce le risposte e i file del vault letti **dall'apertura**, fino
/// alla fine dell'indicizzazione: le domande dopo leggono per conto loro (gli
/// estratti della ricerca aprono la nota trovata), e non sono la riapertura.
/// Le scritture dell'anagrafe si contano invece fino alla chiusura compresa.
fn session(seen: &Arc<Seen>, root: &Utf8Path) -> (Answers, Vec<String>) {
    seen.reset();
    let host = host(seen);
    host.open(root).expect("opens");
    host.wait_indexed(None).expect("indexes");
    let opened = seen.reads();
    let answers = answers(&host);
    let key = host.current().expect("current vault");
    let errors = host.close_vault(&key).expect("closes");
    assert!(errors.is_empty(), "closing: {errors:?}");
    (answers, opened)
}

/// Il file dei promemoria, dove l'host tiene i dati di `fub.tasks`.
fn reminders_file(root: &Utf8Path) -> Utf8PathBuf {
    let path = root.join(".fub/plugins/fub.tasks/reminders.json");
    assert!(path.exists(), "the reminders file is at {path}");
    path
}

// ---- I presidi ----

fn reminder(doc: &str, when: &str, text: &str) -> (String, String, String) {
    (doc.into(), when.into(), text.into())
}

const NONE: Vec<String> = Vec::new();

#[test]
fn a_vault_reopened_untouched_rereads_no_note() {
    let (_dir, root) = vault();
    let seen = Arc::new(Seen::default());
    let (cold, read) = session(&seen, &root);
    // Il freddo legge ogni nota, la base e il disegno.
    assert_eq!(read.len(), 17, "the cold opening reads the vault: {read:?}");
    assert_eq!(
        cold.reminders,
        vec![
            reminder("Progetti/casa.md", "2026-11-13 09:30", "Chiamare Mario"),
            reminder("Progetti/orto.md", "2026-11-20 07:00", "Seminare"),
        ]
    );
    assert_eq!(cold.search, vec!["Diario/lunedi.md".to_string()]);
    reminders_file(&root);
    let cold_writes = seen.anagrafe_writes();
    assert!(
        cold_writes > 0,
        "the counter sees the anagrafe being written"
    );

    let (warm, read) = session(&seen, &root);
    assert_eq!(read, NONE, "an untouched vault rereads nothing");
    assert_eq!(warm, cold, "the warm opening answers like the cold one");
    assert_eq!(
        seen.anagrafe_writes(),
        0,
        "an untouched vault does not rewrite its anagrafe (#524)"
    );
}

#[test]
fn a_note_changed_while_closed_comes_back_with_its_new_reminder() {
    let (_dir, root) = vault();
    let seen = Arc::new(Seen::default());
    let (cold, _) = session(&seen, &root);

    // Ad app chiusa: stesso numero di byte, un altro promemoria, un'altra ora
    // di modifica (sempre nel passato, quindi un'impronta che si impara).
    assert_eq!(ORA.len(), DOPO.len());
    let changed = format!("---\ntipo: progetto\n---\n# Casa\n\n{DOPO}- [ ] Senza ora\n");
    aged(&root, "Progetti/casa.md", &changed, HOUR / 2);

    let (warm, read) = session(&seen, &root);
    assert_eq!(read, vec!["Progetti/casa.md".to_string()]);
    assert_eq!(
        warm.reminders,
        vec![
            reminder("Progetti/casa.md", "2026-11-14 10:45", "Chiamare Luigi"),
            reminder("Progetti/orto.md", "2026-11-20 07:00", "Seminare"),
        ]
    );
    assert_eq!(warm.search, cold.search);
    assert_eq!(warm.documents, cold.documents);

    // E la terza apertura ha imparato la revisione nuova.
    let (third, read) = session(&seen, &root);
    assert_eq!(read, NONE);
    assert_eq!(third, warm);
}

#[test]
fn a_broken_or_foreign_reminders_file_rereads_and_gives_the_right_reminders() {
    /// Come si guasta il file buono.
    type Damage = fn(&str) -> String;
    let damages: [(&str, Damage); 3] = [
        ("garbage", |_| "{ non è json".to_string()),
        ("old schema", |good| {
            good.replacen("\"schema\":1", "\"schema\":0", 1)
        }),
        ("emptied", |_| String::new()),
    ];
    for (what, damage) in damages {
        let (_dir, root) = vault();
        let seen = Arc::new(Seen::default());
        let (cold, _) = session(&seen, &root);
        let file = reminders_file(&root);
        let good = std::fs::read_to_string(&file).unwrap();
        let bad = damage(&good);
        assert_ne!(bad, good, "{what}: the damage changes the file");
        std::fs::write(&file, bad).unwrap();

        let (warm, read) = session(&seen, &root);
        assert!(
            read.iter().any(|r| r == "Progetti/casa.md"),
            "{what}: the notes are reread: {read:?}"
        );
        assert_eq!(warm, cold, "{what}: the right reminders");

        // Il file è tornato buono: la prossima apertura non rilegge.
        let (_, read) = session(&seen, &root);
        assert_eq!(read, NONE, "{what}: rewritten");
    }
}
