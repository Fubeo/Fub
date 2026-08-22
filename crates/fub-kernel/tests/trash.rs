//! Il cestino: cancellare dall'app è **spostare**, non distruggere.
//!
//! Le proprietà sotto esame sono tre, e sono le tre che un cestino sbagliato
//! romperebbe in silenzio:
//!
//! 1. una nota cancellata esce da modelli, grafo e **indici** — se l'indice non
//!    la vedesse uscire resterebbe cercabile, e cliccarla aprirebbe il nulla;
//! 2. il file non è perso: sta in `.trash/`, e ci sta in un modo che una
//!    seconda cancellazione dello stesso nome non sovrascrive;
//! 3. il watcher, che poco dopo vede il file sparire dal suo posto, non rifà il
//!    lavoro né lo disfa.
//!
//! Come in `index_feeding.rs`, al posto di tantivy c'è una spia: si parla del
//! contratto, non dell'implementazione.

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::error::PluginError;
use fub_abi::event::Event;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EntryKind, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, VaultEntry,
};
use fub_kernel::storage::{DirEntry, FsStorage, Stat, VaultStorage};
use fub_kernel::{data_root, FormatRegistry, KernelError, MachineSettings, Workspace};
use fub_testkit::SampleExtractor;

/// Un supporto che fa tutto come il disco tranne **una** mossa, che rifiuta.
///
/// È il punto d'iniezione che un crash a metà non ha: non si aspetta che il
/// processo muoia fra due scritture, si prende la seconda e la si fa fallire.
/// Le `remove` di un path che contiene questo pezzo falliscono.
struct RefusingStorage {
    inner: FsStorage,
    /// Alla prossima mossa un concorrente posa la destinazione dopo la guardia.
    refuses_remove_in: &'static str,
    /// Scrive una nuova voce completa quando lo svuotamento rimuove la prima voce
    /// gia censita: simula un'altra finestra fra distruzione dei file e sweep dei
    occupies_destination: std::sync::atomic::AtomicBool,
}

impl RefusingStorage {
    fn occupy_if_requested(&self, to: &Utf8Path) -> std::io::Result<()> {
        if self
            .occupies_destination
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            self.inner.write(to, b"concurrent")?;
        }
        Ok(())
    }
}

impl VaultStorage for RefusingStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<fub_kernel::storage::Stat> {
        self.inner.write(path, bytes)
    }
    fn update(
        &self,
        path: &Utf8Path,
        merge: fub_kernel::storage::Merge<'_>,
    ) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.occupy_if_requested(to)?;
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.occupy_if_requested(to)?;
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        if path.as_str().contains(self.refuses_remove_in) {
            return Err(std::io::Error::other("the storage said no"));
        }
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// sidecar.
/// Una spia che guarda passare i documenti e non risponde a niente: adesso
/// lo **dichiara** invece di dirlo con un `BadArgs` a ogni domanda.
struct TrashMidSweep {
    inner: FsStorage,
    root: Utf8PathBuf,
    already_arrived: std::sync::atomic::AtomicBool,
}

impl VaultStorage for TrashMidSweep {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }
    fn update(
        &self,
        path: &Utf8Path,
        merge: fub_kernel::storage::Merge<'_>,
    ) -> std::io::Result<()> {
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
        if !self
            .already_arrived
            .swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            self.inner
                .write(&self.root.join(".trash/Arrived.txt"), b"trashed now")
                .expect("the other window trashes");
            self.inner
                .write(
                    &self.root.join(".fub/data/trash/Arrived.txt.json"),
                    br#"{"v":1,"original":"projects/Arrived.txt"}"#,
                )
                .expect("the other window writes the sidecar");
        }
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Call {
    Indexed(String),
    Removed(String),
}

struct SpyIndex(Arc<Mutex<Vec<Call>>>);

