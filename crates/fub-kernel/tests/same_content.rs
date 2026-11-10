//! **Lo stesso contenuto** (D-3 (b), A-17), dal vault vero: le risposte che il
//! kernel dà a «c'è già un file con questi byte?», con file e tabelle veri in
//! una cartella temporanea. Ogni caso del piano ha il suo test, e i casi in cui
//! la risposta deve restare «non so», o in cui non si scrive niente, controllano
//! anche che il file della tabella resti identico byte per byte.
//!
//! Ogni domanda si fa per le due strade, con un lettore e con i byte in mano, e
//! le due devono dare la stessa risposta. In fondo al file, il conteggio dei
//! byte allocati dice che i byte in mano non si copiano.

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
use fub_kernel::vault::Vault;
use fub_kernel::{data_root, FormatRegistry, KernelError, Workspace};
use serde_json::{json, Value};

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

fn root_of(dir: &tempfile::TempDir) -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("una cartella temporanea è UTF-8")
}

/// Scrive un file e lo porta nel passato: la regola *racily clean* non
/// scarterebbe la sua voce, e il test guarda la domanda, non il tempo.
fn put(root: &Utf8Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().expect("un file ha una cartella")).expect("cartella");
    fs::write(&path, bytes).expect("scrittura del file");
    let past = SystemTime::now() - Duration::from_secs(3600);
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .expect("apertura del file")
        .set_modified(past)
        .expect("data nel passato");
}

fn table_path(root: &Utf8Path) -> Utf8PathBuf {
    data_root(root).join("entries.json")
}

/// La voce di un file così com'è adesso: misura, data, timbro e identità, come
/// le leggerebbe la scansione. Con `fingerprint`, l'impronta che la voce porta.
fn entry(vault: &Vault, rel: &str, fingerprint: Option<&[u8]>) -> Value {
    let id = DocId::new(rel);
    let (size, mtime) = vault.stat(&id).expect("il file c'è");
    let mut value = json!({ "size": size, "mtime": mtime });
    if let Some(stamp) = vault.change_stamp(&id) {
        value["change_stamp"] = json!(stamp);
    }
    if let Some(identity) = vault.file_identity(&id) {
        value["identity"] = json!({ "volume": identity.volume, "file": identity.file });
    }
    if let Some(bytes) = fingerprint {
        value["fingerprint"] = json!(Revision::of_bytes(bytes).0);
    }
    value
}

/// Un record come sta sul file: una riga, delimitata da `\n` prima e dopo.
fn framed(record: &Value) -> Vec<u8> {
    let mut raw = b"\n".to_vec();
    raw.extend(serde_json::to_vec(record).expect("json"));
    raw.push(b'\n');
    raw
}

/// Una tabella fatta di un solo snapshot, con le voci date.
fn write_table<'a>(root: &Utf8Path, entries: impl IntoIterator<Item = (&'a str, Value)>) {
    let map: serde_json::Map<String, Value> = entries
        .into_iter()
        .map(|(id, value)| (id.to_owned(), value))
        .collect();
    write_raw(
        root,
        &framed(&json!({ "v": 5, "op": "snapshot", "entries": map })),
    );
}

fn write_raw(root: &Utf8Path, bytes: &[u8]) {
    let path = table_path(root);
    fs::create_dir_all(path.parent().expect("la tabella ha una cartella")).expect("cartella");
    fs::write(path, bytes).expect("scrittura della tabella");
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

/// La domanda per le due strade: con un lettore, che copia il contenuto in
/// memoria, e con i byte in mano, che non lo copiano. Devono dare la stessa
/// risposta, e ogni caso lo controlla; è quella dei byte in mano che si restituisce.
fn ask(vault: &Vault, bytes: &[u8]) -> SameContent {
    let by_reader = vault
        .same_content(bytes.len() as u64, &mut &bytes[..])
        .expect("la domanda riesce");
    let in_hand = vault.same_content_bytes(bytes);
    assert_eq!(
        by_reader, in_hand,
        "il lettore e i byte in mano danno risposte diverse"
    );
    in_hand
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
    let vault = Vault::open(&root).expect("vault");
    write_table(
        &root,
        [("originale.md", entry(&vault, "originale.md", None))],
    );

    assert_eq!(ask(&vault, b"gli stessi byte"), found("originale.md"));
}

#[test]
fn the_same_size_with_other_bytes_is_not_the_same_content() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"aaaa");
    let vault = Vault::open(&root).expect("vault");
    write_table(&root, [("a.md", entry(&vault, "a.md", None))]);

    // Il controllo positivo: i byte giusti trovano il file, così il no che segue
    // non è un no qualunque.
    assert_eq!(ask(&vault, b"aaaa"), found("a.md"));
    assert_eq!(ask(&vault, b"bbbb"), SameContent::NotFound);
}

