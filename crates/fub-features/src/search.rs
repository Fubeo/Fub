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
//!    proprio plugin (`.fub/data/plugins/fub.search/`). Alla riapertura
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
//!    (`due_ricerche_stanno_nell_indice_insieme`).
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
//! quei momenti. Il path arriva dall'host (`Workspace::plugin_data_root`) ed è
//! **dentro lo stesso recinto** del resto: quel varco è dichiarato, non
//! implicito, ed è ciò che a M5 diventerà un preopen WASI sulla stessa cartella
//! per un componente che avvolga un motore analogo.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use camino::Utf8Path;
use fub_abi::edit::Revision;
use fub_abi::event::{Event, EventKind, EventMask, Notice};
use fub_abi::model::{canonical_tag, DocId, DocumentModel, Span};
use fub_abi::query::{
    QueryClause, QueryExpr, QueryPredicate, TextField, TextMode, TextQuery, TextTolerance,
};
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    DocumentMatch, EntryKind, EventHandler, Excerpts, HostApi, IndexLoss, IndexProvider,
    IndexQuery, IndexResult, Page, Paged, PredicateKind, QueryRoute, VaultEntry,
};
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};
use tantivy::query::{
    AllQuery, BooleanQuery, BoostQuery, Occur, PhrasePrefixQuery, PhraseQuery, Query, RegexQuery,
    TermQuery,
};
use tantivy::schema::{Field, IndexRecordOption, Schema, Value, STORED, STRING, TEXT};
use tantivy::snippet::SnippetGenerator;
use tantivy::tokenizer::TokenStream;
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

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
const SCHEMA_VERSION: u32 = 5;

/// **La forma che quel numero versiona** (§15.3,
/// [0106](../../../docs/decisions/0106-un-formato-si-presenta.md)).
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
const IMPRONTA_DELLO_SCHEMA: &str = "doc_id:raw:stored page_name:default:stored \
body:default:stored tags:raw tag_paths:raw folder:raw folder_exact:raw \
headings:default";

/// Nome del manifest nello spazio dati del plugin (vedi [`Manifest`]).
const MANIFEST: &str = "manifest.json";

/// Sottocartella dello spazio dati in cui vive l'indice di tantivy.
const INDEX_DIR: &str = "index";

/// Memoria del writer tantivy. Sotto i 15 MB tantivy rifiuta.
const WRITER_HEAP: usize = 50_000_000;

/// Lunghezza massima di uno snippet, in caratteri.
const SNIPPET_CHARS: usize = 220;

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

/// Ciò che il manifest deve dire perché ci si possa fidare delle impronte.
///
/// Le impronte vivono qui e non dentro l'indice per non pagare, ad ogni
/// apertura, la lettura documento-per-documento di tutto il vault. Il prezzo è
/// che manifest e indice sono **due cose che possono divergere** (un crash fra
/// il commit e la scrittura del manifest, o un commit deciso da una query e non
/// seguito da un flush). Il guardiano è l'`opstamp`: tantivy lo incrementa ad
/// ogni commit, e un manifest che non cita l'opstamp attualmente committato è
/// per definizione di un'altra epoca — si buttano le impronte, non l'indice, e
/// i documenti si reindicizzano (delete+add è idempotente). Mai il contrario:
/// un manifest creduto valido a sproposito farebbe *saltare* documenti, cioè
/// mentire in silenzio.
#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    schema_version: u32,
    opstamp: u64,
    /// `DocId` → impronta del contenuto indicizzato.
    docs: HashMap<String, u64>,
    /// `DocId` → la revisione del **sorgente** da cui quel contenuto è stato
    /// ricavato, cioè ciò che permette di rispondere a
    /// [`IndexProvider::up_to_date`] **senza che nessuno legga il file**
    /// (§14.2).
    ///
    /// È un'informazione diversa da `docs`, non una ridondanza: `docs` è
    /// l'impronta del *modello* — id, testo, tag — e serve a non riscrivere in
    /// tantivy ciò che è identico *dopo* il parse; questa è l'impronta dei
    /// **byte del file**, la stessa che il kernel tiene in anagrafe, e serve a
    /// non arrivare al parse. Non si può derivare l'una dall'altra: fra le due
    /// c'è un parser.
    ///
    /// Assente per un documento indicizzato **senza** che nessuno abbia
    /// dichiarato di che revisione fosse — cioè per ogni scrittura a sessione
    /// aperta, dove il kernel alimenta l'indice senza passare da `up_to_date`.
    /// Vuol dire «alla prossima apertura rileggimelo», che è il verso giusto in
    /// cui sbagliare.
    #[serde(default)]
    sources: HashMap<String, String>,
}

/// Impronta stabile di ciò che finisce nell'indice per un documento.
///
/// FNV-1a a mano invece di `DefaultHasher`: quest'ultimo non garantisce lo
/// stesso valore fra versioni di Rust o piattaforme, e questa impronta
/// sopravvive su disco fra un avvio e l'altro.
fn fingerprint(doc: &DocumentModel) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut h = OFFSET;
    let mut eat = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(PRIME);
        }
    };
    // Il path intero e non il solo nome: da quando l'indice porta la cartella
    // (`folder`, v3), spostare una nota cambia ciò che è indicizzato anche a
    // contenuto identico.
    eat(doc.id.as_str().as_bytes());
    eat(&[0]);
    eat(doc.text.as_bytes());
    eat(&[0]);
    for tag in &doc.tags {
        eat(tag.name.as_bytes());
        eat(&[0x1f]);
    }
    h
}

/// I campi dello schema, risolti una volta sola.
#[derive(Clone, Copy)]
struct Fields {
    doc_id: Field,
    page_name: Field,
    body: Field,
    /// I tag esatti, in forma canonica.
    tags: Field,
    /// I tag e ogni loro antenato (`progetto/casa` mette anche `progetto`): è
    /// ciò che rende `Tag { descendants: true }` una `TermQuery` invece di un
    /// prefisso da valutare documento per documento.
    tag_paths: Field,
    /// Ogni cartella antenata, radice compresa.
    folder: Field,
    /// La sola cartella che contiene il documento.
    folder_exact: Field,
    /// Il testo degli heading del documento, in fila.
    ///
    /// Il testo c'è già dentro `body` — la proiezione a testo piano non toglie
    /// i titoli — e questa è una **seconda** copia, indicizzata a parte perché
    /// quello che serve è pesarla di più: una nota che ha dedicato una sezione
    /// a una cosa non è come una che la nomina di sfuggita, ed è la distinzione
    /// che `TextField::Heading` esiste per dire.
    headings: Field,
}