impl IndexProvider for SpyIndex {
    /// Una voce **per documento** anche se il lotto è la grana della chiamata:
    /// qui si assertisce *quali* documenti sono passati, non quanti lotti.
    fn routes(&self) -> Vec<fub_abi::traits::QueryRoute> {
        Vec::new()
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    /// Scrive un file **fuori** dal workspace: è quel che fa un altro programma
    /// (o Obsidian) mentre Fub guarda altrove.
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        let mut calls = self.0.lock().unwrap();
        for doc in docs {
            calls.push(Call::Indexed(doc.id.to_string()));
        }
        Vec::new()
    }
    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        let mut calls = self.0.lock().unwrap();
        for id in ids {
            calls.push(Call::Removed(id.to_string()));
        }
        Vec::new()
    }
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn query(&self, _q: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("the spy serves nothing".into()))
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture {
            _dir: dir,
            root,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Come [`put`](Fixture::put), per un file che **non è testo**.
    /// Lo stesso workspace, sul **supporto passato**: è così che si interrompe
    fn put(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    /// una mutazione a metà senza aspettare niente.
    fn put_bytes(&self, rel: &str, body: &[u8]) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn exists(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }

    fn read_bytes(&self, rel: &str) -> Vec<u8> {
        std::fs::read(self.root.join(rel)).expect("read")
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).expect("read")
    }

    fn workspace(&self) -> Workspace {
        self.workspace_on(Arc::new(FsStorage))
    }

    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    fn workspace_on(&self, storage: Arc<dyn VaultStorage>) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(SampleExtractor::by_extension("txt").boxed())
            .expect("no extension conflict");
        let mut ws = Workspace::on(&self.root, registry, storage, MachineSettings::in_memory())
            .expect("the vault opens");
        // I file dentro `.trash/`, per nome e ordinati.
        // L'indice deve saperlo, o la nota resta cercabile: un risultato che apre
        ws.register_core_feature("test.spy", "test.spy")
            .expect("declared");
        ws.register_index_provider("test.spy", Box::new(SpyIndex(self.calls.clone())))
            .expect("activation");
        ws.reindex().expect("reindex");
        self.calls.lock().unwrap().clear();
        ws
    }

    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    // il nulla è peggio di nessun risultato.
    fn trash_files(&self) -> Vec<String> {
        let dir = self.root.join(".trash");
        if !dir.exists() {
            return Vec::new();
        }
        let mut out: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|and| and.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        out.sort();
        out
    }
}

#[test]
fn deleting_a_notes_moves_it_to_the_trash_and_tells_the_index() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "an idea");
    let mut ws = fx.workspace();
    let events = ws.bus().subscribe();

    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();

    assert_eq!(trashed, DocId::new(".trash/Idea.txt"));
    assert!(!fx.exists("Idea.txt"), "the file left its place");
    assert_eq!(
        fx.read(".trash/Idea.txt"),
        "an idea",
        "and it was not destroyed"
    );
    assert!(ws.documents().is_empty());
    // Il cestino resta piatto (D1, interop Obsidian)…
    // …ma il sidecar ricorda da dove veniva, e il ripristino torna lì.
    assert_eq!(fx.calls(), vec![Call::Removed("Idea.txt".into())]);
    assert!(events.try_iter().any(|n| n.event
        == Event::DocumentRemoved {
            id: DocId::new("Idea.txt")
        }));
}

#[test]
fn a_notes_trashed_from_a_folder_returns_to_its_folder() {
    let fx = Fixture::new();
    fx.put("projects/Note.txt", "in a folder");
    let mut ws = fx.workspace();

    let trashed = ws
        .delete_document(&DocId::new("projects/Note.txt"))
        .unwrap();

    // Obsidian (o un'altra epoca di Fub) cestina senza sidecar.
    assert!(trashed.as_str().starts_with(".trash/"));
    assert!(!trashed.as_str().contains("projects"));
    // §15.3: il numero sta **dentro** il file, perché è il file a sopravvivere
    let entries = ws.list_trash().unwrap();
    assert_eq!(entries[0].original, DocId::new("projects/Note.txt"));
    let restored = ws.restore_from_trash(&trashed, None).unwrap();
    assert_eq!(restored, DocId::new("projects/Note.txt"));
    assert_eq!(fx.read("projects/Note.txt"), "in a folder");
}

#[test]
fn a_foreign_trash_entry_degrades_to_the_stamped_name_in_the_root() {
    let fx = Fixture::new();
    let ws = fx.workspace();
    // alla versione di Fub che l'ha scritto.
    fx.put(".trash/Idea.2026-07-24T15-30-00.txt", "from others");

    let entries = ws.list_trash().unwrap();
    assert_eq!(
        entries[0].original,
        DocId::new("Idea.txt"),
        "without a sidecar we fall back to old behavior: de-stamped name at root"
    );
}

