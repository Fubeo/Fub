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
use fub_host::{Consegna, EventSink, Host, NoWatcher};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    /// Un vault con `quante` note: abbastanza da avere un'indicizzazione che
    /// esiste come fase, senza dipendere da quanto è veloce il disco.
    fn con(quante: usize) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        for n in 0..quante {
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
    fn emit(&self, notice: &Notice) -> Consegna {
        self.0.lock().unwrap().push(notice.clone());
        Consegna::Fatta
    }
}

fn stato(host: &Host) -> IndexingState {
    let ws = host.workspace(None).expect("un vault è aperto");
    let ws = ws.read().unwrap();
    match ws.query_index(IndexQuery::VaultStatus) {
        Ok(IndexResult::VaultStatus(s)) => s.indexing,
        altro => panic!("atteso lo stato del vault, trovato {altro:?}"),
    }
}

/// **Chi apre non aspetta chi indicizza**, ed è tutto il punto della voce.
///
/// La prova non è cronometrica — cronometrare vorrebbe dire presidiare la
/// velocità del disco — ma di **stato**: al ritorno di `open` il vault dichiara
/// di stare ancora indicizzando, e più tardi dichiara di aver finito. Le due
/// risposte diverse sono la fase che prima non esisteva.
#[test]
fn open_torna_prima_che_l_indice_sia_pieno() {
    let v = Vault::con(400);
    let host = Host::new().with_watcher(Box::new(NoWatcher));

    host.open(&v.root).expect("il vault si apre");

    // Il vault è **utilizzabile adesso**: l'anagrafe è intera, e una nota si
    // legge. È ciò che rende onesto non aver aspettato.
    let entries = {
        let ws = host.workspace(None).expect("aperto");
        let ws = ws.read().unwrap();
        match ws.query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        }) {
            Ok(IndexResult::Entries(p)) => p.total,
            altro => panic!("attesa l'anagrafe, trovato {altro:?}"),
        }
    };
    assert_eq!(entries, 400, "l'anagrafe è intera prima di aver letto");

    host.wait_indexed(None).expect("aspetta");
    assert_eq!(
        stato(&host),
        IndexingState::Ready,
        "finita l'indicizzazione, l'indice risponde per tutto ciò che c'è"
    );
    let indicizzati = {
        let ws = host.workspace(None).expect("aperto");
        let n = ws.read().unwrap().documents().len();
        n
    };
    assert_eq!(indicizzati, 400, "e ha tutti i documenti");
}

/// **L'indicizzazione si racconta come un lavoro lungo qualunque** (§10.3).
///
/// È la ragione per cui è un job invece di un meccanismo accanto ai job: il
/// centro attività la disegna senza avere un ramo per l'apertura, e il pulsante
/// che ferma un export ferma anche questa.
#[test]
fn l_apertura_e_un_job_come_gli_altri() {
    let v = Vault::con(400);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_sink(Arc::new(Collected(seen.clone())));

    host.open(&v.root).expect("il vault si apre");
    host.wait_indexed(None).expect("aspetta");

    // Il ponte ha un freno (§10.2): la consegna si aspetta, e se non arriva il
    // test fallisce sul tempo massimo invece che sul primo giro.
    let scaduto = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < scaduto {
        let arrivato = seen
            .lock()
            .unwrap()
            .iter()
            .any(|n: &Notice| n.event.kind() == EventKind::JobDone);
        if arrivato {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    let visti = seen.lock().unwrap().clone();
    let specie: Vec<EventKind> = visti.iter().map(|n| n.event.kind()).collect();
    assert!(
        specie.contains(&EventKind::JobStarted),
        "l'apertura si annuncia: {specie:?}"
    );
    assert!(
        specie.contains(&EventKind::JobDone),
        "e ne torna un esito: {specie:?}"
    );

    // **Il progresso porta un totale.** L'apertura è il caso per cui
    // `JobProgress::total` è un'opzione: la scansione sa quanti sono, quindi
    // qui una barra può dire il vero invece di girare a vuoto.
    let progressi: Vec<_> = visti
        .iter()
        .filter_map(|n| match &n.event {
            fub_abi::Event::JobProgress { progress, .. } => Some(progress.clone()),
            _ => None,
        })
        .collect();
    assert!(
        !progressi.is_empty(),
        "un'apertura da 400 note dice a che punto è"
    );
    assert!(
        progressi.iter().all(|p| p.total == Some(400)),
        "il totale lo sa la scansione: {progressi:?}"
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
fn chiudere_a_meta_indicizzazione_non_lascia_un_lavoro_appeso() {
    let v = Vault::con(400);
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("il vault si apre");

    // Si chiude **senza aspettare**: che l'indicizzazione sia già finita o no
    // dipende dal disco, e la promessa deve valere in tutti e due i casi.
    let root = host.vaults().into_iter().next().expect("un vault aperto");
    host.close_vault(&root).expect("il vault si chiude");

    assert!(
        host.vaults().is_empty(),
        "chiudere ha aspettato chi lavorava, e il vault non c'è più"
    );
}
