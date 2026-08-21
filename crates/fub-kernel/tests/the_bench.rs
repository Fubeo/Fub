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
use fub_abi::model::{DocId, DocumentModel, Frontmatter, Link, LinkTarget, Span, Tag};
use fub_abi::traits::{
    HealthCheck, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, LinkDirection, Page,
    QueryRoute, VaultEntry,
};
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::{Bench, Mounted};

// ---------------------------------------------------------------------------
// L'allocatore che conta
// ---------------------------------------------------------------------------

thread_local! {
    /// Le allocazioni fatte **da questo thread**. Per thread e non globale
    /// perché `cargo test` fa girare i test in parallelo: un contatore condiviso
    /// misurerebbe il vicino, che è il difetto da cui questo banco nasce.
    static ALLOCATIONS: Cell<u64> = const { Cell::new(0) };
}

/// Un allocatore che passa tutto a `System` e conta le chiamate.
///
/// Il `const { Cell::new(0) }` del `thread_local!` non è un vezzo: una TLS con
/// inizializzazione pigra allocherebbe al primo accesso, e allocare dentro
/// `alloc` è una ricorsione. Con l'inizializzazione costante l'accesso non
/// alloca, e il `try_with` copre l'unico caso che resta — un thread che sta
/// morendo e ha già smontato le sue TLS.
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
fn count_allocations<T>(f: impl FnOnce() -> T) -> u64 {
    let before = ALLOCATIONS.with(Cell::get);
    let _ = f();
    ALLOCATIONS.with(Cell::get) - before
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
    fn count(&self) -> usize {
        self.parse.load(Ordering::Relaxed)
    }
}

impl FormatProvider for Parser {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("bench", "The bench format (test)", &["md"])
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
        model.links.push(Link {
            target: LinkTarget::wiki(NOTE_ZERO),
            embed: false,
            span: Span::EMPTY,
            context: Some("bench link".to_string()),
        });
        model.tags.push(Tag {
            name: format!("bench/{}", ctx.doc_id),
            span: Span::EMPTY,
        });
        let mut fields = serde_json::Map::new();
        fields.insert(
            "bench".to_string(),
            serde_json::Value::String(ctx.doc_id.clone()),
        );
        model.frontmatter = Frontmatter(fields);
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
struct Batches {
    calls: Arc<AtomicUsize>,
    documents: Arc<AtomicUsize>,
}

impl Batches {
    fn calls(&self) -> usize {
        self.calls.load(Ordering::Relaxed)
    }

    fn documents(&self) -> usize {
        self.documents.load(Ordering::Relaxed)
    }
}

impl IndexProvider for Batches {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    /// Dice di avere già tutto: è la condizione della **riapertura a caldo**, e
    /// senza di lei il ramo che salta i parse non si può nemmeno raggiungere.
    /// senza di lei il ramo che salta i parse non si può nemmeno raggiungere.
    fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> {
        entries.iter().map(|and| and.id.clone()).collect()
    }

    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        self.documents.fetch_add(docs.len(), Ordering::Relaxed);
        Vec::new()
    }

    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("the bench does not respond".into()))
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

/// Un vault di `count` file, sotto una radice che il chiamante tiene in vita —
/// perché la riapertura a caldo vuole ritrovare lo stesso disco.
fn seed(root: &Utf8Path, count: usize) -> (Mounted, Parser, Batches) {
    let parser = Parser::default();
    let batches = Batches::default();
    let mut bench = Bench::on(root)
        .with_format(Box::new(parser.clone()))
        .with_plugin("test.bench")
        .without_scan()
        .mounts();
    for the in 0..count {
        bench.write(
            &note_path(the),
            &format!("# Note {the}\n\nA body with [[{NOTE_ZERO}]] and #bench, long enough\nto cost a real parse.\n"),
        );
    }
    bench
        .register_index_provider("test.bench".to_string(), Box::new(batches.clone()))
        .expect("the bench index registers");
    (bench, parser, batches)
}

/// La stessa cartella riaperta da zero: un `Workspace` nuovo sullo stesso disco,
/// che è ciò che succede al secondo avvio dell'app.
fn reopen(root: &Utf8Path) -> (Workspace, Parser, Batches) {
    let parser = Parser::default();
    let batches = Batches::default();
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(parser.clone()))
        .expect("the bench format does not collide");
    let mut ws = Workspace::new(root, formats).expect("the vault opens");
    ws.register_core_feature("test.bench", "test.bench")
        .expect("feature declared once");
    ws.register_index_provider("test.bench".to_string(), Box::new(batches.clone()))
        .expect("the bench index registers");
    (ws, parser, batches)
}

