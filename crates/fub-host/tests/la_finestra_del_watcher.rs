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
//! sta eseguendo, e subito dopo `monta` riconcilia. L'evento è **nella
//! finestra** per costruzione, non per fortuna. Che esca **una volta sola** si
//! conta sul racconto del ponte: il cambiamento del file lo dice la
//! riconciliazione, e nessun'altra riga dell'apertura ha un `DocumentChanged`
//! per quella nota — la seconda fase alimenta gli indici in silenzio (§15.7).

use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::event::EventKind;
use fub_abi::{Event, Notice};
use fub_host::{Consegna, Custodia, EventSink, Host, NoWatcher, VaultWatcher, WatcherFactory};
use fub_kernel::Workspace;

/// La fabbrica che inietta l'evento **dentro la finestra**: il suo `start`
/// viene chiamato a finestra aperta — la scansione è già finita, il rilevatore
/// non è ancora acceso — e scrive la nota lì.
struct Finestra {
    nota: Utf8PathBuf,
}

impl WatcherFactory for Finestra {
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: Custodia<Workspace>,
        _watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        // L'evento nella finestra: dopo la scansione (che ha letto «prima»),
        // prima che il rilevatore guardi. `NoWatcher` è il rilevatore onesto
        // per chi non guarda: niente debouncer, niente tempi.
        std::fs::write(&self.nota, "dopo\n").expect("l'evento nella finestra");
        Ok(Box::new(NoWatcher))
    }
}

/// Un sink che spedisce tutto ciò che il ponte consegna su un canale: il banco
/// drena quando vuole, e non c'è un lucchetto da aprire per leggere.
struct Registrato(Sender<Notice>);

impl EventSink for Registrato {
    fn emit(&self, notice: &Notice) -> Consegna {
        let _ = self.0.send(notice.clone());
        Consegna::Fatta
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
fn un_evento_nella_finestra_fra_scansione_e_rilevatore_esce_una_volta_sola() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let nota = root.join("nota.md");
    std::fs::write(&nota, "prima\n").expect("la nota alla scansione");

    let (uscita, entrata) = channel();
    let host = Host::new()
        .with_watcher(Box::new(Finestra { nota: nota.clone() }))
        .with_sink(Arc::new(Registrato(uscita)));

    host.open(&root).expect("il vault si apre");

    // Il ponte ha un freno (§10.2): la consegna si aspetta, e se non arriva il
    // test fallisce sul tempo massimo invece che sul primo giro. Il `JobDone`
    // dell'indicizzazione chiude il conto: tutto ciò che l'apertura ha emesso
    // prima di lui è già passato (un filo solo, in ordine), e dopo di lui
    // niente tocca più la nota.
    let mut visti: Vec<Notice> = Vec::new();
    let scaduto = Instant::now() + Duration::from_secs(5);
    while Instant::now() < scaduto {
        visti.extend(entrata.try_iter());
        if visti.iter().any(|n| n.event.kind() == EventKind::JobDone) {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    // L'ultima raffica, per ciò che il `JobDone` si portava dietro in coda.
    visti.extend(entrata.try_iter());

    let specie: Vec<EventKind> = visti.iter().map(|n| n.event.kind()).collect();
    assert!(
        specie.contains(&EventKind::JobDone),
        "l'indicizzazione si è raccontata fino in fondo: {specie:?}"
    );

    let per_nota = visti
        .iter()
        .filter(|n| {
            matches!(
                &n.event,
                Event::DocumentChanged { id, .. } if id.as_str() == "nota.md"
            )
        })
        .count();
    assert_eq!(
        per_nota, 1,
        "l'evento nella finestra esce una volta sola: {visti:?}"
    );
}
