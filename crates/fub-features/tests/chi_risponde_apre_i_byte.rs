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
//! # `rebuild_from_store`: l'impronta *è* il contenuto
//!
//! `VersionRef` porta `hash` (FNV-1a su tutti i byte) e `size` (quanti byte).
//! Non si ricavano da altro: l'unico posto in cui erano già scritti è
//! `versions.json`, cioè l'indice — e `rebuild_from_store` gira **solo** quando
//! quell'indice è assente o illeggibile. Chiedere di non caricare gli snapshot
//! è chiedere di non calcolare l'impronta.
//!
//! # I numeri
//!
//! | misura | conto |
//! |---|---|
//! | `vault.replace` su 2000 note, 3 combaciano | **2003 letture**, 119 019 byte |
//! | idem su 1000 note | 1003 letture, 59 019 byte |
//! | ricostruzione di 200 documenti con uno snapshot ciascuno | **400 letture**, 20 290 byte |
//!
//! 2003 = una lettura per nota, più una per ogni nota che entra nel piano
//! (`document_revision`, che è la base della modifica). 400 = un `meta.json` per
//! cartella più uno snapshot: nessun blob si apre due volte.

use fub_abi::command::InvokeMode;
use fub_abi::model::DocId;
use fub_abi::traits::{CommandProvider, DataWrite, VaultRead};
use fub_features::{CoreCommands, VersionStore, VersioningHandler, VAULT_REPLACE};
use fub_sdk::testing::MemoryHost;

/// L'ago. Una parola che non compare per caso, e abbastanza lunga da poterla
/// nascondere dentro un'altra.
const AGO: &str = "aghifoglia";

/// Quante note. Non tre: una scansione del vault su tre note non si vede, e la
/// taglia serve a rendere il numero **grande** invece che discutibile.
const NOTE: usize = 2000;

/// Un vault in cui solo le prime `combaciano` note contengono l'ago.
fn vault(quante: usize, combaciano: usize) -> MemoryHost {
    let mut host = MemoryHost::new();
    for i in 0..quante {
        let corpo = if i < combaciano {
            format!("# Nota {i}\n\nQui c'è una {AGO} vera.\n")
        } else {
            format!("# Nota {i}\n\nUn corpo qualsiasi, senza niente da sostituire.\n")
        };
        host = host.con_documento(&format!("note/{i:04}.md"), &corpo);
    }
    host
}

fn sostituisci(host: &mut MemoryHost, mode: InvokeMode) {
    CoreCommands
        .invoke(
            VAULT_REPLACE,
            serde_json::json!({ "find": AGO, "replace": "conifera" }),
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
fn sostituire_apre_ogni_nota_del_vault() {
    let mut host = vault(NOTE, 3);

    sostituisci(&mut host, InvokeMode::DryRun);

    let (quante, _byte) = host.letture_totali();
    assert_eq!(
        quante,
        NOTE + 3,
        "attese una lettura per nota più una per ciascuna delle tre che entrano nel piano"
    );
}

/// I tre nascondigli, uno per ciascuna cosa che la proiezione a testo piano
/// toglie o trasforma: dentro una parola più lunga (la tokenizzazione), nel
/// frontmatter (che non entra nel testo), e nel bersaglio di un wikilink (che
/// resta ridotto alla sua etichetta).
const NASCONDIGLI: [(&str, &str, &str); 3] = [
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
fn sostituire_trova_cio_che_l_indice_non_puo_vedere() {
    use camino::Utf8PathBuf;
    use fub_abi::format::{DocumentSource, FormatProvider, ParseContext};
    use fub_abi::model::DocumentModel;
    use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
    use fub_abi::traits::{Excerpts, IndexProvider, IndexQuery, IndexResult, PropertySelect};
    use fub_features::SearchIndex;
    use fub_format_markdown::MarkdownProvider;

    let mut host = MemoryHost::new();
    let mut modelli: Vec<DocumentModel> = Vec::new();
    for (id, sorgente, _) in NASCONDIGLI {
        host = host.con_documento(id, sorgente);
        modelli.push(
            MarkdownProvider
                .parse(
                    &DocumentSource::Text(sorgente.to_string()),
                    &ParseContext::obsidian(id),
                )
                .expect("il parse"),
        );
    }

    // L'indice, come lo vedrebbe un prefiltro.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().join("index")).expect("utf8");
    let mut indice = SearchIndex::open_dir(&path).expect("apertura indice");
    let mut vuoto = MemoryHost::new();
    indice.activate(&mut vuoto).expect("attivazione");
    let perdite = indice.on_documents_indexed(&modelli);
    assert!(perdite.is_empty(), "l'indice ha rifiutato: {perdite:?}");
    let chiedi = |termine: &str| match indice.query(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms(termine))),
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
        chiedi("fossile"),
        1,
        "l'indice non risponde nemmeno a un termine che ha: il banco è rotto, non il codice"
    );
    let trovate = chiedi(AGO);
    assert_eq!(
        trovate, 0,
        "l'indice ne ha trovate {trovate}: se sa rispondere, questo banco non \
         dimostra più niente e va cambiato l'esempio, non l'attesa"
    );

    sostituisci(&mut host, InvokeMode::Apply);

    for (id, _, atteso) in NASCONDIGLI {
        assert_eq!(
            host.read_document(&DocId::new(id)).expect("la nota"),
            atteso,
            "{id}: la scansione del sorgente l'ha trovata, l'indice no"
        );
    }
}

/// **Il numero della riga 0045**: la ricostruzione apre ogni snapshot una volta
/// sola, e ne ricava un'impronta identica a quella che l'indice perduto
/// portava.
///
/// L'uguaglianza sulle impronte è la parte che spiega il conto: `hash` e `size`
/// tornano *esattamente* gli stessi solo perché sono stati ricalcolati sugli
/// stessi byte. Un modo di non leggerli non c'è — c'era, e stava in
/// `versions.json`, che è il file che questo test cancella.
///
/// *Provato in rosso* rileggendo il blob una seconda volta dentro il giro di
/// `rebuild_from_store`: 600 letture invece di 400.
#[test]
fn la_ricostruzione_ritrova_le_impronte_dal_contenuto() {
    const DOCUMENTI: usize = 200;
    let mut host = vault(DOCUMENTI, 0);
    let store = VersionStore::open(&mut host).expect("apertura");
    VersioningHandler::new(store.clone())
        .first_snapshot_of_the_vault(&mut host)
        .expect("la prima fotografia");
    let prima: Vec<_> = store
        .documents()
        .into_iter()
        .map(|id| (id.clone(), store.list(&id)))
        .collect();
    assert_eq!(prima.len(), DOCUMENTI, "il vault è stato fotografato tutto");

    // L'indice sparisce: è il solo caso in cui `rebuild_from_store` gira, ed è
    // anche il solo posto in cui le impronte erano già scritte.
    host.data_remove("versions.json").expect("l'indice va via");
    let (letture_prima, _) = host.letture_totali();
    let ricostruito = VersionStore::open(&mut host).expect("riapertura");
    let (letture_dopo, _) = host.letture_totali();

    let dopo: Vec<_> = ricostruito
        .documents()
        .into_iter()
        .map(|id| (id.clone(), ricostruito.list(&id)))
        .collect();
    assert_eq!(
        dopo, prima,
        "le impronte ricostruite non coincidono con quelle perdute"
    );
    assert_eq!(
        letture_dopo - letture_prima,
        2 * DOCUMENTI,
        "attesi un `meta.json` e uno snapshot per documento, e niente di riletto"
    );
}
