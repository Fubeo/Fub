//! **Lo stesso contenuto** (D-3 (b), A-17, T101), dal workspace vero: le
//! risposte che il kernel dà a «c'è già un file di questo tipo con questi
//! byte?», con file veri in una cartella temporanea. I candidati vengono
//! dall'indice vivo del workspace, non da `.fub/data/entries.json`: un file
//! scritto o cambiato nella sessione si ritrova subito, e la domanda non scrive
//! mai la tabella. Ogni caso del piano ha il suo test.
//!
//! In fondo al file, il conteggio dei byte allocati dice che i byte in mano non
//! si copiano.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::fs;
use std::io;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use fub_kernel::same_content::{SameContent, UnknownReason, MAX_CANDIDATES};
use fub_kernel::storage::{DirEntry, FileIdentity, Merge, RootedFsStorage, Stat, VaultStorage};
use fub_kernel::time::Clock;
use fub_kernel::{data_root, FormatRegistry, MachineSettings, Workspace};
use serde_json::Value;

/// Un supporto che fa tutto come quello radicato, e può **intervenire** sulle
/// letture: rifiutare la lettura di un file, o riscriverlo subito dopo averne
/// letto i pezzi. È il modo di mettere un file a metà di un confronto, senza
/// tempi.
struct Interposed {
    inner: RootedFsStorage,
    /// I path le cui letture a pezzi falliscono.
    failing: Vec<Utf8PathBuf>,
    /// Alla prima lettura a pezzi di questo path, il file viene riscritto con
    /// questi byte.
    rewritten_after_read: Mutex<Option<(Utf8PathBuf, Vec<u8>)>>,
}

impl VaultStorage for Interposed {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
        self.inner.read(path)
    }

    fn read_pieces(&self, path: &Utf8Path, piece: &mut dyn FnMut(&[u8])) -> io::Result<()> {
        if self.failing.iter().any(|failing| failing == path) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "letto male di proposito",
            ));
        }
        self.inner.read_pieces(path, piece)?;
        let mut rewrite = self
            .rewritten_after_read
            .lock()
            .expect("il lucchetto di prova");
        if rewrite.as_ref().is_some_and(|(target, _)| target == path) {
            if let Some((target, bytes)) = rewrite.take() {
                fs::write(target, bytes)?;
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

impl Interposed {
    fn over(root: &Utf8Path) -> Self {
        Interposed {
            inner: RootedFsStorage::open(root).expect("radice"),
            failing: Vec::new(),
            rewritten_after_read: Mutex::new(None),
        }
    }

    /// Alla prossima lettura a pezzi di `path`, il file diventa `bytes`.
    fn rewrite_after_next_read(&self, path: Utf8PathBuf, bytes: &[u8]) {
        *self
            .rewritten_after_read
            .lock()
            .expect("il lucchetto di prova") = Some((path, bytes.to_vec()));
    }
}

fn root_of(dir: &tempfile::TempDir) -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("una cartella temporanea è UTF-8")
}

/// Scrive un file e lo porta nel passato: la regola *racily clean* non
/// scarterebbe la sua impronta, e il test guarda la domanda, non il tempo.
fn put(root: &Utf8Path, rel: &str, bytes: &[u8]) {
    put_aged(root, rel, bytes, 3600);
}

/// [`put`] con un'età esplicita, in secondi: due scritture della stessa misura
/// con età diverse hanno date diverse.
fn put_aged(root: &Utf8Path, rel: &str, bytes: &[u8], seconds: u64) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().expect("un file ha una cartella")).expect("cartella");
    fs::write(&path, bytes).expect("scrittura del file");
    let past = SystemTime::now() - Duration::from_secs(seconds);
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .expect("apertura del file")
        .set_modified(past)
        .expect("data nel passato");
}

/// Il workspace del vault, aperto e scansionato: l'indice vivo c'è. Nessun
/// formato registrato, quindi la scansione non legge i `.md` e i `.bin`: le
/// loro impronte le calcola la domanda.
fn open(root: &Utf8Path) -> Workspace {
    let mut workspace = Workspace::new(root, FormatRegistry::new()).expect("apertura");
    workspace.reindex().expect("scansione");
    workspace
}

