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
use fub_testkit::TestoDiProva;

/// Un supporto che fa tutto come il disco tranne **una** mossa, che rifiuta.
///
/// È il punto d'iniezione che un crash a metà non ha: non si aspetta che il
/// processo muoia fra due scritture, si prende la seconda e la si fa fallire.
struct SupportoCheRifiuta {
    inner: FsStorage,
    /// Le `remove` di un path che contiene questo pezzo falliscono.
    rifiuta_remove_in: &'static str,
}

impl VaultStorage for SupportoCheRifiuta {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<fub_kernel::storage::Stat> {
        self.inner.write(path, bytes)
    }
    fn update(
        &self,
        path: &Utf8Path,
        fondi: fub_kernel::storage::Fusione<'_>,
    ) -> std::io::Result<()> {
        self.inner.update(path, fondi)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        if path.as_str().contains(self.rifiuta_remove_in) {
            return Err(std::io::Error::other("il supporto ha detto di no"));
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

/// Scrive una nuova voce completa quando lo svuotamento rimuove la prima voce
/// gia censita: simula un'altra finestra fra distruzione dei file e sweep dei
/// sidecar.
struct SupportoCheCestinaNelMezzo {
    inner: FsStorage,
    root: Utf8PathBuf,
    gia_arrivata: std::sync::atomic::AtomicBool,
}

impl VaultStorage for SupportoCheCestinaNelMezzo {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }
    fn update(
        &self,
        path: &Utf8Path,
        fondi: fub_kernel::storage::Fusione<'_>,
    ) -> std::io::Result<()> {
        self.inner.update(path, fondi)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        if !self
            .gia_arrivata
            .swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            self.inner
                .write(&self.root.join(".trash/Arrivata.txt"), b"cestinata adesso")
                .expect("l'altra finestra cestina");
            self.inner
                .write(
                    &self.root.join(".fub/data/trash/Arrivata.txt.json"),
                    br#"{"v":1,"original":"progetti/Arrivata.txt"}"#,
                )
                .expect("l'altra finestra scrive il sidecar");
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
    /// Una spia che guarda passare i documenti e non risponde a niente: adesso
    /// lo **dichiara** invece di dirlo con un `BadArgs` a ogni domanda.
    fn routes(&self) -> Vec<fub_abi::traits::QueryRoute> {
        Vec::new()
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    /// Una voce **per documento** anche se il lotto è la grana della chiamata:
    /// qui si assertisce *quali* documenti sono passati, non quanti lotti.
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
        Err(PluginError::Unserved("la spia non serve niente".into()))
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

    /// Scrive un file **fuori** dal workspace: è quel che fa un altro programma
    /// (o Obsidian) mentre Fub guarda altrove.
    fn put(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    /// Come [`put`](Fixture::put), per un file che **non è testo**.
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
        std::fs::read(self.root.join(rel)).expect("lettura")
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).expect("lettura")
    }

    fn workspace(&self) -> Workspace {
        self.workspace_su(Arc::new(FsStorage))
    }

    /// Lo stesso workspace, sul **supporto passato**: è così che si interrompe
    /// una mutazione a metà senza aspettare niente.
    fn workspace_su(&self, storage: Arc<dyn VaultStorage>) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(TestoDiProva::per_estensione("txt").boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::on(&self.root, registry, storage, MachineSettings::in_memory())
            .expect("l'apertura del vault riesce");
        // I plugin di prova si dichiarano prima di registrare (§7.3): il
        // kernel non presta capacità a una stringa.
        ws.register_core_feature("test.spia", "test.spia")
            .expect("dichiarato");
        ws.register_index_provider("test.spia", Box::new(SpyIndex(self.calls.clone())))
            .expect("attivazione");
        ws.reindex().expect("reindex");
        self.calls.lock().unwrap().clear();
        ws
    }

    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    /// I file dentro `.trash/`, per nome e ordinati.
    fn trash_files(&self) -> Vec<String> {
        let dir = self.root.join(".trash");
        if !dir.exists() {
            return Vec::new();
        }
        let mut out: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        out.sort();
        out
    }
}

#[test]
fn deleting_a_note_moves_it_to_the_trash_and_tells_the_index() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "un'idea");
    let mut ws = fx.workspace();
    let events = ws.bus().subscribe();

    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();

    assert_eq!(trashed, DocId::new(".trash/Idea.txt"));
    assert!(!fx.exists("Idea.txt"), "il file ha lasciato il suo posto");
    assert_eq!(
        fx.read(".trash/Idea.txt"),
        "un'idea",
        "e non è stato distrutto"
    );
    assert!(ws.documents().is_empty());
    // L'indice deve saperlo, o la nota resta cercabile: un risultato che apre
    // il nulla è peggio di nessun risultato.
    assert_eq!(fx.calls(), vec![Call::Removed("Idea.txt".into())]);
    assert!(events.try_iter().any(|n| n.event
        == Event::DocumentRemoved {
            id: DocId::new("Idea.txt")
        }));
}

#[test]
fn a_note_trashed_from_a_folder_returns_to_its_folder() {
    let fx = Fixture::new();
    fx.put("progetti/Nota.txt", "in cartella");
    let mut ws = fx.workspace();

    let trashed = ws
        .delete_document(&DocId::new("progetti/Nota.txt"))
        .unwrap();

    // Il cestino resta piatto (D1, interop Obsidian)…
    assert!(trashed.as_str().starts_with(".trash/"));
    assert!(!trashed.as_str().contains("progetti"));
    // …ma il sidecar ricorda da dove veniva, e il ripristino torna lì.
    let entries = ws.list_trash().unwrap();
    assert_eq!(entries[0].original, DocId::new("progetti/Nota.txt"));
    let restored = ws.restore_from_trash(&trashed, None).unwrap();
    assert_eq!(restored, DocId::new("progetti/Nota.txt"));
    assert_eq!(fx.read("progetti/Nota.txt"), "in cartella");
}

#[test]
fn a_foreign_trash_entry_degrades_to_the_stamped_name_in_the_root() {
    let fx = Fixture::new();
    let ws = fx.workspace();
    // Obsidian (o un'altra epoca di Fub) cestina senza sidecar.
    fx.put(".trash/Idea.2026-07-24T15-30-00.txt", "di altri");

    let entries = ws.list_trash().unwrap();
    assert_eq!(
        entries[0].original,
        DocId::new("Idea.txt"),
        "senza sidecar si torna al comportamento di prima: nome de-timbrato in radice"
    );
}

#[test]
fn the_trash_sidecar_carries_its_schema_version() {
    let fx = Fixture::new();
    fx.put("progetti/Nota.txt", "in cartella");
    let mut ws = fx.workspace();

    let trashed = ws
        .delete_document(&DocId::new("progetti/Nota.txt"))
        .unwrap();

    // §15.3: il numero sta **dentro** il file, perché è il file a sopravvivere
    // alla versione di Fub che l'ha scritto.
    let name = trashed.as_str().rsplit('/').next().unwrap();
    let sidecar = fx.read(&format!(".fub/data/trash/{name}.json"));
    let json: serde_json::Value = serde_json::from_str(&sidecar).expect("è JSON");
    assert_eq!(json["v"], 1, "il sidecar dichiara il suo schema");
    assert_eq!(json["original"], "progetti/Nota.txt");
    // E **di quale file** parla: senza, la chiave (il nome della voce) lo
    // renderebbe valido anche per il prossimo omonimo.
    assert_eq!(
        json["file"]["size"], 11,
        "il timbro del file cestinato: {json}"
    );
    assert!(json["file"]["mtime"].is_number(), "{json}");
}

/// Un sidecar scritto prima che il timbro esistesse resta buono.
///
/// **Verde per costruzione**: era il comportamento di prima e lo è ancora, ed è
/// scritto qui perché è una scelta, non un residuo — lo schema non è cambiato di
/// numero apposta (vedi `TrashSidecar::file`), e il giorno che qualcuno rendesse
/// il timbro obbligatorio farebbe tornare in radice ogni nota già nel cestino di
/// chi aggiorna, senza che nessun altro banco se ne accorga.
#[test]
fn a_sidecar_written_before_the_stamp_existed_is_still_believed() {
    let fx = Fixture::new();
    let ws = fx.workspace();
    fx.put(".trash/Idea.txt", "cestinata da una Fub di prima");
    fx.put(
        ".fub/data/trash/Idea.txt.json",
        r#"{"v":1,"original":"progetti/Idea.txt"}"#,
    );

    let voci = ws.list_trash().unwrap();
    assert_eq!(voci.len(), 1);
    assert_eq!(voci[0].original, DocId::new("progetti/Idea.txt"));
}

/// L'mtime di una nota, in secondi UNIX, imposto a mano: è l'unico modo di
/// avere una nota **vecchia** senza aspettare.
fn invecchia(fx: &Fixture, rel: &str, secs: u64) {
    let file = std::fs::File::options()
        .write(true)
        .open(fx.root.join(rel))
        .expect("apertura");
    let quando = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs);
    file.set_times(std::fs::FileTimes::new().set_modified(quando))
        .expect("mtime");
}

