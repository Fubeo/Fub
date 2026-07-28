//! L'indice del **kernel**: metadati parsati, conteggi dei tag, grafo dei link.
//!
//! Queste risposte c'erano già. Non erano un indice: erano un `match` con dei
//! `return` anticipati in cima a `query_index`, e la conseguenza non era di
//! stile — sette varianti su nove non arrivavano a **nessun** provider
//! registrato, e nessuno se ne accorgeva leggendo il contratto. Un autore di
//! plugin vedeva nove varianti e ne poteva servire due.
//!
//! Adesso sono un [`IndexProvider`] come gli altri, registrato per primo. Cosa
//! cambia davvero, in tre punti:
//!
//! 1. **Il percorso di dispatch è uno.** Non «prima il kernel, poi il ciclo»:
//!    una tabella, e chi c'è dentro.
//! 2. **Il kernel non è più il primo rispondente non scavalcabile.** Chi vuole
//!    servire i tag o la salute del vault con un motore proprio lo dichiara, e
//!    la sostituzione si chiede per nome
//!    (`Workspace::replace_index_provider`) invece di essere impossibile.
//! 3. **Le regole escono da dietro un `match` privato** e diventano
//!    l'implementazione di un trait: si leggono, si provano, e a M5 si possono
//!    mettere alla prova contro la stessa conformance suite di un indice di
//!    terzi.
//!
//! Quello che **non** cambia è dove sta la verità: grafo e metadati restano del
//! kernel perché ne è l'unica fonte, e duplicarli dentro un altro indice
//! creerebbe una seconda verità che può divergere dalla prima. La differenza è
//! che adesso quella scelta è **dichiarata** — chi la volesse contraddire
//! troverebbe un conflitto di registrazione, non un ordine di montaggio che
//! decide in silenzio.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use fubmd_abi::model::{canonical_tag, DocId, DocumentModel, Frontmatter, Heading, Link};
use fubmd_abi::query::{in_folder, Matches, QueryEvaluator, QueryPredicate};
use fubmd_abi::rules::properties;
use fubmd_abi::traits::{
    HostApi, IndexProvider, IndexQuery, IndexResult, JobId, JobProgress, JobStatus, LinkDirection,
    Paged, PredicateKind, QueryKind, QueryRoute, VaultStatus,
};
use fubmd_abi::PluginError;

use crate::graph::{GraphSource, LinkGraph};
use crate::health;
use crate::organization::OrganizationStore;
use crate::registry::FormatRegistry;
use crate::settings::SharedSettings;
use crate::tag_counts::TagCounts;
use crate::workspace::GraphUpdate;

/// I metadati di un documento tenuti in cache: identità, frontmatter (alias),
/// outline, link — ciò che le mutazioni devono mantenere e che grafo, canale
/// metadata e riscrittura dei link consumano.
///
/// Il **corpo** (albero dei blocchi) e il **testo piano** non ci sono: è lo
/// split metadata/body di M2. Il render li riparsa dal disco on demand — è
/// per-documento e su richiesta, mentre questa cache è per-vault e sempre
/// calda: tenerci dentro i corpi significava pagare la memoria dell'intero
/// vault per servire letture che il disco serve benissimo. I tag non ci sono
/// per lo stesso principio: il loro stato aggregato vive in [`TagCounts`],
/// mantenuto incrementalmente, e il contributo per-nota lo ricorda lui.
pub(crate) struct DocMeta {
    pub(crate) id: DocId,
    pub(crate) frontmatter: Frontmatter,
    pub(crate) outline: Vec<Heading>,
    pub(crate) links: Vec<Link>,
}

/// I metadati si prendono da un modello **prestato**, perché l'alimentazione è
/// quella di ogni indice (`&DocumentModel`) e non più un passaggio di proprietà
/// riservato al kernel. Il costo è la copia di frontmatter, outline e link — non
/// del corpo, che in cache non ci va: è lo split metadata/body, ed è ciò che
/// rende questa copia più piccola del modello che l'ha generata.
impl From<&DocumentModel> for DocMeta {
    fn from(model: &DocumentModel) -> Self {
        DocMeta {
            id: model.id.clone(),
            frontmatter: model.frontmatter.clone(),
            outline: model.outline.clone(),
            links: model.links.clone(),
        }
    }
}

