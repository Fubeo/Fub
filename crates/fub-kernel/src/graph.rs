//! Il grafo dei link del vault: risoluzione dei link in stile Obsidian e
//! calcolo dei backlink (archi inversi).
//!
//! È **agnostico rispetto al formato**: opera solo su [`DocumentModel`] già
//! parsati. I test lo costruiscono con modelli fatti a mano, senza markdown.
//!
//! # Due specie di arco, una sola macchina
//!
//! Un [`LinkTarget::Wiki`] porta un *nome di pagina* e si risolve globalmente
//! (path se contiene `/`, poi nome, poi alias). Un [`LinkTarget::Path`] — il
//! link markdown ordinario, `[testo](note/altra.md)` — porta un *path relativo
//! al documento che lo contiene*, e si risolve solo per path: le regole stanno
//! in [`fub_abi::rules::path`], che è l'unico posto dove la differenza è
//! scritta. Un
//! [`LinkTarget::Url`] non è un arco e non lo diventa.
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
//! `name_index[K]`, `alias_index[K]`. Quindi:
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
//! come `name_index` (vince il path più corto, poi lessicografico). Con la
//! vecchia `HashMap<String, DocId>` due documenti omonimi per alias — o `a.md` e
//! `a.txt`, che condividono lo stesso path senza estensione — si sovrascrivevano
//! nell'ordine (casuale) di iterazione della cache dei modelli. Serviva comunque
//! l'ordinamento per sapere chi subentra quando il vincitore viene rimosso.

use std::collections::{BTreeSet, HashMap, HashSet};

use fub_abi::model::{DocId, DocumentModel, Link, LinkTarget};
use fub_abi::traits::{BacklinkRef, LinkDirection, NeighborRef};

use fub_abi::rules::path::{resolution_key, resolve_against, strip_ext};

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

/// Un link di un documento, già normalizzato a chiave di risoluzione.
#[derive(Clone, Debug)]
struct LinkRef {
    key: String,
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

#[derive(Default)]
pub struct LinkGraph {
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

impl LinkGraph {
    /// Ricostruisce l'intero grafo da tutti i modelli del vault.
    ///
    /// Resta l'**oracolo** dell'aggiornamento incrementale: due fasi, nessuna
    /// invalidazione, nessuna astuzia (vedi `tests/graph_incremental.rs`).
    pub fn build<'a, S>(docs: impl IntoIterator<Item = &'a S>) -> Self
    where
        S: GraphSource + 'a,
    {
        let docs: Vec<&S> = docs.into_iter().collect();
        let mut graph = LinkGraph::default();

        // Fase 1: indici di nome/alias/path e registrazione dei link (serve
        // conoscere tutti i doc prima di poter risolvere qualsiasi link).
        let mut touched = HashSet::new();
        for doc in &docs {
            graph.attach_indexes(*doc, &mut touched);
            graph.register_links(*doc);
        }

        // Fase 2: risoluzione dei link e archi inversi.
        for doc in &docs {
            graph.link_document(doc.graph_id());
        }
        graph
    }

    /// Inserisce o aggiorna un documento, ri-collegando **solo** i documenti la
    /// cui risoluzione può esserne cambiata.
    ///
    /// Il risultato osservabile è identico a un [`LinkGraph::build`] su tutti i
    /// documenti presenti dopo l'operazione.
    pub fn upsert<S: GraphSource + ?Sized>(&mut self, doc: &S) {
        let mut touched = HashSet::new();
        let id = doc.graph_id().clone();

        // Fuori: vecchie chiavi, vecchi link, vecchi archi uscenti.
        self.detach_indexes(&id, &mut touched);
        self.unregister_links(&id);
        self.unlink_document(&id);

        // Dentro: nuove chiavi e nuovi link (ancora senza risolvere).
        self.attach_indexes(doc, &mut touched);
        self.register_links(doc);

        // Ri-collega il documento e chiunque dipendesse dalle chiavi toccate.
        let mut dirty = self.dependents(&touched);
        dirty.insert(id);
        self.relink_all(dirty);
    }

    /// Rimuove un documento e ri-collega chi lo referenziava.
    pub fn remove(&mut self, id: &DocId) {
        if !self.keys.contains_key(id) {
            return;
        }
        let mut touched = HashSet::new();
        self.detach_indexes(id, &mut touched);
        self.unregister_links(id);
        self.unlink_document(id);
        self.links.remove(id);
        // Nessuno può più puntare a un documento che non esiste: le voci
        // residue sarebbero comunque tolte dal relink dei sorgenti, ma è più
        // onesto non lasciarle in giro nemmeno per un istante.
        self.backlinks.remove(id);

        let dirty = self.dependents(&touched);
        self.relink_all(dirty);
    }