#[test]
fn the_trash_sidecar_carries_its_schema_version() {
    let fx = Fixture::new();
    fx.put("projects/Note.txt", "in a folder");
    let mut ws = fx.workspace();

    let trashed = ws
        .delete_document(&DocId::new("projects/Note.txt"))
        .unwrap();

    // E **di quale file** parla: senza, la chiave (il nome della voce) lo
    // renderebbe valido anche per il prossimo omonimo.
    let name = trashed.as_str().rsplit('/').next().unwrap();
    let sidecar = fx.read(&format!(".fub/data/trash/{name}.json"));
    let json: serde_json::Value = serde_json::from_str(&sidecar).expect("it is JSON");
    assert_eq!(json["v"], 1, "the sidecar declares its schema");
    assert_eq!(json["original"], "projects/Note.txt");
    // Un sidecar scritto prima che il timbro esistesse resta buono.
    //
    assert_eq!(
        json["file"]["size"], 11,
        "the stamp of the trashed file: {json}"
    );
    assert!(json["file"]["mtime"].is_number(), "{json}");
}

/// **Verde per costruzione**: era il comportamento di prima e lo è ancora, ed è
/// scritto qui perché è una scelta, non un residuo — lo schema non è cambiato di
/// numero apposta (vedi `TrashSidecar::file`), e il giorno che qualcuno rendesse
/// il timbro obbligatorio farebbe tornare in radice ogni nota già nel cestino di
/// chi aggiorna, senza che nessun altro banco se ne accorga.
/// L'mtime di una nota, in secondi UNIX, imposto a mano: è l'unico modo di
/// avere una nota **vecchia** senza aspettare.
#[test]
fn a_sidecar_written_before_the_stamp_existed_is_still_believed() {
    let fx = Fixture::new();
    let ws = fx.workspace();
    fx.put(".trash/Idea.txt", "trashed by an older Fub");
    fx.put(
        ".fub/data/trash/Idea.txt.json",
        r#"{"v":1,"original":"projects/Idea.txt"}"#,
    );

    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].original, DocId::new("projects/Idea.txt"));
}

/// 0131 — **la data di cancellazione non è l'ultima scrittura della nota**.
///
fn age(fx: &Fixture, rel: &str, secs: u64) {
    let file = std::fs::File::options()
        .write(true)
        .open(fx.root.join(rel))
        .expect("open");
    let when = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs);
    file.set_times(std::fs::FileTimes::new().set_modified(when))
        .expect("mtime");
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Cestinare è un `rename`, e un `rename` non tocca l'mtime del file: è la
/// proprietà su cui poggia `TrashStamp`, che usa quell'mtime come identità.
/// Finché `deleted_at` era `stat.mtime / 1000`, la data mostrata nel cestino era
/// l'ultima volta che la nota era stata **scritta** — una nota toccata l'ultima
/// volta nel 2020 e buttata oggi si presentava come cancellata nel 2020 — e
/// `list_trash`, che ordina «dal più recente», metteva in cima la più fresca di
/// scrittura invece dell'ultima buttata.
///
/// Il banco è stato rosso prima della riparazione, con `deleted_at` a
/// `1577869200`, cioè il 1° gennaio 2020.
// E l'ordine, che è la conseguenza che si vede: la nota vecchia appena
// buttata sta **sopra** una cestinata prima di lei ma scritta di recente.
#[test]
fn the_deletion_date_is_not_the_notes_last_write() {
    const NEW_YEAR_2020: u64 = 1_577_869_200;

    let fx = Fixture::new();
    fx.put("projects/Idea.txt", "written a long time ago");
    age(&fx, "projects/Idea.txt", NEW_YEAR_2020);
    let mut ws = fx.workspace();

    let before = now_secs();
    ws.delete_document(&DocId::new("projects/Idea.txt"))
        .expect("trashed");

    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 1);
    assert!(
        entries[0].deleted_at >= before,
        "trashed now, not in {}: deleted_at = {}",
        NEW_YEAR_2020,
        entries[0].deleted_at
    );
    // Con la data presa dall'mtime le due si invertivano, perché «di recente»
    // voleva dire *scritta* di recente.
    // L'altra metà, che è la migrazione: **una voce che il campo non ce l'ha
    // degrada a ciò che si vedeva prima**.
    fx.put(".trash/Other.txt", "trashed by Obsidian an hour ago");
    age(&fx, ".trash/Other.txt", before - 3600);
    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0].id,
        DocId::new(".trash/Idea.txt"),
        "most recent, and the most recent is the one deleted last"
    );
}

