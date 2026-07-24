//! Il `Workspace`: l'orchestratore del core. Tiene insieme vault, registry dei
//! formati, cache dei modelli parsati, grafo dei link, event bus e handler di
//! eventi. È l'API principale che l'app Tauri consuma. Resta agnostico: parla
//! solo tramite `dyn FormatProvider` / `dyn EventHandler` e i tipi di
//! `fubmd-abi`.
//!
//! # Dispatch degli eventi: a coda, mai ricorsivo
//!
//! Gli [`EventHandler`] registrati sono chiamati **sincronamente ma a coda**:
//! ogni operazione pubblica che muta il workspace accoda i propri eventi e li
//! drena alla fine ([`Workspace::dispatch_pending`]). Un handler che durante
//! `handle` emette eventi o scrive documenti (via [`HostApi`]) non innesca un
//! dispatch ricorsivo: i nuovi eventi finiscono in coda e sono drenati dallo
//! stesso ciclo, con un budget che tronca i ping-pong infiniti fra handler —
//! troncamento **rumoroso**: al posto degli eventi persi arriva un
//! [`Event::Overflow`] col conteggio, e chi deriva stato dagli eventi
//! riconcilia da zero. Durante il drenaggio gli handler sono *estratti* dal
//! workspace, così il `HostApi` può prestare `&mut Workspace` senza aliasing.
//!
//! Il lavoro **lungo** (rete, calcolo pesante) non passa dagli handler: un
//! provider lo chiede via [`HostApi::spawn_job`], l'host lo esegue fuori dal
//! lock ([`Workspace::take_pending_jobs`]) e l'esito rientra come
//! [`Event::JobDone`] ([`Workspace::complete_job`]).
//!
//! Il canale [`EventBus`] resta il ponte verso i subscriber esterni (frontend,
//! watcher): riceve gli stessi eventi, senza passare dalla coda.
//!
//! # Indici: alimentati direttamente, non dagli eventi
//!
//! Gli [`IndexProvider`] registrati ricevono ogni documento che entra o esce
//! **dentro la stessa operazione** che aggiorna il grafo, non via event bus.
//! È deliberato: la coda eventi ha un budget e può troncare, un indice no —
//! un indice che perde un aggiornamento mente, e mentirebbe in silenzio. Ciò
//! che invece l'indice non può vedere è quel che succede mentre non è vivo
//! (cancellazioni ad app chiusa): lo chiude [`IndexProvider::reconcile`] in
//! [`Workspace::reindex`].

use std::collections::{BTreeSet, HashMap, VecDeque};

use camino::Utf8Path;
use fubmd_abi::format::{ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel, LinkTarget, Span};
use fubmd_abi::traits::{
    BacklinkRef, EventHandler, HostApi, IndexProvider, IndexQuery, IndexResult, JobId, JobSpec,
};
use fubmd_abi::{Event, PluginError};

use crate::bus::EventBus;
use crate::error::{KernelError, Result};
use crate::graph::{normalize, strip_ext, LinkGraph};
use crate::registry::FormatRegistry;
use crate::vault::Vault;

/// Come il `Workspace` tiene aggiornato il grafo dopo una modifica.
///
/// L'incrementale è il percorso normale; il rebuild completo resta disponibile
/// come rete di sicurezza (e come oracolo nei test) finché non ci fidiamo
/// ciecamente dell'invalidazione — vedi `docs/milestones/M2-search-graph.md`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum GraphUpdate {
    #[default]
    Incremental,
    FullRebuild,
}

/// Tetto di eventi drenati in un singolo `dispatch_pending`: tronca i cicli
/// di handler che si rimbalzano eventi a vicenda senza convergere. Il
/// troncamento NON è silenzioso: emette [`Event::Overflow`] (bus + handler),
/// così chi deriva stato dagli eventi sa di dover riconciliare da zero.
const DISPATCH_BUDGET: usize = 1024;

