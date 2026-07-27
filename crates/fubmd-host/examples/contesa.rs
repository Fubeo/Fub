//! Il banco di misura del §8.3: quanto costa la contesa sul workspace.
//!
//! La voce diceva «misurare prima», e questo è il *prima* reso ripetibile
//! invece che citato. Il trucco è che i due mondi si misurano nello stesso
//! binario: sotto un `RwLock`, eseguire una **lettura** prendendo `write()` è
//! esattamente il comportamento del `Mutex` che c'era: un solo lettore alla
//! volta. Quindi non serve un ramo git per il termine di paragone —
//! [`Modo::Esclusivo`] *è* il termine di paragone, e resta verificabile anche
//! fra un anno.
//!
//! ```text
//! cargo run --release -p fubmd-host --example contesa
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
//! con sei sezioni l'una): sotto quella taglia ogni lettura costa meno del lock
//! e la misura racconterebbe il costo del futex, non quello del disegno.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::model::DocId;
use fubmd_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fubmd_abi::traits::{IndexQuery, Page, PropertySelect, ViewInstance};
use fubmd_features::{BACKLINKS_VIEW, OUTLINE_VIEW, STATS_VIEW, TAGS_VIEW};
use fubmd_host::{Host, NoWatcher};
use fubmd_kernel::Workspace;

const NOTES: usize = 2000;
/// Abbastanza per uscire dal rumore, abbastanza poco da poterlo rilanciare.
const DUR: Duration = Duration::from_millis(2500);

/// Come si prende il workspace per fare una **lettura**.
#[derive(Clone, Copy, PartialEq)]
enum Modo {
    /// Un lettore alla volta: è il `Mutex` di prima, simulato prendendo il
    /// prestito esclusivo per un lavoro che esclusivo non è.
    Esclusivo,
    /// N lettori insieme: è il `RwLock` usato per ciò per cui c'è.
    Condiviso,
}

impl Modo {
    fn nome(self) -> &'static str {
        match self {
            Modo::Esclusivo => "esclusivo (= il Mutex di prima)",
            Modo::Condiviso => "condiviso  (= il RwLock)",
        }
    }

    /// Esegue `f` sotto il prestito che questo modo prevede.
    fn leggi<R>(self, ws: &RwLock<Workspace>, f: impl FnOnce(&Workspace) -> R) -> R {
        match self {
            Modo::Esclusivo => f(&ws.write().unwrap()),
            Modo::Condiviso => f(&ws.read().unwrap()),
        }
    }
}

/// Le sei letture del giro: le quattro view ufficiali, la ricerca, l'anteprima.
///
/// Sono il carico che il §8.3 nominava — «le letture sono le view» — più i due
/// che ci stanno accanto in ogni schermata vera: la ricerca aperta e il
/// pannello di anteprima.
#[derive(Clone, Copy)]
enum Lettura {
    Backlinks,
    Outline,
    Tags,
    Stats,
    Ricerca,
    Anteprima,
}

const LETTURE: [(Lettura, &str); 6] = [
    (Lettura::Backlinks, "render_view backlinks"),
    (Lettura::Outline, "render_view outline"),
    (Lettura::Tags, "render_view tags"),
    (Lettura::Stats, "render_view stats"),
    (Lettura::Ricerca, "query_index testo"),
    (Lettura::Anteprima, "render_preview"),
];

impl Lettura {
    fn esegui(self, ws: &Workspace, i: u64) {
        match self {
            Lettura::Backlinks => drop(ws.render_view(&ViewInstance::only(BACKLINKS_VIEW))),
            Lettura::Outline => drop(ws.render_view(&ViewInstance::only(OUTLINE_VIEW))),
            Lettura::Tags => drop(ws.render_view(&ViewInstance::only(TAGS_VIEW))),
            Lettura::Stats => drop(ws.render_view(&ViewInstance::only(STATS_VIEW))),
            Lettura::Ricerca => drop(ws.query_index(IndexQuery::Documents {
                matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms("concorrenza"))),
                sort: None,
                select: PropertySelect::None,
                page: Some(Page::first(20)),
            })),
            Lettura::Anteprima => {
                drop(ws.render_preview(&DocId::new(format!("Nota {}.md", i as usize % NOTES))))
            }
        }
    }
}

/// Gira `mix` su `threads` thread per [`DUR`], e rende le operazioni al secondo.
fn misura(ws: &Arc<RwLock<Workspace>>, modo: Modo, threads: usize, mix: &[Lettura]) -> f64 {
    let stop = Arc::new(AtomicBool::new(false));
    let ops = Arc::new(AtomicU64::new(0));
    let inizio = Instant::now();
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            let (ws, stop, ops) = (ws.clone(), stop.clone(), ops.clone());
            let mix = mix.to_vec();
            std::thread::spawn(move || {
                let mut fatte = 0u64;
                let mut i = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    let lettura = mix[i as usize % mix.len()];
                    modo.leggi(&ws, |w| lettura.esegui(w, i));
                    fatte += 1;
                    i += 1;
                }
                ops.fetch_add(fatte, Ordering::Relaxed);
            })
        })
        .collect();
    std::thread::sleep(DUR);
    stop.store(true, Ordering::Relaxed);
    for h in handles {
        h.join().unwrap();
    }
    ops.load(Ordering::Relaxed) as f64 / inizio.elapsed().as_secs_f64()
}

