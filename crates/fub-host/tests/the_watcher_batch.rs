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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::doc_data;
use fub_abi::traits::{
    EntryKind, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute, VaultEntry,
};
use fub_abi::{Event, FormatProvider, PluginError, Revision, WriteBase};
use fub_host::{Custody, ExternalChange, ExternalSync};
use fub_kernel::storage::{DirEntry, Merge, Stat, VaultStorage};
use fub_kernel::{data_root, FormatRegistry, MachineSettings, MemStorage, Workspace};

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

/// Entra nel watcher mentre questo indice sta ricevendo un feed: la prepare
/// della rinomina incontra intenzionalmente il divieto di rientro dell'indice.
struct PrepareErrorIndex {
    workspace: Custody<Workspace>,
    from: Utf8PathBuf,
    to: Utf8PathBuf,
    armed: AtomicBool,
}

impl IndexProvider for PrepareErrorIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, _: &[DocumentModel]) -> Vec<IndexLoss> {
        if self.armed.swap(false, Ordering::SeqCst) {
            ExternalSync::new(self.workspace.clone()).batch(&[ExternalChange::Renamed {
                from: self.from.clone(),
                to: self.to.clone(),
            }]);
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn flush(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, _: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("feed-only test index".into()))
    }
}

/// Tiene aperto il primo feed mentre il test committa una revisione più nuova
/// dello stesso documento, poi restituisce una perdita che il finalizzatore
/// stale deve comunque riportare.
struct ReentrantFeedIndex {
    gate: Arc<Gate>,
    lose_once: AtomicBool,
}

impl IndexProvider for ReentrantFeedIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, models: &[DocumentModel]) -> Vec<IndexLoss> {
        self.gate.traverse();
        if self.lose_once.swap(false, Ordering::SeqCst) {
            vec![IndexLoss::new(
                models[0].id.clone(),
                PluginError::Io("perdita dal feed rientrante".into()),
            )]
        } else {
            Vec::new()
        }
    }

    fn on_documents_removed(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn flush(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, _: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("feed-only test index".into()))
    }
}

/// Un supporto che rende osservabili sia la camminata di `catch_up` sia lo
/// `stat` discriminante del filtro watcher.
///
/// I due cancelli sono separati: il primo prova la scansione, il secondo arma
/// soltanto un path che combacia con una regola folder-only.
struct BlockingListStorage {
    inner: MemStorage,
    gate: Arc<Gate>,
    stat_gate: Arc<Gate>,
    stat_path: Option<Utf8PathBuf>,
    fail: AtomicBool,
}

impl BlockingListStorage {
    fn new(gate: Arc<Gate>) -> Self {
        Self {
            inner: MemStorage::new(),
            gate,
            stat_gate: Arc::default(),
            stat_path: None,
            fail: AtomicBool::new(false),
        }
    }

    fn blocking_stat(gate: Arc<Gate>, stat_path: Utf8PathBuf) -> Self {
        Self {
            inner: MemStorage::new(),
            gate,
            stat_gate: Arc::default(),
            stat_path: Some(stat_path),
            fail: AtomicBool::new(false),
        }
    }

    fn arm_stat(&self) -> (Receiver<()>, Sender<()>) {
        self.stat_gate.arm()
    }
}

impl VaultStorage for BlockingListStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }

    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }

    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
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
        self.inner.remove(path)
    }

    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        if self.fail.load(Ordering::Relaxed) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "catch-up list denied",
            ));
        }
        self.gate.traverse();
        self.inner.list(dir)
    }

    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        let blocked = self.stat_path.as_deref() == Some(path);
        if blocked {
            self.stat_gate.traverse();
        }
        self.inner.stat(path)
    }

    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
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

