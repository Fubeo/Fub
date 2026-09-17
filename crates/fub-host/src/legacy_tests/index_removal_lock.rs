//! Rimozione e cestino attraversano il vero Custody. I canali ordinano la
//! prova; il timeout serve soltanto a terminare una regressione bloccata.

use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::edit::WriteBase;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    DataWrite, HostApi, HostQuery, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryKind,
    QueryRoute, VaultRead, VaultStructure, VaultWrite,
};
use fub_abi::{Event, PluginError};
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, ExternalChange, ExternalSync, JobHost};
use fub_kernel::{FormatRegistry, Workspace};

const OWNER: &str = "fub.removal-probe";
const OTHER: &str = "fub.removal-independent";
const LIMIT: Duration = Duration::from_secs(10);

fn query(owner: &str) -> IndexQuery {
    IndexQuery::Custom {
        ns: owner.into(),
        query: serde_json::Value::Null,
    }
}

macro_rules! lifecycle {
    () => {
        fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
            Ok(())
        }
        fn on_documents_indexed(&mut self, _: &[DocumentModel]) -> Vec<IndexLoss> {
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
    };
}

struct Independent;
impl IndexProvider for Independent {
    lifecycle!();
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(OTHER.into()))]
    }
    fn query(&self, _: IndexQuery) -> Result<IndexResult, PluginError> {
        Ok(IndexResult::Custom(true.into()))
    }
    fn on_documents_removed(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
}

#[derive(Clone, Copy)]
enum Ending {
    Success,
    Loss,
    Panic,
}

#[derive(Debug)]
struct Observation {
    guard_free: bool,
    own_query_conflicts: bool,
    independent_query_works: bool,
    nested_write_conflicts: bool,
    nested_delete_conflicts: bool,
    no_partial_file_or_events: bool,
    data_write_works: bool,
}

struct Probe {
    workspace: Arc<Mutex<Option<Custody<Workspace>>>>,
    entered: mpsc::SyncSender<Observation>,
    release: Mutex<mpsc::Receiver<()>>,
    ending: Ending,
    first: bool,
}

impl IndexProvider for Probe {
    lifecycle!();
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(OWNER.into()))]
    }
    fn query(&self, _: IndexQuery) -> Result<IndexResult, PluginError> {
        Ok(IndexResult::Custom(true.into()))
    }
    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        if !self.first {
            return Vec::new();
        }
        self.first = false;
        let workspace = self.workspace.lock().unwrap().as_ref().unwrap().clone();
        let guard_free = workspace.try_read().is_some() && workspace.try_write().is_some();
        // La baseline rossa viene rilasciata senza tentare un deadlock.
        let observation = if guard_free {
            let events = workspace.read().unwrap().bus().subscribe();
            let mut host = JobHost::new(workspace.clone(), OWNER);
            let own_query_conflicts = matches!(
                host.query_index(query(OWNER)),
                Err(PluginError::Conflict(_))
            );
            let independent_query_works = host.query_index(query(OTHER)).is_ok();
            let nested_write_conflicts = matches!(
                host.write_document(&ids[0], "# Ricreata", WriteBase::Dictated),
                Err(PluginError::Conflict(_))
            );
            let nested_delete_conflicts = matches!(
                host.trash_document(&DocId::new("Other.md")),
                Err(PluginError::Conflict(_))
            );
            let no_partial_file_or_events = host.read_document(&ids[0]).is_err()
                && host.read_document(&DocId::new("Other.md")).unwrap() == "# Other\n"
                && events.try_recv().is_err();
            let data_write_works = host.data_write("removal-proof", b"alive").is_ok();
            Observation {
                guard_free,
                own_query_conflicts,
                independent_query_works,
                nested_write_conflicts,
                nested_delete_conflicts,
                no_partial_file_or_events,
                data_write_works,
            }
        } else {
            Observation {
                guard_free,
                own_query_conflicts: false,
                independent_query_works: false,
                nested_write_conflicts: false,
                nested_delete_conflicts: false,
                no_partial_file_or_events: false,
                data_write_works: false,
            }
        };
        self.entered.send(observation).unwrap();
        self.release
            .lock()
            .unwrap()
            .recv_timeout(LIMIT)
            .expect("rilascio del provider");
        match self.ending {
            Ending::Success => Vec::new(),
            Ending::Loss => vec![IndexLoss::new(
                ids[0].clone(),
                PluginError::Io("rimozione rifiutata dall'indice".into()),
            )],
            Ending::Panic => panic!("panic intenzionale della rimozione"),
        }
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    workspace: Custody<Workspace>,
    probe_workspace: Arc<Mutex<Option<Custody<Workspace>>>>,
    entered: mpsc::Receiver<Observation>,
    release: mpsc::SyncSender<()>,
}

