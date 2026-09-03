//! **Il rilevatore parte prima della scansione e non perde il primo lotto**
//! (§15.7, [decisione 0070](../../../docs/decisions/0183-composizione-host-kernel.md)):
//! l'apertura tiene il writer turn (non il `RwLock`) mentre avvia il watcher,
//! fotografa il vault, registra il subscriber live e crea il job iniziale. Su
//! rollback libera quel turno prima di aspettare i thread del watcher.
//!
//! La prova vive dove quell'ordine viene montato — nell'apertura, fatta di
//! thread — e quindi sta qui, nel crate che quei thread li monta. La forma è
//! quella delle altre: un `Host` vero, un sink che registra ciò che esce, e un
//! rilevatore **finto**, per non provare il debouncer insieme al protocollo.
//!
//! Il trucco della prova è sincronizzare il thread del fake con il **turno** di
//! apertura: `start` parte prima della scansione, poi aspetta che il thread
//! abbia tentato la propria scrittura. Quel writer resta bloccato finché
//! subscriber live e job iniziale non sono installati; solo dopo il thread
//! scrive il file, sincronizza e consegna il lotto. Il callback `start` stesso
//! non ha invece nessun lock del workspace, come verifica il banco dedicato.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
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

/// La fabbrica che avvia il rilevatore prima della scansione: il suo callback
/// tenta una scrittura, resta trattenuto dal turno di apertura e poi consegna il
/// cambiamento attraverso [`ExternalSync::batch`].
struct Window {
    ready: Mutex<Receiver<()>>,
    attempted: Sender<()>,
}

impl WatcherFactory for Window {
    fn start(
        &self,
        root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        watching.store(true, Ordering::Relaxed);
        let notes = root.join("nota.md");
        let attempted = self.attempted.clone();
        let handle = std::thread::spawn(move || {
            attempted
                .send(())
                .expect("watcher reached the workspace write");
            let write = workspace.write().expect("the workspace is not poisoned");
            drop(write);
            std::fs::write(&notes, "dopo\n").expect("event after live setup");
            let mut sync = ExternalSync::new(workspace);
            sync.batch(&[ExternalChange::Touched(notes)]);
        });
        self.ready
            .lock()
            .map_err(|_| "watcher readiness is poisoned".to_string())?
            .recv_timeout(Duration::from_secs(5))
            .map_err(|and| format!("watcher did not reach the lock: {and}"))?;
        Ok(Box::new(WatcherWindow {
            handle: Some(handle),
        }))
    }
}

/// Un sink che spedisce tutto ciò che il ponte consegna su un canale: il banco
/// drena quando vuole, e non c'è un lucchetto da aprire per leggere.
struct Registered {
    output: Sender<Notice>,
}

impl EventSink for Registered {
    fn emit(&self, notice: &Notice) -> Delivery {
        let _ = self.output.send(notice.clone());
        Delivery::Done
    }
}

/// **Un evento del watcher avviato prima della scansione esce una volta sola.**
///
/// La prova conta i `DocumentChanged` della nota iniettata sul racconto
/// dell'apertura: il callback del watcher può avanzare solo dopo che il live
/// subscriber e il job iniziale esistono, e il `DocumentChanged` per quella
/// nota deve attraversare il ponte una sola volta.
#[test]
fn watcher_started_before_scan_delivers_one_change_after_live_setup() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let seed = root.join("seed.md");
    std::fs::write(&seed, "prima\n").expect("note at scan time");

    let (output, entered) = channel();
    let (attempted, ready) = channel();
    let host = Host::new()
        .with_watcher(Box::new(Window {
            ready: Mutex::new(ready),
            attempted,
        }))
        .with_sink(Arc::new(Registered { output }));

    host.open(&root).expect("vault opens");

    // `start` ha atteso `attempted` mentre teneva il turno di apertura; il
    // thread ha quindi potuto superare `workspace.write()` solo dopo subscriber
    // live e `begin_index_job`. Ora il ponte deve consegnare il cambiamento
    // esterno.
    let mut seen = Vec::new();
    loop {
        let notice = entered
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or_else(|err| {
                panic!("the external event reaches the sink: {err}; seen={seen:?}")
            });
        let is_target = matches!(
            &notice.event,
            Event::DocumentChanged { id, .. } if id.as_str() == "nota.md"
        );
        seen.push(notice);
        if is_target {
            break;
        }
    }
    seen.extend(entered.try_iter());

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
        "the watcher event comes out exactly once: {seen:?}"
    );
}