fn adesso_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// 0131 — **la data di cancellazione non è l'ultima scrittura della nota**.
///
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
#[test]
fn la_data_di_cancellazione_non_e_l_ultima_scrittura_della_nota() {
    const CAPODANNO_2020: u64 = 1_577_869_200;

    let fx = Fixture::new();
    fx.put("progetti/Idea.txt", "scritta molto tempo fa");
    invecchia(&fx, "progetti/Idea.txt", CAPODANNO_2020);
    let mut ws = fx.workspace();

    let prima = adesso_secs();
    ws.delete_document(&DocId::new("progetti/Idea.txt"))
        .expect("cestinata");

    let voci = ws.list_trash().unwrap();
    assert_eq!(voci.len(), 1);
    assert!(
        voci[0].deleted_at >= prima,
        "cancellata adesso, non nel {}: deleted_at = {}",
        CAPODANNO_2020,
        voci[0].deleted_at
    );
    // E l'ordine, che è la conseguenza che si vede: la nota vecchia appena
    // buttata sta **sopra** una cestinata prima di lei ma scritta di recente.
    // Con la data presa dall'mtime le due si invertivano, perché «di recente»
    // voleva dire *scritta* di recente.
    fx.put(".trash/Altra.txt", "cestinata da Obsidian un'ora fa");
    invecchia(&fx, ".trash/Altra.txt", prima - 3600);
    let voci = ws.list_trash().unwrap();
    assert_eq!(voci.len(), 2);
    assert_eq!(
        voci[0].id,
        DocId::new(".trash/Idea.txt"),
        "dal più recente, e la più recente è quella cancellata per ultima"
    );
}

