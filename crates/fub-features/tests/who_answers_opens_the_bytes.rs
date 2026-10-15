// Il banco vive con le sue feature (§16.3): senza `commands` e `versioning` i
// due moduli non sono compilati, e un test che li nomina non avrebbe un
// soggetto.
#![cfg(all(feature = "commands", feature = "versioning"))]
//! **Due letture che sembrano spreco e sono la risposta**, contate.
//!
//! `vault.replace` apre ogni nota del vault; `rebuild_from_store` apre ogni
//! snapshot. Da fuori sono due righe di prestazioni: leggere N file per
//! cambiarne tre, leggere N file per calcolare N numeri da otto byte. Da dentro
//! sono la stessa cosa detta due volte — **la risposta è fatta di quei byte**, e
//! l'unico modo di non leggerli sarebbe rispondere qualcos'altro.
//!
//! # `vault.replace`: l'indice risponde su un altro testo
//!
//! Chiedere all'indice quali note contengono l'ago sembra la mossa ovvia, e
//! `HostQuery::query_index` c'è, e la foglia `QueryPredicate::Text` pure. Ma
//! l'indice non ha il sorgente: riceve un [`DocumentModel`] e indicizza la sua
//! **proiezione a testo piano** — niente frontmatter, niente marcatori, i
//! wikilink ridotti alla loro etichetta — ed è scritto per esteso in
//! `fub-kernel/src/occurrences.rs`, che esiste proprio perché fra la proiezione
//! e il sorgente non c'è nessuna mappa. Sopra ci gira anche una tokenizzazione:
//! `aghifoglia` dentro `paleoaghifoglia` non è un termine.
//!
//! `occurrences()` invece cerca **byte in un file**. Le due domande non
//! combaciano, e non combaciano nel verso che qui conta: l'indice ne trova di
//! meno. Sostituire la scansione con una domanda all'indice non renderebbe
//! `vault.replace` più rapido — lo renderebbe **incompleto**, e in silenzio.
//!
//! # `rebuild_from_store`: l'impronta si registra, non si ricalcola
//!
//! `VersionRef` porta `hash` (FNV-1a su tutti i byte) e `size` (quanti byte).
//! Il `meta.json` di ogni cartella le registra quando la versione nasce, e
//! `rebuild_from_store` — che gira **solo** quando l'indice è assente o
//! illeggibile — le prende da lì senza aprire gli snapshot: ricalcolarle dai
//! byte di adesso farebbe passare per sano un blob alterato. Solo per una
//! cartella scritta prima di questa registrazione lo snapshot si apre e
//! l'impronta si ricalcola dal contenuto.
//!
//! # I numeri
//!
//! | misura | conto |
//! |---|---|
//! | `vault.replace` su 2000 note, 3 combaciano | **2003 letture**, 119 019 byte |
//! | idem su 1000 note | 1003 letture, 59 019 byte |
//! | ricostruzione di 200 documenti con uno snapshot ciascuno | **200 letture** |
//! | idem con `meta.json` di prima delle impronte registrate | **400 letture**, 20 290 byte |
//!
//! 2003 = una lettura per nota, più una per ogni nota che entra nel piano
//! (`document_revision`, che è la base della modifica). 200 = un `meta.json` per
//! cartella e nessuno snapshot aperto; 400 = anche lo snapshot, ma una volta
//! sola: nessun blob si apre due volte.

use fub_abi::command::InvokeMode;
use fub_abi::model::DocId;
use fub_abi::traits::{CommandProvider, DataRead, DataWrite, VaultRead};
use fub_features::{CoreCommands, VersionRef, VersionStore, VersioningHandler, VAULT_REPLACE};
use fub_sdk::testing::MemoryHost;

/// L'ago. Una parola che non compare per caso, e abbastanza lunga da poterla
/// nascondere dentro un'altra.
const NEEDLE: &str = "aghifoglia";

/// Quante note. Non tre: una scansione del vault su tre note non si vede, e la
/// taglia serve a rendere il numero **grande** invece che discutibile.
const NOTE: usize = 2000;

/// Un vault in cui solo le prime `combaciano` note contengono l'ago.
fn vault(count: usize, matching: usize) -> MemoryHost {
    let mut host = MemoryHost::new();
    for the in 0..count {
        let body = if the < matching {
            format!("# Nota {the}\n\nQui c'è una {NEEDLE} vera.\n")
        } else {
            format!("# Nota {the}\n\nUn corpo qualsiasi, senza niente da sostituire.\n")
        };
        host = host.with_document(&format!("note/{the:04}.md"), &body);
    }
    host
}

fn replace(host: &mut MemoryHost, mode: InvokeMode) {
    CoreCommands
        .invoke(
            VAULT_REPLACE,
            serde_json::json!({ "find": NEEDLE, "replace": "conifera" }),
            mode,
            host,
        )
        .expect("la sostituzione");
}

