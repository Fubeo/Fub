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
//! La stessa regola vale per **ogni** chiamata a un provider (`on_action`,
//! `handle`, `flush`, `activate`, il futuro `invoke`): finché il suo frame è
//! aperto (`in_provider_call`) il dispatch è rimandato — *gli eventi arrivano
//! dopo che la tua chiamata è tornata*, mai dentro di essa. Non è una
//! comodità: a M5 il component model **vieta la rientranza di un'istanza**,
//! e un plugin che fosse insieme view e handler (il caso versioning)
//! trapperebbe a runtime se la shell gli consegnasse eventi dentro
//! `on_action`. La semantica di consegna è contratto dal freeze di M4 in poi
//! ed è identica a quella che il proxy WASM potrà onorare.
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
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::command::{CommandEffect, CommandOutcome, CommandSpec, InvokeMode};
use fubmd_abi::custom::{CustomRenderer, SyntaxRule};
use fubmd_abi::edit::{EditReport, EditRequest, Revision, TextEdit};
use fubmd_abi::format::{DocumentSource, ParseContext, RenderOptions, SourceKind};
use fubmd_abi::model::{DocId, DocumentModel, Frontmatter, Heading, Link, LinkTarget, Span};
use fubmd_abi::session::{ContextMask, ViewContext};
use fubmd_abi::traits::{
    BacklinkRef, CommandProvider, EventHandler, HostApi, IndexProvider, IndexQuery, IndexResult,
    JobId, JobSpec, Paged, ViewInstance, ViewProvider, ViewSpec,
};
use fubmd_abi::transfer::{
    ExportProvider, ExportReport, ExportRequest, ExportTarget, ImportProvider, ImportReport,
    ImportRequest, ImportSource,
};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_abi::{Actor, BatchId, Event, Notice, Origin, PluginError};

use crate::bus::EventBus;
use crate::error::{KernelError, Result};
use crate::graph::{normalize, strip_ext, GraphSource, LinkGraph};
use crate::health;
use crate::pathlink;
use crate::properties;
use crate::registry::FormatRegistry;
use crate::renderer::{self, RenderedDocument, RendererConflict, RendererRegistry};
use crate::syntax::{SyntaxConflict, SyntaxRegistry};
use crate::tag_counts::TagCounts;
use crate::vault::{TrashEntry, Vault, DATA_DIR};

/// Il pannello di una shell che ne ha uno solo.
///
/// Sta qui, e non in ogni chiamante, perché kernel, app e test devono nominare
/// lo **stesso** pannello: un contesto pubblicato con un `PaneId` diverso da
/// quello di prima è, da contratto, un cambio di pannello — cioè un ridisegno
/// di tutto ciò che segue il contesto.
pub const MAIN_PANE: &str = "main";

/// Cosa è successo al documento che il contesto stava guardando.
enum ContextChange {
    /// Il suo sorgente è stato riscritto: la selezione non è più posizionabile.
    Rewritten,
    /// Ha cambiato path: l'identità del contesto lo segue.
    Renamed(DocId),
    /// Non esiste più.
    Gone,
}

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

/// Quanto l'host si fida di chi ha prodotto un albero di UI — o un blocco
/// custom, che dal punto di vista del confine è la stessa cosa.
///
/// Non è una proprietà dell'albero, è una proprietà di **chi lo manda**: lo
/// stesso `UiNode::Html` è legittimo da una feature ufficiale e inaccettabile da
/// un plugin sandboxato, perché nella webview principale il contenuto attivo ha
/// l'IPC con pieni privilegi — passare da lì aggirerebbe l'intera sandbox. Vedi
/// `docs/architecture/ui-protocol.md`.
///
/// **Erano due varianti** (§3.5), e 20.2 e 20.3 ne chiedono quattro: verificato,
/// community, locale in sviluppo, revocato. È l'unico dei quattro tipi di quella
/// voce che vive nel kernel e non nell'abi — la sua forma non scade col freeze —
/// e sta lì perché la domanda è la stessa: un `enum` a due casi dove ciò che
/// arriva ha una coda. La differenza con gli altri tre è che qui i casi sono
/// **ordinati e esclusivi**, quindi la risposta non è una mappa: è un grado.
///
/// L'ordine è dal più fidato al meno, e conta: `>=` fra due gradi è una domanda
/// che si fa davvero (`trust <= Trust::Development` = «lo eseguo?»).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum Trust {
    /// Core e feature ufficiali: `Html`/`WebView` ammesse.
    Core,
    /// Firmato da una catena che l'host riconosce (20.2). Non è codice del
    /// core: contenuto attivo rifiutato lo stesso.
    Verified,
    /// Pubblicato ma non verificato. È il default, ed è deliberato che il grado
    /// più restrittivo fra quelli che *girano* sia ciò che si ottiene
    /// dimenticandosi di dichiararlo.
    #[default]
    Community,
    /// Locale, in sviluppo (20.3). Gira, e l'host lo sa: è il grado che una UI
    /// deve poter mostrare diversamente dagli altri, non un sinonimo di
    /// community.
    Development,
    /// Revocato: **non gira affatto**. Non è un grado di fiducia più basso, è
    /// l'assenza del permesso di essere eseguito.
    Revoked,
}

impl Trust {
    /// Può emettere contenuto attivo (`Html`, `WebView`)? Solo il core.
    ///
    /// La regola non si allarga con i gradi nuovi, ed è il punto: `Verified`
    /// dice che *si sa chi è*, non che il suo `<script>` sia benvenuto nella
    /// webview che ha l'IPC. Quel varco si apre con l'asset story e la CSP di
    /// M5, non con una firma.
    pub fn allows_active_content(self) -> bool {
        self == Trust::Core
    }

    /// Gira? Tutto tranne il revocato.
    pub fn runs(self) -> bool {
        self != Trust::Revoked
    }
}

/// Tetto di eventi drenati in un singolo `dispatch_pending`: tronca i cicli
/// di handler che si rimbalzano eventi a vicenda senza convergere. Il
/// troncamento NON è silenzioso: emette [`Event::Overflow`] (bus + handler),
/// così chi deriva stato dagli eventi sa di dover riconciliare da zero.
const DISPATCH_BUDGET: usize = 1024;

/// Nome di una nota nuova a cui nessuno ne ha dato uno (D3). L'utente la
/// rinomina subito: è il motivo per cui non vale la pena essere più creativi.
const UNTITLED: &str = "Senza titolo";

/// Radice dello storage persistente dei plugin, dentro il vault: ogni plugin
/// ha `<vault>/.fubmd-data/plugins/<id>/` e non vede nient'altro.
///
/// Sta nel vault e non nella cartella di configurazione dell'utente perché i
/// dati derivati da un vault appartengono a quel vault: copiarlo, spostarlo o
/// metterlo in sync deve portarsi dietro anche loro.
const PLUGIN_DATA_DIR: &str = "plugins";

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
struct DocMeta {
    id: DocId,
    frontmatter: Frontmatter,
    outline: Vec<Heading>,
    links: Vec<Link>,
}