impl GraphSource for DocMeta {
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

pub(crate) struct CoreIndex {
    /// La cache dei metadati. È l'insieme dei documenti indicizzati:
    /// `contains_key` qui È «il workspace lo conosce».
    ///
    /// `BTreeMap` e non `HashMap`, ed è una conseguenza della finestra sulla
    /// lista documenti (§5.5): l'ordine ce l'ha per costruzione, quindi
    /// `list_documents` non riordina più il vault a ogni chiamata e una pagina
    /// si taglia dall'iteratore senza materializzare il resto. Il costo è un
    /// `log n` per lettura invece di un `1`, su una mappa che sta in RAM.
    pub(crate) metas: BTreeMap<DocId, DocMeta>,
    /// I conteggi dei tag, mantenuti incrementalmente come il grafo: le
    /// interrogazioni sui tag rispondono da qui, senza O(vault).
    pub(crate) tags: TagCounts,
    pub(crate) graph: LinkGraph,
    pub(crate) graph_update: GraphUpdate,
    /// Serve a un controllo solo — distinguere un link a una nota da un
    /// riferimento a un allegato — ed è **condiviso** col workspace invece che
    /// copiato: due elenchi di estensioni sarebbero due idee di cosa è un
    /// documento, e la seconda mentirebbe in silenzio il giorno che i formati
    /// si registrano a caldo.
    registry: Arc<FormatRegistry>,
    /// Che rapporto ha questo vault con il disco (§9.7).
    ///
    /// Sta qui e non sul `Workspace` per la ragione della
    /// [0019](../../../../docs/decisions/0019-il-canale-dati.md): *le risposte
    /// del kernel sono un provider*, e questa è una risposta del kernel. Metterla
    /// sul workspace avrebbe voluto dire intercettare una variante **prima** del
    /// router — cioè rimettere il ramo privilegiato che quella decisione ha
    /// tolto.
    pub(crate) watch: WatchState,
    /// **Cosa sta girando adesso** (§10.3), per la stessa ragione della riga
    /// sopra: è una risposta del kernel, e le risposte del kernel sono un
    /// provider (decisione 0019).
    pub(crate) jobs: JobsState,
    /// **Com'è configurato questo vault** (§11.1), e per la terza volta la
    /// stessa ragione. È **condiviso** col workspace, come `registry`: lo
    /// riempie chi dichiara un plugin, lo scrive chi tocca un interruttore, e
    /// questo indice lo legge — una copia sarebbe una configurazione che
    /// risponde a com'era al montaggio.
    settings: SharedSettings,
    /// **Com'è organizzato questo vault** (§11.3): icone, appuntate,
    /// ordinamenti, spazi. Condiviso col workspace come `settings`, e per la
    /// stessa ragione — lo scrive chi appunta una nota, e questo indice lo
    /// legge; una copia risponderebbe con com'era al montaggio.
    ///
    /// Che sia qui è il guadagno di questa voce: prima l'organizzazione non era
    /// interrogabile affatto — la leggeva un comando IPC, quindi la sapeva
    /// chiedere la shell e nessun altro.
    organization: Arc<OrganizationStore>,
}

/// Il fatto che il §9.7 rende interrogabile: se qualcuno vede le scritture
/// altrui, e cosa è già andato storto nel leggerle.
#[derive(Default)]
pub(crate) struct WatchState {
    /// **Condiviso** con chi tiene vivo il rilevatore (`fubmd-host`): il kernel
    /// non sa cosa sia un watcher, e questo è tutto ciò che gliene serve sapere.
    ///
    /// Un `Arc<AtomicBool>` e non un `bool`, perché la risposta deve poter
    /// diventare `false` **mentre il vault è aperto**. Prima
    /// `VaultWatcher::is_watching` rispondeva *per costruzione* — distingueva
    /// «non ho avviato un debouncer» da «ne ho avviato uno», e un debouncer
    /// morto continuava a rispondere `true`.
    pub(crate) watching: Arc<AtomicBool>,
    failures: u32,
    last_error: Option<String>,
}

impl WatchState {
    /// Registra l'esito di una sincronizzazione per-path.
    ///
    /// Sta **dentro** il kernel, ed è il punto: i due chiamanti veri scrivevano
    /// `let _ = ws.sync_path(…)`, quindi il `Result` c'era e non lo leggeva
    /// nessuno. Registrandolo qui, un chiamante distratto non può più nasconderlo
    /// — al più non lo guarda lui, ma il vault se lo ricorda.
    fn note(&mut self, error: impl std::fmt::Display) {
        self.failures = self.failures.saturating_add(1);
        self.last_error = Some(error.to_string());
    }

