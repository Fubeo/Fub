//! **Chi chiude torna** (§9.3, decisione 0032): il presidio della corsa fra
//! [`JobRunner::stop`] e il ciclo di un thread del pool.
//!
//! `stop` alza `stopping` e **poi** suona il campanello, mentre un thread legge
//! `stopping` in cima al ciclo e prende il biglietto subito dopo. Nell'istante
//! fra i due — controllo passato, `store` non ancora visto — il thread prende
//! un biglietto già oltre la suonata, trova la coda vuota e si mette ad
//! aspettare una campana che non suonerà mai più: chi chiude lo aspetta per
//! sempre.
//!
//! Il presidio non aspetta che lo scheduler scelga quella finestra. Il gancio
//! di test ferma il worker subito dopo il controllo in cima; la prova chiede
//! allora la chiusura, lascia che il worker prenda il biglietto già oltre la
//! suonata e verifica che il ricontrollo dopo il drenaggio lo faccia tornare.
//! Senza quel ricontrollo il watchdog fallisce per un deadlock reale, non per
//! una soglia di prestazioni.

use std::time::Duration;

use camino::Utf8PathBuf;
use fub_host::{BundleRegistry, Custody, JobRunner};
use fub_kernel::Workspace;

use crate::runner::StopRaceProbe;

const WATCHDOG: Duration = Duration::from_secs(10);

#[test]
fn who_stops_a_pool_always_returns() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let workspace = Custody::new(
        "test vault",
        Workspace::new(&root, Default::default()).expect("vault opens successfully"),
    );
    let registry = Custody::new("test components", BundleRegistry::new());
    let probe = StopRaceProbe::new();
    let runner = JobRunner::start_with_stop_probe(workspace, registry, 1, None, probe.clone())
        .expect("pool starts");

    // Il worker ha passato il controllo in cima e ora è fermo prima del
    // biglietto: la chiusura può eseguire store+ring senza dover sperare
    // nell'ordine scelto dal sistema operativo.
    probe.reached();

    // Il giro sta su un thread suo perché un pool piantato pianta chi lo
    // aspetta: il watchdog è soltanto il confine dell'errore, non il via.
    let (done, outcome) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut runner = runner;
        runner.stop();
        let _ = done.send(());
    });

    assert!(
        outcome.recv_timeout(WATCHDOG).is_ok(),
        "`JobRunner::stop` did not return: a pool thread is waiting for a \
         bell that will never ring again"
    );
}