#[test]
fn the_trash_is_not_a_candidate() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // «.trash» viene prima di «vivo» per percorso: se il cestino contasse, la
    // risposta sarebbe lui. La risposta è «vivo», che ha gli stessi byte.
    put(&root, ".trash/vecchio.md", b"stessi byte");
    put(&root, "vivo.md", b"stessi byte");
    let vault = Vault::open(&root).expect("vault");
    write_table(
        &root,
        [
            (
                ".trash/vecchio.md",
                entry(&vault, ".trash/vecchio.md", None),
            ),
            ("vivo.md", entry(&vault, "vivo.md", None)),
        ],
    );

    assert_eq!(ask(&vault, b"stessi byte"), found("vivo.md"));
}

#[test]
fn the_metadata_folder_is_not_a_candidate() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // Il file in `.fub/` viene prima di «vivo» per percorso: se contasse, sarebbe
    // lui la risposta. La risposta è «vivo», che ha gli stessi byte.
    put(&root, ".fub/nascosto.md", b"stessi byte");
    put(&root, "vivo.md", b"stessi byte");
    let vault = Vault::open(&root).expect("vault");
    write_table(
        &root,
        [
            (".fub/nascosto.md", entry(&vault, ".fub/nascosto.md", None)),
            ("vivo.md", entry(&vault, "vivo.md", None)),
        ],
    );

    assert_eq!(ask(&vault, b"stessi byte"), found("vivo.md"));
}

#[test]
fn a_file_in_an_excluded_folder_is_not_a_candidate() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    fs::write(root.join(".gitignore"), "escluso/\n").expect("gitignore");
    // Il file escluso viene prima di «vivo» per percorso: se contasse, sarebbe lui
    // la risposta. La risposta è «vivo», che ha gli stessi byte.
    put(&root, "escluso/nota.md", b"stessi byte");
    put(&root, "vivo.md", b"stessi byte");
    let vault = Vault::open(&root).expect("vault");
    write_table(
        &root,
        [
            ("escluso/nota.md", entry(&vault, "escluso/nota.md", None)),
            ("vivo.md", entry(&vault, "vivo.md", None)),
        ],
    );

    assert_eq!(ask(&vault, b"stessi byte"), found("vivo.md"));
}

#[test]
fn the_candidates_are_compared_up_to_sixty_four_and_past_that_the_answer_is_unknown() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    let names: Vec<String> = (0..=MAX_CANDIDATES)
        .map(|i| format!("f{i:03}.md"))
        .collect();
    for (i, name) in names.iter().enumerate() {
        put(&root, name, format!("x{i:03}").as_bytes());
    }
    let vault = Vault::open(&root).expect("vault");
    let entries: Vec<(&str, Value)> = names
        .iter()
        .map(|name| (name.as_str(), entry(&vault, name, None)))
        .collect();

    write_table(&root, entries[..MAX_CANDIDATES].iter().cloned());
    assert_eq!(ask(&vault, b"zzzz"), SameContent::NotFound);

    write_table(&root, entries.iter().cloned());
    assert_eq!(
        ask(&vault, b"zzzz"),
        unknown(UnknownReason::TooManyCandidates {
            found: MAX_CANDIDATES + 1
        })
    );
}

#[test]
fn ten_thousand_candidates_are_unknown_without_reading_a_file() {
    // Nessun file sul disco: se il limite si controllasse dopo le letture, la
    // risposta sarebbe un errore di lettura e non un «non so».
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    let names: Vec<String> = (0..10_000).map(|i| format!("molti/f{i:05}.md")).collect();
    write_table(
        &root,
        names
            .iter()
            .map(|name| (name.as_str(), json!({ "size": 4, "mtime": 1 }))),
    );
    let vault = Vault::open(&root).expect("vault");

    assert_eq!(
        ask(&vault, b"zzzz"),
        unknown(UnknownReason::TooManyCandidates { found: 10_000 })
    );
}

