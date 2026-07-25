//! Ricerca full-text: il primo [`IndexProvider`] nativo, sopra **tantivy**.
//!
//! Feature ufficiale, quindi codice nativo — nessuna sandbox, nessuna tassa di
//! serializzazione — ma dietro lo **stesso trait** che userà un plugin di terzi
//! a M5. Il kernel non sa che dietro c'è tantivy: vede `dyn IndexProvider`.
//!
//! # Le tre proprietà che questo indice deve garantire
//!
//! 1. **Non mente.** Il kernel lo alimenta direttamente (non via event bus),
//!    quindi non può perdere aggiornamenti; ciò che resta fuori dalla sua vista
//!    — cancellazioni ad app chiusa — lo chiude [`IndexProvider::reconcile`].
//! 2. **Riparte in fretta.** L'indice vive su disco nello spazio dati del
//!    proprio plugin (`.fubmd-data/plugins/fubmd.search/`). Alla riapertura
//!    ogni documento ripassa da `on_document_indexed`, ma l'impronta del
//!    contenuto (vedi [`fingerprint`]) fa saltare gli immutati: su un vault non
//!    toccato la riapertura non scrive nulla.
//! 3. **Non si affeziona ai propri dati.** Qualunque dubbio sulla coerenza fra
//!    indice e manifest si risolve buttando via l'indice e ricostruendolo: la
//!    verità è il vault, questo è solo stato derivato.
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
use std::sync::Mutex;

use camino::Utf8Path;
use fubmd_abi::model::{canonical_tag, DocId, DocumentModel, Span};
use fubmd_abi::traits::{HostApi, IndexProvider, IndexQuery, IndexResult, SearchHit};
use fubmd_abi::{Pagination, PluginError};
use serde::{Deserialize, Serialize};
use tantivy::query::QueryParser;
use tantivy::schema::{Field, Schema, Value, STORED, STRING, TEXT};
use tantivy::snippet::SnippetGenerator;
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

/// Identità della ricerca come plugin: è lo spazio dati che l'host le concede.
/// La assegna chi registra il provider — non la feature.
pub const SEARCH_ID: &str = "fubmd.search";

/// Versione dello schema dell'indice. **Va incrementata** ad ogni modifica dei
/// campi, delle opzioni o del tokenizer: un manifest con versione diversa fa
/// buttare via l'indice e ricostruirlo da zero.
///
/// v2: `tags` da TEXT tokenizzato a STRING (termine esatto, forma canonica).
const SCHEMA_VERSION: u32 = 2;

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
const PAGE_NAME_BOOST: f32 = 4.0;

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
    eat(doc.id.page_name().as_bytes());
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
    tags: Field,
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
    (
        b.build(),
        Fields {
            doc_id,
            page_name,
            body,
            tags,
        },
    )
}

struct Inner {
    index: Index,
    writer: IndexWriter,
    reader: IndexReader,
    fields: Fields,
    fingerprints: HashMap<DocId, u64>,
    /// Ci sono scritture accettate ma non ancora committate?
    dirty: bool,
    /// L'opstamp dell'ultimo commit visto da questa istanza.
    opstamp: u64,
    /// L'opstamp citato dal manifest attualmente su disco, se ce n'è uno di cui
    /// ci si fida. `None` = manifest assente, di un'altra epoca o da riscrivere.
    manifest_at: Option<u64>,
}

