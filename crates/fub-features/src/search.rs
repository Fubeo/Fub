//! Ricerca full-text: il primo [`IndexProvider`] nativo, sopra **tantivy**.
//!
//! Feature ufficiale, quindi codice nativo — nessuna sandbox, nessuna tassa di
//! serializzazione — ma dietro lo **stesso trait** che userà un plugin di terzi
//! a M5. Il kernel non sa che dietro c'è tantivy: vede `dyn IndexProvider`.
//!
//! # Le quattro proprietà che questo indice deve garantire
//!
//! 1. **Non mente.** Il kernel lo alimenta direttamente (non via event bus),
//!    quindi non può perdere aggiornamenti; ciò che resta fuori dalla sua vista
//!    — cancellazioni ad app chiusa — lo chiude [`IndexProvider::reconcile`].
//! 2. **Riparte in fretta.** L'indice vive su disco nello spazio dati del
//!    proprio plugin (`.fub/plugins/fub.search/`). Alla riapertura
//!    ogni documento ripassa da `on_documents_indexed`, ma l'impronta del
//!    contenuto (vedi [`fingerprint`]) fa saltare gli immutati: su un vault non
//!    toccato la riapertura non scrive nulla.
//! 3. **Non si affeziona ai propri dati.** Qualunque dubbio sulla coerenza fra
//!    indice e manifest si risolve buttando via l'indice e ricostruendolo: la
//!    verità è il vault, questo è solo stato derivato.
//! 4. **Non si rimette in fila da sé.** [`IndexProvider::query`] prende `&self`
//!    e il kernel la serve sotto prestito condiviso del workspace: due ricerche
//!    possono essere in volo insieme, e questo indice non le serializza. È la
//!    proprietà che la §8.4 ha trovato **mancante** — c'era un `Mutex` attorno a
//!    tutto — e che nessuna firma può pretendere: il contratto chiede
//!    `Send + Sync`, cioè che chiamare `query` da N thread sia *lecito*, non che
//!    sia *parallelo*. Sta qui perché è una qualità di questo indice, e per la
//!    stessa ragione ha un presidio suo
//!    (`two_searches_are_in_the_index_together`).
//!
//! # Come questo indice usa l'`HostApi` (e dove non può)
//!
//! Il **manifest delle impronte** — l'unico stato che questo provider deve
//! ritrovare alla riapertura — passa da `data_read`/`data_write`: si carica in
//! [`IndexProvider::activate`], si riscrive in [`IndexProvider::flush`]. È il
//! dogfooding della firma: se un plugin di terzi non potesse fare altrettanto,
//! non potrebbe essere un indice persistente.
//!
//! La cartella di **tantivy** invece resta un vero albero di file mmap-ati, e
//! non può passare da `data_*`: un motore di ricerca legge i propri segmenti
//! quando gli pare, anche dai thread di merge, e non ha un host da chiamare in
//! quei momenti. Il path arriva dall'host (`Workspace::plugin_data_dir`) ed è
//! **dentro lo stesso recinto** del resto: quel varco è dichiarato
//! ([0064](../../../docs/decisions/0185-capability-un-solo-guard.md)), non
//! implicito, ed è ciò che a M5 diventerà un preopen WASI sulla stessa cartella
//! per un componente che avvolga un motore analogo.
//!
//! # Operatori: cosa si valuta qui, cosa altrove, cosa manca (P04)
//!
//! Inventario delle foglie di [`QueryPredicate`] viste da questo indice:
//!
//! - `Text`: termini (`Terms`, un AND di termini in qualunque ordine) o frase
//!   (`Phrase`, la sequenza esatta); campi `Name`, `Body`, `Tags`, `Heading`,
//!   default = tutti e quattro coi pesi; tolleranza `Exact`, e `Typos` che cade
//!   su `Exact` — il verso sicuro: restringe invece di allargare.
//!   `partial_last_term` vive solo nell'invocazione mentre-si-digita (l'ultimo
//!   termine è un prefisso), mai salvato. TEXT è termini/frase, mai sintassi di
//!   motore: nella stringa libera non ci sono operatori da parsare.
//! - `Tag { descendants }`: termine esatto su `tags`, o su `tag_paths` (sé
//!   stesso più ogni antenato, via `fub_abi::query::tag_ancestors`) con
//!   `descendants`; la chiave è canonica via [`canonical_tag`].
//! - `Folder { descendants }`: termine esatto su `folder_exact`, o su `folder`
//!   (ogni antenata, via `fub_abi::query::folders_of`) con `descendants`; la
//!   normalizzazione è `fub_abi::rules::folders::normalized`, la stessa che ha
//!   scritto il campo.
//! - `Docs`: è già la risposta, e si legge così com'è.
//! - `Linked`: non si valuta qui — la serve il pianificatore sul grafo del
//!   kernel; qui è [`PluginError::Unserved`].
//! - `Property`: non si valuta qui — la serve chi ha il frontmatter in cache
//!   (il kernel, regole `QueryEvaluator` in un posto solo); qui è
//!   [`PluginError::Unserved`].
//!
//! La regex dell'utente cerca nei campi memorizzati in chiaro, con limiti su
//! pattern, numero di documenti e byte letti; il testo case-sensitive usa la
//! stessa scansione. Entrambi rifiutano la query prima di restituire un insieme
//! parziale se superano il limite. `Task { Open | Done }` è indicizzato dai
//! marker delle liste annidate nel modello, senza inferire uno stato dai nomi.
//! `Path` e `File` spettano al valutatore del kernel, non a Tantivy.
//!
//! Nessun secondo indice grafo/tag qui dentro: tag e cartelle si riusano dalle
//! regole del contratto, i link dal grafo del kernel.

