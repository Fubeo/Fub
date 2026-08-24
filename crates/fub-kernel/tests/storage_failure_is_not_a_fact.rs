//! **Un errore di lettura non diventa mai un fatto del vault.**
//!
//! Cinque punti del kernel prendevano un `Result` del supporto e lo
//! degradavano a una risposta di dominio: «non è un symlink», «il registro è
//! vuoto», «non ci sono bozze», «la base non combacia», «cancellato». Erano
//! cinque file diversi e un difetto solo, perché la domanda che quel `.ok()`
//! poneva è legittima — *c'era qualcosa lì?* — e ciò che non è legittimo è
//! rispondere anche a tutte le altre: un permesso negato, un disco che sta
//! fallendo, un nome troppo lungo non sono un'assenza.
//!
//! La guardia è una — [`fub_kernel::error::se_c_e`], che rende `Ok(None)` solo
//! per l'assenza e lascia risalire il resto col suo tipo — quindi il presidio è
//! uno: un supporto che dice di no su `read`, `list` e `remove`, e un banco per
//! punto che pretende l'errore invece del fatto falso.
//!
//! Il rifiuto si accende **dopo** l'apertura: un supporto che nega dal primo
//! istante non fa nascere il vault su cui la domanda si pone.

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_kernel::storage::{DirEntry, FileNames, FsStorage, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, KernelError, MachineSettings, Workspace};
use fub_testkit::SampleText;

/// Un supporto che fa tutto come il disco, e su certi path **dice di no**.
///
/// Non «non c'è»: `PermissionDenied`, cioè l'errore che un `.ok()` non ha il
/// diritto di leggere come un'assenza. L'elenco dei path rifiutati si riempie a
/// vault aperto, perché è il momento in cui un disco comincia a fallire.
struct RejectingStorage {
    inner: FsStorage,
    rejects: Arc<Mutex<Vec<String>>>,
    invalid_names: Arc<Mutex<Vec<String>>>,
}

type FailureNames = Arc<Mutex<Vec<String>>>;

impl RejectingStorage {
    fn new() -> (Arc<Self>, FailureNames, FailureNames) {
        let rejects = Arc::new(Mutex::new(Vec::new()));
        let invalid_names = Arc::new(Mutex::new(Vec::new()));
        (
            Arc::new(RejectingStorage {
                inner: FsStorage,
                rejects: Arc::clone(&rejects),
                invalid_names: Arc::clone(&invalid_names),
            }),
            rejects,
            invalid_names,
        )
    }

    fn no(&self, path: &Utf8Path) -> Option<std::io::Error> {
        let rejects = self.rejects.lock().unwrap();
        let path = path.as_str().replace('\\', "/");
        rejects
            .iter()
            .any(|f| path.contains(&f.replace('\\', "/")))
            .then(|| {
                std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "il supporto non fa guardare",
                )
            })
    }

    fn invalid_name(&self, path: &Utf8Path) -> Option<std::io::Error> {
        let invalid_names = self.invalid_names.lock().unwrap();
        let path = path.as_str().replace('\\', "/");
        invalid_names
            .iter()
            .any(|name| path.contains(&name.replace('\\', "/")))
            .then(|| std::io::Error::from_raw_os_error(123))
    }
}

impl VaultStorage for RejectingStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        match self.invalid_name(path).or_else(|| self.no(path)) {
            Some(and) => Err(and),
            None => self.inner.read(path),
        }
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
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        match self.no(path) {
            Some(and) => Err(and),
            None => self.inner.remove(path),
        }
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        match self.no(dir) {
            Some(and) => Err(and),
            None => self.inner.list(dir),
        }
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        match self.invalid_name(path) {
            Some(and) => Err(and),
            None => self.inner.stat(path),
        }
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

struct Bench {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    rejects: Arc<Mutex<Vec<String>>>,
    invalid_names: Arc<Mutex<Vec<String>>>,
}