impl From<DocumentModel> for DocMeta {
    fn from(model: DocumentModel) -> Self {
        DocMeta {
            id: model.id,
            frontmatter: model.frontmatter,
            outline: model.outline,
            links: model.links,
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

pub struct Workspace {
    vault: Vault,
    registry: FormatRegistry,
    /// Le sintassi innestate sui provider (§3.1). Girano dopo il parse, sul
    /// modello: è ciò che le rende innestabili su un provider che non le
    /// conosce.
    syntax: SyntaxRegistry,
    /// Chi disegna quale `custom_kind` (§3.2). Il registro che l'escape hatch
    /// del modello non aveva.
    renderers: RendererRegistry,
    /// La cache dei metadati (split metadata/body: vedi [`DocMeta`]). È
    /// l'insieme dei documenti indicizzati: `contains_key` qui È "il
    /// workspace lo conosce".
    metas: HashMap<DocId, DocMeta>,
    /// I conteggi dei tag, mantenuti incrementalmente in `ingest`/`remove`
    /// come il grafo: [`IndexQuery::Tags`] risponde da qui, senza O(vault).
    tags: TagCounts,
    graph: LinkGraph,
    graph_update: GraphUpdate,
    bus: EventBus,
    /// Handler registrati, ognuno col proprio id (feature ufficiali; a M4/M5 i
    /// plugin via registry). L'id non è decorativo: è lo spazio dei nomi dello
    /// storage che l'`HostApi` concede a quell'handler, e chi lo assegna è il
    /// kernel — non l'handler, che altrimenti sceglierebbe il proprio recinto.
    handlers: Vec<(String, Box<dyn EventHandler>)>,
    /// Indici derivati dal contenuto, alimentati **direttamente** (non via
    /// event bus) dentro le stesse operazioni che aggiornano il grafo — così
    /// un troncamento della coda eventi non può far divergere un indice.
    /// Come per gli handler, l'id è lo spazio dello storage persistente che
    /// l'[`HostApi`] concede all'indice: è lì che un indice si ricorda di ciò
    /// che ha già visto.
    indexes: Vec<(String, Box<dyn IndexProvider>)>,
    /// Provider di import, interpellati **in ordine**: il primo che riconosce
    /// una sorgente la prende (vedi [`Workspace::import`]). Come per handler e
    /// indici, l'id è lo spazio dati che l'[`HostApi`] concede al provider.
    imports: Vec<(String, Box<dyn ImportProvider>)>,
    /// Provider di export. Non hanno un ordine che conta: una richiesta nomina
    /// una destinazione, e la destinazione ha un proprietario solo.
    exports: Vec<(String, Box<dyn ExportProvider>)>,
    /// View dichiarative registrate, col grado di fiducia di chi le produce.
    /// Ogni albero di UI che entra nell'host passa da qui: è il punto unico in
    /// cui [`UiNode::validate_untrusted`] viene applicato.
    views: Vec<(String, Trust, Box<dyn ViewProvider>)>,
    /// Provider di comandi, in ordine di registrazione. Senza [`Trust`], a
    /// differenza delle view: la fiducia serve dove passa **contenuto attivo**
    /// (`Html`/`WebView`), e da un comando non passa un albero di UI — l'unica
    /// stringa che l'esito porta all'utente (`notify`) è testo semplice, come
    /// lo snippet di una ricerca. Ciò che serve a un comando è un *permesso*
    /// (§7.3), che è un'altra domanda e ha un altro posto.
    ///
    /// Sono `Arc` e non `Box` — soli fra i provider — perché sono gli unici che
    /// devono restare **raggiungibili durante una propria chiamata**: col
    /// `run_command` della decisione 0013 un comando ne invoca un altro, e se il registro
    /// fosse svuotato per la durata dell'invocazione (la disciplina di view,
    /// indici e handler) la macro non troverebbe nessuno dei comandi che deve
    /// comporre — nemmeno quelli di provider diversi dal suo. `invoke` prende
    /// `&self`, quindi condividere il puntatore basta e il prestito esclusivo
    /// del workspace resta libero per l'host.
    commands: Vec<(String, Arc<dyn CommandProvider>)>,
    /// La catena dei comandi in corso, dal più esterno al più interno: serve a
    /// rifiutare una ricorsione **nominandola** (`a → b → a`) invece di
    /// scoprirla come stack overflow. È anche ciò che limita la profondità: i
    /// comandi registrati sono finiti e nessuno può comparire due volte.
    command_stack: Vec<String>,
    /// Eventi in attesa di dispatch verso gli handler, ognuno con l'origine
    /// che aveva **al momento dell'emissione** — non quella del drenaggio, che
    /// può avvenire sotto un altro attore.
    pending: VecDeque<Notice>,
    /// Guardia anti-rientranza: `dispatch_pending` non si annida mai.
    dispatching: bool,
    /// Siamo dentro una chiamata a un provider (view `on_action`, `handle`,
    /// `flush`, `activate`, futuro `invoke`)? Finché è alzato, il dispatch è
    /// rimandato: gli eventi arrivano **dopo che la chiamata del provider è
    /// tornata**, mai dentro il suo frame. È la semantica che il component
    /// model impone a M5 (un'istanza non è rientrante: un plugin che è sia
    /// view sia handler trapperebbe), promossa a contratto già in nativo —
    /// vedi il § "Dispatch degli eventi" qui sopra.
    in_provider_call: bool,
    /// Job richiesti via [`HostApi::spawn_job`], in attesa che l'host li
    /// esegua fuori dal giro sincrono (vedi [`Workspace::take_pending_jobs`]).
    pending_jobs: Vec<(JobId, JobSpec)>,
    /// Contatore per l'assegnazione dei [`JobId`].
    next_job_id: u64,
    /// Il contesto del pannello con il focus, servito alle view da
    /// [`HostApi::active_context`]. Lo imposta la shell
    /// ([`set_active_context`](Workspace::set_active_context)); il kernel non
    /// lo deriva né lo inventa — quale nota guarda l'utente, dove ha cliccato
    /// e in che modalità legge sono decisioni dell'app, e il kernel le
    /// custodisce solo perché sono il contesto che una view (anche in WASM)
    /// deve poter chiedere.
    ///
    /// Il kernel lo tocca in un caso solo, ed è di **verità**: quando il
    /// sorgente sotto la selezione cambia o il documento sparisce (vedi
    /// [`invalidate_context`](Workspace::invalidate_context)). Uno span
    /// stantio è peggio di uno span assente — chi lo usasse taglierebbe i byte
    /// sbagliati.
    context: Option<ViewContext>,
    /// Chi ha **chiesto** ciò che il workspace sta facendo adesso (decisione 0012): è
    /// l'attore che finisce sull'origine di ogni evento emesso da qui in poi.
    /// Il valore a riposo è [`Actor::User`] perché a riposo il kernel è chiamato
    /// dalla shell; lo cambiano, per la durata di una chiamata,
    /// [`as_actor`](Workspace::as_actor) e i suoi tre chiamanti (il watcher, il
    /// dispatch verso un handler, l'invocazione di un comando).
    actor: Actor,
    /// Il lotto aperto (decisione 0011), se c'è. Uno solo: un `rename_document` dentro un
    /// comando non apre un secondo lotto, entra in quello che c'è — chiuderne
    /// uno interno farebbe arrivare un `batch-ended` mentre l'operazione esterna
    /// è ancora in corso. Per questo non serve contare le aperture: chi trova il
    /// campo pieno non lo tocca, e a chiudere è solo chi lo ha riempito.
    batch: Option<BatchState>,
    /// Contatore per l'assegnazione dei [`BatchId`].
    next_batch_id: u64,
}

/// Un lotto aperto: la sua identità e cosa ha toccato.
struct BatchState {
    id: BatchId,
    /// I documenti toccati, in ordine di prima apparizione e senza ripetizioni:
    /// è l'elenco che finirà in [`Event::BatchEnded`], ed è ciò che l'utente
    /// vedrebbe se glielo si mostrasse — quindi l'ordine è quello in cui le cose
    /// sono successe, non quello di una `HashSet`.
    changed: Vec<DocId>,
    /// Almeno un [`Event::IndexUpdated`] è stato soppresso: alla chiusura il
    /// lotto ha qualcosa da dire anche se non ha toccato documenti (una
    /// rimozione dal solo indice, un rebuild).
    index_dirty: bool,
}

impl Workspace {
    /// Crea un workspace su una radice con un registry di provider già popolato.
    pub fn new(root: impl AsRef<Utf8Path>, registry: FormatRegistry) -> Self {
        Workspace {
            vault: Vault::open(root),
            registry,
            syntax: SyntaxRegistry::new(),
            renderers: RendererRegistry::new(),
            metas: HashMap::new(),
            tags: TagCounts::default(),
            graph: LinkGraph::default(),
            graph_update: GraphUpdate::default(),
            bus: EventBus::new(),
            handlers: Vec::new(),
            indexes: Vec::new(),
            imports: Vec::new(),
            exports: Vec::new(),
            views: Vec::new(),
            commands: Vec::new(),
            command_stack: Vec::new(),
            pending: VecDeque::new(),
            dispatching: false,
            in_provider_call: false,
            pending_jobs: Vec::new(),
            next_job_id: 0,
            context: None,
            actor: Actor::User,
            batch: None,
            next_batch_id: 0,
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

    /// Registra un [`EventHandler`] (fidato: le feature ufficiali) sotto un id.
    /// I plugin di terzi passeranno dal registry dei plugin (M4/M5), che
    /// applica permessi e confine di fiducia prima di arrivare qui.
    ///
    /// `id` è l'identità del plugin: determina lo spazio dello storage
    /// persistente che l'[`HostApi`] gli concede
    /// (`.fubmd-data/plugins/<id>/`). Deve essere un nome semplice, senza
    /// separatori di path.
    pub fn register_event_handler(
        &mut self,
        id: impl Into<String>,
        handler: Box<dyn EventHandler>,
    ) {
        self.handlers.push((id.into(), handler));
    }

    /// Presta un [`HostApi`] intestato a un plugin, per la durata di una
    /// chiamata.
    ///
    /// Serve a chi compone le due metà di una feature dall'esterno del
    /// dispatch: l'app apre lo store delle versioni e legge una versione con le
    /// stesse capacità che l'handler usa dentro `handle`, e non con `std::fs`.
    /// A M4 è anche il modo in cui il registry guiderà `Plugin::activate`.
    pub fn with_host<R>(&mut self, plugin: &str, f: impl FnOnce(&mut dyn HostApi) -> R) -> R {
        // Anche questa è una "chiamata di provider" ai fini della consegna:
        // ciò che `f` emette arriva agli handler quando `f` è tornata.
        let result = self.with_provider_call(|ws| {
            let mut host = KernelHost {
                ws,
                plugin,
                mode: InvokeMode::Apply,
            };
            f(&mut host)
        });
        self.dispatch_pending();
        result
    }

    /// Registra un [`IndexProvider`] sotto un id. Va fatto **prima** di
    /// [`reindex`], che è il momento in cui l'indice riceve il contenuto del
    /// vault e riconcilia ciò che è cambiato mentre non era vivo.
    ///
    /// La registrazione **è** l'attivazione: l'indice riceve subito un
    /// [`HostApi`] intestato al proprio id e ricarica da `data_*` ciò che ha
    /// già visto. Prima di questo momento non può avere ricordi, e dopo il
    /// primo `on_document_indexed` sarebbe troppo tardi per averli.
    ///
    /// L'errore di attivazione arriva al chiamante ma l'indice resta
    /// registrato: un indice che non ha ritrovato la propria memoria
    /// reindicizza tutto, che è lento, non sbagliato.
    ///
    /// `id` è un nome semplice, senza separatori di path: determina lo spazio
    /// dati (`.fubmd-data/plugins/<id>/`), come per gli event handler.
    ///
    /// [`reindex`]: Workspace::reindex
    pub fn register_index_provider(
        &mut self,
        id: impl Into<String>,
        mut index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), PluginError> {
        let id = id.into();
        // `index` è ancora una variabile locale: prestare `&mut self` all'host
        // qui non alias niente. `activate` è una chiamata a un provider come
        // le altre: il dispatch resta rimandato a chiamata tornata.
        let activated = self.with_provider_call(|ws| {
            let mut host = KernelHost {
                ws,
                plugin: &id,
                mode: InvokeMode::Apply,
            };
            index.activate(&mut host)
        });
        self.indexes.push((id, index));
        self.dispatch_pending();
        activated
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
        // Prima si parsa TUTTO, poi si muta: un parse fallito a metà lascia il
        // workspace com'era. I modelli interi vivono solo qui, il tempo di
        // alimentare indici e conteggi: in cache restano i metadati.
        let mut models = Vec::with_capacity(ids.len());
        for id in ids {
            let src = self.vault.read(&id)?;
            let model = self.parse(&id, &src)?;
            models.push((id, model));
        }
        self.metas.clear();
        self.tags.clear();
        for (id, model) in models {
            for (_, index) in self.indexes.iter_mut() {
                index.on_document_indexed(&model);
            }
            self.tags.upsert(&id, &model.tags);
            self.metas.insert(id, DocMeta::from(model));
        }
        self.rebuild_graph();

        let ids: Vec<DocId> = self.documents();
        for (_, index) in self.indexes.iter_mut() {
            index.reconcile(&ids);
        }
        // Gli errori di flush non fanno fallire l'apertura del vault: un
        // indice è stato derivato, il vault è la verità (M4: notifica).
        let _ = self.flush_indexes();

        // L'apertura non l'ha chiesta un documento né un plugin: è il kernel che
        // dichiara di esistere (decisione 0012).
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::VaultOpened {
                root: ws.vault.root().to_string(),
            });
            ws.emit_event(Event::IndexUpdated);
            ws.dispatch_pending();
        });
        Ok(())
    }

    /// Elenco ordinato dei documenti indicizzati.
    pub fn documents(&self) -> Vec<DocId> {
        let mut ids: Vec<DocId> = self.metas.keys().cloned().collect();
        ids.sort();
        ids
    }

    /// Le estensioni che i provider registrati riconoscono (minuscole, senza
    /// punto), ordinate.
    ///
    /// Serve a chi disegna: il "nome pagina" di un documento è il basename
    /// senza l'estensione **gestita**, e quale sia dipende dai provider —
    /// cablare `.md` nel frontend è vero solo finché markdown è l'unico
    /// formato, cioè finché il progetto non fa ciò per cui esiste.
    pub fn extensions(&self) -> Vec<String> {
        let mut exts = self.registry.all_extensions();
        exts.sort();
        exts
    }

    /// Sorgente grezza di un documento dal disco.
    pub fn read_source(&self, id: &DocId) -> Result<String> {
        self.vault.read(id)
    }

    /// Scrive la sorgente, riparsa il documento, aggiorna il grafo ed emette
    /// gli eventi. Il grafo si aggiorna per-documento ([`GraphUpdate`]).
    pub fn write_document(&mut self, id: &DocId, source: &str) -> Result<()> {
        // Il parse è puro: farlo PRIMA di scrivere tiene la mutazione atomica.
        // Nell'ordine inverso un parse fallito lascerebbe il disco avanti
        // rispetto a modelli/grafo/indici — e il chiamante riceverebbe `Err`
        // pur avendo scritto.
        let model = self.parse(id, source)?;
        self.vault.write(id, source)?;
        self.ingest_model(id, model);
        self.dispatch_pending();
        Ok(())
    }

    /// La revisione del sorgente di un documento: l'identità del testo su cui
    /// una modifica chirurgica va calcolata (decisione 0008).
    ///
    /// Si legge dal **disco**, come ogni altra lettura del kernel: la verità di
    /// un documento è il file, e una revisione derivata da una cache sarebbe
    /// vera solo finché la cache lo è.
    pub fn document_revision(&self, id: &DocId) -> Result<Revision> {
        Ok(Revision::of(&self.read_source(id)?))
    }

    /// Applica una modifica chirurgica: gli edit della richiesta, tutti o
    /// nessuno, sul sorgente che la sua `base` nomina.
    ///
    /// È l'altra scrittura del kernel accanto a
    /// [`write_document`](Workspace::write_document), e la differenza non è di
    /// comodo: qui la firma dice **su cosa** la modifica è stata calcolata,
    /// quindi due scritture concorrenti non possono sovrascriversi in silenzio
    /// — la seconda trova una base che non combacia e fallisce
    /// ([`KernelError::Stale`]) senza toccare niente.
    ///
    /// Il resto è la coda di sempre: il testo nuovo passa da `write_document`,
    /// quindi parse prima del disco, indici, grafo ed eventi come qualunque
    /// altra modifica. Una richiesta **senza edit** non è una scrittura: non
    /// tocca il file e non emette eventi.
    pub fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport> {
        let source = self.read_source(id)?;
        let (next, report) = request.apply_to(&source).map_err(|e| match e {
            PluginError::Conflict(_) => KernelError::Stale(id.to_string()),
            other => KernelError::BadEdit {
                doc: id.to_string(),
                why: other.to_string(),
            },
        })?;
        if report.is_empty() {
            return Ok(report);
        }
        self.write_document(id, &next)?;
        Ok(report)
    }

    /// Riparsa un documento già presente sul disco (usato dal file watcher).
    ///
    /// L'origine è [`Actor::Watcher`] (decisione 0012): questa modifica non è passata da
    /// noi, e chi la riceve — la shell col buffer aperto, un'automazione — deve
    /// poterla distinguere da una scrittura che ha chiesto lui.
    pub fn refresh_from_disk(&mut self, id: &DocId) -> Result<()> {
        self.as_actor(Actor::Watcher, |ws| {
            let src = ws.vault.read(id)?;
            ws.ingest(id, &src)?;
            ws.dispatch_pending();
            Ok(())
        })
    }

    fn ingest(&mut self, id: &DocId, source: &str) -> Result<()> {
        let model = self.parse(id, source)?;
        self.ingest_model(id, model);
        Ok(())
    }

    /// La coda di ogni scrittura: indici, conteggi tag, grafo, metadati in
    /// cache, eventi. Prende il modello già parsato — è ciò che permette a
    /// `write_document` di parsare prima di toccare il disco.
    fn ingest_model(&mut self, id: &DocId, model: DocumentModel) {
        // Gli indici vedono la modifica nella stessa operazione del grafo:
        // stessa verità, nessun canale che può perdere pezzi per strada. E la
        // vedono ADESSO, sul modello intero: è l'unico momento in cui corpo e
        // testo esistono — la cache tiene i soli metadati.
        for (_, index) in self.indexes.iter_mut() {
            index.on_document_indexed(&model);
        }
        self.tags.upsert(id, &model.tags);
        if self.graph_update == GraphUpdate::Incremental {
            self.graph.upsert(&model);
        }
        self.metas.insert(id.clone(), DocMeta::from(model));
        if self.graph_update == GraphUpdate::FullRebuild {
            // Il rebuild legge la cache: va aggiornata prima.
            self.rebuild_graph();
        }
        // Il sorgente sotto la selezione è cambiato: gli offset pubblicati
        // dalla shell erano di un altro testo. La shell ne ripubblicherà uno
        // vero al prossimo movimento del cursore (o subito dopo un
        // salvataggio); fino ad allora il contesto dice "non so dove", che è
        // la verità.
        self.invalidate_context(id, ContextChange::Rewritten);
        self.emit_event(Event::DocumentChanged { id: id.clone() });
        self.emit_event(Event::IndexUpdated);
    }

    /// Sincronizza un path assoluto dopo un evento del filesystem: riparsa se
    /// esiste ed è un formato gestito, rimuove se sparito. Restituisce `true`
    /// se qualcosa è cambiato. Path fuori dal vault, ignorati dal vault o senza
    /// provider: nessun effetto.
    ///
    /// Il filtro dei path ignorati è lo **stesso** della scansione
    /// ([`Vault::is_ignored`]) e non una sua copia: le due porte d'ingresso del
    /// vault devono avere la stessa idea di cosa sta fuori, altrimenti una nota
    /// cestinata resterebbe cercabile.
    pub fn sync_path(&mut self, abs: &Utf8Path) -> Result<bool> {
        if self.vault.is_ignored(abs) {
            return Ok(false);
        }
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
            self.as_actor(Actor::Watcher, |ws| {
                let existed = ws.metas.contains_key(&id);
                ws.remove_document(&id);
                Ok(existed)
            })
        }
    }

    /// Rimuove un documento (usato dal file watcher su cancellazione).
    pub fn remove_document(&mut self, id: &DocId) {
        if self.metas.remove(id).is_some() {
            // La nota con il focus non esiste più: `active_context` non deve
            // continuare a nominarla alle view (né tenerne una selezione).
            self.invalidate_context(id, ContextChange::Gone);
            self.tags.remove(id);
            match self.graph_update {
                GraphUpdate::Incremental => self.graph.remove(id),
                GraphUpdate::FullRebuild => self.rebuild_graph(),
            }
            for (_, index) in self.indexes.iter_mut() {
                index.on_document_removed(id);
            }
            self.emit_event(Event::DocumentRemoved { id: id.clone() });
            self.emit_event(Event::IndexUpdated);
            self.dispatch_pending();
        }
    }

    /// Crea una nota vuota e restituisce il suo [`DocId`].
    ///
    /// Senza `name` nasce `Senza titolo` nella radice — e se il nome è già
    /// preso, `Senza titolo 1`, `2`, … (D3): l'utente la rinomina subito, con
    /// il rename che i link se li porta dietro. Con `name` è il flusso "crea
    /// nota da link non risolto": il nome arriva dal wikilink, e una collisione
    /// è un errore, non un nome da aggiustare in silenzio — se quel path
    /// esistesse, il link non sarebbe stato non risolto.
    ///
    /// Il nome libero si calcola qui dentro, dove il workspace è preso in
    /// esclusiva: cercarlo dal chiamante e poi scrivere sarebbe una corsa fra
    /// la domanda e la risposta.
    pub fn create_note(&mut self, name: Option<&str>) -> Result<DocId> {
        let id = match name {
            Some(name) => {
                let id = self.new_note_id(name)?;
                if self.is_taken(&id) {
                    return Err(KernelError::AlreadyExists(id.to_string()));
                }
                id
            }
            None => {
                let ext = self
                    .registry
                    .default_extension()
                    .ok_or(KernelError::NoDefaultFormat)?;
                self.free_name(&DocId::new(format!("{UNTITLED}.{ext}")))
            }
        };
        // Una nota nuova è una scrittura come le altre: grafo, indici ed eventi
        // la vedono nascere per la via normale.
        self.write_document(&id, "")?;
        Ok(id)
    }

    /// Il primo nome libero della famiglia `<nome>`, `<nome> 1`, `<nome> 2`, …
    /// a partire da un [`DocId`] qualsiasi. Se `id` è già libero, è lui.
    ///
    /// È la convenzione D3, e vive **qui** perché il workspace è l'unico a
    /// sapere cosa è occupato — in memoria e su disco. La usa `create_note` per
    /// la nota senza titolo, e la usa l'app quando il ripristino dal cestino
    /// trova il path di nuovo occupato e deve proporre un'alternativa. Due
    /// implementazioni della stessa convenzione (una nel kernel, una nel
    /// frontend) divergerebbero al primo ritocco.
    ///
    /// Non prenota niente: fra la domanda e la scrittura il nome può diventare
    /// occupato, e a quel punto è la scrittura a dirlo. Per questo `create_note`
    /// lo calcola dentro di sé e non lo chiede a un chiamante.
    pub fn free_name(&self, id: &DocId) -> DocId {
        let (stem, ext) = match id.as_str().rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() && !ext.contains('/') => {
                (stem, format!(".{ext}"))
            }
            _ => (id.as_str(), String::new()),
        };
        (0u32..)
            .map(|n| match n {
                0 => id.clone(),
                n => DocId::new(format!("{stem} {n}{ext}")),
            })
            .find(|candidato| !self.is_taken(candidato))
            .expect("la sequenza dei candidati è infinita")
    }