pub struct Workspace {
    vault: Vault,
    registry: FormatRegistry,
    models: HashMap<DocId, DocumentModel>,
    graph: LinkGraph,
    graph_update: GraphUpdate,
    bus: EventBus,
    /// Handler registrati (feature ufficiali; a M4/M5 i plugin via registry).
    handlers: Vec<Box<dyn EventHandler>>,
    /// Indici derivati dal contenuto, alimentati **direttamente** (non via
    /// event bus) dentro le stesse operazioni che aggiornano il grafo — così
    /// un troncamento della coda eventi non può far divergere un indice.
    indexes: Vec<Box<dyn IndexProvider>>,
    /// Eventi in attesa di dispatch verso gli handler.
    pending: VecDeque<Event>,
    /// Guardia anti-rientranza: `dispatch_pending` non si annida mai.
    dispatching: bool,
    /// Job richiesti via [`HostApi::spawn_job`], in attesa che l'host li
    /// esegua fuori dal giro sincrono (vedi [`Workspace::take_pending_jobs`]).
    pending_jobs: Vec<(JobId, JobSpec)>,
    /// Contatore per l'assegnazione dei [`JobId`].
    next_job_id: u64,
    /// Storage chiave→valore dell'`HostApi`. In-memory per ora; persistenza e
    /// namespace per-plugin arrivano col registry dei plugin (M4), vedi
    /// `docs/architecture/plugin-boundary.md`.
    storage: HashMap<String, serde_json::Value>,
}

impl Workspace {
    /// Crea un workspace su una radice con un registry di provider già popolato.
    pub fn new(root: impl AsRef<Utf8Path>, registry: FormatRegistry) -> Self {
        Workspace {
            vault: Vault::open(root),
            registry,
            models: HashMap::new(),
            graph: LinkGraph::default(),
            graph_update: GraphUpdate::default(),
            bus: EventBus::new(),
            handlers: Vec::new(),
            indexes: Vec::new(),
            pending: VecDeque::new(),
            dispatching: false,
            pending_jobs: Vec::new(),
            next_job_id: 0,
            storage: HashMap::new(),
        }
    }

    /// Sceglie la strategia di aggiornamento del grafo (default: incrementale).
    pub fn set_graph_update(&mut self, mode: GraphUpdate) {
        self.graph_update = mode;
    }

    pub fn graph_update(&self) -> GraphUpdate {
        self.graph_update
    }

    pub fn bus(&self) -> &EventBus {
        &self.bus
    }

    pub fn root(&self) -> &Utf8Path {
        self.vault.root()
    }

    /// Registra un [`EventHandler`] (fidato: le feature ufficiali). I plugin di
    /// terzi passeranno dal registry dei plugin (M4/M5), che applica permessi e
    /// confine di fiducia prima di arrivare qui.
    pub fn register_event_handler(&mut self, handler: Box<dyn EventHandler>) {
        self.handlers.push(handler);
    }

    /// Registra un [`IndexProvider`]. Va fatto **prima** di [`reindex`], che è
    /// il momento in cui l'indice riceve il contenuto del vault e riconcilia
    /// ciò che è cambiato mentre non era vivo.
    ///
    /// [`reindex`]: Workspace::reindex
    pub fn register_index_provider(&mut self, index: Box<dyn IndexProvider>) {
        self.indexes.push(index);
    }

    /// Riparsa tutti i documenti del vault, ricostruisce il grafo e allinea
    /// gli indici registrati.
    ///
    /// Per gli indici questo **non** è un rebuild: ogni documento passa da
    /// `on_document_indexed` (un indice persistente riconosce e salta gli
    /// immutati) e [`IndexProvider::reconcile`] gli dice qual è l'insieme
    /// completo, così cancella ciò che è sparito ad app chiusa.
    pub fn reindex(&mut self) -> Result<()> {
        let ids = self.vault.list_documents(&self.registry.all_extensions())?;
        let mut models = HashMap::with_capacity(ids.len());
        for id in ids {
            {
                let src = self.vault.read(&id)?;
                let model = self.parse(&id, &src)?;
                models.insert(id, model);
            }
        }
        self.models = models;
        self.rebuild_graph();

        for index in self.indexes.iter_mut() {
            for model in self.models.values() {
                index.on_document_indexed(model);
            }
        }
        let ids: Vec<DocId> = self.documents();
        for index in self.indexes.iter_mut() {
            index.reconcile(&ids);
        }
        // Gli errori di flush non fanno fallire l'apertura del vault: un
        // indice è stato derivato, il vault è la verità (M4: notifica).
        let _ = self.flush_indexes();

        self.emit_event(Event::VaultOpened {
            root: self.vault.root().to_string(),
        });
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        Ok(())
    }

