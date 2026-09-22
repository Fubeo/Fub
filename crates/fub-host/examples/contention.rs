//! Il banco di misura del §8.3: quanto costa la contesa sul workspace.
//!
//! La voce diceva «misurare prima», e questo è il *prima* reso ripetibile
//! La misura passa dalle porte pubbliche di `Host`: `Exclusive` aggiunge un
//! serializzatore `Mutex` attorno a ogni lettura e scrittura, cioè il modello
//! comparabile con il vecchio mutex; `Shared` lascia lavorare le letture
//! concorrenti sotto il `RwLock` interno dell'host.
//! Non si confonde quindi la contesa artificiale del confronto con la policy
//! che l'API pubblica applica davvero.
//!
//! Il numero dei writer è il numero di chiamate completate a
//! [`Host::write_document`]. La durata registrata parte prima dell'attesa
//! del serializzatore (quando il modo è `Exclusive`) e termina dopo la
//! scrittura: include sempre attesa e scrittura.
//! Quindi `Shared` misura la latenza end-to-end della scrittura mentre letture
//! concorrenti attraversano l'host; `Exclusive` misura la stessa latenza con
//! letture e scritture messe in fila dal mutex del banco.
//!
//! Il trucco è che i due mondi si misurano nello stesso binario: sotto il
//! `Mutex` esplicito, eseguire una **lettura** è esattamente il comportamento
//! seriale del confronto che c'era. Quindi non serve un ramo git per il termine
//! di paragone — [`Mode::Exclusive`] *è* il termine di paragone, e resta
//! verificabile anche fra un anno.
//!
//! ```text
//! cargo run --release -p fub-host --example contesa
//! ```
//!
//! Tre fasi, e tre domande diverse:
//!
//! 1. **Per tipo di lettura** — quali letture scalano davvero. Non tutte: un
//!    provider può avere un lock proprio dentro il prestito condiviso, e allora
//!    il `RwLock` del workspace non lo aiuta. Vale la pena saperlo per nome.
//! 2. **A carico misto** — la curva 1 → 16 thread, che è il numero che si
//!    riporta.
//! 3. **La latenza di chi scrive** — la contropartita da controllare: un lock
//!    condiviso che facesse aspettare per sempre chi salva sarebbe un peggio
//!    travestito da meglio.
//!
//! Il vault sintetico è volutamente più grande di quelli di prova (2000 note
//! Le proprietà del lock che il banco osserva sono presidiate anche dai probe
//! [`concurrency`](../src/legacy_tests/concurrency.rs) e
//! [`query_index_lock`](../src/legacy_tests/query_index_lock.rs): qui si
//! riportano numeri, non soglie dipendenti dalla macchina.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{Excerpts, IndexQuery, Page, PropertySelect, ViewInstance};
use fub_features::{BACKLINKS_VIEW, OUTLINE_VIEW, STATS_VIEW, TAGS_VIEW};
use fub_host::{Host, NoWatcher};

const NOTES: usize = 2000;
/// Abbastanza per uscire dal rumore, abbastanza poco da poterlo rilanciare.
const DUR: Duration = Duration::from_millis(2500);

/// Come si prende il workspace per fare una **lettura**.
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    /// Un lettore alla volta: è il `Mutex` di prima, simulato prendendo il
    /// prestito esclusivo per un lavoro che esclusivo non è.
    Exclusive,
    /// N readers insieme: è il `RwLock` usato per ciò per cui c'è.
    Shared,
}

impl Mode {
    fn name(self) -> &'static str {
        match self {
            Mode::Exclusive => "exclusive (= old Mutex)",
            Mode::Shared => "shared    (= RwLock)",
        }
    }

    /// Esegue la lettura con il limite di contesa scelto.
    fn read_with(
        self,
        host: &Host,
        serial: &Mutex<()>,
        op: ReadOp,
        n: u64,
    ) -> Result<(), fub_abi::PluginError> {
        let _guard = match self {
            Mode::Exclusive => Some(serial.lock().unwrap()),
            Mode::Shared => None,
        };
        op.execute(host, n)
    }
}

/// Le sei letture del giro: le quattro view ufficiali, la ricerca, l'anteprima.
///
/// Sono il carico che il §8.3 nominava — «le letture sono le view» — più i due
/// che ci stanno accanto in ogni schermata vera: la ricerca aperta e il
/// pannello di anteprima.
#[derive(Clone, Copy)]
enum ReadOp {
    Backlinks,
    Outline,
    Tags,
    Stats,
    Search,
    Preview,
}

