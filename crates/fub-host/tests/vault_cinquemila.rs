//! Un vault da cinquemila file **dall'host vero**, su disco vero: quanto ci
//! mette a montarsi e a dare le liste che l'albero disegna. È la parte del
//! costo che sta prima del disegno; il banco `apps/client/bench/tree.mjs`
//! misura il resto, nella pagina.
//!
//! Il vault è quello del banco (`apps/client/bench/vault-fixture.ts`): cinque
//! cartelle, una da milleecinquecento note, una catena di dieci cartelle con
//! una nota per livello, e un nome lungo. Le soglie sono quelle del banco: il
//! primo disegno entro 300 ms, e l'apertura di una cartella entro 100 ms.
//!
//! Il montaggio non si confronta con un tempo assoluto. Sotto carico (un
//! `check.sh` a `nice 19` accanto ai banchi, carico 128 su 20 thread) lo
//! stesso montaggio da 340 ms passava i 2 s in tutti e tre i tentativi, e il
//! doppio della soglia del primo disegno cadeva senza che il codice fosse
//! cambiato: il tempo di una macchina che lavora con altri non è un test. Il
//! rapporto fra due tempi presi sulla stessa macchina nello stesso momento sì.
//! Ogni tentativo monta il vault del banco e, subito dopo, uno con la stessa
//! forma e un decimo delle note; per ciascuno conta il più veloce dei tre
//! tentativi. Quasi tutto il montaggio è un costo fisso (misurato: circa
//! 240 ms in debug anche con un vault vuoto, 1,1–1,2 volte tanto con
//! cinquemila file), e i file costano poco perché il loro indice si fa dopo,
//! in background. La prova chiede che resti così: dieci volte i file al più
//! il triplo del tempo. Un montaggio che legge o analizza ogni file prima di
//! rispondere passa quel triplo; il carico, che rallenta i due montaggi
//! insieme, no. Le soglie del primo disegno le guarda il banco, nella pagina;
//! qui i tempi assoluti si stampano soltanto.
//!
//! L'apertura della cartella grande resta confrontata con il doppio della sua
//! soglia: è una pagina di duecento voci, mezzo millisecondo anche sotto quel
//! carico, quattrocento volte sotto il limite.
//!
//! Tutti i tempi si vedono con
//! `cargo test -p fub-host --test vault_cinquemila -- --nocapture`.

use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::traits::{FolderScope, IndexQuery, IndexResult, Page};
use fub_host::{Host, NoWatcher};

/// Quanti file ha il vault, come `TREE_TOTAL` del banco.
const FILES: usize = 5_000;
/// La cartella da milleecinquecento note che l'albero apre, con le sue note.
const BIG: &str = "Archivio";
const BIG_NOTES: usize = 1_500;
/// Le voci che l'albero chiede per un livello (`LEVEL_PAGE` in `rules/organizer.ts`).
const LEVEL_WINDOW: u32 = 200;
/// Le soglie del banco: il primo disegno dall'arrivo dell'elenco (qui solo
/// stampata), e l'apertura di una cartella (la sua prima pagina, senza il
/// disegno).
const FIRST_DRAW: Duration = Duration::from_millis(300);
const OPEN_FOLDER: Duration = Duration::from_millis(100);
/// Quanti tentativi, ognuno coi suoi due vault; conta il più veloce.
const ATTEMPTS: usize = 3;
/// Il vault di paragone ha in ogni cartella questa frazione delle note (la
/// catena di «Bozze» resta intera).
const SMALL: usize = 10;
/// Quante volte il montaggio grande può costare quello piccolo, che ha un
/// decimo dei file (misurato: 1,1–1,2).
const MAX_RATIO: f64 = 3.0;
/// Quante cartelle annidate ha la catena di «Bozze».
const CHAIN: usize = 10;
/// Il nome lungo del caso S252, come `LONG_TITLE` del banco.
const LONG_TITLE: &str = "Verbale della riunione di condominio di via Roma 12 con le decisioni sul tetto e sulla caldaia";