    /// Elenco ordinato dei documenti indicizzati.
    pub fn documents(&self) -> Vec<DocId> {
        let mut ids: Vec<DocId> = self.models.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn model(&self, id: &DocId) -> Option<&DocumentModel> {
        self.models.get(id)
    }

    /// Sorgente grezza di un documento dal disco.
    pub fn read_source(&self, id: &DocId) -> Result<String> {
        self.vault.read(id)
    }

    /// Scrive la sorgente, riparsa il documento, aggiorna il grafo ed emette
    /// gli eventi. Il grafo si aggiorna per-documento ([`GraphUpdate`]).
    pub fn write_document(&mut self, id: &DocId, source: &str) -> Result<()> {
        self.vault.write(id, source)?;
        self.ingest(id, source)?;
        self.dispatch_pending();
        Ok(())
    }

    /// Riparsa un documento già presente sul disco (usato dal file watcher).
    pub fn refresh_from_disk(&mut self, id: &DocId) -> Result<()> {
        let src = self.vault.read(id)?;
        self.ingest(id, &src)?;
        self.dispatch_pending();
        Ok(())
    }

    fn ingest(&mut self, id: &DocId, source: &str) -> Result<()> {
        let model = self.parse(id, source)?;
        self.models.insert(id.clone(), model);
        match self.graph_update {
            // borrow disgiunti: `graph` in scrittura, `models` in lettura.
            GraphUpdate::Incremental => self.graph.upsert(&self.models[id]),
            GraphUpdate::FullRebuild => self.rebuild_graph(),
        }
        // Gli indici vedono la modifica nella stessa operazione del grafo:
        // stessa verità, nessun canale che può perdere pezzi per strada.
        let model = &self.models[id];
        for index in self.indexes.iter_mut() {
            index.on_document_indexed(model);
        }
        self.emit_event(Event::DocumentChanged { id: id.clone() });
        self.emit_event(Event::IndexUpdated);
        Ok(())
    }

    /// Sincronizza un path assoluto dopo un evento del filesystem: riparsa se
    /// esiste ed è un formato gestito, rimuove se sparito. Restituisce `true`
    /// se qualcosa è cambiato. Path fuori dal vault o senza provider: ignorati.
    pub fn sync_path(&mut self, abs: &Utf8Path) -> Result<bool> {
        let id = match self.vault.doc_id_for_path(abs) {
            Ok(id) => id,
            Err(_) => return Ok(false),
        };
        let ext = extension_of(&id).unwrap_or_default();
        if self.registry.provider_for_ext(&ext).is_none() {
            return Ok(false);
        }
        if abs.exists() {
            self.refresh_from_disk(&id)?;
            Ok(true)
        } else {
            let existed = self.models.contains_key(&id);
            self.remove_document(&id);
            Ok(existed)
        }
    }

    /// Rimuove un documento (usato dal file watcher su cancellazione).
    pub fn remove_document(&mut self, id: &DocId) {
        if self.models.remove(id).is_some() {
            match self.graph_update {
                GraphUpdate::Incremental => self.graph.remove(id),
                GraphUpdate::FullRebuild => self.rebuild_graph(),
            }
            for index in self.indexes.iter_mut() {
                index.on_document_removed(id);
            }
            self.emit_event(Event::DocumentRemoved { id: id.clone() });
            self.emit_event(Event::IndexUpdated);
            self.dispatch_pending();
        }
    }

    /// Rinomina/sposta un documento **preservando l'identità**: file sul disco,
    /// modello, grafo, e riscrittura chirurgica dei wikilink entranti che
    /// puntavano al vecchio nome o path (stile Obsidian). I link per **alias**
    /// non vengono toccati: l'alias vive nel frontmatter del documento e
    /// sopravvive al rename.
    ///
    /// Emette [`Event::DocumentRenamed`] (non `Removed`+`Changed`): chi tiene
    /// stato per-documento migra la chiave.
    pub fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        if from == to {
            return Ok(());
        }
        if !self.models.contains_key(from) {
            return Err(KernelError::NotFound(from.to_string()));
        }
        // Rename "case-only" (`nota.md` → `Nota.md`): su un filesystem
        // case-insensitive (macOS/Windows) `vault.exists(to)` vede lo STESSO
        // file, non una collisione — il check sul disco va saltato. Un vero
        // omonimo-per-case su filesystem case-sensitive è comunque intercettato
        // da `models` (il vault è l'unica fonte dei DocId, quindi lo conosce).
        let case_only = from.as_str().to_lowercase() == to.as_str().to_lowercase();
        if self.models.contains_key(to) || (!case_only && self.vault.exists(to)) {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }
        let ext = extension_of(to).unwrap_or_default();
        if self.registry.provider_for_ext(&ext).is_none() {
            return Err(KernelError::NoProvider(ext));
        }

        // Il piano di riscrittura va calcolato PRIMA di toccare il grafo:
        // serve la risoluzione con il vecchio nome ancora in vigore.
        let plan = self.link_rewrite_plan(from, to);

        self.vault.rename(from, to)?;
        let source = self.vault.read(to)?;
        let model = self.parse(to, &source)?;
        self.models.remove(from);
        self.models.insert(to.clone(), model);
        match self.graph_update {
            GraphUpdate::Incremental => {
                self.graph.remove(from);
                self.graph.upsert(&self.models[to]);
            }
            GraphUpdate::FullRebuild => self.rebuild_graph(),
        }
        // Per un indice il rename è remove+add: l'identità è la chiave, e la
        // chiave è cambiata. (Chi tiene stato *per-documento* invece migra la
        // chiave sull'evento `DocumentRenamed`.)
        for index in self.indexes.iter_mut() {
            index.on_document_removed(from);
        }
        let model = &self.models[to];
        for index in self.indexes.iter_mut() {
            index.on_document_indexed(model);
        }
        self.emit_event(Event::DocumentRenamed {
            from: from.clone(),
            to: to.clone(),
        });

        for (src, new_source) in plan {
            // write_document riparsa, aggiorna il grafo ed emette gli eventi.
            self.write_document(&src, &new_source)?;
        }
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        Ok(())
    }