/// **La stessa proprietà comprende la camminata di apertura.**
///
/// Il supporto si ferma dentro `VaultStorage::list`, non dentro un formato:
/// quando il canale segnala l'ingresso, `catch_up` sta certamente scandendo il
/// vault e il prestito condiviso deve essere ancora disponibile.
#[test]
fn who_reads_enters_while_catch_up_scans_the_vault() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let gate: Arc<Gate> = Arc::default();
    let storage = Arc::new(BlockingListStorage::new(Arc::clone(&gate)));
    storage
        .write(&root.join("nota.md"), b"before\n")
        .expect("seed");

    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(Slow(Arc::default())))
        .expect("no conflict");
    let mut ws = Workspace::on(
        &root,
        formats,
        storage.clone() as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("the vault opens");
    ws.reindex().expect("initial scan");
    let ws = Custody::new("the catch-up vault", ws);

    storage
        .write(&root.join("nota.md"), b"after\n")
        .expect("external write");
    let (inside, via) = gate.arm();
    let catch_up = {
        let ws = ws.clone();
        std::thread::spawn(move || ExternalSync::new(ws).catch_up())
    };

    inside.recv().expect("catch-up enters VaultStorage::list");
    let read_result = ws.try_read();
    assert!(
        read_result.is_some(),
        "the workspace is not borrowable while catch-up scans the vault"
    );
    assert!(read_result
        .expect("the shared borrow is there")
        .render_preview(&DocId::new("nota.md"))
        .is_ok());
    via.send(()).expect("the scan can finish");
    catch_up.join().expect("catch-up finishes");

    assert_eq!(
        entry(&ws.read().unwrap(), &DocId::new("nota.md")).fingerprint,
        Some(Revision::of("after\n")),
        "catch-up scanned the vault but applied nothing"
    );

    let failures = ws.read().unwrap().bus().subscribe();
    storage.fail.store(true, Ordering::Relaxed);
    ExternalSync::new(ws.clone()).catch_up();
    let status = match ws
        .read()
        .unwrap()
        .query_index(IndexQuery::VaultStatus)
    {
        Ok(IndexResult::VaultStatus(status)) => status,
        other => panic!("expected vault status, got {other:?}"),
    };
    assert_eq!(
        status.sync_failures, 1,
        "a failed catch-up scan must be observable in vault status"
    );
    assert_eq!(
        failures
            .try_iter()
            .filter(|notice| matches!(&notice.event, Event::Trouble { .. }))
            .count(),
        1,
        "one failed scan must be reported exactly once"
    );
}
/// Il ramo folder-only di `is_ignored` può chiedere uno `stat`: anche quel
/// preflight deve vivere interamente fuori da `Custody`, per `Touched` e
/// `Renamed`.
#[test]
fn watcher_ignore_preflight_releases_custody_before_folder_stat() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let excluded = root.join("node_modules");
    let storage = Arc::new(BlockingListStorage::blocking_stat(
        Arc::default(),
        excluded.clone(),
    ));
    let ws = Workspace::on(
        &root,
        FormatRegistry::new(),
        storage.clone() as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("the vault opens");
    let ws = Custody::new("the ignore-preflight vault", ws);

    for (kind, change) in [
        ("Touched", ExternalChange::Touched(excluded.clone())),
        (
            "Renamed",
            ExternalChange::Renamed {
                from: excluded.clone(),
                to: root.join("ordinary"),
            },
        ),
    ] {
        let (inside, via) = storage.arm_stat();
        let batch = {
            let ws = ws.clone();
            std::thread::spawn(move || ExternalSync::new(ws).batch(&[change]))
        };

        inside
            .recv()
            .expect("the ignore preflight enters VaultStorage::stat");
        let read = ws.try_read();
        assert!(
            read.is_some(),
            "the {kind} ignore preflight kept the workspace read-locked"
        );
        drop(read);
        let write = ws.try_write();
        assert!(
            write.is_some(),
            "the {kind} ignore preflight kept the workspace locked"
        );
        drop(write);

        via.send(()).expect("the stat preflight can finish");
        batch.join().expect("the watcher batch finishes");
    }
}