    /// Risolve il nome/pagina di un wikilink a un [`DocId`], regole Obsidian:
    /// per path se contiene `/`, altrimenti per nome (fra omonimi vince il
    /// più vicino alla radice), infine per alias.
    pub fn resolve_wiki(&self, page: &str) -> Option<DocId> {
        self.resolve_key(&resolution_key(page))
    }

    /// Risolve la destinazione di un link markdown (`[t](note/altra.md)`)
    /// scritta dentro `source`, a cui è **relativa**.
    ///
    /// È pubblica perché non serve solo al grafo: la riscrittura al rename e
    /// (a valle) la navigazione da un'anteprima devono rispondere alla stessa
    /// domanda con la stessa risposta.
    pub fn resolve_path(&self, source: &DocId, target: &str) -> Option<DocId> {
        let path = resolve_against(source, target)?;
        self.resolve_path_key(&resolution_key(&path))
    }

    /// Backlink verso un documento (riferimenti entranti), ordinati per sorgente.
    pub fn backlinks(&self, target: &DocId) -> Vec<BacklinkRef> {
        let mut refs = self.backlinks.get(target).cloned().unwrap_or_default();
        // Ordinamento *stabile*: fra riferimenti dallo stesso sorgente resta
        // l'ordine dei link nel documento, che è quello del rebuild.
        refs.sort_by(|a, b| a.source.cmp(&b.source));
        refs
    }

    /// Link uscenti risolti da un documento.
    pub fn outgoing(&self, source: &DocId) -> Vec<DocId> {
        self.outgoing.get(source).cloned().unwrap_or_default()
    }