fn folder() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("temporary folder");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("UTF-8 root");
    (dir, root)
}

/// Quante note stanno in un lotto. Deve combaciare con `FEED_BATCH` del kernel,
/// che è privato: qui il numero si riscrive, e se i due divergono sono gli
/// `assert_eq!` di sotto a dirlo, con dentro il conto che si aspettavano.
const BATCH_SIZE: usize = 512;
const NOTE_ZERO: &str = "Folder 0/Note 0.md";

fn note_path(index: usize) -> String {
    format!("Folder {index}/Note {index}.md")
}

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
fn opening_a_vault_crosses_the_boundary_once_for_batch() {
    // Trecento note stanno in un lotto solo, seicento in due: è il minimo che
    // distingue «a lotti» da «tutto insieme».
    for count in [300usize, 600] {
        let (_dir, root) = folder();
        let (mut bench, _parser, batches) = seed(&root, count);
        bench.reindex().expect("opening");

        let expected = count.div_ceil(BATCH_SIZE);
        assert_eq!(
            batches.calls(),
            expected,
            "{count} notes: expected {expected} boundary crossings \
             (one batch is {BATCH_SIZE}), found {}. Counting documents would \
             not see the difference: there are {} in both cases.",
            batches.calls(),
            batches.documents(),
        );
        assert_eq!(
            batches.documents(),
            count,
            "and all documents pass through: the batch reduces the count, not the volume"
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
fn reopening_an_intact_vault_costs_no_parse() {
    let count = 600;
    let (_dir, root) = folder();
    let (mut bench, parser, _batches) = seed(&root, count);
    bench.reindex().expect("first opening");
    assert_eq!(
        parser.count(),
        count,
        "cold, everything is parsed, once"
    );
    drop(bench);

    let (mut ws, parser, batches) = reopen(&root);
    ws.reindex().expect("reopen");

    assert_eq!(
        parser.count(),
        0,
        "a vault nobody touched is not re-parsed: {} extra parses",
        parser.count()
    );
    assert_eq!(
        batches.calls(),
        0,
        "and the boundary is not crossed either: an empty batch is a serialization \
         that brings nothing"
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
/// macchina che non si conosce.
#[test]
fn a_page_of_twenty_does_not_grow_with_the_vault() {
    let mut costs = Vec::new();
    for count in [300usize, 600] {
        let (_dir, root) = folder();
        let (mut bench, _parser, _batches) = seed(&root, count);
        bench.reindex().expect("opening");

        // Un giro a vuoto: la prima domanda paga ciò che si alloca una volta
        // sola, e pagarlo dentro la misura la falserebbe.
        let _ = first_twenty_entries(&bench);
        costs.push(count_allocations(|| first_twenty_entries(&bench)));
    }

    let (small, large) = (costs[0], costs[1]);
    assert!(
        large <= small + 20,
        "a page of twenty lines cost {small} allocations on three hundred \
         notes and {large} on six hundred: the price of a page grows with the \
         vault, meaning what is outside the window is being built anyway. \
         Check in this order: the family uses `Paged::window` instead of \
         `Paged::from_source`, or uses it but with an expensive `.map()` \
         **on the source** instead of inside `make` — which is the same \
         linearity with a different name."
    );
}

/// Le prime venti voci dell'anagrafe, che è la famiglia più grande che il
/// kernel serva: una riga per **file** del vault, allegati compresi.
fn first_twenty_entries(ws: &Workspace) -> usize {
    match ws
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: Some(Page::first(20)),
        })
        .expect("the entry store responds")
    {
        IndexResult::Entries(paged) => {
            assert_eq!(paged.items.len(), 20, "the window is twenty lines");
            assert!(
                paged.total >= 300,
                "and the count stays the right one: `total` says {} on a vault \
                 that has at least three hundred notes, meaning it counts the \
                 window instead of the source",
                paged.total
            );
            paged.items.len()
        }
        other => panic!("expected the entry store, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// 4. Le famiglie paginabili, una riga di allocazioni ciascuna
// ---------------------------------------------------------------------------

/// Le otto famiglie che costruiscono una pagina (`VaultHealth` ha già il proprio
/// banco di risoluzione qui sotto). Ogni riga misura la stessa domanda su trecento
/// e seicento note: il banco riporta il numero, senza imporre una soglia comune a
/// famiglie che hanno costi diversi per costruzione (in particolare `Folders`).
/// Rimisura: `cargo test -p fub-kernel --test the_bench every_paged_index_family_has_an_allocation_row -- --nocapture`.
const PAGED_FAMILIES: [&str; 8] = [
    "Documents",
    "Backlinks",
    "Tags",
    "Neighbors",
    "PropertyValues",
    "Drafts",
    "Entries",
    "Folders",
];

fn query_paged_family(ws: &Workspace, family: &str) -> usize {
    let page = Some(Page::first(20));
    let items = match family {
        "Documents" => match ws
            .query_index(IndexQuery::Documents {
                matching: Default::default(),
                sort: None,
                select: Default::default(),
                page,
                excerpts: Default::default(),
            })
            .expect("the documents index responds")
        {
            IndexResult::Documents(paged) => paged.items.len(),
            other => panic!("expected documents, got {other:?}"),
        },
        "Backlinks" => match ws
            .query_index(IndexQuery::Backlinks {
                target: DocId::new(NOTE_ZERO),
                page,
            })
            .expect("the backlinks index responds")
        {
            IndexResult::Backlinks(paged) => paged.items.len(),
            other => panic!("expected backlinks, got {other:?}"),
        },
        "Tags" => match ws
            .query_index(IndexQuery::Tags {
                matching: Default::default(),
                page,
            })
            .expect("the tags index responds")
        {
            IndexResult::Tags(paged) => paged.items.len(),
            other => panic!("expected tags, got {other:?}"),
        },
        "Neighbors" => match ws
            .query_index(IndexQuery::Neighbors {
                seeds: Default::default(),
                direction: LinkDirection::Inbound,
                depth: 1,
                page,
            })
            .expect("the graph index responds")
        {
            IndexResult::Neighbors(paged) => paged.items.len(),
            other => panic!("expected neighbors, got {other:?}"),
        },
        "PropertyValues" => match ws
            .query_index(IndexQuery::PropertyValues {
                key: "bench".to_string(),
                matching: Default::default(),
                page,
            })
            .expect("the property index responds")
        {
            IndexResult::PropertyValues(paged) => paged.items.len(),
            other => panic!("expected property values, got {other:?}"),
        },
        "Drafts" => match ws
            .query_index(IndexQuery::Drafts { page })
            .expect("the drafts index responds")
        {
            IndexResult::Drafts(paged) => paged.items.len(),
            other => panic!("expected drafts, got {other:?}"),
        },
        "Entries" => first_twenty_entries(ws),
        "Folders" => match ws
            .query_index(IndexQuery::Folders { under: None, page })
            .expect("the folders index responds")
        {
            IndexResult::Folders(paged) => paged.items.len(),
            other => panic!("expected folders, got {other:?}"),
        },
        other => panic!("unknown paged family {other}"),
    };
    assert_eq!(items, 20, "{family} must construct the requested page");
    items
}

#[test]
fn every_paged_index_family_has_an_allocation_row() {
    let mut rows = Vec::new();
    for count in [300usize, 600] {
        let (_dir, root) = folder();
        let (mut bench, _parser, _batches) = seed(&root, count);
        bench.reindex().expect("opening");
        for the in 0..count {
            bench
                .save_draft(&DocId::new(note_path(the)), "unsaved bench text", None)
                .expect("the draft saves");
        }
        for family in PAGED_FAMILIES {
            let _ = query_paged_family(&bench, family);
            let allocations = count_allocations(|| query_paged_family(&bench, family));
            rows.push((family, count, allocations));
        }
    }
    eprintln!("IndexQuery family | notes | allocations");
    for (family, count, allocations) in rows {
        eprintln!("{family} | {count} | {allocations}");
    }
}

// 4. Risolvere un riferimento, contato in allocazioni
// ---------------------------------------------------------------------------

/// Un formato che mette in ogni documento **un riferimento a un allegato**.
///
/// Serve perché la domanda che questo pezzo di banco misura non la fa il testo
/// ma il link: senza un `![[…]]` in `links`, nessuno chiede niente all'anagrafe
/// e la misura sarebbe la stessa a vault vuoto.
#[derive(Clone, Default)]
struct ReferenceParser;

impl FormatProvider for ReferenceParser {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("bench.refs", "The bench format (test)", &["md"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        model.links = vec![Link {
            target: LinkTarget::wiki(ATTACHMENT),
            embed: true,
            span: Span::EMPTY,
            context: None,
        }];
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

/// Il nome che ogni nota incorpora, e il file che lo porta davvero.
const ATTACHMENT: &str = "exists.png";

/// Venti note che incorporano lo stesso allegato, e `filler` altri allegati
/// che nessuno nomina: è il vault che cresce **sotto** una domanda che resta la
/// stessa.
fn vault_with_attachments(filler: usize) -> Mounted {
    let mut bench = Bench::new().with_format(Box::new(ReferenceParser));
    for the in 0..NOTES_WITH_REFERENCES {
        bench = bench.with_file(&format!("Note {the}.md"), "Some body.\n");
    }
    bench = bench.with_file(&format!("attachments/{ATTACHMENT}"), "Fake PNG");
    for the in 0..filler {
        bench = bench.with_file(&format!("attachments/photo {the}.png"), "Fake PNG");
    }
    bench.mounts()
}

const NOTES_WITH_REFERENCES: usize = 20;

/// **Risolvere un riferimento non costa quanto l'anagrafe.**
///
/// Prima costava esattamente quello: risolvere `![[exists.png]]` calcolava fino
/// a due chiavi di risoluzione **per ogni voce del vault** e chiudeva con un
/// `min_by_key`, che non cortocircuita — quindi trovare costava quanto non
/// trovare, e chi chiede una volta per ogni link di ogni documento (il controllo
/// di salute qui, la riscrittura dei riferimenti quando si sposta un allegato)
/// pagava il vault moltiplicato per sé stesso: la misura della voce diceva
/// ventisette millisecondi a chiamata su ventimila voci, cioè quarantasei minuti
/// per rinominare un allegato (difetto 0115).
///
/// Il banco tiene ferme le domande — venti note, un link ciascuna — e fa
/// crescere **solo l'anagrafe**: cento allegati contro cinquecento, che nessuno
/// nomina. Se il prezzo della risposta cresce con loro, la risposta li sta
/// guardando uno per uno.
///
/// Come il presidio della pagina, non guarda il numero assoluto: guarda che
/// quintuplicare l'anagrafe non cambi il prezzo di una domanda.
#[test]
fn resolving_a_reference_does_not_grow_with_the_entry_store() {
    let mut costs = Vec::new();
    for filler in [100usize, 500] {
        let bench = vault_with_attachments(filler);
        // Un giro a vuoto, per la stessa ragione del presidio della pagina: la
        // prima domanda paga ciò che si alloca una volta sola.
        let _ = count_broken_links(&bench);
        costs.push(count_allocations(|| count_broken_links(&bench)));
    }

    let (small, large) = (costs[0], costs[1]);
    assert!(
        large <= small + 20,
        "twenty references cost {small} allocations on an entry store of \
         a hundred attachments and {large} on one of five hundred: resolving \
         a reference looks at entries one by one instead of asking a key, and \
         whoever resolves once per link — the reference rewrite of a moved \
         attachment — pays the vault multiplied by itself"
    );
}

/// Il controllo dei link rotti, che è la via pubblica per cui passa la
/// risoluzione di un riferimento ad allegato.
///
/// L'allegato c'è, quindi la risposta giusta è **zero**: se fosse diversa da
/// zero la misura sopra starebbe misurando la costruzione dei rapporti invece
/// della risoluzione.
fn count_broken_links(ws: &Workspace) -> usize {
    match ws
        .query_index(IndexQuery::VaultHealth {
            check: HealthCheck::BrokenLinks,
            page: Some(Page::first(20)),
        })
        .expect("the health check responds")
    {
        IndexResult::VaultHealth(paged) => {
            assert_eq!(
                paged.total, 0,
                "the incorporated attachment exists: a broken link here would mean \
                 the bench is measuring report construction instead of resolution"
            );
            paged.items.len()
        }
        other => panic!("expected the health check, got {other:?}"),
    }
}