impl Bench {
    /// Un vault con dentro una nota, aperto su un supporto che ancora non nega
    /// niente.
    fn open() -> (Bench, Workspace) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Idea.txt"), "il testo di prima").expect("nota");
        let (storage, rejects, invalid_names) = RejectingStorage::new();
        let mut registry = FormatRegistry::new();
        registry
            .register(SampleText::by_extension("txt").boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::on(
            &root,
            registry,
            storage as Arc<dyn VaultStorage>,
            MachineSettings::in_memory(),
        )
        .expect("l'apertura del vault riesce");
        ws.reindex().expect("reindex");
        // Un plugin dichiarato serve a `with_host`: il kernel non presta
        // capacità a una stringa (§7.3).
        ws.register_core_feature("prova.plugin", "prova.plugin")
            .expect("dichiarato");
        (
            Bench {
                _dir: dir,
                root,
                rejects,
                invalid_names,
            },
            ws,
        )
    }

    /// Da adesso in poi, tutto ciò che nomina questo pezzo di path non si legge.
    fn rejects(&self, piece: &str) {
        self.rejects.lock().unwrap().push(piece.to_string());
    }

    fn windows_invalid_name(&self, piece: &str) {
        self.invalid_names.lock().unwrap().push(piece.to_string());
    }
}

/// 0156 — **come si scrive non si decide su una domanda che è fallita.**
///
/// `symlink_metadata(path).ok()` rispondeva «non c'è niente lì» a un permesso
/// negato, e da quella risposta dipende il ramo: `Nessuno` vuol dire
/// *sostituisci*, cioè una `rename` che stacca l'inode — e se lì sotto c'era un
/// symlink o un hardlink quel nome smette in silenzio di essere lo stesso file.
#[test]
fn a_write_not_chooses_the_path_from_a_read_failed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let notes = root.join("Idea.txt");
    std::fs::write(&notes, "prima").expect("nota");

    let outcome = FsStorage.write_with(
        &notes,
        b"seconda",
        true,
        |_| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "il supporto non fa guardare",
            ))
        },
        |_, _| FileNames::One,
    );

    assert_eq!(
        outcome
            .expect_err("chi non ha potuto guardare non decide")
            .kind(),
        std::io::ErrorKind::PermissionDenied,
        "l'errore risale con il suo tipo, invece di diventare «non c'era niente»"
    );
    assert_eq!(
        std::fs::read_to_string(&notes).expect("rilettura"),
        "prima",
        "e soprattutto non si è scritto sul ramo scelto al buio"
    );
}

/// 0164 — **un registro che non si legge non è un registro vuoto.**
///
/// Le due cose avevano la stessa risposta, e da lì l'annullamento non aveva
/// niente da disfare senza che nessuno dicesse perché.
#[test]
fn a_record_unreadable_not_and_a_record_empty() {
    let (bench, mut ws) = Bench::open();
    ws.write_document(
        &DocId::new("Idea.txt"),
        "una mutazione da registrare",
        WriteBase::Dictated,
    )
    .expect("scritta");
    assert!(
        !ws.journal().expect("registro").records.is_empty(),
        "prima del guasto il registro ha una storia"
    );

    bench.rejects("journal.jsonl");

    let error = ws.journal().expect_err("un guasto non è una storia vuota");
    assert!(
        matches!(&error, KernelError::Io { path, .. } if path.as_str().contains("journal.jsonl")),
        "e dice su quale file: {error}"
    );
}

/// 0166 — **una cartella di bozze che non si legge non è «nessuna bozza».**
///
/// È il punto in cui pesa di più: là dentro sta l'unica copia di ciò che
/// l'utente ha scritto e non ha salvato, e mostrarne zero è il primo passo
/// perché il salvataggio dopo ci scriva sopra.
#[test]
fn a_folder_of_drafts_unreadable_not_and_no_one_draft() {
    let (bench, mut ws) = Bench::open();
    ws.save_draft(&DocId::new("Idea.txt"), "quel che stavo scrivendo", None)
        .expect("bozza scritta");
    assert_eq!(
        ws.drafts().expect("bozze").drafts.len(),
        1,
        "prima del guasto la bozza c'è"
    );

    bench.rejects("/drafts");

    let error = ws.drafts().expect_err("un guasto non è una cartella vuota");
    assert!(
        matches!(&error, KernelError::Io { path, .. } if path.as_str().ends_with("drafts")),
        "e dice quale cartella: {error}"
    );
}

