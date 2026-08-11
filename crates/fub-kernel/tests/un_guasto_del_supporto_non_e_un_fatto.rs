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
use fub_abi::model::DocId;
use fub_kernel::storage::{DirEntry, FsStorage, NomiDelFile, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, KernelError, MachineSettings, Workspace};
use fub_testkit::TestoDiProva;

/// Un supporto che fa tutto come il disco, e su certi path **dice di no**.
///
/// Non «non c'è»: `PermissionDenied`, cioè l'errore che un `.ok()` non ha il
/// diritto di leggere come un'assenza. L'elenco dei path rifiutati si riempie a
/// vault aperto, perché è il momento in cui un disco comincia a fallire.
struct SupportoCheNega {
    inner: FsStorage,
    nega: Arc<Mutex<Vec<String>>>,
}

impl SupportoCheNega {
    fn nuovo() -> (Arc<Self>, Arc<Mutex<Vec<String>>>) {
        let nega = Arc::new(Mutex::new(Vec::new()));
        (
            Arc::new(SupportoCheNega {
                inner: FsStorage,
                nega: Arc::clone(&nega),
            }),
            nega,
        )
    }

    fn no(&self, path: &Utf8Path) -> Option<std::io::Error> {
        let nega = self.nega.lock().unwrap();
        nega.iter()
            .any(|f| path.as_str().contains(f.as_str()))
            .then(|| {
                std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "il supporto non fa guardare",
                )
            })
    }
}

impl VaultStorage for SupportoCheNega {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        match self.no(path) {
            Some(e) => Err(e),
            None => self.inner.read(path),
        }
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
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
        match self.no(path) {
            Some(e) => Err(e),
            None => self.inner.remove(path),
        }
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        match self.no(dir) {
            Some(e) => Err(e),
            None => self.inner.list(dir),
        }
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

struct Banco {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    nega: Arc<Mutex<Vec<String>>>,
}

impl Banco {
    /// Un vault con dentro una nota, aperto su un supporto che ancora non nega
    /// niente.
    fn aperto() -> (Banco, Workspace) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Idea.txt"), "il testo di prima").expect("nota");
        let (storage, nega) = SupportoCheNega::nuovo();
        let mut registry = FormatRegistry::new();
        registry
            .register(TestoDiProva::per_estensione("txt").boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::on(
            &root,
            registry,
            storage as Arc<dyn VaultStorage>,
            MachineSettings::in_memory(),
        );
        ws.reindex().expect("reindex");
        (
            Banco {
                _dir: dir,
                root,
                nega,
            },
            ws,
        )
    }

    /// Da adesso in poi, tutto ciò che nomina questo pezzo di path non si legge.
    fn nega(&self, pezzo: &str) {
        self.nega.lock().unwrap().push(pezzo.to_string());
    }
}

/// 0156 — **come si scrive non si decide su una domanda che è fallita.**
///
/// `symlink_metadata(path).ok()` rispondeva «non c'è niente lì» a un permesso
/// negato, e da quella risposta dipende il ramo: `Nessuno` vuol dire
/// *sostituisci*, cioè una `rename` che stacca l'inode — e se lì sotto c'era un
/// symlink o un hardlink quel nome smette in silenzio di essere lo stesso file.
#[test]
fn una_scrittura_non_sceglie_la_strada_da_una_lettura_fallita() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let nota = root.join("Idea.txt");
    std::fs::write(&nota, "prima").expect("nota");

    let esito = FsStorage.write_con(
        &nota,
        b"seconda",
        |_| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "il supporto non fa guardare",
            ))
        },
        |_, _| NomiDelFile::Uno,
    );

    assert_eq!(
        esito
            .expect_err("chi non ha potuto guardare non decide")
            .kind(),
        std::io::ErrorKind::PermissionDenied,
        "l'errore risale con il suo tipo, invece di diventare «non c'era niente»"
    );
    assert_eq!(
        std::fs::read_to_string(&nota).expect("rilettura"),
        "prima",
        "e soprattutto non si è scritto sul ramo scelto al buio"
    );
}

