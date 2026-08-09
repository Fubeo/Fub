// Il banco di questa feature vive con lei: senza la cargo feature `search`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "search")]
//! **Che cosa costa una ricerca senza finestra**, contato in allocazioni.
//!
//! `SearchIndex::search` traduce «nessuna finestra» in
//! `TopDocs::with_limit(total)`, dove `total` è il conteggio della stessa
//! query. Letta da fuori quella riga sembra un tetto dimenticato — un vault
//! grande, un termine comune, e tantivy si sente chiedere diecimila risultati.
//! Questo banco misura quanto costa davvero quel tetto, e la risposta è
//! **niente**: `total` non è un numero inventato lì, è quanti risultati il
//! chiamante ha chiesto.
//!
//! # I numeri, su un indice di duemila note in cui tutte combaciano
//!
//! | domanda | allocazioni | byte |
//! |---|---|---|
//! | `page: None` (il tetto è `total` = 2000) | 14 326 | 3 706 509 |
//! | `page: Some(0..2000)` (lo stesso tetto, scritto) | 14 287 | 3 514 128 |
//! | `page: Some(0..20)` | 427 | 68 494 |
//!
//! Le prime due righe sono **la stessa chiamata**: `(0, total)` e `(0, 2000)`
//! sono lo stesso `offset`/`limit`, e la differenza fra loro — trentanove
//! allocazioni — è il rumore di due esecuzioni identiche. A quattromila note
//! diventano 31 323 e 31 242, e la distanza resta quella.
//!
//! **L'argomento di `with_limit` non si vede nel conto.** Alzarlo a `total`
//! anche quando una finestra c'è, e troncare subito dopo il collector, lascia le
//! allocazioni di una domanda da venti righe dove stavano (427): il
//! `Vec::with_capacity(2 * top_n)` che tantivy alloca lì dentro è **una**
//! allocazione, e una non si distingue dal rumore. Quello che costa è
//! `searcher.doc(address)`, cioè circa sette allocazioni per **riga
//! restituita** — 427 per venti righe, 14 287 per duemila. Il tetto non è un
//! costo: è la risposta alla domanda «quante righe vuoi».
//!
//! E chiedere senza finestra non è una dimenticanza: è **come il pianificatore
//! interroga sempre** (`fub-kernel/src/index/plan.rs`, `Router::ask`), perché
//! l'ordine e la finestra di una risposta a `Documents` sono del contratto
//! (decisione 0020) e non di tantivy, che rompe la parità per indirizzo di
//! segmento. Consegnare la finestra al provider vorrebbe dire lasciargli
//! scegliere quali righe stanno nella pagina con un ordine che il contratto non
//! promette — e il prezzo di non farlo è scritto lì, dove si chiama costo di
//! **selezione**.
//!
//! # I due presidi, e cos'è rosso
//!
//! - `senza_finestra_escono_tutti_i_risultati` tiene ferma la metà che un tetto
//!   inventato romperebbe **in silenzio**: chi chiede tutto riceve tutto.
//!   *Provato in rosso* rimettendo un tetto al posto di `total`
//!   (`None => (0usize, 100.min(total))`): cento righe invece di duemila.
//! - `una_finestra_non_paga_il_vault` dice da cosa dipende il costo: da quante
//!   righe si restituiscono, non da quante note ci sono. *Provato in rosso*
//!   spostando la finestra **dopo** la materializzazione — il collector prende
//!   `total` e le righe si troncano alla fine, che è il modo in cui si pagina
//!   quando ci si dimentica che la sorgente sa impaginare: 7287 → 14 287, cioè
//!   settemila allocazioni in più per le stesse venti righe. **Non** diventa
//!   rosso alzando l'argomento di `with_limit` da solo, ed è dichiarato apposta:
//!   quello è il numero che smentisce la riga d'audit.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use camino::Utf8PathBuf;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{Excerpts, IndexProvider, IndexQuery, IndexResult, Page, PropertySelect};
use fub_features::SearchIndex;
use fub_sdk::testing::MemoryHost;

thread_local! {
    /// Le allocazioni fatte **da questo thread**: `cargo test` gira in
    /// parallelo, e un contatore condiviso misurerebbe il vicino di banco.
    static ALLOCAZIONI: Cell<u64> = const { Cell::new(0) };
}

/// Passa tutto a `System` e conta le chiamate. Il `const { Cell::new(0) }` non è
/// un vezzo: una TLS con inizializzazione pigra allocherebbe al primo accesso, e
/// allocare dentro `alloc` è una ricorsione. Il `try_with` copre l'unico caso
/// che resta, un thread che sta morendo con le TLS già smontate.
struct Contatore;