/// Indice full-text del vault.
///
/// `Mutex` perché [`IndexProvider::query`] prende `&self` ma una query può
/// dover committare le scritture in sospeso (chi interroga vede sempre le
/// proprie scritture — è il provider a garantirlo, vedi il trait).
pub struct SearchIndex {
    inner: Mutex<Inner>,
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
                    .map_err(|e| PluginError::Internal(format!("creazione indice: {e}")))?,
            );
        }
        let index = index.expect("appena creato se assente");

        // Il writer prende un lock esclusivo sulla cartella. Fallire qui NON
        // deve portare a buttare l'indice: la causa quasi certa è che un'altra
        // istanza di FubMD ha già questo vault aperto, e la sua copia è viva e
        // corretta. Si rinuncia alla ricerca, non ai dati di qualcun altro.
        let writer: IndexWriter = index.writer(WRITER_HEAP).map_err(|e| {
            PluginError::Internal(format!(
                "writer indice ({dir}): {e} — un'altra istanza di FubMD ha \
                 forse questo vault già aperto"
            ))
        })?;
        let reader = index
            .reader_builder()
            // I commit li decidiamo noi (`flush`, o una query con scritture in
            // sospeso): niente thread di watch sul meta.json.
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(|e| PluginError::Internal(format!("reader indice: {e}")))?;

        // L'epoca dell'indice sul disco. Le impronte che le corrispondono
        // arrivano da `activate`, l'unico posto dove c'è un host per leggerle.
        let opstamp = index.load_metas().map(|m| m.opstamp).unwrap_or_default();

        Ok(SearchIndex {
            inner: Mutex::new(Inner {
                index,
                writer,
                reader,
                fields,
                fingerprints: HashMap::new(),
                dirty: false,
                opstamp,
                manifest_at: None,
            }),
        })
    }

    /// Quanti documenti l'indice crede di avere. Utile ai test e alle
    /// diagnostiche; non è una query.
    pub fn len(&self) -> usize {
        self.inner.lock().expect("mutex").fingerprints.len()
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

fn io_err(path: &Utf8Path, e: std::io::Error) -> PluginError {
    PluginError::Internal(format!("{path}: {e}"))
}

impl Inner {
    fn term_for(&self, id: &DocId) -> Term {
        Term::from_field_text(self.fields.doc_id, id.as_str())
    }

    /// Committa se ci sono scritture in sospeso, e riallinea il reader.
    ///
    /// Non tocca il manifest: qui non c'è un host, perché il commit può essere
    /// deciso anche da una `query` (chi interroga vede le proprie scritture) e
    /// una query non ne ha uno. Il manifest lo riscrive [`Inner::persist`], e
    /// finché non lo fa quello su disco risulta di un'altra epoca — cioè
    /// inaffidabile, che è il verso giusto in cui sbagliare.
    fn commit(&mut self) -> Result<(), PluginError> {
        if !self.dirty {
            return Ok(());
        }
        self.opstamp = self
            .writer
            .commit()
            .map_err(|e| PluginError::Internal(format!("commit indice: {e}")))?;
        self.reader
            .reload()
            .map_err(|e| PluginError::Internal(format!("reload indice: {e}")))?;
        self.dirty = false;
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
        if manifest.schema_version != SCHEMA_VERSION || manifest.opstamp != self.opstamp {
            return Ok(());
        }
        self.fingerprints = manifest
            .docs
            .into_iter()
            .map(|(id, h)| (DocId::new(id), h))
            .collect();
        self.manifest_at = Some(manifest.opstamp);
        Ok(())
    }

    /// Rende durevoli le impronte, se quelle su disco non sono già le nostre.
    ///
    /// Il manifest si scrive DOPO il commit e cita il suo opstamp: se qualcosa
    /// va storto qui, alla riapertura le impronte risulteranno di un'altra
    /// epoca e si reindicizzerà — mai il contrario. E se non c'è niente di
    /// nuovo non si scrive: è ciò che rende osservabile «riaprire un vault
    /// immutato non produce scritture».
    fn persist(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if self.manifest_at == Some(self.opstamp) {
            return Ok(());
        }
        let manifest = Manifest {
            schema_version: SCHEMA_VERSION,
            opstamp: self.opstamp,
            docs: self
                .fingerprints
                .iter()
                .map(|(id, h)| (id.as_str().to_string(), *h))
                .collect(),
        };
        let raw = serde_json::to_vec(&manifest)
            .map_err(|e| PluginError::Internal(format!("manifest: {e}")))?;
        host.data_write(MANIFEST, &raw)?;
        self.manifest_at = Some(self.opstamp);
        Ok(())
    }

    fn search(&mut self, query: &str, limit: usize) -> Result<Vec<SearchHit>, PluginError> {
        // Chi interroga vede le proprie scritture, anche senza flush.
        self.commit()?;
        if query.trim().is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        // Il campo dei tag è STRING (termine esatto, niente tokenizer che
        // minuscolizzi): il termine digitato o mostrato va portato lui alla
        // forma canonica, o `tags:Rust` non troverebbe `#rust`.
        let query = canonicalize_tag_terms(query);
        let searcher = self.reader.searcher();
        let f = self.fields;

        let mut parser = QueryParser::for_index(&self.index, vec![f.page_name, f.body, f.tags]);
        parser.set_field_boost(f.page_name, PAGE_NAME_BOOST);
        // Più termini = più stretto, come si aspetta chi cerca: "rust async"
        // vuole le note che parlano di entrambi.
        parser.set_conjunction_by_default();
        let parsed = parser
            .parse_query(&query)
            .map_err(|e| PluginError::BadArgs(format!("query non valida: {e}")))?;

        // `with_limit` va in panico su 0 — intercettato sopra.
        let collector = tantivy::collector::TopDocs::with_limit(limit).order_by_score();
        let top = searcher
            .search(&parsed, &collector)
            .map_err(|e| PluginError::Internal(format!("ricerca: {e}")))?;

        let mut snippets = SnippetGenerator::create(&searcher, &*parsed, f.body)
            .map_err(|e| PluginError::Internal(format!("snippet: {e}")))?;
        snippets.set_max_num_chars(SNIPPET_CHARS);

        let mut hits = Vec::with_capacity(top.len());
        for (score, address) in top {
            let doc: TantivyDocument = searcher
                .doc(address)
                .map_err(|e| PluginError::Internal(format!("lettura documento: {e}")))?;
            let Some(id) = doc.get_first(f.doc_id).and_then(|v| v.as_str()) else {
                continue;
            };
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
            hits.push(SearchHit {
                doc: DocId::new(id),
                score,
                snippet: text,
                highlights,
            });
        }
        Ok(hits)
    }
}

/// Porta alla forma canonica il termine di ogni `tags:` della query, lasciando
/// intatto il resto (i campi TEXT hanno il loro tokenizer, che minuscolizza da
/// sé). Un nome di tag non contiene spazi: basta ragionare per token.
fn canonicalize_tag_terms(query: &str) -> String {
    query
        .split_whitespace()
        .map(|token| match token.strip_prefix("tags:") {
            Some(term) => format!("tags:{}", canonical_tag(term)),
            None => token.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
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
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.inner.get_mut().expect("mutex").load_manifest(host)
    }

    fn on_document_indexed(&mut self, doc: &DocumentModel) {
        let inner = self.inner.get_mut().expect("mutex");
        let print = fingerprint(doc);
        // Contenuto identico a quello già indicizzato: non c'è niente da fare.
        // È questo salto — non una scorciatoia all'avvio — a rendere rapida la
        // riapertura di un vault non toccato.
        if inner.fingerprints.get(&doc.id) == Some(&print) {
            return;
        }
        // tantivy non aggiorna: si cancella il termine e si riscrive.
        let term = inner.term_for(&doc.id);
        inner.writer.delete_term(term);

        let f = inner.fields;
        let mut td = TantivyDocument::new();
        td.add_text(f.doc_id, doc.id.as_str());
        td.add_text(f.page_name, doc.id.page_name());
        td.add_text(f.body, &doc.text);
        // Un valore per tag (non una stringa unita): col tokenizer raw ogni
        // valore È un termine, e il termine è la forma canonica — la stessa
        // chiave con cui il kernel aggrega e il pannello interroga.
        for tag in &doc.tags {
            td.add_text(f.tags, canonical_tag(&tag.name));
        }
        if inner.writer.add_document(td).is_err() {
            // Il writer è andato: l'indice non è più affidabile, e mentire è
            // peggio che perdere il documento. Si dimentica l'impronta, così
            // il prossimo passaggio riproverà.
            inner.fingerprints.remove(&doc.id);
            return;
        }
        inner.fingerprints.insert(doc.id.clone(), print);
        inner.dirty = true;
    }

    fn on_document_removed(&mut self, id: &DocId) {
        let inner = self.inner.get_mut().expect("mutex");
        if inner.fingerprints.remove(id).is_none() {
            return;
        }
        let term = inner.term_for(id);
        inner.writer.delete_term(term);
        inner.dirty = true;
    }

    fn reconcile(&mut self, ids: &[DocId]) {
        let inner = self.inner.get_mut().expect("mutex");
        let alive: std::collections::HashSet<&DocId> = ids.iter().collect();
        let dead: Vec<DocId> = inner
            .fingerprints
            .keys()
            .filter(|id| !alive.contains(id))
            .cloned()
            .collect();
        for id in dead {
            let term = inner.term_for(&id);
            inner.writer.delete_term(term);
            inner.fingerprints.remove(&id);
            inner.dirty = true;
        }
    }

    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let inner = self.inner.get_mut().expect("mutex");
        inner.commit()?;
        inner.persist(host)
    }

    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        match query {
            IndexQuery::FullText { query, scope: _, pagination } => {
                let limit = pagination.map(|p| p.limit as usize).unwrap_or(50);
                let items = inner.search(&query, limit)?;
                let total = items.len() as u32;
                Ok(IndexResult::Search(fubmd_abi::PaginatedResult {
                    items,
                    offset: 0,
                    total,
                }))
            }
            // Backlink e outline hanno una sola fonte di verità, il kernel
            // (grafo e modelli): duplicarli qui creerebbe una seconda verità che
            // può divergere. Un indice risponde "non roba mia".
            IndexQuery::Backlinks { .. } => Err(PluginError::BadArgs(
                "backlinks: li serve il grafo del kernel".to_string(),
            )),
            IndexQuery::Outline { .. } => Err(PluginError::BadArgs(
                "outline: la servono i modelli del kernel".to_string(),
            )),
            IndexQuery::Tags => Err(PluginError::BadArgs(
                "tags: li aggrega il kernel dai modelli".to_string(),
            )),
            IndexQuery::Neighbors { .. } => Err(PluginError::BadArgs(
                "neighbors: li serve il grafo del kernel".to_string(),
            )),
            IndexQuery::Properties { .. } => Err(PluginError::BadArgs(
                "properties: non supportate dall'indice full-text".to_string(),
            )),
            IndexQuery::PropertyValues { .. } => Err(PluginError::BadArgs(
                "property values: non supportate dall'indice full-text".to_string(),
            )),
            IndexQuery::VaultHealth { .. } => Err(PluginError::BadArgs(
                "vault health: non supportato dall'indice full-text".to_string(),
            )),
            IndexQuery::Custom { ns, .. } => {
                Err(PluginError::BadArgs(format!("namespace sconosciuto: {ns}")))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MemoryHost;
    use camino::Utf8PathBuf;
    use fubmd_abi::model::Tag;

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

    fn search(idx: &SearchIndex, q: &str) -> Vec<SearchHit> {
        match idx.query(IndexQuery::FullText {
            query: q.to_string(),
            scope: Default::default(),
            pagination: Some(Pagination::first(10)),
        }) {
            Ok(IndexResult::Search(paginated)) => paginated.items,
            other => panic!("atteso Search, trovato {other:?}"),
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
        idx.on_document_indexed(&doc("a.md", "il gatto dorme sul tappeto"));
        idx.on_document_indexed(&doc("b.md", "il cane abbaia forte"));

        let hits = search(&idx, "gatto");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc, DocId::new("a.md"));
        // Lo snippet è testo puro e gli highlight cadono sul termine cercato.
        assert!(!hits[0].snippet.contains('<'));
        let h = hits[0].highlights.first().expect("un highlight");
        assert_eq!(&hits[0].snippet[h.start..h.end], "gatto");
    }

    #[test]
    fn page_name_outranks_body() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        idx.on_document_indexed(&doc("nota/Rust.md", "appunti sparsi di programmazione"));
        idx.on_document_indexed(&doc("altro.md", "rust rust rust rust rust rust"));

        let hits = search(&idx, "rust");
        assert_eq!(hits.len(), 2);
        assert_eq!(
            hits[0].doc,
            DocId::new("nota/Rust.md"),
            "il titolo pesa di più"
        );
    }

    #[test]
    fn conjunction_by_default() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        idx.on_document_indexed(&doc("a.md", "rust asincrono"));
        idx.on_document_indexed(&doc("b.md", "rust sincrono"));

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
        idx.on_document_indexed(&tagged(
            "a.md",
            "niente di rilevante nel corpo",
            &["progetto/fubmd"],
        ));

        let hits = search(&idx, "tags:progetto/fubmd");
        assert_eq!(hits.len(), 1);
        // Match fuori dal corpo: nessun highlight, ma uno snippet leggibile.
        assert!(hits[0].highlights.is_empty());
        assert!(!hits[0].snippet.is_empty());
    }

    #[test]
    fn a_tag_is_a_key_not_prose() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        idx.on_document_indexed(&tagged("nested.md", "", &["progetto/rust"]));
        idx.on_document_indexed(&tagged("plain.md", "", &["rust"]));
        idx.on_document_indexed(&tagged("adiacenti.md", "", &["area", "lavoro"]));
        idx.on_document_indexed(&tagged("composto.md", "", &["area/lavoro"]));

        // `tags:rust` è un termine esatto: il tag annidato non c'entra.
        let hits = search(&idx, "tags:rust");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc, DocId::new("plain.md"));

        // E `tags:area/lavoro` non è una phrase query: `#area #lavoro`
        // adiacenti non sono `#area/lavoro`.
        let hits = search(&idx, "tags:area/lavoro");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc, DocId::new("composto.md"));
    }

    #[test]
    fn tags_are_case_insensitive_but_exact() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        idx.on_document_indexed(&tagged("a.md", "", &["Rust"]));
        idx.on_document_indexed(&tagged("b.md", "", &["rust"]));

        // `#Rust` e `#rust` sono lo stesso tag (chiave canonica), qualunque
        // sia il case della query: il click dal pannello (che mostra la
        // grafia originale) trova le stesse note del conteggio.
        for q in ["tags:rust", "tags:Rust", "tags:RUST"] {
            assert_eq!(search(&idx, q).len(), 2, "query {q}");
        }
    }

    #[test]
    fn update_replaces_previous_content() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        idx.on_document_indexed(&doc("a.md", "vecchio contenuto"));
        assert_eq!(search(&idx, "vecchio").len(), 1);

        idx.on_document_indexed(&doc("a.md", "nuovo contenuto"));
        assert_eq!(search(&idx, "vecchio").len(), 0, "niente duplicati");
        assert_eq!(search(&idx, "nuovo").len(), 1);
        assert_eq!(idx.len(), 1);
    }

    #[test]
    fn removal_deletes_from_index() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        idx.on_document_indexed(&doc("a.md", "effimero"));
        idx.on_document_removed(&DocId::new("a.md"));
        assert_eq!(search(&idx, "effimero").len(), 0);
        assert!(idx.is_empty());
    }

    #[test]
    fn reconcile_drops_what_the_vault_no_longer_has() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        idx.on_document_indexed(&doc("vivo.md", "presente"));
        idx.on_document_indexed(&doc("morto.md", "sparito"));

        idx.reconcile(&[DocId::new("vivo.md")]);

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
        idx.on_document_indexed(&doc("a.md", "contenuto"));
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
            idx.on_document_indexed(&doc("a.md", "contenuto stabile"));
            idx.flush(&mut host).unwrap();
        }

        let mut idx = open(&path, &mut host);
        assert_eq!(idx.len(), 1, "le impronte sopravvivono alla riapertura");
        // Ripassare lo stesso contenuto non produce scritture: è ciò che rende
        // rapida la riapertura di un vault non toccato.
        idx.on_document_indexed(&doc("a.md", "contenuto stabile"));
        assert!(
            !idx.inner.get_mut().unwrap().dirty,
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
            idx.on_document_indexed(&doc("a.md", "contenuto stabile"));
            idx.flush(&mut host).unwrap();
        }
        // Simula il crash fra commit e manifest: l'opstamp non torna.
        let mut m = manifest_of(&host);
        m.opstamp += 1;
        put_manifest(&mut host, &m);

        let mut idx = open(&path, &mut host);
        assert_eq!(idx.len(), 0, "impronte di un'altra epoca: non ci si fida");
        // Il documento si reindicizza, e non si duplica: delete+add.
        idx.on_document_indexed(&doc("a.md", "contenuto stabile"));
        assert_eq!(search(&idx, "stabile").len(), 1);
    }

    #[test]
    fn a_bumped_schema_throws_the_fingerprints_away() {
        let (_g, path) = tmp();
        let mut host = MemoryHost::new();
        {
            let mut idx = open(&path, &mut host);
            idx.on_document_indexed(&doc("a.md", "contenuto"));
            idx.flush(&mut host).unwrap();
        }
        let mut m = manifest_of(&host);
        m.schema_version = SCHEMA_VERSION + 1;
        put_manifest(&mut host, &m);

        let idx = open(&path, &mut host);
        assert_eq!(idx.len(), 0);
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
            idx.on_document_indexed(&doc("a.md", "contenuto"));
            idx.flush(&mut host).unwrap();
        }
        std::fs::write(path.join("meta.json"), b"non sono json").unwrap();

        let mut idx = open(&path, &mut host);
        assert_eq!(idx.len(), 0);
        idx.on_document_indexed(&doc("a.md", "contenuto"));
        assert_eq!(search(&idx, "contenuto").len(), 1);
    }

    #[test]
    fn nonsense_query_is_bad_args_not_a_crash() {
        let (_g, path) = tmp();
        let (idx, _host) = fresh(&path);
        let err = idx.query(IndexQuery::FullText {
            query: "campo_inesistente:valore".to_string(),
            scope: Default::default(),
            pagination: Some(Pagination::first(10)),
        });
        assert!(matches!(err, Err(PluginError::BadArgs(_))));
    }

    #[test]
    fn empty_query_returns_nothing() {
        let (_g, path) = tmp();
        let (mut idx, _host) = fresh(&path);
        idx.on_document_indexed(&doc("a.md", "qualcosa"));
        assert!(search(&idx, "   ").is_empty());
    }

    #[test]
    fn backlinks_are_not_served_here() {
        let (_g, path) = tmp();
        let (idx, _host) = fresh(&path);
        let r = idx.query(IndexQuery::Backlinks {
            target: DocId::new("a.md"),
        });
        assert!(matches!(r, Err(PluginError::BadArgs(_))));
    }

    #[test]
    fn head_of_truncates_on_char_boundaries() {
        assert_eq!(head_of("breve", 10), "breve");
        let s = head_of("però caffè città perché così", 10);
        assert!(s.ends_with('…'));
        assert!(s.chars().count() <= 12);
    }
}