    /// Questo path è già di qualcuno? Vale sia l'indicizzato sia ciò che sta
    /// sul disco e il workspace non ha ancora visto.
    fn is_taken(&self, id: &DocId) -> bool {
        self.metas.contains_key(id) || self.vault.exists(id)
    }

    /// Il [`DocId`] di una nota che nasce col nome dato: separatori normalizzati
    /// e, se il nome non porta già un'estensione gestita, quella di default.
    fn new_note_id(&self, name: &str) -> Result<DocId> {
        let id = valid_doc_id(name)?;
        let ha_estensione =
            extension_of(&id).is_some_and(|ext| self.registry.provider_for_ext(&ext).is_some());
        if ha_estensione {
            return Ok(id);
        }
        let ext = self
            .registry
            .default_extension()
            .ok_or(KernelError::NoDefaultFormat)?;
        Ok(DocId::new(format!("{}.{ext}", id.as_str())))
    }

    // --- cestino -----------------------------------------------------------

    /// Cancella un documento **spostandolo nel cestino** del vault, e
    /// restituisce il [`DocId`] che vi ha assunto.
    ///
    /// È il delete dell'app, ed è un metodo a sé: [`remove_document`] è il
    /// percorso del *watcher*, che reagisce a un file già sparito dal disco e
    /// non ha nulla da cestinare. Qui il file c'è, e viene spostato prima che i
    /// modelli lo dimentichino — se lo spostamento fallisce, il workspace non
    /// si è mosso e la nota è ancora dov'era.
    ///
    /// Modelli, grafo, indici ed evento sono esattamente il lavoro di
    /// [`remove_document`]: un secondo percorso di rimozione da tenere allineato
    /// sarebbe un secondo modo di divergere.
    ///
    /// [`remove_document`]: Workspace::remove_document
    pub fn delete_document(&mut self, id: &DocId) -> Result<DocId> {
        if !self.metas.contains_key(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let trashed = self.vault.trash(id)?;
        self.remove_document(id);
        Ok(trashed)
    }

    /// Il contenuto del cestino, dal più recente al più vecchio.
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        self.vault.list_trash()
    }

    /// Ripristina una voce del cestino e restituisce il [`DocId`] con cui è
    /// tornata nel vault: il nome originale nella radice, oppure `to` se il
    /// chiamante ne ha scelto un altro (è il caso in cui il path è di nuovo
    /// occupato e l'app ha chiesto all'utente).
    ///
    /// Il ripristino è una **scrittura normale** (D8): passa da
    /// [`write_document`], quindi da parse, grafo, indici ed eventi come
    /// qualunque altra modifica. Nessun percorso speciale da tenere coerente —
    /// ed è anche il motivo per cui il ripristino genera a sua volta uno
    /// snapshot di versione, cioè è annullabile.
    ///
    /// [`write_document`]: Workspace::write_document
    pub fn restore_from_trash(&mut self, trash_id: &DocId, to: Option<DocId>) -> Result<DocId> {
        let entry = self
            .vault
            .list_trash()?
            .into_iter()
            .find(|e| &e.id == trash_id)
            .ok_or_else(|| KernelError::NotFound(trash_id.to_string()))?;
        // `entry.original` nasce da un basename o dal sidecar scritto dal
        // vault, ed è sano per costruzione; il `to` del chiamante invece
        // arriva dall'IPC e va validato.
        let original = entry.original.clone();
        let target = match to {
            Some(to) => valid_doc_id(to.as_str())?,
            None => entry.original,
        };
        if self.metas.contains_key(&target) || self.vault.exists(&target) {
            return Err(KernelError::AlreadyExists(target.to_string()));
        }
        let ext = extension_of(&target).unwrap_or_default();
        if self.registry.provider_for_ext(&ext).is_none() {
            return Err(KernelError::NoProvider(ext));
        }

        let source = self.vault.read(trash_id)?;
        self.write_document(&target, &source)?;
        // Se il ripristino approda su un path diverso dall'origine (il path
        // era di nuovo occupato e l'utente ha scelto un altro nome), lo stato
        // per-documento — storia del versioning, meta del frontend — vive
        // ancora sotto la chiave d'origine: è un rename a tutti gli effetti,
        // anche se il documento non era indicizzato, e chi tiene stato migra
        // la chiave sull'evento.
        if target != original {
            self.emit_event(Event::DocumentRenamed {
                from: original,
                to: target.clone(),
            });
            self.dispatch_pending();
        }
        // La copia nel cestino se ne va per ultima: se la cancellazione
        // fallisce restano due copie della nota, il che è un fastidio. Fare il
        // contrario significherebbe rischiare di non averne nessuna.
        self.vault.remove_trashed(trash_id)?;
        Ok(target)
    }

    /// Svuota il cestino. Restituisce quante voci ha cancellato: da qui in poi
    /// non sono più recuperabili, e chi chiama deve poterlo dire.
    pub fn empty_trash(&mut self) -> Result<usize> {
        self.vault.empty_trash()
    }

