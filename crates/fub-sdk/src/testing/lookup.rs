//! Le domande interne del doppio: a cosa punta un link, quali documenti
//! conta e come li legge.

use super::*;

impl MemoryHost {
    /// A cosa punta `target`, scritto in `from`, fra i documenti in memoria.
    ///
    /// È la regola di `fub_kernel::graph` (`resolve_wiki`/`resolve_path`) e
    /// del ripiego sull'anagrafe (`resolve_entry_in`) scritta come scansione:
    /// il doppio ha pochi documenti e nessun indice. La parità col kernel la
    /// prova `both_hosts_answer_alike`.
    pub(super) fn resolve(&self, target: &LinkTarget, from: Option<&DocId>) -> Option<DocId> {
        use fub_abi::rules::path::{exact_key, resolution_key, resolve_against, strip_ext};
        let docs = self.docs.lock().unwrap();
        // L'ordine fra omonimi del grafo: il path più corto, poi il minore;
        // fra formati dello stesso path, prima la prosa.
        let prose = |id: &DocId| {
            self.format_of(id).is_some_and(|format| {
                format
                    .capabilities
                    .supports(fub_abi::options::source::PROSE)
            })
        };
        let mut ids: Vec<DocId> = docs.keys().map(DocId::new).collect();
        ids.sort_by(|a, b| {
            let depth = |id: &DocId| id.as_str().matches('/').count();
            depth(a).cmp(&depth(b)).then_with(|| {
                let by_path = a.as_str().cmp(b.as_str());
                if strip_ext(a.as_str()) == strip_ext(b.as_str()) {
                    prose(b).cmp(&prose(a)).then(by_path)
                } else {
                    by_path
                }
            })
        });
        // Fra i candidati di una chiave vince chi combacia esattamente con
        // ciò che si è scritto, altrimenti il primo per priorità.
        let pick = |key: &str,
                    exact: &str,
                    keyed: &dyn Fn(&DocId) -> String,
                    form: &dyn Fn(&DocId) -> String| {
            let mut candidates = ids.iter().filter(|id| keyed(id) == key).peekable();
            let first = (*candidates.peek()?).clone();
            Some(
                candidates
                    .find(|id| form(id) == exact)
                    .cloned()
                    .unwrap_or(first),
            )
        };
        let root = DocId::new("");
        let source = from.unwrap_or(&root);
        match target {
            _ if target.names_host() => from.filter(|doc| docs.contains_key(doc.as_str())).cloned(),
            LinkTarget::Wiki { page, .. } => {
                let key = resolution_key(page);
                let exact = exact_key(page);
                if key.is_empty() {
                    return None;
                }
                let by_path = |id: &DocId| resolution_key(&strip_ext(id.as_str()));
                if key.contains('/') {
                    let stem = strip_ext(&key);
                    if let Some(id) = ids
                        .iter()
                        .find(|id| by_path(id) == stem && exact_key(id.as_str()) == exact)
                    {
                        return Some(id.clone());
                    }
                    if let Some(id) = pick(&stem, &strip_ext(&exact), &by_path, &|id| {
                        exact_key(&strip_ext(id.as_str()))
                    }) {
                        return Some(id);
                    }
                }
                let by_name = |id: &DocId| resolution_key(id.page_name());
                if let Some(id) = pick(&key, &exact, &by_name, &|id| exact_key(id.page_name())) {
                    return Some(id);
                }
                // Il nome con la sua estensione (`[[board.canvas]]`), prima
                // degli alias come nel grafo.
                let file = |id: &DocId| id.as_str().rsplit('/').next().unwrap_or("").to_string();
                if strip_ext(&key) != key {
                    if let Some(id) = pick(&key, &exact, &|id| resolution_key(&file(id)), &|id| {
                        exact_key(&file(id))
                    }) {
                        return Some(id);
                    }
                }
                let models = self.models.lock().unwrap();
                let aliased = ids.iter().find(|id| {
                    models.get(id.as_str()).is_some_and(|model| {
                        model
                            .frontmatter
                            .aliases()
                            .iter()
                            .any(|alias| resolution_key(alias) == key)
                    })
                });
                if let Some(id) = aliased {
                    return Some(id.clone());
                }
                // Il file per nome, estensione compresa (`[[foto.png]]`), o
                // per path intero: il più vicino alla radice.
                ids.iter()
                    .find(|id| {
                        let name = id.as_str().rsplit('/').next().unwrap_or(id.as_str());
                        resolution_key(name) == key || resolution_key(id.as_str()) == key
                    })
                    .cloned()
            }
            LinkTarget::Path(raw) => {
                let path = resolve_against(source, raw)?;
                let key = resolution_key(&path);
                let exact = exact_key(&path);
                if key.is_empty() {
                    return None;
                }
                let stem = strip_ext(&key);
                let by_path = |id: &DocId| resolution_key(&strip_ext(id.as_str()));
                if let Some(id) = ids
                    .iter()
                    .filter(|id| by_path(id) == stem)
                    .find(|id| exact_key(id.as_str()) == exact)
                    .or_else(|| {
                        ids.iter()
                            .filter(|id| by_path(id) == stem)
                            .find(|id| resolution_key(id.as_str()) == key)
                    })
                {
                    return Some(id.clone());
                }
                if let Some(id) = pick(&key, &exact, &by_path, &|id| {
                    exact_key(&strip_ext(id.as_str()))
                }) {
                    return Some(id);
                }
                // L'anagrafe: il path esatto, poi la sua chiave.
                if docs.contains_key(path.as_str()) {
                    return Some(DocId::new(path));
                }
                let mut named: Vec<&DocId> = ids
                    .iter()
                    .filter(|id| resolution_key(id.as_str()) == key)
                    .collect();
                named.sort_by(|a, b| a.as_str().cmp(b.as_str()));
                named.first().map(|id| (*id).clone())
            }
            LinkTarget::Url(_) => None,
        }
    }
}