/// [`open`] su un supporto che interviene sulle letture.
fn open_on(root: &Utf8Path, storage: Arc<Interposed>) -> Workspace {
    let mut workspace = Workspace::on(
        root,
        FormatRegistry::new(),
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("apertura");
    workspace.reindex().expect("scansione");
    workspace
}

/// La domanda come la fa l'host: i candidati sotto il lucchetto, il confronto
/// fuori, le impronte imparate riportate all'indice.
fn ask(workspace: &mut Workspace, target: &str, bytes: &[u8]) -> SameContent {
    let prepared = workspace.prepare_same_content(&DocId::new(target), bytes.len() as u64);
    let outcome = prepared.invoke(bytes);
    workspace.learn_fingerprints(outcome.learned);
    outcome.answer
}

fn table_path(root: &Utf8Path) -> Utf8PathBuf {
    data_root(root).join("entries.json")
}

/// L'impronta che la tabella porta per `rel`, guardando l'ultimo record che la
/// riguarda.
fn recorded_fingerprint(root: &Utf8Path, rel: &str) -> Option<String> {
    let raw = fs::read(table_path(root)).expect("la tabella esiste");
    let mut current = None;
    for line in raw
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let record: Value = serde_json::from_slice(line).expect("una riga valida");
        match record["op"].as_str() {
            Some("snapshot") => {
                current = record["entries"][rel]["fingerprint"]
                    .as_str()
                    .map(str::to_owned);
            }
            Some("upsert") if record["id"] == rel => {
                current = record["entry"]["fingerprint"].as_str().map(str::to_owned);
            }
            Some("remove") if record["id"] == rel => current = None,
            _ => {}
        }
    }
    current
}

fn found(rel: &str) -> SameContent {
    SameContent::Found {
        id: DocId::new(rel),
    }
}

fn unknown(reason: UnknownReason) -> SameContent {
    SameContent::Unknown { reason }
}

#[test]
fn a_file_with_the_same_bytes_is_found_under_another_name() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "originale.md", b"gli stessi byte");
    let mut workspace = open(&root);

    assert_eq!(
        ask(&mut workspace, "arrivi/nuovo.md", b"gli stessi byte"),
        found("originale.md")
    );
}

#[test]
fn the_same_size_with_other_bytes_is_not_the_same_content() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"aaaa");
    let mut workspace = open(&root);

    // Il controllo positivo: i byte giusti trovano il file, così il no che segue
    // non è un no qualunque.
    assert_eq!(ask(&mut workspace, "b.md", b"aaaa"), found("a.md"));
    assert_eq!(ask(&mut workspace, "b.md", b"bbbb"), SameContent::NotFound);
}

#[test]
fn a_file_written_in_the_session_is_found_at_once() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "nota.md", b"# nota\n");
    let mut workspace = open(&root);
    let photo = b"\x89PNG una foto nuova";
    assert_eq!(
        ask(&mut workspace, "foto.bin", photo),
        SameContent::NotFound
    );

    // Il file nasce dopo l'apertura: la tabella su disco non lo conosce, l'indice
    // vivo sì, appena il rilevatore glielo dice.
    put(&root, "allegati/foto.bin", photo);
    assert!(workspace
        .sync_path(&root.join("allegati/foto.bin"))
        .expect("sincronizzazione"));

    assert_eq!(
        ask(&mut workspace, "allegati/foto 1.bin", photo),
        found("allegati/foto.bin")
    );
}

#[test]
fn only_a_file_with_the_same_extension_is_a_candidate() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "nota.md", b"ciao\n");
    put(&root, "LICENSE", b"mit\n");
    let mut workspace = open(&root);

    assert_eq!(
        ask(&mut workspace, "nota.txt", b"ciao\n"),
        SameContent::NotFound,
        "un .txt uguale a una nota non è quella nota"
    );
    assert_eq!(
        ask(&mut workspace, "Copia.MD", b"ciao\n"),
        found("nota.md"),
        "maiuscole e minuscole non contano"
    );
    assert_eq!(
        ask(&mut workspace, "COPYING", b"mit\n"),
        found("LICENSE"),
        "senza estensione trova solo un file senza estensione"
    );
    assert_eq!(
        ask(&mut workspace, "licenza.md", b"mit\n"),
        SameContent::NotFound
    );
}

