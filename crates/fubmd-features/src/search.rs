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
//! 2. **Riparte in fretta.** L'indice vive su disco in `.fubmd-data/index/`.
//!    Alla riapertura ogni documento ripassa da `on_document_indexed`, ma
//!    l'impronta del contenuto (vedi [`fingerprint`]) fa saltare gli immutati:
//!    su un vault non toccato la riapertura non scrive nulla.
//! 3. **Non si affeziona ai propri dati.** Qualunque dubbio sulla coerenza fra
//!    indice e manifest si risolve buttando via l'indice e ricostruendolo: la
//!    verità è il vault, questo è solo stato derivato.

use std::collections::HashMap;
use std::sync::Mutex;

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::model::{DocId, DocumentModel, Span};
use fubmd_abi::traits::{IndexProvider, IndexQuery, IndexResult, SearchHit};
use fubmd_abi::PluginError;
use serde::{Deserialize, Serialize};
use tantivy::query::QueryParser;
use tantivy::schema::{Field, Schema, Value, STORED, STRING, TEXT};
use tantivy::snippet::SnippetGenerator;
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

/// Versione dello schema dell'indice. **Va incrementata** ad ogni modifica dei
/// campi, delle opzioni o del tokenizer: un manifest con versione diversa fa
/// buttare via l'indice e ricostruirlo da zero.
const SCHEMA_VERSION: u32 = 1;