unsafe impl GlobalAlloc for Contatore {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOCAZIONI.try_with(|c| c.set(c.get() + 1));
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATORE: Contatore = Contatore;

/// Quante allocazioni costa `f`.
fn allocazioni_di<T>(f: impl FnOnce() -> T) -> u64 {
    let prima = ALLOCAZIONI.with(Cell::get);
    let _ = f();
    ALLOCAZIONI.with(Cell::get) - prima
}

/// La parola che sta in **ogni** nota: serve un termine comune, o il tetto di
/// cui si parla non arriverebbe mai a essere grande.
const COMUNE: &str = "aghifoglia";

/// Un indice vero — tantivy su disco — con `quante` note che combaciano tutte.
fn indice(quante: usize) -> (tempfile::TempDir, SearchIndex) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().join("index")).expect("utf8");
    let mut host = MemoryHost::new();
    let mut idx = SearchIndex::open_dir(&path).expect("apertura indice");
    idx.activate(&mut host).expect("attivazione");
    let note: Vec<DocumentModel> = (0..quante)
        .map(|i| {
            let mut m = DocumentModel::empty(DocId::new(format!("nota{i:05}.md")));
            m.text = format!("Nota {i}. Un corpo qualsiasi che nomina una {COMUNE}.");
            m
        })
        .collect();
    let _ = idx.on_documents_indexed(&note);
    (dir, idx)
}

/// La domanda come la fa il pianificatore: niente estratti, e la finestra è
/// l'unica cosa che cambia fra un caso e l'altro.
fn chiedi(idx: &SearchIndex, page: Option<Page>) -> (usize, u32) {
    match idx.query(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms(COMUNE))),
        sort: None,
        select: PropertySelect::None,
        page,
        excerpts: Excerpts::Omit,
    }) {
        Ok(IndexResult::Documents(hits)) => (hits.items.len(), hits.total),
        other => panic!("attesi documenti, trovato {other:?}"),
    }
}

/// Chi non chiede una finestra riceve **tutto**, e duemila non è un numero
/// tondo: è il numero di note che combaciano.
///
/// È la metà della correttezza, e va tenuta ferma prima dell'altra: qualunque
/// tetto messo qui per far scendere un conto si porterebbe via dei risultati
/// senza che nessuno lo veda — chi chiede riceverebbe una risposta più corta e
/// nessun modo di sapere che lo è.
#[test]
fn senza_finestra_escono_tutti_i_risultati() {
    let (_g, idx) = indice(2000);

    let (quanti, totale) = chiedi(&idx, None);

    assert_eq!(
        quanti, 2000,
        "senza finestra sono uscite {quanti} righe su duemila: qualcuno ha messo un tetto"
    );
    assert_eq!(totale, 2000, "e il conteggio deve dire lo stesso numero");
}

/// Il costo di una ricerca dipende da **quanti risultati si chiedono**, non da
/// quante note ci sono nel vault: raddoppiare le note a parità di finestra non
/// costa niente in più.
///
/// È il verso in cui la riga d'audit sbagliava. `TopDocs::with_limit(total)` non
/// è un tetto scelto male: `total` è il numero di righe che il chiamante ha
/// chiesto, e il conto non sa nemmeno dire quanto valga quell'argomento —
/// quello che sa dire è quante righe sono uscite.
#[test]
fn una_finestra_non_paga_il_vault() {
    let (_g1, mille) = indice(1000);
    let (_g2, duemila) = indice(2000);

    // Un giro a vuoto: la prima chiamata paga le inizializzazioni pigre e
    // scalda i reader di tantivy.
    let _ = chiedi(&mille, Some(Page::first(20)));
    let _ = chiedi(&duemila, Some(Page::first(20)));

    let a = allocazioni_di(|| chiedi(&mille, Some(Page::first(20))));
    let b = allocazioni_di(|| chiedi(&duemila, Some(Page::first(20))));

    assert_eq!(
        chiedi(&mille, Some(Page::first(20))).0,
        chiedi(&duemila, Some(Page::first(20))).0,
        "il confronto regge solo se le due domande restituiscono lo stesso numero di righe"
    );
    assert!(
        b <= a + 64,
        "mille note in più sono costate {} allocazioni in più ({a} → {b}) a parità di \
         righe restituite: la finestra si sta applicando dopo aver materializzato tutto",
        b as i64 - a as i64
    );
}