/// **Il fatto Touched precede anche una scrittura che supera il suo feed.**
///
/// Il provider trattiene la callback con un canale mentre il core committa una
/// revisione più nuova dello stesso documento. Il completamento vecchio deve
/// recuperare frame e perdita senza applicare il proprio epilogo sul modello
/// nuovo; l'evento già accodato resta prima di quelli prodotti dopo il rientro.
#[test]
fn a_completed_feed_does_not_announce_over_a_newer_write() {
    const INDEX: &str = "test.watcher-feed-reentry";

    let bench = bench();
    let gate = Arc::new(Gate::default());
    {
        let mut ws = bench.ws.write().expect("the vault is alive");
        ws.register_core_feature(INDEX, "Watcher feed reentry probe")
            .expect("index owner declares");
        ws.register_index_provider(
            INDEX,
            Box::new(ReentrantFeedIndex {
                gate: gate.clone(),
                lose_once: AtomicBool::new(true),
            }),
        )
        .expect("index provider registers");
    }

    let id = DocId::new("nota.md");
    let path = bench.root.join("nota.md");
    let events = bench.ws.read().expect("the vault is alive").bus().subscribe();
    std::fs::write(&path, "from outside\n").expect("external write");
    let plan = bench
        .ws
        .read()
        .expect("the vault is alive")
        .plan_sync(&path)
        .expect("there was a document to prepare");
    let parsed = plan.invoke();
    let pending = bench
        .ws
        .write()
        .expect("the vault is alive")
        .prepare_sync_path_prepared(&path, Some(parsed))
        .expect("the parsed change is valid")
        .expect("the feed is pending");

    let (inside, via) = gate.arm();
    let invoking = std::thread::spawn(move || pending.invoke());
    inside.recv().expect("the old feed entered the provider");

    let newer = {
        let prepared = bench
            .ws
            .write()
            .expect("the vault is alive")
            .prepare_document_write(&id, WriteBase::Dictated)
            .expect("the newer write prepares");
        let model = prepared
            .parse("from user\n")
            .expect("the newer source parses");
        bench
            .ws
            .write()
            .expect("the vault is alive")
            .commit_document_write(prepared, "from user\n", model, Ok(()))
            .expect("the newer write commits while the old provider is active")
    };

    via.send(()).expect("the old feed can finish");
    let completed = invoking.join().expect("the old feed returns");
    {
        let mut ws = bench.ws.write().expect("the vault is alive");
        assert!(
            matches!(ws.finish_sync_path_prepared(completed), Ok(false)),
            "the stale feed must be a no-op"
        );
    }

    let newer = newer.invoke_indexes();
    bench
        .ws
        .write()
        .expect("the vault is alive")
        .finalize_document_write(newer)
        .expect("the newer feed finalizes");

    let mut ws = bench.ws.write().expect("the vault is alive");
    assert_eq!(
        entry(&ws, &id).fingerprint,
        Some(Revision::of("from user\n")),
        "the stale feed replaced the newer core revision"
    );
    ws.deactivate_plugin(INDEX)
        .expect("the stale owner restored the provider frame");
    let observed: Vec<_> = events
        .try_iter()
        .filter(|notice| {
            matches!(
                &notice.event,
                Event::DocumentChanged { id: changed, .. } if changed == &id
            ) || matches!(
                &notice.event,
                Event::Trouble {
                    subject: Some(changed),
                    ..
                } if changed == &id
            )
        })
        .map(|notice| notice.event)
        .collect();
    assert_eq!(observed.len(), 3, "fact, loss and newer fact survive");
    assert!(matches!(observed[0], Event::DocumentChanged { .. }));
    assert!(matches!(observed[1], Event::Trouble { .. }));
    assert!(matches!(observed[2], Event::DocumentChanged { .. }));
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

    bench
        .ws
        .write()
        .unwrap()
        .set_icon(id.as_str(), Some("📌".into()))
        .expect("asset organization");
    let plugin_root = data_root(&bench.root).join("plugins").join("test.asset");
    let old_data = plugin_root.join(doc_data::path(&id, "thumbnail.bin"));
    std::fs::create_dir_all(old_data.parent().expect("data parent")).expect("data directory");
    std::fs::write(&old_data, b"preview").expect("asset side data");
    let before_rename = entry(&bench.ws.read().unwrap(), &id);
    let renamed_path = bench.root.join("media/foto.png");
    let renamed_id = DocId::new("media/foto.png");
    std::fs::create_dir_all(renamed_path.parent().expect("asset parent"))
        .expect("asset directory");
    std::fs::rename(&path, &renamed_path).expect("asset renamed");
    sync.batch(&[ExternalChange::Renamed {
        from: path.clone(),
        to: renamed_path.clone(),
    }]);

    let after_rename = entry(&bench.ws.read().unwrap(), &renamed_id);
    assert_eq!(after_rename.kind, before_rename.kind);
    assert_eq!(after_rename.size, before_rename.size);
    assert_eq!(after_rename.fingerprint, before_rename.fingerprint);
    let ws = bench.ws.read().unwrap();
    assert_eq!(
        ws.organization()
            .icons
            .get(renamed_id.as_str())
            .map(String::as_str),
        Some("📌"),
        "organization follows the asset identity"
    );
    drop(ws);
    let new_data = plugin_root.join(doc_data::path(&renamed_id, "thumbnail.bin"));
    assert_eq!(
        std::fs::read(&new_data).ok().as_deref(),
        Some(&b"preview"[..]),
        "per-document side data follows the asset identity"
    );
    assert!(!old_data.exists(), "the old side-data key is gone");
    let renamed_events: Vec<_> = events
        .try_iter()
        .filter(|notice| {
            matches!(
                &notice.event,
                Event::EntryRenamed {
                    from,
                    to,
                    kind: EntryKind::Asset
                } if from == &id && to == &renamed_id
            )
        })
        .collect();
    assert_eq!(
        renamed_events.len(),
        1,
        "an asset identity rename emits EntryRenamed exactly once"
    );

    std::fs::remove_file(&renamed_path).expect("asset removed");
    sync.batch(&[ExternalChange::Touched(renamed_path)]);
    assert_eq!(
        events
            .try_iter()
            .filter(|notice| matches!(
                &notice.event,
                Event::EntryRemoved { id: removed, kind: EntryKind::Asset } if removed == &renamed_id
            ))
            .count(),
        1,
        "removal emits EntryRemoved exactly once"
    );
}

