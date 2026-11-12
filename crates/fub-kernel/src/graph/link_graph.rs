//! `impl LinkGraph`: costruzione, aggiornamento incrementale, interrogazioni,
//! risoluzione delle chiavi, indici di nome/alias/path e archi.

use std::collections::{BTreeSet, HashMap, HashSet};

use fub_abi::model::{DocId, LinkTarget};
use fub_abi::traits::{BacklinkRef, LinkDirection, NeighborRef};

use fub_abi::rules::path::{exact_key, resolution_key, resolve_against, strip_ext};

use super::{
    changed_keys, dep_keys, file_name, first_of, insert_sorted, names_an_attachment, remove_sorted,
    DocKeys, GraphSource, LinkGraph, LinkRef, ProseFormats, RefKind, ResolvedDoc,
};

impl LinkGraph {
    /// Ricostruisce l'intero grafo da tutti i modelli del vault.
    ///
    /// Resta l'**oracolo** dell'aggiornamento incrementale: due fasi, nessuna
    /// invalidazione, nessuna astuzia (vedi `tests/graph_incremental.rs`).
    pub fn build<'a, S>(docs: impl IntoIterator<Item = &'a S>) -> Self
    where
        S: GraphSource + 'a,
    {
        Self::build_with(docs, ProseFormats::default())
    }

    /// Un grafo vuoto che conosce i formati di prosa.
    pub fn with_prose(prose: ProseFormats) -> Self {
        LinkGraph {
            prose,
            ..LinkGraph::default()
        }
    }

    /// I formati di prosa che questo grafo conosce, per chi ne costruisce un
    /// altro uguale.
    pub(crate) fn prose(&self) -> &ProseFormats {
        &self.prose
    }

    /// Come [`build`](Self::build), con i formati di prosa del vault.
    pub fn build_with<'a, S>(docs: impl IntoIterator<Item = &'a S>, prose: ProseFormats) -> Self
    where
        S: GraphSource + 'a,
    {
        let docs: Vec<&S> = docs.into_iter().collect();
        let mut graph = LinkGraph {
            prose,
            name_index: HashMap::with_capacity(docs.len()),
            path_index: HashMap::with_capacity(docs.len()),
            alias_index: HashMap::with_capacity(docs.len() / 4),
            backlinks: HashMap::with_capacity(docs.len()),
            outgoing: HashMap::with_capacity(docs.len()),
            links: HashMap::with_capacity(docs.len()),
            keys: HashMap::with_capacity(docs.len()),
            watchers: HashMap::with_capacity(docs.len()),
            refs_by_key: HashMap::with_capacity(docs.len()),
        };

        // Fase 1: indici di nome/alias/path e registrazione dei link (serve
        // conoscere tutti i doc prima di poter risolvere qualsiasi link).
        for doc in &docs {
            graph.attach_indexes_internal(*doc, None);
            graph.register_links(*doc);
        }

        // Fase 2: risoluzione dei link e archi inversi.
        let doc_ids: Vec<DocId> = docs.iter().map(|d| d.graph_id().clone()).collect();
        let n = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .clamp(1, 8);

        if n > 1 && doc_ids.len() > 256 {
            let chunk_size = doc_ids.len().div_ceil(n);
            let graph_ref = &graph;
            let resolved_chunks: Vec<Vec<ResolvedDoc>> = std::thread::scope(|s| {
                let handles: Vec<_> = doc_ids
                    .chunks(chunk_size)
                    .map(|chunk| {
                        s.spawn(move || {
                            let mut chunk_res = Vec::with_capacity(chunk.len());
                            for id in chunk {
                                if let Some(refs) = graph_ref.links.get(id) {
                                    let mut out = Vec::with_capacity(refs.len());
                                    let mut backlinks = Vec::new();
                                    for link in refs {
                                        let resolved = graph_ref.resolve_ref(link);
                                        if let Some(target) = resolved {
                                            if &target != id {
                                                backlinks.push((
                                                    target.clone(),
                                                    BacklinkRef {
                                                        source: id.clone(),
                                                        context: link.context.clone(),
                                                    },
                                                ));
                                            }
                                            out.push(target);
                                        }
                                    }
                                    chunk_res.push((id.clone(), out, backlinks));
                                }
                            }
                            chunk_res
                        })
                    })
                    .collect();
                handles.into_iter().map(|h| h.join().unwrap()).collect()
            });

            for chunk_res in resolved_chunks {
                for (id, out, backlinks) in chunk_res {
                    if !out.is_empty() {
                        graph.outgoing.insert(id, out);
                    }
                    for (target, backlink) in backlinks {
                        graph.backlinks.entry(target).or_default().push(backlink);
                    }
                }
            }
        } else {
            for id in &doc_ids {
                graph.link_document(id);
            }
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
        let before = self.keys.get(&id).cloned();

        // Fuori: vecchie chiavi, vecchi link, vecchi archi uscenti.
        self.detach_indexes(&id, &mut touched);
        self.unregister_links(&id);
        self.unlink_document(&id);

        // Dentro: nuove chiavi e nuovi link (ancora senza risolvere).
        self.attach_indexes(doc, &mut touched);
        self.register_links(doc);

        // Una chiave uguale prima e dopo, nello stesso indice, lascia l'indice
        // com'era: chi la usa risolve come prima. Salvare una nota che mille
        // altre citano ri-collegava tutte le mille.
        if let (Some(before), Some(after)) = (&before, self.keys.get(&id)) {
            touched = changed_keys(before, after);
        }

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
    /// più vicino alla radice), poi per nome con la sua estensione
    /// (`[[board.canvas]]`), infine per alias.
    pub fn resolve_wiki(&self, page: &str) -> Option<DocId> {
        self.resolve_key(&resolution_key(page), &exact_key(page))
    }

    /// Risolve la destinazione di un link markdown (`[t](note/altra.md)`)
    /// scritta dentro `source`, a cui è **relativa**.
    ///
    /// È pubblica perché non serve solo al grafo: la riscrittura al rename e
    /// (a valle) la navigazione da un'anteprima devono rispondere alla stessa
    /// domanda con la stessa risposta.
    pub fn resolve_path(&self, source: &DocId, target: &str) -> Option<DocId> {
        let path = resolve_against(source, target)?;
        self.resolve_path_key(&resolution_key(&path), &exact_key(&path))
    }

    /// Backlink verso un documento (riferimenti entranti), ordinati per sorgente.
    ///
    /// **Un elemento per link, non per documento**, ed è il contratto e non un
    /// effetto: una nota che ne cita un'altra in tre punti produce tre
    /// [`BacklinkRef`], perché ognuno porta il proprio `context` — il frammento
    /// in cui il link compare — ed è quello che un pannello backlink mostra.
    /// Raggrupparli è una **vista** (FEATURES §7.2, «Backlink raggruppati»), non
    /// una proprietà di questa risposta.
    ///
    /// Chi invece vuole **le note che linkano qui, una volta ciascuna**, chiami
    /// [`linked`](Self::linked): la sua firma è un `BTreeSet`, cioè dice da sé
    /// di essere un insieme. È lì che sta scritta quella domanda, e non in un
    /// `.map(|b| b.source).collect()` ripetuto a ogni sito.
    /// C'è qualcuno che punta qui? È la domanda dell'orfano, e non ha bisogno
    /// del vettore intero clonato che [`backlinks`](Self::backlinks) costa a
    /// chi risponde solo sì o no.
    pub fn has_backlinks(&self, target: &DocId) -> bool {
        self.backlinks.get(target).is_some_and(|v| !v.is_empty())
    }

    pub fn backlinks(&self, target: &DocId) -> Vec<BacklinkRef> {
        let mut refs = self.backlinks.get(target).cloned().unwrap_or_default();
        // Ordinamento *stabile*: fra riferimenti dallo stesso sorgente resta
        // l'ordine dei link nel documento, che è quello del rebuild.
        refs.sort_by(|a, b| a.source.cmp(&b.source));
        refs
    }

    /// Link uscenti risolti da un documento, **nell'ordine dei link nel
    /// sorgente** — e quindi con lo stesso bersaglio ripetuto se il documento
    /// lo cita due volte, per la stessa ragione di [`backlinks`](Self::backlinks).
    /// Chi vuole l'insieme chiami [`linked`](Self::linked).
    pub fn outgoing(&self, source: &DocId) -> Vec<DocId> {
        self.outgoing.get(source).cloned().unwrap_or_default()
    }

    /// Risolve un link già registrato, con le stesse regole Obsidian di
    /// `link_document`: wikilink per chiave globale, path per chiave di path.
    /// È l'unico punto che distingue le due specie — tutto il resto riusa.
    fn resolve_ref(&self, link: &LinkRef) -> Option<DocId> {
        match link.kind {
            RefKind::Wiki => self.resolve_key(&link.key, &link.exact),
            RefKind::Path => self.resolve_path_key(&link.key, &link.exact),
        }
    }

    /// Link uscenti con il loro contesto, **nello stesso ordine e con gli stessi
    /// duplicati** di `outgoing`.
    ///
    /// Riusa il `context` dei `LinkRef` già registrati e la stessa risoluzione
    /// di `link_document` (stesse `resolve_key`/`resolve_path_key`, stesse
    /// regole Obsidian): nessuna seconda risoluzione, nessun secondo indice,
    /// nessuno stato in più. Il costo è proporzionale ai link del documento,
    /// non al vault — è una derivazione on-demand, non un mantenimento.
    ///
    /// I non risolti si saltano e il self-link resta, come in `outgoing`: le
    /// due risposte dicono la stessa cosa, una con le coordinate per riga.
    pub fn outgoing_with_context(&self, source: &DocId) -> Vec<(DocId, Option<String>)> {
        let Some(refs) = self.links.get(source) else {
            return Vec::new();
        };
        let mut out = Vec::with_capacity(refs.len());
        for link in refs {
            let Some(target) = self.resolve_ref(link) else {
                continue;
            };
            out.push((target, link.context.clone()));
        }
        out
    }

    /// **I documenti in relazione di link con `doc`, una volta ciascuno.**
    ///
    /// È la domanda che [`backlinks`](Self::backlinks) e
    /// [`outgoing`](Self::outgoing) non rispondono: quelle due elencano *link*,
    /// questa elenca *documenti*. La distinzione non è accademica — chi cammina
    /// il grafo, chi valuta un predicato di link e chi pianifica una riscrittura
    /// al rename vogliono tutti e tre l'insieme, e prima di questa firma se lo
    /// ricavavano da soli in tre modi diversi: un `BTreeSet` costruito a mano,
    /// un `.collect()` che si affidava al `BTreeMap` di `Matches` per assorbire
    /// i doppioni, e un `if !docs.contains(…)`. Tre spelling della stessa
    /// proprietà sono tre occasioni di dimenticarla.
    ///
    /// Il tipo di ritorno è la proprietà: un `BTreeSet` non ha doppioni per
    /// costruzione, quindi il prossimo chiamante non ha niente da ricordarsi.
    pub fn linked(&self, doc: &DocId, direction: LinkDirection) -> BTreeSet<DocId> {
        let mut out = BTreeSet::new();
        if matches!(direction, LinkDirection::Outbound | LinkDirection::Both) {
            out.extend(self.outgoing.get(doc).into_iter().flatten().cloned());
        }
        if matches!(direction, LinkDirection::Inbound | LinkDirection::Both) {
            out.extend(
                self.backlinks
                    .get(doc)
                    .into_iter()
                    .flatten()
                    .map(|r| r.source.clone()),
            );
        }
        out
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
        let step = |id: &DocId| -> BTreeSet<DocId> { self.linked(id, direction) };

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
    fn resolve_key(&self, key: &str, exact: &str) -> Option<DocId> {
        if key.is_empty() {
            return None;
        }
        if key.contains('/') {
            // Prima l'accoppiamento esatto — `[[sub/Nota.txt]]` è
            // `sub/Nota.txt`, non `sub/Nota.md` che gli sta accanto — e solo
            // in sua assenza la chiave senza estensione, che è quella dei
            // wikilink nudi. È la stessa regola del lato markdown
            // (`resolve_path_key`): l'estensione esplicita nomina un file e
            // non va strippata via prima di guardare chi c'è.
            if let Some(ids) = self.path_index.get(&strip_ext(key)) {
                if let Some(id) = ids.iter().find(|id| exact_key(id.as_str()) == exact) {
                    return Some(id.clone());
                }
            }
            if let Some(id) =
                self.pick(&self.path_index, &strip_ext(key), &strip_ext(exact), |id| {
                    exact_key(&strip_ext(id.as_str()))
                })
            {
                return Some(id);
            }
        }
        // Il nome pagina è il nome senza estensione, e una chiave che finisce
        // con l'estensione di un allegato non lo è (`names_an_attachment`).
        if !names_an_attachment(key) {
            if let Some(id) =
                self.pick(&self.name_index, key, exact, |id| exact_key(id.page_name()))
            {
                return Some(id);
            }
        }
        // Un nome con la sua estensione nomina un file: `[[board.canvas]]` è
        // `board.canvas`, e non `board.md` che gli sta accanto. È come Obsidian
        // scrive i link ai canvas. Il nome pagina ha avuto la precedenza sopra
        // perché `[[v1.2]]` è la pagina `v1.2.md`, non un file di estensione `2`.
        let stem = strip_ext(key);
        if stem != key {
            if let Some(ids) = self.name_index.get(&stem) {
                if let Some(id) = ids
                    .iter()
                    .find(|id| exact_key(file_name(id.as_str())) == exact)
                {
                    return Some(id.clone());
                }
                if let Some(id) = ids
                    .iter()
                    .find(|id| resolution_key(file_name(id.as_str())) == key)
                {
                    return Some(id.clone());
                }
            }
        }
        // Gli alias no, ed è una differenza di sostanza: dietro un path e un
        // nome pagina c'è un **file**, e due file che differiscono per una
        // maiuscola sono due cose che il filesystem distingue e la chiave no.
        // Un alias è una dichiarazione dentro un frontmatter: due documenti che
        // dichiarano `NASA` e `nasa` non sono due file omonimi, sono due
        // rivendicazioni ugualmente valide, e nessun fatto sul disco dice quale
        // l'utente intendesse. Lì l'ambiguità è genuina e la priorità resta la
        // risposta.
        first_of(&self.alias_index, key)
    }

    /// Fra i candidati di una chiave vince chi **combacia esattamente** con ciò
    /// che l'utente ha scritto; se nessuno combacia, il primo per priorità —
    /// cioè la regola di prima, intera.
    ///
    /// Il caso in cui questo cambia qualcosa è esattamente uno: la chiave ha più
    /// di un candidato *perché* due documenti differiscono solo per il caso. Con
    /// un candidato solo `find` trova quello o non trova niente, e `first` lo
    /// restituisce lo stesso.
    fn pick(
        &self,
        index: &HashMap<String, Vec<DocId>>,
        key: &str,
        exact: &str,
        form: impl Fn(&DocId) -> String,
    ) -> Option<DocId> {
        let ids = index.get(key)?;
        ids.iter()
            .find(|id| form(id) == exact)
            .or_else(|| ids.first())
            .cloned()
    }

    /// Risoluzione di una chiave di **path** (già normalizzata e già assoluta
    /// rispetto alla radice del vault).
    ///
    /// Prima l'accoppiamento esatto — `note/a.md` è `note/a.md`, non `note/a.txt`
    /// che gli sta accanto — e solo in sua assenza la chiave senza estensione,
    /// che è quella dei wikilink. È la regola 2 di [`crate::pathlink`]; qui c'è
    /// perché `path_index` è indicizzato *senza* estensione e l'esatto va
    /// cercato fra i suoi candidati.
    fn resolve_path_key(&self, key: &str, exact: &str) -> Option<DocId> {
        if key.is_empty() {
            return None;
        }
        if let Some(ids) = self.path_index.get(&strip_ext(key)) {
            // Chi combacia in tutto — estensione **e** caso — prima di chi
            // combacia solo a meno del caso.
            if let Some(id) = ids.iter().find(|id| exact_key(id.as_str()) == exact) {
                return Some(id.clone());
            }
            if let Some(id) = ids.iter().find(|id| resolution_key(id.as_str()) == key) {
                return Some(id.clone());
            }
        }
        // Il ripiego, e non è decorativo: è il cammino che risolve le chiavi
        // **senza** estensione — `[t](sub/nota)` — perché i due `find` sopra
        // confrontano l'id *con* estensione contro una chiave *senza*, e non
        // combaciano mai. Qui `key` è già la chiave d'indice (senza estensione,
        // `strip_ext(key) == key`), e `pick` la trova. Non va «riparato» con
        // `strip_ext(key)`: il caso con estensione inesistente
        // (`[t](sub/nota.png)` senza `sub/nota.png`) deve **fallire** — un path
        // nomina un file, e un file che non c'è non si raggiunge per prossimità
        // (`an_explicit_extension_is_taken_seriously`). Con una chiave *con*
        // estensione `index.get(key)` non trova la voce (l'indice è senza) e
        // ritorna `None`, che è la risposta giusta. Lo stesso cammino copre i
        // nomi con un punto interno — `note/v1.2.md` è indicizzato come
        // `note/v1.2`, e `[t](note/v1.2)` lo raggiunge qui: `strip_ext` taglia
        // `v1.2` in `v1`, il blocco sopra guarda la chiave sbagliata, e questo
        // `pick` trova quella giusta. Una chiave che finisce con l'estensione
        // di un allegato non è un path senza estensione
        // (`names_an_attachment`).
        if names_an_attachment(key) {
            return None;
        }
        self.pick(&self.path_index, key, exact, |id| {
            exact_key(&strip_ext(id.as_str()))
        })
    }

    // --- indici di nome/alias/path ----------------------------------------

    fn attach_indexes<S: GraphSource + ?Sized>(&mut self, doc: &S, touched: &mut HashSet<String>) {
        self.attach_indexes_internal(doc, Some(touched));
    }

    fn attach_indexes_internal<S: GraphSource + ?Sized>(
        &mut self,
        doc: &S,
        touched: Option<&mut HashSet<String>>,
    ) {
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
        insert_sorted(&mut self.name_index, &self.prose, &keys.name, id);
        insert_sorted(&mut self.path_index, &self.prose, &keys.path, id);
        for alias in &keys.aliases {
            insert_sorted(&mut self.alias_index, &self.prose, alias, id);
        }
        if let Some(touched) = touched {
            touched.insert(keys.name.clone());
            touched.insert(keys.path.clone());
            touched.extend(keys.aliases.iter().cloned());
        }
        self.keys.insert(id.clone(), keys);
    }

    fn detach_indexes(&mut self, id: &DocId, touched: &mut HashSet<String>) {
        let Some(keys) = self.keys.remove(id) else {
            return;
        };
        remove_sorted(&mut self.name_index, &self.prose, &keys.name, id);
        remove_sorted(&mut self.path_index, &self.prose, &keys.path, id);
        for alias in &keys.aliases {
            remove_sorted(&mut self.alias_index, &self.prose, alias, id);
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
            let (key, exact, kind) = match &link.target {
                LinkTarget::Wiki { page, .. } => {
                    (resolution_key(page), exact_key(page), RefKind::Wiki)
                }
                // Il path si risolve **qui**, contro la cartella del sorgente:
                // da questo punto in poi la chiave è assoluta nel vault e il
                // resto della macchina non deve più sapere da dove veniva.
                LinkTarget::Path(target) => match resolve_against(id, target) {
                    Some(path) => (resolution_key(&path), exact_key(&path), RefKind::Path),
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
                exact,
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
            let Some(target) = self.resolve_ref(&link) else {
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