/// La contropartita: quanto aspetta chi **scrive** mentre `threads` lettori
/// tengono il workspace. Rende (mediana, massimo) in millisecondi.
fn latenza_di_chi_scrive(
    ws: &Arc<RwLock<Workspace>>,
    modo: Modo,
    threads: usize,
) -> (f64, f64, usize) {
    let stop = Arc::new(AtomicBool::new(false));
    let lettori: Vec<_> = (0..threads)
        .map(|t| {
            let (ws, stop) = (ws.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut i = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    modo.leggi(&ws, |w| Lettura::Anteprima.esegui(w, i));
                    i += 1;
                }
            })
        })
        .collect();

    // Un attimo perché i lettori entrino in regime.
    std::thread::sleep(Duration::from_millis(200));

    let mut attese = Vec::new();
    let fine = Instant::now() + Duration::from_millis(2000);
    let mut n = 0;
    while Instant::now() < fine {
        let t = Instant::now();
        let mut w = ws.write().unwrap();
        let atteso = t.elapsed();
        w.write_document(
            &DocId::new("Scrittore.md"),
            &format!("# Scrittore\n\ngiro {n}\n"),
        )
        .unwrap();
        drop(w);
        attese.push(atteso.as_secs_f64() * 1000.0);
        n += 1;
        // Un salvataggio ogni tanto, non un ciclo stretto: è il ritmo di chi
        // scrive a mano, che è il caso che conta.
        std::thread::sleep(Duration::from_millis(5));
    }
    stop.store(true, Ordering::Relaxed);
    for h in lettori {
        h.join().unwrap();
    }

    attese.sort_by(f64::total_cmp);
    let mediana = attese[attese.len() / 2];
    let massimo = *attese.last().unwrap();
    (mediana, massimo, n)
}

fn semina(root: &Utf8Path) {
    let tag = ["rust", "cucina", "musica", "storia", "matematica"];
    for i in 0..NOTES {
        let mut b = format!("# Nota {i}\n\n#{} #{}\n\n", tag[i % 5], tag[(i * 7) % 5]);
        for s in 0..6 {
            b.push_str(&format!("## Sezione {s}\n\n"));
            for p in 0..3 {
                b.push_str(&format!(
                    "Un paragrafo {p} con parole ricorrenti come linguaggio, sistema, \
                     memoria, concorrenza e prestazione. Vedi [[Nota {}]] e [[Nota {}]].\n\n",
                    (i + 1) % NOTES,
                    (i + 13) % NOTES
                ));
            }
        }
        std::fs::write(root.join(format!("Nota {i}.md")), b).unwrap();
    }
}

fn main() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    eprintln!("semino {NOTES} note in {root} …");
    semina(&root);

    let host = Host::new().with_watcher(Box::new(NoWatcher));
    let t = Instant::now();
    host.open(&root).unwrap();
    // Il numero che il §8.3 chiama «lavoro lungo»: `reindex` è `&mut self`, e
    // per tutta la sua durata nessuno legge. Qui non blocca nessuno solo perché
    // `Host::open` lo fa **prima** di condividere il workspace — l'unica delle
    // cinque operazioni lunghe della voce che stia già fuori dal lock.
    eprintln!(
        "apertura + scansione (esclusiva per costruzione): {:?}",
        t.elapsed()
    );
    eprintln!(
        "core disponibili: {}\n",
        std::thread::available_parallelism().map_or(0, |n| n.get())
    );

    let ws = host.workspace(None).unwrap();
    ws.write()
        .unwrap()
        .set_active_document(Some(DocId::new("Nota 7.md")));

    // --- 1. per tipo di lettura -------------------------------------------
    println!("== 1. quali letture scalano (8 thread) ==");
    println!(
        "{:<24} {:>12} {:>12} {:>8}",
        "lettura", "esclusivo", "condiviso", "×"
    );
    for (lettura, nome) in LETTURE {
        let e = misura(&ws, Modo::Esclusivo, 8, &[lettura]);
        let c = misura(&ws, Modo::Condiviso, 8, &[lettura]);
        println!("{nome:<24} {e:>12.0} {c:>12.0} {:>7.1}×", c / e);
    }

    // --- 2. carico misto ---------------------------------------------------
    let mix: Vec<Lettura> = LETTURE.iter().map(|(l, _)| *l).collect();
    println!("\n== 2. carico misto: op/s ==");
    println!(
        "{:<8} {:>12} {:>12} {:>8}",
        "thread", "esclusivo", "condiviso", "×"
    );
    for threads in [1usize, 2, 4, 8, 16] {
        let e = misura(&ws, Modo::Esclusivo, threads, &mix);
        let c = misura(&ws, Modo::Condiviso, threads, &mix);
        println!("{threads:<8} {e:>12.0} {c:>12.0} {:>7.1}×", c / e);
    }

    // --- 3. la contropartita ----------------------------------------------
    println!("\n== 3. quanto aspetta chi scrive, con 8 lettori (ms) ==");
    println!(
        "{:<32} {:>10} {:>10} {:>10}",
        "modo", "mediana", "massimo", "scritture"
    );
    for modo in [Modo::Esclusivo, Modo::Condiviso] {
        let (med, max, n) = latenza_di_chi_scrive(&ws, modo, 8);
        println!("{:<32} {med:>10.2} {max:>10.2} {n:>10}", modo.nome());
    }
}