/// La forma dello schema, in una riga: `nome:tokenizer[:stored]` per campo, in
/// ordine di dichiarazione. Sta accanto a chi lo costruisce, perché è di lui che
/// parla.
#[cfg(test)]
fn schema_fingerprint(schema: &Schema) -> String {
    schema
        .fields()
        .map(|(_, entry)| {
            let mut riga = entry.name().to_string();
            if let tantivy::schema::FieldType::Str(opts) = entry.field_type() {
                riga.push(':');
                riga.push_str(match opts.get_indexing_options() {
                    Some(i) => i.tokenizer(),
                    None => "-",
                });
                if opts.is_stored() {
                    riga.push_str(":stored");
                }
            } else {
                riga.push_str(":altro");
            }
            riga
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    // STRING = tokenizer "raw": il DocId resta un termine unico ed esatto, ed
    // è ciò che rende `delete_term` una cancellazione chirurgica.
    let doc_id = b.add_text_field("doc_id", STRING | STORED);
    let page_name = b.add_text_field("page_name", TEXT | STORED);
    // STORED anche il corpo: il generatore di snippet rilegge il testo del
    // documento, non può ricostruirlo dai postings.
    let body = b.add_text_field("body", TEXT | STORED);
    // STRING, non TEXT: un tag è una CHIAVE, non prosa. Tokenizzato,
    // `tags:rust` matchava anche `#progetto/rust` e `tags:area/lavoro`
    // diventava una phrase query su due termini — conteggi del pannello e
    // risultati del click non coincidevano mai. Ogni tag entra come termine
    // unico nella forma canonica ([`canonical_tag`]).
    let tags = b.add_text_field("tags", STRING);
    let tag_paths = b.add_text_field("tag_paths", STRING);
    // Come i tag, la cartella è una CHIAVE: termine esatto, non prosa. Non è
    // STORED perché non torna mai indietro — serve solo a filtrare.
    let folder = b.add_text_field("folder", STRING);
    let folder_exact = b.add_text_field("folder_exact", STRING);
    // Prosa, come il corpo: un heading è una frase che qualcuno ha scritto, e
    // si cerca dentro con le stesse regole. Non STORED: da qui non torna
    // indietro niente — gli estratti li genera il corpo.
    let headings = b.add_text_field("headings", TEXT);
    (
        b.build(),
        Fields {
            doc_id,
            page_name,
            body,
            tags,
            tag_paths,
            folder,
            folder_exact,
            headings,
        },
    )
}

/// Indice full-text del vault.
///
/// # Perché non c'è un lock attorno a tutto
///
/// Prima c'era: un `Mutex<Inner>` che [`IndexProvider::query`] prendeva a ogni
/// interrogazione, perché una query può dover **committare** le scritture in
/// sospeso (chi interroga vede sempre le proprie scritture — è il provider a
/// garantirlo, vedi il trait). Il risultato era che la lettura che l'utente
/// scatena più spesso non guadagnava niente dal prestito condiviso del
/// workspace: il `RwLock` del kernel non attraversa il lock di un provider, e
/// otto thread facevano le stesse ricerche al secondo di uno
/// ([decisione 0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)).
///
/// La garanzia non è stata tolta: è stato tolto il **prezzo di chi non la usa**.
/// Committare serve solo quando c'è qualcosa da committare, e chi scrive passa
/// da `&mut self` — cioè, nel kernel, dal prestito esclusivo del workspace.
/// Quindi:
///
/// - il **writer** è l'unica cosa dietro un lock, perché `IndexWriter::commit`
///   vuole `&mut self` mentre `add_document`/`delete_term` no;
/// - `dirty` è un atomico, e una query che lo trova falso — il caso normale —
///   non tocca nessun lock: legge un `bool` e va a interrogare il reader;
/// - `reader`, `index` e `fields` servono in sola lettura, e tantivy li dà per
///   condivisi (`searcher()` prende `&self`);
/// - `fingerprints` e `manifest_at` cambiano **solo** sotto `&mut self`, quindi
///   sono campi normali: è il compilatore a tenerli fuori dalla concorrenza,
///   non un lock.
pub struct SearchIndex {
    index: Index,
    /// Il solo lock rimasto, e non sta sul percorso di una query pulita: lo
    /// prende chi scrive, e chi interroga **solo** se trova `dirty`.
    ///
    /// `Option` perché una chiusura lo **restituisce**: `IndexProvider::close`
    /// (decisione 0028) lo estrae e aspetta i thread di merge, che è il solo
    /// modo di lasciare andare il lock file della cartella prima che il processo
    /// muoia. Vuoto = questo indice è chiuso, e ciò che arriva dopo non ha più
    /// dove andare.
    writer: Mutex<Option<IndexWriter>>,
    reader: IndexReader,
    fields: Fields,
    fingerprints: HashMap<DocId, u64>,
    /// `DocId` → revisione del sorgente indicizzato (vedi [`Manifest::sources`]).
    sources: HashMap<DocId, Revision>,
    /// Ciò che il kernel ha **appena dichiarato** chiedendo cosa è già a posto:
    /// `DocId` → revisione del sorgente che sta per consegnare.
    ///
    /// Serve perché [`IndexProvider::on_documents_indexed`] riceve un *modello*,
    /// e da un modello la revisione del sorgente non si ricalcola. L'unico
    /// posto in cui questo indice la vede è la domanda del kernel, e questa
    /// mappa è il tempo che passa fra la domanda e la consegna: si riempie in
    /// [`IndexProvider::up_to_date`] e si **consuma** documento per documento.
    /// Consumare e non consultare è il punto: un documento che arriva senza
    /// dichiarazione — perché qualcuno l'ha salvato a sessione aperta — non
    /// deve raccogliere la revisione che la domanda dell'avvio aveva lasciato
    /// lì, che sarebbe quella di *prima* della modifica.
    ///
    /// `Mutex` perché la domanda arriva su `&self`: è una lettura per il
    /// contratto, ed è giusto che lo sia — chiedere cosa un indice ha già non
    /// lo cambia.
    announced: Mutex<HashMap<DocId, Revision>>,
    /// Ci sono scritture accettate ma non ancora committate? Atomico perché lo
    /// spegne anche una `query`, che ha solo `&self`.
    dirty: AtomicBool,
    /// L'opstamp dell'ultimo commit visto da questa istanza. Atomico per lo
    /// stesso motivo: lo alza anche il commit deciso da una query.
    opstamp: AtomicU64,
    /// L'opstamp citato dal manifest attualmente su disco, se ce n'è uno di cui
    /// ci si fida. `None` = manifest assente, di un'altra epoca o da riscrivere.
    ///
    /// Non atomico: lo scrivono solo `activate` e `flush`, che hanno `&mut self`.
    manifest_at: Option<u64>,
    /// Quanto pesa ciascun campo (§21.6). Condiviso con [`SearchSettings`], che
    /// è chi lo rinfresca: vedi [`FieldWeights`].
    weights: Arc<RwLock<FieldWeights>>,
}

impl SearchIndex {
    /// Apre (o crea) l'indice dentro lo spazio dati che l'host assegna a questo
    /// provider (`Workspace::plugin_data_root(SEARCH_ID)`).
    ///
    /// Il path arriva da fuori e non si compone qui: la disposizione dello
    /// spazio dati di un plugin è una scelta del kernel, e una feature che se la
    /// ricalcolasse per conto proprio ne terrebbe una seconda copia.
    pub fn open(plugin_data_root: &Utf8Path) -> Result<Self, PluginError> {
        Self::open_dir(&plugin_data_root.join(INDEX_DIR))
    }

    /// Apre (o crea) l'indice in una cartella specifica.
    pub fn open_dir(dir: &Utf8Path) -> Result<Self, PluginError> {
        let (schema, fields) = build_schema();

        // Un indice che non si apre, o il cui schema non è più il nostro, non
        // è un problema da diagnosticare: è stato derivato, si butta.
        let mut index = open_existing(dir, &schema);
        if index.is_none() {
            wipe(dir)?;
            std::fs::create_dir_all(dir).map_err(|e| io_err(dir, e))?;
            index = Some(
                Index::create_in_dir(dir, schema.clone())
                    .map_err(|e| PluginError::Internal(motivo(INDEX_CREATE, e)))?,
            );
        }
        let index = index.expect("appena creato se assente");

        // Il writer prende un lock esclusivo sulla cartella. Fallire qui NON
        // deve portare a buttare l'indice: la causa quasi certa è che un'altra
        // istanza di Fub ha già questo vault aperto, e la sua copia è viva e
        // corretta. Si rinuncia alla ricerca, non ai dati di qualcun altro.
        let writer: IndexWriter = index.writer(WRITER_HEAP).map_err(|e| {
            PluginError::Internal(Text::message(
                INDEX_LOCKED,
                vec![
                    Arg::text(PATH, dir.to_string()),
                    Arg::text(REASON, e.to_string()),
                ],
            ))
        })?;
        let reader = index
            .reader_builder()
            // I commit li decidiamo noi (`flush`, o una query con scritture in
            // sospeso): niente thread di watch sul meta.json.
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(|e| PluginError::Internal(motivo(INDEX_READER, e)))?;

        // L'epoca dell'indice sul disco. Le impronte che le corrispondono
        // arrivano da `activate`, l'unico posto dove c'è un host per leggerle.
        let opstamp = index.load_metas().map(|m| m.opstamp).unwrap_or_default();

        Ok(SearchIndex {
            index,
            writer: Mutex::new(Some(writer)),
            reader,
            fields,
            fingerprints: HashMap::new(),
            sources: HashMap::new(),
            announced: Mutex::new(HashMap::new()),
            dirty: AtomicBool::new(false),
            opstamp: AtomicU64::new(opstamp),
            manifest_at: None,
            // I default finché non c'è un host da cui leggere i veri: `open`
            // non ne ha uno, `activate` sì.
            weights: Arc::new(RwLock::new(FieldWeights::default())),
        })
    }

    /// Il capo dell'`Arc` da dare a [`SearchSettings`] perché possa rinfrescare
    /// i pesi di *questo* indice.
    ///
    /// Esiste perché i due si registrano separatamente — un `IndexProvider` e
    /// un `EventHandler` sono due registrazioni distinte, e dopo la prima
    /// l'indice è dentro il workspace e non lo si tocca più. Il capo si prende
    /// **prima**, al montaggio.
    pub fn settings_handler(&self) -> SearchSettings {
        SearchSettings {
            weights: Arc::clone(&self.weights),
        }
    }

    /// I pesi con cui questo indice sta punteggiando adesso. Per i test e le
    /// diagnostiche: una query non la si può interrogare su come ha pesato.
    pub fn weights(&self) -> FieldWeights {
        *self.weights.read().expect("rwlock")
    }

    /// Quanti documenti l'indice crede di avere. Utile ai test e alle
    /// diagnostiche; non è una query.
    pub fn len(&self) -> usize {
        self.fingerprints.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Apre un indice esistente, se c'è ed è ancora il nostro.
fn open_existing(dir: &Utf8Path, schema: &Schema) -> Option<Index> {
    if !dir.exists() {
        return None;
    }
    let index = Index::open_in_dir(dir).ok()?;
    // Lo schema sul disco deve essere identico a quello che il codice si
    // aspetta, altrimenti le query cercherebbero campi che non esistono.
    (index.schema() == *schema).then_some(index)
}

fn wipe(dir: &Utf8Path) -> Result<(), PluginError> {
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| io_err(dir, e))?;
    }
    Ok(())
}

/// Le chiavi delle stringhe della ricerca.
///
/// Sono **tutte** messaggi d'errore, come nel versioning e per la stessa
/// ragione: la ricerca non disegna niente — il pannello è della shell, e i
/// risultati sono dati — quindi l'unica prosa che scrive è quella di quando non
/// riesce. Undici delle tredici sono un fallimento della libreria d'indice
/// impacchettato (vedi [`motivo`]); le altre due sono le due domande che la
/// ricerca non serve.
const INDEX_CREATE: &str = "index_create";
const INDEX_LOCKED: &str = "index_locked";
const INDEX_READER: &str = "index_reader";
const INDEX_COMMIT: &str = "index_commit";
const INDEX_RELOAD: &str = "index_reload";
const INDEX_CLOSE: &str = "index_close";
const MANIFEST_WRITE: &str = "manifest_write";
const COUNT: &str = "count";
const SEARCH: &str = "search";
const SNIPPET: &str = "snippet";
const DOC_READ: &str = "doc_read";
const TOKENIZER: &str = "tokenizer";
const IO: &str = "io";
const UNSERVED_LEAF: &str = "unserved_leaf";
const UNSERVED_FAMILY: &str = "unserved_family";
const SELECT_UNSUPPORTED: &str = "select_unsupported";
/// I nomi degli argomenti.
const PATH: &str = "path";
const REASON: &str = "reason";
const WHAT: &str = "what";

/// Le chiavi delle stringhe dei **pesi** (§21.6). Sono le etichette che il
/// pannello disegna, e stanno accanto allo schema che le nomina: una `label`
/// senza la sua `SettingSpec` a fianco è la prima cosa che si disallinea.
///
/// Il suffisso `.label` sulle prime distingue la chiave della *stringa* da
/// quella dell'*impostazione* ([`BOOST_NAME_KEY`] e compagne): sono due spazi di
/// nomi diversi (§7.4) e potrebbero anche coincidere, ma due cose diverse con lo
/// stesso nome dentro lo stesso file sono un invito a scambiarle.
const S_GROUP: &str = "search.group";
const S_NAME: &str = "search.boost.name.label";
const S_NAME_DESC: &str = "search.boost.name.desc";
const S_HEADING: &str = "search.boost.heading.label";
const S_HEADING_DESC: &str = "search.boost.heading.desc";
const S_BODY: &str = "search.boost.body.label";
const S_BODY_DESC: &str = "search.boost.body.desc";
const S_TAGS: &str = "search.boost.tags.label";
const S_TAGS_DESC: &str = "search.boost.tags.desc";

/// Lo schema delle impostazioni della ricerca: **quanto pesa ciascun campo**
/// (§21.6).
///
/// # Perché sta qui e non in `fub-host`
///
/// L'altro schema di una feature ufficiale — l'interruttore del versioning —
/// vive in `fub_host::settings`, e la ragione scritta lì è che quell'interruttore
/// è **dell'host**: il versioning non sa di poter essere spento, e chi lo spegne
/// è chi monta. Qui è l'opposto e va detto, perché la disposizione diversa non
/// sia scambiata per una dimenticanza: un motore di ricerca sa benissimo di
/// avere dei pesi, li legge lui, ed è lui a saper dire cosa vuol dire metterne
/// uno a zero. Questa è la forma normale — un componente che dichiara le proprie
/// chiavi — ed è **esattamente** ciò che scriverebbe un plugin di terzi con un
/// indice configurabile; quella del versioning è l'eccezione, per un
/// interruttore che il componente stesso non possiede.
///
/// Ne segue la proprietà che rende la voce chiusa invece che spostata: i default
/// dello schema **sono** le costanti che il motore usa e che il banco della
/// seduta (`examples/una_ricerca.rs`) importa. Una fonte sola, e nessun posto in
/// cui possano divergere.
///
/// # Quattro chiavi, e i rapporti che contano
///
/// Anche il corpo, il cui default è 1.0 e che di fatto è l'unità di misura degli
/// altri tre. La ragione di dichiararlo lo stesso è che quattro campi
/// indicizzati con tre chiavi lasciano un caso speciale da spiegare a voce; la
/// cosa che va detta — alzarli tutti e quattro insieme non sposta un solo
/// risultato — si dice nella descrizione, che è dove qualcuno la legge.
///
/// Tutte e quattro `program_writable`, come `versioning.enabled`: un peso è
/// reversibile e non riguarda la privacy, e «questo vault è un archivio di
/// paper, alza gli heading» è il profilo di vault che il §11.1 apre. Il permesso
/// `fub:write-settings` resta il primo cancello, e nessun plugin di terzi ce
/// l'ha finché non se lo dichiara e qualcuno glielo concede.
pub fn settings() -> Vec<SettingSpec> {
    let peso = |key: &str, label: &str, desc: &str, default: f32| {
        SettingSpec::new(
            key,
            Text::key(label),
            SettingKind::Number {
                default: default as f64,
                min: Some(BOOST_MIN),
                max: Some(BOOST_MAX),
            },
        )
        .describing(Text::key(desc))
        .grouped(Text::key(S_GROUP))
        .program_writable()
    };
    vec![
        peso(BOOST_NAME_KEY, S_NAME, S_NAME_DESC, PAGE_NAME_BOOST),
        peso(BOOST_HEADING_KEY, S_HEADING, S_HEADING_DESC, HEADING_BOOST),
        peso(BOOST_BODY_KEY, S_BODY, S_BODY_DESC, BODY_BOOST),
        peso(BOOST_TAGS_KEY, S_TAGS, S_TAGS_DESC, TAGS_BOOST),
    ]
}

/// Le stringhe della ricerca: i suoi errori, e le etichette dei suoi pesi.
///
/// Vedi [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell. Le etichette dei pesi stanno in **questo**
/// catalogo e non in un secondo che il montaggio somma — come fa il versioning —
/// per la stessa ragione per cui ci sta lo schema: sono della ricerca, e un
/// componente che parla di sé lo fa con una voce sola.
///
/// Le descrizioni dicono le due cose che nessuno indovina guardando un numero:
/// che conta il **rapporto** fra i pesi e non il loro valore, e che **zero non
/// spegne la ricerca su quel campo** — la nota si trova ancora, smette solo di
/// salire per merito suo.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(
                INDEX_CREATE,
                "Non riesco a creare l'indice di ricerca: {reason}",
            )
            .with(
                INDEX_LOCKED,
                "L'indice di ricerca in {path} è occupato: {reason} — un'altra \
                 istanza di Fub ha forse questo vault già aperto.",
            )
            .with(
                INDEX_READER,
                "Non riesco a leggere l'indice di ricerca: {reason}",
            )
            .with(
                INDEX_COMMIT,
                "Non riesco a salvare l'indice di ricerca: {reason}",
            )
            .with(
                INDEX_RELOAD,
                "Non riesco a ricaricare l'indice di ricerca: {reason}",
            )
            .with(
                INDEX_CLOSE,
                "Non riesco a chiudere l'indice di ricerca: {reason}",
            )
            .with(
                MANIFEST_WRITE,
                "Non riesco a scrivere il manifest dell'indice: {reason}",
            )
            .with(COUNT, "Non riesco a contare i risultati: {reason}")
            .with(SEARCH, "La ricerca non è riuscita: {reason}")
            .with(
                SNIPPET,
                "Non riesco a preparare l'anteprima di un risultato: {reason}",
            )
            .with(
                DOC_READ,
                "Non riesco a leggere un documento dall'indice: {reason}",
            )
            .with(
                TOKENIZER,
                "Non riesco ad analizzare il testo cercato: {reason}",
            )
            .with(IO, "{path} non si legge: {reason}")
            .with(
                UNSERVED_LEAF,
                "La ricerca non valuta questa condizione: {what}",
            )
            .with(
                UNSERVED_FAMILY,
                "La ricerca non serve questa famiglia di domande: {what}",
            )
            .with(
                SELECT_UNSUPPORTED,
                "La ricerca non ordina per proprietà e non sceglie le colonne: \
                 quello lo fa chi ha il frontmatter.",
            )
            .with(S_GROUP, "Ricerca")
            .with(S_NAME, "Peso del nome della nota")
            .with(
                S_NAME_DESC,
                "Quanto una corrispondenza nel titolo della nota la fa salire fra \
                 i risultati. Conta il rapporto fra i quattro pesi, non il loro \
                 valore: raddoppiarli tutti non cambia nessun ordine. A zero il \
                 campo si cerca ancora — la nota si trova — ma non fa più salire \
                 il risultato; per non cercarci affatto si restringono i campi \
                 della ricerca.",
            )
            .with(S_HEADING, "Peso dei titoli di sezione")
            .with(
                S_HEADING_DESC,
                "Quanto pesa una corrispondenza in un'intestazione. Chi a un \
                 argomento ha dedicato una sezione ne parla più di chi lo nomina \
                 in una riga.",
            )
            .with(S_BODY, "Peso del testo")
            .with(
                S_BODY_DESC,
                "Quanto pesa una corrispondenza nel corpo della nota. È il \
                 riferimento con cui si leggono gli altri tre: lasciandolo a 1 \
                 gli altri pesi si leggono come «quante volte più del testo».",
            )
            .with(S_TAGS, "Peso dei tag")
            .with(
                S_TAGS_DESC,
                "Quanto pesa una corrispondenza in un tag. Alzatelo se le note le \
                 organizzate per tag, abbassatelo se i tag li usate poco.",
            ),
        StringCatalog::new("en")
            .with(INDEX_CREATE, "Cannot create the search index: {reason}")
            .with(
                INDEX_LOCKED,
                "The search index in {path} is busy: {reason} — another instance of \
                 Fub may already have this vault open.",
            )
            .with(INDEX_READER, "Cannot read the search index: {reason}")
            .with(INDEX_COMMIT, "Cannot save the search index: {reason}")
            .with(INDEX_RELOAD, "Cannot reload the search index: {reason}")
            .with(INDEX_CLOSE, "Cannot close the search index: {reason}")
            .with(MANIFEST_WRITE, "Cannot write the index manifest: {reason}")
            .with(COUNT, "Cannot count the results: {reason}")
            .with(SEARCH, "The search failed: {reason}")
            .with(SNIPPET, "Cannot build the preview of a result: {reason}")
            .with(DOC_READ, "Cannot read a document from the index: {reason}")
            .with(TOKENIZER, "Cannot analyse the searched text: {reason}")
            .with(IO, "{path} cannot be read: {reason}")
            .with(
                UNSERVED_LEAF,
                "The search does not evaluate this condition: {what}",
            )
            .with(
                UNSERVED_FAMILY,
                "The search does not serve this family of questions: {what}",
            )
            .with(
                SELECT_UNSUPPORTED,
                "The search does not sort by property and does not pick columns: \
                 that is for whoever has the frontmatter.",
            )
            .with(S_GROUP, "Search")
            .with(S_NAME, "Note name weight")
            .with(
                S_NAME_DESC,
                "How much a match in the note title lifts it among the results. \
                 What counts is the ratio between the four weights, not their \
                 value: doubling them all changes no ordering. At zero the field \
                 is still searched — the note is still found — but it no longer \
                 lifts the result; to not search it at all, narrow the fields of \
                 the search.",
            )
            .with(S_HEADING, "Heading weight")
            .with(
                S_HEADING_DESC,
                "How much a match in a heading weighs. Someone who devoted a \
                 section to a topic says more about it than someone who names it \
                 in one line.",
            )
            .with(S_BODY, "Body weight")
            .with(
                S_BODY_DESC,
                "How much a match in the body of the note weighs. It is the \
                 reference the other three are read against: leaving it at 1 makes \
                 the others read as «how many times more than the body».",
            )
            .with(S_TAGS, "Tag weight")
            .with(
                S_TAGS_DESC,
                "How much a match in a tag weighs. Raise it if you organize your \
                 notes by tag, lower it if you barely use them.",
            ),
    ]
}

