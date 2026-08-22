//! Il banco dell'apertura a fasi (§15.7, §25.3): quanto costa aprire un vault
//! grande, e dove va il tempo.
//!
//! ```text
//! cargo run --release -p fub-host --example apertura_30k
//! ```
//!
//! Tre scenari sulla stessa cartella, e tre domande diverse:
//!
//! 1. **Freddo** — la prima apertura: la scansione cammina il disco, e ogni
//!    documento si legge, si parsa e si indicizza. È il caso che il §25.3
//!    chiama «la prima volta», ed è quello che l'utente paga all'avvio.
//! 2. **Caldo** — la riapertura: la cache dei metadati (§14.1) ha già le
//!    impronte, e le fette non leggono quasi niente. È il caso normale di chi
//!    chiude e riapre l'app.
//! 3. **Tiepido** — poche note toccate mentre l'app era chiusa: la scansione
//!    è quasi tutta cache, ma le note cambiate si rileggono per intero.
//!
//! Il numero di note è parametrico (`FUB_APERTURA_N`, default 30000): il banco
//! vero gira a 30k, e una prova piccola a 200 basta per vedere la forma delle
//! tabelle. La semina è volutamente più magra di quella di `contesa` — un
//! paragrafo per nota invece di sei sezioni — perché a 30k il costo da
//! misurare è l'apertura, non la generazione del vault.
//!
//! Le fasi si misurano con span `tracing` permanenti (target `fub.apertura`)
//! e un subscriber scritto in casa, come il collettore di Fub: niente
//! `tracing-subscriber`, che qui è vietato (la decisione sta in
//! `crates/fub-kernel/src/log.rs`). Il subscriber conta per nome il tempo
//! totale e il numero di occorrenze, e l'example azzera i conti fra uno
//! scenario e l'altro.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_host::{Host, NoWatcher};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Level, Metadata, Subscriber};

/// Il numero di note: `FUB_APERTURA_N`, default 30000.
fn n_from_env() -> usize {
    std::env::var("FUB_APERTURA_N")
        .ok()
        .map(|v| v.parse().expect("FUB_APERTURA_N must be an integer"))
        .unwrap_or(30_000)
}

/// Il subscriber del banco: tiene per ogni nome di fase il tempo totale e il
/// numero di occorrenze, e basta. Gli span si aprono su `new_span` e si
/// chiudono su `try_close`; per gli omonimi annidati (una `fetta` contiene una
/// `plan_batch`) la mappa per `Id` tiene i due intervalli separati.
#[derive(Clone)]
struct OpeningSub {
    /// Id progressivi, da 1: 0 non è mai un Id valido per `tracing`.
    next: Arc<AtomicU64>,
    /// Gli span aperti: Id → (nome, inizio).
    open: Arc<Mutex<HashMap<Id, (String, Instant)>>>,
    /// I totali per nome: (tempo totale, occorrenze).
    times: Arc<Mutex<BTreeMap<String, (Duration, u32)>>>,
}

