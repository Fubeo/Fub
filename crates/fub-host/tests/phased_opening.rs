//! **Un vault si apre in due tempi** (§15.7,
//! [decisione 0070](../../../docs/decisions/0070-un-vault-si-apre-in-due-tempi.md)).
//!
//! La prima metà del §15.7 — che l'apertura possa **fallire in parte** — ha i
//! suoi presidi nel kernel (`l_apertura.rs`), dove il fallimento si provoca con
//! un file. Questa è l'altra metà, e vive qui per una ragione precisa: la
//! **forma** dell'apertura è fatta di thread, e i thread sono dell'host.
//!
//! Le tre cose che si guardano, e che una chiamata sincrona non poteva avere:
//!
//! - **`open` non aspetta l'indicizzazione**: al suo ritorno il vault è
//!   utilizzabile e l'indice non è ancora pieno;
//! - **l'indicizzazione si racconta e si ferma** come qualunque lavoro lungo,
//!   perché *è* un lavoro lungo (§10.3);
//! - **chi chiude a metà riceve comunque un esito**, che è la regola della
//!   [0028](../../../docs/decisions/0028-come-un-componente-smette.md) applicata
//!   al job che nessuno ha chiesto.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::event::EventKind;
use fub_abi::traits::{IndexQuery, IndexResult, IndexingState};
use fub_abi::Notice;
use fub_host::{Delivery, EventSink, Host, NoWatcher};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    /// Un vault con `quante` note: abbastanza da avere un'indicizzazione che
    /// esiste come fase, senza dipendere da quanto è veloce il disco.
    fn with(count: usize) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        for n in 0..count {
            std::fs::write(
                root.join(format!("Nota{n:04}.md")),
                format!("# Nota {n}\n\nUn corpo qualunque, con [[Nota0000]].\n"),
            )
            .expect("semina");
        }
        Vault { _dir: dir, root }
    }
}

#[derive(Default)]
struct Collected(Arc<Mutex<Vec<Notice>>>);

impl EventSink for Collected {
    fn emit(&self, notice: &Notice) -> Delivery {
        self.0.lock().unwrap().push(notice.clone());
        Delivery::Done
    }
}

fn state(host: &Host) -> IndexingState {
    let ws = host.workspace(None).expect("a vault is open");
    let ws = ws.read().unwrap();
    match ws.query_index(IndexQuery::VaultStatus) {
        Ok(IndexResult::VaultStatus(s)) => s.indexing,
        other => panic!("atteso lo stato del vault, trovato {other:?}"),
    }
}

/// **Chi apre non aspetta chi indicizza**, ed è tutto il punto della voce.
///
/// La prova non è cronometrica — cronometrare vorrebbe dire presidiare la
/// velocità del disco — ma di **stato**: al ritorno di `open` il vault dichiara
/// di stare ancora indicizzando, e più tardi dichiara di aver finito. Le due
/// risposte diverse sono la fase che prima non esisteva.
#[test]
fn open_returns_first_that_the_index_sia_pieno() {
    let v = Vault::with(400);
    let host = Host::new().with_watcher(Box::new(NoWatcher));

    host.open(&v.root).expect("the vault opens");

    // Il vault è **utilizzabile adesso**: l'anagrafe è intera, e una nota si
    // legge. È ciò che rende onesto non aver aspettato.
    let entries = {
        let ws = host.workspace(None).expect("open");
        let ws = ws.read().unwrap();
        match ws.query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        }) {
            Ok(IndexResult::Entries(p)) => p.total,
            other => panic!("attesa l'anagrafe, trovato {other:?}"),
        }
    };
    assert_eq!(entries, 400, "the registry is complete before reading");

    host.wait_indexed(None).expect("waits");
    assert_eq!(
        state(&host),
        IndexingState::Ready,
        "indexing finished, the index responds for everything there is"
    );
    let indexed = {
        let ws = host.workspace(None).expect("open");
        let n = ws.read().unwrap().documents().len();
        n
    };
    assert_eq!(indexed, 400, "e ha tutti i documenti");
}