#[test]
fn an_empty_content_is_never_found() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "vuota.md", b"");
    put(&root, "vuoto.csv", b"");
    let mut workspace = open(&root);

    assert_eq!(ask(&mut workspace, "dati.csv", b""), SameContent::NotFound);
    assert_eq!(ask(&mut workspace, "altra.md", b""), SameContent::NotFound);
}

#[test]
fn an_index_that_has_not_scanned_does_not_know() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"stessi");
    let mut workspace = Workspace::new(&root, FormatRegistry::new()).expect("apertura");

    assert_eq!(
        ask(&mut workspace, "b.md", b"stessi"),
        unknown(UnknownReason::IndexNotReady)
    );
    workspace.reindex().expect("scansione");
    assert_eq!(ask(&mut workspace, "b.md", b"stessi"), found("a.md"));
}

#[test]
fn the_trash_is_not_a_candidate() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // «.trash» viene prima di «vivo» per percorso: se il cestino contasse, la
    // risposta sarebbe lui. La risposta è «vivo», che ha gli stessi byte.
    put(&root, ".trash/vecchio.md", b"stessi byte");
    put(&root, "vivo.md", b"stessi byte");
    let mut workspace = open(&root);

    assert_eq!(
        ask(&mut workspace, "x.md", b"stessi byte"),
        found("vivo.md")
    );
}

#[test]
fn the_metadata_folder_is_not_a_candidate() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, ".fub/nascosto.md", b"stessi byte");
    put(&root, "vivo.md", b"stessi byte");
    let mut workspace = open(&root);

    assert_eq!(
        ask(&mut workspace, "x.md", b"stessi byte"),
        found("vivo.md")
    );
}

#[test]
fn a_file_in_an_excluded_folder_is_not_a_candidate() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    fs::write(root.join(".gitignore"), "escluso/\n").expect("gitignore");
    put(&root, "escluso/nota.md", b"stessi byte");
    put(&root, "vivo.md", b"stessi byte");
    let mut workspace = open(&root);

    assert_eq!(
        ask(&mut workspace, "x.md", b"stessi byte"),
        found("vivo.md")
    );
}

#[test]
fn the_candidates_are_compared_up_to_sixty_four_and_past_that_the_answer_is_unknown() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    for i in 0..MAX_CANDIDATES {
        put(&root, &format!("f{i:03}.md"), format!("x{i:03}").as_bytes());
    }
    let mut workspace = open(&root);
    assert_eq!(ask(&mut workspace, "z.md", b"zzzz"), SameContent::NotFound);

    // Uno in più, nato nella sessione: l'indice vivo lo conta subito.
    let extra = format!("f{MAX_CANDIDATES:03}.md");
    put(&root, &extra, b"yyyy");
    workspace
        .sync_path(&root.join(&extra))
        .expect("sincronizzazione");
    assert_eq!(
        ask(&mut workspace, "z.md", b"zzzz"),
        unknown(UnknownReason::TooManyCandidates {
            found: MAX_CANDIDATES + 1
        })
    );
    // Gli stessi byte con un'altra estensione non sono candidati: il limite
    // conta solo i file dello stesso tipo.
    assert_eq!(ask(&mut workspace, "z.bin", b"zzzz"), SameContent::NotFound);
}

#[test]
fn among_duplicates_the_first_by_path_is_the_answer() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "b.md", b"doppio");
    put(&root, "a.md", b"doppio");
    let mut workspace = open(&root);

    assert_eq!(ask(&mut workspace, "c.md", b"doppio"), found("a.md"));
}

#[test]
fn a_file_changed_while_it_is_read_is_no_match_and_records_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // «a.md» si cambia mentre lo si legge; «b.md» ha gli stessi byte e non si
    // tocca. La risposta è «b.md», e ad «a.md» non si registra niente.
    put(&root, "a.md", b"vecchio");
    put(&root, "b.md", b"vecchio");
    let storage = Arc::new(Interposed::over(&root));
    let mut workspace = open_on(&root, Arc::clone(&storage));
    storage.rewrite_after_next_read(root.join("a.md"), b"molto piu lungo di prima");

    assert_eq!(ask(&mut workspace, "c.md", b"vecchio"), found("b.md"));
    workspace.store_entries();
    assert_eq!(
        recorded_fingerprint(&root, "a.md"),
        None,
        "un file cambiato a metà non lascia un'impronta"
    );
    assert_eq!(
        recorded_fingerprint(&root, "b.md"),
        Some(Revision::of_bytes(b"vecchio").0)
    );
}