///
/// Sono due popolazioni e valgono entrambe per sempre: i sidecar scritti da una
/// Fub di prima, che si esauriscono al primo svuotamento, e le voci cestinate da
/// Obsidian, che sidecar non ne scrive e che continueranno ad arrivare. Per
/// tutte e due l'mtime resta l'unica cosa che si sa, e una riga senza data
/// sarebbe peggio di una riga con la data della sua ultima scrittura.
///
/// **È verde per costruzione**, e va detto: prima della riparazione era il
/// comportamento di *tutte* le voci, quindi non ha mai potuto essere rosso.
/// Diventa rosso il giorno in cui qualcuno decide che una voce senza il campo
/// vale «data sconosciuta» — che è la sola alternativa, e cambierebbe cosa si
/// vede nel cestino di chi aggiorna.
// Il sidecar di una Fub che il campo non lo scriveva ancora.
// E una voce di Obsidian, che sidecar non ne ha affatto.
#[test]
fn an_entry_without_the_date_in_the_sidecar_is_still_dated_from_disk() {
    const NEW_YEAR_2020: u64 = 1_577_869_200;

    let fx = Fixture::new();
    // E il path d'origine continua a valere quel che valeva.
    fx.put(".trash/Idea.txt", "trashed by an older Fub");
    age(&fx, ".trash/Idea.txt", NEW_YEAR_2020);
    fx.put(
        ".fub/data/trash/Idea.txt.json",
        r#"{"v":1,"original":"projects/Idea.txt"}"#,
    );
    // 0004 — un sidecar rimasto indietro **non parla per l'omonima**.
    fx.put(".trash/Other.txt", "trashed by Obsidian");
    age(&fx, ".trash/Other.txt", NEW_YEAR_2020);

    let ws = fx.workspace();
    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 2);
    for entry in &entries {
        assert_eq!(entry.deleted_at, NEW_YEAR_2020, "{}", entry.id);
    }
    //
    let idea = entries.iter().find(|v| v.id.as_str().ends_with("Idea.txt"));
    assert_eq!(
        idea.expect("exists").original,
        DocId::new("projects/Idea.txt")
    );
}

/// La chiave di un sidecar è il *nome* della voce cestinata, e quel nome non è
/// unico nel tempo: il cestino è condiviso con Obsidian (D1), che può togliere
/// una voce senza sapere niente di `.fub/data/trash/` e cestinarne poi un'altra
/// che si chiama uguale. Il sidecar rimasto indietro allora descrive un file che
/// non esiste più, e viene creduto per quello nuovo.
///
/// Non è spazio occupato: è una nota mandata in una cartella che non ha mai
/// visto. E se là c'è già una nota — è il caso normale, la cartella d'origine di
/// una nota cancellata è la cartella dove si lavora — il ripristino sotto un
/// altro nome le porta via lo stato per-documento, storia del versioning
/// compresa, perché `restore_from_trash` lo migra dall'`original` che il sidecar
/// dichiara.
// 1. Fub cestina la prima: il sidecar ricorda `progetti/`.
// 2. Un'altra app distrugge quella voce dal cestino. Il sidecar è roba di
#[test]
fn an_orphan_sidecar_does_not_speak_for_a_namesake() {
    let fx = Fixture::new();
    fx.put("projects/Idea.txt", "the first");
    let mut ws = fx.workspace();

    //    Fub, in `.fub/data/`: lei non lo conosce e lo lascia dov'è.
    let trashed = ws
        .delete_document(&DocId::new("projects/Idea.txt"))
        .unwrap();
    // 3. La stessa app cestina un'ALTRA nota che si chiama uguale.
    // Una copia di Fub più nuova ha cestinato la nota e ha scritto un sidecar
    std::fs::remove_file(fx.root.join(trashed.as_str())).unwrap();
    assert!(
        fx.exists(".fub/data/trash/Idea.txt.json"),
        "the sidecar was left behind"
    );
    // di uno schema che questa copia non sa leggere.
    fx.put(
        ".trash/Idea.txt",
        "the second, which has nothing to do with it",
    );

    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 1, "{entries:?}");
    assert_eq!(
        entries[0].original,
        DocId::new("Idea.txt"),
        "the second was never in projects/: without a sidecar **of its own** \
         it degrades to the root, like every entry trashed by another app"
    );
}

#[test]
fn a_sidecar_from_a_newer_fub_is_worth_no_sidecar_at_all() {
    let fx = Fixture::new();
    let ws = fx.workspace();
    // Il path d'origine è di nuovo occupato: il ripristino andrà altrove.
    // Lo stato per-documento (versioning, meta) vive sotto il path d'origine:
    fx.put(".trash/Idea.2026-07-24T15-30-00.txt", "from another era");
    fx.put(
        ".fub/data/trash/Idea.2026-07-24T15-30-00.txt.json",
        r#"{"v":99,"original":"projects/Idea.txt","folder":"which here cannot be read"}"#,
    );

    let entries = ws.list_trash().unwrap();
    assert_eq!(
        entries[0].original,
        DocId::new("Idea.txt"),
        "a version that is not known counts as no sidecar: it degrades to the \
         root instead of believing half of a file written by another era"
    );
}

