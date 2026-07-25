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

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::format::{ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel, LinkTarget, Span};
use fubmd_abi::traits::{
    BacklinkRef, EventHandler, HostApi, IndexProvider, IndexQuery, IndexResult, JobId, JobSpec,
    TagCount, ViewProvider, ViewSpec,
};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_abi::{Event, PluginError};

use crate::bus::EventBus;
use crate::error::{KernelError, Result};
use crate::graph::{normalize, strip_ext, LinkGraph};
use crate::registry::FormatRegistry;
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

pub struct Workspace {
    vault: Vault,
    registry: FormatRegistry,
    models: HashMap<DocId, DocumentModel>,
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
    /// View dichiarative registrate, col grado di fiducia di chi le produce.
    /// Ogni albero di UI che entra nell'host passa da qui: è il punto unico in
    /// cui [`UiNode::validate_untrusted`] viene applicato.
    views: Vec<(String, Trust, Box<dyn ViewProvider>)>,
    /// Eventi in attesa di dispatch verso gli handler.
    pending: VecDeque<Event>,
    /// Guardia anti-rientranza: `dispatch_pending` non si annida mai.
    dispatching: bool,
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
            models: HashMap::new(),
            graph: LinkGraph::default(),
            graph_update: GraphUpdate::default(),
            bus: EventBus::new(),
            handlers: Vec::new(),
            indexes: Vec::new(),
            views: Vec::new(),
            pending: VecDeque::new(),
            dispatching: false,
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
        let mut host = KernelHost { ws: self, plugin };
        f(&mut host)
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
        // qui non alias niente.
        let activated = {
            let mut host = KernelHost {
                ws: self,
                plugin: &id,
            };
            index.activate(&mut host)
        };
        self.indexes.push((id, index));
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

        for (_, index) in self.indexes.iter_mut() {
            for model in self.models.values() {
                index.on_document_indexed(model);
            }
        }
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
        let mut ids: Vec<DocId> = self.models.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn model(&self, id: &DocId) -> Option<&DocumentModel> {
        self.models.get(id)
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
        for (_, index) in self.indexes.iter_mut() {
            index.on_document_indexed(model);
        }
        self.emit_event(Event::DocumentChanged { id: id.clone() });
        self.emit_event(Event::IndexUpdated);
        Ok(())
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
        self.models.contains_key(id) || self.vault.exists(id)
    }