/// **Il numero della riga 0040**: senza `docs`, `vault.replace` apre ogni nota
/// del vault, e apre una seconda volta quelle che entrano nel piano.
///
/// L'uguaglianza è esatta apposta. Una soglia direbbe «non troppe» e resterebbe
/// verde a qualunque cosa succeda sotto; un'uguaglianza dice **quante**, e
/// chiunque cambi il modo in cui questo comando sceglie le note passa di qui a
/// riscrivere il numero — che è esattamente il momento in cui deve leggere il
/// resto di questo file.
///
/// *Provato in rosso* costruendo la base della modifica dal sorgente già letto
/// (`Revision::of(&source)` al posto di `host.document_revision(&doc)`): 2000
/// letture invece di 2003.
#[test]
fn replace_opens_every_notes_in_the_vault() {
    let mut host = vault(NOTE, 3);

    replace(&mut host, InvokeMode::DryRun);

    let (count, _byte) = host.read_totals();
    assert_eq!(
        count,
        NOTE + 3,
        "attese una lettura per nota più una per ciascuna delle tre che entrano nel piano"
    );
}

/// I tre nascondigli, uno per ciascuna cosa che la proiezione a testo piano
/// toglie o trasforma: dentro una parola più lunga (la tokenizzazione), nel
/// frontmatter (che non entra nel testo), e nel bersaglio di un wikilink (che
/// resta ridotto alla sua etichetta).
const HIDDEN_DOCUMENTS: [(&str, &str, &str); 3] = [
    (
        "dentro.md",
        "Una paleoaghifoglia fossile.\n",
        "Una paleoconifera fossile.\n",
    ),
    (
        "testa.md",
        "---\ntipo: aghifoglia\n---\n\nNiente nel corpo.\n",
        "---\ntipo: conifera\n---\n\nNiente nel corpo.\n",
    ),
    (
        "link.md",
        "Vedi [[aghifoglia|le foglie]].\n",
        "Vedi [[conifera|le foglie]].\n",
    ),
];

/// La metà che tiene ferma la correttezza: `vault.replace` trova l'ago **dove
/// l'indice non lo trova**, e le due metà sono asserite nella stessa prova —
/// l'indice risponde zero, il comando ne sostituisce tre.
///
/// L'indice è quello vero: `SearchIndex` su disco, alimentato con i
/// [`DocumentModel`] che il parser markdown ricava da questi stessi sorgenti,
/// cioè esattamente ciò che arriverebbe a un prefiltro. Non c'è modo di chiedere
/// «chi contiene questi byte» a una struttura costruita su un altro testo.
///
/// *Provato in rosso* dando all'indice il **sorgente** al posto della proiezione
/// (`modello.text = sorgente`): due documenti trovati invece di zero. È il verso
/// giusto in cui provarlo — se un domani l'indice imparasse a rispondere sui
/// byte, questo banco diventa rosso e chiede di rileggere la riparazione, invece
/// di restare verde mentre `vault.replace` smette di trovare le occorrenze che
/// oggi trova.
#[cfg(feature = "search")]
#[test]
fn replace_finds_what_the_index_cannot_see() {
    use camino::Utf8PathBuf;
    use fub_abi::format::{DocumentSource, FormatProvider, ParseContext};
    use fub_abi::model::DocumentModel;
    use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
    use fub_abi::traits::{Excerpts, IndexProvider, IndexQuery, IndexResult, PropertySelect};
    use fub_features::SearchIndex;
    use fub_format_markdown::MarkdownProvider;

    let mut host = MemoryHost::new();
    let mut models: Vec<DocumentModel> = Vec::new();
    for (id, source, _) in HIDDEN_DOCUMENTS {
        host = host.with_document(id, source);
        models.push(
            MarkdownProvider
                .parse(
                    &DocumentSource::Text(source.to_string()),
                    &ParseContext::obsidian(id),
                )
                .expect("il parse"),
        );
    }

    // L'indice, come lo vedrebbe un prefiltro.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().join("index")).expect("utf8");
    let mut index = SearchIndex::open_dir(&path).expect("apertura indice");
    let mut empty = MemoryHost::new();
    index.activate(&mut empty).expect("attivazione");
    let losses = index.on_documents_indexed(&models);
    assert!(losses.is_empty(), "l'indice ha rifiutato: {losses:?}");
    let ask = |term: &str| match index.query(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms(term))),
        sort: None,
        select: PropertySelect::None,
        page: None,
        excerpts: Excerpts::Omit,
    }) {
        Ok(IndexResult::Documents(hits)) => hits.items.len(),
        other => panic!("attesi documenti, trovato {other:?}"),
    };

    // Il controllo positivo, prima della negazione: l'indice **c'è** e risponde.
    // Senza questa riga uno zero potrebbe voler dire soltanto che non è stato
    // indicizzato niente, e il banco proverebbe il proprio errore.
    assert_eq!(
        ask("fossile"),
        1,
        "l'indice non risponde nemmeno a un termine che ha: il banco è rotto, non il codice"
    );
    let found = ask(NEEDLE);
    assert_eq!(
        found, 0,
        "l'indice ne ha trovate {found}: se sa rispondere, questo banco non \
         dimostra più niente e va cambiato l'esempio, non l'attesa"
    );

    replace(&mut host, InvokeMode::Apply);

    for (id, _, expected) in HIDDEN_DOCUMENTS {
        assert_eq!(
            host.read_document(&DocId::new(id)).expect("la nota"),
            expected,
            "{id}: la scansione del sorgente l'ha trovata, l'indice no"
        );
    }
}