#[test]
fn restoring_under_a_new_name_announces_the_identity_migration() {
    let fx = Fixture::new();
    fx.put("projects/Note.txt", "first life");
    let mut ws = fx.workspace();
    let trashed = ws
        .delete_document(&DocId::new("projects/Note.txt"))
        .unwrap();
    // chi lo tiene deve sapere che la chiave è migrata.
    ws.write_document(
        &DocId::new("projects/Note.txt"),
        "second life",
        WriteBase::Dictated,
    )
    .unwrap();

    let events = ws.bus().subscribe();
    let restored = ws
        .restore_from_trash(&trashed, Some(DocId::new("projects/Note 1.txt")))
        .unwrap();

    assert_eq!(restored, DocId::new("projects/Note 1.txt"));
    // Il `to` arriva dall'IPC: un path che risale deve essere rifiutato, non
    // scritto fuori dal vault con un DocId fantasma negli indici.
    assert!(events.try_iter().any(|n| n.event
        == Event::DocumentRenamed {
            from: DocId::new("projects/Note.txt"),
            to: DocId::new("projects/Note 1.txt"),
        }));
}

#[test]
fn emptying_the_trash_sweeps_the_sidecars_too() {
    let fx = Fixture::new();
    fx.put("projects/Note.txt", "body");
    let mut ws = fx.workspace();
    ws.delete_document(&DocId::new("projects/Note.txt"))
        .unwrap();
    assert!(
        data_root(&fx.root).join("trash").exists(),
        "the sidecar was written"
    );

    ws.empty_trash().unwrap();

    assert!(
        !data_root(&fx.root).join("trash").exists(),
        "empty trash = no sidecar to remember"
    );
}

#[test]
fn a_restore_target_cannot_escape_the_vault() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "an idea");
    let mut ws = fx.workspace();
    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();

    // Poco dopo il watcher riferisce che `Idea.txt` non c'è più (vero) e che in
    // `.trash/` è comparso qualcosa (vero, e non sono fatti suoi).
    let err = ws
        .restore_from_trash(&trashed, Some(DocId::new("../outside.txt")))
        .unwrap_err();
    assert!(err.to_string().contains("nome non valido"), "{err}");
    assert!(fx.exists(".trash/Idea.txt"), "the trash entry did not move");
    assert!(!fx.root.parent().unwrap().join("outside.txt").exists());
}

#[test]
fn the_watcher_seeing_the_file_vanish_does_not_do_the_work_twice() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "an idea");
    let mut ws = fx.workspace();

    ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    fx.calls.lock().unwrap().clear();

    // La seconda porta l'istante nel nome, prima dell'estensione: resta un .txt.
    // Il ripristino è una scrittura normale (D8): l'indice la riceve come
    assert!(!ws.sync_path(&fx.root.join("Idea.txt")).unwrap());
    assert!(!ws.sync_path(&fx.root.join(".trash/Idea.txt")).unwrap());
    assert!(fx.calls().is_empty(), "nothing to redo and nothing to undo");
    assert!(fx.exists(".trash/Idea.txt"));
}

#[test]
fn deleting_the_same_name_twice_never_overwrites_the_first_copy() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();

    ws.write_document(&DocId::new("Idea.txt"), "first draft", WriteBase::Dictated)
        .unwrap();
    ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    ws.write_document(&DocId::new("Idea.txt"), "second draft", WriteBase::Dictated)
        .unwrap();
    let second = ws.delete_document(&DocId::new("Idea.txt")).unwrap();

    assert_eq!(fx.trash_files().len(), 2, "two deletions, two copies");
    assert_eq!(
        fx.read(".trash/Idea.txt"),
        "first draft",
        "the first is intact"
    );
    assert_eq!(fx.read(second.as_str()), "second draft");
    // riceverebbe qualunque altra modifica, senza percorsi speciali.
    // Obsidian cestina così: file spostato in `.trash/`, nome intatto, nessun
    assert!(second.as_str().starts_with(".trash/Idea."));
    assert!(second.as_str().ends_with(".txt"));
}

