//! Il banco di misura del §8.3 confronta due politiche di un **gate** esterno
//! al percorso pubblico di [`Host`]: `Exclusive` usa `Mutex<()>`, mentre
//! `Shared` usa `RwLock<()>`. Il gate è volutamente esplicito: il confronto
//! misura la contesa di queste due politiche, non pretende di strumentare il
//! `Custody<Workspace>` privato dell'host.
//!
//! Entrambi i modi coprono esattamente la stessa sezione: ogni lettore prende
//! il proprio gate attorno a `op.execute`, e ogni writer lo mantiene attorno
//! alla stessa chiamata a [`Host::write_document`]. Non c'è quindi un callback
//! detached tenuto sotto il mutex solo in uno dei due rami. Per il writer si
//! riportano separatamente attesa di acquisizione del gate e durata della
//! scrittura; il numero dei writer è quello delle chiamate completate.
//!
//! Questo gate esterno non sostituisce la regressione del confine provider:
//! `legacy_tests::query_index_lock::host_query_allows_a_writer_while_index_provider_is_suspended`.
//! Lo stesso schema è riusato per `ViewProvider::render_view` in
//! `legacy_tests::concurrency::a_view_render_provider_runs_without_holding_the_workspace_lock`.
//! La prova interna sospende un `IndexProvider` reale dopo l'ingresso fuori dal
//! `Workspace`, poi richiede una scrittura del workspace entro un watchdog
//! deterministico; se una guardia interna attraversa la callback, il test è
//! rosso. Il comando che la collega al banco è:
//!
//! ```text
//! cargo +1.89.0 test -p fub-host --lib \
//!   legacy_tests::query_index_lock::host_query_allows_a_writer_while_index_provider_is_suspended
//! ```
//!
//! Eseguire questa prova prima di interpretare i numeri sotto: il benchmark
//! rimane un gate di prestazioni e il test interno resta il gate del lifecycle.
//!
//! ```text
//! cargo run --release -p fub-host --example contention
//! ```
//!
//! `open` può tornare prima dell'indice: il banco chiama `wait_indexed` e
//! verifica `IndexQuery::VaultStatus` uguale a `IndexingState::Ready` prima di
//! iniziare le misure.
//!
//! Tre fasi, e tre domande diverse:
//!
//! 1. **Per tipo di lettura** — quali lavori scalano quando si cambia solo la
//!    politica del gate.
//! 2. **A carico misto** — la curva 1 → 16 thread, che è il numero che si
//!    riporta.
//! 3. **La latenza di chi scrive** — attesa per acquisire il gate e durata
//!    della scrittura, mostrate separatamente.
//!
//! Il vault sintetico è volutamente più grande di quelli di prova (2000 note).

use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{
    Excerpts, IndexQuery, IndexResult, IndexingState, Page, PropertySelect, ViewInstance,
};
use fub_features::{BACKLINKS_VIEW, OUTLINE_VIEW, STATS_VIEW, TAGS_VIEW};
use fub_host::Host;

const NOTES: usize = 2000;
type BenchmarkResult<T> = Result<T, Box<dyn std::error::Error>>;
/// Durata di ogni misura di contesa, abbastanza lunga per uscire dal rumore.
const DUR: Duration = Duration::from_millis(2500);
/// Politica del gate usato dal banco per la lettura e la scrittura.
#[derive(Clone, Copy)]
enum Mode {
    /// Un solo lettore o writer alla volta.
    Exclusive,
    /// Più lettori concorrenti, writer esclusivi.
    Shared,
}

impl Mode {
    fn name(self) -> &'static str {
        match self {
            Mode::Exclusive => "exclusive (Mutex gate)",
            Mode::Shared => "shared (RwLock gate)",
        }
    }

    fn gate(self) -> Gate {
        match self {
            Mode::Exclusive => Gate::Exclusive(Mutex::new(())),
            Mode::Shared => Gate::Shared(RwLock::new(())),
        }
    }
}

