//! `CoreIndex` come `IndexProvider`: le risposte alle domande sull'indice.

use super::*;

impl IndexProvider for CoreIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![
            // Le famiglie di cui il kernel è l'unica fonte di verità.
            QueryRoute::Query(QueryKind::Backlinks),
            QueryRoute::Query(QueryKind::Outline),
            QueryRoute::Query(QueryKind::Tags),
            QueryRoute::Query(QueryKind::Neighbors),
            QueryRoute::Query(QueryKind::PropertyValues),
            QueryRoute::Query(QueryKind::VaultHealth),
            // Ciò che è rimasto non salvato (§15.2): il kernel è l'unico che
            // può rispondere, perché è l'unico che possiede quel posto sul
            // disco — e l'unico che sa, dall'anagrafe, se la nota c'è ancora.
            QueryRoute::Query(QueryKind::Drafts),
            // Il rapporto col disco (§9.7): il kernel è l'unico che può
            // rispondere, perché è l'unico che conosce insieme l'esito delle
            // sincronizzazioni e il fatto — passatogli da chi monta — che un
            // rilevatore ci sia.
            QueryRoute::Query(QueryKind::VaultStatus),
            // Cosa sta girando (§10.3): di nuovo il kernel, e di nuovo perché è
            // l'unico che li conosce tutti — chi possiede i thread sa quali
            // sono partiti, non quali stanno per partire.
            QueryRoute::Query(QueryKind::Jobs),
            // Com'è configurato (§11.1): ancora il kernel, e stavolta si vede a
            // occhio — lo schema sta nel registro dei plugin, il valore nello
            // store di configurazione, e nessun altro li ha tutti e due.
            QueryRoute::Query(QueryKind::Settings),
            // Com'è organizzato (§11.3): il kernel possiede il sidecar, quindi
            // è l'unico che può rispondere. Prima non poteva rispondere
            // nessuno: la domanda non passava dal canale dati affatto.
            QueryRoute::Query(QueryKind::Organization),
            // Cosa nomina un riferimento (§13.1): il kernel, perché risolvere è
            // una funzione del grafo — gli omonimi si dirimono per distanza
            // dalla radice, e gli alias stanno in un indice che tiene solo lui.
            // Prima rispondeva solo alla shell, per un comando IPC scritto
            // apposta.
            QueryRoute::Query(QueryKind::Resolve),
            // Cosa c'è nel vault (§14.1): il kernel, per esclusione — l'anagrafe
            // la costruisce chi cammina il disco, e nessun altro cammina il
            // disco. Prima questa domanda non si poteva fare affatto: la lista
            // dei documenti filtrava per estensione, quindi di un PNG non
            // sapeva rispondere nemmeno che c'era.
            QueryRoute::Query(QueryKind::Entries),
            // Quali cartelle ci sono (§14.3): il kernel, e per la stessa
            // ragione — una cartella la vede chi cammina il disco. Prima non la
            // vedeva nessuno: le cartelle esistevano solo come prefissi dei
            // path delle note, dentro l'albero della shell.
            QueryRoute::Query(QueryKind::Folders),
            // La resa di un documento (§1.6, decisione 0163): il kernel la
            // instrada come Outline — è una domanda che ha un solo risponditore,
            // e il risponditore è il kernel. La query arriva a
            // `Workspace::query_index`, che intercetta prima di `indexes.query`
            // perché `CoreIndex` non ha i documenti né i renderer.
            QueryRoute::Query(QueryKind::RenderPreview),
            QueryRoute::Query(QueryKind::RenderEmbed),
            QueryRoute::Query(QueryKind::SyntaxForms),
            QueryRoute::Query(QueryKind::RenderPrint),
            // Le foglie che sa valutare dai metadati in cache. `Text` non c'è, e
            // non è una lacuna: il kernel non indicizza il corpo, e prometterlo
            // vorrebbe dire scandire il vault a ogni ricerca.
            QueryRoute::Predicate(PredicateKind::Property),
            QueryRoute::Predicate(PredicateKind::Tag),
            QueryRoute::Predicate(PredicateKind::Folder),
            QueryRoute::Predicate(PredicateKind::Path),
            QueryRoute::Predicate(PredicateKind::File),
            QueryRoute::Predicate(PredicateKind::Linked),
        ]
    }

    /// Niente da ricaricare: la memoria di questo indice è il vault, e la
    /// riscansione la fa il workspace all'apertura.
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    /// Non perde niente, e la lista vuota che restituisce è un fatto e non una
    /// scorciatoia: questo indice tiene i propri metadati in memoria, e una
    /// `BTreeMap` che accetta una chiave non ha un modo di rifiutarla. Il
    /// giorno che ne avesse uno — un tetto, una quota — sarebbe qui che lo
    /// direbbe.
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        if !docs.is_empty() {
            self.graph_epoch = self.graph_epoch.wrapping_add(1);
        }
        for doc in docs {
            let names = document_tag_names(doc);
            self.tags
                .upsert_names(&doc.id, names.iter().map(String::as_str));
            let metadata = DocMeta::from(doc);
            if self.graph_update == GraphUpdate::Incremental {
                self.graph.upsert(&metadata);
            }
            self.metas.insert(metadata.id.clone(), metadata);
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        if !ids.is_empty() {
            self.graph_epoch = self.graph_epoch.wrapping_add(1);
        }
        for id in ids {
            if self.metas.remove(id).is_none() {
                continue;
            }
            self.tags.remove(id);
            if self.graph_update == GraphUpdate::Incremental {
                self.graph.remove(id);
            }
        }
        Vec::new()
    }

    /// L'indice del kernel **è** la verità corrente: non ha niente da
    /// riconciliare con essa. Il rebuild completo, quando è la strategia
    /// scelta, lo chiude il workspace dopo la scansione.
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    /// Non persiste niente: ciò che sa lo ricostruisce dal vault, che è la
    /// definizione di stato derivato.
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    /// Non tiene niente che vada lasciato andare: la memoria di questo indice è
    /// memoria, e se ne va con lui. La riga c'è perché il contratto non ha un
    /// default (decisione 0028), ed è il caso che quel default avrebbe reso
    /// indistinguibile da «non ci ho pensato».
    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            // Arriva quando il pianificatore consegna un sottoalbero di foglie
            // che questo indice ha dichiarato: la struttura la regge
            // `QueryEvaluator`, che è scritta una volta sola nel contratto.
            IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
                // Nessun estratto da omettere: questo indice non ha il corpo dei
                // documenti (è lo split metadata/body di M2), quindi seleziona e
                // basta — e una risposta senza estratti è già ciò che dà.
                excerpts: _,
            } => {
                let matches = self.expr(&matching)?;
                Ok(IndexResult::Documents(self.finish_documents(
                    matches,
                    sort.as_ref(),
                    &select,
                    page,
                )))
            }
            // Un allegato non sta nel grafo: chi lo nomina si chiede ai link.
            IndexQuery::Backlinks { target, page } => {
                let refs =
                    if !self.metas.contains_key(&target) && self.entries.contains_key(&target) {
                        self.attachment_backlinks(&target)
                    } else {
                        self.graph.backlinks(&target)
                    };
                Ok(IndexResult::Backlinks(Paged::window(refs, page)))
            }
            IndexQuery::Outline { doc } => Ok(IndexResult::Outline(
                self.metas
                    .get(&doc)
                    .map(|m| m.outline.clone())
                    .unwrap_or_default(),
            )),
            IndexQuery::Tags { matching, page } => {
                let counts = if matching.is_everything() {
                    // Lo snapshot incrementale: niente O(vault) a ogni
                    // interrogazione — e il pannello interroga a ogni
                    // salvataggio.
                    self.tags.snapshot()
                } else {
                    let selected = self.expr(&matching)?;
                    self.tags.snapshot_of(selected.ids())
                };
                Ok(IndexResult::Tags(Paged::window(counts, page)))
            }
            IndexQuery::Neighbors {
                seeds,
                direction,
                depth,
                page,
            } => {
                let from = self.expr(&seeds)?;
                let folder = self.attachment_folder();
                let mut all = Vec::new();
                // I semi in ordine di id, e i vicini di ognuno di seguito: senza
                // un ordine totale la seconda pagina di un grafo grande
                // ripeterebbe righe della prima.
                for seed in from.ids() {
                    let near = self.graph.neighbors(seed, direction, depth);
                    // Gli allegati sono foglie uscenti: nel verso entrante
                    // non c'è niente da aggiungere.
                    if depth == 0 || direction == LinkDirection::Inbound {
                        all.extend(near);
                    } else {
                        all.extend(self.with_attachments(seed, near, depth, folder.as_deref()));
                    }
                }
                Ok(IndexResult::Neighbors(Paged::window(all, page)))
            }
            IndexQuery::PropertyValues {
                key,
                matching,
                page,
            } => {
                let selected = self.expr(&matching)?;
                let facets = properties::facets_with_types(
                    selected
                        .ids()
                        .filter_map(|id| self.metas.get(id).map(|m| (id, &m.frontmatter))),
                    &key,
                    &self.date_formats(),
                    &self.property_types(),
                );
                Ok(IndexResult::PropertyValues(Paged::window(facets, page)))
            }
            IndexQuery::VaultHealth { check, page } => {
                let issues = health::run(
                    check,
                    self.metas
                        .iter()
                        .map(|(id, m)| (id, m.links.as_slice(), &m.frontmatter)),
                    // Il risolutore è il grafo **più l'anagrafe** (§14.1): il
                    // grafo sa dove arriva un link fra note, l'anagrafe sa se
                    // il PNG che una nota mostra c'è davvero. Con il solo grafo
                    // la seconda domanda non era rispondibile, e l'unica cosa
                    // onesta che si poteva fare era tacere su ogni allegato.
                    &health::VaultView {
                        graph: &self.graph,
                        entries: &self.entries,
                        names: &self.names,
                    },
                    &self.registry.all_extensions(),
                    &self.date_formats(),
                );
                Ok(IndexResult::VaultHealth(Paged::window(issues, page)))
            }
            IndexQuery::Drafts { page } => {
                // Il guasto risale a chi ha chiesto la pagina invece di
                // diventare una pagina vuota: chiedere le bozze e riceverne
                // zero perché la cartella non si è letta è il modo in cui il
                // recupero di un testo non salvato non viene offerto a nessuno.
                let drafts = self.drafts.read().map_err(|and| {
                    PluginError::Io(
                        format!("drafts were not read ({}): {and}", self.drafts.dir()).into(),
                    )
                })?;
                // **Qui `Paged::from_source` non guadagna niente**, ed è un
                // fatto misurato dal banco del §17.1 (decisione 0113) e non una
                // scelta di comodo: la linearità di questa famiglia sta *a
                // monte*, in `drafts.read()`, che apre e deserializza ogni
                // bozza del disco prima che questa riga cominci; e il `map` qui
                // sotto **sposta** il testo invece di copiarlo, quindi
                // costruirlo fuori dalla finestra non alloca. Chi volesse
                // rendere costante il prezzo di questa pagina deve paginare la
                // lettura, che è un'altra cosa e sta dall'altra parte.
                let items = drafts
                    .drafts
                    .into_iter()
                    .map(|d| {
                        let entry = self.entries.get(&d.doc);
                        DraftInfo {
                            doc: d.doc,
                            at: d.at,
                            base: d.base,
                            // L'anagrafe è la fonte di entrambi: `exists` è
                            // «c'è una voce», `current` è l'impronta che
                            // qualcuno ha già pagato. Nessuna delle due apre un
                            // file — offrire un recupero non deve costare una
                            // rilettura del vault.
                            exists: entry.is_some(),
                            current: entry.and_then(|and| and.fingerprint.clone()),
                            text: d.text,
                        }
                    })
                    .collect::<Vec<_>>();
                Ok(IndexResult::Drafts(Paged::window(items, page)))
            }
            // Il filtro sta **prima** della finestra, e non è un dettaglio: una
            // pagina tagliata sull'anagrafe intera e poi filtrata sarebbe una
            // pagina con dentro un numero di righe che dipende da cosa c'è nel
            // resto del vault (§14.4).
            //
            // Le voci di una cartella sono un tratto contiguo della mappa, come
            // in `folders_under`: il giro parte dalla sua soglia e si ferma dove
            // il prefisso non regge più, e la risposta cresce con la cartella e
            // non col vault. Il filtro resta la regola.
            IndexQuery::Entries {
                of_kind,
                within,
                page,
            } => {
                let from = subtree_start(
                    within
                        .as_ref()
                        .map_or("", |scope| fub_abi::rules::folders::normalized(&scope.path)),
                );
                Ok(IndexResult::Entries(Paged::from_source(
                    self.entries
                        .range(DocId::new(from.as_str())..)
                        .map(|(_, entry)| entry)
                        .take_while(|entry| entry.id.as_str().starts_with(&from))
                        .filter(|and| of_kind.is_none_or(|k| and.kind == k))
                        .filter(|and| match &within {
                            Some(scope) => in_folder(&and.id, &scope.path, scope.descendants),
                            None => true,
                        }),
                    page,
                    // La clonazione è **qui dentro** e non un `.cloned()` sulla
                    // catena: il filtro cammina il tratto intero per dire quanti
                    // sono, ma una `VaultEntry` la si copia solo se sta nella
                    // finestra.
                    VaultEntry::clone,
                )))
            }
            IndexQuery::Folders { under, page } => Ok(IndexResult::Folders(Paged::window(
                self.folders_under(under.as_ref()),
                page,
            ))),
            IndexQuery::Custom { ns, .. } => Err(PluginError::Unserved(
                format!("the kernel index does not extend the channel: `{ns}`").into(),
            )),
            IndexQuery::VaultStatus => Ok(IndexResult::VaultStatus(self.watch.status())),
            IndexQuery::Jobs => Ok(IndexResult::Jobs(self.jobs.live())),
            IndexQuery::Organization => Ok(IndexResult::Organization(self.organization.snapshot())),
            // Arriva solo se qualcuno chiama `indexes.query` di qua, non dal
            // canale dati: `Workspace::query_index` intercetta Settings prima,
            // perché qui non ci sono i cataloghi con cui risolvere le etichette.
            IndexQuery::Settings { plugin } => Ok(IndexResult::Settings(
                self.settings
                    .read()
                    .expect("config store")
                    .entries(plugin.as_deref()),
            )),
            // Le tre specie di bersaglio hanno tre regole diverse, e il punto di
            // questa variante è **non** inventarne una quarta che le indovini:
            // chi chiede dice di che specie è il riferimento, perché lo sa — è
            // ciò che ha parsato, o ciò che `LinkTarget::classify` gli ha
            // risposto.
            IndexQuery::Resolve { target, from } => {
                Ok(IndexResult::Resolved(self.resolve(&target, from.as_ref())))
            }
            // La resa è intercettata da `Workspace::query_index` prima di
            // arrivare qui: `CoreIndex` non possiede i documenti né i renderer.
            // Questi bracci non si raggiungono mai, ma il `match` è esaustivo e
            // non accetta un `_` — vedi la 0104.
            IndexQuery::RenderPreview { .. }
            | IndexQuery::RenderEmbed { .. }
            | IndexQuery::RenderPrint { .. }
            | IndexQuery::SyntaxForms { .. } => Err(PluginError::Internal(
                "workspace-owned query reached the kernel index".into(),
            )),
        }
    }
}