/// Nome del manifest accanto all'indice (vedi [`Manifest`]).
const MANIFEST: &str = "fubmd-manifest.json";

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
/// che manifest e indice sono **due file che possono divergere** (un crash fra
/// il commit e la scrittura del manifest). Il guardiano è l'`opstamp`: tantivy
/// lo incrementa ad ogni commit, e un manifest che non cita l'opstamp
/// attualmente committato è per definizione di un'altra epoca — si buttano le
/// impronte, non l'indice, e i documenti si reindicizzano (delete+add è
/// idempotente). Mai il contrario: un manifest creduto valido a sproposito
/// farebbe *saltare* documenti, cioè mentire in silenzio.
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
    let tags = b.add_text_field("tags", TEXT);
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
    dir: Utf8PathBuf,
    index: Index,
    writer: IndexWriter,
    reader: IndexReader,
    fields: Fields,
    fingerprints: HashMap<DocId, u64>,
    /// Ci sono scritture accettate ma non ancora committate?
    dirty: bool,
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
    /// Apre (o crea) l'indice nella cartella dati del vault.
    ///
    /// `vault_root` è la radice del vault: l'indice finisce in
    /// `.fubmd-data/index/`, che la scansione del vault già ignora.
    pub fn open(vault_root: &Utf8Path) -> Result<Self, PluginError> {
        Self::open_dir(&vault_root.join(".fubmd-data").join("index"))
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

        let fingerprints = load_fingerprints(dir, &index);

        Ok(SearchIndex {
            inner: Mutex::new(Inner {
                dir: dir.to_owned(),
                index,
                writer,
                reader,
                fields,
                fingerprints,
                dirty: false,
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

/// Legge le impronte dal manifest, ma solo se il manifest parla della stessa
/// epoca dell'indice (vedi [`Manifest`]). Nel dubbio: nessuna impronta, cioè
/// tutto verrà reindicizzato.
fn load_fingerprints(dir: &Utf8Path, index: &Index) -> HashMap<DocId, u64> {
    let empty = HashMap::new();
    let Ok(raw) = std::fs::read_to_string(dir.join(MANIFEST)) else {
        return empty;
    };
    let Ok(manifest) = serde_json::from_str::<Manifest>(&raw) else {
        return empty;
    };
    if manifest.schema_version != SCHEMA_VERSION {
        return empty;
    }
    let Ok(metas) = index.load_metas() else {
        return empty;
    };
    if metas.opstamp != manifest.opstamp {
        return empty;
    }
    manifest
        .docs
        .into_iter()
        .map(|(id, h)| (DocId::new(id), h))
        .collect()
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
    fn commit(&mut self) -> Result<(), PluginError> {
        if !self.dirty {
            return Ok(());
        }
        let opstamp = self
            .writer
            .commit()
            .map_err(|e| PluginError::Internal(format!("commit indice: {e}")))?;
        self.reader
            .reload()
            .map_err(|e| PluginError::Internal(format!("reload indice: {e}")))?;
        self.dirty = false;
        // Il manifest si scrive DOPO il commit e cita il suo opstamp: se
        // qualcosa va storto qui, alla riapertura le impronte risulteranno di
        // un'altra epoca e si reindicizzerà — mai il contrario.
        self.write_manifest(opstamp)
    }

    fn write_manifest(&self, opstamp: u64) -> Result<(), PluginError> {
        let manifest = Manifest {
            schema_version: SCHEMA_VERSION,
            opstamp,
            docs: self
                .fingerprints
                .iter()
                .map(|(id, h)| (id.as_str().to_string(), *h))
                .collect(),
        };
        let raw = serde_json::to_string(&manifest)
            .map_err(|e| PluginError::Internal(format!("manifest: {e}")))?;
        let path = self.dir.join(MANIFEST);
        std::fs::write(&path, raw).map_err(|e| io_err(&path, e))
    }

    fn search(&mut self, query: &str, limit: usize) -> Result<Vec<SearchHit>, PluginError> {
        // Chi interroga vede le proprie scritture, anche senza flush.
        self.commit()?;
        if query.trim().is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let searcher = self.reader.searcher();
        let f = self.fields;

        let mut parser = QueryParser::for_index(&self.index, vec![f.page_name, f.body, f.tags]);
        parser.set_field_boost(f.page_name, PAGE_NAME_BOOST);
        // Più termini = più stretto, come si aspetta chi cerca: "rust async"
        // vuole le note che parlano di entrambi.
        parser.set_conjunction_by_default();
        let parsed = parser
            .parse_query(query)
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
        if !doc.tags.is_empty() {
            let tags: Vec<&str> = doc.tags.iter().map(|t| t.name.as_str()).collect();
            td.add_text(f.tags, tags.join(" "));
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

    fn flush(&mut self) -> Result<(), PluginError> {
        self.inner.get_mut().expect("mutex").commit()
    }

    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        match query {
            IndexQuery::FullText { query, limit } => {
                Ok(IndexResult::Search(inner.search(&query, limit as usize)?))
            }
            // I backlink hanno una sola fonte di verità, il grafo del kernel:
            // duplicarli qui creerebbe una seconda verità che può divergere.
            IndexQuery::Backlinks { .. } => Err(PluginError::BadArgs(
                "backlinks: li serve il grafo del kernel".to_string(),
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

    fn search(idx: &SearchIndex, q: &str) -> Vec<SearchHit> {
        match idx.query(IndexQuery::FullText {
            query: q.to_string(),
            limit: 10,
        }) {
            Ok(IndexResult::Search(hits)) => hits,
            other => panic!("atteso Search, trovato {other:?}"),
        }
    }

    #[test]
    fn finds_by_body_and_reports_highlights() {
        let (_g, path) = tmp();
        let mut idx = SearchIndex::open_dir(&path).unwrap();
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
        let mut idx = SearchIndex::open_dir(&path).unwrap();
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
        let mut idx = SearchIndex::open_dir(&path).unwrap();
        idx.on_document_indexed(&doc("a.md", "rust asincrono"));
        idx.on_document_indexed(&doc("b.md", "rust sincrono"));

        assert_eq!(search(&idx, "rust asincrono").len(), 1);
    }

    #[test]
    fn finds_by_tag() {
        let (_g, path) = tmp();
        let mut idx = SearchIndex::open_dir(&path).unwrap();
        let mut m = doc("a.md", "niente di rilevante nel corpo");
        m.tags = vec![Tag {
            name: "progetto/fubmd".into(),
            span: Span::EMPTY,
        }];
        idx.on_document_indexed(&m);

        let hits = search(&idx, "fubmd");
        assert_eq!(hits.len(), 1);
        // Match fuori dal corpo: nessun highlight, ma uno snippet leggibile.
        assert!(hits[0].highlights.is_empty());
        assert!(!hits[0].snippet.is_empty());
    }

    #[test]
    fn update_replaces_previous_content() {
        let (_g, path) = tmp();
        let mut idx = SearchIndex::open_dir(&path).unwrap();
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
        let mut idx = SearchIndex::open_dir(&path).unwrap();
        idx.on_document_indexed(&doc("a.md", "effimero"));
        idx.on_document_removed(&DocId::new("a.md"));
        assert_eq!(search(&idx, "effimero").len(), 0);
        assert!(idx.is_empty());
    }

    #[test]
    fn reconcile_drops_what_the_vault_no_longer_has() {
        let (_g, path) = tmp();
        let mut idx = SearchIndex::open_dir(&path).unwrap();
        idx.on_document_indexed(&doc("vivo.md", "presente"));
        idx.on_document_indexed(&doc("morto.md", "sparito"));

        idx.reconcile(&[DocId::new("vivo.md")]);

        assert_eq!(search(&idx, "presente").len(), 1);
        assert_eq!(search(&idx, "sparito").len(), 0);
    }

    #[test]
    fn reopening_skips_unchanged_documents() {
        let (_g, path) = tmp();
        {
            let mut idx = SearchIndex::open_dir(&path).unwrap();
            idx.on_document_indexed(&doc("a.md", "contenuto stabile"));
            idx.flush().unwrap();
        }

        let mut idx = SearchIndex::open_dir(&path).unwrap();
        assert_eq!(idx.len(), 1, "le impronte sopravvivono alla riapertura");
        // Ripassare lo stesso contenuto non produce scritture: è ciò che rende
        // rapida la riapertura di un vault non toccato.
        idx.on_document_indexed(&doc("a.md", "contenuto stabile"));
        assert!(
            !idx.inner.get_mut().unwrap().dirty,
            "un documento immutato non sporca l'indice"
        );
        assert_eq!(search(&idx, "stabile").len(), 1);
    }

    #[test]
    fn reopening_reindexes_when_the_manifest_is_of_another_epoch() {
        let (_g, path) = tmp();
        {
            let mut idx = SearchIndex::open_dir(&path).unwrap();
            idx.on_document_indexed(&doc("a.md", "contenuto stabile"));
            idx.flush().unwrap();
        }
        // Simula il crash fra commit e manifest: l'opstamp non torna.
        let manifest_path = path.join(MANIFEST);
        let raw = std::fs::read_to_string(&manifest_path).unwrap();
        let mut m: Manifest = serde_json::from_str(&raw).unwrap();
        m.opstamp += 1;
        std::fs::write(&manifest_path, serde_json::to_string(&m).unwrap()).unwrap();

        let mut idx = SearchIndex::open_dir(&path).unwrap();
        assert_eq!(idx.len(), 0, "impronte di un'altra epoca: non ci si fida");
        // Il documento si reindicizza, e non si duplica: delete+add.
        idx.on_document_indexed(&doc("a.md", "contenuto stabile"));
        assert_eq!(search(&idx, "stabile").len(), 1);
    }

    #[test]
    fn a_bumped_schema_throws_the_index_away() {
        let (_g, path) = tmp();
        {
            let mut idx = SearchIndex::open_dir(&path).unwrap();
            idx.on_document_indexed(&doc("a.md", "contenuto"));
            idx.flush().unwrap();
        }
        let manifest_path = path.join(MANIFEST);
        let raw = std::fs::read_to_string(&manifest_path).unwrap();
        let mut m: Manifest = serde_json::from_str(&raw).unwrap();
        m.schema_version = SCHEMA_VERSION + 1;
        std::fs::write(&manifest_path, serde_json::to_string(&m).unwrap()).unwrap();

        let idx = SearchIndex::open_dir(&path).unwrap();
        assert_eq!(idx.len(), 0);
    }

    #[test]
    fn a_corrupt_index_is_rebuilt_not_diagnosed() {
        let (_g, path) = tmp();
        {
            let mut idx = SearchIndex::open_dir(&path).unwrap();
            idx.on_document_indexed(&doc("a.md", "contenuto"));
            idx.flush().unwrap();
        }
        std::fs::write(path.join("meta.json"), b"non sono json").unwrap();

        let mut idx = SearchIndex::open_dir(&path).expect("si riapre comunque");
        assert_eq!(idx.len(), 0);
        idx.on_document_indexed(&doc("a.md", "contenuto"));
        assert_eq!(search(&idx, "contenuto").len(), 1);
    }

    #[test]
    fn nonsense_query_is_bad_args_not_a_crash() {
        let (_g, path) = tmp();
        let idx = SearchIndex::open_dir(&path).unwrap();
        let err = idx.query(IndexQuery::FullText {
            query: "campo_inesistente:valore".to_string(),
            limit: 10,
        });
        assert!(matches!(err, Err(PluginError::BadArgs(_))));
    }

    #[test]
    fn empty_query_returns_nothing() {
        let (_g, path) = tmp();
        let mut idx = SearchIndex::open_dir(&path).unwrap();
        idx.on_document_indexed(&doc("a.md", "qualcosa"));
        assert!(search(&idx, "   ").is_empty());
    }

    #[test]
    fn backlinks_are_not_served_here() {
        let (_g, path) = tmp();
        let idx = SearchIndex::open_dir(&path).unwrap();
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