/// L'altra metà, che è la migrazione: **una voce che il campo non ce l'ha
/// degrada a ciò che si vedeva prima**.
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
#[test]
fn una_voce_senza_la_data_nel_sidecar_resta_datata_dal_disco() {
    const CAPODANNO_2020: u64 = 1_577_869_200;

    let fx = Fixture::new();
    // Il sidecar di una Fub che il campo non lo scriveva ancora.
    fx.put(".trash/Idea.txt", "cestinata da una Fub di prima");
    invecchia(&fx, ".trash/Idea.txt", CAPODANNO_2020);
    fx.put(
        ".fub/data/trash/Idea.txt.json",
        r#"{"v":1,"original":"progetti/Idea.txt"}"#,
    );
    // E una voce di Obsidian, che sidecar non ne ha affatto.
    fx.put(".trash/Altra.txt", "cestinata da Obsidian");
    invecchia(&fx, ".trash/Altra.txt", CAPODANNO_2020);

    let ws = fx.workspace();
    let voci = ws.list_trash().unwrap();
    assert_eq!(voci.len(), 2);
    for voce in &voci {
        assert_eq!(voce.deleted_at, CAPODANNO_2020, "{}", voce.id);
    }
    // E il path d'origine continua a valere quel che valeva.
    let idea = voci.iter().find(|v| v.id.as_str().ends_with("Idea.txt"));
    assert_eq!(idea.expect("c'è").original, DocId::new("progetti/Idea.txt"));
}