    /// Per ogni documento che linkava `from` per nome o per path, la nuova
    /// sorgente con i riferimenti riscritti verso `to`. Sostituzione
    /// chirurgica: si tocca solo il testo-pagina dentro lo `Span` del link,
    /// mai il resto del documento (heading `#...`, blocco `^...`, alias
    /// `|label` e formattazione restano intatti).
    fn link_rewrite_plan(&self, from: &DocId, to: &DocId) -> Vec<(DocId, String)> {
        let from_name = normalize(from.page_name());
        let from_path = normalize(&strip_ext(from.as_str()));

        // Nuovo riferimento: il nome pagina se nessun altro documento lo
        // contende (a quel punto la risoluzione per nome è certa), altrimenti
        // il path senza estensione, che è sempre univoco.
        let to_name = to.page_name();
        let ambiguous = self
            .models
            .keys()
            .any(|id| id != from && normalize(id.page_name()) == normalize(to_name));
        let new_ref = if ambiguous {
            strip_ext(to.as_str())
        } else {
            to_name.to_string()
        };

        let sources: BTreeSet<DocId> = self
            .graph
            .backlinks(from)
            .into_iter()
            .map(|r| r.source)
            .collect();

        let mut plan = Vec::new();
        for src in sources {
            let Some(model) = self.models.get(&src) else {
                continue;
            };
            let Ok(source_text) = self.vault.read(&src) else {
                continue;
            };
            let mut edits: Vec<Span> = Vec::new();
            for link in &model.links {
                let LinkTarget::Wiki { page, .. } = &link.target else {
                    continue;
                };
                // Riscrivi solo se il link puntava davvero a `from` (non a un
                // omonimo) e ci arrivava per nome o per path — mai per alias.
                let key = normalize(page);
                let by_name = key == from_name;
                let by_path = key == from_path || normalize(&strip_ext(&key)) == from_path;
                if !(by_name || by_path) {
                    continue;
                }
                if self.graph.resolve_wiki(page).as_ref() != Some(from) {
                    continue;
                }
                let Some(slice) = source_text.get(link.span.start..link.span.end) else {
                    continue;
                };
                let Some(rel) = slice.find(page.as_str()) else {
                    continue;
                };
                let start = link.span.start + rel;
                edits.push(Span::new(start, start + page.len()));
            }
            if edits.is_empty() {
                continue;
            }
            edits.sort_by_key(|s| s.start);
            let mut out = String::with_capacity(source_text.len());
            let mut pos = 0;
            for span in edits {
                if span.start < pos {
                    continue; // sovrapposizioni: difensivo, non dovrebbe accadere
                }
                out.push_str(&source_text[pos..span.start]);
                out.push_str(&new_ref);
                pos = span.end;
            }
            out.push_str(&source_text[pos..]);
            plan.push((src, out));
        }
        plan
    }