impl OpeningSub {
    fn new() -> Self {
        OpeningSub {
            next: Arc::new(AtomicU64::new(0)),
            open: Arc::new(Mutex::new(HashMap::new())),
            times: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    /// Azzera i totali fra uno scenario e l'altro.
    fn clear(&self) {
        self.times.lock().unwrap().clear();
    }
}

impl Subscriber for OpeningSub {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target() == "fub.apertura" && metadata.level() <= &Level::INFO
    }

    fn new_span(&self, attrs: &Attributes<'_>) -> Id {
        let id = Id::from_u64(self.next.fetch_add(1, Ordering::Relaxed) + 1);
        self.open.lock().unwrap().insert(
            id.clone(),
            (attrs.metadata().name().to_string(), Instant::now()),
        );
        id
    }

    fn record(&self, _span: &Id, _values: &Record<'_>) {}

    fn record_follows_from(&self, _span: &Id, _follows: &Id) {}

    fn event(&self, _event: &Event<'_>) {}

    fn enter(&self, _id: &Id) {}

    fn exit(&self, _id: &Id) {}

    fn clone_span(&self, id: &Id) -> Id {
        id.clone()
    }

    fn try_close(&self, id: Id) -> bool {
        if let Some((name, start)) = self.open.lock().unwrap().remove(&id) {
            let mut times = self.times.lock().unwrap();
            let entry = times.entry(name).or_insert((Duration::ZERO, 0));
            entry.0 += start.elapsed();
            entry.1 += 1;
        }
        true
    }
}

/// Il corpo di una nota: titolo, due tag, un paragrafo con due wikilink.
fn body(the: usize, n: usize) -> String {
    format!(
        "# Nota {the}\n\n#tag-{} #tag-{}\n\nA paragraph with recurring words like \
         language, system, memory, and concurrency. See [[Nota {}]] and [[Nota {}]].\n",
        the % 5,
        (the * 7) % 5,
        (the + 1) % n,
        (the + 13) % n
    )
}

/// Semina `n` note in parallelo: 30k scritture seriali sono lente, e la semina
/// non è ciò che il banco deve misurare.
fn seed(root: &Utf8Path, n: usize) {
    let n_thread = std::thread::available_parallelism()
        .map(|x| x.get())
        .unwrap_or(1)
        .clamp(1, 8);
    let size = n.div_ceil(n_thread);
    std::thread::scope(|s| {
        for c in (0..n).collect::<Vec<_>>().chunks(size) {
            let c = c.to_vec();
            let root = root.to_owned();
            s.spawn(move || {
                for the in c {
                    std::fs::write(root.join(format!("Nota {the}.md")), body(the, n)).unwrap();
                }
            });
        }
    });
}

/// Tocca le prime `n.min(100)` note: le riscrive con un suffisso, come un
/// salvataggio fatto ad app chiusa.
fn touches(root: &Utf8Path, n: usize) {
    for the in 0..n.min(100) {
        let path = root.join(format!("Nota {the}.md"));
        let mut b = std::fs::read_to_string(&path).unwrap();
        b.push_str(" tocco\n");
        std::fs::write(path, b).unwrap();
    }
}

/// Un giro completo: azzera i conti, apre, aspetta l'indicizzazione, stampa.
fn scenario(host: &Host, root: &Utf8Path, name: &str, sub: &OpeningSub) {
    sub.clear();
    let t_open = Instant::now();
    host.open(root).unwrap();
    let open_ms = t_open.elapsed();
    let t_index = Instant::now();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let index_ms = t_index.elapsed();
    print_report(name, sub, open_ms, index_ms);
}

/// La tabella del banco: le fasi nell'ordine in cui un'apertura le attraversa.
fn print_report(name: &str, sub: &OpeningSub, open_ms: Duration, index_ms: Duration) {
    let times = sub.times.lock().unwrap();
    println!("\n== {name} ==");
    println!("{:<18} {:>9} {:>5}", "phase", "ms", "n");
    for phase in [
        "open",
        "scan_vault",
        "catch_up",
        "fotografia",
        "fetta",
        "plan_batch",
        "finish_index",
        "graph_sources",
        "rebuild_graph",
        "reconcile",
        "flush_indexes",
        "store_entries",
        "collect_doc_data",
    ] {
        let (ms, n) = times
            .get(phase)
            .map(|(d, n)| (d.as_secs_f64() * 1000.0, *n))
            .unwrap_or((0.0, 0));
        println!("{:<18} {:>9.1} {:>5}", phase, ms, n);
    }
    println!(
        "{:<18} {:>9.1} {:>5}",
        "wait_indexed (wall)",
        index_ms.as_secs_f64() * 1000.0,
        1
    );
    println!(
        "open_ms = {:.1}, index_ms = {:.1}",
        open_ms.as_secs_f64() * 1000.0,
        index_ms.as_secs_f64() * 1000.0
    );
}

fn main() {
    let n = n_from_env();
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    eprintln!("seeding {n} notes in {root} ...");
    seed(&root, n);

    let sub = OpeningSub::new();
    tracing::subscriber::set_global_default(sub.clone())
        .expect("only one global subscriber per process");

    let parallelism = std::thread::available_parallelism()
        .map(|x| x.get())
        .unwrap_or(1);
    println!(
        "N = {n}, available_parallelism = {parallelism}, build = {}",
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    );

    let host = Host::new().with_watcher(Box::new(NoWatcher));

    // 1. Freddo: la prima apertura, tutto da leggere.
    scenario(&host, &root, "freddo", &sub);

    // 2. Si chiude, e si riapre.
    host.close_vault(&root).unwrap();

    // 3. Caldo: la cache dei metadati ha già le impronte.
    scenario(&host, &root, "caldo", &sub);

    // 4. Si chiude, si toccano poche note ad app chiusa, poi la riapertura.
    host.close_vault(&root).unwrap();
    touches(&root, n);
    scenario(&host, &root, "tiepido", &sub);
}
