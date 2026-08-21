// Il banco di questa feature vive con lei: senza la cargo feature `versioning`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "versioning")]
//! **Fotografare una nota non costa quanto il vault intero.**
//!
//! # Perché un conto e non un tempo
//!
//! Il difetto che questo banco presidia era quadratico nel **lavoro**, non nei
//! byte scritti: ogni fotografia costruiva il proprio piano con un
//! `docs.clone()`, cioè copiava la `BTreeMap` che nomina *tutti* i documenti
//! del vault — chiave, cartella ed elenco delle versioni — per cambiarne una
//! voce sola. Un cronometro lo vedeva (3,5 s su 5 000 note, 79 s su 20 000), ma
//! un tempo su una macchina condivisa non è un segnale. Una copia invece è
//! un'**allocazione**, e le allocazioni si contano allo stesso modo ovunque.
//!
//! # Perché la passata, e non un salvataggio singolo
//!
//! Fuori da una passata ogni fotografia riscrive `versions.json`, che nomina
//! tutti i documenti: quel costo è O(N) per definizione — è il prezzo onesto di
//! un indice, e nasconderebbe qualunque altra cosa in un conto di allocazioni.
//! Dentro la passata l'indice si scrive **una volta sola**
//! (`the_before_snapshot_writes_the_index_a_time_single`), e ciò che resta per ogni
//! nota è esattamente il piano. Ma il piano è lo stesso codice —
//! `Inner::apply` — su cui passa ogni salvataggio a vault aperto: la passata
//! è il posto dove lo si vede da solo, non un caso a parte.
//!
//! # Chi è stato rosso e chi no
//!
//! **Rosso**: `a_pass_does_not_pays_the_vault_a_every_snapshot`. Con il
//! `docs.clone()` di prima, raddoppiare le note quadruplicava il conto —
//! 68 210 allocazioni su 200 note contro 262 978 su 400, cioè **3,86x** per il
//! doppio del lavoro. Con il piano che nomina le chiavi toccate sono 5 407 e
//! 10 784, cioè **1,99x**: la crescita del numero di note, e nient'altro.
//!
//! **Verdi anche prima, e dichiarato**: gli altri due. Non provano che qualcosa
//! sia cambiato, provano che qualcosa **non** è cambiato — l'indice che va sul
//! disco nomina ancora tutti i documenti, non solo quello toccato, e un indice
//! che il disco rifiuta non lascia in memoria una versione che sul disco non
//! c'è. Sono le due metà che il piano più magro potrebbe portarsi via in
//! silenzio, ed è per questo che stanno accanto al conto.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use fub_abi::model::DocId;
use fub_abi::traits::DataRead;
use fub_features::{VersionStore, VersioningHandler};
use fub_sdk::testing::MemoryHost;

thread_local! {
    /// Le allocazioni fatte **da questo thread**: `cargo test` gira in
    /// parallelo, e un contatore condiviso misurerebbe il vicino di banco.
    static ALLOCATIONS: Cell<u64> = const { Cell::new(0) };
}

/// Passa tutto a `System` e conta le chiamate. Il `const { Cell::new(0) }` non è
/// un vezzo: una TLS con inizializzazione pigra allocherebbe al primo accesso, e
/// allocare dentro `alloc` è una ricorsione. Il `try_with` copre l'unico caso
/// che resta, un thread che sta morendo con le TLS già smontate.
struct Counter;

