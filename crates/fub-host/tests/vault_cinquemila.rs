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
//! La prova fallisce solo oltre il doppio delle soglie: il tempo di una
//! macchina che lavora con altri non è un test. I numeri si stampano sempre, e
//! si vedono con `cargo test -p fub-host --test vault_cinquemila -- --nocapture`.

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
/// Le soglie del banco: il primo disegno dall'arrivo dell'elenco, e l'apertura
/// di una cartella (la sua prima pagina, senza il disegno).
const FIRST_DRAW: Duration = Duration::from_millis(300);
const OPEN_FOLDER: Duration = Duration::from_millis(100);
/// Quante cartelle annidate ha la catena di «Bozze».
const CHAIN: usize = 10;
/// Il nome lungo del caso S252, come `LONG_TITLE` del banco.
const LONG_TITLE: &str = "Verbale della riunione di condominio di via Roma 12 con le decisioni sul tetto e sulla caldaia";

fn write_note(path: &Utf8Path, title: &str) {
    std::fs::write(
        path,
        format!("# {title}\n\nUna nota del banco dell'albero.\n"),
    )
    .unwrap();
}

/// Il vault del banco, sul disco: le stesse cartelle, gli stessi nomi.
fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
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
    for (folder, notes) in layout {
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
            }
        }
    }
    (dir, root)
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

#[test]
fn the_five_thousand_file_vault_mounts_and_lists_within_twice_the_budget() {
    let (_dir, root) = vault();
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

    // Aprire la cartella da milleecinquecento note: la sua prima pagina.
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
        "vault da {FILES} file: montaggio {mounted:.1?}, radice ({folder_total} cartelle, {root_entries} voci) {root_list:.1?}, «{BIG}» prima pagina ({big_window} di {big_total}) {big_list:.1?}, indice {indexed:.1?}"
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
    assert_eq!(all as usize, FILES, "tutti i file, a ogni profondità");
    assert_eq!(big_total as usize, BIG_NOTES);
    assert_eq!(big_window as u32, LEVEL_WINDOW, "la finestra del livello");

    // La catena: ogni livello ha la sua sottocartella, e la conta.
    let (_, level) = folders(&host, FolderScope::direct("Bozze/Livello 1"), None);
    assert_eq!(level, vec![("Bozze/Livello 1/Livello 2".to_owned(), 1)]);

    let first = mounted + root_list;
    assert!(
        first <= FIRST_DRAW * 2,
        "montare e listare la radice ha richiesto {first:.1?}, oltre il doppio della soglia del primo disegno ({FIRST_DRAW:?})"
    );
    assert!(
        big_list <= OPEN_FOLDER * 2,
        "aprire «{BIG}» ha richiesto {big_list:.1?}, oltre il doppio della soglia di una cartella ({OPEN_FOLDER:?})"
    );
}