fn io_err(path: &Utf8Path, e: std::io::Error) -> PluginError {
    PluginError::Internal(Text::message(
        IO,
        vec![
            Arg::text(PATH, path.to_string()),
            Arg::text(REASON, e.to_string()),
        ],
    ))
}

/// Il guscio comune degli undici fallimenti di libreria: una chiave che dice
/// **cosa** non è riuscito, e la causa così come la racconta chi l'ha vista.
///
/// Il `{reason}` resta la frase di Tantivy, in inglese, e non c'è modo di
/// tradurla: viene da fuori. Il degrado però è quello giusto — la frase che la
/// contiene si legge nella lingua di chi guarda, e la causa resta cercabile
/// così com'è, che è precisamente ciò che serve per riportarla a chi la sa
/// leggere.
fn motivo(key: &str, e: impl std::fmt::Display) -> Text {
    Text::message(key, vec![Arg::text(REASON, e.to_string())])
}

impl SearchIndex {
    fn term_for(&self, id: &DocId) -> Term {
        Term::from_field_text(self.fields.doc_id, id.as_str())
    }

    /// Il documento come lo vuole tantivy.
    ///
    /// Sta fuori da `on_documents_indexed` per una ragione sola: comporlo non ha
    /// niente a che vedere col writer, e non deve tenerne il lock. Chi scrive lo
    /// prende per due chiamate, non per la costruzione di un record.
    fn tantivy_doc(&self, doc: &DocumentModel) -> TantivyDocument {
        let f = self.fields;
        let mut td = TantivyDocument::new();
        td.add_text(f.doc_id, doc.id.as_str());
        td.add_text(f.page_name, doc.id.page_name());
        td.add_text(f.body, &doc.text);
        // Un valore per heading e non una stringa unita: due titoli attaccati
        // formerebbero una frase che nessuno ha scritto, e una ricerca per
        // frase la troverebbe.
        for heading in &doc.outline {
            td.add_text(f.headings, &heading.text);
        }
        // Un valore per tag (non una stringa unita): col tokenizer raw ogni
        // valore È un termine, e il termine è la forma canonica — la stessa
        // chiave con cui il kernel aggrega e il pannello interroga.
        for tag in &doc.tags {
            let canonical = canonical_tag(&tag.name);
            // Ogni antenato è un termine a sé: `#progetto/casa` si lascia
            // trovare da `progetto` con `descendants`, senza che nessuno debba
            // valutare un prefisso documento per documento.
            for ancestor in fub_abi::query::tag_ancestors(&canonical) {
                td.add_text(f.tag_paths, &ancestor);
            }
            td.add_text(f.tags, &canonical);
        }
        // Una cartella per ogni antenata: cercare in `Progetti` prende anche
        // `Progetti/sub`, e la radice (`""`) è su tutti.
        for folder in fub_abi::query::folders_of(&doc.id) {
            td.add_text(f.folder, folder);
        }
        td.add_text(f.folder_exact, fub_abi::query::folder_of(&doc.id));
        td
    }

    /// Committa se ci sono scritture in sospeso, e riallinea il reader.
    ///
    /// Prende `&self` perché il commit può essere deciso anche da una `query`
    /// (chi interroga vede le proprie scritture), ed è **l'unico punto in cui
    /// una query tocca un lock esclusivo**. Quando non c'è niente in sospeso —
    /// cioè sempre, tranne subito dopo una scrittura — questa funzione è la
    /// lettura di un atomico e nient'altro.
    ///
    /// Qui c'era scritto «l'unico punto in cui una query tocca un lock», senza
    /// *esclusivo*, e la frase era **falsa**: [`FieldWeights`] sta dietro un
    /// `RwLock` e `text_query` ne prende la `read()` a ogni ricerca di testo.
    /// La differenza è tutta la §8.4 — una `read()` condivisa non mette nessuno
    /// in fila, un `Mutex` sì — e una parola mancante la cancellava. L'ha
    /// trovata il banco del §17.1
    /// ([decisione 0113](../../../docs/decisions/0113-il-banco-conta-le-operazioni.md)),
    /// che è quello che il commento accanto ai pesi chiedeva quando diceva «*il
    /// banco della seduta è lì per smentirmi se sbaglio*».
    ///
    /// Il doppio controllo di `dirty` non è prudenza: due query concorrenti
    /// possono trovarlo alzato insieme, e la seconda non deve committare a
    /// vuoto. Le due `Ordering` non decorative sono queste: chi spegne `dirty`
    /// lo fa in `Release` **dopo** il `reload`, chi lo legge spento lo fa in
    /// `Acquire` **prima** di chiedere un `searcher` — cioè chi vede «pulito»
    /// vede anche l'indice ricaricato che ha reso vera quella parola.
    ///
    /// Non tocca il manifest: qui non c'è un host, e una query non ne ha uno. Il
    /// manifest lo riscrive [`SearchIndex::persist`], e finché non lo fa quello
    /// su disco risulta di un'altra epoca — cioè inaffidabile, che è il verso
    /// giusto in cui sbagliare.
    fn commit(&self) -> Result<(), PluginError> {
        if !self.dirty.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut guard = self.writer.lock().expect("mutex");
        if !self.dirty.load(Ordering::Acquire) {
            return Ok(());
        }
        // Chiuso: non c'è più niente da committare, e ciò che era in sospeso lo
        // ha già committato `close`. Dirlo come errore sarebbe dire che
        // qualcosa è andato storto, e non è andato storto niente.
        let Some(writer) = guard.as_mut() else {
            return Ok(());
        };
        let opstamp = writer
            .commit()
            .map_err(|e| PluginError::Internal(motivo(INDEX_COMMIT, e)))?;
        self.reader
            .reload()
            .map_err(|e| PluginError::Internal(motivo(INDEX_RELOAD, e)))?;
        self.opstamp.store(opstamp, Ordering::Relaxed);
        self.dirty.store(false, Ordering::Release);
        Ok(())
    }

    /// Legge le impronte dal manifest, ma solo se parla della stessa epoca
    /// dell'indice (vedi [`Manifest`]). Nel dubbio: nessuna impronta, cioè
    /// tutto verrà reindicizzato.
    fn load_manifest(&mut self, host: &dyn HostApi) -> Result<(), PluginError> {
        // Un errore di lettura dello storage lo si segnala (l'indice
        // reindicizzerà tutto); un manifest assente, illeggibile o di
        // un'altra epoca è invece il caso normale, e non è un errore.
        let Some(raw) = host.data_read(MANIFEST)? else {
            return Ok(());
        };
        let Ok(manifest) = serde_json::from_slice::<Manifest>(&raw) else {
            return Ok(());
        };
        if manifest.schema_version != SCHEMA_VERSION
            || manifest.opstamp != self.opstamp.load(Ordering::Relaxed)
        {
            return Ok(());
        }
        self.fingerprints = manifest
            .docs
            .into_iter()
            .map(|(id, h)| (DocId::new(id), h))
            .collect();
        // Solo le revisioni di ciò che risulta indicizzato: una revisione senza
        // il documento a cui appartiene non è un'informazione parziale, è una
        // risposta sbagliata a `up_to_date` che aspetta di essere data.
        self.sources = manifest
            .sources
            .into_iter()
            .map(|(id, r)| (DocId::new(id), Revision::new(r)))
            .filter(|(id, _)| self.fingerprints.contains_key(id))
            .collect();
        self.manifest_at = Some(manifest.opstamp);
        Ok(())
    }

    /// Prende nota di **che revisione** è il documento appena indicizzato,
    /// consumando ciò che la domanda del kernel aveva dichiarato.
    ///
    /// Nessuna dichiarazione = si dimentica quella di prima. È la sola scelta
    /// che non mente: tenerla vorrebbe dire attribuire al testo di adesso la
    /// revisione del testo di allora, e alla riapertura saltare un documento
    /// modificato.
    fn note_source(&mut self, id: &DocId) {
        match self.announced.lock().expect("mutex").remove(id) {
            Some(revision) => self.sources.insert(id.clone(), revision),
            None => self.sources.remove(id),
        };
    }

    /// Dimentica tutto di un documento: l'impronta del modello, quella del
    /// sorgente e la dichiarazione che era in volo. Le tre insieme, perché una
    /// sola che sopravvivesse alle altre sarebbe una promessa senza il
    /// documento dietro.
    fn forget(&mut self, id: &DocId) {
        self.fingerprints.remove(id);
        self.sources.remove(id);
        self.announced.lock().expect("mutex").remove(id);
    }

    /// Rende durevoli le impronte, se quelle su disco non sono già le nostre.
    ///
    /// Il manifest si scrive DOPO il commit e cita il suo opstamp: se qualcosa
    /// va storto qui, alla riapertura le impronte risulteranno di un'altra
    /// epoca e si reindicizzerà — mai il contrario. E se non c'è niente di
    /// nuovo non si scrive: è ciò che rende osservabile «riaprire un vault
    /// immutato non produce scritture».
    fn persist(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let opstamp = self.opstamp.load(Ordering::Relaxed);
        if self.manifest_at == Some(opstamp) {
            return Ok(());
        }
        let manifest = Manifest {
            schema_version: SCHEMA_VERSION,
            opstamp,
            docs: self
                .fingerprints
                .iter()
                .map(|(id, h)| (id.as_str().to_string(), *h))
                .collect(),
            sources: self
                .sources
                .iter()
                .map(|(id, r)| (id.as_str().to_string(), r.0.clone()))
                .collect(),
        };
        let raw = serde_json::to_vec(&manifest)
            .map_err(|e| PluginError::Internal(motivo(MANIFEST_WRITE, e)))?;
        host.data_write(MANIFEST, &raw)?;
        self.manifest_at = Some(opstamp);
        Ok(())
    }

    /// La ricerca vera: l'albero della query, tradotto, e la finestra.
    ///
    /// La finestra si applica **alla sorgente** — `offset`/`limit` vanno al
    /// collector di tantivy, non a un `Vec` già costruito — ed è la ragione per
    /// cui un indice pagina meglio di chi lo interroga: la pagina 40 non costa
    /// come le prime 40 messe insieme. `total` arriva dal collector `Count`
    /// sulla stessa query, così chi disegna può scrivere "1-20 di 4321".
    ///
    /// Prima qui arrivava una **stringa**, e finiva dritta nel `QueryParser` di
    /// tantivy: la sintassi di ricerca che l'utente digitava era quella di una
    /// dipendenza, e un errore di parsing di tantivy diventava «Query
    /// incompleta» nella shell. Adesso arriva un albero, e questo modulo lo
    /// **traduce**: la stringa libera sopravvive solo dentro la foglia di testo,
    /// dove è quello che è — dei termini da cercare.
    fn search(
        &self,
        matching: &QueryExpr,
        page: Option<Page>,
        excerpts: Excerpts,
    ) -> Result<Paged<DocumentMatch>, PluginError> {
        // Chi interroga vede le proprie scritture, anche senza flush. È la sola
        // riga di questa funzione che possa fermarsi ad aspettare qualcuno, e
        // solo se c'è davvero una scrittura in sospeso (vedi `commit`).
        self.commit()?;
        let f = self.fields;
        let mut text_parts: Vec<Box<dyn Query>> = Vec::new();
        let query = self.translate(matching, &mut text_parts)?;
        // Una ricerca senza termini non è "tutto il vault" solo perché la
        // stringa è vuota: se l'albero non seleziona niente, non seleziona
        // niente — ed è il pianificatore a sapere se il resto della domanda ha
        // altri rami.
        let Some(query) = query else {
            return Ok(Paged::all(Vec::new()));
        };
        let searcher = self.reader.searcher();

        let total = searcher
            .search(&*query, &tantivy::collector::Count)
            .map_err(|e| PluginError::Internal(motivo(COUNT, e)))?;
        let (offset, limit) = match page {
            // Senza finestra si restituisce tutto ciò che combacia: il tetto è
            // il conteggio, non un numero inventato qui.
            None => (0usize, total),
            Some(p) => (p.offset as usize, p.limit as usize),
        };
        if limit == 0 || offset >= total {
            return Ok(Paged {
                items: Vec::new(),
                offset: offset as u32,
                total: total as u32,
            });
        }

        // `with_limit` va in panico su 0 — intercettato sopra.
        let collector = tantivy::collector::TopDocs::with_limit(limit)
            .and_offset(offset)
            .order_by_score();
        let top = searcher
            .search(&*query, &collector)
            .map_err(|e| PluginError::Internal(motivo(SEARCH, e)))?;

        // La **rilevanza** ce l'ha chi ha una foglia di testo, e solo lui:
        // evidenziare la cartella o il tag per cui una nota è stata selezionata
        // non vuol dire niente, e `tipo: progetto` non è più vero su una nota
        // che su un'altra. Si decide qui perché `text_parts` finisce dentro il
        // generatore, e perché non dipende dagli estratti: il punteggio serve a
        // **ordinare**, e ordinare è ciò che si fa prima di sapere quale pagina
        // resta.
        let scored = !text_parts.is_empty();
        // Gli estratti invece si generano solo se qualcuno li ha chiesti
        // (§21.9). Non è una micro-ottimizzazione: senza finestra — che è come
        // chiede il pianificatore, perché l'ordine della risposta è del
        // contratto e non di tantivy — questa riga vale un estratto per **ogni**
        // documento che combacia. Su duemila note e un termine comune erano
        // duemila estratti generati per mostrarne venti, cioè i ventuno
        // millisecondi che la §21.9 non sapeva spiegare.
        let mut snippets = match !scored || !excerpts.wanted() {
            true => None,
            false => {
                let text_query: Box<dyn Query> = Box::new(BooleanQuery::new(
                    text_parts
                        .into_iter()
                        .map(|q| (Occur::Should, q))
                        .collect::<Vec<_>>(),
                ));
                let mut gen = SnippetGenerator::create(&searcher, &*text_query, f.body)
                    .map_err(|e| PluginError::Internal(motivo(SNIPPET, e)))?;
                gen.set_max_num_chars(SNIPPET_CHARS);
                Some(gen)
            }
        };

        let mut hits = Vec::with_capacity(top.len());
        for (score, address) in top {
            let doc: TantivyDocument = searcher
                .doc(address)
                .map_err(|e| PluginError::Internal(motivo(DOC_READ, e)))?;
            let Some(id) = doc.get_first(f.doc_id).and_then(|v| v.as_str()) else {
                continue;
            };
            let mut hit = DocumentMatch::of(DocId::new(id));
            if scored {
                hit.score = Some(score);
            }
            if let Some(snippets) = snippets.as_mut() {
                let body = doc.get_first(f.body).and_then(|v| v.as_str()).unwrap_or("");
                let snippet = snippets.snippet_from_doc(&doc);
                let (text, highlights) = if snippet.fragment().is_empty() {
                    // Match sul solo titolo o sui soli tag: nessun frammento da
                    // evidenziare, ma un incipit è meglio di una riga vuota.
                    (head_of(body, SNIPPET_CHARS), Vec::new())
                } else {
                    let ranges = snippet
                        .highlighted()
                        .iter()
                        .map(|r| Span::new(r.start, r.end))
                        .collect();
                    (snippet.fragment().to_string(), ranges)
                };
                hit.snippet = Some(text);
                hit.highlights = highlights;
            }
            hits.push(hit);
        }
        Ok(Paged {
            items: hits,
            offset: offset as u32,
            total: total as u32,
        })
    }

