//! **Il banco delle prestazioni** (§17.1,
//! [decisione 0113](../../../docs/decisions/0113-il-banco-conta-le-operazioni.md)):
//! misura **operazioni**, non tempi.
//!
//! La voce chiedeva «benchmark su vault sintetici grandi (10k/100k note) in CI,
//! con soglie: tempo di apertura, ricerca, memoria». Metà di quella riga è stata
//! scartata, e la ragione sta scritta a due passi da qui: la §8.4 aveva già un
//! presidio che confrontava due tempi, e la CI l'ha smentito — un rapporto
//! venuto 0,97 su ubuntu e 0,89 su windows con la suite verde in locale, non
//! perché la proprietà fosse falsa ma perché su un runner condiviso **il tempo
//! non è un segnale**. Una soglia in millisecondi o è così larga che non scatta
//! mai, o scatta sul vicino di banco.
//!
//! Ciò che resta, e che una macchina qualunque misura sempre uguale, è **quante
//! volte** si fa una cosa:
//!
//! - *tempo di apertura* → quanti **attraversamenti del confine** e quanti
//!   **parse** costa aprire un vault di N note;
//! - *ricerca e memoria* → quante **allocazioni** costa una pagina di venti
//!   righe, e — la sola domanda che conta — se quel numero **cresce col vault**.
//!
//! # Perché il vault sintetico è piccolo
//!
//! Le note qui sono seicento e non centomila, ed è deliberato. Un conto esatto è
//! esatto a qualunque taglia: `ceil(N / 512)` vale per seicento come per
//! centomila, e seicento è il minimo che attraversa il lotto **due** volte, cioè
//! il minimo che distingue «a lotti» da «tutto insieme». Centomila note
//! comprerebbero solo un numero di secondi, che è precisamente la cosa che
//! questo banco non misura.
//!
//! # Come si conta la memoria senza guardare i byte
//!
//! Un allocatore che conta le chiamate, per thread. Il numero assoluto non vuol
//! dire niente e non va mai asserito: quello che vuol dire tutto è la
//! **differenza fra due vault di taglia diversa sulla stessa macchina**, che è
//! la forma di un rapporto e non di una soglia.
//!
//! **La zona cieca di quella scelta, misurata**: se il lavoro caro emigra su un
//! altro thread, questo banco non lo segue — stesso identico lavoro, milleduecento
//! allocazioni sul thread del test e sei su un figlio. Non è un'attenuazione, è
//! una sparizione, e per giunta in verde. Vale per qualunque risposta che un
//! giorno venisse servita da un pool: il giorno che succede, questa misura va
//! spostata dove il lavoro è andato, non allargata.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::error::{FormatError, PluginError};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, Page, QueryRoute, VaultEntry,
};
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::{Banco, Montato};

// ---------------------------------------------------------------------------
// L'allocatore che conta
// ---------------------------------------------------------------------------

thread_local! {
    /// Le allocazioni fatte **da questo thread**. Per thread e non globale
    /// perché `cargo test` fa girare i test in parallelo: un contatore condiviso
    /// misurerebbe il vicino, che è il difetto da cui questo banco nasce.
    static ALLOCAZIONI: Cell<u64> = const { Cell::new(0) };
}

/// Un allocatore che passa tutto a `System` e conta le chiamate.
///
/// Il `const { Cell::new(0) }` del `thread_local!` non è un vezzo: una TLS con
/// inizializzazione pigra allocherebbe al primo accesso, e allocare dentro
/// `alloc` è una ricorsione. Con l'inizializzazione costante l'accesso non
/// alloca, e il `try_with` copre l'unico caso che resta — un thread che sta
/// morendo e ha già smontato le sue TLS.
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

// ---------------------------------------------------------------------------
// Le due spie: chi parsa e chi riceve i lotti
// ---------------------------------------------------------------------------

/// Un formato che conta i **parse**, cioè il lavoro vero di un'apertura.
#[derive(Clone, Default)]
struct Parser {
    parse: Arc<AtomicUsize>,
}

impl Parser {
    fn conta(&self) -> usize {
        self.parse.load(Ordering::Relaxed)
    }
}