    /// Rende l'anteprima HTML di un documento tramite il suo provider.
    pub fn render_preview(&self, id: &DocId) -> Result<String> {
        let model = self
            .models
            .get(id)
            .ok_or_else(|| KernelError::NotFound(id.to_string()))?;
        let provider = self.provider_for(id)?;
        let opts = RenderOptions {
            wikilinks_as_data_attrs: true,
        };
        Ok(provider.render_html(model, &opts)?)
    }

    /// Rende il contenuto di un embed `![[page#heading]]`: risolve la pagina
    /// e rende l'intero documento, o la sola sezione del heading richiesto.
    ///
    /// È il pezzo kernel della **transclusion**: `render_html` dei provider
    /// resta una funzione pura per-documento (emette solo un placeholder per
    /// gli embed); la composizione è del frontend, che chiama questo metodo e
    /// innesta l'HTML nel placeholder. Ricorsione, profondità massima e cicli
    /// sono gestiti dal chiamante, che conosce la catena di embed corrente
    /// (vedi `docs/architecture/ui-protocol.md`).
    pub fn render_embed(&self, page: &str, heading: Option<&str>) -> Result<(DocId, String)> {
        let id = self
            .resolve_link(page)
            .ok_or_else(|| KernelError::NotFound(page.to_string()))?;
        let model = self
            .models
            .get(&id)
            .ok_or_else(|| KernelError::NotFound(id.to_string()))?;
        let provider = self.provider_for(&id)?;
        let opts = RenderOptions {
            wikilinks_as_data_attrs: true,
        };
        let html = match heading {
            None => provider.render_html(model, &opts)?,
            Some(h) => {
                let section = section_of(model, h)
                    .ok_or_else(|| KernelError::NotFound(format!("{id}#{h}")))?;
                provider.render_html(&section, &opts)?
            }
        };
        Ok((id, html))
    }

    /// Backlink verso un documento.
    pub fn backlinks(&self, id: &DocId) -> Vec<BacklinkRef> {
        self.graph.backlinks(id)
    }

    /// Link uscenti risolti da un documento.
    pub fn outgoing(&self, id: &DocId) -> Vec<DocId> {
        self.graph.outgoing(id)
    }

    /// Risolve il nome di un wikilink a un documento esistente.
    pub fn resolve_link(&self, page: &str) -> Option<DocId> {
        self.graph.resolve_wiki(page)
    }

    // --- indici -----------------------------------------------------------