    /// L'albero del contratto → l'albero di tantivy.
    ///
    /// `text_parts` raccoglie le sole foglie di testo: servono al generatore di
    /// snippet, che deve evidenziare ciò che l'utente ha cercato e non i filtri
    /// che gli stanno intorno.
    ///
    /// `None` significa «questa espressione non seleziona niente», che non è la
    /// stessa cosa di «tutto»: una clausola con una foglia di testo vuota è
    /// vuota, mentre un'espressione senza clausole è tutto il vault.
    fn translate(
        &self,
        expr: &QueryExpr,
        text_parts: &mut Vec<Box<dyn Query>>,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        if expr.any.is_empty() {
            return Ok(Some(Box::new(AllQuery)));
        }
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        for clause in &expr.any {
            if let Some(q) = self.translate_clause(clause, text_parts)? {
                clauses.push((Occur::Should, q));
            }
        }
        match clauses.len() {
            0 => Ok(None),
            1 => Ok(Some(clauses.pop().expect("ce n'è una").1)),
            _ => Ok(Some(Box::new(BooleanQuery::new(clauses)))),
        }
    }

    fn translate_clause(
        &self,
        clause: &QueryClause,
        text_parts: &mut Vec<Box<dyn Query>>,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        if clause.all.is_empty() {
            return Ok(Some(Box::new(AllQuery)));
        }
        let mut parts: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        let mut only_negated = true;
        for literal in &clause.all {
            let translated = self.translate_predicate(&literal.predicate, text_parts)?;
            match (literal.negated, translated) {
                // Un letterale positivo che non seleziona niente svuota l'AND.
                (false, None) => return Ok(None),
                (false, Some(q)) => {
                    only_negated = false;
                    parts.push((Occur::Must, q));
                }
                // Negare ciò che non seleziona niente non toglie niente.
                (true, None) => {}
                (true, Some(q)) => parts.push((Occur::MustNot, q)),
            }
        }
        if parts.is_empty() {
            return Ok(Some(Box::new(AllQuery)));
        }
        if only_negated {
            // Un booleano di soli `MustNot` non ha da cosa sottrarre.
            parts.push((Occur::Must, Box::new(AllQuery)));
        }
        Ok(Some(Box::new(BooleanQuery::new(parts))))
    }

    fn translate_predicate(
        &self,
        predicate: &QueryPredicate,
        text_parts: &mut Vec<Box<dyn Query>>,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        let f = self.fields;
        match predicate {
            QueryPredicate::Text(text) => {
                let Some(q) = self.text_query(text)? else {
                    return Ok(None);
                };
                text_parts.push(q.box_clone());
                Ok(Some(q))
            }
            QueryPredicate::Tag { name, descendants } => {
                let field = if *descendants { f.tag_paths } else { f.tags };
                Ok(Some(term_query(field, &canonical_tag(name))))
            }
            QueryPredicate::Folder { path, descendants } => {
                let field = if *descendants {
                    f.folder
                } else {
                    f.folder_exact
                };
                Ok(Some(term_query(field, path.trim_end_matches('/'))))
            }
            QueryPredicate::Docs { docs } => {
                if docs.is_empty() {
                    return Ok(None);
                }
                Ok(Some(Box::new(BooleanQuery::new(
                    docs.iter()
                        .map(|d| (Occur::Should, term_query(f.doc_id, d.as_str())))
                        .collect::<Vec<_>>(),
                ))))
            }
            // Il routing non manda qui ciò che non è stato dichiarato: se
            // succede è un errore del kernel, non una domanda malposta.
            other => Err(PluginError::Unserved(Text::message(
                UNSERVED_LEAF,
                vec![Arg::text(WHAT, format!("{other:?}"))],
            ))),
        }
    }

    /// La foglia di testo: dei **termini**, non un linguaggio.
    ///
    /// I termini si ricavano col tokenizer del campo — lo stesso che ha
    /// indicizzato il documento — invece che spezzando la stringa a mano: è
    /// l'unico modo perché «Rust» trovi `rust` senza replicare qui le regole
    /// dell'analizzatore.
    fn text_query(&self, text: &TextQuery) -> Result<Option<Box<dyn Query>>, PluginError> {
        let f = self.fields;
        // Una sola lettura per query, e non una per campo: i quattro pesi vanno
        // presi nello stesso istante, o una query lanciata mentre qualcuno
        // muove uno slider potrebbe pesare il nome con la taratura nuova e gli
        // heading con quella vecchia — un ordinamento che non corrisponde a
        // nessuna configurazione mai esistita.
        let w = *self.weights.read().expect("rwlock");
        let wanted: Vec<(Field, f32)> = if text.fields.is_empty() {
            vec![
                (f.page_name, w.name),
                (f.headings, w.heading),
                (f.body, w.body),
                (f.tags, w.tags),
            ]
        } else {
            text.fields
                .iter()
                .map(|field| match field {
                    TextField::Name => (f.page_name, w.name),
                    TextField::Body => (f.body, w.body),
                    TextField::Tags => (f.tags, w.tags),
                    TextField::Heading => (f.headings, w.heading),
                })
                .collect()
        };
        if text.text.trim().is_empty() {
            return Ok(None);
        }
        // La **tolleranza è dicibile e non ancora onorata**, ed è così di
        // proposito (decisione 0050): la forma entra nel contratto prima del
        // comportamento, perché la forma scade col freeze di M4 e il fuzzy no.
        // Il `match` è esaustivo apposta — il giorno che `Typos` diventa una
        // `FuzzyTermQuery`, il compilatore porta chi lo scrive esattamente qui,
        // invece di lasciare il caso assorbito da un `_`.
        match text.tolerance {
            // Ciò che il motore fa oggi, ed è l'unico verso in cui questo
            // silenzio è innocuo: chi ha chiesto l'esattezza la ottiene.
            TextTolerance::Exact => {}
            // Chi ha chiesto di essere indovinato riceve una ricerca esatta —
            // meno risultati, non risultati sbagliati. Il verso opposto (essere
            // tolleranti senza che nessuno lo abbia chiesto) è quello che la
            // §21.1 chiama un difetto, perché su questo canale ci passano anche
            // le scritture.
            TextTolerance::Typos => {}
        }

        let mut per_field: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        let mut per_term: Vec<Vec<(Occur, Box<dyn Query>)>> = Vec::new();
        for (field, boost) in wanted {
            let terms = self.terms_of(field, &text.text)?;
            if terms.is_empty() {
                continue;
            }
            // L'ultimo termine è quello che si sta ancora scrivendo, e solo
            // lui: `arch async` cerca `async` per intero e `arch` come
            // prefisso, cioè quello che ha sotto le dita chi digita.
            let last = terms.len() - 1;
            match text.mode {
                // La frase: la sequenza esatta, in un campo alla volta. Con un
                // termine solo non c'è nessuna sequenza da rispettare, e
                // `PhraseQuery` va in panico: è un termine.
                TextMode::Phrase => {
                    let q: Box<dyn Query> = match (terms.len(), text.partial_last_term) {
                        (1, false) => Box::new(TermQuery::new(
                            terms[0].clone(),
                            IndexRecordOption::WithFreqs,
                        )),
                        (1, true) => self.prefix_query(field, &terms[0])?,
                        // Una frase il cui ultimo termine è incompleto è
                        // esattamente ciò che `PhrasePrefixQuery` esprime: la
                        // sequenza, e in coda un prefisso.
                        (_, true) => Box::new(PhrasePrefixQuery::new(terms)),
                        (_, false) => Box::new(PhraseQuery::new(terms)),
                    };
                    per_field.push((Occur::Should, boosted(q, boost)));
                }
                // I termini: ognuno deve comparire (in qualche campo), che è
                // ciò che si aspetta chi digita due parole.
                TextMode::Terms => {
                    for (at, term) in terms.into_iter().enumerate() {
                        let q: Box<dyn Query> = if at == last && text.partial_last_term {
                            self.prefix_query(field, &term)?
                        } else {
                            Box::new(TermQuery::new(term, IndexRecordOption::WithFreqs))
                        };
                        if per_term.len() <= at {
                            per_term.push(Vec::new());
                        }
                        per_term[at].push((Occur::Should, boosted(q, boost)));
                    }
                }
            }
        }

        match text.mode {
            TextMode::Phrase => match per_field.len() {
                0 => Ok(None),
                _ => Ok(Some(Box::new(BooleanQuery::new(per_field)))),
            },
            TextMode::Terms => {
                if per_term.is_empty() {
                    return Ok(None);
                }
                let all: Vec<(Occur, Box<dyn Query>)> = per_term
                    .into_iter()
                    .map(|alternatives| {
                        let q: Box<dyn Query> = Box::new(BooleanQuery::new(alternatives));
                        (Occur::Must, q)
                    })
                    .collect();
                Ok(Some(Box::new(BooleanQuery::new(all))))
            }
        }
    }

    /// Un termine **incompleto**: tutto ciò che comincia così.
    ///
    /// È un automa sul dizionario dei termini — cioè un intervallo aperto nella
    /// term dictionary, che è il costo vero di una ricerca mentre si digita
    /// (§21.9 lo dice per iscritto: un prefisso apre un intervallo). Il testo
    /// arriva già passato dal tokenizer del campo, quindi qui non ci sono
    /// maiuscole né punteggiatura da normalizzare; l'escape c'è lo stesso,
    /// perché ciò che entra in un motore di regex viene da chi digita e non da
    /// noi.
    fn prefix_query(&self, field: Field, term: &Term) -> Result<Box<dyn Query>, PluginError> {
        let value = term.value();
        let pattern = format!("{}.*", escape_regex(value.as_str().unwrap_or_default()));
        let query = RegexQuery::from_pattern(&pattern, field)
            .map_err(|e| PluginError::Internal(motivo(TOKENIZER, e)))?;
        Ok(Box::new(query))
    }

    /// I termini di un testo secondo il tokenizer del campo. Per un campo
    /// `STRING` (i tag) il tokenizer è `raw`, e il termine è la stringa intera —
    /// che è esattamente ciò che serve.
    fn terms_of(&self, field: Field, text: &str) -> Result<Vec<Term>, PluginError> {
        let mut analyzer = self
            .index
            .tokenizer_for_field(field)
            .map_err(|e| PluginError::Internal(motivo(TOKENIZER, e)))?;
        let mut terms = Vec::new();
        let mut stream = analyzer.token_stream(text);
        while let Some(token) = stream.next() {
            terms.push(Term::from_field_text(field, &token.text));
        }
        Ok(terms)
    }
}

fn term_query(field: Field, value: &str) -> Box<dyn Query> {
    Box::new(TermQuery::new(
        Term::from_field_text(field, value),
        IndexRecordOption::Basic,
    ))
}

