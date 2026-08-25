//! **Il lotto del watcher non tiene il vault mentre legge il disco.**
//!
//! È la regola della [0024](../../../docs/decisions/README.md)
//! applicata alla porta da cui il vault cambia da fuori: il lotto prendeva
//! `write()` e sotto quel lucchetto leggeva e parsava ogni file cambiato, quindi
//! chi legge — la ricerca, l'autocompletamento, il disegno dei pannelli —
//! aspettava la fine di un'I/O che non ha niente a che fare con lui.
//!
//! **Qui non si cronometra niente.** Un tempo su una macchina condivisa non è
//! un segnale, e la proprietà non è «più veloce»: è che *durante* quella
//! lettura il prestito condiviso si prende ancora. Il presidio la osserva
//! direttamente, e la sincronizzazione è un canale — un formato di prova che
//! blocca dentro `parse` finché il lettore non ha letto. Deterministico: o il
//! lettore entra, o il test resta appeso e libtest lo dice.
//!
//! Il modo di perdere la proprietà è una parola: `read()` riscritto in `write()`
//! nella fase 1 di `ExternalSync::batch` compila, passa ogni test funzionale e
//! non si vede in nessuna diff che non sia questa.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexQuery, IndexResult, VaultEntry};
use fub_abi::{FormatProvider, Revision, WriteBase};
use fub_host::{Custody, ExternalChange, ExternalSync};
use fub_kernel::{FormatRegistry, Workspace};

/// Il cancello che rende **osservabile** una lettura lenta senza dormire.
///
/// `inside` dice al test che il parse è cominciato, `via` gli lascia decidere
/// quando finisce. Finché non sono armati il formato parsa come qualunque
/// altro: la scansione iniziale del vault passa di qui, e un cancello sempre
/// chiuso la bloccherebbe.
#[derive(Default)]
struct Gate {
    inside: Mutex<Option<Sender<()>>>,
    via: Mutex<Option<Receiver<()>>>,
}

impl Gate {
    /// Arma il cancello per **una** lettura: restituisce l'estremo da cui il
    /// test sente che il parse è entrato, e quello con cui lo lascia uscire.
    /// test sente che il parse è entrato, e quello con cui lo lascia uscire.
    fn arm(&self) -> (Receiver<()>, Sender<()>) {
        let (inside_tx, inside_rx) = channel();
        let (exit_tx, exit_rx) = channel();
        *self.inside.lock().unwrap() = Some(inside_tx);
        *self.via.lock().unwrap() = Some(exit_rx);
        (inside_rx, exit_tx)
    }

    fn traverse(&self) {
        let inside = self.inside.lock().unwrap().take();
        let via = self.via.lock().unwrap().take();
        if let (Some(inside), Some(via)) = (inside, via) {
            inside.send(()).expect("the test waits for the parse");
            via.recv().expect("the test lets the parse exit");
        }
    }
}

/// Un formato di testo nudo che, a cancello armato, si ferma dentro `parse`.
struct Slow(Arc<Gate>);

impl FormatProvider for Slow {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("prova.lento", "Slow", &["md"])
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        self.0.traverse();
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
    gate: Arc<Gate>,
    ws: Custody<Workspace>,
}

fn bench() -> Bench {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("nota.md"), "before\n").expect("seeds");

    let gate: Arc<Gate> = Arc::default();
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(Slow(gate.clone())))
        .expect("no conflict");
    let mut ws = Workspace::new(&root, formats).expect("the vault opens");
    // La scansione iniziale passa dal parse: il cancello è ancora aperto.
    ws.reindex().expect("initial scan");

    Bench {
        _dir: dir,
        root,
        gate,
        ws: Custody::new("the test vault", ws),
    }
}

fn entry(ws: &Workspace, id: &DocId) -> VaultEntry {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })
        .expect("the kernel serves the index")
    else {
        panic!("expected the index");
    };
    page.items
        .into_iter()
        .find(|and| &and.id == id)
        .expect("the note is in the index")
}

/// **La proprietà.** Mentre il lotto legge e parsa un file cambiato, chi legge
/// entra nel workspace.
///
/// `try_read` e non `read`: un `read` che aspettasse renderebbe il test verde
/// anche col prestito esclusivo — aspetterebbe la fine del parse e poi
/// passerebbe. Ciò che si vuole sapere è se in *quel momento* il vault è
/// prendibile, e a quella domanda risponde solo la forma che non aspetta.
#[test]
fn who_reads_enters_while_the_batch_reads_the_disk() {
    let bench = bench();
    std::fs::write(bench.root.join("nota.md"), "after\n").expect("external write");

    let (inside, via) = bench.gate.arm();
    let batch = {
        let (ws, path) = (bench.ws.clone(), bench.root.join("nota.md"));
        std::thread::spawn(move || {
            ExternalSync::new(ws).batch(&[ExternalChange::Touched(path)]);
        })
    };

    // Il parse è cominciato: da qui in poi il lotto sta facendo I/O.
    inside.recv().expect("the batch enters the parse");
    let read_result = bench.ws.try_read();
    assert!(
        read_result.is_some(),
        "the workspace is not borrowable while the batch reads the disk: the \
         phase that reads and parses holds the exclusive borrow, and whoever \
         reads — search, panel drawing — waits for an I/O that does not concern \
         it (0024)"
    );
    // E non è un prestito vuoto: da lì si legge davvero.
    assert!(read_result
        .expect("the shared borrow is there")
        .render_preview(&DocId::new("nota.md"))
        .is_ok());
    via.send(()).expect("the batch can finish");
    batch.join().expect("the batch finishes");

    // E il lotto ha fatto il suo lavoro: il modello nuovo è dentro.
    assert_eq!(
        entry(&bench.ws.read().unwrap(), &DocId::new("nota.md")).fingerprint,
        Some(Revision::of("after\n")),
        "the batch read and parsed, but applied nothing"
    );
}

/// **Il piano dichiara cosa credeva di sapere, e chi applica lo verifica.**
///
/// È il prezzo della fase in più: fra il parse e l'applicazione il prestito
/// esclusivo passa di mano, e in mezzo può entrarci un salvataggio dell'utente.
/// Applicare il modello parsato *prima* di quella scrittura la cancellerebbe
/// dalla memoria del kernel — sul disco resterebbe, in anagrafe e negli indici
/// no, e nessuno se ne accorgerebbe fino alla riapertura.
/// no, e nessuno se ne accorgerebbe fino alla riapertura.
#[test]
fn a_plan_aged_not_deletes_who_has_written_in_middle() {
    let bench = bench();
    let id = DocId::new("nota.md");
    let path = bench.root.join("nota.md");
    std::fs::write(&path, "from outside\n").expect("external write");

    let mut ws = bench.ws.write().unwrap();
    // Fase 1: il piano legge «da fuori».
    let plan = ws.plan_sync(&path);
    assert!(plan.is_some(), "there was a document to prepare");
    // In mezzo, l'utente salva.
    ws.write_document(&id, "from user\n", WriteBase::Dictated)
        .expect("the save succeeds");
    // Fase 2: il piano è invecchiato e si butta.
    ws.sync_path_prepared(&path, plan)
        .expect("synchronization succeeds anyway");

    assert_eq!(
        entry(&ws, &id).fingerprint,
        Some(Revision::of("from user\n")),
        "a plan made before the save was applied after: the user write \
         vanished from kernel memory"
    );
}