/// 0004 — un sidecar rimasto indietro **non parla per l'omonima**.
///
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
#[test]
fn an_orphan_sidecar_does_not_speak_for_a_namesake() {
    let fx = Fixture::new();
    fx.put("progetti/Idea.txt", "la prima");
    let mut ws = fx.workspace();

    // 1. Fub cestina la prima: il sidecar ricorda `progetti/`.
    let cestinata = ws
        .delete_document(&DocId::new("progetti/Idea.txt"))
        .unwrap();
    // 2. Un'altra app distrugge quella voce dal cestino. Il sidecar è roba di
    //    Fub, in `.fub/data/`: lei non lo conosce e lo lascia dov'è.
    std::fs::remove_file(fx.root.join(cestinata.as_str())).unwrap();
    assert!(
        fx.exists(".fub/data/trash/Idea.txt.json"),
        "il sidecar è rimasto indietro"
    );
    // 3. La stessa app cestina un'ALTRA nota che si chiama uguale.
    fx.put(".trash/Idea.txt", "la seconda, che non c'entra niente");

    let voci = ws.list_trash().unwrap();
    assert_eq!(voci.len(), 1, "{voci:?}");
    assert_eq!(
        voci[0].original,
        DocId::new("Idea.txt"),
        "la seconda non è mai stata in progetti/: senza un sidecar **suo** \
         degrada alla radice, come ogni voce cestinata da un'altra app"
    );
}

#[test]
fn a_sidecar_from_a_newer_fub_is_worth_no_sidecar_at_all() {
    let fx = Fixture::new();
    let ws = fx.workspace();
    // Una copia di Fub più nuova ha cestinato la nota e ha scritto un sidecar
    // di uno schema che questa copia non sa leggere.
    fx.put(".trash/Idea.2026-07-24T15-30-00.txt", "di un'altra epoca");
    fx.put(
        ".fub/data/trash/Idea.2026-07-24T15-30-00.txt.json",
        r#"{"v":99,"original":"progetti/Idea.txt","cartella":"che qui non si sa leggere"}"#,
    );

    let entries = ws.list_trash().unwrap();
    assert_eq!(
        entries[0].original,
        DocId::new("Idea.txt"),
        "una versione che non si conosce vale come un sidecar che non c'è: si degrada \
         alla radice invece di credere a metà di un file scritto da un'altra epoca"
    );
}

#[test]
fn restoring_under_a_new_name_announces_the_identity_migration() {
    let fx = Fixture::new();
    fx.put("progetti/Nota.txt", "prima vita");
    let mut ws = fx.workspace();
    let trashed = ws
        .delete_document(&DocId::new("progetti/Nota.txt"))
        .unwrap();
    // Il path d'origine è di nuovo occupato: il ripristino andrà altrove.
    ws.write_document(
        &DocId::new("progetti/Nota.txt"),
        "seconda vita",
        WriteBase::Dictated,
    )
    .unwrap();

    let events = ws.bus().subscribe();
    let restored = ws
        .restore_from_trash(&trashed, Some(DocId::new("progetti/Nota 1.txt")))
        .unwrap();

    assert_eq!(restored, DocId::new("progetti/Nota 1.txt"));
    // Lo stato per-documento (versioning, meta) vive sotto il path d'origine:
    // chi lo tiene deve sapere che la chiave è migrata.
    assert!(events.try_iter().any(|n| n.event
        == Event::DocumentRenamed {
            from: DocId::new("progetti/Nota.txt"),
            to: DocId::new("progetti/Nota 1.txt"),
        }));
}

#[test]
fn emptying_the_trash_sweeps_the_sidecars_too() {
    let fx = Fixture::new();
    fx.put("progetti/Nota.txt", "corpo");
    let mut ws = fx.workspace();
    ws.delete_document(&DocId::new("progetti/Nota.txt"))
        .unwrap();
    assert!(
        data_root(&fx.root).join("trash").exists(),
        "il sidecar è stato scritto"
    );

    ws.empty_trash().unwrap();

    assert!(
        !data_root(&fx.root).join("trash").exists(),
        "cestino vuoto = nessun sidecar da ricordare"
    );
}