    /// Il [`DocId`] di una nota che nasce col nome dato: separatori normalizzati
    /// e, se il nome non porta già un'estensione gestita, quella di default.
    fn new_note_id(&self, name: &str) -> Result<DocId> {
        let normalizzato = name.replace('\\', "/");
        let pulito = normalizzato.trim().trim_start_matches('/').trim_end();
        if pulito.is_empty() || pulito.split('/').any(|c| c == ".." || c.is_empty()) {
            return Err(KernelError::BadName(name.to_string()));
        }
        let id = DocId::new(pulito);
        let ha_estensione =
            extension_of(&id).is_some_and(|ext| self.registry.provider_for_ext(&ext).is_some());
        if ha_estensione {
            return Ok(id);
        }
        let ext = self
            .registry
            .default_extension()
            .ok_or(KernelError::NoDefaultFormat)?;
        Ok(DocId::new(format!("{pulito}.{ext}")))
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
        if !self.models.contains_key(id) {
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
        let target = to.unwrap_or(entry.original);
        if self.models.contains_key(&target) || self.vault.exists(&target) {
            return Err(KernelError::AlreadyExists(target.to_string()));
        }
        let ext = extension_of(&target).unwrap_or_default();
        if self.registry.provider_for_ext(&ext).is_none() {
            return Err(KernelError::NoProvider(ext));
        }

        let source = self.vault.read(trash_id)?;
        self.write_document(&target, &source)?;
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
        for (_, index) in self.indexes.iter_mut() {
            index.on_document_removed(from);
        }
        let model = &self.models[to];
        for (_, index) in self.indexes.iter_mut() {
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
        // Query servite dal kernel, non dai provider: hanno già una fonte di
        // verità qui. I backlink stanno nel grafo (conosce le regole di
        // risoluzione e le ambiguità del vault); l'outline sta nel modello
        // parsato che il kernel tiene — è il modo con cui una view legge la
        // struttura di un documento senza avere un `FormatProvider`.
        match &query {
            IndexQuery::Backlinks { target } => {
                return Ok(IndexResult::Backlinks(self.graph.backlinks(target)));
            }
            IndexQuery::Outline { doc } => {
                let outline = self
                    .models
                    .get(doc)
                    .map(|m| m.outline.clone())
                    .unwrap_or_default();
                return Ok(IndexResult::Outline(outline));
            }
            IndexQuery::Tags => {
                return Ok(IndexResult::Tags(self.aggregate_tags()));
            }
            _ => {}
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

    /// I tag del vault con quante **note** li portano (non quante occorrenze:
    /// un tag ripetuto nella stessa nota conta una volta). Ordinati per nome.
    fn aggregate_tags(&self) -> Vec<TagCount> {
        let mut counts: std::collections::BTreeMap<&str, u32> = std::collections::BTreeMap::new();
        for model in self.models.values() {
            let mut seen = std::collections::BTreeSet::new();
            for tag in &model.tags {
                if seen.insert(tag.name.as_str()) {
                    *counts.entry(tag.name.as_str()).or_default() += 1;
                }
            }
        }
        counts
            .into_iter()
            .map(|(name, count)| TagCount {
                name: name.to_string(),
                count,
            })
            .collect()
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
        for (id, index) in indexes.iter_mut() {
            let mut host = KernelHost {
                ws: self,
                plugin: id,
            };
            if let Err(e) = index.flush(&mut host) {
                errors.push(e);
            }
        }
        // Indici registrati *durante* il flush si accodano in fondo (simmetria
        // con `deliver_to_handlers`: nessun percorso può perdere una
        // registrazione solo perché è arrivata nel momento sbagliato).
        let registered_meanwhile = std::mem::take(&mut self.indexes);
        self.indexes = indexes;
        self.indexes.extend(registered_meanwhile);
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
    pub fn render_view(&mut self, view: &str) -> std::result::Result<UiNode, PluginError> {
        let at = self.view_owner(view)?;
        // I provider escono dal workspace per la durata della chiamata, così
        // `KernelHost` può prestare `&mut Workspace` senza aliasing (stessa
        // manovra del dispatch degli eventi).
        let mut views = std::mem::take(&mut self.views);
        let (rendered, trust) = {
            let (id, trust, provider) = &mut views[at];
            let host = KernelHost {
                ws: self,
                plugin: id,
            };
            (provider.render_view(view, &host), *trust)
        };
        self.restore_views(views);
        let tree = rendered?;
        guard_ui(trust, &tree)?;
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
        let (updated, trust) = {
            let (id, trust, provider) = &mut views[at];
            let mut host = KernelHost {
                ws: self,
                plugin: id,
            };
            (provider.on_action(view, action, &mut host), *trust)
        };
        self.restore_views(views);
        let update = updated?;
        if let ViewUpdate::Replace { root } = &update {
            guard_ui(trust, root)?;
        }
        // Un handler può aver emesso eventi scrivendo durante `on_action`.
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
        for (id, handler) in handlers.iter_mut() {
            if !handler.subscribed().contains(event.kind()) {
                continue;
            }
            let mut host = KernelHost {
                ws: self,
                plugin: id,
            };
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
        self.ws
            .read_source(id)
            .map_err(|e| PluginError::Internal(e.to_string()))
    }

    fn write_document(&mut self, id: &DocId, source: &str) -> std::result::Result<(), PluginError> {
        self.ws
            .write_document(id, source)
            .map_err(|e| PluginError::Internal(e.to_string()))
    }

    fn list_documents(&self) -> std::result::Result<Vec<DocId>, PluginError> {
        Ok(self.ws.documents())
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
