//! Il grafo dei link del vault: risoluzione dei wikilink in stile Obsidian e
//! calcolo dei backlink (archi inversi).
//!
//! È **agnostico rispetto al formato**: opera solo su [`DocumentModel`] già
//! parsati. I test lo costruiscono con modelli fatti a mano, senza markdown.
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

use fubmd_abi::model::{DocId, DocumentModel, LinkTarget};
use fubmd_abi::traits::BacklinkRef;

/// Un wikilink di un documento, già normalizzato a chiave di risoluzione.
#[derive(Clone, Debug)]
struct LinkRef {
    key: String,
    context: Option<String>,
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
    pub fn build<'a>(docs: impl IntoIterator<Item = &'a DocumentModel>) -> Self {
        let docs: Vec<&DocumentModel> = docs.into_iter().collect();
        let mut graph = LinkGraph::default();

        // Fase 1: indici di nome/alias/path e registrazione dei link (serve
        // conoscere tutti i doc prima di poter risolvere qualsiasi link).
        let mut touched = HashSet::new();
        for doc in &docs {
            graph.attach_indexes(doc, &mut touched);
            graph.register_links(doc);
        }

        // Fase 2: risoluzione dei link e archi inversi.
        for doc in &docs {
            graph.link_document(&doc.id);
        }
        graph
    }

    /// Inserisce o aggiorna un documento, ri-collegando **solo** i documenti la
    /// cui risoluzione può esserne cambiata.
    ///
    /// Il risultato osservabile è identico a un [`LinkGraph::build`] su tutti i
    /// documenti presenti dopo l'operazione.
    pub fn upsert(&mut self, doc: &DocumentModel) {
        let mut touched = HashSet::new();

        // Fuori: vecchie chiavi, vecchi link, vecchi archi uscenti.
        self.detach_indexes(&doc.id, &mut touched);
        self.unregister_links(&doc.id);
        self.unlink_document(&doc.id);

        // Dentro: nuove chiavi e nuovi link (ancora senza risolvere).
        self.attach_indexes(doc, &mut touched);
        self.register_links(doc);

        // Ri-collega il documento e chiunque dipendesse dalle chiavi toccate.
        let mut dirty = self.dependents(&touched);
        dirty.insert(doc.id.clone());
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
        self.resolve_key(&normalize(page))
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

    // --- indici di nome/alias/path ----------------------------------------

    fn attach_indexes(&mut self, doc: &DocumentModel, touched: &mut HashSet<String>) {
        let id = &doc.id;
        let keys = DocKeys {
            name: normalize(id.page_name()),
            path: normalize(&strip_ext(id.as_str())),
            aliases: doc
                .frontmatter
                .aliases()
                .iter()
                .map(|a| normalize(a))
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

    fn register_links(&mut self, doc: &DocumentModel) {
        let mut refs = Vec::new();
        for link in &doc.links {
            let LinkTarget::Wiki { page, .. } = &link.target else {
                continue;
            };
            let key = normalize(page);
            for dep in dep_keys(&key) {
                self.watchers.entry(dep).or_default().insert(key.clone());
            }
            self.refs_by_key
                .entry(key.clone())
                .or_default()
                .insert(doc.id.clone());
            refs.push(LinkRef {
                key,
                context: link.context.clone(),
            });
        }
        self.links.insert(doc.id.clone(), refs);
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
            let Some(target) = self.resolve_key(&link.key) else {
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

/// Chiave di risoluzione: trim + minuscolo. Unico punto di normalizzazione.
pub(crate) fn normalize(s: &str) -> String {
    s.trim().to_lowercase()
}

/// Le voci d'indice da cui dipende la risoluzione di una chiave di link.
/// `resolve_key` guarda `path_index[strip_ext(key)]`, `name_index[key]` e
/// `alias_index[key]`: al più due chiavi distinte.
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

pub(crate) fn strip_ext(path: &str) -> String {
    match path.rsplit_once('.') {
        Some((stem, ext)) if !ext.contains('/') => stem.to_string(),
        _ => path.to_string(),
    }
}

fn segments(id: &DocId) -> usize {
    id.as_str().matches('/').count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::model::{Link, Span};

    fn doc_with_links(id: &str, links: &[&str]) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new(id));
        m.links = links
            .iter()
            .map(|p| Link {
                target: LinkTarget::wiki(*p),
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

    #[test]
    fn remove_of_unknown_document_is_a_noop() {
        let a = doc_with_links("a.md", &["Nota"]);
        let mut graph = LinkGraph::build([&a]);
        graph.remove(&DocId::new("mai-esistito.md"));
        assert_eq!(graph.documents(), [DocId::new("a.md")]);
    }
}