    fn status(&self) -> VaultStatus {
        VaultStatus {
            watching: self.watching.load(Ordering::Relaxed),
            sync_failures: self.failures,
            last_sync_error: self.last_error.clone(),
        }
    }
}

/// **I lavori lunghi vivi** (§10.3, decisione 0035): da quando il kernel
/// accetta un job a quando ne riconsegna l'esito.
///
/// È una tabella e non un conto, ed è ciò che permette al centro attività di
/// **riconciliare**: gli eventi del ciclo di un job sono recuperabili
/// ([`Event::is_recoverable`](fubmd_abi::Event::is_recoverable)) proprio perché
/// c'è questa, e senza di essa il canale più fitto del contratto sarebbe l'unico
/// che non si può frenare.
///
/// `BTreeMap` per l'ordine, e la chiave è il **numero** dentro il [`JobId`] e
/// non l'id: un `JobId` è opaco per contratto — chi lo ordina sta assumendo
/// qualcosa che l'host non gli deve — e l'unico che quell'assunzione la può
/// fare è chi i numeri li assegna, cioè questo kernel. Ne esce l'elenco
/// nell'ordine in cui il lavoro è stato chiesto, che è l'unico che chi guarda
/// riconosce.
#[derive(Default)]
pub(crate) struct JobsState {
    live: BTreeMap<u64, JobStatus>,
}

impl JobsState {
    /// Un job è stato accettato: da qui è vivo, e da qui si vede.
    ///
    /// Il `since` lo prende chi accetta e non chi chiede: è il momento in cui il
    /// kernel se ne è fatto carico, e un job che aspetta un thread libero è già
    /// in attesa da allora.
    pub(crate) fn accepted(&mut self, id: JobId, job: &str, plugin: &str) {
        self.live.insert(
            id.0,
            JobStatus {
                id,
                job: job.to_string(),
                plugin: plugin.to_string(),
                since: crate::time::now_unix_millis(),
                progress: None,
            },
        );
    }

    /// Registra un progresso, e dice se il job era **vivo**.
    ///
    /// Il `false` non è pignoleria: un progresso che arriva per un job già
    /// concluso — l'host che lo timbra gira su un altro thread, e fra il suo
    /// ultimo passo e l'esito ci sta di tutto — non deve far ricomparire una
    /// riga nel centro attività. Chi lo riceve non lo emette nemmeno.
    pub(crate) fn progressed(&mut self, id: JobId, progress: JobProgress) -> bool {
        match self.live.get_mut(&id.0) {
            Some(status) => {
                status.progress = Some(progress);
                true
            }
            None => false,
        }
    }

    /// Di chi è questo job, se è ancora vivo. Serve a intestargli il proprio
    /// progresso: l'origine di un `job-progress` è il plugin che sta lavorando,
    /// e chi timbra l'evento ha in mano l'id, non il nome.
    pub(crate) fn owner(&self, id: JobId) -> String {
        self.live
            .get(&id.0)
            .map(|status| status.plugin.clone())
            .unwrap_or_default()
    }