    /// Interroga gli indici.
    ///
    /// I **backlink** non passano dai provider: li serve il grafo del kernel,
    /// che è la loro unica fonte di verità (conosce le regole di risoluzione
    /// dei wikilink e le ambiguità dell'intero vault). Duplicarli in un indice
    /// creerebbe una seconda verità che può divergere dalla prima.
    ///
    /// Tutto il resto va ai provider registrati, in ordine di registrazione:
    /// vince il primo che non risponde [`PluginError::BadArgs`], che è per
    /// contratto il modo di dire "non è roba mia" (vedi
    /// [`IndexQuery::Custom`]). Se nessuno la riconosce, l'errore dell'ultimo
    /// interpellato arriva al chiamante.
    pub fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        if let IndexQuery::Backlinks { target } = &query {
            return Ok(IndexResult::Backlinks(self.graph.backlinks(target)));
        }
        let mut last = Err(PluginError::BadArgs(
            "nessun IndexProvider registrato".to_string(),
        ));
        for index in &self.indexes {
            match index.query(query.clone()) {
                Err(PluginError::BadArgs(msg)) => last = Err(PluginError::BadArgs(msg)),
                other => return other,
            }
        }
        last
    }

    /// Porta gli indici a un punto di consistenza (vedi
    /// [`IndexProvider::flush`]). Da chiamare quando un lotto di modifiche è
    /// finito: il kernel non decide da solo *quando* è finito un lotto.
    ///
    /// L'errore di un indice non fa fallire il chiamante — un indice è stato
    /// *derivato*, la verità è il vault e si ricostruisce. Restituisce gli
    /// errori perché chi ha un canale di notifica possa mostrarli.
    pub fn flush_indexes(&mut self) -> Vec<PluginError> {
        let mut errors = Vec::new();
        for index in self.indexes.iter_mut() {
            if let Err(e) = index.flush() {
                errors.push(e);
            }
        }
        errors
    }

    // --- eventi ------------------------------------------------------------

    /// Unico punto di emissione: ponte verso i subscriber esterni + coda per
    /// gli handler registrati.
    fn emit_event(&mut self, event: Event) {
        self.bus.emit(event.clone());
        self.pending.push_back(event);
    }

    /// Drena la coda eventi verso gli handler. Mai rientrante: chiamato
    /// durante un dispatch (es. da un `write_document` fatto da un handler)
    /// ritorna subito e lascia drenare il ciclo esterno.
    ///
    /// Se il budget si esaurisce (handler che si rimbalzano eventi senza
    /// convergere) il troncamento è **rumoroso**: gli eventi restanti vengono
    /// scartati ma al loro posto viene consegnato — al bus e agli handler —
    /// un [`Event::Overflow`] con il conteggio dei persi. Gli eventi emessi
    /// *durante* la gestione dell'`Overflow` sono a loro volta scartati (è
    /// l'unico modo di garantire la terminazione).
    fn dispatch_pending(&mut self) {
        // La guardia di rientranza DEVE venire prima del fast-path qui sotto:
        // durante un dispatch gli handler sono estratti (`handlers` è vuoto) e
        // svuotare la coda qui butterebbe via gli eventi appena accodati.
        if self.dispatching {
            return;
        }
        if self.handlers.is_empty() {
            // Nessun osservatore: non accumulare eventi all'infinito.
            self.pending.clear();
            return;
        }
        self.dispatching = true;
        let mut budget = DISPATCH_BUDGET;
        while let Some(event) = self.pending.pop_front() {
            if budget == 0 {
                // L'evento estratto e i rimanenti non verranno consegnati.
                let dropped = (self.pending.len() + 1) as u64;
                self.pending.clear();
                let overflow = Event::Overflow { dropped };
                self.bus.emit(overflow.clone());
                self.deliver_to_handlers(&overflow);
                // Ciò che gli handler hanno emesso gestendo l'Overflow è
                // scartato: la coda deve terminare qui.
                self.pending.clear();
                break;
            }
            budget -= 1;
            self.deliver_to_handlers(&event);
        }
        self.dispatching = false;
    }

    /// Consegna un singolo evento a tutti gli handler abbonati. Gli handler
    /// escono dal workspace per la durata della chiamata: così `KernelHost`
    /// può prestare `&mut Workspace` senza aliasing.
    fn deliver_to_handlers(&mut self, event: &Event) {
        let mut handlers = std::mem::take(&mut self.handlers);
        for handler in handlers.iter_mut() {
            if !handler.subscribed().contains(event.kind()) {
                continue;
            }
            let mut host = KernelHost { ws: self };
            // L'errore di un handler non deve far fallire l'operazione
            // che ha emesso l'evento: si ignora (M4: log/notifica).
            let _ = handler.handle(event, &mut host);
        }
        // Handler registrati *durante* il dispatch si accodano in fondo.
        let registered_meanwhile = std::mem::take(&mut self.handlers);
        self.handlers = handlers;
        self.handlers.extend(registered_meanwhile);
    }

    // --- job (lavoro lungo, fuori dal giro sincrono) -----------------------

    /// Preleva i job richiesti dai provider via [`HostApi::spawn_job`].
    ///
    /// Il kernel è sincrono e non possiede thread: chi li possiede (l'app, o
    /// il registry dei plugin a M4/M5) drena questa coda, esegue ogni job
    /// **fuori** dal lock del workspace (`Plugin::run_job`, a M5 su
    /// un'istanza separata del componente) e riconsegna l'esito con
    /// [`Workspace::complete_job`].
    pub fn take_pending_jobs(&mut self) -> Vec<(JobId, JobSpec)> {
        std::mem::take(&mut self.pending_jobs)
    }

    /// Riconsegna l'esito di un job: emette [`Event::JobDone`] sul giro
    /// sincrono normale (bus + handler). Chi ha lanciato il job riconosce il
    /// proprio `id`.
    pub fn complete_job(
        &mut self,
        id: JobId,
        job: impl Into<String>,
        result: std::result::Result<serde_json::Value, PluginError>,
    ) {
        self.emit_event(Event::JobDone {
            id,
            job: job.into(),
            result,
        });
        self.dispatch_pending();
    }

    // --- interni ---------------------------------------------------------

    fn parse(&self, id: &DocId, source: &str) -> Result<DocumentModel> {
        let provider = self.provider_for(id)?;
        let ctx = ParseContext::obsidian(id.as_str());
        Ok(provider.parse(source, &ctx)?)
    }

    fn provider_for(&self, id: &DocId) -> Result<&dyn fubmd_abi::FormatProvider> {
        let ext = extension_of(id).unwrap_or_default();
        self.registry
            .provider_for_ext(&ext)
            .ok_or(KernelError::NoProvider(ext))
    }

    fn rebuild_graph(&mut self) {
        self.graph = LinkGraph::build(self.models.values());
    }
}