#[test]
fn a_restore_target_cannot_escape_the_vault() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "un'idea");
    let mut ws = fx.workspace();
    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();

    // Il `to` arriva dall'IPC: un path che risale deve essere rifiutato, non
    // scritto fuori dal vault con un DocId fantasma negli indici.
    let err = ws
        .restore_from_trash(&trashed, Some(DocId::new("../fuori.txt")))
        .unwrap_err();
    assert!(err.to_string().contains("nome non valido"), "{err}");
    assert!(
        fx.exists(".trash/Idea.txt"),
        "la voce del cestino non si è mossa"
    );
    assert!(!fx.root.parent().unwrap().join("fuori.txt").exists());
}

#[test]
fn the_watcher_seeing_the_file_vanish_does_not_do_the_work_twice() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "un'idea");
    let mut ws = fx.workspace();

    ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    fx.calls.lock().unwrap().clear();

    // Poco dopo il watcher riferisce che `Idea.txt` non c'è più (vero) e che in
    // `.trash/` è comparso qualcosa (vero, e non sono fatti suoi).
    assert!(!ws.sync_path(&fx.root.join("Idea.txt")).unwrap());
    assert!(!ws.sync_path(&fx.root.join(".trash/Idea.txt")).unwrap());
    assert!(
        fx.calls().is_empty(),
        "niente da rifare e niente da disfare"
    );
    assert!(fx.exists(".trash/Idea.txt"));
}

#[test]
fn deleting_the_same_name_twice_never_overwrites_the_first_copy() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();

    ws.write_document(
        &DocId::new("Idea.txt"),
        "prima stesura",
        WriteBase::Dictated,
    )
    .unwrap();
    ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    ws.write_document(
        &DocId::new("Idea.txt"),
        "seconda stesura",
        WriteBase::Dictated,
    )
    .unwrap();
    let seconda = ws.delete_document(&DocId::new("Idea.txt")).unwrap();

    assert_eq!(fx.trash_files().len(), 2, "due cancellazioni, due copie");
    assert_eq!(
        fx.read(".trash/Idea.txt"),
        "prima stesura",
        "la prima è intatta"
    );
    assert_eq!(fx.read(seconda.as_str()), "seconda stesura");
    // La seconda porta l'istante nel nome, prima dell'estensione: resta un .txt.
    assert!(seconda.as_str().starts_with(".trash/Idea."));
    assert!(seconda.as_str().ends_with(".txt"));
}

#[test]
fn restoring_from_the_trash_brings_the_note_back_everywhere() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "un'idea");
    let mut ws = fx.workspace();

    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    fx.calls.lock().unwrap().clear();

    let tornata = ws.restore_from_trash(&trashed, None).unwrap();

    assert_eq!(tornata, DocId::new("Idea.txt"));
    assert_eq!(ws.documents(), vec![DocId::new("Idea.txt")]);
    assert_eq!(fx.read("Idea.txt"), "un'idea");
    assert!(
        !fx.exists(".trash/Idea.txt"),
        "il cestino l'ha lasciata andare"
    );
    // Il ripristino è una scrittura normale (D8): l'indice la riceve come
    // riceverebbe qualunque altra modifica, senza percorsi speciali.
    assert_eq!(fx.calls(), vec![Call::Indexed("Idea.txt".into())]);
}

#[test]
fn a_note_trashed_by_obsidian_is_restorable_here() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    // Obsidian cestina così: file spostato in `.trash/`, nome intatto, nessun
    // registro da nessuna parte. È tutto ciò su cui si può contare.
    fx.put(".trash/Vecchia.txt", "scritta altrove");

    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].original, DocId::new("Vecchia.txt"));

    let tornata = ws.restore_from_trash(&entries[0].id, None).unwrap();
    assert_eq!(tornata, DocId::new("Vecchia.txt"));
    assert_eq!(fx.read("Vecchia.txt"), "scritta altrove");
}