    /// Rinomina/sposta un documento **preservando l'identità**: file sul disco,
    /// modello, grafo, e riscrittura chirurgica dei wikilink entranti che
    /// puntavano al vecchio nome o path (stile Obsidian). I link per **alias**
    /// non vengono toccati: l'alias vive nel frontmatter del documento e
    /// sopravvive al rename.
    ///
    /// Emette [`Event::DocumentRenamed`] (non `Removed`+`Changed`): chi tiene
    /// stato per-documento migra la chiave.
    ///
    /// È un **lotto** (decisione 0011), ed è il caso che ha fatto nascere la voce: una
    /// nota con 200 backlink riscrive 200 sorgenti, e prima di questo giro erano
    /// 200 `index-updated` — cioè 200 ridisegni completi della shell, con 200
    /// `list_documents`, per un'operazione che l'utente ha chiesto una volta.
    /// Adesso è un `batch-ended` solo, con dentro l'elenco.
    pub fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        self.batch(|ws| ws.rename_document_in_batch(from, to))
    }

    fn rename_document_in_batch(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        // `to` arriva dall'IPC: senza validazione `../fuori.md` sposterebbe il
        // file fuori dal vault.
        let to = &valid_doc_id(to.as_str())?;
        if from == to {
            return Ok(());
        }
        if !self.metas.contains_key(from) {
            return Err(KernelError::NotFound(from.to_string()));
        }
        // Rename "case-only" (`nota.md` → `Nota.md`): su un filesystem
        // case-insensitive (macOS/Windows) `vault.exists(to)` vede lo STESSO
        // file, non una collisione — il check sul disco va saltato. Un vero
        // omonimo-per-case su filesystem case-sensitive è comunque intercettato
        // da `models` (il vault è l'unica fonte dei DocId, quindi lo conosce).
        let case_only = from.as_str().to_lowercase() == to.as_str().to_lowercase();
        if self.metas.contains_key(to) || (!case_only && self.vault.exists(to)) {
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
        self.migrate_identity(from, to, model);

        // Il piano si applica TUTTO, anche se una sorgente fallisce: abortire
        // a metà lascerebbe link misti vecchio/nuovo senza possibilità di
        // retry. Gli errori si accumulano per-sorgente e arrivano in coda.
        let mut falliti: Vec<String> = Vec::new();
        for (src, request) in plan {
            // `apply_edit` riparsa, aggiorna il grafo ed emette gli eventi come
            // ogni scrittura — con in più la base: se qualcuno ha riscritto una
            // di queste sorgenti da quando il piano è stato calcolato, quella
            // riscrittura non viene cancellata in silenzio, il suo link resta
            // vecchio e il fallimento è nominato qui sotto.
            if let Err(e) = self.apply_edit(&src, request) {
                falliti.push(format!("{src}: {e}"));
            }
        }
        // Dentro il lotto questo `index-updated` non esce: diventa il
        // `batch-ended` che la chiusura emette. Resta scritto qui perché il
        // rename **ha** aggiornato l'indice, e chi legge questo metodo non deve
        // dedurlo dal fatto che è avvolto in un lotto.
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        // Il lotto non annulla: le sorgenti riscritte restano riscritte anche
        // se una è fallita, ed è la scelta giusta *per il rename* — abortire a
        // metà lascerebbe link misti senza possibilità di retry. Chi vuole il
        // contrario (import, migrazioni) vuole il journal del §15.2, non un
        // campo in più qui.
        if !falliti.is_empty() {
            return Err(KernelError::LinkRewrite(falliti.join("; ")));
        }
        Ok(())
    }

    /// Migra l'identità di un documento il cui file è **già** al path nuovo:
    /// modelli, documento attivo, grafo, indici, evento [`Event::DocumentRenamed`].
    ///
    /// È il tratto comune di [`rename_document`](Workspace::rename_document)
    /// (che prima sposta il file) e di
    /// [`sync_renamed_path`](Workspace::sync_renamed_path) (dove il file lo ha
    /// già spostato qualcun altro).
    fn migrate_identity(&mut self, from: &DocId, to: &DocId, model: DocumentModel) {
        self.metas.remove(from);
        // La nota aperta segue il rename anche qui: senza, `active_context`
        // risponderebbe col path vecchio e outline/backlink si svuoterebbero
        // fino al prossimo cambio nota. Va fatto nel kernel, non nella shell:
        // vale anche per i rename non innescati da lei.
        self.invalidate_context(from, ContextChange::Renamed(to.clone()));
        // Per tag e indici il rename è remove+add: l'identità è la chiave, e
        // la chiave è cambiata. (Chi tiene stato *per-documento* invece migra
        // la chiave sull'evento `DocumentRenamed`.)
        self.tags.remove(from);
        self.tags.upsert(to, &model.tags);
        for (_, index) in self.indexes.iter_mut() {
            index.on_document_removed(from);
        }
        for (_, index) in self.indexes.iter_mut() {
            index.on_document_indexed(&model);
        }
        if self.graph_update == GraphUpdate::Incremental {
            self.graph.remove(from);
            self.graph.upsert(&model);
        }
        self.metas.insert(to.clone(), DocMeta::from(model));
        if self.graph_update == GraphUpdate::FullRebuild {
            self.rebuild_graph();
        }
        self.emit_event(Event::DocumentRenamed {
            from: from.clone(),
            to: to.clone(),
        });
    }

    /// Sincronizza un **rename accoppiato** riferito dal filesystem (`from` →
    /// `to`, file già spostato da qualcun altro: Finder, Obsidian, sync).
    ///
    /// Se `from` era indicizzato e `to` è un documento del vault, è una
    /// **migrazione d'identità** come quella di
    /// [`rename_document`](Workspace::rename_document) — versioning, meta del
    /// frontend e stato per-documento seguono il [`Event::DocumentRenamed`] —
    /// ma **senza riscrittura dei wikilink entranti**: chi ha rinominato il
    /// file può averci già pensato (Obsidian lo fa), e riscrivere sorgenti in
    /// risposta al watcher significherebbe litigare con l'altra app.
    ///
    /// Tutti gli altri casi degradano ai percorsi già noti: destinazione
    /// fuori dal vault/ignorata (es. cestinata da un'altra app) è una
    /// rimozione; sorgente mai vista è al più un'aggiunta ([`sync_path`]).
    ///
    /// [`sync_path`]: Workspace::sync_path
    pub fn sync_renamed_path(&mut self, from: &Utf8Path, to: &Utf8Path) -> Result<bool> {
        self.as_actor(Actor::Watcher, |ws| ws.sync_renamed_path_here(from, to))
    }

    fn sync_renamed_path_here(&mut self, from: &Utf8Path, to: &Utf8Path) -> Result<bool> {
        let from_id = (!self.vault.is_ignored(from))
            .then(|| self.vault.doc_id_for_path(from).ok())
            .flatten()
            .filter(|id| self.metas.contains_key(id));
        let Some(from_id) = from_id else {
            // Niente da migrare: al più in `to` è comparso qualcosa.
            return self.sync_path(to);
        };
        let to_id = (!self.vault.is_ignored(to))
            .then(|| self.vault.doc_id_for_path(to).ok())
            .flatten()
            .filter(|id| {
                let ext = extension_of(id).unwrap_or_default();
                self.registry.provider_for_ext(&ext).is_some()
            });
        let Some(to_id) = to_id else {
            // Spostato fuori, in una cartella ignorata o in un formato non
            // gestito: per il workspace è una rimozione.
            self.remove_document(&from_id);
            return Ok(true);
        };
        if from_id == to_id {
            return self.sync_path(to);
        }
        if !to.exists() {
            self.remove_document(&from_id);
            return Ok(true);
        }
        let source = self.vault.read(&to_id)?;
        let model = self.parse(&to_id, &source)?;
        self.migrate_identity(&from_id, &to_id, model);
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        Ok(true)
    }

    /// Per ogni documento che linkava `from` per nome o per path, la
    /// **modifica** che riscrive i suoi riferimenti verso `to`. Sostituzione
    /// chirurgica: si tocca solo il testo del riferimento dentro lo `Span` del
    /// link, mai il resto del documento (heading `#...`, blocco `^...`, alias
    /// `|label` e formattazione restano intatti).
    ///
    /// Il piano è fatto di [`EditRequest`], non di sorgenti intere: è lo stesso
    /// calcolo di prima — gli span dei link li dava già il modello — detto nella
    /// forma che il contratto ora ha (decisione 0008). La `base` di ognuna è la revisione
    /// del sorgente **letto qui**, ed è ciò che impedisce che una riscrittura
    /// arrivata nel frattempo venga cancellata dal piano.
    ///
    /// Vale per **entrambe le specie di link**, e la seconda ha un caso in più
    /// della prima. Un wikilink si rompe solo se si sposta il suo bersaglio; un
    /// link markdown è relativo alla cartella di chi lo scrive, quindi si rompe
    /// anche se si sposta la **sorgente**: muovere `a.md` in `sub/` invalida
    /// ogni `[t](altra.md)` che conteneva. Per questo `from` è sempre fra le
    /// sorgenti del piano — i suoi link uscenti vanno ri-basati sulla cartella
    /// nuova — e non solo quando linka se stesso.
    fn link_rewrite_plan(&self, from: &DocId, to: &DocId) -> Vec<(DocId, EditRequest)> {
        let from_name = normalize(from.page_name());
        let from_path = normalize(&strip_ext(from.as_str()));

        // Nuovo riferimento: il nome pagina se nessun altro documento lo
        // contende (a quel punto la risoluzione per nome è certa), altrimenti
        // il path senza estensione, che è sempre univoco.
        let to_name = to.page_name();
        let ambiguous = self
            .metas
            .keys()
            .any(|id| id != from && normalize(id.page_name()) == normalize(to_name));
        let new_ref = if ambiguous {
            strip_ext(to.as_str())
        } else {
            to_name.to_string()
        };

        let mut sources: BTreeSet<DocId> = self
            .graph
            .backlinks(from)
            .into_iter()
            .map(|r| r.source)
            .collect();
        // Il self-link è escluso dai backlink per scelta, ma al rename va
        // riscritto come gli altri: `[[Nota]]` dentro la nota stessa resterebbe
        // dangling — e verrebbe dirottato da chi ricreasse il vecchio nome. Ai
        // link markdown serve comunque (vedi la nota sopra: sposta la
        // sorgente), quindi `from` entra sempre e sarà il filtro per-link a
        // dire se c'è davvero qualcosa da riscrivere.
        sources.insert(from.clone());

        let mut plan = Vec::new();
        for src in sources {
            let Some(meta) = self.metas.get(&src) else {
                continue;
            };
            let Ok(source_text) = self.vault.read(&src) else {
                continue;
            };
            let mut edits: Vec<TextEdit> = Vec::new();
            for link in &meta.links {
                // `from_end` è la direzione in cui cercare il riferimento
                // dentro lo span, e non è una preferenza: in `[[Nota|Nota]]` la
                // pagina è la **prima** delle due occorrenze, in
                // `[Nota.md](Nota.md)` la destinazione è la **seconda**. Chi
                // sbaglia direzione riscrive l'etichetta e lascia il link rotto.
                let (written, replacement, from_end) = match &link.target {
                    LinkTarget::Wiki { page, .. } => {
                        // Riscrivi solo se il link puntava davvero a `from`
                        // (non a un omonimo) e ci arrivava per nome o per path
                        // — mai per alias.
                        let key = normalize(page);
                        let by_name = key == from_name;
                        let by_path = key == from_path || normalize(&strip_ext(&key)) == from_path;
                        if !(by_name || by_path) {
                            continue;
                        }
                        if self.graph.resolve_wiki(page).as_ref() != Some(from) {
                            continue;
                        }
                        (page.as_str(), new_ref.clone(), false)
                    }
                    LinkTarget::Path(written) => {
                        let Some(new_target) = self.rebased_path_link(from, to, &src, written)
                        else {
                            continue;
                        };
                        let (_, fragment) = pathlink::split_fragment(written);
                        let rewritten = format!("{new_target}{fragment}");
                        if rewritten == *written {
                            continue;
                        }
                        (written.as_str(), rewritten, true)
                    }
                    LinkTarget::Url(_) => continue,
                };
                let Some(slice) = source_text.get(link.span.start..link.span.end) else {
                    continue;
                };
                let found = if from_end {
                    slice.rfind(written)
                } else {
                    slice.find(written)
                };
                let Some(rel) = found else {
                    continue;
                };
                let start = link.span.start + rel;
                edits.push(TextEdit::replace(
                    Span::new(start, start + written.len()),
                    replacement,
                ));
            }
            if edits.is_empty() {
                continue;
            }
            // La sorgente rinominata vive ormai al path nuovo: la sua
            // riscrittura va applicata lì — e la base resta valida, perché un
            // rename sposta il file senza toccarne il contenuto. È una proprietà
            // della revisione-impronta: un contatore per-documento, qui, avrebbe
            // detto che il documento è cambiato.
            let dest = if &src == from { to.clone() } else { src };
            plan.push((dest, EditRequest::new(Revision::of(&source_text), edits)));
        }
        plan
    }

    /// La destinazione che il link markdown `written`, scritto dentro `src`,
    /// deve avere dopo il rename `from` → `to`; `None` se non va toccato.
    ///
    /// Ci sono tre modi di non toccarlo, e sono tre cose diverse: il link non
    /// risolve (è già rotto — riscriverlo sarebbe indovinare); né la sorgente
    /// né il bersaglio si spostano (il path relativo continua a valere); il
    /// link parte dalla radice del vault e a spostarsi è solo la sorgente (la
    /// radice non si muove).
    ///
    /// L'estensione ricompare sempre nel riferimento nuovo, anche se il
    /// vecchio ne era privo: vedi [`pathlink::relative_ref`].
    fn rebased_path_link(
        &self,
        from: &DocId,
        to: &DocId,
        src: &DocId,
        written: &str,
    ) -> Option<String> {
        let resolved = self.graph.resolve_path(src, written)?;
        let source_moves = src == from;
        let target_moves = resolved == *from;
        if !source_moves && !target_moves {
            return None;
        }
        let (path, _) = pathlink::split_fragment(written);
        let from_root = path.trim_start().starts_with('/');
        if from_root {
            if !target_moves {
                return None;
            }
            // Un link dalla radice resta dalla radice: è una scelta di stile
            // di chi scrive, e il rename non è il momento di discuterla.
            return Some(format!("/{}", pathlink::percent_encode_path(to.as_str())));
        }
        let src_after = if source_moves { to } else { src };
        let target_after = if target_moves { to } else { &resolved };
        Some(pathlink::relative_ref(src_after, target_after))
    }

    /// Innesta una sintassi su un provider (§3.1), o dice **perché no**.
    ///
    /// Il `Result` non è cerimonia: due regole che rivendicano la stessa
    /// sintassi sono un conflitto, e il modo in cui questo registro sbagliava
    /// prima era proprio non avere dove dirlo.
    pub fn register_syntax_rule(
        &mut self,
        rule: Box<dyn SyntaxRule>,
    ) -> std::result::Result<(), SyntaxConflict> {
        self.syntax.register(rule)
    }

    /// Registra chi disegna un `custom_kind` (§3.2).
    ///
    /// Il [`Trust`] è quello delle view e per la stessa ragione: un
    /// `CustomRendering::Ui` è un albero di UI, e da chi non è il core il
    /// contenuto attivo si rifiuta a qualunque profondità.
    pub fn register_custom_renderer(
        &mut self,
        trust: Trust,
        renderer: Box<dyn CustomRenderer>,
    ) -> std::result::Result<(), RendererConflict> {
        self.renderers.register(trust, renderer)
    }

    /// I `custom_kind` che qualcuno **produce** e nessuno **disegna**.
    ///
    /// È il conto che il §3.2 chiedeva di poter fare: ogni nome qui dentro è un
    /// blocco che l'utente leggerà crudo — il degrado generico funziona, ma
    /// nessuno ha detto chi lo disegnerebbe. Chi monta l'app può guardarlo; oggi
    /// non c'è ancora una superficie dove mostrarlo (§20.4).
    pub fn undrawn_kinds(&self) -> Vec<String> {
        let drawn = self.renderers.rendered_kinds();
        self.syntax
            .produced_kinds()
            .into_iter()
            .filter(|k| !drawn.contains(k))
            .collect()
    }

    /// Rende l'anteprima di un documento: l'HTML del provider, e le parti
    /// **dichiarative** che i renderer registrati hanno prodotto.
    ///
    /// Il corpo non sta in cache (split metadata/body): si rilegge e riparsa
    /// dal disco, nella forma che il provider ha dichiarato (§3.4). Il render è
    /// per-documento e on demand — è esattamente il tipo di lettura che il disco
    /// serve bene, mentre la cache calda serve le mutazioni.
    pub fn render_preview(&self, id: &DocId) -> Result<RenderedDocument> {
        if !self.metas.contains_key(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let model = self.parse_from_disk(id)?;
        let provider = self.provider_for(id)?;
        Ok(renderer::compose(
            &model,
            provider,
            &self.renderers,
            &RenderOptions::preview(),
        )?)
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
    pub fn render_embed(
        &self,
        page: &str,
        heading: Option<&str>,
    ) -> Result<(DocId, RenderedDocument)> {
        let id = self
            .resolve_link(page)
            .ok_or_else(|| KernelError::NotFound(page.to_string()))?;
        if !self.metas.contains_key(&id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        // Come `render_preview`: il corpo si riparsa dal disco on demand.
        let model = self.parse_from_disk(&id)?;
        let provider = self.provider_for(&id)?;
        let opts = RenderOptions::preview();
        let model = match heading {
            None => model,
            Some(h) => {
                section_of(&model, h).ok_or_else(|| KernelError::NotFound(format!("{id}#{h}")))?
            }
        };
        // Anche un embed passa dai renderer: un diagramma dentro una nota
        // trascluso resta un diagramma. Gli slot delle parti sono numerati
        // dentro QUESTA composizione, e il frontend li monta dentro il
        // segnaposto dell'embed che ha appena idratato.
        Ok((
            id,
            renderer::compose(&model, provider, &self.renderers, &opts)?,
        ))
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

    // --- sessione ----------------------------------------------------------

    /// Pubblica il contesto del pannello con il focus e restituisce **le view
    /// da ridisegnare**: quelle la cui `ViewSpec::follows` interseca ciò che è
    /// cambiato, in ordine di registrazione.
    ///
    /// Lo chiama la shell a ogni cambio di nota, di selezione o di modalità. È
    /// l'unico modo di scrivere il contesto: le view lo **leggono** via
    /// [`HostApi::active_context`], nessuno lo scrive dall'interno del
    /// contratto — vedi il campo [`Workspace::context`].
    ///
    /// Il conto di *cosa* ridisegnare sta qui e non nella shell perché la
    /// risposta non deve dipendere da chi la calcola: la regola è una
    /// ([`ViewContext::changes`]), e a M5 un host diverso avrà la stessa. La
    /// shell resta padrona del *quando* (è lei a pubblicare) e ignara del
    /// *chi* (non conosce gli id delle view).
    pub fn set_active_context(&mut self, context: Option<ViewContext>) -> Vec<String> {
        let changed = match (&self.context, &context) {
            (Some(prima), Some(dopo)) => prima.changes(dopo),
            // Un contesto che appare o sparisce cambia tutto ciò che si può
            // seguire: non c'è un campo per volta da confrontare.
            (None, Some(_)) | (Some(_), None) => ContextMask::all(),
            (None, None) => ContextMask::default(),
        };
        self.context = context;
        if changed.is_empty() {
            return Vec::new();
        }
        self.views()
            .into_iter()
            .filter(|spec| spec.follows.intersects(&changed))
            .map(|spec| spec.id)
            .collect()
    }

    /// Scorciatoia per una shell a un pannello solo: il documento attivo, senza
    /// selezione né modalità dichiarata.
    ///
    /// Non è una seconda strada per la stessa cosa — è la stessa strada con i
    /// campi che una shell senza split non ha da dire. Azzera la selezione:
    /// dichiarare un documento e lasciare la selezione del precedente sarebbe
    /// l'unico modo di produrre uno span mentitore.
    pub fn set_active_document(&mut self, id: Option<DocId>) -> Vec<String> {
        let context = id.map(|id| ViewContext::new(MAIN_PANE).with_doc(Some(id)));
        self.set_active_context(context)
    }

    /// Il contesto del pannello con il focus, se la shell ne ha pubblicato uno.
    pub fn active_context(&self) -> Option<&ViewContext> {
        self.context.as_ref()
    }

    /// Il documento del contesto attivo: la lettura che il kernel usa dove il
    /// pannello non c'entra (rename, rimozione, comodità dei test).
    pub fn active_document(&self) -> Option<&DocId> {
        self.context.as_ref().and_then(|c| c.doc.as_ref())
    }

    /// Rimette il contesto in accordo con il vault dopo che il documento che
    /// guarda è cambiato, è stato rinominato o è sparito.
    ///
    /// La selezione cade in tutti e tre i casi, e per la stessa ragione: i suoi
    /// offset erano di un testo che non c'è più. Il `text` cadrebbe con essi —
    /// tenerlo senza span darebbe una selezione che non si sa più dov'era.
    fn invalidate_context(&mut self, doc: &DocId, change: ContextChange) {
        let Some(context) = self.context.as_mut() else {
            return;
        };
        if context.doc.as_ref() != Some(doc) {
            return;
        }
        context.selection = None;
        match change {
            ContextChange::Rewritten => {}
            ContextChange::Renamed(to) => context.doc = Some(to),
            ContextChange::Gone => context.doc = None,
        }
    }

    // --- indici -----------------------------------------------------------

    /// Interroga gli indici.
    ///
    /// Una buona metà delle query **non passa dai provider**: le serve il
    /// kernel, perché di quel dato è già l'unica fonte di verità. I backlink e
    /// il grafo stanno nel [`LinkGraph`] (conosce le regole di risoluzione dei
    /// wikilink e le ambiguità dell'intero vault); outline e proprietà stanno
    /// nei metadati parsati che il kernel tiene in cache; la salute del vault è
    /// un'interrogazione sugli stessi due. Duplicarli in un indice creerebbe una
    /// seconda verità che può divergere dalla prima — e per una view sarebbe
    /// comunque irraggiungibile, perché un `FormatProvider` un plugin non ce
    /// l'ha.
    ///
    /// Tutto il resto va ai provider registrati, in ordine di registrazione:
    /// vince il primo che non risponde [`PluginError::BadArgs`], che è per
    /// contratto il modo di dire "non è roba mia" (vedi
    /// [`IndexQuery::Custom`]). Se nessuno la riconosce, l'errore dell'ultimo
    /// interpellato arriva al chiamante.
    pub fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        match &query {
            IndexQuery::Backlinks { target, page } => {
                return Ok(IndexResult::Backlinks(Paged::window(
                    self.graph.backlinks(target),
                    *page,
                )));
            }
            IndexQuery::Outline { doc } => {
                let outline = self
                    .metas
                    .get(doc)
                    .map(|m| m.outline.clone())
                    .unwrap_or_default();
                return Ok(IndexResult::Outline(outline));
            }
            IndexQuery::Tags { page } => {
                // Da struttura incrementale ([`TagCounts`]): niente O(vault)
                // a ogni interrogazione — e il pannello interroga a ogni
                // `IndexUpdated`, cioè a ogni salvataggio.
                return Ok(IndexResult::Tags(Paged::window(
                    self.tags.snapshot(),
                    *page,
                )));
            }
            IndexQuery::Neighbors {
                doc,
                direction,
                depth,
                page,
            } => {
                return Ok(IndexResult::Neighbors(Paged::window(
                    self.graph.neighbors(doc, *direction, *depth),
                    *page,
                )));
            }
            IndexQuery::Properties {
                filter,
                sort,
                select,
                page,
            } => {
                let rows = properties::query(
                    self.metas.iter().map(|(id, m)| (id, &m.frontmatter)),
                    filter,
                    sort.as_ref(),
                    select,
                );
                return Ok(IndexResult::Properties(Paged::window(rows, *page)));
            }
            IndexQuery::PropertyValues { key, filter, page } => {
                let facets = properties::facets(
                    self.metas.iter().map(|(id, m)| (id, &m.frontmatter)),
                    key,
                    filter,
                );
                return Ok(IndexResult::PropertyValues(Paged::window(facets, *page)));
            }
            IndexQuery::VaultHealth { check, page } => {
                // In ordine di `DocId`: la cache è una mappa hash, e una
                // risposta paginata che cambiasse ordine a ogni chiamata
                // ripeterebbe e salterebbe righe fra una pagina e l'altra.
                let mut ids: Vec<&DocId> = self.metas.keys().collect();
                ids.sort();
                let issues = health::run(
                    *check,
                    ids.into_iter()
                        .map(|id| (id, self.metas[id].links.as_slice())),
                    &self.graph,
                    &self.registry.all_extensions(),
                );
                return Ok(IndexResult::VaultHealth(Paged::window(issues, *page)));
            }
            IndexQuery::FullText { .. } | IndexQuery::Custom { .. } => {}
        }
        let mut last = Err(PluginError::BadArgs(
            "nessun IndexProvider registrato".to_string(),
        ));
        for (_, index) in &self.indexes {
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
    ///
    /// È anche il punto in cui un indice **scrive**: riceve un [`HostApi`]
    /// intestato al proprio id, come gli event handler durante il dispatch.
    /// Gli indici escono dal workspace per la durata delle chiamate, così
    /// l'host può prestare `&mut Workspace` senza aliasing.
    pub fn flush_indexes(&mut self) -> Vec<PluginError> {
        let mut indexes = std::mem::take(&mut self.indexes);
        let mut errors = Vec::new();
        self.with_provider_call(|ws| {
            for (id, index) in indexes.iter_mut() {
                let mut host = KernelHost {
                    ws,
                    plugin: id,
                    mode: InvokeMode::Apply,
                };
                if let Err(e) = index.flush(&mut host) {
                    errors.push(e);
                }
            }
        });
        // Indici registrati *durante* il flush si accodano in fondo (simmetria
        // con `deliver_to_handlers`: nessun percorso può perdere una
        // registrazione solo perché è arrivata nel momento sbagliato).
        let registered_meanwhile = std::mem::take(&mut self.indexes);
        self.indexes = indexes;
        self.indexes.extend(registered_meanwhile);
        // Ciò che i flush hanno emesso si consegna a chiamate tornate, non
        // dentro il frame di un provider.
        self.dispatch_pending();
        errors
    }

    // --- view dichiarative -------------------------------------------------

    /// Registra un [`ViewProvider`] sotto un id, dichiarando **quanto ci si
    /// fida** di ciò che produce.
    ///
    /// `id` è l'identità del provider, come per gli handler e gli indici:
    /// determina lo spazio dati che l'[`HostApi`] gli concede.
    pub fn register_view_provider(
        &mut self,
        id: impl Into<String>,
        trust: Trust,
        provider: Box<dyn ViewProvider>,
    ) {
        self.views.push((id.into(), trust, provider));
    }

    /// Le view offerte dai provider registrati, in ordine di registrazione.
    pub fn views(&self) -> Vec<ViewSpec> {
        self.views.iter().flat_map(|(_, _, p)| p.views()).collect()
    }

    /// Rende una view e restituisce il suo albero di UI.
    ///
    /// **È il punto di enforcement del confine di fiducia della UI.** Ogni
    /// albero che entra nell'host passa da qui, e da un provider non fidato le
    /// varianti con contenuto attivo (`Html`, `WebView`) vengono rifiutate a
    /// qualunque profondità. Oggi tutti i provider registrabili sono fidati e la
    /// validazione è un no-op: il punto esiste **prima** del primo non fidato,
    /// perché aggiungerlo dopo significherebbe cercarlo fra N chiamanti.
    ///
    /// Prende `&self`: il render è una **lettura**, e gira sotto prestito
    /// condiviso del workspace — è esattamente il carico che il futuro
    /// `RwLock` deve poter parallelizzare (N view che si ridisegnano non si
    /// mettono in coda dietro una scrittura). Ha anche un effetto di
    /// visibilità: il provider non viene estratto (`mem::take`) per la durata
    /// della chiamata, quindi durante il render vede il mondo intero — indici
    /// e view registrate compresi. La mutilazione del mondo osservabile resta
    /// confinata ai callback in scrittura (vedi il doc di `HostApi`).
    pub fn render_view(&self, instance: &ViewInstance) -> std::result::Result<UiNode, PluginError> {
        let at = self.view_owner(&instance.view)?;
        let (id, trust, provider) = &self.views[at];
        self.check_params(at, instance)?;
        let host = ReadHost {
            ws: self,
            plugin: id,
        };
        let tree = provider.render_view(instance, &host)?;
        guard_ui(*trust, &tree)?;
        Ok(tree)
    }

    /// Consegna un'azione della UI al provider della view e restituisce il suo
    /// aggiornamento. L'albero eventualmente contenuto in
    /// [`ViewUpdate::Replace`] passa dalla stessa validazione di
    /// [`render_view`](Workspace::render_view): un provider non fidato non può
    /// iniettare contenuto attivo *in risposta a un click* invece che al
    /// rendering.
    pub fn view_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let at = self.view_owner(&instance.view)?;
        self.check_params(at, instance)?;
        let mut views = std::mem::take(&mut self.views);
        // Il flag rimanda il dispatch: se il provider scrive via `HostApi`
        // dentro `on_action`, gli handler NON girano nel suo frame — girano
        // nel `dispatch_pending` qui sotto, a chiamata tornata. Senza, un
        // plugin che è sia view sia handler (il caso versioning) sarebbe
        // rientrato nella propria istanza: in nativo funziona, a M5 trappa.
        let (updated, trust) = self.with_provider_call(|ws| {
            let (id, trust, provider) = &mut views[at];
            let mut host = KernelHost {
                ws,
                plugin: id,
                mode: InvokeMode::Apply,
            };
            (provider.on_action(instance, action, &mut host), *trust)
        });
        self.restore_views(views);
        let update = updated?;
        if let ViewUpdate::Replace { root } = &update {
            guard_ui(trust, root)?;
        }
        // Gli eventi accodati durante `on_action` arrivano ADESSO, dopo che la
        // chiamata del provider è tornata: è il contratto di consegna.
        self.dispatch_pending();
        Ok(update)
    }

    /// I parametri di questa istanza reggono la spec della sua view?
    ///
    /// È l'unico punto di convalida, e sta qui per la stessa ragione per cui ci
    /// stanno gli argomenti di un comando: uno schema che a farlo rispettare è
    /// chi lo pubblica non è uno schema, è un commento. Il provider riceve
    /// `params` già buoni e non deve difendersi da chi apre.
    fn check_params(
        &self,
        at: usize,
        instance: &ViewInstance,
    ) -> std::result::Result<(), PluginError> {
        let (_, _, provider) = &self.views[at];
        let spec = provider
            .views()
            .into_iter()
            .find(|spec| spec.id == instance.view)
            .ok_or_else(|| PluginError::UnknownView(instance.view.clone()))?;
        spec.validate_params(&instance.params)
    }

    /// Chi possiede una view, per posizione. `UnknownView` se nessuno.
    fn view_owner(&self, view: &str) -> std::result::Result<usize, PluginError> {
        self.views
            .iter()
            .position(|(_, _, p)| p.views().iter().any(|spec| spec.id == view))
            .ok_or_else(|| PluginError::UnknownView(view.to_string()))
    }

    /// Rimette i provider al loro posto, in coda a quelli registrati nel
    /// frattempo (simmetria con `deliver_to_handlers` e `flush_indexes`).
    fn restore_views(&mut self, views: Vec<(String, Trust, Box<dyn ViewProvider>)>) {
        let registered_meanwhile = std::mem::take(&mut self.views);
        self.views = views;
        self.views.extend(registered_meanwhile);
    }

    // --- comandi -----------------------------------------------------------
    //
    // Il registro della decisione 0009: un'azione si dichiara una volta e la chiedono tutti
    // — la palette, la tastiera, una macro, la CLI, il centro di comando. Il
    // kernel non sa cosa faccia un comando; sa scegliere chi lo possiede,
    // convalidare ciò che gli si passa e decidere **quali capacità** prestargli.

    /// Registra un [`CommandProvider`] sotto un id, con la stessa disciplina
    /// degli altri provider: l'id è lo spazio dati che l'[`HostApi`] gli
    /// concede, e l'ordine di registrazione è l'ordine in cui i comandi
    /// compaiono e in cui si risolve un id conteso.
    pub fn register_command_provider(
        &mut self,
        id: impl Into<String>,
        provider: Box<dyn CommandProvider>,
    ) {
        // La firma resta `Box` — è quella degli altri `register_*`, e chi
        // registra non deve sapere perché qui dentro serve un `Arc` (decisione 0013:
        // `run_command` rientra nel registro mentre il registro è in uso).
        self.commands.push((id.into(), Arc::from(provider)));
    }

    /// I comandi offerti dai provider registrati, in ordine di registrazione.
    ///
    /// È la metà "discovery" del registro, ed è la ragione per cui una
    /// [`CommandSpec`] porta descrizione, parametri e raggio: chi legge questo
    /// elenco può essere una palette, ma anche una CLI o un modello, e nessuno
    /// dei due ha letto il codice del comando.
    pub fn commands(&self) -> Vec<CommandSpec> {
        self.commands
            .iter()
            .flat_map(|(_, p)| p.commands())
            .collect()
    }

    /// Esegue — o **simula** — un comando.
    ///
    /// Due cose accadono qui e non dentro i comandi, e sono le due che rendono
    /// il registro utilizzabile da chi non lo conosce:
    ///
    /// 1. **Gli argomenti sono convalidati contro la spec**
    ///    ([`CommandSpec::validate_args`]) prima di chiamare chiunque. Un
    ///    comando non deve difendersi da un chiamante distratto, e chi sbaglia
    ///    riceve un [`PluginError::BadArgs`] che dice cosa manca — non un
    ///    comportamento a sorpresa.
    /// 2. **Le capacità dipendono da ciò che il comando ha dichiarato.** Scrive
    ///    solo un [`InvokeMode::Apply`] di un comando che si è dichiarato
    ///    `writes`; in ogni altro caso l'host prestato è in sola lettura e ogni
    ///    scrittura risponde [`PluginError::PermissionDenied`]. Il dry-run
    ///    quindi non è una promessa di chi implementa (che un comando di terzi
    ///    non manterrebbe), ed è per la stessa ragione che `writes: false` non è
    ///    una decorazione: dichiararsi innocuo è vincolante.
    ///
    /// 3. **L'invocazione è un lotto, intestato a chi l'ha chiesta** (decisione 0011 +
    ///    decisione 0012). Un `Apply` è, per definizione, *una* cosa che qualcuno ha
    ///    chiesto: `vault.replace` su 40 note emette un `batch-ended` solo, e
    ///    ogni evento che ne nasce porta `by` come attore. Che `by` sia un
    ///    parametro e non un default è la stessa scelta di [`InvokeMode`]:
    ///    attribuire all'utente ciò che ha chiesto un'automazione è l'errore che
    ///    16.2 esiste per non fare — l'automazione non riconoscerebbe più le
    ///    proprie scritture, e si richiamerebbe da sola.
    ///
    /// L'attore è **chi ha chiesto**, non il provider che esegue: un comando
    /// invocato da un plugin scrive con l'origine di quel plugin. Per la stessa
    /// ragione `by` non arriva fino a
    /// [`CommandProvider::invoke`](fubmd_abi::traits::CommandProvider::invoke):
    /// l'origine è ciò che l'host **appone**, non ciò che il comando legge, e un
    /// comando che si comportasse diversamente a seconda di chi lo chiama
    /// sarebbe una policy (§7.3) nascosta dentro un'implementazione. Il giorno
    /// che servirà leggerla, è un metodo additivo sull'`HostApi`.
    ///
    /// Il resto è la disciplina di sempre: il provider esce dal workspace per la
    /// durata della chiamata, `in_provider_call` rimanda il dispatch, e ciò che
    /// il comando ha emesso arriva agli handler **dopo** che `invoke` è tornata.
    pub fn invoke_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Actor,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.as_actor(by, |ws| {
            ws.batch(|ws| ws.invoke_command_here(command, args, mode))
        })
    }

    /// L'invocazione **annidata**: quella di
    /// [`HostApi::run_command`](fubmd_abi::traits::HostApi::run_command).
    ///
    /// Differisce da [`invoke_command`](Workspace::invoke_command) per le due
    /// cose che non fa, ed è lì che sta la semantica della decisione 0013:
    ///
    /// - **non cambia attore**: chi ha chiesto è chi è entrato nel kernel, e
    ///   invocare non è entrare. Un comando che si intestasse le scritture
    ///   fatte per conto dell'utente direbbe all'automazione che le ha chieste
    ///   lei, e un'automazione che non riconosce chi ha chiesto si richiama da
    ///   sola (è il caso che la decisione 0012 esiste per evitare, letto dall'altro
    ///   verso).
    /// - **non apre un lotto**: si unisce a quello aperto (se non ce n'è uno —
    ///   un handler che invoca un comando — lo apre, perché anche lì è *una*
    ///   cosa). Una macro di tre comandi è un `batch-ended` solo.
    ///
    /// Il **modo** invece non è un parametro di questa funzione per caso: lo
    /// passa l'host, che è l'unico a sapere in che modo sta girando chi
    /// invoca. Vedi `KernelHost::mode` e `ReadOnlyHost::run_command`.
    fn invoke_command_nested(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.batch(|ws| ws.invoke_command_here(command, args, mode))
    }

    fn invoke_command_here(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let at = self.command_owner(command)?;
        let spec = self.commands[at]
            .1
            .commands()
            .into_iter()
            .find(|s| s.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando");
        spec.validate_args(&args)?;

        // Il giro (decisione 0013). Un comando che rientra su sé stesso non è una
        // profondità da limitare con un numero: è un errore di chi lo ha
        // scritto, e l'unica risposta utile lo nomina.
        if self.command_stack.iter().any(|c| c == command) {
            let mut giro = self.command_stack.clone();
            giro.push(command.to_string());
            return Err(PluginError::BadArgs(format!(
                "un comando non può invocare sé stesso: {}",
                giro.join(" → ")
            )));
        }

        // Il provider **resta** nel registro: si condivide il puntatore (vedi
        // il campo `commands`). È ciò che permette a `run_command` di trovare
        // gli altri comandi — e anche gli altri comandi dello stesso provider —
        // mentre questo è in corso.
        let (owner, provider) = self.commands[at].clone();
        self.command_stack.push(command.to_string());
        let outcome = if spec.scope.writes && mode == InvokeMode::Apply {
            self.with_provider_call(|ws| {
                let mut host = KernelHost {
                    ws,
                    plugin: &owner,
                    mode,
                };
                provider.invoke(command, args, mode, &mut host)
            })
        } else {
            let why = if mode.is_dry_run() {
                "una simulazione non scrive"
            } else {
                "il comando si è dichiarato di sola lettura"
            };
            let mut host = ReadOnlyHost {
                ws: self,
                plugin: &owner,
                why,
            };
            provider.invoke(command, args, mode, &mut host)
        };
        self.command_stack.pop();

        let mut outcome = outcome?;
        if let CommandEffect::Plan(plan) = &mut outcome.effect {
            // L'insieme impattato è ciò che l'utente approva: lo completa
            // l'host, invece di fidarsi che chi ha scritto il piano si sia
            // ricordato di elencare ogni documento che i suoi edit nominano.
            plan.complete();
        }
        self.dispatch_pending();
        Ok(outcome)
    }

    /// Chi possiede un comando, per posizione. `UnknownCommand` se nessuno.
    fn command_owner(&self, command: &str) -> std::result::Result<usize, PluginError> {
        self.commands
            .iter()
            .position(|(_, p)| p.commands().iter().any(|spec| spec.id == command))
            .ok_or_else(|| PluginError::UnknownCommand(command.to_string()))
    }

    // --- import ed export ---------------------------------------------------
    //
    // Il kernel non sa cosa sia un formato di scambio: sa scegliere chi lo sa e
    // prestargli le capacità. Vedi `fubmd_abi::transfer`.

    /// Registra un [`ImportProvider`] sotto un id. L'ordine di registrazione è
    /// l'ordine in cui i provider vengono interpellati da
    /// [`import`](Workspace::import).
    ///
    /// Come per gli altri provider, `id` è un nome semplice e determina lo
    /// spazio dati (`.fubmd-data/plugins/<id>/`).
    pub fn register_import_provider(&mut self, id: impl Into<String>, p: Box<dyn ImportProvider>) {
        self.imports.push((id.into(), p));
    }

    /// Registra un [`ExportProvider`] sotto un id.
    pub fn register_export_provider(&mut self, id: impl Into<String>, p: Box<dyn ExportProvider>) {
        self.exports.push((id.into(), p));
    }

    /// Fa entrare una sorgente esterna nel vault, col **primo** provider
    /// registrato che la riconosce.
    ///
    /// Il dispatch è lo stesso di `query_index` visto da vicino: interpellare in
    /// ordine e fermarsi al primo che risponde. Qui però la domanda «è roba
    /// tua?» è esplicita ([`ImportProvider::can_handle`]) invece di essere
    /// dedotta da un `BadArgs`, perché una sorgente si può riconoscere **senza**
    /// provare a importarla — e provare, per un import, vuol dire scrivere.
    ///
    /// Nessun provider la riconosce → `BadArgs`: il kernel non ha un formato di
    /// riserva, e fingere di averlo produrrebbe note vuote.
    ///
    /// Gli eventi che l'import genera (una `DocumentChanged` per documento,
    /// oggi) arrivano **dopo** che la chiamata del provider è tornata, come per
    /// ogni altro callback in scrittura. Che siano N e non uno è il debito del
    /// decisione 0011 (il lotto), non una scelta di qui.
    pub fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
    ) -> std::result::Result<ImportReport, PluginError> {
        let at = self
            .imports
            .iter()
            .position(|(_, p)| p.can_handle(source))
            .ok_or_else(|| {
                PluginError::BadArgs(format!(
                    "nessun ImportProvider registrato riconosce `{}`",
                    source.name
                ))
            })?;
        // Stessa disciplina di `view_action`: i provider escono dal workspace
        // per la durata della chiamata (così `KernelHost` può prestare
        // `&mut Workspace`), e chi si registra nel frattempo si accoda in fondo.
        let mut imports = std::mem::take(&mut self.imports);
        let report = self.with_provider_call(|ws| {
            let (id, provider) = &mut imports[at];
            let mut host = KernelHost {
                ws,
                plugin: id,
                mode: InvokeMode::Apply,
            };
            provider.import(source, request, &mut host)
        });
        let registered_meanwhile = std::mem::take(&mut self.imports);
        self.imports = imports;
        self.imports.extend(registered_meanwhile);
        self.dispatch_pending();
        report
    }

    /// Le destinazioni di export offerte dai provider registrati.
    pub fn export_targets(&self) -> Vec<ExportTarget> {
        self.exports.iter().flat_map(|(_, p)| p.targets()).collect()
    }

    /// Esporta secondo la richiesta, col provider che possiede la destinazione.
    ///
    /// Prende `&self`, come [`render_view`](Workspace::render_view) e per la
    /// stessa ragione: un export è una lettura, e le letture girano sotto
    /// prestito condiviso invece di mettersi in fila dietro una scrittura. Il
    /// provider non viene quindi estratto dal workspace e durante l'export vede
    /// il mondo intero — indici compresi, che è ciò che serve a una selezione
    /// per query.
    pub fn export(
        &self,
        request: &ExportRequest,
    ) -> std::result::Result<ExportReport, PluginError> {
        let (id, provider) = self
            .exports
            .iter()
            .find(|(_, p)| p.targets().iter().any(|t| t.id == request.target))
            .ok_or_else(|| {
                PluginError::BadArgs(format!(
                    "destinazione di export ignota: `{}`",
                    request.target
                ))
            })?;
        let host = ReadHost {
            ws: self,
            plugin: id,
        };
        provider.export(request, &host)
    }

    // --- eventi ------------------------------------------------------------

    /// Unico punto di emissione: ponte verso i subscriber esterni + coda per
    /// gli handler registrati.
    ///
    /// È anche il punto unico in cui l'origine (decisione 0012) viene apposta e in cui il
    /// lotto (decisione 0011) fa il proprio lavoro. Che siano la stessa riga non è
    /// economia: un secondo posto da cui emettere sarebbe un posto da cui uscire
    /// senza origine o fuori dal lotto, e un evento non attribuito è
    /// indistinguibile da uno attribuito male.
    fn emit_event(&mut self, event: Event) {
        // Dentro un lotto `index-updated` non esce: N copie di un evento senza
        // payload dicono quanto ne dice una, e alla chiusura il `batch-ended`
        // dice quella e in più *quali* documenti. È l'unico evento che il lotto
        // coalizza — vedi il doc di `fubmd_abi::event`.
        if let Some(state) = self.batch.as_mut() {
            if matches!(event, Event::IndexUpdated) {
                state.index_dirty = true;
                return;
            }
            if let Some(doc) = event.touched() {
                if !state.changed.contains(doc) {
                    state.changed.push(doc.clone());
                }
            }
        }
        let notice = Notice::new(event, self.origin());
        self.bus.emit(notice.clone());
        self.pending.push_back(notice);
    }

    /// L'origine di ciò che il workspace sta emettendo adesso.
    fn origin(&self) -> Origin {
        Origin::by(self.actor.clone()).in_batch(self.batch.as_ref().map(|b| b.id))
    }

    /// Esegue `f` attribuendo a `actor` tutto ciò che ne nasce, e rimette
    /// l'attore di prima quando `f` è tornata.
    ///
    /// L'attore è **chi ha chiesto**, non chi esegue: per questo lo alzano il
    /// watcher (il vault è cambiato senza passare da noi), il dispatch verso un
    /// handler (il plugin agisce di propria iniziativa) e `invoke_command` — dove
    /// però l'attore è il *chiamante* del comando, non il provider che lo
    /// esegue. Vedi `fubmd_abi::event`.
    fn as_actor<R>(&mut self, actor: Actor, f: impl FnOnce(&mut Self) -> R) -> R {
        let prev = std::mem::replace(&mut self.actor, actor);
        let result = f(self);
        self.actor = prev;
        result
    }

    /// Esegue `f` dentro un **lotto** (decisione 0011): ciò che vi succede è una cosa
    /// sola.
    ///
    /// Cosa cambia, dentro: gli eventi portano l'id del lotto sulla propria
    /// origine, `index-updated` non viene emesso, e il dispatch verso gli
    /// handler è rimandato alla chiusura — un handler che vedesse la sorgente
    /// numero 1 di una rinomina mentre la 200 non è ancora riscritta vedrebbe un
    /// vault a metà, e reagirebbe a uno stato che non è mai esistito per
    /// nessuno.
    ///
    /// Alla chiusura, se qualcosa è stato toccato, arriva un
    /// [`Event::BatchEnded`] con l'elenco dei documenti; poi la coda si drena.
    ///
    /// **Non è una transazione.** Se una delle scritture dentro `f` fallisce, le
    /// altre restano fatte: il lotto non annulla niente e non lo promette (il
    /// tutto-o-niente vuole il journal del §15.2). Ciò che è andato storto lo
    /// riporta `f` col proprio valore di ritorno, che questa funzione passa
    /// intatto.
    ///
    /// Annidato, entra nel lotto che c'è invece di aprirne un secondo: chiudere
    /// quello interno farebbe arrivare un `batch-ended` mentre l'operazione
    /// esterna è ancora in corso.
    pub fn batch<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        if self.batch.is_some() {
            // Entra in quello che c'è, e non lo chiude: a chiudere è chi lo ha
            // aperto. Contare le aperture non servirebbe a niente — chi trova il
            // campo pieno non lo tocca in nessun caso.
            return f(self);
        }
        let id = BatchId(self.next_batch_id);
        self.next_batch_id += 1;
        self.batch = Some(BatchState {
            id,
            changed: Vec::new(),
            index_dirty: false,
        });
        let result = f(self);
        self.end_batch();
        result
    }

    /// Chiude il lotto più esterno: emette il terminale (se c'è qualcosa da
    /// dire) e drena.
    fn end_batch(&mut self) {
        let Some(state) = self.batch.take() else {
            return;
        };
        if state.index_dirty || !state.changed.is_empty() {
            // Il terminale si costruisce a mano invece di passare da
            // `emit_event`: la sua origine porta il lotto che sta **chiudendo**
            // (è l'evento *del* lotto, non uno che arriva dopo), e passare dal
            // punto unico significherebbe o riaprire il lotto per una riga o
            // emetterlo orfano.
            let notice = Notice::new(
                Event::BatchEnded {
                    batch: state.id,
                    changed: state.changed,
                },
                Origin::by(self.actor.clone()).in_batch(Some(state.id)),
            );
            self.bus.emit(notice.clone());
            self.pending.push_back(notice);
        }
        self.dispatch_pending();
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
    ///
    /// Un lotto aperto rimanda il drenaggio come lo rimanda una chiamata a un
    /// provider, e per la stessa ragione: dentro, il vault è a metà di
    /// un'operazione che nessuno ha ancora finito di chiedere.
    ///
    /// **Un lotto non è al riparo dal troncamento.** Se il budget si esaurisce
    /// mentre la coda si drena, fra gli eventi persi può esserci il
    /// `batch-ended`: l'`Overflow` che arriva al suo posto dice «riconcilia da
    /// zero», che è una richiesta più forte di «ridisegna questi documenti», e
    /// una garanzia in più per il solo terminale sarebbe una seconda promessa
    /// più debole accanto a una che già copre il caso.
    fn dispatch_pending(&mut self) {
        // La guardia di rientranza DEVE venire prima del fast-path qui sotto:
        // durante un dispatch gli handler sono estratti (`handlers` è vuoto) e
        // svuotare la coda qui butterebbe via gli eventi appena accodati.
        //
        // `in_provider_call` è l'altra metà della stessa regola: un provider
        // che scrive durante `on_action`/`handle`/`flush` accoda, e la coda si
        // drena quando la SUA chiamata è tornata — mai dentro il suo frame
        // (a M5 il component model vieta la rientranza di un'istanza; la
        // semantica di consegna non può cambiare al freeze).
        if self.dispatching || self.in_provider_call || self.batch.is_some() {
            return;
        }
        if self.handlers.is_empty() {
            // Nessun osservatore: non accumulare eventi all'infinito.
            self.pending.clear();
            return;
        }
        self.dispatching = true;
        let mut budget = DISPATCH_BUDGET;
        while let Some(notice) = self.pending.pop_front() {
            if budget == 0 {
                // L'evento estratto e i rimanenti non verranno consegnati.
                let dropped = (self.pending.len() + 1) as u64;
                self.pending.clear();
                // Il troncamento è del **kernel**: non lo ha chiesto chi stava
                // scrivendo, e attribuirglielo direbbe a un'automazione «questa
                // l'hai causata tu» proprio nel momento in cui le si chiede di
                // riconciliare.
                let overflow = Notice::new(Event::Overflow { dropped }, Origin::by(Actor::Kernel));
                self.bus.emit(overflow.clone());
                self.deliver_to_handlers(&overflow);
                // Ciò che gli handler hanno emesso gestendo l'Overflow è
                // scartato: la coda deve terminare qui.
                self.pending.clear();
                break;
            }
            budget -= 1;
            self.deliver_to_handlers(&notice);
        }
        self.dispatching = false;
    }

    /// Esegue `f` col flag `in_provider_call` alzato: qualunque
    /// `dispatch_pending` innescato dentro `f` (un provider che scrive via
    /// `HostApi`) viene rimandato. Chi chiama è responsabile di drenare la
    /// coda **dopo** — è il "dopo che la tua chiamata è tornata" del contratto.
    fn with_provider_call<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        let prev = self.in_provider_call;
        self.in_provider_call = true;
        let result = f(self);
        self.in_provider_call = prev;
        result
    }

    /// Consegna un singolo evento a tutti gli handler abbonati. Gli handler
    /// escono dal workspace per la durata della chiamata: così `KernelHost`
    /// può prestare `&mut Workspace` senza aliasing.
    ///
    /// Per la durata di `handle` l'attore è il **plugin** (decisione 0012): ciò che
    /// scrive lì dentro lo ha chiesto lui, di propria iniziativa, ed è così che
    /// alla prossima consegna riconosce le proprie scritture senza tenerne una
    /// contabilità privata. L'origine dell'evento che sta *ricevendo* è un'altra
    /// cosa e sta nel [`Notice`], dove il plugin la legge.
    fn deliver_to_handlers(&mut self, notice: &Notice) {
        let mut handlers = std::mem::take(&mut self.handlers);
        self.with_provider_call(|ws| {
            for (id, handler) in handlers.iter_mut() {
                if !handler.subscribed().contains(notice.kind()) {
                    continue;
                }
                let attore = Actor::Plugin { id: id.clone() };
                ws.as_actor(attore, |ws| {
                    let mut host = KernelHost {
                        ws,
                        plugin: id,
                        mode: InvokeMode::Apply,
                    };
                    // L'errore di un handler non deve far fallire l'operazione
                    // che ha emesso l'evento: si ignora (M4: log/notifica).
                    let _ = handler.handle(notice, &mut host);
                });
            }
        });
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
    ///
    /// L'origine è [`Actor::Kernel`] e non il plugin che ha lanciato il job: il
    /// job lo ha eseguito l'host, fuori dal lock, e il lanciatore si riconosce
    /// dall'`id` — che è il campo fatto apposta. Intestarglielo direbbe «questo
    /// lo hai chiesto tu adesso», che è vero solo a metà e proprio nel senso
    /// sbagliato per un handler che salta le proprie scritture.
    pub fn complete_job(
        &mut self,
        id: JobId,
        job: impl Into<String>,
        result: std::result::Result<serde_json::Value, PluginError>,
    ) {
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::JobDone {
                id,
                job: job.into(),
                result,
            });
            ws.dispatch_pending();
        });
    }

    // --- interni ---------------------------------------------------------

    /// Parsa una sorgente che il chiamante ha già in mano.
    ///
    /// Ha per forza del testo: chi la chiama è appena passato da una scrittura o
    /// da un `Vault::read`. Per un documento che sta solo sul disco c'è
    /// [`Workspace::parse_from_disk`], che legge nella forma che il provider ha
    /// dichiarato.
    fn parse(&self, id: &DocId, source: &str) -> Result<DocumentModel> {
        self.parse_source(id, DocumentSource::Text(source.to_string()))
    }

    /// Legge e parsa un documento **nella forma che il suo provider chiede**:
    /// testo decodificato o byte grezzi (§3.4).
    fn parse_from_disk(&self, id: &DocId) -> Result<DocumentModel> {
        let source = match self.provider_for(id)?.descriptor().source {
            SourceKind::Text => DocumentSource::Text(self.vault.read(id)?),
            SourceKind::Bytes => DocumentSource::Bytes(self.vault.read_bytes(id)?),
        };
        self.parse_source(id, source)
    }

    fn parse_source(&self, id: &DocId, source: DocumentSource) -> Result<DocumentModel> {
        let provider = self.provider_for(id)?;
        let ctx = ParseContext::obsidian(id.as_str());
        let mut model = provider.parse(&source, &ctx)?;
        // L'innesto del §3.1: le regole sintattiche registrate girano DOPO il
        // provider, sul modello. È ciò che le rende innestabili su un provider
        // che non le conosce — vedi `syntax::apply_rules`.
        self.syntax
            .apply(&mut model, &ctx, &provider.descriptor().id);
        Ok(model)
    }

    fn provider_for(&self, id: &DocId) -> Result<&dyn fubmd_abi::FormatProvider> {
        let ext = extension_of(id).unwrap_or_default();
        self.registry
            .provider_for_ext(&ext)
            .ok_or(KernelError::NoProvider(ext))
    }

    fn rebuild_graph(&mut self) {
        self.graph = LinkGraph::build(self.metas.values());
    }

    // --- storage persistente dei plugin ------------------------------------

    /// La radice dello spazio dati di un plugin, **come cartella del
    /// filesystem**.
    ///
    /// È un varco per il codice nativo, e per questo è un metodo del workspace
    /// e non una capacità dell'[`HostApi`]: `data_*` nomina blob, non file, ed è
    /// tutto ciò che un plugin WASM avrà. Un provider nativo che avvolge un
    /// motore con un proprio formato su disco (tantivy mmappa i suoi segmenti e
    /// li rilegge quando gli pare, anche dai thread di merge) ha bisogno di una
    /// vera cartella: questa è quella cartella, **dentro lo stesso recinto** di
    /// tutto il resto. A M5 l'equivalente per un componente è un preopen WASI
    /// sulla stessa radice.
    ///
    /// Rifiuta un id che non sia un nome semplice, con la stessa regola dei
    /// path di `data_*`: il recinto è uno.
    pub fn plugin_data_dir(&self, plugin: &str) -> std::result::Result<Utf8PathBuf, PluginError> {
        self.plugin_data_path(plugin, "")
    }

    /// La radice dello spazio dati di un plugin.
    fn plugin_data_root(&self, plugin: &str) -> Utf8PathBuf {
        self.vault
            .root()
            .join(DATA_DIR)
            .join(PLUGIN_DATA_DIR)
            .join(plugin)
    }

    /// Traduce un path relativo dello spazio di un plugin in un path assoluto,
    /// rifiutando **tutto** ciò che proverebbe a uscirne.
    ///
    /// Il recinto è qui e in nessun altro posto: il plugin nomina blob, non
    /// path del filesystem, e non ha modo di sapere dove sia la radice del
    /// vault. `rel` vuoto è la radice stessa (serve a `data_list`).
    fn plugin_data_path(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<Utf8PathBuf, PluginError> {
        let denied = |why: &str| PluginError::PermissionDenied(format!("`{rel}`: {why}"));
        if !is_safe_component(plugin) {
            return Err(PluginError::PermissionDenied(format!(
                "id di plugin non utilizzabile come spazio dati: `{plugin}`"
            )));
        }
        let mut path = self.plugin_data_root(plugin);
        if rel.is_empty() {
            return Ok(path);
        }
        // I separatori sono `/` e basta: un `\` su Windows sarebbe un
        // separatore, e qui deve restare un carattere qualunque — cioè un nome
        // di file illegale, non una via d'uscita.
        if rel.contains('\\') {
            return Err(denied("i separatori di path sono `/`"));
        }
        for comp in rel.split('/') {
            if !is_safe_component(comp) {
                return Err(denied("path assoluti e risalite non sono ammessi"));
            }
            path.push(comp);
        }
        Ok(path)
    }
}

/// Valida un nome/path destinato a diventare (o rimpiazzare) un [`DocId`]:
/// normalizza i separatori `\` → `/`, toglie spazi e slash iniziali, rifiuta
/// componenti vuote, `.` e `..`. Un path che risale (`../fuori.md`) uscirebbe
/// dal vault lasciando un `DocId` fantasma in modelli, grafo e indici.
///
/// È la regola di `create_note`, estratta perché OGNI percorso che trasforma
/// input esterno in un `DocId` deve passarci: rename, restore e i costruttori
/// usati dai comandi IPC (a M4/M5 quella superficie è dei plugin).
pub fn valid_doc_id(name: &str) -> Result<DocId> {
    let normalizzato = name.replace('\\', "/");
    let pulito = normalizzato.trim().trim_start_matches('/');
    if pulito.is_empty()
        || pulito
            .split('/')
            .any(|c| c.is_empty() || c == "." || c == "..")
    {
        return Err(KernelError::BadName(name.to_string()));
    }
    Ok(DocId::new(pulito))
}

/// Il [`DocId`] con cui un **plugin** può nominare un documento, o
/// `PermissionDenied`.
///
/// È [`valid_doc_id`] applicata sul confine delle capacità: stessa regola dei
/// comandi IPC, altro varco. L'errore è `PermissionDenied` e non `BadArgs`
/// perché è la stessa risposta che `data_*` dà a una risalita — per chi la
/// riceve, i due recinti si comportano allo stesso modo.
fn fenced_doc_id(id: &DocId) -> std::result::Result<DocId, PluginError> {
    valid_doc_id(id.as_str()).map_err(|_| {
        PluginError::PermissionDenied(format!(
            "`{id}`: un documento si nomina con un path relativo dentro il vault"
        ))
    })
}

/// Un errore del kernel come lo vede un provider.
///
/// Le due specie della modifica chirurgica non finiscono in `Internal`: un
/// conflitto è la sola cosa che chi chiama deve **riprovare** (rileggendo e
/// ricalcolando), un edit malformato la sola che deve **correggere**.
/// Appiattirli su un errore interno lascerebbe quella distinzione a chi legge il
/// messaggio, cioè a una stringa italiana — che è il debito del §12.2, non un
/// posto dove aggiungerne.
fn plugin_error(e: KernelError) -> PluginError {
    match e {
        KernelError::Stale(doc) => PluginError::Conflict(doc),
        KernelError::BadEdit { doc, why } => PluginError::BadArgs(format!("{doc}: {why}")),
        other => PluginError::Internal(other.to_string()),
    }
}

/// La validazione del confine di fiducia della UI, in un posto solo.
///
/// Da un provider fidato passa tutto; da uno non fidato l'albero deve essere
/// interamente dichiarativo. La funzione è banale **di proposito**: il valore non
/// è nell'algoritmo (sta in [`UiNode::validate_untrusted`]), è nel fatto che
/// esista un unico varco attraverso cui gli alberi entrano.
fn guard_ui(trust: Trust, tree: &UiNode) -> std::result::Result<(), PluginError> {
    if trust.allows_active_content() {
        Ok(())
    } else {
        tree.validate_untrusted()
    }
}

/// Un componente di path che un plugin può nominare: non vuoto, non `.`, non
/// `..`, senza separatori e senza il `:` delle lettere di unità Windows.
fn is_safe_component(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains(':')
}

/// Elenca ricorsivamente i file sotto `dir`, come path relativi a `root`.
fn collect_data_files(root: &Utf8Path, dir: &Utf8Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        // Una cartella che non c'è è una lista vuota, non un errore: chi
        // interroga uno storage vuoto non sta sbagliando niente.
        return;
    };
    for entry in entries.flatten() {
        let Ok(path) = Utf8PathBuf::from_path_buf(entry.path()) else {
            continue; // path non UTF-8: non è nominabile dal contratto
        };
        if path.is_dir() {
            collect_data_files(root, &path, out);
        } else if let Some(rel) = path.strip_prefix(root).ok().map(Utf8Path::as_str) {
            out.push(rel.replace('\\', "/"));
        }
    }
}

