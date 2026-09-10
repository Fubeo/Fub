Warning: truncated output (original token count: 110751)
Total output lines: 9587

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

mod registration;
pub use registration::{
    PreparedIndexRegistration, PreparedPluginDeactivation, PreparedRegistration, RegistrationPermit,
};
mod lifecycle;
pub use lifecycle::{PreparedIndexFlush, PreparedPluginTeardown, RetiredPlugin};
mod removal;
pub use removal::{
    CompletedDocumentDeletion, CompletedDocumentRemoval, PreparedDocumentDeletion,
    PreparedDocumentRemoval,
};
mod restore;
pub use restore::{CompletedDocumentRestore, PendingDocumentRestore, PreparedDocumentRestore};

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
use fub_abi::query::{Matches, QueryEvaluator, QueryPredicate};
use fub_abi::session::ViewContext;
use fub_abi::settings::{
    SettingEntry, SettingKind, SettingScope, SettingSource, SettingSpec, SettingValue,
};
use fub_abi::text::{Localize, Strings, Text};
use fub_abi::traits::{
    BacklinkRef, CivilTime, CommandProvider, DocPosition, DocumentMatch, EntryKind, EventHandler,
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, IndexingState, JobId, JobProgress,
    JobSpec, LinkDirection, Page, Paged, PluginManifest, PropertySelect, PropertySort, QueryRoute,
    ReadApi, ServiceProvider, TimerSpec, VaultEntry, ViewInstance, ViewInterests, ViewProvider,
    ViewSpec,
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
use crate::error::{KernelError, Missing, Result};
use crate::graph::{BuiltGraph, GraphSources};
use crate::host::{Granted, Guard, KernelHost, ReadHost, ReadOnly};
use crate::index::plan::{QueryCore, QueryPlan};
use crate::index::{
    feed_handles as feed_index_handles, reconcile_handles as reconcile_index_handles,
    release_handles as release_index_handles, up_to_date_handles as up_to_date_index_handles,
    CompletedIndexQuery, Indexes, PreparedIndexQuery, SharedIndexProvider,
};
use crate::journal::{Journal, JournalOp, JournalRead};
use crate::locale::SystemLocale;
use crate::occurrences;
use crate::organization::OrganizationStore;
use crate::plugins::{self, PluginInfo, RegistrationKind, RegistryError};
use crate::poison::{SharedShelter, Shelter};
use crate::providers::{ProviderRegistry, ProviderTable, RegisteredCommand, RegisteredView};
use crate::registry::FormatRegistry;
use crate::renderer::RenderedDocument;
use crate::safety::Gate;
use crate::session::{ContextChange, Session};
use crate::settings::{MachineSettings, SettingsStore, SharedSettings};
use crate::transfer::{MemorySink, OpenSources, SourceBacking, PROLOGUE};
use crate::undo::UndoStack;
use crate::vault::TrashEntry;
use crate::viewstate::ViewStates;

/// Identità process-local di un'istanza `Workspace`.
///
/// Non è una versione persistita e non attraversa alcun confine: distingue due
/// workspace costruiti sulla stessa radice, così un token preparato da quello
/// ritirato non può finalizzare il suo sostituto.
static NEXT_WORKSPACE_ID: AtomicU64 = AtomicU64::new(1);

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

/// Receipt for the exact machine-setting write that materialized default deny.
/// It can only undo that write while it is still the latest write to the key.
pub struct PermissionInitialization(crate::settings::MachineSettingRevision);

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
    generation: Arc<()>,
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
    generation: Arc<()>,
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

/// Una proiezione locale risolta fino al confine dei provider. Sorgente,
/// parser, regole e renderer sono valori posseduti: nessuno porta con sé una
/// guardia del workspace.
pub struct PreparedLocalProjection {
    id: DocId,
    resolved_page: Option<String>,
    source_revision: Revision,
    source: DocumentSource,
    parser: PreparedParse,
    renderers: crate::renderer::RendererRegistry,
    kind: LocalProjectionKind,
    routing_generation: u64,
    projection_generation: u64,
}

/// Lettura del modello risolta fino al confine del parser. La sorgente, il
/// provider e le regole sono posseduti: `invoke` non prende in prestito il
/// workspace e può quindi attraversare il codice esterno senza la sua guardia.
pub struct PreparedDocumentModel {
    id: DocId,
    source_revision: Revision,
    source: DocumentSource,
    parser: PreparedParse,
    syntax_generation: u64,
}

/// Modello prodotto fuori dal workspace, ancora da confrontare con la
/// sorgente e la pipeline correnti.
pub struct CompletedDocumentModel {
    id: DocId,
    source_revision: Revision,
    model: DocumentModel,
    syntax_generation: u64,
}

enum LocalProjectionKind {
    Preview,
    Embed {
        heading: Option<String>,
        block: Option<String>,
    },
}

/// Il risultato esterno di una proiezione, ancora da validare contro lo stato
/// corrente del workspace.
pub struct CompletedLocalProjection {
    id: DocId,
    resolved_page: Option<String>,
    source_revision: Revision,
    result: IndexResult,
    routing_generation: u64,
    projection_generation: u64,
}

impl PreparedLocalProjection {
    /// Attraversa `FormatProvider::parse`, le `SyntaxRule`,
    /// `FormatProvider::render_html` e i `CustomRenderer`. Il chiamante deve
    /// aver già rilasciato ogni guardia di `Custody<Workspace>`.
    pub fn invoke(self) -> std::result::Result<CompletedLocalProjection, PluginError> {
        let PreparedLocalProjection {
            id,
            resolved_page,
            source_revision,
            source,
            parser,
            renderers,
            kind,
            routing_generation,
            projection_generation,
        } = self;
        let model = parser.invoke(source).map_err(PluginError::from)?;
        let (model, result_kind) = match kind {
            LocalProjectionKind::Preview => (model, None),
            LocalProjectionKind::Embed { block, heading } => {
                let clipped = match (block.as_deref(), heading.as_deref()) {
                    (Some(block), _) => block_of(&model, block)
                        .ok_or_else(|| PluginError::NotFound(format!("{id}#^{block}").into()))?,
                    (None, Some(heading)) => section_of(&model, heading)
                        .ok_or_else(|| PluginError::NotFound(format!("{id}#{heading}").into()))?,
                    (None, None) => model,
                };
                (clipped, Some(id.0.clone()))
            }
        };
        let rendered = parser
            .render(&model, &renderers, &RenderOptions::preview())
            .map_err(PluginError::from)?;
        let result = match result_kind {
            None => IndexResult::RenderPreview(rendered.into()),
            Some(doc_id) => IndexResult::RenderEmbed(EmbedContent {
                doc_id,
                content: rendered.into(),
            }),
        };
        Ok(CompletedLocalProjection {
            id,
            resolved_page,
            source_revision,
            result,
            routing_generation,
            projection_generation,
        })
    }
}

impl PreparedDocumentModel {
    /// Esegue `FormatProvider::parse` e le `SyntaxRule` sulla fotografia
    /// preparata. Il chiamante deve avere già rilasciato qualunque guardia di
    /// `Custody<Workspace>`.
    pub fn invoke(self) -> std::result::Result<CompletedDocumentModel, PluginError> {
        let PreparedDocumentModel {
            id,
            source_revision,
            source,
            parser,
            syntax_generation,
        } = self;
        let model = parser.invoke(source).map_err(PluginError::from)?;
        Ok(CompletedDocumentModel {
            id,
            source_revision,
            model,
            syntax_generation,
        })
    }
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
    folders: Vec<String>,
    entries: Vec<VaultEntry>,
    documents: Vec<VaultEntry>,
    known_entries: Vec<Option<StoredEntry>>,
    assets: Vec<VaultEntry>,
    up_to_date: BTreeSet<DocId>,
}

impl PreparedVaultScan {
    /// Esegue soltanto `IndexProvider::up_to_date`, sugli handle staccati.
    pub fn invoke(self) -> CompletedVaultScan {
        let PreparedVaultScan {
            folders,
            entries,
            documents,
            known_entries,
            assets,
            providers,
        } = self;
        let mut up_to_date = up_to_date_index_handles(&providers, &documents);
        if release_index_handles(providers).is_err() {
            up_to_date.clear();
        }
        CompletedVaultScan {
            folders,
            entries,
            documents,
            known_entries,
            assets,
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
        let PreparedIndexBatchCheck {
            seen,
            entries,
            discarded,
            providers,
        } = self;
        let documents: Vec<VaultEntry> = entries
            .iter()
            .filter(|pending| pending.entry.kind == EntryKind::Document)
            .map(|pending| pending.entry.clone())
            .collect();
        let mut already = up_to_date_index_handles(&providers, &documents);
        if release_index_handles(providers).is_err() {
            already.clear();
        }
        CheckedIndexBatch {
            seen,
            entries,
            discarded,
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
    work: Indexing,
    graph: BuiltGraph,
    external_losses: Vec<IndexLoss>,
}

impl PreparedIndexFinish {
    pub fn invoke(self) -> CompletedIndexFinish {
        let PreparedIndexFinish {
            work,
            graph,
            ids,
            providers,
        } = self;
        let mut external_losses = if work.finished() {
            reconcile_index_handles(&providers, &ids)
        } else {
            Vec::new()
        };
        if let Err(error) = release_index_handles(providers) {
            if let Some(id) = ids.into_iter().next() {
                external_losses.push(IndexLoss::new(id, error));
            }
        }
        CompletedIndexFinish {
            work,
            graph,
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
        let providers = std::mem::take(&mut self.providers);
        self.losses
            .extend(feed_index_handles(&providers, &self.models));
        if let Err(error) = release_index_handles(providers) {
            self.losses.extend(
                self.models
                    .iter()
                    .map(|model| IndexLoss::new(model.id.clone(), error.clone())),
            );
        }
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

/// Un epilogo che ha già chiuso il frame dell'operazione ma deve ancora
/// consegnare gli eventi fuori da `Custody<Workspace>`.
///
/// Il valore resta opaco all'host: il kernel conserva qui anche lo stato che
/// va ripristinato *dopo* il drain (l'attore di un comando) e il journal che,
/// per una scrittura, deve restare nell'ordine storico
/// `indici -> eventi -> journal`.
pub struct DeferredEvents<T> {
    outcome: T,
    previous_actor: Option<Actor>,
    journal: Option<JournalOp>,
}

/// Diritto monouso a completare una chiusura già annunciata.
///
/// [`Workspace::prepare_close`] alza la generazione terminale del workspace
/// (`closed`) e accoda `VaultClosed`; da quel momento nessun'altra prepare può
/// riuscire. Il token non è clonabile e i suoi campi sono privati: l'host lo
/// conserva mentre drena l'evento fuori da `Custody<Workspace>`, quindi lo
/// riconsegna una volta sola a [`Workspace::finish_close_with`]. Un nonce
/// process-local impedisce che venga accettato da un'altra istanza aperta sulla
/// stessa radice.
#[derive(Debug)]
pub struct PreparedClose {
    root: String,
    workspace_id: u64,
}

impl<T> DeferredEvents<T> {
    fn outcome(outcome: T) -> Self {
        Self {
            outcome,
            previous_actor: None,
            journal: None,
        }
    }
}

/// Token opaco usato dal proxy dei job per rimandare il dispatch finché il
/// suo write guard non è stato rilasciato.
pub struct EventDispatchDeferral {
    previous_dispatch_deferral: bool,
}

/// Cursore di un drenaggio eventi eseguito dall'host fuori dal lock.
///
/// Il budget appartiene all'intero drenaggio, non a una singola callback: una
/// cascata rientrante conserva quindi lo stesso limite del percorso diretto di
/// [`Workspace`].
pub struct EventDrain {
    budget: usize,
    active: bool,
    lent: bool,
    done: bool,
}

impl EventDrain {
    pub fn new() -> Self {
        Self {
            budget: Dispatcher::budget(),
            active: false,
            lent: false,
            done: false,
        }
    }
}

impl Default for EventDrain {
    fn default() -> Self {
        Self::new()
    }
}

/// Una consegna preparata sotto il write guard e invocabile senza alcun
/// prestito di `Custody<Workspace>`.
pub struct PreparedEventDelivery {
    notice: Notice,
    handlers: Vec<(String, Box<dyn EventHandler>)>,
    previous_provider_call: bool,
}

/// La parte che deve rientrare nel workspace anche quando uno o più handler
/// hanno risposto con errore o sono andati in panico.
pub struct CompletedEventDelivery {
    notice: Notice,
    handlers: Vec<(String, Box<dyn EventHandler>)>,
    previous_provider_call: bool,
    troubles: Vec<(String, PluginError)>,
}

impl PreparedEventDelivery {
    /// Esegue `subscribed` e `handle` fuori dal workspace. La closure presta
    /// l'host stretto del singolo plugin e viene chiamata soltanto dopo che il
    /// chiamante ha rilasciato il write guard.
    pub fn invoke(
        mut self,
        mut with_host: impl FnMut(
            &str,
            &mut dyn FnMut(&mut dyn HostApi),
        ) -> std::result::Result<(), PluginError>,
    ) -> CompletedEventDelivery {
        let mut troubles = Vec::new();
        for (id, handler) in &mut self.handlers {
            let subscribed = crate::safety::calling(id, Gate::Event, "", || {
                Ok::<_, PluginError>(handler.subscribed())
            });
            let mask = match subscribed {
                Ok(mask) => mask,
                Err(error) => {
                    troubles.push((id.clone(), error));
                    continue;
                }
            };
            if !mask.wants(&self.notice.event) {
                continue;
            }

            let mut outcome = None;
            let mut invoke = |host: &mut dyn HostApi| {
                outcome = Some(crate::safety::calling(id, Gate::Event, "", || {
                    handler.handle(&self.notice, host)
                }));
            };
            if let Err(error) = with_host(id, &mut invoke) {
                troubles.push((id.clone(), error));
                continue;
            }
            match outcome {
                Some(Ok(())) => {}
                Some(Err(error)) => troubles.push((id.clone(), error)),
                None => troubles.push((
                    id.clone(),
                    PluginError::Internal(
                        "l'host non ha invocato la consegna evento preparata".into(),
                    ),
                )),
            }
        }

        CompletedEventDelivery {
            notice: self.notice,
            handlers: self.handlers,
            previous_provider_call: self.previous_provider_call,
            troubles,
        }
    }
}

impl PreparedDocumentFeed {
    pub fn invoke_indexes(mut self) -> Self {
        let providers = std::mem::take(&mut self.providers);
        self.losses.extend(feed_index_handles(
            &providers,
            std::slice::from_ref(&self.model),
        ));
        if let Err(error) = release_index_handles(providers) {
            self.losses
                .push(IndexLoss::new(self.model.id.clone(), error));
        }
        self
    }
}

impl PreparedDocumentWrite {
    /// Esegue `FormatProvider::parse` e tutte le `SyntaxRule`, e nient'altro.
    pub fn parse(&self, source: &str) -> Result<DocumentModel> {
        self.parser.invoke(DocumentSource::Text(source.to_string()))
    }

    /// Il sorgente verificato da `WriteBase::DescendsFrom`.
    ///
    /// Serve al percorso host dell'edit: gli span vengono applicati e il
    /// provider di formato viene chiamato dopo aver rilasciato il workspace.
    pub fn expected_source(&self) -> Option<&str> {
        self.expected_source.as_deref()
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
    /// Nonce process-local che lega i token opachi a questa istanza precisa.
    workspace_id: u64,
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
    /// Cambia quando regole sintattiche o renderer rendono obsoleta una
    /// fotografia della pipeline di proiezione. È distinta dai token delle
    /// view: quei token versionano il proprietario di una callback, questa
    /// versione il contenuto della pipeline documentale.
    projection_generation: u64,
    /// Versiona la sola parte della pipeline che costruisce un modello. Un
    /// renderer nuovo invalida una resa in volo, ma è compatibile con un parse
    /// che non lo consulta.
    syntax_generation: u64,
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
            workspace_id: NEXT_WORKSPACE_ID.fetch_add(1, Ordering::Relaxed),
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
            projection_generation: 0,
            syntax_generation: 0,
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
        let permit = self.registration_permit(&plugin)?;
        let provides = self.registration_services(&permit)?;
        let mut prepared = PreparedRegistration::service(provides, provider);
        self.commit_registration(&permit, &mut prepared)
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

    /// Chiude flag e stack senza consegnare eventi. L'host usa questa forma per
    /// rilasciare `Custody<Workspace>` prima degli [`EventHandler`].
    pub fn finish_service_call_deferred(
        &mut self,
        prepared: PreparedService,
        outcome: std::result::Result<serde_json::Value, PluginError>,
    ) -> DeferredEvents<std::result::Result<serde_json::Value, PluginError>> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let popped = self.providers.service_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.service.as_str()));
        DeferredEvents::outcome(outcome)
    }

    /// Chiude il frame aperto da [`prepare_service_call`](Self::prepare_service_call)
    /// nello stesso ordine del vecchio percorso sincrono: flag, stack, dispatch.
    pub fn finish_service_call(
        &mut self,
        prepared: PreparedService,
        outcome: std::result::Result<serde_json::Value, PluginError>,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        let deferred = self.finish_service_call_deferred(prepared, outcome);
        self.dispatch_pending();
        self.finish_deferred_events(deferred)
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
    // Percorso sincrono legacy: chi arriva a close ha già ricevuto il flush.
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

        let mut prepared = self.prepare_plugin_teardown(plugin)?;
        self.take_plugin_teardown_indexes(&mut prepared)
            .map_err(RegistryError::Activate)?;
        let errors = {
            let mut host = self.host_for(plugin, InvokeMode::Apply);
            prepared.invoke_indexes(&mut host)
        };
        let outcome = self
            .finish_plugin_teardown(prepared, errors)
            .map(RetiredPlugin::dispose)
            .map_err(|(_, error)| RegistryError::Activate(error));
        self.dispatch_pending();
        outcome
    }

    /// Ritira soltanto registrazioni e dichiarazione, dopo le callback.
    fn retire_plugin(
        &mut self,
        plugin: &str,
        removed_indexes: bool,
    ) -> lifecycle::RetiredResources {
        let mut retired = lifecycle::RetiredResources::default();
        retired.take("event handler", &mut self.providers.handlers, |(id, _)| {
            id == plugin
        });
        retired.take("view", &mut self.providers.views, |v| v.id == plugin);
        retired.take("command", &mut self.providers.commands, |c| c.id == plugin);
        retired.take("service", &mut self.providers.services, |(id, _)| {
            id == plugin
        });
        retired.take("import", &mut self.providers.imports, |(id, _)| {
            id == plugin
        });
        retired.take("export", &mut self.providers.exports, |(id, _)| {
            id == plugin
        });
        if self
            .before_write
            .as_ref()
            .is_some_and(|(owner, _)| owner == plugin)
        {
            retired.push("before-write hook", self.before_write.take());
        }

        // Regole sintattiche e renderer hanno registri propri che conoscono
        // l'id della regola, non quello dell'owner. L'inventario conserva
        // l'associazione e fornisce i nomi da ritirare.
        let mut syntax_changed = false;
        for id in self
            .providers
            .plugins
            .ids_of(plugin, RegistrationKind::Syntax)
        {
            if let Some(rule) = self.docs.syntax.take(&id) {
                syntax_changed = true;
                retired.push("syntax rule", rule);
            }
        }
        let mut renderer_changed = false;
        for id in self
            .providers
            .plugins
            .ids_of(plugin, RegistrationKind::Renderer)
        {
            if let Some(renderer) = self.docs.renderers.take(&id) {
                renderer_changed = true;
                retired.push("custom renderer", renderer);
            }
        }
        if syntax_changed {
            self.syntax_generation = self.syntax_generation.wrapping_add(1);
        }
        if syntax_changed || renderer_changed {
            self.projection_generation = self.projection_generation.wrapping_add(1);
        }

        self.providers.plugins.retire(plugin);
        // Lo schema delle impostazioni se ne va con l'owner: le sue chiavi non
        // sono più accessibili, ma i valori restano per la prossima attivazione.
        self.settings
            .write()
            .expect("store di configurazione")
            .withdraw(plugin);

        // I job ancora accodati non partiranno: il loro Plugin::run_job non
        // esiste più. Ognuno riceve comunque un esito terminale (§9.2).
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

        // Le query degli indici sono cambiate: il kernel annuncia il ritiro
        // ai consumer, dopo la restituzione dalle callback (decisione 0012).
        if removed_indexes {
            self.as_actor(Actor::Kernel, |ws| {
                ws.emit_event(Event::IndexUpdated);
                ws.dispatch_pending();
            });
        }
        retired
    }

    /// Chiude il vault: punto di consistenza globale, poi teardown (§9.5).
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

    /// Annuncia una chiusura senza chiamare alcun provider.
    ///
    /// `closed` è la versione che invalida un secondo tentativo: una volta
    /// prodotto il token, lo stesso workspace non può essere preparato di
    /// nuovo. Le scritture compiute da un handler di `VaultClosed` sono invece
    /// compatibili e intenzionali: chi monta dietro `Custody` conserva il
    /// writer turn, drena gli handler senza guardie e le include nel flush che
    /// segue. La sostituzione concorrente di un provider non può attraversare
    /// quel turno; il token, monouso, impedisce la doppia finalizzazione.
    pub fn prepare_close(&mut self) -> Option<PreparedClose> {
        if self.closed {
            return None;
        }
        self.closed = true;

        let root = self.docs.vault.root().to_string();
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::VaultClosed { root: root.clone() });
        });
        Some(PreparedClose {
            root,
            workspace_id: self.workspace_id,
        })
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
        stopping: impl FnMut(&mut Workspace, &str) -> Vec<PluginError>,
    ) -> Vec<PluginError> {
        let Some(prepared) = self.prepare_close() else {
            return Vec::new();
        };
        self.dispatch_pending();
        match self.finish_close_with(prepared, stopping) {
            Ok(errors) => errors,
            Err((_prepared, error)) => vec![error],
        }
    }

    /// Completa una chiusura preparata dopo che `VaultClosed` è stato drenato.
    ///
    /// Il metodo non riemette il terminale e consuma il token. L'identità
    /// process-local valida il token anche se due istanze hanno la **stessa**
    /// radice; un mismatch restituisce token ed errore senza toccare il
    /// workspace, così il chiamante può riconsegnarlo al proprietario giusto.
    /// Nel percorso host il writer turn tenuto fra prepare e finalize esclude
    /// inoltre qualsiasi writer concorrente.
    ///
    /// Questo confine riguarda soltanto gli `EventHandler` del terminale:
    /// `flush_indexes`, `IndexProvider::close`, `stopping` e la disattivazione
    /// restano il seguito sincrono preesistente e richiedono ciascuno la
    /// propria migrazione prima che l'intera lifecycle possa dirsi staccata.
    pub fn finish_close_with(
        &mut self,
        prepared: PreparedClose,
        mut stopping: impl FnMut(&mut Workspace, &str) -> Vec<PluginError>,
    ) -> std::result::Result<Vec<PluginError>, (PreparedClose, PluginError)> {
        if prepared.workspace_id != self.workspace_id || !self.closed {
            let error = PluginError::Conflict(
                format!(
                    "close prepared by workspace {} on `{}` cannot finalize workspace {} on `{}`",
                    prepared.workspace_id,
                    prepared.root,
                    self.workspace_id,
                    self.docs.vault.root()
                )
                .into(),
            );
            return Err((prepared, error));
        }

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

        // l'ultimo momento in cui qualcuno sa che sta chiudendo (§9.5)…60751 tokens truncated…        replay: None,
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
        let mut prepared = PreparedRegistration::import(p);
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
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
        let mut prepared = PreparedRegistration::export(p).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
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

    /// Accoda un guasto prodotto dal composition root dell'host.
    ///
    /// Il watcher non è un plugin e non deve attraversare un [`HostApi`]
    /// intestato a un id fittizio: la guardia delle capacità filtrerebbe
    /// correttamente quell'emissione. L'host chiama questa porta dentro il
    /// proprio `with_event_drain`; qui si attribuisce il fatto al kernel e si
    /// accoda soltanto il notice, così gli handler verranno invocati dopo che
    /// il composition root avrà rilasciato la guardia del workspace.
    pub fn report_host_trouble(&mut self, severity: Severity, error: PluginError) {
        self.as_actor(Actor::Kernel, |ws| {
            ws.report_trouble(severity, None, error, None)
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

    /// Rimanda il dispatch avviato da una capacità del proxy host. Il token va
    /// sempre restituito a [`restore_event_dispatch`](Self::restore_event_dispatch)
    /// prima di rilasciare il guard.
    pub fn defer_event_dispatch(&mut self) -> EventDispatchDeferral {
        EventDispatchDeferral {
            previous_dispatch_deferral: self.dispatch.defer_dispatch(),
        }
    }

    /// Ripristina il frame aperto da [`defer_event_dispatch`](Self::defer_event_dispatch).
    pub fn restore_event_dispatch(&mut self, deferred: EventDispatchDeferral) {
        self.dispatch
            .restore_dispatch(deferred.previous_dispatch_deferral);
    }

    /// Completa un epilogo dopo che l'host ha drenato gli eventi. Non chiama
    /// codice esterno.
    pub fn finish_deferred_events<T>(&mut self, deferred: DeferredEvents<T>) -> T {
        if let Some(journal) = deferred.journal {
            self.record(journal);
        }
        if let Some(previous_actor) = deferred.previous_actor {
            self.dispatch.restore_actor(previous_actor);
        }
        deferred.outcome
    }

    /// Prepara una sola consegna del drenaggio `drain` senza eseguire callback.
    ///
    /// Dopo `Some`, chi chiama deve rilasciare il guard, invocare
    /// [`PreparedEventDelivery::invoke`] e riconsegnare sempre il risultato a
    /// [`finish_event_delivery`](Self::finish_event_delivery). `None` chiude
    /// il drenaggio (o dice che, per le regole consuete, va rimandato).
    pub fn prepare_event_delivery(
        &mut self,
        drain: &mut EventDrain,
    ) -> Option<PreparedEventDelivery> {
        if drain.done {
            return None;
        }
        debug_assert!(
            !drain.lent,
            "una consegna va finalizzata prima di prepararne un'altra"
        );
        if !drain.active {
            if !self
                .dispatch
                .begin_drain(!self.providers.handlers.is_empty())
            {
                drain.done = true;
                return None;
            }
            drain.active = true;
        }

        let Some(notice) = self.dispatch.next_to_deliver(&mut drain.budget) else {
            self.dispatch.end_drain();
            drain.active = false;
            drain.done = true;
            return None;
        };
        let handlers = self.providers.handlers.take();
        let previous_provider_call = self.dispatch.enter_provider_call();
        drain.lent = true;
        Some(PreparedEventDelivery {
            notice,
            handlers,
            previous_provider_call,
        })
    }

    /// Ripristina tabella e flag della consegna, quindi trasforma gli errori
    /// raccolti nei `Trouble` previsti dal contratto. Gira anche sul ramo
    /// errore/panico, perché entrambi sono già valori nel completamento.
    pub fn finish_event_delivery(
        &mut self,
        drain: &mut EventDrain,
        completed: CompletedEventDelivery,
    ) {
        let CompletedEventDelivery {
            notice,
            handlers,
            previous_provider_call,
            troubles,
        } = completed;
        self.dispatch.restore_provider_call(previous_provider_call);
        self.providers.handlers.restore(handlers);
        drain.lent = false;
        self.report_handler_troubles(&notice, troubles);
    }

    /// Attribuisce le capacità rientranti al plugin che sta ricevendo
    /// l'evento. Il token va sempre riconsegnato a
    /// [`finish_event_handler`](Self::finish_event_handler).
    pub fn prepare_event_handler(&mut self, plugin: &str) -> Actor {
        self.dispatch.swap_actor(Actor::Plugin {
            id: plugin.to_string(),
        })
    }

    /// Ripristina l'attore installato da [`prepare_event_handler`](Self::prepare_event_handler).
    pub fn finish_event_handler(&mut self, previous: Actor) {
        self.dispatch.restore_actor(previous);
    }

    /// Drena la coda eventi verso gli handler. Mai rientrante: chiamato
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
                    let subscribed = crate::safety::calling(id, Gate::Event, "", || {
                        Ok::<_, PluginError>(handler.subscribed())
                    });
                    let mask = match subscribed {
                        Ok(mask) => mask,
                        Err(error) => {
                            troubles.push((id.clone(), error));
                            continue;
                        }
                    };
                    if !mask.wants(&notice.event) {
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
                        crate::safety::calling(id, Gate::Event, "", || {
                            handler.handle(notice, &mut host)
                        })
                        .err()
                    });
                    troubles.extend(fault.map(|and| (id.clone(), and)));
                }
                troubles
            },
        );
        self.report_handler_troubles(notice, troubles);
    }

    fn report_handler_troubles(&mut self, notice: &Notice, troubles: Vec<(String, PluginError)>) {
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

    /// Writes a machine-scoped permission denial only while no machine choice
    /// exists, returning the exact write receipt needed by rollback.
    pub fn initialize_permission_denial(
        &mut self,
        key: &str,
    ) -> std::result::Result<Option<PermissionInitialization>, PluginError> {
        if fub_abi::settings::permission_of_key(key).is_none() {
            return Err(PluginError::BadArgs(
                format!("`{key}` is not a permission setting").into(),
            ));
        }
        let receipt = self
            .settings
            .read()
            .expect("store di configurazione")
            .initialize_machine_default_tracked(key, SettingValue::Toggle(false))?;
        if receipt.is_some() {
            self.announce_setting(key, SettingScope::Machine);
        }
        Ok(receipt.map(PermissionInitialization))
    }

    /// Undoes only the exact default-deny write represented by `receipt`.
    /// A later write, including an ABA write back to `false`, is preserved.
    pub fn rollback_permission_denial(
        &mut self,
        receipt: &PermissionInitialization,
    ) -> std::result::Result<bool, PluginError> {
        let reset = self
            .settings
            .read()
            .expect("store di configurazione")
            .rollback_machine_if_current(&receipt.0)?;
        if reset {
            self.announce_setting(receipt.0.key(), SettingScope::Machine);
        }
        Ok(reset)
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
impl QueryCore for Workspace {
    fn query_core(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        self.indexes.core.query(query)
    }

    fn core_documents(&self) -> std::result::Result<Vec<DocId>, PluginError> {
        Ok(self.indexes.core.documents())
    }

    fn core_predicate(
        &self,
        predicate: &QueryPredicate,
    ) -> std::result::Result<Matches, PluginError> {
        self.indexes.core.predicate(predicate)
    }

    fn finish_core_documents(
        &self,
        matches: Matches,
        sort: Option<&PropertySort>,
        select: &PropertySelect,
        page: Option<Page>,
    ) -> std::result::Result<Paged<DocumentMatch>, PluginError> {
        Ok(self
            .indexes
            .core
            .finish_documents(matches, sort, select, page))
    }
}

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