#[test]
fn a_note_deleted_from_a_deep_folder_comes_back_to_it() {
    let fx = Fixture::new();
    fx.put("appunti/2026/Idea.txt", "un'idea");
    let mut ws = fx.workspace();

    let trashed = ws
        .delete_document(&DocId::new("appunti/2026/Idea.txt"))
        .unwrap();
    let tornata = ws.restore_from_trash(&trashed, None).unwrap();

    // Il cestino resta piatto perché è quello di Obsidian (D1), ma il sidecar
    // ricorda la provenienza: il ripristino ricrea la cartella se serve. (Le
    // voci senza sidecar — cestinate da Obsidian — degradano alla radice.)
    assert_eq!(tornata, DocId::new("appunti/2026/Idea.txt"));
    assert_eq!(fx.read("appunti/2026/Idea.txt"), "un'idea");
}

#[test]
fn restoring_onto_an_occupied_path_asks_instead_of_overwriting() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "la vecchia");
    let mut ws = fx.workspace();

    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    ws.write_document(
        &DocId::new("Idea.txt"),
        "una nuova nota, stesso nome",
        WriteBase::Dictated,
    )
    .unwrap();

    let err = ws.restore_from_trash(&trashed, None).unwrap_err();
    assert!(
        matches!(err, KernelError::AlreadyExists(_)),
        "trovato {err}"
    );
    assert_eq!(
        fx.read("Idea.txt"),
        "una nuova nota, stesso nome",
        "intatta"
    );

    // È il chiamante a risolvere il conflitto scegliendo un nome: il kernel non
    // inventa nomi al posto dell'utente.
    let tornata = ws
        .restore_from_trash(&trashed, Some(DocId::new("Idea (ripristinata).txt")))
        .unwrap();
    assert_eq!(fx.read(tornata.as_str()), "la vecchia");
}

/// 0058 — il ripristino è **una mossa sola**, e non c'è un istante in cui la
/// nota sta in due posti.
///
/// Il guasto non si aspetta, si inietta: il supporto rifiuta le cancellazioni
/// dentro `.trash/`, cioè esattamente la seconda metà di uno «scrivi e poi
/// cancella». Con quella forma il banco è rosso — la nota è tornata **e** è
/// ancora nel cestino, e l'utente che ne modifica una ritrova l'altra. Con un
/// `rename` la seconda metà non esiste.
#[test]
fn a_restore_the_disk_interrupts_leaves_one_copy_not_two() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "un'idea");
    let mut ws = fx.workspace_su(Arc::new(SupportoCheRifiuta {
        inner: FsStorage,
        rifiuta_remove_in: "/.trash/",
    }));

    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    let esito = ws.restore_from_trash(&trashed, None);

    let tornata = fx.exists("Idea.txt");
    let nel_cestino = fx.exists(".trash/Idea.txt");
    assert!(
        tornata != nel_cestino,
        "esito {esito:?}: tornata={tornata}, ancora nel cestino={nel_cestino} — \
         due copie della stessa nota sono la peggiore delle due risposte"
    );
}

/// 0002 — dal cestino torna anche ciò che nessuno parsa.
///
/// `list_trash` elenca **tutti** i file apposta, allegati compresi (il cestino è
/// condiviso con Obsidian, D1). Pretendere un provider — o che i byte siano
/// UTF-8 — per restituirne uno sarebbe il difetto, ed è la stessa ragione per
/// cui `rename_entry_in_batch` non lo pretende.
#[test]
fn an_attachment_comes_back_from_the_trash_like_a_note() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    let png = [0x89u8, b'P', b'N', b'G', 0x0D, 0x00, 0xFF];
    fx.put_bytes(".trash/foto.png", &png);

    let voci = ws.list_trash().unwrap();
    assert_eq!(voci.len(), 1, "il cestino la elenca: {voci:?}");
    let tornata = ws
        .restore_from_trash(&voci[0].id, None)
        .expect("un allegato torna dal cestino come una nota");

    assert_eq!(tornata, DocId::new("foto.png"));
    assert_eq!(fx.read_bytes("foto.png"), png, "byte per byte");
    assert!(
        !fx.exists(".trash/foto.png"),
        "il cestino l'ha lasciata andare"
    );
    // E il vault la **vede**: un allegato ripristinato che l'anagrafe non
    // conosce ricompare solo alla prossima apertura.
    let anagrafe = entries_di_specie(&ws, EntryKind::Asset);
    assert_eq!(
        anagrafe
            .iter()
            .map(|e| e.id.to_string())
            .collect::<Vec<_>>(),
        vec!["foto.png".to_string()]
    );
}