/// I tempi di un montaggio.
struct Run {
    files: usize,
    mounted: Duration,
    root_list: Duration,
    big_list: Duration,
    indexed: Duration,
}

impl Run {
    /// Ciò che sta prima del primo disegno: il montaggio e la radice.
    fn first(&self) -> Duration {
        self.mounted + self.root_list
    }
}

fn write_note(path: &Utf8Path, title: &str) {
    std::fs::write(
        path,
        format!("# {title}\n\nUna nota del banco dell'albero.\n"),
    )
    .unwrap();
}

/// Il vault del banco, sul disco: le stesse cartelle, gli stessi nomi. Con
/// `divisor` maggiore di uno ogni cartella ha quella frazione delle sue note.
/// Restituisce anche quanti file ha.
fn vault(divisor: usize) -> (tempfile::TempDir, Utf8PathBuf, usize) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    let layout = [
        (BIG, BIG_NOTES),
        ("Clienti", 1_204),
        ("Progetti", 1_312),
        ("Diario", 860),
        ("Bozze", 124),
    ];
    let mut serial = 0;
    let mut files = 0;
    for (folder, notes) in layout {
        let notes = notes / divisor;
        let at = root.join(folder);
        std::fs::create_dir_all(&at).unwrap();
        // In «Bozze» una nota per livello della catena, e le altre sono piatte:
        // la prima ha il nome lungo.
        let chained = if folder == "Bozze" { CHAIN } else { 0 };
        for i in 0..notes - chained {
            serial += 1;
            let title = if folder == "Bozze" && i == 0 {
                LONG_TITLE.to_owned()
            } else {
                format!("Nota {serial:05}")
            };
            write_note(&at.join(format!("{title}.md")), &title);
            files += 1;
        }
        if folder == "Bozze" {
            let mut level_dir = at;
            for level in 1..=CHAIN {
                level_dir = level_dir.join(format!("Livello {level}"));
                std::fs::create_dir_all(&level_dir).unwrap();
                if level < CHAIN {
                    write_note(
                        &level_dir.join(format!("Appunti del livello {level}.md")),
                        &format!("Appunti del livello {level}"),
                    );
                } else {
                    serial += 1;
                    write_note(
                        &level_dir.join(format!("Nota {serial:05}.md")),
                        &format!("Nota {serial:05}"),
                    );
                }
                files += 1;
            }
        }
    }
    (dir, root, files)
}

/// Le cartelle che l'indice dà per `under`: il totale, e per ognuna il path e
/// quante sottocartelle dirette ha.
fn folders(host: &Host, under: FolderScope, page: Option<Page>) -> (u32, Vec<(String, u32)>) {
    match host
        .query_index(
            None,
            IndexQuery::Folders {
                under: Some(under),
                page,
            },
        )
        .unwrap()
    {
        IndexResult::Folders(paged) => (
            paged.total,
            paged
                .items
                .into_iter()
                .map(|folder| (folder.path, folder.folders))
                .collect(),
        ),
        other => panic!("cartelle attese, trovato {other:?}"),
    }
}

/// Le voci che l'indice dà per `within`: il totale, e quante ne ha la pagina.
fn entries(host: &Host, within: Option<FolderScope>, page: Option<Page>) -> (u32, usize) {
    match host
        .query_index(
            None,
            IndexQuery::Entries {
                of_kind: None,
                within,
                page,
            },
        )
        .unwrap()
    {
        IndexResult::Entries(paged) => (paged.total, paged.items.len()),
        other => panic!("voci attese, trovato {other:?}"),
    }
}