/// Un errore della prepare non può lasciare il dispatch del watcher sospeso:
/// il lotto seguente deve rendere visibile il proprio evento.
#[test]
fn a_prepare_error_does_not_silence_the_next_watcher_batch() {
    const INDEX: &str = "test.watcher-prepare-error";

    let bench = bench();
    let from = bench.root.join("nota.md");
    let to = bench.root.join("spostata.md");
    {
        let mut ws = bench.ws.write().expect("the vault is alive");
        ws.register_core_feature(INDEX, "Watcher prepare error probe")
            .expect("index owner declares");
        ws.register_index_provider(
            INDEX,
            Box::new(PrepareErrorIndex {
                workspace: bench.ws.clone(),
                from: from.clone(),
                to: to.clone(),
                armed: AtomicBool::new(true),
            }),
        )
        .expect("prepare error index registers");
    }

    let trigger = bench.root.join("trigger.md");
    std::fs::write(&trigger, "trigger\n").expect("trigger write");
    let plan = bench
        .ws
        .read()
        .expect("the vault is alive")
        .plan_sync(&trigger)
        .expect("the trigger needs a feed");
    let parsed = plan.invoke();
    let pending = bench
        .ws
        .write()
        .expect("the vault is alive")
        .prepare_sync_path_prepared(&trigger, Some(parsed))
        .expect("the trigger prepare succeeds")
        .expect("the trigger feed is pending");

    std::fs::rename(&from, &to).expect("external document rename");
    let completed = pending.invoke();
    bench
        .ws
        .write()
        .expect("the vault is alive")
        .finish_sync_path_prepared(completed)
        .expect("the trigger feed finishes");

    let events = bench.ws.read().expect("the vault is alive").bus().subscribe();
    let asset = bench.root.join("after.png");
    let asset_id = DocId::new("after.png");
    std::fs::write(&asset, b"after").expect("second external write");
    ExternalSync::new(bench.ws.clone()).batch(&[ExternalChange::Touched(asset)]);

    assert!(
        events.try_iter().any(|notice| matches!(
            notice.event,
            Event::EntryChanged {
                id,
                kind: EntryKind::Asset
            } if id == asset_id
        )),
        "the prepare error left dispatch deferred and silenced the next batch"
    );
}