use std::collections::HashMap;
use std::ops::Bound;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use camino::Utf8Path;
use fub_abi::edit::{Fnv1a, Revision};
use fub_abi::event::{Event, EventKind, EventMask, Notice};
use fub_abi::model::{canonical_tag, Block, DocId, DocumentModel, Span};
use fub_abi::query::{
    DueBound, QueryClause, QueryExpr, QueryPredicate, TaskStatus, TextField, TextMode, TextQuery,
    TextTolerance,
};
use fub_abi::rules::folders;
use fub_abi::rules::snippet::SNIPPET_CHARS;
use fub_abi::schema::SchemaVersion;
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    DocumentMatch, EntryKind, EventHandler, Excerpts, HostApi, IndexLoss, IndexProvider,
    IndexQuery, IndexResult, Page, Paged, PredicateKind, QueryRoute, VaultEntry,
};
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};
use tantivy::query::{
    AllQuery, BooleanQuery, BoostQuery, Occur, PhrasePrefixQuery, PhraseQuery, Query, RangeQuery,
    RegexQuery, TermQuery,
};
use tantivy::schema::{Field, IndexRecordOption, Schema, Value, STORED, STRING, TEXT};
use tantivy::snippet::SnippetGenerator;
use tantivy::tokenizer::TokenStream;
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

mod scope;

const MAX_SCAN_DOCS: u64 = 2048;
const MAX_SCAN_BYTES: usize = 8 * 1024 * 1024;
const MAX_REGEX_BYTES: usize = 256;
const ALL_TEXT_FIELDS: [TextField; 4] = [
    TextField::Name,
    TextField::Body,
    TextField::Tags,
    TextField::Heading,
];

/// Identità della ricerca come plugin: è lo spazio dati che l'host le concede.
/// La assegna chi registra il provider — non la feature.
pub const SEARCH_ID: &str = "fub.search";

/// Versione dello schema dell'indice. **Va incrementata** ad ogni modifica dei
/// campi, delle opzioni o del tokenizer: un manifest con versione diversa fa
/// buttare via l'indice e ricostruirlo da zero.
///
/// v2: `tags` da TEXT tokenizzato a STRING (termine esatto, forma canonica).
/// v3: campo `folder` (ogni cartella antenata come termine) per l'ambito della
/// ricerca, e impronta sul `DocId` intero invece che sul solo nome.
/// v4: `folder_exact` e `tag_paths`, cioè le due forme che i predicati del
/// linguaggio (§5.3) chiedono e che i campi di prima non sapevano distinguere —
/// «in questa cartella» contro «in questa o sotto», e lo stesso per un tag.
/// v5: `headings`, il campo che `TextField::Heading` chiede (decisione 0050).
/// v6: `headings` e `tags` memorizzati per la scansione regex/case-sensitive;
/// `task_state` per i marker open/done. Gli alias restano in `page_name` e
/// sono coperti dall'impronta del contenuto.
/// v7: `layout`, righe, blocchi e sezioni del corpo per `QueryPredicate::Scoped`.
/// v8: `task_due`, le scadenze `📅` delle task aperte per `QueryPredicate::TaskDue`.
const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(8);