    /// I documenti raggiungibili da `doc` in al più `depth` passi, nel verso
    /// chiesto — la camminata che serve a una vista a grafo (7.3) e che
    /// [`IndexQuery::Neighbors`] espone nel contratto.
    ///
    /// È un attraversamento in ampiezza: ogni documento compare **una volta
    /// sola**, alla distanza minima a cui lo si raggiunge, e `via` è l'anello
    /// da cui ci si è arrivati (l'albero di visita, non l'insieme di tutti gli
    /// archi). Il documento di partenza non è vicino di sé stesso, e nemmeno lo
    /// diventa un ciclo che ci ritorna sopra.
    ///
    /// L'ordine è deterministico — distanza crescente, poi `DocId` — perché la
    /// risposta è paginata: senza un ordine stabile la seconda pagina
    /// ripeterebbe pezzi della prima.
    ///
    /// [`IndexQuery::Neighbors`]: fub_abi::traits::IndexQuery::Neighbors
    pub fn neighbors(&self, doc: &DocId, direction: LinkDirection, depth: u8) -> Vec<NeighborRef> {
        if depth == 0 {
            return Vec::new();
        }
        let step = |id: &DocId| -> Vec<DocId> {
            let mut next: BTreeSet<DocId> = BTreeSet::new();
            if matches!(direction, LinkDirection::Outbound | LinkDirection::Both) {
                next.extend(self.outgoing(id));
            }
            if matches!(direction, LinkDirection::Inbound | LinkDirection::Both) {
                next.extend(self.backlinks(id).into_iter().map(|b| b.source));
            }
            next.into_iter().collect()
        };

        let mut seen: HashSet<DocId> = HashSet::from([doc.clone()]);
        let mut out = Vec::new();
        let mut frontier = vec![doc.clone()];
        for step_no in 1..=depth {
            let mut next_frontier = Vec::new();
            for from in &frontier {
                for to in step(from) {
                    if !seen.insert(to.clone()) {
                        continue;
                    }
                    out.push(NeighborRef {
                        doc: to.clone(),
                        via: from.clone(),
                        depth: step_no,
                    });
                    next_frontier.push(to);
                }
            }
            if next_frontier.is_empty() {
                break;
            }
            frontier = next_frontier;
        }
        // Dentro un anello l'ordine è quello dei `via`, che è già deterministico
        // (la frontiera nasce ordinata); qui si aggiunge l'ordine per bersaglio,
        // che è quello che un elenco mostra.
        out.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.doc.cmp(&b.doc)));
        out
    }

    /// I documenti presenti nel grafo, ordinati.
    pub fn documents(&self) -> Vec<DocId> {
        let mut ids: Vec<DocId> = self.keys.keys().cloned().collect();
        ids.sort();
        ids
    }

    // --- risoluzione ------------------------------------------------------

    /// Come [`Self::resolve_wiki`] ma su una chiave già normalizzata.
    fn resolve_key(&self, key: &str) -> Option<DocId> {
        if key.is_empty() {
            return None;
        }
        if key.contains('/') {
            if let Some(id) = first_of(&self.path_index, &strip_ext(key)) {
                return Some(id);
            }
        }
        if let Some(id) = first_of(&self.name_index, key) {
            return Some(id);
        }
        first_of(&self.alias_index, key)
    }

    /// Risoluzione di una chiave di **path** (già normalizzata e già assoluta
    /// rispetto alla radice del vault).
    ///
    /// Prima l'accoppiamento esatto — `note/a.md` è `note/a.md`, non `note/a.txt`
    /// che gli sta accanto — e solo in sua assenza la chiave senza estensione,
    /// che è quella dei wikilink. È la regola 2 di [`crate::pathlink`]; qui c'è
    /// perché `path_index` è indicizzato *senza* estensione e l'esatto va
    /// cercato fra i suoi candidati.
    fn resolve_path_key(&self, key: &str) -> Option<DocId> {
        if key.is_empty() {
            return None;
        }
        if let Some(ids) = self.path_index.get(&strip_ext(key)) {
            if let Some(id) = ids.iter().find(|id| resolution_key(id.as_str()) == key) {
                return Some(id.clone());
            }
        }
        first_of(&self.path_index, key)
    }

    // --- indici di nome/alias/path ----------------------------------------

    fn attach_indexes<S: GraphSource + ?Sized>(&mut self, doc: &S, touched: &mut HashSet<String>) {
        let id = doc.graph_id();
        let keys = DocKeys {
            name: resolution_key(id.page_name()),
            path: resolution_key(&strip_ext(id.as_str())),
            aliases: doc
                .graph_aliases()
                .iter()
                .map(|a| resolution_key(a))
                .collect(),
        };
        insert_sorted(&mut self.name_index, &keys.name, id);
        insert_sorted(&mut self.path_index, &keys.path, id);
        for alias in &keys.aliases {
            insert_sorted(&mut self.alias_index, alias, id);
        }
        touched.insert(keys.name.clone());
        touched.insert(keys.path.clone());
        touched.extend(keys.aliases.iter().cloned());
        self.keys.insert(id.clone(), keys);
    }

    fn detach_indexes(&mut self, id: &DocId, touched: &mut HashSet<String>) {
        let Some(keys) = self.keys.remove(id) else {
            return;
        };
        remove_sorted(&mut self.name_index, &keys.name, id);
        remove_sorted(&mut self.path_index, &keys.path, id);
        for alias in &keys.aliases {
            remove_sorted(&mut self.alias_index, alias, id);
        }
        touched.insert(keys.name);
        touched.insert(keys.path);
        touched.extend(keys.aliases);
    }

    // --- registro dei link (chi usa quale chiave) -------------------------

    fn register_links<S: GraphSource + ?Sized>(&mut self, doc: &S) {
        let id = doc.graph_id();
        let mut refs = Vec::new();
        for link in doc.graph_links() {
            let (key, kind) = match &link.target {
                LinkTarget::Wiki { page, .. } => (resolution_key(page), RefKind::Wiki),
                // Il path si risolve **qui**, contro la cartella del sorgente:
                // da questo punto in poi la chiave è assoluta nel vault e il
                // resto della macchina non deve più sapere da dove veniva.
                LinkTarget::Path(target) => match resolve_against(id, target) {
                    Some(path) => (resolution_key(&path), RefKind::Path),
                    None => continue,
                },
                LinkTarget::Url(_) => continue,
            };
            for dep in dep_keys(&key) {
                self.watchers.entry(dep).or_default().insert(key.clone());
            }
            self.refs_by_key
                .entry(key.clone())
                .or_default()
                .insert(id.clone());
            refs.push(LinkRef {
                key,
                kind,
                context: link.context.clone(),
            });
        }
        self.links.insert(id.clone(), refs);
    }

    fn unregister_links(&mut self, id: &DocId) {
        let Some(refs) = self.links.get(id) else {
            return;
        };
        let keys: BTreeSet<String> = refs.iter().map(|r| r.key.clone()).collect();
        for key in keys {
            let Some(sources) = self.refs_by_key.get_mut(&key) else {
                continue;
            };
            sources.remove(id);
            if !sources.is_empty() {
                continue;
            }
            // Ultimo utente della chiave: sparisce anche dai watchers, così le
            // mappe non crescono all'infinito su un vault che cambia molto.
            self.refs_by_key.remove(&key);
            for dep in dep_keys(&key) {
                if let Some(set) = self.watchers.get_mut(&dep) {
                    set.remove(&key);
                    if set.is_empty() {
                        self.watchers.remove(&dep);
                    }
                }
            }
        }
    }

    /// I documenti la cui risoluzione dipende da almeno una delle chiavi date.
    fn dependents(&self, touched: &HashSet<String>) -> BTreeSet<DocId> {
        let mut dirty = BTreeSet::new();
        for key in touched {
            let Some(link_keys) = self.watchers.get(key) else {
                continue;
            };
            for link_key in link_keys {
                if let Some(sources) = self.refs_by_key.get(link_key) {
                    dirty.extend(sources.iter().cloned());
                }
            }
        }
        dirty
    }

    // --- archi -------------------------------------------------------------

    fn relink_all(&mut self, dirty: BTreeSet<DocId>) {
        for id in dirty {
            self.unlink_document(&id);
            self.link_document(&id);
        }
    }

    /// Toglie tutti gli archi uscenti da `id` (e i backlink che ne derivano).
    fn unlink_document(&mut self, id: &DocId) {
        let Some(targets) = self.outgoing.remove(id) else {
            return;
        };
        for target in targets.into_iter().collect::<BTreeSet<_>>() {
            let Some(refs) = self.backlinks.get_mut(&target) else {
                continue;
            };
            refs.retain(|r| &r.source != id);
            if refs.is_empty() {
                self.backlinks.remove(&target);
            }
        }
    }

    /// Risolve i link di `id` e ricrea archi uscenti e backlink.
    fn link_document(&mut self, id: &DocId) {
        let Some(refs) = self.links.get(id).cloned() else {
            return;
        };
        let mut out = Vec::with_capacity(refs.len());
        for link in refs {
            let resolved = match link.kind {
                RefKind::Wiki => self.resolve_key(&link.key),
                RefKind::Path => self.resolve_path_key(&link.key),
            };
            let Some(target) = resolved else {
                continue;
            };
            if target != *id {
                self.backlinks
                    .entry(target.clone())
                    .or_default()
                    .push(BacklinkRef {
                        source: id.clone(),
                        context: link.context,
                    });
            }
            out.push(target);
        }
        if !out.is_empty() {
            self.outgoing.insert(id.clone(), out);
        }
    }
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
fn insert_sorted(index: &mut HashMap<String, Vec<DocId>>, key: &str, id: &DocId) {
    let ids = index.entry(key.to_string()).or_default();
    if let Err(pos) = ids.binary_search_by(|probe| priority(probe).cmp(&priority(id))) {
        ids.insert(pos, id.clone());
    }
}

