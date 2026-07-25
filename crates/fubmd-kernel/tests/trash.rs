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

use camino::Utf8PathBuf;
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::Event;
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::traits::{HostApi, IndexProvider, IndexQuery, IndexResult};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, KernelError, Workspace};

/// Provider minimo: il documento è il suo testo.
struct PlainProvider;

impl FormatProvider for PlainProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: "plain".into(),
            name: "Testo semplice (test)".into(),
            extensions: vec!["txt".into()],
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(&self, m: &DocumentModel, _o: &RenderOptions) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }

    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Call {
    Indexed(String),
    Removed(String),
}

struct SpyIndex(Arc<Mutex<Vec<Call>>>);

impl IndexProvider for SpyIndex {
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn on_document_indexed(&mut self, doc: &DocumentModel) {
        self.0
            .lock()
            .unwrap()
            .push(Call::Indexed(doc.id.to_string()));
    }
    fn on_document_removed(&mut self, id: &DocId) {
        self.0.lock().unwrap().push(Call::Removed(id.to_string()));
    }
    fn reconcile(&mut self, _ids: &[DocId]) {}
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn query(&self, _q: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::BadArgs("spia".into()))
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
    /// (o Obsidian) mentre FubMD guarda altrove.
    fn put(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn exists(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).expect("lettura")
    }

    fn workspace(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry.register(Box::new(PlainProvider));
        let mut ws = Workspace::new(&self.root, registry);
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
    assert!(events.try_iter().any(|e| e
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
    // Obsidian (o un'altra epoca di FubMD) cestina senza sidecar.
    fx.put(".trash/Idea.2026-07-24T15-30-00.txt", "di altri");

    let entries = ws.list_trash().unwrap();
    assert_eq!(
        entries[0].original,
        DocId::new("Idea.txt"),
        "senza sidecar si torna al comportamento di prima: nome de-timbrato in radice"
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
    ws.write_document(&DocId::new("progetti/Nota.txt"), "seconda vita")
        .unwrap();

    let events = ws.bus().subscribe();
    let restored = ws
        .restore_from_trash(&trashed, Some(DocId::new("progetti/Nota 1.txt")))
        .unwrap();

    assert_eq!(restored, DocId::new("progetti/Nota 1.txt"));
    // Lo stato per-documento (versioning, meta) vive sotto il path d'origine:
    // chi lo tiene deve sapere che la chiave è migrata.
    assert!(events.try_iter().any(|e| e
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
        fx.root.join(".fubmd-data/trash").exists(),
        "il sidecar è stato scritto"
    );

    ws.empty_trash().unwrap();

    assert!(
        !fx.root.join(".fubmd-data/trash").exists(),
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

    ws.write_document(&DocId::new("Idea.txt"), "prima stesura")
        .unwrap();
    ws.delete_document(&DocId::new("Idea.txt")).unwrap();
    ws.write_document(&DocId::new("Idea.txt"), "seconda stesura")
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
    ws.write_document(&DocId::new("Idea.txt"), "una nuova nota, stesso nome")
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