/// L'[`HostApi`] del kernel per gli handler fidati: chiamate dirette, costo
/// zero. È qui (in un solo punto) che a M4 si innesteranno i permessi dei
/// plugin — vedi `docs/architecture/plugin-boundary.md`.
struct KernelHost<'a> {
    ws: &'a mut Workspace,
    /// Chi sta usando queste capacità: determina lo spazio dati `data_*`.
    plugin: &'a str,
    /// In che modo sta girando chi ha in mano questo host.
    ///
    /// Serve a una capacità sola — [`HostApi::run_command`] — ed è ciò che
    /// impedisce a una simulazione di diventare reale invocando qualcuno. Fuori
    /// dal percorso dei comandi (dispatch di un evento, azione di una view,
    /// import) è [`InvokeMode::Apply`], che è la verità: lì non si sta
    /// simulando niente.
    mode: InvokeMode,
}

impl HostApi for KernelHost<'_> {
    fn read_document(&self, id: &DocId) -> std::result::Result<String, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws
            .read_source(&id)
            .map_err(|e| PluginError::Internal(e.to_string()))
    }

    fn write_document(&mut self, id: &DocId, source: &str) -> std::result::Result<(), PluginError> {
        // Il recinto del vault, sul confine dei plugin e in un punto solo. Fino
        // alla decisione 0006 l'unico input esterno che diventava un `DocId` arrivava dai
        // comandi IPC, che lo sanitizzano; un `ImportProvider` invece nomina i
        // documenti a partire dal **nome di una sorgente**, cioè da una stringa
        // che l'utente non ha scritto (un'entrata di zip, un campo di JSON).
        // `../../.ssh/authorized_keys` non è un `DocId` fantasma: è una
        // scrittura fuori dal vault.
        let id = fenced_doc_id(id)?;
        self.ws
            .write_document(&id, source)
            .map_err(|e| PluginError::Internal(e.to_string()))
    }

    fn document_revision(&self, id: &DocId) -> std::result::Result<Revision, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.document_revision(&id).map_err(plugin_error)
    }

    fn apply_edit(
        &mut self,
        id: &DocId,
        request: EditRequest,
    ) -> std::result::Result<EditReport, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.apply_edit(&id, request).map_err(plugin_error)
    }

    fn list_documents(&self) -> std::result::Result<Vec<DocId>, PluginError> {
        Ok(self.ws.documents())
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.ws.free_name(id)
    }

    fn create_document(
        &mut self,
        id: &DocId,
        source: &str,
    ) -> std::result::Result<(), PluginError> {
        let id = fenced_doc_id(id)?;
        // Il rifiuto È la capacità: `write_document` qui sopra sovrascrive, e
        // se questa facesse lo stesso non ci sarebbe motivo di averla.
        if self.ws.is_taken(&id) {
            return Err(plugin_error(KernelError::AlreadyExists(id.to_string())));
        }
        self.ws.write_document(&id, source).map_err(plugin_error)?;
        Ok(())
    }

    fn rename_document(
        &mut self,
        from: &DocId,
        to: &DocId,
    ) -> std::result::Result<(), PluginError> {
        let from = fenced_doc_id(from)?;
        let to = fenced_doc_id(to)?;
        self.ws.rename_document(&from, &to).map_err(plugin_error)
    }

    fn trash_document(&mut self, id: &DocId) -> std::result::Result<DocId, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.delete_document(&id).map_err(plugin_error)
    }

    fn list_trash(&self) -> std::result::Result<Vec<TrashEntry>, PluginError> {
        self.ws.list_trash().map_err(plugin_error)
    }

    fn restore_document(
        &mut self,
        entry: &DocId,
        to: Option<DocId>,
    ) -> std::result::Result<DocId, PluginError> {
        // `entry` nomina un file **dentro** `.trash/`, non un documento del
        // vault: il recinto che vale qui è quello del cestino, e lo applica
        // `restore_from_trash` cercando la voce fra quelle che esistono — un id
        // che non è nel cestino è `NotFound`, non un path da spazzolare. Il
        // `to`, che invece atterra nel vault, lo valida il kernel.
        self.ws.restore_from_trash(entry, to).map_err(plugin_error)
    }

    fn empty_trash(&mut self) -> std::result::Result<u64, PluginError> {
        self.ws
            .empty_trash()
            .map(|n| n as u64)
            .map_err(plugin_error)
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

    fn data_read(&self, path: &str) -> std::result::Result<Option<Vec<u8>>, PluginError> {
        let path = self.data_blob(path)?;
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            // Mancare non è un errore: chi legge uno store vuoto lo scopre così.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(PluginError::Internal(format!("{path}: {e}"))),
        }
    }

    fn data_write(&mut self, path: &str, bytes: &[u8]) -> std::result::Result<(), PluginError> {
        let path = self.data_blob(path)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| PluginError::Internal(format!("{parent}: {e}")))?;
        }
        std::fs::write(&path, bytes).map_err(|e| PluginError::Internal(format!("{path}: {e}")))
    }

    fn data_remove(&mut self, path: &str) -> std::result::Result<(), PluginError> {
        let path = self.data_blob(path)?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            // Idempotente: cancellare ciò che non c'è è già il risultato voluto.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(PluginError::Internal(format!("{path}: {e}"))),
        }
    }

    fn data_list(&self, prefix: &str) -> std::result::Result<Vec<String>, PluginError> {
        let root = self.ws.plugin_data_root(self.plugin);
        let dir = self.ws.plugin_data_path(self.plugin, prefix)?;
        let mut out = Vec::new();
        collect_data_files(&root, &dir, &mut out);
        out.sort_unstable();
        Ok(out)
    }

    fn now_unix_millis(&self) -> u64 {
        crate::time::now_unix_millis()
    }

    fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        // Stesso dispatch di `Workspace::query_index`: i backlink li serve il
        // grafo, il resto i provider registrati. Una view vede esattamente ciò
        // che vedrebbe il kernel, e sotto lo stesso prestito condiviso.
        self.ws.query_index(query)
    }

    fn active_context(&self) -> Option<ViewContext> {
        self.ws.active_context().cloned()
    }

    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        // Il modo è quello dell'host, non della chiamata: vedi `mode`.
        self.ws.invoke_command_nested(command, args, self.mode)
    }
}