/// Un montaggio: monta il vault diviso per `divisor`, lo elenca come l'albero,
/// e verifica che le risposte siano quelle giuste. Il tempo è la sola cosa che
/// il montaggio lascia alla prova.
fn attempt(divisor: usize) -> Run {
    let (_dir, root, files) = vault(divisor);
    let big_notes = BIG_NOTES / divisor;
    let host = Host::new().with_watcher(Box::new(NoWatcher));

    let started = Instant::now();
    host.open(&root).unwrap();
    let mounted = started.elapsed();

    // La radice è ciò che l'albero disegna per primo: le sue cartelle, e le
    // voci che ha direttamente, che sono nessuna.
    let started = Instant::now();
    let (folder_total, root_folders) = folders(&host, FolderScope::direct(""), None);
    let (root_entries, _) = entries(&host, Some(FolderScope::direct("")), None);
    let root_list = started.elapsed();

    // Aprire la cartella grande: la sua prima pagina.
    let started = Instant::now();
    let (big_total, big_window) = entries(
        &host,
        Some(FolderScope::direct(BIG)),
        Some(Page::new(0, LEVEL_WINDOW)),
    );
    let big_list = started.elapsed();

    let started = Instant::now();
    host.wait_indexed(None).unwrap();
    let indexed = started.elapsed();

    let (all, _) = entries(&host, None, None);
    println!(
        "{files} file: montaggio {mounted:.1?}, radice ({folder_total} cartelle, {root_entries} voci) {root_list:.1?}, «{BIG}» prima pagina ({big_window} di {big_total}) {big_list:.1?}, indice {indexed:.1?}"
    );

    assert_eq!(folder_total, 5, "cinque cartelle alla radice");
    assert_eq!(
        root_folders
            .iter()
            .map(|(path, _)| path.as_str())
            .collect::<Vec<_>>(),
        [BIG, "Bozze", "Clienti", "Diario", "Progetti"],
    );
    assert_eq!(root_entries, 0, "nessun file direttamente alla radice");
    assert_eq!(all as usize, files, "tutti i file, a ogni profondità");
    assert_eq!(big_total as usize, big_notes);
    assert_eq!(
        big_window,
        big_notes.min(LEVEL_WINDOW as usize),
        "la finestra del livello"
    );

    // La catena: la cartella «Livello 1» ha la sua sottocartella, e questa ne
    // ha una a sua volta.
    let (_, level) = folders(&host, FolderScope::direct("Bozze/Livello 1"), None);
    assert_eq!(level, vec![("Bozze/Livello 1/Livello 2".to_owned(), 1)]);

    Run {
        files,
        mounted,
        root_list,
        big_list,
        indexed,
    }
}

#[test]
fn the_five_thousand_file_vault_mounts_without_growing_with_the_files_and_lists_within_twice_the_budget(
) {
    let mut large = Vec::new();
    let mut small = Vec::new();
    for n in 1..=ATTEMPTS {
        // I due montaggi di un tentativo uno dopo l'altro: il carico che c'è,
        // lo vedono tutti e due.
        print!("tentativo {n}, ");
        large.push(attempt(1));
        print!("tentativo {n}, ");
        small.push(attempt(SMALL));
    }
    assert_eq!(large[0].files, FILES, "il vault del banco");

    let first = large.iter().map(Run::first).min().unwrap();
    let small_first = small.iter().map(Run::first).min().unwrap();
    let big_list = large.iter().map(|run| run.big_list).min().unwrap();
    let indexed = large.iter().map(|run| run.indexed).min().unwrap();
    let ratio = first.as_secs_f64() / small_first.as_secs_f64().max(1e-6);
    println!(
        "vault da {FILES} file, il più veloce dei {ATTEMPTS}: montaggio e radice {first:.1?} (soglia del banco {FIRST_DRAW:?}), {ratio:.1} volte i {} file ({small_first:.1?}, limite {MAX_RATIO}), «{BIG}» {big_list:.1?} (soglia {OPEN_FOLDER:?}), indice {indexed:.1?}",
        small[0].files
    );

    assert!(
        ratio <= MAX_RATIO,
        "montare e listare la radice di {FILES} file ({first:.1?}) è costato {ratio:.1} volte farlo con {} ({small_first:.1?}), oltre {MAX_RATIO}: il montaggio è cresciuto con i file, come se li leggesse prima di rispondere",
        small[0].files
    );
    assert!(
        big_list <= OPEN_FOLDER * 2,
        "aprire «{BIG}» ha richiesto {big_list:.1?} anche nel tentativo più veloce, oltre il doppio della soglia di una cartella ({OPEN_FOLDER:?})"
    );
}
