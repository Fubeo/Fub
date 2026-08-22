//! **La finestra fra la scansione e il rilevatore si chiude** (§15.7,
//! [decisione 0070](../../../docs/decisions/0070-un-vault-si-apre-in-due-tempi.md)):
//! un cambiamento esterno che cade fra le due non è nella fotografia della
//! scansione e non è ancora guardato dal rilevatore, e senza una
//! riconciliazione nessun evento lo recupererebbe fino alla riapertura.
//!
//! La riconciliazione vive dove la finestra vive — nell'apertura, che è fatta
//! di thread — e quindi questa prova sta qui, nel crate che quei thread li
//! monta. La forma è quella delle altre: un `Host` vero, un sink che registra
//! ciò che esce, e un rilevatore **finto**, per non provare il debouncer
//! insieme alla finestra.
//!
//! Il trucco della prova è dove la fabbrica scrive: dentro `start`. Quando la
//! fabbrica viene chiamata la scansione è già finita — ha letto «prima» — e il
//! rilevatore non è ancora acceso: il suo `start` è la riga che la fabbrica
//! sta eseguendo, e subito dopo `mount` riconcilia. L'evento è **nella
//! finestra** per costruzione, non per fortuna. Che esca **una volta sola** si
//! conta sul racconto del ponte: il cambiamento del file lo dice la
//! riconciliazione, e nessun'altra riga dell'apertura ha un `DocumentChanged`
//! per quella nota — la seconda fase alimenta gli indici in silenzio (§15.7).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::event::EventKind;
use fub_abi::{Event, Notice};
use fub_host::{
    Custody, Delivery, EventSink, ExternalChange, ExternalSync, Host, VaultWatcher, WatcherFactory,
};
use fub_kernel::Workspace;

struct WatcherWindow {
    handle: Option<std::thread::JoinHandle<()>>,
}

impl VaultWatcher for WatcherWindow {
    fn is_watching(&self) -> bool {
        true
    }
}

impl Drop for WatcherWindow {
    fn drop(&mut self) {
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// La fabbrica che inietta un cambiamento esterno durante l'apertura:
/// il rilevatore si avvia prima della scansione, e consegna l'evento
/// attraverso [`ExternalSync::batch`].
struct Window {
    notes: Utf8PathBuf,
}

impl WatcherFactory for Window {
    fn start(
        &self,
        _root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        watching.store(true, Ordering::Relaxed);
        let notes = self.notes.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            std::fs::write(&notes, "dopo\n").expect("event during the open");
            let mut sync = ExternalSync::new(workspace);
            sync.batch(&[ExternalChange::Touched(notes)]);
        });
        Ok(Box::new(WatcherWindow {
            handle: Some(handle),
        }))
    }
}

/// Un sink che spedisce tutto ciò che il ponte consegna su un canale: il banco
/// drena quando vuole, e non c'è un lucchetto da aprire per leggere.
struct Registered(Sender<Notice>);

impl EventSink for Registered {
    fn emit(&self, notice: &Notice) -> Delivery {
        let _ = self.0.send(notice.clone());
        Delivery::Done
    }
}

/// **Un evento caduto nella finestra fra la scansione e il rilevatore esce
/// una volta sola.**
///
/// La prova conta i `DocumentChanged` della nota iniettata sul racconto
/// completo dell'apertura: quando il `JobDone` dell'indicizzazione è passato
/// dal ponte, ogni evento emesso prima di lui è passato anche — il ponte è un
/// filo solo, e consegna in ordine (§10.2) — e il `DocumentChanged` per quella
/// nota è uno.
#[test]
fn event_in_window_between_scan_and_detector_exits_exactly_once() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let notes = root.join("nota.md");
    std::fs::write(&notes, "prima\n").expect("note at scan time");

    let (output, entered) = channel();
    let host = Host::new()
        .with_watcher(Box::new(Window {
            notes: notes.clone(),
        }))
        .with_sink(Arc::new(Registered(output)));

    host.open(&root).expect("vault opens");

    // Il ponte ha un freno (§10.2): la consegna si aspetta, e se non arriva il
    // test fallisce sul tempo massimo invece che sul primo giro. Il `JobDone`
    // dell'indicizzazione chiude il conto: tutto ciò che l'apertura ha emesso
    // prima di lui è già passato (un filo solo, in ordine), e dopo di lui
    // niente tocca più la nota.
    let mut seen: Vec<Notice> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        seen.extend(entered.try_iter());
        if seen.iter().any(|n| n.event.kind() == EventKind::JobDone)
            && seen.iter().any(|n| matches!(&n.event, Event::DocumentChanged { id, .. } if id.as_str() == "nota.md"))
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    // L'ultima raffica, per ciò che il `JobDone` si portava dietro in coda.
    seen.extend(entered.try_iter());

    let kinds: Vec<EventKind> = seen.iter().map(|n| n.event.kind()).collect();
    assert!(
        kinds.contains(&EventKind::JobDone),
        "indexing reported all the way to the end: {kinds:?}"
    );

    let for_notes = seen
        .iter()
        .filter(|n| {
            matches!(
                &n.event,
                Event::DocumentChanged { id, .. } if id.as_str() == "nota.md"
            )
        })
        .count();
    assert_eq!(
        for_notes, 1,
        "the event in the window comes out exactly once: {seen:?}"
    );
}