    /// L'esito è tornato: il job smette di essere vivo.
    pub(crate) fn finished(&mut self, id: JobId) {
        self.live.remove(&id.0);
    }

    pub(crate) fn live(&self) -> Vec<JobStatus> {
        self.live.values().cloned().collect()
    }
}

impl CoreIndex {
    pub(crate) fn new(
        registry: Arc<FormatRegistry>,
        settings: SharedSettings,
        organization: Arc<OrganizationStore>,
    ) -> Self {
        CoreIndex {
            metas: BTreeMap::new(),
            tags: TagCounts::default(),
            graph: LinkGraph::default(),
            graph_update: GraphUpdate::default(),
            registry,
            watch: WatchState::default(),
            jobs: JobsState::default(),
            settings,
            organization,
        }
    }

    /// Registra un fallimento di sincronizzazione (§9.7).
    pub(crate) fn note_sync_failure(&mut self, error: impl std::fmt::Display) {
        self.watch.note(error);
    }

    pub(crate) fn contains(&self, id: &DocId) -> bool {
        self.metas.contains_key(id)
    }

    /// Gli id indicizzati, in ordine. L'ordine non è una cortesia: è ciò che
    /// rende stabile una risposta paginata.
    pub(crate) fn ids(&self) -> impl Iterator<Item = &DocId> {
        self.metas.keys()
    }

    pub(crate) fn documents(&self) -> Vec<DocId> {
        self.metas.keys().cloned().collect()
    }

    pub(crate) fn clear(&mut self) {
        self.metas.clear();
        self.tags.clear();
    }

    pub(crate) fn rebuild_graph(&mut self) {
        self.graph = LinkGraph::build(self.metas.values());
    }

    /// Il frontmatter di un documento, per chi compone una riga di risposta.
    pub(crate) fn frontmatter(&self, id: &DocId) -> Option<&Frontmatter> {
        self.metas.get(id).map(|m| &m.frontmatter)
    }

    /// I documenti in relazione di link con `doc`, secondo il verso chiesto.
    fn linked(&self, doc: &DocId, direction: LinkDirection) -> Vec<DocId> {
        match direction {
            LinkDirection::Outbound => self.graph.outgoing(doc),
            LinkDirection::Inbound => self
                .graph
                .backlinks(doc)
                .into_iter()
                .map(|b| b.source)
                .collect(),
            LinkDirection::Both => {
                let mut all = self.graph.outgoing(doc);
                all.extend(self.graph.backlinks(doc).into_iter().map(|b| b.source));
                all
            }
        }
    }
}

impl QueryEvaluator for CoreIndex {
    fn universe(&self) -> Result<Matches, PluginError> {
        Ok(Matches::of_docs(self.metas.keys().cloned()))
    }

    fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
        match predicate {
            QueryPredicate::Property { filter } => Ok(Matches::of_docs(
                self.metas
                    .iter()
                    .filter(|(_, meta)| properties::test(&meta.frontmatter, filter))
                    .map(|(id, _)| id.clone()),
            )),
            QueryPredicate::Tag { name, descendants } => {
                let wanted = canonical_tag(name);
                Ok(Matches::of_docs(self.tags.docs_with(&wanted, *descendants)))
            }
            QueryPredicate::Folder { path, descendants } => Ok(Matches::of_docs(
                self.metas
                    .keys()
                    .filter(|id| in_folder(id, path, *descendants))
                    .cloned(),
            )),
            QueryPredicate::Linked { doc, direction } => Ok(Matches::of_docs(
                self.linked(doc, *direction)
                    .into_iter()
                    .filter(|id| self.metas.contains_key(id)),
            )),
            // Ciò che il pianificatore ha già risolto per conto di qualcun
            // altro: si prende per buono, ristretto a ciò che esiste.
            QueryPredicate::Docs { docs } => Ok(Matches::of_docs(
                docs.iter()
                    .filter(|id| self.metas.contains_key(id))
                    .cloned(),
            )),
            other => Err(PluginError::Unserved(
                format!("l'indice del kernel non valuta questa foglia: {other:?}").into(),
            )),
        }
    }
}

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
            // Le foglie che sa valutare dai metadati in cache. `Text` non c'è, e
            // non è una lacuna: il kernel non indicizza il corpo, e prometterlo
            // vorrebbe dire scandire il vault a ogni ricerca.
            QueryRoute::Predicate(PredicateKind::Property),
            QueryRoute::Predicate(PredicateKind::Tag),
            QueryRoute::Predicate(PredicateKind::Folder),
            QueryRoute::Predicate(PredicateKind::Linked),
        ]
    }

    /// Niente da ricaricare: la memoria di questo indice è il vault, e la
    /// riscansione la fa il workspace all'apertura.
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_document_indexed(&mut self, doc: &DocumentModel) {
        self.tags.upsert(&doc.id, &doc.tags);
        let meta = DocMeta::from(doc);
        if self.graph_update == GraphUpdate::Incremental {
            self.graph.upsert(&meta);
        }
        self.metas.insert(meta.id.clone(), meta);
    }

    fn on_document_removed(&mut self, id: &DocId) {
        if self.metas.remove(id).is_none() {
            return;
        }
        self.tags.remove(id);
        if self.graph_update == GraphUpdate::Incremental {
            self.graph.remove(id);
        }
    }

    /// L'indice del kernel **è** la verità corrente: non ha niente da
    /// riconciliare con essa. Il rebuild completo, quando è la strategia
    /// scelta, lo chiude il workspace dopo la scansione.
    fn reconcile(&mut self, _ids: &[DocId]) {}

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
            } => {
                let matches = self.expr(&matching)?;
                Ok(IndexResult::Documents(properties::finish(
                    matches,
                    sort.as_ref(),
                    &select,
                    page,
                    |id| self.frontmatter(id),
                )))
            }
            IndexQuery::Backlinks { target, page } => Ok(IndexResult::Backlinks(Paged::window(
                self.graph.backlinks(&target),
                page,
            ))),
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
                let mut all = Vec::new();
                // I semi in ordine di id, e i vicini di ognuno di seguito: senza
                // un ordine totale la seconda pagina di un grafo grande
                // ripeterebbe righe della prima.
                for seed in from.ids() {
                    all.extend(self.graph.neighbors(seed, direction, depth));
                }
                Ok(IndexResult::Neighbors(Paged::window(all, page)))
            }
            IndexQuery::PropertyValues {
                key,
                matching,
                page,
            } => {
                let selected = self.expr(&matching)?;
                let facets = properties::facets(
                    selected
                        .ids()
                        .filter_map(|id| self.metas.get(id).map(|m| (id, &m.frontmatter))),
                    &key,
                );
                Ok(IndexResult::PropertyValues(Paged::window(facets, page)))
            }
            IndexQuery::VaultHealth { check, page } => {
                let issues = health::run(
                    check,
                    self.metas.iter().map(|(id, m)| (id, m.links.as_slice())),
                    &self.graph,
                    &self.registry.all_extensions(),
                );
                Ok(IndexResult::VaultHealth(Paged::window(issues, page)))
            }
            IndexQuery::Custom { ns, .. } => Err(PluginError::Unserved(
                format!("l'indice del kernel non estende il canale: `{ns}`").into(),
            )),
            IndexQuery::VaultStatus => Ok(IndexResult::VaultStatus(self.watch.status())),
            IndexQuery::Jobs => Ok(IndexResult::Jobs(self.jobs.live())),
            IndexQuery::Organization => Ok(IndexResult::Organization(self.organization.snapshot())),
            IndexQuery::Settings { plugin } => Ok(IndexResult::Settings(
                self.settings
                    .read()
                    .expect("store di configurazione")
                    .entries(plugin.as_deref()),
            )),
        }
    }
}