/// L'[`HostApi`] del kernel per gli handler fidati: chiamate dirette, costo
/// zero. È qui (in un solo punto) che a M4 si innesteranno i permessi dei
/// plugin — vedi `docs/architecture/plugin-boundary.md`.
struct KernelHost<'a> {
    ws: &'a mut Workspace,
}

impl HostApi for KernelHost<'_> {
    fn read_document(&self, id: &DocId) -> std::result::Result<String, PluginError> {
        self.ws
            .read_source(id)
            .map_err(|e| PluginError::Internal(e.to_string()))
    }

    fn write_document(&mut self, id: &DocId, source: &str) -> std::result::Result<(), PluginError> {
        self.ws
            .write_document(id, source)
            .map_err(|e| PluginError::Internal(e.to_string()))
    }

    fn emit(&mut self, event: Event) {
        self.ws.emit_event(event);
    }

    fn spawn_job(&mut self, spec: JobSpec) -> std::result::Result<JobId, PluginError> {
        let id = JobId(self.ws.next_job_id);
        self.ws.next_job_id += 1;
        self.ws.pending_jobs.push((id, spec));
        Ok(id)
    }

    fn storage_get(&self, key: &str) -> Option<serde_json::Value> {
        self.ws.storage.get(key).cloned()
    }

    fn storage_set(&mut self, key: &str, value: serde_json::Value) {
        self.ws.storage.insert(key.to_string(), value);
    }
}

/// Sottomodello con i soli blocchi della sezione di un heading: da esso
/// (incluso) fino al prossimo heading di livello pari o superiore. `heading`
/// matcha per slug o per testo, case-insensitive.
fn section_of(model: &DocumentModel, heading: &str) -> Option<DocumentModel> {
    let want = normalize(heading);
    let idx = model
        .outline
        .iter()
        .position(|h| normalize(&h.slug) == want || normalize(&h.text) == want)?;
    let start = model.outline[idx].span.start;
    let level = model.outline[idx].level;
    let end = model.outline[idx + 1..]
        .iter()
        .find(|h| h.level <= level)
        .map(|h| h.span.start)
        .unwrap_or(usize::MAX);

    let mut section = DocumentModel::empty(model.id.clone());
    section.body = model
        .body
        .iter()
        .filter(|b| {
            let s = block_span_start(b);
            s >= start && s < end
        })
        .cloned()
        .collect();
    Some(section)
}

fn block_span_start(block: &fubmd_abi::model::Block) -> usize {
    use fubmd_abi::model::Block;
    match block {
        Block::Heading { span, .. }
        | Block::Paragraph { span, .. }
        | Block::List { span, .. }
        | Block::CodeBlock { span, .. }
        | Block::Quote { span, .. }
        | Block::ThematicBreak { span }
        | Block::Custom { span, .. } => span.start,
    }
}

fn extension_of(id: &DocId) -> Option<String> {
    id.as_str()
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
}