/// Gate di confronto. Le due varianti espongono sezioni omologhe: cambia solo
/// la politica di acquisizione, non il lavoro eseguito sotto la guardia.
enum Gate {
    Exclusive(Mutex<()>),
    Shared(RwLock<()>),
}

impl Gate {
    fn read<R>(&self, operation: impl FnOnce() -> R) -> R {
        match self {
            Gate::Exclusive(lock) => {
                let _guard = match lock.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                operation()
            }
            Gate::Shared(lock) => {
                let _guard = match lock.read() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                operation()
            }
        }
    }

    /// Misura separatamente attesa di acquisizione e lavoro sotto il gate.
    fn write(
        &self,
        operation: impl FnOnce() -> Result<(), PluginError>,
    ) -> Result<(Duration, Duration), PluginError> {
        match self {
            Gate::Exclusive(lock) => {
                let waiting = Instant::now();
                let _guard = match lock.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                let wait = waiting.elapsed();
                let started = Instant::now();
                let outcome = operation();
                let write = started.elapsed();
                outcome.map(|()| (wait, write))
            }
            Gate::Shared(lock) => {
                let waiting = Instant::now();
                let _guard = match lock.write() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                let wait = waiting.elapsed();
                let started = Instant::now();
                let outcome = operation();
                let write = started.elapsed();
                outcome.map(|()| (wait, write))
            }
        }
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
    fn execute(self, host: &Host, the: u64) -> Result<(), PluginError> {
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

#[derive(Default)]
struct ReadCounts {
    successes: u64,
    failures: u64,
}

struct ReadMeasurement {
    counts: ReadCounts,
    elapsed: Duration,
}

impl ReadMeasurement {
    fn successes_per_second(&self) -> f64 {
        let seconds = self.elapsed.as_secs_f64();
        if seconds > 0.0 {
            self.counts.successes as f64 / seconds
        } else {
            0.0
        }
    }
}

/// Esegue `mix` su `threads` thread per [`DUR`] e rende le operazioni riuscite
/// al secondo insieme al conteggio separato dei fallimenti. In entrambi i modi
/// il gate copre esattamente `op.execute`.
fn measure(
    host: &Arc<Host>,
    mode: Mode,
    threads: usize,
    mix: &[ReadOp],
) -> BenchmarkResult<ReadMeasurement> {
    if mix.is_empty() {
        return Err(io::Error::other("read measurement mix must not be empty").into());
    }

    let stop = Arc::new(AtomicBool::new(false));
    let gate = Arc::new(mode.gate());
    let start = Instant::now();
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            let (host, stop, gate) = (Arc::clone(host), stop.clone(), gate.clone());
            let mix = mix.to_vec();
            std::thread::spawn(move || {
                let mut counts = ReadCounts::default();
                let mut the = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    let operation = mix[the as usize % mix.len()];
                    match gate.read(|| operation.execute(&host, the)) {
                        Ok(()) => counts.successes += 1,
                        Err(_) => counts.failures += 1,
                    }
                    the += 1;
                }
                counts
            })
        })
        .collect();
    std::thread::sleep(DUR);
    stop.store(true, Ordering::Relaxed);

    let mut counts = ReadCounts::default();
    for handle in handles {
        let local = handle
            .join()
            .map_err(|_| io::Error::other("read measurement thread panicked"))?;
        counts.successes += local.successes;
        counts.failures += local.failures;
    }
    Ok(ReadMeasurement {
        counts,
        elapsed: start.elapsed(),
    })
}

/// La contropartita: la durata del gate e della scrittura mentre `threads`
/// lettori eseguono l'anteprima tramite `Host`.
///
/// Rende (mediana attesa, massimo attesa, mediana scrittura, massimo scrittura,
/// chiamate completate), tutti i tempi in millisecondi. L'attesa è misurata
/// direttamente dall'inizio dell'acquisizione del gate alla sua riuscita; la
/// scrittura parte solo dopo l'acquisizione e resta sotto la stessa guardia dei
/// lettori in entrambi i modi. Anche gli esiti delle letture concorrenti restano
/// separati nel risultato.
struct WriteMeasurement {
    wait_median: f64,
    wait_max: f64,
    write_median: f64,
    write_max: f64,
    writes: usize,
    reader_counts: ReadCounts,
}