/// Le voci dell'anagrafe di una specie, come le chiede la shell.
fn entries_di_specie(ws: &Workspace, of_kind: EntryKind) -> Vec<VaultEntry> {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind: Some(of_kind),
            within: None,
            page: None,
        })
        .expect("il kernel serve l'anagrafe")
    else {
        panic!("attesa l'anagrafe");
    };
    page.items
}

#[test]
fn emptying_the_trash_says_how_much_it_destroyed() {
    let fx = Fixture::new();
    fx.put("Uno.txt", "primo");
    fx.put("Due.txt", "secondo");
    let mut ws = fx.workspace();

    ws.delete_document(&DocId::new("Uno.txt")).unwrap();
    ws.delete_document(&DocId::new("Due.txt")).unwrap();
    assert_eq!(ws.list_trash().unwrap().len(), 2);

    assert_eq!(ws.empty_trash().unwrap(), 2);
    assert!(ws.list_trash().unwrap().is_empty());
    assert!(!fx.exists(".trash/Uno.txt"));
}

/// 0157 (ripreso) — una voce senza sidecar al censimento non e ancora
/// distruttibile.
///
/// `trash` rinomina prima il file e scrive il sidecar dopo. Questa banca prova
/// ferma un'altra finestra esattamente fra le due operazioni: la vecchia
/// `rename` dell'intero cestino la includeva e la distruggeva.
#[test]
fn una_voce_senza_sidecar_al_censimento_non_viene_distrutta() {
    let fx = Fixture::new();
    fx.put("Uno.txt", "primo");
    fx.put("Due.txt", "secondo");
    let mut ws = fx.workspace();

    ws.delete_document(&DocId::new("Uno.txt")).unwrap();
    ws.delete_document(&DocId::new("Due.txt")).unwrap();
    fx.put(
        ".trash/Arrivata.txt",
        "cestinata, sidecar non ancora scritto",
    );
    assert!(!fx.exists(".fub/data/trash/Arrivata.txt.json"));

    assert_eq!(
        ws.empty_trash().unwrap(),
        2,
        "si contano solo le voci gia completate al censimento"
    );
    assert!(
        fx.exists(".trash/Arrivata.txt"),
        "la voce con la rename completata ma senza sidecar e stata distrutta"
    );
}

/// Uno sweep globale dei sidecar non deve cancellare il metadato di una voce
/// arrivata dopo il censimento dei file da distruggere.
#[test]
fn il_sidecar_arrivato_durante_lo_svuotamento_resta() {
    let fx = Fixture::new();
    fx.put("Uno.txt", "primo");
    fx.put("Due.txt", "secondo");
    let supporto = Arc::new(SupportoCheCestinaNelMezzo {
        inner: FsStorage,
        root: fx.root.clone(),
        gia_arrivata: std::sync::atomic::AtomicBool::new(false),
    });
    let mut ws = fx.workspace_su(supporto);

    ws.delete_document(&DocId::new("Uno.txt")).unwrap();
    ws.delete_document(&DocId::new("Due.txt")).unwrap();
    assert_eq!(ws.empty_trash().unwrap(), 2);

    let rimaste = ws.list_trash().unwrap();
    assert_eq!(rimaste.len(), 1);
    assert_eq!(rimaste[0].id, DocId::new(".trash/Arrivata.txt"));
    assert_eq!(rimaste[0].original, DocId::new("progetti/Arrivata.txt"));
    assert!(fx.exists(".fub/data/trash/Arrivata.txt.json"));
}