/// 0164 — **un registro che non si legge non è un registro vuoto.**
///
/// Le due cose avevano la stessa risposta, e da lì l'annullamento non aveva
/// niente da disfare senza che nessuno dicesse perché.
#[test]
fn un_registro_illeggibile_non_e_un_registro_vuoto() {
    let (banco, mut ws) = Banco::aperto();
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

    banco.nega("journal.jsonl");

    let errore = ws.journal().expect_err("un guasto non è una storia vuota");
    assert!(
        matches!(&errore, KernelError::Io { path, .. } if path.as_str().contains("journal.jsonl")),
        "e dice su quale file: {errore}"
    );
}

/// 0166 — **una cartella di bozze che non si legge non è «nessuna bozza».**
///
/// È il punto in cui pesa di più: là dentro sta l'unica copia di ciò che
/// l'utente ha scritto e non ha salvato, e mostrarne zero è il primo passo
/// perché il salvataggio dopo ci scriva sopra.
#[test]
fn una_cartella_di_bozze_illeggibile_non_e_nessuna_bozza() {
    let (banco, mut ws) = Banco::aperto();
    ws.save_draft(&DocId::new("Idea.txt"), "quel che stavo scrivendo", None)
        .expect("bozza scritta");
    assert_eq!(
        ws.drafts().expect("bozze").drafts.len(),
        1,
        "prima del guasto la bozza c'è"
    );

    banco.nega("/drafts");

    let errore = ws.drafts().expect_err("un guasto non è una cartella vuota");
    assert!(
        matches!(&errore, KernelError::Io { path, .. } if path.as_str().ends_with("drafts")),
        "e dice quale cartella: {errore}"
    );
}

/// 0178 — **«non riesco a leggere la tua nota» non è «il documento è cambiato
/// sotto di te».**
///
/// L'unico dei cinque con un testo che l'utente legge: chi ha un disco che sta
/// fallendo riceveva la frase del conflitto, e un conflitto vero non si
/// distingueva da un supporto rotto.
#[test]
fn una_nota_che_non_si_legge_non_e_una_base_che_non_combacia() {
    let (banco, mut ws) = Banco::aperto();
    let id = DocId::new("Idea.txt");
    let base = ws.document_revision(&id).expect("revisione");

    banco.nega("Idea.txt");

    let errore = ws
        .write_document(&id, "il testo nuovo", WriteBase::DescendsFrom(base))
        .expect_err("il supporto ha detto di no");
    assert!(
        !matches!(errore, KernelError::Stale(_)),
        "un guasto del supporto non si racconta come un conflitto: {errore}"
    );
    let detto = errore.to_string();
    assert!(
        detto.contains("Idea.txt") && detto.contains("I/O"),
        "e la frase dice cos'è successo e su cosa: {detto}"
    );

    // La nota non è stata toccata: chi non ha potuto controllare non scrive.
    assert_eq!(
        std::fs::read_to_string(banco.root.join("Idea.txt")).expect("rilettura"),
        "il testo di prima"
    );
}

/// 0178, l'altra metà — **una base che davvero non combacia resta `Stale`.**
///
/// La riparazione stringe il ramo, non lo chiude: il file cestinato sotto i
/// piedi di chi scriveva continua a essere un conflitto, che è la risposta
/// giusta.
#[test]
fn una_base_che_non_combacia_resta_un_conflitto() {
    let (_banco, mut ws) = Banco::aperto();
    let id = DocId::new("Idea.txt");
    let vecchia = Revision::of("un testo che non è mai stato sul disco");

    let errore = ws
        .write_document(&id, "il testo nuovo", WriteBase::DescendsFrom(vecchia))
        .expect_err("la base non combacia");
    assert!(matches!(errore, KernelError::Stale(_)), "{errore}");
}

/// 0193 — **un cestino svuotato a metà non è un cestino svuotato.**
///
/// I sidecar del cestino se ne vanno con un `remove_dir_all` il cui esito era
/// buttato: restavano indietro a nominare voci che non esistono più, e chi
/// aveva chiesto di svuotare sentiva dire che era andato tutto bene.
#[test]
fn un_cestino_svuotato_a_meta_non_e_un_cestino_svuotato() {
    let (banco, mut ws) = Banco::aperto();
    ws.delete_document(&DocId::new("Idea.txt"))
        .expect("cestinata");

    banco.nega("/data/trash/");

    let errore = ws
        .empty_trash()
        .expect_err("ciò che è rimasto indietro si dice");
    assert!(
        matches!(&errore, KernelError::Io { path, .. } if path.as_str().contains("trash")),
        "e dice cosa non si è tolto: {errore}"
    );
}