#[test]
fn an_empty_file_is_the_same_content_of_empty_bytes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "vuoto.md", b"");
    let vault = Vault::open(&root).expect("vault");
    write_table(&root, [("vuoto.md", entry(&vault, "vuoto.md", None))]);

    assert_eq!(ask(&vault, b""), found("vuoto.md"));
}

#[test]
fn among_duplicates_the_first_by_path_is_the_answer() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "b.md", b"doppio");
    put(&root, "a.md", b"doppio");
    let vault = Vault::open(&root).expect("vault");
    write_table(
        &root,
        [
            ("b.md", entry(&vault, "b.md", None)),
            ("a.md", entry(&vault, "a.md", None)),
        ],
    );

    assert_eq!(ask(&vault, b"doppio"), found("a.md"));
}

#[test]
fn a_file_changed_while_it_is_read_is_no_match_and_records_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // «a.md» si cambia mentre lo si legge; «b.md» ha gli stessi byte e non si
    // tocca. La risposta è «b.md», e ad «a.md» non si registra niente.
    put(&root, "a.md", b"vecchio");
    put(&root, "b.md", b"vecchio");
    let plain = Vault::open(&root).expect("vault");
    write_table(
        &root,
        [
            ("a.md", entry(&plain, "a.md", None)),
            ("b.md", entry(&plain, "b.md", None)),
        ],
    );

    let interposed = Interposed {
        inner: RootedFsStorage::open(&root).expect("radice"),
        failing: Vec::new(),
        rewritten_after_read: Mutex::new(Some((
            root.join("a.md"),
            b"molto piu lungo di prima".to_vec(),
        ))),
    };
    let vault = Vault::on(&root, Arc::new(interposed)).expect("vault");

    assert_eq!(ask(&vault, b"vecchio"), found("b.md"));
    assert_eq!(
        recorded_fingerprint(&root, "a.md"),
        None,
        "un file cambiato a metà non lascia un'impronta"
    );
}

#[test]
fn a_file_rewritten_right_after_it_is_compared_is_no_match() {
    // Il confronto dei byte riesce: il file ha esattamente i byte cercati. Subito
    // dopo, prima della risposta, lo si riscrive più lungo. Un file cambiato mentre
    // lo si confronta non è una risposta: si salta, e la domanda dice «no». Il solo
    // confronto dei byte direbbe «sì».
    for by_reader in [true, false] {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = root_of(&dir);
        put(&root, "a.md", b"stesso");
        let plain = Vault::open(&root).expect("vault");
        // L'impronta della voce descrive il file, quindi il confronto è la sola lettura.
        write_table(&root, [("a.md", entry(&plain, "a.md", Some(b"stesso")))]);
        let interposed = Interposed {
            inner: RootedFsStorage::open(&root).expect("radice"),
            failing: Vec::new(),
            rewritten_after_read: Mutex::new(Some((
                root.join("a.md"),
                b"molto piu lungo di prima".to_vec(),
            ))),
        };
        let vault = Vault::on(&root, Arc::new(interposed)).expect("vault");
        let answer = if by_reader {
            vault
                .same_content(b"stesso".len() as u64, &mut &b"stesso"[..])
                .expect("la domanda riesce")
        } else {
            vault.same_content_bytes(b"stesso")
        };
        assert_eq!(answer, SameContent::NotFound, "con un lettore: {by_reader}");
    }
}

#[test]
fn a_fingerprint_that_no_longer_describes_the_file_is_not_believed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // La voce porta l'impronta di «vecchio», con la data di allora. Il file cambia a
    // parità di misura, con altri byte e un'altra data: quell'impronta non lo
    // descrive più, e non si crede. Si rifà dai byte, e il file c'è.
    put(&root, "a.md", b"vecchio");
    let plain = Vault::open(&root).expect("vault");
    write_table(&root, [("a.md", entry(&plain, "a.md", Some(b"vecchio")))]);
    fs::write(root.join("a.md"), b"novita!").expect("riscrittura");
    fs::OpenOptions::new()
        .write(true)
        .open(root.join("a.md"))
        .expect("apertura del file")
        .set_modified(SystemTime::now() - Duration::from_secs(7200))
        .expect("data nel passato");
    let vault = Vault::open(&root).expect("vault");

    assert_eq!(ask(&vault, b"novita!"), found("a.md"));
}