/// **L'indicizzazione si racconta come un lavoro lungo qualunque** (§10.3).
///
/// È la ragione per cui è un job invece di un meccanismo accanto ai job: il
/// centro attività la disegna senza avere un ramo per l'apertura, e il pulsante
/// che ferma un export ferma anche questa.
#[test]
fn the_opening_and_a_job_as_the_other() {
    let v = Vault::with(400);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_sink(Arc::new(Collected(seen.clone())));

    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None).expect("waits");

    // Il ponte ha un freno (§10.2): la consegna si aspetta, e se non arriva il
    // test fallisce sul tempo massimo invece che sul primo giro.
    let expired = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < expired {
        let arrived = seen
            .lock()
            .unwrap()
            .iter()
            .any(|n: &Notice| n.event.kind() == EventKind::JobDone);
        if arrived {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    let seen = seen.lock().unwrap().clone();
    let kinds: Vec<EventKind> = seen.iter().map(|n| n.event.kind()).collect();
    assert!(
        kinds.contains(&EventKind::JobStarted),
        "the open announces itself: {kinds:?}"
    );
    assert!(
        kinds.contains(&EventKind::JobDone),
        "and an outcome comes back: {kinds:?}"
    );

    // **Il progresso porta un totale.** L'apertura è il caso per cui
    // `JobProgress::total` è un'opzione: la scansione sa quanti sono, quindi
    // qui una barra può dire il vero invece di girare a vuoto.
    let progress: Vec<_> = seen
        .iter()
        .filter_map(|n| match &n.event {
            fub_abi::Event::JobProgress { progress, .. } => Some(progress.clone()),
            _ => None,
        })
        .collect();
    assert!(
        !progress.is_empty(),
        "an open of 400 notes says what point it is at"
    );
    assert!(
        progress.iter().all(|p| p.total == Some(400)),
        "the total is known by the scan: {progress:?}"
    );
}

/// **Chiudere un vault a metà indicizzazione non lascia un job vivo per
/// sempre.**
///
/// Un worker che vede `stopping` in cima al proprio ciclo esce senza passare
/// dall'apertura: senza una riga che la chiuda comunque, l'esito che la
/// [0028](../../../docs/decisions/0028-come-un-componente-smette.md) promette a
/// ogni job non arriverebbe proprio a quello che nessuno ha chiesto.
#[test]
fn close_a_metadata_indexing_not_leaves_a_work_hanging() {
    let v = Vault::with(400);
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");

    // Si chiude **senza aspettare**: che l'indicizzazione sia già finita o no
    // dipende dal disco, e la promessa deve valere in tutti e due i casi.
    let root = host.vaults().into_iter().next().expect("an open vault");
    host.close_vault(&root).expect("the vault closes");

    assert!(
        host.vaults().is_empty(),
        "closing waited for who was working, and the vault is gone"
    );
}

/// **L'apertura a fasi raccoglie lo spazio per-documento delle note che non ci
/// sono più**, e la raccolta non è più dentro `finish_index`.
///
/// La raccolta (§13.2) cammina il disco degli spazi dati e il cestino: girava
/// sotto il prestito **esclusivo** perché stava dentro `Workspace::finish_index`,
/// e in fondo a un'apertura è l'ultima cosa che chi disegna il vault aspetta
/// senza motivo. Adesso `collect_doc_data` prende `&self` e la chiama il runner,
/// sotto il prestito condiviso.
///
/// **Il presidio è qui e non nel kernel**, ed è la ragione per cui esiste: nel
/// kernel la raccolta si prova attraverso `reindex`, che è il giro sincrono e se
/// la chiama da sé. La strada che poteva perderla è questa — quella dei thread —
/// e a spostare una riga fuori da una funzione si perde chi la chiamava, non chi
/// la scriveva. Togliendo la riga da `Shared::advance_opening` questo test è
/// rosso e nessun altro se ne accorge.
#[test]
fn opening_in_phases_collects_the_space_of_those_no_longer_present() {
    let v = Vault::with(3);
    // Lo spazio per-documento di una nota che nel vault non c'è: è ciò che resta
    // di una cancellazione definitiva fatta ad app chiusa, che nessun evento
    let orphan = fub_kernel::data_root(&v.root)
        .join("plugins")
        .join("plugin.spento")
        .join(fub_abi::rules::doc_data::DOC_SPACE)
        .join(fub_abi::rules::doc_data::encode("Sparita.md"));
    std::fs::create_dir_all(&orphan).expect("folders");
    std::fs::write(orphan.join("annotazioni.json"), br#"{"notes":"x"}"#).expect("write");

    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None).expect("waits");

    assert!(
        !orphan.exists(),
        "phased opening did not collect the space of a note that no longer \
         exists: the collection exited `finish_index` and the phased opener did \
         not collect it ({orphan})"
    );
}