#[test]
fn deleting_a_note_the_workspace_never_saw_is_an_error_not_a_shrug() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();

    let err = ws.delete_document(&DocId::new("Fantasma.txt")).unwrap_err();
    assert!(matches!(err, KernelError::NotFound(_)), "trovato {err}");
    // E il cestino non è nemmeno stato creato: nessun effetto collaterale.
    assert!(!fx.exists(".trash"));
}

#[test]
fn the_trash_lists_the_most_recent_first() {
    let fx = Fixture::new();
    // Date diverse le impone il filesystem via mtime; qui bastano due file
    // scritti a mano con nomi già timbrati, come li lascerebbe una sessione
    // precedente.
    fx.put(".trash/Uno.2026-07-24T10-00-00.txt", "primo");
    fx.put(".trash/Due.txt", "secondo");
    let ws = fx.workspace();

    let entries = ws.list_trash().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(
        entries[0].deleted_at >= entries[1].deleted_at,
        "dal più recente"
    );
    let originali: Vec<String> = entries.iter().map(|e| e.original.to_string()).collect();
    assert!(
        originali.contains(&"Uno.txt".to_string()),
        "il timbro non fa parte del nome"
    );
    assert!(originali.contains(&"Due.txt".to_string()));
}

/// 0208 — **una nota cestinata non lascia la bozza dietro di sé.**
///
/// La bozza è indicizzata per `DocId`, e cestinare cambia il `DocId`: il testo
/// non salvato restava sotto la chiave vecchia, che dopo la cancellazione non
/// nomina più niente. Non era un residuo innocuo — `recuperaBozze` all'avvio
/// ripesca ogni bozza e la rimette in un buffer **sporco**, quindi la prima
/// scrittura che passa di lì riscrive sul disco una nota che l'utente aveva
/// chiesto di buttare: una cancellazione confermata che si disfa da sola.
///
/// La bozza muore col documento, come il buffer sporco che la shell chiude
/// insieme alla nota: non è una perdita silenziosa, è il gesto che l'utente ha
/// appena confermato.
#[test]
fn una_nota_cestinata_non_lascia_la_sua_bozza() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "un'idea");
    let mut ws = fx.workspace();
    let id = DocId::new("Idea.txt");
    ws.save_draft(&id, "l'idea che stavo ancora scrivendo", None)
        .unwrap();
    assert_eq!(
        bozze(&ws),
        vec!["Idea.txt".to_string()],
        "il banco parte da una bozza che c'è"
    );

    ws.delete_document(&id).unwrap();

    assert!(
        bozze(&ws).is_empty(),
        "la bozza è rimasta sotto la chiave di una nota cestinata: il recupero \
         all'avvio la rimette in un buffer sporco e la nota risorge"
    );
}

/// L'altra metà, e senza di lei la riparazione diventa «ogni sparizione butta
/// la bozza»: un file che se ne va **per mano d'altri** — un `rm` da terminale,
/// un sync, un'altra app — non è una cancellazione confermata da nessuno, ed è
/// precisamente il momento in cui la bozza è l'unica copia di ciò che si era
/// scritto. Quel percorso è `remove_document`, non `delete_document`, e la
/// bozza deve restare dov'è.
#[test]
fn un_file_sparito_da_fuori_lascia_la_bozza_dov_e() {
    let fx = Fixture::new();
    fx.put("Idea.txt", "un'idea");
    let mut ws = fx.workspace();
    let id = DocId::new("Idea.txt");
    ws.save_draft(&id, "l'unica copia di ciò che avevo scritto", None)
        .unwrap();

    // Il `rm` di qualcun altro, e il watcher che passa di lì subito dopo.
    std::fs::remove_file(fx.root.join("Idea.txt")).unwrap();
    ws.sync_path(&fx.root.join("Idea.txt")).unwrap();

    assert_eq!(
        bozze(&ws),
        vec!["Idea.txt".to_string()],
        "la bozza è stata buttata insieme a un file che l'utente non ha \
         chiesto di cancellare: era l'unica copia del suo testo"
    );
}

/// I documenti che hanno una bozza, per nome.
fn bozze(ws: &Workspace) -> Vec<String> {
    ws.drafts()
        .expect("bozze")
        .drafts
        .into_iter()
        .map(|b| b.doc.to_string())
        .collect()
}