#[test]
fn a_candidate_that_cannot_be_read_is_skipped() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"doppio");
    put(&root, "b.md", b"doppio");
    let plain = Vault::open(&root).expect("vault");
    write_table(
        &root,
        [
            ("a.md", entry(&plain, "a.md", None)),
            ("b.md", entry(&plain, "b.md", None)),
        ],
    );

    let interposed = Interposed {
        inner: RootedFsStorage::open(&root).expect("radice"),
        failing: vec![root.join("a.md")],
        rewritten_after_read: Mutex::new(None),
    };
    let vault = Vault::on(&root, Arc::new(interposed)).expect("vault");

    assert_eq!(ask(&vault, b"doppio"), found("b.md"));
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
    // Un collegamento relativo dentro il vault, e uno assoluto fuori: la tabella
    // li ha registrati quando erano file, e la misura è quella del file vero. Un
    // `stat` che seguisse il collegamento li troverebbe, e li leggerebbe.
    std::os::unix::fs::symlink("vero.md", root.join("dentro.md")).expect("link");
    std::os::unix::fs::symlink(&outside_file, root.join("fuori.md")).expect("link");
    let vault = Vault::open(&root).expect("vault");
    write_table(
        &root,
        [
            ("dentro.md", json!({ "size": 11, "mtime": 1 })),
            ("fuori.md", json!({ "size": 11, "mtime": 1 })),
            ("vero.md", entry(&vault, "vero.md", None)),
        ],
    );

    // Il file vero, con gli stessi byte, è la risposta: i collegamenti si saltano.
    // Se si seguissero, «dentro.md», che viene prima per percorso, lo sarebbe.
    assert_eq!(ask(&vault, b"stessi byte"), found("vero.md"));
    assert_eq!(
        fs::read(&outside_file).expect("il file fuori"),
        b"stessi byte",
        "il file fuori dal vault non si tocca"
    );
}

#[test]
fn a_recorded_fingerprint_is_believed_but_the_bytes_decide() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"ciao!");
    let vault = Vault::open(&root).expect("vault");
    // Un'impronta falsa, uguale a quella di ciò che arriva (stessa misura): la
    // voce descrive il file, quindi l'impronta si crede, e il confronto dei byte
    // dice no.
    write_table(&root, [("a.md", entry(&vault, "a.md", Some(b"altr!")))]);

    assert_eq!(ask(&vault, b"altr!"), SameContent::NotFound);

    // Con l'impronta giusta la stessa voce risponde: il controllo positivo.
    write_table(&root, [("a.md", entry(&vault, "a.md", Some(b"ciao!")))]);
    assert_eq!(ask(&vault, b"ciao!"), found("a.md"));
}

#[test]
fn a_fingerprint_computed_for_a_candidate_is_recorded_in_its_entry() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"ciao!");
    let vault = Vault::open(&root).expect("vault");
    write_table(&root, [("a.md", entry(&vault, "a.md", None))]);

    assert_eq!(ask(&vault, b"altr!"), SameContent::NotFound);
    assert_eq!(
        recorded_fingerprint(&root, "a.md"),
        Some(Revision::of_bytes(b"ciao!").0),
        "l'impronta calcolata sul file di oggi si registra"
    );
}

#[test]
fn a_broken_table_is_unknown_and_is_not_rewritten() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"stessi");
    let vault = Vault::open(&root).expect("vault");

    // Una coda che non comincia con `\n`, e una che ha una riga sola, troncata:
    // nessuna dice quali file ci sono.
    for broken in [b"non e una coda".as_slice(), b"\n{troncato".as_slice()] {
        write_raw(&root, broken);
        let before = fs::read(table_path(&root)).expect("la tabella");
        assert_eq!(ask(&vault, b"stessi"), unknown(UnknownReason::TableBroken));
        assert_eq!(fs::read(table_path(&root)).expect("la tabella"), before);
    }
}