/// L'[`HostApi`] del percorso di **lettura** ([`Workspace::render_view`]):
/// presta `&Workspace`, non `&mut`.
///
/// Esiste perché `render_view` deve poter girare sotto prestito condiviso (è
/// il carico che il futuro `RwLock` parallelizza), e un [`KernelHost`] è per
/// costruzione un prestito esclusivo. Le capacità di lettura delegano al
/// workspace come farebbe `KernelHost`; quelle di **scrittura** prendono
/// `&mut self`, che da un `&dyn HostApi` — l'unica forma in cui questo host
/// viene prestato — non è raggiungibile: se un giorno lo diventasse, sarebbe
/// un bug del kernel, e il panic lo direbbe subito.
struct ReadHost<'a> {
    ws: &'a Workspace,
    plugin: &'a str,
}

impl ReadHost<'_> {
    fn read_only(&self) -> ! {
        unreachable!(
            "ReadHost: il percorso di render è in sola lettura (&self); \
             una capacità di scrittura non può arrivare qui"
        )
    }
}

impl HostApi for ReadHost<'_> {
    fn read_document(&self, id: &DocId) -> std::result::Result<String, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws
            .read_source(&id)
            .map_err(|e| PluginError::Internal(e.to_string()))
    }

    fn write_document(
        &mut self,
        _id: &DocId,
        _source: &str,
    ) -> std::result::Result<(), PluginError> {
        self.read_only()
    }

    /// Leggere una revisione è una lettura: una view che prepara una modifica
    /// (calcolare gli edit è la parte lunga) può farlo mentre disegna, e
    /// consegnarla poi da `on_action`, dove l'host sa scrivere.
    fn document_revision(&self, id: &DocId) -> std::result::Result<Revision, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.document_revision(&id).map_err(plugin_error)
    }

    fn apply_edit(
        &mut self,
        _id: &DocId,
        _request: EditRequest,
    ) -> std::result::Result<EditReport, PluginError> {
        self.read_only()
    }

    fn list_documents(&self) -> std::result::Result<Vec<DocId>, PluginError> {
        Ok(self.ws.documents())
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.ws.free_name(id)
    }

    fn create_document(
        &mut self,
        _id: &DocId,
        _source: &str,
    ) -> std::result::Result<(), PluginError> {
        self.read_only()
    }

    fn rename_document(
        &mut self,
        _from: &DocId,
        _to: &DocId,
    ) -> std::result::Result<(), PluginError> {
        self.read_only()
    }

    fn trash_document(&mut self, _id: &DocId) -> std::result::Result<DocId, PluginError> {
        self.read_only()
    }

    /// Elencare il cestino è una lettura: un pannello "cestino" è una view, e
    /// una view disegna dal percorso di render.
    fn list_trash(&self) -> std::result::Result<Vec<TrashEntry>, PluginError> {
        self.ws.list_trash().map_err(plugin_error)
    }

    fn restore_document(
        &mut self,
        _entry: &DocId,
        _to: Option<DocId>,
    ) -> std::result::Result<DocId, PluginError> {
        self.read_only()
    }

    fn empty_trash(&mut self) -> std::result::Result<u64, PluginError> {
        self.read_only()
    }

    fn emit(&mut self, _event: Event) {
        self.read_only()
    }

    fn spawn_job(&mut self, _spec: JobSpec) -> std::result::Result<JobId, PluginError> {
        self.read_only()
    }

    fn data_read(&self, path: &str) -> std::result::Result<Option<Vec<u8>>, PluginError> {
        if path.is_empty() {
            return Err(PluginError::BadArgs("nome del blob vuoto".into()));
        }
        let path = self.ws.plugin_data_path(self.plugin, path)?;
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(PluginError::Internal(format!("{path}: {e}"))),
        }
    }

    fn data_write(&mut self, _path: &str, _bytes: &[u8]) -> std::result::Result<(), PluginError> {
        self.read_only()
    }

    fn data_remove(&mut self, _path: &str) -> std::result::Result<(), PluginError> {
        self.read_only()
    }

    fn data_list(&self, prefix: &str) -> std::result::Result<Vec<String>, PluginError> {
        let root = self.ws.plugin_data_root(self.plugin);
        let dir = self.ws.plugin_data_path(self.plugin, prefix)?;
        let mut out = Vec::new();
        collect_data_files(&root, &dir, &mut out);
        out.sort_unstable();
        Ok(out)
    }

    fn now_unix_millis(&self) -> u64 {
        crate::time::now_unix_millis()
    }

    fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        self.ws.query_index(query)
    }

    fn active_context(&self) -> Option<ViewContext> {
        self.ws.active_context().cloned()
    }

    /// Invocare un comando è, potenzialmente, scrivere: anche una simulazione
    /// chiede al workspace di prestare un host, e da `&Workspace` non si presta
    /// niente. Un `render_view` che volesse *eseguire* qualcosa sta disegnando
    /// nel momento sbagliato.
    fn run_command(
        &mut self,
        _command: &str,
        _args: serde_json::Value,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.read_only()
    }
}