/// I metacaratteri di regex resi letterali.
///
/// Non ci sono liste di caratteri «pericolosi» da tenere aggiornate: tutto ciò
/// che non è alfanumerico si scrive con la fuga davanti, che è sempre lecito e
/// non richiede di sapere quali metacaratteri conosca il motore di oggi.
fn escape_regex(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 4);
    for c in text.chars() {
        if !c.is_alphanumeric() {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn boosted(query: Box<dyn Query>, boost: f32) -> Box<dyn Query> {
    if boost == 1.0 {
        query
    } else {
        Box::new(BoostQuery::new(query, boost))
    }
}

/// I primi `max` caratteri di `text`, troncati su un confine di carattere e
/// senza spezzare l'ultima parola quando si può evitare.
fn head_of(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut = text
        .char_indices()
        .nth(max)
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    let head = &text[..cut];
    let trimmed = match head.rfind(char::is_whitespace) {
        Some(sp) if sp > cut / 2 => &head[..sp],
        _ => head,
    };
    format!("{}…", trimmed.trim_end())
}

impl IndexProvider for SearchIndex {
    /// Tre foglie, nessuna famiglia.
    ///
    /// Il testo è l'unica che sa solo lui — il kernel non indicizza il corpo —
    /// mentre tag e cartelle le sa anche il kernel: dichiararle **non** è una
    /// rivendicazione contro di lui, è ciò che permette al pianificatore di
    /// consegnare a questo indice una clausola intera (`testo AND cartella`)
    /// invece di spezzarla e intersecare a mano. È il filtro dentro il motore
    /// della decisione 0005, e adesso è il motore a dichiarare di saperlo fare.
    fn routes(&self) -> Vec<QueryRoute> {
        vec![
            QueryRoute::Predicate(PredicateKind::Text),
            QueryRoute::Predicate(PredicateKind::Tag),
            QueryRoute::Predicate(PredicateKind::Folder),
        ]
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        // I pesi **prima** del manifest, e senza `?`: se le impostazioni non si
        // leggono valgono i default (vedi [`FieldWeights::read`]), mentre un
        // manifest che non si legge è una diagnostica vera. Sono due errori di
        // gravità diversa e sarebbe sbagliato farli cadere insieme.
        *self.weights.write().expect("rwlock") = FieldWeights::read(host);
        self.load_manifest(host)
    }

    /// Cosa è già a posto, guardando solo l'anagrafe (§14.2).
    ///
    /// La domanda che mancava: prima il kernel leggeva e parsava l'intero vault
    /// e *poi* consegnava tutto a chi ce l'aveva già. Qui si risponde senza
    /// aprire un file, confrontando la revisione del sorgente che il kernel
    /// dichiara con quella da cui è stato ricavato ciò che sta nell'indice.
    ///
    /// Tre cautele, tutte nello stesso verso — dire «ce l'ho» a sproposito
    /// farebbe **saltare** un documento, cioè mentire in silenzio, mentre dire
    /// «mandamelo» di troppo costa una rilettura:
    ///
    /// - senza impronta dichiarata non si risponde: chi non sa di che revisione
    ///   è un file non può sapere se è la sua;
    /// - la revisione deve stare accanto a un documento davvero indicizzato
    ///   (`fingerprints`), e le due mappe arrivano dallo stesso manifest, che è
    ///   già respinto in blocco se cita un'altra epoca o un altro schema;
    /// - ciò che non è un documento non è affar suo. Il kernel oggi manda solo
    ///   documenti, ma un provider che ci contasse leggerebbe il contratto più
    ///   stretto di com'è scritto.
    fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> {
        let mut announced = self.announced.lock().expect("mutex");
        announced.clear();
        let mut current = Vec::new();
        for entry in entries {
            let (EntryKind::Document, Some(revision)) = (entry.kind, entry.fingerprint.as_ref())
            else {
                continue;
            };
            if self.sources.get(&entry.id) == Some(revision)
                && self.fingerprints.contains_key(&entry.id)
            {
                current.push(entry.id.clone());
                // **Non** si dichiara ciò che si è appena detto di avere: quel
                // documento non arriverà, e una dichiarazione che resta lì ad
                // aspettare verrebbe raccolta dalla prima consegna successiva —
                // cioè dal primo salvataggio a sessione aperta, che porta un
                // testo nuovo e si prenderebbe la revisione di quello vecchio.
                // Se poi arrivasse lo stesso (un altro indice non ce l'aveva),
                // si resta senza revisione e lo si rilegge alla prossima
                // apertura: il verso sicuro dello sbaglio.
                continue;
            }
            announced.insert(entry.id.clone(), revision.clone());
        }
        current
    }

    /// **Il posto in cui questo indice sapeva di perdere un documento e non
    /// aveva come dirlo** (§20.1). Il commento che c'è sotto — «mentire è
    /// peggio che perdere il documento» — era già qui prima della decisione
    /// 0051, ed era tutto ciò che si poteva fare: il ripiego (dimenticare
    /// l'impronta, così il prossimo passaggio riprova) funziona solo alla
    /// riapertura del vault, perché `reindex` è l'unico percorso che rialimenta
    /// un documento **immutato**. Per tutta la sessione corrente quella nota non
    /// era nella ricerca, e «nessun risultato» era indistinguibile da «nessuna
    /// corrispondenza».
    ///
    /// Adesso la stessa riga produce un [`IndexLoss`] che nomina il documento,
    /// e il ripiego resta: si riprova alla riapertura **e** lo si dice adesso.
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        let mut lost = Vec::new();
        for doc in docs {
            let print = fingerprint(doc);
            // Contenuto identico a quello già indicizzato: non c'è niente da
            // fare in tantivy. È questo salto — non una scorciatoia all'avvio —
            // a rendere rapida la riapertura di un vault non toccato. La
            // revisione del sorgente si aggiorna lo stesso: un file può cambiare
            // senza che il modello cambi (una riga di frontmatter che nessuno
            // indicizza), e lasciarci quella vecchia vorrebbe dire farlo
            // rileggere per sempre.
            if self.fingerprints.get(&doc.id) == Some(&print) {
                self.note_source(&doc.id);
                continue;
            }
            // tantivy non aggiorna: si cancella il termine e si riscrive.
            let term = self.term_for(&doc.id);
            let td = self.tantivy_doc(doc);
            {
                let guard = self.writer.lock().expect("mutex");
                // Il writer è andato — chiuso (decisione 0028) o rotto — e in
                // entrambi i casi l'indice non è più affidabile: mentire è
                // peggio che perdere il documento. Si dimentica l'impronta, così
                // il prossimo passaggio riproverà.
                let Some(writer) = guard.as_ref() else {
                    drop(guard);
                    self.forget(&doc.id);
                    lost.push(IndexLoss::new(
                        doc.id.clone(),
                        PluginError::Internal(
                            "l'indice di ricerca non accetta più scritture: questo documento \
                             non è cercabile finché il vault non viene riaperto"
                                .into(),
                        ),
                    ));
                    continue;
                };
                writer.delete_term(term);
                if let Err(e) = writer.add_document(td) {
                    drop(guard);
                    self.forget(&doc.id);
                    lost.push(IndexLoss::new(
                        doc.id.clone(),
                        PluginError::Internal(
                            format!("l'indice di ricerca ha rifiutato il documento: {e}").into(),
                        ),
                    ));
                    continue;
                }
            }
            self.fingerprints.insert(doc.id.clone(), print);
            self.note_source(&doc.id);
            self.dirty.store(true, Ordering::Release);
        }
        lost
    }

    /// La perdita di segno opposto, e la più visibile: senza writer il termine
    /// **non** si cancella, quindi il documento resta cercabile pur essendo
    /// sparito dal vault — chi cerca lo trova e lo apre, e trova un file che
    /// non c'è.
    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        let mut lost = Vec::new();
        for id in ids {
            self.sources.remove(id);
            if self.fingerprints.remove(id).is_none() {
                continue;
            }
            let term = self.term_for(id);
            match self.writer.lock().expect("mutex").as_ref() {
                Some(writer) => {
                    writer.delete_term(term);
                    self.dirty.store(true, Ordering::Release);
                }
                None => lost.push(IndexLoss::new(
                    id.clone(),
                    PluginError::Internal(
                        "l'indice di ricerca non accetta più scritture: questo documento resta \
                         fra i risultati pur non esistendo più"
                            .into(),
                    ),
                )),
            }
        }
        lost
    }

    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        // Fine del giro d'apertura: le consegne che la domanda annunciava sono
        // arrivate tutte, e ciò che resta dichiarato è di un documento che non
        // è arrivato — un parse fallito, un file sparito fra la scansione e la
        // lettura. Tenerlo vorrebbe dire consegnarlo a chi passa dopo.
        self.announced.lock().expect("mutex").clear();

        let alive: std::collections::HashSet<&DocId> = ids.iter().collect();
        let dead: Vec<DocId> = self
            .fingerprints
            .keys()
            .filter(|id| !alive.contains(id))
            .cloned()
            .collect();
        if dead.is_empty() {
            return Vec::new();
        }
        let terms: Vec<Term> = dead.iter().map(|id| self.term_for(id)).collect();
        // Senza writer i morti restano dentro, e `forget` qui sotto toglierebbe
        // anche l'unica traccia che permette di riprovare: sono perdite, e sono
        // esattamente il caso che `reconcile` esiste per chiudere — ciò che è
        // sparito ad app chiusa.
        let mut lost = Vec::new();
        match self.writer.lock().expect("mutex").as_ref() {
            Some(writer) => {
                for term in terms {
                    writer.delete_term(term);
                }
                self.dirty.store(true, Ordering::Release);
            }
            None => {
                lost = dead
                    .iter()
                    .map(|id| {
                        IndexLoss::new(
                            id.clone(),
                            PluginError::Internal(
                                "l'indice di ricerca non accetta più scritture: questo documento \
                                 è stato cancellato ad app chiusa e resta fra i risultati"
                                    .into(),
                            ),
                        )
                    })
                    .collect();
            }
        }
        for id in &dead {
            self.forget(id);
        }
        lost
    }

    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.commit()?;
        self.persist(host)
    }

    /// Lascia andare la cartella: commit di ciò che resta, manifest, e **il
    /// writer restituito a tantivy** aspettando i suoi thread di merge.
    ///
    /// L'ultimo passo è ciò per cui il §9.2 chiedeva questa funzione. Un
    /// `IndexWriter` tiene un lock esclusivo sulla cartella dell'indice: finché
    /// è vivo, un'altra sessione sullo stesso vault non apre la ricerca —
    /// e `Index::writer` non fallisce subito, *aspetta*. Chi riapriva lo stesso
    /// vault trovava il proprio indice dietro il lock della sessione che se ne
    /// stava andando.
    ///
    /// Il `flush` che il kernel chiama prima ha già fatto commit e manifest;
    /// rifarli qui non costa niente (`dirty` è spento, il manifest cita
    /// l'opstamp corrente) e copre chi chiama `close` da solo.
    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.commit()?;
        self.persist(host)?;
        let Some(writer) = self.writer.lock().expect("mutex").take() else {
            // Già chiuso: chiudere due volte non è un errore, è un no-op — la
            // stessa regola di `data_remove`.
            return Ok(());
        };
        writer
            .wait_merging_threads()
            .map_err(|e| PluginError::Internal(motivo(INDEX_CLOSE, e)))
    }

    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
                excerpts,
            } => {
                // Il pianificatore non chiede a un indice ciò che l'indice non
                // sa fare: ordinare per una proprietà del frontmatter e
                // riempire le colonne è roba di chi il frontmatter ce l'ha in
                // cache. Se arrivasse comunque, rispondere ignorandolo sarebbe
                // mentire in silenzio.
                if sort.is_some() || !select.is_none() {
                    return Err(PluginError::BadArgs(Text::key(SELECT_UNSUPPORTED)));
                }
                Ok(IndexResult::Documents(
                    self.search(&matching, page, excerpts)?,
                ))
            }
            // Tutto il resto ha già una fonte di verità nel kernel — grafo,
            // modelli parsati, frontmatter — e non si duplica qui: due verità
            // sullo stesso dato divergono, e la seconda mente in silenzio.
            // Prima questo `match` doveva dirlo variante per variante con dei
            // `BadArgs`, perché era così che si scopriva chi servisse cosa;
            // adesso il routing è dichiarato e questo ramo è irraggiungibile.
            other => Err(PluginError::Unserved(Text::message(
                UNSERVED_FAMILY,
                vec![Arg::text(WHAT, format!("{:?}", other.kind()))],
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// Chi rinfresca i pesi (§21.6)
// ---------------------------------------------------------------------------

/// L'`EventHandler` che tiene i pesi di [`SearchIndex`] allineati alle
/// impostazioni.
///
/// # Perché è un secondo oggetto e non un metodo dell'indice
///
/// Perché il contratto lo impone, ed è giusto che lo imponga:
/// [`IndexProvider`] non riceve eventi e [`IndexProvider::query`] non riceve un
/// host, quindi l'unico posto in cui un indice può *sapere* che una chiave è
/// cambiata è un handler. Registrarne uno accanto al provider non è una
/// scorciatoia interna alle feature ufficiali: è esattamente ciò che farebbe un
/// plugin di terzi che volesse un indice configurabile, e il bundle della
/// ricerca passa dalle stesse due registrazioni.
///
/// # L'evento non porta il valore, e chi reagisce rilegge
///
/// [`Event::SettingChanged`] dice **quale** chiave è cambiata e in che livello,
/// non il valore nuovo — è una scelta di progetto (vedi il contratto in
/// `frontend/src/host/contract.ts`), e la ragione è che un evento che portasse
/// il valore sarebbe una seconda fonte di verità che arriva in ritardo. Qui si
/// rilegge, e si rilegge **tutto**: quattro `setting()` su un file già in
/// memoria costano meno del ramo che deciderebbe quale delle quattro toccare.
pub struct SearchSettings {
    weights: Arc<RwLock<FieldWeights>>,
}

impl EventHandler for SearchSettings {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::SettingChanged])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        // Il **prefisso**, e non i quattro nomi: il giorno che un quinto campo
        // diventa indicizzabile, la sua chiave arriva qui senza che nessuno si
        // ricordi di aggiungerla a un elenco.
        if let Event::SettingChanged { key, .. } = &notice.event {
            if key.starts_with(BOOST_PREFIX) {
                *self.weights.write().expect("rwlock") = FieldWeights::read(host);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_sdk::testing::MemoryHost;
    // Le famiglie che il doppio serve a questi test: dal §7.1 un host è la
    // somma di dieci trait, e i metodi di un trait si vedono se il trait è in
    // scope — anche quando l'oggetto li ha tutti.
    use camino::Utf8PathBuf;
    use fub_abi::model::Tag;
    use fub_abi::query::QueryLiteral;
    use fub_abi::settings::{SettingScope, SettingValue};
    use fub_abi::traits::PropertySelect;
    use fub_abi::traits::{DataRead, DataWrite, SettingsWrite};

    fn doc(id: &str, text: &str) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new(id));
        m.text = text.to_string();
        m
    }

    fn tmp() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("index")).expect("utf8");
        (dir, path)
    }

    /// Apre l'indice **come lo apre il kernel**: costruzione e poi `activate`
    /// con un host. Chiamarlo così nei test è il punto: un indice che
    /// funzionasse solo senza attivazione non sarebbe l'indice che gira.
    fn open(path: &Utf8Path, host: &mut MemoryHost) -> SearchIndex {
        let mut idx = SearchIndex::open_dir(path).expect("apertura indice");
        idx.activate(host).expect("attivazione indice");
        idx
    }

    /// Un indice nuovo con il suo host: il caso di gran lunga più comune.
    fn fresh(path: &Utf8Path) -> (SearchIndex, MemoryHost) {
        let mut host = MemoryHost::new();
        let idx = open(path, &mut host);
        (idx, host)
    }

    fn search(idx: &SearchIndex, q: &str) -> Vec<DocumentMatch> {
        page_of(idx, text(q), Some(Page::first(10))).items
    }

    /// Una clausola sola: i letterali in AND, che è la forma in cui il
    /// pianificatore consegna una clausola a questo indice.
    fn clause(literals: Vec<QueryLiteral>) -> QueryExpr {
        QueryExpr {
            any: vec![QueryClause { all: literals }],
        }
    }

    fn lit(predicate: QueryPredicate) -> QueryLiteral {
        QueryLiteral {
            negated: false,
            predicate,
        }
    }

    fn text(q: &str) -> QueryExpr {
        clause(vec![lit(QueryPredicate::Text(TextQuery::terms(q)))])
    }

    /// Il testo con l'ultimo termine **incompleto**: la forma che manda una
    /// casella mentre si digita (§21.2).
    fn text_parziale(q: &str) -> QueryExpr {
        clause(vec![lit(QueryPredicate::Text(
            TextQuery::terms(q).while_typing(),
        ))])
    }

    fn tag(name: &str, descendants: bool) -> QueryExpr {
        clause(vec![lit(QueryPredicate::Tag {
            name: name.to_string(),
            descendants,
        })])
    }

    /// L'interrogazione con la finestra, cioè la firma vera del contratto.
    fn page_of(idx: &SearchIndex, matching: QueryExpr, page: Option<Page>) -> Paged<DocumentMatch> {
        match idx.query(IndexQuery::Documents {
            matching,
            sort: None,
            select: PropertySelect::None,
            page,
            excerpts: Excerpts::Attach,
        }) {
            Ok(IndexResult::Documents(hits)) => hits,
            other => panic!("attesi documenti, trovato {other:?}"),
        }
    }

    /// Il manifest come lo vede lo storage del plugin.
    fn manifest_of(host: &MemoryHost) -> Manifest {
        let raw = host
            .data_read(MANIFEST)
            .expect("storage leggibile")
            .expect("il manifest c'è");
        serde_json::from_slice(&raw).expect("manifest valido")
    }

    fn put_manifest(host: &mut MemoryHost, m: &Manifest) {
        host.data_write(MANIFEST, &serde_json::to_vec(m).unwrap())
            .unwrap();
    }

    #[test]
    fn finds_by_body_and_reports_highlights() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "a.md",
            "il gatto dorme sul tappeto",
        )));
        let _ =
            idx.on_documents_indexed(std::slice::from_ref(&doc("b.md", "il cane abbaia forte")));

        let hits = search(&idx, "gatto");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc, DocId::new("a.md"));
        // Lo snippet è testo puro e gli highlight cadono sul termine cercato.
        assert!(!hits[0].snippet.as_deref().unwrap_or_default().contains('<'));
        let h = hits[0].highlights.first().expect("un highlight");
        let snippet = hits[0].snippet.as_deref().expect("un match di testo");
        assert_eq!(&snippet[h.start..h.end], "gatto");
    }

    #[test]
    fn page_name_outranks_body() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "nota/Rust.md",
            "appunti sparsi di programmazione",
        )));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "altro.md",
            "rust rust rust rust rust rust",
        )));

        let hits = search(&idx, "rust");
        assert_eq!(hits.len(), 2);
        assert_eq!(
            hits[0].doc,
            DocId::new("nota/Rust.md"),
            "il titolo pesa di più"
        );
    }

    // -----------------------------------------------------------------------
    // I pesi dei campi sono un'impostazione (§21.6)
    // -----------------------------------------------------------------------

    /// Un host che dichiara le quattro chiavi come le dichiara il montaggio, e
    /// dà a una di esse il valore che il test vuole provare.
    fn host_con_peso(key: &str, valore: f64) -> MemoryHost {
        let mut host = MemoryHost::new();
        for spec in settings() {
            host = if spec.key == key {
                host.con_valore(spec, SettingValue::Number(valore))
            } else {
                host.con_impostazione(spec)
            };
        }
        host
    }

    /// I due documenti di `page_name_outranks_body`: uno vince per il titolo,
    /// l'altro per la ripetizione nel corpo. È la coppia giusta per provare un
    /// peso, perché l'esito dipende **solo** da quello.
    fn titolo_contro_corpo(idx: &mut SearchIndex) {
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "nota/Rust.md",
            "appunti sparsi di programmazione",
        )));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "altro.md",
            "rust rust rust rust rust rust",
        )));
    }

    #[test]
    fn i_pesi_arrivano_dalle_impostazioni() {
        let (_g, path) = tmp();
        // Il titolo azzerato: la nota *intitolata* Rust non ha più il vantaggio
        // che le dava il default, e passa dietro a chi ripete il termine nel
        // corpo. È l'esatto rovescio di `page_name_outranks_body`, e i due test
        // insieme dicono che quella riga non è più una legge del motore.
        let mut host = host_con_peso(BOOST_NAME_KEY, 0.0);
        let mut idx = open(&path, &mut host);
        assert_eq!(idx.weights().name, 0.0, "letto in `activate`");
        titolo_contro_corpo(&mut idx);

        let hits = search(&idx, "rust");
        assert_eq!(hits.len(), 2, "zero non esclude: la nota si trova ancora");
        assert_eq!(
            hits[0].doc,
            DocId::new("altro.md"),
            "col peso del titolo a zero vince chi ripete nel corpo"
        );
    }

    #[test]
    fn una_chiave_mai_scritta_vale_il_suo_default() {
        let (_g, path) = tmp();
        // Nessuna dichiarazione affatto: è il caso di un host che di
        // impostazioni non sa niente, e la ricerca deve partire lo stesso. Un
        // motore che si rifiutasse di pesare perché un numero non si legge
        // sarebbe un vault senza ricerca per una chiave assente.
        let (idx, _host) = fresh(&path);
        assert_eq!(idx.weights(), FieldWeights::default());
    }

    #[test]
    fn i_pesi_si_aggiornano_a_vault_aperto() {
        let (_g, path) = tmp();
        let mut host = host_con_peso(BOOST_NAME_KEY, PAGE_NAME_BOOST as f64);
        let mut idx = open(&path, &mut host);
        titolo_contro_corpo(&mut idx);
        assert_eq!(
            search(&idx, "rust")[0].doc,
            DocId::new("nota/Rust.md"),
            "col default vince il titolo"
        );

        // Qualcuno muove lo slider. L'evento **non porta il valore** — per
        // progetto chi reagisce rilegge — quindi il valore va cambiato
        // nell'host, e poi si annuncia.
        let mut handler = idx.settings_handler();
        host.set_setting(BOOST_NAME_KEY, SettingValue::Number(0.0))
            .expect("scrittura");
        handler
            .handle(
                &Notice::of(Event::SettingChanged {
                    key: BOOST_NAME_KEY.into(),
                    scope: SettingScope::Vault,
                }),
                &mut host,
            )
            .expect("rilettura");

        assert_eq!(idx.weights().name, 0.0, "il provider ha visto il cambio");
        assert_eq!(
            search(&idx, "rust")[0].doc,
            DocId::new("altro.md"),
            "e l'ordine è cambiato senza riaprire il vault"
        );
    }

    #[test]
    fn una_chiave_che_non_e_un_peso_non_fa_rileggere() {
        let (_g, path) = tmp();
        let mut host = host_con_peso(BOOST_NAME_KEY, PAGE_NAME_BOOST as f64);
        let idx = open(&path, &mut host);
        let mut handler = idx.settings_handler();

        // Il tema cambia mille volte in una sessione, e la ricerca non deve
        // rileggere quattro chiavi ogni volta. Il presidio guarda l'effetto e
        // non il numero di letture — che sarebbe un dettaglio interno — ma il
        // ramo che protegge è quello del prefisso.
        host.set_setting(BOOST_NAME_KEY, SettingValue::Number(0.0))
            .expect("scrittura");
        handler
            .handle(
                &Notice::of(Event::SettingChanged {
                    key: "appearance.theme".into(),
                    scope: SettingScope::Vault,
                }),
                &mut host,
            )
            .expect("nessuna rilettura");
        assert_eq!(
            idx.weights().name,
            PAGE_NAME_BOOST,
            "un'altra chiave non trascina i pesi con sé"
        );
    }

    #[test]
    fn lo_schema_dichiara_i_default_che_il_motore_usa() {
        // La duplicazione che questa voce ha tolto: prima i pesi erano costanti
        // cablate, e il banco ne teneva una copia con un commento che chiedeva
        // di non farle divergere. Adesso i default dello schema **sono** quelle
        // costanti, e se qualcuno ne cambiasse una sola questo test è il posto
        // in cui lo scopre.
        let d = FieldWeights::default();
        for (key, atteso) in [
            (BOOST_NAME_KEY, d.name),
            (BOOST_HEADING_KEY, d.heading),
            (BOOST_BODY_KEY, d.body),
            (BOOST_TAGS_KEY, d.tags),
        ] {
            let spec = settings()
                .into_iter()
                .find(|s| s.key == key)
                .unwrap_or_else(|| panic!("`{key}` non è dichiarata"));
            let SettingKind::Number { default, min, max } = spec.kind else {
                panic!("`{key}` non è un numero");
            };
            assert_eq!(default as f32, atteso, "`{key}`");
            assert_eq!(min, Some(BOOST_MIN));
            assert_eq!(max, Some(BOOST_MAX));
            assert!(
                spec.program_writable,
                "`{key}` è un profilo di vault scrivibile da un comando"
            );
        }
    }

    #[test]
    fn conjunction_by_default() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "rust asincrono")));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("b.md", "rust sincrono")));

        assert_eq!(search(&idx, "rust asincrono").len(), 1);
    }

    fn tagged(id: &str, body: &str, tags: &[&str]) -> DocumentModel {
        let mut m = doc(id, body);
        m.tags = tags
            .iter()
            .map(|t| Tag {
                name: t.to_string(),
                span: Span::EMPTY,
            })
            .collect();
        m
    }

    #[test]
    fn finds_by_tag_as_an_exact_term() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged(
            "a.md",
            "niente di rilevante nel corpo",
            &["progetto/fub"],
        )));

        let hits = page_of(&idx, tag("progetto/fub", false), None).items;
        assert_eq!(hits.len(), 1);
        // Selezionata da un fatto e non da una pertinenza: niente rilevanza,
        // niente estratto, niente highlight. Prima un `tags:` nella stringa
        // produceva un punteggio, ed era il punteggio di una domanda che non
        // era una ricerca.
        assert!(hits[0].highlights.is_empty());
        assert!(hits[0].score.is_none());
        assert!(hits[0].snippet.is_none());
    }

    #[test]
    fn a_tag_is_a_key_not_prose() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged(
            "nested.md",
            "",
            &["progetto/rust"],
        )));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("plain.md", "", &["rust"])));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged(
            "adiacenti.md",
            "",
            &["area", "lavoro"],
        )));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged(
            "composto.md",
            "",
            &["area/lavoro"],
        )));

        // Un tag è un termine esatto: senza `descendants`, quello annidato non
        // c'entra.
        let hits = page_of(&idx, tag("rust", false), None).items;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc, DocId::new("plain.md"));

        // Con `descendants`, invece, la gerarchia c'è tutta — ed è la stessa
        // regola che applica il kernel sui suoi conteggi.
        let mut ids: Vec<String> = page_of(&idx, tag("rust", true), None)
            .items
            .into_iter()
            .map(|h| h.doc.to_string())
            .collect();
        ids.sort();
        assert_eq!(
            ids,
            ["plain.md"],
            "`rust` non è antenato di `progetto/rust`"
        );
        let mut ids: Vec<String> = page_of(&idx, tag("progetto", true), None)
            .items
            .into_iter()
            .map(|h| h.doc.to_string())
            .collect();
        ids.sort();
        assert_eq!(ids, ["nested.md"]);

        // E `area/lavoro` non è una phrase query: `#area #lavoro` adiacenti non
        // sono `#area/lavoro`.
        let hits = page_of(&idx, tag("area/lavoro", false), None).items;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc, DocId::new("composto.md"));
    }

    #[test]
    fn tags_are_case_insensitive_but_exact() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("a.md", "", &["Rust"])));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("b.md", "", &["rust"])));

        // `#Rust` e `#rust` sono lo stesso tag (chiave canonica), qualunque
        // sia il case della query: il click dal pannello (che mostra la
        // grafia originale) trova le stesse note del conteggio.
        for q in ["rust", "Rust", "RUST"] {
            assert_eq!(page_of(&idx, tag(q, false), None).items.len(), 2, "tag {q}");
        }
    }

    #[test]
    fn update_replaces_previous_content() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "vecchio contenuto")));
        assert_eq!(search(&idx, "vecchio").len(), 1);

        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "nuovo contenuto")));
        assert_eq!(search(&idx, "vecchio").len(), 0, "niente duplicati");
        assert_eq!(search(&idx, "nuovo").len(), 1);
        assert_eq!(idx.len(), 1);
    }

    #[test]
    fn removal_deletes_from_index() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "effimero")));
        let _ = idx.on_documents_removed(std::slice::from_ref(&DocId::new("a.md")));
        assert_eq!(search(&idx, "effimero").len(), 0);
        assert!(idx.is_empty());
    }

    #[test]
    fn reconcile_drops_what_the_vault_no_longer_has() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("vivo.md", "presente")));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("morto.md", "sparito")));

        let _ = idx.reconcile(&[DocId::new("vivo.md")]);

        assert_eq!(search(&idx, "presente").len(), 1);
        assert_eq!(search(&idx, "sparito").len(), 0);
    }

    #[test]
    fn the_fingerprints_live_in_the_plugin_storage() {
        // Il dogfooding della firma: ciò che questo indice deve *ritrovare* alla
        // riapertura passa da `data_*`, cioè dall'unico storage durevole che
        // avrà anche un provider di terzi. Non da `std::fs`.
        let (_g, path) = tmp();
        let (mut idx, mut host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto")));
        idx.flush(&mut host).unwrap();

        let manifest = manifest_of(&host);
        assert_eq!(manifest.schema_version, SCHEMA_VERSION);
        assert!(manifest.docs.contains_key("a.md"));
        assert!(
            !path.join(MANIFEST).exists(),
            "il manifest non deve più stare accanto ai file di tantivy"
        );
    }

    #[test]
    fn reopening_skips_unchanged_documents() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            let _ =
                idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto stabile")));
            idx.flush(&mut host).unwrap();
        }

        let mut idx = open(&path, &mut host);
        assert_eq!(idx.len(), 1, "le impronte sopravvivono alla riapertura");
        // Ripassare lo stesso contenuto non produce scritture: è ciò che rende
        // rapida la riapertura di un vault non toccato.
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto stabile")));
        assert!(
            !idx.dirty.load(Ordering::Relaxed),
            "un documento immutato non sporca l'indice"
        );
        // E nemmeno il manifest si riscrive: non c'è niente di nuovo da dire.
        let prima = manifest_of(&host).opstamp;
        idx.flush(&mut host).unwrap();
        assert_eq!(manifest_of(&host).opstamp, prima);
        assert_eq!(search(&idx, "stabile").len(), 1);
    }

    #[test]
    fn reopening_reindexes_when_the_manifest_is_of_another_epoch() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            let _ =
                idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto stabile")));
            idx.flush(&mut host).unwrap();
        }
        // Simula il crash fra commit e manifest: l'opstamp non torna.
        let mut m = manifest_of(&host);
        m.opstamp += 1;
        put_manifest(&mut host, &m);

        let mut idx = open(&path, &mut host);
        assert_eq!(idx.len(), 0, "impronte di un'altra epoca: non ci si fida");
        // Il documento si reindicizza, e non si duplica: delete+add.
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto stabile")));
        assert_eq!(search(&idx, "stabile").len(), 1);
    }

    #[test]
    fn lo_schema_non_cambia_senza_che_il_numero_salga() {
        let (schema, _) = build_schema();
        assert_eq!(
            schema_fingerprint(&schema),
            IMPRONTA_DELLO_SCHEMA,
            "lo schema di tantivy è cambiato e SCHEMA_VERSION è ancora {SCHEMA_VERSION}. \
             Chi riapre un vault indicizzato da una versione precedente non troverebbe \
             una ricostruzione ma un indice incoerente, che è il danno che quel numero \
             esiste per evitare. Alza SCHEMA_VERSION, aggiungi la riga di storia al suo \
             commento, e riscrivi qui l'impronta nuova."
        );
    }

    #[test]
    fn a_bumped_schema_throws_the_fingerprints_away() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto")));
            idx.flush(&mut host).unwrap();
        }
        let mut m = manifest_of(&host);
        m.schema_version = SCHEMA_VERSION + 1;
        put_manifest(&mut host, &m);

        let idx = open(&path, &mut host);
        assert_eq!(idx.len(), 0);
    }

    // --- la domanda che mancava (§14.2) ------------------------------------

    /// Una voce d'anagrafe come la costruisce il kernel: la specie, e
    /// l'impronta del **sorgente** se qualcuno ne ha già avuto i byte in mano.
    fn voce(id: &str, source: Option<&str>) -> VaultEntry {
        VaultEntry {
            id: DocId::new(id),
            kind: EntryKind::Document,
            size: 0,
            mtime: 0,
            fingerprint: source.map(Revision::of),
        }
    }

    /// Il giro dell'apertura come lo fa il kernel: prima si chiede cosa c'è
    /// già, poi si consegna ciò che non c'era.
    fn giro(idx: &mut SearchIndex, vault: &[(&str, &str)]) -> Vec<String> {
        let entries: Vec<VaultEntry> = vault
            .iter()
            .map(|(id, source)| voce(id, Some(source)))
            .collect();
        let gia = idx.up_to_date(&entries);
        for (id, source) in vault {
            if gia.iter().any(|d| d.as_str() == *id) {
                continue;
            }
            let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(id, source)));
        }
        gia.iter().map(|d| d.to_string()).collect()
    }

    #[test]
    fn alla_prima_apertura_non_ce_niente_di_gia_a_posto() {
        let (_g, path) = tmp();
        let (idx, _host) = fresh(&path);
        assert!(
            idx.up_to_date(&[voce("a.md", Some("contenuto"))])
                .is_empty(),
            "un indice vuoto chiede tutto, che è il verso sicuro dello sbaglio"
        );
    }

    #[test]
    fn alla_riapertura_si_riconosce_cio_che_non_e_cambiato() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        let vault = [("a.md", "il gatto"), ("b.md", "il cane")];
        {
            let mut idx = open(&path, &mut host);
            assert!(
                giro(&mut idx, &vault).is_empty(),
                "il primo giro non sa niente"
            );
            idx.flush(&mut host).unwrap();
        }

        // Le impronte dei sorgenti sono nel manifest, accanto a quelle dei
        // modelli: sono due informazioni diverse, e fra le due c'è un parser.
        let manifest = manifest_of(&host);
        assert_eq!(manifest.sources.len(), 2);
        assert_eq!(
            manifest.sources.get("a.md"),
            Some(&Revision::of("il gatto").0)
        );

        let mut idx = open(&path, &mut host);
        let mut gia = giro(&mut idx, &vault);
        gia.sort();
        assert_eq!(
            gia,
            ["a.md", "b.md"],
            "e alla riapertura si risponde SENZA che nessuno abbia aperto un file"
        );
        assert_eq!(search(&idx, "gatto").len(), 1, "e l'indice è ancora quello");
    }

    #[test]
    fn cio_che_e_cambiato_ad_app_chiusa_non_risulta_a_posto() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            giro(&mut idx, &[("a.md", "il gatto"), ("b.md", "il cane")]);
            idx.flush(&mut host).unwrap();
        }

        let mut idx = open(&path, &mut host);
        let gia = giro(&mut idx, &[("a.md", "il gatto"), ("b.md", "il criceto")]);
        assert_eq!(gia, ["a.md"], "solo quello con la stessa impronta");
        assert_eq!(
            search(&idx, "criceto").len(),
            1,
            "e l'altro è stato riletto"
        );
        assert_eq!(search(&idx, "cane").len(), 0);
    }

    #[test]
    fn senza_impronta_dichiarata_non_si_risponde() {
        // Il kernel non calcola l'impronta di ciò che non deve leggere: chi non
        // sa di che revisione è un file non può sapere se è la sua.
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            giro(&mut idx, &[("a.md", "il gatto")]);
            idx.flush(&mut host).unwrap();
        }
        let idx = open(&path, &mut host);
        assert!(idx.up_to_date(&[voce("a.md", None)]).is_empty());
        // E ciò che non è un documento non è affar suo, per quanta impronta
        // porti: il kernel oggi manda solo documenti, ma leggerlo più stretto di
        // com'è scritto sarebbe un'assunzione, non una lettura.
        let mut allegato = voce("a.md", Some("il gatto"));
        allegato.kind = EntryKind::Asset;
        assert!(idx.up_to_date(&[allegato]).is_empty());
    }

    #[test]
    fn un_manifest_di_un_altra_epoca_si_porta_via_anche_le_impronte_dei_sorgenti() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            giro(&mut idx, &[("a.md", "il gatto")]);
            idx.flush(&mut host).unwrap();
        }
        let mut m = manifest_of(&host);
        m.opstamp += 1;
        put_manifest(&mut host, &m);

        let idx = open(&path, &mut host);
        assert!(
            idx.up_to_date(&[voce("a.md", Some("il gatto"))]).is_empty(),
            "il guardiano è uno solo: se il manifest è di un'altra epoca non se ne \
             crede nessuna parte — dire «ce l'ho» a sproposito farebbe SALTARE un \
             documento, cioè mentire in silenzio"
        );
    }

    #[test]
    fn una_scrittura_a_sessione_aperta_non_eredita_la_revisione_di_prima() {
        // Il caso in cui la mappa mentirebbe: alla riapertura il kernel dichiara
        // le revisioni di *adesso*, poi l'utente salva, e l'indice riceve un
        // documento nuovo senza che nessuno gli abbia detto di che revisione è.
        // Tenere quella dichiarata all'avvio vorrebbe dire attribuire al testo di
        // adesso la revisione del testo di allora — e alla riapertura saltare un
        // documento modificato.
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            giro(&mut idx, &[("a.md", "il gatto")]);
            idx.flush(&mut host).unwrap();
        }
        {
            let mut idx = open(&path, &mut host);
            giro(&mut idx, &[("a.md", "il gatto")]);
            // Salvataggio a sessione aperta: nessuna domanda prima.
            let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "il cane")));
            idx.close(&mut host).unwrap();
        }
        assert!(
            !manifest_of(&host).sources.contains_key("a.md"),
            "nessuna dichiarazione = nessuna promessa: alla prossima apertura lo si rilegge"
        );

        let idx = open(&path, &mut host);
        assert!(idx.up_to_date(&[voce("a.md", Some("il cane"))]).is_empty());
    }

    #[test]
    fn un_documento_uscito_dal_vault_non_lascia_una_revisione_dietro() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        let mut idx = open(&path, &mut host);
        giro(&mut idx, &[("a.md", "il gatto"), ("b.md", "il cane")]);

        let _ = idx.on_documents_removed(std::slice::from_ref(&DocId::new("a.md")));
        let _ = idx.reconcile(&[DocId::new("b.md")]);
        idx.flush(&mut host).unwrap();
        assert_eq!(
            manifest_of(&host).sources.keys().collect::<Vec<_>>(),
            ["b.md"],
            "una revisione senza il documento dietro è una risposta sbagliata che \
             aspetta di essere data"
        );
    }

    #[test]
    fn una_modifica_che_non_cambia_il_modello_aggiorna_lo_stesso_la_revisione() {
        // Due sorgenti diversi che danno lo stesso modello: succede davvero —
        // una riga di frontmatter che nessuno indicizza, uno spazio in fondo.
        // Se la revisione non si aggiornasse, quel documento risulterebbe
        // «cambiato» a ogni apertura, per sempre.
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        let mut idx = open(&path, &mut host);
        idx.up_to_date(&[voce("a.md", Some("prima"))]);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "testo identico")));
        idx.up_to_date(&[voce("a.md", Some("dopo"))]);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "testo identico")));
        idx.flush(&mut host).unwrap();

        assert_eq!(
            manifest_of(&host).sources.get("a.md"),
            Some(&Revision::of("dopo").0)
        );
    }

    #[test]
    fn a_missing_manifest_is_not_an_error() {
        // Il primo avvio, e ogni avvio dopo un manifest perso: non si fallisce,
        // si reindicizza. Un'attivazione che fallisse per questo impedirebbe la
        // ricerca per un file che il vault non ha nemmeno bisogno di avere.
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        let mut idx = SearchIndex::open_dir(&path).unwrap();
        assert!(idx.activate(&mut host).is_ok());
        assert!(idx.is_empty());
    }

    #[test]
    fn a_corrupt_index_is_rebuilt_not_diagnosed() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto")));
            idx.flush(&mut host).unwrap();
        }
        std::fs::write(path.join("meta.json"), b"non sono json").unwrap();

        let mut idx = open(&path, &mut host);
        assert_eq!(idx.len(), 0);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto")));
        assert_eq!(search(&idx, "contenuto").len(), 1);
    }

    /// **Non esiste più una query malformata.** Prima `campo:valore` andava nel
    /// parser di tantivy e un campo sconosciuto era un `BadArgs` che la shell
    /// mostrava come «Query incompleta»: la sintassi di ricerca dell'utente era
    /// quella di una dipendenza. Adesso quella stringa è ciò che sembra — dei
    /// termini — e la risposta è un elenco, eventualmente vuoto.
    #[test]
    fn what_used_to_be_a_syntax_error_is_now_just_terms() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "a.md",
            "qui c'è scritto campo_inesistente:valore",
        )));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("b.md", "qui no")));

        let hits = search(&idx, "campo_inesistente:valore");
        assert_eq!(
            hits.len(),
            1,
            "i due token sono termini, e il documento che li contiene combacia"
        );
        assert_eq!(hits[0].doc, DocId::new("a.md"));
    }

    #[test]
    fn empty_query_returns_nothing() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "qualcosa")));
        assert!(search(&idx, "   ").is_empty());
    }

    // --- ambito e finestra (decisione 0005) ------------------------------------------

    #[test]
    fn a_folder_scope_takes_the_descendants_too() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("radice.md", "gatto")));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("Progetti/alpha.md", "gatto")));
        let _ =
            idx.on_documents_indexed(std::slice::from_ref(&doc("Progetti/sub/beta.md", "gatto")));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("Altro/gamma.md", "gatto")));

        let in_folder = |folder: &str| {
            let matching = clause(vec![
                lit(QueryPredicate::Text(TextQuery::terms("gatto"))),
                lit(QueryPredicate::Folder {
                    path: folder.to_string(),
                    descendants: true,
                }),
            ]);
            let mut ids: Vec<String> = page_of(&idx, matching, None)
                .items
                .into_iter()
                .map(|h| h.doc.to_string())
                .collect();
            ids.sort();
            ids
        };

        assert_eq!(
            in_folder("Progetti"),
            ["Progetti/alpha.md", "Progetti/sub/beta.md"],
            "una cartella prende anche le sue discendenti"
        );
        assert_eq!(in_folder("Progetti/sub"), ["Progetti/sub/beta.md"]);
        assert_eq!(
            in_folder("").len(),
            4,
            "la radice è l'intero vault, non le sole note di primo livello"
        );
    }

    #[test]
    fn scoping_by_tag_is_an_and_with_the_query() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("a.md", "gatto", &["Casa"])));
        let _ =
            idx.on_documents_indexed(std::slice::from_ref(&tagged("b.md", "gatto", &["lavoro"])));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("c.md", "cane", &["casa"])));

        // Grafia diversa dal canonico: il predicato la normalizza come fa il
        // pannello dei tag, o "cerca fra le note #Casa" non troverebbe #casa.
        let matching = clause(vec![
            lit(QueryPredicate::Text(TextQuery::terms("gatto"))),
            lit(QueryPredicate::Tag {
                name: "Casa".to_string(),
                descendants: false,
            }),
        ]);
        let hits = page_of(&idx, matching, None);
        assert_eq!(hits.total, 1);
        assert_eq!(hits.items[0].doc, DocId::new("a.md"));
    }

    #[test]
    fn the_window_moves_over_the_matches_and_the_total_stays_the_total() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        for i in 0..5 {
            let _ = idx
                .on_documents_indexed(std::slice::from_ref(&doc(&format!("nota{i}.md"), "gatto")));
        }

        let first = page_of(&idx, text("gatto"), Some(Page::new(0, 2)));
        assert_eq!(first.items.len(), 2);
        assert_eq!(
            (first.offset, first.total),
            (0, 5),
            "il totale è quello dei match, non della pagina"
        );

        let second = page_of(&idx, text("gatto"), Some(Page::new(2, 2)));
        assert_eq!(second.items.len(), 2);
        assert_eq!(second.total, 5);
        let overlap = first
            .items
            .iter()
            .any(|h| second.items.iter().any(|s| s.doc == h.doc));
        assert!(!overlap, "due pagine consecutive non si sovrappongono");

        let beyond = page_of(&idx, text("gatto"), Some(Page::new(99, 2)));
        assert!(beyond.items.is_empty(), "oltre la fine è vuoto");
        assert_eq!(beyond.total, 5, "e il totale resta");

        let all = page_of(&idx, text("gatto"), None);
        assert_eq!(all.items.len(), 5, "senza finestra si prende tutto");
    }

    #[test]
    fn moving_a_note_reindexes_it_even_with_the_same_content() {
        // L'impronta include il path: da quando l'indice porta la cartella,
        // due note con lo stesso testo in cartelle diverse NON sono la stessa
        // cosa indicizzata.
        let a = doc("Progetti/nota.md", "identico");
        let b = doc("Archivio/nota.md", "identico");
        assert_ne!(fingerprint(&a), fingerprint(&b));
    }

    /// Ciò che ha già una fonte di verità nel kernel non si duplica qui. Prima
    /// questo indice doveva **dirlo** con un `BadArgs` per ogni famiglia,
    /// perché era così che il dispatch scopriva chi servisse cosa; adesso le
    /// rotte sono dichiarate e questa domanda non gli arriva. La risposta resta
    /// per chi lo chiamasse fuori dal kernel, e dice la cosa giusta: non che la
    /// domanda è malposta, ma che non la serve lui.
    #[test]
    fn backlinks_are_not_served_here() {
        let (_g, path) = tmp();
        let (idx, _host) = fresh(&path);
        assert!(
            !idx.routes()
                .contains(&QueryRoute::Query(fub_abi::traits::QueryKind::Backlinks)),
            "e soprattutto non li rivendica"
        );
        let r = idx.query(IndexQuery::Backlinks {
            target: DocId::new("a.md"),
            page: None,
        });
        assert!(matches!(r, Err(PluginError::Unserved(_))));
    }

    // --- la quarta proprietà: due ricerche insieme (§8.4) ----------------------------

    /// Quante ricerche fa ogni thread in una corsa. Abbastanza da coprire il
    /// costo di far partire i thread, abbastanza poche da non pesare sulla suite.
    const RICERCHE: usize = 20;

    /// Un vault abbastanza grande che una query costi più del lock che si sta
    /// misurando: sotto questa taglia la corsa racconterebbe il costo di
    /// `thread::spawn`, non quello della ricerca.
    fn indice_pieno(path: &Utf8Path) -> (SearchIndex, MemoryHost) {
        let (mut idx, mut host) = fresh(path);
        for i in 0..200 {
            let mut corpo = String::new();
            for s in 0..6 {
                corpo.push_str(&format!(
                    "## Sezione {s}\n\nUn paragrafo con parole ricorrenti come \
                     linguaggio, sistema, memoria, concorrenza e prestazione.\n\n"
                ));
            }
            let _ = idx
                .on_documents_indexed(std::slice::from_ref(&doc(&format!("Nota {i}.md"), &corpo)));
        }
        // Committato **prima** di misurare: con scritture in sospeso la prima
        // query prenderebbe il lock del writer per davvero, e la corsa
        // misurerebbe quello.
        idx.flush(&mut host).expect("flush");
        assert!(!idx.dirty.load(Ordering::Relaxed));
        (idx, host)
    }

    /// Quanto ci mettono `thread` thread a fare [`RICERCHE`] ricerche a testa.
    ///
    /// Con `in_fila` le si serializza da fuori: è il termine di paragone, ed è
    /// **il comportamento di prima** — un lock attorno all'intera `query`. Sta
    /// nello stesso binario e nella stessa corsa, come il banco della 0024, così
    /// non serve un ramo git per sapere cosa si sta guadagnando.
    fn corsa(idx: &SearchIndex, thread: usize, in_fila: Option<&Mutex<()>>) -> f64 {
        let inizio = std::time::Instant::now();
        std::thread::scope(|s| {
            for _ in 0..thread {
                s.spawn(move || {
                    for _ in 0..RICERCHE {
                        let _fila = in_fila.map(|m| m.lock().expect("mutex"));
                        let hits = page_of(idx, text("concorrenza"), Some(Page::first(10)));
                        assert_eq!(hits.total, 200, "la ricerca deve trovare tutto il vault");
                    }
                });
            }
        });
        inizio.elapsed().as_secs_f64()
    }

    /// **La proprietà che dà il nome alla §8.4**: due ricerche possono essere in
    /// volo insieme dentro questo indice.
    ///
    /// Non si misura contando chi è *dentro* `query` — con un `Mutex` interno ci
    /// starebbero in due lo stesso, uno dei quali fermo ad aspettare, e il test
    /// passerebbe proprio nel caso che deve bocciare. Si misura invece il tempo,
    /// contro un termine di paragone che sta nella stessa corsa: le stesse
    /// ricerche serializzate da un lock esterno. Se l'indice ha un lock suo, le
    /// due colonne coincidono e questo test è rosso — che è esattamente ciò che
    /// succedeva prima della §8.4.
    ///
    /// La soglia è larga (un quarto di tempo risparmiato) perché il numero da
    /// difendere non è «quanto va veloce» ma «scala o no»: col lock interno il
    /// rapporto è 1,0, senza è vicino al numero di core. In mezzo non c'è niente
    /// che una macchina lenta possa produrre per caso.
    ///
    /// Una macchina **occupata** è un'altra cosa da una lenta, e può darlo un
    /// falso rosso: le due colonne stanno nella stessa corsa ma non nello stesso
    /// istante, quindi un vicino di banco che si prende i core durante la
    /// seconda peggiora solo quella. Il modo di distinguerlo è rilanciarlo da
    /// solo (`cargo test -p fub-features --lib due_ricerche -- --ignored`): un
    /// rosso che resta è un lock tornato dentro l'indice, uno che sparisce era il
    /// carico. La soglia non va spostata per farlo tacere.
    ///
    /// # Perché è `ignore`, e cosa lo rimetterà in CI
    ///
    /// Qui sopra c'era scritto che «fra 0,4 e 0,95 non c'è niente che una
    /// macchina lenta possa produrre per caso», e **la CI l'ha smentito**: su
    /// ubuntu il rapporto è venuto 0,97 e su windows 0,89, con la suite verde in
    /// locale. La ragione non è che quei runner siano lenti — è che ogni colonna
    /// misura **una trentina di millisecondi**, e a quella scala il tempo se lo
    /// mangiano lo spawn dei thread e lo scheduling, che non scalano con i core.
    /// Il rapporto misurato non è più la proprietà: è il rumore.
    ///
    /// Quindi il test resta — la proprietà è vera e vale un presidio — ma si
    /// lancia a mano, dove la macchina è nota. Rimetterlo a ogni push vuol dire
    /// dargli un carico che domini l'overhead e un banco che non condivida i
    /// core con nessuno: è la **§17.1**, che chiede esattamente «benchmark su
    /// vault sintetici grandi in CI, con soglie», ed è aperta. Questo è il suo
    /// primo abitante.
    #[ignore = "misura un tempo, e in CI condivisa il tempo non è un segnale (§17.1)"]
    #[test]
    fn due_ricerche_stanno_nell_indice_insieme() {
        let n = std::thread::available_parallelism()
            .map_or(1, |n| n.get())
            .min(4);
        if n < 2 {
            eprintln!("un core solo: la sovrapposizione non è misurabile, e il test lo dice");
            return;
        }

        let (_g, path) = tmp();
        let (idx, _host) = indice_pieno(&path);

        // Un giro a vuoto: la prima ricerca paga la cache dei segmenti, e
        // pagarla dentro una delle due colonne la falserebbe.
        corsa(&idx, n, None);
        let in_fila = Mutex::new(());
        let seriale = corsa(&idx, n, Some(&in_fila));
        let insieme = corsa(&idx, n, None);

        assert!(
            insieme < seriale * 0.75,
            "{n} thread hanno impiegato {insieme:.3}s insieme contro {seriale:.3}s \
             in fila: la ricerca non scala, cioè c'è di nuovo un lock dentro \
             l'indice. È la §8.4, e il prestito condiviso del workspace non lo \
             attraversa."
        );
    }

    /// La chiusura (§9.2, decisione 0028) **lascia andare la cartella**: il
    /// writer torna a tantivy, i suoi thread di merge finiscono, e il lock
    /// esclusivo sull'indice non c'è più.
    ///
    /// È la ragione per cui `close` esiste ed è obbligatoria. Il primo indice
    /// qui sotto è **ancora vivo** quando il secondo si apre: senza la chiusura
    /// il secondo aspetterebbe il lock del primo — non un errore, un'attesa
    /// senza fine, che è esattamente ciò che succedeva riaprendo lo stesso vault
    /// prima che la sessione precedente cadesse.
    #[test]
    fn un_indice_chiuso_lascia_la_cartella_a_chi_arriva_dopo() {
        let (_g, path) = tmp();
        let (mut primo, mut host) = fresh(&path);
        let _ = primo.on_documents_indexed(std::slice::from_ref(&doc("a.md", "ciao")));
        primo.close(&mut host).expect("chiusura");

        let secondo = SearchIndex::open_dir(&path);
        assert!(
            secondo.is_ok(),
            "la cartella è libera mentre il primo indice è ancora in vita: {:?}",
            secondo.err()
        );
        // E richiudere non è un errore: è un no-op, come cancellare un blob che
        // non c'è.
        primo.close(&mut host).expect("chiudere due volte");
    }

    #[test]
    fn head_of_truncates_on_char_boundaries() {
        assert_eq!(head_of("breve", 10), "breve");
        let s = head_of("però caffè città perché così", 10);
        assert!(s.ends_with('…'));
        assert!(s.chars().count() <= 12);
    }

    /// La §21.2: `arch` trova *architettura* prima che la parola sia finita, e
    /// **solo** l'ultimo termine è un prefisso.
    #[test]
    fn lultimo_termine_incompleto_e_un_prefisso_e_gli_altri_no() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "a.md",
            "note di architettura del kernel",
        )));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "b.md",
            "un archivio di vecchie note",
        )));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "c.md",
            "il kernel e le sue parti",
        )));

        // Senza il prefisso, `arch` non è una parola di nessuno dei tre.
        assert!(
            page_of(&idx, text("arch"), None).items.is_empty(),
            "l'esattezza resta il default: `arch` da solo non trova niente"
        );
        // Con il prefisso, li trova entrambi — ed è la stessa stringa.
        let mut ids: Vec<String> = page_of(&idx, text_parziale("arch"), None)
            .items
            .into_iter()
            .map(|m| m.doc.0)
            .collect();
        ids.sort();
        assert_eq!(ids, vec!["a.md".to_string(), "b.md".to_string()]);

        // Due termini: l'ultimo è il prefisso, il primo no. `kernel arch` deve
        // trovare la nota che ha kernel E qualcosa che comincia per arch, e non
        // quella che ha solo kernel.
        let ids: Vec<String> = page_of(&idx, text_parziale("kernel arch"), None)
            .items
            .into_iter()
            .map(|m| m.doc.0)
            .collect();
        assert_eq!(ids, vec!["a.md".to_string()]);

        // E il termine che **non** è l'ultimo resta intero: `arch kernel` non
        // deve trovare `archivio`, perché lì il prefisso non è più suo.
        let ids: Vec<String> = page_of(&idx, text_parziale("arch kernel"), None)
            .items
            .into_iter()
            .map(|m| m.doc.0)
            .collect();
        assert!(
            ids.is_empty(),
            "solo l'ultimo termine è incompleto: {ids:?}"
        );
    }

    /// La §21.1: un heading pesa più del corpo, e `TextField::Heading` cerca
    /// **solo** lì.
    #[test]
    fn un_heading_pesa_piu_del_corpo_ed_e_un_campo_a_se() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        // La stessa parola: in un heading di una nota, nel corpo dell'altra.
        let mut con_sezione = doc("sezione.md", "Concorrenza\n\nqualche riga qui");
        con_sezione.outline = vec![fub_abi::model::Heading {
            level: 2,
            text: "Concorrenza".into(),
            slug: "concorrenza".into(),
            span: Span::new(0, 14),
        }];
        let _ = idx.on_documents_indexed(std::slice::from_ref(&con_sezione));
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            "citata.md",
            "un accenno alla concorrenza e poi si passa oltre",
        )));

        // Chi le ha dedicato una sezione viene prima: il termine conta due
        // volte, e la seconda con il boost.
        let hits = search(&idx, "concorrenza");
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].doc, DocId::new("sezione.md"));

        // E il campo è a sé: cercando **solo** negli heading resta una sola.
        let solo_heading = clause(vec![lit(QueryPredicate::Text(TextQuery {
            fields: vec![TextField::Heading],
            ..TextQuery::terms("concorrenza")
        }))]);
        let ids: Vec<String> = page_of(&idx, solo_heading, None)
            .items
            .into_iter()
            .map(|m| m.doc.0)
            .collect();
        assert_eq!(ids, vec!["sezione.md".to_string()]);
    }

    /// La tolleranza è **dicibile** e non ancora onorata, e il verso del
    /// silenzio è quello sicuro: chiedere `typos` non allarga niente.
    #[test]
    fn chiedere_la_tolleranza_non_rende_tollerante_di_nascosto() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        let _ =
            idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "note di architettura")));

        let con_refuso = clause(vec![lit(QueryPredicate::Text(TextQuery {
            tolerance: TextTolerance::Typos,
            ..TextQuery::terms("architettra")
        }))]);
        assert!(
            page_of(&idx, con_refuso, None).items.is_empty(),
            "`typos` è dicibile: chi non lo onora risponde come per `exact`, e \
             restringere è il verso innocuo dello sbaglio"
        );
    }
}