/// **La forma che quel numero versiona** (§15.3,
/// [0106](../../../docs/decisions/0191-ui-dichiarativa-e-renderer.md)).
///
/// Un numero di schema serve a chi rilegge, e serve a una condizione sola: che
/// **salga quando la forma cambia**. I due banchi di questo file provano che il
/// numero scritto è quello letto e che un numero diverso butta le impronte —
/// nessuno dei due prova la cosa che conta, ed è stato misurato: rinominando il
/// campo `body` in `corpo` senza toccare `SCHEMA_VERSION` la suite intera resta
/// verde, e chi riapre un vault indicizzato ieri trova un indice **incoerente**
/// invece di una ricostruzione.
///
/// Questa stringa è la forma dello schema di tantivy, campo per campo: il nome,
/// il tokenizer con cui è indicizzato e se è memorizzato. Cambiarne uno senza
/// alzare il numero è la sola cosa che
/// [`lo_schema_non_cambia_senza_che_il_numero_salga`] non lascia passare.
#[cfg(test)]
const FINGERPRINT_OF_THE_SCHEMA: &str = "doc_id:raw:stored page_name:default:stored \
body:default:stored tags:raw:stored tag_paths:raw folder:raw folder_exact:raw \
headings:default:stored task_state:raw layout:-:stored task_due:raw";

/// Nome del manifest nello spazio dati del plugin (vedi [`Manifest`]).
const MANIFEST: &str = "manifest.json";

/// Sottocartella dello spazio dati in cui vive l'indice di tantivy.
const INDEX_DIR: &str = "index";

/// Memoria del writer tantivy. Sotto i 15 MB tantivy rifiuta.
const WRITER_HEAP: usize = 50_000_000;

/// Il `page_name` conta più del corpo: chi cerca "Rust" vuole prima la nota
/// *intitolata* Rust, poi le mille che la nominano.
///
/// È il **default** dell'impostazione `search.boost.name`, non più una legge
/// del motore (§21.6): resta il numero giusto per la maggioranza dei vault, e
/// chi ne ha uno diverso lo cambia. Pubblica perché ha due lettori che non
/// devono poter divergere — lo schema che la dichiara
/// (`fub_host::settings::search_settings`) e il banco della seduta
/// (`examples/una_ricerca.rs`).
pub const PAGE_NAME_BOOST: f32 = 4.0;

/// Un heading conta più del corpo e meno del titolo della nota: chi ci ha
/// dedicato una **sezione** ne parla più di chi la nomina in una riga, e meno
/// di chi ci ha intitolato la nota intera. Il boost si somma alla copia che il
/// termine ha già nel corpo, ed è precisamente l'effetto voluto.
///
/// Default di `search.boost.heading`.
pub const HEADING_BOOST: f32 = 2.0;

/// Il corpo è l'**unità di misura** degli altri tre, e per questo il suo
/// default è 1.0: in un punteggio contano i rapporti fra i pesi, non i loro
/// valori assoluti — moltiplicarli tutti e quattro per dieci non sposta un
/// solo risultato. È configurabile lo stesso, per non avere un campo indicizzato
/// su quattro che si comporta diversamente dagli altri senza che la firma lo
/// dica, e la descrizione della chiave lo spiega invece di lasciarlo scoprire.
pub const BODY_BOOST: f32 = 1.0;

/// I tag pesano quanto il corpo, e non è una scelta forte: è il default di chi
/// non sa come l'utente organizza le note. Chi organizza *per tag* li vuole
/// sopra, chi non li usa li vuole a zero, e da qui in poi può dirlo
/// (`search.boost.tags`).
pub const TAGS_BOOST: f32 = 1.0;

/// Il prefisso delle chiavi dei pesi. Chi reagisce a `SettingChanged` guarda
/// questo e non i quattro nomi a uno a uno: aggiungere un campo indicizzato non
/// deve poter lasciare indietro il ramo che lo rilegge.
pub const BOOST_PREFIX: &str = "search.boost.";

/// Quanto pesa una corrispondenza nel nome della nota.
pub const BOOST_NAME_KEY: &str = "search.boost.name";
/// Quanto pesa una corrispondenza in un heading.
pub const BOOST_HEADING_KEY: &str = "search.boost.heading";
/// Quanto pesa una corrispondenza nel corpo.
pub const BOOST_BODY_KEY: &str = "search.boost.body";
/// Quanto pesa una corrispondenza in un tag.
pub const BOOST_TAGS_KEY: &str = "search.boost.tags";

