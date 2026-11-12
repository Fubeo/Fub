//! Il grafo dei link del vault: risoluzione dei link in stile Obsidian e
//! calcolo dei backlink (archi inversi).
//!
//! È **agnostico rispetto al formato**: opera solo su [`DocumentModel`] già
//! parsati. I test lo costruiscono con modelli fatti a mano, senza markdown.
//!
//! # Due specie di arco, una sola macchina
//!
//! Un [`LinkTarget::Wiki`](fub_abi::model::LinkTarget::Wiki) porta un *nome di pagina* e si risolve globalmente
//! (path se contiene `/`, poi nome, poi alias). Un [`LinkTarget::Path`](fub_abi::model::LinkTarget::Path) — il
//! link markdown ordinario, `[testo](note/altra.md)` — porta un *path relativo
//! al documento che lo contiene*, e si risolve solo per path: le regole stanno
//! in [`fub_abi::rules::path`], che è l'unico posto dove la differenza è
//! scritta. Un
//! [`LinkTarget::Url`](fub_abi::model::LinkTarget::Url) non è un arco e non lo diventa.
//!
//! Da qui in giù i due sono indistinguibili: stessa chiave di risoluzione,
//! stessi `watchers`, stessi backlink. Un link markdown a una nota del vault ha
//! il backlink, entra nel grafo e viene riscritto al rename esattamente come un
//! wikilink — perché per l'utente *è* la stessa promessa.
//!
//! # Aggiornamento incrementale (M2)
//!
//! [`LinkGraph::build`] ricostruisce tutto ed è l'**oracolo**: semplice, lineare,
//! ovviamente corretto. [`LinkGraph::upsert`] e [`LinkGraph::remove`] applicano
//! lo stesso risultato con un delta per-documento.
//!
//! Il punto difficile non è aggiungere gli archi del documento toccato, ma
//! sapere **quali altri documenti devono essere ri-risolti**: creare `Nota.md`
//! ruba il nome `nota` a `sub/Nota.md` e sposta i link di terzi; cancellarlo lo
//! restituisce. L'invariante che rende tutto trattabile è che la risoluzione di
//! una chiave `K` dipende *solo* dalle voci `path_index[strip_ext(K)]`,
//! `name_index[K]`, `name_index[strip_ext(K)]` (il nome scritto con la sua
//! estensione, `[[board.canvas]]`), `alias_index[K]`. Quindi:
//!
//! - `watchers`: chiave d'indice → chiavi di link che ne dipendono;
//! - `refs_by_key`: chiave di link → documenti che la usano.
//!
//! Toccando un documento si conoscono le chiavi d'indice che cambia (nome, path,
//! alias, prima e dopo); da lì i `watchers` danno le chiavi di link invalidate e
//! `refs_by_key` i documenti da ri-collegare. Il costo è proporzionale al
//! vicinato, non al vault.
//!
//! Nota di determinismo: `alias_index` e `path_index` sono multi-mappe ordinate
//! come `name_index` (vince il path più corto, poi lessicografico; fra formati
//! diversi dello stesso path, la pagina di prosa: vedi [`ProseFormats`]). Con la
//! vecchia `HashMap<String, DocId>` due documenti omonimi per alias — o `a.md` e
//! `a.txt`, che condividono lo stesso path senza estensione — si sovrascrivevano
//! nell'ordine (casuale) di iterazione della cache dei modelli. Serviva comunque
//! l'ordinamento per sapere chi subentra quando il vincitore viene rimosso.

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use fub_abi::model::{DocId, DocumentModel, Link};
use fub_abi::traits::BacklinkRef;

use fub_abi::rules::media::mime_of;
use fub_abi::rules::path::strip_ext;

mod link_graph;

/// **Ciò che un thread riporta di un documento** quando la fase 2 gira a pezzi:
/// chi è, dove punta, e i backlink che deposita sugli altri.
///
/// Il terzo campo è una lista di *coppie* e non una mappa perché chi lo produce
/// non può scrivere sul grafo: i thread risolvono in sola lettura
/// (`graph_ref: &LinkGraph`) e chi cuce gli archi inversi è il chiamante, dopo
/// il `join` — con la mappa scritta da un solo lato, che è la ragione per cui
/// la fase 2 si può spezzare.
///
/// È un alias e non una struct perché a leggerlo è un `Vec` locale in una
/// funzione sola: dargli tre nomi di campo vorrebbe dire dichiarare un tipo
/// pubblico per un valore che non esce da lì. Il nome esiste perché la firma
/// scritta per esteso — tre livelli di tuple dentro due `Vec` — è quella che
/// `clippy::type_complexity` rifiuta, e aveva ragione.
type ResolvedDoc = (DocId, Vec<DocId>, Vec<(DocId, BacklinkRef)>);