/// L'[`HostApi`] prestato a un comando che **non deve scrivere**: o perché lo
/// si sta simulando ([`InvokeMode::DryRun`]), o perché si è dichiarato di sola
/// lettura ([`CommandScope::writes`](fubmd_abi::command::CommandScope::writes)).
///
/// È un [`ReadHost`] con l'altra risposta alle capacità di scrittura: là il
/// percorso di render non può *raggiungerle* (è prestato come `&dyn HostApi`, e
/// arrivarci sarebbe un bug del kernel, quindi un panic), qui invece un comando
/// ce le ha davanti e può provarci — e provarci non è un bug del kernel, è il
/// caso normale di un comando che ha dichiarato una cosa e ne fa un'altra.
/// La risposta giusta è un errore che dice **perché**, e che chi ha scritto il
/// comando legge nei propri test.
///
/// Senza questa struttura il dry-run sarebbe una convenzione: "per favore non
/// scrivere quando ti chiedo cosa faresti". Le convenzioni le rispettano i
/// comandi che si scrivono in questo repo.
struct ReadOnlyHost<'a> {
    /// Il prestito è **esclusivo** anche qui, benché nessuna scrittura passi:
    /// serve a [`HostApi::run_command`], che deve poter far girare un altro
    /// comando *in simulazione* — e simulare vuol dire chiedere al workspace di
    /// prestare a sua volta un host. Le letture riducono il prestito a un
    /// [`ReadHost`] temporaneo, così le loro implementazioni restano una sola.
    ws: &'a mut Workspace,
    plugin: &'a str,
    /// La ragione del divieto, com'è arrivata all'host: finisce nel messaggio.
    why: &'static str,
}

