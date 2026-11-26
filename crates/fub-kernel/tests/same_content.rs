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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::FormatProvider;
use fub_kernel::same_content::{SameContent, UnknownReason, MAX_CANDIDATES};
use fub_kernel::storage::{
    DirEntry, FileIdentity, FileWitness, Merge, RootedFsStorage, Stat, VaultStorage,
};
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
    /// Quante domande di identità e di segno del cambio ha ricevuto.
    witness_questions: AtomicUsize,
    /// Il timbro di cambiamento è la data, come su FAT: una rinomina sopra
    /// non lo cambia, e un file nuovo con la data di prima ha il timbro di
    /// prima.
    stamp_is_the_date: bool,
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
        self.witness_questions.fetch_add(1, Ordering::SeqCst);
        self.inner.file_identity(path)
    }

    fn change_stamp(&self, path: &Utf8Path) -> io::Result<Option<u64>> {
        self.witness_questions.fetch_add(1, Ordering::SeqCst);
        if self.stamp_is_the_date {
            return Ok(Some(self.inner.stat(path)?.mtime));
        }
        self.inner.change_stamp(path)
    }

    /// Timbro e identità insieme sono **una** domanda, come per il supporto
    /// vero, che su Windows li legge da un handle solo.
    fn witness(&self, path: &Utf8Path) -> io::Result<FileWitness> {
        self.witness_questions.fetch_add(1, Ordering::SeqCst);
        let mut witness = self.inner.witness(path)?;
        if self.stamp_is_the_date {
            witness.change_stamp = Some(self.inner.stat(path)?.mtime);
        }
        Ok(witness)
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
            witness_questions: AtomicUsize::new(0),
            stamp_is_the_date: false,
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
    beyond_the_grain();
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
    beyond_the_grain();
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
fn a_fingerprint_learned_on_a_file_replaced_afterwards_is_not_believed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    beyond_the_grain();
    let mut workspace = open(&root);

    // La domanda legge «a.md» fuori dal lucchetto e ne calcola l'impronta, e
    // la consegna: la voce la tiene, col file su cui l'ha imparata…
    let outcome = workspace
        .prepare_same_content(&DocId::new("b.md"), 4)
        .invoke(b"zzzz");
    assert_eq!(workspace.learn_fingerprints(outcome.learned), 1);
    // …poi un altro file prende il suo posto con la stessa misura e la stessa
    // data, senza che il rilevatore lo dica: l'impronta non è la sua.
    replace_keeping_the_date(&root, "a.md", b"efgh");
    assert_eq!(ask(&mut workspace, "b.md", b"abcd"), SameContent::NotFound);
    assert_eq!(
        ask(&mut workspace, "b.md", b"efgh"),
        found("a.md"),
        "la domanda dopo vede che il file è un altro, e rilegge"
    );
}

#[test]
fn the_entry_store_does_not_certify_a_file_replaced_after_the_learning() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    beyond_the_grain();
    let mut workspace = open(&root);
    let outcome = workspace
        .prepare_same_content(&DocId::new("b.md"), 4)
        .invoke(b"zzzz");
    assert_eq!(workspace.learn_fingerprints(outcome.learned), 1);

    // Il file è sostituito senza evento, con la stessa misura e la stessa data;
    // poi l'anagrafe scrive la tabella col segno che il file ha adesso.
    replace_keeping_the_date(&root, "a.md", b"efgh");
    workspace.store_entries();
    assert_ne!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"abcd").0),
        "la riga col segno del file nuovo non porta l'impronta dei byte vecchi"
    );
    drop(workspace);

    // Riaperto, il vault non crede a un'impronta vecchia: i byte di prima non
    // ci sono, quelli di adesso sì.
    let mut reopened = open(&root);
    assert_ne!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"abcd").0)
    );
    assert_eq!(ask(&mut reopened, "b.md", b"abcd"), SameContent::NotFound);
    assert_eq!(ask(&mut reopened, "b.md", b"efgh"), found("a.md"));
}

#[test]
fn learning_under_the_lock_asks_the_storage_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    for n in 0..8 {
        put(
            &root,
            &format!("pila/{n}.bin"),
            format!("byte{n}").as_bytes(),
        );
    }
    beyond_the_grain();
    let storage = Arc::new(Interposed::over(&root));
    let mut workspace = open_on(&root, Arc::clone(&storage));

    let outcome = workspace
        .prepare_same_content(&DocId::new("nuovo.bin"), 5)
        .invoke(b"altro");
    assert_eq!(outcome.answer, SameContent::NotFound);
    // Segno e identità li ha presi la domanda, fuori dal lucchetto: dentro si
    // confronta soltanto.
    let before = storage.witness_questions.load(Ordering::SeqCst);
    assert_eq!(workspace.learn_fingerprints(outcome.learned), 8);
    assert_eq!(
        storage.witness_questions.load(Ordering::SeqCst),
        before,
        "nessuna domanda al supporto sotto il lucchetto esclusivo"
    );
}