/// 0178 — **«non riesco a leggere la tua nota» non è «il documento è cambiato
/// sotto di te».**
///
/// L'unico dei cinque con un testo che l'utente legge: chi ha un disco che sta
/// fallendo riceveva la frase del conflitto, e un conflitto vero non si
/// distingueva da un supporto rotto.
#[test]
fn a_notes_that_not_is_reads_not_and_a_base_that_not_matches() {
    let (bench, mut ws) = Bench::open();
    let id = DocId::new("Idea.txt");
    let base = ws.document_revision(&id).expect("revisione");

    bench.rejects("Idea.txt");

    let error = ws
        .write_document(&id, "il testo nuovo", WriteBase::DescendsFrom(base))
        .expect_err("il supporto ha detto di no");
    assert!(
        !matches!(error, KernelError::Stale(_)),
        "un guasto del supporto non si racconta come un conflitto: {error}"
    );
    let said = error.to_string();
    assert!(
        said.contains("Idea.txt") && said.contains("I/O"),
        "e la frase dice cos'è successo e su cosa: {said}"
    );

    // La nota non è stata toccata: chi non ha potuto controllare non scrive.
    assert_eq!(
        std::fs::read_to_string(bench.root.join("Idea.txt")).expect("rilettura"),
        "il testo di prima"
    );
}

/// 0178, l'altra metà — **una base che davvero non combacia resta `Stale`.**
///
/// La riparazione stringe il ramo, non lo chiude: il file cestinato sotto i
/// piedi di chi scriveva continua a essere un conflitto, che è la risposta
/// giusta.
#[test]
fn a_base_that_not_matches_remains_a_conflict() {
    let (_bench, mut ws) = Bench::open();
    let id = DocId::new("Idea.txt");
    let old = Revision::of("un testo che non è mai stato sul disco");

    let error = ws
        .write_document(&id, "il testo nuovo", WriteBase::DescendsFrom(old))
        .expect_err("la base non combacia");
    assert!(matches!(error, KernelError::Stale(_)), "{error}");
}

/// 0193 — **un cestino svuotato a metà non è un cestino svuotato.**
///
/// I sidecar del cestino se ne vanno con un `remove_dir_all` il cui esito era
/// buttato: restavano indietro a nominare voci che non esistono più, e chi
/// aveva chiesto di svuotare sentiva dire che era andato tutto bene.
#[test]
fn a_trash_emptied_a_metadata_not_and_a_trash_emptied() {
    let (bench, mut ws) = Bench::open();
    ws.delete_document(&DocId::new("Idea.txt"))
        .expect("cestinata");

    bench.rejects("/data/trash/");

    let error = ws
        .empty_trash()
        .expect_err("ciò che è rimasto indietro si dice");
    assert!(
        matches!(&error, KernelError::Io { path, .. } if path.as_str().contains("trash")),
        "e dice cosa non si è tolto: {error}"
    );
}

// ---------------------------------------------------------------------------
// Il rovescio: un'assenza non è un guasto
// ---------------------------------------------------------------------------

