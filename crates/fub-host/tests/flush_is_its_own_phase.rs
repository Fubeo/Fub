//! **Il flush degli indici è una fase sua** (difetto 0113): fra la chiusura
//! dell'indicizzazione e la durevolezza il lucchetto si rilascia, e un lettore
//! concorrente non aspetta la somma delle fasi ma la sola che sta correndo.
//!
//! # Perché questo banco esiste
//!
//! Il difetto era il perimetro del prestito esclusivo di `finish_index`: cinque
//! fasi in fila — la ricostruzione del grafo, la riconciliazione, il flush
//! degli indici, il ricongiungimento delle rinomine, la riscrittura
//! dell'anagrafe — e tre di esse toccano il disco. Un lettore concorrente
//! aspettava la somma di tutte e cinque invece della sola indicizzazione.
//!
//! La riparazione segue il pattern a fasi di `ExternalSync::batch`: il flush
//! esce dal prestito della chiusura e diventa un prestito esclusivo **suo**,
//! come fa il runner in `advance_opening`. Le fasi che toccano lo stato
//! condiviso del workspace — la riconciliazione delle tabelle degli indici, il
//! ricongiungimento che cammina l'anagrafe — restano dove sono: il difetto
//! chiede di ridurre l'attesa, non di ridisegnare il kernel.
//!
//! # Come si osserva
//!
//! Due osservabili, uno per ciascuna metà della proprietà.
//!
//! **Il lettore passa fra le fasi.** Il banco monta un `Workspace` vero dentro
//! una [`Custody`] e lo apre con le stesse fasi del runner — `scan_vault`,
//! grafo fuori dal lucchetto, `finish_index_with_graph`, `flush_indexes`,
//! `store_entries` — con due barriere a tenere fermo l'apritore fra il prestito
//! della chiusura e quello del flush. Nel punto in cui il difetto teneva il
//! lucchetto, il lettore chiede «lo posso avere adesso?» (`try_read`, l'idioma
//! di `concorrenza.rs`) e lo riceve: la custodia non è tenuta da nessuno.
//!
//! **Il flush è una chiamata sola.** Un indice che conta i propri `flush`
//! dimostra il contratto dal lato del kernel: nella sequenza del runner il
//! flush deve essere chiamato **una** volta sola — quella della fase sua. Se
//! qualcuno rimettesse il flush dentro `finish_index_with_graph`, il conto
//! salirebbe a due e il banco sarebbe rosso.
//!
//! # Chi è stato rosso
//!
//! Il secondo osservabile, con il flush dentro `finish_index_with_graph`: il
//! conto fa `2` invece di `1`. Il primo è **verde anche prima, e dichiarato** —
//! come il secondo banco di `l_anagrafe_si_chiude_con_il_vault.rs`: il montaggio
//! controlla i prestiti, quindi il lettore passa anche col difetto in piedi. È
//! la metà che mostra l'osservabile che il difetto nomina; il conto dei flush è
//! la metà che tiene fermo il contratto.
//! contract.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};

use camino::Utf8PathBuf;
use fub_abi::error::PluginError;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute};
use fub_host::Custody;
use fub_kernel::storage::VaultStorage;
use fub_kernel::{FormatRegistry, MachineSettings, MemStorage, Workspace};
use fub_testkit::SampleText;

const ROOT: &str = "/vault-flush-fase-sua";
/// Quante note. Non tre: il numero deve essere abbastanza grande da rendere
/// credibile che le fasi durino, e abbastanza piccolo da non pesare sul banco.
const NOTE: usize = 40;

/// Un indice che **conta i propri flush** e per il resto non fa niente: è
/// l'`IndiceCheRifiuta` di `quando_qualcosa_va_storto.rs` ridotto a una
/// domanda sola — quante volte il kernel gli ha chiesto di rendere durevole
struct CountingIndex {
    flush: Arc<AtomicUsize>,
}

impl IndexProvider for CountingIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn on_documents_indexed(&mut self, _docs: &[DocumentModel]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.flush.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("nothing".into()))
    }
}

fn seed(storage: &Arc<MemStorage>) {
    for the in 0..NOTE {
        storage
            .write(
                &Utf8PathBuf::from(format!("{ROOT}/nota{the:04}.txt")),
                format!("nota{the:04}\n").as_bytes(),
            )
            .expect("seed");
    }
}

#[test]
fn flush_is_its_own_phase() {
    let storage = Arc::new(MemStorage::new());
    seed(&storage);

    let mut registry = FormatRegistry::new();
    registry
        .register(SampleText::by_extension("txt").boxed())
        .expect("no extension conflict");

    let flush = Arc::new(AtomicUsize::new(0));
    let mut ws = Workspace::on(
        ROOT,
        registry,
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("vault opens");
    ws.register_core_feature("test.flush", "test.flush")
        .expect("declared");
    ws.register_index_provider(
        "test.flush",
        Box::new(CountingIndex {
            flush: Arc::clone(&flush),
        }),
    )
    .expect("registered");

    let custody = Custody::new("the open vault", ws);
    let barrier = Arc::new(Barrier::new(2));

    // L'apritore: le stesse fasi del runner (`advance_opening`), con la stessa
    // separazione dei prestiti. Le due barriere tengono fermo il punto fra la
    // chiusura dell'indicizzazione e il flush, che è il punto in cui il
    let open = {
        let custody = Custody::clone(&custody);
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            let work = {
                let mut ws = custody.write().expect("write");
                ws.scan_vault().expect("scan")
            };
            let graph = {
                let ws = custody.read().expect("read");
                ws.graph_sources().build()
            };
            {
                let mut ws = custody.write().expect("write");
                ws.finish_index_with_graph(work, graph);
            }
            // Fra i due prestiti esclusivi il lucchetto si rilascia: è qui che
            // il lettore deve passare.
            barrier.wait();
            barrier.wait();
            {
                let mut ws = custody.write().expect("write");
                let _ = ws.flush_indexes();
            }
            {
                let ws = custody.read().expect("read");
                ws.store_entries();
            }
        })
    };

    // Il lettore: nel punto in cui il difetto teneva il lucchetto, il prestito
    // condiviso si ha subito. La barriera di ritorno tiene l'apritore fermo
    // finché l'osservazione non è fatta — il banco è deterministico, non
    // cronometra.
    barrier.wait();
    let reader = custody.try_read();
    assert!(
        reader.is_some(),
        "between closing indexing and flush the lock is still held: a \
         concurrent reader waits for the sum of phases (0113)"
    );
    drop(reader);
    barrier.wait();
    open.join().expect("opening must not panic");

    assert_eq!(
        flush.load(Ordering::Relaxed),
        1,
        "flush was called {} times: in the runner sequence it must be called \
         once only — the one in its own phase. If the flush is inside \
         `finish_index_with_graph` the count rises to two (0113)",
        flush.load(Ordering::Relaxed)
    );
}