unsafe impl GlobalAlloc for Counter {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOCATIONS.try_with(|c| c.set(c.get() + 1));
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counter = Counter;

/// Quante allocazioni costa `f`.
fn allocations_of<T>(f: impl FnOnce() -> T) -> u64 {
    let before = ALLOCATIONS.with(Cell::get);
    let _ = f();
    ALLOCATIONS.with(Cell::get) - before
}

/// L'indice dello store, nello spazio dati del plugin. È privato nel modulo, e
/// qui si nomina il path perché è ciò che un plugin di terzi vedrebbe: il banco
/// guarda lo spazio dati, non l'interno della feature.
const INDEX_FILE: &str = "versions.json";

fn vault(count: usize) -> MemoryHost {
    let mut host = MemoryHost::new();
    for the in 0..count {
        host = host.with_document(
            &format!("note/{the:04}.md"),
            &format!("# Nota {the}\n\nUn corpo qualsiasi, lungo abbastanza da non\nessere un caso degenere.\n"),
        );
    }
    host
}

/// Quante allocazioni costa fotografare un vault di `quante` note.
fn pass_on(count: usize) -> u64 {
    let mut host = vault(count);
    let store = VersionStore::open(&mut host).expect("apertura");
    let handler = VersioningHandler::new(store.clone());
    let cost = allocations_of(|| {
        handler
            .first_snapshot_of_the_vault(&mut host)
            .expect("la prima fotografia")
    });
    assert_eq!(
        store.documents().len(),
        count,
        "la passata non ha fotografato tutto il vault: il conto non misura il lavoro giusto"
    );
    cost
}

/// Il costo di una fotografia dipende da **quella nota**, non da quante note
/// ci sono già: raddoppiare il vault raddoppia il lavoro della passata, non lo
/// quadruplica.
///
/// La soglia è un tetto e non un'uguaglianza — le allocazioni di contorno
/// (formattazione dei nomi, serializzazione dell'indice finale) ci sono e
/// crescono anche loro con le note. Ma stanno tutte nella parte lineare: il
/// termine che questo banco cerca è l'unico che ha un'altra classe, e fra 2,0 e
/// 3,7 non c'è niente da discutere.
#[test]
fn a_pass_does_not_pays_the_vault_a_every_snapshot() {
    let few = pass_on(200);
    let doubles = pass_on(400);

    assert!(
        doubles <= few * 5 / 2,
        "duecento note in più sono costate {doubles} allocazioni contro {few} \
         ({:.2}x per il doppio delle note): il piano di ogni fotografia sta \
         ancora copiando l'anagrafe di tutto il vault",
        doubles as f64 / few as f64
    );
}

/// Il conto di sopra è cieco a ciò che non gli si dice di guardare, e la cosa
/// che deve restare vera non è «si copia poco»: è che l'indice sul disco
/// continui a nominare **tutti** i documenti, e non solo quello che la
/// fotografia ha toccato.
///
/// È esattamente ciò che un piano più magro può portarsi via senza che nessuno
/// se ne accorga fino alla prossima apertura, dove uno store riaperto da un
/// indice mutilato avrebbe perso ogni altra storia.
#[test]
fn a_save_writes_a_index_that_names_all() {
    let mut host = vault(50);
    let store = VersionStore::open(&mut host).expect("apertura");
    let handler = VersioningHandler::new(store.clone());
    handler
        .first_snapshot_of_the_vault(&mut host)
        .expect("la prima fotografia");
    drop(handler);

    // Un salvataggio come tutti gli altri: fuori da una passata, quindi
    // l'indice si riscrive qui.
    let id = DocId::new("note/0007.md");
    store
        .snapshot(&id, "# Nota 7\n\nriscritta a mano\n", &mut host)
        .expect("la fotografia")
        .expect("il contenuto è cambiato, quindi una versione c'è");
    drop(store);

    // Riaperto **dall'indice**: se la scrittura avesse messo giù il solo
    // documento toccato, di qui uscirebbe uno store con una storia sola.
    let reopened = VersionStore::open(&mut host).expect("riapertura");
    assert_eq!(
        reopened.documents().len(),
        50,
        "l'indice riscritto da un salvataggio nomina {} documenti su cinquanta",
        reopened.documents().len()
    );
    assert_eq!(
        reopened.list(&id).len(),
        2,
        "il documento toccato ha perso una delle sue due versioni"
    );
    for other in reopened.documents() {
        let versions = reopened.list(&other);
        assert!(
            !versions.is_empty(),
            "{other} è nominato dall'indice senza nessuna versione"
        );
        assert!(
            reopened.read(&other, versions[0].ts, &host).is_ok(),
            "l'indice nomina una versione di {other} e il contenuto non c'è"
        );
    }
    assert!(
        host.data_read(INDEX_FILE).expect("lettura").is_some(),
        "l'indice non è sul disco"
    );
}

/// La disciplina che non è in discussione: il piano si **installa solo se il
/// disco l'ha accettato**. Se `versions.json` non si scrive, in memoria non
/// deve restare una versione che sul disco nessuno nomina — o il prossimo
/// salvataggio pianificherebbe da una base che non esiste.
#[test]
fn a_index_rejected_does_not_leaves_in_memory_a_version_that_does_not_exists() {
    let mut host = vault(20);
    let store = VersionStore::open(&mut host).expect("apertura");
    let handler = VersioningHandler::new(store.clone());
    handler
        .first_snapshot_of_the_vault(&mut host)
        .expect("la prima fotografia");
    drop(handler);

    let id = DocId::new("note/0003.md");
    let before = store.list(&id);
    host.denies_write(INDEX_FILE);

    let outcome = store.snapshot(&id, "# Nota 3\n\nun testo nuovo\n", &mut host);

    assert!(
        outcome.is_err(),
        "l'indice è stato rifiutato e nessuno l'ha detto"
    );
    assert_eq!(
        store.list(&id),
        before,
        "il disco ha detto di no e la memoria è andata avanti lo stesso"
    );
    assert_eq!(
        store.documents().len(),
        20,
        "il piano rifiutato ha cambiato l'anagrafe in memoria"
    );
}