#[test]
fn restoring_from_the_trash_brings_the_notes_back_everywhere() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "an idea");
    let mut ws = fx.workspace();

    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    fx.calls.lock().unwrap().clear();

    let brought_back = ws.restore_from_trash(&trashed, None).unwrap();

    assert_eq!(brought_back, DocId::new("Idea.txt"));
    assert_eq!(ws.documents(), vec![DocId::new("Idea.txt")]);
    assert_eq!(fx.read("Idea.txt"), "an idea");
    assert!(!fx.exists(".trash/Idea.txt"), "the trash let it go");
    // registro da nessuna parte. È tutto ciò su cui si può contare.
    // Il cestino resta piatto perché è quello di Obsidian (D1), ma il sidecar
    assert_eq!(fx.calls(), vec![Call::Indexed("Idea.txt".into())]);
}

#[test]
fn a_notes_trashed_by_obsidian_is_restorable_here() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    // ricorda la provenienza: il ripristino ricrea la cartella se serve. (Le
    // voci senza sidecar — cestinate da Obsidian — degradano alla radice.)
    fx.put(".trash/Old.txt", "written elsewhere");

    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].original, DocId::new("Old.txt"));

    let brought_back = ws.restore_from_trash(&entries[0].id, None).unwrap();
    assert_eq!(brought_back, DocId::new("Old.txt"));
    assert_eq!(fx.read("Old.txt"), "written elsewhere");
}

#[test]
fn a_notes_deleted_from_a_deep_folder_comes_back_to_it() {
    let fx = Fixture::new();
    fx.put("notes/2026/Idea.txt", "an idea");
    let mut ws = fx.workspace();

    let trashed = ws
        .delete_document(&DocId::new("notes/2026/Idea.txt"))
        .unwrap();
    let brought_back = ws.restore_from_trash(&trashed, None).unwrap();

    // È il chiamante a risolvere il conflitto scegliendo un nome: il kernel non
    // inventa nomi al posto dell'utente.
    // Una guardia applicativa non protegge ciò che arriva mentre il ripristino
    assert_eq!(brought_back, DocId::new("notes/2026/Idea.txt"));
    assert_eq!(fx.read("notes/2026/Idea.txt"), "an idea");
}

#[test]
fn restoring_onto_an_occupied_path_asks_instead_of_overwriting() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "the old one");
    let mut ws = fx.workspace();

    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    ws.write_document(
        &DocId::new("Idea.txt"),
        "a new note, same name",
        WriteBase::Dictated,
    )
    .unwrap();

    let err = ws.restore_from_trash(&trashed, None).unwrap_err();
    assert!(matches!(err, KernelError::AlreadyExists(_)), "found {err}");
    assert_eq!(fx.read("Idea.txt"), "a new note, same name", "intact");

    // legge e parsa la voce. Il supporto posa un concorrente al momento esatto
    // della mossa: deve restare intatto, e la voce deve restare nel cestino.
    let brought_back = ws
        .restore_from_trash(&trashed, Some(DocId::new("Idea (restored).txt")))
        .unwrap();
    assert_eq!(fx.read(brought_back.as_str()), "the old one");
}

/// 0058 — il ripristino è **una mossa sola**, e non c'è un istante in cui la
/// nota sta in due posti.
///
#[test]
fn whoever_occupies_the_destination_after_the_guard_is_not_buried() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "the trashed note");
    let storage = Arc::new(RefusingStorage {
        inner: FsStorage,
        refuses_remove_in: "never",
        occupies_destination: std::sync::atomic::AtomicBool::new(false),
    });
    let mut ws = fx.workspace_on(storage.clone());
    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    storage
        .occupies_destination
        .store(true, std::sync::atomic::Ordering::SeqCst);

    let result = ws.restore_from_trash(&trashed, None);

    assert!(
        matches!(result, Err(KernelError::AlreadyExists(_))),
        "the late collision must come back as such: {result:?}"
    );
    assert_eq!(fx.read("Idea.txt"), "concurrent");
    assert_eq!(fx.read(trashed.as_str()), "the trashed note");
}

/// Il guasto non si aspetta, si inietta: il supporto rifiuta le cancellazioni
/// dentro `.trash/`, cioè esattamente la seconda metà di uno «scrivi e poi
/// cancella». Con quella forma il banco è rosso — la nota è tornata **e** è
/// ancora nel cestino, e l'utente che ne modifica una ritrova l'altra. Con un
/// `rename` la seconda metà non esiste.
/// 0002 — dal cestino torna anche ciò che nessuno parsa.
///
/// `list_trash` elenca **tutti** i file apposta, allegati compresi (il cestino è
#[test]
fn a_restore_the_disk_interrupts_leaves_one_copy_not_two() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "an idea");
    let mut ws = fx.workspace_on(Arc::new(RefusingStorage {
        inner: FsStorage,
        refuses_remove_in: "/.trash/",
        occupies_destination: std::sync::atomic::AtomicBool::new(false),
    }));

    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    let result = ws.restore_from_trash(&trashed, None);

    let back = fx.exists("Idea.txt");
    let in_trash = fx.exists(".trash/Idea.txt");
    assert!(
        back != in_trash,
        "result {result:?}: back={back}, still in trash={in_trash} — \
         two copies of the same note are the worst of the two answers"
    );
}