fn write_latency(
    host: &Arc<Host>,
    mode: Mode,
    threads: usize,
) -> BenchmarkResult<WriteMeasurement> {
    let stop = Arc::new(AtomicBool::new(false));
    let gate = Arc::new(mode.gate());
    let readers: Vec<_> = (0..threads)
        .map(|t| {
            let (host, stop, gate) = (Arc::clone(host), stop.clone(), gate.clone());
            std::thread::spawn(move || {
                let mut counts = ReadCounts::default();
                let mut the = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    match gate.read(|| ReadOp::Preview.execute(&host, the)) {
                        Ok(()) => counts.successes += 1,
                        Err(_) => counts.failures += 1,
                    }
                    the += 1;
                }
                counts
            })
        })
        .collect();

    // Un attimo perché i lettori entrino in regime.
    std::thread::sleep(Duration::from_millis(200));

    let mut waits = Vec::new();
    let mut writes = Vec::new();
    let end = Instant::now() + Duration::from_millis(2000);
    let mut n = 0;
    let mut writer_error = None;
    while Instant::now() < end {
        let source = format!("# Scrittore\n\ngiro {n}\n");
        match gate.write(|| {
            host.write_document(
                None,
                &DocId::new("Scrittore.md"),
                &source,
                WriteBase::Dictated,
            )
            .map(|_| ())
        }) {
            Ok((wait, write)) => {
                waits.push(wait.as_secs_f64() * 1000.0);
                writes.push(write.as_secs_f64() * 1000.0);
                n += 1;
            }
            Err(error) => {
                writer_error = Some(error);
                break;
            }
        }
        // Un salvataggio ogni tanto, non un ciclo stretto: è il ritmo di chi
        // scrive a mano, che è il caso che conta.
        std::thread::sleep(Duration::from_millis(5));
    }
    stop.store(true, Ordering::Relaxed);

    let mut reader_counts = ReadCounts::default();
    for handle in readers {
        let local = handle
            .join()
            .map_err(|_| io::Error::other("writer measurement reader panicked"))?;
        reader_counts.successes += local.successes;
        reader_counts.failures += local.failures;
    }
    if let Some(error) = writer_error {
        return Err(error.into());
    }

    waits.sort_by(f64::total_cmp);
    writes.sort_by(f64::total_cmp);
    let Some(max_wait) = waits.last().copied() else {
        return Err(io::Error::other("writer gate produced no completed sample").into());
    };
    let Some(max_write) = writes.last().copied() else {
        return Err(io::Error::other("writer produced no completed sample").into());
    };
    let median_wait = waits[waits.len() / 2];
    let median_write = writes[writes.len() / 2];
    Ok(WriteMeasurement {
        wait_median: median_wait,
        wait_max: max_wait,
        write_median: median_write,
        write_max: max_write,
        writes: n,
        reader_counts,
    })
}

fn seed(root: &Utf8Path) -> io::Result<()> {
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
        std::fs::write(root.join(format!("Nota {the}.md")), b)?;
    }
    Ok(())
}

fn wait_until_ready(host: &Host) -> BenchmarkResult<()> {
    host.wait_indexed(None)?;
    match host.query_index(None, IndexQuery::VaultStatus)? {
        IndexResult::VaultStatus(status) if status.indexing == IndexingState::Ready => Ok(()),
        IndexResult::VaultStatus(status) => Err(io::Error::other(format!(
            "indexing stopped before ready: {:?}",
            status.indexing
        ))
        .into()),
        other => Err(io::Error::other(format!("index readiness query returned {other:?}")).into()),
    }
}