/// Il workspace di `root` su un supporto che conta le domande, senza
/// scansione.
fn unscanned_on(root: &Utf8Path, storage: &Arc<Interposed>) -> Workspace {
    Workspace::on(
        root,
        FormatRegistry::new(),
        Arc::clone(storage) as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("apertura")
}

/// La scansione chiede il timbro del cambio **solo alle voci che l'anagrafe
/// potrebbe certificare**: su Windows chiederlo è aprire il file, e alla prima
/// apertura di un vault nessuna voce è nota (issue #493: cinquemila aperture
/// buttate sul vault da cinquemila file). Alla riapertura, invece, ogni voce
/// con la sua impronta lo chiede ancora: è il timbro che la smentisce quando
/// misura e data sono rimaste uguali.
#[test]
fn the_scan_asks_the_change_stamp_only_of_entries_it_could_certify() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    for n in 0..8 {
        put(
            &root,
            &format!("pila/{n}.bin"),
            format!("byte{n}").as_bytes(),
        );
    }

    beyond_the_grain();
    // La prima apertura: l'anagrafe è vuota, nessun timbro si chiede.
    let storage = Arc::new(Interposed::over(&root));
    let workspace = unscanned_on(&root, &storage);
    let before = storage.witness_questions.load(Ordering::SeqCst);
    drop(workspace.prepare_scan_vault().expect("scansione"));
    assert_eq!(
        storage.witness_questions.load(Ordering::SeqCst),
        before,
        "alla prima apertura nessuna voce è nota: nessun file si apre per il timbro"
    );
    drop(workspace);

    // L'anagrafe impara le otto impronte e le scrive.
    let mut workspace = open_on(&root, Arc::new(Interposed::over(&root)));
    let outcome = workspace
        .prepare_same_content(&DocId::new("nuovo.bin"), 5)
        .invoke(b"altro");
    assert_eq!(workspace.learn_fingerprints(outcome.learned), 8);
    workspace.store_entries();
    drop(workspace);

    // La riapertura: ogni voce certificabile chiede timbro e identità.
    let storage = Arc::new(Interposed::over(&root));
    let workspace = unscanned_on(&root, &storage);
    let before = storage.witness_questions.load(Ordering::SeqCst);
    drop(workspace.prepare_scan_vault().expect("scansione"));
    assert_eq!(
        storage.witness_questions.load(Ordering::SeqCst) - before,
        8,
        "alla riapertura timbro e identità si chiedono a ogni voce con la sua impronta, \
         con una domanda sola"
    );
}

/// **Un file messo al posto di un altro non eredita la sua riga**, anche
/// dove il timbro di cambiamento non lo distingue.
///
/// Su FAT il timbro è la data, e una rinomina sopra non lo tocca: il file
/// nuovo con la misura e la data di quello di prima ha anche il suo timbro.
/// Prima la riapertura guardava misura, data e timbro, e certificava il file
/// nuovo con l'impronta (e i metadati) di quello vecchio; adesso guarda anche
/// l'identità, con la stessa regola di ogni altro punto che lo decide.
#[test]
fn the_reopening_does_not_certify_a_file_renamed_over_with_the_same_stamp() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    let fat = || {
        Arc::new(Interposed {
            stamp_is_the_date: true,
            ..Interposed::over(&root)
        })
    };

    let mut workspace = open_on(&root, fat());
    let outcome = workspace
        .prepare_same_content(&DocId::new("b.md"), 4)
        .invoke(b"zzzz");
    assert_eq!(workspace.learn_fingerprints(outcome.learned), 1);
    workspace.store_entries();
    drop(workspace);
    assert_eq!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"abcd").0)
    );

    replace_keeping_the_date(&root, "a.md", b"efgh");
    let reopened = open_on(&root, fat());
    reopened.store_entries();
    assert_ne!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"abcd").0),
        "il file messo sopra non si certifica coi byte di quello di prima"
    );
}

/// Un formato di testo che è il suo testo: rende documenti i `.md`, così la
/// seconda fase dell'apertura li legge, come fa con le note vere.
struct Plain;

