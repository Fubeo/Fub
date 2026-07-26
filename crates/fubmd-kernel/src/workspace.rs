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

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::format::{ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel, Frontmatter, Heading, Link, LinkTarget, Span};
use fubmd_abi::traits::{
    BacklinkRef, EventHandler, HostApi, IndexProvider, IndexQuery, IndexResult, JobId, JobSpec,
    Paged, ViewProvider, ViewSpec,
};
use fubmd_abi::transfer::{
    ExportProvider, ExportReport, ExportRequest, ExportTarget, ImportProvider, ImportReport,
    ImportRequest, ImportSource,
};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_abi::{Event, PluginError};

use crate::bus::EventBus;
use crate::error::{KernelError, Result};
use crate::graph::{normalize, strip_ext, GraphSource, LinkGraph};
use crate::health;
use crate::pathlink;
use crate::properties;
use crate::registry::FormatRegistry;
use crate::tag_counts::TagCounts;
use crate::vault::{TrashEntry, Vault, DATA_DIR};

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

/// Quanto l'host si fida di chi ha prodotto un albero di UI.
///
/// Non è una proprietà dell'albero, è una proprietà di **chi lo manda**: lo
/// stesso `UiNode::Html` è legittimo da una feature ufficiale e inaccettabile da
/// un plugin sandboxato, perché nella webview principale il contenuto attivo ha
/// l'IPC con pieni privilegi — passare da lì aggirerebbe l'intera sandbox. Vedi
/// `docs/architecture/ui-protocol.md`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum Trust {
    /// Core e feature ufficiali: `Html`/`WebView` ammesse.
    Trusted,
    /// Plugin di terzi (a M4 i nativi non-core, a M5 i componenti WASM):
    /// contenuto attivo rifiutato, in qualunque punto dell'albero.
    #[default]
    Untrusted,
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
    /// Eventi in attesa di dispatch verso gli handler.
    pending: VecDeque<Event>,
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
    /// Lo `storage_get/set` dell'`HostApi`: stato **volatile** a chiave→valore
    /// (preferenze, cursori, ciò che si ricostruisce). In memoria non è una
    /// mancanza da colmare — è la sua semantica; ciò che deve durare passa da
    /// `data_*`, che scrive in `.fubmd-data/plugins/<id>/`. Vedi
    /// `docs/architecture/plugin-boundary.md`, "Storage".
    ///
    /// Il namespace per-plugin su questa mappa arriva col registry dei plugin
    /// (M4): oggi gli handler registrati sono tutti codice fidato.
    storage: HashMap<String, serde_json::Value>,
    /// Il documento con il focus della sessione di editing, servito alle view
    /// da [`HostApi::active_document`]. Lo imposta la shell
    /// ([`set_active_document`](Workspace::set_active_document)); il kernel non
    /// lo deriva né lo cambia da sé — "quale nota guarda l'utente" è una
    /// decisione dell'app, e il kernel la custodisce solo perché è il contesto
    /// che una view (anche in WASM) deve poter chiedere.
    active: Option<DocId>,
}