/// condiviso con Obsidian, D1). Pretendere un provider — o che i byte siano
/// UTF-8 — per restituirne uno sarebbe il difetto, ed è la stessa ragione per
/// cui `rename_entry_in_batch` non lo pretende.
// E il vault la **vede**: un allegato ripristinato che l'anagrafe non
// conosce ricompare solo alla prossima apertura.
/// Le voci dell'anagrafe di una specie, come le chiede la shell.
#[test]
fn an_attachment_comes_back_from_the_trash_like_a_notes() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    let png = [0x89u8, b'P', b'N', b'G', 0x0D, 0x00, 0xFF];
    fx.put_bytes(".trash/photo.png", &png);

    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 1, "the trash lists it: {entries:?}");
    let brought_back = ws
        .restore_from_trash(&entries[0].id, None)
        .expect("an attachment comes back from the trash like a note");

    assert_eq!(brought_back, DocId::new("photo.png"));
    assert_eq!(fx.read_bytes("photo.png"), png, "byte for byte");
    assert!(!fx.exists(".trash/photo.png"), "the trash let it go");
    // 0157 (ripreso) — una voce senza sidecar al censimento non e ancora
    // distruttibile.
    let store = entries_of_kind(&ws, EntryKind::Asset);
    assert_eq!(
        store
            .iter()
            .map(|and| and.id.to_string())
            .collect::<Vec<_>>(),
        vec!["photo.png".to_string()]
    );
}

fn entries_of_kind(ws: &Workspace, of_kind: EntryKind) -> Vec<VaultEntry> {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind: Some(of_kind),
            within: None,
            page: None,
        })
        .expect("the kernel serves the entry store")
    else {
        panic!("expected the entry store");
    };
    page.items
}

#[test]
fn emptying_the_trash_says_how_much_it_destroyed() {
    let fx = Fixture::new();
    fx.put("One.txt", "first");
    fx.put("Two.txt", "second");
    let mut ws = fx.workspace();

    ws.delete_document(&DocId::new("One.txt")).unwrap();
    ws.delete_document(&DocId::new("Two.txt")).unwrap();
    assert_eq!(ws.list_trash().unwrap().len(), 2);

    assert_eq!(ws.empty_trash().unwrap(), 2);
    assert!(ws.list_trash().unwrap().is_empty());
    assert!(!fx.exists(".trash/One.txt"));
}

/// `trash` rinomina prima il file e scrive il sidecar dopo. Questa banca prova
/// ferma un'altra finestra esattamente fra le due operazioni: la vecchia
/// `rename` dell'intero cestino la includeva e la distruggeva.
/// Uno sweep globale dei sidecar non deve cancellare il metadato di una voce
/// arrivata dopo il censimento dei file da distruggere.
// E il cestino non è nemmeno stato creato: nessun effetto collaterale.
#[test]
fn an_entry_without_sidecar_at_catalogue_time_is_not_destroyed() {
    let fx = Fixture::new();
    fx.put("One.txt", "first");
    fx.put("Two.txt", "second");
    let mut ws = fx.workspace();

    ws.delete_document(&DocId::new("One.txt")).unwrap();
    ws.delete_document(&DocId::new("Two.txt")).unwrap();
    fx.put(".trash/Arrived.txt", "trashed, sidecar not yet written");
    assert!(!fx.exists(".fub/data/trash/Arrived.txt.json"));

    assert_eq!(
        ws.empty_trash().unwrap(),
        2,
        "only the entries already complete at catalogue time are counted"
    );
    assert!(
        fx.exists(".trash/Arrived.txt"),
        "the entry with the rename completed but without sidecar was not destroyed"
    );
}