impl FormatProvider for Plain {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("semplice", "Testo semplice (test)", &["md"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

/// [`open_on`] con le note come documenti ([`Plain`]).
fn open_notes_on(root: &Utf8Path, storage: Arc<Interposed>) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(Plain)).expect("il formato");
    let mut workspace = Workspace::on(
        root,
        registry,
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("apertura");
    workspace.reindex().expect("scansione");
    workspace
}

/// **La riga porta il file che si è letto**, non quello che c'è quando la si
/// scrive.
///
/// La seconda fase legge la nota e ne tiene impronta e metadati; poi, senza
/// che il rilevatore lo dica, un altro file con la stessa misura e la stessa
/// data prende il suo posto. Dove il timbro è la data (FAT) il timbro non lo
/// distingue: prima la riga prendeva timbro e identità di adesso, cioè del
/// file nuovo, con l'impronta di quello letto, e la riapertura certificava il
/// file nuovo coi byte di quello vecchio. Adesso la voce ricorda il file da
/// cui ha l'impronta, e la riga di un file che nel frattempo è un altro non
/// la porta, né porta il timbro.
#[test]
fn the_row_does_not_give_the_file_read_the_identity_of_the_one_renamed_over_it() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    beyond_the_grain();
    let fat = || {
        Arc::new(Interposed {
            stamp_is_the_date: true,
            ..Interposed::over(&root)
        })
    };

    let workspace = open_notes_on(&root, fat());
    replace_keeping_the_date(&root, "a.md", b"efgh");
    workspace.store_entries();
    drop(workspace);

    let reopened = open_notes_on(&root, fat());
    reopened.store_entries();
    assert_eq!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"efgh").0),
        "la riapertura rilegge il file messo sopra invece di certificarlo coi byte letti prima"
    );
}

/// Il controllo positivo del test sopra: un file **rimasto lo stesso** dalla
/// lettura alla scrittura della riga si certifica alla riapertura, senza
/// rileggerlo (la riga porta timbro e impronta).
#[test]
fn the_row_of_a_file_left_alone_certifies_it_at_the_reopening() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    beyond_the_grain();
    let fat = || {
        Arc::new(Interposed {
            stamp_is_the_date: true,
            ..Interposed::over(&root)
        })
    };

    let workspace = open_notes_on(&root, fat());
    workspace.store_entries();
    drop(workspace);
    assert_eq!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"abcd").0)
    );

    let mut reopened = open_notes_on(&root, fat());
    reopened.store_entries();
    assert_eq!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"abcd").0)
    );
    // Certificata vuol dire non riletta: la seconda fase della riapertura non
    // ha niente da fare.
    let work = reopened.scan_vault().expect("riapre");
    assert_eq!(work.total(), 0, "un file rimasto lo stesso non si rilegge");
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
    beyond_the_grain();
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

/// **L'anagrafe interroga ogni file una volta per scrittura** (#524). Il
/// confronto con la tabella sul disco e la tabella nuova vengono dagli stessi
/// testimoni: chiederli due volte raddoppiava le domande al supporto proprio
/// sulla riapertura che cambia qualcosa, e fra le due domande un file poteva
/// cambiare, dando una tabella diversa da quella confrontata.
#[test]
fn the_entry_store_asks_each_file_once_even_when_it_writes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"ciao!");
    put(&root, "b.md", b"bene");
    put(&root, "c.bin", b"x");
    let storage = Arc::new(Interposed::over(&root));
    let mut workspace = open_on(&root, Arc::clone(&storage));
    // Un'impronta imparata: la tabella sul disco non la porta, la prossima
    // scrittura la deve scrivere.
    assert_eq!(ask(&mut workspace, "z.md", b"altr!"), SameContent::NotFound);
    let before = fs::read(table_path(&root)).expect("la tabella");

    storage.witness_questions.store(0, Ordering::SeqCst);
    workspace.store_entries();
    let writing = storage.witness_questions.load(Ordering::SeqCst);
    assert_ne!(
        fs::read(table_path(&root)).expect("la tabella"),
        before,
        "this store had something to write"
    );

    storage.witness_questions.store(0, Ordering::SeqCst);
    workspace.store_entries();
    let still = storage.witness_questions.load(Ordering::SeqCst);
    assert!(still > 0, "the comparison asks the files");
    assert_eq!(
        writing, still,
        "writing asks the same questions as finding nothing to write"
    );
}

/// Aspetta che i timbri di cambiamento dei file appena scritti siano **fermi**
/// per l'anagrafe: più vecchi di una grana
/// ([`CHANGE_STAMP_GRAIN`](fub_kernel::storage::CHANGE_STAMP_GRAIN), due
/// secondi) dell'istante in cui li si guarda. `put` mette la data un'ora
/// indietro, ma il timbro (`ctime`) non si può rimettere: un file scritto
/// adesso ha il timbro di adesso, e la sua riga si scriverebbe senza timbro,
/// cosa giusta ma che questi test non guardano.
fn beyond_the_grain() {
    std::thread::sleep(std::time::Duration::from_millis(2_100));
}