fn main() -> BenchmarkResult<()> {
    let dir = tempfile::tempdir()?;
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).map_err(|path| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("temporary directory path is not UTF-8: {}", path.display()),
        )
    })?;

    let stderr = io::stderr();
    let mut diagnostics = stderr.lock();
    writeln!(diagnostics, "seeding {NOTES} notes in {root} ...")?;
    seed(&root)?;

    let host = Arc::new(Host::without_watcher());
    let opening = Instant::now();
    host.open(&root)?;
    wait_until_ready(&host)?;
    writeln!(
        diagnostics,
        "opening + index ready (after wait_indexed): {:?}",
        opening.elapsed()
    )?;
    writeln!(
        diagnostics,
        "available cores: {}\n",
        std::thread::available_parallelism().map_or(0, |n| n.get())
    )?;
    drop(diagnostics);

    let stdout = io::stdout();
    let mut output = stdout.lock();
    writeln!(output, "index ready: wait_indexed completed")?;

    let mut read_failures = 0u64;

    // --- 1. per tipo di lettura -------------------------------------------
    writeln!(
        output,
        "== 1. same reads under each gate policy (8 threads; successful ops/s) =="
    )?;
    writeln!(
        output,
        "{:<24} {:>16} {:>14} {:>16} {:>14}",
        "read", "Mutex success/s", "Mutex errors", "RwLock success/s", "RwLock errors"
    )?;
    for (operation, name) in READ_OPS {
        let mutex = measure(&host, Mode::Exclusive, 8, &[operation])?;
        let rwlock = measure(&host, Mode::Shared, 8, &[operation])?;
        read_failures += mutex.counts.failures + rwlock.counts.failures;
        writeln!(
            output,
            "{name:<24} {:>16.0} {:>14} {:>16.0} {:>14}",
            mutex.successes_per_second(),
            mutex.counts.failures,
            rwlock.successes_per_second(),
            rwlock.counts.failures
        )?;
    }

    let mix: Vec<ReadOp> = READ_OPS.iter().map(|(operation, _)| *operation).collect();
    writeln!(
        output,
        "\n== 2. same mixed load under each gate policy (successful ops/s) =="
    )?;
    writeln!(
        output,
        "{:<8} {:>16} {:>14} {:>16} {:>14}",
        "thread", "Mutex success/s", "Mutex errors", "RwLock success/s", "RwLock errors"
    )?;
    for threads in [1usize, 2, 4, 8, 16] {
        let mutex = measure(&host, Mode::Exclusive, threads, &mix)?;
        let rwlock = measure(&host, Mode::Shared, threads, &mix)?;
        read_failures += mutex.counts.failures + rwlock.counts.failures;
        writeln!(
            output,
            "{threads:<8} {:>16.0} {:>14} {:>16.0} {:>14}",
            mutex.successes_per_second(),
            mutex.counts.failures,
            rwlock.successes_per_second(),
            rwlock.counts.failures
        )?;
    }
    output.flush()?;

    writeln!(
        output,
        "\n== 3. writer gate wait + write time (8 readers; ms) =="
    )?;
    writeln!(
        output,
        "{:<32} {:>12} {:>12} {:>12} {:>12} {:>10}",
        "mode", "wait median", "wait max", "write median", "write max", "writes"
    )?;
    for mode in [Mode::Exclusive, Mode::Shared] {
        let measurement = write_latency(&host, mode, 8)?;
        read_failures += measurement.reader_counts.failures;
        writeln!(
            output,
            "{:<32} {:>12.3} {:>12.3} {:>12.3} {:>12.3} {:>10}",
            mode.name(),
            measurement.wait_median,
            measurement.wait_max,
            measurement.write_median,
            measurement.write_max,
            measurement.writes
        )?;
        writeln!(
            output,
            "  reader operations: {} successful, {} failed",
            measurement.reader_counts.successes, measurement.reader_counts.failures
        )?;
    }

    writeln!(output, "\nsummary: {read_failures} read errors")?;
    output.flush()?;
    if read_failures != 0 {
        return Err(io::Error::other(format!(
            "benchmark observed {read_failures} failed read operations"
        ))
        .into());
    }
    Ok(())
}