impl Fixture {
    fn new(ending: Ending) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
        std::fs::write(root.join("Note.md"), "# Note\n").unwrap();
        std::fs::write(root.join("Other.md"), "# Other\n").unwrap();
        let mut formats = FormatRegistry::new();
        formats.register(MarkdownProvider::boxed()).unwrap();
        let mut ws = Workspace::new(&root, formats).unwrap();
        ws.reindex().unwrap();
        let workspace = Custody::new("removal test", ws);
        let probe_workspace = Arc::new(Mutex::new(Some(workspace.clone())));
        let (entered_tx, entered) = mpsc::sync_channel(1);
        let (release, release_rx) = mpsc::sync_channel(1);
        {
            let mut ws = workspace.write().unwrap();
            ws.register_core_feature(OWNER, "Removal probe").unwrap();
            ws.register_core_feature(OTHER, "Independent probe")
                .unwrap();
            ws.register_index_provider(OTHER, Box::new(Independent))
                .unwrap();
            ws.register_index_provider(
                OWNER,
                Box::new(Probe {
                    workspace: Arc::clone(&probe_workspace),
                    entered: entered_tx,
                    release: Mutex::new(release_rx),
                    ending,
                    first: true,
                }),
            )
            .unwrap();
        }
        Self {
            _dir: dir,
            root,
            workspace,
            probe_workspace,
            entered,
            release,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.probe_workspace.lock().unwrap().take();
    }
}

fn run(ending: Ending, watcher: bool) {
    let fixture = Fixture::new(ending);
    let notices = fixture.workspace.read().unwrap().bus().subscribe();
    let workspace = fixture.workspace.clone();
    let path = fixture.root.join("Note.md");
    let (done_tx, done) = mpsc::sync_channel(1);
    let worker = std::thread::spawn(move || {
        if watcher {
            std::fs::remove_file(&path).unwrap();
            ExternalSync::new(workspace).batch(&[ExternalChange::Touched(path)]);
        } else {
            JobHost::new(workspace, OWNER)
                .trash_document(&DocId::new("Note.md"))
                .unwrap();
        }
        done_tx.send(()).unwrap();
    });
    let observation = fixture
        .entered
        .recv_timeout(LIMIT)
        .expect("ingresso nella callback");
    // Progresso di un vero lettore concorrente mentre la callback è sospesa.
    let reader_progress = if observation.guard_free {
        let workspace = fixture.workspace.clone();
        let (read_tx, read_rx) = mpsc::sync_channel(1);
        let reader = std::thread::spawn(move || {
            let ws = workspace.read().unwrap();
            read_tx.send(ws.is_closed()).unwrap();
        });
        let result = read_rx
            .recv_timeout(LIMIT)
            .expect("lettore indipendente progredisce");
        reader.join().unwrap();
        !result
    } else {
        false
    };
    assert!(
        notices.try_recv().is_err(),
        "eventi di rimozione prima del ritorno degli indici"
    );
    fixture.release.send(()).unwrap();
    done.recv_timeout(LIMIT).expect("rimozione completata");
    worker.join().unwrap();
    assert!(observation.guard_free && reader_progress, "{observation:?}");
    assert!(
        observation.own_query_conflicts && observation.independent_query_works,
        "{observation:?}"
    );
    assert!(
        observation.nested_write_conflicts
            && observation.nested_delete_conflicts
            && observation.no_partial_file_or_events,
        "{observation:?}"
    );
    assert!(observation.data_write_works, "{observation:?}");
    let events: Vec<_> = notices.try_iter().map(|notice| notice.event).collect();
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, Event::DocumentRemoved { .. }))
            .count(),
        1
    );
    let removed = events
        .iter()
        .position(|event| matches!(event, Event::DocumentRemoved { .. }))
        .expect("la rimozione viene annunciata");
    let indexed = events
        .iter()
        .position(|event| matches!(event, Event::IndexUpdated | Event::BatchEnded { .. }))
        .expect("il completamento dell'indice viene annunciato");
    assert!(
        removed < indexed,
        "la rimozione precede il completamento dell'indice: {events:?}"
    );
    let losses = events
        .iter()
        .filter(|event| matches!(event, Event::Trouble { .. }))
        .count();
    assert_eq!(losses, usize::from(!matches!(ending, Ending::Success)));
    let mut host = JobHost::new(fixture.workspace.clone(), OWNER);
    host.write_document(&DocId::new("Note.md"), "# Ricreata", WriteBase::Dictated)
        .expect("il frame è stato ripristinato");
    assert_eq!(
        host.read_document(&DocId::new("Note.md")).unwrap(),
        "# Ricreata"
    );
    assert!(host.query_index(query(OWNER)).is_ok());
}

#[test]
fn trash_releases_custody_and_rejects_only_conflicting_reentry() {
    run(Ending::Success, false);
}
#[test]
fn watcher_removal_releases_custody_and_preserves_event_order() {
    run(Ending::Success, true);
}
#[test]
fn removal_reports_provider_losses_and_recovers_after_panic() {
    run(Ending::Loss, false);
    run(Ending::Panic, false);
}

#[test]
fn ungranted_and_dry_run_trash_leave_file_and_events_unchanged() {
    let fixture = Fixture::new(Ending::Success);
    let events = fixture.workspace.read().unwrap().bus().subscribe();
    for mut host in [
        JobHost::new(fixture.workspace.clone(), "unknown"),
        JobHost::new(fixture.workspace.clone(), OWNER).in_mode(InvokeMode::DryRun),
    ] {
        assert!(matches!(
            host.trash_document(&DocId::new("Note.md")),
            Err(PluginError::PermissionDenied(_))
        ));
    }
    assert_eq!(
        std::fs::read_to_string(fixture.root.join("Note.md")).unwrap(),
        "# Note\n"
    );
    assert!(events.try_recv().is_err());
}