#[test]
fn a_table_of_another_version_is_unknown_and_is_not_rewritten() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"stessi");
    write_raw(
        &root,
        &framed(
            &json!({ "v": 6, "op": "snapshot", "entries": { "a.md": { "size": 6, "mtime": 1 } } }),
        ),
    );
    let before = fs::read(table_path(&root)).expect("la tabella");
    let vault = Vault::open(&root).expect("vault");

    assert_eq!(
        ask(&vault, b"stessi"),
        unknown(UnknownReason::TableOfAnotherVersion)
    );
    assert_eq!(fs::read(table_path(&root)).expect("la tabella"), before);
}

#[test]
fn an_absent_table_is_unknown_and_is_not_created() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"stessi");
    let vault = Vault::open(&root).expect("vault");

    assert_eq!(ask(&vault, b"stessi"), unknown(UnknownReason::NoTable));
    assert!(
        !table_path(&root).exists(),
        "la domanda non crea una tabella"
    );
}

#[test]
fn an_incoming_of_another_length_than_declared_is_an_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    put(&root, "a.md", b"abcd");
    let vault = Vault::open(&root).expect("vault");
    write_table(&root, [("a.md", entry(&vault, "a.md", None))]);

    let short = vault.same_content(4, &mut &b"ab"[..]);
    assert!(matches!(short, Err(KernelError::Io { .. })), "{short:?}");
    let long = vault.same_content(4, &mut &b"abcdef"[..]);
    assert!(matches!(long, Err(KernelError::Io { .. })), "{long:?}");
}

#[test]
fn a_table_written_by_the_workspace_answers_found() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    fs::write(root.join("nota.md"), b"# uguale\n").expect("file");
    // La regola *racily clean*: la scansione non registra una data che non è
    // ancora nel passato, quindi il file aspetta un millisecondo.
    std::thread::sleep(Duration::from_millis(5));
    {
        let mut workspace = Workspace::new(&root, FormatRegistry::new()).expect("apertura");
        workspace.reindex().expect("reindex");
    }

    let vault = Vault::open(&root).expect("vault");
    assert_eq!(ask(&vault, b"# uguale\n"), found("nota.md"));
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
fn the_bytes_in_hand_are_not_copied_while_a_reader_is() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    // Stessa misura, altri byte: il candidato si legge per l'impronta, e basta.
    let other = vec![b'b'; SIZE];
    put(&root, "altro.bin", &other);
    let vault = Vault::open(&root).expect("vault");
    write_table(&root, [("altro.bin", entry(&vault, "altro.bin", None))]);
    let wanted = vec![b'a'; SIZE];

    let (answer, in_hand) = allocated_by(|| vault.same_content_bytes(&wanted));
    assert_eq!(answer, SameContent::NotFound);
    assert!(
        in_hand < SIZE as u64 / 2,
        "con i byte in mano il thread ha chiesto {in_hand} byte: il contenuto è stato copiato"
    );

    // Il controllo: il lettore copia il contenuto, e la misura lo mostra.
    let (answer, by_reader) = allocated_by(|| vault.same_content(SIZE as u64, &mut &wanted[..]));
    assert_eq!(answer.expect("la domanda riesce"), SameContent::NotFound);
    assert!(
        by_reader >= SIZE as u64,
        "il lettore avrebbe dovuto copiare il contenuto, ha chiesto {by_reader} byte"
    );
}

#[test]
fn the_bytes_in_hand_are_not_copied_when_the_candidate_matches() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = root_of(&dir);
    let wanted = vec![b'a'; SIZE];
    put(&root, "uguale.bin", &wanted);
    let vault = Vault::open(&root).expect("vault");
    write_table(&root, [("uguale.bin", entry(&vault, "uguale.bin", None))]);

    let (answer, in_hand) = allocated_by(|| vault.same_content_bytes(&wanted));
    assert_eq!(answer, found("uguale.bin"));
    assert!(
        in_hand < SIZE as u64 / 2,
        "con un candidato uguale il thread ha chiesto {in_hand} byte: il contenuto è stato copiato"
    );
}