fn remove_sorted(index: &mut HashMap<String, Vec<DocId>>, key: &str, id: &DocId) {
    let Some(ids) = index.get_mut(key) else {
        return;
    };
    if let Ok(pos) = ids.binary_search_by(|probe| priority(probe).cmp(&priority(id))) {
        ids.remove(pos);
    }
    if ids.is_empty() {
        index.remove(key);
    }
}

/// Ordine fra candidati omonimi: vince il path più corto (più vicino alla
/// radice), a parità quello lessicograficamente minore.
fn priority(id: &DocId) -> (usize, &str) {
    (segments(id), id.as_str())
}

fn segments(id: &DocId) -> usize {
    id.as_str().matches('/').count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::{Link, Span};

    fn doc_with_links(id: &str, links: &[&str]) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new(id));
        m.links = links
            .iter()
            .map(|p| Link {
                target: LinkTarget::wiki(*p),
                embed: false,
                span: Span::EMPTY,
                context: Some(format!("→ {p}")),
            })
            .collect();
        m
    }

    fn doc_with_aliases(id: &str, aliases: &[&str]) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new(id));
        m.frontmatter
            .0
            .insert("aliases".into(), serde_json::json!(aliases));
        m
    }

    fn sources(graph: &LinkGraph, target: &str) -> Vec<String> {
        graph
            .backlinks(&DocId::new(target))
            .into_iter()
            .map(|r| r.source.to_string())
            .collect()
    }

    #[test]
    fn resolves_by_name_and_records_backlinks() {
        let a = doc_with_links("a.md", &["Nota B"]);
        let b = DocumentModel::empty(DocId::new("sub/Nota B.md"));
        let graph = LinkGraph::build([&a, &b]);

        assert_eq!(
            graph.resolve_wiki("Nota B"),
            Some(DocId::new("sub/Nota B.md"))
        );
        let bl = graph.backlinks(&DocId::new("sub/Nota B.md"));
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].source, DocId::new("a.md"));
        assert_eq!(bl[0].context.as_deref(), Some("→ Nota B"));
    }

    #[test]
    fn shortest_path_wins_among_homonyms() {
        let deep = DocumentModel::empty(DocId::new("x/y/Nota.md"));
        let shallow = DocumentModel::empty(DocId::new("Nota.md"));
        let graph = LinkGraph::build([&deep, &shallow]);
        assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("Nota.md")));
    }

    #[test]
    fn resolves_by_path_and_alias() {
        let mut aliased = DocumentModel::empty(DocId::new("people/Mario Rossi.md"));
        aliased
            .frontmatter
            .0
            .insert("aliases".into(), serde_json::json!(["Mario"]));
        let other = DocumentModel::empty(DocId::new("people/Altro.md"));
        let graph = LinkGraph::build([&aliased, &other]);

        assert_eq!(
            graph.resolve_wiki("people/Mario Rossi"),
            Some(DocId::new("people/Mario Rossi.md"))
        );
        assert_eq!(
            graph.resolve_wiki("Mario"),
            Some(DocId::new("people/Mario Rossi.md"))
        );
    }

    #[test]
    fn unresolved_link_yields_no_backlink() {
        let a = doc_with_links("a.md", &["Inesistente"]);
        let graph = LinkGraph::build([&a]);
        assert_eq!(graph.resolve_wiki("Inesistente"), None);
        assert!(graph.backlinks(&DocId::new("Inesistente.md")).is_empty());
    }

    #[test]
    fn nfd_file_names_meet_nfc_links() {
        // Il nome file come lo scrive macOS (NFD: `e` + combining acute), il
        // link come lo digita l'utente (NFC: `é` precomposto). Senza NFC nel
        // punto di normalizzazione sarebbero due chiavi — e due nodi.
        let target = DocumentModel::empty(DocId::new("Cafe\u{0301}.md"));
        let a = doc_with_links("a.md", &["Café"]);
        let graph = LinkGraph::build([&a, &target]);

        assert_eq!(
            graph.resolve_wiki("Café"),
            Some(DocId::new("Cafe\u{0301}.md"))
        );
        assert_eq!(sources(&graph, "Cafe\u{0301}.md"), ["a.md"]);
    }

    #[test]
    fn self_link_is_not_a_backlink() {
        let a = doc_with_links("a.md", &["a"]);
        let graph = LinkGraph::build([&a]);
        assert!(graph.backlinks(&DocId::new("a.md")).is_empty());
    }

    // --- incrementale: i casi che il full-rebuild nasconde ------------------

    #[test]
    fn upsert_creating_target_resolves_dangling_links() {
        let a = doc_with_links("a.md", &["Nota"]);
        let mut graph = LinkGraph::build([&a]);
        assert!(sources(&graph, "Nota.md").is_empty());

        graph.upsert(&DocumentModel::empty(DocId::new("Nota.md")));

        assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("Nota.md")));
        assert_eq!(sources(&graph, "Nota.md"), ["a.md"]);
        assert_eq!(graph.outgoing(&DocId::new("a.md")), [DocId::new("Nota.md")]);
    }

    #[test]
    fn upsert_of_closer_homonym_steals_the_backlink() {
        let a = doc_with_links("a.md", &["Nota"]);
        let deep = DocumentModel::empty(DocId::new("x/y/Nota.md"));
        let mut graph = LinkGraph::build([&a, &deep]);
        assert_eq!(sources(&graph, "x/y/Nota.md"), ["a.md"]);

        graph.upsert(&DocumentModel::empty(DocId::new("Nota.md")));

        assert!(sources(&graph, "x/y/Nota.md").is_empty());
        assert_eq!(sources(&graph, "Nota.md"), ["a.md"]);
    }

    #[test]
    fn remove_of_winner_falls_back_to_runner_up() {
        let a = doc_with_links("a.md", &["Nota"]);
        let deep = DocumentModel::empty(DocId::new("x/y/Nota.md"));
        let shallow = DocumentModel::empty(DocId::new("Nota.md"));
        let mut graph = LinkGraph::build([&a, &deep, &shallow]);
        assert_eq!(sources(&graph, "Nota.md"), ["a.md"]);

        graph.remove(&DocId::new("Nota.md"));

        assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("x/y/Nota.md")));
        assert_eq!(sources(&graph, "x/y/Nota.md"), ["a.md"]);
    }

    #[test]
    fn removing_the_target_drops_its_backlinks() {
        let a = doc_with_links("a.md", &["Nota"]);
        let target = DocumentModel::empty(DocId::new("Nota.md"));
        let mut graph = LinkGraph::build([&a, &target]);

        graph.remove(&DocId::new("Nota.md"));

        assert_eq!(graph.resolve_wiki("Nota"), None);
        assert!(sources(&graph, "Nota.md").is_empty());
        assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
    }

    #[test]
    fn upsert_replaces_the_links_of_a_document() {
        let a = doc_with_links("a.md", &["Uno"]);
        let uno = DocumentModel::empty(DocId::new("Uno.md"));
        let due = DocumentModel::empty(DocId::new("Due.md"));
        let mut graph = LinkGraph::build([&a, &uno, &due]);
        assert_eq!(sources(&graph, "Uno.md"), ["a.md"]);

        graph.upsert(&doc_with_links("a.md", &["Due"]));

        assert!(sources(&graph, "Uno.md").is_empty());
        assert_eq!(sources(&graph, "Due.md"), ["a.md"]);
    }

    #[test]
    fn losing_an_alias_moves_the_backlink() {
        let a = doc_with_links("a.md", &["Mario"]);
        let rossi = doc_with_aliases("people/Rossi.md", &["Mario"]);
        let mut graph = LinkGraph::build([&a, &rossi]);
        assert_eq!(sources(&graph, "people/Rossi.md"), ["a.md"]);

        // stesso documento, senza più l'alias
        graph.upsert(&DocumentModel::empty(DocId::new("people/Rossi.md")));

        assert_eq!(graph.resolve_wiki("Mario"), None);
        assert!(sources(&graph, "people/Rossi.md").is_empty());
    }

    #[test]
    fn alias_collision_is_deterministic_and_survives_removal() {
        let a = doc_with_links("a.md", &["Mario"]);
        let deep = doc_with_aliases("x/y/Uno.md", &["Mario"]);
        let shallow = doc_with_aliases("Due.md", &["Mario"]);
        let mut graph = LinkGraph::build([&a, &deep, &shallow]);
        // fra due alias uguali vince il path più corto, non l'ordine di scan
        assert_eq!(graph.resolve_wiki("Mario"), Some(DocId::new("Due.md")));

        graph.remove(&DocId::new("Due.md"));
        assert_eq!(graph.resolve_wiki("Mario"), Some(DocId::new("x/y/Uno.md")));
        assert_eq!(sources(&graph, "x/y/Uno.md"), ["a.md"]);
    }

    #[test]
    fn path_key_collision_across_extensions() {
        // `sub/nota.md` e `sub/nota.txt` condividono il path senza estensione.
        let a = doc_with_links("a.md", &["sub/nota"]);
        let md = DocumentModel::empty(DocId::new("sub/nota.md"));
        let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
        let mut graph = LinkGraph::build([&a, &md, &txt]);
        assert_eq!(
            graph.resolve_wiki("sub/nota"),
            Some(DocId::new("sub/nota.md"))
        );

        graph.remove(&DocId::new("sub/nota.md"));
        assert_eq!(
            graph.resolve_wiki("sub/nota"),
            Some(DocId::new("sub/nota.txt"))
        );
        assert_eq!(sources(&graph, "sub/nota.txt"), ["a.md"]);
    }

    #[test]
    fn duplicate_links_keep_multiplicity() {
        let a = doc_with_links("a.md", &["Nota", "Nota"]);
        let nota = DocumentModel::empty(DocId::new("Nota.md"));
        let mut graph = LinkGraph::build([&a, &nota]);
        assert_eq!(sources(&graph, "Nota.md"), ["a.md", "a.md"]);
        assert_eq!(graph.outgoing(&DocId::new("a.md")).len(), 2);

        // idempotenza: ri-upsert dello stesso documento non duplica nulla
        graph.upsert(&a);
        assert_eq!(sources(&graph, "Nota.md"), ["a.md", "a.md"]);
        assert_eq!(graph.outgoing(&DocId::new("a.md")).len(), 2);
    }

    // --- la camminata: `IndexQuery::Neighbors` (decisione 0005) ----------------------

    /// `a → b → c`, e `d → a`.
    fn chain() -> Vec<DocumentModel> {
        vec![
            doc_with_links("a.md", &["b"]),
            doc_with_links("b.md", &["c"]),
            DocumentModel::empty(DocId::new("c.md")),
            doc_with_links("d.md", &["a"]),
        ]
    }

    fn walk(graph: &LinkGraph, from: &str, dir: LinkDirection, depth: u8) -> Vec<(String, u8)> {
        graph
            .neighbors(&DocId::new(from), dir, depth)
            .into_iter()
            .map(|n| (n.doc.to_string(), n.depth))
            .collect()
    }

    #[test]
    fn one_step_out_is_plain_adjacency() {
        let docs = chain();
        let graph = LinkGraph::build(docs.iter());
        assert_eq!(
            walk(&graph, "a.md", LinkDirection::Outbound, 1),
            [("b.md".to_string(), 1)]
        );
        assert_eq!(
            walk(&graph, "a.md", LinkDirection::Inbound, 1),
            [("d.md".to_string(), 1)],
            "il verso entrante sono i backlink"
        );
    }

    #[test]
    fn depth_is_a_breadth_first_walk_and_via_rebuilds_the_edges() {
        let docs = chain();
        let graph = LinkGraph::build(docs.iter());
        let found = graph.neighbors(&DocId::new("a.md"), LinkDirection::Outbound, 2);
        let edges: Vec<(String, String, u8)> = found
            .iter()
            .map(|n| (n.via.to_string(), n.doc.to_string(), n.depth))
            .collect();
        assert_eq!(
            edges,
            [
                ("a.md".to_string(), "b.md".to_string(), 1),
                ("b.md".to_string(), "c.md".to_string(), 2),
            ],
            "`via` è l'anello precedente: senza, questa risposta sarebbe un sacchetto di nodi"
        );
    }

    #[test]
    fn both_directions_meet_in_the_middle() {
        let docs = chain();
        let graph = LinkGraph::build(docs.iter());
        let names: Vec<String> = walk(&graph, "a.md", LinkDirection::Both, 1)
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        assert_eq!(names, ["b.md", "d.md"], "uscenti ed entranti, in ordine");
    }

    #[test]
    fn a_cycle_terminates_and_nobody_is_a_neighbour_of_itself() {
        let a = doc_with_links("a.md", &["b"]);
        let b = doc_with_links("b.md", &["a"]);
        let graph = LinkGraph::build([&a, &b]);
        let found = walk(&graph, "a.md", LinkDirection::Both, 10);
        assert_eq!(
            found,
            [("b.md".to_string(), 1)],
            "il ciclo torna su a.md, che non è vicino di sé stesso"
        );
    }

    #[test]
    fn a_neighbour_reached_twice_keeps_the_shortest_distance() {
        // a → b, a → c, b → c: `c` è a un passo, non a due.
        let a = doc_with_links("a.md", &["b", "c"]);
        let b = doc_with_links("b.md", &["c"]);
        let c = DocumentModel::empty(DocId::new("c.md"));
        let graph = LinkGraph::build([&a, &b, &c]);
        assert_eq!(
            walk(&graph, "a.md", LinkDirection::Outbound, 3),
            [("b.md".to_string(), 1), ("c.md".to_string(), 1)]
        );
    }

    #[test]
    fn depth_zero_is_an_empty_answer() {
        let docs = chain();
        let graph = LinkGraph::build(docs.iter());
        assert!(walk(&graph, "a.md", LinkDirection::Both, 0).is_empty());
    }

    // --- link markdown: la seconda specie di arco (decisione 0004) ------------------

    fn doc_with_paths(id: &str, dests: &[&str]) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new(id));
        m.links = dests
            .iter()
            .map(|d| Link {
                target: LinkTarget::Path((*d).to_string()),
                embed: false,
                span: Span::EMPTY,
                context: Some(format!("→ {d}")),
            })
            .collect();
        m
    }

    #[test]
    fn a_path_link_is_relative_to_its_source() {
        // Stessa stringa, due sorgenti, due documenti: è tutta la differenza
        // fra un link markdown e un wikilink.
        let root = doc_with_paths("a.md", &["Nota.md"]);
        let sub = doc_with_paths("sub/a.md", &["Nota.md"]);
        let n_root = DocumentModel::empty(DocId::new("Nota.md"));
        let n_sub = DocumentModel::empty(DocId::new("sub/Nota.md"));
        let graph = LinkGraph::build([&root, &sub, &n_root, &n_sub]);

        assert_eq!(sources(&graph, "Nota.md"), ["a.md"]);
        assert_eq!(sources(&graph, "sub/Nota.md"), ["sub/a.md"]);
    }

    #[test]
    fn a_path_link_walks_up_and_starts_from_the_root() {
        let a = doc_with_paths("x/y/a.md", &["../../Nota.md", "/Altra.md"]);
        let nota = DocumentModel::empty(DocId::new("Nota.md"));
        let altra = DocumentModel::empty(DocId::new("Altra.md"));
        let graph = LinkGraph::build([&a, &nota, &altra]);

        assert_eq!(sources(&graph, "Nota.md"), ["x/y/a.md"]);
        assert_eq!(sources(&graph, "Altra.md"), ["x/y/a.md"]);
    }

    #[test]
    fn a_path_link_never_falls_back_to_name_or_alias() {
        let a = doc_with_paths("a.md", &["Nota.md", "Mario"]);
        let deep = doc_with_aliases("x/y/Nota.md", &["Mario"]);
        let graph = LinkGraph::build([&a, &deep]);

        // `[[Nota]]` lo troverebbe per nome, `[[Mario]]` per alias: un path no.
        assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("x/y/Nota.md")));
        assert!(sources(&graph, "x/y/Nota.md").is_empty());
    }

    #[test]
    fn an_explicit_extension_is_taken_seriously() {
        let md = DocumentModel::empty(DocId::new("sub/nota.md"));
        let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
        let esatto = doc_with_paths("a.md", &["sub/nota.txt"]);
        let senza = doc_with_paths("b.md", &["sub/nota"]);
        let sbagliato = doc_with_paths("c.md", &["sub/nota.png"]);
        let graph = LinkGraph::build([&md, &txt, &esatto, &senza, &sbagliato]);

        // L'esatto vince sull'ordine di priorità; il senza-estensione ricade
        // sulla chiave dei wikilink; l'estensione inesistente non ricade su
        // nulla — `c.md` non è backlink di nessuno dei due.
        assert_eq!(sources(&graph, "sub/nota.txt"), ["a.md"]);
        assert_eq!(sources(&graph, "sub/nota.md"), ["b.md"]);
    }

    #[test]
    fn percent_encoding_and_fragments_do_not_change_the_edge() {
        let a = doc_with_paths("a.md", &["sub/nota%20uno.md#sezione"]);
        let target = DocumentModel::empty(DocId::new("sub/nota uno.md"));
        let graph = LinkGraph::build([&a, &target]);
        assert_eq!(sources(&graph, "sub/nota uno.md"), ["a.md"]);
    }

    #[test]
    fn what_is_not_a_vault_resource_is_not_an_edge() {
        let mut a = doc_with_paths("a.md", &["../fuori.md", "#solo-ancora", ""]);
        a.links.push(Link {
            target: LinkTarget::Url("https://esempio.test/Nota.md".into()),
            embed: false,
            span: Span::EMPTY,
            context: None,
        });
        let graph = LinkGraph::build([&a]);
        assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
    }

    #[test]
    fn upsert_resolves_and_steals_path_links_too() {
        // La stessa proprietà dei wikilink, sull'altra specie: creare il
        // bersaglio risolve il link pendente, toglierlo lo restituisce.
        let a = doc_with_paths("a.md", &["sub/Nota.md"]);
        let mut graph = LinkGraph::build([&a]);
        assert!(sources(&graph, "sub/Nota.md").is_empty());

        graph.upsert(&DocumentModel::empty(DocId::new("sub/Nota.md")));
        assert_eq!(sources(&graph, "sub/Nota.md"), ["a.md"]);

        graph.remove(&DocId::new("sub/Nota.md"));
        assert!(sources(&graph, "sub/Nota.md").is_empty());
        assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
    }

    #[test]
    fn remove_of_the_winner_falls_back_for_an_extensionless_path_link() {
        let a = doc_with_paths("a.md", &["sub/nota"]);
        let md = DocumentModel::empty(DocId::new("sub/nota.md"));
        let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
        let mut graph = LinkGraph::build([&a, &md, &txt]);
        assert_eq!(sources(&graph, "sub/nota.md"), ["a.md"]);

        graph.remove(&DocId::new("sub/nota.md"));
        assert_eq!(sources(&graph, "sub/nota.txt"), ["a.md"]);
    }

    #[test]
    fn remove_of_unknown_document_is_a_noop() {
        let a = doc_with_links("a.md", &["Nota"]);
        let mut graph = LinkGraph::build([&a]);
        graph.remove(&DocId::new("mai-esistito.md"));
        assert_eq!(graph.documents(), [DocId::new("a.md")]);
    }
}
