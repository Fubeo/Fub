//! Il `Workspace`: l'orchestratore del core. Tiene insieme vault, registry dei
//! formati, cache dei modelli parsati, grafo dei link, event bus e handler di
//! eventi. È l'API principale che l'app Tauri consuma. Resta agnostico: parla
//! solo tramite `dyn FormatProvider` / `dyn EventHandler` e i tipi di
//! `fub-abi`.
//!
//! # Dispatch degli eventi: a coda, mai ricorsivo
//!
//! Gli [`EventHandler`] registrati sono chiamati **sincronamente ma a coda**:
//! ogni operazione pubblica che muta il workspace accoda i propri eventi e li
//! drena alla fine (`Workspace::dispatch_pending`, interno). Un handler che durante
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
//! Il lavoro **lungo** (rete, calcolo pesante, il vault camminato per intero)
//! non passa dagli handler: un provider lo chiede via
//! [`HostEvents::spawn_job`](fub_abi::traits::HostEvents::spawn_job),
//! l'host lo esegue fuori dal lock ([`Workspace::take_pending_jobs`]) e l'esito
//! rientra come [`Event::JobDone`] ([`Workspace::complete_job`]). Le capacità
//! lì dentro ci sono (decisione 0027), e il prestito del workspace se lo prende
//! una chiamata alla volta.
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

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandSpec, Failure, InvokeMode, Partial, UndoStep, Undone,
};
use fub_abi::custom::{CustomRenderer, SyntaxForm, SyntaxRule};
use fub_abi::edit::{EditReport, EditRequest, Revision, TextEdit, WriteBase};
use fub_abi::event::DocChanges;
use fub_abi::format::{DocumentFormat, DocumentSource, RenderOptions};
use fub_abi::locale::Locale;
use fub_abi::model::{canonical_anchor, heading_matches, DocId, DocumentModel, LinkTarget, Span};
use fub_abi::session::ViewContext;
use fub_abi::settings::{
    SettingEntry, SettingKind, SettingScope, SettingSource, SettingSpec, SettingValue,
};
use fub_abi::text::{Localize, Strings, Text};
use fub_abi::traits::{
    BacklinkRef, CivilTime, CommandProvider, DocPosition, DocumentMatch, EntryKind, EventHandler,
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, IndexingState, JobId, JobProgress,
    JobSpec, LinkDirection, Page, Paged, PluginManifest, QueryRoute, ReadApi, ServiceProvider,
    TimerSpec, VaultEntry, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
};
use fub_abi::transfer::{
    ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportTarget, ImportProvider,
    ImportReport, ImportRequest, ImportSource, SourceContent, SourceHandle, StreamedSource,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::{Actor, Event, Notice, PluginError, Severity};
use serde::{Deserialize, Serialize};

use fub_abi::render::EmbedContent;
use fub_abi::rules::media;
use fub_abi::rules::path as rules_path;
use fub_abi::rules::path::{resolution_key, strip_ext};
use fub_abi::rules::path_policy::{self, Naming};

use crate::bus::EventBus;
use crate::dispatcher::{Dispatcher, JobBell, PendingJob};
use crate::documents::{extension_of, DocumentStore, PreparedParse};
use crate::drafts::Drafts;
use crate::entries::{EntryStore, StoredEntry, StoredMeta};
use crate::error::{KernelError, Result};
use crate::graph::{BuiltGraph, GraphSources};
use crate::host::{Granted, Guard, KernelHost, ReadHost, ReadOnly};
use crate::index::plan::QueryPlan;
use crate::index::{
    feed_handles as feed_index_handles, reconcile_handles as reconcile_index_handles,
    up_to_date_handles as up_to_date_index_handles, Indexes, SharedIndexProvider,
};
use crate::journal::{Journal, JournalOp, JournalRead};
use crate::locale::SystemLocale;
use crate::occurrences;
use crate::organization::OrganizationStore;
use crate::plugins::{self, PluginInfo, RegistrationKind, RegistryError};
use crate::poison::{SharedShelter, Shelter};
use crate::providers::{ProviderRegistry, ProviderTable, RegisteredCommand, RegisteredView};
use crate::registry::FormatRegistry;
use crate::renderer::{self, RenderedDocument};
use crate::safety::Gate;
use crate::session::{ContextChange, Session};
use crate::settings::{MachineSettings, SettingsStore, SharedSettings};
use crate::transfer::{MemorySink, OpenSources, SourceBacking, PROLOGUE};
use crate::undo::UndoStack;
use crate::vault::TrashEntry;
use crate::viewstate::ViewStates;

/// Il pannello di una shell che ne ha uno solo.
///
/// Sta qui, e non in ogni chiamante, perché kernel, app e test devono nominare
/// lo **stesso** pannello: un contesto pubblicato con un `PaneId` diverso da
/// quello di prima è, da contratto, un cambio di pannello — cioè un ridisegno
/// di tutto ciò che segue il contesto.
pub const MAIN_PANE: &str = "main";

/// Un documento che l'apertura **non ha potuto guardare**, e perché (§15.7).
///
/// Il file c'è: è la scansione ad averlo trovato, e la sua voce resta
/// nell'anagrafe con dimensione e data. Ciò che manca è il suo *contenuto* —
/// non si è letto, o si è letto e nessun parser lo ha accettato — quindi il
/// documento non è arrivato a nessun indice: non lo trova la ricerca, non ha
/// archi nel grafo, non ha proprietà.
///
/// Non è un [`IndexLoss`](fub_abi::traits::IndexLoss), e i due non si fondono:
/// là un **derivato** non ha preso un documento che il kernel aveva in mano —
/// il vault sa ancora tutto e ricostruire è gratis — qui il kernel non ce l'ha
/// affatto. È la stessa distinzione con cui la
/// [decisione 0052](../../../docs/decisions/0184-eventi-accodati-e-job.md)
/// sceglie la severità, ed è la ragione per cui uno esce come
/// [`Severity::Warning`] e l'altro come [`Severity::Failure`].
#[derive(Clone, Debug)]
pub struct Rejected {
    /// Quale documento.
    pub id: DocId,
    /// Cosa ha risposto il disco, o il parser.
    pub why: PluginError,
}

/// L'esito di un'apertura: cosa **non** ha letto (§15.7).
///
/// È la forma della [`JournalRead`](crate::journal::JournalRead) del registro
/// ([decisione 0067](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md))
/// applicata un piano più in su, e per lo stesso principio: un esito che porta
/// ciò che ha scartato invece di un `Result` che si rifiuta. Là il conto
/// bastava perché una riga di journal rotta non ha un nome; qui ciò che si
/// scarta ha un [`DocId`], e il §15.7 chiede di aprire *segnalando cosa* non si
/// è letto — quindi la stessa forma porta i nomi invece del numero.
///
/// Vuota vuol dire che il vault si è aperto intero, ed è il caso normale.
#[derive(Clone, Debug, Default)]
pub struct Opening {
    /// I documenti rimasti fuori, in ordine di scansione.
    pub discarded: Vec<Rejected>,
    /// L'indicizzazione ha smesso prima della fine (§15.7).
    ///
    /// Non è uno scarto in grande: uno scarto dice *questo documento non si è
    /// letto* e il vault sa di averlo saltato, questo dice *non si è finito di
    /// guardare*, e ciò che resta indietro non ha un nome. È la ragione per cui
    /// chi si è interrotto non riconcilia — vedi
    /// [`Workspace::finish_index`](crate::Workspace::finish_index).
    pub interrupted: bool,
    /// Gli stessi id, per cercarli senza scorrere la lista.
    ///
    /// Il caso normale è zero scarti, dove non servirebbe; serve nel caso che
    /// questa voce esiste per reggere — una cartella di file binari con
    /// l'estensione sbagliata — dove cercare in una lista dentro il giro su
    /// tutti i documenti sarebbe quadratico proprio dove il vault è peggio.
    index: BTreeSet<DocId>,
}

impl Opening {
    /// Il vault si è aperto per intero: niente da segnalare.
    pub fn whole(&self) -> bool {
        self.discarded.is_empty() && !self.interrupted
    }

    fn discards(&mut self, id: DocId, why: impl Into<PluginError>) {
        self.index.insert(id.clone());
        self.discarded.push(Rejected {
            id,
            why: why.into(),
        });
    }
}

/// **La seconda fase dell'apertura, mentre è in corso** (§15.7): cosa resta da
/// indicizzare, e cosa si è raccolto finora.
///
/// La consegna [`scan_vault`](crate::Workspace::scan_vault), la porta avanti
/// [`plan_batch`](crate::Workspace::plan_batch) +
/// [`index_batch_prepared`](crate::Workspace::index_batch_prepared) una fetta
/// alla volta, la
/// chiude [`finish_index`](crate::Workspace::finish_index). Vive **fuori** dal
/// `Workspace` e non dentro, ed è la scelta che rende l'apertura interrompibile
/// senza aggiungere uno stato al kernel: chi la tiene in mano è chi ha i thread
/// (il `JobRunner`, decisione 0032), e fra una fetta e l'altra il workspace non
/// è prestato a nessuno — il che è precisamente ciò che questa voce chiedeva,
/// perché `reindex` teneva il workspace in esclusiva ~780 ms su 2000 note.
///
/// Un'indicizzazione **abbandonata** non lascia niente da ripulire: il vault
/// resta con gli indici che ha, e ciò che manca lo dice
/// [`Opening::interrupted`].
pub struct Indexing {
    /// I documenti da esaminare, in ordine di scansione.
    from_do: Vec<VaultEntry>,
    /// Quanti se ne sono già presi in carico. Non è «quanti sono riusciti»:
    /// uno scarto è fatto quanto un documento indicizzato — è stato guardato.
    cursor: usize,
    opening: Opening,
}

impl Indexing {
    fn new(from_do: Vec<VaultEntry>) -> Self {
        Indexing {
            from_do,
            cursor: 0,
            opening: Opening::default(),
        }
    }

    /// Quanti documenti in tutto. Il kernel lo sa dalla scansione, ed è la
    /// ragione per cui il progresso di questa fase ha un `total` invece di
    /// essere indeterminato.
    pub fn total(&self) -> u64 {
        self.from_do.len() as u64
    }

    /// Quanti ne sono stati guardati.
    pub fn done(&self) -> u64 {
        self.cursor as u64
    }

    /// Non c'è più niente da guardare.
    pub fn finished(&self) -> bool {
        self.cursor >= self.from_do.len()
    }

    /// Il documento da cui riparte la prossima fetta, per chi compone
    /// l'etichetta di un progresso.
    pub fn next(&self) -> Option<&DocId> {
        self.from_do.get(self.cursor).map(|entry| &entry.id)
    }

    /// Ciò che di quest'apertura si sa finora: gli scarti raccolti fin qui.
    /// Un documento **già letto e già parsato**, che aspetta di entrare nel
    pub fn opening(&self) -> &Opening {
        &self.opening
    }

    fn next_slice(&mut self) -> Vec<VaultEntry> {
        let end = (self.cursor + FEED_BATCH).min(self.from_do.len());
        let slice = self.from_do[self.cursor..end].to_vec();
        self.cursor = end;
        slice
    }
}

/// workspace.
///
/// È il valore che permette a una sincronizzazione da fuori di stare nella
/// forma della [decisione 0024](../../../docs/decisions/README.md):
/// leggere e parsare sotto prestito condiviso
/// ([`Workspace::plan_sync`]), mutare sotto quello esclusivo
/// ([`Workspace::sync_path_prepared`]).
///
/// I campi sono chiusi apposta: fuori dal kernel non c'è niente da guardarci
/// dentro, e ciò che si può fare con questo valore è **darlo a chi lo applica**.
/// È anche ciò che lo rende un presidio invece di una comodità — chi tiene un
/// `ParsedChange` in mano ha per forza già rilasciato il prestito condiviso,
/// perché il tipo non ne porta con sé nessun pezzo.
/// `None` quando il file letto porta **l'impronta che l'anagrafe ha già**:
pub struct ParsedChange {
    id: DocId,
    /// è la scrittura del kernel che rientra dal rilevatore, e non c'è niente
    /// da parsare né da ingerire (difetto 0196, vedi
    /// [`Workspace::already_ingested`]).
    /// L'impronta del sorgente che è stato letto: è quella che finirà in
    model: Option<DocumentModel>,
    /// anagrafe.
    /// L'impronta che l'anagrafe aveva **al momento del piano**. Vedi
    fingerprint: Revision,
    /// [`Workspace::sync_path_prepared`].
    /// **Una fetta dell'apertura già letta e già parsata**, che aspetta di entrare
    seen: Option<Revision>,
}

/// nel workspace.
///
/// È il [`ParsedChange`] di un lotto invece che di un file, e il nome dice la
/// parentela apposta: la forma è la stessa della
/// [decisione 0119](../../../docs/decisions/README.md)
/// — leggere e parsare sotto prestito condiviso
/// ([`Workspace::plan_batch`]), mutare sotto quello esclusivo
/// ([`Workspace::index_batch_prepared`]) — su un percorso dove i file non sono
/// quattro ma quattromila.
///
/// I campi sono chiusi per la stessa ragione: chi ne tiene uno in mano ha per
/// forza già rilasciato il prestito condiviso, perché il tipo non ne porta con
/// sé nessun pezzo.
/// Le voci della fetta, con l'impronta che la lettura ha imparato.
#[derive(Default)]
pub struct ParsedBatch {
    /// Ciò che si è ripreso dalla cache invece di riparsarlo.
    read: Vec<VaultEntry>,
    /// Ciò che si è letto e parsato.
    reused: Vec<(DocId, StoredMeta)>,
    /// **L'impronta che l'anagrafe attribuiva a ogni voce quando il piano è
    models: Vec<DocumentModel>,
    /// stato fatto.** Vedi [`Workspace::index_batch_prepared`].
    ///
    /// È per documento e non per fetta: fra il piano e l'applicazione l'utente
    /// salva *una* nota, e buttare le altre novecentonovantanove vorrebbe dire
    /// rileggerle dal disco per niente.
    /// Il risultato di un pezzo di fetta lavorato da un thread: gli stessi campi
    seen: BTreeMap<DocId, Option<Revision>>,
}

/// di [`ParsedBatch`], ma senza `seen` (che si calcola una volta per tutta la
/// fetta). Si fondono in [`Workspace::plan_batch`].
/// Come il `Workspace` tiene aggiornato il grafo dopo una modifica.
struct PendingIndexEntry {
    entry: VaultEntry,
    source: Option<DocumentSource>,
}

#[derive(Default)]
struct IndexCheckChunk {
    entries: Vec<PendingIndexEntry>,
    discarded: Vec<(DocId, KernelError)>,
}

struct PendingDocumentParse {
    id: DocId,
    parser: PreparedParse,
    source: DocumentSource,
}

#[derive(Default)]
struct IndexParseChunk {
    models: Vec<DocumentModel>,
    discarded: Vec<(DocId, KernelError)>,
}

///
/// L'incrementale è il percorso normale; il rebuild completo resta disponibile
/// come rete di sicurezza (e come oracolo nei test) finché non ci fidiamo
/// ciecamente dell'invalidazione — vedi `../../../docs/project/status.md`.
/// Quanto l'host si fida di chi ha prodotto un albero di UI — o un blocco
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum GraphUpdate {
    #[default]
    Incremental,
    FullRebuild,
}

/// custom, che dal punto di vista del confine è la stessa cosa.
///
/// Non è una proprietà dell'albero, è una proprietà di **chi lo manda**: lo
/// stesso `UiNode::Html` è legittimo da una feature ufficiale e inaccettabile da
/// un plugin sandboxato, perché nella webview principale il contenuto attivo ha
/// l'IPC con pieni privilegi — passare da lì aggirerebbe l'intera sandbox. Vedi
/// `../../../docs/architecture/frontend-and-ipc.md`.
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
/// Core e feature ufficiali: `Html`/`WebView` ammesse.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Trust {
    /// Firmato da una catena che l'host riconosce (20.2). Non è codice del
    Core,
    /// core: contenuto attivo rifiutato lo stesso.
    /// Pubblicato ma non verificato. È il default, ed è deliberato che il grado
    Verified,
    /// più restrittivo fra quelli che *girano* sia ciò che si ottiene
    /// dimenticandosi di dichiararlo.
    /// Locale, in sviluppo (20.3). Gira, e l'host lo sa: è il grado che una UI
    #[default]
    Community,
    /// deve poter mostrare diversamente dagli altri, non un sinonimo di
    /// community.
    /// Revocato: **non gira affatto**. Non è un grado di fiducia più basso, è
    Development,
    /// l'assenza del permesso di essere eseguito.
    /// Può emettere contenuto attivo (`Html`, `WebView`)? Solo il core.
    Revoked,
}

impl Trust {
    ///
    /// La regola non si allarga con i gradi nuovi, ed è il punto: `Verified`
    /// dice che *si sa chi è*, non che il suo `<script>` sia benvenuto nella
    /// webview che ha l'IPC. Quel varco si apre con l'asset story e la CSP di
    /// M5, non con una firma.
    /// Gira? Tutto tranne il revocato.
    pub fn allows_active_content(self) -> bool {
        self == Trust::Core
    }

    /// Nome di una nota nuova a cui nessuno ne ha dato uno (D3). L'utente la
    pub fn runs(self) -> bool {
        self != Trust::Revoked
    }
}

/// rinomina subito: è il motivo per cui non vale la pena essere più creativi.
/// **Quanti documenti alla volta si alimenta un indice** (§20.1, decisione
const UNTITLED: &str = "Senza titolo";

/// 0051).
///
/// La firma dell'alimentazione è a lotti, e a tagliarli è il kernel: è l'unico
/// a sapere quanti modelli ha in mano, ed è l'unico punto in cui il numero
/// esiste. Sta qui e non nel contratto per la stessa ragione per cui il tetto
/// della coda eventi sta con chi ritira (decisione 0034): è una politica
/// dell'host, e un guest che la leggesse dalla firma comincerebbe a dipenderne.
///
/// Il valore è un compromesso su un solo asse, e nessuno dei due estremi è
/// gratis: una fetta grande risparmia attraversamenti e a M5 costringe a
/// serializzare un buffer prima che l'indice ne veda una riga; una piccola
/// riporta all'aritmetica che questa voce esiste per togliere. Cinquecentododici
/// è la misura di un lotto che sta comodamente in memoria e riduce di tre ordini
/// di grandezza gli attraversamenti di un `reindex` da 100k note.
///
/// Non è un'impostazione, e per adesso è giusto così: diventerà una il giorno
/// che il confine costerà davvero, cioè quando ci sarà un guest da misurare
/// (M5). Fissarne una adesso vorrebbe dire chiedere a un utente un numero che
/// nessuno sa ancora se conta.
/// Il nome dell'entry point della seconda fase dell'apertura (§15.7), con cui
const FEED_BATCH: usize = 512;

/// compare nel centro attività e in
/// [`IndexQuery::Jobs`](fub_abi::traits::IndexQuery::Jobs).
///
/// Ha la forma di un `JobSpec::job` qualunque perché **è** un job qualunque per
/// chi lo guarda: chi disegna una riga di lavoro in corso non deve avere un
/// ramo per l'apertura.
/// Un gancio **prima della scrittura**: ciò che una feature vuole fare con
pub const INDEX_JOB: &str = "vault.index";

/// l'originale un istante prima che venga sovrascritto (0154).
///
/// È generico — un id di plugin e una chiusura — perché il kernel non sa cosa
/// sia una fotografia: sa solo che c'è un momento, fra il parse e il disco, in
/// cui il contenuto che sta per sparire è ancora leggibile, e che qualcuno può
/// volerlo guardare. `None` è il default e non è un difetto: la maggior parte
/// dei montaggi non registra niente.
/// *Il disco, e come ciò che ci sta sopra diventa un modello* (§8.1): il
pub type BeforeWriteHook =
    Arc<dyn Fn(&mut dyn HostApi, &DocId) -> std::result::Result<(), PluginError> + Send + Sync>;

/// Una chiamata a `CommandProvider` preparata sotto lock e invocabile fuori.
///
/// Contiene anche il frame da ripristinare al rientro: attore, batch, pila e
/// flag di provider restano una singola transazione logica anche se il `RwLock`
/// non attraversa codice esterno.
pub struct PreparedCommand {
    owner: String,
    command: String,
    args: Option<serde_json::Value>,
    mode: InvokeMode,
    provider: Arc<dyn CommandProvider>,
    read_only_reason: Option<&'static str>,
    previous_actor: Option<Actor>,
    owns_batch: bool,
    previous_provider_call: bool,
}

impl PreparedCommand {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    /// Modalità che il proxy deve usare per le capacità annidate.
    pub fn host_mode(&self) -> InvokeMode {
        if self.read_only_reason.is_some() {
            InvokeMode::DryRun
        } else {
            self.mode
        }
    }

    /// Il recinto addizionale da mettere davanti al proxy, se serve.
    pub fn read_only_reason(&self) -> Option<&'static str> {
        self.read_only_reason
    }

    /// Esegue **soltanto** il codice del provider. Nessun `Workspace` è
    /// necessario qui: chi chiama deve aver già rilasciato la sua guardia.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let args = self.args.take().ok_or_else(|| {
            PluginError::Internal("una chiamata preparata è stata invocata due volte".into())
        })?;
        crate::safety::calling(&self.owner, Gate::Command, &self.command, || {
            self.provider.invoke(&self.command, args, self.mode, host)
        })
    }
}

/// Una chiamata a [`ServiceProvider`] preparata sotto lock e invocabile
/// senza tenere `Custody<Workspace>`.
pub struct PreparedService {
    owner: String,
    service: String,
    method: String,
    args: Option<serde_json::Value>,
    provider: Arc<dyn ServiceProvider>,
    previous_provider_call: bool,
}

impl PreparedService {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    /// Esegue soltanto il codice esterno. Stack e flag sono già stati impostati
    /// da `prepare_service_call` e verranno chiusi da `finish_service_call`.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        let args = self.args.take().ok_or_else(|| {
            PluginError::Internal(
                "una chiamata di servizio preparata è stata invocata due volte".into(),
            )
        })?;
        crate::safety::calling(
            &self.owner,
            Gate::Service,
            &format!("{}.{}", self.service, self.method),
            || self.provider.call(&self.service, &self.method, args, host),
        )
    }
}

/// Un render di [`ViewProvider`] risolto sotto lock e invocabile senza tenere
/// `Custody<Workspace>`. Il provider resta registrato tramite un `Arc`; il lock
/// qui è del solo provider, non del workspace, e consente render concorrenti.
pub struct PreparedViewRender {
    owner: String,
    view: String,
    instance: ViewInstance,
    trust: Trust,
    provider: Arc<SharedShelter<Box<dyn ViewProvider>>>,
}

impl PreparedViewRender {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn instance_id(&self) -> &str {
        &self.instance.instance
    }

    /// Esegue soltanto il codice esterno del provider. Le letture richieste dal
    /// provider passano dal proxy host e prendono il workspace per capacità.
    pub fn invoke(&self, host: &dyn ReadApi) -> std::result::Result<UiNode, PluginError> {
        let provider = self.provider.read();
        crate::safety::calling(&self.owner, Gate::ViewRender, &self.view, || {
            provider.render_view(&self.instance, host)
        })
    }
}

/// Un'azione di [`ViewProvider`] risolta sotto lock e invocabile senza tenere
/// `Custody<Workspace>`. Il frame di provider resta logicamente aperto fino al
/// finalize, mentre l'esclusione sulla mutabilità riguarda il solo provider.
pub struct PreparedViewAction {
    owner: String,
    view: String,
    instance: ViewInstance,
    action: Option<UiAction>,
    trust: Trust,
    provider: Arc<SharedShelter<Box<dyn ViewProvider>>>,
    previous_provider_call: bool,
}

impl PreparedViewAction {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn instance_id(&self) -> &str {
        &self.instance.instance
    }

    /// Esegue soltanto il codice esterno. Il provider ha il proprio lock; il
    /// workspace viene ripreso dal proxy soltanto per la singola capacità che
    /// la callback usa.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let action = self
            .action
            .take()
            .expect("a prepared view action is invoked exactly once");
        let mut provider = self.provider.write();
        crate::safety::calling(&self.owner, Gate::ViewAction, &self.view, || {
            provider.on_action(&self.instance, action, host)
        })
    }
}

/// Scrittura risolta fino al confine del codice esterno. Non porta guardie del
/// workspace: può essere parsata mentre `Custody<Workspace>` è rilasciato.
pub struct PreparedDocumentWrite {
    id: DocId,
    existed: bool,
    from: Option<Revision>,
    expected_source: Option<String>,
    parser: PreparedParse,
    before_write: Option<(String, BeforeWriteHook)>,
}

/// La scansione preparata senza chiamare codice esterno. Contiene una
/// fotografia degli handle degli indici, non una guardia del `Workspace`.
pub struct PreparedVaultScan {
    folders: Vec<String>,
    entries: Vec<VaultEntry>,
    documents: Vec<VaultEntry>,
    known_entries: Vec<Option<StoredEntry>>,
    assets: Vec<VaultEntry>,
    providers: Vec<(String, SharedIndexProvider)>,
}

/// La risposta degli indici alla scansione, pronta per la finalizzazione.
pub struct CompletedVaultScan {
    prepared: PreparedVaultScan,
    up_to_date: BTreeSet<DocId>,
}

impl PreparedVaultScan {
    /// Esegue soltanto `IndexProvider::up_to_date`, sugli handle staccati.
    pub fn invoke(self) -> CompletedVaultScan {
        let up_to_date = up_to_date_index_handles(&self.providers, &self.documents);
        CompletedVaultScan {
            prepared: self,
            up_to_date,
        }
    }
}

/// Prima metà di una fetta d'apertura: impronte e fotografia dei provider,
/// senza callback esterne.
pub struct PreparedIndexBatchCheck {
    seen: BTreeMap<DocId, Option<Revision>>,
    entries: Vec<PendingIndexEntry>,
    discarded: Vec<(DocId, KernelError)>,
    providers: Vec<(String, SharedIndexProvider)>,
}

/// Risposta di `up_to_date` che non porta alcuna guardia del workspace.
pub struct CheckedIndexBatch {
    seen: BTreeMap<DocId, Option<Revision>>,
    entries: Vec<PendingIndexEntry>,
    discarded: Vec<(DocId, KernelError)>,
    already: BTreeSet<DocId>,
}

impl PreparedIndexBatchCheck {
    /// Attraversa il solo confine degli indici. Il chiamante deve aver già
    /// rilasciato qualunque guardia di `Custody<Workspace>`.
    pub fn invoke(self) -> CheckedIndexBatch {
        let documents: Vec<VaultEntry> = self
            .entries
            .iter()
            .filter(|pending| pending.entry.kind == EntryKind::Document)
            .map(|pending| pending.entry.clone())
            .collect();
        let already = up_to_date_index_handles(&self.providers, &documents);
        CheckedIndexBatch {
            seen: self.seen,
            entries: self.entries,
            discarded: self.discarded,
            already,
        }
    }
}

/// Seconda metà preparata della fetta: parser e sorgenti risolti, ma nessun
/// `FormatProvider` o `SyntaxRule` ancora eseguito.
pub struct PreparedIndexBatchParse {
    read: Vec<VaultEntry>,
    reused: Vec<(DocId, StoredMeta)>,
    parses: Vec<PendingDocumentParse>,
    discarded: Vec<(DocId, KernelError)>,
    seen: BTreeMap<DocId, Option<Revision>>,
}

impl PreparedIndexBatchParse {
    /// Esegue soltanto parse e regole sintattiche. Gli scarti aggiornano
    /// `Indexing`, che vive fuori dal workspace.
    pub fn invoke(self, work: &mut Indexing) -> ParsedBatch {
        let PreparedIndexBatchParse {
            read,
            reused,
            parses,
            mut discarded,
            seen,
        } = self;

        let n = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .clamp(1, 8);
        let chunks: Vec<IndexParseChunk> = if n > 1 && parses.len() > n {
            let mut buckets: Vec<Vec<PendingDocumentParse>> = (0..n).map(|_| Vec::new()).collect();
            for (at, pending) in parses.into_iter().enumerate() {
                buckets[at % n].push(pending);
            }
            std::thread::scope(|scope| {
                let handles: Vec<_> = buckets
                    .into_iter()
                    .filter(|bucket| !bucket.is_empty())
                    .map(|bucket| scope.spawn(move || Workspace::invoke_parse_chunk(bucket)))
                    .collect();
                handles
                    .into_iter()
                    .map(|handle| handle.join().expect("il parser non esce dal recinto"))
                    .collect()
            })
        } else {
            vec![Workspace::invoke_parse_chunk(parses)]
        };

        let mut models = Vec::new();
        for chunk in chunks {
            models.extend(chunk.models);
            discarded.extend(chunk.discarded);
        }
        for (id, why) in discarded {
            work.opening.discards(id, why);
        }
        ParsedBatch {
            read,
            reused,
            models,
            seen,
        }
    }
}

/// Chiusura dell'indicizzazione preparata: grafo, insieme completo e handle dei
/// provider attraversano il confine senza portarsi dietro il `Workspace`.
pub struct PreparedIndexFinish {
    work: Indexing,
    graph: BuiltGraph,
    ids: Vec<DocId>,
    providers: Vec<(String, SharedIndexProvider)>,
}

pub struct CompletedIndexFinish {
    prepared: PreparedIndexFinish,
    external_losses: Vec<IndexLoss>,
}

impl PreparedIndexFinish {
    pub fn invoke(self) -> CompletedIndexFinish {
        let external_losses = if self.work.finished() {
            reconcile_index_handles(&self.providers, &self.ids)
        } else {
            Vec::new()
        };
        CompletedIndexFinish {
            prepared: self,
            external_losses,
        }
    }
}

pub struct PreparedIndexBatchFeed {
    models: Vec<DocumentModel>,
    providers: Vec<(String, SharedIndexProvider)>,
    losses: Vec<IndexLoss>,
}

impl PreparedIndexBatchFeed {
    pub fn invoke_indexes(mut self) -> Self {
        self.losses
            .extend(feed_index_handles(&self.providers, &self.models));
        self
    }
}

pub struct PreparedDocumentFeed {
    id: DocId,
    model: DocumentModel,
    changes: DocChanges,
    revision: Revision,
    journal: JournalOp,
    providers: Vec<(String, SharedIndexProvider)>,
    losses: Vec<IndexLoss>,
}

impl PreparedDocumentFeed {
    pub fn invoke_indexes(mut self) -> Self {
        self.losses.extend(feed_index_handles(
            &self.providers,
            std::slice::from_ref(&self.model),
        ));
        self
    }
}

impl PreparedDocumentWrite {
    /// Esegue `FormatProvider::parse` e tutte le `SyntaxRule`, e nient'altro.
    pub fn parse(&self, source: &str) -> Result<DocumentModel> {
        self.parser.invoke(DocumentSource::Text(source.to_string()))
    }

    pub fn before_write_owner(&self) -> Option<&str> {
        self.before_write.as_ref().map(|(owner, _)| owner.as_str())
    }

    /// Esegue soltanto il gancio esterno fra parse e disco. Il chiamante host
    /// gli fornisce un proxy che riacquisisce capacità strette una per volta.
    pub fn invoke_before_write(
        &self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<(), PluginError> {
        match &self.before_write {
            Some((_, hook)) => hook(host, &self.id),
            None => Ok(()),
        }
    }
}

pub struct Workspace {
    /// vault, il registro dei formati, le sintassi innestate (§3.1) e i
    /// renderer dei blocchi custom (§3.2). Stanno insieme perché **ogni** parse
    /// li attraversa tutti e quattro.
    /// Il canale dati: l'indice del kernel (metadati, tag, grafo), quelli
    docs: DocumentStore,
    /// registrati e la tabella che dice a chi va cosa (§5.1, §5.2).
    ///
    /// Sono alimentati **direttamente** (non via event bus) dentro la stessa
    /// operazione che aggiorna il vault — così un troncamento della coda eventi
    /// non può far divergere un indice — e l'id di ognuno è lo spazio dello
    /// storage persistente che l'[`HostApi`] gli concede: è lì che un indice si
    /// ricorda di ciò che ha già visto.
    /// *Chi è registrato, cosa ha dichiarato, chi possiede quale nome* (§8.1):
    indexes: Indexes,
    /// le sei tabelle di provider, il registro dei plugin (decisione 0021) e le
    /// due catene di chiamate in corso. Ciò che si risponde **senza svegliare
    /// nessuno** sta lì dentro; chiamare un provider vuole un `HostApi`, che è
    /// costruito su tutto il workspace, e resta orchestrazione di qui.
    /// *Quando un evento parte, con che nome e per quanto* (§8.1): il bus, la
    providers: ProviderRegistry,
    /// coda verso gli handler, il lotto, l'attore corrente, il budget del
    /// drenaggio e la coda dei job. Tre regole che il piano nominava separate —
    /// lotto (decisione 0011), origine (decisione 0012), budget — e che si
    /// applicano tutte nello stesso punto: tenerle in tre posti sarebbe avere
    /// tre posti da cui un evento può uscire senza lotto, senza attribuzione o
    /// senza freno. Vedi il § "Dispatch degli eventi" qui sopra.
    /// *Cosa sta guardando l'utente adesso* (§8.1): il contesto del pannello
    dispatch: Dispatcher,
    /// con il focus, servito alle view da
    /// [`HostEnv::active_context`](fub_abi::traits::HostEnv::active_context).
    /// Lo imposta la shell
    /// ([`set_active_context`](Workspace::set_active_context)); il kernel non
    /// lo deriva né lo inventa — quale nota guarda l'utente, dove ha cliccato
    /// e in che modalità legge sono decisioni dell'app, e il kernel le
    /// custodisce solo perché sono il contesto che una view (anche in WASM)
    /// deve poter chiedere.
    ///
    /// Il kernel lo tocca in un caso solo, ed è di **verità**: quando il
    /// sorgente sotto la selezione cambia o il documento sparisce (vedi
    /// [`Session::invalidate`]). Uno span stantio è peggio di uno span
    /// assente — chi lo usasse taglierebbe i byte sbagliati.
    /// **Il filo verso fuori** (§23.3), se chi monta ne ha messo uno.
    session: Session,
    ///
    /// `None` non è un difetto ed è la ragione per cui questo campo esiste
    /// invece di una dipendenza: il kernel non sa cosa sia un client HTTP e non
    /// deve saperlo — è la stessa forma del watcher, che vive in `fub-host`
    /// dietro una cargo feature perché ci sono posti dove non c'è (PWA, mobile,
    /// e2e headless), e una dipendenza obbligatoria renderebbe il trait una
    /// promessa che il `Cargo.toml` smentisce. Un host montato senza risponde
    /// [`PluginError::Unserved`], che è una frase diversa da «non ti è
    /// concesso»: di qua non ci passa nessun filo.
    ///
    /// Un `Arc` e non un `Box` perché lo prende anche chi esegue un job, che
    /// lo usa **fuori** dal prestito del workspace: una richiesta di rete non
    /// tocca il vault, e tenerne il lock per quanto dura la rete affamerebbe
    /// chi scrive (decisione 0024).
    /// **Le sorgenti di import che l'host tiene aperte** (decisione 0102).
    network: Option<Arc<dyn fub_abi::traits::HostNetwork>>,
    ///
    /// Non è un sesto proprietario: è una tabella di prestiti in corso, che vive
    /// quanto il dialogo di sistema che l'ha riempita. Sta dietro un lucchetto per
    /// una ragione sola e dichiarata: `TransferRead::read_source` prende `&self`
    /// — perché quel trait sta anche su chi legge — mentre leggere un file
    /// avanza un cursore. Fra i due era meglio l'interiore che una firma che
    /// mente su cosa tocca.
    ///
    /// Un [`Shelter`](crate::poison::Shelter) e non un `Mutex` nudo, e qui la ragione non è di forma:
    /// `OpenSources::read` chiama `SourceBacking::read_at` — **codice di
    /// qualcun altro** — col prestito in mano. Un provider che pania là dentro
    /// avvelena questo lucchetto, e da lì ogni `open_source`, `close_source`,
    /// `read_open_source` e `source_len` sarebbe stato un panico: sotto il
    /// prestito esclusivo del workspace, cioè un vault irraggiungibile fino al
    /// riavvio. Sarebbe la [0032](../../../docs/decisions/0183-composizione-host-kernel.md)
    /// disfatta da sotto — *un provider che pania costa la chiamata, non il
    /// vault* — e la rete che la 0032 mette attorno alla chiamata non lo vede,
    /// perché il veleno **resta** dopo che il panico è stato preso.
    ///
    /// Ci si riprende, per la regola della
    /// [0126](../../../docs/decisions/0184-eventi-accodati-e-job.md):
    /// ciò che il lucchetto protegge è una tabella di prestiti **indipendenti**
    /// e un contatore monotòno. `read` non muta niente (cerca e chiama), e le
    /// altre tre sono un `insert`, un `remove` e una lettura: nessuna lascia
    /// dietro di sé mezza mutazione, e le sorgenti che non c'entrano non hanno
    /// nessuna ragione di morire con quella che è andata storta.
    /// Il vault è già stato chiuso ([`close`](Workspace::close))?
    sources: Shelter<OpenSources>,
    ///
    /// **Non è un sesto proprietario** (§8.1): è lo stato del *tutto*, ed è
    /// l'unica cosa che nessuno dei cinque può sapere da sé — il disco non sa
    /// degli indici, gli indici non sanno dei provider, e «il vault è chiuso» è
    /// esattamente la frase che li riguarda tutti insieme. Serve a una cosa
    /// sola: chiudere due volte non è chiudere due volte.
    /// *Com'è configurato questo vault* (§11.1): gli schemi che i plugin
    closed: bool,
    /// dichiarano nel manifest, i valori dei due livelli, e la precedenza.
    ///
    /// **Non è un sesto proprietario** più di quanto lo sia `closed`: è una
    /// tabella che due dei cinque devono vedere uguale — il registro dei
    /// provider la riempie dichiarando, l'indice del kernel la legge per
    /// rispondere a [`IndexQuery::Settings`] — e l'`Arc<RwLock<…>>` è la forma
    /// di quella condivisione, la stessa di
    /// `WatchState::watching` e di `CoreIndex::registry`.
    /// Lo stato di vista di questa macchina (§11.2), condiviso fra i vault
    settings: SharedSettings,
    /// aperti come il livello macchina delle impostazioni.
    /// L'organizzazione di **questo** vault (§11.3): icone, appuntate,
    view_states: Arc<ViewStates>,
    /// ordinamenti, spazi. Condiviso con l'indice del kernel, che è chi risponde
    /// a `IndexQuery::Organization`.
    /// Ciò che la shell riporta del sistema: lingua, fuso, calendario (§12.3).
    organization: Arc<OrganizationStore>,
    /// Condiviso fra tutti i vault aperti, come il livello macchina delle
    /// impostazioni e lo stato di vista — la lingua di chi guarda non cambia
    /// perché si apre un secondo vault.
    /// La pila delle operazioni annullabili di **questa sessione** (§13.3).
    system_locale: Arc<SystemLocale>,
    ///
    /// Non è un sesto proprietario dei cinque del §8.1, ed è la seconda volta
    /// che vale la pena dirlo (la prima è `closed`): quei cinque rispondono
    /// alla domanda «di chi è questo dato», e questa pila non ha un dato suo —
    /// ha la **storia** di ciò che gli altri hanno fatto, che nessuno dei
    /// cinque poteva tenere senza sapere degli altri quattro.
    /// **Ciò che si sapeva del vault l'ultima volta** (§14.2): la tabella
    undo: UndoStack,
    /// dell'anagrafe su disco, con dimensione, data, impronta e — dei documenti
    /// — i metadati che risparmiano una riapertura.
    ///
    /// Non è un sesto proprietario più di quanto lo siano `closed` e
    /// `settings`: è la **memoria** di uno dei cinque (l'indice del kernel), e
    /// sta qui perché a riempirla è la scansione, che è del workspace. È anche
    /// l'unico stato di questa lista che si può buttare senza perdere niente —
    /// è derivato, e il vault resta la verità.
    /// **Ciò che è successo al vault** (§15.2): il registro append-only delle
    entry_store: EntryStore,
    /// mutazioni che il kernel ha eseguito.
    ///
    /// Non è un sesto proprietario per la ragione dell'anagrafe — è la memoria
    /// di ciò che i cinque hanno fatto — ed è il suo esatto contrario per
    /// classe: l'anagrafe è l'unico stato di questa lista che si può buttare
    /// senza perdere niente, il registro è quello che non si rifà da niente.
    /// **Ciò che l'utente ha scritto e non ha salvato** (§15.2): le bozze.
    journal: Journal,
    ///
    /// Sta accanto al registro e ne condivide la classe — autorevole, non si
    /// rifà da niente — ed è il suo opposto per verso: il registro conserva ciò
    /// che è **successo** al vault, questo ciò che non è ancora successo.
    /// Quali spazi per-documento non hanno potuto seguire una rinomina (§13.2).
    drafts: Arc<Drafts>,
    ///
    /// Un `Vec` nudo e non un `Arc<RwLock<…>>` come le altre due liste di
    /// avvisi: qui a scrivere è **solo** `migrate_identity`, che ha già il
    /// prestito esclusivo del workspace. Un lucchetto in più non renderebbe
    /// visibile niente a nessuno che non lo veda già.
    /// I documenti spariti che **potrebbero** essere stati rinominati ad app
    doc_data_warnings: Vec<String>,
    /// chiusa, e su cui il ricongiungimento non ha saputo decidere (§23.1).
    ///
    /// Sta sul workspace e non passa da un parametro perché serve a un
    /// chiamante che non c'era quando il dubbio è nato: `vault.repair` raccoglie
    /// a comando, a vault aperto da un pezzo, e senza questo elenco
    /// cancellerebbe con un clic esattamente ciò che l'apertura aveva deciso di
    /// non cancellare.
    /// Il gancio **prima della scrittura** (0154), se chi monta ne ha messo
    suspended_from_rejoin: BTreeSet<DocId>,
    /// uno: l'id del plugin a cui intestare l'host e la chiusura da chiamare
    /// in [`write_source`](Workspace::write_source) fra il parse e il disco.
    ///
    /// `None` è il default e non è un difetto — è la forma di `network` e del
    /// watcher: il kernel non sa cosa sia una fotografia, sa solo che c'è un
    /// istante in cui l'originale è ancora leggibile, e chi lo vuole guardare
    /// lo dichiara qui. Il gancio gira **dentro** la scrittura, sotto il
    /// prestito esclusivo del workspace, e un suo errore ferma la scrittura:
    /// sovrascrivere senza che la fotografia sia riuscita sarebbe la finestra
    /// che questo meccanismo esiste per chiudere.
    /// L'ultimo documento che il rilevatore ha visto sparire, con l'impronta
    before_write: Option<(String, BeforeWriteHook)>,
    /// che aveva. Serve a ricongiungere una rinomina esterna spezzata dal
    /// debounce (difetto 0198): partenza e arrivo in due finestre diverse
    /// arrivano come remove+add, e senza questo accoppiamento la bozza e lo
    /// stato per-documento restano sotto il nome morto.
    ///
    /// Uno solo, e per impronta: è la regola della 0099 vista dal rilevatore
    /// aperto. Due sparizioni di fila tengono l'ultima; un arrivo con
    /// impronta diversa non consuma il posto; nel dubbio non si accoppia.
    /// Crea un workspace su una radice con un registry di provider già
    last_removed: Option<(DocId, Revision)>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct StoredCivilTime {
    year: i32,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
}

impl From<StoredCivilTime> for CivilTime {
    fn from(value: StoredCivilTime) -> Self {
        CivilTime {
            year: value.year,
            month: value.month,
            day: value.day,
            hour: value.hour,
            minute: value.minute,
            second: value.second,
        }
    }
}

impl From<CivilTime> for StoredCivilTime {
    fn from(value: CivilTime) -> Self {
        StoredCivilTime {
            year: value.year,
            month: value.month,
            day: value.day,
            hour: value.hour,
            minute: value.minute,
            second: value.second,
        }
    }
}

const TIMER_CURSORS_FILE: &str = "timers.json";
/// Marca `.fub/data/plugins/<id>/` come cache. Senza di esso quella cartella
/// è l'albero autorevole *legacy*: `cache_write` la crea, e data_* non deve
/// scambiarla per dati.
const PLUGIN_CACHE_MARK: &str = ".fub-cache-root";

impl Workspace {
    /// popolato, e **senza livello macchina**: le impostazioni di macchina
    /// vivono in memoria e non toccano il disco.
    ///
    /// È il default giusto per chi non ha un'installazione — un test, un
    /// e2e headless — e sbagliato per un'app: chi monta davvero passa da
    /// [`with_machine_settings`](Workspace::with_machine_settings), e senza
    /// quella riga il tema scelto dall'utente non sopravvive alla chiusura.
    /// Che sia questo il default e non l'altro è deliberato: una suite di test
    /// che scrivesse nella cartella di configurazione di chi la esegue è un
    /// difetto che si scopre tardi e per vie traverse.
    /// Come [`new`](Workspace::new), col livello macchina **condiviso** fra
    pub fn new(root: impl AsRef<Utf8Path>, registry: FormatRegistry) -> Result<Self> {
        Workspace::with_machine_settings(root, registry, MachineSettings::in_memory())
    }

    /// tutti i vault aperti da questo host (§11.1).
    // **Un** supporto per workspace, non uno per proprietario: il vault, il
    pub fn with_machine_settings(
        root: impl AsRef<Utf8Path>,
        registry: FormatRegistry,
        machine: Arc<MachineSettings>,
    ) -> Result<Self> {
        // sidecar dell'organizzazione, la configurazione del vault e l'anagrafe
        // scrivono tutti nella stessa cartella, e due supporti per la stessa
        // cartella sarebbero due idee di cosa c'è dentro — il giorno in cui uno
        // dei due cifra, un dato su due resta in chiaro (§15.1, 0065).
        // Come [`with_machine_settings`](Workspace::with_machine_settings), col
        let root = crate::vault::root_absolute(root.as_ref());
        let storage = crate::storage::RootedFsStorage::open(&root).map_err(|source| {
            KernelError::InvalidRoot {
                path: root.clone(),
                source,
            }
        })?;
        Workspace::on(root, registry, Arc::new(storage), machine)
    }

    /// **supporto passato** invece del disco (§15.1).
    ///
    /// Esiste per la stessa ragione per cui esiste [`Vault::on`](crate::Vault::on),
    /// e ne è il gemello un piano più su: finché il `FsStorage` è l'unico
    /// supporto che un workspace sa montare, ciò che il workspace fa al disco si
    /// può solo *osservare a valle*, mai **interrompere a metà** — e le proprietà
    /// che parlano di cosa sopravvive a un guasto non hanno un banco. Con questa
    /// riga un supporto che fallisce la mossa che si vuole studiare è tre righe
    /// di test, e non c'è nessuna attesa da costruire.
    // Il registry è condiviso con l'indice del kernel invece che copiato:
    pub fn on(
        root: impl AsRef<Utf8Path>,
        registry: FormatRegistry,
        storage: Arc<dyn crate::storage::VaultStorage>,
        machine: Arc<MachineSettings>,
    ) -> Result<Self> {
        // **La radice si fissa e si verifica prima di aprire qualunque store**.
        // Un supporto capability controlla qui l'handle già aperto: nessun
        // sidecar viene letto o creato prima che il recinto sia valido.
        let root_buf = crate::vault::root_absolute(root.as_ref());
        storage
            .mount_fence(&root_buf)
            .map_err(|source| KernelError::InvalidRoot {
                path: root_buf.clone(),
                source,
            })?;
        // "quali estensioni sono documenti" è una domanda sola (vedi
        // `CoreIndex::registry`).
        let registry = Arc::new(registry);
        // appende il proprio nome — le impostazioni, l'organizzazione, le
        // bozze, i documenti, l'anagrafe, il registro: sei store, e cinque il
        // path se lo calcolano adesso mentre il vault se lo ricalcola a ogni
        // domanda. Con una radice relativa sarebbero sei file scritti in un
        // posto e riletti da un altro, appena la cartella di lavoro del
        // processo si sposta. Che questa riga **copra** il parametro non è
        // stile: chi aggiungerà il settimo store non ha in mano nessun'altra
        // `root` da passargli.
        // L'organizzazione è **del vault**, quindi si apre col root e non si
        let root = &root_buf;
        let settings: SharedSettings = Arc::new(RwLock::new(SettingsStore::open(
            root,
            Arc::clone(&storage),
            machine,
        )));
        // riceve da chi monta: è la differenza con il livello macchina e con lo
        // stato di vista, che sono della macchina e valgono per N vault.
        // Le bozze sono **del vault** come il registro: ciò che si stava
        let (organization, warning) = OrganizationStore::open(root, Arc::clone(&storage));
        if let Some(warning) = warning {
            organization.warn(warning);
        }
        // scrivendo in questo archivio viaggia con questo archivio. Condivise
        // con l'indice del kernel, che è chi risponde a chi le chiede (0019).
        // L'anagrafe è **del vault**, come l'organizzazione: si apre col
        let drafts = Arc::new(Drafts::open(root, Arc::clone(&storage)));
        Ok(Workspace {
            docs: DocumentStore::new(
                root,
                Arc::clone(&registry),
                Arc::clone(&storage),
                Arc::clone(&settings),
            )?,
            indexes: Indexes::new(
                registry,
                Arc::clone(&settings),
                Arc::clone(&organization),
                Arc::clone(&drafts),
            ),
            providers: ProviderRegistry::new(),
            dispatch: Dispatcher::new(EventBus::new()),
            session: Session::default(),
            network: None,
            sources: Shelter::new(OpenSources::default()),
            closed: false,
            settings,
            view_states: ViewStates::in_memory(),
            organization,
            system_locale: Arc::new(SystemLocale::default()),
            undo: UndoStack::default(),
            // root e non si riceve da chi monta.
            // Il registro è **del vault** come l'anagrafe, e come lei si apre
            entry_store: EntryStore::open(root, Arc::clone(&storage)),
            // col root: ciò che è successo a queste note viaggia con queste
            // note.
            // Aggancia lo stato di vista della macchina (§11.2).
            journal: Journal::open(root, storage),
            drafts,
            doc_data_warnings: Vec::new(),
            suspended_from_rejoin: BTreeSet::new(),
            before_write: None,
            last_removed: None,
        })
    }

    ///
    /// Builder e non parametro di [`with_machine_settings`](Workspace::with_machine_settings)
    /// perché è la stessa scelta fatta là e per la stessa ragione: il default è
    /// **in memoria**, cioè ciò che serve a un test, e chi ha un'installazione
    /// lo sostituisce in una riga. Un default che scrive nella cartella di
    /// configurazione di chi esegue la suite è un difetto che si scopre tardi.
    /// Aggancia il locale di sistema **condiviso** fra i vault aperti (§12.3).
    pub fn with_view_states(mut self, states: Arc<ViewStates>) -> Self {
        self.view_states = states;
        self
    }

    ///
    /// Builder come [`with_view_states`](Workspace::with_view_states) e per la
    /// stessa ragione: il default è un locale indeterminato, che è ciò che serve
    /// a un test e a un host senza shell, e chi ha una finestra lo sostituisce
    /// in una riga.
    /// Il locale **che vale adesso**: ciò che la shell riporta del sistema, con
    pub fn with_system_locale(mut self, locale: Arc<SystemLocale>) -> Self {
        self.system_locale = locale;
        self
    }

    /// sopra le chiavi `locale.*` che l'utente ha scelto (§12.3).
    ///
    /// È ciò che [`HostEnv::locale`](fub_abi::HostEnv::locale) rende, e ciò
    /// che la shell ridisegna quando cambia. Si ricompone a ogni chiamata invece
    /// di tenere una copia risolta: le due sorgenti cambiano da due parti — la
    /// shell che ripubblica, l'utente che scrive un'impostazione — e una copia
    /// che non si accorge di una delle due è il modo in cui la lingua resta
    /// quella di prima finché non si riavvia.
    /// **Risolve i testi** di ciò che sta uscendo dal contratto, col catalogo di
    pub fn locale(&self) -> Locale {
        let system = self.system_locale.get();
        crate::locale::resolve(&system, |key| {
            self.setting(key).ok().and_then(|v| match v {
                SettingValue::Text(s) => Some(s),
                _ => None,
            })
        })
    }

    /// chi l'ha prodotto e nella lingua di chi guarda (§12.1).
    ///
    /// È il metodo che rende vera la riga del modulo
    /// [`text`](fub_abi::text): dopo di lui ogni [`Text`] è un
    /// [`Text::Literal`], che sul filo è una stringa nuda. Sta **qui** e non
    /// nella shell perché la shell è uno dei tre host previsti — l'app, la CLI
    /// (27.1), l'API locale (27.2) — e il kernel è l'unico posto che ognuno dei
    /// tre attraversa: risolvere nella shell avrebbe voluto dire riscrivere la
    /// scala di ripiego in ogni host, e sbagliarla in due su tre.
    ///
    /// Il locale si ricompone a ogni chiamata per la stessa ragione di
    /// [`locale`](Workspace::locale): fra un render e il successivo l'utente può
    /// aver cambiato lingua.
    /// Come [`localize`](Workspace::localize), per ciò che esce **al posto** del
    pub(crate) fn localize<T: Localize + ?Sized>(&self, plugin: &str, value: &mut T) {
        let locale = self.locale();
        let (catalogs, default_locale) = self.providers.plugins.strings_of(plugin);
        Strings::new(catalogs, default_locale, &locale).localize(value);
    }

    /// valore (§12.2).
    ///
    /// Un errore è testo che qualcuno legge, e fino a questa seduta era l'unico
    /// che usciva dal contratto senza passare da qui: le sei vie d'uscita
    /// risolvevano ciò che restituivano e lasciavano non risolto ciò con cui
    /// fallivano. Il catalogo giusto è lo stesso — quello di **chi l'ha
    /// prodotto** — per la stessa ragione per cui lo è quello dell'esito: la
    /// frase l'ha scritta lui.
    ///
    /// Si applica al solo `?` che può portare l'errore *di un provider*. Ciò che
    /// fallisce prima che un provider sia stato chiamato — la view non esiste, i
    /// parametri non reggono, il comando gira su sé stesso — è prosa del kernel,
    /// cioè un [`Text::Literal`](fub_abi::text::Text::Literal) che nessun
    /// catalogo tocca: farlo passare di qui non sarebbe sbagliato, sarebbe
    /// rumore che suggerisce una traduzione che non avviene.
    /// Il locale di sistema condiviso: chi monta lo passa alla shell perché ci
    pub(crate) fn localized(&self, plugin: &str, mut and: PluginError) -> PluginError {
        self.localize(plugin, &mut and);
        and
    }

    /// scriva ciò che il sistema dice.
    /// Sceglie la strategia di aggiornamento del grafo (default: incrementale).
    pub fn system_locale(&self) -> Arc<SystemLocale> {
        Arc::clone(&self.system_locale)
    }

    // --- il registro dei plugin (§7.3, §7.4, §7.6) --------------------------
    pub fn set_graph_update(&mut self, mode: GraphUpdate) {
        self.indexes.core.graph_update = mode;
    }

    pub fn graph_update(&self) -> GraphUpdate {
        self.indexes.core.graph_update
    }

    pub fn bus(&self) -> &EventBus {
        self.dispatch.bus()
    }

    pub fn root(&self) -> &Utf8Path {
        self.docs.vault.root()
    }

    //
    // Chi registra qualcosa si **dichiara** prima. Non è burocrazia: è la sola
    // forma in cui l'host sa di chi siano le capacità che sta prestando, e in
    // cui un nome ha un proprietario invece di essere il primo arrivato.
    /// Dichiara un plugin: id, versione, versione di ABI, permessi, fiducia.
    ///
    ///
    /// Va **prima** di ogni `register_*` che nomini quell'id. Un id non
    /// dichiarato non è un plugin creato al volo: è un errore, e la ragione è
    /// la stessa per cui [`Trust::default`] è il grado più restrittivo fra
    /// quelli che girano — ciò che si ottiene dimenticandosi di dichiarare non
    /// può essere più di ciò che si ottiene dichiarando.
    ///
    /// Il [`Trust`] non sta nel manifest e non ci starà mai: è ciò che l'host
    /// pensa del plugin, non ciò che il plugin dice di sé.
    // I servizi che offre sono nomi, e valgono la regola del §7.4: o è il
    pub fn register_plugin(
        &mut self,
        manifest: PluginManifest,
        trust: Trust,
    ) -> std::result::Result<(), RegistryError> {
        // proprio id, o è dentro di esso.
        // E i requisiti devono essere **già offerti**: chi dipende da ciò che
        let owner = match trust {
            Trust::Core => fub_abi::rules::ids::Owner::Core,
            _ => fub_abi::rules::ids::Owner::Plugin(&manifest.id),
        };
        for service in &manifest.provides {
            fub_abi::rules::ids::check(service, owner).map_err(RegistryError::Namespace)?;
            if let Some(incumbent) = self.providers.plugins.provider_of(service) {
                return Err(RegistryError::Claimed {
                    kind: RegistrationKind::Service,
                    id: service.clone(),
                    incumbent: incumbent.to_string(),
                    challenger: manifest.id.clone(),
                });
            }
        }
        // non c'è non si dichiara affatto (§7.5). Ne segue che l'ordine di
        // dichiarazione dev'essere topologico, e a M5 è il caricatore a
        // ordinarlo — il kernel non riordina ciò che gli si passa, dice che non
        // sta in piedi.
        // E le **chiavi di impostazione** (§11.1), che sono nomi come i servizi
        let missing = self.providers.plugins.missing_requirements(&manifest);
        if !missing.is_empty() {
            return Err(RegistryError::MissingRequirement {
                plugin: manifest.id.clone(),
                requires: missing,
            });
        }
        // e valgono la stessa regola. Vanno dichiarate qui e non alla prima
        // lettura per la ragione che tiene lo schema nel manifest: il primo che
        // legge una chiave è l'`activate` del plugin che l'ha dichiarata, e
        // arriva **dopo** questa riga e prima di qualunque altra occasione.
        // E i **nomi delle sveglie** (§22.1), che valgono la regola opposta:
        for spec in &manifest.settings {
            fub_abi::rules::ids::check(&spec.key, owner).map_err(RegistryError::Namespace)?;
        }
        // nudi, come le chiavi di un catalogo di stringhe. Una sveglia vive
        // dentro il componente che l'ha dichiarata e nessun altro la può
        // nominare — la qualifica è strutturale, e a dire di chi è è
        // `TimerFired.owner`. Ciò che si verifica è quindi solo che il nome ci
        // sia e sia unico: due sveglie omonime dello stesso componente
        // sarebbero due eventi indistinguibili da chi li riceve.
        // La dichiarazione del plugin **prima** dello schema, e non per gusto
        let mut seen = std::collections::BTreeSet::new();
        for timer in &manifest.timers {
            if timer.id.is_empty() || !seen.insert(timer.id.as_str()) {
                return Err(RegistryError::Timer {
                    plugin: manifest.id.clone(),
                    timer: timer.id.clone(),
                });
            }
        }
        let timers_declared = !manifest.timers.is_empty();
        let (id, specs) = (manifest.id.clone(), manifest.settings.clone());
        // dell'ordine: se fosse al contrario, un id doppio lascerebbe dietro le
        // chiavi di un plugin che non è mai stato dichiarato — e a toglierle non
        // ci sarebbe nessuno, perché `deactivate_plugin` non conosce chi non è
        // mai entrato.
        // E le chiavi con cui si **negano i suoi permessi** (§23.17). Sono
        self.providers.plugins.declare(manifest, trust)?;
        if let Err(why) = self
            .settings
            .write()
            .expect("store di configurazione")
            .declare(&id, &specs)
        {
            self.providers.plugins.retire(&id);
            return Err(RegistryError::Setting(why));
        }
        // fabbricate qui e non dichiarate nel manifest per la ragione che le
        // rende utili: un componente non deve poter decidere se il proprio
        // recinto sia mostrabile. Vanno **dopo** lo schema suo, e ciò che ne
        // segue è la risposta giusta al caso brutto — un plugin che dichiarasse
        // di suo una chiave `<id>:permissions.…` fa fallire questa riga, e non
        // si monta affatto. Se l'ordine fosse rovesciato, a fallire sarebbe la
        // sua dichiarazione: stesso esito, ma il difetto verrebbe raccontato
        // come se fosse dell'host.
        // E si **ritira il suo schema**, che è stato dichiarato una
        let permissions = self.permission_specs(&id);
        let outcome = {
            let mut settings = self.settings.write().expect("store di configurazione");
            settings.declare(&id, &permissions).inspect_err(|_| {
                // riga più su e che `retire` non conosce. È il primo punto di
                // questa funzione che poteva lasciare qualcosa a metà: senza
                // questa riga le chiavi del manifest restavano nello store
                // attribuite a un plugin che non è registrato, e il secondo
                // tentativo con lo stesso id falliva **prima**, sul proprio
                // schema, con «già dichiarata da `<id>`» — cioè raccontando
                // come un difetto del manifest uno stato che aveva creato
                // l'host.
                // E si applica **subito** ciò che l'utente aveva già negato: un vault
                settings.withdraw(&id);
            })
        };
        if let Err(why) = outcome {
            self.providers.plugins.retire(&id);
            return Err(RegistryError::Setting(why));
        }
        // che si riapre non è un'occasione per ricominciare da capo.
        // Se fra le chiavi appena dichiarate c'è la finestra del registro, il
        self.reapply_permissions(&id);
        // registro si pota **adesso**: prima di questa riga quella chiave non si
        // poteva leggere, e il journal si era aperto col solo tetto. È l'altra
        // metà di `announce_setting` — la finestra vale da quando è dichiarata,
        // e da lì in poi a ogni cambiamento.
        // Chi dorme non sa che è arrivata una sveglia (§22.1, decisione 0069).
        if specs
            .iter()
            .any(|s| s.key == crate::journal::RETENTION_DAYS)
        {
            self.prunes_the_record();
        }
        if !timers_declared {
            return Ok(());
        }
        // Il pool aspetta senza scadenza finché nessuno dichiara timer — che è
        // la promessa fatta a chi non ne dichiara — quindi un componente montato
        // *dopo* che i thread si sono addormentati resterebbe senza sveglia fino
        // al primo job di qualcun altro. È la stessa mossa con cui `stop` sveglia
        // i dormienti: la campana non annuncia un job, annuncia che c'è da
        // ricontare.
        // Registra chi **offre** i servizi che il suo manifest dichiara (§7.5).
        self.dispatch.bell().ring();
        Ok(())
    }

    ///
    /// I `ns` non si passano qui: sono già nel manifest, e sono già stati
    /// verificati alla dichiarazione. Registrare un provider per un plugin che
    /// non offre niente è un errore che nomina la dimenticanza — è quasi certo
    /// che manchi il `provides`, non che il provider sia di troppo.
    /// Chiama un servizio offerto da un plugin (§7.5).
    pub fn register_service_provider(
        &mut self,
        plugin: impl Into<String>,
        provider: Box<dyn ServiceProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let provides = self
            .providers
            .plugins
            .get(&plugin)
            .map(|and| and.manifest.provides.clone())
            .ok_or_else(|| RegistryError::UnknownPlugin(plugin.clone()))?;
        if provides.is_empty() {
            return Err(RegistryError::NothingProvided(plugin));
        }
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Service, &provides);
        self.providers.services.push((plugin, Arc::from(provider)));
        Ok(())
    }

    ///
    /// Chi esegue gira con le **proprie** capacità: un servizio non presta i
    /// suoi permessi a chi lo chiama, e chi lo chiama non presta i propri a
    /// lui. È la differenza fra una superficie fra pari e una scala per
    /// scavalcare i permessi.
    ///
    /// Nessuno lo offre → [`PluginError::Unserved`], che è distinguibile da
    /// «chi lo offre ha fallito»: è la stessa distinzione del canale dati
    /// (decisione 0019), e serve a chi disegna per scegliere fra «installa il
    /// plugin» e «qualcosa è andato storto».
    // Il giro. Come per i comandi (decisione 0013), un servizio che rientra
    pub fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        let mut prepared = self.prepare_service_call(service, method, args)?;
        let owner = prepared.owner().to_string();
        let outcome = {
            let mut host = self.host_for(&owner, InvokeMode::Apply);
            prepared.invoke(&mut host)
        };
        self.finish_service_call(prepared, outcome)
    }

    /// Risolve e apre il frame di una chiamata a servizio senza eseguire codice
    /// esterno. Chi riceve il valore deve sempre riconsegnarlo a
    /// [`finish_service_call`](Self::finish_service_call).
    pub fn prepare_service_call(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> std::result::Result<PreparedService, PluginError> {
        let owner = self
            .providers
            .plugins
            .provider_of(service)
            .ok_or_else(|| {
                PluginError::Unserved(format!("nessun plugin offre il servizio `{service}`").into())
            })?
            .to_string();
        let at = self
            .providers
            .services
            .position(|(id, _)| *id == owner)
            .ok_or_else(|| {
                PluginError::Unserved(
                    format!("`{owner}` dichiara `{service}` e non ha registrato chi lo serve")
                        .into(),
                )
            })?;

        if self.providers.service_stack.iter().any(|s| s == service) {
            let mut round = self.providers.service_stack.clone();
            round.push(service.to_string());
            return Err(PluginError::BadArgs(
                format!(
                    "un servizio non può chiamare sé stesso: {}",
                    round.join(" → ")
                )
                .into(),
            ));
        }

        let provider = Arc::clone(&self.providers.services[at].1);
        self.providers.service_stack.push(service.to_string());
        let previous_provider_call = self.dispatch.enter_provider_call();
        Ok(PreparedService {
            owner,
            service: service.to_string(),
            method: method.to_string(),
            args: Some(args),
            provider,
            previous_provider_call,
        })
    }

    /// Chiude il frame aperto da [`prepare_service_call`](Self::prepare_service_call)
    /// nello stesso ordine del vecchio percorso sincrono: flag, stack, dispatch.
    pub fn finish_service_call(
        &mut self,
        prepared: PreparedService,
        outcome: std::result::Result<serde_json::Value, PluginError>,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let popped = self.providers.service_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.service.as_str()));
        self.dispatch_pending();
        outcome
    }

    /// permessi di
    /// [`PluginPermissions::core`](fub_abi::traits::PluginPermissions::core).
    ///
    /// È zucchero su [`register_plugin`](Workspace::register_plugin) e non un
    /// secondo percorso: passa dallo stesso registro, con lo stesso manifest,
    /// e prende gli stessi rifiuti. Se fosse un percorso privilegiato, il §7.3
    /// sarebbe applicato solo a chi non esiste ancora.
    /// **Spegne un plugin**: chiude i suoi indici, toglie tutto ciò che ha
    pub fn register_core_feature(
        &mut self,
        id: &str,
        name: &str,
    ) -> std::result::Result<(), RegistryError> {
        self.register_plugin(PluginManifest::core(id, name), Trust::Core)
    }

    /// registrato, e ritira la sua dichiarazione (§9.4).
    ///
    /// È l'inverso esatto della strada di registrazione, e prima non c'era:
    /// `register_*` faceva `push` e basta, quindi "spento" poteva voler dire
    /// una cosa sola — *non registrato all'avvio*, deciso da una variabile
    /// d'ambiente (D7). Con le impostazioni del §11.1 la decisione si prende a
    /// runtime, e senza un modo di togliere un provider quella parola non
    /// significherebbe più niente.
    ///
    /// # Cosa succede, nell'ordine
    ///
    /// 1. **Gli indici**: `flush` e poi `close` (decisione 0028), ognuno con
    ///    l'host intestato a sé — è il loro ultimo momento per rendere durevole
    ///    ciò che hanno e lasciare andare ciò che tengono. Le loro rotte
    ///    spariscono dalla tabella: chi le chiede riceve `Unserved`, non la
    ///    risposta di chi gli stava dietro nell'elenco.
    /// 2. **Gli altri provider** — handler, view, comandi, servizi, import,
    ///    export, regole sintattiche, renderer — che non hanno un momento di
    ///    chiusura perché non tengono niente: il punto in cui un bundle libera
    ///    ciò che possiede è `Plugin::deactivate`, e lo chiama chi possiede il
    ///    bundle — il `BundleRegistry` di `fub-host`
    ///    ([decisione 0031](../../../docs/decisions/0183-composizione-host-kernel.md)),
    ///    non il kernel. Lo chiama **prima** di questa funzione, che è l'unico
    ///    momento in cui il bundle è ancora intero: dopo, l'host intestato a
    ///    quell'id nega tutto, perché la dichiarazione non c'è più.
    /// 3. **La dichiarazione**, che sparisce dall'inventario del §7.6.
    ///
    /// Gli errori tornano al chiamante e **non fermano niente**: chi smette
    /// smette comunque, e un `close` fallito non è una ragione per lasciare
    /// mezzo plugin registrato. È la stessa regola di
    /// [`flush_indexes`](Workspace::flush_indexes).
    ///
    /// # Da dentro una chiamata di provider non si può
    ///
    /// [`RegistryError::Busy`], e non è prudenza: lì i provider sono **in
    /// prestito** (§7.2), la loro tabella è vuota, e una rimozione calcolata su
    /// una tabella vuota toglie zero e vede tornare tutti. Chi lo riceve
    /// richiede a chiamata tornata.
    // Il flush **prima** della chiusura, come dice il contratto: chi
    pub fn deactivate_plugin(
        &mut self,
        plugin: &str,
    ) -> std::result::Result<Vec<PluginError>, RegistryError> {
        if self.providers.plugins.get(plugin).is_none() {
            return Err(RegistryError::UnknownPlugin(plugin.to_string()));
        }
        if self.dispatch.in_provider_call() {
            return Err(RegistryError::Busy(plugin.to_string()));
        }

        let mut errors = Vec::new();
        let indexes = self.indexes.remove(plugin);
        let removed_indexes = !indexes.is_empty();
        for (id, index) in indexes {
            let mut index = index.write();
            let out = self.with_provider_call(|ws| {
                let mut host = ws.host_for(&id, InvokeMode::Apply);
                // arriva a `close` ha già avuto il proprio punto di persistenza,
                // e ciò che scrive lì dentro è roba della chiusura.
                // Qui il `Box` cade, ed è il momento in cui un provider nativo
                let flushed = index.flush(&mut host);
                let closed = index.close(&mut host);
                [flushed, closed]
            });
            errors.extend(out.into_iter().filter_map(|outcome| outcome.err()));
            // lascia andare ciò che il `close` non ha saputo lasciare.
            // Regole sintattiche e renderer non sono in una tabella di provider: i
            drop(index);
        }

        self.providers.handlers.retain(|(id, _)| id != plugin);
        self.providers.views.retain(|v| v.id != plugin);
        self.providers.commands.retain(|c| c.id != plugin);
        self.providers.services.retain(|(id, _)| id != plugin);
        self.providers.imports.retain(|(id, _)| id != plugin);
        self.providers.exports.retain(|(id, _)| id != plugin);

        // loro registri conoscono l'id della *regola*, non quello di chi l'ha
        // registrata. Chi lo sa è l'inventario, ed è da lì che si prendono i
        // nomi da togliere.
        // Lo schema delle sue impostazioni se ne va con lui: da qui in poi le
        for id in self
            .providers
            .plugins
            .ids_of(plugin, RegistrationKind::Syntax)
        {
            self.docs.syntax.remove(&id);
        }
        for id in self
            .providers
            .plugins
            .ids_of(plugin, RegistrationKind::Renderer)
        {
            self.docs.renderers.remove(&id);
        }

        self.providers.plugins.retire(plugin);
        // sue chiavi non si leggono e non si scrivono, che è ciò che vuol dire
        // «quella feature non c'è». I **valori** restano scritti dov'erano —
        // spegnere una feature non è riconfigurarla, e riaccenderla ritrova come
        // l'avevi lasciata.
        // I job che aveva in coda non partiranno: il loro corpo è
        self.settings
            .write()
            .expect("store di configurazione")
            .withdraw(plugin);

        // `Plugin::run_job`, e quel plugin non c'è più. Ognuno riceve il proprio
        // esito, perché un job che sparisce senza dire niente è un chiamante che
        // aspetta per sempre — ed è la terza faccia del §9.2, quella che la
        // decisione 0027 aveva lasciato aperta.
        // Il canale dati non risponde più come prima: chi disegna da una query
        for job in self.dispatch.take_jobs_of(plugin) {
            self.complete_job(
                job.id,
                job.spec.job.clone(),
                Err(PluginError::Internal(
                    format!(
                        "`{plugin}` è stato disattivato prima che il job `{}` partisse",
                        job.spec.job
                    )
                    .into(),
                )),
            );
        }

        // sta mostrando il passato. Non lo ha chiesto un documento né un plugin
        // — è il kernel che dichiara di aver cambiato forma (decisione 0012).
        // **Chiude il vault**: l'ultimo giro sincrono, un punto di consistenza per
        if removed_indexes {
            self.as_actor(Actor::Kernel, |ws| {
                ws.emit_event(Event::IndexUpdated);
                ws.dispatch_pending();
            });
        }
        Ok(errors)
    }

    /// tutti, e poi ognuno che smette (§9.5).
    ///
    /// È il gemello di [`reindex`](Workspace::reindex), che è l'apertura, e
    /// prima non esisteva: `flush_indexes` aveva **un solo chiamante in
    /// produzione**, il callback del watcher, quindi la durabilità di un indice
    /// dipendeva da un componente **opzionale**. Dove il watcher non c'è — un
    /// network share, una cartella cloud, la CLI, un e2e headless, PWA e mobile
    /// — le scritture di un indice non diventavano mai durevoli, e il sintomo
    /// era solo una riapertura lenta: nessuno se ne accorgeva finché non
    /// contava.
    ///
    /// # L'ordine, e perché è quello
    ///
    /// 1. **[`Event::VaultClosed`]**, con la coda drenata subito dopo. È
    ///    l'ultimo momento in cui il vault è ancora quello di prima: chi lo
    ///    riceve è ancora registrato, ha ancora l'`HostApi` e può ancora
    ///    scrivere. Emetterlo dopo aver spento qualcuno sarebbe stato
    ///    annunciare una chiusura a chi non c'è più.
    /// 2. **Un flush di tutti gli indici**, che è il punto di consistenza che
    ///    non è il watcher. Prima delle disattivazioni, e non dentro: ciò che
    ///    l'evento ha fatto scrivere agli handler dev'essere già indicizzato
    ///    quando il primo indice si chiude.
    /// 3. **Ogni plugin, in ordine inverso di dichiarazione** — `flush` e
    ///    `close` sui suoi indici, via tutto il resto
    ///    ([decisione 0028](../../../docs/decisions/0183-composizione-host-kernel.md)).
    ///    All'inverso perché è l'ordine in cui si smontano le cose che si sono
    ///    montate in ordine: chi è arrivato per ultimo può dipendere da chi
    ///    c'era già (§7.5), mai il contrario.
    ///
    /// Gli errori non fermano niente e tornano tutti insieme: una chiusura che
    /// si interrompesse a metà lascerebbe il resto aperto, che è il caso che
    /// questa funzione esiste per non produrre. È la stessa regola di
    /// [`flush_indexes`](Workspace::flush_indexes) — chi ha un canale per dirlo
    /// li mostra.
    ///
    /// Chiuderlo due volte non fa niente: la seconda chiamata rende una lista
    /// vuota senza emettere un secondo `VaultClosed`.
    ///
    /// **L'indice del kernel non riceve `close`**, e non è una dimenticanza: non
    /// persiste niente per conto proprio (la sua verità è il vault, e la
    /// ricostruisce all'apertura), non ha uno spazio dati, e non potrebbe
    /// riceverlo senza uscire da sé stesso — l'host che gli si presterebbe è
    /// costruito sul workspace che lo contiene.
    /// [`close`](Workspace::close), con **un passo in più su ogni plugin**:
    pub fn close(&mut self) -> Vec<PluginError> {
        self.close_with(|_, _| Vec::new())
    }

    /// `stopping` gira su ciascuno subito prima che il kernel lo disattivi, ed è
    /// il posto in cui chi possiede i bundle chiama
    /// [`Plugin::deactivate`](fub_abi::traits::Plugin::deactivate) (§9.3).
    ///
    /// Esiste perché quel passo **non può stare né prima né dopo**. Il kernel
    /// non possiede i `Box<dyn Plugin>` — li possiede il registry, che vive in
    /// `fub-host` — quindi chiuderli non è cosa sua; e chi li possiede non può
    /// farlo fuori da qui, perché prima di questa funzione il vault non ha
    /// ancora avuto il suo [`Event::VaultClosed`] e dopo non c'è più nessuno a
    /// cui dirlo: [`deactivate_plugin`](Workspace::deactivate_plugin) ritira la
    /// dichiarazione, e da lì in poi un host intestato a quell'id nega tutto.
    ///
    /// L'ordine è quindi, per ogni plugin e a rovescio della dichiarazione:
    /// **`stopping` mentre il bundle è ancora intero** — provider registrati,
    /// capacità vive — e poi il kernel che gli toglie tutto. È la stessa forma
    /// del punto 1 qui sopra: si dice a chi c'è ancora.
    ///
    /// Gli errori di `stopping` si accodano agli altri e non fermano niente,
    /// come tutto il resto della chiusura.
    // Un `Busy` qui vorrebbe dire che si sta chiudendo il vault da
    pub fn close_with(
        &mut self,
        mut stopping: impl FnMut(&mut Workspace, &str) -> Vec<PluginError>,
    ) -> Vec<PluginError> {
        if self.closed {
            return Vec::new();
        }
        self.closed = true;

        let root = self.docs.vault.root().to_string();
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::VaultClosed { root });
            ws.dispatch_pending();
        });

        let mut errors = self.flush_indexes();

        let plugins: Vec<String> = self
            .providers
            .plugins
            .iter()
            .map(|and| and.manifest.id.clone())
            .rev()
            .collect();
        for id in plugins {
            errors.extend(stopping(self, &id));
            match self.deactivate_plugin(&id) {
                Ok(errs) => errors.extend(errs),
                // dentro la chiamata di un provider, cioè che chi chiude è
                // qualcuno che il vault lo sta usando. Non fa danno e va detto.
                // **L'anagrafe si scrive qui**, ed è l'ultima riga della chiusura: è
                Err(and) => errors.push(PluginError::Internal(and.to_string().into())),
            }
        }

        // l'ultimo momento in cui qualcuno sa che sta chiudendo (§9.5). Fra
        // l'apertura e questa riga `touch_entry` ha aggiornato la sola memoria
        // — cinque siti: un salvataggio, una scrittura vista dal rilevatore, il
        // cestino, il ripristino, la rinomina — e senza questa riga tutto ciò
        // che si è toccato dopo l'apertura veniva riletto e riparsato alla
        // riapertura, cioè il lavoro che l'anagrafe esiste per evitare.
        //
        // **Non copre il processo ucciso**, e non deve: chi muore senza passare
        // di qui ricade su ciò che c'era prima — l'anagrafe di fine apertura,
        // che rilegge i soli documenti toccati dopo. È il degrado di un
        // derivato, non una perdita, quindi qui non si baratta niente: questa
        // riga toglie del lavoro nel caso normale e non ne aggiunge in nessuno.
        //
        // **Ultima, e non a metà** (difetto 0190). Dove esattamente cada non è
        // una preferenza, perché i due stati a metà che un'interruzione può
        // lasciare non si equivalgono: l'anagrafe è ciò che alla riapertura
        // *risparmia* il lavoro — una voce la cui impronta combacia col disco
        // non si rilegge, non si riparsa e non torna agli indici, si riprende
        // dalla cache —, quindi scriverla prima che gli indici abbiano finito
        // vuol dire lasciare, per tutto il resto della chiusura, un disco che
        // dichiara indicizzato ciò che nessun indice ha ancora scritto. Chi
        // muore lì dentro riapre un vault in cui quelle note esistono, si
        // aprono e si leggono, e dalla ricerca sono sparite in silenzio finché
        // qualcuno non chiede una ricostruzione. Il verso opposto — indici
        // scritti e anagrafe no — è il degrado del capoverso qui sopra: si
        // rilegge, e non si perde niente. Fra i due si sceglie quello che costa
        // lavoro invece di quello che costa verità.
        //
        // «Gli indici hanno finito» è più tardi di quanto sembri, ed è la parte
        // che stava storta: non basta [`flush_indexes`](Workspace::flush_indexes),
        // perché la disattivazione qui sopra dà a ogni indice un altro `flush` e
        // poi il suo `close` — è il contratto (decisione 0028) —, e `stopping`
        // in mezzo può far scrivere ancora. L'ordine che
        // [`finish_index`](Workspace::finish_index) teneva già è lo stesso letto
        // in una funzione più lunga: **l'anagrafe per ultima**, quando non c'è
        // più nessuno che possa scrivere dopo di lei.
        // Il vault è già stato chiuso?
        self.store_entries();

        errors
    }

    /// La bandiera del **rilevamento delle modifiche esterne** (§9.7), da dare a
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// chi tiene vivo un rilevatore.
    ///
    /// È l'unico modo che il kernel ha di sapere una cosa che non gli
    /// appartiene: il watcher vive in `fub-host`, il kernel non sa cosa sia, e
    /// però è il kernel che deve **rispondere**
    /// ([`IndexQuery::VaultStatus`]),
    /// perché è l'unico che conosce anche l'altra metà della risposta — quante
    /// sincronizzazioni sono fallite.
    ///
    /// Una bandiera **condivisa** e non un valore copiato, perché la copia
    /// sarebbe una seconda verità: chi monta la alzerebbe all'avvio e nessuno la
    /// abbasserebbe quando il rilevatore muore. Chi la tiene la abbassa — quando
    /// fallisce e quando smette — e la risposta del kernel cambia da sé.
    /// Monta il filo verso fuori (§23.3). Lo chiama chi monta, una volta.
    pub fn watch_flag(&self) -> Arc<AtomicBool> {
        self.indexes.core.watch.watching.clone()
    }

    /// Il client di rete montato, se c'è.
    pub fn set_network(&mut self, client: Arc<dyn fub_abi::traits::HostNetwork>) {
        self.network = Some(client);
    }

    ///
    /// È pubblico perché serve a chi esegue un **job**: la richiesta si fa
    /// fuori dal prestito, quindi il client si prende di qui e il permesso da
    /// [`Workspace::granted`].
    /// La politica di un plugin, così com'è **adesso**.
    pub fn network(&self) -> Option<Arc<dyn fub_abi::traits::HostNetwork>> {
        self.network.clone()
    }

    ///
    /// Serve allo stesso caso, e la parola *adesso* è tutta la ragione per cui
    /// non la si cattura all'avvio di un job: un plugin revocato mentre una sua
    /// richiesta è in volo deve trovare il cancello chiuso alla successiva, non
    /// alla fine del job.
    /// Questo plugin può nominare questo id? La regola del §7.4, per chi non
    pub fn granted_policy(&self, plugin: &str) -> crate::host::Granted {
        self.providers.plugins.granted(plugin)
    }

    /// passa da una registrazione.
    ///
    /// Serve al topic di un [`Event::Custom`], che è l'unico nome del contratto
    /// senza un momento di registrazione in cui verificarlo: si controlla
    /// quando lo si emette.
    /// L'inventario di ciò che è **attivo** (§7.6): chi è registrato, con quale
    pub(crate) fn owns_name(
        &self,
        plugin: &str,
        id: &str,
    ) -> std::result::Result<(), fub_abi::rules::ids::IdFault> {
        self.providers.owns_name(plugin, id)
    }

    /// manifest, quale fiducia, quali permessi, e cosa ha registrato.
    ///
    /// È ciò che fa sparire `VaultInfo.versioning: bool` — un booleano per
    /// feature dentro un record IPC, che con i moduli del 21.2 sarebbero
    /// diventati venti booleani, ognuno una modifica al record, al mirror e
    /// alla fixture.
    /// Il grado di fiducia di un plugin dichiarato.
    pub fn plugins(&self) -> Vec<PluginInfo> {
        self.providers.inventory()
    }

    /// Registra un [`EventHandler`] per conto di un plugin dichiarato.
    pub fn trust_of(&self, plugin: &str) -> Option<Trust> {
        self.providers.trust_of(plugin)
    }

    ///
    /// `plugin` è l'identità di chi lo offre: determina lo spazio dello storage
    /// persistente che l'`HostApi` gli concede (`.fub/plugins/<id>/`, con cache in `.fub/data/plugins/<id>/`) e
    /// **i permessi con cui girerà**. Un handler non nomina niente di suo, e
    /// quindi non ha id da far collidere: l'unico nome in gioco è quello del
    /// plugin.
    /// Presta un [`HostApi`] intestato a un plugin, per la durata di una
    pub fn register_event_handler(
        &mut self,
        plugin: impl Into<String>,
        handler: Box<dyn EventHandler>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        self.providers
            .plugins
            .admit(&plugin, RegistrationKind::EventHandler, &[])?;
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::EventHandler, &[]);
        self.providers.handlers.push((plugin, handler));
        Ok(())
    }

    /// chiamata.
    ///
    /// Serve a chi compone le due metà di una feature dall'esterno del
    /// dispatch: l'app apre lo store delle versioni e legge una versione con le
    /// stesse capacità che l'handler usa dentro `handle`, e non con `std::fs`.
    /// A M4 è anche il modo in cui il registry guiderà `Plugin::activate`.
    ///
    /// Le capacità sono **quelle del plugin**, non quelle del chiamante: un id
    /// che nessuno ha dichiarato riceve un host che nega tutto, dicendo perché.
    // Anche questa è una "chiamata di provider" ai fini della consegna:
    pub fn with_host<R>(&mut self, plugin: &str, f: impl FnOnce(&mut dyn HostApi) -> R) -> R {
        self.with_host_mode(plugin, InvokeMode::Apply, f)
    }

    /// Come [`with_host`](Self::with_host), conservando la modalità della
    /// chiamata esterna. Serve ai proxy che rientrano per una singola capacità.
    pub fn with_host_mode<R>(
        &mut self,
        plugin: &str,
        mode: InvokeMode,
        f: impl FnOnce(&mut dyn HostApi) -> R,
    ) -> R {
        // ciò che `f` emette arriva agli handler quando `f` è tornata.
        let result = self.with_provider_call(|ws| {
            let mut host = ws.host_for(plugin, mode);
            f(&mut host)
        });
        self.dispatch_pending();
        result
    }

    /// Variante del proxy di scrittura intestata a un esemplare di view. Le
    /// capacità restano per-chiamata; cambia soltanto il timbro dello stato di
    /// view.
    pub fn with_host_mode_instance<R>(
        &mut self,
        plugin: &str,
        mode: InvokeMode,
        instance: &str,
        f: impl FnOnce(&mut dyn HostApi) -> R,
    ) -> R {
        let mut host = self.host_for_view(plugin, mode, Some(instance));
        f(&mut host)
    }

    /// chiamata — il gemello in sola lettura di
    /// [`with_host`](Workspace::with_host).
    ///
    /// Prende `&self`, ed è tutta la ragione per cui esiste: chi ha il workspace
    /// dietro un `RwLock` (l'host, decisione 0024) può servire una lettura con
    /// il prestito **condiviso** invece di quello esclusivo. Passare da
    /// `with_host` anche per leggere rimetterebbe in fila chiunque stia
    /// disegnando, e lo farebbe in silenzio: `write()` al posto di `read()`
    /// compila.
    ///
    /// Il primo cliente è il `JobHost` di `fub-host` (§9.1): un lavoro lungo
    /// che cammina il vault fa quasi solo letture, e sono migliaia.
    // Niente `with_provider_call` e niente drenaggio: da qui non si emette
    pub fn with_read_host<R>(&self, plugin: &str, f: impl FnOnce(&dyn ReadApi) -> R) -> R {
        // e non si scrive, quindi non c'è nessuna coda che possa crescere.
        // L'host di **lettura** intestato a un plugin, con la stessa politica di
        let host = self.read_host_for(plugin);
        f(&host)
    }

    /// Variante del proxy di lettura intestata a un esemplare di view. È la
    /// stessa politica di `with_read_host`, con in più la chiave dello stato di
    /// view che solo l'host può timbrare correttamente.
    pub fn with_read_host_instance<R>(
        &self,
        plugin: &str,
        instance: &str,
        f: impl FnOnce(&dyn ReadApi) -> R,
    ) -> R {
        let host = self.read_host_for_view(plugin, Some(instance));
        f(&host)
    }

    /// [`host_for`](Workspace::host_for) davanti.
    ///
    /// Non è un `KernelHost` con meno capacità: è un tipo che le altre non le
    /// ha (§7.1), e prende `&self` perché una lettura gira sotto prestito
    /// condiviso del workspace.
    /// Come [`read_host_for`](Workspace::read_host_for), **per conto di un
    pub(crate) fn read_host_for<'a>(&'a self, plugin: &'a str) -> Guard<ReadHost<'a>, Granted> {
        self.read_host_for_view(plugin, None)
    }

    /// esemplare di view**.
    ///
    /// L'esemplare è ciò che rende la chiave dello stato di vista (§11.2) di chi
    /// disegna e non di chiunque: lo timbra l'host, come l'id di un job nella
    /// 0035, perché è l'unico dei due a saperlo con certezza. `None` = non si
    /// sta disegnando una view, e allora uno stato di vista non c'è.
    /// **Il punto di applicazione** (§7.3): un host intestato a un plugin, con
    pub(crate) fn read_host_for_view<'a>(
        &'a self,
        plugin: &'a str,
        instance: Option<&'a str>,
    ) -> Guard<ReadHost<'a>, Granted> {
        Guard::new(
            ReadHost {
                ws: self,
                plugin,
                instance,
            },
            self.providers.plugins.granted(plugin),
        )
    }

    /// davanti la politica che i suoi permessi e la sua fiducia compongono.
    ///
    /// Ogni prestito passa di qui. Prima ne passava nessuno: `KernelHost`
    /// portava `plugin: &str` e `mode`, e nient'altro — non sapeva di chi
    /// fossero le capacità che stava prestando, quindi non poteva negarne
    /// nessuna.
    /// Come [`host_for`](Workspace::host_for), per conto di un esemplare di
    pub(crate) fn host_for<'a>(
        &'a mut self,
        plugin: &'a str,
        mode: InvokeMode,
    ) -> Guard<KernelHost<'a>, Granted> {
        self.host_for_view(plugin, mode, None)
    }

    /// view: vedi [`read_host_for_view`](Workspace::read_host_for_view).
    // La politica si prende **prima**: dopo, `self` è prestato all'host.
    pub(crate) fn host_for_view<'a>(
        &'a mut self,
        plugin: &'a str,
        mode: InvokeMode,
        instance: Option<&'a str>,
    ) -> Guard<KernelHost<'a>, Granted> {
        // Mette il gancio **prima della scrittura** (0154): l'id del plugin a cui
        let granted = self.providers.plugins.granted(plugin);
        Guard::new(
            KernelHost {
                ws: self,
                plugin,
                mode,
                instance,
            },
            granted,
        )
    }

    /// intestare l'host e la chiusura da chiamare in
    /// [`write_source`](Workspace::write_source) fra il parse e il disco.
    ///
    /// Un solo gancio, l'ultimo vince: chi monta la fotografia è il montaggio
    /// del versioning, e non c'è un secondo candidato. `None` (il default)
    /// disattiva.
    /// Registra un [`IndexProvider`] sotto un id. Va fatto **prima** di
    pub fn set_before_write_hook(&mut self, hook: Option<(String, BeforeWriteHook)>) {
        self.before_write = hook;
    }

    /// [`reindex`], che è il momento in cui l'indice riceve il contenuto del
    /// vault e riconcilia ciò che è cambiato mentre non era vivo.
    ///
    /// La registrazione **è** l'attivazione: l'indice riceve subito un
    /// [`HostApi`] intestato al proprio id e ricarica da `data_*` ciò che ha
    /// già visto. Prima di questo momento non può avere ricordi, e dopo il
    /// primo `on_documents_indexed` sarebbe troppo tardi per averli.
    ///
    /// I due esiti sono **diversi**, e li distingue chi chiama: un conflitto di
    /// rotte vuol dire che l'indice non è registrato affatto; un errore di
    /// attivazione che è registrato ma non ha ritrovato la propria memoria —
    /// reindicizzerà tutto, che è lento, non sbagliato.
    ///
    /// `id` è un nome semplice, senza separatori di path: determina lo spazio
    /// dati (`.fub/data/plugins/<id>/`), come per gli event handler.
    ///
    /// [`reindex`]: Workspace::reindex
    // I `ns` delle query custom sono nomi in uno spazio condiviso, e la
    pub fn register_index_provider(
        &mut self,
        plugin: impl Into<String>,
        index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        // regola del §7.4 vale per loro come per gli id di view: chi rivendica
        // `acme:tasks` deve essere `acme`. Le rotte del contratto invece non
        // sono nomi di nessuno — chi le rivendica non le nomina, le serve — e il
        // loro conflitto lo vede la tabella delle rotte.
        // Registra un indice **sostituendo** chi rivendicava le stesse famiglie di
        let namespaces = plugins::custom_namespaces(&index.routes());
        self.providers
            .plugins
            .admit(&plugin, RegistrationKind::Index, &namespaces)?;
        self.indexes
            .declare(&plugin, index.as_ref())
            .map_err(RegistryError::Route)?;
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Index, &namespaces);
        self.activate_index(plugin, index)
    }

    /// domande.
    ///
    /// È l'operazione che il dispatch per tentativi faceva senza dirlo — vinceva
    /// chi si era registrato prima, e non c'era modo di accorgersene — e che
    /// adesso si chiede per nome. È anche il modo in cui l'indice del kernel si
    /// scavalca: `Backlinks`, `Tags` e gli altri non sono più un ramo prima del
    /// ciclo, sono rotte come le altre.
    // Sostituire non scavalca la regola dei nomi: si prende il posto di chi
    pub fn replace_index_provider(
        &mut self,
        plugin: impl Into<String>,
        index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let namespaces = plugins::custom_namespaces(&index.routes());
        // c'era, non il suo namespace. E il permesso si chiede **prima** di
        // togliere la riga di chi c'era, o un rifiuto lascerebbe la rotta ancora
        // servita e l'inventario a dire che non è di nessuno.
        // La registrazione **è** l'attivazione: l'indice riceve subito un
        self.providers
            .plugins
            .admit_replacing(&plugin, RegistrationKind::Index, &namespaces)?;
        self.providers
            .plugins
            .forget(RegistrationKind::Index, &namespaces);
        self.indexes.declare_replacing(index.as_ref());
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Index, &namespaces);
        self.activate_index(plugin, index)
    }

    /// [`HostApi`] intestato al proprio id e ricarica da `data_*` ciò che ha già
    /// visto. Prima di questo momento non può avere ricordi, e dopo il primo
    /// `on_documents_indexed` sarebbe troppo tardi per averli.
    // `index` è ancora una variabile locale: prestare `&mut self` all'host
    fn activate_index(
        &mut self,
        id: String,
        mut index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        // qui non alias niente. `activate` è una chiamata a un provider come
        // le altre: il dispatch resta rimandato a chiamata tornata.
        // Guarda cosa c'è nel vault, ricostruisce il grafo e allinea gli indici
        let activated = self.with_provider_call(|ws| {
            let mut host = ws.host_for(&id, InvokeMode::Apply);
            index.activate(&mut host)
        });
        self.indexes
            .providers
            .push((id, Arc::new(SharedShelter::new(index))));
        self.dispatch_pending();
        activated.map_err(RegistryError::Activate)
    }

    /// registrati — **rileggendo e riparsando solo ciò che serve** (§14.1,
    /// §14.2).
    ///
    /// # Cosa succede, in ordine
    ///
    /// 1. **La scansione vede tutti i file**, non solo le estensioni dei
    ///    provider registrati: da qui nasce l'anagrafe, e da qui in poi un PNG
    ///    nel vault esiste.
    /// 2. Di ogni voce si porta avanti ciò che l'anagrafe scritta l'ultima
    ///    volta ne sapeva, **se descrive ancora quel file** (dimensione e data).
    /// 3. I documenti di cui non si sa niente si leggono, e leggendoli se ne
    ///    calcola l'impronta: è l'unico posto in cui si calcola: dove i byte
    ///    sono già in mano.
    /// 4. Si chiede agli indici registrati **cosa hanno già**
    ///    ([`IndexProvider::up_to_date`]). Prima non glielo si chiedeva: il
    ///    kernel leggeva e parsava tutto e poi lo consegnava a chi ce l'aveva
    ///    già.
    /// 5. Un documento si salta — niente lettura, niente parse, niente
    ///    alimentazione — solo se l'anagrafe ne ha i metadati, l'impronta
    ///    combacia e **ogni** indice ha detto di averlo. Tutto il resto passa
    ///    dalla strada di sempre.
    ///
    /// Per gli indici questo **non** è un rebuild: chi riceve un documento lo
    /// ha chiesto (o non ha detto niente, che vuol dire la stessa cosa), e
    /// [`IndexProvider::reconcile`] dice a tutti qual è l'insieme completo, così
    /// ognuno cancella ciò che è sparito ad app chiusa.
    ///
    /// # Cosa può fallire, e cosa no (§15.7)
    ///
    /// **Un documento che non si legge o non si parsa non fa fallire
    /// l'apertura**: finisce fra gli [`discarded`](Opening::discarded) dell'[`Opening`](Opening)
    /// che questa funzione restituisce, e la sua voce resta nell'anagrafe — il file c'è, è
    /// il suo contenuto che non si è potuto vedere. Il `Result` che resta porta
    /// **solo** ciò che riguarda il vault intero, cioè la scansione: il confine
    /// non è lettura-contro-parse, è se il vault sappia ancora dire *quali*
    /// documenti esistono. Il perché sta nella
    /// [decisione 0068](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md).
    // La raccolta sta fuori da `finish_index` perché vuole `&self` e non
    pub fn reindex(&mut self) -> Result<Opening> {
        let mut indexing = self.scan_vault()?;
        while !indexing.finished() {
            self.index_batch(&mut indexing);
        }
        let opening = self.finish_index(indexing);
        // `&mut` (vedi il suo doc); qui la si rifà subito, come prima, perché
        // `reindex` è il giro sincrono e chi lo chiama ha già il prestito in
        // mano — non c'è nessuno da non far aspettare.
        //
        // L'esito **non** risale, e la ragione è quella del § qui sopra: il
        // `Result` di un'apertura porta solo ciò che riguarda la scansione, e
        // una cartella di dati che non si è potuta togliere non impedisce a
        // nessuno di aprire una nota. Chi ha chiesto *espressamente* di
        // raccogliere — `vault.repair` — la riceve invece, perché è la sola
        // cosa che aveva chiesto.
        // Toglie i temporanei di scrittura che la camminata ha trovato rimasti
        if let Err(and) = self.collect_doc_data() {
            tracing::warn!(target: "fub.kernel", "spazi per-documento non raccolti: {and}");
        }
        Ok(opening)
    }

    /// indietro (difetto 0155).
    ///
    /// Sta qui e non nella camminata perché è l'unica mutazione dell'apertura
    /// che non nasce da ciò che l'utente ha scritto, e sta **nell'apertura** e
    /// non in `vault.repair` perché il sedimento cresce a ogni crash e un
    /// comando che nessuno lancia non lo ferma: il posto giusto per raccogliere
    /// ciò che un crash ha lasciato è il giro successivo a quel crash.
    ///
    /// Un guasto non risale, per la ragione con cui non risale quello della
    /// raccolta degli spazi per-documento: un residuo che non si è potuto
    /// togliere non impedisce a nessuno di aprire una nota, e la prossima
    /// apertura ci riprova.
    /// **La prima fase dell'apertura** (§15.7): guarda cosa c'è, e basta.
    fn sweep_temporary(&self, temporary: &[Utf8PathBuf]) {
        for path in temporary {
            match self.docs.vault.storage().remove(path) {
                Ok(()) => tracing::info!(
                    target: "fub.kernel",
                    "temporaneo di scrittura rimasto indietro, tolto: {path}"
                ),
                Err(and) => tracing::warn!(
                    target: "fub.kernel",
                    "temporaneo di scrittura {path} non tolto: {and}"
                ),
            }
        }
    }

    ///
    /// Al ritorno il vault è **utilizzabile** — l'anagrafe c'è, le cartelle ci
    /// sono, una nota si apre — e *non* è indicizzato: la ricerca e il grafo
    /// sono vuoti finché la [`Indicizzazione`] che questa funzione consegna non
    /// è stata portata in fondo a fette da
    /// [`plan_batch`](Workspace::plan_batch) e
    /// chiusa da [`finish_index`](Workspace::finish_index).
    ///
    /// **Il `Result` è qui e non altrove**, ed è tutta la ragione per cui il
    /// taglio cade in questo punto: ciò che può far fallire un'apertura è
    /// rimasto solo la scansione
    /// ([0068](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)),
    /// quindi la fase che può fallire e la fase che dura sono due fasi diverse.
    /// Chi apre aspetta la prima e non la seconda.
    // La specie si **ricalcola** e non si rilegge dalla tabella: dipende da
    pub fn prepare_scan_vault(&self) -> Result<PreparedVaultScan> {
        let _phase = tracing::info_span!(target: "fub.apertura", "scan_vault").entered();
        let scanned = self.docs.vault.scan()?;
        self.sweep_temporary(&scanned.temporary_remaining_back);

        // La scansione raccoglie una fotografia completa ma non muta ancora il
        // core: durante `IndexProvider::up_to_date` i reader vedono l'ultimo stato
        // coerente, non metà della nuova anagrafe.
        let entries: Vec<(VaultEntry, Option<StoredEntry>)> = scanned
            .files
            .into_iter()
            .map(|file| {
                let change_stamp = self.docs.vault.change_stamp(&file.id);
                let known = self
                    .entry_store
                    .known(&file.id)
                    .filter(|known| known.describes(file.size, file.mtime))
                    .filter(|known| known.same_change_stamp(change_stamp))
                    .filter(|known| known.fingerprint.is_some());
                let entry = VaultEntry {
                    fingerprint: known.as_ref().and_then(|known| known.fingerprint.clone()),
                    kind: media::kind_of_ext(&file.id, |ext| self.docs.registry.has_doc_ext(ext)),
                    id: file.id,
                    size: file.size,
                    mtime: file.mtime,
                };
                (entry, known)
            })
            .collect();

        let mut documents = Vec::new();
        let mut known_entries = Vec::new();
        let mut assets = Vec::new();
        for (entry, known) in &entries {
            match entry.kind {
                EntryKind::Document => {
                    documents.push(entry.clone());
                    known_entries.push(known.clone());
                }
                EntryKind::Asset => assets.push(entry.clone()),
                _ => {}
            }
        }

        Ok(PreparedVaultScan {
            folders: scanned.folders,
            entries: entries.into_iter().map(|(entry, _)| entry).collect(),
            documents,
            known_entries,
            assets,
            providers: self.indexes.feed_handles(),
        })
    }

    /// Installa atomicamente la fotografia della scansione dopo che le risposte
    /// esterne sono tornate. Nessuna callback provider gira in questa fase.
    pub fn finalize_scan_vault(&mut self, completed: CompletedVaultScan) -> Indexing {
        let CompletedVaultScan {
            prepared:
                PreparedVaultScan {
                    folders,
                    entries,
                    documents,
                    known_entries,
                    assets,
                    providers: _,
                },
            up_to_date,
        } = completed;

        self.indexes.core.clear();
        for folder in folders {
            self.indexes.core.set_folder(folder);
        }
        for entry in entries {
            self.indexes.core.set_entry(entry);
        }

        let mut to_index = Vec::new();
        for (entry, known) in documents.into_iter().zip(known_entries) {
            let metadata = if entry.fingerprint.is_some() && up_to_date.contains(&entry.id) {
                known
                    .filter(|known| known.fingerprint == entry.fingerprint)
                    .and_then(|known| known.metadata.clone())
            } else {
                None
            };
            if let Some(metadata) = metadata {
                self.indexes.core.restore(&entry.id, metadata);
            } else {
                to_index.push(entry);
            }
        }
        to_index.extend(assets);

        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::VaultOpened {
                root: ws.docs.vault.root().to_string(),
            });
            ws.dispatch_pending();
        });
        self.indexes.core.watch.indexing = IndexingState::Running;
        Indexing::new(to_index)
    }

    /// Percorso sincrono per chi possiede direttamente un `Workspace`. L'host,
    /// che usa `Custody`, chiama esplicitamente prepare/invoke/finalize.
    pub fn scan_vault(&mut self) -> Result<Indexing> {
        let completed = self.prepare_scan_vault()?.invoke();
        Ok(self.finalize_scan_vault(completed))
    }

    /// [`FEED_BATCH`] documenti, e torna.
    ///
    /// Torna perché chi la chiama possa fare, fra una fetta e l'altra, le due
    /// cose che una chiamata sola non lascia fare: **guardare la bandiera**
    /// dell'annullamento e **timbrare un progresso**. È la stessa forma con cui
    /// il §20.1 taglia l'alimentazione, applicata un piano più in su: là la
    /// fetta serve a chi riceve, qui serve a chi guarda.
    ///
    /// Chiamarla su un'[`Indicizzazione`] già finita non fa niente.
    ///
    /// **Non è la porta di chi ha i thread**, ed è `pub(crate)` apposta: da
    /// fuori dal kernel una fetta si prepara con [`plan_batch`](Workspace::plan_batch)
    /// e si applica con
    /// [`index_batch_prepared`](Workspace::index_batch_prepared), così la forma
    /// che tiene il prestito esclusivo attraverso il disco **non si scrive**.
    /// Qui resta perché `reindex` è sincrono per definizione: chi lo chiama ha
    /// già il `&mut`, e non c'è nessuno da non far aspettare.
    /// **La metà di una fetta che non ha bisogno del prestito esclusivo**:
    pub(crate) fn index_batch(&mut self, work: &mut Indexing) {
        let prepared = self.plan_batch(work);
        self.index_batch_prepared(prepared);
    }

    /// legge dal disco e parsa fino a [`FEED_BATCH`] documenti, sotto `&self`.
    ///
    /// È la regola della
    /// [decisione 0119](../../../docs/decisions/README.md)
    /// sul suo secondo sito, che quella voce aveva già nominato: la stessa forma
    /// del lotto del watcher, sul percorso dove i file da leggere non sono
    /// quattro ma quattromila. Chi guarda il vault appena aperto — la ricerca,
    /// l'albero, l'autocompletamento — non ha niente a che fare con l'I/O di una
    /// fetta, e prima di questa riga la aspettava tutta.
    ///
    /// Il cursore avanza **qui**, perché è qui che la fetta si prende in carico:
    /// l'[`Indicizzazione`] vive fuori dal workspace, quindi avanzarla non vuole
    /// nessun prestito. E siccome `work` è un `&mut`, due piani sulla stessa
    /// indicizzazione non compilano — l'ordine delle fette lo dice il tipo, come
    /// nella 0119 lo diceva `ExternalSync::batch`.
    // Lo span copre tutto il lavoro parallelo della fetta, `thread::scope`
    pub fn plan_batch(&self, work: &mut Indexing) -> ParsedBatch {
        let checked = self.prepare_index_batch_check(work).invoke();
        self.prepare_index_batch_parse(checked).invoke(work)
    }

    /// Legge soltanto ciò che serve a determinare le impronte della prossima
    /// fetta e cattura gli handle degli indici. Nessuna callback esterna gira
    /// sotto il prestito condiviso del workspace.
    pub fn prepare_index_batch_check(&self, work: &mut Indexing) -> PreparedIndexBatchCheck {
        let slice = work.next_slice();
        let seen: BTreeMap<DocId, Option<Revision>> = slice
            .iter()
            .map(|entry| (entry.id.clone(), self.entry_fingerprint(&entry.id)))
            .collect();
        if slice.is_empty() {
            return PreparedIndexBatchCheck {
                seen,
                entries: Vec::new(),
                discarded: Vec::new(),
                providers: self.indexes.feed_handles(),
            };
        }

        let _phase = tracing::info_span!(target: "fub.apertura", "plan_batch").entered();
        let n = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .clamp(1, 8);
        let docs = &self.docs;
        let chunks: Vec<IndexCheckChunk> = if n > 1 && slice.len() > n {
            let size = slice.len().div_ceil(n);
            std::thread::scope(|scope| {
                let handles: Vec<_> = slice
                    .chunks(size)
                    .map(|chunk| {
                        let chunk = chunk.to_vec();
                        scope.spawn(move || Self::prepare_index_check_chunk(docs, chunk))
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|handle| handle.join().expect("la lettura non esce dal recinto"))
                    .collect()
            })
        } else {
            vec![Self::prepare_index_check_chunk(docs, slice)]
        };

        let mut entries = Vec::new();
        let mut discarded = Vec::new();
        for chunk in chunks {
            entries.extend(chunk.entries);
            discarded.extend(chunk.discarded);
        }
        PreparedIndexBatchCheck {
            seen,
            entries,
            discarded,
            providers: self.indexes.feed_handles(),
        }
    }

    fn prepare_index_check_chunk(
        docs: &DocumentStore,
        entries: Vec<VaultEntry>,
    ) -> IndexCheckChunk {
        let mut out = IndexCheckChunk::default();
        for mut entry in entries {
            let mut source = None;
            match entry.kind {
                EntryKind::Asset if entry.fingerprint.is_none() => {
                    match docs.vault.read_bytes(&entry.id) {
                        Ok(bytes) => entry.fingerprint = Some(Revision::of_bytes(&bytes)),
                        Err(why) => out.discarded.push((entry.id.clone(), why)),
                    }
                }
                EntryKind::Document if entry.fingerprint.is_none() => {
                    match docs.source_from_disk(&entry.id) {
                        Ok(read) => {
                            entry.fingerprint = Some(Revision::of_bytes(read.bytes()));
                            source = Some(read);
                        }
                        Err(why) => out.discarded.push((entry.id.clone(), why)),
                    }
                }
                _ => {}
            }
            out.entries.push(PendingIndexEntry { entry, source });
        }
        out
    }

    /// Risolve cache e parser dopo che `up_to_date` è tornato. Leggere il
    /// sorgente resta sotto un prestito condiviso breve; il parser preparato lo
    /// attraverserà soltanto dopo il rilascio della guardia.
    pub fn prepare_index_batch_parse(&self, checked: CheckedIndexBatch) -> PreparedIndexBatchParse {
        let CheckedIndexBatch {
            seen,
            entries,
            mut discarded,
            already,
        } = checked;
        let discarded_ids: BTreeSet<DocId> = discarded.iter().map(|(id, _)| id.clone()).collect();
        let mut read = Vec::with_capacity(entries.len());
        let mut reused = Vec::new();
        let mut parses = Vec::new();

        for pending in entries {
            let PendingIndexEntry { entry, source } = pending;
            read.push(entry.clone());
            if discarded_ids.contains(&entry.id) || entry.kind != EntryKind::Document {
                continue;
            }
            let remembered = self
                .entry_store
                .known(&entry.id)
                .filter(|known| known.fingerprint == entry.fingerprint)
                .and_then(|known| known.metadata.clone());
            if let Some(metadata) = remembered.filter(|_| already.contains(&entry.id)) {
                reused.push((entry.id.clone(), metadata));
                continue;
            }
            let source = match source {
                Some(source) => source,
                None => match self.docs.source_from_disk(&entry.id) {
                    Ok(source) => source,
                    Err(why) => {
                        discarded.push((entry.id.clone(), why));
                        continue;
                    }
                },
            };
            match self.docs.prepare_parse(&entry.id) {
                Ok(parser) => parses.push(PendingDocumentParse {
                    id: entry.id,
                    parser,
                    source,
                }),
                Err(why) => discarded.push((entry.id, why)),
            }
        }

        PreparedIndexBatchParse {
            read,
            reused,
            parses,
            discarded,
            seen,
        }
    }

    fn invoke_parse_chunk(parses: Vec<PendingDocumentParse>) -> IndexParseChunk {
        let mut out = IndexParseChunk::default();
        for pending in parses {
            match pending.parser.invoke(pending.source) {
                Ok(model) => out.models.push(model),
                Err(why) => out.discarded.push((pending.id, why)),
            }
        }
        out
    }

    /// [`plan_batch`](Workspace::plan_batch).
    ///
    /// **Il piano dichiara cosa credeva di sapere, e chi applica lo verifica**
    /// (0119). Fra la fase condivisa e questa il prestito esclusivo passa di
    /// mano, e un'apertura dura secondi: in mezzo ci sta comodo un salvataggio
    /// dell'utente, che il vault è utilizzabile da quando la scansione è finita.
    /// Applicare qui un modello parsato *prima* di quella scrittura la
    /// cancellerebbe dalla memoria del kernel — sul disco resta, in anagrafe e
    /// negli indici no, e non se ne accorge nessuno fino alla riapertura.
    ///
    /// Il confronto è sull'impronta che l'anagrafe dà al documento, ed è la
    /// stessa di [`sync_path_prepared`](Workspace::sync_path_prepared): ogni
    /// scrittura che passa dal kernel la alza (`touch_entry`), quindi «l'impronta
    /// è un'altra» vuol dire esattamente «qualcuno ha scritto mentre leggevo».
    /// Non è mtime+size: quelli bastano a *saltare* un file, non a credergli
    /// (§14.1).
    ///
    /// Un documento invecchiato si **butta e basta**, senza rifare la strada:
    /// chi ha scritto in mezzo lo ha già parsato, alimentato agli indici e messo
    /// in anagrafe con l'impronta giusta. Rileggerlo dal disco vorrebbe dire
    /// rifare il lavoro di qualcun altro per arrivare al suo stesso risultato —
    /// ed è la differenza con la 0119, dove il piano buttato era l'unica notizia
    /// che quel file fosse cambiato.
    // L'impronta appena calcolata torna in anagrafe: la voce c'era già
    pub fn commit_index_batch_prepared(
        &mut self,
        prepared: ParsedBatch,
    ) -> Option<PreparedIndexBatchFeed> {
        let ParsedBatch {
            read,
            reused,
            models,
            seen,
        } = prepared;
        let aged: BTreeSet<DocId> = seen
            .into_iter()
            .filter(|(id, expected)| self.entry_fingerprint(id) != *expected)
            .map(|(id, _)| id)
            .collect();

        for entry in read {
            if entry.fingerprint.is_some() && !aged.contains(&entry.id) {
                self.indexes.core.set_entry_from_scan(entry);
            }
        }
        for (id, metadata) in reused {
            if aged.contains(&id) {
                continue;
            }
            self.indexes.core.restore(&id, metadata);
        }
        let models: Vec<DocumentModel> = models
            .into_iter()
            .filter(|model| !aged.contains(&model.id))
            .collect();
        if models.is_empty() {
            return None;
        }

        let losses = self.indexes.core.on_documents_indexed(&models);
        let providers = self.indexes.feed_handles();
        Some(PreparedIndexBatchFeed {
            models,
            providers,
            losses,
        })
    }

    pub fn finalize_index_batch_prepared(&mut self, pending: PreparedIndexBatchFeed) {
        self.report_losses(pending.losses);
    }

    pub fn index_batch_prepared(&mut self, prepared: ParsedBatch) {
        if let Some(pending) = self.commit_index_batch_prepared(prepared) {
            let pending = pending.invoke_indexes();
            self.finalize_index_batch_prepared(pending);
        }
    }

    /// (id, alias, link), e tiene il prestito condiviso solo per quella copia:
    /// [`GraphSources::build`] gira dopo, senza lucchetto
    /// ([0024](../../../docs/decisions/README.md)).
    ///
    /// Chi ha i thread la chiama sotto prestito condiviso, poi costruisce, poi
    /// consegna il risultato a [`finish_index_with_graph`].
    /// **La chiusura dell'apertura** (§15.7): il grafo, la riconciliazione, e i
    pub fn graph_sources(&self) -> GraphSources {
        let _phase = tracing::info_span!(target: "fub.apertura", "graph_sources").entered();
        GraphSources::from_docs(
            self.indexes.core.metas.values(),
            self.indexes.core.graph_epoch,
        )
    }

    /// guasti di ciò che non si è letto.
    ///
    /// Si chiama sia su un'indicizzazione arrivata in fondo sia su una
    /// **interrotta**, e la differenza sta in una riga sola — chi ha smesso a
    /// metà non riconcilia. Il resto si fa comunque: ciò che è stato
    /// alimentato è buono, e buttarlo perché non è tutto vorrebbe dire che
    /// annullare costa più che non aver cominciato.
    ///
    /// Il grafo si ricostruisce **qui** quando chi chiama ha già il prestito
    /// esclusivo in mano (`reindex`, i test). Chi ha i thread usa
    /// [`finish_index_with_graph`]: a caldo `restore` non tocca il grafo, e
    /// rifarlo sotto esclusivo congelerebbe l'UI per tutto il vault
    /// (`a_reopening_a_warm_has_the_same_graph_of_a_a_cold`).
    ///
    /// Il flush degli indici è una **fase sua** (difetto 0113): sta qui solo
    /// perché questo percorso è sincrono e chi chiama tiene già il prestito
    /// esclusivo — non c'è concorrenza da servire. Chi ha i thread la fa
    /// seguire a [`finish_index_with_graph`] in un prestito esclusivo
    /// separato, come la terza fase di `ExternalSync::batch`: fra la chiusura
    /// dell'indicizzazione e la durevolezza il lucchetto si rilascia, e i
    /// lettori in coda passano.
    // Gli errori di flush non fanno fallire l'apertura del vault: un
    pub fn finish_index(&mut self, work: Indexing) -> Opening {
        let _phase = tracing::info_span!(target: "fub.apertura", "finish_index").entered();
        self.indexes.core.rebuild_graph();
        let ids = self.reconcile_ids(&work);
        let external_losses = if work.finished() {
            reconcile_index_handles(&self.indexes.feed_handles(), &ids)
        } else {
            Vec::new()
        };
        let opening = self.close_indexing(work, external_losses);
        // indice è stato derivato, il vault è la verità (M4: notifica).
        // Come [`finish_index`], col grafo già costruito fuori dal prestito
        {
            let _phase = tracing::info_span!(target: "fub.apertura", "flush_indexes").entered();
            let _ = self.flush_indexes();
        }
        self.store_entries();
        opening
    }

    /// esclusivo. Se l'epoca non coincide — una scrittura è arrivata in mezzo —
    /// lo ricostruisce qui dai metadati correnti.
    ///
    /// Il flush degli indici non sta qui (difetto 0113): è una fase sua, con
    /// un prestito esclusivo proprio, e chi ha i thread la fa seguire a questa
    /// funzione — fra i due prestiti il lucchetto si rilascia e i lettori in
    /// coda passano, come nella terza fase di `ExternalSync::batch`.
    // **Gli scarti entrano nell'insieme completo**, e non è un
    /// Prepara la chiusura senza eseguire provider. Il turno di scrittura può
    /// restare aperto mentre la guardia del workspace viene rilasciata.
    pub fn prepare_finish_index_with_graph(
        &self,
        work: Indexing,
        graph: BuiltGraph,
    ) -> PreparedIndexFinish {
        let ids = self.reconcile_ids(&work);
        PreparedIndexFinish {
            work,
            graph,
            ids,
            providers: self.indexes.feed_handles(),
        }
    }

    /// Installa grafo e stato soltanto dopo che `reconcile` dei provider è
    /// tornato. Questa fase non attraversa codice esterno.
    pub fn finalize_finish_index(&mut self, completed: CompletedIndexFinish) -> Opening {
        let CompletedIndexFinish {
            prepared:
                PreparedIndexFinish {
                    work,
                    graph,
                    ids: _,
                    providers: _,
                },
            external_losses,
        } = completed;
        if graph.epoch == self.indexes.core.graph_epoch {
            self.indexes.core.graph = graph.graph;
        } else {
            self.indexes.core.rebuild_graph();
        }
        self.close_indexing(work, external_losses)
    }

    pub fn finish_index_with_graph(&mut self, work: Indexing, graph: BuiltGraph) -> Opening {
        let completed = self.prepare_finish_index_with_graph(work, graph).invoke();
        self.finalize_finish_index(completed)
    }

    fn reconcile_ids(&self, work: &Indexing) -> Vec<DocId> {
        if !work.finished() {
            return Vec::new();
        }
        let mut ids: Vec<DocId> = self.documents();
        ids.extend(
            work.opening
                .discarded
                .iter()
                .map(|discard| discard.id.clone()),
        );
        ids.sort();
        ids.dedup();
        ids
    }

    fn close_indexing(&mut self, work: Indexing, external_losses: Vec<IndexLoss>) -> Opening {
        let mut opening = work.opening;
        if work.cursor >= work.from_do.len() {
            // dettaglio. `reconcile` dice agli indici *quali documenti
            // esistono*, così ognuno cancella ciò che è sparito ad app chiusa;
            // un documento che non si è potuto leggere **non è sparito** — il
            // file c'è, è la vista sul suo contenuto che manca. Ometterlo
            // direbbe agli indici una cosa falsa, e alla prima apertura con un
            // permesso storto la nota uscirebbe dalla ricerca in silenzio.
            // **Un'indicizzazione interrotta non riconcilia**, ed è la stessa
            let mut ids: Vec<DocId> = self.documents();
            ids.extend(opening.discarded.iter().map(|discard| discard.id.clone()));
            ids.sort();
            ids.dedup();
            let mut lost = {
                let _phase = tracing::info_span!(target: "fub.apertura", "reconcile").entered();
                self.indexes.core.reconcile(&ids)
            };
            lost.extend(external_losses);
            self.report_losses(lost);
        } else {
            // riga con cui la 0068 tiene fatale la scansione: un insieme
            // incompleto non si dichiara completo. Qui l'insieme non è bucato
            // da un permesso ma da un pulsante, e la conseguenza sarebbe la
            // stessa e peggiore — dire a ogni indice di dimenticare tutto ciò
            // che l'annullamento non ha fatto in tempo a nominare, cioè
            // trasformare «ho smesso di indicizzare» in «cancella».
            // **Il flush non sta qui** (difetto 0113): è una fase sua, con un
            opening.interrupted = true;
        }
        self.indexes.core.watch.indexing = if opening.interrupted {
            IndexingState::Stopped
        } else {
            IndexingState::Ready
        };
        // prestito esclusivo proprio, come la terza fase di `ExternalSync::batch`.
        // Qui dentro restano le fasi che toccano lo stato condiviso — la
        // riconciliazione delle tabelle degli indici, il ricongiungimento delle
        // rinomine che cammina l'anagrafe, gli eventi — e chi chiama
        // (`finish_index`, il runner) fa seguire il flush da sé, fra un prestito
        // e l'altro: un lettore concorrente non aspetta la somma delle fasi ma
        // la sola che sta correndo.
        // **Prima si riconosce, poi si raccoglie** (§23.1), e l'ordine è tutto:

        // ciò che una rinomina fatta ad app chiusa ha lasciato sotto il nome
        // vecchio, per la raccolta è indistinguibile da ciò che è rimasto di una
        // nota cancellata. Invertire le due righe vorrebbe dire cancellare i
        // dati un istante prima di sapere di chi sono.
        //
        // Solo se l'apertura è arrivata in fondo: da un'anagrafe parziale
        // «sparito» e «non ancora guardato» sono la stessa cosa.
        // I guasti erano nello stesso lotto di `VaultOpened`, perché chi si
        if !opening.interrupted {
            self.suspended_from_rejoin = self.rejoin_renamed_while_closed();
        }

        self.as_actor(Actor::Kernel, |ws| {
            // abbonava per disegnare il vault appena aperto avesse già in mano
            // ciò che di quel vault non si era letto. Con le fasi quel lotto
            // non esiste più — gli scarti si scoprono *dopo* che il vault è
            // aperto, per definizione — e la promessa che resta è più debole e
            // vera: chi disegna un albero lo disegna intero, e ciò che di quei
            // documenti non si è potuto leggere arriva mentre l'indicizzazione
            // procede, sulla stessa superficie di prima (`Event::Trouble`).
            // Rimette in anagrafe un file che è appena cambiato, chiedendo al disco
            for discard in &opening.discarded {
                ws.report_trouble(
                    Severity::Failure,
                    Some(discard.id.clone()),
                    discard.why.clone(),
                    None,
                );
            }
            ws.emit_event(Event::IndexUpdated);
            ws.dispatch_pending();
        });
        opening
    }

    /// quanto è grande e di quando è (§14.1).
    ///
    /// Un file che non c'è più esce dall'anagrafe invece di restarci con i
    /// numeri di prima: `stat` che non risponde e file sparito sono la stessa
    /// cosa per chi tiene un elenco di ciò che esiste.
    ///
    /// La **specie** si ricalcola qui e non si porta dietro: è la stessa regola
    /// della scansione, e vale anche a metà sessione — un provider registrato
    /// dopo l'apertura cambia cosa è un documento.
    /// La metà di [`touch_entry`](Workspace::touch_entry) **che non guarda il
    fn touch_entry(&mut self, id: &DocId, fingerprint: Option<Revision>) -> Option<EntryKind> {
        let Some((size, mtime)) = self.docs.vault.stat(id) else {
            return self.indexes.core.remove_entry(id);
        };
        Some(self.set_entry(id, size, mtime, fingerprint))
    }

    /// disco**: mette in anagrafe una dimensione e una data che il chiamante
    /// già sa.
    ///
    /// Le sa chi ha appena scritto — [`Vault::write`](crate::Vault::write) le
    /// rende insieme all'esito — e chiederle di nuovo era il difetto 0179: fra
    /// la scrittura riuscita e la `stat` ci sta la cancellazione di un altro
    /// processo, e in quella finestra l'anagrafe *toglieva la voce* di un
    /// documento che aveva appena risposto `Ok` e per cui era già uscito
    /// `DocumentChanged`. Il rimedio non è guardare meglio: è non guardare
    /// affatto, perché la risposta era già in mano.
    ///
    /// Chi invece **non** ha scritto niente — il rilevatore, un ripristino dal
    /// cestino — passa da `touch_entry`, dove togliere la voce di un file che
    /// non c'è è la risposta giusta.
    // Un file che c'è dice che le cartelle che attraversa ci sono (§14.3):
    fn set_entry(
        &mut self,
        id: &DocId,
        size: u64,
        mtime: u64,
        fingerprint: Option<Revision>,
    ) -> EntryKind {
        let kind = media::kind_of_ext(id, |ext| self.docs.registry.has_doc_ext(ext));
        // senza questa riga una nota creata in una cartella nuova comparirebbe
        // in un albero che quella cartella non conosce fino alla riapertura.
        // Scrive l'anagrafe, perché la prossima apertura non debba rifare ciò che
        self.indexes.core.ensure_folders_of(id);
        self.indexes.core.set_entry(VaultEntry {
            id: id.clone(),
            kind,
            size,
            mtime,
            fingerprint,
        });
        kind
    }

    /// questa ha appena fatto (§14.2).
    ///
    /// Si scrive **qui e alla chiusura** — i due chiamanti sono
    /// [`finish_index`](Workspace::finish_index) e
    /// [`close_with`](Workspace::close_with) — e non a ogni salvataggio: è un
    /// file che contiene una riga per file del vault, e riscriverlo a ogni
    /// battuta sarebbe pagare l'intero vault per un documento. Fra un giro e
    /// l'altro l'anagrafe vive in memoria; se il processo muore prima di
    /// scriverla, la riapertura rilegge ciò che si è toccato da quando è stata
    /// scritta l'ultima volta — cioè si comporta come prima che questa voce
    /// esistesse, che è il degrado giusto per un dato derivato.
    ///
    /// Non tocca lo stato condiviso del workspace — legge le tabelle degli
    /// indici e scrive su disco — e per questo (difetto 0113) chi ha i thread
    /// la chiama sotto prestito **condiviso**, fuori dal prestito esclusivo
    /// della chiusura dell'indicizzazione: un lettore concorrente non aspetta
    /// la riscrittura dell'anagrafe insieme alle fasi in memoria.
    ///
    /// L'esito non risale, e non perché non interessi: un'apertura riuscita non
    /// deve fallire perché una cache non si è scritta. Non finisce nemmeno in
    /// [`IndexQuery::VaultStatus`](fub_abi::traits::IndexQuery::VaultStatus),
    /// che è il fatto interrogabile del §9.7 e dice un'altra cosa — *questo
    /// vault vede le scritture altrui* —: allargarlo a «e poi non ho scritto una
    /// cache» renderebbe quel numero la somma di due incidenti diversi. Va su
    /// `stderr` come il sidecar del cestino, ed è il §20.2 che gli darà una
    /// destinazione vera.
    /// # Ciò che si è visto nel proprio istante non si scrive
    ///
    /// Una voce la cui data non era nel passato quando la si è letta non è
    /// affidabile per la **prossima** apertura, e qui è dove quella risposta —
    /// presa al momento dell'osservazione, che è l'unico in cui la domanda ha
    /// senso — si spende (difetto 0187). Saltarla costa la rilettura di quel
    /// file alla riapertura; scriverla costerebbe un indice fermo su un
    /// contenuto vecchio fino al primo evento che tornasse a toccare quel file,
    /// e se nessuno lo toccasse, per sempre.
    /// Elenco ordinato dei documenti indicizzati.
    pub fn store_entries(&self) {
        let _phase = tracing::info_span!(target: "fub.apertura", "store_entries").entered();
        let table = self
            .indexes
            .core
            .entries
            .values()
            .filter(|entry| !self.indexes.core.observed_at_the_same_instant(&entry.id))
            .map(|entry| {
                (
                    entry.id.clone(),
                    StoredEntry {
                        size: entry.size,
                        mtime: entry.mtime,
                        change_stamp: self.docs.vault.change_stamp(&entry.id),
                        identity: self.docs.vault.file_identity(&entry.id),
                        fingerprint: entry.fingerprint.clone(),
                        metadata: self.indexes.core.stored_metadata(&entry.id),
                    },
                )
            })
            .collect();
        if let Err(and) = self.entry_store.store(table) {
            tracing::warn!(target: "fub.kernel", "anagrafe: {and}");
        }
    }

    ///
    /// L'ordine non si impone più a ogni chiamata: la cache dei metadati è
    /// ordinata per costruzione (§5.5). Chi ne vuole una **finestra** non passa
    /// di qui ma da
    /// [`VaultRead::list_documents`](fub_abi::traits::VaultRead::list_documents),
    /// che non materializza il resto.
    /// Una finestra sui documenti indicizzati, col conto di quanti sono.
    pub fn documents(&self) -> Vec<DocId> {
        self.indexes.core.documents()
    }

    /// Le estensioni che i provider registrati riconoscono (minuscole, senza
    pub fn documents_page(&self, page: Option<Page>) -> Paged<DocId> {
        let total = self.indexes.core.metas.len() as u32;
        let Some(page) = page else {
            return Paged::all(self.indexes.core.documents());
        };
        Paged {
            items: self
                .indexes
                .core
                .ids()
                .skip(page.offset as usize)
                .take(page.limit as usize)
                .cloned()
                .collect(),
            offset: page.offset,
            total,
        }
    }

    /// punto), ordinate.
    ///
    /// Serve a chi disegna: il "nome pagina" di un documento è il basename
    /// senza l'estensione **gestita**, e quale sia dipende dai provider —
    /// cablare `.md` nel frontend è vero solo finché markdown è l'unico
    /// formato, cioè finché il progetto non fa ciò per cui esiste.
    /// Sorgente grezza di un documento dal disco.
    pub fn extensions(&self) -> Vec<String> {
        let mut exts = self.docs.registry.all_extensions();
        exts.sort();
        exts
    }

    /// I byte di un documento, senza decodificarli (§21.8).
    pub fn read_source(&self, id: &DocId) -> Result<String> {
        self.docs.vault.read(id)
    }

    ///
    /// Non è una variante di comodo di [`Workspace::read_source`]: è la sola
    /// forma in cui un allegato — un PDF, un audio — si lascia leggere, e chi la
    /// chiama è chi da quei byte tira fuori del testo.
    /// Scrive la sorgente, riparsa il documento, aggiorna il grafo ed emette
    pub fn read_source_bytes(&self, id: &DocId) -> Result<Vec<u8>> {
        self.docs.vault.read_bytes(id)
    }

    /// gli eventi (il grafo per-documento, [`GraphUpdate`]) — dicendo **da cosa
    /// si parte** (§18.1).
    ///
    /// Con [`WriteBase::DescendsFrom`] la revisione attesa è quella che chi
    /// scrive si aspetta di trovare sul disco: se non combacia si risponde
    /// [`KernelError::Stale`] e non si tocca niente. È la guardia che
    /// `apply_edit` ha dalla
    /// [0008](../../../docs/decisions/README.md) e che questa
    /// metà non aveva, cioè il buco per cui il salvataggio dell'editor
    /// **copriva** una scrittura altrui che il watcher non aveva visto.
    ///
    /// Con [`WriteBase::Dictated`] la guardia non c'è perché non ci sarebbe
    /// niente da guardare, ed è una **dichiarazione**: fino alla
    /// [0092](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md) esisteva
    /// anche una `write_document` a due argomenti, che voleva dire `Dictated`
    /// senza dirlo. Era la stessa trappola del contratto, in casa: due firme per
    /// la stessa domanda, di cui una cieca e più corta da scrivere.
    ///
    /// Il confronto è col **disco** e non con l'anagrafe, per la ragione di
    /// [`document_revision`](Workspace::document_revision): la verità di un
    /// documento è il file, e una guardia che si fidasse di una cache
    /// direbbe di sì proprio nel caso in cui la cache è indietro — che è
    /// esattamente il caso che deve prendere. La lettura in più si paga **solo**
    /// quando qualcuno la chiede: una scrittura dettata legge dalla memoria come
    /// prima, perché una riga di registro non vale una lettura a ogni
    /// salvataggio (§15.2).
    // Cosa si sapeva **prima**: l'impronta che l'anagrafe teneva, e se il
    pub fn prepare_document_write(
        &self,
        id: &DocId,
        base: WriteBase,
    ) -> Result<PreparedDocumentWrite> {
        let (id, existed, from, expected_source) = match base {
            WriteBase::DescendsFrom(expected) => {
                let current = crate::error::optional(self.docs.vault.read(id))?;
                let now = current.as_ref().map(|s| Revision::of(s));
                if !current
                    .as_deref()
                    .is_some_and(|source| expected.matches(source))
                {
                    return Err(KernelError::Stale(id.to_string()));
                }
                (id.clone(), true, now, current)
            }
            WriteBase::Dictated => {
                let in_store = self.indexes.core.entries.get(id);
                let candidate = new_doc_id(id.as_str());
                let unchanged_portable =
                    in_store.is_some() && candidate.as_ref().is_ok_and(|candidate| candidate == id);
                let normalized_exists = !unchanged_portable
                    && candidate.as_ref().is_ok_and(|candidate| {
                        candidate != id && self.docs.vault.stat(candidate).is_some()
                    });
                let raw_exists = !unchanged_portable && self.docs.vault.stat(id).is_some();
                let normalized_aliases_raw = normalized_exists
                    && raw_exists
                    && candidate
                        .as_ref()
                        .is_ok_and(|candidate| self.docs.vault.same_file(id, candidate));
                let use_normalized = normalized_exists && (!raw_exists || normalized_aliases_raw);
                let existed = unchanged_portable || normalized_exists || raw_exists;
                if existed {
                    let id = if use_normalized {
                        candidate
                            .as_ref()
                            .expect("a normalized existing target")
                            .clone()
                    } else {
                        id.clone()
                    };
                    let in_store = self.indexes.core.entries.get(&id);
                    let fingerprint = in_store.and_then(|and| and.fingerprint.clone());
                    (id, true, fingerprint, None)
                } else {
                    let id = candidate?;
                    let in_store = self.indexes.core.entries.get(&id);
                    let fingerprint = in_store.and_then(|and| and.fingerprint.clone());
                    let existed = self.docs.vault.stat(&id).is_some();
                    (id, existed, existed.then_some(fingerprint).flatten(), None)
                }
            }
        };
        let parser = self.docs.prepare_parse(&id)?;
        Ok(PreparedDocumentWrite {
            id,
            existed,
            from,
            expected_source,
            parser,
            before_write: self.before_write.clone(),
        })
    }

    /// Finalizza una scrittura già parsata. La CAS resta qui, sotto il writer
    /// turn, quindi il tempo passato nel provider non allarga la finestra fra
    /// expected e write per gli altri writer Fub.
    /// Finalizza una scrittura già parsata e con il gancio già tornato. La CAS
    /// resta qui, sotto il writer turn: nessun writer Fub può infilarsi fra la
    /// base preparata e la sostituzione, mentre il provider gira senza RwLock.
    pub fn commit_document_write(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<PreparedDocumentFeed> {
        let PreparedDocumentWrite {
            id,
            existed,
            from,
            expected_source,
            ..
        } = prepared;
        if let Err(and) = before_write {
            return Err(Self::before_write_error(&id, and));
        }
        let placed = if let Some(expected) = expected_source.as_deref() {
            self.docs
                .vault
                .write_if_unchanged(&id, expected, source)?
                .ok_or_else(|| KernelError::Stale(id.to_string()))?
        } else {
            self.docs.vault.write(&id, source)?
        };
        let revision = Revision::of(source);
        let changes = self.indexes.core.changes_for(&model, &revision);
        self.set_entry(&id, placed.0, placed.1, Some(revision.clone()));
        let losses = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let providers = self.indexes.feed_handles();
        let journal = if existed {
            JournalOp::Written {
                doc: id.clone(),
                from,
                to: revision.clone(),
            }
        } else {
            JournalOp::Created {
                doc: id.clone(),
                to: revision.clone(),
            }
        };
        Ok(PreparedDocumentFeed {
            id,
            model,
            changes,
            revision,
            journal,
            providers,
            losses,
        })
    }

    pub fn finalize_document_write(&mut self, pending: PreparedDocumentFeed) -> Result<Revision> {
        let revision = pending.revision.clone();
        let journal = pending.journal.clone();
        self.finish_index_feed(pending);
        self.dispatch_pending();
        self.record(journal);
        Ok(revision)
    }

    pub fn finish_document_write(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<Revision> {
        let pending = self.commit_document_write(prepared, source, model, before_write)?;
        let pending = pending.invoke_indexes();
        self.finalize_document_write(pending)
    }

    pub fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision> {
        let prepared = self.prepare_document_write(id, base)?;
        let model = prepared.parse(source)?;
        let before_write = if let Some(owner) = prepared.before_write_owner().map(str::to_owned) {
            let mut host = self.host_for(&owner, InvokeMode::Apply);
            prepared.invoke_before_write(&mut host)
        } else {
            Ok(())
        };
        self.finish_document_write(prepared, source, model, before_write)
    }

    /// coda di ogni scrittura, eventi. Rende la revisione prodotta.
    ///
    /// Esiste perché i tre chiamanti raccontano tre cose diverse al registro —
    /// un salvataggio, una modifica chirurgica, un ripristino dal cestino — e
    /// senza questa separazione ognuno ne avrebbe scritte **due**: la propria e
    /// quella di `write_document`, cioè una mutazione contata due volte in una
    /// lista che esiste per essere ripercorsa.
    // Il parse è puro: farlo PRIMA di scrivere tiene la mutazione atomica.
    fn write_source(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
    ) -> Result<Revision> {
        let model = self.docs.parse(id, source)?;
        if let Some((plugin, hook)) = self.before_write.clone() {
            let mut host = self.host_for(&plugin, InvokeMode::Apply);
            if let Err(and) = hook(&mut host, id) {
                return Err(Self::before_write_error(id, and));
            }
        }
        self.write_source_parsed(id, source, expected_source, model)
    }

    /// Seconda metà di `write_source`: da qui in poi il modello è già stato
    /// prodotto. Restano hook, storage/CAS, ingestione ed eventi.
    /// Seconda metà di `write_source`: parse e gancio sono già tornati. Da qui
    /// in poi restano soltanto storage/CAS, ingestione ed eventi.
    fn before_write_error(id: &DocId, and: PluginError) -> KernelError {
        match and {
            PluginError::Io(why) => KernelError::Io {
                path: id.to_string().into(),
                source: std::io::Error::other(why.to_string()),
            },
            other => KernelError::BadEdit {
                doc: id.to_string(),
                why: other.to_string(),
            },
        }
    }

    fn write_source_parsed(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
        model: DocumentModel,
    ) -> Result<Revision> {
        let placed = if let Some(expected) = expected_source {
            self.docs
                .vault
                .write_if_unchanged(id, expected, source)?
                .ok_or_else(|| KernelError::Stale(id.to_string()))?
        } else {
            self.docs.vault.write(id, source)?
        };
        let revision = Revision::of(source);
        self.ingest_model(id, model, revision.clone(), Some(placed));
        self.dispatch_pending();
        Ok(revision)
    }

    ///
    /// Si chiama **dopo** che la mutazione è riuscita, e l'ordine è la decisione
    /// ([0067](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)):
    /// un crash può far perdere la coda del registro — le ultime operazioni non
    /// si potranno annullare — e mai il contrario, una riga che racconta
    /// qualcosa che non è successo.
    ///
    /// L'esito non risale, come per l'anagrafe e per il sidecar del cestino: una
    /// scrittura riuscita non deve fallire perché il suo registro non si è
    /// scritto. A differenza dell'anagrafe però qui si **perde qualcosa** — un
    /// pezzo di ciò che è successo, che non si ricostruisce da niente — quindi
    /// non è un `warn` e basta: è un guasto che esce anche dal canale (0052,
    /// 0062), perché chi importa cinquecento note ha il diritto di sapere che
    /// quella riga non sarà annullabile.
    /// Ciò che è successo a questo vault, e **cosa non si è potuto leggere**
    fn record(&mut self, op: JournalOp) {
        let origin = self.dispatch.origin();
        if let Err(and) = self.journal.append(origin, op) {
            self.report_trouble(
                Severity::Failure,
                None,
                PluginError::Internal(format!("registro: {and}").into()),
                None,
            );
        }
    }

    /// (§15.2).
    ///
    /// È la lettura del registro come sta sul disco, non una cache in memoria:
    /// sullo stesso file scrivono anche le altre installazioni aperte sulla
    /// stessa cartella, e una copia in memoria mostrerebbe solo le proprie
    /// righe.
    ///
    /// **Un registro che non si legge non è un registro vuoto** (§15.2): il
    /// file assente resta una `JournalRead` vuota, ogni altro guasto del supporto
    /// arriva qui come [`KernelError::Io`] col path che non si è potuto
    /// aprire.
    /// Pota il registro alla finestra dichiarata (§23.9).
    pub fn journal(&self) -> Result<JournalRead> {
        self.journal.read().map_err(|and| KernelError::Io {
            path: self.journal.path().to_owned(),
            source: and,
        })
    }

    ///
    /// Una funzione sola per i due momenti in cui la finestra si sa — la si è
    /// appena dichiarata, o l'utente l'ha appena cambiata — invece della stessa
    /// lettura scritta due volte: il giorno che se ne aggiunge un terzo, quel
    /// terzo la eredita.
    ///
    /// Una chiave che non c'è vale zero, cioè *per sempre*: è la regola di
    /// [`FieldWeights::read`](fub_features) applicata qui — un'impostazione che
    /// manca fa cadere nel default, non in un guasto — e per un registro
    /// autorevole il default che non perde niente è l'unico difendibile.
    // -----------------------------------------------------------------------
    fn prunes_the_record(&self) {
        let days = match self.setting(crate::journal::RETENTION_DAYS) {
            Ok(SettingValue::Number(n)) if n > 0.0 => n as u64,
            _ => 0,
        };
        self.journal.prune(days);
    }

    // Le bozze (§15.2)
    // -----------------------------------------------------------------------
    //
    // Tre righe e non una capacità dell'`HostApi`, ed è una scelta: il testo
    // che l'utente non ha ancora salvato è il dato più privato che il vault
    // contenga, e una porta su `HostApi` lo consegnerebbe a **ogni** plugin
    // montato — compresi quelli che a M5 non scriviamo noi. Chi ha bisogno di
    // scriverci è la shell, che non è un plugin.
    /// Scrive la bozza di un documento: ciò che c'è nel buffer adesso.
    ///
    ///
    /// `base` è la revisione del file su cui il buffer sta lavorando (`None`
    /// per una nota mai salvata) e non si deduce qui di proposito: dedurla
    /// vorrebbe dire rileggere il file a ogni battuta, e per giunta darebbe la
    /// revisione di **adesso** invece di quella su cui l'utente stava
    /// scrivendo — cioè proprio l'informazione che serve per accorgersi che il
    /// file è cambiato sotto.
    /// Butta la bozza di un documento: il buffer è tornato pulito, o l'utente ha
    pub fn save_draft(
        &mut self,
        doc: &DocId,
        text: &str,
        base: Option<Revision>,
    ) -> std::io::Result<()> {
        let at = crate::time::now_unix_millis();
        self.drafts.save(doc, text, base, at)
    }

    /// scelto di scartarla.
    /// Le bozze di questo vault, **e quante non si sono lette**.
    pub fn discard_draft(&mut self, doc: &DocId) -> std::io::Result<()> {
        self.drafts.discard(doc)
    }

    ///
    /// Dal disco e non da una cache, per la ragione del registro: dopo un crash
    /// non c'è nessuna memoria da consultare, ed è l'unico momento in cui questa
    /// domanda conta davvero.
    ///
    /// E una cartella che **non si legge** non è una cartella senza bozze: là
    /// dentro c'è l'unica copia di ciò che l'utente ha scritto e non ha ancora
    /// salvato, quindi il guasto risale con il path invece di diventare un
    /// elenco vuoto.
    /// La revisione del sorgente di un documento: l'identità del testo su cui
    pub fn drafts(&self) -> Result<crate::drafts::DraftRead> {
        self.drafts.read().map_err(|and| KernelError::Io {
            path: self.drafts.dir().to_owned(),
            source: and,
        })
    }

    /// una modifica chirurgica va calcolata (decisione 0008).
    ///
    /// Si legge dal **disco**, come ogni altra lettura del kernel: la verità di
    /// un documento è il file, e una revisione derivata da una cache sarebbe
    /// vera solo finché la cache lo è.
    /// Applica una modifica chirurgica: gli edit della richiesta, tutti o
    pub fn document_revision(&self, id: &DocId) -> Result<Revision> {
        Ok(Revision::of(&self.read_source(id)?))
    }

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
    // Nel registro va l'**impronta** e non l'inverso: dove la modifica ha
    pub fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport> {
        let source = self.read_source(id)?;
        let (next, report) = request.apply_to(&source).map_err(|and| match and {
            PluginError::Conflict(_) => KernelError::Stale(id.to_string()),
            other => KernelError::BadEdit {
                doc: id.to_string(),
                why: other.to_string(),
            },
        })?;
        if report.is_empty() {
            return Ok(report);
        }
        let from = request.base.clone();
        let to = self.write_source(id, &next, Some(&source))?;
        // toccato e quanto ha sostituito, mai con cosa (0103). Non è
        // `report.inverse()` a cui si toglie il testo — quella funzione qui non
        // si chiama affatto, così i byte dell'utente non passano nemmeno per una
        // variabile sulla strada del disco.
        // Riparsa un documento già presente sul disco (usato dal file watcher).
        self.record(JournalOp::Edited {
            doc: id.clone(),
            from,
            to,
            footprint: crate::journal::EditFootprint::of(&report.applied),
        });
        Ok(report)
    }

    ///
    /// L'origine è [`Actor::Watcher`] (decisione 0012): questa modifica non è passata da
    /// noi, e chi la riceve — la shell col buffer aperto, un'automazione — deve
    /// poterla distinguere da una scrittura che ha chiesto lui.
    ///
    /// **Ciò che il kernel ha già in memoria non si riparsa**: risponde `false`
    /// e non emette niente, che è la verità — nessuno ha cambiato niente da
    /// quando lo si è letto l'ultima volta. Vedi
    /// [`already_ingested`](Workspace::already_ingested) per il perché.
    // Il file sta ancora cambiando, o è sparito fra le due `stat`
    pub fn refresh_from_disk(&mut self, id: &DocId) -> Result<bool> {
        self.as_actor(Actor::Watcher, |ws| {
            let Some(src) = ws.source_if_stable(id)? else {
                // (difetto 0197). Non è un fallimento: il debounce del
                // rilevatore riproverà, e ingerire la metà sarebbe il difetto.
                // La coda di ogni scrittura: indici, conteggi tag, grafo, metadati in
                return Ok(false);
            };
            if ws.already_ingested(id, &Revision::of(&src)) {
                return Ok(false);
            }
            ws.ingest(id, &src)?;
            ws.dispatch_pending();
            Ok(true)
        })
    }

    fn ingest(&mut self, id: &DocId, source: &str) -> Result<()> {
        let model = self.docs.parse(id, source)?;
        self.ingest_model(id, model, Revision::of(source), None);
        Ok(())
    }

    /// cache, eventi. Prende il modello già parsato — è ciò che permette a
    /// `write_document` di parsare prima di toccare il disco.
    ///
    /// `posato` è **dimensione e data di ciò che sta sul disco, per chi le sa
    /// già**: chi ha appena scritto le ha ricevute dal supporto insieme
    /// all'esito, e non deve tornare a chiederle (difetto 0179, vedi
    /// [`set_entry`](Workspace::set_entry)). `None` per chi porta dentro un
    /// cambiamento che non ha fatto lui.
    // Una rinomina esterna spezzata dal debounce arriva come «sparito» e
    fn ingest_model(
        &mut self,
        id: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
        placed: Option<(u64, u64)>,
    ) {
        // poi «nato» (difetto 0198). Se il nato ha l'impronta di chi è appena
        // sparito, è la stessa nota: lo stato attaccato la segue. Uno a uno e
        // per impronta, come la 0099; se `id` è già in anagrafe non è una
        // rinomina (0135).
        // **E poi si dice**, con lo stesso evento della rinomina
        if !self.indexes.core.metas.contains_key(id) {
            if let Some((from, fp)) = self.last_removed.take() {
                if from != *id && fp == fingerprint {
                    self.migrate_side_data(&from, id);
                    // vista: chi tiene stato per-documento fuori dallo spazio
                    // dichiarato — il versioning, che ha uno store suo perché
                    // deve sopravvivere alla cancellazione (0044) — non ha
                    // altro modo di saperlo, e senza l'evento la sua storia si
                    // spezza in due chiavi. È il gemello del rejoin a vault
                    // chiuso (il precedente qui sotto, ~7093-7106), che però
                    // passa da `as_actor(Actor::Kernel, …)` perché lì non c'è
                    // un rilevatore: qui l'attore è chi ha visto — il batch del
                    // rilevatore — e l'evento esce dal suo frame, come ogni
                    // altro di questo ingest.
                    // L'anagrafe segue ogni scrittura (§14.1): dimensione, data e impronta
                    self.emit_event(Event::DocumentRenamed {
                        from,
                        to: id.clone(),
                    });
                } else if from != *id {
                    self.last_removed = Some((from, fp));
                }
            }
        }
        // di un documento appena scritto sono cambiate, e una voce ferma a
        // prima direbbe che il file è quello di ieri — a chi la interroga
        // adesso, e alla prossima apertura, che sull'anagrafe decide cosa
        // rileggere.
        // **Prima** di toccare qualunque cosa: è l'unico momento in cui il
        // vecchio e il nuovo esistono insieme (§22.2, decisione 0069). Un
        // istante più in là l'anagrafe ha l'impronta nuova, `self.tags` i tag
        // nuovi e `self.metas` i metadati nuovi, e dire *cosa* è cambiato
        // costerebbe una lettura del disco invece di zero.
        // Gli indici vedono la modifica nella stessa operazione del grafo:
        let changes = self.indexes.core.changes_for(&model, &fingerprint);
        match placed {
            Some((size, mtime)) => {
                self.set_entry(id, size, mtime, Some(fingerprint.clone()));
            }
            None => {
                self.touch_entry(id, Some(fingerprint.clone()));
            }
        }
        let lost = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let providers = self.indexes.feed_handles();
        let pending = PreparedDocumentFeed {
            id: id.clone(),
            model,
            changes,
            revision: fingerprint,
            journal: JournalOp::Written {
                doc: id.clone(),
                from: None,
                to: Revision::of(""),
            },
            providers,
            losses: lost,
        };
        let pending = pending.invoke_indexes();
        self.finish_index_feed(pending);
    }

    fn finish_index_feed(&mut self, pending: PreparedDocumentFeed) {
        self.report_losses(pending.losses);
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        self.session
            .invalidate(&pending.id, ContextChange::Rewritten);
        self.emit_event(Event::DocumentChanged {
            id: pending.id,
            changes: Some(pending.changes),
        });
        self.emit_event(Event::IndexUpdated);
    }

    /// esiste ed è un documento, aggiorna l'anagrafe se è un file di
    /// un'altra specie, toglie se è sparito. Restituisce `true` se qualcosa è
    /// cambiato. Path fuori dal vault o ignorati dal vault: nessun effetto.
    ///
    /// **Un file senza provider non è più «nessun effetto»** (§14.1): era il
    /// ramo con cui un PNG copiato nel vault a Fub aperto spariva senza
    /// lasciare traccia, e il vault dichiarava di non saperne niente fino alla
    /// riapertura successiva — cioè fino a quando la scansione lo avrebbe visto
    /// comunque. Adesso entra in anagrafe e lo annuncia, con gli eventi che
    /// nominano ciò che è: un allegato, non un documento.
    ///
    /// Il filtro dei path ignorati è lo **stesso** della scansione
    /// ([`Vault::is_ignored`](crate::vault::Vault::is_ignored)) e non una sua copia: le due porte d'ingresso del
    /// vault devono avere la stessa idea di cosa sta fuori, altrimenti una nota
    /// cestinata resterebbe cercabile.
    ///
    /// **Un fallimento resta scritto anche se il chiamante non lo legge** (§9.7):
    /// i due chiamanti veri sono nel callback del watcher e scrivevano
    /// `let _ = ws.sync_path(…)`, quindi un file esterno che non si legge o non
    /// si parsa lasciava la cache, il grafo e l'indice fermi a *prima*, per
    /// sempre, senza che niente lo dicesse. Adesso lo dice
    /// [`IndexQuery::VaultStatus`].
    /// **La metà di [`sync_path`] che non ha bisogno del prestito esclusivo**:
    pub fn sync_path(&mut self, abs: &Utf8Path) -> Result<bool> {
        let outcome = self.sync_path_here(abs);
        self.notes_sync(abs, &outcome);
        outcome
    }

    /// legge il file dal disco e lo parsa, sotto `&self`.
    ///
    /// È la regola della
    /// [decisione 0024](../../../docs/decisions/README.md)
    /// applicata alla porta da cui il vault cambia da fuori: leggere e parsare
    /// N file è l'I/O più lungo di un lotto del watcher, e chi legge — la
    /// ricerca, il disegno dei pannelli — non ha niente a che farci. Il
    /// chiamante prepara sotto prestito **condiviso** e applica con
    /// [`sync_path_prepared`](Workspace::sync_path_prepared).
    ///
    /// `None` vuol dire «qui non c'è niente da preparare», e non è un
    /// fallimento: un path ignorato, un file di un'altra specie, un file
    /// sparito, una lettura che non è riuscita, o un file che sta ancora
    /// cambiando sotto (difetto 0197: due `stat` discordi). In tutti i casi
    /// [`sync_path_prepared`] rifà la strada intera sotto il prestito
    /// esclusivo, che è dove quei rami stavano già — e dove un errore viene
    /// registrato come sempre (§9.7). Un file instabile si rifiuta anche
    /// là: ingerirlo a metà è il difetto, non una lettura da ritentare subito.
    // L'eco della propria scrittura non si riparsa (§14.1, difetto 0196).
    pub fn plan_sync(&self, abs: &Utf8Path) -> Option<ParsedChange> {
        if self.docs.vault.is_ignored(abs) {
            return None;
        }
        let id = self.docs.vault.doc_id_for_path(abs).ok()?;
        let ext = extension_of(&id).unwrap_or_default();
        self.docs.registry.provider_for_ext(&ext)?;
        if !abs.exists() {
            return None;
        }
        let source = self.source_if_stable(&id).ok().flatten()?;
        let fingerprint = Revision::of(&source);
        // **I byte, se il file sta fermo.** Due `stat` attorno alla lettura: se
        let model = if self.already_ingested(&id, &fingerprint) {
            None
        } else {
            Some(self.docs.parse_owned(&id, source).ok()?)
        };
        Some(ParsedChange {
            seen: self.entry_fingerprint(&id),
            fingerprint,
            id,
            model,
        })
    }

    /// dimensione o data cambiano in mezzo, qualcun altro sta ancora scrivendo
    /// e questi byte sono una metà (difetto 0197). `None` non è un fallimento
    /// — il debounce del rilevatore riproverà — ed è per questo che non si
    /// aspetta: un `sleep` in un banco non è un segnale, e qui non ce n'è
    /// bisogno, perché la prova è sui due numeri, non sul tempo.
    /// **Questi byte sono già quelli che il kernel ha in memoria?**
    fn source_if_stable(&self, id: &DocId) -> Result<Option<String>> {
        let Some(before) = self.docs.vault.stat(id) else {
            return Ok(None);
        };
        let source = self.docs.vault.read(id)?;
        let Some(after) = self.docs.vault.stat(id) else {
            return Ok(None);
        };
        Ok((before == after).then_some(source))
    }

    ///
    /// L'impronta in anagrafe è quella dell'ultimo sorgente ingerito, e se il
    /// file sul disco ne porta una uguale non c'è niente da fare: il modello in
    /// cache è già quello che un parse rifarebbe identico.
    ///
    /// È così che una scrittura si riconosce quando **rientra dal rilevatore**
    /// (difetto 0196). Ogni salvataggio del kernel passa da una rename, la
    /// rename è un evento del filesystem, e il lotto che ne segue riportava
    /// dentro il documento appena scritto: riletto, riparsato, reingerito, con
    /// un `DocumentChanged` a nome del rilevatore su una modifica che l'utente
    /// aveva appena fatto lui. Il conto si paga su ogni salvataggio di ogni
    /// nota.
    ///
    /// **Si riconosce dai byte e non dalla data**, e la differenza è
    /// correttezza: `mtime + size` è il criterio dell'anagrafe (§14.1) ma
    /// sbaglia nel verso caro — una scrittura altrui nello stesso millisecondo
    /// e della stessa lunghezza passerebbe per «immutato», e l'indice resterebbe
    /// fermo su un documento vecchio. L'impronta non ha quella finestra: costa
    /// la lettura del file, che il piano fa comunque, e non costa il parse né la
    /// coda di ingestione, che sono la parte cara.
    ///
    /// La cache dei metadati va **guardata insieme all'impronta**: un documento
    /// che sta in anagrafe ma non in cache — uno che alla scansione non si è
    /// potuto parsare — non è «già dentro», e va riprovato.
    /// L'impronta che l'anagrafe attribuisce **adesso** a un documento: è ciò
    fn already_ingested(&self, id: &DocId, fingerprint: &Revision) -> bool {
        self.indexes.core.metas.contains_key(id)
            && self.entry_fingerprint(id).as_ref() == Some(fingerprint)
    }

    /// che un piano si porta dietro per accorgersi di essere invecchiato.
    /// [`sync_path`] con il lavoro di lettura **già fatto** da
    fn entry_fingerprint(&self, id: &DocId) -> Option<Revision> {
        self.indexes
            .core
            .entries
            .get(id)
            .and_then(|and| and.fingerprint.clone())
    }

    /// [`plan_sync`](Workspace::plan_sync).
    ///
    /// **Il piano dichiara cosa credeva di sapere, e chi applica lo verifica.**
    /// Fra la fase condivisa e questa il prestito esclusivo è passato di mano, e
    /// in mezzo può esserci stato un salvataggio dell'utente: applicare un
    /// modello parsato *prima* di quella scrittura la cancellerebbe dalla
    /// memoria del kernel, in silenzio. Il piano porta quindi l'impronta che
    /// l'anagrafe aveva quando è stato fatto; se adesso è un'altra, il piano si
    /// butta e si rifà la strada intera — che è ciò che il codice faceva sempre,
    /// e qui succede solo nel caso raro.
    // Il file può anche essere sparito nel frattempo: è un `stat`, non una
    pub fn sync_path_prepared(
        &mut self,
        abs: &Utf8Path,
        prepared: Option<ParsedChange>,
    ) -> Result<bool> {
        let Some(plan) = prepared else {
            return self.sync_path(abs);
        };
        // lettura, e il ramo che toglie un documento sta di là.
        // Niente da parsare vuol dire niente da applicare: il piano ha
        if self.entry_fingerprint(&plan.id) != plan.seen || !abs.exists() {
            return self.sync_path(abs);
        }
        let ParsedChange {
            id,
            model,
            fingerprint,
            ..
        } = plan;
        // riconosciuto l'eco di una scrittura del kernel (difetto 0196).
        // **I piani che chiudono la finestra di apertura** (§15.7): ciò che è
        let Some(model) = model else {
            return Ok(false);
        };
        let outcome = self.as_actor(Actor::Watcher, |ws| {
            ws.ingest_model(&id, model, fingerprint, None);
            ws.dispatch_pending();
            Ok(true)
        });
        self.notes_sync(abs, &outcome);
        outcome
    }

    /// cambiato fra la scansione e l'accensione del rilevatore.
    ///
    /// La scansione fotografa il vault in un istante e il rilevatore comincia
    /// a guardare in un altro; in mezzo — tutta la seconda fase dell'apertura —
    /// un cambiamento esterno non è nella fotografia e non è ancora guardato,
    /// e nessun evento lo recuperava fino alla riapertura. Questi piani sono
    /// la differenza fra i due istanti: chi apre li applica con
    /// [`sync_path_prepared`](Workspace::sync_path_prepared) appena il
    /// rilevatore è acceso, e un cambiamento caduto nella finestra esce **una
    /// volta sola** — con lo stesso attore e lo stesso diritto all'impronta di
    /// un lotto vero, perché la porta è la stessa ([`plan_sync`]).
    ///
    /// L'insieme è **il disco adesso più l'anagrafe della scansione**: un file
    /// nuovo c'è solo nel disco, uno sparito solo nell'anagrafe, uno riscritto
    /// sta in entrambi con numeri diversi. Chi è rimasto com'era — stessi
    /// `size` e `mtime` della camminata di scansione — non si legge: è il salto
    /// che la cache dei metadati compra (§14.1), e senza di esso ogni apertura
    /// rileggerebbe il vault intero per dire che non è cambiato niente. Un
    /// lotto del rilevatore che arrivasse dopo su un path già allineato non
    /// trova niente da fare: l'impronta in anagrafe è la stessa, e
    /// `sync_path_prepared` risponde senza parsare (difetto 0196).
    ///
    /// I piani si fanno sotto prestito condiviso, come [`plan_sync`], e chi li
    /// applica lo fa sotto quello esclusivo: è la regola della
    /// [0119](../../../docs/decisions/README.md)
    /// sull'unico sito che le mancava.
    // La camminata è quella della scansione — stessa politica di
    pub fn plan_catch_up(&self) -> Vec<(Utf8PathBuf, Option<ParsedChange>)> {
        // esclusione, stesse specie: elenca i file, non li apre.
        // Ciò che l'anagrafe aveva e il disco non ha più: un file sparito
        let Ok(scanned) = self.docs.vault.scan() else {
            return Vec::new();
        };
        let mut paths: BTreeSet<Utf8PathBuf> = BTreeSet::new();
        let mut on_the_disk: BTreeSet<DocId> = BTreeSet::new();
        for file in scanned.files {
            let unchanged = self
                .indexes
                .core
                .entries
                .get(&file.id)
                .filter(|entry| entry.size == file.size && entry.mtime == file.mtime)
                .and_then(|entry| entry.fingerprint.as_ref())
                .is_some_and(|fingerprint| {
                    self.docs
                        .vault
                        .read_bytes(&file.id)
                        .is_ok_and(|bytes| fingerprint.matches_bytes(&bytes))
                });
            on_the_disk.insert(file.id.clone());
            if !unchanged {
                paths.insert(self.root().join(file.id.as_str()));
            }
        }
        // nella finestra si toglie, e `plan_sync` risponde `None` per lui —
        // chi applica rifà la strada intera, che è dove lo sparito si toglie.
        // Registra l'esito di una sincronizzazione per-path nel fatto interrogabile
        for id in self.indexes.core.entries.keys() {
            if !on_the_disk.contains(id) {
                paths.insert(self.root().join(id.as_str()));
            }
        }
        paths
            .into_iter()
            .map(|path| {
                let plan = self.plan_sync(&path);
                (path, plan)
            })
            .collect()
    }

    /// del §9.7. Non cambia ciò che il chiamante riceve: aggiunge un secondo
    /// lettore, che è il vault stesso.
    ///
    /// **Pavimento e porta, non solo il registro** (0062, difetto 0200). Il
    /// fatto interrogabile è una risposta a chi chiede, e chi chiede deve prima
    /// sospettare: `VaultStatus` dice «è già andato storto qualcosa» a un
    /// pannello che nessuno apre finché non si accorge che qualcosa non torna,
    /// ed è la forma di notizia che arriva dopo il danno. Un documento che non
    /// si sincronizza resta indietro rispetto al disco per sempre — non c'è una
    /// riconciliazione periodica, `reindex` gira solo all'apertura —, quindi
    /// chi apre quella nota vede il testo di ieri e chi la cerca la trova col
    /// contenuto di ieri: è esattamente il caso per cui il canale esiste. Le
    /// tre uscite dicono tre cose diverse e nessuna sostituisce le altre: il
    /// registro **conta** (è già successo *n* volte), il log **resta** dopo che
    /// l'app si è chiusa, l'evento **arriva** mentre succede.
    ///
    /// Sta qui e non nei chiamanti per la ragione che questa funzione aveva già
    /// scritta accanto: i chiamanti veri scrivevano `let _ =`, e ciò che si
    /// appoggia alla loro attenzione si perde. Le tre porte pubbliche —
    /// [`sync_path`](Workspace::sync_path),
    /// [`sync_path_prepared`](Workspace::sync_path_prepared),
    /// [`sync_renamed_path`](Workspace::sync_renamed_path) — passano tutte di
    /// qui, e la quarta che verrà la eredita senza che nessuno se ne debba
    /// ricordare.
    ///
    /// [`Severity::Warning`], e per la regola di [`report_losses`]: il vault è
    /// la verità e ciò che è rimasto indietro torna riaprendo. Non «non è
    /// grave» — fino ad allora chi legge quella nota legge una versione vecchia
    /// senza sapere che lo è.
    ///
    /// Il soggetto è il documento e non il path, perché il soggetto di un
    /// guasto è ciò che l'utente ha in mano; se quel path un documento non lo
    /// nomina — è fuori dal vault, o non è UTF-8 — il guasto resta senza
    /// soggetto invece di inventarne uno.
    ///
    /// [`report_losses`]: Workspace::report_losses
    /// La stessa sincronizzazione per un file che **non è un documento**: si
    fn notes_sync(&mut self, abs: &Utf8Path, outcome: &Result<bool>) {
        let Err(and) = outcome else {
            return;
        };
        self.indexes.core.notes_sync_failure(and);
        tracing::warn!(target: "fub.kernel", "sincronizzazione di {abs}: {and}");
        let subject = self.docs.vault.doc_id_for_path(abs).ok();
        let reason = PluginError::Internal(format!("sincronizzazione di {abs}: {and}").into());
        self.as_actor(Actor::Watcher, |ws| {
            ws.report_trouble(Severity::Warning, subject, reason, None);
            ws.dispatch_pending();
        });
    }

    fn sync_path_here(&mut self, abs: &Utf8Path) -> Result<bool> {
        if self.docs.vault.is_ignored(abs) {
            return Ok(false);
        }
        let id = match self.docs.vault.doc_id_for_path(abs) {
            Ok(id) => id,
            Err(_) => return Ok(false),
        };
        let ext = extension_of(&id).unwrap_or_default();
        if self.docs.registry.provider_for_ext(&ext).is_none() {
            return self.sync_entry_here(&id, abs);
        }
        if abs.exists() {
            self.refresh_from_disk(&id)
        } else {
            self.as_actor(Actor::Watcher, |ws| {
                let existed = ws.indexes.core.metas.contains_key(&id);
                if existed {
                    if let Some(fp) = ws.entry_fingerprint(&id) {
                        ws.last_removed = Some((id.clone(), fp));
                    }
                }
                ws.remove_document(&id);
                Ok(existed)
            })
        }
    }

    /// aggiorna l'anagrafe e si dice cosa è successo, senza leggere niente
    /// (§14.1).
    ///
    /// Non si legge e non si parsa perché non c'è niente da parsare, e non si
    /// calcola l'impronta perché costerebbe i byte di un file che nessuno ha
    /// chiesto: l'anagrafe dice che c'è, quanto è grande e di quando è, che è
    /// tutto ciò che si può sapere gratis.
    // Stessa dimensione e stessa data: è lo stesso contenuto, e
    fn sync_entry_here(&mut self, id: &DocId, abs: &Utf8Path) -> Result<bool> {
        self.as_actor(Actor::Watcher, |ws| {
            if abs.exists() {
                let before = ws.indexes.core.entries.get(id).cloned();
                let fingerprint = match (&before, ws.docs.vault.stat(id)) {
                    // un'impronta che qualcuno aveva calcolato vale ancora.
                    // Cambiato: l'impronta di prima descriveva un altro
                    (Some(and), Some((size, mtime))) if and.size == size && and.mtime == mtime => {
                        and.fingerprint.as_ref().and_then(|fingerprint| {
                            ws.docs
                                .vault
                                .read_bytes(id)
                                .ok()
                                .filter(|bytes| fingerprint.matches_bytes(bytes))
                                .map(|_| fingerprint.clone())
                        })
                    }
                    // contenuto, e tenerla sarebbe scrivere una bugia in
                    // anagrafe. Chi la vorrà la calcolerà leggendo i byte.
                    // Nessuna differenza: un rilevatore che riferisce due volte
                    _ => None,
                };
                let Some(kind) = ws.touch_entry(id, fingerprint) else {
                    return Ok(false);
                };
                if ws.indexes.core.entries.get(id) == before.as_ref() {
                    // lo stesso fatto non è un fatto due volte.
                    // Rimuove un documento (usato dal file watcher su cancellazione).
                    return Ok(false);
                }
                ws.emit_event(Event::EntryChanged {
                    id: id.clone(),
                    kind,
                });
                ws.dispatch_pending();
                return Ok(true);
            }
            let Some(kind) = ws.indexes.core.remove_entry(id) else {
                return Ok(false);
            };
            ws.emit_event(Event::EntryRemoved {
                id: id.clone(),
                kind,
            });
            ws.dispatch_pending();
            Ok(true)
        })
    }

    // La nota con il focus non esiste più: `active_context` non deve
    pub fn remove_document(&mut self, id: &DocId) {
        if self.indexes.core.contains(id) {
            // continuare a nominarla alle view (né tenerne una selezione).
            // Crea una nota vuota e restituisce il suo [`DocId`].
            self.session.invalidate(id, ContextChange::Gone);
            self.indexes.core.remove_entry(id);
            let lost = self.indexes.on_documents_removed(std::slice::from_ref(id));
            self.report_losses(lost);
            if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
                self.indexes.core.rebuild_graph();
            }
            self.emit_event(Event::DocumentRemoved { id: id.clone() });
            self.emit_event(Event::IndexUpdated);
            self.dispatch_pending();
        }
    }

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
    // Una nota nuova è una scrittura come le altre: grafo, indici ed eventi
    pub fn create_notes(&mut self, name: Option<&str>) -> Result<DocId> {
        let id = match name {
            Some(name) => {
                let id = self.new_notes_id(name)?;
                if self.is_taken(&id) {
                    return Err(KernelError::AlreadyExists(id.to_string()));
                }
                id
            }
            None => {
                let ext = self
                    .docs
                    .registry
                    .default_extension()
                    .ok_or(KernelError::NoDefaultFormat)?;
                self.free_name(&DocId::new(format!("{UNTITLED}.{ext}")))
            }
        };
        // la vedono nascere per la via normale. `Dictated` perché il nome
        // appena scelto è libero — `free_name` l'ha appena stabilito — e una
        // base sarebbe la revisione di un file che non esiste.
        // Il primo nome libero della famiglia `<nome>`, `<nome> 1`, `<nome> 2`, …
        self.write_document(&id, "", WriteBase::Dictated)?;
        Ok(id)
    }

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
    /// Questo path è già di qualcuno? Vale sia l'indicizzato sia ciò che sta
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
            .find(|candidate| !self.is_taken(candidate))
            .expect("la sequenza dei candidati è infinita")
    }

    /// sul disco e il workspace non ha ancora visto.
    /// Il [`DocId`] di una nota che nasce col nome dato: separatori normalizzati
    pub(crate) fn is_taken(&self, id: &DocId) -> bool {
        self.indexes.core.metas.contains_key(id) || self.docs.vault.exists(id)
    }

    /// e, se il nome non porta già un'estensione gestita, quella di default.
    // Un nome che nasce: la tolleranza stretta del §15.5.
    fn new_notes_id(&self, name: &str) -> Result<DocId> {
        // --- cestino -----------------------------------------------------------
        let id = new_doc_id(name)?;
        let has_extension = self.docs.has_provider_for(&id);
        if has_extension {
            return Ok(id);
        }
        let ext = self
            .docs
            .registry
            .default_extension()
            .ok_or(KernelError::NoDefaultFormat)?;
        Ok(DocId::new(format!("{}.{ext}", id.as_str())))
    }

    /// Cancella un documento **spostandolo nel cestino** del vault, e
    ///
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
    // **E la bozza non salvata se ne va con la nota** (§15.2). Sta qui per
    pub fn delete_document(&mut self, id: &DocId) -> Result<DocId> {
        if !self.indexes.core.metas.contains_key(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let (trashed, sidecar_fault) = self.docs.vault.trash(id)?;
        self.remove_document(id);
        // la ragione per cui `migrate_side_data` la fa seguire una rinomina —
        // una bozza è indicizzata per `DocId`, e un `DocId` che non nomina più
        // niente è una bozza che nessuna vista raggiunge — ma con la risposta
        // opposta, perché opposto è il gesto: chi rinomina vuole quel testo al
        // nome nuovo, chi cestina ha appena detto che quella nota non la vuole.
        // La bozza rimasta sotto la chiave vecchia non è un residuo innocuo: è
        // ciò che il recupero all'avvio ripesca e rimette in un buffer sporco,
        // cioè una nota cestinata che risorge alla prima scrittura di chi non ha
        // chiesto niente (difetto 0208).
        //
        // `delete_document` e non `remove_document`, e la differenza è tutta:
        // questo è il cestino dell'app, dove l'utente ha confermato: quello è il
        // percorso del **watcher**, che reagisce a un file sparito dal disco per
        // mano d'altri — ed è precisamente il momento in cui la bozza è l'unica
        // copia di ciò che si era scritto, quindi lì non si tocca.
        // Il sidecar del cestino non si è scritto: la cancellazione è riuscita
        if let Err(and) = self.drafts.discard(id) {
            self.organization.warn(format!(
                "la bozza non salvata di {id} è rimasta dietro alla nota cestinata: {and}"
            ));
        }
        self.record(JournalOp::Trashed {
            doc: id.clone(),
            trash: trashed.clone(),
        });
        // ma chi ripristina questa voce tornerà nel posto sbagliato. È la
        // perdita di un dato autorevole (0052 la conta come `Failure`), e
        // `delete_document` è il primo chiamante con il workspace in mano —
        // quindi è qui che il guasto esce sia nel log che nel canale (0062).
        // Stringa letterale e non chiave di catalogo: è il precedente dei
        if let Some(fault) = sidecar_fault {
            tracing::warn!(target: "fub.kernel", "cestino: sidecar di {trashed} non scritto: {fault}");
            // guasti del kernel (`report_losses` passa i messaggi di panico di
            // `safety::reporting`), e il giorno che il centro notifiche vorrà
            // tradurli tutti, li raccoglie insieme.
            // Il contenuto del cestino, dal più recente al più vecchio.
            self.report_trouble(
                Severity::Failure,
                Some(trashed.clone()),
                PluginError::Internal(
                    format!("cestino: sidecar di {trashed} non scritto: {fault}").into(),
                ),
                None,
            );
        }
        Ok(trashed)
    }

    /// Ripristina una voce del cestino e restituisce il [`DocId`] con cui è
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        self.docs.vault.list_trash()
    }

    /// tornata nel vault: il nome originale nella radice, oppure `to` se il
    /// chiamante ne ha scelto un altro (è il caso in cui il path è di nuovo
    /// occupato e l'app ha chiesto all'utente).
    ///
    /// Il ripristino è l'**inverso esatto** della cancellazione: una mossa sola
    /// sul disco ([`Vault::restore_trashed`]), e poi la stessa coda che segue
    /// ogni scrittura — parse, grafo, indici, eventi. Non è un `write` seguito
    /// da un `remove`: quella forma ha un istante in cui la nota sta in due
    /// posti, e un guasto lì dentro ce la lascia.
    ///
    /// Ciò che torna può **non essere un documento**: nel cestino ci finiscono
    /// anche gli allegati — è condiviso con Obsidian (D1) e
    /// [`list_trash`](Vault::list_trash) li elenca apposta — e per restituire un
    /// `.png` non serve né un provider né che i byte siano UTF-8. Pretenderli
    /// sarebbe il difetto, com'è per
    /// [`rename_entry_in_batch`](Workspace::rename_entry_in_batch): la coda di
    /// un allegato è quella di un documento per sottrazione, non un secondo
    /// percorso.
    ///
    /// [`Vault::restore_trashed`]: crate::Vault::restore_trashed
    // `entry.original` nasce da un basename o dal sidecar scritto dal
    pub fn restore_from_trash(&mut self, trash_id: &DocId, to: Option<DocId>) -> Result<DocId> {
        let entry = self
            .docs
            .vault
            .list_trash()?
            .into_iter()
            .find(|and| &and.id == trash_id)
            .ok_or_else(|| KernelError::NotFound(trash_id.to_string()))?;
        // vault, ed è sano per costruzione; il `to` del chiamante invece
        // arriva dall'IPC e va validato.
        //
        // Le due strade fanno **due domande diverse**, ed è la distinzione del
        // §15.5 letta sul cestino. Senza `to` non nasce nessun nome: ne torna
        // uno che c'era, e va giudicato col solo recinto — una nota che si
        // chiamava `CON.md` prima di finire nel cestino deve poter tornare, e
        // sarebbe un modo curioso di perdere un file, rifiutarsi di restituirlo
        // per un nome che il vault conteneva già. Con `to` invece il nome
        // **nasce adesso**: `to` è opzionale proprio perché è il caso in cui il
        // path d'origine era occupato e l'utente ne ha digitato un altro, cioè
        // Fub sta scegliendo dove mettere un file. Finché anche questa strada
        // chiedeva il solo recinto, un ripristino poteva atterrare su
        // `.nascosta/Nota.md` — legale su ogni filesystem, saltato dalla
        // scansione — e la nota tornava invisibile a chi l'aveva ripristinata,
        // con la sua voce fantasma in anagrafe. Era il difetto 0186.
        // Il modello si costruisce **prima** di muovere il file, per la ragione
        let original = entry.original.clone();
        let target = match to {
            Some(to) => new_doc_id(to.as_str())?,
            None => entry.original,
        };
        if self.indexes.core.metas.contains_key(&target) || self.docs.vault.exists(&target) {
            return Err(KernelError::AlreadyExists(target.to_string()));
        }
        // di `write_source`: il parse è puro, e farlo dopo lascerebbe il disco
        // avanti rispetto a modelli, grafo e indici davanti a un chiamante che
        // riceve `Err`.
        //
        // Nessun provider per questa estensione non è un errore: è un allegato,
        // e la sua coda è questa per sottrazione — niente lettura, niente parse,
        // niente modello da mettere in cache.
        // **Una** mossa sul disco, e il cestino lascia andare la voce con tutto
        let ext = extension_of(&target).unwrap_or_default();
        let model = match self.docs.registry.provider_for_ext(&ext) {
            Some(_) => {
                let source = self.docs.vault.read(trash_id)?;
                let revision = Revision::of(&source);
                Some((self.docs.parse_owned(&target, source)?, revision))
            }
            None => None,
        };

        // ciò che teneva per lei.
        // L'impronta di un allegato non c'è, come per ogni voce che
        self.docs.vault.restore_trashed(trash_id, &target)?;
        match model {
            Some((model, revision)) => self.ingest_model(&target, model, revision, None),
            None => {
                // nessuno parsa: l'anagrafe la ricava dal disco.
                // Se il ripristino approda su un path diverso dall'origine (il path
                let kind = self
                    .touch_entry(&target, None)
                    .unwrap_or(EntryKind::Unknown);
                self.emit_event(Event::EntryChanged {
                    id: target.clone(),
                    kind,
                });
                self.emit_event(Event::IndexUpdated);
            }
        }
        self.dispatch_pending();
        self.record(JournalOp::Restored {
            trash: trash_id.clone(),
            doc: target.clone(),
        });
        // era di nuovo occupato e l'utente ha scelto un altro nome), lo stato
        // per-documento — storia del versioning, meta del frontend — vive
        // ancora sotto la chiave d'origine: è un rename a tutti gli effetti,
        // anche se il documento non era indicizzato, e chi tiene stato migra
        // la chiave sull'evento.
        // Lo stato per-documento segue la chiave anche qui, e va fatto nel
        if target != original {
            // kernel per la ragione di sempre: l'evento dice la stessa cosa, ma
            // la coda ha un budget e può troncare (decisione 0034), e chi tiene
            // stato autorevole non può dipendere da una consegna best-effort.
            // Svuota il cestino. Restituisce quante voci ha cancellato: da qui in poi
            self.migrate_doc_data(&original, &target);
            self.emit_event(Event::DocumentRenamed {
                from: original,
                to: target.clone(),
            });
            self.dispatch_pending();
        }
        Ok(target)
    }

    /// non sono più recuperabili, e chi chiama deve poterlo dire.
    /// Rinomina/sposta un documento **preservando l'identità**: file sul disco,
    pub fn empty_trash(&mut self) -> Result<usize> {
        self.docs.vault.empty_trash()
    }

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
    // `to` arriva dall'IPC: senza validazione `../fuori.md` sposterebbe il
    pub fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        self.batch(|ws| ws.rename_document_in_batch(from, to))
    }

    fn rename_document_in_batch(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        // file fuori dal vault. E la destinazione di un rename è un nome che
        // **nasce**, quindi vale la tolleranza stretta del §15.5: rinominare
        // *verso* `CON.md` è creare un file che su Windows non si apre, mentre
        // rinominare *via da* `CON.md` è precisamente il modo di sistemarlo — ed
        // è per questo che qui si valida `to` e non `from`.
        // Non è un documento, ma il vault potrebbe conoscerlo lo stesso
        let to = &new_doc_id(to.as_str())?;
        if from == to {
            return Ok(());
        }
        if !self.indexes.core.metas.contains_key(from) {
            // (§14.1): spostare un allegato è la stessa operazione, con una
            // coda diversa — non c'è niente da riparsare, e i riferimenti che
            // lo seguono sono quelli che lo mostrano.
            // Rename "case-only" (`nota.md` → `Nota.md`): su un filesystem
            if self.indexes.core.entries.contains_key(from) {
                return self.rename_entry_in_batch(from, to);
            }
            return Err(KernelError::NotFound(from.to_string()));
        }
        // case-insensitive (macOS/Windows) `vault.exists(to)` vede lo STESSO
        // file, non una collisione — e il check sul disco va saltato **perché è
        // lo stesso file**, non perché i due nomi si somiglino. La differenza
        // non è di stile: là dove il filesystem il caso lo distingue, `Nota.md`
        // è un omonimo vero, e saltare il check lo seppelliva senza dire niente
        // (0182). Chi risponde è il supporto, l'unico che lo sappia.
        // Il piano di riscrittura va calcolato PRIMA di toccare il grafo:
        let same_file = self.docs.vault.same_file(from, to);
        if self.indexes.core.metas.contains_key(to) || (!same_file && self.docs.vault.exists(to)) {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }
        let ext = extension_of(to).unwrap_or_default();
        if self.docs.registry.provider_for_ext(&ext).is_none() {
            return Err(KernelError::NoProvider(ext));
        }

        // serve la risoluzione con il vecchio nome ancora in vigore.
        // **Ciò che può fallire va prima di ciò che non si disfa.** Leggere e
        let plan = self.link_rewrite_plan(from, to);

        // parsare stanno qui e non dopo la `rename` per la ragione per cui ci
        // stanno in `write_source` e in `restore_document`: un errore di parse —
        // un provider che rifiuta quel testo, un file sparito nella finestra —
        // risaliva con `?` **a rename avvenuta**, e allora il disco aveva il
        // nome nuovo, la memoria il vecchio (nessun `migrate_identity`), il
        // registro non aveva la riga `Renamed`, e chi aveva chiamato riceveva un
        // `Err` per un'operazione che sul disco era successa. Un secondo
        // tentativo rispondeva `NotFound(from)`, e la nota spariva dalla vista
        // fino alla riapertura del vault.
        //
        // Si legge `from` e si parsa **col nome nuovo**: i byte sono gli stessi
        // — una rinomina non li tocca — e il nome serve al parse per risolvere i
        // link relativi, che devono essere quelli di dove il documento sta per
        // andare.
        // I dati per-documento si spostano **prima** del file (difetto 0168),
        let source = self.docs.vault.read(from)?;
        let revision = Revision::of(&source);
        let model = self.docs.parse_owned(to, source)?;
        // mentre `from` è ancora vivo: un crash fra le due lasciava il file al
        // nome nuovo e i dati sotto la chiave vecchia, dove la prima `collect`
        // li spazza. La seconda `migrate_side_data` dentro `migrate_identity`
        // è un no-op — la bozza a `from` non c'è più (`drafts.migrate` torna
        // `Ok(())`). `sync_renamed_path_here` resta migrate-dopo: là il file
        // è già a `to`. Il registro `Renamed` resta dopo la mutazione del
        // file (0067).
        // La riga del rename va **prima** di quelle delle sorgenti riscritte:
        self.migrate_side_data(from, to);
        self.docs.vault.rename_no_replace(from, to)?;
        self.migrate_identity(from, to, model, revision);
        // sono tutte dentro lo stesso lotto, e chi le ripercorre all'indietro le
        // trova nell'ordine in cui `UndoStep` le vuole (0045: i passi sono in
        // ordine di esecuzione, e chi esegue non riordina).
        // Il piano si applica TUTTO, anche se una sorgente fallisce: abortire
        self.record(JournalOp::Renamed {
            from: from.clone(),
            to: to.clone(),
        });

        // a metà lascerebbe link misti vecchio/nuovo senza possibilità di
        // retry. Gli errori si accumulano per-sorgente e arrivano in coda.
        // `apply_edit` riparsa, aggiorna il grafo ed emette gli eventi come
        let mut failed: Vec<String> = Vec::new();
        for (src, request) in plan {
            // ogni scrittura — con in più la base: se qualcuno ha riscritto una
            // di queste sorgenti da quando il piano è stato calcolato, quella
            // riscrittura non viene cancellata in silenzio, il suo link resta
            // vecchio e il fallimento è nominato qui sotto.
            // Dentro il lotto questo `index-updated` non esce: diventa il
            if let Err(and) = self.apply_edit(&src, request) {
                failed.push(format!("{src}: {and}"));
            }
        }
        // `batch-ended` che la chiusura emette. Resta scritto qui perché il
        // rename **ha** aggiornato l'indice, e chi legge questo metodo non deve
        // dedurlo dal fatto che è avvolto in un lotto.
        // Il lotto non annulla: le sorgenti riscritte restano riscritte anche
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        // se una è fallita, ed è la scelta giusta *per il rename* — abortire a
        // metà lascerebbe link misti senza possibilità di retry. Chi vuole il
        // contrario (import, migrazioni) vuole il registro delle mutazioni, che
        // adesso c'è (0067) e di questo lotto tiene i confini — non un campo in
        // più qui.
        // Sposta un file che **non è un documento**, e porta i riferimenti con sé
        if !failed.is_empty() {
            return Err(KernelError::LinkRewrite(failed.join("; ")));
        }
        Ok(())
    }

    /// (§14.1).
    ///
    /// È il gemello di [`rename_document_in_batch`](Workspace::rename_document_in_batch)
    /// e le differenze sono tutte per sottrazione: non si legge, non si parsa,
    /// non c'è un modello da rimettere in cache e non c'è un provider da
    /// pretendere — anzi, **pretenderlo sarebbe il difetto**: rinominare
    /// `foto.png` in `foto2.png` non deve richiedere che qualcuno sappia parsare
    /// i PNG.
    ///
    /// Ciò che resta identico è la parte che conta per chi guarda: i documenti
    /// che mostravano quell'immagine continuano a mostrarla, perché i loro
    /// riferimenti vengono riscritti nella stessa operazione. Senza, spostare un
    /// allegato in una cartella «allegati» — cioè la prima cosa che si fa
    /// mettendo ordine — romperebbe ogni nota che lo incorpora.
    // Il piano PRIMA di spostare: si risolve con il vecchio path ancora in
    fn rename_entry_in_batch(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        let same_file = self.docs.vault.same_file(from, to);
        if self.indexes.core.entries.contains_key(to)
            || self.indexes.core.metas.contains_key(to)
            || (!same_file && self.docs.vault.exists(to))
        {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }

        // vigore, come per i documenti.
        // L'impronta segue il file: un rename sposta i byte senza toccarli.
        let plan = self.entry_rewrite_plan(from, to);
        self.docs.vault.rename_no_replace(from, to)?;

        let fingerprint = self
            .indexes
            .core
            .entries
            .get(from)
            .and_then(|and| and.fingerprint.clone());
        self.indexes.core.remove_entry(from);
        // E lo seguono anche le due cose che seguono ogni identità che cambia:
        let kind = self
            .touch_entry(to, fingerprint)
            .unwrap_or(EntryKind::Unknown);
        // ciò che l'utente gli ha attaccato addosso (§11.3) e lo spazio
        // per-documento di chiunque altro (§13.2). Un allegato può essere
        // appuntato e può avere una miniatura, e nessuna delle due è meno sua
        // per il fatto che nessuno lo parsa.
        // Un allegato spostato è una mutazione del vault come le altre: il
        if let Err(and) = self.organization.migrate(from.as_str(), to.as_str()) {
            self.organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in {to}: {and}"
            ));
        }
        self.migrate_doc_data(from, to);
        // registro non conosce la differenza fra un documento e un file di cui
        // nessuno sa il formato, e non deve — l'inverso è lo stesso.
        // Per ogni documento che **mostra** o nomina `from`, la modifica che
        self.record(JournalOp::Renamed {
            from: from.clone(),
            to: to.clone(),
        });

        let mut failed: Vec<String> = Vec::new();
        for (src, request) in plan {
            if let Err(and) = self.apply_edit(&src, request) {
                failed.push(format!("{src}: {and}"));
            }
        }
        self.emit_event(Event::EntryRenamed {
            from: from.clone(),
            to: to.clone(),
            kind,
        });
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        if !failed.is_empty() {
            return Err(KernelError::LinkRewrite(failed.join("; ")));
        }
        Ok(())
    }

    /// riscrive il suo riferimento verso `to` (§14.1).
    ///
    /// Le sorgenti non si chiedono al grafo, e non è una scorciatoia: un
    /// allegato non è un nodo del grafo — non ha backlink, perché non ha link
    /// uscenti e non partecipa alla risoluzione per nome delle note. Si cammina
    /// quindi la cache dei metadati, che i link ce li ha tutti. È un giro
    /// sull'intero vault, e si paga quando qualcuno sposta un allegato: cioè
    /// quanto costa già un rename di nota con molti backlink.
    // Un wikilink nomina per nome: il nome nuovo, che è il nome
    fn entry_rewrite_plan(&self, from: &DocId, to: &DocId) -> Vec<(DocId, EditRequest)> {
        let mut plan = Vec::new();
        for (src, metadata) in &self.indexes.core.metas {
            let Ok(source_text) = self.docs.vault.read(src) else {
                continue;
            };
            let mut edits: Vec<TextEdit> = Vec::new();
            for link in &metadata.links {
                if self.indexes.core.resolve_entry(src, &link.target).as_ref() != Some(from) {
                    continue;
                }
                let (written, replacement, from_end) = match &link.target {
                    // del file con la sua estensione. Se il vault ha già un
                    // omonimo del nome d'arrivo si scrive il path intero, che è
                    // sempre univoco — la stessa regola delle note.
                    // Né il nome d'arrivo né quello di partenza contano
                    LinkTarget::Wiki { page, .. } => {
                        let name = to.as_str().rsplit('/').next().unwrap_or(to.as_str());
                        let contended = self.indexes.core.entries.keys().any(|id| {
                            // come omonimi: il piano si calcola con il vecchio
                            // path **ancora in anagrafe**, e senza escluderlo
                            // uno spostamento che non cambia il nome del file
                            // risulterebbe conteso da sé stesso — cioè ogni
                            // `![[foto.png]]` diventerebbe un path intero anche
                            // quando nel vault c'è una foto sola.
                            // Un link dalla radice resta dalla radice: è una
                            id != to
                                && id != from
                                && fub_abi::rules::path::resolution_key(
                                    id.as_str().rsplit('/').next().unwrap_or(id.as_str()),
                                ) == fub_abi::rules::path::resolution_key(name)
                        });
                        let new = if contended {
                            to.as_str().to_string()
                        } else {
                            name.to_string()
                        };
                        (page.as_str(), new, false)
                    }
                    LinkTarget::Path(written) => {
                        let (path, fragment) = rules_path::split_fragment(written);
                        let new = if path.trim_start().starts_with('/') {
                            // scelta di stile di chi scrive, e il rename non è il
                            // momento di discuterla.
                            // Migra l'identità di un documento il cui file è **già** al path nuovo:
                            format!("/{}", rules_path::percent_encode_path(to.as_str()))
                        } else {
                            rules_path::relative_ref(src, to)
                        };
                        let rewritten = format!("{new}{fragment}");
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
            if !edits.is_empty() {
                plan.push((
                    src.clone(),
                    EditRequest::new(Revision::of(&source_text), edits),
                ));
            }
        }
        plan
    }

    /// modelli, documento attivo, grafo, indici, evento [`Event::DocumentRenamed`].
    ///
    /// È il tratto comune di [`rename_document`](Workspace::rename_document)
    /// (che prima sposta il file) e di
    /// [`sync_renamed_path`](Workspace::sync_renamed_path) (dove il file lo ha
    /// già spostato qualcun altro).
    // L'anagrafe migra come tutto il resto: la chiave è il path, e il path
    fn migrate_identity(
        &mut self,
        from: &DocId,
        to: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
    ) {
        // è cambiato.
        // La nota aperta segue il rename anche qui: senza, `active_context`
        self.indexes.core.remove_entry(from);
        self.touch_entry(to, Some(fingerprint));
        // risponderebbe col path vecchio e outline/backlink si svuoterebbero
        // fino al prossimo cambio nota. Va fatto nel kernel, non nella shell:
        // vale anche per i rename non innescati da lei.
        // Per ogni indice — quello del kernel compreso — il rename è
        self.session
            .invalidate(from, ContextChange::Renamed(to.clone()));
        self.migrate_side_data(from, to);
        // remove+add: l'identità è la chiave, e la chiave è cambiata. (Chi
        // tiene stato *per-documento* invece migra la chiave sull'evento
        // `DocumentRenamed`.)
        // Porta dietro a una rinomina **tutto ciò che sta attaccato al documento e
        let lost = self
            .indexes
            .on_documents_removed(std::slice::from_ref(from));
        self.report_losses(lost);
        let lost = self
            .indexes
            .on_documents_indexed(std::slice::from_ref(&model));
        self.report_losses(lost);
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        self.emit_event(Event::DocumentRenamed {
            from: from.clone(),
            to: to.clone(),
        });
    }

    /// non è il documento**: l'organizzazione del kernel, lo spazio
    /// per-documento di chiunque altro, la bozza non salvata.
    ///
    /// Sta in una funzione sua perché i chiamanti sono **due**, e sono due
    /// mondi: [`migrate_identity`](Workspace::migrate_identity) — la rinomina
    /// che il kernel fa o vede fare — e
    /// [`rejoin_renamed_while_closed`](Workspace::rejoin_renamed_while_closed),
    /// la rinomina che non ha visto nessuno (§23.1). Tenerle in due copie
    /// sarebbe il difetto che la [decisione 0044] ha appena finito di togliere,
    /// rifatto dentro il kernel invece che fuori: *il rename è un rito che
    /// ognuno celebra per conto proprio, e ognuno lo celebra col proprio buco*.
    /// Il modo in cui si vedrebbe è preciso — un quarto posto per-documento
    /// aggiunto qui e non là, e la rinomina ad app chiusa che ne perde uno solo.
    ///
    /// **La destinazione è libera, e non è un'ipotesi**: i tre canali qui
    /// sotto scrivono ciascuno *sopra* ciò che sta a `to`, quindi chiamare
    /// questa funzione con un `to` vivo in anagrafe vuol dire perdere il dato
    /// di qualcun altro senza dirlo. Chi entra da
    /// [`rename_document`](Workspace::rename_document) ha un `AlreadyExists`
    /// davanti; chi entra da
    /// [`rejoin_renamed_while_closed`](Workspace::rejoin_renamed_while_closed)
    /// accoppia solo id che ieri non erano in anagrafe; chi entra dal watcher
    /// ha la guardia di [`sync_renamed_path_here`] (decisione 0135).
    ///
    /// [`sync_renamed_path_here`]: Workspace::sync_renamed_path_here
    ///
    /// **Nessuno di questi tre errori risale**, ed è la regola dell'§11.3: chi
    /// chiama ha già il file al posto nuovo, e far fallire una rinomina riuscita
    /// perché un'icona non l'ha seguita sarebbe il verso sbagliato. La rinomina
    /// vale, ciò che resta indietro si dice.
    ///
    /// [decisione 0044]: ../../../docs/decisions/0190-sessioni-documento-e-undo.md
    /// Ciò che l'utente ha attaccato addosso a un **allegato** rinominato da
    /// un'altra applicazione (difetto 0184).
    ///
    /// È la metà di [`migrate_side_data`](Workspace::migrate_side_data) che vale
    /// per chi non ha un modello: l'organizzazione e lo stato per-documento di
    /// chiunque altro. La bozza no, e non per dimenticanza — una bozza è il
    /// buffer sporco di un editor di testo, e un allegato non si apre in un
    /// editor di testo.
    ///
    /// Il resto della rinomina lo fanno le due mezze verità che seguono, che
    /// l'anagrafe la sistemano già: qui non si sposta niente sul disco, si
    /// sposta ciò che sta **accanto** al disco.
    ///
    /// I cancelli sono quelli dei documenti, letti per la stessa ragione: la
    /// sorgente dev'essere qualcosa che il vault conosceva davvero, e la
    /// destinazione dev'essere **libera** — una rinomina che atterra su
    /// un'identità viva non è una rinomina (§25.1, decisione 0135), e qui
    /// varrebbe scrivere il pin di `from` sopra quello di `to`.
    // In anagrafe e non fra i documenti: chi ha un modello è già passato di
    fn migrate_attachment_state(&mut self, from: &Utf8Path, to: &Utf8Path) {
        let identity = |ws: &Self, p: &Utf8Path| {
            (!ws.docs.vault.is_ignored(p))
                .then(|| ws.docs.vault.doc_id_for_path(p).ok())
                .flatten()
        };
        let (Some(from_id), Some(to_id)) = (identity(self, from), identity(self, to)) else {
            return;
        };
        if from_id == to_id {
            return;
        }
        // sopra, e non arriva mai qui.
        // Se a destinazione non c'è niente questa non è una rinomina ma una
        if !self.indexes.core.entries.contains_key(&from_id) {
            return;
        }
        if self.indexes.core.entries.contains_key(&to_id)
            || self.indexes.core.metas.contains_key(&to_id)
        {
            return;
        }
        // sparizione, e portarci lo stato vorrebbe dire metterlo sotto una
        // chiave che la prima raccolta spazza: sotto quella vecchia almeno
        // resta finché il file può tornare.
        // **L'organizzazione segue l'identità** (§11.3): icona, pin e posto
        if !self.docs.vault.exists(&to_id) {
            return;
        }
        if let Err(and) = self.organization.migrate(from_id.as_str(), to_id.as_str()) {
            self.organization.warn(format!(
                "l'organizzazione di {from_id} non ha potuto seguire la rinomina \
                 in {to_id}: {and}"
            ));
        }
        self.migrate_doc_data(&from_id, &to_id);
    }

    fn migrate_side_data(&mut self, from: &DocId, to: &DocId) {
        // nell'ordinamento sono attaccati alla nota, non al suo vecchio path.
        //
        // Qui e non sull'evento `DocumentRenamed`, che pure lo direbbe: la coda
        // ha un budget e può troncare (decisione 0034), e l'organizzazione è un
        // dato **autorevole** — perso, non si ricostruisce da niente. Un dato
        // così non può dipendere da una consegna dichiaratamente best-effort.
        // Ne segue il guadagno che si vede: passando di qui migra anche la
        // rinomina fatta da **un'altra app** mentre Fub è aperto, perché
        // `sync_renamed_path` arriva allo stesso punto.
        // **E lo stesso vale per lo stato per-documento di chiunque altro**
        if let Err(and) = self.organization.migrate(from.as_str(), to.as_str()) {
            self.organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in \
                 {to}: {and}"
            ));
        }
        // (§13.2). Sta accanto all'organizzazione perché è la stessa cosa vista
        // in generale: quella è lo stato per-documento *del kernel*, questo è
        // quello di tutti gli altri, e finché il kernel non lo migrava ognuno se
        // lo migrava da sé ascoltando l'evento — cioè nessuno lo migrava per il
        // rename fatto ad app chiusa o da un'altra applicazione.
        //
        // Cammina il **disco** e non i plugin montati, di proposito: chi è
        // spento oggi non deve riaccendersi domani con le chiavi di ieri, ed è
        // esattamente chi non può accorgersene da solo.
        // **E la bozza non salvata** (§15.2), che sta accanto ai due di sopra
        self.migrate_doc_data(from, to);
        // per la ragione dei due di sopra e con un motivo in più: una bozza è
        // l'**unica** copia di ciò che l'utente ha scritto. Se `to` ne ha già
        // una sua, quella di `from` prende un nome di recupero e si elenca
        // come orfana: niente si sovrascrive, e niente resta sotto l'id morto.
        // Sincronizza un **rename accoppiato** riferito dal filesystem (`from` →
        if let Err(and) = self.drafts.migrate(from, to) {
            self.organization.warn(format!(
                "la bozza non salvata di {from} non ha potuto seguire la \
                 rinomina in {to}: {and}"
            ));
        }
    }

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
    ///
    /// Come [`sync_path`](Workspace::sync_path), un fallimento resta scritto
    /// anche se il chiamante non lo legge (§9.7) — e **una volta sola**: i rami
    /// che degradano a `sync_path` passano dal corpo interno, non dalla porta
    /// che registra.
    // Il soggetto è **dove il file è adesso**: una rinomina che fallisce
    pub fn sync_renamed_path(&mut self, from: &Utf8Path, to: &Utf8Path) -> Result<bool> {
        let outcome = self.as_actor(Actor::Watcher, |ws| ws.sync_renamed_path_here(from, to));
        // lascia indietro la destinazione, ed è quella che l'utente ha in mano.
        // Nessuna **identità di documento** da migrare — ma le due mezze
        self.notes_sync(to, &outcome);
        outcome
    }

    fn sync_renamed_path_here(&mut self, from: &Utf8Path, to: &Utf8Path) -> Result<bool> {
        let from_id = (!self.docs.vault.is_ignored(from))
            .then(|| self.docs.vault.doc_id_for_path(from).ok())
            .flatten()
            .filter(|id| self.indexes.core.metas.contains_key(id));
        let Some(from_id) = from_id else {
            // verità vanno dette entrambe (§14.1): in `to` può essere comparso
            // qualcosa, e da `from` può essere sparito. Finché il vault vedeva
            // solo documenti la seconda non esisteva; adesso sì, e saltarla
            // lascerebbe in anagrafe un allegato che nessuno può più aprire,
            // fino alla riapertura del vault. Il corpo interno, non la porta:
            // chi ci ha chiamati registrerà l'esito una volta sola (§9.7).
            //
            // **Le due mezze verità dicono dov'è il file, non che cosa gli è
            // attaccato addosso** (difetto 0184). Un allegato non ha un modello,
            // e per questa funzione «non ha un modello» valeva «non ha
            // un'identità»: la rinomina dal Finder di `foto.png` usciva come
            // «sparita e ricomparsa», cioè due voci d'anagrafe scollegate, e
            // pin, icona, annotazioni e miniatura restavano sotto la chiave
            // vecchia — dove non li cerca più nessuno e dove la prima `collect`
            // li spazza, perché non corrispondono a nessun file vivo. La stessa
            // rinomina fatta **da dentro** li porta con sé da sempre
            // (`rename_entry_in_batch`), quindi la differenza non era una
            // regola: era il rilevatore che ne sapeva meno.
            // Spostato fuori, in una cartella ignorata o in un formato non
            self.migrate_attachment_state(from, to);
            let started = self.sync_path_here(from)?;
            return Ok(self.sync_path_here(to)? || started);
        };
        let to_id = (!self.docs.vault.is_ignored(to))
            .then(|| self.docs.vault.doc_id_for_path(to).ok())
            .flatten()
            .filter(|id| {
                let ext = extension_of(id).unwrap_or_default();
                self.docs.registry.provider_for_ext(&ext).is_some()
            });
        let Some(to_id) = to_id else {
            // gestito: per il workspace è una rimozione.
            // **Una rinomina che atterra su un'identità viva non è una rinomina**
            self.remove_document(&from_id);
            return Ok(true);
        };
        if from_id == to_id {
            return self.sync_path_here(to);
        }
        // (§25.1, decisione 0135). Dei tre modi di entrare in
        // `migrate_side_data` questo è l'unico che possa avere davanti una
        // destinazione *occupata*: `rename_document` ha un `AlreadyExists`
        // prima, `rejoin_renamed_while_closed` accoppia per impronta un id che
        // ieri non era in anagrafe. Senza questa riga il rito si
        // celebrava lo stesso, e i tre canali attaccati a `to` — icona e pin,
        // spazio per-documento, bozza — scrivevano il dato di `from` sopra
        // quello di `to`, che è vivo. La bozza è l'**unica** copia di ciò che
        // l'utente ha scritto: `mv A.md B.md` in un terminale cancellava per
        // sempre il buffer sporco di `B`, in silenzio.
        //
        // La guardia sta **qui e non dentro i tre canali** perché è la stessa
        // domanda per tutti e tre, e a valle nessuno dei tre saprebbe più
        // rispondere «allora non era un rename»: la si eredita passando di
        // qua, non ricordandosela.
        //
        // Il prezzo lo paga chi ha rinominato, ed è dichiarato: la storia di
        // `from` si spezza e i suoi dati restano orfani fino alla prima
        // raccolta. Non paga niente di ciò che era di `to`. La degradazione è
        // la stessa di sopra — è sparito qualcosa da `from`, è comparso
        // qualcosa in `to` — e le due mezze verità vanno dette entrambe
        // (§14.1). Fondere invece di degradare è la forma (b) della voce, che
        // vuole tre politiche di collisione e resta aperta.
        // **Il disco è già avanti, quindi da qui in poi un `Err` secco è il
        if self.indexes.core.metas.contains_key(&to_id) {
            let started = self.sync_path_here(from)?;
            return Ok(self.sync_path_here(to)? || started);
        }
        if !to.exists() {
            self.remove_document(&from_id);
            return Ok(true);
        }
        // difetto** (0181). Chi ha spostato il file è un'altra applicazione: a
        // `to` i byte ci sono da prima che il rilevatore ce lo dicesse, e a
        // `from` non c'è più niente. Rispondere `Err` perché la destinazione
        // non si rilegge o non si parsa lasciava memoria, grafo, indici,
        // registro ed eventi fermi al nome vecchio — cioè un vault che mostra
        // una nota che sul disco non esiste, e che ad aprirla dà un errore,
        // fino alla riapertura.
        //
        // È la regola che `restore_from_trash` enuncia dal verso in cui la si
        // può ancora rispettare — «il parse è puro, e farlo dopo lascerebbe il
        // disco avanti rispetto a modelli, grafo e indici davanti a un
        // chiamante che riceve `Err`» —: là si legge **prima** di muovere,
        // qui muovere non è stata una nostra mossa e l'ordine non si può più
        // scegliere. Ciò che resta da rispettare è la seconda metà: non
        // lasciare vivo il nome vecchio.
        //
        // Non serve inventare un ramo: sono le **due mezze verità** che questa
        // funzione dice già in tre punti (§14.1) — da `from` è sparito
        // qualcosa, in `to` è comparso qualcosa — col prezzo già dichiarato
        // sopra, la storia di `from` che si spezza. Si paga solo quando
        // l'alternativa è un vault che racconta un file che non c'è; e se
        // anche la seconda metà non riesce, l'errore che risale arriva **dopo**
        // che la prima è stata detta, non al posto suo.
        // Per ogni documento che linkava `from` per nome o per path, la
        let new = match self.docs.vault.read(&to_id) {
            Ok(source) => {
                let revision = Revision::of(&source);
                self.docs
                    .parse_owned(&to_id, source)
                    .map(|model| (model, revision))
            }
            Err(and) => Err(and),
        };
        let (model, revision) = match new {
            Ok(done) => done,
            Err(_) => {
                let started = self.sync_path_here(from)?;
                return Ok(self.sync_path_here(to)? || started);
            }
        };
        self.migrate_identity(&from_id, &to_id, model, revision);
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        Ok(true)
    }

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
    // Nuovo riferimento: il nome pagina se nessun altro documento lo
    fn link_rewrite_plan(&self, from: &DocId, to: &DocId) -> Vec<(DocId, EditRequest)> {
        let from_name = resolution_key(from.page_name());
        let from_path = resolution_key(&strip_ext(from.as_str()));

        // contende, altrimenti il path senza estensione, altrimenti il path
        // intero.
        //
        // **La terza forma esiste perché la seconda non è «sempre univoca»**,
        // come questo commento ha dichiarato fino alla
        // [0107](../../../docs/decisions/0192-impostazioni-locale-e-temi.md): la
        // chiave di `path_index` è `resolution_key(strip_ext(…))`, quindi
        // `sub/Nota.md` e `sub/nota.txt` la condividono. E qui non si sta
        // scegliendo cosa mostrare a schermo: si sta **scrivendo su disco nei
        // documenti di terzi**, cioè producendo il riferimento che un altro
        // programma leggerà fra un anno.
        //
        // **La prova non si può fare qui**, ed è stato misurato provandoci: la
        // strada onesta sarebbe chiedere al grafo se il riferimento scelto torna
        // davvero a `to`, ma questo piano si calcola *prima* che il rename sia
        // applicato — il grafo conosce ancora `from` e non ha mai sentito
        // nominare `to`. Ogni candidato risulterebbe sbagliato, e la
        // riscrittura scriverebbe sempre la forma più lunga. Quindi resta una
        // regola; ciò che cambia è che adesso la seconda condizione la si
        // **verifica** invece di affermarla.
        // **`metas` e non `entries`, ed è la scelta giusta** (difetto 0059, che
        // affermava il contrario). La gemella qui accanto — `entry_rewrite_plan`,
        // che sposta un allegato — cerca gli omonimi nell'anagrafe, e la
        // differenza fra le due non è una svista: **ogni piano cerca l'omonimia
        // nel registro che il proprio risolutore legge**. Un wikilink verso un
        // allegato lo risolve la chiave dei nomi dell'anagrafe, che porta il
        // nome del file **con l'estensione** (`![[foto.png]]`, mai `[[foto]]`),
        // quindi un allegato non contende mai un *nome pagina*; e dove le due
        // stringhe coincidono davvero — un file senza estensione — chi risolve
        // prova il grafo per primo e ripiega sull'anagrafe solo se lì non ha
        // trovato niente. Allargare la ricerca a `entries` scriverebbe il path
        // intero dentro i documenti di terzi per un'ambiguità che non esiste.
        // La stessa domanda sul path senza estensione, che è la chiave di
        let to_name = to.page_name();
        let ambiguous = self
            .indexes
            .core
            .metas
            .keys()
            .any(|id| id != from && resolution_key(id.page_name()) == resolution_key(to_name));
        // `path_index`: `sub/Nota.md` e `sub/nota.txt` la condividono, quindi
        // due file possono contenderselo esattamente come si contendono un
        // nome. Dove anche questa è contesa si scrive il path **intero**.
        // Le note che linkano `from`, **una volta ciascuna**: chi lo cita tre
        let to_path_key = resolution_key(&strip_ext(to.as_str()));
        let path_ambiguous = self
            .indexes
            .core
            .metas
            .keys()
            .any(|id| id != from && resolution_key(&strip_ext(id.as_str())) == to_path_key);
        let new_ref = if !ambiguous {
            to_name.to_string()
        } else if !path_ambiguous {
            strip_ext(to.as_str())
        } else {
            to.as_str().to_string()
        };

        // volte va riscritto una volta sola, e il filtro per-link qui sotto
        // cammina già tutti i suoi link. Prima questo era un `.map().collect()`
        // in un `BTreeSet` costruito qui: adesso l'insieme lo dice la firma.
        // Il self-link è escluso dai backlink per scelta, ma al rename va
        let mut sources: BTreeSet<DocId> =
            self.indexes.core.graph.linked(from, LinkDirection::Inbound);
        // riscritto come gli altri: `[[Nota]]` dentro la nota stessa resterebbe
        // dangling — e verrebbe dirottato da chi ricreasse il vecchio nome. Ai
        // link markdown serve comunque (vedi la nota sopra: sposta la
        // sorgente), quindi `from` entra sempre e sarà il filtro per-link a
        // dire se c'è davvero qualcosa da riscrivere.
        // `from_end` è la direzione in cui cercare il riferimento
        sources.insert(from.clone());

        let mut plan = Vec::new();
        for src in sources {
            let Some(metadata) = self.indexes.core.metas.get(&src) else {
                continue;
            };
            let Ok(source_text) = self.docs.vault.read(&src) else {
                continue;
            };
            let mut edits: Vec<TextEdit> = Vec::new();
            for link in &metadata.links {
                // dentro lo span, e non è una preferenza: in `[[Nota|Nota]]` la
                // pagina è la **prima** delle due occorrenze, in
                // `[Nota.md](Nota.md)` la destinazione è la **seconda**. Chi
                // sbaglia direzione riscrive l'etichetta e lascia il link rotto.
                // Riscrivi solo se il link puntava davvero a `from`
                let (written, replacement, from_end) = match &link.target {
                    LinkTarget::Wiki { page, .. } => {
                        // (non a un omonimo) e ci arrivava per nome o per path
                        // — mai per alias.
                        // La sorgente rinominata vive ormai al path nuovo: la sua
                        let key = resolution_key(page);
                        let by_name = key == from_name;
                        let by_path =
                            key == from_path || resolution_key(&strip_ext(&key)) == from_path;
                        if !(by_name || by_path) {
                            continue;
                        }
                        if self.indexes.core.graph.resolve_wiki(page).as_ref() != Some(from) {
                            continue;
                        }
                        (page.as_str(), new_ref.clone(), false)
                    }
                    LinkTarget::Path(written) => {
                        let Some(new_target) = self.rebased_path_link(from, to, &src, written)
                        else {
                            continue;
                        };
                        let (_, fragment) = rules_path::split_fragment(written);
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
            // riscrittura va applicata lì — e la base resta valida, perché un
            // rename sposta il file senza toccarne il contenuto. È una proprietà
            // della revisione-impronta: un contatore per-documento, qui, avrebbe
            // detto che il documento è cambiato.
            // La destinazione che il link markdown `written`, scritto dentro `src`,
            let dest = if &src == from { to.clone() } else { src };
            plan.push((dest, EditRequest::new(Revision::of(&source_text), edits)));
        }
        plan
    }

    /// deve avere dopo il rename `from` → `to`; `None` se non va toccato.
    ///
    /// Ci sono tre modi di non toccarlo, e sono tre cose diverse: il link non
    /// risolve (è già rotto — riscriverlo sarebbe indovinare); né la sorgente
    /// né il bersaglio si spostano (il path relativo continua a valere); il
    /// link parte dalla radice del vault e a spostarsi è solo la sorgente (la
    /// radice non si muove).
    ///
    /// L'estensione ricompare sempre nel riferimento nuovo, anche se il
    /// vecchio ne era privo: vedi [`fub_abi::rules::path::relative_ref`].
    // Un link dalla radice resta dalla radice: è una scelta di stile
    fn rebased_path_link(
        &self,
        from: &DocId,
        to: &DocId,
        src: &DocId,
        written: &str,
    ) -> Option<String> {
        let resolved = self.indexes.core.graph.resolve_path(src, written)?;
        let source_moves = src == from;
        let target_moves = resolved == *from;
        if !source_moves && !target_moves {
            return None;
        }
        let (path, _) = rules_path::split_fragment(written);
        let from_root = path.trim_start().starts_with('/');
        if from_root {
            if !target_moves {
                return None;
            }
            // di chi scrive, e il rename non è il momento di discuterla.
            // Innesta una sintassi su un provider (§3.1), o dice **perché no**.
            return Some(format!("/{}", rules_path::percent_encode_path(to.as_str())));
        }
        let src_after = if source_moves { to } else { src };
        let target_after = if target_moves { to } else { &resolved };
        Some(rules_path::relative_ref(src_after, target_after))
    }

    ///
    /// Il `Result` non è cerimonia: due regole che rivendicano la stessa
    /// sintassi sono un conflitto, e il modo in cui questo registro sbagliava
    /// prima era proprio non avere dove dirlo.
    // La regola dei nomi è **una** (§7.4): questa famiglia aveva la
    pub fn register_syntax_rule(
        &mut self,
        plugin: impl Into<String>,
        rule: Box<dyn SyntaxRule>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let spec = rule.spec();
        let id = spec.id;
        // propria — «serve un `ns:nome`», senza sapere di chi — e chiedeva un
        // namespace anche al core mentre non chiedeva a nessuno che fosse il
        // *suo*. Adesso passa di qui come le altre.
        // E vale anche per i `custom_kind` che la regola si impegna a emettere:
        self.providers.plugins.admit(
            &plugin,
            RegistrationKind::Syntax,
            std::slice::from_ref(&id),
        )?;
        // sono nomi che entrano nel modello, e senza questa riga un terzo
        // dichiara `callout` e si fa disegnare dal core. Non passano da `admit`
        // perché produrre lo stesso kind in due non è una contesa — è come si
        // scrivono due dialetti della stessa famiglia.
        // Registra chi disegna un `custom_kind` (§3.2).
        self.providers
            .plugins
            .check_names(&plugin, &spec.produces)?;
        self.docs
            .syntax
            .register(rule)
            .map_err(RegistryError::Syntax)?;
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Syntax, std::slice::from_ref(&id));
        Ok(())
    }

    ///
    /// Il [`Trust`] è quello del **plugin** e non un parametro di questa
    /// chiamata: un `CustomRendering::Ui` è un albero di UI, e da chi non è il
    /// core il contenuto attivo si rifiuta a qualunque profondità — ma *quanto*
    /// ci si fida di qualcuno è una proprietà sua, non di ogni cosa che
    /// registra (§7.3).
    /// I `custom_kind` che qualcuno **produce** e nessuno **disegna**.
    pub fn register_custom_renderer(
        &mut self,
        plugin: impl Into<String>,
        renderer: Box<dyn CustomRenderer>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let id = renderer.spec().id;
        self.providers.plugins.admit(
            &plugin,
            RegistrationKind::Renderer,
            std::slice::from_ref(&id),
        )?;
        let trust = self.providers.plugins.trust_of(&plugin).unwrap_or_default();
        self.docs
            .renderers
            .register(trust, renderer)
            .map_err(RegistryError::Renderer)?;
        self.providers.plugins.record(
            &plugin,
            RegistrationKind::Renderer,
            std::slice::from_ref(&id),
        );
        Ok(())
    }

    ///
    /// È il conto che il §3.2 chiedeva di poter fare: ogni nome qui dentro è un
    /// blocco che l'utente leggerà crudo — il degrado generico funziona, ma
    /// nessuno ha detto chi lo disegnerebbe. Chi monta l'app può guardarlo; oggi
    /// non c'è ancora una superficie dove mostrarlo (§20.4).
    /// Il modello parsato di un documento (§4.2): la metà kernel di
    pub fn undrawn_kinds(&self) -> Vec<String> {
        self.docs.undrawn_kinds()
    }

    /// [`VaultRead::read_model`](fub_abi::traits::VaultRead::read_model).
    ///
    /// **Rilegge e riparsa dal disco**, con le regole di sintassi registrate già
    /// applicate — è la stessa catena di `render_preview`, senza il rendering.
    /// La cache tiene i soli metadati (vedi `DocMeta`, interno), quindi il corpo non c'è
    /// e non si può servire da lì: chi vuole i metadati passa da
    /// [`query_index`](Workspace::query_index), che risponde senza toccare il
    /// disco.
    ///
    /// Un documento che il workspace non conosce è `NotFound`. Un file documento
    /// presente sul disco ma assente dai metadati può invece essere stato
    /// scartato perché il parse è fallito: in quel caso lo ripariamo comunque,
    /// così il chiamante riceve il `FormatError` reale (e non un falso
    /// `NotFound`). Asset, directory e file senza provider restano assenti.
    /// Di che formato è un documento, e che sintassi capirebbe (§4.3): la metà
    pub fn read_model(&self, id: &DocId) -> Result<DocumentModel> {
        let indexed = self.indexes.core.metas.contains_key(id);
        let parseable_file =
            self.docs.vault.stat(id).is_some() && self.docs.provider_for(id).is_ok();
        if !indexed && !parseable_file {
            return Err(KernelError::NotFound(id.to_string()));
        }
        self.docs.parse_from_disk(id)
    }

    /// kernel di [`VaultRead::format_of`](fub_abi::traits::VaultRead::format_of).
    ///
    /// Non tocca il disco e non chiede che il documento esista: è una domanda
    /// sull'**estensione**, e il registro dei formati è l'unico che sa
    /// rispondere. `None` = nessun provider la rivendica.
    ///
    /// Le capacità sono quelle **effettive**: quelle del provider, sovrapposte
    /// da quelle che le [`SyntaxRule`] registrate
    /// gli innestano (§3.1). L'ordine della sovrapposizione dice chi vince su
    /// una chiave condivisa, ed è il provider: se sa fare `fub:math` per conto
    /// suo, il suo dettaglio è più informativo del semplice «acceso» che una
    /// regola può dichiarare.
    /// Le sintassi di questo documento **con la loro forma**, per chi deve
    pub fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        self.docs.format_of(id)
    }

    /// disegnare invece di parsare (§4.4).
    ///
    /// Vedi [`crate::documents::DocumentStore::syntax_forms`]: è `format_of`
    /// per una superficie di scrittura, che il modello non ce l'ha e non può
    /// averlo — il buffer che ha in mano è sporco, e un modello spedito di là
    /// sarebbe vero solo quando serve meno
    /// ([0018](../../../docs/decisions/0182-provider-e-porte-generiche.md)).
    /// Rende l'anteprima di un documento: l'HTML del provider, e le parti
    pub fn syntax_forms(&self, id: &DocId) -> Vec<SyntaxForm> {
        self.docs.syntax_forms(id)
    }

    /// **dichiarative** che i renderer registrati hanno prodotto.
    ///
    /// Il corpo non sta in cache (split metadata/body): si rilegge e riparsa
    /// dal disco, nella forma che il provider ha dichiarato (§3.4). Il render è
    /// per-documento e on demand — è esattamente il tipo di lettura che il disco
    /// serve bene, mentre la cache calda serve le mutazioni.
    /// Rende il contenuto di un embed `![[page#heading]]` o `![[page#^blocco]]`:
    pub fn render_preview(&self, id: &DocId) -> Result<RenderedDocument> {
        if !self.indexes.core.metas.contains_key(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let model = self.docs.parse_from_disk(id)?;
        let provider = self.docs.provider_for(id)?;
        Ok(renderer::compose(
            &model,
            provider,
            &self.docs.renderers,
            &RenderOptions::preview(),
        )?)
    }

    /// risolve la pagina e rende l'intero documento, o la sola sezione del
    /// heading richiesto, o il solo blocco che porta quell'ancora.
    ///
    /// È il pezzo kernel della **transclusion**: `render_html` dei provider
    /// resta una funzione pura per-documento (emette solo un placeholder per
    /// gli embed); la composizione è del frontend, che chiama questo metodo e
    /// innesta l'HTML nel placeholder. Ricorsione, profondità massima e cicli
    /// sono gestiti dal chiamante, che conosce la catena di embed corrente
    /// (vedi `../../../docs/architecture/frontend-and-ipc.md`).
    ///
    /// # Chi vince fra i due, e perché non è una scelta di comodo
    ///
    /// Un `LinkTarget::Wiki` può portarli tutti e due, e allora **vince il
    /// blocco**: un'ancora di blocco è unica nel documento — è la chiave con cui
    /// [`canonical_anchor`] la risolve — mentre un heading nomina un intervallo
    /// che la contiene. Chiedere «la sezione X, e dentro il blocco b» e
    /// chiedere «il blocco b» sono la stessa domanda, e la seconda si risponde
    /// senza guardare la prima.
    // Come `render_preview`: il corpo si riparsa dal disco on demand.
    pub fn render_embed(
        &self,
        page: &str,
        heading: Option<&str>,
        block: Option<&str>,
    ) -> Result<(DocId, RenderedDocument)> {
        let id = self
            .resolve_link(page)
            .ok_or_else(|| KernelError::NotFound(page.to_string()))?;
        if !self.indexes.core.metas.contains_key(&id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        // Anche un embed passa dai renderer: un diagramma dentro una nota
        let model = self.docs.parse_from_disk(&id)?;
        let provider = self.docs.provider_for(&id)?;
        let opts = RenderOptions::preview();
        let model =
            match (block, heading) {
                (Some(b), _) => block_of(&model, b)
                    .ok_or_else(|| KernelError::NotFound(format!("{id}#^{b}")))?,
                (None, Some(h)) => section_of(&model, h)
                    .ok_or_else(|| KernelError::NotFound(format!("{id}#{h}")))?,
                (None, None) => model,
            };
        // trascluso resta un diagramma. Gli slot delle parti sono numerati
        // dentro QUESTA composizione, e il frontend li monta dentro il
        // segnaposto dell'embed che ha appena idratato.
        // Backlink verso un documento.
        Ok((
            id,
            renderer::compose(&model, provider, &self.docs.renderers, &opts)?,
        ))
    }

    /// Link uscenti risolti da un documento.
    pub fn backlinks(&self, id: &DocId) -> Vec<BacklinkRef> {
        self.indexes.core.graph.backlinks(id)
    }

    /// Risolve il nome di un wikilink a un documento esistente.
    pub fn outgoing(&self, id: &DocId) -> Vec<DocId> {
        self.indexes.core.graph.outgoing(id)
    }

    ///
    /// È il comodo del kernel per sé e per i propri banchi di prova. Chi sta
    /// **fuori** — la shell, un provider — passa da
    /// [`IndexQuery::Resolve`](fub_abi::traits::IndexQuery::Resolve), che è la
    /// stessa risposta per tutti e le tre specie di bersaglio invece di una
    /// sola: finché questa era raggiungibile solo per un comando IPC scritto
    /// apposta, era un fatto sul vault che la shell conosceva e un plugin no.
    // --- sessione ----------------------------------------------------------
    pub fn resolve_link(&self, page: &str) -> Option<DocId> {
        self.indexes.core.graph.resolve_wiki(page)
    }

    /// Pubblica il contesto del pannello con il focus e restituisce **le view
    ///
    /// da ridisegnare**: quelle il cui `follows` interseca ciò che è cambiato,
    /// in ordine di registrazione.
    ///
    /// Lo chiama la shell a ogni cambio di nota, di selezione o di modalità. È
    /// l'unico modo di scrivere il contesto: le view lo **leggono** via
    /// [`HostEnv::active_context`](fub_abi::traits::HostEnv::active_context),
    /// nessuno lo scrive dall'interno del contratto — vedi il campo `session` e [`Session`].
    ///
    /// Il conto di *cosa* ridisegnare sta qui e non nella shell perché la
    /// risposta non deve dipendere da chi la calcola: la regola è una
    /// ([`ViewContext::changes`]), e a M5 un host diverso avrà la stessa. La
    /// shell resta padrona del *quando* (è lei a pubblicare) e ignara del
    /// *chi* (non conosce gli id delle view).
    // Il taglio del §8.1 passa qui: la sessione dice *cosa* è cambiato, il
    pub fn set_active_context(&self, context: Option<ViewContext>) -> Vec<String> {
        // workspace traduce la maschera in id di view. È deliberato che il
        // componente non sappia che le view esistono.
        // `views()` risolve già le due maschere sull'esemplare unico (§22.3):
        let changed = self.session.publish(context);
        if changed.is_empty() {
            return Vec::new();
        }
        // qui non serve una seconda strada per la stessa domanda, e averla
        // vorrebbe dire due posti dove la regola può divergere.
        // Scorciatoia per chi ha un pannello solo: il documento attivo, senza
        self.views()
            .into_iter()
            .filter(|spec| spec.follows.intersects(&changed))
            .map(|spec| spec.id)
            .collect()
    }

    /// selezione né modalità dichiarata.
    ///
    /// Non è una seconda strada per la stessa cosa — è la stessa strada con i
    /// campi che chi non ha lo split non ha da dire. Azzera la selezione:
    /// dichiarare un documento e lasciare la selezione del precedente sarebbe
    /// l'unico modo di produrre uno span mentitore.
    ///
    /// La shell **non passa più di qui** dal §1.2: i suoi riquadri sono N e
    /// pubblica `ViewContext` interi. Restano i test e gli esempi, ed è il
    /// motivo per cui questo non si toglie — la comodità è onesta, e nominare
    /// `MAIN_PANE` in un banco con un riquadro solo è ciò che si vuole davvero
    /// dire. Che i riquadri siano N non ha cambiato niente qui sotto: il kernel
    /// non tiene una mappa di riquadri e non deve, perché la domanda a cui
    /// risponde — cosa sta guardando l'utente adesso — è una sola per
    /// definizione (vedi la 0078).
    /// Il contesto del pannello con il focus, se la shell ne ha pubblicato uno.
    pub fn set_active_document(&self, id: Option<DocId>) -> Vec<String> {
        let context = id.map(|id| ViewContext::new(MAIN_PANE).with_doc(Some(id)));
        self.set_active_context(context)
    }

    /// Il documento del contesto attivo: la lettura che il kernel usa dove il
    pub fn active_context(&self) -> Option<ViewContext> {
        self.session.context()
    }

    /// pannello non c'entra (rename, rimozione, comodità dei test).
    // --- indici -----------------------------------------------------------
    pub fn active_document(&self) -> Option<DocId> {
        self.session.document()
    }

    /// Interroga il canale dati.
    ///
    ///
    /// **Un percorso di dispatch solo.** Prima erano due e mezzo: sette varianti
    /// su nove le serviva il kernel con un `return` anticipato, e le altre due
    /// giravano su tutti gli indici registrati in ordine finché uno non
    /// rispondeva `BadArgs`. Adesso chi serve cosa è dichiarato
    /// ([`QueryRoute`]), le risposte del kernel
    /// sono un indice registrato per primo, e ciò che nessuno serve torna come
    /// [`PluginError::Unserved`] invece che come l'errore dell'ultimo
    /// interpellato.
    ///
    /// Chi compone la risposta quando la domanda ha foglie di proprietari
    /// diversi è il pianificatore (vedi [`crate::index::plan`]).
    ///
    /// # E poi la risposta si **localizza**
    ///
    /// Un risultato di ricerca che sa dire *quale nota* e non *a che punto*
    /// rende inesprimibili tre cose (la ricerca dentro la nota aperta, il salto
    /// all'occorrenza successiva, N risultati per nota): è la §21.3, chiusa
    /// dalla decisione 0049 con
    /// [`DocumentMatch::occurrences`](fub_abi::traits::DocumentMatch::occurrences).
    ///
    /// A riempirle è **qui**, e non chi indicizza, per una ragione di verità e
    /// non di comodo: le coordinate sono byte del **sorgente**, e chi indicizza
    /// ha in mano la proiezione a testo piano del documento — vedi
    /// [`crate::occurrences`]. Il sorgente ce l'ha il vault, cioè questo
    /// componente, che è anche l'unico punto in cui *ogni* risposta passa,
    /// compresa quella di un motore di terzi che rivendicasse
    /// [`QueryKind::Documents`](fub_abi::traits::QueryKind::Documents).
    ///
    /// Chi ha già riempito `occurrences` non viene toccato: un indice che
    /// sappia dire *dove* — perché tiene i sorgenti, perché è un motore diverso
    // La resa (§1.6, decisione 0163) è intercettata qui e non passa da
    pub fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        // `indexes.query`: `CoreIndex` non ha i documenti né i renderer, e la
        // rotta che dichiara (`QueryRoute::Query`) serve solo a dire che il
        // kernel è il risponditore — come Outline. La fast-path di prima era un
        // comando Tauri bespoke; adesso è il canale dati di tutti.
        // Le etichette, come la resa: `CoreIndex` ha lo store e non i
        match query {
            IndexQuery::RenderPreview { doc } => Ok(IndexResult::RenderPreview(
                self.render_preview(&doc)?.into(),
            )),
            IndexQuery::RenderEmbed {
                page,
                heading,
                block,
            } => {
                let (doc_id, content) =
                    self.render_embed(&page, heading.as_deref(), block.as_deref())?;
                Ok(IndexResult::RenderEmbed(EmbedContent {
                    doc_id: doc_id.0,
                    content: content.into(),
                }))
            }
            // cataloghi. `settings_entries` risolve per proprietario; senza
            // questa porta un `Text::Message` uscirebbe nudo, e sul filo
            // diventerebbe `{"key": …}` dove la shell si aspetta una stringa
            // `[object Object]` nel pannello. Presidiato da
            // `settings_as_out_resolved_too`.
            // Apre i sorgenti della pagina e ci trova dentro i testi cercati.
            IndexQuery::Settings { plugin } => Ok(IndexResult::Settings(
                self.settings_entries(plugin.as_deref()),
            )),
            IndexQuery::SyntaxForms { doc } => {
                Ok(IndexResult::SyntaxForms(self.syntax_forms(&doc)))
            }
            other => {
                let needles = occurrences::wanted(&other);
                let result = self.indexes.query(other)?;
                match result {
                    IndexResult::Documents(page) if !needles.is_empty() => {
                        Ok(IndexResult::Documents(self.locate(page, &needles)))
                    }
                    other => Ok(other),
                }
            }
        }
    }

    ///
    /// Costa **una lettura per riga**, e il tetto di
    /// [`occurrences::max_docs`] è ciò che impedisce a una domanda senza
    /// finestra di aprire il vault intero: oltre quel numero le righe restano
    /// senza coordinate, che è ciò che `occurrences` vuoto significa da
    /// contratto. Un documento che non si legge o che è sparito da sotto non è
    /// un errore della ricerca — la riga resta, senza il punto.
    // La revisione è quella del testo appena letto, non una presa
    fn locate(&self, mut page: Paged<DocumentMatch>, needles: &[String]) -> Paged<DocumentMatch> {
        for hit in page.items.iter_mut().take(occurrences::max_docs()) {
            if !hit.occurrences.is_empty() {
                continue;
            }
            let Ok(source) = self.docs.read_source(&hit.doc) else {
                continue;
            };
            // altrove: uno span vale sul sorgente su cui è stato misurato, e
            // dire «di quando» con l'impronta di un'altra lettura sarebbe la
            // bugia che il campo esiste per impedire.
            // Chi risponderebbe a questa domanda, e come: il piano.
            let revision = Revision::of(&source);
            hit.occurrences = occurrences::locate(&source, needles)
                .into_iter()
                .map(|span| DocPosition::at(span, revision.clone()))
                .collect();
        }
        page
    }

    ///
    /// Serve a due cose che valgono adesso — **provare** il routing invece di
    /// descriverlo, e dire in un messaggio chi avrebbe dovuto rispondere. Non è
    /// l'explain plan di 9.2, che è una superficie con altri clienti.
    /// Le rotte dichiarate: chi serve cosa, oggi, in questo montaggio.
    pub fn query_plan(&self, query: &IndexQuery) -> QueryPlan {
        self.indexes.plan_of(query)
    }

    ///
    /// Non attraversa il contratto — l'inventario di ciò che è attivo è il §7.6
    /// — ma è ciò che rende il routing ispezionabile invece che descritto.
    /// Porta gli indici a un punto di consistenza (vedi
    pub fn query_routes(&self) -> Vec<(QueryRoute, String)> {
        self.indexes
            .routes
            .declared()
            .into_iter()
            .map(|(route, target)| (route, self.indexes.name_of(target)))
            .collect()
    }

    /// [`IndexProvider::flush`]). Da chiamare quando un lotto di modifiche è
    /// finito: il kernel non decide da solo *quando* è finito un lotto.
    ///
    /// È una **fase sua** (difetto 0113): chi ha i thread la chiama in un
    /// prestito esclusivo separato da quello della chiusura dell'indicizzazione
    /// ([`finish_index_with_graph`]), come la terza fase di
    /// `ExternalSync::batch`. Fra i due prestiti il lucchetto si rilascia, e
    /// un lettore concorrente non aspetta la somma delle fasi ma la sola che
    /// sta correndo — il flush tocca solo gli indici e il disco, non lo stato
    /// condiviso del workspace.
    ///
    /// L'errore di un indice non fa fallire il chiamante — un indice è stato
    /// *derivato*, la verità è il vault e si ricostruisce.
    ///
    /// **Li racconta da sé** (§20.3, decisione 0052), e continua a
    /// restituirli. È la forma della
    /// [decisione 0030](../../../docs/decisions/0183-composizione-host-kernel.md):
    /// un `Result` che dipende dall'attenzione di chi lo riceve è un `Result`
    /// che si perde, e il posto dove metterlo al sicuro è dentro chi lo
    /// produce. Qui il doc diceva «restituisce gli errori perché chi ha un
    /// canale di notifica possa mostrarli», e i tre chiamanti in produzione
    /// erano un `eprintln!`, un `let _ =` e una risalita fino a un altro
    /// `eprintln!` — il canale era stato costruito e collegato a metà.
    ///
    /// Il valore di ritorno resta perché c'è un chiamante che deve **agire** e
    /// non solo mostrare: la chiusura del vault (decisione 0029) li risale fino
    /// a chi spegne l'app, e in quel momento l'event bus sta per smettere di
    /// avere ascoltatori. Chi si limita a guardare adesso non deve più fare
    /// niente.
    ///
    /// È anche il punto in cui un indice **scrive**: riceve un [`HostApi`]
    /// intestato al proprio id, come gli event handler durante il dispatch.
    /// Gli indici escono dal workspace per la durata delle chiamate, così
    /// l'host può prestare `&mut Workspace` senza aliasing.
    // Un flush fallito è la perdita di un **derivato**: il vault è intatto,
    pub fn flush_indexes(&mut self) -> Vec<PluginError> {
        let errors = self.lend(
            |ws| &mut ws.indexes.providers,
            |ws, indexes| {
                let mut errors = Vec::new();
                for (id, index) in indexes.iter() {
                    let mut index = index.write();
                    let mut host = ws.host_for(id, InvokeMode::Apply);
                    if let Err(and) = index.flush(&mut host) {
                        errors.push(and);
                    }
                }
                errors
            },
        );
        // e ciò che non è stato scritto si ricostruisce alla riapertura. Non
        // nomina un documento — il flush è per indice, non per nota — ed è
        // esattamente il caso per cui il soggetto di un guasto è opzionale.
        // Ciò che i flush hanno emesso si consegna a chiamate tornate, non
        for error in errors.iter().cloned() {
            self.report_trouble(Severity::Warning, None, error, None);
        }
        // dentro il frame di un provider.
        // --- view dichiarative -------------------------------------------------
        self.dispatch_pending();
        errors
    }

    /// Registra un [`ViewProvider`] sotto un id, dichiarando **quanto ci si
    ///
    /// fida** di ciò che produce.
    ///
    /// `id` è l'identità del provider, come per gli handler e gli indici:
    /// determina lo spazio dati che l'[`HostApi`] gli concede.
    /// Registra un `ViewProvider` **sostituendo** chi possedeva gli stessi id
    pub fn register_view_provider(
        &mut self,
        plugin: impl Into<String>,
        provider: Box<dyn ViewProvider>,
    ) -> std::result::Result<(), RegistryError> {
        self.mount_views(plugin.into(), provider, false)
    }

    /// di view.
    ///
    /// È la stessa disciplina delle rotte (decisione 0019) e del registro dei
    /// formati (decisione 0017), portata all'ultima famiglia che risolveva un
    /// id per tentativi: sostituire resta possibile, ma **si chiede per nome**
    /// invece di succedere a chi si registra per primo.
    // Il permesso **prima** di togliere chi c'era: una sostituzione ha due
    pub fn replace_view_provider(
        &mut self,
        plugin: impl Into<String>,
        provider: Box<dyn ViewProvider>,
    ) -> std::result::Result<(), RegistryError> {
        self.mount_views(plugin.into(), provider, true)
    }

    fn mount_views(
        &mut self,
        plugin: String,
        provider: Box<dyn ViewProvider>,
        replacing: bool,
    ) -> std::result::Result<(), RegistryError> {
        let specs = crate::providers::declared_specs(provider.as_ref());
        let ids: Vec<String> = specs.iter().map(|s| s.id.clone()).collect();
        // effetti, e un rifiuto in mezzo lascerebbe il primo fatto e il secondo
        // no — cioè una view del core cancellata da chi non poteva nemmeno
        // nominarla, con in mano un errore che dice «non è registrato».
        // Il grado di fiducia è quello del plugin: era un parametro di questa
        if replacing {
            self.providers
                .plugins
                .admit_replacing(&plugin, RegistrationKind::View, &ids)?;
            self.providers.plugins.forget(RegistrationKind::View, &ids);
            self.providers
                .views
                .retain(|v| !v.specs.iter().any(|s| ids.contains(&s.id)));
        } else {
            self.providers
                .plugins
                .admit(&plugin, RegistrationKind::View, &ids)?;
        }
        // sola registrazione, ed è la ragione per cui un `IndexProvider` di
        // terzi avrebbe ricevuto ogni documento del vault senza che nessuno gli
        // avesse dato un grado (§7.3).
        // Rilegge ciò che un provider dichiara: view e comandi.
        let trust = self.providers.plugins.trust_of(&plugin).unwrap_or_default();
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::View, &ids);
        self.providers.views.push(RegisteredView {
            id: plugin,
            specs,
            provider: Arc::new(SharedShelter::new(provider)),
            trust,
        });
        Ok(())
    }

    ///
    /// È l'altra metà di «le spec sono dato di registrazione»: il kernel tiene
    /// la verità, e chi cambia idea **lo dice**. Non è una capacità
    /// dell'[`HostApi`] e non attraversa il contratto, per la regola della
    /// decisione 0013 — una capacità entra quando la chiede un cliente vero, e
    /// oggi nessun provider cambia il proprio elenco a runtime. Il giorno che
    /// succederà (un plugin che registra una view per ogni database aperto) è un
    /// metodo additivo, e questa è la sua metà kernel già in piedi.
    ///
    /// **Cambiare idea non scavalca la regola dei nomi** (§7.4): i nomi nuovi
    /// passano dallo stesso varco della registrazione, e quelli che erano già
    /// suoi non sono una contesa con sé stesso. Era l'ultimo modo di aggirarla —
    /// registrarsi con un id ammissibile e poi dichiararne un altro — e valeva
    /// anche per l'inventario, che restava a raccontare la registrazione invece
    /// dello stato.
    ///
    /// Un rifiuto non cambia niente: le due famiglie si convalidano **prima**
    /// che l'una o l'altra si muova.
    /// Le view offerte dai provider registrati, in ordine di registrazione,
    pub fn refresh_specs(&mut self, id: &str) -> std::result::Result<(), RegistryError> {
        self.providers.refresh_specs(id)
    }

    /// **coi titoli risolti** nella lingua di chi guarda (§12.1).
    ///
    /// Le due maschere che escono di qui sono quelle dell'**esemplare unico**
    /// (§22.3): le risolve
    /// [`declared_specs`](crate::providers::declared_specs) al momento della
    /// registrazione, che è dove le spec si chiedono — una volta sola, come
    /// tutto il resto di ciò che un provider dichiara.
    /// Rende una view e restituisce il suo albero di UI.
    pub fn views(&self) -> Vec<ViewSpec> {
        self.providers
            .view_specs_by_owner()
            .into_iter()
            .map(|(owner, mut spec)| {
                self.localize(&owner, &mut spec);
                spec
            })
            .collect()
    }

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
    // Anche il percorso di lettura passa dal punto di applicazione: un
    pub fn prepare_view_render(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<PreparedViewRender, PluginError> {
        let at = self.view_owner(&instance.view)?;
        let registered = &self.providers.views[at];
        self.check_params(at, instance)?;
        Ok(PreparedViewRender {
            owner: registered.id.clone(),
            view: instance.view.clone(),
            instance: instance.clone(),
            trust: registered.trust,
            provider: Arc::clone(&registered.provider),
        })
    }

    /// Applica il confine di fiducia e la localizzazione dopo che il provider è
    /// tornato. Nessun codice del provider viene eseguito in questa fase.
    pub fn finish_view_render(
        &self,
        prepared: PreparedViewRender,
        outcome: std::result::Result<UiNode, PluginError>,
    ) -> std::result::Result<UiNode, PluginError> {
        let mut tree = outcome.map_err(|and| self.localized(&prepared.owner, and))?;
        guard_ui(prepared.trust, &tree)?;
        self.localize(&prepared.owner, &mut tree);
        Ok(tree)
    }

    pub fn render_view(&self, instance: &ViewInstance) -> std::result::Result<UiNode, PluginError> {
        let prepared = self.prepare_view_render(instance)?;
        let owner = prepared.owner().to_string();
        let instance_id = prepared.instance_id().to_string();
        let host = self.read_host_for_view(&owner, Some(instance_id.as_str()));
        let outcome = prepared.invoke(&host);
        self.finish_view_render(prepared, outcome)
    }

    ///
    /// A differenza dei campi omonimi della spec — dichiarati prima che un
    /// esemplare esistesse — questa la risponde il provider, che ha davanti i
    /// parametri con cui l'esemplare è stato aperto. Per l'esemplare unico la
    /// risposta è già dentro [`views`](Self::views); serve a chi ne apre uno
    /// **con parametri**, ed è il verso in cui il §22.3 continua.
    /// Consegna un'azione della UI al provider della view e restituisce il suo
    pub fn view_interests(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<ViewInterests, PluginError> {
        let at = self.view_owner(&instance.view)?;
        let registered = &self.providers.views[at];
        let provider = registered.provider.read();
        Ok(provider.interests(instance))
    }

    /// aggiornamento. Ogni albero che l'aggiornamento porta con sé —
    /// [`ViewUpdate::Replace`] e [`ViewUpdate::Patch`] — passa dalla stessa
    /// validazione di [`render_view`](Workspace::render_view): un provider non
    /// fidato non può iniettare contenuto attivo *in risposta a un click*
    /// invece che al rendering, né per la via stretta invece che per quella
    /// larga.
    // Prima del `take`: dopo, il registro è vuoto.
    /// Prepara un'azione di view senza eseguire codice del provider. Il flag di
    /// provider-call viene aperto qui e chiuso in `finish_view_action`, così gli
    /// eventi prodotti dalla callback non possono rientrare nel suo frame.
    pub fn prepare_view_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
    ) -> std::result::Result<PreparedViewAction, PluginError> {
        let at = self.view_owner(&instance.view)?;
        self.check_params(at, instance)?;
        let (owner, trust, provider) = {
            let registered = &self.providers.views[at];
            (
                registered.id.clone(),
                registered.trust,
                Arc::clone(&registered.provider),
            )
        };
        let previous_provider_call = self.dispatch.enter_provider_call();
        Ok(PreparedViewAction {
            owner,
            view: instance.view.clone(),
            instance: instance.clone(),
            action: Some(action),
            trust,
            provider,
            previous_provider_call,
        })
    }

    /// Chiude il frame aperto da `prepare_view_action` e riproduce l'epilogo
    /// del vecchio percorso: ripristino flag, errore localizzato, trust gate,
    /// localizzazione e soltanto alla fine consegna degli eventi accodati.
    pub fn finish_view_action(
        &mut self,
        prepared: PreparedViewAction,
        outcome: std::result::Result<ViewUpdate, PluginError>,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let mut update = outcome.map_err(|and| self.localized(&prepared.owner, and))?;
        let tree = match &update {
            ViewUpdate::Replace { root } => Some(root),
            ViewUpdate::Patch { node, .. } => Some(node),
            ViewUpdate::None
            | ViewUpdate::Navigate { .. }
            | ViewUpdate::Reveal { .. }
            | ViewUpdate::RunSearch { .. }
            | ViewUpdate::Custom { .. } => None,
        };
        if let Some(tree) = tree {
            guard_ui(prepared.trust, tree)?;
        }
        self.localize(&prepared.owner, &mut update);
        self.dispatch_pending();
        Ok(update)
    }

    /// Compatibilità per i chiamanti diretti del kernel. L'host di processo usa
    /// le tre fasi separatamente, perché solo lui possiede `Custody<Workspace>`.
    pub fn view_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let mut prepared = self.prepare_view_action(instance, action)?;
        let owner = prepared.owner().to_string();
        let instance_id = prepared.instance_id().to_string();
        let outcome = {
            let mut host = self.host_for_view(&owner, InvokeMode::Apply, Some(&instance_id));
            prepared.invoke(&mut host)
        };
        self.finish_view_action(prepared, outcome)
    }

    ///
    /// È l'unico punto di convalida, e sta qui per la stessa ragione per cui ci
    /// stanno gli argomenti di un comando: uno schema che a farlo rispettare è
    /// chi lo pubblica non è uno schema, è un commento. Il provider riceve
    /// `params` già buoni e non deve difendersi da chi apre.
    /// Chi possiede una view, per posizione. `UnknownView` se nessuno.
    fn check_params(
        &self,
        at: usize,
        instance: &ViewInstance,
    ) -> std::result::Result<(), PluginError> {
        self.providers.check_params(at, instance)
    }

    // --- comandi -----------------------------------------------------------
    fn view_owner(&self, view: &str) -> std::result::Result<usize, PluginError> {
        self.providers.view_owner(view)
    }

    //
    // Il registro della decisione 0009: un'azione si dichiara una volta e la chiedono tutti
    // — la palette, la tastiera, una macro, la CLI, il centro di comando. Il
    // kernel non sa cosa faccia un comando; sa scegliere chi lo possiede,
    // convalidare ciò che gli si passa e decidere **quali capacità** prestargli.
    /// Registra un [`CommandProvider`] sotto un id, con la stessa disciplina
    ///
    /// degli altri provider: l'id è lo spazio dati che l'[`HostApi`] gli
    /// concede, e l'ordine di registrazione è l'ordine in cui i comandi
    /// compaiono e in cui si risolve un id conteso.
    // Le **scorciatoie** come impostazioni (§18.2): una chiave per comando,
    pub fn register_command_provider(
        &mut self,
        plugin: impl Into<String>,
        provider: Box<dyn CommandProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let specs = provider.commands();
        let ids: Vec<String> = specs.iter().map(|s| s.id.clone()).collect();
        self.providers
            .plugins
            .admit(&plugin, RegistrationKind::Command, &ids)?;
        // fabbricata qui e non chiesta a chi registra. Chiederla avrebbe voluto
        // dire che un comando con la scorciatoia riconfigurabile è un comando il
        // cui autore si è ricordato di dichiararne una — cioè la proprietà che
        // interessa affidata alla diligenza, mentre l'utente che vuole
        // rimappare *quel* comando non ha modo di sapere perché non può.
        //
        // Va **dopo** `admit` e prima di `record`: `admit` è ciò che verifica
        // che quegli id siano nominabili da questo plugin, e sintetizzare una
        // chiave dal nome di un comando che il registro sta per rifiutare
        // vorrebbe dire dichiarare l'impostazione di un comando che non
        // esisterà.
        // La firma resta `Box` — è quella degli altri `register_*`, e chi
        let keys = self.keybinding_specs(&specs);
        if let Err(why) = self
            .settings
            .write()
            .expect("store di configurazione")
            .declare(&plugin, &keys)
        {
            return Err(RegistryError::Setting(why));
        }
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Command, &ids);
        // registra non deve sapere perché qui dentro serve un `Arc` (decisione 0013:
        // `run_command` rientra nel registro mentre il registro è in uso).
        // Le impostazioni `keys.<id>` di un elenco di comandi (§18.2).
        self.providers.commands.push(RegisteredCommand {
            id: plugin,
            specs,
            provider: Arc::from(provider),
        });
        Ok(())
    }

    ///
    /// Tre scelte, e ognuna ha la sua ragione:
    ///
    /// - **Il default è il suggerimento dichiarato** (`CommandSpec.keybinding`,
    ///   o la stringa vuota). Ne segue la proprietà che rende superflua ogni
    ///   regola di fusione a valle: il valore *efficace* della chiave **è** la
    ///   scorciatoia, sempre — e `SettingSource` dice da sé se l'utente l'ha
    ///   cambiata, che è ciò da cui il pannello decide se mostrare «azzera».
    /// - **L'etichetta e la descrizione sono quelle del comando**, riusate
    ///   com'erano. Sono già dei `Text` del catalogo del suo proprietario, e
    ///   inventare qui due chiavi nuove avrebbe voluto dire chiedere a ogni
    ///   componente di tradurre una seconda volta il nome che ha già tradotto.
    /// - **Nessun gruppo.** Un'intestazione si raggruppa per *testo risolto*
    ///   (vedi [`SettingSpec::group`]), quindi una chiave di gruppo del core non
    ///   si tradurrebbe nel catalogo di un plugin: dire «Scorciatoie» a nome di
    ///   qualcun altro è ciò che qui non si può fare. A metterle insieme è la
    ///   shell, che sa comporre la chiave e quindi sa riconoscerle.
    ///
    /// Non è `program_writable`: quali tasti fanno cosa è dell'utente, ed è lo
    /// stesso argomento delle chiavi `locale.*`.
    /// Le impostazioni `<id>:permissions.<nome>` di un plugin dichiarato
    fn keybinding_specs(&self, specs: &[CommandSpec]) -> Vec<SettingSpec> {
        specs
            .iter()
            .map(|spec| {
                SettingSpec::new(
                    fub_abi::settings::keybinding_key(&spec.id),
                    spec.title.clone(),
                    SettingKind::Text {
                        default: spec.keybinding.clone().unwrap_or_default(),
                    },
                )
                .describing(spec.description.clone())
            })
            .collect()
    }

    /// (§23.17): una per ogni permesso **che il suo manifest dichiara e che
    /// questo host conosce**.
    ///
    /// Quattro scelte, e ognuna ha la sua ragione.
    ///
    /// - **Solo i permessi dichiarati.** Un componente che non chiede la rete
    ///   non ha un interruttore della rete: un elenco di tredici righe quasi
    ///   tutte spente direbbe *cosa esiste* dove chi guarda vuole sapere *cosa
    ///   è stato chiesto*.
    /// - **Solo quelli che l'host conosce**
    ///   ([`permission::ALL`](fub_abi::options::permission::ALL)). Un permesso
    ///   fuori da quell'elenco non governa nessuna famiglia, quindi negarlo non
    ///   negherebbe niente — e un interruttore che non fa niente insegna a non
    ///   fidarsi degli interruttori (è la stessa riga con cui il pannello
    ///   nasconde «azzera» dove non c'è nulla da azzerare). Che quel permesso
    ///   *esista* nel manifest resta visibile: lo porta `PluginInfo`, e chi
    ///   disegna lo dice per quello che è.
    /// - **Il default è `true`.** Ciò che il manifest dichiara è concesso
    ///   finché qualcuno non dice di no. È l'unica forma che non cambia il
    ///   comportamento di ieri: un permesso che nessuno ha mai potuto vedere non
    ///   deve cominciare a mancare il giorno in cui acquista un interruttore.
    /// - **L'etichetta è la chiave del permesso, non una frase.** È deliberato,
    ///   ed è la riga di sicurezza di questa voce: la frase che l'utente legge
    ///   accettando *«può connettersi a qualunque host»* non deve poterla
    ///   scrivere chi il permesso lo sta chiedendo. Un `Text` di catalogo qui si
    ///   risolverebbe nel catalogo del **proprietario della chiave** (§12.1),
    ///   cioè del plugin; e un catalogo del core non si tradurrebbe a nome suo,
    ///   che è lo stesso ostacolo che le scorciatoie incontrano sul gruppo. La
    ///   frase la scrive quindi chi mostra — la shell, dal proprio catalogo, su
    ///   un elenco di nomi chiuso — e ciò che attraversa di qui è un
    ///   **identificatore**.
    ///
    /// Non è `program_writable`, e qui è più che una convenzione: un componente
    /// che potesse riscrivere questa chiave si riconcederebbe da sé ciò che
    /// l'utente gli ha tolto. È lo stesso argomento di `plugins.disabled`, un
    /// grado più in là — là avrebbe potuto spegnere chi lo controlla, qui
    /// potrebbe non farsi spegnere affatto.
    /// Rifà il recinto di un plugin da ciò che l'utente ha negato **adesso**
    fn permission_specs(&self, plugin: &str) -> Vec<SettingSpec> {
        let Some(entry) = self.providers.plugins.get(plugin) else {
            return Vec::new();
        };
        fub_abi::options::permission::ALL
            .iter()
            .filter(|key| entry.manifest.permissions.has(key))
            .map(|key| {
                SettingSpec::toggle(
                    fub_abi::settings::permission_key(plugin, key),
                    Text::Literal((*key).to_string()),
                    true,
                )
            })
            .collect()
    }

    /// (§23.17).
    ///
    /// Si chiama alla dichiarazione e a ogni scrittura di una di quelle chiavi,
    /// e la seconda è quella che conta: una revoca deve valere alla prossima
    /// chiamata, non alla riapertura del vault. È il precedente che la
    /// [0097](../../../docs/decisions/0185-capability-un-solo-guard.md)
    /// ha scritto per la rete — `JobHost::fetch` rilegge il permesso a ogni
    /// chiamata invece di catturarlo all'avvio del job — onorato dalla parte
    /// opposta: là si rilegge perché la politica può essere cambiata, qui si
    /// riscrive la politica **nel momento** in cui cambia.
    ///
    /// Il conto sta da questa parte per la ragione che tiene [`Granted`]
    /// piccola: la politica si clona a ogni prestito, e un prestito accade a
    /// ogni evento consegnato a ogni handler. Rileggere lì dentro tredici
    /// chiavi di configurazione sarebbe una lettura dello store per evento; qui
    /// è un conto solo, e lo si fa quando una persona muove un interruttore.
    // Una chiave che non si legge — perché nessuno l'ha dichiarata,
    fn reapply_permissions(&mut self, plugin: &str) {
        let Some(entry) = self.providers.plugins.get(plugin) else {
            return;
        };
        let declared: Vec<&'static str> = fub_abi::options::permission::ALL
            .iter()
            .copied()
            .filter(|key| entry.manifest.permissions.has(key))
            .collect();
        let store = self.settings.read().expect("store di configurazione");
        let denied: Vec<String> = declared
            .into_iter()
            .filter(|key| {
                // o perché il file porta un valore che non regge lo schema — è
                // un **non ho detto di no**: il default è la concessione, e
                // trattare l'illeggibile come un rifiuto spegnerebbe un
                // componente per un file scritto male.
                // I comandi offerti dai provider registrati, in ordine di registrazione.
                matches!(
                    store.effective(&fub_abi::settings::permission_key(plugin, key)),
                    Ok((SettingValue::Toggle(false), _))
                )
            })
            .map(String::from)
            .collect();
        drop(store);
        self.providers.plugins.restrict(plugin, &denied);
    }

    ///
    /// È la metà "discovery" del registro, ed è la ragione per cui una
    /// [`CommandSpec`] porta descrizione, parametri e raggio: chi legge questo
    /// elenco può essere una palette, ma anche una CLI o un modello, e nessuno
    /// dei due ha letto il codice del comando.
    /// Esegue — o **simula** — un comando.
    pub fn commands(&self) -> Vec<CommandSpec> {
        self.providers
            .command_specs_by_owner()
            .into_iter()
            .map(|(owner, mut spec)| {
                self.localize(&owner, &mut spec);
                spec
            })
            .collect()
    }

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
    /// [`CommandProvider::invoke`]:
    /// l'origine è ciò che l'host **appone**, non ciò che il comando legge, e un
    /// comando che si comportasse diversamente a seconda di chi lo chiama
    /// sarebbe una policy (§7.3) nascosta dentro un'implementazione. Il giorno
    /// che servirà leggerla, è un metodo additivo sull'`HostApi`.
    ///
    /// Il resto è la disciplina di sempre: il provider esce dal workspace per la
    /// durata della chiamata, `in_provider_call` rimanda il dispatch, e ciò che
    /// il comando ha emesso arriva agli handler **dopo** che `invoke` è tornata.
    /// L'invocazione **annidata**: quella di
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

    /// Prepara il ramo **esterno** di un comando provider. `None` significa che
    /// il comando è manutenzione del kernel e va eseguito dal percorso interno.
    ///
    /// Dopo `Some`, il chiamante deve invocare [`PreparedCommand::invoke`] senza
    /// una guardia del workspace e riconsegnare sempre l'esito a
    /// [`finish_provider_command`](Self::finish_provider_command).
    pub fn prepare_provider_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Actor,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        self.prepare_provider_command_here(command, args, mode, Some(by))
    }

    /// Versione per [`HostCommands::run_command`](fub_abi::traits::HostCommands::run_command):
    /// apre un batch se non ce n'è già uno, ma **non cambia attore**. Il
    /// chiamante resta chi è entrato nel kernel; annidare non è un nuovo ingresso.
    pub fn prepare_nested_provider_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        self.prepare_provider_command_here(command, args, mode, None)
    }

    fn prepare_provider_command_here(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Option<Actor>,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        let at = self.command_owner(command)?;
        let spec = self.providers.commands[at]
            .specs
            .iter()
            .find(|s| s.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando")
            .clone();
        spec.validate_args(&args)?;

        if self.providers.command_stack.iter().any(|c| c == command) {
            let mut round = self.providers.command_stack.clone();
            round.push(command.to_string());
            return Err(PluginError::BadArgs(
                format!(
                    "un comando non può invocare sé stesso: {}",
                    round.join(" → ")
                )
                .into(),
            ));
        }

        if self.providers.commands[at].id == crate::maintenance::MAINTENANCE_ID {
            return Ok(None);
        }

        let owner = self.providers.commands[at].id.clone();
        let provider = Arc::clone(&self.providers.commands[at].provider);
        let read_only_reason = if spec.scope.writes && mode == InvokeMode::Apply {
            None
        } else if mode.is_dry_run() {
            Some("una simulazione non scrive")
        } else {
            Some("il comando si è dichiarato di sola lettura")
        };

        let previous_actor = by.map(|by| self.dispatch.swap_actor(by));
        let owns_batch = self.dispatch.open_batch();
        self.providers.command_stack.push(command.to_string());
        let previous_provider_call = self.dispatch.enter_provider_call();

        Ok(Some(PreparedCommand {
            owner,
            command: command.to_string(),
            args: Some(args),
            mode,
            provider,
            read_only_reason,
            previous_actor,
            owns_batch,
            previous_provider_call,
        }))
    }

    /// Rientra dopo una [`PreparedCommand`] e riproduce l'epilogo del percorso
    /// sincrono: ripristino del flag, pila, localizzazione, undo, batch, dispatch
    /// e infine attore. Il provider non gira in questa funzione.
    pub fn finish_provider_command(
        &mut self,
        prepared: PreparedCommand,
        outcome: std::result::Result<CommandOutcome, PluginError>,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let popped = self.providers.command_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.command.as_str()));

        let result = match outcome {
            Err(and) => Err(self.localized(&prepared.owner, and)),
            Ok(mut outcome) => {
                if let CommandEffect::Plan(plan) = &mut outcome.effect {
                    plan.complete();
                }
                self.localize(&prepared.owner, &mut outcome);
                if prepared.mode == InvokeMode::Apply && self.providers.command_stack.is_empty() {
                    if let Some(undo) = outcome.undo.clone() {
                        self.undo.push(undo, outcome.partial.clone());
                    }
                }
                // Come `invoke_command_here`: dentro un batch questo è un no-op;
                // resta qui perché nel caso annidato non siamo proprietari della
                // chiusura e non dobbiamo anticipare la consegna.
                self.dispatch_pending();
                Ok(outcome)
            }
        };

        if prepared.owns_batch {
            self.dispatch.close_batch();
            self.dispatch_pending();
        }
        if let Some(previous_actor) = prepared.previous_actor {
            self.dispatch.restore_actor(previous_actor);
        }
        result
    }

    /// [`HostCommands::run_command`](fub_abi::traits::HostCommands::run_command).
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
    /// invoca. Vedi `KernelHost::mode` e la politica `ReadOnly`.
    // Il giro (decisione 0013). Un comando che rientra su sé stesso non è una
    /// Porta stretta dell'host per il solo ramo di manutenzione del kernel.
    ///
    /// Un `PreparedCommand` restituisce `None` soltanto per questo proprietario:
    /// tenere questa porta distinta impedisce a `fub-host` di acquisire una
    /// scorciatoia pubblica con cui eseguire provider arbitrari sotto lock.
    pub fn invoke_nested_maintenance_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let at = self.command_owner(command)?;
        if self.providers.commands[at].id != crate::maintenance::MAINTENANCE_ID {
            return Err(PluginError::PermissionDenied(
                format!("`{command}` non è un comando di manutenzione del kernel").into(),
            ));
        }
        self.invoke_command_nested(command, args, mode)
    }

    pub(crate) fn invoke_command_nested(
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
        let spec = self.providers.commands[at]
            .specs
            .iter()
            .find(|s| s.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando")
            .clone();
        spec.validate_args(&args)?;

        // profondità da limitare con un numero: è un errore di chi lo ha
        // scritto, e l'unica risposta utile lo nomina.
        // **La manutenzione la esegue il kernel** (§15.2). L'id è passato dalla
        if self.providers.command_stack.iter().any(|c| c == command) {
            let mut round = self.providers.command_stack.clone();
            round.push(command.to_string());
            return Err(PluginError::BadArgs(
                format!(
                    "un comando non può invocare sé stesso: {}",
                    round.join(" → ")
                )
                .into(),
            ));
        }

        // porta di tutti — è stato ammesso, ha una spec, i suoi argomenti sono
        // stati convalidati, ha la sua chiave di scorciatoia — e qui si separa,
        // perché ciò che fa non sta sull'`HostApi` e non deve starci: rifare
        // l'indice non è una capacità da prestare a ogni plugin montato. È la
        // 0086 generalizzata — *la dichiarazione sta nel registro, l'esecuzione
        // sta dove sta il potere* — e sta **prima** del prestito di proposito:
        // ciò che viene dopo costruisce un host che a questi comandi non
        // servirebbe.
        // Il provider **resta** nel registro: si condivide il puntatore (vedi
        // il campo `commands`). È ciò che permette a `run_command` di trovare
        // gli altri comandi — e anche gli altri comandi dello stesso provider —
        // mentre questo è in corso.
        // **La manutenzione la esegue il kernel** (§15.2). L'id è passato dalla
        let owner = self.providers.commands[at].id.clone();
        let provider = Arc::clone(&self.providers.commands[at].provider);
        self.providers.command_stack.push(command.to_string());
        // porta di tutti — ammesso, con una spec, con gli argomenti convalidati,
        // con la sua chiave di scorciatoia — e si separa **solo** su chi lo
        // esegue, perché ciò che fa non sta sull'`HostApi` e non deve starci:
        // rifare l'indice non è una capacità da prestare a ogni plugin montato.
        // È la 0086 generalizzata — *la dichiarazione sta nel registro,
        // l'esecuzione sta dove sta il potere*.
        //
        // Che il ramo sia **qui dentro** e non un ritorno anticipato più su non
        // è cosmesi, ed è un difetto che un test ha trovato prima di questa
        // riga: ciò che viene dopo — la localizzazione dell'esito col catalogo
        // di chi l'ha scritto (0040), il completamento del piano, il drenaggio
        // della coda — vale per **ogni** comando, e un comando che salta quella
        // coda consegna una chiave di catalogo a chi si aspetta una frase.
        // Il rifiuto è un wrapper (§7.1): la politica dice quali famiglie
        let outcome = if self.providers.commands[at].id == crate::maintenance::MAINTENANCE_ID {
            self.run_maintenance(command, mode)
        } else if spec.scope.writes && mode == InvokeMode::Apply {
            self.with_provider_call(|ws| {
                let mut host = ws.host_for(&owner, mode);
                crate::safety::calling(&owner, Gate::Command, command, || {
                    provider.invoke(command, args, mode, &mut host)
                })
            })
        } else {
            let why = if mode.is_dry_run() {
                "una simulazione non scrive"
            } else {
                "il comando si è dichiarato di sola lettura"
            };
            // servire, e l'host sottostante gira in simulazione — così una
            // macro simulata compone i piani dei suoi passi invece di
            // rispondere `permission-denied` a ogni riga.
            // Due politiche insieme: quella del plugin e quella del divieto.
            // È la combinatoria del §7.3 senza un tipo per combinazione.
            // Il `pop` è **fuori** dalla rete e prima del `?`: un comando che pania
            let granted = self.providers.plugins.granted(&owner);
            let mut host = Guard::new(
                KernelHost {
                    ws: self,
                    plugin: &owner,
                    mode: InvokeMode::DryRun,
                    instance: None,
                },
                (ReadOnly { why }, granted),
            );
            crate::safety::calling(&owner, Gate::Command, command, || {
                provider.invoke(command, args, mode, &mut host)
            })
        };
        // non deve restare per sempre "in giro" nella pila, o la prossima
        // invocazione si rifiuterebbe da sé dicendo che sta chiamando sé stesso.
        // L'insieme impattato è ciò che l'utente approva: lo completa
        self.providers.command_stack.pop();

        let mut outcome = outcome.map_err(|and| self.localized(&owner, and))?;
        if let CommandEffect::Plan(plan) = &mut outcome.effect {
            // l'host, invece di fidarsi che chi ha scritto il piano si sia
            // ricordato di elencare ogni documento che i suoi edit nominano.
            // I testi dell'esito — la notifica, il riassunto di un piano — col
            plan.complete();
        }
        // catalogo di chi ha eseguito. `run_command` annidato passa da qui come
        // l'invocazione dall'esterno: chi rientra riceve l'esito dell'altro già
        // risolto, che è giusto, perché il catalogo giusto è quello di chi ha
        // scritto la frase e non quello di chi la inoltra.
        // La pila dell'annullamento si riempie **a profondità zero** (§13.3):
        self.localize(&owner, &mut outcome);
        // una macro di tre rinomine è *una* cosa che qualcuno ha chiesto,
        // quindi una voce sola — la stessa regola per cui è un `batch-ended`
        // solo (decisione 0011). Chi compone comandi compone anche il loro
        // inverso, e `Undo::steps` esiste per permetterglielo.
        //
        // Solo `Apply`: una simulazione non ha fatto niente, e mettere in pila
        // l'inverso di ciò che non è successo sarebbe la scala per uscire dalla
        // simulazione — annullare qualcosa che non è mai stato fatto.
        //
        // Col conto dell'esito **appaiato** alla voce (§23.14): i due pezzi
        // arrivano da qui insieme e si separano una riga dopo — l'esito torna a
        // chi ha invocato, la voce resta in pila — quindi o si appaiano adesso o
        // mesi dopo, davanti al menu che disfa, nessuno sa più che quella
        // archiviazione era di undici note su dodici. La copia sta qui e non nei
        // comandi per la ragione della decisione 0098: una regola che vale per
        // tutti i chiamanti si scrive nel posto che tutti attraversano, e il
        // comando che qualcuno scriverà domani la eredita senza saperlo.
        // Annulla l'ultima operazione annullabile, e dice quale era (§13.3).
        if mode == InvokeMode::Apply && self.providers.command_stack.is_empty() {
            if let Some(undo) = outcome.undo.clone() {
                self.undo.push(undo, outcome.partial.clone());
            }
        }
        self.dispatch_pending();
        Ok(outcome)
    }

    ///
    /// `Ok(None)` = non c'era niente, e non è un errore: è la risposta normale a
    /// un vault appena aperto.
    ///
    /// I passi girano nell'ordine in cui l'operazione li ha elencati, che è già
    /// quello in cui vanno eseguiti: chi esegue non riordina, perché riordinare
    /// vorrebbe dire capire cosa dipende da cosa, e lo sa meglio chi ha scritto
    /// l'operazione.
    ///
    /// # Ci si ferma al passo caduto, e lo si dice (§23.14)
    ///
    /// Una voce non è **un** passo: è una lista, e il passo che fallisce sta in
    /// mezzo agli altri. Prima il `?` di questo ciclo faceva due cose in
    /// silenzio — lasciava applicati i passi già fatti e **non provava** quelli
    /// dopo — e restituiva un errore nudo, mentre la voce era già uscita dalla
    /// pila. Chi annullava un'archiviazione di dodici note poteva ritrovarne
    /// quattro tornate indietro, otto no, e sullo schermo il perché di una sola.
    ///
    /// Ci si ferma ancora, e **non** si tira dritto: i passi non sono
    /// indipendenti. L'inverso di «crea `A`, poi rinominala in `B`» è
    /// `[rinomina B→A, cestina A]`, e proseguire dopo che la prima è fallita
    /// vorrebbe dire cestinare una nota `A` che non è quella — cioè fare un
    /// danno per rimediare a un danno. È l'opposto della regola di
    /// `vault.replace`, dove le N note *sono* indipendenti, e la differenza è
    /// tutta lì.
    ///
    /// Ciò che cambia è che il conto esce: quanti passi c'erano, quanti sono
    /// andati, e il perché di quello che ha fermato il giro. Se non ne è andato
    /// **nessuno** resta un errore — niente è cambiato, e la parola giusta per
    /// niente è ancora «fallito», che è la promessa che
    /// [`HostCommands::undo_last`](fub_abi::traits::HostCommands::undo_last)
    /// faceva già.
    // Tutto dentro un lotto solo: annullare una rinomina che aveva riscritto
    pub(crate) fn undo_last(&mut self) -> std::result::Result<Option<Undone>, PluginError> {
        let Some(entry) = self.undo.pop() else {
            return Ok(None);
        };
        let count = entry.undo.steps.len();
        // quaranta sorgenti è un gesto, quindi un `batch-ended` e un ridisegno.
        // La bandiera dell'annullamento è un prestito e si chiude cadendo (vedi
        // [`Riproduzione`]): su questo tratto passa tutto ciò che pania — un
        // supporto che esplode invece di rispondere, una `expect` del kernel — e
        // una riga di ripristino scritta dopo la chiamata la salterebbe.
        // Niente è cambiato: resta un errore, ma la voce torna in pila. Il
        let mut replay = Replay::open(self);
        let batch_result = replay.batch(|ws| {
            let mut done = 0usize;
            for step in &entry.undo.steps {
                let outcome = match step {
                    UndoStep::Edit(planned) => ws
                        .apply_edit(&planned.doc, planned.edit.clone())
                        .map(|_| ())
                        .map_err(|and| Failure::of(planned.doc.clone(), and.into())),
                    UndoStep::Command { command, args } => ws
                        .invoke_command_here(command, args.clone(), InvokeMode::Apply)
                        .map(|_| ())
                        .map_err(Failure::other),
                };
                match outcome {
                    Ok(()) => done += 1,
                    Err(failure) => return (done, Some(failure)),
                }
            }
            (done, None)
        });
        drop(replay);

        let (done, failure) = batch_result;
        let Some(failure) = failure else {
            return Ok(Some(Undone {
                label: entry.undo.label,
                operation: entry.partial,
                replay: None,
            }));
        };
        // conflitto può essere transitorio e chi riprova deve ritrovare lo stesso
        // annullamento invece di una pila vuota. `replay` è già caduto, quindi
        // `UndoStack::push` non scarta la voce come riproduzione ricorsiva.
        // Chi possiede un comando, per posizione. `UnknownCommand` se nessuno.
        if done == 0 {
            let error = failure.error;
            self.undo.push(entry.undo, entry.partial);
            return Err(error);
        }
        Ok(Some(Undone {
            label: entry.undo.label,
            operation: entry.partial,
            replay: Partial::of(count, done, vec![failure]),
        }))
    }

    // --- import ed export ---------------------------------------------------
    fn command_owner(&self, command: &str) -> std::result::Result<usize, PluginError> {
        self.providers.command_owner(command)
    }

    //
    // Il kernel non sa cosa sia un formato di scambio: sa scegliere chi lo sa e
    // prestargli le capacità. Vedi `fub_abi::transfer`.
    /// Registra un [`ImportProvider`] sotto un id. L'ordine di registrazione è
    ///
    /// l'ordine in cui i provider vengono interpellati da
    /// [`import`](Workspace::import).
    ///
    /// Come per gli altri provider, `id` è un nome semplice e determina lo
    /// spazio dati autorevole (`.fub/plugins/<id>/`), con cache derivata in `.fub/data/plugins/<id>/`.
    /// Registra un [`ExportProvider`] per conto di un plugin dichiarato.
    pub fn register_import_provider(
        &mut self,
        plugin: impl Into<String>,
        p: Box<dyn ImportProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        self.providers
            .plugins
            .admit(&plugin, RegistrationKind::Import, &[])?;
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Import, &[]);
        self.providers.imports.push((plugin, p));
        Ok(())
    }

    ///
    /// Gli id delle **destinazioni** (`markdown.files`) sono nomi in uno spazio
    /// condiviso: valgono la regola del §7.4 e il conflitto, come per le view.
    /// **Apre** una sorgente perché un provider la legga a pezzi invece che
    pub fn register_export_provider(
        &mut self,
        plugin: impl Into<String>,
        p: Box<dyn ExportProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let ids: Vec<String> = p.targets().into_iter().map(|t| t.id).collect();
        self.providers
            .plugins
            .admit(&plugin, RegistrationKind::Export, &ids)?;
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Export, &ids);
        self.providers.exports.push((plugin, p));
        Ok(())
    }

    /// tutta insieme (decisione 0102).
    ///
    /// Chi chiama è chi ha aperto il dialogo di sistema: il kernel non sceglie
    /// il file, lo riceve già aperto sotto forma di [`SourceBacking`]. È la
    /// stessa divisione della 0006 — «chi apre il dialogo di sistema e chi posa
    /// i byte è l'host» — spostata di un gradino, perché adesso c'è qualcosa da
    /// tenere aperto fra l'una e l'altra.
    ///
    /// Il prologo si legge **qui e una volta sola**, ed è ciò che rende
    /// possibile il dispatch: [`ImportProvider::can_handle`] non riceve un host
    /// e quindi non può leggere niente. Senza, una sorgente a handle si
    /// riconoscerebbe dal solo nome — e la 0006 spiega perché non basta.
    ///
    /// Chiude [`close_source`](Workspace::close_source), e non `import`: la
    /// coppia preview→apply è due chiamate sulla stessa sorgente, e chiuderla in
    /// mezzo vorrebbe dire rileggerla per rispondere alla stessa domanda.
    /// Chiude una sorgente aperta. Chiudere ciò che non c'è riesce.
    pub fn open_source(
        &mut self,
        name: impl Into<String>,
        media_type: Option<String>,
        mut backing: Box<dyn SourceBacking>,
    ) -> std::result::Result<ImportSource, PluginError> {
        let len = backing.len();
        let prologue = backing.read_at(0, PROLOGUE as u32)?;
        let handle = self.sources.acquire().open(backing);
        Ok(ImportSource {
            name: name.into(),
            media_type,
            content: SourceContent::Streamed(StreamedSource {
                handle,
                len,
                prologue,
            }),
        })
    }

    /// Legge da una sorgente aperta: il lato host di
    pub fn close_source(&mut self, handle: SourceHandle) {
        self.sources.acquire().close(handle);
    }

    /// [`TransferRead::read_source`](fub_abi::traits::TransferRead::read_source).
    /// Quanti byte ha una sorgente aperta, se lo è.
    pub(crate) fn read_open_source(
        &self,
        handle: SourceHandle,
        offset: u64,
        len: u32,
    ) -> std::result::Result<Vec<u8>, PluginError> {
        self.sources.acquire().read(handle, offset, len)
    }

    /// Fa entrare una sorgente esterna nel vault, col **primo** provider
    pub fn source_len(&self, handle: SourceHandle) -> Option<u64> {
        self.sources.acquire().len(handle)
    }

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
    // La stessa disciplina di tutti gli altri, e non più una quarta copia:
    pub fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
    ) -> std::result::Result<ImportReport, PluginError> {
        let at = self
            .providers
            .imports
            .iter()
            .position(|(_, p)| p.can_handle(source))
            .ok_or_else(|| {
                PluginError::BadArgs(
                    format!(
                        "nessun ImportProvider registrato riconosce `{}`",
                        source.name
                    )
                    .into(),
                )
            })?;
        // vedi `Workspace::lend`.
        // Le destinazioni di export offerte dai provider registrati.
        let report = self.lend(
            |ws| &mut ws.providers.imports,
            |ws, imports| {
                let (id, provider) = &mut imports[at];
                let mut host = ws.host_for(id, InvokeMode::Apply);
                provider.import(source, request, &mut host)
            },
        );
        self.dispatch_pending();
        report
    }

    /// Esporta secondo la richiesta, col provider che possiede la destinazione.
    pub fn export_targets(&self) -> Vec<ExportTarget> {
        self.providers.export_targets()
    }

    ///
    /// Prende `&self`, come [`render_view`](Workspace::render_view) e per la
    /// stessa ragione: un export è una lettura, e le letture girano sotto
    /// prestito condiviso invece di mettersi in fila dietro una scrittura. Il
    /// provider non viene quindi estratto dal workspace e durante l'export vede
    /// il mondo intero — indici compresi, che è ciò che serve a una selezione
    /// per query.
    /// Come [`export`](Workspace::export), ma versando gli artefatti dove dice
    pub fn export(
        &self,
        request: &ExportRequest,
    ) -> std::result::Result<ExportReport, PluginError> {
        let mut sink = MemorySink::default();
        self.export_to(request, &mut sink)
    }

    /// chi chiama (decisione 0102).
    ///
    /// I due non sono due modi di fare la stessa cosa: `export` tiene tutto in
    /// memoria — che è ciò che il contratto faceva sempre, e che va benissimo
    /// per tre note — mentre qui l'esito può non entrarci. Un export del vault
    /// intero in PDF è il caso per cui questa esiste.
    // --- eventi ------------------------------------------------------------
    pub fn export_to(
        &self,
        request: &ExportRequest,
        out: &mut dyn ArtifactSink,
    ) -> std::result::Result<ExportReport, PluginError> {
        let (id, provider) = self
            .providers
            .exports
            .iter()
            .find(|(_, p)| p.targets().iter().any(|t| t.id == request.target))
            .ok_or_else(|| {
                PluginError::BadArgs(
                    format!("destinazione di export ignota: `{}`", request.target).into(),
                )
            })?;
        let host = self.read_host_for(id);
        provider.export(request, &host, out)
    }

    /// Unico punto di emissione: ponte verso i subscriber esterni + coda per
    ///
    /// gli handler registrati.
    ///
    /// È anche il punto unico in cui l'origine (decisione 0012) viene apposta e in cui il
    /// lotto (decisione 0011) fa il proprio lavoro. Che siano la stessa riga non è
    /// economia: un secondo posto da cui emettere sarebbe un posto da cui uscire
    /// senza origine o fuori dal lotto, e un evento non attribuito è
    /// indistinguibile da uno attribuito male.
    /// **Qualcosa è andato storto, e adesso c'è dove dirlo** (§20.2, decisione
    pub(crate) fn emit_event(&mut self, event: Event) {
        self.dispatch.emit(event);
    }

    /// 0052).
    ///
    /// L'unico punto da cui il kernel emette un guasto. Passa da `emit_event`
    /// come tutto il resto — quindi porta l'origine e sta dentro il lotto — e
    /// non fa niente di più: non decide se si vede, non sceglie un tono per
    /// chi disegna, non scrive su `stderr`. Chi ha una superficie si abbona.
    /// Le perdite dell'alimentazione (§20.1) diventano guasti (§20.2): è la
    pub(crate) fn report_trouble(
        &mut self,
        severity: Severity,
        subject: Option<DocId>,
        error: PluginError,
        gate: Option<Gate>,
    ) {
        self.emit_event(Event::Trouble {
            severity,
            subject,
            error,
            gate,
        });
    }

    /// giunzione fra le due voci, ed è l'unica ragione per cui vanno decise
    /// nella stessa seduta — un esito che nomina i documenti perduti e nessun
    /// posto dove portarlo è un canale senza destinazione.
    ///
    /// Sono [`Severity::Warning`] tutte, e per la regola scritta nel contratto:
    /// un indice è un **derivato**, il vault è la verità, e ciò che si è perso
    /// torna riaprendo il vault. Non «non è grave» — chi cerca, fino ad allora,
    /// riceve una risposta incompleta senza sapere che lo è, ed è esattamente
    /// per questo che lo si dice.
    /// Esegue `f` attribuendo a `actor` tutto ciò che ne nasce, e rimette
    pub(crate) fn report_losses(&mut self, lost: Vec<IndexLoss>) {
        for loss in lost {
            self.report_trouble(Severity::Warning, Some(loss.id), loss.why, None);
        }
    }

    /// l'attore di prima quando `f` è tornata.
    ///
    /// L'attore è **chi ha chiesto**, non chi esegue: per questo lo alzano il
    /// watcher (il vault è cambiato senza passare da noi), il dispatch verso un
    /// handler (il plugin agisce di propria iniziativa) e `invoke_command` — dove
    /// però l'attore è il *chiamante* del comando, non il provider che lo
    /// esegue. Vedi `fub_abi::event`.
    /// Esegue `f` dentro un **lotto** (decisione 0011): ciò che vi succede è una cosa
    fn as_actor<R>(&mut self, actor: Actor, f: impl FnOnce(&mut Self) -> R) -> R {
        let prev = self.dispatch.swap_actor(actor);
        let result = f(self);
        self.dispatch.restore_actor(prev);
        result
    }

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
    /// tutto-o-niente vuole il registro delle mutazioni, che dalla 0067 c'è e di
    /// ogni lotto tiene i confini: manca chi lo ripercorre). Ciò che è andato storto lo
    /// riporta `f` col proprio valore di ritorno, che questa funzione passa
    /// intatto.
    ///
    /// Annidato, entra nel lotto che c'è invece di aprirne un secondo: chiudere
    /// quello interno farebbe arrivare un `batch-ended` mentre l'operazione
    /// esterna è ancora in corso.
    ///
    /// **La chiusura è un `Drop`, non una riga da ricordare.** `f` è codice del
    /// kernel e dei provider, e può panicare: con la chiusura scritta *dopo* la
    /// chiamata, un panico la saltava e il lotto restava aperto — cioè
    /// `dispatch_pending` trovava `batch.is_some()` e tornava subito **per
    /// sempre**, senza consegnare più niente a nessun handler. Non è il panico
    /// che si vuole gestire (chi pania se lo tiene, decisione 0032): è che
    /// l'uscita da un lotto non dipenda da chi la scrive.
    /// Chiude il lotto più esterno: emette il terminale (se c'è qualcosa da
    pub fn batch<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        let mut batch = Batch::open(self);
        f(&mut batch)
    }

    /// dire) e drena.
    /// Drena la coda eventi verso gli handler. Mai rientrante: chiamato
    fn end_batch(&mut self) {
        self.dispatch.close_batch();
        self.dispatch_pending();
    }

    /// durante un dispatch (es. da un `write_document` fatto da un handler)
    /// ritorna subito e lascia drenare il ciclo esterno.
    ///
    /// Se il budget si esaurisce (handler che si rimbalzano eventi senza
    /// convergere) il troncamento è **rumoroso e non cieco**: ciò che si
    /// riscopre riguardando il vault viene scartato e al suo posto viene
    /// consegnato — al bus e agli handler — un [`Event::Overflow`] con il
    /// conteggio dei persi, mentre ciò che porta l'unica copia di un fatto
    /// viene consegnato lo stesso (§20.5). Gli eventi emessi *durante* quel
    /// tratto finale non si consegnano — la coda deve terminare — ma si
    /// contano, e il conto esce in un ultimo `Overflow`.
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
    // Il ciclo consegna e basta: quando fermarsi, cosa scartare e cosa
    fn dispatch_pending(&mut self) {
        // mettere al posto di ciò che si scarta lo decide il [`Dispatcher`]
        // (§8.1). Qui resta ciò che il componente non può fare — chiamare un
        // provider, che vuole `&mut Workspace` da prestare come `HostApi`.
        // **Presta i provider di una tabella per la durata di una chiamata**: la
        if !self
            .dispatch
            .begin_drain(!self.providers.handlers.is_empty())
        {
            return;
        }
        let mut budget = Dispatcher::budget();
        while let Some(notice) = self.dispatch.next_to_deliver(&mut budget) {
            self.deliver_to_handlers(&notice);
        }
        self.dispatch.end_drain();
    }

    /// disciplina di consegna, scritta una volta sola (§7.2).
    ///
    /// Estrae le voci dal workspace (l'host presta `&mut Workspace`, e un
    /// provider che vi restasse dentro sarebbe un alias), chiama `f` col flag
    /// `in_provider_call` alzato — così ciò che il provider emette arriva agli
    /// handler *dopo* che la sua chiamata è tornata — e rimette le voci al loro
    /// posto, in coda a quelle registrate nel frattempo.
    ///
    /// Erano tre copie (`deliver_to_handlers`, `flush_indexes`, `view_action`)
    /// e ognuna delle tre poteva sbagliare l'ultimo passo in silenzio. Il
    /// drenaggio della coda **non** è qui: `deliver_to_handlers` gira già
    /// dentro un dispatch, e gli altri due devono drenare dopo aver finito il
    /// proprio lavoro (validare un albero, raccogliere gli errori).
    ///
    /// `field` è un puntatore a funzione e non una chiusura perché deve poter
    /// essere richiamato **due volte** su `self` — prima per svuotare, poi per
    /// ripristinare — e una chiusura che catturasse `&mut self` non lo
    /// permetterebbe.
    /// Esegue `f` col flag `in_provider_call` alzato: qualunque
    fn lend<T, R>(
        &mut self,
        field: fn(&mut Self) -> &mut ProviderTable<T>,
        f: impl FnOnce(&mut Self, &mut [T]) -> R,
    ) -> R {
        let mut lent = field(self).take();
        let out = self.with_provider_call(|ws| f(ws, &mut lent));
        field(self).restore(lent);
        out
    }

    /// `dispatch_pending` innescato dentro `f` (un provider che scrive via
    /// `HostApi`) viene rimandato. Chi chiama è responsabile di drenare la
    /// coda **dopo** — è il "dopo che la tua chiamata è tornata" del contratto.
    /// Consegna un singolo evento a tutti gli handler abbonati. Gli handler
    fn with_provider_call<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        let prev = self.dispatch.enter_provider_call();
        let result = f(self);
        self.dispatch.restore_provider_call(prev);
        result
    }

    /// escono dal workspace per la durata della chiamata: così `KernelHost`
    /// può prestare `&mut Workspace` senza aliasing.
    ///
    /// Per la durata di `handle` l'attore è il **plugin** (decisione 0012): ciò che
    /// scrive lì dentro lo ha chiesto lui, di propria iniziativa, ed è così che
    /// alla prossima consegna riconosce le proprie scritture senza tenerne una
    /// contabilità privata. L'origine dell'evento che sta *ricevendo* è un'altra
    /// cosa e sta nel [`Notice`], dove il plugin la legge.
    // La maschera per intero: la specie, il prefisso di topic
    fn deliver_to_handlers(&mut self, notice: &Notice) {
        let troubles = self.lend(
            |ws| &mut ws.providers.handlers,
            |ws, handlers| {
                let mut troubles: Vec<(String, PluginError)> = Vec::new();
                for (id, handler) in handlers.iter_mut() {
                    // per i custom, il soggetto (§10.1) e **cosa è cambiato**
                    // nel documento (§22.2, decisione 0069). La regola sta nel
                    // contratto (`fub_abi::rules::events`) e non qui, perché
                    // il secondo lettore è la shell — che decide da sé quando
                    // ridisegnare una view dichiarata.
                    // L'errore di un handler non deve far fallire
                    if !handler.subscribed().wants(&notice.event) {
                        continue;
                    }
                    let attore = Actor::Plugin { id: id.clone() };
                    let fault = ws.as_actor(attore, |ws| {
                        let mut host = ws.host_for(id, InvokeMode::Apply);
                        // l'operazione che ha emesso l'evento — quella parte
                        // del vecchio commento era giusta ed è rimasta — ma
                        // «non far fallire» non vuol dire «non dirlo» (§20.3):
                        // qui c'era un `let _ =` e un panico che finiva su
                        // `stderr`, e la sola feature che esiste per esserci
                        // quando qualcosa va storto — il versioning, che è un
                        // `EventHandler` e nient'altro — smetteva di fare
                        // snapshot in un modo indistinguibile dal funzionare.
                        // **Il guasto della consegna di un guasto non si emette** (decisione
                        let mut fault = None;
                        if let Some(panic) = crate::safety::reporting(id, Gate::Event, "", || {
                            fault = handler.handle(notice, &mut host).err();
                        }) {
                            fault = Some(panic);
                        }
                        fault
                    });
                    troubles.extend(fault.map(|and| (id.clone(), and)));
                }
                troubles
            },
        );
        // 0052). È l'unico ciclo che questa variante rende possibile — un
        // handler che fallisce ricevendo un `Trouble` ne produrrebbe un
        // secondo, che ripasserebbe da lui — e si chiude dove nasce, cioè qui,
        // perché è il kernel a emettere. Il budget del dispatch lo fermerebbe
        // comunque: ma quello è una rete di sicurezza, non una semantica, e
        // ciò che troncherebbe sono gli eventi degli altri.
        // Emesso **fuori** dal prestito: dentro `lend` la tabella degli
        if matches!(notice.event, Event::Trouble { .. }) {
            return;
        }
        // handler è in mano a chi consegna, e un evento emesso lì dentro
        // arriverebbe a una lista vuota. Il soggetto è il documento che
        // l'evento nominava — chi guarda quella nota è chi ha interesse a
        // sapere che qualcuno non è riuscito a reagirle.
        // **Chi** ha fallito lo dice l'origine, non un campo nuovo: il
        let subject = notice.event.touched().cloned();
        for (id, error) in troubles {
            // guasto si emette a nome del plugin (decisione 0012), che è la
            // stessa meccanica con cui un handler riconosce le proprie
            // scritture. Un campo `plugin` dentro il record avrebbe duplicato
            // ciò che il notice porta già.
            //
            // `Failure` e non `Warning`: il kernel non sa cosa **non** è
            // successo. Dietro un `EventHandler` c'è il versioning tanto
            // quanto un contatore, e sottostimare la perdita di uno snapshot è
            // peggio che sovrastimare quella di un contatore.
            // --- job (lavoro lungo, fuori dal giro sincrono) -----------------------
            let subject = subject.clone();
            self.as_actor(Actor::Plugin { id }, |ws| {
                ws.report_trouble(Severity::Failure, subject, error, Some(Gate::Event))
            });
        }
    }

    /// Accoda un job richiesto via
    ///
    /// [`HostEvents::spawn_job`](fub_abi::traits::HostEvents::spawn_job) e ne
    /// restituisce l'identità.
    ///
    /// Sta qui e non nell'host perché il contatore è del workspace: un host è
    /// un prestito per la durata di una chiamata, e un'identità che si conta
    /// dentro un prestito ricomincerebbe da capo a ogni prestito.
    ///
    /// Da qui il job è **vivo e visibile** (§10.3): entra nella tabella che
    /// [`IndexQuery::Jobs`](fub_abi::traits::IndexQuery::Jobs) racconta, e ne
    /// esce un [`Event::JobStarted`]. L'origine non la si tocca: è quella del
    /// giro in corso, cioè di **chi ha chiesto** il lavoro — che è la sola cosa
    /// che l'evento non porta nei propri campi.
    ///
    /// **Su un vault che sta chiudendo non entra, e lo dice.** Da quando
    /// `closed` è alzato nessuno può più eseguire un job — il runner del vault
    /// è già fermo, e l'unico drenaggio è già girato — quindi accodarne uno
    /// vorrebbe dire un chiamante che aspetta un `JobDone` che non arriva mai.
    /// La guardia risponde subito con un
    /// [`Cancelled`](PluginError::Cancelled) e la coda resta vuota. È **per
    /// generazione**: chi riapre il vault è un workspace nuovo col suo `closed`
    /// a posto, e la chiusura vecchia non lo lascia chiuso.
    /// **Dichiara viva la seconda fase dell'apertura**, e le dà un'identità
    pub(crate) fn enqueue_job(
        &mut self,
        plugin: &str,
        spec: JobSpec,
    ) -> std::result::Result<JobId, PluginError> {
        if self.closed {
            return Err(PluginError::Cancelled(
                format!("il vault si sta chiudendo: il job `{}` non parte", spec.job).into(),
            ));
        }
        let job = spec.job.clone();
        let id = self.dispatch.enqueue_job(plugin, spec);
        self.indexes.core.jobs.accepted(id, &job, plugin);
        self.emit_event(Event::JobStarted { id, job });
        Ok(id)
    }

    /// (§15.7).
    ///
    /// L'indicizzazione è un job *vero* e non un meccanismo accanto ai job: da
    /// qui compare in
    /// [`IndexQuery::Jobs`](fub_abi::traits::IndexQuery::Jobs), si racconta con
    /// [`note_job_progress`](Workspace::note_job_progress), si ferma dal
    /// pulsante che ferma gli altri (§10.3) e si chiude con
    /// [`complete_job`](Workspace::complete_job). Riusarli invece di
    /// costruirne un secondo giro non è un risparmio di righe: è ciò che fa sì
    /// che il centro attività mostri l'apertura senza sapere che l'apertura
    /// esiste.
    ///
    /// **Non entra nella coda** ([`take_pending_jobs`](Workspace::take_pending_jobs)):
    /// un job in coda dice *quale plugin* lo esegue, e il registry ne cerca il
    /// corpo. Questo corpo non sta in nessun bundle — è il kernel — e mettercelo
    /// vorrebbe dire o un bundle finto o una capacità con cui «alimenta gli
    /// indici» sia esprimibile al confine. Chi ha i thread lo sa e lo porta
    /// avanti a fette, che è la ragione per cui l'[`Indicizzazione`] è un valore
    /// che si passa e non uno stato del kernel.
    ///
    /// L'intestatario è [`CORE_ID`](crate::index::CORE_ID) e l'origine è
    /// [`Actor::Kernel`]: l'apertura non l'ha chiesta nessun plugin
    /// (decisione 0012).
    /// **A che punto è** un job (§10.3, decisione 0035).
    pub fn begin_index_job(&mut self) -> JobId {
        let id = self.dispatch.next_job_id();
        self.indexes
            .core
            .jobs
            .accepted(id, INDEX_JOB, crate::index::CORE_ID);
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::JobStarted {
                id,
                job: INDEX_JOB.to_string(),
            });
            ws.dispatch_pending();
        });
        id
    }

    ///
    /// Non è una capacità e non passa dall'[`HostApi`](fub_abi::traits::HostApi):
    /// è la porta di chi *esegue* il job — il `JobHost` di `fub-host`, che
    /// l'identità ce l'ha — e proprio per questo l'id non è un parametro che un
    /// job possa sbagliare o fingere. Il job dal canto suo chiama
    /// [`report_progress`](fub_abi::traits::HostEvents::report_progress), che
    /// non nomina nessuno.
    ///
    /// Un progresso per un job **non più vivo** non si registra e non si emette:
    /// chi lo timbra gira su un altro thread, e fra il suo ultimo passo e
    /// l'esito ci sta di tutto — far ricomparire una riga già chiusa sarebbe un
    /// centro attività che mostra un lavoro finito.
    ///
    /// L'origine è il **plugin di cui il job è**, e non il kernel come per
    /// l'esito: `JobDone` lo emette il kernel perché il job lo ha eseguito lui e
    /// chi lo ha chiesto si riconosce dall'`id`, mentre un progresso è il
    /// racconto che il job fa di sé — «questo lo sto facendo io».
    /// **Il campanello dei job** (§9.3), da dare a chi possiede i thread.
    pub fn notes_job_progress(&mut self, id: JobId, progress: JobProgress) {
        if !self.indexes.core.jobs.progressed(id, progress.clone()) {
            return;
        }
        let plugin = self.indexes.core.jobs.owner(id);
        self.as_actor(Actor::Plugin { id: plugin }, |ws| {
            ws.emit_event(Event::JobProgress { id, progress });
            ws.dispatch_pending();
        });
    }

    ///
    /// Il kernel non sa che esistono dei thread, e non deve: sa che qualcuno
    /// potrebbe stare aspettando un job, e presta il pezzetto di stato che serve
    /// a svegliarlo — esattamente come presta la bandiera del rilevamento a chi
    /// tiene un watcher ([`watch_flag`](Workspace::watch_flag), decisione 0030).
    /// Senza, chi drena la coda dovrebbe interrogarla a intervalli, cioè
    /// scegliere una politica al posto di un fatto.
    /// Preleva i job richiesti dai provider via
    pub fn job_bell(&self) -> Arc<JobBell> {
        self.dispatch.bell()
    }

    /// [`HostEvents::spawn_job`](fub_abi::traits::HostEvents::spawn_job).
    ///
    /// Il kernel è sincrono e non possiede thread: chi li possiede — il
    /// `JobRunner` di `fub-host`
    /// ([decisione 0032](../../../docs/decisions/0183-composizione-host-kernel.md)), a
    /// M5 l'host WASM — drena questa coda, esegue ogni job **fuori** dal lock
    /// del workspace (`Plugin::run_job`, a M5 su un'istanza separata del
    /// componente) e riconsegna l'esito con [`Workspace::complete_job`].
    ///
    /// Chi drena non deve chiedere «ce n'è uno?» a intervalli: aspetta il
    /// [campanello](Workspace::job_bell), che suona quando uno entra.
    ///
    /// «Fuori dal lock» è la parte che chi drena non può sbagliare senza
    /// rompere tutto: dalla decisione 0027 il job ha l'host, quindi la prima
    /// capacità che usa prende il prestito del workspace, e chi lo eseguisse
    /// tenendolo aspetterebbe sé stesso. Il ponte che serve — un host che prende
    /// il prestito per **chiamata** — è `JobHost` in `fub-host`.
    /// **Quante identità di job il kernel ha emesso finora**: il primo numero
    pub fn take_pending_jobs(&mut self) -> Vec<PendingJob> {
        self.dispatch.take_pending_jobs()
    }

    /// che non è ancora di nessuno.
    ///
    /// È un confine, non una statistica, e serve a una domanda sola: *questo id
    /// è mai stato dato a qualcuno?* Chi annulla riceve l'id da fuori — dal
    /// pulsante del centro attività, e sull'IPC come stringa — e senza questo
    /// numero non c'è modo di distinguere «un job che deve ancora partire» da
    /// «un numero che non è mai stato un job». Le due cose vogliono risposte
    /// opposte: la prima vuole che l'annullamento **aspetti** il job, la seconda
    /// che non lasci niente dietro di sé.
    ///
    /// Il contatore è **uno** per workspace e non cala mai: un id sotto questo
    /// segno è stato emesso, uno pari o sopra no, e nessun riuso lo rimette in
    /// discussione.
    /// Le **sveglie dichiarate** da chi è registrato adesso (§22.1, decisione
    pub fn jobs_issued(&self) -> u64 {
        self.dispatch.jobs_issued()
    }

    /// 0069): l'id del componente e la sua `TimerSpec`.
    ///
    /// È ciò che uno scheduler legge per sapere quando deve svegliarsi. Il
    /// kernel non lo tiene: lo tiene il manifest, che è dove la dichiarazione è
    /// stata scritta, e lo perde quando il componente si ritira — che è la
    /// proprietà per cui non c'è un secondo registro da tenere allineato.
    ///
    /// **Il kernel non legge l'orologio.** Questa firma non dice *quando* è
    /// adesso e non ha un `Instant` da nessuna parte: il tempo di parete è di
    /// chi possiede i thread, e la 0032 ha già stabilito che è l'host. Il
    /// contratto ci mette la regola ([`TimerSchedule::nth_after`](fub_abi::traits::TimerSchedule::nth_after)) perché due
    /// host non abbiano due idee di cosa voglia dire «ogni ora».
    /// Fa suonare una sveglia: emette [`Event::TimerFired`] sul giro sincrono
    pub fn declared_timers(&self) -> Vec<(String, TimerSpec)> {
        self.providers
            .plugins
            .timers()
            .into_iter()
            .map(|(owner, spec)| (owner.to_string(), spec.clone()))
            .collect()
    }

    /// normale, come ogni altro evento.
    ///
    /// Risponde `false` — e non emette niente — se quel componente non dichiara
    /// (più) quella sveglia. È la riga che rende la dichiarazione **valutata**
    /// invece che decorativa: senza, uno scheduler che si tiene una copia
    /// dell'elenco continuerebbe a svegliare un plugin disattivato, e il
    /// contratto direbbe che la sveglia è del manifest mentre in realtà è di
    /// chi l'ha copiata.
    ///
    /// L'origine è [`Actor::Kernel`] per la ragione di [`Event::JobDone`]: a
    /// far scattare la sveglia non è stato il plugin, è stato il tempo. Chi si
    /// riconosce lo fa da `owner`, che è il campo fatto apposta.
    // Come `complete_job`, e per la stessa ragione: chi chiama arriva da
    pub fn fire_timer(&mut self, owner: &str, timer: &str) -> bool {
        let declared = self
            .providers
            .plugins
            .timers()
            .iter()
            .any(|(or, spec)| *or == owner && spec.id == timer);
        if !declared {
            return false;
        }
        // fuori del giro sincrono — è il pool — quindi l'evento non trova
        // nessuno che stia già drenando, e senza questa riga resterebbe in coda
        // fino alla prossima scrittura di qualcun altro.
        // Riconsegna l'esito di un job: emette [`Event::JobDone`] sul giro
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::TimerFired {
                owner: owner.to_string(),
                timer: timer.to_string(),
            });
            ws.dispatch_pending();
        });
        true
    }

    /// sincrono normale (bus + handler). Chi ha lanciato il job riconosce il
    /// proprio `id`.
    ///
    /// L'origine è [`Actor::Kernel`] e non il plugin che ha lanciato il job: il
    /// job lo ha eseguito l'host, fuori dal lock, e il lanciatore si riconosce
    /// dall'`id` — che è il campo fatto apposta. Intestarglielo direbbe «questo
    /// lo hai chiesto tu adesso», che è vero solo a metà e proprio nel senso
    /// sbagliato per un handler che salta le proprie scritture.
    ///
    /// È anche il momento in cui il job **smette di essere vivo**: la riga esce
    /// dalla tabella del §10.3 *prima* che l'evento parta, o chi riceve
    /// `job-done` e ricontrolla l'elenco troverebbe ancora là dentro il lavoro
    /// che gli è appena stato detto finito.
    // --- le impostazioni (§11.1) -------------------------------------------
    pub fn complete_job(
        &mut self,
        id: JobId,
        job: impl Into<String>,
        result: std::result::Result<serde_json::Value, PluginError>,
    ) {
        self.indexes.core.jobs.finished(id);
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::JobDone {
                id,
                job: job.into(),
                result,
            });
            ws.dispatch_pending();
        });
    }

    //
    // Il workspace è l'unico che le può servire: lo schema lo tiene il registro
    // dei plugin (arriva dal manifest, alla dichiarazione) e il valore lo tiene
    // lo store, e le due cose si incontrano solo qui.
    /// Il valore che vale adesso per una chiave dichiarata.
    ///
    /// Come [`setting`](Workspace::setting), ma dice anche **da dove viene**.
    pub fn setting(&self, key: &str) -> std::result::Result<SettingValue, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .effective(key)
            .map(|(value, _)| value)
    }

    /// Scrive una chiave, e **lo dice**: la scrittura di un'impostazione è un
    pub fn setting_source(
        &self,
        key: &str,
    ) -> std::result::Result<(SettingValue, SettingSource), PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .effective(key)
    }

    /// fatto che riguarda chi la legge, e senza l'evento un interruttore
    /// spostato in una finestra resterebbe invisibile a tutto il resto finché
    /// qualcuno non ricarica.
    ///
    /// L'attore è quello corrente, come per ogni altra scrittura: chi ha chiesto
    /// è chi è entrato nel kernel (decisione 0012), e questa capacità passa da
    /// un comando o da un plugin, mai dal kernel di sua iniziativa.
    /// Azzera una chiave: ricade al livello sotto (vedi
    pub fn set_setting(
        &mut self,
        key: &str,
        value: SettingValue,
    ) -> std::result::Result<(), PluginError> {
        let scope = self
            .settings
            .write()
            .expect("store di configurazione")
            .set(key, value)?;
        self.announce_setting(key, scope);
        Ok(())
    }

    /// [`SettingsWrite::reset_setting`](fub_abi::traits::SettingsWrite::reset_setting)).
    // Una chiave che è un recinto rifà il recinto, **prima** di dirlo
    pub fn reset_setting(&mut self, key: &str) -> std::result::Result<(), PluginError> {
        let scope = self
            .settings
            .write()
            .expect("store di configurazione")
            .reset(key)?;
        self.announce_setting(key, scope);
        Ok(())
    }

    fn announce_setting(&mut self, key: &str, scope: SettingScope) {
        // (§23.17): chi riceve l'evento può chiamare, e riceverebbe un cancello
        // ancora aperto. Passa di qui e non dai due chiamanti perché scrivere e
        // azzerare sono la stessa cosa vista da due lati — azzerare una chiave
        // negata è precisamente il modo in cui si riconcede.
        // E una chiave che è una **finestra** ripota il registro, subito e non
        if let Some((plugin, _)) = fub_abi::settings::permission_of_key(key) {
            let plugin = plugin.to_string();
            self.reapply_permissions(&plugin);
        }
        // alla prossima apertura: chi stringe la conservazione a trenta giorni
        // lo fa per far cadere ciò che c'è adesso, non ciò che ci sarà. Stessa
        // riga del recinto qui sopra, stessa ragione (§23.9).
        // Le scorciatoie che il file di questo vault dichiara (§23.13), come
        if key == crate::journal::RETENTION_DAYS {
            self.prunes_the_record();
        }
        let key = key.to_string();
        self.emit_event(Event::SettingChanged { key, scope });
        if !self.dispatch.in_provider_call() {
            self.dispatch_pending();
        }
    }

    /// chiave → accordo. La chiede chi monta, per sapere cosa questo vault
    /// propone alla tastiera di chi lo apre.
    /// Sospende il valore del vault di queste chiavi (§23.13): finché sono
    pub fn vault_keybindings(&self) -> std::collections::BTreeMap<String, String> {
        self.settings
            .read()
            .expect("store di configurazione")
            .vault_keybindings()
    }

    /// sospese si leggono come se il file non ne parlasse.
    ///
    /// **Non emette l'evento** delle impostazioni, e la ragione è che non
    /// succede a impostazioni cambiate: succede all'apertura, prima che ci sia
    /// qualcuno in ascolto, e ciò che chi legge vede è un valore che non è mai
    /// stato altro. Scioglierla invece è un cambiamento come gli altri, e passa
    /// da [`announce_setting`](Workspace::announce_setting) come tutti.
    /// Le chiavi sospese adesso (§23.13).
    pub fn suspend_settings(&mut self, keys: std::collections::BTreeSet<String>) {
        self.settings
            .write()
            .expect("store di configurazione")
            .suspend(keys);
    }

    /// Scioglie la sospensione di queste chiavi — l'utente le ha guardate — e
    pub fn suspended_settings(&self) -> std::collections::BTreeSet<String> {
        self.settings
            .read()
            .expect("store di configurazione")
            .suspended()
            .clone()
    }

    /// **lo dice**, una per una: chi disegna la tastiera rilegge gli accordi
    /// quando sente cambiare un'impostazione, e un risveglio silenzioso
    /// lascerebbe la scorciatoia nuova scritta nel pannello e non premibile fino
    /// alla riapertura.
    ///
    /// Prende un elenco e non scioglie tutto perché chi risponde ha risposto su
    /// ciò che ha visto: una chiave che nessuno gli ha mostrato — perché nessuno
    /// la dichiara — non è compresa nel sì.
    /// Qualcuno dichiara questa chiave in questo montaggio?
    pub fn resume_settings(&mut self, keys: &std::collections::BTreeSet<String>) {
        {
            let mut store = self.settings.write().expect("store di configurazione");
            let mut suspended = store.suspended().clone();
            suspended.retain(|k| !keys.contains(k));
            store.suspend(suspended);
        }
        for key in keys {
            self.announce_setting(key, SettingScope::Vault);
        }
    }

    ///
    /// È una domanda diversa da «c'è un valore»: un file può portare la
    /// scorciatoia di un comando di un componente che oggi è spento, e quella
    /// chiave non ha uno schema, non si legge e non si scrive. Chi chiede è chi
    /// deve **mostrarla a qualcuno** (§23.13), e una riga senza schema non ha né
    /// un titolo da scrivere né un modo di essere azzerata.
    /// Questa chiave si è dichiarata scrivibile da un programma? `None` = non
    pub fn setting_is_declared(&self, key: &str) -> bool {
        self.settings
            .read()
            .expect("store di configurazione")
            .spec(key)
            .is_some()
    }

    /// è dichiarata affatto, che è un no diverso e va detto diverso.
    ///
    /// Lo chiede l'host dei plugin prima di scrivere (§11.1): il permesso dice
    /// *chi*, questo dice *cosa*.
    /// Le impostazioni risolte, tutte o di un plugin: è la risposta che il
    pub fn setting_is_program_writable(&self, key: &str) -> Option<bool> {
        self.settings
            .read()
            .expect("store di configurazione")
            .spec(key)
            .map(|spec| spec.program_writable)
    }

    /// canale dati restituisce a [`IndexQuery::Settings`].
    // --- lo stato di vista (§11.2) -----------------------------------------
    pub fn settings_entries(&self, plugin: Option<&str>) -> Vec<SettingEntry> {
        let rows = self
            .settings
            .read()
            .expect("store di configurazione")
            .entries_by_owner(plugin);
        rows.into_iter()
            .map(|(owner, mut entry)| {
                self.localize(&owner, &mut entry);
                entry
            })
            .collect()
    }

    //
    // Le due porte sono **due**, come per le impostazioni e per la stessa
    // ragione: queste prendono il proprietario come argomento perché le chiama
    // chi *è* la shell (che non è un plugin e non ha un id da timbrare); un
    // provider passa invece dalle capacità, dove il proprietario e l'esemplare
    // li mette l'host e non si possono nominare.
    /// Ciò che questo esemplare aveva salvato sotto questa chiave, su questa
    ///
    /// macchina e per questo vault.
    /// Salva (`Some`) o dimentica (`None`) lo stato di vista di un esemplare.
    pub fn view_state(&self, owner: &str, instance: &str, key: &str) -> Option<serde_json::Value> {
        self.view_states
            .get(self.root().as_str(), owner, instance, key)
    }

    /// Lo stato di vista della macchina, da condividere col prossimo vault che
    pub fn set_view_state(
        &self,
        owner: &str,
        instance: &str,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> std::result::Result<(), String> {
        self.view_states
            .set(self.root().as_str(), owner, instance, key, value)
    }

    /// si apre. Gemello di [`machine_settings`](Workspace::machine_settings).
    // --- l'organizzazione del vault (§11.3) --------------------------------
    pub fn view_states(&self) -> Arc<ViewStates> {
        Arc::clone(&self.view_states)
    }

    //
    // **Per chiave, non a blob intero**, ed è la riga che questa voce esiste
    // per scrivere: prima la shell rileggeva tutto, cambiava un campo e
    // riscriveva tutto, quindi due finestre sullo stesso vault erano una *lost
    // update* — la seconda che salva cancella ciò che ha fatto la prima, e
    // nessuna delle due se ne accorge.
    //
    // Non sono capacità dell'`HostApi` ma metodi del workspace: **nessun plugin
    // le chiede ancora**, e una capacità concessa a nessuno è superficie da
    // mantenere, documentare e sandboxare per sempre — è la regola del §1.6, e
    // vale anche quando la cosa da non aggiungere è comoda. Leggere invece passa
    // dal canale dati, che chiunque ha.
    /// L'organizzazione di questo vault: icone, appuntate, ordinamenti, spazi.
    ///
    /// L'emoji accanto a una nota o a una cartella (`None` la toglie).
    pub fn organization(&self) -> fub_abi::organization::Organization {
        self.organization.snapshot()
    }

    /// Appunta o spunta una nota.
    pub fn set_icon(&self, path: &str, icon: Option<String>) -> std::result::Result<(), String> {
        self.organization.set_icon(path, icon)
    }

    /// Registra o toglie una cartella dagli spazi.
    pub fn set_pinned(&self, id: &str, pinned: bool) -> std::result::Result<(), String> {
        self.organization.set_pinned(id, pinned)
    }

    /// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
    pub fn set_space(&self, path: &str, is_space: bool) -> std::result::Result<(), String> {
        self.organization.set_space(path, is_space)
    }

    /// Cosa è andato storto con l'organizzazione: il file illeggibile
    pub fn set_order(&self, folder: &str, names: Vec<String>) -> std::result::Result<(), String> {
        self.organization.set_order(folder, names)
    }

    /// all'apertura, o una migrazione che non si è potuta scrivere. Chi monta le
    /// mostra, e svuotandole se ne fa carico.
    /// Quali spazi per-documento non hanno potuto seguire una rinomina (§13.2).
    pub fn organization_warnings(&self) -> Vec<String> {
        self.organization.take_warnings()
    }

    /// Chi monta le mostra, e svuotandole se ne fa carico.
    /// Porta dietro a una rinomina lo stato per-documento di **ogni** plugin
    pub fn doc_data_warnings(&mut self) -> Vec<String> {
        std::mem::take(&mut self.doc_data_warnings)
    }

    /// (§13.2), e annota chi non ce l'ha fatta.
    ///
    /// Non torna un `Result` e non può tornarlo: chi la chiama ha già spostato
    /// il file, e annullare una rinomina riuscita perché un plugin non ha potuto
    /// seguirla sarebbe il verso sbagliato. È la stessa regola
    /// dell'organizzazione, applicata a chi non è il kernel.
    /// Toglie lo stato per-documento delle note che non esistono più (§13.2).
    fn migrate_doc_data(&mut self, from: &DocId, to: &DocId) {
        let roots = self.docs.plugin_data_roots();
        let storage = Arc::clone(self.docs.vault.storage());
        for error in crate::docdata::migrate_data(storage.as_ref(), &roots, from, to) {
            self.doc_data_warnings.push(format!(
                "lo stato per-documento di {from} non ha potuto seguire la rinomina \
                 in {to} — {error}"
            ));
        }
    }

    ///
    /// È un **giro sul disco** e non una reazione a un evento, ed è la sola
    /// forma che funziona: la cancellazione definitiva la si può perdere (una
    /// nota tolta dal cestino ad app chiusa non la annuncia nessuno), un giro
    /// no. Gira all'apertura, quando l'anagrafe è appena stata ricostruita.
    ///
    /// «Non esiste più» vuol dire né indicizzata **né nel cestino**: una nota
    /// cestinata è recuperabile, e ripristinarla senza i suoi dati sarebbe una
    /// perdita silenziosa fatta da chi doveva impedirla.
    /// Esegue un comando di manutenzione (§15.2).
    ///
    /// Sta qui e non in un `CommandProvider` per la ragione scritta in testa a
    /// [`crate::maintenance`]: ciò che questi comandi fanno non è una capacità
    /// dell'`HostApi`, e non deve diventarlo per poterli scrivere.
    ///
    /// Il **modo** è onorato come per ogni altro comando: una simulazione dice
    /// cosa farebbe e non lo fa. Che i tre siano innocui non è una ragione per
    /// saltare quel ramo — chi simula una macro che li contiene si aspetta un
    /// piano, non un vault reindicizzato.
    // Il piano è **vuoto di documenti** per tutti e quattro, e non è una
    fn run_maintenance(
        &mut self,
        command: &str,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        use crate::maintenance::{
            Diagnostics, BUNDLE_FILE, DIAGNOSTICS_VERSION, VAULT_CLEAR_JOURNAL,
            VAULT_DIAGNOSTIC_BUNDLE, VAULT_REBUILD_INDEX, VAULT_REPAIR,
        };
        if mode.is_dry_run() {
            // lacuna: nessuno tocca una nota, quindi l'insieme impattato è
            // davvero vuoto. Il sommario però non è vuoto per tutti — è il campo
            // che esiste per dire «cosa succede» in una riga, e i tre che
            // riparano non hanno niente da dire mentre il quarto **perde
            // qualcosa** e chi approva deve vederne il conto.
            // Il rebuild rifà il derivato; questo raccoglie ciò che il
            let mut plan = fub_abi::command::CommandPlan::default();
            if command == VAULT_CLEAR_JOURNAL {
                plan.summary = Text::message(
                    crate::maintenance::T_JOURNAL_PLAN,
                    vec![fub_abi::text::Arg::int(
                        crate::maintenance::A_LINES,
                        self.journal()?.records.len() as i64,
                    )],
                );
            }
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }
        match command {
            VAULT_REBUILD_INDEX => {
                let opening = self.reindex().map_err(|and| {
                    PluginError::Internal(format!("l'indice non si è rifatto: {and}").into())
                })?;
                let discarded = opening.discarded.len();
                Ok(CommandOutcome::notify(Text::message(
                    crate::maintenance::T_REBUILT,
                    vec![
                        fub_abi::text::Arg::int(
                            crate::maintenance::A_DOCS,
                            self.indexes.core.metas.len() as i64,
                        ),
                        fub_abi::text::Arg::int(
                            crate::maintenance::A_ENTRIES,
                            self.indexes.core.entries.len() as i64,
                        ),
                        fub_abi::text::Arg::int(crate::maintenance::A_SKIPPED, discarded as i64),
                    ],
                )))
            }
            VAULT_REPAIR => {
                // rebuild non guarda — i dati attaccati a note che non ci sono
                // più — e **dice** ciò che non ripara, invece di tacerlo.
                // Il messaggio è **una chiave per caso**, e non una frase
                let collected = self.collect_doc_data()?;
                let journal = self.journal()?;
                let drafts = self.drafts()?;
                let orfane = drafts
                    .drafts
                    .iter()
                    .filter(|b| !self.indexes.core.entries.contains_key(&b.doc))
                    .count();
                // composta a pezzi: concatenare stringhe tradotte produce testo
                // che nella lingua dopo non sta in piedi (0040).
                // Le due righe che questo comando **non** ripara si dicono, e
                let key = if journal.pruned > 0 || drafts.pruned > 0 || orfane > 0 {
                    crate::maintenance::T_REPAIRED_PARZIALE
                } else {
                    crate::maintenance::T_REPAIRED
                };
                // sono due specie diverse di cosa: una riga di registro rotta è
                // perduta, una bozza orfana è l'unica copia di un testo — e la
                // seconda si ripara solo decidendo, cioè non qui.
                // Il primo lettore vero di `IndexQuery::VaultHealth`: quella
                Ok(CommandOutcome::notify(Text::message(
                    key,
                    vec![
                        fub_abi::text::Arg::int(crate::maintenance::A_COLLECTED, collected as i64),
                        fub_abi::text::Arg::int(crate::maintenance::A_LOST, journal.pruned as i64),
                        fub_abi::text::Arg::int(crate::maintenance::A_UNREAD, drafts.pruned as i64),
                        fub_abi::text::Arg::int(crate::maintenance::A_ORPHANS, orfane as i64),
                    ],
                )))
            }
            VAULT_DIAGNOSTIC_BUNDLE => {
                let journal = self.journal()?;
                let drafts = self.drafts()?;
                let orfane = drafts
                    .drafts
                    .iter()
                    .filter(|b| !self.indexes.core.entries.contains_key(&b.doc))
                    .count();
                // query esisteva e non la chiedeva nessuno.
                //
                // L'elenco è `HealthCheck::ALL` e non tre righe scritte qui: un
                // elenco a mano che si dimentica un controllo lascia il rapporto
                // valido — è ancora un array — con una riga in meno, e nessun
                // presidio guarda dentro quell'array.
                // Dal **supporto**, come ogni altro byte sotto la linea del
                let health = fub_abi::traits::HealthCheck::ALL
                    .into_iter()
                    .map(|check| {
                        let count =
                            match self.query_index(IndexQuery::VaultHealth { check, page: None }) {
                                Ok(IndexResult::VaultHealth(page)) => page.total as usize,
                                _ => 0,
                            };
                        (format!("{check:?}"), count)
                    })
                    .collect();
                let report = Diagnostics {
                    v: DIAGNOSTICS_VERSION,
                    at: crate::time::now_unix_millis(),
                    fub: env!("CARGO_PKG_VERSION").to_string(),
                    documents: self.indexes.core.metas.len(),
                    entries: self.indexes.core.entries.len(),
                    journal_pruned: journal.pruned,
                    drafts: drafts.drafts.len(),
                    drafts_orphans: orfane,
                    health,
                };
                let bytes = serde_json::to_vec_pretty(&report)
                    .map_err(|and| PluginError::Internal(format!("rapporto: {and}").into()))?;
                let path = crate::vault::data_root(self.docs.vault.root()).join(BUNDLE_FILE);
                // vault: un rapporto scritto con `std::fs` sarebbe il primo file
                // di Fub a non essere né atomico né cifrabile.
                // L'unico dei quattro il cui esito **risale**: gli altri tre non
                self.docs
                    .vault
                    .storage()
                    .write(&path, &bytes)
                    .map_err(|and| PluginError::Internal(format!("rapporto: {and}").into()))?;
                Ok(CommandOutcome::notify(Text::message(
                    crate::maintenance::T_BUNDLE_WRITTEN,
                    vec![fub_abi::text::Arg::text(
                        crate::maintenance::A_PATH,
                        path.as_str(),
                    )],
                )))
            }
            VAULT_CLEAR_JOURNAL => {
                // perdono niente, quindi un guasto si può raccontare e basta.
                // Qui l'utente ha chiesto che una cosa sparisca, e una richiesta
                // di far sparire qualcosa che fallisce in silenzio è la peggiore
                // delle risposte — chi l'ha chiesta se ne va credendo che sia
                // sparita.
                // **Toglie lo spazio per-documento delle note che non ci sono più** (§13.2),
                let count = self
                    .journal
                    .clear()
                    .map_err(|and| PluginError::Internal(format!("registro: {and}").into()))?;
                Ok(CommandOutcome::notify(Text::message(
                    crate::maintenance::T_JOURNAL_CLEARED,
                    vec![fub_abi::text::Arg::int(
                        crate::maintenance::A_LINES,
                        count as i64,
                    )],
                )))
            }
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }

    /// e dice quante ne ha tolte.
    ///
    /// Passa di qui e non da un evento: la cancellazione definitiva si può
    /// perdere — svuotare il cestino ad app chiusa non lo annuncia nessuno —
    /// mentre un giro sul disco no. Il momento giusto è subito dopo
    /// [`finish_index`](Workspace::finish_index), quando l'anagrafe è appena
    /// stata ricostruita ed è al suo massimo di verità.
    ///
    /// # Perché prende `&self`, e perché non basta che lo prenda
    ///
    /// Perché non tocca il workspace: guarda l'anagrafe, cammina il disco degli
    /// spazi dati e toglie cartelle. Stava dentro `finish_index`, cioè dentro il
    /// prestito **esclusivo**, e su un vault con una storia per nota quel giro è
    /// un `readdir` più uno `stat` per documento — più il cestino, che si legge
    /// per intero. Chi disegna il vault appena aperto lo aspettava tutto.
    ///
    /// Il prestito **condiviso** non è solo più corto: è l'unico che tiene in
    /// piedi ciò che questa funzione decide. «Questo documento non c'è più» si
    /// legge dall'anagrafe e si esegue cancellando, e fra le due cose nessuno
    /// deve poter far tornare quel documento — se no si cancella lo spazio di una
    /// nota viva. Chiunque lo farebbe vuole `&mut`, quindi il prestito condiviso
    /// lo esclude: la finestra fra il giudizio e la cancellazione non esiste,
    /// senza che serva un piano da invalidare (0119).
    ///
    /// **Chi la chiama**: [`reindex`](Workspace::reindex) per il giro sincrono,
    /// il runner di `fub-host` per l'apertura a fasi, e `vault.repair`. Che il
    /// secondo non se la dimentichi lo guarda un banco, non questa riga.
    ///
    /// **Quante ne ha tolte, o cosa non è riuscita a togliere.** Una
    /// cancellazione parziale prima era indistinguibile da una riuscita — il
    /// conto tornava più piccolo e basta — e chi resta indietro sul disco non lo
    /// segnalava nessuno. Adesso il guasto risale, e sono i due chiamanti a
    /// decidere cosa farne: l'apertura lo registra e prosegue, `vault.repair` lo
    /// dice a chi l'ha chiesto.
    // **Una raccolta si fa su un'anagrafe che si dichiara completa, o non si
    pub fn collect_doc_data(&self) -> Result<usize> {
        // fa** (§23.1). È la stessa riga con cui `finish_index` non riconcilia
        // un'indicizzazione interrotta, applicata al suo vicino di tre righe
        // sotto — dove mancava, e dove costava incomparabilmente di più: chi
        // riconcilia su un insieme parziale svuota un **derivato**, che si rifà
        // riaprendo; chi raccoglie su un insieme parziale cancella dal disco lo
        // spazio per-documento di note che esistono, e quello non lo rifà
        // nessuno. Ci si arrivava premendo «annulla» sulla prima
        // indicizzazione di un vault grande, o chiudendo l'app mentre girava.
        //
        // `Ready` è il **default** di questo stato, quindi la guardia non chiude
        // la porta a chi raccoglie senza aver aperto niente: chiude a chi ha
        // aperto a metà, che è l'unico caso in cui l'anagrafe mente.
        // Ciò che il ricongiungimento ha messo in dubbio non si raccoglie: è la
        if self.indexes.core.watch.indexing != IndexingState::Ready {
            return Ok(0);
        }
        let roots = self.docs.plugin_data_roots();
        if roots.is_empty() {
            return Ok(0);
        }
        let _phase = tracing::info_span!(target: "fub.apertura", "collect_doc_data").entered();
        let trashed = self.trashed_originals();
        let metas = &self.indexes.core.metas;
        // terza regola di [`rejoin_renamed_while_closed`], e vive qui perché la
        // raccolta ha due chiamanti — l'apertura e `vault.repair` — e uno di
        // essi gira quando quel dubbio non è più in vista.
        // I documenti da cui il cestino è passato: ciò che sta lì dentro **non è
        let suspended = &self.suspended_from_rejoin;
        let storage = Arc::clone(self.docs.vault.storage());
        crate::docdata::collect(storage.as_ref(), &roots, &|doc: &DocId| {
            metas.contains_key(doc) || trashed.contains(doc) || suspended.contains(doc)
        })
    }

    /// sparito**, è recuperabile.
    /// **Riconosce le rinomine che non ha visto nessuno** (§23.1), e restituisce
    fn trashed_originals(&self) -> std::collections::HashSet<DocId> {
        self.docs
            .list_trash()
            .unwrap_or_default()
            .into_iter()
            .map(|and| and.original)
            .collect()
    }

    /// i documenti su cui il dubbio ha sospeso il giudizio.
    ///
    /// # Il problema
    ///
    /// Il path è la chiave, e lo è per sempre
    /// ([0043](../../../docs/decisions/0188-identita-path-e-rename.md)). Chi
    /// rinomina una nota mentre Fub è aperto — dalla shell, dal Finder, da un
    /// client di sync — la fa seguire da tutto ciò che le sta attaccato, perché
    /// il rilevatore accoppia i due path e si finisce in
    /// [`migrate_identity`](Workspace::migrate_identity). Chi la rinomina mentre
    /// Fub è **chiuso** non ha nessuno che accoppi: alla riapertura una nota
    /// risulta sparita e ne risulta nata un'altra, e lo spazio per-documento, le
    /// versioni e — l'unica copia di un testo mai salvato — la **bozza** restano
    /// attaccati a un nome che non esiste più.
    ///
    /// Non è il caso di frontiera: un client di sync che rinomina ad app chiusa
    /// è il caso *normale* di chi tiene il vault su due macchine.
    ///
    /// # La terza strada
    ///
    /// La 0043 ha scartato l'id esterno, e giustamente — una tabella
    /// `path → id` tenuta dal kernel è «il path con un costume addosso». Ma la
    /// riassociazione non deve passare da un id: passa dal **contenuto**. Il
    /// materiale è già tutto su disco e non costa una lettura in più:
    /// l'anagrafe è durevole fra un avvio e l'altro
    /// ([0046](../../../docs/decisions/0188-identita-path-e-rename.md)) e porta
    /// l'impronta di ogni documento che qualcuno ha letto, e l'impronta di ciò
    /// che è comparso oggi l'ha appena calcolata
    /// [`plan_batch`](Workspace::plan_batch) leggendolo.
    ///
    /// # Le tre regole, e perché nessuna si poteva scrivere senza deciderla
    ///
    /// 1. **Uno a uno, o niente.** Due impronte uguali sono una rinomina solo se
    ///    una nota è *sparita*: due file identici comparsi senza che sparisse
    ///    niente sono una copia, e trattarli come una rinomina sposterebbe la
    ///    bozza dell'uno sull'altro. E quando ne spariscono N e ne compaiono N
    ///    con la stessa impronta, l'accoppiamento non è unico.
    /// 2. **Nel dubbio non si accoppia**, ed è il verso *opposto* a quello della
    ///    [0085](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md): là nel
    ///    dubbio si conta come cambiamento, perché una rilettura di troppo costa
    ///    un file aperto. Qui un accoppiamento sbagliato consegna il testo non
    ///    salvato di una nota a un'altra, e non c'è nessun «di troppo» che
    ///    costi così poco.
    /// 3. **Nel dubbio non si nemmeno raccoglie.** Se le due mosse restano una
    ///    sola — non accoppiare — il dubbio finisce a `remove_dir_all`, che è
    ///    irreversibile, mentre aspettare costa qualche byte fermo. Quindi ciò
    ///    che questa funzione mette in dubbio esce dalla porta e la raccolta lo
    ///    salta: se domani l'ambiguità si scioglie (l'utente cancella la copia
    ///    di troppo), il giro dopo accoppia.
    ///
    /// # Cosa resta fuori, e non per dimenticanza
    ///
    /// - **Il file vuoto**, che con un altro file vuoto ha per forza la stessa
    ///   impronta: zero byte non sono una prova di identità, sono l'assenza di
    ///   una prova. È il caso in cui la regola 1 sarebbe soddisfatta e la
    ///   conclusione falsa.
    /// - **Il cestino**: una nota cestinata non è sparita, è recuperabile, e
    ///   spostarne i dati su un omonimo li toglierebbe a chi la ripristina.
    /// - **Gli allegati**: la seconda fase calcola la stessa impronta dei
    ///   documenti direttamente dai byte, così una rinomina ad app chiusa può
    ///   ricongiungersi qui senza una riga di codice dedicata.
    /// - **Un'anagrafe che non si è potuta leggere** (versione ignota, file
    ///   rotto): niente ieri, niente spariti, nessuna rinomina da vedere. Il
    ///   ricongiungimento è una capacità di un **derivato**, e perso il derivato
    ///   si perde anche lei — per un giro, e in silenzio.
    // C'era ieri, oggi non c'è, e portava l'impronta di un contenuto.
    fn rejoin_renamed_while_closed(&mut self) -> BTreeSet<DocId> {
        let trashed = self.trashed_originals();
        // Oggi c'è, ieri non c'era. Si guardano solo le impronte per cui
        let mut disappeared: BTreeMap<(crate::storage::FileIdentity, Revision), Vec<DocId>> =
            BTreeMap::new();
        let snapshot = self.entry_store.snapshot();
        for (id, entry) in &snapshot {
            if entry.size == 0 || self.indexes.core.entries.contains_key(id) || trashed.contains(id)
            {
                continue;
            }
            if let (Some(identity), Some(fingerprint)) = (entry.identity, entry.fingerprint.clone())
            {
                disappeared
                    .entry((identity, fingerprint))
                    .or_default()
                    .push(id.clone());
            }
        }
        if disappeared.is_empty() {
            return BTreeSet::new();
        }

        // qualcosa è sparito: un vault appena aperto per la prima volta ha
        // tutto «comparso» e niente «sparito», e non deve costare una mappa
        // grande quanto il vault per scoprirlo.
        // Nessun candidato: non è una rinomina, è una cancellazione. La
        let mut appeared: BTreeMap<(crate::storage::FileIdentity, Revision), Vec<DocId>> =
            BTreeMap::new();
        for entry in self.indexes.core.entries.values() {
            if entry.size == 0 || self.entry_store.known(&entry.id).is_some() {
                continue;
            }
            let (Some(identity), Some(fingerprint)) = (
                self.docs.vault.file_identity(&entry.id),
                entry.fingerprint.clone(),
            ) else {
                continue;
            };
            let key = (identity, fingerprint);
            if disappeared.contains_key(&key) {
                appeared.entry(key).or_default().push(entry.id.clone());
            }
        }

        let mut suspended = BTreeSet::new();
        let mut pairs: Vec<(DocId, DocId)> = Vec::new();
        for (identity_and_digest, mut from) in disappeared {
            let Some(a) = appeared.get(&identity_and_digest) else {
                // raccolta se ne occupa come si è sempre occupata.
                // Il pavimento e la porta insieme (0062): una riga nel log per chi
                continue;
            };
            if from.len() == 1 && a.len() == 1 {
                pairs.push((from.remove(0), a[0].clone()));
            } else {
                suspended.extend(from);
            }
        }

        for (from, to) in &pairs {
            // fa assistenza, e l'evento qui sotto per chi sta dentro l'app.
            // **E poi si dice**, con lo stesso evento della rinomina vista: chi
            tracing::info!(
                target: "fub.kernel",
                "rinomina fatta ad app chiusa riconosciuta dall'impronta: {from} → {to}"
            );
            self.migrate_side_data(from, to);
        }
        if !pairs.is_empty() {
            // tiene stato per-documento fuori dallo spazio dichiarato — il
            // versioning, che ha uno store suo perché deve sopravvivere alla
            // cancellazione (0044) — non ha altro modo di saperlo, e questo è
            // l'unico posto in cui qualcuno lo sa. Che la coda possa troncare
            // (0034) è la ragione per cui i tre dati autorevoli che il kernel sa
            // spostare li ha spostati **prima**, e non aspettando che qualcuno
            // ascoltasse.
            // Cosa è andato storto **leggendo** la configurazione: un file malformato,
            self.as_actor(Actor::Kernel, |ws| {
                for (from, to) in pairs {
                    ws.emit_event(Event::DocumentRenamed { from, to });
                }
            });
        }
        suspended
    }

    /// una chiave di macchina scritta dentro un vault, un valore che non regge
    /// la specie dichiarata. Chi monta le mostra, e svuotandole se ne fa carico.
    /// Il livello macchina di questo workspace, da condividere con il prossimo
    pub fn settings_warnings(&mut self) -> Vec<String> {
        self.settings
            .write()
            .expect("store di configurazione")
            .take_warnings()
    }

    /// vault che si apre (§11.1): la configurazione della macchina è **una**, e
    /// N copie sarebbero N idee del tema.
    // --- interni ---------------------------------------------------------
    pub fn machine_settings(&self) -> Arc<MachineSettings> {
        Arc::clone(
            self.settings
                .read()
                .expect("store di configurazione")
                .machine(),
        )
    }

    // --- storage persistente dei plugin ------------------------------------

    /// La radice dello spazio dati di un plugin, **come cartella del
    ///
    /// filesystem**.
    ///
    /// È **l'unico varco del filesystem fuori da `VaultStorage`**
    /// ([0064](../../../docs/decisions/0185-capability-un-solo-guard.md)): ogni
    /// altro byte di un vault passa dal supporto, e lì la cifratura si ferma
    /// qui. Per questo è un metodo del workspace e non una capacità
    /// dell'[`HostApi`]: `data_*` nomina blob, non file, ed è tutto ciò che un
    /// plugin WASM avrà. Un provider nativo che avvolge un motore con un
    /// proprio formato su disco (tantivy mmappa i suoi segmenti e li rilegge
    /// quando gli pare, anche dai thread di merge) ha bisogno di una vera
    /// cartella: questa è quella cartella, **dentro lo stesso recinto** di
    /// tutto il resto. A M5 l'equivalente per un componente è un preopen WASI
    /// sulla stessa radice — un plugin WASM non riceverà mai una cartella dal
    /// kernel.
    ///
    /// Chi la chiama è elencato e presidiato in
    /// `crates/fub-kernel/tests/il_supporto.rs`: oggi solo la ricerca.
    ///
    /// Rifiuta un id che non sia un nome semplice, con la stessa regola dei
    /// path di `data_*`: il recinto è uno.
    /// La radice dello spazio dati di un plugin.
    pub fn plugin_data_dir(&self, plugin: &str) -> std::result::Result<Utf8PathBuf, PluginError> {
        self.plugin_data_path(plugin, "")
    }

    /// Il supporto del vault (§15.1), per chi implementa `data_*`: lo spazio
    pub(crate) fn plugin_data_root(&self, plugin: &str) -> Utf8PathBuf {
        self.docs.plugin_data_root(plugin)
    }

    /// La radice derivata della cache di un plugin.
    pub(crate) fn plugin_cache_root(&self, plugin: &str) -> Utf8PathBuf {
        self.docs.plugin_cache_root(plugin)
    }

    /// dati di un plugin sta **dentro** il vault, e ci si scrive con lo stesso
    /// supporto con cui si scrivono i documenti.
    /// Traduce un path relativo dello spazio di un plugin in un path assoluto,
    pub(crate) fn storage(&self) -> &Arc<dyn crate::storage::VaultStorage> {
        self.docs.vault.storage()
    }

    /// rifiutando **tutto** ciò che proverebbe a uscirne.
    ///
    /// Il recinto è qui e in nessun altro posto: il plugin nomina blob, non
    /// path del filesystem, e non ha modo di sapere dove sia la radice del
    /// vault. `rel` vuoto è la radice stessa (serve a `data_list`).
    // I separatori sono `/` e basta: un `\` su Windows sarebbe un
    pub(crate) fn plugin_data_path(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<Utf8PathBuf, PluginError> {
        let denied = |why: &str| PluginError::PermissionDenied(format!("`{rel}`: {why}").into());
        if !is_safe_component(plugin) {
            return Err(PluginError::PermissionDenied(
                format!("id di plugin non utilizzabile come spazio dati: `{plugin}`").into(),
            ));
        }
        let mut path = self.plugin_data_root(plugin);
        if rel.is_empty() {
            return Ok(path);
        }
        // separatore, e qui deve restare un carattere qualunque — cioè un nome
        // di file illegale, non una via d'uscita.
        // Valida un nome/path che **nomina un documento che esiste** (o che potrebbe
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

    /// Traduce un path relativo nello spazio derivato della cache.
    pub(crate) fn plugin_cache_path(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<Utf8PathBuf, PluginError> {
        let data_path = self.plugin_data_path(plugin, rel)?;
        let relative = data_path
            .strip_prefix(self.plugin_data_root(plugin))
            .map_err(|_| PluginError::Internal("cache path outside plugin root".into()))?;
        Ok(self.plugin_cache_root(plugin).join(relative))
    }

    fn plugin_cache_mark_path(&self, plugin: &str) -> Utf8PathBuf {
        self.plugin_cache_root(plugin).join(PLUGIN_CACHE_MARK)
    }

    /// `.fub/data/plugins/<id>/` esiste e **non** è cache: è l'albero vecchio.
    pub(crate) fn plugin_legacy_is_authoritative(&self, plugin: &str) -> bool {
        let cache = self.plugin_cache_root(plugin);
        self.storage().exists(&cache)
            && !self.storage().exists(&self.plugin_cache_mark_path(plugin))
    }

    pub(crate) fn plugin_authoritative_uses_canonical(&self, plugin: &str) -> bool {
        self.storage().exists(&self.plugin_data_root(plugin))
            || !self.plugin_legacy_is_authoritative(plugin)
    }

    pub(crate) fn plugin_authoritative_path(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<Utf8PathBuf, PluginError> {
        if self.plugin_authoritative_uses_canonical(plugin) {
            self.plugin_data_path(plugin, rel)
        } else {
            self.plugin_cache_path(plugin, rel)
        }
    }

    /// Prima di `cache_write`: se il vecchio albero è ancora autorevole, lo
    /// sposta in `.fub/plugins/<id>/`. Poi posa il marcatore, così un plugin
    /// nuovo che scrive solo cache non rende quei blob visibili a `data_read`.
    pub(crate) fn prepare_plugin_cache_write(
        &self,
        plugin: &str,
    ) -> std::result::Result<(), PluginError> {
        if self.plugin_legacy_is_authoritative(plugin) {
            let from = self.plugin_cache_root(plugin);
            let to = self.plugin_data_root(plugin);
            self.storage().rename(&from, &to).map_err(|and| {
                PluginError::Io(format!("migrazione `{from}` → `{to}`: {and}").into())
            })?;
        }
        let mark = self.plugin_cache_mark_path(plugin);
        self.storage()
            .write_derived(&mark, b"cache\n")
            .map(|_| ())
            .map_err(|and| PluginError::Io(format!("{mark}: {and}").into()))
    }

    /// Legge i cursori dei timer del plugin dal dato autorevole del vault.
    ///
    /// Il file vive nello spazio dati del plugin (`.fub/plugins/<id>/`), la
    /// stessa radice centralizzata da `plugin_data_path`; non è una cache.
    pub fn timer_cursors(
        &self,
        owner: &str,
    ) -> std::result::Result<BTreeMap<String, CivilTime>, PluginError> {
        let path = self.plugin_data_path(owner, TIMER_CURSORS_FILE)?;
        let bytes = match self.storage().read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Err(error) => return Err(PluginError::Io(format!("{path}: {error}").into())),
        };
        let stored: BTreeMap<String, StoredCivilTime> =
            serde_json::from_slice(&bytes).map_err(|error| {
                PluginError::Internal(format!("timer cursors at {path}: {error}").into())
            })?;
        Ok(stored
            .into_iter()
            .map(|(id, time)| (id, time.into()))
            .collect())
    }

    /// Aggiorna atomicamente il cursore di un timer.
    pub fn set_timer_cursor(
        &self,
        owner: &str,
        timer: &str,
        cursor: CivilTime,
    ) -> std::result::Result<(), PluginError> {
        let path = self.plugin_data_path(owner, TIMER_CURSORS_FILE)?;
        self.storage()
            .update(&path, &mut |existing| {
                let mut stored: BTreeMap<String, StoredCivilTime> = existing
                    .map(serde_json::from_slice)
                    .transpose()
                    .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?
                    .unwrap_or_default();
                stored.insert(timer.to_owned(), cursor.into());
                serde_json::to_vec_pretty(&stored)
                    .map(Some)
                    .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
            })
            .map_err(|error| PluginError::Io(format!("{path}: {error}").into()))
    }
}

/// esistere): normalizza i separatori `\` → `/`, toglie spazi e slash iniziali, e
/// pretende che ciò che resta stia dentro il vault.
///
/// Il giudizio è del contratto — [`path_policy::check`] con
/// [`Naming::Existing`] — e non più di questa funzione: la stessa regola serve a
/// un indice di terzi e a un guest WASM, che `fub-kernel` non lo hanno
/// (decisione 0020). Anche la **tolleranza del varco** — la conversione dei
/// separatori Windows e il trim — è del contratto
/// ([`path_policy::from_outside`]), e non perché sia una regola sui nomi: perché
/// i varchi sono più d'uno. Il sidecar dell'organizzazione e il doppio dell'SDK
/// fanno lo stesso ingresso senza avere `fub-kernel` fra le mani, e tre trim
/// scritti a mano sono tre tolleranze che divergono senza che nessuno le veda.
///
/// È la regola di ogni percorso che trasforma input esterno in un `DocId`:
/// rename, restore, i comandi IPC e il confine delle capacità
/// ([`fenced_doc_id`]). Chi invece fa **nascere** un nome passa da
/// [`new_doc_id`], che è più stretta — e la differenza è il §15.5.
/// Il [`DocId`] di un nome che **nasce adesso**: [`valid_doc_id`], più la
pub fn valid_doc_id(name: &str) -> Result<DocId> {
    let clean = &path_policy::from_outside(name);
    path_policy::check(clean, Naming::Existing).map_err(|why| KernelError::BadName {
        name: name.to_string(),
        why: why.to_string(),
    })?;
    Ok(DocId::new(clean))
}

/// portabilità e la forma NFC (§15.5).
///
/// La differenza fra le due non è di severità ma di **domanda**. Un vault
/// contiene ciò che contiene — un `CON.md` scritto su Linux, un nome in NFD
/// scritto da macOS — e rifiutarsi di nominarlo vorrebbe dire rifiutarsi di
/// aprire il vault. Ma scriverne uno nuovo così è Fub che crea un file che, il
/// giorno in cui il vault attraversa un sistema operativo, non si apre più: il
/// difetto è nostro, e l'unico momento in cui costa niente è adesso.
///
/// Il nome torna **normalizzato** ([`path_policy::normalized`]): NFC e senza
/// spazi ai bordi dei segmenti. Non è una migrazione di ciò che c'è — è la scelta
/// di una forma sola per ciò che si scrive, e serve perché due nomi che
/// differiscono solo per la composizione Unicode sono due file per il filesystem
/// e **uno** per il grafo.
///
/// Qui non si normalizza *prima* di chiedere il giudizio, e prima della 0068 lo
/// si faceva: `check(_, Naming::New)` giudica ormai da sé la forma che si
/// scrive, quindi comporre le due funzioni in questa riga sarebbe normalizzare
/// due volte e, soprattutto, rimettere in giro l'idea che l'ordine sia una cosa
/// che il chiamante deve sapere.
/// Il [`DocId`] con cui un **plugin** può nominare un documento, o
pub fn new_doc_id(name: &str) -> Result<DocId> {
    let id = valid_doc_id(name)?;
    path_policy::check(id.as_str(), Naming::New).map_err(|why| KernelError::BadName {
        name: name.to_string(),
        why: why.to_string(),
    })?;
    Ok(DocId::new(path_policy::normalized(id.as_str())))
}

/// `PermissionDenied`.
///
/// È [`valid_doc_id`] applicata sul confine delle capacità: stessa regola dei
/// comandi IPC, altro varco. L'errore è `PermissionDenied` e non `BadArgs`
/// perché è la stessa risposta che `data_*` dà a una risalita — per chi la
/// riceve, i due recinti si comportano allo stesso modo.
///
/// Vive nel **contratto** e non qui perché il kernel non è l'unico a ospitare
/// un plugin: `MemoryHost`, il doppio con cui si prova una feature prima che
/// esista un vault, deve dire di no agli stessi path, e finché la funzione
/// stava dentro `fub-kernel` — che il doppio non può nemmeno vedere — non
/// c'era modo di fargliela chiamare invece di riscriverla (0220). La riga qui
/// resta come nome: chi arriva dai varchi del kernel continua a trovarla dove
/// l'ha sempre cercata, e il corpo è uno solo.
/// La validazione del confine di fiducia della UI, in un posto solo.
pub(crate) use fub_abi::rules::path_policy::fenced_doc_id;

///
/// Da un provider fidato passa tutto; da uno non fidato l'albero deve essere
/// interamente dichiarativo. La funzione è banale **di proposito**: il valore non
/// è nell'algoritmo (sta in [`UiNode::validate_untrusted`]), è nel fatto che
/// esista un unico varco attraverso cui gli alberi entrano.
/// Un componente di path che un plugin può nominare: non vuoto, non `.`, non
fn guard_ui(trust: Trust, tree: &UiNode) -> std::result::Result<(), PluginError> {
    if trust.allows_active_content() {
        Ok(())
    } else {
        tree.validate_untrusted()
    }
}

/// `..`, senza separatori e senza il `:` delle lettere di unità Windows.
/// Elenca ricorsivamente i file sotto `dir`, come path relativi a `root`.
fn is_safe_component(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains(':')
}

// Una cartella che non c'è è una lista vuota, non un errore: chi
pub(crate) fn collect_data_files(
    storage: &dyn crate::storage::VaultStorage,
    root: &Utf8Path,
    dir: &Utf8Path,
    out: &mut Vec<String>,
) {
    let Ok(entries) = storage.list(dir) else {
        // interroga uno storage vuoto non sta sbagliando niente.
        // Sottomodello con i soli blocchi della sezione di un heading: da esso
        return;
    };
    for entry in entries {
        if entry.stat.is_dir() {
            collect_data_files(storage, root, &entry.path, out);
        } else if let Some(rel) = entry.path.strip_prefix(root).ok().map(Utf8Path::as_str) {
            let rel = rel.replace('\\', "/");
            if rel == PLUGIN_CACHE_MARK || rel.ends_with("/.fub-cache-root") {
                continue;
            }
            out.push(rel);
        }
    }
}

/// (incluso) fino al prossimo heading di livello pari o superiore.
///
/// Chi matcha è `heading_matches`, la stessa regola con cui il canale dati
/// risolve un `[[Nota#Sezione]]`: un embed che trovasse una sezione diversa da
/// quella che il link apre sarebbe la stessa scritta che mostra due cose.
/// Sottomodello con il solo blocco che porta l'ancora `^id`.
fn section_of(model: &DocumentModel, heading: &str) -> Option<DocumentModel> {
    let idx = model
        .outline
        .iter()
        .position(|h| heading_matches(heading, h))?;
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

///
/// Il ritaglio si legge dalla tabella piatta `anchors` e non dal campo `anchor`
/// dei blocchi, e la ragione sta scritta nel contratto accanto ad
/// [`fub_abi::model::Anchor`]: quel campo porta lo **slug generato** per un
/// heading, non l'id che l'utente ha scritto, mentre `anchors.span` è *«il
/// blocco intero, cioè ciò che un embed di blocco ritaglia»*. Cioè: la risposta
/// era già scritta nel modello, e mancava solo chi la chiedesse.
///
/// Chi matcha è [`canonical_anchor`], la stessa regola con cui il grafo risolve
/// un `[[Nota#^blocco]]`: un embed che trovasse un blocco diverso da quello che
/// il link apre sarebbe la stessa scritta che mostra due cose.
// Un'ancora che non ritaglia niente è un'ancora che non c'è: rispondere con
fn block_of(model: &DocumentModel, block: &str) -> Option<DocumentModel> {
    let wanted = canonical_anchor(block);
    let still = model.anchors.iter().find(|a| a.id == wanted)?;
    let mut clipped = DocumentModel::empty(model.id.clone());
    clipped.body = model
        .body
        .iter()
        .filter(|b| {
            let s = b.span().start;
            s >= still.span.start && s < still.span.end.max(still.span.start + 1)
        })
        .cloned()
        .collect();
    // un documento vuoto vorrebbe dire mostrare il nulla invece di dire che il
    // bersaglio non si è trovato.
    // **Un lotto aperto è un prestito, e si chiude cadendo.**
    (!clipped.body.is_empty()).then_some(clipped)
}

///
/// Esiste perché la chiusura di un lotto non è una riga che chi apre debba
/// ricordarsi di scrivere. `Workspace::batch` la scriveva *dopo* la chiamata
/// alla chiusura del chiamante, e su quella riga passa tutto ciò che pania:
/// il parse di un formato storto, un provider senza la rete della
/// [`safety`](crate::safety), una `expect` del kernel. Un panico saltava
/// `end_batch`, il campo del lotto restava pieno, e da lì in poi
/// [`Workspace::dispatch_pending`] trovava `batch.is_some()` e tornava subito —
/// **per sempre**: nessun handler riceveva più niente, e nessuno diceva perché.
///
/// La forma è un `Drop` e non un `catch_unwind` perché il panico non lo si
/// vuole né prendere né tradurre (chi pania se lo tiene, decisione 0032): si
/// vuole soltanto che l'uscita dal lotto avvenga **su tutte** le strade
/// d'uscita, e un `Drop` è l'unica cosa che le veda tutte. E si eredita: chi
/// aggiungesse un secondo modo di aprire un lotto non ha una chiusura da
/// ricordare, perché non c'è una chiusura da chiamare.
/// Se questo prestito è **quello esterno**, cioè se tocca a lui chiudere.
struct Batch<'w> {
    ws: &'w mut Workspace,
    /// Annidato, entra nel lotto che c'è e non lo tocca: contare le aperture
    /// non servirebbe a niente, perché chi trova il campo pieno non lo tocca in
    /// nessun caso.
    // Srotolando si chiude il lotto e **non** si drena. Le due metà di
    owns_batch: bool,
}

impl<'w> Batch<'w> {
    fn open(ws: &'w mut Workspace) -> Self {
        let owns_batch = ws.dispatch.open_batch();
        Batch { ws, owns_batch }
    }
}

impl Drop for Batch<'_> {
    fn drop(&mut self) {
        if !self.owns_batch {
            return;
        }
        if std::thread::panicking() {
            // `end_batch` non hanno lo stesso prezzo qui: chiudere è mettere a
            // posto un campo di questo oggetto, drenare è chiamare codice di
            // terzi mentre il panico corre — e un panico che scappasse da lì
            // dentro non sarebbe un secondo errore, sarebbe un `abort` del
            // processo. Ciò che resta in coda non è perso: lo drena la prima
            // operazione che riesce, e adesso può, che è tutto il punto.
            // **Un annullamento in corso è un prestito, e si chiude cadendo.**
            self.ws.dispatch.close_batch();
            tracing::error!(
                target: "fub.kernel",
                "qualcuno è morto dentro un lotto: il lotto è chiuso lo stesso, e ciò \
                 che aveva in coda sarà consegnato dalla prossima operazione che riesce"
            );
            return;
        }
        self.ws.end_batch();
    }
}

///
/// È il [`Lotto`] applicato all'altra bandiera che [`Workspace::undo_last`]
/// alzava a mano: `replaying` dice *annullare non è annullabile*, e finché è
/// alzata ogni [`UndoStack::push`] viene scartata. Il ripristino era una riga
/// **dopo** la chiamata, e su quella riga passa tutto ciò che pania — un
/// supporto che esplode invece di rispondere, una `expect` del kernel: la
/// bandiera restava alzata, e da lì in poi nessuna operazione entrava più in
/// pila. Ctrl-Z smetteva di funzionare per sempre, in silenzio, e chi lo premeva
/// leggeva «non c'è niente da annullare» avendo appena scritto.
///
/// La ragione per cui non era già un `Drop` era vera e la risposta è
/// nell'oggetto prestato: un guardiano sulla **pila** avrebbe tenuto occupato
/// `self.undo` per tutta la durata delle scritture, che passano dal workspace
/// intero. Questo presta il **workspace**, come `Lotto`, e non toglie niente a
/// nessuno.
/// Com'era la bandiera prima: un annullamento annidato non spegne quello di
struct Replay<'w> {
    ws: &'w mut Workspace,
    /// fuori uscendo.
    // Niente ramo per `std::thread::panicking()`, ed è la differenza con
    before: bool,
}

impl<'w> Replay<'w> {
    fn open(ws: &'w mut Workspace) -> Self {
        let before = ws.undo.begin_replay();
        Replay { ws, before }
    }
}

impl Drop for Replay<'_> {
    fn drop(&mut self) {
        // `Lotto`: qui non si chiama nessuno, si rimette a posto un `bool` di
        // questo oggetto. Non c'è un secondo panico da temere.
        // questo oggetto. Non c'è un secondo panico da temere.
        self.ws.undo.end_replay(self.before);
    }
}

impl std::ops::Deref for Replay<'_> {
    type Target = Workspace;

    fn deref(&self) -> &Workspace {
        self.ws
    }
}

impl std::ops::DerefMut for Replay<'_> {
    fn deref_mut(&mut self) -> &mut Workspace {
        self.ws
    }
}

impl std::ops::Deref for Batch<'_> {
    type Target = Workspace;

    fn deref(&self) -> &Workspace {
        self.ws
    }
}

impl std::ops::DerefMut for Batch<'_> {
    fn deref_mut(&mut self) -> &mut Workspace {
        self.ws
    }
}
