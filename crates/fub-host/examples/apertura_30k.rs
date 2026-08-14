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
fn n_da_env() -> usize {
    std::env::var("FUB_APERTURA_N")
        .ok()
        .map(|v| {
            v.parse()
                .expect("FUB_APERTURA_N deve essere un numero intero")
        })
        .unwrap_or(30_000)
}

/// Il subscriber del banco: tiene per ogni nome di fase il tempo totale e il
/// numero di occorrenze, e basta. Gli span si aprono su `new_span` e si
/// chiudono su `try_close`; per gli omonimi annidati (una `fetta` contiene una
/// `plan_batch`) la mappa per `Id` tiene i due intervalli separati.
#[derive(Clone)]
struct AperturaSub {
    /// Id progressivi, da 1: 0 non è mai un Id valido per `tracing`.
    prossimo: Arc<AtomicU64>,
    /// Gli span aperti: Id → (nome, inizio).
    aperti: Arc<Mutex<HashMap<Id, (String, Instant)>>>,
    /// I totali per nome: (tempo totale, occorrenze).
    tempi: Arc<Mutex<BTreeMap<String, (Duration, u32)>>>,
}

impl AperturaSub {
    fn nuovo() -> Self {
        AperturaSub {
            prossimo: Arc::new(AtomicU64::new(0)),
            aperti: Arc::new(Mutex::new(HashMap::new())),
            tempi: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    /// Azzera i totali fra uno scenario e l'altro.
    fn azzera(&self) {
        self.tempi.lock().unwrap().clear();
    }
}

impl Subscriber for AperturaSub {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target() == "fub.apertura" && metadata.level() <= &Level::INFO
    }

    fn new_span(&self, attrs: &Attributes<'_>) -> Id {
        let id = Id::from_u64(self.prossimo.fetch_add(1, Ordering::Relaxed) + 1);
        self.aperti.lock().unwrap().insert(
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
        if let Some((nome, inizio)) = self.aperti.lock().unwrap().remove(&id) {
            let mut tempi = self.tempi.lock().unwrap();
            let voce = tempi.entry(nome).or_insert((Duration::ZERO, 0));
            voce.0 += inizio.elapsed();
            voce.1 += 1;
        }
        true
    }
}

/// Il corpo di una nota: titolo, due tag, un paragrafo con due wikilink.
fn corpo(i: usize, n: usize) -> String {
    format!(
        "# Nota {i}\n\n#tag-{} #tag-{}\n\nUn paragrafo con parole ricorrenti come \
         linguaggio, sistema, memoria e concorrenza. Vedi [[Nota {}]] e [[Nota {}]].\n",
        i % 5,
        (i * 7) % 5,
        (i + 1) % n,
        (i + 13) % n
    )
}

/// Semina `n` note in parallelo: 30k scritture seriali sono lente, e la semina
/// non è ciò che il banco deve misurare.
fn semina(root: &Utf8Path, n: usize) {
    let n_thread = std::thread::available_parallelism()
        .map(|x| x.get())
        .unwrap_or(1)
        .clamp(1, 8);
    let size = (n + n_thread - 1) / n_thread;
    std::thread::scope(|s| {
        for c in (0..n).collect::<Vec<_>>().chunks(size) {
            let c = c.to_vec();
            let root = root.to_owned();
            s.spawn(move || {
                for i in c {
                    std::fs::write(root.join(format!("Nota {i}.md")), corpo(i, n)).unwrap();
                }
            });
        }
    });
}

/// Tocca le prime `n.min(100)` note: le riscrive con un suffisso, come un
/// salvataggio fatto ad app chiusa.
fn tocca(root: &Utf8Path, n: usize) {
    for i in 0..n.min(100) {
        let path = root.join(format!("Nota {i}.md"));
        let mut b = std::fs::read_to_string(&path).unwrap();
        b.push_str(" tocco\n");
        std::fs::write(path, b).unwrap();
    }
}

/// Un giro completo: azzera i conti, apre, aspetta l'indicizzazione, stampa.
fn scenario(host: &Host, root: &Utf8Path, nome: &str, sub: &AperturaSub) {
    sub.azzera();
    let t_open = Instant::now();
    host.open(root).unwrap();
    let open_ms = t_open.elapsed();
    let t_index = Instant::now();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let index_ms = t_index.elapsed();
    stampa(nome, sub, open_ms, index_ms);
}

/// La tabella del banco: le fasi nell'ordine in cui un'apertura le attraversa.
fn stampa(nome: &str, sub: &AperturaSub, open_ms: Duration, index_ms: Duration) {
    let tempi = sub.tempi.lock().unwrap();
    println!("\n== {nome} ==");
    println!("{:<18} {:>9} {:>5}", "fase", "ms", "n");
    for fase in [
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
        let (ms, n) = tempi
            .get(fase)
            .map(|(d, n)| (d.as_secs_f64() * 1000.0, *n))
            .unwrap_or((0.0, 0));
        println!("{:<18} {:>9.1} {:>5}", fase, ms, n);
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
    let n = n_da_env();
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    eprintln!("semino {n} note in {root} …");
    semina(&root, n);

    let sub = AperturaSub::nuovo();
    tracing::subscriber::set_global_default(sub.clone())
        .expect("un solo subscriber globale per processo");

    let parallelismo = std::thread::available_parallelism()
        .map(|x| x.get())
        .unwrap_or(1);
    println!(
        "N = {n}, available_parallelism = {parallelismo}, build = {}",
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
    tocca(&root, n);
    scenario(&host, &root, "tiepido", &sub);
}