const READ_OPS: [(ReadOp, &str); 6] = [
    (ReadOp::Backlinks, "render_view backlinks"),
    (ReadOp::Outline, "render_view outline"),
    (ReadOp::Tags, "render_view tags"),
    (ReadOp::Stats, "render_view stats"),
    (ReadOp::Search, "query_index text"),
    (ReadOp::Preview, "render_preview"),
];
impl ReadOp {
    fn execute(self, host: &Host, the: u64) -> Result<(), fub_abi::PluginError> {
        match self {
            ReadOp::Backlinks => host
                .render_view(None, &ViewInstance::only(BACKLINKS_VIEW))
                .map(|_| ()),
            ReadOp::Outline => host
                .render_view(None, &ViewInstance::only(OUTLINE_VIEW))
                .map(|_| ()),
            ReadOp::Tags => host
                .render_view(None, &ViewInstance::only(TAGS_VIEW))
                .map(|_| ()),
            ReadOp::Stats => host
                .render_view(None, &ViewInstance::only(STATS_VIEW))
                .map(|_| ()),
            ReadOp::Search => host
                .query_index(
                    None,
                    IndexQuery::Documents {
                        matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms(
                            "concorrenza",
                        ))),
                        sort: None,
                        select: PropertySelect::None,
                        page: Some(Page::first(20)),
                        excerpts: Excerpts::Attach,
                    },
                )
                .map(|_| ()),
            ReadOp::Preview => host
                .render_preview(
                    None,
                    &DocId::new(format!("Nota {}.md", the as usize % NOTES)),
                )
                .map(|_| ()),
        }
    }
}

/// Gira `mix` su `threads` thread per [`DUR`], e rende operazioni e risultati.
fn measure(host: &Arc<Host>, mode: Mode, threads: usize, mix: &[ReadOp]) -> (f64, u64, u64) {
    let stop = Arc::new(AtomicBool::new(false));
    let successes = Arc::new(AtomicU64::new(0));
    let failures = Arc::new(AtomicU64::new(0));
    let serial = Arc::new(Mutex::new(()));
    let start = Instant::now();
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            let (host, stop, successes, failures, serial) = (
                Arc::clone(host),
                stop.clone(),
                successes.clone(),
                failures.clone(),
                serial.clone(),
            );
            let mix = mix.to_vec();
            std::thread::spawn(move || {
                let mut the = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    let operation = mix[the as usize % mix.len()];
                    match mode.read_with(&host, &serial, operation, the) {
                        Ok(()) => {
                            successes.fetch_add(1, Ordering::Relaxed);
                        }
                        Err(_) => {
                            failures.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    the += 1;
                }
            })
        })
        .collect();
    std::thread::sleep(DUR);
    stop.store(true, Ordering::Relaxed);
    for handle in handles {
        handle.join().unwrap();
    }
    (
        successes.load(Ordering::Relaxed) as f64 / start.elapsed().as_secs_f64(),
        successes.load(Ordering::Relaxed),
        failures.load(Ordering::Relaxed),
    )
}

/// La contropartita: quanto aspetta chi **scrive** mentre `threads` lettori
/// tengono il workspace. Rende attese, scritture riuscite e guasti.
fn write_latency(host: &Arc<Host>, mode: Mode, threads: usize) -> (f64, f64, u64, u64) {
    let stop = Arc::new(AtomicBool::new(false));
    let serial = Arc::new(Mutex::new(()));
    let readers: Vec<_> = (0..threads)
        .map(|t| {
            let (host, stop, serial) = (Arc::clone(host), stop.clone(), serial.clone());
            std::thread::spawn(move || {
                let mut the = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    let _ = mode.read_with(&host, &serial, ReadOp::Preview, the);
                    the += 1;
                }
            })
        })
        .collect();

    // Un attimo perché i lettori entrino in regime.
    std::thread::sleep(Duration::from_millis(200));

    let mut waits = Vec::new();
    let end = Instant::now() + Duration::from_millis(2000);
    let mut writes = 0u64;
    let mut failures = 0u64;
    while Instant::now() < end {
        let started = Instant::now();
        let result = {
            let _guard = match mode {
                Mode::Exclusive => Some(serial.lock().unwrap()),
                Mode::Shared => None,
            };
            host.write_document(
                None,
                &DocId::new("Scrittore.md"),
                &format!("# Scrittore\n\ngiro {writes}\n"),
                WriteBase::Dictated,
            )
        };
        waits.push(started.elapsed().as_secs_f64() * 1000.0);
        match result {
            Ok(_) => writes += 1,
            Err(_) => failures += 1,
        }
        // Un salvataggio ogni tanto, non un ciclo stretto: è il ritmo di chi
        // scrive a mano, che è il caso che conta.
        std::thread::sleep(Duration::from_millis(5));
    }
    stop.store(true, Ordering::Relaxed);
    for handle in readers {
        handle.join().unwrap();
    }

    waits.sort_by(f64::total_cmp);
    let median = waits[waits.len() / 2];
    let max = *waits.last().unwrap();
    (median, max, writes, failures)
}

