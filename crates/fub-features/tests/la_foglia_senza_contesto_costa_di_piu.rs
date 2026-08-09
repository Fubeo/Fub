// Il banco vive con la sua feature (§16.3): senza `commands` il modulo non è
// compilato, e un test che lo nomina non avrebbe un soggetto.
#![cfg(feature = "commands")]
//! **Quanto costa il piano di una rinomina**, e quanto costerebbe la foglia che
//! sembrava doverlo snellire. Contato in allocazioni e in byte allocati.
//!
//! Il dry-run di `note.rename` chiede `IndexQuery::Backlinks` per sapere quali
//! note nominano il documento, e di ogni riferimento riceve anche il `context`
//! — il paragrafo in cui il link compare — che poi butta via, perché ciò che
//! costruisce è un elenco di path. Da fuori è una riga di prestazioni ovvia:
//! `QueryPredicate::Linked` è la stessa domanda **senza** il contesto, e il
//! docstring di [`IndexQuery::Backlinks`] la indica per nome («la forma senza
//! contesto è la foglia»). Contata, la riga si rovescia.
//!
//! # I numeri, su note che nominano il bersaglio dentro paragrafi da 260 caratteri
//!
//! Duecentosessanta non è un numero tondo: è la **mediana** della lunghezza di
//! un blocco di prosa nei documenti di questo repo (7409 blocchi, mediana 257,
//! media 374, p90 763). Il contesto di un link è il testo del blocco che lo
//! contiene, quindi è quella la scala vera.
//!
//! | domanda | allocazioni | byte |
//! |---|---|---|
//! | `Backlinks` su 500 backlink, contesti compresi | 1 003 | 187 512 |
//! | **il dry-run intero** sugli stessi 500 | 1 058 | **237 953** |
//! | `Documents` con la foglia `Linked`, stessi 500 | 1 728 | **686 078** |
//! | `Backlinks` su 2000 backlink | 4 003 | 750 012 |
//! | il dry-run intero sugli stessi 2000 | 4 062 | 947 909 |
//! | `Documents` con `Linked`, stessi 2000 | 6 871 | 2 750 970 |
//!
//! **La foglia costa quasi tre volte l'intero dry-run che avrebbe dovuto
//! alleggerire**, e quasi quattro volte la domanda che sostituirebbe. La ragione
//! è che `Backlinks` clona un `BacklinkRef` per riferimento — un centinaio di
//! byte più il contesto, qui 375 in tutto — mentre la strada di `Documents`
//! materializza un `DocumentMatch` per riga: il `BTreeSet<DocId>` di
//! `LinkGraph::linked`, poi il `BTreeMap<DocId, DocumentMatch>` di `Matches`,
//! poi il `Vec` di `into_vec`, cioè tre copie del `DocId` e circa 1,37 KB per
//! documento — 1 372 a 500 backlink, 1 375 a 2000, **qualunque cosa contengano i
//! contesti**. Il punto di pareggio sta attorno agli 1,2 KB di contesto per
//! riferimento: sopra la mediana della prosa vera, sopra anche il p90.
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
//! `la_foglia_senza_contesto_costa_piu_dei_contesti` è la premessa della riga
//! 0137 scritta al rovescio: la domanda **senza** i contesti costa più di quella
//! **con** i contesti. Diventa rosso il giorno in cui la strada di `Documents`
//! dimagrisce — cioè il giorno in cui lo scambio va fatto.
//!
//! `il_dry_run_spende_sulla_domanda_non_intorno` dice che il piano non costa
//! molto più della domanda che pone: sta entro una volta e mezza, e oggi ci sta
//! con 237 953 byte contro 187 512, cioè 1,27. *Provato in rosso* applicando lo
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
use fub_features::{CoreCommands, COMMANDS_ID, NOTE_RENAME};
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

struct Contatore;

unsafe impl GlobalAlloc for Contatore {
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
static ALLOCATORE: Contatore = Contatore;

/// Quante allocazioni e quanti byte costa `f`.
fn costo_di<T>(f: impl FnOnce() -> T) -> (u64, u64) {
    let (n0, b0) = ALLOC.with(Cell::get);
    let _ = f();
    let (n1, b1) = ALLOC.with(Cell::get);
    (n1 - n0, b1 - b0)
}

const BERSAGLIO: &str = "bersaglio.md";
/// Quante note nominano il bersaglio. Cinquecento è la nota-crocevia: quella
/// che tutto il vault cita, cioè il caso in cui i contesti consegnati fanno i
/// duecento chilobyte da cui la riga d'audit era partita.
const BACKLINK: usize = 500;
/// La mediana di un blocco di prosa nei documenti di questo repo, arrotondata.
const CONTESTO: usize = 260;

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
        let mut ws = Workspace::new(&self.root, registry);
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
/// paragrafo lungo `CONTESTO` caratteri.
fn vault_che_linka(v: &Vault) -> Workspace {
    let mut ws = v.open();
    ws.write_document(&DocId::new(BERSAGLIO), "sono io\n", WriteBase::Dictated)
        .expect("scrive");
    let riempitivo = "parola ".repeat(CONTESTO / 2 / 7);
    for i in 0..BACKLINK {
        ws.write_document(
            &DocId::new(format!("note/{i:05}.md")),
            &format!("{riempitivo}vedi [[bersaglio]] {riempitivo}\n"),
            WriteBase::Dictated,
        )
        .expect("scrive");
    }
    ws
}

/// Le note che il dry-run della rinomina mette nel piano.
fn piano(ws: &mut Workspace) -> Vec<DocId> {
    let outcome = ws
        .invoke_command(
            NOTE_RENAME,
            serde_json::json!({ "doc": BERSAGLIO, "to": "nuovo.md" }),
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
fn per_la_foglia(ws: &Workspace) -> Vec<DocId> {
    match ws
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Linked {
                doc: DocId::new(BERSAGLIO),
                direction: LinkDirection::Inbound,
            }),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: Excerpts::Omit,
        })
        .expect("la foglia")
    {
        IndexResult::Documents(righe) => righe.items.into_iter().map(|r| r.doc).collect(),
        altro => panic!("attesi documenti, trovato {altro:?}"),
    }
}