#[test]
fn a_file_rewritten_right_after_it_is_compared_is_no_match() {
    // Il confronto dei byte riesce: il file ha esattamente i byte cercati. Subito
    // dopo, prima della risposta, lo si riscrive più lungo. Un file cambiato mentre
    // lo si confronta non è una risposta: si salta, e la domanda dice «no». Il solo
    // confronto dei byte direbbe «sì».
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"stesso");
    let storage = Arc::new(Interposed::over(&root));
    let mut workspace = open_on(&root, Arc::clone(&storage));
    // La prima domanda impara l'impronta: dalla seconda il confronto dei byte è la
    // sola lettura.
    assert_eq!(
        ask(&mut workspace, "b.md", b"altro!"),
        SameContent::NotFound
    );
    storage.rewrite_after_next_read(root.join("a.md"), b"molto piu lungo di prima");

    assert_eq!(
        ask(&mut workspace, "b.md", b"stesso"),
        SameContent::NotFound
    );
}

#[test]
fn a_fingerprint_that_no_longer_describes_the_file_is_not_believed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // La voce impara l'impronta di «vecchio», con la data di allora. Il file cambia
    // a parità di misura, con altri byte e un'altra data, senza che l'indice lo
    // sappia: quell'impronta non lo descrive più, e non si crede. Si rifà dai
    // byte, e il file c'è.
    put(&root, "a.md", b"vecchio");
    let mut workspace = open(&root);
    assert_eq!(ask(&mut workspace, "b.md", b"vecchio"), found("a.md"));
    put_aged(&root, "a.md", b"novita!", 7200);

    assert_eq!(ask(&mut workspace, "b.md", b"novita!"), found("a.md"));
}

#[test]
fn a_candidate_that_cannot_be_read_is_skipped() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"doppio");
    put(&root, "b.md", b"doppio");
    let storage = Arc::new(Interposed {
        failing: vec![root.join("a.md")],
        ..Interposed::over(&root)
    });
    let mut workspace = open_on(&root, storage);

    assert_eq!(ask(&mut workspace, "c.md", b"doppio"), found("b.md"));
}

#[cfg(unix)]
#[test]
fn a_symlink_is_not_followed_wherever_it_points() {
    let dir = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("tempdir fuori dal vault");
    let root = root_of(&dir);
    put(&root, "vero.md", b"stessi byte");
    let outside_file = root_of(&outside).join("fuori.md");
    fs::write(&outside_file, b"stessi byte").expect("file fuori");
    // Un collegamento relativo dentro il vault, e uno assoluto fuori: vengono
    // prima di «vero.md» per percorso. Se si seguissero, la risposta sarebbe uno
    // di loro.
    std::os::unix::fs::symlink("vero.md", root.join("dentro.md")).expect("link");
    std::os::unix::fs::symlink(&outside_file, root.join("fuori.md")).expect("link");
    let mut workspace = open(&root);

    assert_eq!(
        ask(&mut workspace, "x.md", b"stessi byte"),
        found("vero.md")
    );
    assert_eq!(
        fs::read(&outside_file).expect("il file fuori"),
        b"stessi byte",
        "il file fuori dal vault non si tocca"
    );
}

#[test]
fn a_fingerprint_computed_for_a_candidate_reaches_the_table_through_the_entry_store() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"ciao!");
    let mut workspace = open(&root);
    assert_eq!(recorded_fingerprint(&root, "a.md"), None);
    let before = fs::read(table_path(&root)).expect("la tabella");

    assert_eq!(ask(&mut workspace, "b.md", b"altr!"), SameContent::NotFound);
    assert_eq!(
        fs::read(table_path(&root)).expect("la tabella"),
        before,
        "la domanda non scrive la tabella: la scrive solo l'anagrafe"
    );

    // L'impronta vive nell'indice, e l'anagrafe la porta sul disco quando scrive.
    workspace.store_entries();
    assert_eq!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"ciao!").0),
        "l'impronta calcolata sul file di oggi si registra"
    );
}

