//! Il grafo dei link del vault: risoluzione dei wikilink in stile Obsidian e
//! calcolo dei backlink (archi inversi).
//!
//! È **agnostico rispetto al formato**: opera solo su [`DocumentModel`] già
//! parsati. I test lo costruiscono con modelli fatti a mano, senza markdown.

use std::collections::HashMap;

use fubmd_abi::model::{DocId, DocumentModel, LinkTarget};
use fubmd_abi::traits::BacklinkRef;

#[derive(Default)]
pub struct LinkGraph {
    /// page name (minuscolo) → documenti con quel nome.
    name_index: HashMap<String, Vec<DocId>>,
    /// alias (minuscolo) → documento.
    alias_index: HashMap<String, DocId>,
    /// path relativo senza estensione (minuscolo) → documento.
    path_index: HashMap<String, DocId>,
    /// documento target → riferimenti entranti.
    backlinks: HashMap<DocId, Vec<BacklinkRef>>,
    /// documento → target risolti uscenti (per invalidazioni future).
    outgoing: HashMap<DocId, Vec<DocId>>,
}

impl LinkGraph {
    /// Ricostruisce l'intero grafo da tutti i modelli del vault.
    pub fn build<'a>(docs: impl IntoIterator<Item = &'a DocumentModel>) -> Self {
        let docs: Vec<&DocumentModel> = docs.into_iter().collect();
        let mut graph = LinkGraph::default();

        // Fase 1: indici di nome/alias/path (serve conoscere tutti i doc prima
        // di poter risolvere qualsiasi link).
        for doc in &docs {
            let id = &doc.id;
            let name = id.page_name().to_lowercase();
            graph.name_index.entry(name).or_default().push(id.clone());
            graph
                .path_index
                .insert(strip_ext(id.as_str()).to_lowercase(), id.clone());
            for alias in doc.frontmatter.aliases() {
                graph.alias_index.insert(alias.to_lowercase(), id.clone());
            }
        }
        // Ordine stabile: fra omonimi vince il path più corto, poi lessicografico.
        for ids in graph.name_index.values_mut() {
            ids.sort_by(|a, b| {
                let (sa, sb) = (segments(a), segments(b));
                sa.cmp(&sb).then_with(|| a.cmp(b))
            });
        }

        // Fase 2: risoluzione dei link e archi inversi.
        for doc in &docs {
            for link in &doc.links {
                if let LinkTarget::Wiki { page, .. } = &link.target {
                    if let Some(target) = graph.resolve_wiki(page) {
                        if target != doc.id {
                            graph
                                .backlinks
                                .entry(target.clone())
                                .or_default()
                                .push(BacklinkRef {
                                    source: doc.id.clone(),
                                    context: link.context.clone(),
                                });
                        }
                        graph
                            .outgoing
                            .entry(doc.id.clone())
                            .or_default()
                            .push(target);
                    }
                }
            }
        }
        graph
    }

    /// Risolve il nome/pagina di un wikilink a un [`DocId`], regole Obsidian:
    /// per path se contiene `/`, altrimenti per nome (fra omonimi vince il
    /// più vicino alla radice), infine per alias.
    pub fn resolve_wiki(&self, page: &str) -> Option<DocId> {
        let key = page.trim().to_lowercase();
        if key.is_empty() {
            return None;
        }
        if key.contains('/') {
            if let Some(id) = self.path_index.get(&strip_ext(&key)) {
                return Some(id.clone());
            }
        }
        if let Some(ids) = self.name_index.get(&key) {
            if let Some(first) = ids.first() {
                return Some(first.clone());
            }
        }
        self.alias_index.get(&key).cloned()
    }

    /// Backlink verso un documento (riferimenti entranti), ordinati per sorgente.
    pub fn backlinks(&self, target: &DocId) -> Vec<BacklinkRef> {
        let mut refs = self.backlinks.get(target).cloned().unwrap_or_default();
        refs.sort_by(|a, b| a.source.cmp(&b.source));
        refs
    }

    /// Link uscenti risolti da un documento.
    pub fn outgoing(&self, source: &DocId) -> Vec<DocId> {
        self.outgoing.get(source).cloned().unwrap_or_default()
    }
}

fn strip_ext(path: &str) -> String {
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

    #[test]
    fn resolves_by_name_and_records_backlinks() {
        let a = doc_with_links("a.md", &["Nota B"]);
        let b = DocumentModel::empty(DocId::new("sub/Nota B.md"));
        let graph = LinkGraph::build([&a, &b]);

        assert_eq!(graph.resolve_wiki("Nota B"), Some(DocId::new("sub/Nota B.md")));
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
}