/// La domanda che il dry-run pone oggi, isolata: gli stessi riferimenti, coi
/// contesti che poi butta via.
fn per_i_backlink(ws: &Workspace) -> usize {
    match ws
        .query_index(IndexQuery::Backlinks {
            target: DocId::new(BERSAGLIO),
            page: None,
        })
        .expect("i backlink")
    {
        IndexResult::Backlinks(righe) => righe.items.len(),
        altro => panic!("attesi backlink, trovato {altro:?}"),
    }
}

/// **La premessa della riga, scritta al rovescio.** `QueryPredicate::Linked` è
/// `Backlinks` *senza* i contesti — 266 KB di paragrafi in meno da consegnare —
/// e costa di più.
///
/// Non c'è un numero magico: è un confronto fra due domande misurate nello
/// stesso giro sullo stesso vault. Diventa rosso quando la strada di
/// `Documents` smette di materializzare tre copie del `DocId` per riga, che è
/// esattamente il giorno in cui lo scambio che la 0137 chiedeva va fatto.
#[test]
fn la_foglia_senza_contesto_costa_piu_dei_contesti() {
    let v = Vault::new();
    let mut ws = vault_che_linka(&v);
    // Un giro a vuoto: la prima invocazione paga le inizializzazioni pigre.
    let _ = piano(&mut ws);
    let _ = per_la_foglia(&ws);
    let _ = per_i_backlink(&ws);

    let (alloc_backlink, byte_backlink) = costo_di(|| per_i_backlink(&ws));
    let (alloc_foglia, byte_foglia) = costo_di(|| per_la_foglia(&ws));

    assert!(
        byte_foglia > byte_backlink,
        "la foglia senza contesti costa {byte_foglia} byte in {alloc_foglia} allocazioni, i \
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
fn il_dry_run_spende_sulla_domanda_non_intorno() {
    let v = Vault::new();
    let mut ws = vault_che_linka(&v);
    let _ = piano(&mut ws);
    let _ = per_i_backlink(&ws);

    let (_, byte_backlink) = costo_di(|| per_i_backlink(&ws));
    let (alloc_piano, byte_piano) = costo_di(|| piano(&mut ws));

    let tetto = byte_backlink + byte_backlink / 2;
    assert!(
        byte_piano < tetto,
        "il dry-run costa {byte_piano} byte in {alloc_piano} allocazioni, la domanda che pone \
         {byte_backlink}: oltre il tetto di {tetto}, cioè il piano ha smesso di spendere sulla \
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
fn le_due_forme_nominano_le_stesse_note() {
    let v = Vault::new();
    let mut ws = vault_che_linka(&v);
    // Una nota che cita il bersaglio **due volte**: è il solo caso in cui
    // «riferimenti» e «documenti» potrebbero divergere, e senza di essa il
    // confronto proverebbe due elenchi che nessuno ha messo alla prova.
    ws.write_document(
        &DocId::new("note/doppia.md"),
        "vedi [[bersaglio]]\n\ne ancora [[bersaglio]]\n",
        WriteBase::Dictated,
    )
    .expect("scrive");

    let dal_piano = piano(&mut ws);
    let dalla_foglia = per_la_foglia(&ws);

    // Il piano porta davanti il documento rinominato e il suo nome nuovo: sono
    // suoi, non dell'indice.
    assert_eq!(
        dal_piano[..2],
        [DocId::new(BERSAGLIO), DocId::new("nuovo.md")],
        "il piano nomina per prime la nota e la sua destinazione"
    );
    assert_eq!(
        &dal_piano[2..],
        dalla_foglia.as_slice(),
        "le due forme non nominano più le stesse note nello stesso ordine: la \
         scelta fra loro ha smesso di essere una questione di costo"
    );
    assert!(
        dalla_foglia.contains(&DocId::new("note/doppia.md")),
        "la nota che cita due volte deve comparire, e una volta sola"
    );
    assert_eq!(
        dal_piano.len(),
        BACKLINK + 3,
        "attese le {BACKLINK} note che linkano, più quella che linka due volte, \
         più la nota e la sua destinazione"
    );
}
