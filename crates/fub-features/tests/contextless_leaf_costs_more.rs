// Il banco vive con la sua feature (§16.3): senza `commands` il modulo non è
// compilato, e un test che lo nomina non avrebbe un soggetto.
#![cfg(feature = "commands")]
//! **Quanto costa il piano di una rinomina**, e quanto costerebbe la foglia che
//! sembrava doverlo snellire. Contato in allocazioni e in byte allocati.
//!
//! Il dry-run di `note.rename` chiede `IndexQuery::Backlinks` per sapere quali
//! note nominano il documento, e di ogni riferimento riceve anche il `context`
//! — la finestra di testo attorno al link (§25.4, `fub_abi::rules::snippet`)
//! — che poi butta via, perché ciò che costruisce è un elenco di path. Da
//! fuori è una riga di prestazioni ovvia: `QueryPredicate::Linked` è la stessa
//! domanda **senza** il contesto, e il docstring di [`IndexQuery::Backlinks`]
//! la indica per nome («la forma senza contesto è la foglia»). Contata, la
//! riga si rovescia.
//!
//! # I numeri, su note che nominano il bersaglio dentro paragrafi da 260 caratteri
//!
//! Duecentosessanta non è un numero tondo: è la **mediana** della lunghezza di
//! un blocco di prosa nei documenti di questo repo (7409 blocchi, mediana 257,
//! media 374, p90 763). Il contesto di un link era il testo del blocco che lo
//! contiene, quindi quella era la scala vera; dalla §25.4 è una **finestra di
//! 220 caratteri** attorno al link (`fub_abi::rules::snippet`), e la scala è
//! il tetto — i numeri qui sotto sono misurati con la finestra.
//!
//! | domanda | allocazioni | byte |
//! |---|---|---|
//! | `Backlinks` su 500 backlink, contesti compresi | 1 003 | 167 012 |
//! | **il dry-run intero** sugli stessi 500 | 1 058 | **217 453** |
//! | `Documents` con la foglia `Linked`, stessi 500 | 1 728 | **686 078** |
//! | `Backlinks` su 2000 backlink | 4 003 | 668 012 |
//! | il dry-run intero sugli stessi 2000 | 4 062 | 865 909 |
//! | `Documents` con `Linked`, stessi 2000 | 6 871 | 2 750 970 |
//!
//! **La foglia costa più di tre volte l'intero dry-run che avrebbe dovuto
//! alleggerire**, e quattro volte la domanda che sostituirebbe. La ragione
//! è che `Backlinks` clona un `BacklinkRef` per riferimento — un centinaio di
//! byte più il contesto, qui 334 in tutto — mentre la strada di `Documents`
//! materializza un `DocumentMatch` per riga: il `BTreeSet<DocId>` di
//! `LinkGraph::linked`, poi il `BTreeMap<DocId, DocumentMatch>` di `Matches`,
//! poi il `Vec` di `into_vec`, cioè tre copie del `DocId` e circa 1,37 KB per
//! documento — 1 372 a 500 backlink, 1 375 a 2000, **qualunque cosa contengano i
//! contesti**. Il punto di pareggio sta attorno agli 1,2 KB di contesto per
//! riferimento: sopra la mediana della prosa vera, sopra anche il p90 — e, da
//! quando il contesto è una finestra di 220 caratteri, **fuori dal dominio**.
//!
//! Non è un argomento contro la foglia — è la foglia giusta, e il giorno che
//! quelle tre copie diventassero una la scelta si rovescia. È un argomento
//! contro il **chiudere una riga di prestazioni senza contarla**: il rimedio
//! che la riga indicava triplicava la spesa che diceva di togliere.
//!
//! # Cos'è rosso
//!
//! Due asserzioni, nessuna delle due con un numero magico dentro: sono rapporti
//! fra grandezze misurate nello stesso giro.
//!
//! `the_leaf_without_context_costs_more_of_the_contexts` è la premessa della riga
//! 0137 scritta al rovescio: la domanda **senza** i contesti costa più di quella
//! **con** i contesti. Diventa rosso il giorno in cui la strada di `Documents`
//! dimagrisce — cioè il giorno in cui lo scambio va fatto.
//!
//! `the_dry_run_spends_on_the_question_does_not_around` dice che il piano non costa
//! molto più della domanda che pone: sta entro una volta e mezza, e oggi ci sta
//! con 217 453 byte contro 167 012, cioè 1,30. *Provato in rosso* applicando lo
//! scambio per davvero dentro `note_rename`: il dry-run è passato a **672 535**
//! byte, cioè 3,59 volte la domanda che aveva sostituito, e il banco si è
//! acceso. (Il primo confronto scritto — «il piano intero costa meno della sola
//! foglia» — con lo scambio applicato restava verde per un pelo, 672 535 contro
//! 686 078, perché un tutto misurato di lato non è confrontabile con una parte
//! misurata da sola: è stata cambiata la forma del banco, non la pretesa.)

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::edit::WriteBase;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::query::{QueryExpr, QueryPredicate};
use fub_abi::traits::{Excerpts, IndexQuery, IndexResult, LinkDirection, PropertySelect};
use fub_features::{CoreCommands, COMMANDS_ID, NOTES_RENAME};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