/// Ciò che il grafo legge di un documento: identità, alias, link.
///
/// È l'interfaccia che rende il grafo **autosufficiente** rispetto a come il
/// chiamante tiene i documenti: il `Workspace` lo alimenta dai soli metadati
/// in cache (split metadata/body di M2), i test dai `DocumentModel` interi.
/// Il grafo non guarda mai corpo o testo — dichiararlo nella firma lo rende
/// un fatto, non una convenzione.
pub trait GraphSource {
    fn graph_id(&self) -> &DocId;
    fn graph_aliases(&self) -> Vec<String>;
    fn graph_links(&self) -> &[Link];
}

impl GraphSource for DocumentModel {
    fn graph_id(&self) -> &DocId {
        &self.id
    }

    fn graph_aliases(&self) -> Vec<String> {
        self.frontmatter.aliases()
    }

    fn graph_links(&self) -> &[Link] {
        &self.links
    }
}

/// Fotografia di ciò che [`LinkGraph::build`] legge.
///
/// Si clona sotto prestito **condiviso** (id, alias, link: niente corpo, niente
/// outline). La costruzione del grafo, che è CPU sull'insieme intero, gira
/// **senza** lucchetto. L'epoca è la generazione dei metadati da cui è nata: se
/// nel frattempo una scrittura li ha toccati, chi installa rifà il grafo dai
/// metadati correnti invece di coprire la scrittura con una fotografia vecchia.
pub struct GraphSources {
    docs: Vec<GraphDoc>,
    epoch: u64,
    prose: ProseFormats,
}

struct GraphDoc {
    id: DocId,
    aliases: Vec<String>,
    links: Vec<Link>,
}

impl GraphSource for GraphDoc {
    fn graph_id(&self) -> &DocId {
        &self.id
    }

    fn graph_aliases(&self) -> Vec<String> {
        self.aliases.clone()
    }

    fn graph_links(&self) -> &[Link] {
        &self.links
    }
}

/// Un [`LinkGraph`] costruito da una [`GraphSources`], con l'epoca di quella
/// fotografia. Opaco: lo produce [`GraphSources::build`] e lo consuma
/// [`crate::Workspace::finish_index_with_graph`].
pub struct BuiltGraph {
    pub(crate) graph: LinkGraph,
    pub(crate) epoch: u64,
}

impl GraphSources {
    pub(crate) fn from_docs<'a, S: GraphSource + 'a>(
        docs: impl IntoIterator<Item = &'a S>,
        epoch: u64,
        prose: ProseFormats,
    ) -> Self {
        GraphSources {
            docs: docs
                .into_iter()
                .map(|d| GraphDoc {
                    id: d.graph_id().clone(),
                    aliases: d.graph_aliases(),
                    links: d.graph_links().to_vec(),
                })
                .collect(),
            epoch,
            prose,
        }
    }

    /// Ricostruisce il grafo. Costa O(documenti) di CPU e **non** tiene
    /// nessun lucchetto: la fotografia è già in mano.
    pub fn build(self) -> BuiltGraph {
        let _phase = tracing::info_span!(target: "fub.apertura", "rebuild_graph").entered();
        BuiltGraph {
            graph: LinkGraph::build_with(self.docs.iter(), self.prose),
            epoch: self.epoch,
        }
    }
}

/// Un link di un documento, già normalizzato a chiave di risoluzione.
#[derive(Clone, Debug)]
struct LinkRef {
    key: String,
    /// Lo stesso riferimento **senza** il passo che collassa le maiuscole: è la
    /// forma con cui l'utente l'ha scritto, e serve a scegliere fra i candidati
    /// che la chiave mette insieme. Non entra in nessun indice — gli indici
    /// restano indicizzati per chiave, quindi l'invalidazione incrementale non
    /// cambia di una riga.
    exact: String,
    kind: RefKind,
    context: Option<String>,
}