fn seed(root: &Utf8Path) {
    let tag = ["rust", "cooking", "music", "history", "math"];
    for the in 0..NOTES {
        let mut b = format!(
            "# Nota {the}\n\n#{} #{}\n\n",
            tag[the % 5],
            tag[(the * 7) % 5]
        );
        for s in 0..6 {
            b.push_str(&format!("## Section {s}\n\n"));
            for p in 0..3 {
                b.push_str(&format!(
                    "A paragraph {p} with recurring words like language, system, \
                     memory, concurrency, and performance. See [[Nota {}]] and [[Nota {}]].\n\n",
                    (the + 1) % NOTES,
                    (the + 13) % NOTES
                ));
            }
        }
        std::fs::write(root.join(format!("Nota {the}.md")), b).unwrap();
    }
}

fn main() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    eprintln!("seeding {NOTES} notes in {root} ...");
    seed(&root);

    let host = Arc::new(Host::new().with_watcher(Box::new(NoWatcher)));
    let t = Instant::now();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    eprintln!(
        "opening + scan (exclusive by construction): {:?}",
        t.elapsed()
    );
    eprintln!(
        "available cores: {}\n",
        std::thread::available_parallelism().map_or(0, |n| n.get())
    );

    // --- 1. per tipo di lettura -------------------------------------------
    println!("== 1. which reads actually scale (8 threads) ==");
    println!(
        "{:<24} {:>12} {:>12} {:>8} {}",
        "read", "exclusive", "shared", "×", "ok/errors (exclusive/shared)"
    );
    for (operation, name) in READ_OPS {
        let (exclusive, exclusive_ok, exclusive_errors) =
            measure(&host, Mode::Exclusive, 8, &[operation]);
        let (shared, shared_ok, shared_errors) = measure(&host, Mode::Shared, 8, &[operation]);
        assert_eq!(
            exclusive_errors, 0,
            "{name}: exclusive read errors ({exclusive_errors})"
        );
        assert_eq!(
            shared_errors, 0,
            "{name}: shared read errors ({shared_errors})"
        );
        println!(
            "{name:<24} {exclusive:>12.0} {shared:>12.0} {:>7.1}× ok={exclusive_ok}/{shared_ok} errors={exclusive_errors}/{shared_errors}",
            shared / exclusive
        );
    }

    // --- 2. carico misto ---------------------------------------------------
    let mix: Vec<ReadOp> = READ_OPS.iter().map(|(the, _)| *the).collect();
    println!("\n== 2. mixed load: ops/s ==");
    println!(
        "{:<8} {:>12} {:>12} {:>8} {}",
        "thread", "exclusive", "shared", "×", "ok/errors (exclusive/shared)"
    );
    for threads in [1usize, 2, 4, 8, 16] {
        let (exclusive, exclusive_ok, exclusive_errors) =
            measure(&host, Mode::Exclusive, threads, &mix);
        let (shared, shared_ok, shared_errors) = measure(&host, Mode::Shared, threads, &mix);
        assert_eq!(
            exclusive_errors, 0,
            "mixed exclusive read errors ({exclusive_errors})"
        );
        assert_eq!(
            shared_errors, 0,
            "mixed shared read errors ({shared_errors})"
        );
        println!(
            "{threads:<8} {exclusive:>12.0} {shared:>12.0} {:>7.1}× ok={exclusive_ok}/{shared_ok} errors={exclusive_errors}/{shared_errors}",
            shared / exclusive
        );
    }
    // --- 3. la contropartita ----------------------------------------------
    println!("\n== 3. how long the writer waits, with 8 readers (ms) ==");
    println!(
        "{:<32} {:>10} {:>10} {:>10} {:>10}",
        "mode", "median", "max", "writes", "errors"
    );
    for mode in [Mode::Exclusive, Mode::Shared] {
        let (med, max, writes, errors) = write_latency(&host, mode, 8);
        assert_eq!(errors, 0, "{} writer errors ({errors})", mode.name());
        println!(
            "{:<32} {med:>10.2} {max:>10.2} {writes:>10} {errors:>10}",
            mode.name()
        );
    }
}