thread_local! {
    /// I byte allocati **da questo thread**: `cargo test` gira in parallelo, e
    /// un contatore condiviso misurerebbe il vicino di banco. Il
    /// `const { Cell::new(..) }` non è un vezzo — una TLS con inizializzazione
    /// pigra allocherebbe al primo accesso, e allocare dentro `alloc` è una
    /// ricorsione.
    static ALLOC: Cell<(u64, u64)> = const { Cell::new((0, 0)) };
}

struct Counter;

unsafe impl GlobalAlloc for Counter {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOC.try_with(|c| {
            let (n, b) = c.get();
            c.set((n + 1, b + layout.size() as u64))
        });
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counter = Counter;

/// Quante allocazioni e quanti byte costa `f`.
fn costo_of<T>(f: impl FnOnce() -> T) -> (u64, u64) {
    let (n0, b0) = ALLOC.with(Cell::get);
    let _ = f();
    let (n1, b1) = ALLOC.with(Cell::get);
    (n1 - n0, b1 - b0)
}

const TARGET: &str = "bersaglio.md";
/// Quante note nominano il bersaglio. Cinquecento è la nota-crocevia: quella
/// che tutto il vault cita, cioè il caso in cui i contesti consegnati fanno i
/// duecento chilobyte da cui la riga d'audit era partita.
const BACKLINK: usize = 500;
/// La mediana di un blocco di prosa nei documenti di questo repo, arrotondata.
const CONTEXT_CHARS: usize = 260;

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

/// Un vault in cui `BACKLINK` note nominano il bersaglio, ciascuna dentro un
/// paragrafo lungo `CONTEXT_CHARS` caratteri.
fn vault_that_links(v: &Vault) -> Workspace {
    let mut ws = v.open();
    ws.write_document(&DocId::new(TARGET), "sono io\n", WriteBase::Dictated)
        .expect("scrive");
    let placeholder = "parola ".repeat(CONTEXT_CHARS / 2 / 7);
    for the in 0..BACKLINK {
        ws.write_document(
            &DocId::new(format!("note/{the:05}.md")),
            &format!("{placeholder}vedi [[bersaglio]] {placeholder}\n"),
            WriteBase::Dictated,
        )
        .expect("scrive");
    }
    ws
}

/// Le note che il dry-run della rinomina mette nel piano.
fn plan(ws: &mut Workspace) -> Vec<DocId> {
    let outcome = ws
        .invoke_command(
            NOTES_RENAME,
            serde_json::json!({ "doc": TARGET, "to": "nuovo.md" }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("simula");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un dry-run risponde con un piano")
    };
    plan.docs
}

/// La stessa domanda per la foglia che il docstring di `Backlinks` indica.
fn for_the_leaf(ws: &Workspace) -> Vec<DocId> {
    match ws
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Linked {
                doc: DocId::new(TARGET),
                direction: LinkDirection::Inbound,
            }),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: Excerpts::Omit,
        })
        .expect("la foglia")
    {
        IndexResult::Documents(rows) => rows.items.into_iter().map(|r| r.doc).collect(),
        other => panic!("attesi documenti, trovato {other:?}"),
    }
}

/// La domanda che il dry-run pone oggi, isolata: gli stessi riferimenti, coi
/// contesti che poi butta via.
fn for_the_backlink(ws: &Workspace) -> usize {
    match ws
        .query_index(IndexQuery::Backlinks {
            target: DocId::new(TARGET),
            page: None,
        })
        .expect("i backlink")
    {
        IndexResult::Backlinks(rows) => rows.items.len(),
        other => panic!("attesi backlink, trovato {other:?}"),
    }
}