/// Come si risolve una chiave. Non è un dettaglio di provenienza: è *quali
/// indici* si consultano, e i due insiemi non coincidono.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RefKind {
    /// Wikilink: path (se la chiave contiene `/`), poi nome, poi alias.
    Wiki,
    /// Link markdown: **solo** path, già risolto contro la cartella del
    /// documento sorgente. Un `[t](Mario)` non deve pescare l'alias "Mario":
    /// l'utente ha scritto un path, e nel path non ci sono alias.
    Path,
}

/// Le chiavi con cui un documento è raggiungibile dalla risoluzione.
#[derive(Clone, Debug, Default)]
struct DocKeys {
    name: String,
    path: String,
    aliases: Vec<String>,
}

/// Le estensioni dei formati che dichiarano un sorgente di **prosa**
/// ([`source::PROSE`](fub_abi::options::source::PROSE)).
///
/// Servono a uno spareggio solo: documenti con lo stesso path senza estensione
/// e formati diversi. Accanto a `Progetto.md`, `Progetto.canvas` e
/// `Progetto.base`, `[[Progetto]]` nomina la pagina, come in Obsidian, e non il
/// primo in ordine alfabetico. Il kernel lo sa dalla dichiarazione del formato,
/// non dal nome della sua estensione. Chi vuole un altro formato scrive
/// l'estensione (`[[Progetto.canvas]]`).
///
/// Il registro dei formati è fisso per la vita del `Workspace`, quindi lo è
/// anche questo insieme: nessun documento cambia posto negli indici senza
/// essere toccato.
#[derive(Clone, Debug, Default)]
pub struct ProseFormats(Arc<HashSet<String>>);

impl ProseFormats {
    /// Le estensioni, in qualunque caso: il confronto è disarmato come nel
    /// registro dei formati.
    pub fn new<S: AsRef<str>>(extensions: impl IntoIterator<Item = S>) -> Self {
        ProseFormats(Arc::new(
            extensions
                .into_iter()
                .map(|ext| ext.as_ref().to_lowercase())
                .collect(),
        ))
    }

    fn names(&self, id: &DocId) -> bool {
        let path = id.as_str();
        let stem = stem_of(path);
        !self.0.is_empty()
            && stem.len() < path.len()
            && self.0.contains(&path[stem.len() + 1..].to_lowercase())
    }
}

#[derive(Default)]
pub struct LinkGraph {
    /// Chi vince fra formati diversi dello stesso path.
    prose: ProseFormats,
    /// page name (minuscolo) → documenti con quel nome, in ordine di priorità.
    name_index: HashMap<String, Vec<DocId>>,
    /// alias (minuscolo) → documenti che lo dichiarano, in ordine di priorità.
    alias_index: HashMap<String, Vec<DocId>>,
    /// path relativo senza estensione (minuscolo) → documenti, in ordine.
    path_index: HashMap<String, Vec<DocId>>,
    /// documento target → riferimenti entranti.
    backlinks: HashMap<DocId, Vec<BacklinkRef>>,
    /// documento → target risolti uscenti (nell'ordine dei link nel sorgente).
    outgoing: HashMap<DocId, Vec<DocId>>,

    // --- stato per l'aggiornamento incrementale --------------------------
    /// documento → i suoi wikilink, in ordine.
    links: HashMap<DocId, Vec<LinkRef>>,
    /// documento → chiavi che contribuisce agli indici (per staccarlo).
    keys: HashMap<DocId, DocKeys>,
    /// chiave d'indice → chiavi di link la cui risoluzione ne dipende.
    watchers: HashMap<String, HashSet<String>>,
    /// chiave di link → documenti che la usano.
    refs_by_key: HashMap<String, BTreeSet<DocId>>,
}

/// Le chiavi il cui indice cambia passando da `before` ad `after`, per ruolo:
/// la stessa stringa passata da alias a nome cambia la risoluzione, e conta.
fn changed_keys(before: &DocKeys, after: &DocKeys) -> HashSet<String> {
    let mut touched = HashSet::new();
    if before.name != after.name {
        touched.insert(before.name.clone());
        touched.insert(after.name.clone());
    }
    if before.path != after.path {
        touched.insert(before.path.clone());
        touched.insert(after.path.clone());
    }
    let old: HashSet<&String> = before.aliases.iter().collect();
    let new: HashSet<&String> = after.aliases.iter().collect();
    touched.extend(old.symmetric_difference(&new).map(|key| (*key).clone()));
    touched
}