impl FormatProvider for Parser {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("banco", "Il formato del banco (test)", &["md"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        self.parse.fetch_add(1, Ordering::Relaxed);
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

/// Un indice che conta **le chiamate**, non i documenti.
///
/// È la differenza che nessun altro presidio di questo repo guarda: le nove
/// spie che implementano `on_documents_indexed` nei test iterano `docs` e
/// registrano una riga per documento, appiattendo proprio il confine del lotto
/// che il §20.1 esiste per rendere raro. Con quelle spie, `FEED_BATCH = 1`
/// resterebbe verde ovunque.
#[derive(Clone, Default)]
struct Lotti {
    chiamate: Arc<AtomicUsize>,
    documenti: Arc<AtomicUsize>,
}

impl Lotti {
    fn chiamate(&self) -> usize {
        self.chiamate.load(Ordering::Relaxed)
    }

    fn documenti(&self) -> usize {
        self.documenti.load(Ordering::Relaxed)
    }
}

impl IndexProvider for Lotti {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    /// Dice di avere già tutto: è la condizione della **riapertura a caldo**, e
    /// senza di lei il ramo che salta i parse non si può nemmeno raggiungere.
    fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> {
        entries.iter().map(|e| e.id.clone()).collect()
    }

    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        self.chiamate.fetch_add(1, Ordering::Relaxed);
        self.documenti.fetch_add(docs.len(), Ordering::Relaxed);
        Vec::new()
    }

    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("il banco non risponde".into()))
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Il vault sintetico
// ---------------------------------------------------------------------------

/// Un vault di `note` file, sotto una radice che il chiamante tiene in vita —
/// perché la riapertura a caldo vuole ritrovare lo stesso disco.
fn semina(radice: &Utf8Path, note: usize) -> (Montato, Parser, Lotti) {
    let parser = Parser::default();
    let lotti = Lotti::default();
    let mut banco = Banco::su(radice)
        .con_formato(Box::new(parser.clone()))
        .con_plugin("test.banco")
        .senza_scansione()
        .monta();
    for i in 0..note {
        banco.scrivi(
            &format!("Nota {i}.md"),
            &format!("# Nota {i}\n\nUn corpo con [[Nota 0]] e #banco, abbastanza\nlungo da costare un parse vero.\n"),
        );
    }
    banco
        .register_index_provider("test.banco".to_string(), Box::new(lotti.clone()))
        .expect("l'indice del banco si registra");
    (banco, parser, lotti)
}

/// La stessa cartella riaperta da zero: un `Workspace` nuovo sullo stesso disco,
/// che è ciò che succede al secondo avvio dell'app.
fn riapri(radice: &Utf8Path) -> (Workspace, Parser, Lotti) {
    let parser = Parser::default();
    let lotti = Lotti::default();
    let mut formati = FormatRegistry::new();
    formati
        .register(Box::new(parser.clone()))
        .expect("il formato del banco non collide");
    let mut ws = Workspace::new(radice, formati);
    ws.register_core_feature("test.banco", "test.banco")
        .expect("feature dichiarata una volta sola");
    ws.register_index_provider("test.banco".to_string(), Box::new(lotti.clone()))
        .expect("l'indice del banco si registra");
    (ws, parser, lotti)
}

fn cartella() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("cartella temporanea");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("radice UTF-8");
    (dir, root)
}

/// Quante note stanno in un lotto. Deve combaciare con `FEED_BATCH` del kernel,
/// che è privato: qui il numero si riscrive, e se i due divergono sono gli
/// `assert_eq!` di sotto a dirlo, con dentro il conto che si aspettavano.
const LOTTO: usize = 512;

// ---------------------------------------------------------------------------
// 1. L'apertura, contata in attraversamenti del confine
// ---------------------------------------------------------------------------

/// **Aprire N note attraversa il confine `ceil(N / 512)` volte, non N.**
///
/// È il numero che la 0051 ha scelto e che nessuno verificava: le spie degli
/// altri banchi contano i documenti, e contando i documenti `FEED_BATCH = 1` è
/// indistinguibile da `FEED_BATCH = 512`. A M5 ogni attraversamento è una
/// serializzazione, quindi è **questo** il numero che vale, non quanti modelli
/// ci passano dentro.
#[test]
fn aprire_un_vault_attraversa_il_confine_una_volta_per_lotto() {
    // Trecento note stanno in un lotto solo, seicento in due: è il minimo che
    // distingue «a lotti» da «tutto insieme».
    for note in [300usize, 600] {
        let (_dir, radice) = cartella();
        let (mut banco, _parser, lotti) = semina(&radice, note);
        banco.reindex().expect("apertura");

        let attesi = note.div_ceil(LOTTO);
        assert_eq!(
            lotti.chiamate(),
            attesi,
            "{note} note: attesi {attesi} attraversamenti del confine \
             (un lotto è di {LOTTO}), trovati {}. Contare i documenti non \
             vedrebbe la differenza: sono {} in tutti e due i casi.",
            lotti.chiamate(),
            lotti.documenti(),
        );
        assert_eq!(
            lotti.documenti(),
            note,
            "e i documenti ci passano tutti: il lotto riduce le volte, non il volume"
        );
    }
}

// ---------------------------------------------------------------------------
// 2. La riapertura, contata in parse
// ---------------------------------------------------------------------------

/// **Riaprire un vault intatto non parsa niente e non attraversa niente.**
///
/// È «apri in fretta un vault grande» detto in un numero invece che in
/// millisecondi: il costo di una riapertura non è una frazione del costo della
/// prima, è **zero** — l'impronta in anagrafe combacia, gli indici dicono di
/// avere già tutto, e non c'è nessun modello da consegnare.
///
/// L'ultima metà di questa proprietà è arrivata **misurando**: prima di questo
/// banco la riapertura a caldo attraversava il confine lo stesso, `ceil(N/512)`
/// volte, con un lotto **vuoto** ogni volta. Nessun test lo vedeva, perché
/// nessuno contava le chiamate.
#[test]
fn riaprire_un_vault_intatto_non_costa_un_parse() {
    let note = 600;
    let (_dir, radice) = cartella();
    let (mut banco, parser, _lotti) = semina(&radice, note);
    banco.reindex().expect("prima apertura");
    assert_eq!(
        parser.conta(),
        note,
        "a freddo si parsa tutto, una volta sola"
    );
    drop(banco);

    let (mut ws, parser, lotti) = riapri(&radice);
    ws.reindex().expect("riapertura");

    assert_eq!(
        parser.conta(),
        0,
        "un vault che nessuno ha toccato non si riparsa: {} parse di troppo",
        parser.conta()
    );
    assert_eq!(
        lotti.chiamate(),
        0,
        "e nemmeno si attraversa il confine: un lotto vuoto è una serializzazione \
         che non porta niente"
    );
}

// ---------------------------------------------------------------------------
// 3. Una pagina, contata in allocazioni
// ---------------------------------------------------------------------------

/// **Mostrare venti righe di un vault non costa quanto il vault.**
///
/// È la promessa scritta su `Page` — «un vault con centomila note non deve
/// materializzare centomila righe per mostrarne venti» — e prima di questo banco
/// era falsa per ogni famiglia dell'indice del kernel: si costruiva l'insieme
/// intero e poi lo si tagliava. Misurato su questo banco: trecento note
/// costavano seicentotto allocazioni per una pagina di venti, e seicento note
/// ne costavano milleduecentonove — due per nota, cioè esattamente la linearità
/// che la finestra doveva togliere. Dopo, quarantaquattro in tutti e due i casi.
///
/// Il presidio non guarda il numero assoluto, che dipende da com'è fatto
/// l'allocatore: guarda che **raddoppiare il vault non cambi il prezzo di una
/// pagina**. È l'unica forma in cui una misura di memoria sopravvive a una
/// macchina che non si conosce.
#[test]
fn una_pagina_di_venti_non_cresce_col_vault() {
    let mut costi = Vec::new();
    for note in [300usize, 600] {
        let (_dir, radice) = cartella();
        let (mut banco, _parser, _lotti) = semina(&radice, note);
        banco.reindex().expect("apertura");

        // Un giro a vuoto: la prima domanda paga ciò che si alloca una volta
        // sola, e pagarlo dentro la misura la falserebbe.
        let _ = pagina_di_venti(&banco);
        costi.push(allocazioni_di(|| pagina_di_venti(&banco)));
    }

    let (piccolo, grande) = (costi[0], costi[1]);
    assert!(
        grande <= piccolo + 20,
        "una pagina di venti righe è costata {piccolo} allocazioni su trecento \
         note e {grande} su seicento: il prezzo di una pagina cresce col vault, \
         cioè quello che sta fuori dalla finestra viene costruito lo stesso. \
         Da guardare in quest'ordine: la famiglia usa `Paged::window` invece di \
         `Paged::from_source`, oppure la usa ma con un `.map()` caro **sulla \
         sorgente** invece che dentro `make` — che è la stessa linearità con un \
         nome diverso."
    );
}

/// Le prime venti voci dell'anagrafe, che è la famiglia più grande che il
/// kernel serva: una riga per **file** del vault, allegati compresi.
fn pagina_di_venti(ws: &Workspace) -> usize {
    match ws
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: Some(Page::first(20)),
        })
        .expect("l'anagrafe risponde")
    {
        IndexResult::Entries(paged) => {
            assert_eq!(paged.items.len(), 20, "la finestra è di venti righe");
            assert!(
                paged.total >= 300,
                "e il conto resta quello vero: `total` dice {} su un vault che \
                 ha almeno trecento note, cioè conta la finestra invece della \
                 sorgente",
                paged.total
            );
            paged.items.len()
        }
        altro => panic!("attesa l'anagrafe, trovato {altro:?}"),
    }
}