impl ReadOnlyHost<'_> {
    fn denied<T>(&self, what: &str) -> std::result::Result<T, PluginError> {
        Err(PluginError::PermissionDenied(format!(
            "{what}: {}",
            self.why
        )))
    }

    /// Le capacità di lettura, delegate a [`ReadHost`]: una lettura è una
    /// lettura, e averne due implementazioni sarebbe averne due semantiche.
    fn reading(&self) -> ReadHost<'_> {
        ReadHost {
            ws: self.ws,
            plugin: self.plugin,
        }
    }
}

impl HostApi for ReadOnlyHost<'_> {
    fn read_document(&self, id: &DocId) -> std::result::Result<String, PluginError> {
        self.reading().read_document(id)
    }

    fn write_document(
        &mut self,
        id: &DocId,
        _source: &str,
    ) -> std::result::Result<(), PluginError> {
        self.denied(&format!("scrivere `{id}`"))
    }

    /// Leggere una revisione è una lettura, ed è **la** lettura che serve a un
    /// dry-run: un piano è fatto di [`EditRequest`] con una base, e la base la
    /// dà questa capacità.
    fn document_revision(&self, id: &DocId) -> std::result::Result<Revision, PluginError> {
        self.reading().document_revision(id)
    }

    fn apply_edit(
        &mut self,
        id: &DocId,
        _request: EditRequest,
    ) -> std::result::Result<EditReport, PluginError> {
        self.denied(&format!("modificare `{id}`"))
    }

    fn list_documents(&self) -> std::result::Result<Vec<DocId>, PluginError> {
        self.reading().list_documents()
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.reading().free_name(id)
    }

    // Le operazioni strutturali della decisione 0013 sono negate qui **tutte**, ed è
    // l'unico punto del kernel in cui oggi un permesso di scrittura viene
    // davvero applicato. Il §7.3 non dovrà inventare il varco: dovrà solo
    // decidere una seconda ragione per attraversarlo.

    fn create_document(
        &mut self,
        id: &DocId,
        _source: &str,
    ) -> std::result::Result<(), PluginError> {
        self.denied(&format!("creare `{id}`"))
    }

    fn rename_document(
        &mut self,
        from: &DocId,
        _to: &DocId,
    ) -> std::result::Result<(), PluginError> {
        self.denied(&format!("rinominare `{from}`"))
    }

    fn trash_document(&mut self, id: &DocId) -> std::result::Result<DocId, PluginError> {
        self.denied(&format!("cestinare `{id}`"))
    }

    fn list_trash(&self) -> std::result::Result<Vec<TrashEntry>, PluginError> {
        self.reading().list_trash()
    }

    fn restore_document(
        &mut self,
        entry: &DocId,
        _to: Option<DocId>,
    ) -> std::result::Result<DocId, PluginError> {
        self.denied(&format!("ripristinare `{entry}`"))
    }

    fn empty_trash(&mut self) -> std::result::Result<u64, PluginError> {
        self.denied("svuotare il cestino")
    }

    fn emit(&mut self, _event: Event) {
        // L'unica capacità senza esito: un evento che non si può rifiutare si
        // può solo non emettere. Simulare significa anche non farsi sentire —
        // un `DocumentChanged` finto farebbe ricaricare l'editor su una
        // modifica che non è avvenuta.
    }

    fn spawn_job(&mut self, _spec: JobSpec) -> std::result::Result<JobId, PluginError> {
        // Un job gira fuori dal giro sincrono e il suo esito rientra come
        // evento: lanciarlo durante una simulazione è un effetto che la
        // simulazione non può ritirare.
        self.denied("lanciare un job")
    }

    fn data_read(&self, path: &str) -> std::result::Result<Option<Vec<u8>>, PluginError> {
        self.reading().data_read(path)
    }

    fn data_write(&mut self, path: &str, _bytes: &[u8]) -> std::result::Result<(), PluginError> {
        self.denied(&format!("scrivere il blob `{path}`"))
    }

    fn data_remove(&mut self, path: &str) -> std::result::Result<(), PluginError> {
        self.denied(&format!("cancellare il blob `{path}`"))
    }

    fn data_list(&self, prefix: &str) -> std::result::Result<Vec<String>, PluginError> {
        self.reading().data_list(prefix)
    }

    fn now_unix_millis(&self) -> u64 {
        self.reading().now_unix_millis()
    }

    fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        self.reading().query_index(query)
    }

    fn active_context(&self) -> Option<ViewContext> {
        self.reading().active_context()
    }

    /// Invocare **si può**, ma in simulazione — sempre, qualunque fosse la
    /// ragione del divieto.
    ///
    /// È la scelta che dà un senso al dry-run di una macro: se qui si
    /// rispondesse `permission-denied`, simulare `vault.archive` non
    /// direbbe *niente* di ciò che farebbe, perché tutto ciò che fa è invocare
    /// altri comandi. Forzare il modo invece compone: il piano di una macro è
    /// l'unione dei piani dei suoi passi, e nessuno dei passi ha modo di
    /// scrivere — il comando invocato riceve a sua volta un host come questo.
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.ws
            .invoke_command_nested(command, args, InvokeMode::DryRun)
    }
}

impl KernelHost<'_> {
    /// Path assoluto di un blob: come [`Workspace::plugin_data_path`], ma il
    /// nome vuoto non è la radice — è una richiesta malformata.
    fn data_blob(&self, rel: &str) -> std::result::Result<Utf8PathBuf, PluginError> {
        if rel.is_empty() {
            return Err(PluginError::BadArgs("nome del blob vuoto".into()));
        }
        self.ws.plugin_data_path(self.plugin, rel)
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
            let s = b.span().start;
            s >= start && s < end
        })
        .cloned()
        .collect();
    Some(section)
}

fn extension_of(id: &DocId) -> Option<String> {
    id.as_str()
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
}