impl MemoryHost {
    /// I documenti **come li conta il kernel**: quelli che un formato serve,
    /// in ordine di id. È l'universo delle domande sui documenti; l'anagrafe
    /// intera, allegati compresi, è [`IndexQuery::Entries`].
    pub(super) fn documents(&self) -> Vec<DocId> {
        let docs = self.docs.lock().unwrap();
        docs.keys()
            .map(DocId::new)
            .filter(|id| self.format_of(id).is_some())
            .collect()
    }

    /// I documenti a un passo da `doc` sugli archi seminati, nel verso
    /// chiesto: ciò che nel kernel risponde il grafo (`LinkGraph::linked`).
    pub(super) fn linked(&self, doc: &DocId, direction: LinkDirection) -> BTreeSet<DocId> {
        let edges = self.edges.lock().unwrap();
        let mut out = BTreeSet::new();
        for (from, to) in edges.iter() {
            let outbound = matches!(direction, LinkDirection::Outbound | LinkDirection::Both);
            let inbound = matches!(direction, LinkDirection::Inbound | LinkDirection::Both);
            if outbound && from == doc.as_str() {
                out.insert(DocId::new(to));
            }
            if inbound && to == doc.as_str() {
                out.insert(DocId::new(from));
            }
        }
        out
    }

    /// La camminata del kernel (`LinkGraph::neighbors`) sugli archi seminati:
    /// in ampiezza, ogni documento una volta sola alla distanza minima, `via`
    /// è l'anello da cui ci si arriva, e chi parte non è vicino di sé stesso.
    /// L'ordine è distanza crescente, poi id.
    pub(super) fn neighbors(
        &self,
        doc: &DocId,
        direction: LinkDirection,
        depth: u8,
    ) -> Vec<NeighborRef> {
        let mut seen = BTreeSet::from([doc.clone()]);
        let mut out = Vec::new();
        let mut frontier = vec![doc.clone()];
        for step in 1..=depth {
            let mut next = Vec::new();
            for from in &frontier {
                for to in self.linked(from, direction) {
                    if !seen.insert(to.clone()) {
                        continue;
                    }
                    out.push(NeighborRef {
                        doc: to.clone(),
                        via: from.clone(),
                        depth: step,
                    });
                    next.push(to);
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
        out.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.doc.cmp(&b.doc)));
        out
    }

    /// `doc` è servito dal Markdown di serie, e non da un formato seminato?
    /// La risposta è quella di `format_of`, così l'estensione si legge in un
    /// posto solo.
    pub(super) fn speaks_series_markdown(&self, doc: &DocId) -> bool {
        self.format_of(doc)
            .is_some_and(|format| Some(format) == format_of_series("md"))
    }
}