#[test]
fn a_write_of_the_index_while_a_fingerprint_is_learned_is_not_rolled_back() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    let mut workspace = open(&root);

    // La domanda legge «a.md» fuori dal lucchetto e ne calcola l'impronta…
    let prepared = workspace.prepare_same_content(&DocId::new("b.md"), 4);
    let outcome = prepared.invoke(b"zzzz");
    assert_eq!(outcome.answer, SameContent::NotFound);
    assert!(!outcome.learned.is_empty());

    // …intanto il file cambia, e il rilevatore lo dice all'indice.
    put_aged(&root, "a.md", b"efgh", 7200);
    assert!(workspace
        .sync_path(&root.join("a.md"))
        .expect("sincronizzazione"));

    // L'impronta di prima non vale più per la voce di adesso: non si tiene.
    assert_eq!(workspace.learn_fingerprints(outcome.learned), 0);
    workspace.store_entries();
    assert_ne!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"abcd").0),
        "la voce non torna all'impronta del file di prima"
    );
    assert_eq!(ask(&mut workspace, "b.md", b"abcd"), SameContent::NotFound);
    assert_eq!(ask(&mut workspace, "b.md", b"efgh"), found("a.md"));
}

#[test]
fn a_file_replaced_with_the_same_size_and_date_teaches_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    let mut workspace = open(&root);
    // Un altro file prende il posto di «a.md» senza che il rilevatore lo dica:
    // stessa misura, stessa data, ma è un altro file (un'altra identità, un
    // altro timbro di cambiamento). La voce dell'indice, e la riga
    // dell'anagrafe, descrivono ancora quello di prima.
    replace_keeping_the_date(&root, "a.md", b"efgh");

    // La domanda legge il file nuovo, e ne calcola l'impronta…
    let outcome = workspace
        .prepare_same_content(&DocId::new("b.md"), 4)
        .invoke(b"zzzz");
    assert_eq!(outcome.answer, SameContent::NotFound);
    assert!(!outcome.learned.is_empty());
    // …ma la voce non è di quel file: l'impronta non le si attacca, o
    // l'anagrafe certificherebbe i metadati del file di prima con i byte di
    // quello nuovo.
    assert_eq!(
        workspace.learn_fingerprints(outcome.learned),
        0,
        "un file sostituito con la stessa misura e la stessa data non insegna"
    );
    // I byte decidono ancora: il file nuovo si ritrova.
    assert_eq!(ask(&mut workspace, "b.md", b"efgh"), found("a.md"));
}

/// Mette al posto di `rel` un altro file con questi byte e la data di quello di
/// prima, senza dirlo a nessuno: un'altra identità, un altro timbro.
fn replace_keeping_the_date(root: &Utf8Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    let mtime = fs::metadata(&path)
        .expect("il file")
        .modified()
        .expect("data");
    let other = root.join("sostituto.tmp");
    fs::write(&other, bytes).expect("il file nuovo");
    fs::OpenOptions::new()
        .write(true)
        .open(&other)
        .expect("apertura")
        .set_modified(mtime)
        .expect("la stessa data");
    fs::rename(&other, &path).expect("sostituzione");
}

#[test]
fn a_file_replaced_after_the_question_teaches_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    let mut workspace = open(&root);

    // La domanda legge «a.md» fuori dal lucchetto e ne calcola l'impronta…
    let outcome = workspace
        .prepare_same_content(&DocId::new("b.md"), 4)
        .invoke(b"zzzz");
    assert!(!outcome.learned.is_empty());
    // …poi, prima che l'impronta torni, un altro file prende il suo posto con
    // la stessa misura e la stessa data: l'impronta letta non è la sua.
    replace_keeping_the_date(&root, "a.md", b"efgh");
    assert_eq!(workspace.learn_fingerprints(outcome.learned), 0);
    assert_eq!(ask(&mut workspace, "b.md", b"abcd"), SameContent::NotFound);
    assert_eq!(ask(&mut workspace, "b.md", b"efgh"), found("a.md"));
}

/// Un orologio fermo a un istante scelto dal test.
struct Stopped(u64);