/// Il minimo di un peso, e il massimo (§21.6).
///
/// Zero è **ammesso** e non vuol dire «non cercare lì»: un campo con peso zero
/// continua a far *combaciare* il documento, e smette solo di farlo salire. È
/// una distinzione che si spiega nella descrizione della chiave invece di
/// vietarla, perché il caso è reale — «trova anche nei tag, ma non premiarli» —
/// e perché «non cercare lì» ha già la sua porta, che è `TextQuery.fields`.
///
/// Il tetto non è una legge di natura: è il guardrail contro il refuso, `40`
/// battuto al posto di `4.0`. Un peso fuori intervallo viene **rifiutato** e
/// non arrotondato — è la regola di [`SettingKind::rejects`], e vale qui come
/// altrove: un valore corretto in silenzio è un valore che l'utente non ha
/// scelto e non sa di non avere.
///
/// [`SettingKind::rejects`]: fub_abi::settings::SettingKind::rejects
pub const BOOST_MIN: f64 = 0.0;
/// Vedi [`BOOST_MIN`].
pub const BOOST_MAX: f64 = 100.0;

/// Quanto pesa ciascun campo, cioè lo stato che la §21.6 ha tolto dal codice
/// sorgente e messo nelle mani di chi usa il vault.
///
/// # Una copia che non invecchia
///
/// [`IndexProvider::query`] riceve `&self` e **nessun `HostApi`**: i pesi non
/// si possono leggere nel momento in cui servono, e vanno tenuti qui. Uno stato
/// letto una volta e tenuto in RAM è una copia, e una copia invecchia — così
/// questa ha chi la rinfresca: [`SearchSettings`], un `EventHandler` che
/// registriamo accanto al provider e che rilegge le chiavi a ogni
/// [`Event::SettingChanged`]. I due condividono l'`Arc`, ed è il motivo per cui
/// il campo non è un semplice `FieldWeights`.
///
/// Il `RwLock` sta sul percorso di ogni query, ed è la cosa giusta da fare per
/// la stessa ragione della decisione 0024: chi legge è tutto il mondo, chi
/// scrive è una persona che muove uno slider ogni tanto. Il costo di una
/// `read()` non contendibile non si misura accanto al giro dentro tantivy — e
/// il banco della seduta è lì per smentirmi se sbaglio.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FieldWeights {
    pub name: f32,
    pub heading: f32,
    pub body: f32,
    pub tags: f32,
}

impl Default for FieldWeights {
    fn default() -> Self {
        FieldWeights {
            name: PAGE_NAME_BOOST,
            heading: HEADING_BOOST,
            body: BODY_BOOST,
            tags: TAGS_BOOST,
        }
    }
}

impl FieldWeights {
    /// I pesi come sono adesso nelle impostazioni.
    ///
    /// Una chiave che non c'è, o che porta un valore di un'altra specie, vale
    /// il proprio default: è la stessa risposta che darebbe uno schema
    /// dichiarato e mai scritto, e qui non è un ripiego — un motore di ricerca
    /// che si rifiutasse di partire perché un peso non si legge sarebbe un
    /// vault senza ricerca per un numero.
    pub fn read(host: &dyn HostApi) -> Self {
        let d = FieldWeights::default();
        let one = |key: &str, fallback: f32| -> f32 {
            host.setting(key)
                .ok()
                .and_then(|v| v.as_number())
                .map(|n| n as f32)
                .unwrap_or(fallback)
        };
        FieldWeights {
            name: one(BOOST_NAME_KEY, d.name),
            heading: one(BOOST_HEADING_KEY, d.heading),
            body: one(BOOST_BODY_KEY, d.body),
            tags: one(BOOST_TAGS_KEY, d.tags),
        }
    }
}

mod catalog;
mod engine;
mod index;
mod provider;
mod schema;
#[cfg(test)]
mod tests;

pub use catalog::{catalog, settings};
use catalog::{
    io_err, reason, COUNT, DOC_READ, INDEX_CLOSE, INDEX_COMMIT, INDEX_CREATE, INDEX_LOCKED,
    INDEX_READER, INDEX_RELOAD, MANIFEST_WRITE, PATH, REASON, SCOPE_TOO_LARGE, SCOPE_TOO_MANY,
    SEARCH, SELECT_UNSUPPORTED, SNIPPET, TOKENIZER, UNSERVED_FAMILY, UNSERVED_LEAF, WHAT,
};
#[cfg(test)]
use engine::head_of;
use engine::item_due;
pub use index::SearchIndex;
pub use provider::SearchSettings;
#[cfg(test)]
use schema::schema_fingerprint;
use schema::{build_schema, fingerprint, tag_names, task_states, Fields, Manifest};