/// **La premessa della riga, scritta al rovescio.** `QueryPredicate::Linked` è
/// `Backlinks` *senza* i contesti — 519 KB in meno da consegnare, misurati —
/// e costa di più.
///
/// Non c'è un numero magico: è un confronto fra due domande misurate nello
/// stesso giro sullo stesso vault. Diventa rosso quando la strada di
/// `Documents` smette di materializzare tre copie del `DocId` per riga, che è
/// esattamente il giorno in cui lo scambio che la 0137 chiedeva va fatto.
#[test]
fn the_leaf_without_context_costs_more_of_the_contexts() {
    let v = Vault::new();
    let mut ws = vault_that_links(&v);
    // Un giro a vuoto: la prima invocazione paga le inizializzazioni pigre.
    let _ = plan(&mut ws);
    let _ = for_the_leaf(&ws);
    let _ = for_the_backlink(&ws);

    let (alloc_backlink, byte_backlink) = costo_of(|| for_the_backlink(&ws));
    let (alloc_leaf, byte_leaf) = costo_of(|| for_the_leaf(&ws));

    assert!(
        byte_leaf > byte_backlink,
        "la foglia senza contesti costa {byte_leaf} byte in {alloc_leaf} allocazioni, i \
         backlink coi contesti {byte_backlink} in {alloc_backlink}: la foglia è diventata la \
         più economica, e lo scambio che la riga 0137 chiedeva adesso conviene — vedi il § in \
         testa"
    );
}

/// **Il dry-run spende sulla domanda, non intorno.** Il piano intero — la
/// domanda all'indice, i contesti che riceve e butta, la deduplica e il vettore
/// che costruisce — sta entro una volta e mezza la domanda che pone.
///
/// È il banco che si accende se qualcuno applica lo scambio: la foglia costa
/// quasi il doppio dei backlink, e il piano che la contenesse sfonderebbe il
/// tetto. Il rapporto è fra due misure dello stesso giro, non un numero inciso.
#[test]
fn the_dry_run_spends_on_the_question_does_not_around() {
    let v = Vault::new();
    let mut ws = vault_that_links(&v);
    let _ = plan(&mut ws);
    let _ = for_the_backlink(&ws);

    let (_, byte_backlink) = costo_of(|| for_the_backlink(&ws));
    let (alloc_plan, byte_plan) = costo_of(|| plan(&mut ws));

    let ceiling = byte_backlink + byte_backlink / 2;
    assert!(
        byte_plan < ceiling,
        "il dry-run costa {byte_plan} byte in {alloc_plan} allocazioni, la domanda che pone \
         {byte_backlink}: oltre il tetto di {ceiling}, cioè il piano ha smesso di spendere sulla \
         domanda e ha cominciato a spendere intorno — vedi il § in testa"
    );
}

/// La metà della correttezza, e va tenuta ferma perché è **l'unica ragione per
/// cui la scelta è di prestazioni e non di comportamento**: le due forme
/// nominano le stesse note, nello stesso ordine.
///
/// `Backlinks` elenca *riferimenti* — una nota che ne cita un'altra tre volte
/// compare tre volte — e il dry-run li deduplica a mano; `Linked` risponde con
/// un `BTreeSet`, cioè un insieme per costruzione. Che i due elenchi coincidano
/// è ciò che rende il conto qui sopra l'intero argomento: se divergessero, non
/// ci sarebbe niente da misurare, ci sarebbe da scegliere cosa mostrare
/// all'utente.
#[test]
fn the_two_forms_name_the_same_notes() {
    let v = Vault::new();
    let mut ws = vault_that_links(&v);
    // Una nota che cita il bersaglio **due volte**: è il solo caso in cui
    // «riferimenti» e «documenti» potrebbero divergere, e senza di essa il
    // confronto proverebbe due elenchi che nessuno ha messo alla prova.
    ws.write_document(
        &DocId::new("note/doppia.md"),
        "vedi [[bersaglio]]\n\ne ancora [[bersaglio]]\n",
        WriteBase::Dictated,
    )
    .expect("scrive");

    let from_the_plan = plan(&mut ws);
    let from_the_leaf = for_the_leaf(&ws);

    // Il piano porta davanti il documento rinominato e il suo nome nuovo: sono
    // suoi, non dell'indice.
    assert_eq!(
        from_the_plan[..2],
        [DocId::new(TARGET), DocId::new("nuovo.md")],
        "il piano nomina per prime la nota e la sua destinazione"
    );
    assert_eq!(
        &from_the_plan[2..],
        from_the_leaf.as_slice(),
        "le due forme non nominano più le stesse note nello stesso ordine: la \
         scelta fra loro ha smesso di essere una questione di costo"
    );
    assert!(
        from_the_leaf.contains(&DocId::new("note/doppia.md")),
        "la nota che cita due volte deve comparire, e una volta sola"
    );
    assert_eq!(
        from_the_plan.len(),
        BACKLINK + 3,
        "attese le {BACKLINK} note che linkano, più quella che linka due volte, \
         più la nota e la sua destinazione"
    );
}
