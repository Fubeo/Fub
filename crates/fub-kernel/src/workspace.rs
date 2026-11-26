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
    PreparedGridBytesCall, PreparedIndexRegistration, PreparedPluginDeactivation,
    PreparedRegistration, RegistrationPermit,
};
mod lifecycle;
pub use lifecycle::{
    PluginTeardownFailure, PreparedIndexFlush, PreparedPluginTeardown, RetiredPlugin,
};
mod removal;
pub use removal::{
    CommittedDocumentDeletion, CompletedDocumentDeletion, CompletedDocumentRemoval,
    FinalizedDocumentDeletion, PreparedDocumentDeletion, PreparedDocumentRemoval,
};
mod reads_in_flight;
use reads_in_flight::ReadInFlight;
pub use reads_in_flight::{Barred, ReadsInFlight};
mod restore;
pub use restore::{CompletedDocumentRestore, PendingDocumentRestore, PreparedDocumentRestore};
mod commands;
pub use commands::*;
mod events;
pub use events::*;
mod hosts;
mod housekeeping;
pub use housekeeping::*;
mod import_export;
pub use import_export::*;
mod index_batch;
pub use index_batch::*;
mod indexing;
pub use indexing::*;
mod models;
pub use models::*;
mod notes;
mod plugin_calls;
pub use plugin_calls::*;
mod queries;
pub use queries::*;
mod rename;
mod rename_plans;
pub use rename_plans::*;
mod resources;
pub use resources::*;
mod settings_api;
pub use settings_api::*;
mod sync;
mod sync_plans;
pub use sync_plans::*;
mod views;
pub use views::*;
mod writes;
pub use writes::*;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandSpec, Failure, InvokeMode, Partial, UndoStep, Undone,
};
use fub_abi::custom::{CustomRenderer, SyntaxForm, SyntaxRule};
use fub_abi::error::FormatError;
use fub_abi::event::DocChanges;
use fub_abi::format::{
    DocumentFormat, DocumentSource, FormatProvider, LinkRewrite, ParseContext, RenderOptions,
    RenderTarget, SourceKind,
};
use fub_abi::locale::Locale;
use fub_abi::model::{canonical_anchor, heading_matches, DocId, DocumentModel, LinkTarget};
use fub_abi::query::{Matches, QueryEvaluator, QueryPredicate};
use fub_abi::session::ViewContext;
use fub_abi::settings::{
    SettingEntry, SettingKind, SettingScope, SettingSource, SettingSpec, SettingValue,
};
use fub_abi::text::{Arg, Localize, Strings, Text};
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
use fub_abi::{
    Actor, EditReport, EditRequest, Event, Notice, PluginError, Revision, Severity, TextEdit,
    WriteBase,
};
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
    withdraw_handles as withdraw_index_handles, CompletedIndexQuery, Indexes, PreparedIndexQuery,
    SharedIndexProvider,
};
use crate::journal::{Journal, JournalOp, JournalRead};
use crate::locale::SystemLocale;
use crate::occurrences;
use crate::organization::OrganizationStore;
use crate::plugins::{self, PluginInfo, RegistrationKind, RegistryError};
use crate::poison::{SharedShelter, Shelter};
use crate::providers::{
    ProviderRegistry, ProviderTable, RegisteredCommand, RegisteredGrid, RegisteredView,
};
use crate::registry::FormatRegistry;
use crate::rename_recovery::{self, RenameRecoveryEdit, RenameRecoveryReceipt, RenameRecoveryScan};
use crate::renderer::RenderedDocument;
use crate::safety::Gate;
use crate::same_content::{LearnedFingerprints, SameContentOutcome};
use crate::session::{ContextChange, Session};
use crate::settings::{MachineSettings, SettingsStore, SharedSettings};
use crate::transfer::{
    FileWitness, MemorySink, OpenSources, ResourceLease, SourceBacking, PROLOGUE,
};
use crate::undo::UndoStack;
use crate::vault::{PreparedIgnoreCheck, PreparedTrashSweep, TrashEntry};
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
    /// [`Gate::FormatParse`] quando a dire di no è stato il provider del
    /// formato (un parse fallito, una sorgente che non è la sua), `None`
    /// quando il file non si è nemmeno letto.
    ///
    /// È la porta che il guasto porta con sé verso chi lo mostra: il messaggio
    /// di un [`FormatError`] è la prosa del codec, in inglese e per chi
    /// sviluppa, e chi disegna lo sostituisce con la sua frase («questo
    /// documento non si apre») solo se sa che il guasto è entrato da lì
    /// (IMP-117). Il provider era davvero in mezzo, che è il criterio con cui
    /// [`Event::Trouble`] dice una porta.
    pub gate: Option<Gate>,
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

    fn discards(&mut self, id: DocId, why: KernelError) {
        self.index.insert(id.clone());
        let gate = matches!(why, KernelError::Format(_)).then_some(Gate::FormatParse);
        self.discarded.push(Rejected {
            id,
            why: why.into(),
            gate,
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
    pub fn opening(&self) -> &Opening {
        &self.opening
    }

    /// Fino a [`FEED_BATCH`] voci, e fino a
    /// [`MAX_DOCUMENT_SOURCE_BYTES`](crate::documents::MAX_DOCUMENT_SOURCE_BYTES)
    /// di documenti: una fetta tiene in memoria tutte le sorgenti che legge e
    /// tutti i modelli che parsa finché non si applica, e il parse costa decine
    /// di volte la sorgente. Dieci note da 30 MB nella stessa fetta portavano
    /// l'apertura a 3 GB. La dimensione viene dalla scansione, prima di leggere;
    /// un documento più grande del tetto fa una fetta da solo.
    fn next_slice(&mut self) -> Vec<VaultEntry> {
        let mut end = self.cursor;
        let mut bytes = 0u64;
        while end < self.from_do.len() && end - self.cursor < FEED_BATCH {
            let entry = &self.from_do[end];
            if entry.kind == EntryKind::Document {
                bytes = bytes.saturating_add(entry.size);
                if bytes > crate::documents::MAX_DOCUMENT_SOURCE_BYTES && end > self.cursor {
                    break;
                }
            }
            end += 1;
        }
        let slice = self.from_do[self.cursor..end].to_vec();
        self.cursor = end;
        slice
    }
}

/// Quanto l'host si fida di chi ha prodotto un albero di UI — o un blocco
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
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

/// Nome di una nota nuova a cui nessuno ne ha dato uno (D3). L'utente la
/// rinomina subito: è il motivo per cui non vale la pena essere più creativi.
const UNTITLED: &str = "Senza titolo";

/// **Quanti documenti alla volta si alimenta un indice** (§20.1, decisione
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
const FEED_BATCH: usize = 512;

/// Il nome dell'entry point della seconda fase dell'apertura (§15.7), con cui
/// compare nel centro attività e in
/// [`IndexQuery::Jobs`](fub_abi::traits::IndexQuery::Jobs).
///
/// Ha la forma di un `JobSpec::job` qualunque perché **è** un job qualunque per
/// chi lo guarda: chi disegna una riga di lavoro in corso non deve avere un
/// ramo per l'apertura.
pub const INDEX_JOB: &str = "vault.index";

pub struct Workspace {
    /// Nonce process-local che lega i token opachi a questa istanza precisa.
    workspace_id: u64,
    /// *Il disco, e come ciò che ci sta sopra diventa un modello* (§8.1): il
    /// vault, il registro dei formati, le sintassi innestate (§3.1) e i
    /// renderer dei blocchi custom (§3.2). Stanno insieme perché **ogni** parse
    /// li attraversa tutti e quattro.
    docs: DocumentStore,
    /// Il canale dati: l'indice del kernel (metadati, tag, grafo), quelli
    /// registrati e la tabella che dice a chi va cosa (§5.1, §5.2).
    ///
    /// Sono alimentati **direttamente** (non via event bus) dentro la stessa
    /// operazione che aggiorna il vault — così un troncamento della coda eventi
    /// non può far divergere un indice — e l'id di ognuno è lo spazio dello
    /// storage persistente che l'[`HostApi`] gli concede: è lì che un indice si
    /// ricorda di ciò che ha già visto.
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
    /// *Chi è registrato, cosa ha dichiarato, chi possiede quale nome* (§8.1):
    /// le sei tabelle di provider, il registro dei plugin (decisione 0021) e le
    /// due catene di chiamate in corso. Ciò che si risponde **senza svegliare
    /// nessuno** sta lì dentro; chiamare un provider vuole un `HostApi`, che è
    /// costruito su tutto il workspace, e resta orchestrazione di qui.
    providers: ProviderRegistry,
    /// *Quando un evento parte, con che nome e per quanto* (§8.1): il bus, la
    /// coda verso gli handler, il lotto, l'attore corrente, il budget del
    /// drenaggio e la coda dei job. Tre regole che il piano nominava separate —
    /// lotto (decisione 0011), origine (decisione 0012), budget — e che si
    /// applicano tutte nello stesso punto: tenerle in tre posti sarebbe avere
    /// tre posti da cui un evento può uscire senza lotto, senza attribuzione o
    /// senza freno. Vedi il § "Dispatch degli eventi" qui sopra.
    dispatch: Dispatcher,
    /// *Cosa sta guardando l'utente adesso* (§8.1): il contesto del pannello
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
    session: Session,
    /// **Il filo verso fuori** (§23.3), se chi monta ne ha messo uno.
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
    network: Option<Arc<dyn fub_abi::traits::HostNetwork>>,
    /// L'orologio del vault (vedi [`crate::time::Clock`]).
    clock: Arc<dyn crate::time::Clock>,
    /// **Le sorgenti di import che l'host tiene aperte** (decisione 0102).
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
    sources: Shelter<OpenSources>,
    /// Il vault è già stato chiuso ([`close`](Workspace::close))?
    ///
    /// **Non è un sesto proprietario** (§8.1): è lo stato del *tutto*, ed è
    /// l'unica cosa che nessuno dei cinque può sapere da sé — il disco non sa
    /// degli indici, gli indici non sanno dei provider, e «il vault è chiuso» è
    /// esattamente la frase che li riguarda tutti insieme. Serve a una cosa
    /// sola: chiudere due volte non è chiudere due volte.
    closed: bool,
    /// I comandi di sola lettura in volo, che il turno non vede: lo
    /// smontaggio di un loro proprietario risponde `Busy`, la chiusura li
    /// ferma e li aspetta ([`ReadsInFlight`]).
    reads_in_flight: ReadsInFlight,
    /// Il vault che leggono i [`ResourceReader`] dati fuori, che non hanno il
    /// workspace e devono smettere quando si chiude. Lo svuota
    /// [`prepare_close`](Workspace::prepare_close), insieme a `closed`: così
    /// nessun lettore tiene viva la maniglia della cartella del vault.
    resource_readers_vault: Arc<Shelter<Option<crate::vault::Vault>>>,
    /// *Com'è configurato questo vault* (§11.1): gli schemi che i plugin
    /// dichiarano nel manifest, i valori dei due livelli, e la precedenza.
    ///
    /// **Non è un sesto proprietario** più di quanto lo sia `closed`: è una
    /// tabella che due dei cinque devono vedere uguale — il registro dei
    /// provider la riempie dichiarando, l'indice del kernel la legge per
    /// rispondere a [`IndexQuery::Settings`] — e l'`Arc<RwLock<…>>` è la forma
    /// di quella condivisione, la stessa di
    /// `WatchState::watching` e di `CoreIndex::registry`.
    settings: SharedSettings,
    /// Lo stato di vista di questa macchina (§11.2), condiviso fra i vault
    /// aperti come il livello macchina delle impostazioni.
    view_states: Arc<ViewStates>,
    /// L'organizzazione di **questo** vault (§11.3): icone, appuntate,
    /// ordinamenti, spazi. Condiviso con l'indice del kernel, che è chi risponde
    /// a `IndexQuery::Organization`.
    organization: Arc<OrganizationStore>,
    /// Ciò che la shell riporta del sistema: lingua, fuso, calendario (§12.3).
    /// Condiviso fra tutti i vault aperti, come il livello macchina delle
    /// impostazioni e lo stato di vista — la lingua di chi guarda non cambia
    /// perché si apre un secondo vault.
    system_locale: Arc<SystemLocale>,
    /// La pila delle operazioni annullabili di **questa sessione** (§13.3).
    ///
    /// Non è un sesto proprietario dei cinque del §8.1, ed è la seconda volta
    /// che vale la pena dirlo (la prima è `closed`): quei cinque rispondono
    /// alla domanda «di chi è questo dato», e questa pila non ha un dato suo —
    /// ha la **storia** di ciò che gli altri hanno fatto, che nessuno dei
    /// cinque poteva tenere senza sapere degli altri quattro.
    undo: UndoStack,
    /// **Ciò che si sapeva del vault l'ultima volta** (§14.2): la tabella
    /// dell'anagrafe su disco, con dimensione, data, impronta e — dei documenti
    /// — i metadati che risparmiano una riapertura.
    ///
    /// Non è un sesto proprietario più di quanto lo siano `closed` e
    /// `settings`: è la **memoria** di uno dei cinque (l'indice del kernel), e
    /// sta qui perché a riempirla è la scansione, che è del workspace. È anche
    /// l'unico stato di questa lista che si può buttare senza perdere niente —
    /// è derivato, e il vault resta la verità.
    entry_store: EntryStore,
    /// **Ciò che è successo al vault** (§15.2): il registro append-only delle
    /// mutazioni che il kernel ha eseguito.
    ///
    /// Non è un sesto proprietario per la ragione dell'anagrafe — è la memoria
    /// di ciò che i cinque hanno fatto — ed è il suo esatto contrario per
    /// classe: l'anagrafe è l'unico stato di questa lista che si può buttare
    /// senza perdere niente, il registro è quello che non si rifà da niente.
    journal: Arc<Journal>,
    /// **Ciò che l'utente ha scritto e non ha salvato** (§15.2): le bozze.
    ///
    /// Sta accanto al registro e ne condivide la classe — autorevole, non si
    /// rifà da niente — ed è il suo opposto per verso: il registro conserva ciò
    /// che è **successo** al vault, questo ciò che non è ancora successo.
    drafts: Arc<Drafts>,
    /// Quali spazi per-documento non hanno potuto seguire una rinomina (§13.2).
    ///
    /// Un `Vec` nudo e non un `Arc<RwLock<…>>` come le altre due liste di
    /// avvisi: qui a scrivere è **solo** `migrate_identity`, che ha già il
    /// prestito esclusivo del workspace. Un lucchetto in più non renderebbe
    /// visibile niente a nessuno che non lo veda già.
    doc_data_warnings: Vec<String>,
    /// I documenti spariti che **potrebbero** essere stati rinominati ad app
    /// chiusa, e su cui il ricongiungimento non ha saputo decidere (§23.1).
    ///
    /// Sta sul workspace e non passa da un parametro perché serve a un
    /// chiamante che non c'era quando il dubbio è nato: `vault.repair` raccoglie
    /// a comando, a vault aperto da un pezzo, e senza questo elenco
    /// cancellerebbe con un clic esattamente ciò che l'apertura aveva deciso di
    /// non cancellare.
    suspended_from_rejoin: BTreeSet<DocId>,
    /// I ganci **prima della scrittura** (0154), uno per owner e nell'ordine
    /// di registrazione: l'id del plugin a cui intestare l'host e la chiusura
    /// da chiamare in [`write_source`](Workspace::write_source) fra il parse e il disco.
    ///
    /// Nessun gancio è il default e non è un difetto — è la forma di `network` e del
    /// watcher: il kernel non sa cosa sia una fotografia, sa solo che c'è un
    /// istante in cui l'originale è ancora leggibile, e chi lo vuole guardare
    /// lo dichiara qui. Ogni gancio gira **dentro** la scrittura, prima del
    /// disco, e il primo errore ferma la scrittura e i ganci che seguono:
    /// sovrascrivere senza che la fotografia sia riuscita sarebbe la finestra
    /// che questo meccanismo esiste per chiudere.
    before_write: Vec<(String, BeforeWriteHook)>,
}

impl Workspace {
    /// Crea un workspace su una radice con un registry di provider già
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
    pub fn new(root: impl AsRef<Utf8Path>, registry: FormatRegistry) -> Result<Self> {
        Workspace::with_machine_settings(root, registry, MachineSettings::in_memory())
    }

    /// Come [`new`](Workspace::new), col livello macchina **condiviso** fra
    /// tutti i vault aperti da questo host (§11.1).
    pub fn with_machine_settings(
        root: impl AsRef<Utf8Path>,
        registry: FormatRegistry,
        machine: Arc<MachineSettings>,
    ) -> Result<Self> {
        // **Un** supporto per workspace, non uno per proprietario: il vault, il
        // sidecar dell'organizzazione, la configurazione del vault e l'anagrafe
        // scrivono tutti nella stessa cartella, e due supporti per la stessa
        // cartella sarebbero due idee di cosa c'è dentro — il giorno in cui uno
        // dei due cifra, un dato su due resta in chiaro (§15.1, 0065).
        let root = crate::vault::root_absolute(root.as_ref());
        let storage = crate::storage::RootedFsStorage::open(&root).map_err(|source| {
            KernelError::InvalidRoot {
                path: root.clone(),
                source,
            }
        })?;
        Workspace::on(root, registry, Arc::new(storage), machine)
    }

    /// Come [`with_machine_settings`](Workspace::with_machine_settings), col
    /// **supporto passato** invece del disco (§15.1).
    ///
    /// Esiste per la stessa ragione per cui esiste [`Vault::on`](crate::Vault::on),
    /// e ne è il gemello un piano più su: finché il `FsStorage` è l'unico
    /// supporto che un workspace sa montare, ciò che il workspace fa al disco si
    /// può solo *osservare a valle*, mai **interrompere a metà** — e le proprietà
    /// che parlano di cosa sopravvive a un guasto non hanno un banco. Con questa
    /// riga un supporto che fallisce la mossa che si vuole studiare è tre righe
    /// di test, e non c'è nessuna attesa da costruire.
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
        // Il registry è condiviso con l'indice del kernel invece che copiato:
        // "quali estensioni sono documenti" è una domanda sola (vedi
        // `CoreIndex::registry`).
        let registry = Arc::new(registry);
        // **La radice si fissa qui, una volta sola.** Tutto ciò che segue ci
        // appende il proprio nome — le impostazioni, l'organizzazione, le
        // bozze, i documenti, l'anagrafe, il registro: sei store, e cinque il
        // path se lo calcolano adesso mentre il vault se lo ricalcola a ogni
        // domanda. Con una radice relativa sarebbero sei file scritti in un
        // posto e riletti da un altro, appena la cartella di lavoro del
        // processo si sposta. Che questa riga **copra** il parametro non è
        // stile: chi aggiungerà il settimo store non ha in mano nessun'altra
        // `root` da passargli.
        let root = &root_buf;
        let settings: SharedSettings = Arc::new(RwLock::new(SettingsStore::open(
            root,
            Arc::clone(&storage),
            machine,
        )));
        // L'organizzazione è **del vault**, quindi si apre col root e non si
        // riceve da chi monta: è la differenza con il livello macchina e con lo
        // stato di vista, che sono della macchina e valgono per N vault.
        let (organization, warning) = OrganizationStore::open(root, Arc::clone(&storage));
        if let Some(warning) = warning {
            organization.warn(warning);
        }
        // Le bozze sono **del vault** come il registro: ciò che si stava
        // scrivendo in questo archivio viaggia con questo archivio. Condivise
        // con l'indice del kernel, che è chi risponde a chi le chiede (0019).
        let drafts = Arc::new(Drafts::open(root, Arc::clone(&storage)));
        let docs = DocumentStore::new(
            root,
            Arc::clone(&registry),
            Arc::clone(&storage),
            Arc::clone(&settings),
        )?;
        let resource_readers_vault = Arc::new(Shelter::new(Some(docs.vault.clone())));
        Ok(Workspace {
            workspace_id: NEXT_WORKSPACE_ID.fetch_add(1, Ordering::Relaxed),
            docs,
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
            clock: Arc::new(crate::time::SystemClock),
            sources: Shelter::new(OpenSources::default()),
            closed: false,
            reads_in_flight: ReadsInFlight::default(),
            resource_readers_vault,
            settings,
            view_states: ViewStates::in_memory(),
            organization,
            system_locale: Arc::new(SystemLocale::default()),
            undo: UndoStack::default(),
            // L'anagrafe è **del vault**, come l'organizzazione: si apre col
            // root e non si riceve da chi monta.
            entry_store: EntryStore::open(root, Arc::clone(&storage)),
            // Il registro è **del vault** come l'anagrafe, e come lei si apre
            // col root: ciò che è successo a queste note viaggia con queste
            // note.
            journal: Arc::new(Journal::open(root, storage)),
            drafts,
            doc_data_warnings: Vec::new(),
            suspended_from_rejoin: BTreeSet::new(),
            before_write: Vec::new(),
        })
    }

    /// Aggancia lo stato di vista della macchina (§11.2).
    ///
    /// Builder e non parametro di [`with_machine_settings`](Workspace::with_machine_settings)
    /// perché è la stessa scelta fatta là e per la stessa ragione: il default è
    /// **in memoria**, cioè ciò che serve a un test, e chi ha un'installazione
    /// lo sostituisce in una riga. Un default che scrive nella cartella di
    /// configurazione di chi esegue la suite è un difetto che si scopre tardi.
    pub fn with_view_states(mut self, states: Arc<ViewStates>) -> Self {
        self.view_states = states;
        self
    }

    /// Aggancia il locale di sistema **condiviso** fra i vault aperti (§12.3).
    ///
    /// Builder come [`with_view_states`](Workspace::with_view_states) e per la
    /// stessa ragione: il default è un locale indeterminato, che è ciò che serve
    /// a un test e a un host senza shell, e chi ha una finestra lo sostituisce
    /// in una riga.
    pub fn with_system_locale(mut self, locale: Arc<SystemLocale>) -> Self {
        self.system_locale = locale;
        self
    }

    /// Il locale **che vale adesso**: ciò che la shell riporta del sistema, con
    /// sopra le chiavi `locale.*` che l'utente ha scelto (§12.3).
    ///
    /// È ciò che [`HostEnv::locale`](fub_abi::HostEnv::locale) rende, e ciò
    /// che la shell ridisegna quando cambia. Si ricompone a ogni chiamata invece
    /// di tenere una copia risolta: le due sorgenti cambiano da due parti — la
    /// shell che ripubblica, l'utente che scrive un'impostazione — e una copia
    /// che non si accorge di una delle due è il modo in cui la lingua resta
    /// quella di prima finché non si riavvia.
    pub fn locale(&self) -> Locale {
        let system = self.system_locale.get();
        crate::locale::resolve(&system, |key| {
            self.setting(key).ok().and_then(|v| match v {
                SettingValue::Text(s) => Some(s),
                _ => None,
            })
        })
    }

    /// **Risolve i testi** di ciò che sta uscendo dal contratto, col catalogo di
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
    pub(crate) fn localize<T: Localize + ?Sized>(&self, plugin: &str, value: &mut T) {
        let locale = self.locale();
        let (catalogs, default_locale) = self.providers.plugins.strings_of(plugin);
        Strings::new(catalogs, default_locale, &locale).localize(value);
    }

    /// Localizza per conto di `plugin` ciò che la composizione ha costruito
    /// con le chiavi del suo catalogo. I comandi posseduti dall'host non
    /// passano dal registro, ma devono parlare con le stesse frasi e nella
    /// stessa lingua di quelli che ci passano.
    pub fn localize_as<T: Localize + ?Sized>(&self, plugin: &str, value: &mut T) {
        self.localize(plugin, value);
    }

    /// Come [`localize`](Workspace::localize), per ciò che esce **al posto** del
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
    pub(crate) fn localized(&self, plugin: &str, mut and: PluginError) -> PluginError {
        self.localize(plugin, &mut and);
        and
    }

    /// L'errore di una domanda al canale dati, nel catalogo dell'indice che
    /// l'ha prodotto (§12.2): la stessa via d'uscita di [`localized`], per la
    /// domanda che il pianificatore ha girato a un indice. Vale anche per la
    /// domanda staccata ([`PreparedIndexQuery::invoke`]), che fallisce senza
    /// il prestito del workspace e torna qui per le parole.
    ///
    /// [`localized`]: Workspace::localized
    pub fn localized_query_failure(
        &self,
        failure: crate::index::plan::QueryFailure,
    ) -> PluginError {
        match failure.owner {
            Some(owner) => self.localized(&owner, failure.error),
            None => failure.error,
        }
    }

    /// Il locale di sistema condiviso: chi monta lo passa alla shell perché ci
    /// scriva ciò che il sistema dice.
    pub fn system_locale(&self) -> Arc<SystemLocale> {
        Arc::clone(&self.system_locale)
    }

    /// Sceglie la strategia di aggiornamento del grafo (default: incrementale).
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

    /// Prepara la scansione degli intent di rinomina senza fare I/O sotto il
    /// lock del workspace. La lettura del disco avviene in `invoke`.
    pub fn prepare_rename_recovery_scan(&self) -> RenameRecoveryScan {
        RenameRecoveryScan::new(
            Arc::clone(self.docs.vault.storage()),
            self.docs.vault.root().to_owned(),
        )
    }
}

/// Valida un nome/path che **nomina un documento che esiste** (o che potrebbe
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
pub fn valid_doc_id(name: &str) -> Result<DocId> {
    let clean = &path_policy::from_outside(name);
    path_policy::check(clean, Naming::Existing).map_err(|why| KernelError::BadName {
        name: name.to_string(),
        why: why.to_string(),
    })?;
    Ok(DocId::new(clean))
}

/// Il [`DocId`] di un nome che **nasce adesso**: [`valid_doc_id`], più la
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
pub fn new_doc_id(name: &str) -> Result<DocId> {
    let id = valid_doc_id(name)?;
    path_policy::check(id.as_str(), Naming::New).map_err(|why| KernelError::BadName {
        name: name.to_string(),
        why: why.to_string(),
    })?;
    Ok(DocId::new(path_policy::normalized(id.as_str())))
}

/// Il [`DocId`] con cui un **plugin** può nominare un documento, o
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
pub(crate) use fub_abi::rules::path_policy::fenced_doc_id;

/// Un intento che la shell esegue con un privilegio suo
/// ([`fub_abi::ui::privileged_intent`]) passa solo da chi ha il grado del
/// contenuto attivo: è la stessa linea di [`guard_ui`], applicata a ciò che un
/// provider chiede alla shell invece che a ciò che le fa disegnare.
fn guard_intent(trust: Trust, ns: &str) -> std::result::Result<(), PluginError> {
    if fub_abi::ui::privileged_intent(ns) && !trust.allows_active_content() {
        Err(PluginError::PermissionDenied(
            format!("l'intento `{ns}` è riservato ai provider del core").into(),
        ))
    } else {
        Ok(())
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
///
/// Una cartella che non c'è è una lista vuota, non un errore: chi interroga
/// uno storage vuoto non sta sbagliando niente. Lo stesso vale per un prefisso
/// che nomina un blob, sotto cui non sta niente. Ogni altro guasto risale,
/// anche quello di una sottocartella: un elenco a metà preso per intero faceva
/// ripristinare un backup senza i file che non si erano visti, e ricostruire
/// un indice di versioni che ne dimenticava.
pub(crate) fn collect_data_files(
    storage: &dyn crate::storage::VaultStorage,
    root: &Utf8Path,
    dir: &Utf8Path,
    out: &mut Vec<String>,
) -> std::io::Result<()> {
    let entries = match storage.list(dir) {
        Ok(entries) => entries,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(())
        }
        Err(error) => return Err(error),
    };
    for entry in entries {
        if entry.stat.is_dir() {
            collect_data_files(storage, root, &entry.path, out)?;
        } else if let Some(rel) = entry.path.strip_prefix(root).ok().map(Utf8Path::as_str) {
            let rel = rel.replace('\\', "/");
            if rel == PLUGIN_CACHE_MARK || rel.ends_with("/.fub-cache-root") {
                continue;
            }
            out.push(rel);
        }
    }
    Ok(())
}

/// Sottomodello con i soli blocchi della sezione di un heading: da esso
/// (incluso) fino al prossimo heading di livello pari o superiore.
///
/// Chi matcha è `heading_matches`, la stessa regola con cui il canale dati
/// risolve un `[[Nota#Sezione]]`: un embed che trovasse una sezione diversa da
/// quella che il link apre sarebbe la stessa scritta che mostra due cose.
fn section_of(model: &DocumentModel, heading: &str) -> Option<DocumentModel> {
    // Un documento fatto di un solo blocco custom può dichiarare sezioni
    // nominate (`fub_abi::custom::SECTIONS_ATTR`): per lui il nome sceglie una
    // sezione, non un heading. Il kernel non sa di che formato si tratta; un
    // blocco senza la dichiarazione passa per gli heading come ogni altro.
    if let [fub_abi::model::Block::Custom { attrs, .. }] = model.body.as_slice() {
        if let Some(sections) = attrs
            .get(fub_abi::custom::SECTIONS_ATTR)
            .and_then(serde_json::Value::as_array)
        {
            if !sections.iter().any(|name| name.as_str() == Some(heading)) {
                return None;
            }
            let mut selected = DocumentModel::empty(model.id.clone());
            selected.body.push(model.body[0].clone());
            if let fub_abi::model::Block::Custom { attrs, .. } = &mut selected.body[0] {
                attrs[fub_abi::custom::SECTION_ATTR] =
                    serde_json::Value::String(heading.to_owned());
            }
            return Some(selected);
        }
    }
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

/// Sottomodello con il solo blocco che porta l'ancora `^id`.
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
    // Un'ancora che non ritaglia niente è un'ancora che non c'è: rispondere con
    // un documento vuoto vorrebbe dire mostrare il nulla invece di dire che il
    // bersaglio non si è trovato.
    (!clipped.body.is_empty()).then_some(clipped)
}

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

/// **Un lotto aperto è un prestito, e si chiude cadendo.**
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
struct Batch<'w> {
    ws: &'w mut Workspace,
    /// Se questo prestito è **quello esterno**, cioè se tocca a lui chiudere.
    /// Annidato, entra nel lotto che c'è e non lo tocca: contare le aperture
    /// non servirebbe a niente, perché chi trova il campo pieno non lo tocca in
    /// nessun caso.
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
            // Srotolando si chiude il lotto e **non** si drena. Le due metà di
            // `end_batch` non hanno lo stesso prezzo qui: chiudere è mettere a
            // posto un campo di questo oggetto, drenare è chiamare codice di
            // terzi mentre il panico corre — e un panico che scappasse da lì
            // dentro non sarebbe un secondo errore, sarebbe un `abort` del
            // processo. Ciò che resta in coda non è perso: lo drena la prima
            // operazione che riesce, e adesso può, che è tutto il punto.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents::MAX_DOCUMENT_SOURCE_BYTES;

    fn entry(name: &str, kind: EntryKind, size: u64) -> VaultEntry {
        VaultEntry {
            id: DocId::new(name),
            kind,
            size,
            mtime: 0,
            fingerprint: None,
        }
    }

    fn slices(mut work: Indexing) -> Vec<Vec<String>> {
        let mut out = Vec::new();
        while !work.finished() {
            out.push(
                work.next_slice()
                    .into_iter()
                    .map(|entry| entry.id.to_string())
                    .collect(),
            );
        }
        out
    }

    /// **Una fetta non tiene più documenti di quanti il kernel ne legga uno.**
    ///
    /// Sorgenti e modelli di una fetta restano in memoria insieme fino
    /// all'applicazione: le fette si contano in byte di documenti oltre che in
    /// voci. Gli allegati non pesano, perché la loro impronta si prende a pezzi.
    #[test]
    fn a_slice_holds_at_most_the_largest_readable_document() {
        let half = MAX_DOCUMENT_SOURCE_BYTES / 2;
        let work = Indexing::new(vec![
            entry("a.md", EntryKind::Document, half),
            entry("b.md", EntryKind::Document, half),
            entry("film.mp4", EntryKind::Asset, 10 * MAX_DOCUMENT_SOURCE_BYTES),
            entry("c.md", EntryKind::Document, 1),
            entry(
                "enorme.md",
                EntryKind::Document,
                2 * MAX_DOCUMENT_SOURCE_BYTES,
            ),
            entry("d.md", EntryKind::Document, 1),
        ]);
        assert_eq!(
            slices(work),
            [
                vec!["a.md", "b.md", "film.mp4"],
                vec!["c.md"],
                vec!["enorme.md"],
                vec!["d.md"],
            ]
        );
    }

    /// Le note piccole riempiono la fetta fino al conto delle voci.
    #[test]
    fn small_notes_still_fill_a_slice() {
        let work = Indexing::new(
            (0..FEED_BATCH + 1)
                .map(|n| entry(&format!("{n}.md"), EntryKind::Document, 10_000))
                .collect(),
        );
        let sizes: Vec<usize> = slices(work).iter().map(Vec::len).collect();
        assert_eq!(sizes, [FEED_BATCH, 1]);
    }

    /// **Chiuso il vault, un lettore rimasto in giro non tiene la cartella.**
    ///
    /// Il bundle Craft tiene i lettori in una cache del processo: se il
    /// lettore clonasse il vault per sé, la maniglia della cartella vivrebbe
    /// oltre la chiusura, e su Windows la cartella non si rinomina né si
    /// cancella più. Il supporto del vault deve morire col workspace anche se
    /// un lettore resta vivo.
    #[test]
    fn a_reader_left_around_does_not_keep_the_vault_storage_alive() {
        let dir = tempfile::tempdir().expect("la cartella del vault");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("un path UTF-8");
        std::fs::write(root.join("a.bin"), b"0123").expect("il file");
        let mut ws = Workspace::new(&root, FormatRegistry::new()).expect("l'apertura");
        let reader = ws.resource_reader();
        let lease = reader.open(&DocId::new("a.bin")).expect("la lease");
        assert_eq!(reader.read_at(&lease, 0, 4).unwrap(), b"0123");
        let storage = Arc::downgrade(ws.storage());
        assert!(ws.close().is_empty());
        drop(ws);
        assert!(
            storage.upgrade().is_none(),
            "il lettore tiene ancora il supporto del vault chiuso"
        );
        assert_eq!(reader.root(), lease.root.as_path());
        let error = reader.read_at(&lease, 0, 4).unwrap_err();
        assert!(
            matches!(&error, KernelError::Io { source, .. }
                if source.kind() == std::io::ErrorKind::NotConnected),
            "{error:?}"
        );
    }
}