const DOCUMENTS: usize = 200;

/// Un vault fotografato per intero, e l'elenco di ciò che lo store sa.
fn photographed() -> (MemoryHost, Vec<(DocId, Vec<VersionRef>)>) {
    let mut host = vault(DOCUMENTS, 0);
    let store = VersionStore::open(&mut host).expect("apertura");
    VersioningHandler::new(store.clone())
        .first_snapshot_of_the_vault(&mut host)
        .expect("la prima fotografia");
    let before: Vec<_> = store
        .documents()
        .into_iter()
        .map(|id| (id.clone(), store.list(&id)))
        .collect();
    assert_eq!(
        before.len(),
        DOCUMENTS,
        "il vault è stato fotografato tutto"
    );
    (host, before)
}

/// Riapre lo store senza indice e dice cosa ha trovato e quante letture ha pagato.
fn rebuilt(host: &mut MemoryHost) -> (Vec<(DocId, Vec<VersionRef>)>, usize) {
    host.data_remove("versions.json").expect("l'indice va via");
    let (reads_first, _) = host.read_totals();
    let store = VersionStore::open(host).expect("riapertura");
    let (reads_after, _) = host.read_totals();
    let after = store
        .documents()
        .into_iter()
        .map(|id| (id.clone(), store.list(&id)))
        .collect();
    (after, reads_after - reads_first)
}

/// La ricostruzione prende le impronte che il `meta.json` registrò alla
/// scrittura, e non apre nessuno snapshot: una lettura per cartella.
///
/// L'uguaglianza sulle impronte dice che non se ne è persa nessuna; il conto
/// dice che non sono state ricalcolate dai byte di adesso — che è proprio ciò
/// che faceva passare per sano un blob alterato.
#[test]
fn the_rebuild_takes_the_registered_fingerprints_without_opening_the_snapshots() {
    let (mut host, before) = photographed();
    let (after, reads) = rebuilt(&mut host);
    assert_eq!(
        after, before,
        "le impronte ricostruite non coincidono con quelle perdute"
    );
    assert_eq!(
        reads, DOCUMENTS,
        "attesa una sola lettura per documento, il `meta.json`"
    );
}

/// **Il numero della riga 0045**, per le cartelle di prima delle impronte
/// registrate: la ricostruzione apre ogni snapshot una volta sola, e ne ricava
/// un'impronta identica a quella che l'indice perduto portava.
///
/// L'uguaglianza sulle impronte è la parte che spiega il conto: `hash` e `size`
/// tornano *esattamente* gli stessi solo perché sono stati ricalcolati sugli
/// stessi byte, ed è l'unica strada quando il `meta.json` non le registra.
///
/// *Provato in rosso* rileggendo il blob una seconda volta dentro il giro di
/// `rebuild_from_store`: 600 letture invece di 400.
#[test]
fn a_folder_from_before_the_registered_fingerprints_is_rebuilt_from_its_content() {
    let (mut host, before) = photographed();
    // Il `meta.json` com'era prima: senza l'elenco delle versioni.
    for path in host.data_list("").expect("elenco") {
        if !path.ends_with("/meta.json") {
            continue;
        }
        let raw = host.data_read(&path).expect("lettura").expect("c'è");
        let mut meta: serde_json::Value = serde_json::from_slice(&raw).expect("json");
        meta.as_object_mut().expect("oggetto").remove("versions");
        host.data_write(&path, &serde_json::to_vec(&meta).expect("json"))
            .expect("riscrittura");
    }

    let (after, reads) = rebuilt(&mut host);
    assert_eq!(
        after, before,
        "le impronte ricostruite non coincidono con quelle perdute"
    );
    assert_eq!(
        reads,
        2 * DOCUMENTS,
        "attesi un `meta.json` e uno snapshot per documento, e niente di riletto"
    );
}