/// 0221 — **chiedere un documento che non c'è è un «non trovato».**
///
/// Il contratto dichiara le due facce accanto e con ragioni diverse:
/// `not-found` è *«semmai qualcuno l'ha cancellato nel frattempo»*, `io` è
/// *«disco pieno, file in uso, cartella sparita sotto i piedi»* — e su questo
/// secondo *«chi riprova ha ragione di farlo»*. Una lettura di ciò che non
/// c'era rispondeva `io`, quindi chi automatizza riprovava per sempre una
/// lettura che non ha niente da ritrovare, e chi disegna scriveva «riprova»
/// dove il messaggio vero è «non esiste più».
///
/// La domanda si pone dove è già posta una volta sola — [`Assenza`], nata per
/// `se_c_e` — ma sull'altro lato: nella **traduzione verso il contratto**, non
/// dentro ogni capacità di lettura. Perciò il banco le prova tutte e quattro:
/// è la seconda prova della barra, e una capacità di lettura nuova la eredita
/// senza che nessuno se ne debba ricordare.
///
/// [`Assenza`]: fub_kernel::error::Assenza
#[test]
fn ask_a_document_that_not_c_and_and_a_not_found() {
    let (_bench, mut ws) = Bench::open();

    ws.with_host("prova.plugin", |host| {
        for name in [
            "mai-scritta.txt",
            "con\nnewline.md",
            "con*stella.md",
            "con?punto.md",
        ] {
            let absent = DocId::new(name);
            for (which, outcome) in [
                ("read_document", host.read_document(&absent).map(|_| ())),
                (
                    "read_document_bytes",
                    host.read_document_bytes(&absent).map(|_| ()),
                ),
                ("read_model", host.read_model(&absent).map(|_| ())),
                (
                    "document_revision",
                    host.document_revision(&absent).map(|_| ()),
                ),
            ] {
                let and = outcome.expect_err("il documento non c'è");
                assert!(
                    matches!(and, PluginError::NotFound(_)),
                    "`{which}` su `{name:?}` deve dire «non trovato», e \
                     non «errore di I/O»: {and:?}"
                );
                assert!(
                    and.message().to_string().contains(name),
                    "e deve nominare ciò che non ha trovato: {and}"
                );
            }
        }
    });
}

/// Windows reports an absent illegal component as `ERROR_INVALID_NAME` (123),
/// which Rust exposes as `Other`, not `NotFound`. The kernel must still keep
/// the plugin contract stable for both text and byte reads.
#[test]
fn windows_invalid_name_from_stat_and_read_is_not_found() {
    let (bench, mut ws) = Bench::open();
    for name in ["con\nnewline.txt", "con*stella.txt", "con?punto.txt"] {
        bench.windows_invalid_name(name);
        let id = DocId::new(name);
        ws.with_host("prova.plugin", |host| {
            assert!(matches!(
                host.read_document(&id),
                Err(PluginError::NotFound(_))
            ));
            assert!(matches!(
                host.read_document_bytes(&id),
                Err(PluginError::NotFound(_))
            ));
        });
    }
}

/// Un nome non portabile che esiste davvero è un import, non un'assenza:
/// la pre-verifica del path non deve impedirne la lettura.
#[cfg(unix)]
#[test]
fn an_existing_nonportable_import_is_still_readable() {
    let (bench, mut ws) = Bench::open();
    let id = DocId::new("con*stella.txt");
    std::fs::write(bench.root.join(id.as_str()), "arrivato da fuori").unwrap();

    ws.with_host("prova.plugin", |host| {
        assert_eq!(host.read_document(&id).unwrap(), "arrivato da fuori");
    });
}

/// La metà che tiene onesta la riparazione: **un supporto che nega resta un
/// guasto.**
///
/// Chi nega non ha detto «non c'è», ha detto «non ti faccio guardare», e la
/// nota c'è ancora. Se anche questo diventasse `not-found`, chi legge
/// smetterebbe di riprovare proprio dove riprovare è la mossa giusta — cioè lo
/// stesso difetto scritto dall'altro capo, che è il verso che tutto questo file
/// presidia.
#[test]
fn a_support_that_denies_remains_a_fault_and_not_a_absence() {
    let (bench, mut ws) = Bench::open();
    let id = DocId::new("Idea.txt");

    bench.rejects("Idea.txt");

    ws.with_host("prova.plugin", |host| {
        let and = host.read_document(&id).expect_err("il supporto nega");
        assert!(
            !matches!(and, PluginError::NotFound(_)),
            "un permesso negato non è un'assenza: la nota c'è ancora — {and:?}"
        );
    });
}