impl Clock for Stopped {
    fn now_unix_millis(&self) -> u64 {
        self.0
    }
}

#[test]
fn the_instant_of_the_question_is_the_vault_clock() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");

    // Il controllo positivo: con l'orologio di sistema la data del file, di
    // un'ora fa, è nel passato, e l'impronta si impara.
    let mut workspace = open(&root);
    let outcome = workspace
        .prepare_same_content(&DocId::new("b.md"), 4)
        .invoke(b"zzzz");
    assert_eq!(outcome.answer, SameContent::NotFound);
    assert_eq!(workspace.learn_fingerprints(outcome.learned), 1);

    // Con l'orologio del vault fermo al 1970 la stessa data è nel futuro della
    // domanda: l'impronta potrebbe descrivere un file che cambia ancora nello
    // stesso istante, e non si impara.
    let mut workspace = open(&root).with_clock(Arc::new(Stopped(1_000)));
    let outcome = workspace
        .prepare_same_content(&DocId::new("b.md"), 4)
        .invoke(b"zzzz");
    assert_eq!(outcome.answer, SameContent::NotFound);
    assert_eq!(
        workspace.learn_fingerprints(outcome.learned),
        0,
        "l'istante della domanda viene dall'orologio del vault"
    );
}

thread_local! {
    /// Quanti byte ha chiesto al sistema questo thread: `cargo test` gira in
    /// parallelo, e un contatore condiviso misurerebbe il vicino di banco.
    static ALLOCATED: Cell<u64> = const { Cell::new(0) };
}

/// Passa tutto a `System` e conta i byte chiesti. Stesso schema di
/// `fub-features/tests/the_filter_does_not_allocate.rs`: il `const` nella TLS
/// evita che il primo accesso allochi dentro `alloc`, e il `try_with` copre un
/// thread che sta morendo.
struct Counter;

unsafe impl GlobalAlloc for Counter {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOCATED.try_with(|c| c.set(c.get() + layout.size() as u64));
        System.alloc(layout)
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let _ = ALLOCATED.try_with(|c| c.set(c.get() + new_size as u64));
        System.realloc(ptr, layout, new_size)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counter = Counter;

/// Il risultato di `f`, e quanti byte il thread ha chiesto mentre `f` girava.
fn allocated_by<T>(f: impl FnOnce() -> T) -> (T, u64) {
    let before = ALLOCATED.with(Cell::get);
    let value = f();
    (value, ALLOCATED.with(Cell::get) - before)
}

/// Otto MiB: una copia del contenuto ne chiederebbe otto. Un candidato letto a
/// pezzi ne chiede uno solo, il buffer di `read_in_pieces`.
const SIZE: usize = 8 * 1024 * 1024;

#[test]
fn the_bytes_in_hand_are_not_copied() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // Stessa misura, altri byte: il candidato si legge per l'impronta, e basta.
    put(&root, "altro.bin", &vec![b'b'; SIZE]);
    let mut workspace = open(&root);
    let wanted = vec![b'a'; SIZE];

    let (answer, in_hand) = allocated_by(|| ask(&mut workspace, "nuovo.bin", &wanted));
    assert_eq!(answer, SameContent::NotFound);
    assert!(
        in_hand < SIZE as u64 / 2,
        "con i byte in mano il thread ha chiesto {in_hand} byte: il contenuto è stato copiato"
    );

    // Il controllo: una copia del contenuto la misura la vede.
    let (copy, copied) = allocated_by(|| wanted.clone());
    assert_eq!(copy.len(), SIZE);
    assert!(
        copied >= SIZE as u64,
        "una copia avrebbe dovuto chiedere {SIZE} byte, ne ha chiesti {copied}"
    );
}

#[test]
fn the_bytes_in_hand_are_not_copied_when_the_candidate_matches() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    let wanted = vec![b'a'; SIZE];
    put(&root, "uguale.bin", &wanted);
    let mut workspace = open(&root);

    let (answer, in_hand) = allocated_by(|| ask(&mut workspace, "nuovo.bin", &wanted));
    assert_eq!(answer, found("uguale.bin"));
    assert!(
        in_hand < SIZE as u64 / 2,
        "con un candidato uguale il thread ha chiesto {in_hand} byte: il contenuto è stato copiato"
    );
}