impl Workspace {
    /// Crea un workspace su una radice con un registry di provider già popolato.
    pub fn new(root: impl AsRef<Utf8Path>, registry: FormatRegistry) -> Self {
        Workspace {
            vault: Vault::open(root),
            registry,
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
            pending: VecDeque::new(),
            dispatching: false,
            in_provider_call: false,
            pending_jobs: Vec::new(),
            next_job_id: 0,
            storage: HashMap::new(),
            active: None,
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
            let mut host = KernelHost { ws, plugin };
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
            let mut host = KernelHost { ws, plugin: &id };
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

        self.emit_event(Event::VaultOpened {
            root: self.vault.root().to_string(),
        });
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
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

    /// Riparsa un documento già presente sul disco (usato dal file watcher).
    pub fn refresh_from_disk(&mut self, id: &DocId) -> Result<()> {
        let src = self.vault.read(id)?;
        self.ingest(id, &src)?;
        self.dispatch_pending();
        Ok(())
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
            let existed = self.metas.contains_key(&id);
            self.remove_document(&id);
            Ok(existed)
        }
    }

    /// Rimuove un documento (usato dal file watcher su cancellazione).
    pub fn remove_document(&mut self, id: &DocId) {
        if self.metas.remove(id).is_some() {
            // La nota con il focus non esiste più: `active_document` non deve
            // continuare a nominarla alle view.
            if self.active.as_ref() == Some(id) {
                self.active = None;
            }
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
    pub fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<()> {
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
        for (src, new_source) in plan {
            // write_document riparsa, aggiorna il grafo ed emette gli eventi.
            if let Err(e) = self.write_document(&src, &new_source) {
                falliti.push(format!("{src}: {e}"));
            }
        }
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
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
        // La nota aperta segue il rename anche qui: senza, `active_document`
        // risponderebbe col path vecchio e outline/backlink si svuoterebbero
        // fino al prossimo cambio nota. Va fatto nel kernel, non nella shell:
        // vale anche per i rename non innescati da lei.
        if self.active.as_ref() == Some(from) {
            self.active = Some(to.clone());
        }
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

    /// Per ogni documento che linkava `from` per nome o per path, la nuova
    /// sorgente con i riferimenti riscritti verso `to`. Sostituzione
    /// chirurgica: si tocca solo il testo del riferimento dentro lo `Span` del
    /// link, mai il resto del documento (heading `#...`, blocco `^...`, alias
    /// `|label` e formattazione restano intatti).
    ///
    /// Vale per **entrambe le specie di link**, e la seconda ha un caso in più
    /// della prima. Un wikilink si rompe solo se si sposta il suo bersaglio; un
    /// link markdown è relativo alla cartella di chi lo scrive, quindi si rompe
    /// anche se si sposta la **sorgente**: muovere `a.md` in `sub/` invalida
    /// ogni `[t](altra.md)` che conteneva. Per questo `from` è sempre fra le
    /// sorgenti del piano — i suoi link uscenti vanno ri-basati sulla cartella
    /// nuova — e non solo quando linka se stesso.
    fn link_rewrite_plan(&self, from: &DocId, to: &DocId) -> Vec<(DocId, String)> {
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
            let mut edits: Vec<(Span, String)> = Vec::new();
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
                edits.push((Span::new(start, start + written.len()), replacement));
            }
            if edits.is_empty() {
                continue;
            }
            edits.sort_by_key(|(s, _)| s.start);
            let mut out = String::with_capacity(source_text.len());
            let mut pos = 0;
            for (span, replacement) in edits {
                if span.start < pos {
                    continue; // sovrapposizioni: difensivo, non dovrebbe accadere
                }
                out.push_str(&source_text[pos..span.start]);
                out.push_str(&replacement);
                pos = span.end;
            }
            out.push_str(&source_text[pos..]);
            // La sorgente rinominata vive ormai al path nuovo: la sua
            // riscrittura va applicata lì.
            let dest = if &src == from { to.clone() } else { src };
            plan.push((dest, out));
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

    /// Rende l'anteprima HTML di un documento tramite il suo provider.
    ///
    /// Il corpo non sta in cache (split metadata/body): si rilegge e riparsa
    /// dal disco. Il render è per-documento e on demand — è esattamente il
    /// tipo di lettura che il disco serve bene, mentre la cache calda serve
    /// le mutazioni.
    pub fn render_preview(&self, id: &DocId) -> Result<String> {
        if !self.metas.contains_key(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let source = self.vault.read(id)?;
        let model = self.parse(id, &source)?;
        let provider = self.provider_for(id)?;
        let opts = RenderOptions {
            wikilinks_as_data_attrs: true,
        };
        Ok(provider.render_html(&model, &opts)?)
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
        if !self.metas.contains_key(&id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        // Come `render_preview`: il corpo si riparsa dal disco on demand.
        let source = self.vault.read(&id)?;
        let model = self.parse(&id, &source)?;
        let provider = self.provider_for(&id)?;
        let opts = RenderOptions {
            wikilinks_as_data_attrs: true,
        };
        let html = match heading {
            None => provider.render_html(&model, &opts)?,
            Some(h) => {
                let section = section_of(&model, h)
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

    // --- sessione ----------------------------------------------------------

    /// Imposta (o azzera) il documento con il focus della sessione di editing.
    ///
    /// Lo chiama la shell quando l'utente cambia nota. È l'unico modo di
    /// scrivere `active`: le view lo **leggono** via
    /// [`HostApi::active_document`], nessuno lo scrive dall'interno del
    /// contratto — vedi il campo [`Workspace::active`].
    pub fn set_active_document(&mut self, id: Option<DocId>) {
        self.active = id;
    }

    /// Il documento con il focus della sessione, se impostato.
    pub fn active_document(&self) -> Option<&DocId> {
        self.active.as_ref()
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
                let mut host = KernelHost { ws, plugin: id };
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
    pub fn render_view(&self, view: &str) -> std::result::Result<UiNode, PluginError> {
        let at = self.view_owner(view)?;
        let (id, trust, provider) = &self.views[at];
        let host = ReadHost {
            ws: self,
            plugin: id,
        };
        let tree = provider.render_view(view, &host)?;
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
        view: &str,
        action: UiAction,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let at = self.view_owner(view)?;
        let mut views = std::mem::take(&mut self.views);
        // Il flag rimanda il dispatch: se il provider scrive via `HostApi`
        // dentro `on_action`, gli handler NON girano nel suo frame — girano
        // nel `dispatch_pending` qui sotto, a chiamata tornata. Senza, un
        // plugin che è sia view sia handler (il caso versioning) sarebbe
        // rientrato nella propria istanza: in nativo funziona, a M5 trappa.
        let (updated, trust) = self.with_provider_call(|ws| {
            let (id, trust, provider) = &mut views[at];
            let mut host = KernelHost { ws, plugin: id };
            (provider.on_action(view, action, &mut host), *trust)
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
    /// §1.12 (il lotto), non una scelta di qui.
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
            let mut host = KernelHost { ws, plugin: id };
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
        //
        // `in_provider_call` è l'altra metà della stessa regola: un provider
        // che scrive durante `on_action`/`handle`/`flush` accoda, e la coda si
        // drena quando la SUA chiamata è tornata — mai dentro il suo frame
        // (a M5 il component model vieta la rientranza di un'istanza; la
        // semantica di consegna non può cambiare al freeze).
        if self.dispatching || self.in_provider_call {
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
    fn deliver_to_handlers(&mut self, event: &Event) {
        let mut handlers = std::mem::take(&mut self.handlers);
        self.with_provider_call(|ws| {
            for (id, handler) in handlers.iter_mut() {
                if !handler.subscribed().contains(event.kind()) {
                    continue;
                }
                let mut host = KernelHost { ws, plugin: id };
                // L'errore di un handler non deve far fallire l'operazione
                // che ha emesso l'evento: si ignora (M4: log/notifica).
                let _ = handler.handle(event, &mut host);
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

/// La validazione del confine di fiducia della UI, in un posto solo.
///
/// Da un provider fidato passa tutto; da uno non fidato l'albero deve essere
/// interamente dichiarativo. La funzione è banale **di proposito**: il valore non
/// è nell'algoritmo (sta in [`UiNode::validate_untrusted`]), è nel fatto che
/// esista un unico varco attraverso cui gli alberi entrano.
fn guard_ui(trust: Trust, tree: &UiNode) -> std::result::Result<(), PluginError> {
    match trust {
        Trust::Trusted => Ok(()),
        Trust::Untrusted => tree.validate_untrusted(),
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
        // al §1.7 l'unico input esterno che diventava un `DocId` arrivava dai
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

    fn list_documents(&self) -> std::result::Result<Vec<DocId>, PluginError> {
        Ok(self.ws.documents())
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.ws.free_name(id)
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
        self.ws.storage.get(&self.storage_key(key)).cloned()
    }

    fn storage_set(&mut self, key: &str, value: serde_json::Value) {
        let key = self.storage_key(key);
        self.ws.storage.insert(key, value);
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

    fn active_document(&self) -> Option<DocId> {
        self.ws.active_document().cloned()
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

    fn list_documents(&self) -> std::result::Result<Vec<DocId>, PluginError> {
        Ok(self.ws.documents())
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.ws.free_name(id)
    }

    fn emit(&mut self, _event: Event) {
        self.read_only()
    }

    fn spawn_job(&mut self, _spec: JobSpec) -> std::result::Result<JobId, PluginError> {
        self.read_only()
    }

    fn storage_get(&self, key: &str) -> Option<serde_json::Value> {
        self.ws
            .storage
            .get(&format!("{}/{key}", self.plugin))
            .cloned()
    }

    fn storage_set(&mut self, _key: &str, _value: serde_json::Value) {
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

    fn active_document(&self) -> Option<DocId> {
        self.ws.active_document().cloned()
    }
}

impl KernelHost<'_> {
    /// La chiave davvero usata da `storage_get/set`: prefissata dall'id del
    /// plugin, così due feature che scelgono lo stesso nome generico
    /// ("cursor", "config") non si pestano. `data_*` ha il recinto in firma;
    /// qui il recinto sta nell'implementazione. Il separatore `/` non è
    /// ambiguo: gli id di plugin sono nomi semplici, senza separatori.
    fn storage_key(&self, key: &str) -> String {
        format!("{}/{key}", self.plugin)
    }

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
