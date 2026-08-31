//! Il banco di misura del §8.3: quanto costa la contesa sul workspace.
//!
//! La voce diceva «misurare prima», e questo è il *prima* reso ripetibile
//! invece che citato. Il trucco è che i due mondi si misurano nello stesso
//! binario: sotto un `RwLock`, eseguire una **lettura** prendendo `write()` è
//! esattamente il comportamento del `Mutex` che c'era: un solo lettore alla
//! volta. Quindi non serve un ramo git per il termine di paragone —
//! [`Mode::Exclusive`] *è* il termine di paragone, e resta verificabile anche
//! fra un anno.
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

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{Excerpts, IndexQuery, Page, PropertySelect, ViewInstance};
use fub_features::{BACKLINKS_VIEW, OUTLINE_VIEW, STATS_VIEW, TAGS_VIEW};
use fub_host::{Custody, Host, NoWatcher};
use fub_kernel::Workspace;

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

    /// Esegue `f` sotto il prestito che questo modo prevede.
    fn read_with<R>(self, ws: &Custody<Workspace>, f: impl FnOnce(&Workspace) -> R) -> R {
        match self {
            Mode::Exclusive => f(&ws.write().unwrap()),
            Mode::Shared => f(&ws.read().unwrap()),
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
    fn execute(self, ws: &Workspace, the: u64) {
        match self {
            ReadOp::Backlinks => drop(ws.render_view(&ViewInstance::only(BACKLINKS_VIEW))),
            ReadOp::Outline => drop(ws.render_view(&ViewInstance::only(OUTLINE_VIEW))),
            ReadOp::Tags => drop(ws.render_view(&ViewInstance::only(TAGS_VIEW))),
            ReadOp::Stats => drop(ws.render_view(&ViewInstance::only(STATS_VIEW))),
            ReadOp::Search => drop(ws.query_index(IndexQuery::Documents {
                matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms("concorrenza"))),
                sort: None,
                select: PropertySelect::None,
                page: Some(Page::first(20)),
                excerpts: Excerpts::Attach,
            })),
            ReadOp::Preview => {
                drop(ws.render_preview(&DocId::new(format!("Nota {}.md", the as usize % NOTES))))
            }
        }
    }
}

/// Gira `mix` su `threads` thread per [`DUR`], e rende le operazioni al secondo.
fn measure(ws: &Custody<Workspace>, mode: Mode, threads: usize, mix: &[ReadOp]) -> f64 {
    let stop = Arc::new(AtomicBool::new(false));
    let ops = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            let (ws, stop, ops) = (ws.clone(), stop.clone(), ops.clone());
            let mix = mix.to_vec();
            std::thread::spawn(move || {
                let mut made = 0u64;
                let mut the = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    let operation = mix[the as usize % mix.len()];
                    mode.read_with(&ws, |w| operation.execute(w, the));
                    made += 1;
                    the += 1;
                }
                ops.fetch_add(made, Ordering::Relaxed);
            })
        })
        .collect();
    std::thread::sleep(DUR);
    stop.store(true, Ordering::Relaxed);
    for h in handles {
        h.join().unwrap();
    }
    ops.load(Ordering::Relaxed) as f64 / start.elapsed().as_secs_f64()
}

/// La contropartita: quanto aspetta chi **scrive** mentre `threads` lettori
/// tengono il workspace. Rende (mediana, massimo) in millisecondi.
fn write_latency(ws: &Custody<Workspace>, mode: Mode, threads: usize) -> (f64, f64, usize) {
    let stop = Arc::new(AtomicBool::new(false));
    let readers: Vec<_> = (0..threads)
        .map(|t| {
            let (ws, stop) = (ws.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut the = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    mode.read_with(&ws, |w| ReadOp::Preview.execute(w, the));
                    the += 1;
                }
            })
        })
        .collect();

    // Un attimo perché i lettori entrino in regime.
    std::thread::sleep(Duration::from_millis(200));

    let mut waits = Vec::new();
    let end = Instant::now() + Duration::from_millis(2000);
    let mut n = 0;
    while Instant::now() < end {
        let t = Instant::now();
        let mut w = ws.write().unwrap();
        let expected = t.elapsed();
        w.write_document(
            &DocId::new("Scrittore.md"),
            &format!("# Scrittore\n\ngiro {n}\n"),
            WriteBase::Dictated,
        )
        .unwrap();
        drop(w);
        waits.push(expected.as_secs_f64() * 1000.0);
        n += 1;
        // Un salvataggio ogni tanto, non un ciclo stretto: è il ritmo di chi
        // scrive a mano, che è il caso che conta.
        std::thread::sleep(Duration::from_millis(5));
    }
    stop.store(true, Ordering::Relaxed);
    for h in readers {
        h.join().unwrap();
    }

    waits.sort_by(f64::total_cmp);
    let median = waits[waits.len() / 2];
    let max = *waits.last().unwrap();
    (median, max, n)
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

    let host = Host::new().with_watcher(Box::new(NoWatcher));
    let t = Instant::now();
    host.open(&root).unwrap();
    // Il numero che il §8.3 chiama «lavoro lungo»: `reindex` è `&mut self`, e
    // per tutta la sua durata nessuno legge. Qui non blocca nessuno solo perché
    // `Host::open` lo fa **prima** di condividere il workspace — l'unica delle
    // cinque operazioni lunghe della voce che stia già fuori dal lock.
    // cinque operazioni lunghe della voce che stia già fuori dal lock.
    eprintln!(
        "opening + scan (exclusive by construction): {:?}",
        t.elapsed()
    );
    eprintln!(
        "available cores: {}\n",
        std::thread::available_parallelism().map_or(0, |n| n.get())
    );

    let ws = host.debug_workspace(None).unwrap();
    ws.write()
        .unwrap()
        .set_active_document(Some(DocId::new("Nota 7.md")));

    // --- 1. per tipo di lettura -------------------------------------------
    println!("== 1. which reads actually scale (8 threads) ==");
    println!(
        "{:<24} {:>12} {:>12} {:>8}",
        "read", "exclusive", "shared", "×"
    );
    for (operation, name) in READ_OPS {
        let and = measure(&ws, Mode::Exclusive, 8, &[operation]);
        let c = measure(&ws, Mode::Shared, 8, &[operation]);
        println!("{name:<24} {and:>12.0} {c:>12.0} {:>7.1}×", c / and);
    }

    // --- 2. carico misto ---------------------------------------------------
    let mix: Vec<ReadOp> = READ_OPS.iter().map(|(the, _)| *the).collect();
    println!("\n== 2. mixed load: ops/s ==");
    println!(
        "{:<8} {:>12} {:>12} {:>8}",
        "thread", "exclusive", "shared", "×"
    );
    for threads in [1usize, 2, 4, 8, 16] {
        let and = measure(&ws, Mode::Exclusive, threads, &mix);
        let c = measure(&ws, Mode::Shared, threads, &mix);
        println!("{threads:<8} {and:>12.0} {c:>12.0} {:>7.1}×", c / and);
    }

    // --- 3. la contropartita ----------------------------------------------
    println!("\n== 3. how long the writer waits, with 8 readers (ms) ==");
    println!(
        "{:<32} {:>10} {:>10} {:>10}",
        "mode", "median", "max", "writes"
    );
    for mode in [Mode::Exclusive, Mode::Shared] {
        let (med, max, n) = write_latency(&ws, mode, 8);
        println!("{:<32} {med:>10.2} {max:>10.2} {n:>10}", mode.name());
    }
}