/// Le voci d'indice da cui dipende la risoluzione di una chiave di link.
/// `resolve_key` guarda `path_index[strip_ext(key)]`, `name_index[key]` e
/// `alias_index[key]`; `resolve_path_key` guarda `path_index` su entrambe. In
/// tutti i casi: al più due chiavi distinte, ed è lo stesso paio — per questo
/// wikilink e link markdown condividono `watchers` senza doversi distinguere.
fn dep_keys(key: &str) -> Vec<String> {
    let stripped = strip_ext(key);
    if stripped == key {
        vec![key.to_string()]
    } else {
        vec![key.to_string(), stripped]
    }
}

fn first_of(index: &HashMap<String, Vec<DocId>>, key: &str) -> Option<DocId> {
    index.get(key).and_then(|ids| ids.first().cloned())
}

/// Inserisce mantenendo l'ordine di priorità (idempotente).
fn insert_sorted(
    index: &mut HashMap<String, Vec<DocId>>,
    prose: &ProseFormats,
    key: &str,
    id: &DocId,
) {
    let ids = index.entry(key.to_string()).or_default();
    if let Err(pos) = ids.binary_search_by(|probe| precedence(prose, probe, id)) {
        ids.insert(pos, id.clone());
    }
}

fn remove_sorted(
    index: &mut HashMap<String, Vec<DocId>>,
    prose: &ProseFormats,
    key: &str,
    id: &DocId,
) {
    let Some(ids) = index.get_mut(key) else {
        return;
    };
    if let Ok(pos) = ids.binary_search_by(|probe| precedence(prose, probe, id)) {
        ids.remove(pos);
    }
    if ids.is_empty() {
        index.remove(key);
    }
}

/// Ordine fra candidati omonimi: vince il path più corto (più vicino alla
/// radice), a parità quello lessicograficamente minore.
///
/// Con un'eccezione sola: fra documenti con lo stesso path senza estensione
/// (`Progetto.md`, `Progetto.canvas`) vince prima la pagina di prosa
/// ([`ProseFormats`]). L'ordine resta totale, perché un tale gruppo è contiguo
/// nell'ordine dei path: i suoi membri coincidono fino al punto
/// dell'estensione, e ogni altro path sta prima o dopo di tutti loro.
fn precedence(prose: &ProseFormats, a: &DocId, b: &DocId) -> Ordering {
    segments(a).cmp(&segments(b)).then_with(|| {
        let by_path = a.as_str().cmp(b.as_str());
        if stem_of(a.as_str()) == stem_of(b.as_str()) {
            prose.names(b).cmp(&prose.names(a)).then(by_path)
        } else {
            by_path
        }
    })
}

/// Il path senza l'ultima estensione, come [`strip_ext`] ma senza allocare.
fn stem_of(path: &str) -> &str {
    match path.rsplit_once('.') {
        Some((stem, ext)) if !ext.contains('/') => stem,
        _ => path,
    }
}

/// La chiave finisce con l'estensione di un allegato, cioè di un tipo della
/// [tabella dei MIME](fub_abi::rules::media): nomina un file di quel tipo, e
/// non si legge come un nome o un path senza estensione.
///
/// Senza questa regola `[[Bando.pdf]]` e `[t](Bando.pdf)` nominerebbero
/// `Bando.pdf.fubann`, le annotazioni del PDF, o una `Bando.pdf.md` che ne
/// parla: il loro nome pagina è `Bando.pdf`, e il grafo, che conosce solo i
/// documenti, li preferirebbe al PDF accanto. Così il grafo risponde di no e
/// il PDF lo trova chi risolve gli allegati. Il punto di `v1.2` resta nel
/// nome, perché `2` non è un tipo; il documento che porta l'estensione per
/// intero (`[[acqua.svg]]` con `acqua.svg`) si raggiunge come prima, dal suo
/// nome di file. La risoluzione di una chiave guarda al più le voci di prima,
/// quindi i `watchers` restano giusti.
fn names_an_attachment(key: &str) -> bool {
    mime_of(&DocId::new(key)).is_some()
}

/// Il nome del file, con la sua estensione.
fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn segments(id: &DocId) -> usize {
    id.as_str().matches('/').count()
}

#[cfg(test)]
mod tests;
