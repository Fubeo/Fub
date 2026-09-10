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
use fub_abi::traits::{EntryKind, IndexQuery, IndexResult, VaultEntry};
use fub_abi::{Event, FormatProvider, Revision, WriteBase};
use fub_host::{Custody, ExternalChange, ExternalSync};
use fub_kernel::{FormatRegistry, SyncPlan, Workspace};

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

/// **Anche il feed completato dichiara quale revisione ha indicizzato.**
///
/// Fra la mutazione del core e la finalizzazione degli eventi il prestito è
/// rilasciato per notificare i provider. Un salvataggio può quindi superare il
/// feed già completato: il finalizzatore deve riconoscere la revisione stale e
/// non annunciare come corrente la modifica precedente.
#[test]
fn a_completed_feed_does_not_announce_over_a_newer_write() {
    let bench = bench();
    let id = DocId::new("nota.md");
    let path = bench.root.join("nota.md");
    std::fs::write(&path, "from outside\n").expect("external write");

    let plan = {
        let ws = bench.ws.read().unwrap();
        ws.plan_sync(&path)
    };
    assert!(plan.is_some(), "there was a document to prepare");
    let parsed = plan.map(SyncPlan::invoke);
    let pending = {
        let mut ws = bench.ws.write().unwrap();
        ws.prepare_sync_path_prepared(&path, parsed)
            .expect("the parsed change is valid")
            .expect("the feed is pending")
    };

    let completed = pending.invoke();
    let mut ws = bench.ws.write().unwrap();
    ws.write_document(&id, "from user\n", WriteBase::Dictated)
        .expect("the newer save succeeds");
    let events = ws.bus().subscribe();
    assert!(
        matches!(ws.finish_sync_path_prepared(completed), Ok(false)),
        "the stale feed must be a no-op"
    );

    assert_eq!(
        entry(&ws, &id).fingerprint,
        Some(Revision::of("from user\n")),
        "the stale feed replaced the newer core revision"
    );
    assert!(
        events.try_iter().next().is_none(),
        "the stale feed emitted finalization events"
    );
}

/// Un path senza `FormatProvider` attraversa le stesse tre fasi del documento:
/// lo `stat` avviene detached e la finalizzazione conserva l'anagrafe e gli
/// eventi di creazione, modifica, no-op e rimozione.
#[test]
fn a_providerless_entry_survives_the_watcher_batch() {
    let bench = bench();
    let path = bench.root.join("foto.png");
    let id = DocId::new("foto.png");
    let events = bench.ws.read().unwrap().bus().subscribe();
    let mut sync = ExternalSync::new(bench.ws.clone());

    std::fs::write(&path, b"one").expect("asset created");
    sync.batch(&[ExternalChange::Touched(path.clone())]);
    assert_eq!(entry(&bench.ws.read().unwrap(), &id).kind, EntryKind::Asset);
    assert_eq!(
        events
            .try_iter()
            .filter(|notice| matches!(
                &notice.event,
                Event::EntryChanged { id: changed, kind: EntryKind::Asset } if changed == &id
            ))
            .count(),
        1,
        "creation emits EntryChanged exactly once"
    );

    std::fs::write(&path, b"a longer asset").expect("asset changed");
    sync.batch(&[ExternalChange::Touched(path.clone())]);
    assert_eq!(
        entry(&bench.ws.read().unwrap(), &id).size,
        b"a longer asset".len() as u64
    );
    assert_eq!(
        events
            .try_iter()
            .filter(|notice| matches!(
                &notice.event,
                Event::EntryChanged { id: changed, kind: EntryKind::Asset } if changed == &id
            ))
            .count(),
        1,
        "a metadata change emits EntryChanged exactly once"
    );

    sync.batch(&[ExternalChange::Touched(path.clone())]);
    assert_eq!(
        events
            .try_iter()
            .filter(|notice| matches!(&notice.event, Event::EntryChanged { id: changed, .. } if changed == &id))
            .count(),
        0,
        "an unchanged entry is a no-op"
    );

    std::fs::remove_file(&path).expect("asset removed");
    sync.batch(&[ExternalChange::Touched(path)]);
    assert_eq!(
        events
            .try_iter()
            .filter(|notice| matches!(
                &notice.event,
                Event::EntryRemoved { id: removed, kind: EntryKind::Asset } if removed == &id
            ))
            .count(),
        1,
        "removal emits EntryRemoved exactly once"
    );
}