// Date diverse le impone il filesystem via mtime; qui bastano due file
// scritti a mano con nomi già timbrati, come li lascerebbe una sessione
#[test]
fn the_sidecar_arrived_during_emptying_is_kept() {
    let fx = Fixture::new();
    fx.put("One.txt", "first");
    fx.put("Two.txt", "second");
    let storage = Arc::new(TrashMidSweep {
        inner: FsStorage,
        root: fx.root.clone(),
        already_arrived: std::sync::atomic::AtomicBool::new(false),
    });
    let mut ws = fx.workspace_on(storage);

    ws.delete_document(&DocId::new("One.txt")).unwrap();
    ws.delete_document(&DocId::new("Two.txt")).unwrap();
    assert_eq!(ws.empty_trash().unwrap(), 2);

    let remaining = ws.list_trash().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, DocId::new(".trash/Arrived.txt"));
    assert_eq!(remaining[0].original, DocId::new("projects/Arrived.txt"));
    assert!(fx.exists(".fub/data/trash/Arrived.txt.json"));
}

#[test]
fn deleting_a_notes_the_workspace_never_saw_is_an_error_not_a_shrug() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();

    let err = ws.delete_document(&DocId::new("Ghost.txt")).unwrap_err();
    assert!(matches!(err, KernelError::NotFound(_)), "found {err}");
    // precedente.
    assert!(!fx.exists(".trash"));
}

#[test]
fn the_trash_lists_the_most_recent_first() {
    let fx = Fixture::new();
    // 0208 — **una nota cestinata non lascia la bozza dietro di sé.**
    //
    // La bozza è indicizzata per `DocId`, e cestinare cambia il `DocId`: il testo
    fx.put(".trash/One.2026-07-24T10-00-00.txt", "first");
    fx.put(".trash/Two.txt", "second");
    let ws = fx.workspace();

    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(
        entries[0].deleted_at >= entries[1].deleted_at,
        "most recent"
    );
    let originals: Vec<String> = entries.iter().map(|and| and.original.to_string()).collect();
    assert!(
        originals.contains(&"One.txt".to_string()),
        "the stamp is not part of the name"
    );
    assert!(originals.contains(&"Two.txt".to_string()));
}

/// non salvato restava sotto la chiave vecchia, che dopo la cancellazione non
/// nomina più niente. Non era un residuo innocuo — `recuperaBozze` all'avvio
/// ripesca ogni bozza e la rimette in un buffer **sporco**, quindi la prima
/// scrittura che passa di lì riscrive sul disco una nota che l'utente aveva
/// chiesto di buttare: una cancellazione confermata che si disfa da sola.
///
/// La bozza muore col documento, come il buffer sporco che la shell chiude
/// insieme alla nota: non è una perdita silenziosa, è il gesto che l'utente ha
/// appena confermato.
/// L'altra metà, e senza di lei la riparazione diventa «ogni sparizione butta
/// la bozza»: un file che se ne va **per mano d'altri** — un `rm` da terminale,
/// un sync, un'altra app — non è una cancellazione confermata da nessuno, ed è
#[test]
fn a_trashed_notes_does_not_leave_its_draft() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "an idea");
    let mut ws = fx.workspace();
    let id = DocId::new("Idea.txt");
    ws.save_draft(&id, "the idea I was still writing", None)
        .unwrap();
    assert_eq!(
        drafts(&ws),
        vec!["Idea.txt".to_string()],
        "the bench starts from a draft that exists"
    );

    ws.delete_document(&id).unwrap();

    assert!(
        drafts(&ws).is_empty(),
        "the draft stayed under the key of a trashed note: the startup recovery \
         puts it back in a dirty buffer and the note rises from the dead"
    );
}

/// precisamente il momento in cui la bozza è l'unica copia di ciò che si era
/// scritto. Quel percorso è `remove_document`, non `delete_document`, e la
/// bozza deve restare dov'è.
// Il `rm` di qualcun altro, e il watcher che passa di lì subito dopo.
/// I documenti che hanno una bozza, per nome.
/// bozza deve restare dov'è.
#[test]
fn a_file_vanished_from_outside_leaves_the_draft_where_it_is() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "an idea");
    let mut ws = fx.workspace();
    let id = DocId::new("Idea.txt");
    ws.save_draft(&id, "the only copy of what I had written", None)
        .unwrap();

    // Il `rm` di qualcun altro, e il watcher che passa di lì subito dopo.
    std::fs::remove_file(fx.root.join("Idea.txt")).unwrap();
    ws.sync_path(&fx.root.join("Idea.txt")).unwrap();

    assert_eq!(
        drafts(&ws),
        vec!["Idea.txt".to_string()],
        "the draft was thrown away together with a file the user did not ask \
         to delete: it was the only copy of its text"
    );
}

/// I documenti che hanno una bozza, per nome.
fn drafts(ws: &Workspace) -> Vec<String> {
    ws.drafts()
        .expect("drafts")
        .drafts
        .into_iter()
        .map(|b| b.doc.to_string())
        .collect()
}
