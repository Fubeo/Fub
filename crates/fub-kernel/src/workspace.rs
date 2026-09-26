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
    PreparedGridCall, PreparedIndexRegistration, PreparedPluginDeactivation, PreparedRegistration,
    RegistrationPermit,
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
    CompletedIndexQuery, Indexes, PreparedIndexQuery, SharedIndexProvider,
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
use crate::session::{ContextChange, Session};
use crate::settings::{MachineSettings, SettingsStore, SharedSettings};
use crate::transfer::{MemorySink, OpenSources, ResourceLease, SourceBacking, PROLOGUE};
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

/// Piano owned di una sincronizzazione esterna.
///
/// La preparazione fotografa soltanto stato del kernel e handle condivisi. La
/// lettura `stat-read-stat` e il parse avvengono con [`SyncPlan::invoke`],
/// senza conservare alcun prestito del workspace.
pub struct SyncPlan {
    snapshot: SyncSnapshot,
    action: SyncPlanAction,
}

/// Lettura e parse owned di una rinomina esplicita di documento.
///
/// La preparazione fotografa il core e risolve provider e sintassi senza
/// invocarli. [`PreparedExplicitRename::invoke`] esegue lo stat-read-stat e il
/// parse senza prendere in prestito il workspace.
#[must_use = "la rinomina preparata deve essere invocata e committata"]
pub struct PreparedExplicitRename {
    snapshot: ExplicitRenameSnapshot,
    storage: Arc<dyn crate::storage::VaultStorage>,
    parser: PreparedParse,
    source_kind: SourceKind,
    rewrites: Vec<PreparedExplicitLinkRewrite>,
    side_data: PreparedRenameSideData,
    recovery_root: Utf8PathBuf,
}
/// Piano owned di una rinomina esplicita di una voce senza provider di formato.
///
/// La preparazione fotografa soltanto core, path, riferimenti e handle. I byte
/// dell'asset, le sorgenti dei link e i side-data vengono letti o mossi da
/// [`PreparedExplicitAssetRename::invoke`] senza prendere in prestito il
/// workspace.
#[must_use = "la rinomina asset preparata deve essere invocata e committata"]
pub struct PreparedExplicitAssetRename {
    snapshot: ExplicitRenameSnapshot,
    storage: Arc<dyn crate::storage::VaultStorage>,
    rewrites: Vec<PreparedExplicitLinkRewrite>,
    side_data: PreparedAssetRenameSideData,
    recovery_root: Utf8PathBuf,
}

/// Asset già spostato e fotografato esattamente, ancora da riconvalidare nel core.
#[must_use = "la rinomina asset spostata deve essere committata o annullata"]
pub struct MovedExplicitAssetRename {
    snapshot: ExplicitRenameSnapshot,
    storage: Arc<dyn crate::storage::VaultStorage>,
    fingerprint: Revision,
    stat: crate::storage::Stat,
    identity: Option<crate::storage::FileIdentity>,
    rewrites: Vec<(DocId, EditRequest)>,
    side_data: CompletedAssetRenameSideData,
    recovery: RenameRecoveryReceipt,
}

/// Core della rinomina asset installato, con callback ancora da invocare.
#[must_use = "registro e riscritture della rinomina asset devono essere invocati"]
pub struct PendingExplicitAssetRename {
    workspace_id: u64,
    installed: VaultEntry,
    rewrites: Vec<(DocId, EditRequest)>,
    side_data: CompletedAssetRenameSideData,
    recovery: RenameRecoveryReceipt,
    journal: Arc<Journal>,
    origin: fub_abi::event::Origin,
    from: DocId,
    to: DocId,
    owns_batch: bool,
}

/// Callback della rinomina asset concluse, pronto per eventi ed epilogo.
pub struct CompletedExplicitAssetRename {
    workspace_id: u64,
    installed: VaultEntry,
    side_data: CompletedAssetRenameSideData,
    from: DocId,
    to: DocId,
    owns_batch: bool,
    rewrite_failures: Vec<String>,
    journal_fault: Option<String>,
}

/// Sorgente stabile e modello già parsato, ancora da riconvalidare nel core.
#[must_use = "la rinomina parsata deve essere committata"]
pub struct ParsedExplicitRename {
    snapshot: ExplicitRenameSnapshot,
    storage: Arc<dyn crate::storage::VaultStorage>,
    model: DocumentModel,
    fingerprint: Revision,
    stat: crate::storage::Stat,
    identity: Option<crate::storage::FileIdentity>,
    rewrites: Vec<(DocId, EditRequest)>,
    side_data: CompletedRenameSideData,
    recovery: RenameRecoveryReceipt,
}
/// Core della rinomina esplicita già installato, con gli handle degli indici
/// ancora da invocare fuori dal workspace.
#[must_use = "gli indici della rinomina devono essere invocati e finalizzati"]
pub struct PendingExplicitRename {
    identity: PendingIdentityMigration,
    rewrites: Vec<(DocId, EditRequest)>,
    side_data: CompletedRenameSideData,
    recovery: RenameRecoveryReceipt,
    journal: Arc<Journal>,
    origin: fub_abi::event::Origin,
    from: DocId,
    to: DocId,
    owns_batch: bool,
}

/// Callback degli indici concluse, pronto per l'epilogo sotto guard.
pub struct CompletedExplicitRename {
    identity: CompletedIdentityMigration,
    rewrites: Vec<(DocId, EditRequest)>,
    side_data: CompletedRenameSideData,
    recovery: RenameRecoveryReceipt,
    owns_batch: bool,
    rewrite_failures: Vec<String>,
    journal_fault: Option<String>,
}

struct PendingIdentityMigration {
    workspace_id: u64,
    from: DocId,
    to: DocId,
    installed: VaultEntry,
    removal: PreparedDocumentRemoval,
    feed: PreparedDocumentFeed,
}

struct CompletedIdentityMigration {
    workspace_id: u64,
    from: DocId,
    to: DocId,
    installed: VaultEntry,
    removal: CompletedDocumentRemoval,
    feed: PreparedDocumentFeed,
}

struct ExplicitRenameSnapshot {
    workspace_id: u64,
    from_path: Utf8PathBuf,
    to_path: Utf8PathBuf,
    from: DocId,
    to: DocId,
    from_entry: VaultEntry,
    to_entry: Option<VaultEntry>,
    syntax_generation: u64,
    routing_generation: u64,
}

struct PreparedExplicitLinkRewrite {
    source_path: Utf8PathBuf,
    destination: DocId,
    provider: Option<std::sync::Arc<dyn FormatProvider>>,
    provider_id: String,
    ctx: ParseContext,
    source_kind: SourceKind,
    rewrites: Vec<LinkRewrite>,
}

/// Fotografia provider-owned di una sorgente da riscrivere: handle condiviso,
/// id formato, contesto parse e specie sorgente. Solo dati owned, nessun lock.
struct RewritePlan {
    provider: std::sync::Arc<dyn FormatProvider>,
    provider_id: String,
    ctx: ParseContext,
    source_kind: SourceKind,
}

/// Routing owned di una rinomina consegnata dal watcher.
pub enum ExternalRenamePlan {
    Asset(Box<PreparedExternalAssetRename>),
    Document(Box<PreparedExternalDocumentRename>),
    Sync(Vec<(Utf8PathBuf, Option<SyncPlan>)>),
}

/// Lettura e parse detached della destinazione di una rinomina documento.
pub struct PreparedExternalDocumentRename {
    snapshot: ExternalRenameSnapshot,
    storage: Arc<dyn crate::storage::VaultStorage>,
    parser: PreparedParse,
    source_kind: SourceKind,
    side_data: PreparedRenameSideData,
}

/// Destinazione già letta e parsata fuori dal workspace.
pub struct ParsedExternalDocumentRename {
    snapshot: ExternalRenameSnapshot,
    state: ParsedExternalDocumentState,
    side_data: PreparedRenameSideData,
}

enum ParsedExternalDocumentState {
    Ready {
        model: Box<DocumentModel>,
        fingerprint: Revision,
        stat: crate::storage::Stat,
    },
    Failed(KernelError),
    Stale,
}

/// Handle owned per spostare i dati autorevoli di una rinomina fuori dal
/// workspace.
struct PreparedRenameSideData {
    from: DocId,
    to: DocId,
    organization: Arc<OrganizationStore>,
    drafts: Arc<Drafts>,
    storage: Arc<dyn crate::storage::VaultStorage>,
    doc_data_roots: Vec<Utf8PathBuf>,
}

/// Errori recuperabili prodotti dalla migrazione detached dei side-data.
struct CompletedRenameSideData {
    from: DocId,
    to: DocId,
    errors: Vec<String>,
    rollback: Option<PreparedRenameSideData>,
}
/// Handle owned per migrare soltanto i side-data che appartengono anche agli
/// asset. Le bozze sono buffer di documenti testuali e non seguono questa rotta.
struct PreparedAssetRenameSideData {
    from: DocId,
    to: DocId,
    organization: Arc<OrganizationStore>,
    storage: Arc<dyn crate::storage::VaultStorage>,
    doc_data_roots: Vec<Utf8PathBuf>,
}

/// Esito e ricevuta one-shot per il rollback dei side-data di un asset.
struct CompletedAssetRenameSideData {
    from: DocId,
    to: DocId,
    errors: Vec<String>,
    rollback: Option<PreparedAssetRenameSideData>,
}

/// Core della rinomina già installato, callback e side-data ancora detached.
pub struct PendingExternalDocumentRename {
    snapshot: ExternalRenameSnapshot,
    installed: VaultEntry,
    removal: PreparedDocumentRemoval,
    feed: PreparedDocumentFeed,
    side_data: PreparedRenameSideData,
}

/// Callback e side-data completati, pronto per l'unico epilogo.
pub struct CompletedExternalDocumentRename {
    snapshot: ExternalRenameSnapshot,
    installed: VaultEntry,
    removal: CompletedDocumentRemoval,
    feed: PreparedDocumentFeed,
    side_data: CompletedRenameSideData,
}

/// Prima fase owned della migrazione d'identità di un asset.
pub struct PreparedExternalAssetRename {
    snapshot: ExternalRenameSnapshot,
    storage: Arc<dyn crate::storage::VaultStorage>,
    organization: Arc<OrganizationStore>,
    doc_data_roots: Vec<Utf8PathBuf>,
    fallback: Vec<(Utf8PathBuf, Option<SyncPlan>)>,
}

/// Esito detached della prima fase di una rinomina asset.
pub enum ParsedExternalRename {
    Asset(Box<ParsedExternalAssetRename>),
    Sync(Vec<(Utf8PathBuf, Option<ParsedChange>)>),
}

pub struct ParsedExternalAssetRename {
    snapshot: ExternalRenameSnapshot,
    stat: crate::storage::Stat,
    fingerprint: Revision,
    organization: Arc<OrganizationStore>,
    storage: Arc<dyn crate::storage::VaultStorage>,
    doc_data_roots: Vec<Utf8PathBuf>,
}

/// Core già migrato, side-data ancora da spostare fuori dal workspace.
pub struct PendingExternalAssetRename {
    snapshot: ExternalRenameSnapshot,
    installed: VaultEntry,
    organization: Arc<OrganizationStore>,
    storage: Arc<dyn crate::storage::VaultStorage>,
    doc_data_roots: Vec<Utf8PathBuf>,
}

/// Side-data già migrato, pronto per l'unica finalizzazione e notifica.
pub struct CompletedExternalAssetRename {
    snapshot: ExternalRenameSnapshot,
    installed: VaultEntry,
    doc_data_errors: Vec<String>,
}

struct ExternalRenameSnapshot {
    workspace_id: u64,
    from_path: Utf8PathBuf,
    to_path: Utf8PathBuf,
    from_id: DocId,
    to_id: DocId,
    from_entry: VaultEntry,
    to_entry: Option<VaultEntry>,
    syntax_generation: u64,
    routing_generation: u64,
}

/// Fotografia owned necessaria a confrontare il disco dopo l'avvio del watcher.
///
/// Il workspace la prepara senza I/O; [`PreparedCatchUp::invoke`] cammina il
/// vault e verifica le impronte dopo che la guardia di [`Workspace`] è caduta.
pub struct PreparedCatchUp {
    vault: crate::Vault,
    entries: BTreeMap<DocId, VaultEntry>,
}

/// Candidati prodotti dalla scansione detached della riconciliazione d'apertura.
/// I campi restano chiusi: soltanto [`Workspace::plan_catch_up`] può trasformare
/// questa fotografia in piani legati allo stato corrente del workspace.
pub struct CatchUpSnapshot {
    candidates: BTreeMap<DocId, Utf8PathBuf>,
}

/// Esito già invocato della fase detached di una sincronizzazione esterna.
///
/// Questo tipo non espone `invoke`: non può quindi essere confuso con il piano
/// che ancora possiede I/O o parse da eseguire.
pub struct ParsedChange {
    snapshot: SyncSnapshot,
    state: ParsedChangeState,
}

/// Mutazione preparata sotto il workspace, ma non ancora notificata agli
/// indici esterni.
pub struct PendingSyncChange {
    snapshot: SyncSnapshot,
    state: PendingSyncState,
}

/// Risultato di una mutazione dopo l'unica callback esterna necessaria.
pub struct CompletedSyncChange {
    snapshot: SyncSnapshot,
    state: CompletedSyncState,
}

struct SyncSnapshot {
    workspace_id: u64,
    path: Utf8PathBuf,
    id: DocId,
    /// L'impronta che l'anagrafe aveva **al momento del piano**.
    seen: Option<Revision>,
    entry: Option<VaultEntry>,
    syntax_generation: u64,
    routing_generation: u64,
}

enum SyncPlanAction {
    Parse {
        storage: Arc<dyn crate::storage::VaultStorage>,
        parser: Box<PreparedParse>,
        source_kind: SourceKind,
        already_ingested: bool,
    },
    Stat {
        storage: Arc<dyn crate::storage::VaultStorage>,
    },
}

enum ParsedChangeState {
    Ready {
        model: Box<DocumentModel>,
        /// L'impronta del sorgente che è stato letto: è quella che finirà in
        /// anagrafe.
        fingerprint: Revision,
        stat: crate::storage::Stat,
    },
    Entry(Option<crate::storage::Stat>),
    /// Il file letto porta **l'impronta che l'anagrafe ha già**: è la
    /// scrittura del kernel che rientra dal rilevatore, e non c'è niente da
    /// parsare né da ingerire (difetto 0196, vedi
    /// [`Workspace::already_ingested`]).
    Unchanged(crate::storage::Stat),
    Missing,
    Unstable,
    Failed(KernelError),
}

enum PendingSyncState {
    Feed {
        feed: Box<PreparedDocumentFeed>,
        previous_provider_call: bool,
    },
    Removal(PreparedDocumentRemoval),
    Entry(Option<crate::storage::Stat>),
    Unchanged(crate::storage::Stat),
}

enum CompletedSyncState {
    Feed {
        feed: Box<PreparedDocumentFeed>,
        previous_provider_call: bool,
    },
    Removal(CompletedDocumentRemoval),
    Entry(Option<crate::storage::Stat>),
    Unchanged(crate::storage::Stat),
}

impl SyncPlan {
    /// Esegue I/O e parse senza alcun prestito del workspace.
    pub fn invoke(self) -> ParsedChange {
        let SyncPlan { snapshot, action } = self;
        let state = match action {
            SyncPlanAction::Parse {
                storage,
                parser,
                source_kind,
                already_ingested,
            } => invoke_sync_read(
                &snapshot,
                storage.as_ref(),
                *parser,
                source_kind,
                already_ingested,
            ),
            SyncPlanAction::Stat { storage } => match storage.stat(&snapshot.path) {
                Ok(stat) if stat.is_file() => ParsedChangeState::Entry(Some(stat)),
                Ok(_) => ParsedChangeState::Entry(None),
                Err(error) if sync_path_is_absent(&error) => ParsedChangeState::Entry(None),
                Err(source) => ParsedChangeState::Failed(KernelError::Io {
                    path: snapshot.path.clone(),
                    source,
                }),
            },
        };
        ParsedChange { snapshot, state }
    }
}

impl PreparedExplicitRename {
    /// Legge e parsa una versione stabile della sorgente, costruisce le
    /// richieste CAS dei backlink e persiste l'intent recuperabile prima di
    /// migrare side-data o file. Tutto avviene senza un prestito del workspace.
    pub fn invoke(self) -> Result<ParsedExplicitRename> {
        let PreparedExplicitRename {
            snapshot,
            storage,
            parser,
            source_kind,
            rewrites,
            side_data,
            recovery_root,
        } = self;

        // **Ciò che può fallire va prima di ciò che non si disfa.** Leggere e
        // parsare stanno qui e non dopo la `rename` per la ragione per cui ci
        // stanno in `write_source` e nel ripristino staged: un errore di parse —
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
        let path = snapshot.from_path.clone();
        let before = storage.stat(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        if !before.is_file() {
            return Err(KernelError::NotFound(snapshot.from.to_string()));
        }
        let identity_before = storage
            .file_identity(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        let bytes = storage.read(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        let after = storage.stat(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        let identity_after = storage
            .file_identity(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        if !after.is_file() || before != after || identity_before != identity_after {
            return Err(KernelError::Stale(snapshot.from.to_string()));
        }
        let identity = identity_after;
        let fingerprint = Revision::of_bytes(&bytes);
        let source = match source_kind {
            SourceKind::Text => {
                let text =
                    fub_abi::rules::text_policy::decode(&bytes).map_err(|at| KernelError::Io {
                        path: path.clone(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("il file non è UTF-8: il primo byte non valido è a {at}"),
                        ),
                    })?;
                DocumentSource::Text(text.to_string())
            }
            SourceKind::Bytes => DocumentSource::Bytes(bytes),
        };
        let model = parser.invoke(source)?;
        let durable_rewrites = invoke_prepared_link_rewrites(storage.as_ref(), rewrites)?;

        // Rename "case-only" (`nota.md` → `Nota.md`): su un filesystem
        // case-insensitive (macOS/Windows) `storage.exists` vede lo STESSO
        // file, non una collisione — e il check sul disco va saltato **perché è
        // lo stesso file**, non perché i due nomi si somiglino. La differenza
        // non è di stile: là dove il filesystem il caso lo distingue, `Nota.md`
        // è un omonimo vero, e saltare il check lo seppelliva senza dire niente
        // (0182). Chi risponde è il supporto, l'unico che lo sappia.
        let same_file = storage.same_file(&snapshot.from_path, &snapshot.to_path);
        if !same_file && storage.exists(&snapshot.to_path) {
            return Err(KernelError::AlreadyExists(snapshot.to.to_string()));
        }
        let mut recovery = rename_recovery::persist(
            Arc::clone(&storage),
            &recovery_root,
            snapshot.from.clone(),
            snapshot.to.clone(),
            fingerprint.clone(),
            durable_rewrites.clone(),
        )?;
        let rewrites = durable_rewrites
            .iter()
            .map(|rewrite| (rewrite.source().clone(), rewrite.request().clone()))
            .collect();
        // I dati per-documento si spostano **prima** del file (difetto 0168),
        // mentre `from` è ancora vivo: un crash fra le due lasciava il file al
        // nome nuovo e i dati sotto la chiave vecchia, dove la prima `collect`
        // li spazza. `sync_renamed_path_here` resta migrate-dopo: là il file
        // è già a `to`. Il registro `Renamed` resta dopo la mutazione del
        // file (0067).
        let side_data = side_data.invoke();
        if let Err(source) = storage.rename_no_replace(&snapshot.from_path, &snapshot.to_path) {
            let mut rollback_errors = side_data.rollback();
            if let Err(error) = recovery.cancel() {
                rollback_errors.push(format!("intent di recupero non cancellato: {error}"));
            }
            if source.kind() == std::io::ErrorKind::AlreadyExists {
                let to = if rollback_errors.is_empty() {
                    snapshot.to.to_string()
                } else {
                    format!(
                        "{}; anche il rollback è fallito: {}",
                        snapshot.to,
                        rollback_errors.join("; ")
                    )
                };
                return Err(KernelError::AlreadyExists(to));
            }
            let source = if rollback_errors.is_empty() {
                source
            } else {
                std::io::Error::new(
                    source.kind(),
                    format!(
                        "{source}; anche il rollback è fallito: {}",
                        rollback_errors.join("; ")
                    ),
                )
            };
            return Err(KernelError::Io {
                path: snapshot.from_path,
                source,
            });
        }
        Ok(ParsedExplicitRename {
            snapshot,
            storage,
            model,
            fingerprint,
            stat: after,
            identity,
            rewrites,
            side_data,
            recovery,
        })
    }
}
impl ParsedExplicitRename {
    /// Annulla una mossa che il workspace ha rifiutato al commit. Il token è
    /// one-shot e riporta il file indietro soltanto se la destinazione contiene
    /// ancora esattamente i byte mossi da questa invocazione.
    pub fn rollback(self) -> Result<()> {
        let ParsedExplicitRename {
            snapshot,
            storage,
            fingerprint,
            identity,
            side_data,
            mut recovery,
            ..
        } = self;
        let before = storage
            .stat(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let identity_before =
            storage
                .file_identity(&snapshot.to_path)
                .map_err(|source| KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                })?;
        let bytes = storage
            .read(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let after = storage
            .stat(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let identity_after =
            storage
                .file_identity(&snapshot.to_path)
                .map_err(|source| KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                })?;
        if !before.is_file()
            || before != after
            || identity_before != identity
            || identity_after != identity
            || Revision::of_bytes(&bytes) != fingerprint
        {
            return Err(KernelError::Stale(snapshot.to.to_string()));
        }
        recovery.mark_cancelled()?;
        let mut rollback_errors = side_data.rollback();
        if let Err(source) = storage.rename_no_replace(&snapshot.to_path, &snapshot.from_path) {
            let source = if rollback_errors.is_empty() {
                source
            } else {
                std::io::Error::new(
                    source.kind(),
                    format!(
                        "{source}; anche il rollback dei side-data è fallito: {}",
                        rollback_errors.join("; ")
                    ),
                )
            };
            return Err(KernelError::Io {
                path: snapshot.to_path,
                source,
            });
        }
        if let Err(error) = recovery.complete() {
            rollback_errors.push(format!("intent di recupero non rimosso: {error}"));
        }
        if rollback_errors.is_empty() {
            Ok(())
        } else {
            Err(KernelError::Io {
                path: snapshot.from_path,
                source: std::io::Error::other(format!(
                    "il file è stato ripristinato, ma il rollback è fallito: {}",
                    rollback_errors.join("; ")
                )),
            })
        }
    }
}
impl PendingExplicitRename {
    /// Esegue le callback remove+feed e registra il fatto usando handle owned,
    /// lasciando le riscritture al chiamante.
    pub fn invoke(self) -> CompletedExplicitRename {
        let PendingExplicitRename {
            identity,
            rewrites,
            side_data,
            recovery,
            journal,
            origin,
            from,
            to,
            owns_batch,
        } = self;
        let identity = identity.invoke();
        // La riga del rename va **prima** di quelle delle sorgenti riscritte:
        // sono tutte dentro lo stesso lotto, e chi le ripercorre all'indietro le
        // trova nell'ordine in cui `UndoStep` le vuole (0045: i passi sono in
        // ordine di esecuzione, e chi esegue non riordina).
        let journal_fault = journal
            .append(origin, JournalOp::Renamed { from, to })
            .err();
        CompletedExplicitRename {
            identity,
            rewrites,
            side_data,
            recovery,
            owns_batch,
            rewrite_failures: Vec::new(),
            journal_fault,
        }
    }
}

impl CompletedExplicitRename {
    /// Applica tutte le riscritture fuori dal workspace e conserva gli errori
    /// qualificati con la sorgente per il finalizzatore.
    pub fn invoke_rewrites<E>(
        mut self,
        mut apply: impl FnMut(&DocId, &EditRequest) -> std::result::Result<(), E>,
    ) -> Self
    where
        E: std::fmt::Display,
    {
        // Il piano si applica TUTTO, anche se una sorgente fallisce: abortire
        // a metà lascerebbe link misti vecchio/nuovo senza possibilità di
        // retry. Gli errori si accumulano per-sorgente e arrivano in coda.
        for (source, request) in &self.rewrites {
            if let Err(error) = apply(source, request) {
                self.rewrite_failures.push(format!("{source}: {error}"));
            }
        }
        if self.rewrite_failures.is_empty() {
            if let Err(error) = self.recovery.complete() {
                self.rewrite_failures
                    .push(format!("intent di recupero: {error}"));
            }
        }
        self
    }
}
/// Riscrittura format-owned, batch detached per sorgente.
///
/// Il kernel non conosce grammatica né escaping di alcun formato: per ogni
/// sorgente legge i byte nella forma del suo provider, invoca una volta
/// [`FormatProvider::rewrite_links`] sotto [`Gate::FormatParse`] e valida il
/// vincolo d'output — ogni [`TextEdit`] entro uno span osservato, bounds UTF-8,
/// patch non sovrapposte (validatore [`EditRequest`] esistente); ogni richiesta
/// effettiva coperta oppure errore esplicito. `None` = capability mancante, mai
/// fallback raw: errore tipizzato per la sorgente. Niente parsing JSON/Markdown
/// nel kernel, nessun provider sotto lock, nessuna omissione silenziosa.
/// La CAS di [`EditRequest`] resta la preimmagine per-file; i conflitti restano
/// [`KernelError::Stale`]/`AlreadyExists`, senza protocollo parallelo.
fn invoke_prepared_link_rewrites(
    storage: &dyn crate::storage::VaultStorage,
    rewrites: Vec<PreparedExplicitLinkRewrite>,
) -> Result<Vec<RenameRecoveryEdit>> {
    let mut out = Vec::new();
    for prepared in rewrites {
        let bytes = storage
            .read(&prepared.source_path)
            .map_err(|source| KernelError::Io {
                path: prepared.source_path.clone(),
                source,
            })?;
        let source = match prepared.source_kind {
            SourceKind::Text => {
                let text =
                    fub_abi::rules::text_policy::decode(&bytes).map_err(|at| KernelError::Io {
                        path: prepared.source_path.clone(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("il file non è UTF-8: il primo byte non valido è a {at}"),
                        ),
                    })?;
                DocumentSource::Text(text.to_string())
            }
            SourceKind::Bytes => DocumentSource::Bytes(bytes),
        };
        let revision = match &source {
            DocumentSource::Text(text) => Revision::of(text),
            DocumentSource::Bytes(bytes) => Revision::of_bytes(bytes),
        };
        let Some(provider) = prepared.provider.clone() else {
            return Err(KernelError::Format(FormatError::Parse(format!(
                "il formato di {} non offre la riscrittura dei link",
                prepared.destination
            ))));
        };
        let provider_id = prepared.provider_id.clone();
        let destination = prepared.destination.clone();
        let ctx = prepared.ctx.clone();
        let wanted = prepared.rewrites.clone();
        let edits = crate::safety::caught(
            &provider_id,
            Gate::FormatParse,
            destination.as_str(),
            FormatError::Parse,
            || provider.rewrite_links(&source, &ctx, &wanted),
        )?
        .ok_or_else(|| {
            KernelError::Format(FormatError::Parse(format!(
                "il formato di {destination} non offre la riscrittura dei link"
            )))
        })?;
        validate_rewrite_output(&wanted, &edits, &source, &destination)?;
        if edits.is_empty() {
            continue;
        }
        let request = EditRequest::new(revision, edits);
        let result = match &source {
            DocumentSource::Text(text) => {
                let (next, _) = request
                    .apply_to(text)
                    .map_err(|error| KernelError::BadEdit {
                        doc: destination.to_string(),
                        why: error.to_string(),
                    })?;
                Revision::of(&next)
            }
            DocumentSource::Bytes(_) => {
                unreachable!("validate_rewrite_output rejects edits over a byte source")
            }
        };
        out.push(RenameRecoveryEdit::new(destination, request, result));
    }
    Ok(out)
}

/// Vincolo d'output della porta format-owned: copertura totale, confini
/// dichiarati, validità UTF-8 e non sovrapposizione. Riusa il validatore
/// [`EditRequest`]; qui si aggiunge solo il recinto (entro span osservati) e la
/// copertura (ogni richiesta effettiva servita oppure errore esplicito).
fn validate_rewrite_output(
    wanted: &[LinkRewrite],
    edits: &[TextEdit],
    source: &DocumentSource,
    destination: &DocId,
) -> Result<()> {
    let text = match source {
        DocumentSource::Text(text) => text.as_str(),
        DocumentSource::Bytes(_) => {
            return Err(KernelError::Format(FormatError::Parse(format!(
                "riscrittura dei link non applicabile a una sorgente non testuale in {destination}"
            ))));
        }
    };
    if !wanted.is_empty() && edits.is_empty() {
        return Err(KernelError::Format(FormatError::Parse(format!(
            "il formato di {destination} non ha riscritto alcun riferimento richiesto"
        ))));
    }
    for edit in edits {
        let inside = wanted
            .iter()
            .any(|want| edit.span.start >= want.span.start && edit.span.end <= want.span.end);
        if !inside {
            return Err(KernelError::Format(FormatError::Parse(format!(
                "il formato di {destination} ha scritto fuori dai riferimenti dichiarati"
            ))));
        }
    }
    EditRequest::new(Revision::of(text), edits.to_vec())
        .apply_to(text)
        .map(|_| ())
        .map_err(|and| KernelError::BadEdit {
            doc: destination.to_string(),
            why: and.to_string(),
        })
}

impl PreparedExplicitAssetRename {
    /// Verifica l'identità dell'asset, prepara le CAS dei riferimenti e
    /// persiste l'intent recuperabile prima di migrare side-data o file.
    pub fn invoke(self) -> Result<MovedExplicitAssetRename> {
        let PreparedExplicitAssetRename {
            snapshot,
            storage,
            rewrites,
            side_data,
            recovery_root,
        } = self;
        let path = snapshot.from_path.clone();
        let before = storage.stat(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        if !before.is_file() {
            return Err(KernelError::NotFound(snapshot.from.to_string()));
        }
        let identity_before = storage
            .file_identity(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        let bytes = storage.read(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        let after = storage.stat(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        let identity_after = storage
            .file_identity(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        if !after.is_file() || before != after || identity_before != identity_after {
            return Err(KernelError::Stale(snapshot.from.to_string()));
        }
        let identity = identity_after;
        let fingerprint = Revision::of_bytes(&bytes);
        let durable_rewrites = invoke_prepared_link_rewrites(storage.as_ref(), rewrites)?;
        let same_file = storage.same_file(&snapshot.from_path, &snapshot.to_path);
        if !same_file && storage.exists(&snapshot.to_path) {
            return Err(KernelError::AlreadyExists(snapshot.to.to_string()));
        }
        let mut recovery = rename_recovery::persist(
            Arc::clone(&storage),
            &recovery_root,
            snapshot.from.clone(),
            snapshot.to.clone(),
            fingerprint.clone(),
            durable_rewrites.clone(),
        )?;
        let rewrites = durable_rewrites
            .iter()
            .map(|rewrite| (rewrite.source().clone(), rewrite.request().clone()))
            .collect();
        let side_data = side_data.invoke();
        if let Err(source) = storage.rename_no_replace(&snapshot.from_path, &snapshot.to_path) {
            let mut rollback_errors = side_data.rollback();
            if let Err(error) = recovery.cancel() {
                rollback_errors.push(format!("intent di recupero non cancellato: {error}"));
            }
            if source.kind() == std::io::ErrorKind::AlreadyExists {
                let to = if rollback_errors.is_empty() {
                    snapshot.to.to_string()
                } else {
                    format!(
                        "{}; anche il rollback è fallito: {}",
                        snapshot.to,
                        rollback_errors.join("; ")
                    )
                };
                return Err(KernelError::AlreadyExists(to));
            }
            let source = if rollback_errors.is_empty() {
                source
            } else {
                std::io::Error::new(
                    source.kind(),
                    format!(
                        "{source}; anche il rollback è fallito: {}",
                        rollback_errors.join("; ")
                    ),
                )
            };
            return Err(KernelError::Io {
                path: snapshot.from_path,
                source,
            });
        }
        Ok(MovedExplicitAssetRename {
            snapshot,
            storage,
            fingerprint,
            stat: after,
            identity,
            rewrites,
            side_data,
            recovery,
        })
    }
}

impl MovedExplicitAssetRename {
    /// Ripristina esattamente il file mosso se il commit del core lo rifiuta.
    pub fn rollback(self) -> Result<()> {
        let MovedExplicitAssetRename {
            snapshot,
            storage,
            fingerprint,
            stat,
            identity,
            side_data,
            mut recovery,
            ..
        } = self;
        let before = storage
            .stat(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let identity_before =
            storage
                .file_identity(&snapshot.to_path)
                .map_err(|source| KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                })?;
        let bytes = storage
            .read(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let after = storage
            .stat(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let identity_after =
            storage
                .file_identity(&snapshot.to_path)
                .map_err(|source| KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                })?;
        if !before.is_file()
            || before != stat
            || before != after
            || identity_before != identity
            || identity_after != identity
            || Revision::of_bytes(&bytes) != fingerprint
        {
            return Err(KernelError::Stale(snapshot.to.to_string()));
        }
        recovery.mark_cancelled()?;
        let mut rollback_errors = side_data.rollback();
        if let Err(source) = storage.rename_no_replace(&snapshot.to_path, &snapshot.from_path) {
            let source = if rollback_errors.is_empty() {
                source
            } else {
                std::io::Error::new(
                    source.kind(),
                    format!(
                        "{source}; anche il rollback dei side-data è fallito: {}",
                        rollback_errors.join("; ")
                    ),
                )
            };
            return Err(KernelError::Io {
                path: snapshot.to_path,
                source,
            });
        }
        if let Err(error) = recovery.complete() {
            rollback_errors.push(format!("intent di recupero non rimosso: {error}"));
        }
        if rollback_errors.is_empty() {
            Ok(())
        } else {
            Err(KernelError::Io {
                path: snapshot.from_path,
                source: std::io::Error::other(format!(
                    "l'asset è stato ripristinato, ma il rollback è fallito: {}",
                    rollback_errors.join("; ")
                )),
            })
        }
    }
}

impl PendingExplicitAssetRename {
    /// Registra il fatto e applica le riscritture tramite callback del chiamante.
    pub fn invoke_rewrites<E>(
        self,
        mut apply: impl FnMut(&DocId, &EditRequest) -> std::result::Result<(), E>,
    ) -> CompletedExplicitAssetRename
    where
        E: std::fmt::Display,
    {
        let PendingExplicitAssetRename {
            workspace_id,
            installed,
            rewrites,
            side_data,
            recovery,
            journal,
            origin,
            from,
            to,
            owns_batch,
        } = self;
        // Un allegato spostato è una mutazione del vault come le altre: il
        // registro non conosce la differenza fra un documento e un file di cui
        // nessuno sa il formato, e non deve — l'inverso è lo stesso.
        let journal_fault = journal
            .append(
                origin,
                JournalOp::Renamed {
                    from: from.clone(),
                    to: to.clone(),
                },
            )
            .err();
        let mut rewrite_failures = Vec::new();
        for (source, request) in &rewrites {
            if let Err(error) = apply(source, request) {
                rewrite_failures.push(format!("{source}: {error}"));
            }
        }
        if rewrite_failures.is_empty() {
            if let Err(error) = recovery.complete() {
                rewrite_failures.push(format!("intent di recupero: {error}"));
            }
        }
        CompletedExplicitAssetRename {
            workspace_id,
            installed,
            side_data,
            from,
            to,
            owns_batch,
            rewrite_failures,
            journal_fault,
        }
    }
}

impl PendingIdentityMigration {
    fn invoke(self) -> CompletedIdentityMigration {
        CompletedIdentityMigration {
            workspace_id: self.workspace_id,
            from: self.from,
            to: self.to,
            installed: self.installed,
            removal: self.removal.invoke(),
            feed: self.feed.invoke_indexes(),
        }
    }
}

impl PreparedExternalDocumentRename {
    /// Esegue stat-read-stat e parse nella forma dichiarata dal formato.
    pub fn invoke(self) -> ParsedExternalDocumentRename {
        let PreparedExternalDocumentRename {
            snapshot,
            storage,
            parser,
            source_kind,
            side_data,
        } = self;
        let state = match storage.stat(&snapshot.to_path) {
            Ok(before) if before.is_file() => match storage.read(&snapshot.to_path) {
                Ok(bytes) => match storage.stat(&snapshot.to_path) {
                    Ok(after) if after.is_file() && before == after => {
                        let fingerprint = Revision::of_bytes(&bytes);
                        let source =
                            match source_kind {
                                SourceKind::Text => {
                                    match fub_abi::rules::text_policy::decode(&bytes) {
                                    Ok(text) => Ok(DocumentSource::Text(text.to_string())),
                                    Err(at) => Err(KernelError::Io {
                                        path: snapshot.to_path.clone(),
                                        source: std::io::Error::new(
                                            std::io::ErrorKind::InvalidData,
                                            format!(
                                                "il file non è UTF-8: il primo byte non valido è a {at}"
                                            ),
                                        ),
                                    }),
                                }
                                }
                                SourceKind::Bytes => Ok(DocumentSource::Bytes(bytes)),
                            };
                        match source.and_then(|source| parser.invoke(source)) {
                            Ok(model) => ParsedExternalDocumentState::Ready {
                                model: Box::new(model),
                                fingerprint,
                                stat: after,
                            },
                            Err(error) => ParsedExternalDocumentState::Failed(error),
                        }
                    }
                    Ok(_) => ParsedExternalDocumentState::Stale,
                    Err(error) if sync_path_is_absent(&error) => ParsedExternalDocumentState::Stale,
                    Err(source) => ParsedExternalDocumentState::Failed(KernelError::Io {
                        path: snapshot.to_path.clone(),
                        source,
                    }),
                },
                Err(error) if sync_path_is_absent(&error) => ParsedExternalDocumentState::Stale,
                Err(source) => ParsedExternalDocumentState::Failed(KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                }),
            },
            Ok(_) => ParsedExternalDocumentState::Stale,
            Err(error) if sync_path_is_absent(&error) => ParsedExternalDocumentState::Stale,
            Err(source) => ParsedExternalDocumentState::Failed(KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            }),
        };
        ParsedExternalDocumentRename {
            snapshot,
            state,
            side_data,
        }
    }
}

impl PreparedRenameSideData {
    fn invoke(self) -> CompletedRenameSideData {
        let rollback = PreparedRenameSideData {
            from: self.to.clone(),
            to: self.from.clone(),
            organization: Arc::clone(&self.organization),
            drafts: Arc::clone(&self.drafts),
            storage: Arc::clone(&self.storage),
            doc_data_roots: self.doc_data_roots.clone(),
        };
        let PreparedRenameSideData {
            from,
            to,
            organization,
            drafts,
            storage,
            doc_data_roots,
        } = self;
        if let Err(error) = organization.migrate(from.as_str(), to.as_str()) {
            organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in {to}: {error}"
            ));
        }
        let mut errors =
            crate::docdata::migrate_data(storage.as_ref(), &doc_data_roots, &from, &to);
        if let Err(error) = drafts.migrate(&from, &to) {
            errors.push(format!("bozza non migrata: {error}"));
        }
        CompletedRenameSideData {
            from,
            to,
            errors,
            rollback: Some(rollback),
        }
    }
}

impl CompletedRenameSideData {
    fn rollback(mut self) -> Vec<String> {
        let Some(rollback) = self.rollback.take() else {
            return vec!["ricevuta di rollback già consumata".into()];
        };
        let PreparedRenameSideData {
            from,
            to,
            organization,
            drafts,
            storage,
            doc_data_roots,
        } = rollback;
        let mut errors = Vec::new();
        if let Err(error) = organization.migrate(from.as_str(), to.as_str()) {
            errors.push(format!("organizzazione non ripristinata: {error}"));
        }
        errors.extend(crate::docdata::migrate_data(
            storage.as_ref(),
            &doc_data_roots,
            &from,
            &to,
        ));
        if let Err(error) = drafts.migrate(&from, &to) {
            errors.push(format!("bozza non ripristinata: {error}"));
        }
        errors
    }
}
impl PreparedAssetRenameSideData {
    fn invoke(self) -> CompletedAssetRenameSideData {
        let rollback = PreparedAssetRenameSideData {
            from: self.to.clone(),
            to: self.from.clone(),
            organization: Arc::clone(&self.organization),
            storage: Arc::clone(&self.storage),
            doc_data_roots: self.doc_data_roots.clone(),
        };
        let PreparedAssetRenameSideData {
            from,
            to,
            organization,
            storage,
            doc_data_roots,
        } = self;
        // Seguono l'allegato le due cose che seguono ogni identità che cambia:
        // ciò che l'utente gli ha attaccato addosso (§11.3) e lo spazio
        // per-documento di chiunque altro (§13.2). Un allegato può essere
        // appuntato e può avere una miniatura, e nessuna delle due è meno sua
        // per il fatto che nessuno lo parsa.
        if let Err(error) = organization.migrate(from.as_str(), to.as_str()) {
            organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in {to}: {error}"
            ));
        }
        let errors = crate::docdata::migrate_data(storage.as_ref(), &doc_data_roots, &from, &to);
        CompletedAssetRenameSideData {
            from,
            to,
            errors,
            rollback: Some(rollback),
        }
    }
}

impl CompletedAssetRenameSideData {
    fn rollback(mut self) -> Vec<String> {
        let Some(rollback) = self.rollback.take() else {
            return vec!["ricevuta di rollback asset già consumata".into()];
        };
        let PreparedAssetRenameSideData {
            from,
            to,
            organization,
            storage,
            doc_data_roots,
        } = rollback;
        let mut errors = Vec::new();
        if let Err(error) = organization.migrate(from.as_str(), to.as_str()) {
            errors.push(format!("organizzazione non ripristinata: {error}"));
        }
        errors.extend(crate::docdata::migrate_data(
            storage.as_ref(),
            &doc_data_roots,
            &from,
            &to,
        ));
        errors
    }
}

impl PendingExternalDocumentRename {
    /// Notifica remove+feed e migra i dati autorevoli senza detenere il workspace.
    pub fn invoke(self) -> CompletedExternalDocumentRename {
        let PendingExternalDocumentRename {
            snapshot,
            installed,
            removal,
            feed,
            side_data,
        } = self;
        CompletedExternalDocumentRename {
            snapshot,
            installed,
            removal: removal.invoke(),
            feed: feed.invoke_indexes(),
            side_data: side_data.invoke(),
        }
    }
}

impl PreparedExternalAssetRename {
    /// Verifica la destinazione con stat-read-stat e, se non è un file stabile,
    /// invoca i due piani per-path già fotografati. Tutto il filesystem resta
    /// fuori da Custody.
    pub fn invoke(self) -> ParsedExternalRename {
        let PreparedExternalAssetRename {
            snapshot,
            storage,
            organization,
            doc_data_roots,
            fallback,
        } = self;
        let verified = match storage.stat(&snapshot.to_path) {
            Ok(before) if before.is_file() => match storage.read(&snapshot.to_path) {
                Ok(bytes) => match storage.stat(&snapshot.to_path) {
                    Ok(after) if after.is_file() && before == after => {
                        Some((after, Revision::of_bytes(&bytes)))
                    }
                    _ => None,
                },
                Err(_) => None,
            },
            _ => None,
        };
        match verified {
            Some((stat, fingerprint)) => {
                ParsedExternalRename::Asset(Box::new(ParsedExternalAssetRename {
                    snapshot,
                    stat,
                    fingerprint,
                    organization,
                    storage,
                    doc_data_roots,
                }))
            }
            None => ParsedExternalRename::Sync(
                fallback
                    .into_iter()
                    .map(|(path, plan)| (path, plan.map(SyncPlan::invoke)))
                    .collect(),
            ),
        }
    }
}

impl PendingExternalAssetRename {
    /// Migra i dati autorevoli dell'asset senza detenere il workspace.
    pub fn invoke(self) -> CompletedExternalAssetRename {
        let PendingExternalAssetRename {
            snapshot,
            installed,
            organization,
            storage,
            doc_data_roots,
        } = self;
        if let Err(error) = organization.migrate(snapshot.from_id.as_str(), snapshot.to_id.as_str())
        {
            organization.warn(format!(
                "l'organizzazione di {} non ha potuto seguire la rinomina in {}: {error}",
                snapshot.from_id, snapshot.to_id
            ));
        }
        let doc_data_errors = crate::docdata::migrate_data(
            storage.as_ref(),
            &doc_data_roots,
            &snapshot.from_id,
            &snapshot.to_id,
        );
        CompletedExternalAssetRename {
            snapshot,
            installed,
            doc_data_errors,
        }
    }
}

impl PreparedCatchUp {
    /// Cammina e legge il vault senza conservare alcun prestito del workspace.
    ///
    /// Soltanto un `size + mtime` uguale rende il file eleggibile al salto, e
    /// l'impronta sui byte decide poi se è davvero rimasto uguale. Un metadato
    /// diverso o una lettura fallita resta candidato.
    pub fn invoke(self) -> Result<CatchUpSnapshot> {
        let PreparedCatchUp { vault, entries } = self;
        // La camminata è quella della scansione — stessa politica di
        // esclusione, stesse specie.
        let scanned = vault.scan()?;
        let mut candidates = BTreeMap::new();
        let mut on_disk = BTreeSet::new();
        for file in scanned.files {
            let unchanged = entries
                .get(&file.id)
                .filter(|entry| entry.size == file.size && entry.mtime == file.mtime)
                .and_then(|entry| entry.fingerprint.as_ref())
                .is_some_and(|fingerprint| {
                    vault
                        .read_bytes(&file.id)
                        .is_ok_and(|bytes| fingerprint.matches_bytes(&bytes))
                });
            on_disk.insert(file.id.clone());
            if !unchanged {
                candidates.insert(file.id.clone(), vault.root().join(file.id.as_str()));
            }
        }
        // Ciò che l'anagrafe aveva e il disco non ha più: un file sparito
        // nella finestra resta un candidato, e lo toglie chi applica il suo
        // piano — la strada intera, che è dove lo sparito si toglie.
        for id in entries.keys() {
            if on_disk.contains(id) {
                continue;
            }
            let path = vault.root().join(id.as_str());
            if !vault.is_ignored(&path) {
                candidates.insert(id.clone(), path);
            }
        }
        Ok(CatchUpSnapshot { candidates })
    }
}

impl PendingSyncChange {
    /// Esegue la sola callback esterna successiva alla mutazione del core.
    pub fn invoke(self) -> CompletedSyncChange {
        let PendingSyncChange { snapshot, state } = self;
        let state = match state {
            PendingSyncState::Feed {
                feed,
                previous_provider_call,
            } => CompletedSyncState::Feed {
                feed: Box::new((*feed).invoke_indexes()),
                previous_provider_call,
            },
            PendingSyncState::Removal(removal) => CompletedSyncState::Removal(removal.invoke()),
            PendingSyncState::Entry(stat) => CompletedSyncState::Entry(stat),
            PendingSyncState::Unchanged(stat) => CompletedSyncState::Unchanged(stat),
        };
        CompletedSyncChange { snapshot, state }
    }
}

fn invoke_sync_read(
    snapshot: &SyncSnapshot,
    storage: &dyn crate::storage::VaultStorage,
    parser: PreparedParse,
    source_kind: SourceKind,
    already_ingested: bool,
) -> ParsedChangeState {
    let before = match storage.stat(&snapshot.path) {
        Ok(stat) if stat.is_file() => stat,
        Ok(_) => return ParsedChangeState::Unstable,
        Err(error) if sync_path_is_absent(&error) => return ParsedChangeState::Missing,
        Err(source) => {
            return ParsedChangeState::Failed(KernelError::Io {
                path: snapshot.path.clone(),
                source,
            })
        }
    };
    let bytes = match storage.read(&snapshot.path) {
        Ok(bytes) => bytes,
        Err(error) if sync_path_is_absent(&error) => return ParsedChangeState::Missing,
        Err(source) => {
            return ParsedChangeState::Failed(KernelError::Io {
                path: snapshot.path.clone(),
                source,
            })
        }
    };
    let after = match storage.stat(&snapshot.path) {
        Ok(stat) if stat.is_file() => stat,
        Ok(_) => return ParsedChangeState::Unstable,
        Err(error) if sync_path_is_absent(&error) => return ParsedChangeState::Missing,
        Err(source) => {
            return ParsedChangeState::Failed(KernelError::Io {
                path: snapshot.path.clone(),
                source,
            })
        }
    };
    if before != after {
        return ParsedChangeState::Unstable;
    }
    let fingerprint = Revision::of_bytes(&bytes);
    // L'eco della propria scrittura non si riparsa (§14.1, difetto 0196).
    if already_ingested && snapshot.seen.as_ref() == Some(&fingerprint) {
        return ParsedChangeState::Unchanged(after);
    }
    let source = match source_kind {
        SourceKind::Text => match fub_abi::rules::text_policy::decode(&bytes) {
            Ok(text) => DocumentSource::Text(text.to_string()),
            Err(at) => {
                return ParsedChangeState::Failed(KernelError::Io {
                    path: snapshot.path.clone(),
                    source: std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!(
                            "il file non è UTF-8: il primo byte non valido è a {at} \
                             (0x{:02X}), su {} byte in tutto",
                            bytes.get(at).copied().unwrap_or(0),
                            bytes.len()
                        ),
                    ),
                })
            }
        },
        SourceKind::Bytes => DocumentSource::Bytes(bytes),
    };
    match parser.invoke(source) {
        Ok(model) => ParsedChangeState::Ready {
            model: Box::new(model),
            fingerprint,
            stat: after,
        },
        Err(error) => ParsedChangeState::Failed(error),
    }
}

fn sync_path_is_absent(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::InvalidInput
    ) || matches!(error.raw_os_error(), Some(2 | 3 | 123))
}

/// Una fetta dell'apertura già letta e parsata, che aspetta di entrare nel workspace.
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
#[derive(Default)]
pub struct ParsedBatch {
    /// Le voci della fetta, con l'impronta che la lettura ha imparato.
    read: Vec<VaultEntry>,
    /// Ciò che si è ripreso dalla cache invece di riparsarlo.
    reused: Vec<(DocId, StoredMeta)>,
    /// Ciò che si è letto e parsato.
    models: Vec<DocumentModel>,
    /// **L'impronta che l'anagrafe attribuiva a ogni voce quando il piano è
    /// stato fatto.** Vedi [`Workspace::index_batch_prepared`].
    ///
    /// È per documento e non per fetta: fra il piano e l'applicazione l'utente
    /// salva *una* nota, e buttare le altre novecentonovantanove vorrebbe dire
    /// rileggerle dal disco per niente.
    seen: BTreeMap<DocId, Option<Revision>>,
}

struct PendingIndexEntry {
    entry: VaultEntry,
    source: Option<DocumentSource>,
}

/// Il risultato di un pezzo di fetta lavorato da un thread: le voci della
/// fetta, con l'impronta che la lettura ha imparato, ma senza `seen` (che si
/// calcola una volta per tutta la fetta). Si fondono in
/// [`Workspace::prepare_index_batch_check`].
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

/// Come il `Workspace` tiene aggiornato il grafo dopo una modifica.
///
/// L'incrementale è il percorso normale; il rebuild completo resta disponibile
/// come rete di sicurezza (e come oracolo nei test) finché non ci fidiamo
/// ciecamente dell'invalidazione — vedi `../../../docs/project/status.md`.
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

/// Un gancio **prima della scrittura**: ciò che una feature vuole fare con
/// l'originale un istante prima che venga sovrascritto (0154).
///
/// È generico — un id di plugin e una chiusura — perché il kernel non sa cosa
/// sia una fotografia: sa solo che c'è un momento, fra il parse e il disco, in
/// cui il contenuto che sta per sparire è ancora leggibile, e che qualcuno può
/// volerlo guardare. Nessun gancio è il default e non è un difetto: la maggior
/// parte dei montaggi non registra niente.
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
/// Frame del solo rebuild di manutenzione che l'host porta avanti senza una
/// guardia del workspace. Attore, batch, pila e rinvio degli eventi restano
/// aperti fino alla riconciliazione finale.
pub struct PreparedMaintenanceRebuild {
    owner: String,
    command: String,
    mode: InvokeMode,
    previous_actor: Option<Actor>,
    owns_batch: bool,
    previous_dispatch_deferral: bool,
}

impl PreparedMaintenanceRebuild {
    pub fn mode(&self) -> InvokeMode {
        self.mode
    }
}

/// Stato owned di un annullamento fra un passo e il successivo.
///
/// Il token tiene aperti replay e batch senza prestare il [`Workspace`], così
/// un host può eseguire provider, parser e indici dopo avere rilasciato il
/// proprio guard. Va sempre riconsegnato a
/// [`Workspace::finish_undo_replay_deferred`].
pub struct UndoReplay {
    entry: crate::undo::Entry,
    next: usize,
    done: usize,
    failure: Option<Failure>,
    /// Com'era la bandiera prima: un annullamento annidato non spegne quello di
    /// fuori uscendo.
    before_replay: bool,
    owns_batch: bool,
}

/// Epilogo di undo da completare soltanto dopo il drain degli eventi.
pub struct DeferredUndo {
    entry: crate::undo::Entry,
    done: usize,
    failure: Option<Failure>,
    before_replay: bool,
}

impl UndoReplay {
    /// Il prossimo passo, owned perché deve poter attraversare il confine del
    /// guard del workspace.
    pub fn next_step(&self) -> Option<UndoStep> {
        if self.failure.is_some() {
            return None;
        }
        self.entry.undo.steps.get(self.next).cloned()
    }

    /// Riconsegna l'esito del passo appena estratto.
    pub fn finish_step(&mut self, outcome: std::result::Result<(), Failure>) {
        debug_assert!(
            self.failure.is_none() && self.next < self.entry.undo.steps.len(),
            "un esito di undo deve seguire un passo preparato"
        );
        match outcome {
            Ok(()) => {
                self.done += 1;
                self.next += 1;
            }
            Err(failure) => self.failure = Some(failure),
        }
    }

    /// Registra nel token che il passo in corso è uscito per unwind.
    ///
    /// Il payload resta al driver, che lo riprenderà dopo l'epilogo. Qui serve
    /// soltanto distinguere l'interruzione da un replay completo: se nessun
    /// passo era riuscito, la normale chiusura rimette la voce in pila.
    pub fn finish_unwind(&mut self) {
        if self.failure.is_none() {
            self.failure = Some(Failure::other(PluginError::Internal(
                "undo interrotto da un panic".into(),
            )));
        }
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
        // La rete contro i panici sta **attorno alla chiamata del provider** e
        // a niente di più (§9.3): tutto ciò che viene dopo — la pila dei
        // servizi da svuotare, il dispatch da drenare, in
        // `finish_service_call` — è già scritto per girare sul ramo
        // dell'errore, e catturare più in alto lo salterebbe.
        crate::safety::calling(
            &self.owner,
            Gate::Service,
            &format!("{}.{}", self.service, self.method),
            || self.provider.call(&self.service, &self.method, args, host),
        )
    }
}

thread_local! {
    /// Gli [`ImportProvider`] che questo thread sta eseguendo, per indirizzo.
    ///
    /// `import` chiede `&mut self`, quindi ogni importer sta dietro il proprio
    /// lucchetto esclusivo. Un secondo import sullo stesso thread — l'importer
    /// che, importando, chiede all'host una sorgente che riconosce lui stesso —
    /// lo aspetterebbe per sempre: lo si rifiuta. Da un altro thread si
    /// aspetta il turno, come per ogni scrittura.
    static IMPORTING: std::cell::RefCell<Vec<usize>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

type SharedImport = Arc<SharedShelter<Box<dyn ImportProvider>>>;

fn import_key(provider: &SharedImport) -> usize {
    Arc::as_ptr(provider) as *const () as usize
}

fn importing_here(provider: &SharedImport) -> bool {
    let key = import_key(provider);
    IMPORTING.with(|running| running.borrow().contains(&key))
}

/// L'iscrizione di un import in corso su questo thread; uscire dallo scope,
/// anche per un panico, la toglie.
struct Importing(usize);

impl Importing {
    fn enter(provider: &SharedImport) -> Importing {
        let key = import_key(provider);
        IMPORTING.with(|running| running.borrow_mut().push(key));
        Importing(key)
    }
}

impl Drop for Importing {
    fn drop(&mut self) {
        IMPORTING.with(|running| {
            let mut running = running.borrow_mut();
            if let Some(at) = running.iter().rposition(|key| *key == self.0) {
                running.remove(at);
            }
        });
    }
}

fn reentrant_import(owner: &str) -> PluginError {
    PluginError::Conflict(
        format!("`{owner}` is already importing: an import cannot re-enter its own importer")
            .into(),
    )
}

/// Gli [`ImportProvider`] registrati, presi sotto lock e interpellabili senza
/// tenere `Custody<Workspace>`: un import può durare quanto la rete che lo
/// alimenta, e intanto il workspace resta di tutti.
///
/// Il dispatch è quello di [`Workspace::import`]: in ordine di registrazione,
/// il primo che riconosce la sorgente.
pub struct PreparedImport {
    candidates: Vec<(String, SharedImport)>,
}

impl PreparedImport {
    /// La posizione del primo importer che riconosce `source`.
    ///
    /// Nessuno → `BadArgs`: il kernel non ha un formato di riserva, e fingere
    /// di averlo produrrebbe note vuote.
    pub fn choose(&self, source: &ImportSource) -> std::result::Result<usize, PluginError> {
        for (at, (owner, provider)) in self.candidates.iter().enumerate() {
            if importing_here(provider) {
                return Err(reentrant_import(owner));
            }
            if provider.read().can_handle(source) {
                return Ok(at);
            }
        }
        Err(PluginError::BadArgs(
            format!(
                "nessun ImportProvider registrato riconosce `{}`",
                source.name
            )
            .into(),
        ))
    }

    /// Chi ha registrato l'importer in `at`: l'host con cui chiamarlo è il suo.
    pub fn owner(&self, at: usize) -> &str {
        &self.candidates[at].0
    }

    /// Esegue soltanto il codice esterno, con l'host che chi chiama ha
    /// intestato a [`owner`](Self::owner).
    pub fn invoke(
        &self,
        at: usize,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> std::result::Result<ImportReport, PluginError> {
        let (owner, provider) = &self.candidates[at];
        if importing_here(provider) {
            return Err(reentrant_import(owner));
        }
        let _importing = Importing::enter(provider);
        let mut provider = provider.write();
        provider.import(source, request, host)
    }
}

/// Gli [`ExportProvider`] registrati, presi sotto lock e interpellabili senza
/// tenere `Custody<Workspace>`. `export` prende `&self`, quindi più export
/// girano insieme anche sullo stesso provider.
pub struct PreparedExport {
    candidates: Vec<(String, Arc<dyn ExportProvider>)>,
}

impl PreparedExport {
    /// Le destinazioni offerte, in ordine di registrazione.
    pub fn targets(&self) -> Vec<ExportTarget> {
        self.candidates
            .iter()
            .flat_map(|(_, provider)| provider.targets())
            .collect()
    }

    /// La posizione del provider che offre `target`; nessuno → `BadArgs`.
    pub fn choose(&self, target: &str) -> std::result::Result<usize, PluginError> {
        self.candidates
            .iter()
            .position(|(_, provider)| provider.targets().iter().any(|t| t.id == target))
            .ok_or_else(|| {
                PluginError::BadArgs(format!("destinazione di export ignota: `{target}`").into())
            })
    }

    /// Chi ha registrato il provider in `at`: l'host con cui chiamarlo è il suo.
    pub fn owner(&self, at: usize) -> &str {
        &self.candidates[at].0
    }

    /// Esegue soltanto il codice esterno, con l'host di sola lettura che chi
    /// chiama ha intestato a [`owner`](Self::owner).
    pub fn invoke(
        &self,
        at: usize,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> std::result::Result<ExportReport, PluginError> {
        self.candidates[at].1.export(request, host, out)
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
/// Interests di [`ViewProvider`] risolti sotto lock e invocabili senza tenere
/// una guardia di [`Workspace`]. Il provider resta registrato tramite un
/// `Arc`, mentre la consistenza della registrazione viene verificata in
/// `Workspace::finish_view_interests`.
pub struct PreparedViewInterests {
    owner: String,
    view: String,
    instance: ViewInstance,
    provider: Arc<SharedShelter<Box<dyn ViewProvider>>>,
    generation: Arc<()>,
}

impl PreparedViewInterests {
    /// Esegue soltanto la callback esterna del provider.
    pub fn invoke(&self) -> std::result::Result<ViewInterests, PluginError> {
        let provider = self.provider.read();
        crate::safety::calling(&self.owner, Gate::ViewRender, &self.view, || {
            Ok(provider.interests(&self.instance))
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

/// Un gancio prima della scrittura pronto da chiamare, con l'owner a cui
/// intestare l'host.
///
/// I ganci sono uno per owner e girano nell'ordine di registrazione; il primo
/// errore ferma la scrittura e i ganci che seguono non girano. Chi scrive fuori
/// dal workspace (l'host) li percorre con [`PreparedDocumentWrite::before_write`]
/// e dà a ciascuno un proxy con le capacità del **suo** owner: un gancio non
/// presta le proprie capacità a quello dopo.
///
/// Il gancio è soltanto nativo: il WIT non ha un export per lui, quindi un
/// componente WASM non può registrarne uno.
pub struct BeforeWriteCall<'a> {
    owner: &'a str,
    hook: &'a BeforeWriteHook,
    id: &'a DocId,
}

impl BeforeWriteCall<'_> {
    /// Il plugin che ha registrato il gancio.
    pub fn owner(&self) -> &str {
        self.owner
    }

    /// Chiama il gancio; un panico diventa un errore che nomina l'owner.
    pub fn invoke(&self, host: &mut dyn HostApi) -> std::result::Result<(), PluginError> {
        crate::safety::calling_callback(self.owner, "BeforeWriteHook", || {
            (self.hook)(host, self.id)
        })
    }
}

fn before_write_calls<'a>(
    hooks: &'a [(String, BeforeWriteHook)],
    id: &'a DocId,
) -> impl Iterator<Item = BeforeWriteCall<'a>> {
    hooks
        .iter()
        .map(move |(owner, hook)| BeforeWriteCall { owner, hook, id })
}

/// Scrittura risolta fino al confine del codice esterno. Non porta guardie del
/// workspace: può essere parsata mentre `Custody<Workspace>` è rilasciato.
pub struct PreparedDocumentWrite {
    id: DocId,
    existed: bool,
    from: Option<Revision>,
    expected_source: Option<String>,
    parser: PreparedParse,
    before_write: Vec<(String, BeforeWriteHook)>,
}

/// Scrittura raw preparata senza eseguire provider. La preimmagine resta quella
/// verificata all'apertura del turno, anche se il file cambia durante il parse.
pub struct PreparedDocumentBytesWrite {
    id: DocId,
    path: Utf8PathBuf,
    from: Option<Revision>,
    expected_bytes: Option<Vec<u8>>,
    parser: Option<PreparedParse>,
    before_write: Vec<(String, BeforeWriteHook)>,
}

/// Apertura metadata sullo storage attivo, eseguibile senza custodia workspace.
pub struct PreparedResourceOpen {
    vault: crate::vault::Vault,
    id: DocId,
}

/// Lettura bounded su lease condivisa: non copia path o buffer dell'allegato.
pub struct PreparedResourceRead {
    storage: Arc<dyn crate::storage::VaultStorage>,
    lease: Arc<ResourceLease>,
    offset: u64,
    len: usize,
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
    Print,
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
        let (model, result_kind, print) = match kind {
            LocalProjectionKind::Preview => (model, None, false),
            LocalProjectionKind::Print => (model, None, true),
            LocalProjectionKind::Embed { block, heading } => {
                let clipped = match (block.as_deref(), heading.as_deref()) {
                    (Some(block), _) => block_of(&model, block)
                        .ok_or_else(|| PluginError::NotFound(format!("{id}#^{block}").into()))?,
                    (None, Some(heading)) => section_of(&model, heading)
                        .ok_or_else(|| PluginError::NotFound(format!("{id}#{heading}").into()))?,
                    (None, None) => model,
                };
                (clipped, Some(id.0.clone()), false)
            }
        };
        let options = if print {
            RenderOptions {
                target: RenderTarget::Print,
                ..Default::default()
            }
        } else {
            RenderOptions::preview()
        };
        let rendered = parser
            .render(&model, &renderers, &options)
            .map_err(PluginError::from)?;
        let result = if print {
            IndexResult::RenderPrint(rendered.into())
        } else if let Some(doc_id) = result_kind {
            IndexResult::RenderEmbed(EmbedContent {
                doc_id,
                content: rendered.into(),
            })
        } else {
            IndexResult::RenderPreview(rendered.into())
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

/// Una scrittura mirata chiesta al provider di un documento, risolta fino al
/// confine del provider: `invoke` non prende in prestito il workspace.
///
/// Sono le domande che una feature fa al formato invece di scrivere la sua
/// sintassi ([`VaultRead::format_link`](fub_abi::traits::VaultRead::format_link)
/// e [`VaultRead::task_state_edit`](fub_abi::traits::VaultRead::task_state_edit)).
pub struct PreparedFormatEdit {
    parser: PreparedParse,
    /// La sorgente su cui il provider lavora, per le operazioni che la
    /// leggono. Il link non la legge: il documento può non esistere ancora.
    source: Option<DocumentSource>,
}

impl PreparedFormatEdit {
    /// Il testo con cui il formato scrive `link`. Il chiamante deve avere già
    /// rilasciato la guardia del workspace.
    pub fn format_link(
        &self,
        link: &fub_abi::format::LinkInsert,
    ) -> std::result::Result<Option<String>, PluginError> {
        self.parser.format_link(link).map_err(PluginError::from)
    }

    /// La modifica che porta il task di `marker` a `done`, con la revisione
    /// della sorgente su cui è stata calcolata.
    pub fn task_state_edit(
        &self,
        marker: &fub_abi::model::TaskMarker,
        done: bool,
    ) -> std::result::Result<Option<EditRequest>, PluginError> {
        let source = self
            .source
            .as_ref()
            .ok_or_else(|| PluginError::Internal("la sorgente non è stata preparata".into()))?;
        let edits = self
            .parser
            .task_state_edits(source, marker, done)
            .map_err(PluginError::from)?;
        Ok(edits.map(|edits| EditRequest::new(Revision::of_bytes(source.bytes()), edits)))
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
        // **La domanda agli indici è per fetta**, come lo è l'alimentazione. Un
        // indice che risponde `up_to_date` guardando ciò che ha non cambia
        // risposta perché gliela si chiede in dieci volte; chiederla una volta
        // sola vorrebbe dire tenere in mano l'elenco intero prima di alimentare
        // il primo documento, che è esattamente ciò che questa voce toglie.
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
    model: Option<DocumentModel>,
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
        if let Some(model) = &self.model {
            self.losses
                .extend(feed_index_handles(&providers, std::slice::from_ref(model)));
        }
        if let Err(error) = release_index_handles(providers) {
            self.losses.push(IndexLoss::new(self.id.clone(), error));
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

    /// I ganci esterni fra parse e disco, nell'ordine in cui girano. Il
    /// chiamante host dà a ciascuno un proxy che riacquisisce capacità strette
    /// una per volta, e si ferma al primo errore.
    pub fn before_write(&self) -> impl Iterator<Item = BeforeWriteCall<'_>> {
        before_write_calls(&self.before_write, &self.id)
    }
}
impl PreparedDocumentBytesWrite {
    /// Produce il modello attraverso la stessa pipeline dei salvataggi testuali.
    /// I file senza provider restano opachi; nessun buffer viene allocato per loro.
    pub fn parse(&self, bytes: &[u8]) -> Result<Option<DocumentModel>> {
        let Some(parser) = &self.parser else {
            return Ok(None);
        };
        let source = match parser.source_kind() {
            SourceKind::Bytes => DocumentSource::Bytes(bytes.to_vec()),
            SourceKind::Text => {
                let text =
                    fub_abi::rules::text_policy::decode(bytes).map_err(|at| KernelError::Io {
                        path: self.path.clone(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("invalid UTF-8 at byte {at}"),
                        ),
                    })?;
                DocumentSource::Text(text.to_string())
            }
        };
        parser.invoke(source).map(Some)
    }

    /// I ganci esterni fra parse e disco, come nella via testuale.
    pub fn before_write(&self) -> impl Iterator<Item = BeforeWriteCall<'_>> {
        before_write_calls(&self.before_write, &self.id)
    }
}

impl PreparedResourceOpen {
    pub fn invoke(self) -> Result<ResourceLease> {
        crate::transfer::resource_open_on(&self.vault, &self.id)
    }
}

impl PreparedResourceRead {
    pub fn invoke(self) -> Result<Vec<u8>> {
        crate::transfer::resource_read_at(self.storage.as_ref(), &self.lease, self.offset, self.len)
    }
}

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
/// Token owned per the persistent timer-cursor file.
///
/// The workspace validates the plugin namespace and freezes both the storage
/// handle and the absolute path. Invoking the token can therefore perform
/// storage I/O after the `Workspace` guard has been released.
pub struct PreparedTimerCursors {
    storage: Arc<dyn crate::storage::VaultStorage>,
    path: Utf8PathBuf,
}

impl PreparedTimerCursors {
    /// Read all persisted cursors for this plugin.
    pub fn read(self) -> std::result::Result<BTreeMap<String, CivilTime>, PluginError> {
        let bytes = match self.storage.read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Err(error) => return Err(PluginError::Io(format!("{}: {error}", self.path).into())),
        };
        let stored: BTreeMap<String, StoredCivilTime> =
            serde_json::from_slice(&bytes).map_err(|error| {
                PluginError::Internal(format!("timer cursors at {}: {error}", self.path).into())
            })?;
        Ok(stored
            .into_iter()
            .map(|(id, time)| (id, time.into()))
            .collect())
    }

    /// Atomically advance one persisted cursor without accepting stale updates.
    pub fn write(self, timer: &str, cursor: CivilTime) -> std::result::Result<(), PluginError> {
        let path = self.path;
        self.storage
            .update(&path, &mut |existing| {
                let mut stored: BTreeMap<String, StoredCivilTime> = existing
                    .map(serde_json::from_slice)
                    .transpose()
                    .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?
                    .unwrap_or_default();
                if stored
                    .get(timer)
                    .is_some_and(|current| cursor <= CivilTime::from(*current))
                {
                    return Ok(None);
                }
                stored.insert(timer.to_owned(), cursor.into());
                serde_json::to_vec_pretty(&stored)
                    .map(Some)
                    .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
            })
            .map_err(|error| PluginError::Io(format!("{path}: {error}").into()))
    }
}

const TIMER_CURSORS_FILE: &str = "timers.json";

/// Marca `.fub/data/plugins/<id>/` come cache. Senza di esso quella cartella
/// è l'albero autorevole *legacy*: `cache_write` la crea, e data_* non deve
/// scambiarla per dati.
pub(crate) const PLUGIN_CACHE_MARK: &str = ".fub-cache-root";

enum SettingMutation {
    Set(SettingValue),
    Reset,
}

/// Mutazione di configurazione validata che può persistere fuori dalla
/// custodia del workspace.
pub struct PreparedSettingMutation {
    settings: SharedSettings,
    key: String,
    scope: SettingScope,
    mutation: SettingMutation,
}

/// Esito persistito che autorizza il solo epilogo in memoria.
pub struct AppliedSettingMutation {
    key: String,
    scope: SettingScope,
}

impl PreparedSettingMutation {
    pub fn invoke(self) -> std::result::Result<AppliedSettingMutation, PluginError> {
        let mut settings = self.settings.write().expect("store di configurazione");
        let scope = match self.mutation {
            SettingMutation::Set(value) => settings.set(&self.key, value)?,
            SettingMutation::Reset => settings.reset(&self.key)?,
        };
        debug_assert_eq!(scope, self.scope);
        Ok(AppliedSettingMutation {
            key: self.key,
            scope,
        })
    }
}

/// Token owned per l'I/O dello spazio dati di un plugin.
///
/// Il workspace valida e congela radici e path; ogni domanda al supporto,
/// inclusa la scelta fra namespace canonico e legacy e il marcatore cache,
/// avviene soltanto quando il token viene invocato.
pub struct PreparedPluginDataIo {
    storage: Arc<dyn crate::storage::VaultStorage>,
    canonical_root: Utf8PathBuf,
    cache_root: Utf8PathBuf,
    cache_mark: Utf8PathBuf,
    canonical_path: Utf8PathBuf,
    cache_path: Utf8PathBuf,
}

impl PreparedPluginDataIo {
    fn authoritative_uses_canonical(&self) -> bool {
        self.storage.exists(&self.canonical_root)
            || !self.storage.exists(&self.cache_root)
            || self.storage.exists(&self.cache_mark)
    }

    fn authoritative_path(&self) -> &Utf8Path {
        if self.authoritative_uses_canonical() {
            &self.canonical_path
        } else {
            &self.cache_path
        }
    }

    pub fn read_authoritative(self) -> std::result::Result<Option<Vec<u8>>, PluginError> {
        let path = self.authoritative_path();
        match self.storage.read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(PluginError::Internal(format!("{path}: {error}").into())),
        }
    }

    pub fn list_authoritative(self) -> Vec<String> {
        let (root, dir) = if self.authoritative_uses_canonical() {
            (&self.canonical_root, &self.canonical_path)
        } else {
            (&self.cache_root, &self.cache_path)
        };
        let mut paths = Vec::new();
        collect_data_files(self.storage.as_ref(), root, dir, &mut paths);
        paths.sort_unstable();
        paths
    }

    pub fn read_cache(self) -> std::result::Result<Option<Vec<u8>>, PluginError> {
        match self.storage.read(&self.cache_path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(PluginError::Internal(
                format!("{}: {error}", self.cache_path).into(),
            )),
        }
    }

    pub fn write_authoritative(self, bytes: &[u8]) -> std::result::Result<(), PluginError> {
        let path = self.authoritative_path();
        self.storage
            .write(path, bytes)
            .map(|_| ())
            .map_err(|error| PluginError::Io(format!("{path}: {error}").into()))
    }

    pub fn remove_authoritative(self) -> std::result::Result<(), PluginError> {
        let path = self.authoritative_path();
        match self.storage.remove(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(PluginError::Io(format!("{path}: {error}").into())),
        }
    }

    pub fn write_cache(self, bytes: &[u8]) -> std::result::Result<(), PluginError> {
        if !self.authoritative_uses_canonical() {
            self.storage
                .rename(&self.cache_root, &self.canonical_root)
                .map_err(|error| {
                    PluginError::Io(
                        format!(
                            "migrazione `{}` → `{}`: {error}",
                            self.cache_root, self.canonical_root
                        )
                        .into(),
                    )
                })?;
        }
        self.storage
            .write_derived(&self.cache_mark, b"cache\n")
            .map_err(|error| PluginError::Io(format!("{}: {error}", self.cache_mark).into()))?;
        self.storage
            .write(&self.cache_path, bytes)
            .map(|_| ())
            .map_err(|error| PluginError::Io(format!("{}: {error}", self.cache_path).into()))
    }
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
            clock: Arc::new(crate::time::SystemClock),
            sources: Shelter::new(OpenSources::default()),
            closed: false,
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

    // --- il registro dei plugin (§7.3, §7.4, §7.6) --------------------------
    //
    // Chi registra qualcosa si **dichiara** prima. Non è burocrazia: è la sola
    // forma in cui l'host sa di chi siano le capacità che sta prestando, e in
    // cui un nome ha un proprietario invece di essere il primo arrivato.

    /// Dichiara un plugin: id, versione, versione di ABI, permessi, fiducia.
    ///
    /// Va **prima** di ogni `register_*` che nomini quell'id. Un id non
    /// dichiarato non è un plugin creato al volo: è un errore, e la ragione è
    /// la stessa per cui [`Trust::default`] è il grado più restrittivo fra
    /// quelli che girano — ciò che si ottiene dimenticandosi di dichiarare non
    /// può essere più di ciò che si ottiene dichiarando.
    ///
    /// Il [`Trust`] non sta nel manifest e non ci starà mai: è ciò che l'host
    /// pensa del plugin, non ciò che il plugin dice di sé.
    pub fn register_plugin(
        &mut self,
        manifest: PluginManifest,
        trust: Trust,
    ) -> std::result::Result<(), RegistryError> {
        // I servizi che offre sono nomi, e valgono la regola del §7.4: o è il
        // proprio id, o è dentro di esso.
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
        // E i requisiti devono essere **già offerti**: chi dipende da ciò che
        // non c'è non si dichiara affatto (§7.5). Ne segue che l'ordine di
        // dichiarazione dev'essere topologico, e a M5 è il caricatore a
        // ordinarlo — il kernel non riordina ciò che gli si passa, dice che non
        // sta in piedi.
        let missing = self.providers.plugins.missing_requirements(&manifest);
        if !missing.is_empty() {
            return Err(RegistryError::MissingRequirement {
                plugin: manifest.id.clone(),
                requires: missing,
            });
        }
        // E le **chiavi di impostazione** (§11.1), che sono nomi come i servizi
        // e valgono la stessa regola. Vanno dichiarate qui e non alla prima
        // lettura per la ragione che tiene lo schema nel manifest: il primo che
        // legge una chiave è l'`activate` del plugin che l'ha dichiarata, e
        // arriva **dopo** questa riga e prima di qualunque altra occasione.
        for spec in &manifest.settings {
            fub_abi::rules::ids::check(&spec.key, owner).map_err(RegistryError::Namespace)?;
        }
        // E i **nomi delle sveglie** (§22.1), che valgono la regola opposta:
        // nudi, come le chiavi di un catalogo di stringhe. Una sveglia vive
        // dentro il componente che l'ha dichiarata e nessun altro la può
        // nominare — la qualifica è strutturale, e a dire di chi è è
        // `TimerFired.owner`. Ciò che si verifica è quindi solo che il nome ci
        // sia e sia unico: due sveglie omonime dello stesso componente
        // sarebbero due eventi indistinguibili da chi li riceve.
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
        // La dichiarazione del plugin **prima** dello schema, e non per gusto
        // dell'ordine: se fosse al contrario, un id doppio lascerebbe dietro le
        // chiavi di un plugin che non è mai stato dichiarato — e a toglierle non
        // ci sarebbe nessuno, perché `deactivate_plugin` non conosce chi non è
        // mai entrato.
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
        // E le chiavi con cui si **negano i suoi permessi** (§23.17). Sono
        // fabbricate qui e non dichiarate nel manifest per la ragione che le
        // rende utili: un componente non deve poter decidere se il proprio
        // recinto sia mostrabile. Vanno **dopo** lo schema suo, e ciò che ne
        // segue è la risposta giusta al caso brutto — un plugin che dichiarasse
        // di suo una chiave `<id>:permissions.…` fa fallire questa riga, e non
        // si monta affatto. Se l'ordine fosse rovesciato, a fallire sarebbe la
        // sua dichiarazione: stesso esito, ma il difetto verrebbe raccontato
        // come se fosse dell'host.
        let permissions = self.permission_specs(&id);
        let outcome = {
            let mut settings = self.settings.write().expect("store di configurazione");
            settings.declare(&id, &permissions).inspect_err(|_| {
                // E si **ritira il suo schema**, che è stato dichiarato una
                // riga più su e che `retire` non conosce. È il primo punto di
                // questa funzione che poteva lasciare qualcosa a metà: senza
                // questa riga le chiavi del manifest restavano nello store
                // attribuite a un plugin che non è registrato, e il secondo
                // tentativo con lo stesso id falliva **prima**, sul proprio
                // schema, con «già dichiarata da `<id>`» — cioè raccontando
                // come un difetto del manifest uno stato che aveva creato
                // l'host.
                settings.withdraw(&id);
            })
        };
        if let Err(why) = outcome {
            self.providers.plugins.retire(&id);
            return Err(RegistryError::Setting(why));
        }
        // E si applica **subito** ciò che l'utente aveva già negato: un vault
        // che si riapre non è un'occasione per ricominciare da capo.
        self.reapply_permissions(&id);
        // Se fra le chiavi appena dichiarate c'è la finestra del registro, il
        // registro si pota **adesso**: prima di questa riga quella chiave non si
        // poteva leggere, e il journal si era aperto col solo tetto. È l'altra
        // metà di `announce_setting` — la finestra vale da quando è dichiarata,
        // e da lì in poi a ogni cambiamento.
        if specs
            .iter()
            .any(|s| s.key == crate::journal::RETENTION_DAYS)
        {
            self.prunes_the_record();
        }
        if !timers_declared {
            return Ok(());
        }
        // Chi dorme non sa che è arrivata una sveglia (§22.1, decisione 0069).
        // Il pool aspetta senza scadenza finché nessuno dichiara timer — che è
        // la promessa fatta a chi non ne dichiara — quindi un componente montato
        // *dopo* che i thread si sono addormentati resterebbe senza sveglia fino
        // al primo job di qualcun altro. È la stessa mossa con cui `stop` sveglia
        // i dormienti: la campana non annuncia un job, annuncia che c'è da
        // ricontare.
        self.dispatch.bell().ring();
        Ok(())
    }

    /// Registra chi **offre** i servizi che il suo manifest dichiara (§7.5).
    ///
    /// I `ns` non si passano qui: sono già nel manifest, e sono già stati
    /// verificati alla dichiarazione. Registrare un provider per un plugin che
    /// non offre niente è un errore che nomina la dimenticanza — è quasi certo
    /// che manchi il `provides`, non che il provider sia di troppo.
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

    /// Chiama un servizio offerto da un plugin (§7.5).
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

        // Il giro. Come per i comandi (decisione 0013), un servizio che rientra
        // su sé stesso non è una profondità da limitare con un numero: è un
        // errore di chi lo ha scritto, e l'unica risposta utile lo nomina.
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

    /// Dichiara una **feature ufficiale** di questo repo: [`Trust::Core`] e i
    /// permessi di
    /// [`PluginPermissions::core`](fub_abi::traits::PluginPermissions::core).
    ///
    /// È zucchero su [`register_plugin`](Workspace::register_plugin) e non un
    /// secondo percorso: passa dallo stesso registro, con lo stesso manifest,
    /// e prende gli stessi rifiuti. Se fosse un percorso privilegiato, il §7.3
    /// sarebbe applicato solo a chi non esiste ancora.
    pub fn register_core_feature(
        &mut self,
        id: &str,
        name: &str,
    ) -> std::result::Result<(), RegistryError> {
        self.register_plugin(PluginManifest::core(id, name), Trust::Core)
    }

    /// **Spegne un plugin**: chiude i suoi indici, toglie tutto ciò che ha
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

        // Percorso sincrono legacy: chi arriva a close ha già ricevuto il flush.
        let mut prepared = self.prepare_plugin_teardown(plugin)?;
        self.take_plugin_teardown_indexes(&mut prepared)
            .map_err(RegistryError::Activate)?;
        let mut errors = prepared.invoke_grids();
        {
            let mut host = self.host_for(plugin, InvokeMode::Apply);
            errors.extend(prepared.invoke_indexes(&mut host));
        }
        let outcome = self
            .finish_plugin_teardown(prepared, errors)
            .map(RetiredPlugin::dispose)
            .map_err(|failure| RegistryError::Activate(failure.error));
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
        let (retiring, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.before_write)
            .into_iter()
            .partition(|(owner, _)| owner == plugin);
        self.before_write = kept;
        for hook in retiring {
            retired.push("before-write hook", hook);
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

    /// [`close`](Workspace::close), con **un passo in più su ogni plugin**:
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
                // Un `Busy` qui vorrebbe dire che si sta chiudendo il vault da
                // dentro la chiamata di un provider, cioè che chi chiude è
                // qualcuno che il vault lo sta usando. Non fa danno e va detto.
                Err(and) => errors.push(PluginError::Internal(and.to_string().into())),
            }
        }

        // **L'anagrafe si scrive qui**, ed è l'ultima riga della chiusura: è
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
        self.store_entries();

        Ok(errors)
    }

    /// Ordine terminale di una chiusura valida, senza chiamate ai provider.
    pub fn closing_plugins(
        &self,
        prepared: &PreparedClose,
    ) -> std::result::Result<Vec<String>, PluginError> {
        if prepared.workspace_id != self.workspace_id || !self.closed {
            return Err(PluginError::Conflict("stale workspace close".into()));
        }
        Ok(self
            .providers
            .plugins
            .iter()
            .rev()
            .map(|entry| entry.manifest.id.clone())
            .collect())
    }

    /// Ultimo passo della chiusura staccata: nessun plugin può scrivere dopo
    /// l'anagrafe. Un token errato torna al proprietario senza mutazioni.
    pub fn finish_detached_close(
        &mut self,
        prepared: PreparedClose,
    ) -> std::result::Result<(), (PreparedClose, PluginError)> {
        if let Err(error) = self.closing_plugins(&prepared) {
            return Err((prepared, error));
        }
        if self.providers.plugins.iter().next().is_some() {
            return Err((
                prepared,
                PluginError::Conflict("cannot finish close while plugins remain declared".into()),
            ));
        }
        self.store_entries();
        Ok(())
    }

    /// Il vault è già stato chiuso?
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// La bandiera del **rilevamento delle modifiche esterne** (§9.7), da dare a
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
    pub fn watch_flag(&self) -> Arc<AtomicBool> {
        self.indexes.core.watch.watching.clone()
    }

    /// Riserva all'host gli id dei comandi che esegue in proprio, fuori dal
    /// registro. Lo chiama chi monta, una volta, prima dei provider: da qui in
    /// poi un plugin che li invoca riceve [`PluginError::Unserved`] invece di
    /// un `UnknownCommand` che non spiega, e un provider che ne dichiara un
    /// omonimo è rifiutato come davanti a un id già rivendicato.
    pub fn reserve_host_commands(
        &mut self,
        ids: &[&str],
    ) -> std::result::Result<(), RegistryError> {
        for (owner, spec) in self.providers.command_specs_by_owner() {
            if ids.contains(&spec.id.as_str()) {
                return Err(RegistryError::Claimed {
                    kind: RegistrationKind::Command,
                    id: spec.id,
                    incumbent: owner,
                    challenger: crate::providers::HOST_OWNER.to_string(),
                });
            }
        }
        self.providers
            .host_commands
            .extend(ids.iter().map(|id| (*id).to_string()));
        Ok(())
    }

    /// L'orologio del vault al posto di quello di sistema: il registro, il
    /// cestino, le bozze, i job e l'`HostEnv` dei plugin leggono questo. Lo
    /// chiama chi monta, prima che qualcuno scriva.
    pub fn with_clock(mut self, clock: Arc<dyn crate::time::Clock>) -> Self {
        self.docs.set_clock(Arc::clone(&clock));
        self.journal = Arc::new(self.journal.with_clock(Arc::clone(&clock)));
        self.clock = clock;
        self
    }

    /// Adesso, sull'orologio del vault.
    pub fn now_unix_millis(&self) -> u64 {
        self.clock.now_unix_millis()
    }

    /// Monta il filo verso fuori (§23.3). Lo chiama chi monta, una volta.
    pub fn set_network(&mut self, client: Arc<dyn fub_abi::traits::HostNetwork>) {
        self.network = Some(client);
    }

    /// Il client di rete montato, se c'è.
    ///
    /// È pubblico perché serve a chi esegue un **job**: la richiesta si fa
    /// fuori dal prestito, quindi il client si prende di qui e il permesso da
    /// [`Workspace::granted`].
    pub fn network(&self) -> Option<Arc<dyn fub_abi::traits::HostNetwork>> {
        self.network.clone()
    }

    /// La politica di un plugin, così com'è **adesso**.
    ///
    /// Serve allo stesso caso, e la parola *adesso* è tutta la ragione per cui
    /// non la si cattura all'avvio di un job: un plugin revocato mentre una sua
    /// richiesta è in volo deve trovare il cancello chiuso alla successiva, non
    /// alla fine del job.
    pub fn granted_policy(&self, plugin: &str) -> crate::host::Granted {
        self.providers.plugins.granted(plugin)
    }

    /// Questo plugin può nominare questo id? La regola del §7.4, per chi non
    /// passa da una registrazione.
    ///
    /// Serve al topic di un [`Event::Custom`], che è l'unico nome del contratto
    /// senza un momento di registrazione in cui verificarlo: si controlla
    /// quando lo si emette.
    pub(crate) fn owns_name(
        &self,
        plugin: &str,
        id: &str,
    ) -> std::result::Result<(), fub_abi::rules::ids::IdFault> {
        self.providers.owns_name(plugin, id)
    }

    /// L'inventario di ciò che è **attivo** (§7.6): chi è registrato, con quale
    /// manifest, quale fiducia, quali permessi, e cosa ha registrato.
    ///
    /// È ciò che fa sparire `VaultInfo.versioning: bool` — un booleano per
    /// feature dentro un record IPC, che con i moduli del 21.2 sarebbero
    /// diventati venti booleani, ognuno una modifica al record, al mirror e
    /// alla fixture.
    pub fn plugins(&self) -> Vec<PluginInfo> {
        self.providers.inventory()
    }

    /// Il grado di fiducia di un plugin dichiarato.
    pub fn trust_of(&self, plugin: &str) -> Option<Trust> {
        self.providers.trust_of(plugin)
    }

    /// Registra un [`EventHandler`] per conto di un plugin dichiarato.
    ///
    /// `plugin` è l'identità di chi lo offre: determina lo spazio dello storage
    /// persistente che l'`HostApi` gli concede (`.fub/plugins/<id>/`, con cache in `.fub/data/plugins/<id>/`) e
    /// **i permessi con cui girerà**. Un handler non nomina niente di suo, e
    /// quindi non ha id da far collidere: l'unico nome in gioco è quello del
    /// plugin.
    pub fn register_event_handler(
        &mut self,
        plugin: impl Into<String>,
        handler: Box<dyn EventHandler>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared = PreparedRegistration::event_handler(handler);
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Presta un [`HostApi`] intestato a un plugin, per la durata di una
    /// chiamata.
    ///
    /// Serve a chi compone le due metà di una feature dall'esterno del
    /// dispatch: l'app apre lo store delle versioni e legge una versione con le
    /// stesse capacità che l'handler usa dentro `handle`, e non con `std::fs`.
    /// A M4 è anche il modo in cui il registry guiderà `Plugin::activate`.
    ///
    /// Le capacità sono **quelle del plugin**, non quelle del chiamante: un id
    /// che nessuno ha dichiarato riceve un host che nega tutto, dicendo perché.
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
        // Anche questa è una "chiamata di provider" ai fini della consegna:
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

    /// Presta un [`ReadApi`] intestato a un plugin, per la durata di una
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
    pub fn with_read_host<R>(&self, plugin: &str, f: impl FnOnce(&dyn ReadApi) -> R) -> R {
        // Niente `with_provider_call` e niente drenaggio: da qui non si emette
        // e non si scrive, quindi non c'è nessuna coda che possa crescere.
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

    /// L'host di **lettura** intestato a un plugin, con la stessa politica di
    /// [`host_for`](Workspace::host_for) davanti.
    ///
    /// Non è un `KernelHost` con meno capacità: è un tipo che le altre non le
    /// ha (§7.1), e prende `&self` perché una lettura gira sotto prestito
    /// condiviso del workspace.
    pub(crate) fn read_host_for<'a>(&'a self, plugin: &'a str) -> Guard<ReadHost<'a>, Granted> {
        self.read_host_for_view(plugin, None)
    }

    /// Come [`read_host_for`](Workspace::read_host_for), **per conto di un
    /// esemplare di view**.
    ///
    /// L'esemplare è ciò che rende la chiave dello stato di vista (§11.2) di chi
    /// disegna e non di chiunque: lo timbra l'host, come l'id di un job nella
    /// 0035, perché è l'unico dei due a saperlo con certezza. `None` = non si
    /// sta disegnando una view, e allora uno stato di vista non c'è.
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

    /// **Il punto di applicazione** (§7.3): un host intestato a un plugin, con
    /// davanti la politica che i suoi permessi e la sua fiducia compongono.
    ///
    /// Ogni prestito passa di qui. Prima ne passava nessuno: `KernelHost`
    /// portava `plugin: &str` e `mode`, e nient'altro — non sapeva di chi
    /// fossero le capacità che stava prestando, quindi non poteva negarne
    /// nessuna.
    pub(crate) fn host_for<'a>(
        &'a mut self,
        plugin: &'a str,
        mode: InvokeMode,
    ) -> Guard<KernelHost<'a>, Granted> {
        self.host_for_view(plugin, mode, None)
    }

    /// Come [`host_for`](Workspace::host_for), per conto di un esemplare di
    /// view: vedi [`read_host_for_view`](Workspace::read_host_for_view).
    pub(crate) fn host_for_view<'a>(
        &'a mut self,
        plugin: &'a str,
        mode: InvokeMode,
        instance: Option<&'a str>,
    ) -> Guard<KernelHost<'a>, Granted> {
        // La politica si prende **prima**: dopo, `self` è prestato all'host.
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

    /// Mette il gancio **prima della scrittura** (0154): l'id del plugin a cui
    /// intestare l'host e la chiusura da chiamare in
    /// [`write_source`](Workspace::write_source) fra il parse e il disco.
    ///
    /// Un gancio per owner, nell'ordine di registrazione: rimetterlo sostituisce
    /// quello dello stesso owner e lascia gli altri al loro posto. `None` toglie
    /// quello dell'owner.
    pub fn set_before_write_hook(&mut self, owner: &str, hook: Option<BeforeWriteHook>) {
        match (
            self.before_write.iter_mut().find(|(held, _)| held == owner),
            hook,
        ) {
            (Some(slot), Some(hook)) => slot.1 = hook,
            (None, Some(hook)) => self.before_write.push((owner.to_owned(), hook)),
            (_, None) => self.before_write.retain(|(held, _)| held != owner),
        }
    }

    /// Registra un [`IndexProvider`] sotto un id. Va fatto **prima** di
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
    pub fn register_index_provider(
        &mut self,
        plugin: impl Into<String>,
        index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared =
            PreparedIndexRegistration::new(index).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.admit_index_registration(&permit, &prepared)?;
        self.with_provider_call(|ws| {
            let mut host = ws.host_for(&plugin, InvokeMode::Apply);
            // The token retains the outcome for publication, including the
            // established recoverable RegistryError::Activate case.
            let _ = prepared.activate(&mut host);
        });
        let result = self.commit_index_registration(&permit, &mut prepared);
        self.dispatch_pending();
        result
    }

    /// Registra un indice **sostituendo** chi rivendicava le stesse famiglie di
    /// domande.
    ///
    /// È l'operazione che il dispatch per tentativi faceva senza dirlo — vinceva
    /// chi si era registrato prima, e non c'era modo di accorgersene — e che
    /// adesso si chiede per nome. È anche il modo in cui l'indice del kernel si
    /// scavalca: `Backlinks`, `Tags` e gli altri non sono più un ramo prima del
    /// ciclo, sono rotte come le altre.
    pub fn replace_index_provider(
        &mut self,
        plugin: impl Into<String>,
        index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let namespaces = plugins::custom_namespaces(&index.routes());
        // Sostituire non scavalca la regola dei nomi: si prende il posto di chi
        // c'era, non il suo namespace. E il permesso si chiede **prima** di
        // togliere la riga di chi c'era, o un rifiuto lascerebbe la rotta ancora
        // servita e l'inventario a dire che non è di nessuno.
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

    /// La registrazione **è** l'attivazione: l'indice riceve subito un
    /// [`HostApi`] intestato al proprio id e ricarica da `data_*` ciò che ha già
    /// visto. Prima di questo momento non può avere ricordi, e dopo il primo
    /// `on_documents_indexed` sarebbe troppo tardi per averli.
    fn activate_index(
        &mut self,
        id: String,
        mut index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        // `index` è ancora una variabile locale: prestare `&mut self` all'host
        // qui non alias niente. `activate` è una chiamata a un provider come
        // le altre: il dispatch resta rimandato a chiamata tornata.
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

    /// Guarda cosa c'è nel vault, ricostruisce il grafo e allinea gli indici
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
    pub fn reindex(&mut self) -> Result<Opening> {
        let mut indexing = self.scan_vault()?;
        while !indexing.finished() {
            self.index_batch(&mut indexing);
        }
        let opening = self.finish_index(indexing);
        // La raccolta sta fuori da `finish_index` perché vuole `&self` e non
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
        if let Err(and) = self.collect_doc_data() {
            tracing::warn!(target: "fub.kernel", "spazi per-documento non raccolti: {and}");
        }
        Ok(opening)
    }

    /// Toglie i temporanei di scrittura che la camminata ha trovato rimasti
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

    /// **La prima fase dell'apertura** (§15.7): guarda cosa c'è, e basta.
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
    pub fn prepare_scan_vault(&self) -> Result<PreparedVaultScan> {
        let _phase = tracing::info_span!(target: "fub.apertura", "scan_vault").entered();
        let scanned = self.docs.vault.scan()?;
        self.sweep_temporary(&scanned.temporary_remaining_back);

        // La scansione raccoglie una fotografia completa ma non muta ancora il
        // core: durante `IndexProvider::up_to_date` i reader vedono l'ultimo stato
        // coerente, non metà della nuova anagrafe.
        //
        // La specie si **ricalcola** e non si rilegge dalla tabella: dipende da
        // chi è registrato adesso, e un `.canvas` diventa un documento il giorno
        // che qualcuno rivendica quell'estensione, senza essere cambiato.
        let entries: Vec<(VaultEntry, Option<StoredEntry>)> = scanned
            .files
            .into_iter()
            .map(|file| {
                let change_stamp = self.docs.vault.change_stamp(&file.id);
                // Una domanda sola all'anagrafe: la risposta intera serve
                // alla riapertura incrementale di `finalize_scan_vault`, e
                // rifarla là è un lock e una copia regalati per niente.
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

        // La coppia viaggia in parallelo: il `VaultEntry` per gli indici
        // (che lo chiedono per valore), l'anagrafe per la riapertura.
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
            folders,
            entries,
            documents,
            known_entries,
            assets,
            up_to_date,
        } = completed;

        // **Gli indici si svuotano qui**, cioè in chiusura della prima fase e
        // non a giro di lettura finito. Finché il parse era fatale, svuotare
        // tardi teneva il tutto-o-niente; quando la
        // [0068](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)
        // gliel'ha tolto, teneva ancora una cosa vera — gli indici non restano
        // vuoti per il tempo in cui si cammina il disco. Quella cosa **si
        // perde qui**, ed è il prezzo dichiarato dell'apertura a fasi: fra
        // `scan_vault` e `finish_index` la ricerca risponde poco e poi di più.
        // Il prezzo si paga in questo verso perché l'alternativa lo fa pagare
        // tutto a chi apre — che aspetta a schermo fermo — invece che a chi
        // cerca nei primi secondi, che vede l'app viva e i risultati arrivare.
        // Chi guarda non deve indovinarlo: lo dice `Indexing` a chi la porta
        // avanti, e `VaultStatus::indexing` a chiunque altro.
        self.indexes.core.clear();
        // Le cartelle prima delle voci, e dalla **camminata** e non dai path
        // dei file (§14.3): una cartella vuota non compare in nessun path, e
        // dedurle dai file vorrebbe dire che l'unica cartella che esiste è
        // quella che ha già qualcosa dentro.
        for folder in folders {
            self.indexes.core.set_folder(folder);
        }
        // L'anagrafe è **intera già adesso**, ed è ciò che rende il vault
        // utilizzabile alla fine di questa fase: l'albero dei file, le
        // cartelle e la specie di ogni voce non aspettano di aver letto niente.
        // Le impronte che mancano le riempirà la seconda fase, rimettendo in
        // anagrafe le voci che legge.
        for entry in entries {
            self.indexes.core.set_entry(entry);
        }

        // **Riapertura incrementale**: per ogni documento descritto dall'anagrafe
        // (size+mtime+timbro di cambiamento → impronta) che porta i metadati e
        // per cui tutti gli indici plugin rispondono `up_to_date`, si
        // ripristinano direttamente i metadati in memoria senza rileggerlo dal
        // disco. A fette finiscono solo i documenti nuovi, modificati, o per cui
        // un indice plugin deve essere allineato.
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
        // Gli allegati non hanno metadati da ripristinare: la seconda fase ne
        // legge i byte e aggiorna la stessa impronta dei documenti.
        to_index.extend(assets);

        // L'apertura non l'ha chiesta un documento né un plugin: è il kernel che
        // dichiara di esistere (decisione 0012).
        //
        // `VaultOpened` esce **qui**, dove il vault diventa usabile, e non alla
        // fine dell'indicizzazione: è l'evento che dice *questo vault è
        // aperto*, e con le fasi quel momento è questo. Chi lo riceve sa che
        // l'anagrafe c'è; per sapere se la ricerca è pronta c'è `IndexUpdated`,
        // che resta dov'era — in fondo.
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::VaultOpened {
                root: ws.docs.vault.root().to_string(),
            });
            ws.dispatch_pending();
        });

        // Da qui l'indice risponde **meno di quanto il vault sappia**, e chi lo
        // interroga deve poterlo distinguere da un vault vuoto (§15.7).
        self.indexes.core.watch.indexing = IndexingState::Running;
        Indexing::new(to_index)
    }

    /// Percorso sincrono per chi possiede direttamente un `Workspace`. L'host,
    /// che usa `Custody`, chiama esplicitamente prepare/invoke/finalize.
    pub fn scan_vault(&mut self) -> Result<Indexing> {
        let completed = self.prepare_scan_vault()?.invoke();
        Ok(self.finalize_scan_vault(completed))
    }

    /// **Una fetta della seconda fase** (§15.7): legge, parsa e alimenta fino a
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
    pub(crate) fn index_batch(&mut self, work: &mut Indexing) {
        let prepared = self.plan_batch(work);
        self.index_batch_prepared(prepared);
    }

    /// **La metà di una fetta che non ha bisogno del prestito esclusivo**:
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
    pub fn plan_batch(&self, work: &mut Indexing) -> ParsedBatch {
        let checked = self.prepare_index_batch_check(work).invoke();
        self.prepare_index_batch_parse(checked).invoke(work)
    }

    /// Legge soltanto ciò che serve a determinare le impronte della prossima
    /// fetta e cattura gli handle degli indici. Nessuna callback esterna gira
    /// sotto il prestito condiviso del workspace.
    pub fn prepare_index_batch_check(&self, work: &mut Indexing) -> PreparedIndexBatchCheck {
        let slice = work.next_slice();
        // L'impronta che l'anagrafe dà a ogni voce **adesso**: è ciò che il
        // piano si porta dietro per accorgersi di essere invecchiato (0119).
        // Si calcola una volta per tutta la fetta, prima del lavoro parallelo.
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

        // Lo span copre il lavoro parallelo di lettura della fetta,
        // `thread::scope` compreso: è ciò che il banco dell'apertura legge per
        // vedere se le fette scalano davvero (§25.3).
        let _phase = tracing::info_span!(target: "fub.apertura", "plan_batch").entered();
        // La fetta si lavora in parallelo quando ci sono abbastanza documenti
        // da ripagare i thread: su un vault da 30k file la prima apertura
        // legge e parsa ogni documento, e farlo in un thread solo la rende
        // seriale. `thread::scope` presta `docs` ai figli — è `Sync` — e li
        // aspetta prima di restituire. Gli handle si raccolgono **tutti** prima
        // di joinare: `map(spawn).map(join)` è pigro, e joinerebbe un thread
        // alla volta.
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

    /// Il lavoro di un pezzo di fetta: lettura e impronta. Ogni pezzo è
    /// indipendente e può girare in un `thread::scope`.
    fn prepare_index_check_chunk(
        docs: &DocumentStore,
        entries: Vec<VaultEntry>,
    ) -> IndexCheckChunk {
        let mut out = IndexCheckChunk::default();
        // Ciò che non si sa lo si legge, e leggendolo se ne prende l'impronta:
        // dopo un `git checkout` che ha ritimbrato mille file senza cambiarne
        // uno, la data non combacia ma il contenuto sì — e chi tiene l'impronta
        // (l'anagrafe, e chi risponde alla domanda di `up_to_date`) li riconosce
        // tutti e mille.
        //
        // **Si legge nella forma che il provider ha dichiarato** (§21.8): un
        // documento rivendicato a byte non passa da una decodifica UTF-8 che
        // fallirebbe, e la sua impronta si prende sui byte — che per una
        // sorgente di testo è lo stesso numero di prima.
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
            let ext = extension_of(&entry.id).unwrap_or_default();
            if self.docs.registry.provider_for_ext(&ext).is_none() {
                continue;
            }
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

    /// L'applicazione di una fetta, con il lavoro di lettura **già fatto** da
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
            // L'impronta appena calcolata torna in anagrafe: la voce c'era già
            // dalla prima fase, quello che qui si aggiunge è ciò che si è
            // imparato leggendola.
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

        // **Il kernel taglia** (§20.1): la fetta di lavoro è già grande quanto
        // il lotto di alimentazione, quindi qui non si taglia una seconda
        // volta. I modelli interi vivono solo nel feed preparato qui, il tempo
        // di alimentare indici e conteggi: in cache restano i metadati.
        //
        // **Una fetta senza modelli non attraversa il confine** (§17.1,
        // decisione 0113): è il caso normale di una riapertura a caldo, dove
        // ogni documento è stato ripreso dalla cache, e un lotto vuoto non
        // porta nessuna notizia a nessuno — a M5 sarebbe una serializzazione
        // per dire niente. Lo ha trovato il banco contando le chiamate: nessun
        // altro presidio le conta.
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

    /// Fotografia di ciò che il grafo legge. Costa O(documenti) di **copia**
    /// (id, alias, link), e tiene il prestito condiviso solo per quella copia:
    /// [`GraphSources::build`] gira dopo, senza lucchetto
    /// ([0024](../../../docs/decisions/README.md)).
    ///
    /// Chi ha i thread la chiama sotto prestito condiviso, poi costruisce, poi
    /// consegna il risultato a [`finish_index_with_graph`].
    pub fn graph_sources(&self) -> GraphSources {
        let _phase = tracing::info_span!(target: "fub.apertura", "graph_sources").entered();
        GraphSources::from_docs(
            self.indexes.core.metas.values(),
            self.indexes.core.graph_epoch,
            self.indexes.core.graph.prose().clone(),
        )
    }

    /// **La chiusura dell'apertura** (§15.7): il grafo, la riconciliazione, e i
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
        // Gli errori di flush non fanno fallire l'apertura del vault: un
        // indice è stato derivato, il vault è la verità (M4: notifica).
        {
            let _phase = tracing::info_span!(target: "fub.apertura", "flush_indexes").entered();
            let _ = self.flush_indexes();
        }
        self.store_entries();
        opening
    }

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
            work,
            graph,
            external_losses,
        } = completed;
        if graph.epoch == self.indexes.core.graph_epoch {
            self.indexes.core.graph = graph.graph;
        } else {
            self.indexes.core.rebuild_graph();
        }
        self.close_indexing(work, external_losses)
    }

    /// Come [`finish_index`], col grafo già costruito fuori dal prestito
    /// esclusivo. Se l'epoca non coincide — una scrittura è arrivata in mezzo —
    /// lo ricostruisce qui dai metadati correnti.
    ///
    /// Il flush degli indici non sta qui (difetto 0113): è una fase sua, con
    /// un prestito esclusivo proprio, e chi ha i thread la fa seguire a questa
    /// funzione — fra i due prestiti il lucchetto si rilascia e i lettori in
    /// coda passano, come nella terza fase di `ExternalSync::batch`.
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
            // **Gli scarti entrano nell'insieme completo**, e non è un
            // dettaglio. `reconcile` dice agli indici *quali documenti
            // esistono*, così ognuno cancella ciò che è sparito ad app chiusa;
            // un documento che non si è potuto leggere **non è sparito** — il
            // file c'è, è la vista sul suo contenuto che manca. Ometterlo
            // direbbe agli indici una cosa falsa, e alla prima apertura con un
            // permesso storto la nota uscirebbe dalla ricerca in silenzio.
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
            // **Un'indicizzazione interrotta non riconcilia**, ed è la stessa
            // riga con cui la 0068 tiene fatale la scansione: un insieme
            // incompleto non si dichiara completo. Qui l'insieme non è bucato
            // da un permesso ma da un pulsante, e la conseguenza sarebbe la
            // stessa e peggiore — dire a ogni indice di dimenticare tutto ciò
            // che l'annullamento non ha fatto in tempo a nominare, cioè
            // trasformare «ho smesso di indicizzare» in «cancella».
            opening.interrupted = true;
        }
        self.indexes.core.watch.indexing = if opening.interrupted {
            IndexingState::Stopped
        } else {
            IndexingState::Ready
        };
        // **Il flush non sta qui** (difetto 0113): è una fase sua, con un
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
        if !opening.interrupted {
            self.suspended_from_rejoin = self.rejoin_renamed_while_closed();
        }

        self.as_actor(Actor::Kernel, |ws| {
            // I guasti erano nello stesso lotto di `VaultOpened`, perché chi si
            // abbonava per disegnare il vault appena aperto avesse già in mano
            // ciò che di quel vault non si era letto. Con le fasi quel lotto
            // non esiste più — gli scarti si scoprono *dopo* che il vault è
            // aperto, per definizione — e la promessa che resta è più debole e
            // vera: chi disegna un albero lo disegna intero, e ciò che di quei
            // documenti non si è potuto leggere arriva mentre l'indicizzazione
            // procede, sulla stessa superficie di prima (`Event::Trouble`).
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

    /// Rimette in anagrafe un file che è appena cambiato, chiedendo al disco
    /// quanto è grande e di quando è (§14.1).
    ///
    /// Un file che non c'è più esce dall'anagrafe invece di restarci con i
    /// numeri di prima: `stat` che non risponde e file sparito sono la stessa
    /// cosa per chi tiene un elenco di ciò che esiste.
    ///
    /// La **specie** si ricalcola qui e non si porta dietro: è la stessa regola
    /// della scansione, e vale anche a metà sessione — un provider registrato
    /// dopo l'apertura cambia cosa è un documento.
    fn touch_entry(&mut self, id: &DocId, fingerprint: Option<Revision>) -> Option<EntryKind> {
        let Some((size, mtime)) = self.docs.vault.stat(id) else {
            return self.indexes.core.remove_entry(id);
        };
        Some(self.set_entry(id, size, mtime, fingerprint))
    }

    /// La metà di [`touch_entry`](Workspace::touch_entry) **che non guarda il
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
    fn set_entry(
        &mut self,
        id: &DocId,
        size: u64,
        mtime: u64,
        fingerprint: Option<Revision>,
    ) -> EntryKind {
        let kind = media::kind_of_ext(id, |ext| self.docs.registry.has_doc_ext(ext));
        // Un file che c'è dice che le cartelle che attraversa ci sono (§14.3):
        // senza questa riga una nota creata in una cartella nuova comparirebbe
        // in un albero che quella cartella non conosce fino alla riapertura.
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

    /// Scrive l'anagrafe, perché la prossima apertura non debba rifare ciò che
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

    /// Elenco ordinato dei documenti indicizzati.
    ///
    /// L'ordine non si impone più a ogni chiamata: la cache dei metadati è
    /// ordinata per costruzione (§5.5). Chi ne vuole una **finestra** non passa
    /// di qui ma da
    /// [`VaultRead::list_documents`](fub_abi::traits::VaultRead::list_documents),
    /// che non materializza il resto.
    pub fn documents(&self) -> Vec<DocId> {
        self.indexes.core.documents()
    }

    /// Una finestra sui documenti indicizzati, col conto di quanti sono.
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

    /// Le estensioni che i provider registrati riconoscono (minuscole, senza
    /// punto), ordinate.
    ///
    /// Serve a chi disegna: il "nome pagina" di un documento è il basename
    /// senza l'estensione **gestita**, e quale sia dipende dai provider —
    /// cablare `.md` nel frontend è vero solo finché markdown è l'unico
    /// formato, cioè finché il progetto non fa ciò per cui esiste.
    pub fn extensions(&self) -> Vec<String> {
        let mut exts = self.docs.registry.all_extensions();
        exts.sort();
        exts
    }

    /// Sorgente grezza di un documento dal disco.
    pub fn read_source(&self, id: &DocId) -> Result<String> {
        self.docs.vault.read(id)
    }

    /// I byte di un documento, senza decodificarli (§21.8).
    ///
    /// Non è una variante di comodo di [`Workspace::read_source`]: è la sola
    /// forma in cui un allegato — un PDF, un audio — si lascia leggere, e chi la
    /// chiama è chi da quei byte tira fuori del testo.
    pub fn read_source_bytes(&self, id: &DocId) -> Result<Vec<u8>> {
        self.docs.vault.read_bytes(id)
    }
    /// Apre una lease di risorsa sul VERO Vault/storage di sessione/mount: recinto
    /// via `fenced_doc_id` + `resource_open_on`, mai `Vault::open` nuovo, mai
    /// getter grezzi. `revision` resta `None`: NON si copia l'eventuale
    /// `Entries.fingerprint`, che per testo puo essere hash decodificato e NON
    /// hash raw/BOM/CRLF. Dopo una write il chiamante usa il raw noto.
    pub fn open_resource(&self, id: &DocId) -> Result<ResourceLease> {
        self.prepare_resource_open(id)?.invoke()
    }

    pub fn prepare_resource_open(&self, id: &DocId) -> Result<PreparedResourceOpen> {
        Ok(PreparedResourceOpen {
            vault: self.docs.vault.clone(),
            id: valid_doc_id(id.as_str())?,
        })
    }

    fn check_resource_lease(&self, lease: &ResourceLease) -> Result<()> {
        if lease.root != *self.docs.vault.root() {
            return Err(KernelError::OutsideVault(
                lease.root.join(lease.path.as_str()),
            ));
        }
        Ok(())
    }

    pub fn prepare_resource_read(
        &self,
        lease: Arc<ResourceLease>,
        offset: u64,
        len: usize,
    ) -> Result<PreparedResourceRead> {
        self.check_resource_lease(&lease)?;
        Ok(PreparedResourceRead {
            storage: Arc::clone(self.docs.vault.storage()),
            lease,
            offset,
            len,
        })
    }

    /// Range stabile su lease del VERO storage attivo: rifiuta root diversa dalla
    /// propria, poi `resource_read_at` (stat+identity+change prima/dopo, Stale su
    /// mismatch). Mai intero file in memoria oltre il chunk.
    pub fn read_resource(&self, lease: &ResourceLease, offset: u64, len: usize) -> Result<Vec<u8>> {
        self.check_resource_lease(lease)?;
        crate::transfer::resource_read_at(self.docs.vault.storage().as_ref(), lease, offset, len)
    }

    /// Prima fase di [`write_document`](Workspace::write_document): controlla la
    /// base e prepara il parser, senza eseguire codice del provider.
    pub fn prepare_document_write(
        &self,
        id: &DocId,
        base: WriteBase,
    ) -> Result<PreparedDocumentWrite> {
        self.indexes.ensure_mutation_available()?;
        // Cosa si sapeva **prima**: l'impronta che l'anagrafe teneva, e se il
        // documento esistesse affatto.
        //
        // **«C'era» lo dice il disco** (difetto 0180). L'anagrafe è una cache
        // di ciò che si è indicizzato, quindi «non lo conosco» e «non c'è» ci
        // si assomigliano solo finché nessuno scrive nel vault da fuori: un
        // file creato da un'altra applicazione e non ancora visto dal
        // rilevatore c'è sul disco e in anagrafe no, e sopra quel file il
        // salvataggio scriveva `Created`. Non è una parola imprecisa in una
        // lista: il registro è **autorevole** (0067) e di quella variante c'è
        // scritto sopra che «l'inverso è cestinarlo», quindi chi ripercorre la
        // riga porta nel cestino un file che non abbiamo creato noi, con dentro
        // ciò che ci aveva messo qualcun altro.
        //
        // La domanda è la più povera che risponda — *c'è un file lì?* — e la
        // paga un `stat`, non una lettura: il doc di `write_document` dice
        // che «una riga di registro non vale una lettura a ogni salvataggio»,
        // ed è vera e resta vera, perché una lettura porta i byte e li fa
        // parsare per averne l'impronta mentre qui non serve niente di tutto
        // ciò. Con [`WriteBase::DescendsFrom`] non si paga nemmeno quello: il
        // disco è già stato letto qui sotto, e se non fosse esistito la base non
        // combaciava e non si arrivava a scrivere.
        //
        // E non si paga **quasi mai**, perché l'anagrafe sbaglia in una
        // direzione sola: conosce meno di quanto c'è, mai di più. Quando ha la
        // voce il file c'era, e la domanda è già risposta senza toccare il
        // disco; il `stat` resta al solo caso in cui l'anagrafe tace, che è
        // esattamente la finestra del difetto. Il salvataggio di una nota che
        // si sta scrivendo non ci passa mai, ed è ciò che tiene ferma la 0179 —
        // «un salvataggio non torna a chiedere al disco cosa ha appena
        // scritto», che ha un banco che conta gli `stat` e li vuole zero.
        let (id, existed, from, expected_source) = match base {
            WriteBase::DescendsFrom(expected) => {
                // Un file che **non c'è** non è un errore da propagare: è una
                // base che non combacia — chi scrive credeva di riscrivere
                // qualcosa che nel frattempo è stato cestinato, e ha diritto
                // alla stessa risposta. Ogni **altro** guasto invece risale con
                // il suo tipo, ed è la differenza che vale la riga: con `.ok()`
                // chi non riusciva più a leggere la propria nota — permessi, un
                // disco che sta fallendo, byte che non sono più testo — si
                // sentiva dire «il documento è cambiato sotto di te», cioè un
                // fatto del vault che non era avvenuto, e un conflitto vero non
                // si distingueva da un supporto rotto.
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
                // An indexed, already-portable id is the ordinary save path:
                // the index is authoritative for that unchanged spelling, so
                // keep the no-stat fast path. Imported names that would be
                // changed or rejected by `new_doc_id` must ask the disk: a
                // stale index cannot prove that such a file still exists.
                let candidate = new_doc_id(id.as_str());
                let unchanged_portable =
                    in_store.is_some() && candidate.as_ref().is_ok_and(|candidate| candidate == id);
                // Su Windows un nome con spazio finale (`nota.md `) risolve
                // allo stesso file di `nota.md`: se si guarda prima il nome
                // grezzo, si conserva però l'estensione `md ` e il provider
                // non viene trovato. Il target normalizzato ha precedenza se è
                // l'unico esistente o se i due nomi indicano lo stesso file;
                // due file distinti conservano invece l'import non portabile.
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
                // A dictated write is also the path used by importers and
                // restores. Apply the stricter naming rule only when this
                // call is actually creating a new document: an imported file
                // may already have a name that is not portable to every OS,
                // and writing it back must preserve that existing name.
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
                    // `new_doc_id` may normalize the name (NFC and trimmed
                    // segments) onto a file that is already on disk.  The
                    // stale index is not evidence that this normalized target
                    // exists: only the storage stat can classify this write.
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

    /// Prepara una creazione senza attraversare parser o hook esterni.
    ///
    /// Il nome nasce in questa operazione, quindi applica anche la portabilità
    /// stretta e rifiuta una destinazione già occupata prima di restituire il
    /// token staccato.
    pub fn prepare_document_creation(&self, id: &DocId) -> Result<PreparedDocumentWrite> {
        let id = new_doc_id(id.as_str())?;
        if self.is_taken(&id) {
            return Err(KernelError::AlreadyExists(id.to_string()));
        }
        self.prepare_document_write(&id, WriteBase::Dictated)
    }

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
        self.indexes.ensure_mutation_available()?;
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
            model: Some(model),
            changes,
            revision,
            journal,
            providers,
            losses,
        })
    }

    /// Come `commit_document_write`, conservando però la semantica di journal
    /// dell'edit chirurgico invece di registrarlo come una scrittura generica.
    pub fn commit_document_edit(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
        before_write: std::result::Result<(), PluginError>,
        base: Revision,
        report: &EditReport,
    ) -> Result<PreparedDocumentFeed> {
        let mut pending = self.commit_document_write(prepared, source, model, before_write)?;
        pending.journal = JournalOp::Edited {
            doc: pending.id.clone(),
            from: base,
            to: pending.revision.clone(),
            footprint: crate::journal::EditFootprint::of(&report.applied),
        };
        Ok(pending)
    }

    /// Chiude la fase indici senza consegnare eventi. Il journal resta nel
    /// token e verrà registrato solo dopo il drain staccato.
    pub fn finish_document_write_deferred(
        &mut self,
        pending: PreparedDocumentFeed,
    ) -> DeferredEvents<Revision> {
        let revision = pending.revision.clone();
        let journal = pending.journal.clone();
        self.finish_index_feed(pending);
        DeferredEvents {
            outcome: revision,
            previous_actor: None,
            journal: Some(journal),
        }
    }

    /// Finalizza gli indici di un edit staccato e consegna il report originale
    /// soltanto dopo il drain degli eventi.
    pub fn finish_document_edit_deferred(
        &mut self,
        pending: PreparedDocumentFeed,
        report: EditReport,
    ) -> DeferredEvents<EditReport> {
        let journal = pending.journal.clone();
        self.finish_index_feed(pending);
        DeferredEvents {
            outcome: report,
            previous_actor: None,
            journal: Some(journal),
        }
    }

    pub fn finalize_document_write(&mut self, pending: PreparedDocumentFeed) -> Result<Revision> {
        let deferred = self.finish_document_write_deferred(pending);
        self.dispatch_pending();
        Ok(self.finish_deferred_events(deferred))
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
    /// Pipeline RAW per allegati/binari/opachi: `None` = create-only atomico,
    /// `Some(expected)` = CAS raw atomica. Nessuna variante Dictated, nessun
    /// fallback UTF-8 verso il disco: BOM/CRLF/binari restano identici;
    /// `Revision` raw (`of_bytes`) e testuale NON sono intercambiabili.
    /// Il parse gira detached in `PreparedDocumentBytesWrite::parse` (mai
    /// provider sotto lock); il commit usa `write_if_unchanged` in un colpo
    /// solo. `model: None` = file opaco senza provider: anagrafe + `EntryChanged`,
    /// nessun `DocumentChanged` inventato. Un preflight fallito non chiama hook.
    pub fn prepare_document_bytes_write(
        &self,
        id: &DocId,
        expected: Option<Revision>,
    ) -> Result<PreparedDocumentBytesWrite> {
        self.indexes.ensure_mutation_available()?;
        let id = valid_doc_id(id.as_str())?;
        let (id, from, expected_bytes) = match expected {
            Some(want) => {
                let current = crate::error::optional(self.docs.vault.read_bytes(&id))?
                    .ok_or_else(|| KernelError::Stale(id.to_string()))?;
                let actual = Revision::of_bytes(&current);
                if want != actual {
                    return Err(KernelError::Stale(id.to_string()));
                }
                (id, Some(actual), Some(current))
            }
            None => {
                if self.is_taken(&id) {
                    return Err(KernelError::AlreadyExists(id.to_string()));
                }
                (new_doc_id(id.as_str())?, None, None)
            }
        };
        let path = self.docs.vault.path_for(&id)?;
        let parser = match self.docs.prepare_parse(&id) {
            Ok(parser) => Some(parser),
            Err(KernelError::NoProvider(_)) => None,
            Err(error) => return Err(error),
        };
        Ok(PreparedDocumentBytesWrite {
            id,
            path,
            from,
            expected_bytes,
            parser,
            before_write: self.before_write.clone(),
        })
    }

    /// Commit atomico raw: UNICA `write_if_unchanged(path, None|Some, bytes)` —
    /// `None` = create-only atomico (`Changed` => `AlreadyExists`), `Some` = CAS
    /// (`Changed` => `Stale`). Mai `exists` + `write`. Il modello arriva dal
    /// parse detached; qui solo anagrafe/journal/feed.
    pub fn commit_document_bytes_write(
        &mut self,
        prepared: PreparedDocumentBytesWrite,
        bytes: &[u8],
        model: Option<DocumentModel>,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<PreparedDocumentFeed> {
        self.indexes.ensure_mutation_available()?;
        let PreparedDocumentBytesWrite {
            id,
            path,
            from,
            expected_bytes,
            ..
        } = prepared;
        if let Err(error) = before_write {
            return Err(Self::before_write_error(&id, error));
        }
        let stored = self
            .docs
            .vault
            .storage()
            .write_if_unchanged(&path, expected_bytes.as_deref(), bytes)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        let stat = match stored {
            crate::storage::ConditionalWrite::Written(stat) => stat,
            crate::storage::ConditionalWrite::Changed => {
                return Err(if expected_bytes.is_some() {
                    KernelError::Stale(id.to_string())
                } else {
                    KernelError::AlreadyExists(id.to_string())
                });
            }
        };
        let revision = Revision::of_bytes(bytes);
        let (changes, losses, providers) = match &model {
            Some(model) => (
                self.indexes.core.changes_for(model, &revision),
                self.indexes
                    .core
                    .on_documents_indexed(std::slice::from_ref(model)),
                self.indexes.feed_handles(),
            ),
            None => (DocChanges::default(), Vec::new(), Vec::new()),
        };
        self.set_entry(&id, stat.size, stat.mtime, Some(revision.clone()));
        let journal = if expected_bytes.is_some() {
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

    /// Via breve raw: prepara detached, parsa fuori lock, committa atomico,
    /// finalizza; su CAS fallita niente eventi.
    pub fn write_document_bytes(
        &mut self,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision> {
        let prepared = self.prepare_document_bytes_write(id, expected)?;
        let model = prepared.parse(bytes)?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut host = self.host_for(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut host)
        });
        let pending = self.commit_document_bytes_write(prepared, bytes, model, before_write)?;
        let pending = pending.invoke_indexes();
        self.finalize_document_write(pending)
    }

    /// Scrive la sorgente, riparsa il documento, aggiorna il grafo ed emette
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
    pub fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision> {
        let prepared = self.prepare_document_write(id, base)?;
        let model = prepared.parse(source)?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut host = self.host_for(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut host)
        });
        self.finish_document_write(prepared, source, model, before_write)
    }

    /// Il corpo di una scrittura, **senza la riga di registro**: parse, disco,
    /// coda di ogni scrittura, eventi. Rende la revisione prodotta.
    ///
    /// Esiste perché i tre chiamanti raccontano tre cose diverse al registro —
    /// un salvataggio, una modifica chirurgica, un ripristino dal cestino — e
    /// senza questa separazione ognuno ne avrebbe scritte **due**: la propria e
    /// quella di `write_document`, cioè una mutazione contata due volte in una
    /// lista che esiste per essere ripercorsa.
    fn write_source(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
    ) -> Result<Revision> {
        self.indexes.ensure_mutation_available()?;
        // Il parse è puro: farlo PRIMA di scrivere tiene la mutazione atomica.
        // Nell'ordine inverso un parse fallito lascerebbe il disco avanti
        // rispetto a modelli/grafo/indici — e il chiamante riceverebbe `Err`
        // pur avendo scritto.
        let model = self.docs.parse(id, source)?;
        // Il gancio **prima della scrittura** (0154): fra il parse e il disco
        // l'originale è ancora leggibile, e chi ha registrato una chiusura
        // (la fotografia del versioning) la vuole guardare in questo istante.
        // Un suo errore ferma la scrittura: sovrascrivere senza che la
        // fotografia sia riuscita sarebbe la finestra che il meccanismo
        // esiste per chiudere. L'host è intestato al plugin che ha registrato
        // il gancio, in modalità `Apply` — e non è `with_host`, che in fondo
        // drenerebbe la coda delle scritture mentre siamo dentro una scrittura.
        let hooks = self.before_write.clone();
        for hook in before_write_calls(&hooks, id) {
            let mut host = self.host_for(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut host)
                .map_err(|and| Self::before_write_error(id, and))?;
        }
        self.write_source_parsed(id, source, expected_source, model)
    }

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

    /// Seconda metà di `write_source`: parse e gancio sono già tornati. Da qui
    /// in poi restano soltanto storage/CAS, ingestione ed eventi.
    fn write_source_parsed(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
        model: DocumentModel,
    ) -> Result<Revision> {
        self.indexes.ensure_mutation_available()?;
        // Dimensione e data arrivano dalla scrittura stessa: sono ciò che i byte
        // appena posati dicono di sé, e ripeterle al disco con una `stat` era il
        // difetto 0179.
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

    /// Scrive una riga nel registro delle mutazioni (§15.2).
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

    /// Ciò che è successo a questo vault, e **cosa non si è potuto leggere**
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
    pub fn journal(&self) -> Result<JournalRead> {
        self.journal.read().map_err(|and| KernelError::Io {
            path: self.journal.path().to_owned(),
            source: and,
        })
    }

    /// Pota il registro alla finestra dichiarata (§23.9).
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
    fn prunes_the_record(&self) {
        let days = match self.setting(crate::journal::RETENTION_DAYS) {
            Ok(SettingValue::Number(n)) if n > 0.0 => n as u64,
            _ => 0,
        };
        self.journal.prune(days);
    }

    // -----------------------------------------------------------------------
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
    /// `base` è la revisione del file su cui il buffer sta lavorando (`None`
    /// per una nota mai salvata) e non si deduce qui di proposito: dedurla
    /// vorrebbe dire rileggere il file a ogni battuta, e per giunta darebbe la
    /// revisione di **adesso** invece di quella su cui l'utente stava
    /// scrivendo — cioè proprio l'informazione che serve per accorgersi che il
    /// file è cambiato sotto.
    pub fn save_draft(
        &mut self,
        doc: &DocId,
        text: &str,
        base: Option<Revision>,
    ) -> std::io::Result<()> {
        let at = self.now_unix_millis();
        self.drafts.save(doc, text, base, at)
    }

    /// Butta la bozza di un documento: il buffer è tornato pulito, o l'utente ha
    /// scelto di scartarla.
    pub fn discard_draft(&mut self, doc: &DocId) -> std::io::Result<()> {
        self.drafts.discard(doc)
    }

    /// Le bozze di questo vault, **e quante non si sono lette**.
    ///
    /// Dal disco e non da una cache, per la ragione del registro: dopo un crash
    /// non c'è nessuna memoria da consultare, ed è l'unico momento in cui questa
    /// domanda conta davvero.
    ///
    /// E una cartella che **non si legge** non è una cartella senza bozze: là
    /// dentro c'è l'unica copia di ciò che l'utente ha scritto e non ha ancora
    /// salvato, quindi il guasto risale con il path invece di diventare un
    /// elenco vuoto.
    pub fn drafts(&self) -> Result<crate::drafts::DraftRead> {
        self.drafts.read().map_err(|and| KernelError::Io {
            path: self.drafts.dir().to_owned(),
            source: and,
        })
    }

    /// La revisione dei byte sorgente di un documento, anche senza un provider
    /// di formato: l'identità del testo su cui una modifica chirurgica va
    /// calcolata (decisione 0008).
    ///
    /// Si legge dal **disco**, come ogni altra lettura del kernel: la verità di
    /// un documento è il file, e una revisione derivata da una cache sarebbe
    /// vera solo finché la cache lo è.
    pub fn document_revision(&self, id: &DocId) -> Result<Revision> {
        Ok(Revision::of_bytes(&self.read_source_bytes(id)?))
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
        // Nel registro va l'**impronta** e non l'inverso: dove la modifica ha
        // toccato e quanto ha sostituito, mai con cosa (0103). Non è
        // `report.inverse()` a cui si toglie il testo — quella funzione qui non
        // si chiama affatto, così i byte dell'utente non passano nemmeno per una
        // variabile sulla strada del disco.
        self.record(JournalOp::Edited {
            doc: id.clone(),
            from,
            to,
            footprint: crate::journal::EditFootprint::of(&report.applied),
        });
        Ok(report)
    }

    /// Riparsa un documento già presente sul disco (usato dal file watcher).
    ///
    /// L'origine è [`Actor::Watcher`] (decisione 0012): questa modifica non è passata da
    /// noi, e chi la riceve — la shell col buffer aperto, un'automazione — deve
    /// poterla distinguere da una scrittura che ha chiesto lui.
    ///
    /// **Ciò che il kernel ha già in memoria non si riparsa**: risponde `false`
    /// e non emette niente, che è la verità — nessuno ha cambiato niente da
    /// quando lo si è letto l'ultima volta. Vedi
    /// [`already_ingested`](Workspace::already_ingested) per il perché.
    pub fn refresh_from_disk(&mut self, id: &DocId) -> Result<bool> {
        self.as_actor(Actor::Watcher, |ws| {
            let Some(src) = ws.source_if_stable(id)? else {
                // Il file sta ancora cambiando, o è sparito fra le due `stat`
                // (difetto 0197). Non è un fallimento: il debounce del
                // rilevatore riproverà, e ingerire la metà sarebbe il difetto.
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

    /// La coda di ogni scrittura: indici, conteggi tag, grafo, metadati in
    /// cache, eventi. Prende il modello già parsato — è ciò che permette a
    /// `write_document` di parsare prima di toccare il disco.
    ///
    /// `posato` è **dimensione e data di ciò che sta sul disco, per chi le sa
    /// già**: chi ha appena scritto le ha ricevute dal supporto insieme
    /// all'esito, e non deve tornare a chiederle (difetto 0179, vedi
    /// [`set_entry`](Workspace::set_entry)). `None` per chi porta dentro un
    /// cambiamento che non ha fatto lui.
    fn prepare_ingest_model(
        &mut self,
        id: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
        placed: Option<(u64, u64)>,
        journal: JournalOp,
    ) -> PreparedDocumentFeed {
        // L'anagrafe segue ogni scrittura (§14.1): dimensione, data e impronta
        // di un documento appena scritto sono cambiate, e una voce ferma a
        // prima direbbe che il file è quello di ieri — a chi la interroga
        // adesso, e alla prossima apertura, che sull'anagrafe decide cosa
        // rileggere.
        // **Prima** di toccare qualunque cosa: è l'unico momento in cui il
        // vecchio e il nuovo esistono insieme (§22.2, decisione 0069). Un
        // istante più in là l'anagrafe ha l'impronta nuova, `self.tags` i tag
        // nuovi e `self.metas` i metadati nuovi, e dire *cosa* è cambiato
        // costerebbe una lettura del disco invece di zero.
        let changes = self.indexes.core.changes_for(&model, &fingerprint);
        match placed {
            Some((size, mtime)) => {
                self.set_entry(id, size, mtime, Some(fingerprint.clone()));
            }
            None => {
                self.touch_entry(id, Some(fingerprint.clone()));
            }
        }
        // Gli indici vedono la modifica dalla stessa operazione del grafo:
        // stessa verità, nessun canale che può perdere pezzi per strada. E la
        // vedono sul modello intero, che il feed preparato qui porta agli
        // indici esterni fuori dal prestito: è l'unico momento in cui corpo e
        // testo esistono — la cache tiene i soli metadati.
        // Un lotto di uno: la scrittura singola È il caso normale, e la firma
        // a lotti non la trasforma in un'eccezione da spiegare.
        let lost = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let providers = self.indexes.feed_handles();
        PreparedDocumentFeed {
            id: id.clone(),
            model: Some(model),
            changes,
            revision: fingerprint,
            journal,
            providers,
            losses: lost,
        }
    }

    fn ingest_model(
        &mut self,
        id: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
        placed: Option<(u64, u64)>,
    ) {
        let pending = self.prepare_ingest_model(
            id,
            model,
            fingerprint,
            placed,
            JournalOp::Written {
                doc: id.clone(),
                from: None,
                to: Revision::of(""),
            },
        );
        let pending = pending.invoke_indexes();
        self.finish_index_feed(pending);
    }

    fn finish_index_feed(&mut self, pending: PreparedDocumentFeed) {
        self.report_losses(pending.losses);
        if pending.model.is_some() && self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            // Il rebuild legge la cache: va aggiornata prima.
            self.indexes.core.rebuild_graph();
        }
        // Il sorgente sotto la selezione è cambiato: gli offset pubblicati
        // dalla shell erano di un altro testo. La shell ne ripubblicherà uno
        // vero al prossimo movimento del cursore (o subito dopo un
        // salvataggio); fino ad allora il contesto dice "non so dove", che è
        // la verità.
        self.session
            .invalidate(&pending.id, ContextChange::Rewritten);
        let changes = pending.model.map(|_| pending.changes);
        self.announce_file_change(pending.id, changes);
    }

    /// Accoda il fatto già committato prima che gli indici esterni possano
    /// rientrare e produrre una modifica successiva dello stesso documento.
    fn announce_index_feed(&mut self, pending: &PreparedDocumentFeed) {
        let changes = pending.model.as_ref().map(|_| pending.changes.clone());
        self.announce_file_change(pending.id.clone(), changes);
    }

    fn announce_file_change(&mut self, id: DocId, changes: Option<DocChanges>) {
        let event = match changes {
            Some(changes) => Event::DocumentChanged {
                id,
                changes: Some(changes),
            },
            None => {
                let kind = self
                    .indexes
                    .core
                    .entries
                    .get(&id)
                    .map(|entry| entry.kind)
                    .unwrap_or(EntryKind::Unknown);
                Event::EntryChanged { id, kind }
            }
        };
        self.emit_event(event);
        self.emit_event(Event::IndexUpdated);
    }

    /// Chiude il solo feed watcher. Perdite e frame appartengono alla callback
    /// e vanno sempre recuperati; grafo e sessione, invece, possono seguire il
    /// risultato preparato soltanto finché quella revisione è ancora corrente.
    fn finish_sync_index_feed(&mut self, pending: PreparedDocumentFeed, current: bool) {
        self.report_losses(pending.losses);
        if !current {
            return;
        }
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        self.session
            .invalidate(&pending.id, ContextChange::Rewritten);
    }

    /// Sincronizza un path assoluto dopo un evento del filesystem: riparsa se
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
    ///
    /// La porta sincrona orchestra lo stesso protocollo staged del watcher:
    /// pianifica senza I/O, invoca il piano detached e applica il risultato
    /// attraverso l'unico percorso che gestisce feed, rimozioni e rinomine.
    pub fn sync_path(&mut self, abs: &Utf8Path) -> Result<bool> {
        let prepared = self.plan_sync(abs).map(SyncPlan::invoke);
        self.sync_path_prepared(abs, prepared)
    }

    /// Cattura la politica e lo storage necessari al filtro di un path.
    ///
    /// Questa metà non fa I/O; il watcher invoca il token dopo aver rilasciato
    /// `Custody`, quindi rientra con il solo esito.
    pub fn prepare_is_ignored(&self, abs: &Utf8Path) -> PreparedIgnoreCheck {
        self.docs.vault.prepare_is_ignored(abs)
    }

    /// Prepara una lettura del watcher conservando la porta sincrona storica.
    ///
    /// I chiamanti sotto `Custody` usano invece [`prepare_is_ignored`] e
    /// [`plan_sync_admitted`], separando il possibile `stat` dalla
    /// pianificazione pura.
    pub fn plan_sync(&self, abs: &Utf8Path) -> Option<SyncPlan> {
        if self.prepare_is_ignored(abs).invoke() {
            return None;
        }
        self.plan_sync_admitted(abs)
    }

    /// Prepara un path che il filtro owned ha già ammesso.
    ///
    /// Non interroga lo storage e non ricalcola la politica di esclusione.
    pub fn plan_sync_admitted(&self, abs: &Utf8Path) -> Option<SyncPlan> {
        let id = self.docs.vault.doc_id_for_path(abs).ok()?;
        self.plan_sync_known(abs.to_owned(), id)
    }

    /// Classifica una rinomina esterna conservando la porta sincrona storica.
    pub fn plan_external_rename(&self, from: &Utf8Path, to: &Utf8Path) -> ExternalRenamePlan {
        let from_admitted = !self.prepare_is_ignored(from).invoke();
        let to_admitted = !self.prepare_is_ignored(to).invoke();
        self.plan_external_rename_admitted(from, from_admitted, to, to_admitted)
    }

    /// Classifica una rinomina dai due esiti già valutati fuori da `Custody`.
    ///
    /// Documenti e asset riconosciuti portano handle owned; ogni caso ambiguo
    /// degrada agli stessi piani `Touched` della consegna ordinaria. Questa
    /// funzione non interroga lo storage né ricalcola il filtro.
    pub fn plan_external_rename_admitted(
        &self,
        from: &Utf8Path,
        from_admitted: bool,
        to: &Utf8Path,
        to_admitted: bool,
    ) -> ExternalRenamePlan {
        let sync_plan = |path: &Utf8Path, admitted: bool| {
            admitted.then(|| self.plan_sync_admitted(path)).flatten()
        };
        let fallback = |only_to: bool| {
            let paths = if only_to {
                vec![(to.to_owned(), to_admitted)]
            } else {
                vec![
                    (from.to_owned(), from_admitted),
                    (to.to_owned(), to_admitted),
                ]
            };
            ExternalRenamePlan::Sync(
                paths
                    .into_iter()
                    .map(|(path, admitted)| {
                        let plan = sync_plan(&path, admitted);
                        (path, plan)
                    })
                    .collect(),
            )
        };
        let identity = |path: &Utf8Path, admitted: bool| {
            admitted
                .then(|| self.docs.vault.doc_id_for_path(path).ok())
                .flatten()
        };
        let (Some(from_id), Some(to_id)) =
            (identity(from, from_admitted), identity(to, to_admitted))
        else {
            return fallback(false);
        };
        if from_id == to_id {
            return fallback(true);
        }

        let from_entry = self.indexes.core.entries.get(&from_id).cloned();
        let to_entry = self.indexes.core.entries.get(&to_id).cloned();
        let destination_free = to_entry.is_none() && !self.indexes.core.metas.contains_key(&to_id);
        let from_document = self.indexes.core.metas.contains_key(&from_id);
        let to_has_provider = self
            .docs
            .registry
            .provider_for_ext(&extension_of(&to_id).unwrap_or_default())
            .is_some();
        let to_kind = media::kind_of_ext(&to_id, |ext| self.docs.registry.has_doc_ext(ext));
        if from_document && destination_free && to_has_provider {
            let Some(from_entry) = from_entry.clone() else {
                return fallback(false);
            };
            let Some(descriptor) = self
                .docs
                .registry
                .descriptor_for_ext(&extension_of(&to_id).unwrap_or_default())
            else {
                return fallback(false);
            };
            let Ok(parser) = self.docs.prepare_parse(&to_id) else {
                return fallback(false);
            };
            let side_data = self.prepare_rename_side_data(&from_id, &to_id);
            return ExternalRenamePlan::Document(Box::new(PreparedExternalDocumentRename {
                snapshot: ExternalRenameSnapshot {
                    workspace_id: self.workspace_id,
                    from_path: from.to_owned(),
                    to_path: to.to_owned(),
                    from_id,
                    to_id,
                    from_entry,
                    to_entry,
                    syntax_generation: self.syntax_generation,
                    routing_generation: self.indexes.routing_generation(),
                },
                storage: Arc::clone(self.docs.vault.storage()),
                parser,
                source_kind: descriptor.source,
                side_data,
            }));
        }

        let from_has_provider = self
            .docs
            .registry
            .provider_for_ext(&extension_of(&from_id).unwrap_or_default())
            .is_some();
        let Some(from_entry) = from_entry else {
            return fallback(false);
        };
        if !destination_free
            || from_entry.kind != EntryKind::Asset
            || from_has_provider
            || to_has_provider
            || to_kind != EntryKind::Asset
        {
            return fallback(false);
        }

        let fallback_plans = [
            (from.to_owned(), from_admitted),
            (to.to_owned(), to_admitted),
        ]
        .into_iter()
        .map(|(path, admitted)| {
            let plan = sync_plan(&path, admitted);
            (path, plan)
        })
        .collect();
        ExternalRenamePlan::Asset(Box::new(PreparedExternalAssetRename {
            snapshot: ExternalRenameSnapshot {
                workspace_id: self.workspace_id,
                from_path: from.to_owned(),
                to_path: to.to_owned(),
                from_id,
                to_id,
                from_entry,
                to_entry,
                syntax_generation: self.syntax_generation,
                routing_generation: self.indexes.routing_generation(),
            },
            storage: Arc::clone(self.docs.vault.storage()),
            organization: Arc::clone(&self.organization),
            doc_data_roots: self.docs.plugin_data_roots(),
            fallback: fallback_plans,
        }))
    }

    /// Riconvalida la fotografia e installa remove+feed nel solo core.
    pub fn prepare_external_document_rename(
        &mut self,
        parsed: ParsedExternalDocumentRename,
    ) -> Result<Option<PendingExternalDocumentRename>> {
        let ParsedExternalDocumentRename {
            snapshot,
            state,
            side_data,
        } = parsed;
        let (model, fingerprint, stat) = match state {
            ParsedExternalDocumentState::Ready {
                model,
                fingerprint,
                stat,
            } => (model, fingerprint, stat),
            ParsedExternalDocumentState::Failed(error) => {
                let outcome: Result<()> = Err(error);
                self.notes_sync(&snapshot.to_path, &outcome);
                return Ok(None);
            }
            ParsedExternalDocumentState::Stale => return Ok(None),
        };
        let current_from = self.indexes.core.entries.get(&snapshot.from_id);
        let current_to = self.indexes.core.entries.get(&snapshot.to_id);
        if snapshot.workspace_id != self.workspace_id
            || self
                .docs
                .vault
                .doc_id_for_path(&snapshot.from_path)
                .ok()
                .as_ref()
                != Some(&snapshot.from_id)
            || self
                .docs
                .vault
                .doc_id_for_path(&snapshot.to_path)
                .ok()
                .as_ref()
                != Some(&snapshot.to_id)
            || current_from != Some(&snapshot.from_entry)
            || current_to != snapshot.to_entry.as_ref()
            || !self.indexes.core.metas.contains_key(&snapshot.from_id)
            || self.indexes.core.metas.contains_key(&snapshot.to_id)
            || snapshot.from_entry.fingerprint != self.entry_fingerprint(&snapshot.from_id)
            || snapshot.syntax_generation != self.syntax_generation
            || snapshot.routing_generation != self.indexes.routing_generation()
            || model.id != snapshot.to_id
        {
            return Ok(None);
        }
        let removal = self
            .prepare_document_rename_removal(&snapshot.from_id)?
            .expect("il documento riconvalidato esiste");
        let changes = self.indexes.core.changes_for(&model, &fingerprint);
        let installed = VaultEntry {
            id: snapshot.to_id.clone(),
            kind: EntryKind::Document,
            size: stat.size,
            mtime: stat.mtime,
            fingerprint: Some(fingerprint.clone()),
        };
        self.indexes.core.ensure_folders_of(&snapshot.to_id);
        self.indexes.core.set_entry(installed.clone());
        let losses = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let feed = PreparedDocumentFeed {
            id: snapshot.to_id.clone(),
            model: Some(*model),
            changes,
            revision: fingerprint,
            journal: JournalOp::Renamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
            },
            providers: self.indexes.feed_handles(),
            losses,
        };
        self.session.invalidate(
            &snapshot.from_id,
            ContextChange::Renamed(snapshot.to_id.clone()),
        );
        self.as_actor(Actor::Watcher, |ws| {
            ws.record(JournalOp::Renamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
            });
            ws.emit_event(Event::DocumentRenamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
            });
            ws.emit_event(Event::IndexUpdated);
        });
        Ok(Some(PendingExternalDocumentRename {
            snapshot,
            installed,
            removal,
            feed,
            side_data,
        }))
    }

    /// Recupera sempre frame, perdite e warning; grafo e note di sync seguono
    /// il token soltanto se il core installato è ancora corrente.
    pub fn finish_external_document_rename(
        &mut self,
        completed: CompletedExternalDocumentRename,
    ) -> std::result::Result<bool, Box<(PluginError, CompletedExternalDocumentRename)>> {
        if completed.snapshot.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict(
                    "la rinomina documento appartiene a un altro workspace".into(),
                ),
                completed,
            )));
        }
        let CompletedExternalDocumentRename {
            snapshot,
            installed,
            removal,
            feed,
            side_data,
        } = completed;
        let removal_losses = match self.finish_document_rename_removal(removal) {
            Ok(losses) => losses,
            Err(removal) => {
                return Err(Box::new((
                    PluginError::Conflict(
                        "la rimozione della rinomina appartiene a un altro workspace".into(),
                    ),
                    CompletedExternalDocumentRename {
                        snapshot,
                        installed,
                        removal,
                        feed,
                        side_data,
                    },
                )));
            }
        };
        self.report_losses(removal_losses);
        self.report_losses(feed.losses);
        self.report_rename_side_data(side_data);
        let current = !self.indexes.core.entries.contains_key(&snapshot.from_id)
            && self.indexes.core.entries.get(&snapshot.to_id) == Some(&installed)
            && self.entry_fingerprint(&snapshot.to_id) == installed.fingerprint
            && self.indexes.core.metas.contains_key(&snapshot.to_id)
            && snapshot.syntax_generation == self.syntax_generation
            && snapshot.routing_generation == self.indexes.routing_generation();
        if !current {
            return Ok(false);
        }
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        let outcome: Result<bool> = Ok(true);
        self.notes_sync(&snapshot.to_path, &outcome);
        Ok(true)
    }

    /// Applica soltanto al core un asset già osservato sul path d'arrivo.
    /// Nessun filesystem, sidecar o provider viene attraversato qui.
    pub fn prepare_external_asset_rename(
        &mut self,
        parsed: ParsedExternalAssetRename,
    ) -> Option<PendingExternalAssetRename> {
        let ParsedExternalAssetRename {
            snapshot,
            stat,
            fingerprint,
            organization,
            storage,
            doc_data_roots,
        } = parsed;
        let current_from = self.indexes.core.entries.get(&snapshot.from_id);
        let current_to = self.indexes.core.entries.get(&snapshot.to_id);
        if snapshot.workspace_id != self.workspace_id
            || self
                .docs
                .vault
                .doc_id_for_path(&snapshot.from_path)
                .ok()
                .as_ref()
                != Some(&snapshot.from_id)
            || self
                .docs
                .vault
                .doc_id_for_path(&snapshot.to_path)
                .ok()
                .as_ref()
                != Some(&snapshot.to_id)
            || current_from != Some(&snapshot.from_entry)
            || current_to != snapshot.to_entry.as_ref()
            || snapshot.from_entry.fingerprint != self.entry_fingerprint(&snapshot.from_id)
            || self.indexes.core.metas.contains_key(&snapshot.to_id)
            || snapshot.syntax_generation != self.syntax_generation
            || snapshot.routing_generation != self.indexes.routing_generation()
        {
            return None;
        }
        let installed = VaultEntry {
            id: snapshot.to_id.clone(),
            kind: snapshot.from_entry.kind,
            size: stat.size,
            mtime: stat.mtime,
            fingerprint: Some(fingerprint),
        };
        self.as_actor(Actor::Watcher, |ws| {
            ws.indexes.core.remove_entry(&snapshot.from_id);
            ws.indexes.core.ensure_folders_of(&snapshot.to_id);
            ws.indexes.core.set_entry(installed.clone());
            ws.record(JournalOp::Renamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
            });
            ws.emit_event(Event::EntryRenamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
                kind: installed.kind,
            });
            ws.emit_event(Event::IndexUpdated);
        });
        Some(PendingExternalAssetRename {
            snapshot,
            installed,
            organization,
            storage,
            doc_data_roots,
        })
    }

    /// Recupera sempre i warning detached; l'epilogo derivato resta subordinato
    /// all'identità installata dal token.
    pub fn finish_external_asset_rename(
        &mut self,
        completed: CompletedExternalAssetRename,
    ) -> std::result::Result<bool, Box<(PluginError, CompletedExternalAssetRename)>> {
        if completed.snapshot.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict("la rinomina asset appartiene a un altro workspace".into()),
                completed,
            )));
        }
        let CompletedExternalAssetRename {
            snapshot,
            installed,
            doc_data_errors,
        } = completed;
        for error in doc_data_errors {
            self.doc_data_warnings.push(format!(
                "lo stato per-documento di {} non ha potuto seguire la rinomina in {} — {error}",
                snapshot.from_id, snapshot.to_id
            ));
        }
        let current = !self.indexes.core.entries.contains_key(&snapshot.from_id)
            && self.indexes.core.entries.get(&snapshot.to_id) == Some(&installed)
            && self.entry_fingerprint(&snapshot.to_id) == installed.fingerprint
            && snapshot.syntax_generation == self.syntax_generation
            && snapshot.routing_generation == self.indexes.routing_generation();
        Ok(current)
    }

    /// Compone un piano da un'identità già recintata e filtrata.
    ///
    /// Non interroga il vault: la riconciliazione d'apertura usa questa metà
    /// dopo che la propria scansione detached ha deciso i candidati.
    fn plan_sync_known(&self, path: Utf8PathBuf, id: DocId) -> Option<SyncPlan> {
        let ext = extension_of(&id).unwrap_or_default();
        let entry = self.indexes.core.entries.get(&id).cloned();
        let seen = entry.as_ref().and_then(|entry| entry.fingerprint.clone());
        let action = if let (Some(descriptor), Ok(parser)) = (
            self.docs.registry.descriptor_for_ext(&ext),
            self.docs.prepare_parse(&id),
        ) {
            SyncPlanAction::Parse {
                storage: Arc::clone(self.docs.vault.storage()),
                parser: Box::new(parser),
                source_kind: descriptor.source,
                already_ingested: self.indexes.core.metas.contains_key(&id),
            }
        } else {
            SyncPlanAction::Stat {
                storage: Arc::clone(self.docs.vault.storage()),
            }
        };
        Some(SyncPlan {
            snapshot: SyncSnapshot {
                workspace_id: self.workspace_id,
                path,
                id,
                seen,
                entry,
                syntax_generation: self.syntax_generation,
                routing_generation: self.indexes.routing_generation(),
            },
            action,
        })
    }

    /// Legge testo soltanto quando i due `stat` ai lati della lettura
    /// combaciano. Il percorso sincrono legacy usa ancora questa porta.
    ///
    /// Se dimensione o data cambiano, qualcun altro sta ancora scrivendo e
    /// questi byte sono una metà (difetto 0197).
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

    /// **Questi byte sono già quelli che il kernel ha in memoria?**
    ///
    /// L'impronta in anagrafe è quella dell'ultimo sorgente ingerito: se il
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
    fn already_ingested(&self, id: &DocId, fingerprint: &Revision) -> bool {
        self.indexes.core.metas.contains_key(id)
            && self.entry_fingerprint(id).as_ref() == Some(fingerprint)
    }

    /// L'impronta che un piano porta con sé per rilevare una mutazione
    /// intervenuta prima della finalizzazione.
    fn entry_fingerprint(&self, id: &DocId) -> Option<Revision> {
        self.indexes
            .core
            .entries
            .get(id)
            .and_then(|and| and.fingerprint.clone())
    }

    /// Valida e applica al solo core un risultato già invocato.
    ///
    /// Nessun filesystem o provider viene attraversato qui. Un token stale,
    /// una lettura instabile o un routing cambiato vengono scartati senza
    /// fallback e senza eventi.
    pub fn prepare_sync_path_prepared(
        &mut self,
        abs: &Utf8Path,
        prepared: Option<ParsedChange>,
    ) -> Result<Option<PendingSyncChange>> {
        let Some(parsed) = prepared else {
            return Ok(None);
        };
        let outcome = (|| {
            if parsed.snapshot.workspace_id != self.workspace_id
                || parsed.snapshot.path != abs
                || self.docs.vault.doc_id_for_path(abs).ok().as_ref() != Some(&parsed.snapshot.id)
                || self.indexes.core.entries.get(&parsed.snapshot.id)
                    != parsed.snapshot.entry.as_ref()
                || parsed.snapshot.syntax_generation != self.syntax_generation
                || parsed.snapshot.routing_generation != self.indexes.routing_generation()
            {
                return Ok(None);
            }
            let ParsedChange { snapshot, state } = parsed;
            match state {
                ParsedChangeState::Ready {
                    model,
                    fingerprint,
                    stat,
                } => {
                    self.indexes.ensure_mutation_available()?;
                    let previous_provider_call = self.dispatch.enter_provider_call();
                    let feed = self.as_actor(Actor::Watcher, |ws| {
                        let feed = ws.prepare_ingest_model(
                            &snapshot.id,
                            *model,
                            fingerprint,
                            Some((stat.size, stat.mtime)),
                            JournalOp::Written {
                                doc: snapshot.id.clone(),
                                from: snapshot.seen.clone(),
                                to: Revision::of(""),
                            },
                        );
                        ws.announce_index_feed(&feed);
                        feed
                    });
                    Ok(Some(PendingSyncChange {
                        snapshot,
                        state: PendingSyncState::Feed {
                            feed: Box::new(feed),
                            previous_provider_call,
                        },
                    }))
                }
                ParsedChangeState::Missing => {
                    let removal =
                        self.prepare_sync_document_removal(&snapshot.id)?
                            .map(|removal| PendingSyncChange {
                                snapshot,
                                state: PendingSyncState::Removal(removal),
                            });
                    Ok(removal)
                }
                ParsedChangeState::Entry(stat) => Ok(Some(PendingSyncChange {
                    snapshot,
                    state: PendingSyncState::Entry(stat),
                })),
                ParsedChangeState::Failed(error) => Err(error),
                ParsedChangeState::Unchanged(stat) => Ok(Some(PendingSyncChange {
                    snapshot,
                    state: PendingSyncState::Unchanged(stat),
                })),
                ParsedChangeState::Unstable => Ok(None),
            }
        })();
        self.notes_sync(abs, &outcome);
        outcome
    }

    /// Chiude feed, rimozione o aggiornamento d'anagrafe dopo la fase detached.
    ///
    /// Un errore conserva il token completo: in particolare una rimozione
    /// consegnata al workspace sbagliato deve poter tornare al proprietario,
    /// che è l'unico autorizzato a ripristinarne il frame provider.
    pub fn finish_sync_path_prepared(
        &mut self,
        completed: CompletedSyncChange,
    ) -> std::result::Result<bool, Box<(PluginError, CompletedSyncChange)>> {
        if completed.snapshot.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict("la sincronizzazione appartiene a un altro workspace".into()),
                completed,
            )));
        }
        let CompletedSyncChange { snapshot, state } = completed;
        match state {
            CompletedSyncState::Feed {
                feed,
                previous_provider_call,
            } => {
                self.dispatch.restore_provider_call(previous_provider_call);
                let current = self
                    .docs
                    .vault
                    .doc_id_for_path(&snapshot.path)
                    .ok()
                    .as_ref()
                    == Some(&snapshot.id)
                    && snapshot.routing_generation == self.indexes.routing_generation()
                    && snapshot.syntax_generation == self.syntax_generation
                    && self.entry_fingerprint(&snapshot.id).as_ref() == Some(&feed.revision);
                self.as_actor(Actor::Watcher, |ws| {
                    ws.finish_sync_index_feed(*feed, current)
                });
                Ok(current)
            }
            CompletedSyncState::Removal(removal) => {
                match self.finish_sync_document_removal(removal) {
                    Ok(()) => Ok(true),
                    Err((error, removal)) => Err(Box::new((
                        error,
                        CompletedSyncChange {
                            snapshot,
                            state: CompletedSyncState::Removal(removal),
                        },
                    ))),
                }
            }
            CompletedSyncState::Entry(stat) => {
                if self
                    .docs
                    .vault
                    .doc_id_for_path(&snapshot.path)
                    .ok()
                    .as_ref()
                    != Some(&snapshot.id)
                    || self.indexes.core.entries.get(&snapshot.id) != snapshot.entry.as_ref()
                    || snapshot.syntax_generation != self.syntax_generation
                    || snapshot.routing_generation != self.indexes.routing_generation()
                {
                    return Ok(false);
                }
                Ok(self.as_actor(Actor::Watcher, |ws| {
                    let before = ws.indexes.core.entries.get(&snapshot.id).cloned();
                    let Some(stat) = stat else {
                        let Some(kind) = ws.indexes.core.remove_entry(&snapshot.id) else {
                            return false;
                        };
                        ws.emit_event(Event::EntryRemoved {
                            id: snapshot.id,
                            kind,
                        });
                        return true;
                    };
                    let fingerprint = before.as_ref().and_then(|entry| {
                        (entry.size == stat.size && entry.mtime == stat.mtime)
                            .then(|| entry.fingerprint.clone())
                            .flatten()
                    });
                    let kind = ws.set_entry(&snapshot.id, stat.size, stat.mtime, fingerprint);
                    if ws.indexes.core.entries.get(&snapshot.id) == before.as_ref() {
                        return false;
                    }
                    ws.emit_event(Event::EntryChanged {
                        id: snapshot.id,
                        kind,
                    });
                    true
                }))
            }
            CompletedSyncState::Unchanged(stat) => {
                if self
                    .docs
                    .vault
                    .doc_id_for_path(&snapshot.path)
                    .ok()
                    .as_ref()
                    != Some(&snapshot.id)
                    || self.indexes.core.entries.get(&snapshot.id) != snapshot.entry.as_ref()
                    || snapshot.syntax_generation != self.syntax_generation
                    || snapshot.routing_generation != self.indexes.routing_generation()
                {
                    return Ok(false);
                }
                let Some(fingerprint) = snapshot.seen else {
                    return Ok(false);
                };
                self.set_entry(&snapshot.id, stat.size, stat.mtime, Some(fingerprint));
                Ok(false)
            }
        }
    }

    /// Compatibilità dei chiamanti kernel sincroni. Il watcher di processo usa
    /// le due porte separate sopra e non attraversa provider sotto `Custody`.
    pub fn sync_path_prepared(
        &mut self,
        abs: &Utf8Path,
        prepared: Option<ParsedChange>,
    ) -> Result<bool> {
        let Some(prepared) = self.prepare_sync_path_prepared(abs, prepared)? else {
            return Ok(false);
        };
        let completed = prepared.invoke();
        let outcome = match self.finish_sync_path_prepared(completed) {
            Ok(changed) => Ok(changed),
            Err(failure) => {
                let (error, _completed) = *failure;
                self.report_host_trouble(Severity::Warning, error);
                Ok(false)
            }
        };
        self.dispatch_pending();
        outcome
    }

    /// Cattura sotto prestito soltanto handle e anagrafe owned.
    ///
    /// La scansione non parte finché il chiamante non invoca il token dopo
    /// aver rilasciato il workspace.
    pub fn prepare_catch_up(&self) -> PreparedCatchUp {
        PreparedCatchUp {
            vault: self.docs.vault.clone(),
            entries: self.indexes.core.entries.clone(),
        }
    }

    /// **I piani che chiudono la finestra di apertura** (§15.7): ciò che è
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
    /// sta in entrambi. `size` e `mtime` sono il filtro economico; quando
    /// combaciano, l'impronta dei byte chiude la finestra delle riscritture
    /// della stessa lunghezza nello stesso millisecondo. Solo chi supera
    /// entrambi i confronti viene saltato.
    /// Un lotto del rilevatore che arrivasse dopo su un path già allineato non
    /// trova niente da fare: l'impronta in anagrafe è la stessa, e
    /// `sync_path_prepared` risponde senza parsare (difetto 0196).
    ///
    /// I piani si fanno sotto prestito condiviso, come [`plan_sync`], e chi li
    /// applica lo fa sotto quello esclusivo: è la regola della
    /// [0119](../../../docs/decisions/README.md)
    /// sull'unico sito che le mancava.
    ///
    /// Qui i piani nascono dai candidati di una scansione già completata, e
    /// questa fase è pura rispetto al vault: non cammina, non apre, non fa
    /// `stat` e non ricalcola la politica di esclusione.
    pub fn plan_catch_up(&self, snapshot: CatchUpSnapshot) -> Vec<(Utf8PathBuf, Option<SyncPlan>)> {
        snapshot
            .candidates
            .into_values()
            .map(|path| {
                let plan = self.plan_sync_admitted(&path);
                (path, plan)
            })
            .collect()
    }

    /// Registra l'esito di una sincronizzazione per-path nel fatto interrogabile
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
    fn notes_sync<T>(&mut self, abs: &Utf8Path, outcome: &Result<T>) {
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

    /// Registra un fallimento della scansione detached di catch-up sulle stesse
    /// superfici delle sincronizzazioni per-path.
    pub fn note_catch_up_failure(&mut self, error: KernelError) {
        let root = self.docs.vault.root().to_owned();
        let outcome: Result<()> = Err(error);
        self.notes_sync(&root, &outcome);
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
                ws.remove_document(&id);
                Ok(existed)
            })
        }
    }

    /// La stessa sincronizzazione per un file che **non è un documento**: si
    /// aggiorna l'anagrafe e si dice cosa è successo, senza leggere niente
    /// (§14.1).
    ///
    /// Non si legge e non si parsa perché non c'è niente da parsare, e non si
    /// calcola l'impronta perché costerebbe i byte di un file che nessuno ha
    /// chiesto: l'anagrafe dice che c'è, quanto è grande e di quando è, che è
    /// tutto ciò che si può sapere gratis.
    fn sync_entry_here(&mut self, id: &DocId, abs: &Utf8Path) -> Result<bool> {
        self.as_actor(Actor::Watcher, |ws| {
            if abs.exists() {
                let before = ws.indexes.core.entries.get(id).cloned();
                let fingerprint = match (&before, ws.docs.vault.stat(id)) {
                    // Stessa dimensione e stessa data: è lo stesso contenuto, e
                    // un'impronta che qualcuno aveva calcolato vale ancora.
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
                    // Cambiato: l'impronta di prima descriveva un altro
                    // contenuto, e tenerla sarebbe scrivere una bugia in
                    // anagrafe. Chi la vorrà la calcolerà leggendo i byte.
                    _ => None,
                };
                let Some(kind) = ws.touch_entry(id, fingerprint) else {
                    return Ok(false);
                };
                if ws.indexes.core.entries.get(id) == before.as_ref() {
                    // Nessuna differenza: un rilevatore che riferisce due volte
                    // lo stesso fatto non è un fatto due volte.
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

    /// Rimuove un documento (usato dal file watcher su cancellazione).
    pub fn remove_document(&mut self, id: &DocId) {
        match self.prepare_document_removal(id) {
            Ok(Some(prepared)) => {
                let completed = prepared.invoke();
                if let Err((error, _)) = self.finish_document_removal(completed) {
                    self.report_trouble(Severity::Warning, Some(id.clone()), error, None);
                }
                self.dispatch_pending();
            }
            Ok(None) => {}
            Err(error) => {
                self.report_trouble(Severity::Warning, Some(id.clone()), error.into(), None)
            }
        }
    }

    /// Crea una nota vuota e restituisce il suo [`DocId`].
    ///
    /// Senza `name` nasce `Senza titolo` nella cartella configurata da
    /// `files.new-note-folder` — o nella radice se il valore è vuoto — e se il
    /// nome è già preso usa `Senza titolo 1`, `2`, … (D3). Con `name` è il
    /// flusso "crea nota da link non risolto": un nome semplice usa la stessa
    /// cartella configurata, mentre un path esplicito resta nel path indicato.
    /// Una collisione è un errore, non un nome aggiustato in silenzio.
    ///
    /// Il nome libero si calcola qui dentro, dove il workspace è preso in
    /// esclusiva: cercarlo dal chiamante e poi scrivere sarebbe una corsa fra
    /// la domanda e la risposta.
    pub fn create_notes(&mut self, name: Option<&str>) -> Result<DocId> {
        let id = match name {
            Some(name) => {
                let id = self.new_notes_id(name)?;
                if self.is_taken(&id) {
                    return Err(KernelError::AlreadyExists(id.to_string()));
                }
                id
            }
            None => self.free_name(&self.new_notes_id(UNTITLED)?),
        };
        // Una nota nuova è una scrittura come le altre: grafo, indici ed eventi
        // la vedono nascere per la via normale. `Dictated` perché il nome
        // appena scelto è libero — `free_name` o il controllo sopra l'hanno
        // appena stabilito — e una base sarebbe la revisione di un file che non
        // esiste.
        self.write_document(&id, "", WriteBase::Dictated)?;
        Ok(id)
    }

    /// Il primo nome libero della famiglia `<nome>`, `<nome> 1`, `<nome> 2`, …
    /// a partire da un [`DocId`] qualsiasi. Se `id` è già libero, è lui.
    ///
    /// È la convenzione D3, e vive **qui** perché il workspace è l'unico a
    /// sapere cosa è occupato — in memoria e su disco. La usa `create_notes` per
    /// la nota senza titolo, e la usa l'app quando il ripristino dal cestino
    /// trova il path di nuovo occupato e deve proporre un'alternativa. Due
    /// implementazioni della stessa convenzione (una nel kernel, una nel
    /// frontend) divergerebbero al primo ritocco.
    ///
    /// Non prenota niente: fra la domanda e la scrittura il nome può diventare
    /// occupato, e a quel punto è la scrittura a dirlo. Per questo `create_notes`
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
            .find(|candidate| !self.is_taken(candidate))
            .expect("la sequenza dei candidati è infinita")
    }

    /// Questo path è già di qualcuno? Vale sia l'indicizzato sia ciò che sta
    /// sul disco e il workspace non ha ancora visto.
    pub(crate) fn is_taken(&self, id: &DocId) -> bool {
        self.indexes.core.metas.contains_key(id) || self.docs.vault.exists(id)
    }

    /// Crea una cartella vuota nel vault e la fa comparire nell'albero (§14.3).
    ///
    /// Il nome passa dalla stessa regola di un documento che nasce
    /// ([`new_doc_id`]): recinto, spazio macchina, caratteri riservati e forma
    /// NFC. Una cartella esclusa dalla politica del vault è rifiutata: la
    /// scansione non la vedrebbe, e l'albero mostrerebbe una voce che alla
    /// riapertura sparisce. Una voce già presente — cartella o file — è
    /// [`KernelError::AlreadyExists`] e il disco resta com'era.
    ///
    /// Torna il path normalizzato, che è quello che l'albero mostrerà.
    pub fn create_folder(&mut self, name: &str) -> Result<String> {
        let id = self.check_new_folder(name)?;
        self.docs.vault.create_folder(id.as_str())?;
        self.indexes.core.ensure_folders_of(&id);
        self.indexes.core.set_folder(id.as_str());
        self.emit_event(Event::IndexUpdated);
        Ok(id.as_str().to_string())
    }

    /// Il preflight di [`create_folder`](Workspace::create_folder), senza
    /// scrivere: lo stesso giudizio che darebbe la creazione adesso, e il path
    /// normalizzato che nascerebbe. Serve alla prova a vuoto di un comando;
    /// fra la domanda e la scrittura il nome può ancora occuparsi, e a quel
    /// punto è la creazione a dirlo.
    pub fn check_new_folder(&self, name: &str) -> Result<DocId> {
        let id = new_doc_id(name)?;
        let abs = self.docs.vault.path_for(&id)?;
        if self.docs.vault.is_ignored(&abs) {
            return Err(KernelError::BadName {
                name: name.to_string(),
                why: "la cartella è esclusa dal vault".to_string(),
            });
        }
        if self.docs.vault.exists(&id) {
            return Err(KernelError::AlreadyExists(id.to_string()));
        }
        Ok(id)
    }

    /// Il [`DocId`] di una nota che nasce col nome dato: separatori normalizzati
    /// e, se il nome non porta già un'estensione gestita, quella di default.
    /// Un nome semplice viene collocato nella cartella configurata; un path
    /// esplicito non viene mai ribasato.
    fn new_notes_id(&self, name: &str) -> Result<DocId> {
        // Un nome che nasce: la tolleranza stretta del §15.5.
        let mut id = new_doc_id(name)?;
        if !id.as_str().contains('/') {
            let folder = self
                .settings
                .read()
                .expect("store di configurazione")
                .effective(crate::settings::NEW_NOTE_FOLDER)
                .ok()
                .and_then(|(value, _)| value.as_text().map(str::to_owned))
                .unwrap_or_default();
            let folder = fub_abi::rules::folders::normalized(&folder);
            if !folder.is_empty() {
                id = new_doc_id(&format!("{folder}/{}", id.as_str()))?;
            }
        }
        if self.docs.has_provider_for(&id) {
            return Ok(id);
        }
        // L'estensione scelta nelle impostazioni, se un provider la serve;
        // altrimenti quella del primo provider registrato.
        let chosen = self
            .settings
            .read()
            .expect("store di configurazione")
            .effective(crate::settings::NEW_NOTE_EXTENSION)
            .ok()
            .and_then(|(value, _)| value.as_text().map(str::to_owned))
            .map(|ext| ext.trim().trim_start_matches('.').to_ascii_lowercase())
            .filter(|ext| !ext.is_empty() && !ext.contains(['/', '.']))
            .filter(|ext| self.docs.registry.has_doc_ext(ext));
        let ext = match chosen {
            Some(ext) => ext,
            None => self
                .docs
                .registry
                .default_extension()
                .ok_or(KernelError::NoDefaultFormat)?,
        };
        Ok(DocId::new(format!("{}.{ext}", id.as_str())))
    }

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
        let completed = self.prepare_document_deletion(id)?.invoke()?;
        let committed = match self.commit_document_deletion(completed) {
            Ok(committed) => committed,
            Err(failure) => {
                let (error, completed) = *failure;
                completed.rollback()?;
                return Err(error);
            }
        };
        let finalized = committed.invoke();
        let trashed = match self.finish_document_deletion(finalized) {
            Ok(trashed) => trashed,
            Err(_) => unreachable!("il commit ha già validato l'identità del workspace"),
        };
        Ok(trashed)
    }

    fn finish_deleted_document(
        &mut self,
        id: &DocId,
        trashed: DocId,
        sidecar_fault: Option<KernelError>,
        draft_fault: Option<String>,
        journal_fault: Option<String>,
    ) -> DocId {
        // **E la bozza non salvata se ne va con la nota** (§15.2). Sta qui per
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
        // I callback di storage per bozza e registro sono già avvenuti dal
        // finalizzatore owned. Qui si trasformano soltanto i loro esiti in
        // avvisi e fatti del workspace.
        if let Some(and) = draft_fault {
            self.organization.warn(format!(
                "la bozza non salvata di {id} è rimasta dietro alla nota cestinata: {and}"
            ));
        }
        if let Some(and) = journal_fault {
            self.report_trouble(
                Severity::Failure,
                None,
                PluginError::Internal(format!("registro: {and}").into()),
                None,
            );
        }
        // Il sidecar del cestino non si è scritto: la cancellazione è riuscita
        // ma chi ripristina questa voce tornerà nel posto sbagliato. È la
        // perdita di un dato autorevole (0052 la conta come `Failure`), e
        // `delete_document` è il primo chiamante con il workspace in mano —
        // quindi è qui che il guasto esce sia nel log che nel canale (0062).
        if let Some(fault) = sidecar_fault {
            tracing::warn!(target: "fub.kernel", "cestino: sidecar di {trashed} non scritto: {fault}");
            // Stringa letterale e non chiave di catalogo: è il precedente dei
            // guasti del kernel (`report_losses` passa i messaggi di panico di
            // `safety::reporting`), e il giorno che il centro notifiche vorrà
            // tradurli tutti, li raccoglie insieme.
            self.report_trouble(
                Severity::Failure,
                Some(trashed.clone()),
                PluginError::Internal(
                    format!("cestino: sidecar di {trashed} non scritto: {fault}").into(),
                ),
                None,
            );
        }
        trashed
    }

    /// Elenca il contenuto del cestino, inclusi allegati e voci straniere.
    ///
    /// Il ripristino non ha un gemello sincrono su `Workspace`: parser e indici
    /// devono attraversare il protocollo staged di `workspace::restore`, così
    /// l'host può invocarli dopo aver rilasciato `Custody<Workspace>`.
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        self.docs.vault.list_trash()
    }

    /// Prepara lo sweep del cestino senza accedere allo storage.
    pub fn prepare_empty_trash(&self) -> PreparedTrashSweep {
        self.docs.vault.prepare_empty_trash()
    }

    /// Svuota il cestino. Restituisce quante voci ha cancellato: da qui in poi
    /// non sono più recuperabili, e chi chiama deve poterlo dire.
    pub fn empty_trash(&mut self) -> Result<usize> {
        self.docs.vault.empty_trash()
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
        self.indexes.ensure_mutation_available()?;
        self.batch(|ws| ws.rename_document_in_batch(from, to))
    }

    fn rename_document_in_batch(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        // `to` arriva dall'IPC: senza validazione `../fuori.md` sposterebbe il
        // file fuori dal vault. E la destinazione di un rename è un nome che
        // **nasce**, quindi vale la tolleranza stretta del §15.5: rinominare
        // *verso* `CON.md` è creare un file che su Windows non si apre, mentre
        // rinominare *via da* `CON.md` è precisamente il modo di sistemarlo — ed
        // è per questo che qui si valida `to` e non `from`.
        let to = &new_doc_id(to.as_str())?;
        if from == to {
            return Ok(());
        }
        if !self.indexes.core.metas.contains_key(from) {
            // Non è un documento, ma il vault potrebbe conoscerlo lo stesso
            // (§14.1): spostare un allegato è la stessa operazione, con una
            // coda diversa — non c'è niente da riparsare, e i riferimenti che
            // lo seguono sono quelli che lo mostrano.
            if self.indexes.core.entries.contains_key(from) {
                return self.rename_entry_in_batch(from, to);
            }
            return Err(KernelError::NotFound(from.to_string()));
        }

        let prepared = self
            .prepare_explicit_rename(from, to)?
            .expect("il documento è già stato classificato");
        let parsed = prepared.invoke()?;
        let pending = match self.commit_explicit_rename(parsed) {
            Ok(pending) => pending,
            Err(failure) => {
                let (error, parsed) = *failure;
                parsed.rollback()?;
                return Err(error);
            }
        };
        // `apply_edit` riparsa, aggiorna il grafo ed emette gli eventi come ogni
        // scrittura — con in più la base: se qualcuno ha riscritto una di queste
        // sorgenti da quando il piano è stato calcolato, quella riscrittura non
        // viene cancellata in silenzio, il suo link resta vecchio e il
        // fallimento lo nomina `finish_explicit_rename`, qui sotto.
        let completed = pending
            .invoke()
            .invoke_rewrites(|source, request| self.apply_edit(source, request.clone()).map(drop));
        match self.finish_explicit_rename(completed) {
            Ok(outcome) => outcome,
            Err(_) => unreachable!("il commit ha già validato l'identità del workspace"),
        }
    }

    /// Classifica e fotografa core, routing e pipeline di parse senza I/O né
    /// callback. `None` conserva i due percorsi che non hanno lavoro detached:
    /// no-op e rinomina di una voce non-documento.
    pub fn prepare_explicit_rename(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Result<Option<PreparedExplicitRename>> {
        let to = new_doc_id(to.as_str())?;
        if from == &to {
            return Ok(None);
        }
        if !self.indexes.core.metas.contains_key(from) {
            if self.indexes.core.entries.contains_key(from) {
                return Ok(None);
            }
            return Err(KernelError::NotFound(from.to_string()));
        }
        let to_entry = self.indexes.core.entries.get(&to).cloned();
        if to_entry.is_some() || self.indexes.core.metas.contains_key(&to) {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }
        let ext = extension_of(&to).unwrap_or_default();
        let descriptor = self
            .docs
            .registry
            .descriptor_for_ext(&ext)
            .ok_or_else(|| KernelError::NoProvider(ext.clone()))?;
        let parser = self.docs.prepare_parse(&to)?;
        let from_entry = self
            .indexes
            .core
            .entries
            .get(from)
            .cloned()
            .ok_or_else(|| KernelError::NotFound(from.to_string()))?;
        Ok(Some(PreparedExplicitRename {
            snapshot: ExplicitRenameSnapshot {
                workspace_id: self.workspace_id,
                from_path: self.docs.vault.path_for(from)?,
                to_path: self.docs.vault.path_for(&to)?,
                from: from.clone(),
                to: to.clone(),
                from_entry,
                to_entry,
                syntax_generation: self.syntax_generation,
                routing_generation: self.indexes.routing_generation(),
            },
            storage: Arc::clone(self.docs.vault.storage()),
            parser,
            source_kind: descriptor.source,
            // Il piano di riscrittura va calcolato PRIMA di toccare il grafo:
            // serve la risoluzione con il vecchio nome ancora in vigore.
            rewrites: self.prepare_explicit_link_rewrites(from, &to),
            side_data: self.prepare_rename_side_data(from, &to),
            recovery_root: self.docs.vault.root().to_owned(),
        }))
    }

    /// Riconvalida il solo core della rinomina. Il file e i side-data sono già
    /// stati mossi dal token detached; in caso di rifiuto il chiamante recupera
    /// lo stesso token per il rollback fuori dal guard.
    pub fn commit_explicit_rename(
        &mut self,
        parsed: ParsedExplicitRename,
    ) -> std::result::Result<PendingExplicitRename, Box<(KernelError, ParsedExplicitRename)>> {
        let owns_batch = self.dispatch.open_batch();
        match self.commit_explicit_rename_in_batch(parsed) {
            Ok(mut pending) => {
                pending.owns_batch = owns_batch;
                Ok(pending)
            }
            Err(failure) => {
                if owns_batch {
                    self.dispatch.close_batch();
                }
                Err(failure)
            }
        }
    }

    /// Riconvalida integralmente workspace, generazioni, fotografia del core e
    /// contenuto del token prima della prima mutazione autorevole. Non consulta
    /// lo storage.
    fn commit_explicit_rename_in_batch(
        &mut self,
        parsed: ParsedExplicitRename,
    ) -> std::result::Result<PendingExplicitRename, Box<(KernelError, ParsedExplicitRename)>> {
        let snapshot = &parsed.snapshot;
        let current_from = self.indexes.core.entries.get(&snapshot.from);
        let current_to = self.indexes.core.entries.get(&snapshot.to);
        let source_matches = snapshot.from_entry.fingerprint.as_ref() == Some(&parsed.fingerprint)
            && snapshot.from_entry.size == parsed.stat.size
            && snapshot.from_entry.mtime == parsed.stat.mtime;
        if snapshot.workspace_id != self.workspace_id
            || current_from != Some(&snapshot.from_entry)
            || current_to != snapshot.to_entry.as_ref()
            || !self.indexes.core.metas.contains_key(&snapshot.from)
            || self.indexes.core.metas.contains_key(&snapshot.to)
            || snapshot.syntax_generation != self.syntax_generation
            || snapshot.routing_generation != self.indexes.routing_generation()
            || parsed.model.id != snapshot.to
            || !source_matches
        {
            return Err(Box::new((
                KernelError::Stale(snapshot.from.to_string()),
                parsed,
            )));
        }
        if let Err(error) = self.indexes.ensure_mutation_available() {
            return Err(Box::new((error, parsed)));
        }

        let ParsedExplicitRename {
            snapshot,
            storage: _,
            model,
            fingerprint,
            stat: _,
            identity: _,
            rewrites,
            side_data,
            recovery,
        } = parsed;
        let identity = self
            .migrate_identity_core(&snapshot.from, &snapshot.to, model, fingerprint)
            .expect("la fotografia del core è stata appena riconvalidata");
        Ok(PendingExplicitRename {
            identity,
            rewrites,
            side_data,
            recovery,
            journal: Arc::clone(&self.journal),
            origin: self.dispatch.origin(),
            from: snapshot.from,
            to: snapshot.to,
            owns_batch: false,
        })
    }

    /// Recupera frame e perdite, riporta l'eventuale guasto del registro e
    /// completa il lotto storico. Le riscritture e l'append sono già stati
    /// invocati dal token senza trattenere un prestito del workspace.
    pub fn finish_explicit_rename(
        &mut self,
        completed: CompletedExplicitRename,
    ) -> std::result::Result<Result<()>, Box<(PluginError, CompletedExplicitRename)>> {
        if completed.identity.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict(
                    "la rinomina esplicita appartiene a un altro workspace".into(),
                ),
                completed,
            )));
        }
        let CompletedExplicitRename {
            identity,
            rewrites: _,
            side_data,
            recovery: _,
            owns_batch,
            rewrite_failures,
            journal_fault,
        } = completed;
        if self.finish_identity_migration(identity).is_err() {
            unreachable!("l'identità è già stata legata a questo workspace");
        }
        self.report_rename_side_data(side_data);
        if let Some(and) = journal_fault {
            self.report_trouble(
                Severity::Failure,
                None,
                PluginError::Internal(format!("registro: {and}").into()),
                None,
            );
        }
        let failed = rewrite_failures;
        // Dentro il lotto questo `index-updated` non esce: diventa il
        // `batch-ended` che la chiusura emette. Resta scritto qui perché il
        // rename **ha** aggiornato l'indice, e chi legge questo metodo non deve
        // dedurlo dal fatto che è avvolto in un lotto.
        self.emit_event(Event::IndexUpdated);
        if owns_batch {
            self.dispatch.close_batch();
        }
        // Il lotto non annulla: le sorgenti riscritte restano riscritte anche
        // se una è fallita, ed è la scelta giusta *per il rename* — abortire a
        // metà lascerebbe link misti senza possibilità di retry. Chi vuole il
        // contrario (import, migrazioni) vuole il registro delle mutazioni, che
        // adesso c'è (0067) e di questo lotto tiene i confini — non un campo in
        // più qui.
        if failed.is_empty() {
            Ok(Ok(()))
        } else {
            Ok(Err(KernelError::LinkRewrite(failed.join("; "))))
        }
    }
    /// Fotografa una voce senza modello, i suoi riferimenti e gli handle dei
    /// side-data senza leggere il filesystem né invocare provider.
    pub fn prepare_explicit_asset_rename(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Result<Option<PreparedExplicitAssetRename>> {
        let to = new_doc_id(to.as_str())?;
        if from == &to {
            return Ok(None);
        }
        if self.indexes.core.metas.contains_key(from) {
            return Ok(None);
        }
        let from_entry = self
            .indexes
            .core
            .entries
            .get(from)
            .cloned()
            .ok_or_else(|| KernelError::NotFound(from.to_string()))?;
        let to_entry = self.indexes.core.entries.get(&to).cloned();
        if to_entry.is_some() || self.indexes.core.metas.contains_key(&to) {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }
        Ok(Some(PreparedExplicitAssetRename {
            snapshot: ExplicitRenameSnapshot {
                workspace_id: self.workspace_id,
                from_path: self.docs.vault.path_for(from)?,
                to_path: self.docs.vault.path_for(&to)?,
                from: from.clone(),
                to: to.clone(),
                from_entry,
                to_entry,
                syntax_generation: self.syntax_generation,
                routing_generation: self.indexes.routing_generation(),
            },
            storage: Arc::clone(self.docs.vault.storage()),
            // Il piano PRIMA di spostare: si risolve con il vecchio path ancora in
            // vigore, come per i documenti.
            rewrites: self.prepare_explicit_entry_link_rewrites(from, &to),
            side_data: PreparedAssetRenameSideData {
                from: from.clone(),
                to,
                organization: Arc::clone(&self.organization),
                storage: Arc::clone(self.docs.vault.storage()),
                doc_data_roots: self.docs.plugin_data_roots(),
            },
            recovery_root: self.docs.vault.root().to_owned(),
        }))
    }

    /// Riconvalida e installa nel core un asset già spostato. In caso di stale
    /// restituisce intatto il token, che il chiamante deve annullare fuori dal
    /// guard.
    pub fn commit_explicit_asset_rename(
        &mut self,
        moved: MovedExplicitAssetRename,
    ) -> std::result::Result<PendingExplicitAssetRename, Box<(KernelError, MovedExplicitAssetRename)>>
    {
        let owns_batch = self.dispatch.open_batch();
        match self.commit_explicit_asset_rename_in_batch(moved) {
            Ok(mut pending) => {
                pending.owns_batch = owns_batch;
                Ok(pending)
            }
            Err(failure) => {
                if owns_batch {
                    self.dispatch.close_batch();
                }
                Err(failure)
            }
        }
    }

    fn commit_explicit_asset_rename_in_batch(
        &mut self,
        moved: MovedExplicitAssetRename,
    ) -> std::result::Result<PendingExplicitAssetRename, Box<(KernelError, MovedExplicitAssetRename)>>
    {
        let snapshot = &moved.snapshot;
        let current_from = self.indexes.core.entries.get(&snapshot.from);
        let current_to = self.indexes.core.entries.get(&snapshot.to);
        let source_matches = snapshot.from_entry.fingerprint.as_ref() == Some(&moved.fingerprint)
            && snapshot.from_entry.size == moved.stat.size
            && snapshot.from_entry.mtime == moved.stat.mtime;
        let paths_match = self.docs.vault.path_for(&snapshot.from).ok().as_ref()
            == Some(&snapshot.from_path)
            && self.docs.vault.path_for(&snapshot.to).ok().as_ref() == Some(&snapshot.to_path);
        if snapshot.workspace_id != self.workspace_id
            || current_from != Some(&snapshot.from_entry)
            || current_to != snapshot.to_entry.as_ref()
            || self.indexes.core.metas.contains_key(&snapshot.from)
            || self.indexes.core.metas.contains_key(&snapshot.to)
            || snapshot.syntax_generation != self.syntax_generation
            || snapshot.routing_generation != self.indexes.routing_generation()
            || !source_matches
            || !paths_match
        {
            return Err(Box::new((
                KernelError::Stale(snapshot.from.to_string()),
                moved,
            )));
        }
        if let Err(error) = self.indexes.ensure_mutation_available() {
            return Err(Box::new((error, moved)));
        }

        let MovedExplicitAssetRename {
            snapshot,
            storage: _,
            fingerprint,
            stat,
            identity: _,
            rewrites,
            side_data,
            recovery,
        } = moved;
        // L'impronta segue il file: un rename sposta i byte senza toccarli.
        let installed = VaultEntry {
            id: snapshot.to.clone(),
            kind: snapshot.from_entry.kind,
            size: stat.size,
            mtime: stat.mtime,
            fingerprint: Some(fingerprint),
        };
        self.indexes.core.remove_entry(&snapshot.from);
        self.indexes.core.ensure_folders_of(&snapshot.to);
        self.indexes.core.set_entry(installed.clone());
        Ok(PendingExplicitAssetRename {
            workspace_id: snapshot.workspace_id,
            installed,
            rewrites,
            side_data,
            recovery,
            journal: Arc::clone(&self.journal),
            origin: self.dispatch.origin(),
            from: snapshot.from,
            to: snapshot.to,
            owns_batch: false,
        })
    }

    /// Converte callback e side-data completati nell'unico fatto di rename e
    /// chiude il lotto sotto il guard del workspace.
    pub fn finish_explicit_asset_rename(
        &mut self,
        completed: CompletedExplicitAssetRename,
    ) -> std::result::Result<Result<()>, Box<(PluginError, CompletedExplicitAssetRename)>> {
        if completed.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict(
                    "la rinomina asset esplicita appartiene a un altro workspace".into(),
                ),
                completed,
            )));
        }
        let CompletedExplicitAssetRename {
            workspace_id: _,
            installed,
            side_data,
            from,
            to,
            owns_batch,
            rewrite_failures,
            journal_fault,
        } = completed;
        for error in side_data.errors {
            self.doc_data_warnings.push(format!(
                "lo stato per-documento di {} non ha potuto seguire la rinomina in {} — {error}",
                side_data.from, side_data.to
            ));
        }
        if let Some(and) = journal_fault {
            self.report_trouble(
                Severity::Failure,
                None,
                PluginError::Internal(format!("registro: {and}").into()),
                None,
            );
        }
        self.emit_event(Event::EntryRenamed {
            from,
            to,
            kind: installed.kind,
        });
        self.emit_event(Event::IndexUpdated);
        if owns_batch {
            self.dispatch.close_batch();
        }
        if rewrite_failures.is_empty() {
            Ok(Ok(()))
        } else {
            Ok(Err(KernelError::LinkRewrite(rewrite_failures.join("; "))))
        }
    }

    /// Sposta un file che **non è un documento**, e porta i riferimenti con sé
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
    fn rename_entry_in_batch(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        let prepared = self
            .prepare_explicit_asset_rename(from, to)?
            .expect("la voce senza modello è già stata classificata");
        let moved = prepared.invoke()?;
        let pending = match self.commit_explicit_asset_rename(moved) {
            Ok(pending) => pending,
            Err(failure) => {
                let (error, moved) = *failure;
                moved.rollback()?;
                return Err(error);
            }
        };
        let completed = pending
            .invoke_rewrites(|source, request| self.apply_edit(source, request.clone()).map(drop));
        match self.finish_explicit_asset_rename(completed) {
            Ok(outcome) => outcome,
            Err(_) => unreachable!("il commit ha già validato l'identità del workspace"),
        }
    }

    /// Prepara, senza leggere le sorgenti, le sostituzioni dei riferimenti che
    /// risolvono verso l'asset rinominato.
    ///
    /// Le sorgenti non si chiedono al grafo: un allegato non è un nodo del
    /// grafo, perché non ha link uscenti. Si cammina quindi la cache dei
    /// metadati e si consegnano path, span e testo atteso al token owned, che
    /// leggerà le sorgenti e costruirà le CAS fuori dal workspace.
    fn prepare_explicit_entry_link_rewrites(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Vec<PreparedExplicitLinkRewrite> {
        let mut plan = Vec::new();
        // Il riferimento wiki nuovo dipende solo da `from` e `to`: si chiede
        // all'anagrafe alla prima wikilink che lo richiede, non a ognuna.
        let mut wiki_ref: Option<String> = None;
        for (src, metadata) in &self.indexes.core.metas {
            let mut rewrites = Vec::new();
            for link in &metadata.links {
                if self.indexes.core.resolve_entry(src, &link.target).as_ref() != Some(from) {
                    continue;
                }
                let replacement = match &link.target {
                    LinkTarget::Wiki { .. } => wiki_ref
                        .get_or_insert_with(|| {
                            let name = to.as_str().rsplit('/').next().unwrap_or(to.as_str());
                            let key = fub_abi::rules::path::resolution_key(name);
                            let contended = self.indexes.core.entries.keys().any(|id| {
                                id != to
                                    && id != from
                                    && fub_abi::rules::path::resolution_key(
                                        id.as_str().rsplit('/').next().unwrap_or(id.as_str()),
                                    ) == key
                            });
                            if contended {
                                to.as_str().to_string()
                            } else {
                                name.to_string()
                            }
                        })
                        .clone(),
                    LinkTarget::Path(written) => {
                        let (path, fragment) = rules_path::split_fragment(written);
                        let new = if path.trim_start().starts_with('/') {
                            format!("/{}", rules_path::percent_encode_path(to.as_str()))
                        } else {
                            rules_path::relative_ref(src, to)
                        };
                        let rewritten = format!("{new}{fragment}");
                        if rewritten == *written {
                            continue;
                        }
                        rewritten
                    }
                    LinkTarget::Url(_) => continue,
                };
                rewrites.push(LinkRewrite {
                    span: link.span,
                    target: link.target.clone(),
                    replacement,
                });
            }
            if rewrites.is_empty() {
                continue;
            }
            let Ok(source_path) = self.docs.vault.path_for(src) else {
                continue;
            };
            match self.rewrite_plan_for(src) {
                Some(format_plan) => plan.push(PreparedExplicitLinkRewrite {
                    source_path,
                    destination: src.clone(),
                    provider: Some(format_plan.provider),
                    provider_id: format_plan.provider_id,
                    ctx: format_plan.ctx,
                    source_kind: format_plan.source_kind,
                    rewrites,
                }),
                None => plan.push(PreparedExplicitLinkRewrite {
                    source_path,
                    destination: src.clone(),
                    provider: None,
                    provider_id: String::new(),
                    ctx: ParseContext::obsidian(src.as_str()),
                    source_kind: SourceKind::Text,
                    rewrites,
                }),
            };
        }
        plan
    }
    /// Fotografia provider-owned per una sorgente del piano di riscrittura:
    /// `Arc` + id + contesto + specie, senza eseguire codice esterno sotto lock.
    /// `None` = nessuna riscrittura format-owned possibile per questa sorgente
    /// (nessun provider): il chiamante decide se errore esplicito o skip, mai
    /// fallback raw silenzioso.
    fn rewrite_plan_for(&self, source: &DocId) -> Option<RewritePlan> {
        let ext = extension_of(source).unwrap_or_default();
        let provider = self.docs.registry.provider_arc_for_ext(&ext)?;
        let descriptor = self.docs.registry.descriptor_for_ext(&ext)?.clone();
        Some(RewritePlan {
            provider,
            provider_id: descriptor.id,
            ctx: ParseContext::obsidian(source.as_str()),
            source_kind: descriptor.source,
        })
    }

    /// Installa il cambio d'identità nel core e fotografa gli handle esterni
    /// senza invocare alcun `IndexProvider`.
    fn migrate_identity_core(
        &mut self,
        from: &DocId,
        to: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
    ) -> Result<PendingIdentityMigration> {
        // Per ogni indice — quello del kernel compreso — il rename è
        // remove+add: l'identità è la chiave, e la chiave è cambiata. (Chi
        // tiene stato *per-documento* invece migra la chiave sull'evento
        // `DocumentRenamed`.)
        let removal = self
            .prepare_document_rename_removal(from)?
            .ok_or_else(|| KernelError::NotFound(from.to_string()))?;
        let changes = self.indexes.core.changes_for(&model, &fingerprint);
        // L'anagrafe migra come tutto il resto: la chiave è il path, e il path
        // è cambiato.
        self.touch_entry(to, Some(fingerprint.clone()));
        let installed = self
            .indexes
            .core
            .entries
            .get(to)
            .cloned()
            .expect("touch_entry installa l'identità");
        let losses = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let feed = PreparedDocumentFeed {
            id: to.clone(),
            model: Some(model),
            changes,
            revision: fingerprint,
            journal: JournalOp::Renamed {
                from: from.clone(),
                to: to.clone(),
            },
            providers: self.indexes.feed_handles(),
            losses,
        };
        // La nota aperta segue il rename anche qui: senza, `active_context`
        // risponderebbe col path vecchio e outline/backlink si svuoterebbero
        // fino al prossimo cambio nota. Va fatto nel kernel, non nella shell:
        // vale anche per i rename non innescati da lei.
        self.session
            .invalidate(from, ContextChange::Renamed(to.clone()));
        Ok(PendingIdentityMigration {
            workspace_id: self.workspace_id,
            from: from.clone(),
            to: to.clone(),
            installed,
            removal,
            feed,
        })
    }

    fn finish_identity_migration(
        &mut self,
        completed: CompletedIdentityMigration,
    ) -> std::result::Result<bool, Box<CompletedIdentityMigration>> {
        if completed.workspace_id != self.workspace_id {
            return Err(Box::new(completed));
        }
        let CompletedIdentityMigration {
            from,
            to,
            installed,
            removal,
            feed,
            ..
        } = completed;
        let removal_losses = match self.finish_document_rename_removal(removal) {
            Ok(losses) => losses,
            Err(_) => unreachable!("la rimozione condivide l'identità del workspace"),
        };
        self.report_losses(removal_losses);
        self.report_losses(feed.losses);
        let current = !self.indexes.core.entries.contains_key(&from)
            && self.indexes.core.entries.get(&to) == Some(&installed)
            && self.entry_fingerprint(&to) == installed.fingerprint
            && self.indexes.core.metas.contains_key(&to);
        if current && self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        self.emit_event(Event::DocumentRenamed { from, to });
        Ok(current)
    }

    /// Percorso sincrono usato dal watcher storico.
    fn migrate_identity(
        &mut self,
        from: &DocId,
        to: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
    ) {
        let pending = self
            .migrate_identity_core(from, to, model, fingerprint)
            .expect("la rinomina ha già validato l'identità");
        self.migrate_side_data(from, to);
        let completed = pending.invoke();
        if self.finish_identity_migration(completed).is_err() {
            unreachable!("la migrazione appartiene a questo workspace");
        }
    }

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
        // In anagrafe e non fra i documenti: chi ha un modello è già passato di
        // sopra, e non arriva mai qui.
        if !self.indexes.core.entries.contains_key(&from_id) {
            return;
        }
        if self.indexes.core.entries.contains_key(&to_id)
            || self.indexes.core.metas.contains_key(&to_id)
        {
            return;
        }
        // Se a destinazione non c'è niente questa non è una rinomina ma una
        // sparizione, e portarci lo stato vorrebbe dire metterlo sotto una
        // chiave che la prima raccolta spazza: sotto quella vecchia almeno
        // resta finché il file può tornare.
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

    fn prepare_rename_side_data(&self, from: &DocId, to: &DocId) -> PreparedRenameSideData {
        PreparedRenameSideData {
            from: from.clone(),
            to: to.clone(),
            organization: Arc::clone(&self.organization),
            drafts: Arc::clone(&self.drafts),
            storage: Arc::clone(self.docs.vault.storage()),
            doc_data_roots: self.docs.plugin_data_roots(),
        }
    }

    fn report_rename_side_data(&mut self, completed: CompletedRenameSideData) {
        for error in completed.errors {
            self.doc_data_warnings.push(format!(
                "lo stato di {} non ha potuto seguire la rinomina in {} — {error}",
                completed.from, completed.to
            ));
        }
    }

    /// Porta dietro a una rinomina **tutto ciò che sta attaccato al documento e
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
    fn migrate_side_data(&mut self, from: &DocId, to: &DocId) {
        // **L'organizzazione segue l'identità** (§11.3): icona, pin e posto
        // nell'ordinamento sono attaccati alla nota, non al suo vecchio path.
        //
        // Qui e non sull'evento `DocumentRenamed`, che pure lo direbbe: la coda
        // ha un budget e può troncare (decisione 0034), e l'organizzazione è un
        // dato **autorevole** — perso, non si ricostruisce da niente. Un dato
        // così non può dipendere da una consegna dichiaratamente best-effort.
        // Ne segue il guadagno che si vede: passando di qui migra anche la
        // rinomina fatta da **un'altra app** mentre Fub è aperto, perché
        // `sync_renamed_path` arriva allo stesso punto.
        if let Err(and) = self.organization.migrate(from.as_str(), to.as_str()) {
            self.organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in \
                 {to}: {and}"
            ));
        }
        // **E lo stesso vale per lo stato per-documento di chiunque altro**
        // (§13.2). Sta accanto all'organizzazione perché è la stessa cosa vista
        // in generale: quella è lo stato per-documento *del kernel*, questo è
        // quello di tutti gli altri, e finché il kernel non lo migrava ognuno se
        // lo migrava da sé ascoltando l'evento — cioè nessuno lo migrava per il
        // rename fatto ad app chiusa o da un'altra applicazione.
        //
        // Cammina il **disco** e non i plugin montati, di proposito: chi è
        // spento oggi non deve riaccendersi domani con le chiavi di ieri, ed è
        // esattamente chi non può accorgersene da solo.
        self.migrate_doc_data(from, to);
        // **E la bozza non salvata** (§15.2), che sta accanto ai due di sopra
        // per la ragione dei due di sopra e con un motivo in più: una bozza è
        // l'**unica** copia di ciò che l'utente ha scritto. Se `to` ne ha già
        // una sua, quella di `from` prende un nome di recupero e si elenca
        // come orfana: niente si sovrascrive, e niente resta sotto l'id morto.
        if let Err(and) = self.drafts.migrate(from, to) {
            self.organization.warn(format!(
                "la bozza non salvata di {from} non ha potuto seguire la \
                 rinomina in {to}: {and}"
            ));
        }
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
    ///
    /// Come [`sync_path`](Workspace::sync_path), un fallimento resta scritto
    /// anche se il chiamante non lo legge (§9.7) — e **una volta sola**: i rami
    /// che degradano a `sync_path` passano dal corpo interno, non dalla porta
    /// che registra.
    pub fn sync_renamed_path(&mut self, from: &Utf8Path, to: &Utf8Path) -> Result<bool> {
        let outcome = self.as_actor(Actor::Watcher, |ws| ws.sync_renamed_path_here(from, to));
        // Il soggetto è **dove il file è adesso**: una rinomina che fallisce
        // lascia indietro la destinazione, ed è quella che l'utente ha in mano.
        self.notes_sync(to, &outcome);
        outcome
    }

    fn sync_renamed_path_here(&mut self, from: &Utf8Path, to: &Utf8Path) -> Result<bool> {
        let from_id = (!self.docs.vault.is_ignored(from))
            .then(|| self.docs.vault.doc_id_for_path(from).ok())
            .flatten()
            .filter(|id| self.indexes.core.metas.contains_key(id));
        let Some(from_id) = from_id else {
            // Nessuna **identità di documento** da migrare — ma le due mezze
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
            // Spostato fuori, in una cartella ignorata o in un formato non
            // gestito: per il workspace è una rimozione.
            self.remove_document(&from_id);
            return Ok(true);
        };
        if from_id == to_id {
            return self.sync_path_here(to);
        }
        // **Una rinomina che atterra su un'identità viva non è una rinomina**
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
        if self.indexes.core.metas.contains_key(&to_id) {
            let started = self.sync_path_here(from)?;
            return Ok(self.sync_path_here(to)? || started);
        }
        if !to.exists() {
            self.remove_document(&from_id);
            return Ok(true);
        }
        // **Il disco è già avanti, quindi da qui in poi un `Err` secco è il
        // difetto** (0181). Chi ha spostato il file è un'altra applicazione: a
        // `to` i byte ci sono da prima che il rilevatore ce lo dicesse, e a
        // `from` non c'è più niente. Rispondere `Err` perché la destinazione
        // non si rilegge o non si parsa lasciava memoria, grafo, indici,
        // registro ed eventi fermi al nome vecchio — cioè un vault che mostra
        // una nota che sul disco non esiste, e che ad aprirla dà un errore,
        // fino alla riapertura.
        //
        // È la regola che il ripristino staged enuncia dal verso in cui la si
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

    /// Per ogni documento che linkava `from` per nome o per path, la
    /// **modifica** che riscrive i suoi riferimenti verso `to`. Sostituzione
    /// chirurgica: si tocca solo il testo del riferimento dentro lo `Span` del
    /// link, mai il resto del documento (heading `#...`, blocco `^...`, alias
    /// `|label` e formattazione restano intatti).
    ///
    /// La prepare conserva span, testo atteso e sostituzione senza leggere
    /// sorgenti. L'`invoke` owned legge ciascuna sorgente e costruisce
    /// l'[`EditRequest`] con la revisione CAS osservata in quel momento, così
    /// una scrittura successiva non viene cancellata dal piano.
    ///
    /// Vale per **entrambe le specie di link**, e la seconda ha un caso in più
    /// della prima. Un wikilink si rompe solo se si sposta il suo bersaglio; un
    /// link markdown è relativo alla cartella di chi lo scrive, quindi si rompe
    /// anche se si sposta la **sorgente**: muovere `a.md` in `sub/` invalida
    /// ogni `[t](altra.md)` che conteneva. Per questo `from` è sempre fra le
    /// sorgenti del piano — i suoi link uscenti vanno ri-basati sulla cartella
    /// nuova — e non solo quando linka se stesso.
    fn prepare_explicit_link_rewrites(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Vec<PreparedExplicitLinkRewrite> {
        let from_name = resolution_key(from.page_name());
        let from_path = resolution_key(&strip_ext(from.as_str()));

        // Nuovo riferimento: il nome pagina se nessun altro documento lo
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
        // affermava il contrario). La gemella qui accanto —
        // `prepare_explicit_entry_link_rewrites`, che sposta un allegato — cerca
        // gli omonimi nell'anagrafe, e la differenza fra le due non è una svista:
        // **ogni piano cerca l'omonimia nel registro che il proprio risolutore
        // legge**. Un wikilink verso un allegato lo risolve la chiave dei nomi
        // dell'anagrafe, che porta il nome del file **con l'estensione**
        // (`![[foto.png]]`, mai `[[foto]]`), quindi un allegato non contende mai
        // un *nome pagina*; e dove le due stringhe coincidono davvero — un file
        // senza estensione — chi risolve prova il grafo per primo e ripiega
        // sull'anagrafe solo se lì non ha trovato niente. Allargare la ricerca a
        // `entries` scriverebbe il path intero dentro i documenti di terzi per
        // un'ambiguità che non esiste.
        let to_name = to.page_name();
        let ambiguous = self
            .indexes
            .core
            .metas
            .keys()
            .any(|id| id != from && resolution_key(id.page_name()) == resolution_key(to_name));
        // La stessa domanda sul path senza estensione, che è la chiave di
        // `path_index`: `sub/Nota.md` e `sub/nota.txt` la condividono, quindi
        // due file possono contenderselo esattamente come si contendono un
        // nome. Dove anche questa è contesa si scrive il path **intero**.
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
        // Chi ha scritto l'estensione (`[[board.canvas]]`) nominava il file, e
        // la ritrova: il nome del file se nessun altro lo porta, e nessuna
        // pagina si chiama così (il nome pagina precede), sennò il path intero.
        let file_of = |id: &DocId| resolution_key(id.as_str().rsplit('/').next().unwrap_or(""));
        let from_file = file_of(from);
        let from_full = resolution_key(from.as_str());
        let to_file = file_of(to);
        let file_ambiguous = self.indexes.core.metas.keys().any(|id| {
            id != from && (file_of(id) == to_file || resolution_key(id.page_name()) == to_file)
        });
        let new_file_ref = if file_ambiguous {
            to.as_str().to_string()
        } else {
            to.as_str()
                .rsplit('/')
                .next()
                .unwrap_or(to.as_str())
                .to_string()
        };

        // Le note che linkano `from`, **una volta ciascuna**: chi lo cita tre
        // volte va riscritto una volta sola, e il filtro per-link qui sotto
        // cammina già tutti i suoi link. Prima questo era un `.map().collect()`
        // in un `BTreeSet` costruito qui: adesso l'insieme lo dice la firma.
        let mut sources: BTreeSet<DocId> =
            self.indexes.core.graph.linked(from, LinkDirection::Inbound);
        // Il self-link è escluso dai backlink per scelta, ma al rename va
        // riscritto come gli altri: `[[Nota]]` dentro la nota stessa resterebbe
        // dangling — e verrebbe dirottato da chi ricreasse il vecchio nome. Ai
        // link markdown serve comunque (vedi la nota sopra: sposta la
        // sorgente), quindi `from` entra sempre e sarà il filtro per-link a
        // dire se c'è davvero qualcosa da riscrivere.
        sources.insert(from.clone());

        let mut prepared = Vec::new();
        for source in sources {
            let Some(metadata) = self.indexes.core.metas.get(&source) else {
                continue;
            };
            let mut rewrites = Vec::new();
            for link in &metadata.links {
                let replacement = match &link.target {
                    LinkTarget::Wiki { page, .. } => {
                        // Riscrivi solo se il link puntava davvero a `from`
                        // (non a un omonimo) e ci arrivava per nome o per path
                        // — mai per alias.
                        let key = resolution_key(page);
                        let by_name = key == from_name;
                        let by_path =
                            key == from_path || resolution_key(&strip_ext(&key)) == from_path;
                        let with_extension = key == from_file || key == from_full;
                        if !(by_name || by_path || with_extension)
                            || self.indexes.core.graph.resolve_wiki(page).as_ref() != Some(from)
                        {
                            continue;
                        }
                        if with_extension {
                            new_file_ref.clone()
                        } else {
                            new_ref.clone()
                        }
                    }
                    LinkTarget::Path(written) => {
                        let Some(new_target) = self.rebased_path_link(from, to, &source, written)
                        else {
                            continue;
                        };
                        let (_, fragment) = rules_path::split_fragment(written);
                        let rewritten = format!("{new_target}{fragment}");
                        if rewritten == *written {
                            continue;
                        }
                        rewritten
                    }
                    LinkTarget::Url(_) => continue,
                };
                rewrites.push(LinkRewrite {
                    span: link.span,
                    target: link.target.clone(),
                    replacement,
                });
            }
            if rewrites.is_empty() {
                continue;
            }
            let Ok(source_path) = self.docs.vault.path_for(&source) else {
                continue;
            };
            // La sorgente rinominata vive ormai al path nuovo: la sua
            // riscrittura va applicata lì — e la base resta valida, perché un
            // rename sposta il file senza toccarne il contenuto. È una proprietà
            // della revisione-impronta: un contatore per-documento, qui, avrebbe
            // detto che il documento è cambiato.
            let destination = if &source == from {
                to.clone()
            } else {
                source.clone()
            };
            match self.rewrite_plan_for(&destination) {
                Some(rewrite) => prepared.push(PreparedExplicitLinkRewrite {
                    source_path,
                    destination,
                    provider: Some(rewrite.provider),
                    provider_id: rewrite.provider_id,
                    ctx: rewrite.ctx,
                    source_kind: rewrite.source_kind,
                    rewrites,
                }),
                None => prepared.push(PreparedExplicitLinkRewrite {
                    source_path,
                    destination: destination.clone(),
                    provider: None,
                    provider_id: String::new(),
                    ctx: ParseContext::obsidian(destination.as_str()),
                    source_kind: SourceKind::Text,
                    rewrites,
                }),
            };
        }
        prepared
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
    /// vecchio ne era privo: vedi [`fub_abi::rules::path::relative_ref`].
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
            // Un link dalla radice resta dalla radice: è una scelta di stile
            // di chi scrive, e il rename non è il momento di discuterla.
            return Some(format!("/{}", rules_path::percent_encode_path(to.as_str())));
        }
        let src_after = if source_moves { to } else { src };
        let target_after = if target_moves { to } else { &resolved };
        Some(rules_path::relative_ref(src_after, target_after))
    }

    /// Innesta una sintassi su un provider (§3.1), o dice **perché no**.
    ///
    /// Il `Result` non è cerimonia: due regole che rivendicano la stessa
    /// sintassi sono un conflitto, e il modo in cui questo registro sbagliava
    /// prima era proprio non avere dove dirlo.
    pub fn register_syntax_rule(
        &mut self,
        plugin: impl Into<String>,
        rule: Box<dyn SyntaxRule>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared = PreparedRegistration::syntax(rule).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Registra chi disegna un `custom_kind` (§3.2).
    ///
    /// Il [`Trust`] è quello del **plugin** e non un parametro di questa
    /// chiamata: un `CustomRendering::Ui` è un albero di UI, e da chi non è il
    /// core il contenuto attivo si rifiuta a qualunque profondità — ma *quanto*
    /// ci si fida di qualcuno è una proprietà sua, non di ogni cosa che
    /// registra (§7.3).
    pub fn register_custom_renderer(
        &mut self,
        plugin: impl Into<String>,
        renderer: Box<dyn CustomRenderer>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared =
            PreparedRegistration::renderer(renderer).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// I `custom_kind` che qualcuno **produce** e nessuno **disegna**.
    ///
    /// È il conto che il §3.2 chiedeva di poter fare: ogni nome qui dentro è un
    /// blocco che l'utente leggerà crudo — il degrado generico funziona, ma
    /// nessuno ha detto chi lo disegnerebbe. Chi monta l'app può guardarlo; oggi
    /// non c'è ancora una superficie dove mostrarlo (§20.4).
    pub fn undrawn_kinds(&self) -> Vec<String> {
        self.docs.undrawn_kinds()
    }

    /// Congela sorgente, parser e regole per una lettura del modello che verrà
    /// eseguita dal composition root senza la guardia del workspace.
    pub fn prepare_detached_document_model(
        &self,
        id: &DocId,
    ) -> std::result::Result<PreparedDocumentModel, PluginError> {
        let id = fenced_doc_id(id)?;
        let indexed = self.indexes.core.metas.contains_key(&id);
        let parseable_file =
            self.docs.vault.stat(&id).is_some() && self.docs.provider_for(&id).is_ok();
        if !indexed && !parseable_file {
            return Err(PluginError::NotFound(id.to_string().into()));
        }
        let source = self.docs.source_from_disk(&id).map_err(PluginError::from)?;
        let source_revision = Revision::of_bytes(source.bytes());
        let parser = self.docs.prepare_parse(&id).map_err(PluginError::from)?;
        Ok(PreparedDocumentModel {
            id,
            source_revision,
            source,
            parser,
            syntax_generation: self.syntax_generation,
        })
    }

    /// Il provider di `id` pronto per una scrittura mirata fuori dalla
    /// guardia. `None` = nessun provider rivendica il documento.
    ///
    /// Con `with_source` la sorgente si legge adesso dal disco, sotto la stessa
    /// fotografia: è il sorgente su cui il provider calcolerà gli edit.
    pub fn prepare_format_edit(
        &self,
        id: &DocId,
        with_source: bool,
    ) -> std::result::Result<Option<PreparedFormatEdit>, PluginError> {
        let id = fenced_doc_id(id)?;
        if self.docs.format_of(&id).is_none() {
            return Ok(None);
        }
        let parser = self.docs.prepare_parse(&id).map_err(PluginError::from)?;
        let source = if with_source {
            Some(self.docs.source_from_disk(&id).map_err(PluginError::from)?)
        } else {
            None
        };
        Ok(Some(PreparedFormatEdit { parser, source }))
    }

    /// [`VaultRead::format_link`](fub_abi::traits::VaultRead::format_link) per
    /// chi possiede già un `&Workspace`. Chi lo monta in una `Custody` usa
    /// [`prepare_format_edit`](Workspace::prepare_format_edit) e chiama il
    /// provider dopo aver rilasciato la guardia.
    pub fn format_link(
        &self,
        id: &DocId,
        link: &fub_abi::format::LinkInsert,
    ) -> std::result::Result<Option<String>, PluginError> {
        match self.prepare_format_edit(id, false)? {
            Some(prepared) => prepared.format_link(link),
            None => Ok(None),
        }
    }

    /// [`VaultRead::task_state_edit`](fub_abi::traits::VaultRead::task_state_edit),
    /// come [`format_link`](Workspace::format_link).
    pub fn task_state_edit(
        &self,
        id: &DocId,
        marker: &fub_abi::model::TaskMarker,
        done: bool,
    ) -> std::result::Result<Option<EditRequest>, PluginError> {
        match self.prepare_format_edit(id, true)? {
            Some(prepared) => prepared.task_state_edit(marker, done),
            None => Ok(None),
        }
    }

    /// Pubblica il modello soltanto se sorgente e regole sono ancora quelle
    /// fotografate da `prepare_detached_document_model`. Mutazioni di altri
    /// documenti e cambi ai soli renderer sono compatibili.
    pub fn finish_detached_document_model(
        &self,
        completed: CompletedDocumentModel,
    ) -> std::result::Result<DocumentModel, PluginError> {
        if completed.syntax_generation != self.syntax_generation {
            return Err(PluginError::Conflict(
                "la pipeline sintattica è cambiata durante la lettura del modello".into(),
            ));
        }
        let current = match self.docs.source_from_disk(&completed.id) {
            Ok(current) => current,
            Err(error) if error.is_missing() => {
                return Err(PluginError::Conflict(
                    format!(
                        "{} è stato rimosso durante la lettura del modello",
                        completed.id
                    )
                    .into(),
                ));
            }
            Err(error) => return Err(error.into()),
        };
        if Revision::of_bytes(current.bytes()) != completed.source_revision {
            return Err(PluginError::Conflict(
                format!("{} è cambiato durante la lettura del modello", completed.id).into(),
            ));
        }
        Ok(completed.model)
    }

    /// Il modello parsato di un documento (§4.2): la metà kernel di
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
    ///
    /// Questa è la comodità del kernel quando possiede già un `&Workspace`:
    /// chi lo monta in una `Custody` usa `prepare_detached_document_model` e
    /// `finish_detached_document_model`, perché soltanto il composition root
    /// può rilasciare la propria guardia prima del parse.
    pub fn read_model(&self, id: &DocId) -> Result<DocumentModel> {
        let indexed = self.indexes.core.metas.contains_key(id);
        let parseable_file =
            self.docs.vault.stat(id).is_some() && self.docs.provider_for(id).is_ok();
        if !indexed && !parseable_file {
            return Err(KernelError::NotFound(id.to_string()));
        }
        self.docs.parse_from_disk(id)
    }

    /// Di che formato è un documento, e che sintassi capirebbe (§4.3): la metà
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
    pub fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        self.docs.format_of(id)
    }

    /// Le sintassi di questo documento **con la loro forma**, per chi deve
    /// disegnare invece di parsare (§4.4).
    ///
    /// Vedi [`crate::documents::DocumentStore::syntax_forms`]: è `format_of`
    /// per una superficie di scrittura, che il modello non ce l'ha e non può
    /// averlo — il buffer che ha in mano è sporco, e un modello spedito di là
    /// sarebbe vero solo quando serve meno
    /// ([0018](../../../docs/decisions/0182-provider-e-porte-generiche.md)).
    pub fn syntax_forms(&self, id: &DocId) -> Vec<SyntaxForm> {
        self.docs.syntax_forms(id)
    }

    /// Rende l'anteprima di un documento: l'HTML del provider, e le parti
    /// **dichiarative** che i renderer registrati hanno prodotto.
    ///
    /// Il corpo non sta in cache (split metadata/body): si rilegge e riparsa
    /// dal disco, nella forma che il provider ha dichiarato (§3.4). Il render è
    /// per-documento e on demand — è esattamente il tipo di lettura che il disco
    /// serve bene, mentre la cache calda serve le mutazioni.
    pub fn render_preview(&self, id: &DocId) -> Result<RenderedDocument> {
        self.render_document(id, RenderOptions::preview())
    }

    fn render_document(&self, id: &DocId, options: RenderOptions) -> Result<RenderedDocument> {
        if !self.indexes.core.metas.contains_key(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let source = self.docs.source_from_disk(id)?;
        let parser = self.docs.prepare_parse(id)?;
        let model = parser.invoke(source)?;
        parser.render(&model, &self.docs.renderers, &options)
    }

    /// Rende il contenuto di un embed `![[page#heading]]` o `![[page#^blocco]]`:
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
        // Come `render_preview`: il corpo si riparsa dal disco on demand.
        let source = self.docs.source_from_disk(&id)?;
        let parser = self.docs.prepare_parse(&id)?;
        let model = parser.invoke(source)?;
        let opts = RenderOptions::preview();
        let model =
            match (block, heading) {
                (Some(b), _) => block_of(&model, b)
                    .ok_or_else(|| KernelError::NotFound(format!("{id}#^{b}")))?,
                (None, Some(h)) => section_of(&model, h)
                    .ok_or_else(|| KernelError::NotFound(format!("{id}#{h}")))?,
                (None, None) => model,
            };
        // Anche un embed passa dai renderer: un diagramma dentro una nota
        // trascluso resta un diagramma. Gli slot delle parti sono numerati
        // dentro QUESTA composizione, e il frontend li monta dentro il
        // segnaposto dell'embed che ha appena idratato.
        Ok((id, parser.render(&model, &self.docs.renderers, &opts)?))
    }

    /// Backlink verso un documento.
    pub fn backlinks(&self, id: &DocId) -> Vec<BacklinkRef> {
        self.indexes.core.graph.backlinks(id)
    }

    /// Link uscenti risolti da un documento.
    pub fn outgoing(&self, id: &DocId) -> Vec<DocId> {
        self.indexes.core.graph.outgoing(id)
    }

    /// Risolve il nome di un wikilink a un documento esistente.
    ///
    /// È il comodo del kernel per sé e per i propri banchi di prova. Chi sta
    /// **fuori** — la shell, un provider — passa da
    /// [`IndexQuery::Resolve`](fub_abi::traits::IndexQuery::Resolve), che è la
    /// stessa risposta per tutti e le tre specie di bersaglio invece di una
    /// sola: finché questa era raggiungibile solo per un comando IPC scritto
    /// apposta, era un fatto sul vault che la shell conosceva e un plugin no.
    pub fn resolve_link(&self, page: &str) -> Option<DocId> {
        self.indexes.core.graph.resolve_wiki(page)
    }

    // --- sessione ----------------------------------------------------------

    /// Pubblica il contesto del pannello con il focus e restituisce **le view
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
    pub fn set_active_context(&self, context: Option<ViewContext>) -> Vec<String> {
        // Il taglio del §8.1 passa qui: la sessione dice *cosa* è cambiato, il
        // workspace traduce la maschera in id di view. È deliberato che il
        // componente non sappia che le view esistono.
        let changed = self.session.publish(context);
        if changed.is_empty() {
            return Vec::new();
        }
        // `views()` risolve già le due maschere sull'esemplare unico (§22.3):
        // qui non serve una seconda strada per la stessa domanda, e averla
        // vorrebbe dire due posti dove la regola può divergere.
        self.views()
            .into_iter()
            .filter(|spec| spec.follows.intersects(&changed))
            .map(|spec| spec.id)
            .collect()
    }

    /// Scorciatoia per chi ha un pannello solo: il documento attivo, senza
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
    pub fn set_active_document(&self, id: Option<DocId>) -> Vec<String> {
        let context = id.map(|id| ViewContext::new(MAIN_PANE).with_doc(Some(id)));
        self.set_active_context(context)
    }

    /// Il contesto del pannello con il focus, se la shell ne ha pubblicato uno.
    pub fn active_context(&self) -> Option<ViewContext> {
        self.session.context()
    }

    /// Il documento del contesto attivo: la lettura che il kernel usa dove il
    /// pannello non c'entra (rename, rimozione, comodità dei test).
    pub fn active_document(&self) -> Option<DocId> {
        self.session.document()
    }

    /// Congela il piano delle query servite dal canale dati generico. Le quattro
    /// famiglie composte dal `Workspace` restano sul percorso locale soltanto
    /// quando la rotta appartiene al core; se un indice esterno la sostituisce,
    /// anche quella callback attraversa il percorso staccato.
    pub fn prepare_detached_index_query(&self, query: &IndexQuery) -> Option<PreparedIndexQuery> {
        match query {
            IndexQuery::RenderPreview { .. }
            | IndexQuery::RenderPrint { .. }
            | IndexQuery::RenderEmbed { .. }
            | IndexQuery::Settings { .. }
            | IndexQuery::SyntaxForms { .. }
                if !self.indexes.query_owner_is_external(query) =>
            {
                None
            }
            _ => Some(self.indexes.prepare_query()),
        }
    }

    /// Prepara le due proiezioni servite localmente senza eseguire provider.
    /// Una rotta sostituita da un indice esterno resta sul planner staccato e
    /// non entra qui.
    pub fn prepare_local_index_projection(
        &self,
        query: &IndexQuery,
    ) -> Result<Option<PreparedLocalProjection>> {
        if self.indexes.query_owner_is_external(query) {
            return Ok(None);
        }
        let (id, resolved_page, kind) = match query {
            IndexQuery::RenderPreview { doc } => (doc.clone(), None, LocalProjectionKind::Preview),
            IndexQuery::RenderPrint { doc } => (doc.clone(), None, LocalProjectionKind::Print),
            IndexQuery::RenderEmbed {
                page,
                heading,
                block,
            } => {
                let id = self
                    .resolve_link(page)
                    .ok_or_else(|| KernelError::NotFound(page.clone()))?;
                (
                    id,
                    Some(page.clone()),
                    LocalProjectionKind::Embed {
                        heading: heading.clone(),
                        block: block.clone(),
                    },
                )
            }
            _ => return Ok(None),
        };
        if !self.indexes.core.metas.contains_key(&id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let source = self.docs.source_from_disk(&id)?;
        let source_revision = Revision::of_bytes(source.bytes());
        let parser = self.docs.prepare_parse(&id)?;
        Ok(Some(PreparedLocalProjection {
            id,
            resolved_page,
            source_revision,
            source,
            parser,
            renderers: self.docs.renderers.clone(),
            kind,
            routing_generation: self.indexes.routing_generation(),
            projection_generation: self.projection_generation,
        }))
    }

    /// Accetta una proiezione soltanto se appartiene ancora alla stessa rotta,
    /// alla stessa pipeline e allo stesso sorgente. Mutazioni su altri
    /// documenti sono compatibili e non la invalidano; qualunque registrazione
    /// o ritiro di regole sintattiche o renderer è invece conservativamente
    /// incompatibile con lo snapshot della pipeline.
    pub fn finish_local_index_projection(
        &self,
        completed: CompletedLocalProjection,
    ) -> std::result::Result<IndexResult, PluginError> {
        self.indexes
            .ensure_query_is_current(completed.routing_generation)?;
        if completed.projection_generation != self.projection_generation {
            return Err(PluginError::Conflict(
                "la pipeline di proiezione è cambiata durante la query".into(),
            ));
        }
        if !self.indexes.core.metas.contains_key(&completed.id) {
            return Err(PluginError::Conflict(
                format!("{} è stato ritirato durante la query", completed.id).into(),
            ));
        }
        if completed
            .resolved_page
            .as_deref()
            .is_some_and(|page| self.resolve_link(page).as_ref() != Some(&completed.id))
        {
            return Err(PluginError::Conflict(
                format!(
                    "il riferimento a {} è cambiato durante la query",
                    completed.id
                )
                .into(),
            ));
        }
        let current = match self.docs.source_from_disk(&completed.id) {
            Ok(current) => current,
            Err(error) if error.is_missing() => {
                return Err(PluginError::Conflict(
                    format!("{} è stato rimosso durante la query", completed.id).into(),
                ));
            }
            Err(error) => return Err(error.into()),
        };
        if Revision::of_bytes(current.bytes()) != completed.source_revision {
            return Err(PluginError::Conflict(
                format!("{} è cambiato durante la query", completed.id).into(),
            ));
        }
        Ok(completed.result)
    }

    /// Completa la sola parte locale della risposta dopo l'esecuzione del
    /// piano staccato. Prima rifiuta una fotografia il cui routing è cambiato;
    /// poi traduce le occorrenze sul sorgente corrente senza riattraversare
    /// alcun provider.
    pub fn finish_detached_index_query(
        &self,
        completed: CompletedIndexQuery,
        query: &IndexQuery,
    ) -> std::result::Result<IndexResult, PluginError> {
        self.indexes
            .ensure_query_is_current(completed.routing_generation)?;
        let needles = occurrences::wanted(query);
        Ok(match completed.result {
            IndexResult::Documents(page) if !needles.is_empty() => {
                IndexResult::Documents(self.locate(page, &needles))
            }
            other => other,
        })
    }

    // --- indici -----------------------------------------------------------

    /// Interroga il canale dati.
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
    pub fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        // La resa (§1.6, decisione 0163) è intercettata qui e non passa da
        // `indexes.query`: `CoreIndex` non ha i documenti né i renderer, e la
        // rotta che dichiara (`QueryRoute::Query`) serve solo a dire che il
        // kernel è il risponditore — come Outline. La fast-path di prima era un
        // comando Tauri bespoke; adesso è il canale dati di tutti.
        match query {
            IndexQuery::RenderPreview { doc } => Ok(IndexResult::RenderPreview(
                self.render_preview(&doc)?.into(),
            )),
            IndexQuery::RenderPrint { doc } => Ok(IndexResult::RenderPrint(
                self.render_document(
                    &doc,
                    RenderOptions {
                        target: RenderTarget::Print,
                        ..Default::default()
                    },
                )?
                .into(),
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
            // Le etichette, come la resa: `CoreIndex` ha lo store e non i
            // cataloghi. `settings_entries` risolve per proprietario; senza
            // questa porta un `Text::Message` uscirebbe nudo, e sul filo
            // diventerebbe `{"key": …}` dove la shell si aspetta una stringa
            // `[object Object]` nel pannello. Presidiato da
            // `settings_as_out_resolved_too`.
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

    /// Apre i sorgenti della pagina e ci trova dentro i testi cercati.
    ///
    /// Costa **una lettura per riga**, e il tetto di
    /// [`occurrences::max_docs`] è ciò che impedisce a una domanda senza
    /// finestra di aprire il vault intero: oltre quel numero le righe restano
    /// senza coordinate, che è ciò che `occurrences` vuoto significa da
    /// contratto. Un documento che non si legge o che è sparito da sotto non è
    /// un errore della ricerca — la riga resta, senza il punto.
    fn locate(&self, mut page: Paged<DocumentMatch>, needles: &[String]) -> Paged<DocumentMatch> {
        for hit in page.items.iter_mut().take(occurrences::max_docs()) {
            if !hit.occurrences.is_empty() {
                continue;
            }
            let Ok(source) = self.docs.read_source(&hit.doc) else {
                continue;
            };
            // La revisione è quella del testo appena letto, non una presa
            // altrove: uno span vale sul sorgente su cui è stato misurato, e
            // dire «di quando» con l'impronta di un'altra lettura sarebbe la
            // bugia che il campo esiste per impedire.
            let revision = Revision::of(&source);
            hit.occurrences = occurrences::locate(&source, needles)
                .into_iter()
                .map(|span| DocPosition::at(span, revision.clone()))
                .collect();
        }
        page
    }

    /// Chi risponderebbe a questa domanda, e come: il piano.
    ///
    /// Serve a due cose che valgono adesso — **provare** il routing invece di
    /// descriverlo, e dire in un messaggio chi avrebbe dovuto rispondere. Non è
    /// l'explain plan di 9.2, che è una superficie con altri clienti.
    pub fn query_plan(&self, query: &IndexQuery) -> QueryPlan {
        self.indexes.plan_of(query)
    }

    /// Le rotte dichiarate: chi serve cosa, oggi, in questo montaggio.
    ///
    /// Non attraversa il contratto — l'inventario di ciò che è attivo è il §7.6
    /// — ma è ciò che rende il routing ispezionabile invece che descritto.
    pub fn query_routes(&self) -> Vec<(QueryRoute, String)> {
        self.indexes
            .routes
            .declared()
            .into_iter()
            .map(|(route, target)| (route, self.indexes.name_of(target)))
            .collect()
    }

    /// Porta gli indici a un punto di consistenza (vedi
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
    pub fn flush_indexes(&mut self) -> Vec<PluginError> {
        let errors = self.lend(
            |ws| &mut ws.indexes.providers,
            |ws, indexes| {
                let mut errors = Vec::new();
                for (id, index) in indexes.iter() {
                    let _call = match crate::index::IndexCall::enter(id, index) {
                        Ok(call) => call,
                        Err(error) => {
                            errors.push(error);
                            continue;
                        }
                    };
                    let mut index = index.write();
                    let mut host = ws.host_for(id, InvokeMode::Apply);
                    if let Err(and) = index.flush(&mut host) {
                        errors.push(and);
                    }
                }
                errors
            },
        );
        // Un flush fallito è la perdita di un **derivato**: il vault è intatto,
        // e ciò che non è stato scritto si ricostruisce alla riapertura. Non
        // nomina un documento — il flush è per indice, non per nota — ed è
        // esattamente il caso per cui il soggetto di un guasto è opzionale.
        for error in errors.iter().cloned() {
            self.report_trouble(Severity::Warning, None, error, None);
        }
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
        plugin: impl Into<String>,
        provider: Box<dyn ViewProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared =
            PreparedRegistration::views(provider).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Registra un `ViewProvider` **sostituendo** chi possedeva gli stessi id
    /// di view.
    ///
    /// È la stessa disciplina delle rotte (decisione 0019) e del registro dei
    /// formati (decisione 0017), portata all'ultima famiglia che risolveva un
    /// id per tentativi: sostituire resta possibile, ma **si chiede per nome**
    /// invece di succedere a chi si registra per primo.
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
        // Il permesso **prima** di togliere chi c'era: una sostituzione ha due
        // effetti, e un rifiuto in mezzo lascerebbe il primo fatto e il secondo
        // no — cioè una view del core cancellata da chi non poteva nemmeno
        // nominarla, con in mano un errore che dice «non è registrato».
        // Il token nasce insieme all'entry: non c'è un contatore condiviso che
        // renda obsolete view estranee quando questa viene sostituita.
        let generation = Arc::new(());
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
        // Il grado di fiducia è quello del plugin: era un parametro di questa
        // sola registrazione, ed è la ragione per cui un `IndexProvider` di
        // terzi avrebbe ricevuto ogni documento del vault senza che nessuno gli
        // avesse dato un grado (§7.3).
        let trust = self.providers.plugins.trust_of(&plugin).unwrap_or_default();
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::View, &ids);
        self.providers.views.push(RegisteredView {
            id: plugin,
            specs,
            provider: Arc::new(SharedShelter::new(provider)),
            generation,
            trust,
        });
        Ok(())
    }

    /// Rilegge ciò che un provider dichiara: view e comandi.
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
    pub fn refresh_specs(&mut self, id: &str) -> std::result::Result<(), RegistryError> {
        self.providers.refresh_specs(id)
    }

    /// Le view offerte dai provider registrati, in ordine di registrazione,
    /// **coi titoli risolti** nella lingua di chi guarda (§12.1).
    ///
    /// Le due maschere che escono di qui sono quelle dell'**esemplare unico**
    /// (§22.3): le risolve
    /// [`declared_specs`](crate::providers::declared_specs) al momento della
    /// registrazione, che è dove le spec si chiedono — una volta sola, come
    /// tutto il resto di ciò che un provider dichiara.
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

    /// Prepara il render di una view senza eseguire codice del provider.
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
            generation: Arc::clone(&registered.generation),
        })
    }
    /// Congela la view e i dati necessari a interrogare gli interessi senza
    /// eseguire codice esterno sotto la guardia del workspace.
    pub fn prepare_view_interests(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<PreparedViewInterests, PluginError> {
        let at = self.view_owner(&instance.view)?;
        let registered = &self.providers.views[at];
        self.check_params(at, instance)?;
        Ok(PreparedViewInterests {
            owner: registered.id.clone(),
            view: instance.view.clone(),
            instance: instance.clone(),
            provider: Arc::clone(&registered.provider),
            generation: Arc::clone(&registered.generation),
        })
    }

    /// Una callback preparata può terminare soltanto se la stessa entry
    /// possiede ancora la view. L'`Arc` distingue rimozione e nuova
    /// registrazione; il token di generazione distingue invece un refresh
    /// delle spec sullo stesso provider.
    fn ensure_view_is_current(
        &self,
        owner: &str,
        view: &str,
        generation: &Arc<()>,
        provider: &Arc<SharedShelter<Box<dyn ViewProvider>>>,
    ) -> std::result::Result<(), PluginError> {
        let current = self.providers.views.iter().any(|registered| {
            registered.id == owner
                && Arc::ptr_eq(&registered.generation, generation)
                && Arc::ptr_eq(&registered.provider, provider)
                && registered.specs.iter().any(|spec| spec.id == view)
        });
        if current {
            Ok(())
        } else {
            Err(PluginError::Conflict(
                format!("la registrazione della view `{view}` è cambiata durante la callback")
                    .into(),
            ))
        }
    }

    /// Applica il confine di fiducia e la localizzazione dopo che il provider è
    /// tornato. Nessun codice del provider viene eseguito in questa fase.
    pub fn finish_view_render(
        &self,
        prepared: PreparedViewRender,
        outcome: std::result::Result<UiNode, PluginError>,
    ) -> std::result::Result<UiNode, PluginError> {
        let mut tree = outcome.map_err(|and| self.localized(&prepared.owner, and))?;
        self.ensure_view_is_current(
            &prepared.owner,
            &prepared.view,
            &prepared.generation,
            &prepared.provider,
        )?;
        guard_ui(prepared.trust, &tree)?;
        // **Dopo** la validazione del confine di fiducia, non prima: risolvere
        // una chiave non può trasformare un nodo innocuo in uno riservato — i
        // `Text` non diventano markup — ma l'ordine giusto è comunque quello che
        // non fa passare niente dal catalogo prima del controllo.
        self.localize(&prepared.owner, &mut tree);
        Ok(tree)
    }
    /// Conclude la callback degli interessi verificando che la registrazione
    /// fotografata sia ancora quella pubblicata.
    pub fn finish_view_interests(
        &self,
        prepared: PreparedViewInterests,
        outcome: std::result::Result<ViewInterests, PluginError>,
    ) -> std::result::Result<ViewInterests, PluginError> {
        let interests = outcome.map_err(|error| self.localized(&prepared.owner, error))?;
        self.ensure_view_is_current(
            &prepared.owner,
            &prepared.view,
            &prepared.generation,
            &prepared.provider,
        )?;
        Ok(interests)
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
        let prepared = self.prepare_view_render(instance)?;
        let owner = prepared.owner().to_string();
        let instance_id = prepared.instance_id().to_string();
        // Anche il percorso di lettura passa dal punto di applicazione: un
        // provider senza `read_vault` non legge il vault **mentre disegna** più
        // di quanto lo legga da un'azione. Che il guard qui avvolga un
        // `ReadHost` invece di un `KernelHost` non cambia niente per la
        // politica — è la stessa, e non sa cosa ci sia sotto.
        let host = self.read_host_for_view(&owner, Some(instance_id.as_str()));
        let outcome = prepared.invoke(&host);
        self.finish_view_render(prepared, outcome)
    }

    /// La dichiarazione di interesse di **un esemplare** (§22.3).
    ///
    /// A differenza dei campi omonimi della spec — dichiarati prima che un
    /// esemplare esistesse — questa la risponde il provider, che ha davanti i
    /// parametri con cui l'esemplare è stato aperto. Per l'esemplare unico la
    /// risposta è già dentro [`views`](Self::views); serve a chi ne apre uno
    /// **con parametri**, ed è il verso in cui il §22.3 continua.
    pub fn view_interests(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<ViewInterests, PluginError> {
        let at = self.view_owner(&instance.view)?;
        self.check_params(at, instance)?;
        let registered = &self.providers.views[at];
        let provider = registered.provider.read();
        crate::safety::calling_callback(&registered.id, "ViewProvider::interests", || {
            Ok(provider.interests(instance))
        })
    }

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
        let (owner, trust, provider, generation) = {
            let registered = &self.providers.views[at];
            (
                registered.id.clone(),
                registered.trust,
                Arc::clone(&registered.provider),
                Arc::clone(&registered.generation),
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
            generation,
            previous_provider_call,
        })
    }

    /// Chiude il frame dell'azione senza consegnare eventi. Il valore opaco
    /// permette all'host di eseguire il drain dopo aver rilasciato il guard.
    pub fn finish_view_action_deferred(
        &mut self,
        prepared: PreparedViewAction,
        outcome: std::result::Result<ViewUpdate, PluginError>,
    ) -> DeferredEvents<std::result::Result<ViewUpdate, PluginError>> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let result = (|| {
            // Il proprietario è quello della view: un aggiornamento porta le
            // stringhe di chi l'ha scritto, come l'albero che sostituisce — e
            // come l'errore con cui, invece dell'aggiornamento, può rispondere.
            let mut update = outcome.map_err(|and| self.localized(&prepared.owner, and))?;
            self.ensure_view_is_current(
                &prepared.owner,
                &prepared.view,
                &prepared.generation,
                &prepared.provider,
            )?;
            // **Ogni** albero che l'aggiornamento porta con sé, non solo quello
            // di `Replace`: una `Patch` è un nodo che entra nella webview come
            // gli altri, ed è più piccola solo nella dimensione. Il `match` è
            // esaustivo di proposito — è la stessa lezione di
            // `UiNode::children`, che elencava a mano i contenitori che
            // c'erano: una variante nuova che portasse un nodo deve rompere la
            // compilazione qui, non passare in silenzio.
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
            if let ViewUpdate::Custom { ns, .. } = &update {
                guard_intent(prepared.trust, ns)?;
            }
            self.localize(&prepared.owner, &mut update);
            Ok(update)
        })();
        DeferredEvents::outcome(result)
    }

    /// Chiude il frame aperto da `prepare_view_action` e riproduce l'epilogo
    /// del vecchio percorso: ripristino flag, errore localizzato, trust gate,
    /// localizzazione e soltanto alla fine consegna degli eventi accodati.
    pub fn finish_view_action(
        &mut self,
        prepared: PreparedViewAction,
        outcome: std::result::Result<ViewUpdate, PluginError>,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let deferred = self.finish_view_action_deferred(prepared, outcome);
        // Gli eventi accodati durante `on_action` arrivano ADESSO, dopo che la
        // chiamata del provider è tornata: è il contratto di consegna.
        self.dispatch_pending();
        self.finish_deferred_events(deferred)
    }

    /// Consegna un'azione della UI al provider della view e restituisce il suo
    /// aggiornamento. Ogni albero che l'aggiornamento porta con sé —
    /// [`ViewUpdate::Replace`] e [`ViewUpdate::Patch`] — passa dalla stessa
    /// validazione di [`render_view`](Workspace::render_view): un provider non
    /// fidato non può iniettare contenuto attivo *in risposta a un click*
    /// invece che al rendering, né per la via stretta invece che per quella
    /// larga.
    ///
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
        self.providers.check_params(at, instance)
    }

    /// Chi possiede una view, per posizione. `UnknownView` se nessuno.
    fn view_owner(&self, view: &str) -> std::result::Result<usize, PluginError> {
        self.providers.view_owner(view)
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
        plugin: impl Into<String>,
        provider: Box<dyn CommandProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared =
            PreparedRegistration::commands(provider).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Le impostazioni `keys.<id>` di un elenco di comandi (§18.2).
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

    /// Le impostazioni `<id>:permissions.<nome>` di un plugin dichiarato
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

    /// Rifà il recinto di un plugin da ciò che l'utente ha negato **adesso**
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
                // Una chiave che non si legge — perché nessuno l'ha dichiarata,
                // o perché il file porta un valore che non regge lo schema — è
                // un **non ho detto di no**: il default è la concessione, e
                // trattare l'illeggibile come un rifiuto spegnerebbe un
                // componente per un file scritto male.
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

    /// I comandi offerti dai provider registrati, in ordine di registrazione.
    ///
    /// È la metà "discovery" del registro, ed è la ragione per cui una
    /// [`CommandSpec`] porta descrizione, parametri e raggio: chi legge questo
    /// elenco può essere una palette, ma anche una CLI o un modello, e nessuno
    /// dei due ha letto il codice del comando.
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
    /// [`CommandProvider::invoke`]:
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
        self.user_gesture_gate(command, Some(&by))?;
        self.as_actor(by, |ws| {
            ws.batch(|ws| ws.invoke_command_here(command, args, mode))
        })
    }

    /// Rifiuta i comandi di manutenzione che soltanto un gesto dell'utente
    /// raggiunge ([`crate::maintenance::user_gesture_only`]) quando non entrano
    /// dall'utente: `by` è `None` per ogni invocazione annidata, cioè per
    /// `run_command` sia sincrono sia da un job. Vale in ogni modo: una
    /// simulazione che promettesse un piano che l'applicazione poi rifiuta
    /// mentirebbe a chi la approva.
    fn user_gesture_gate(
        &self,
        command: &str,
        by: Option<&Actor>,
    ) -> std::result::Result<(), PluginError> {
        if matches!(by, Some(Actor::User)) || !crate::maintenance::user_gesture_only(command) {
            return Ok(());
        }
        let at = self.command_owner(command)?;
        if self.providers.commands[at].id != crate::maintenance::MAINTENANCE_ID {
            return Ok(());
        }
        Err(PluginError::PermissionDenied(
            format!("`{command}` è riservato a un gesto dell'utente").into(),
        ))
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
    /// Apre il frame staccato esclusivamente per `vault.rebuild-index`.
    ///
    /// Gli altri comandi di manutenzione restano sul percorso sincrono: questa
    /// porta non è un esecutore generico del potere interno del kernel.
    pub fn prepare_maintenance_rebuild(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Option<Actor>,
    ) -> std::result::Result<Option<PreparedMaintenanceRebuild>, PluginError> {
        if command != crate::maintenance::VAULT_REBUILD_INDEX {
            return Ok(None);
        }

        let at = self.command_owner(command)?;
        if self.providers.commands[at].id != crate::maintenance::MAINTENANCE_ID {
            return Ok(None);
        }
        let spec = self.providers.commands[at]
            .specs
            .iter()
            .find(|spec| spec.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando");
        spec.validate_args(&args)?;

        if self.providers.command_stack.iter().any(|id| id == command) {
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

        let owner = self.providers.commands[at].id.clone();
        let previous_actor = by.map(|actor| self.dispatch.swap_actor(actor));
        let owns_batch = self.dispatch.open_batch();
        self.providers.command_stack.push(command.to_string());
        let previous_dispatch_deferral = self.dispatch.defer_dispatch();

        Ok(Some(PreparedMaintenanceRebuild {
            owner,
            command: command.to_string(),
            mode,
            previous_actor,
            owns_batch,
            previous_dispatch_deferral,
        }))
    }

    /// Chiude il frame del rebuild dopo che l'host ha completato tutte le fasi
    /// esterne. `None` è il dry-run, che conserva il piano del percorso comune.
    pub fn finish_maintenance_rebuild(
        &mut self,
        prepared: PreparedMaintenanceRebuild,
        opening: Option<std::result::Result<Opening, PluginError>>,
    ) -> DeferredEvents<std::result::Result<CommandOutcome, PluginError>> {
        let outcome = match opening {
            Some(Ok(opening)) => Ok(self.rebuild_index_outcome(opening)),
            Some(Err(error)) => Err(error),
            None => self.run_maintenance(&prepared.command, prepared.mode),
        };

        let popped = self.providers.command_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.command.as_str()));
        let result = match outcome {
            Err(error) => Err(self.localized(&prepared.owner, error)),
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
                Ok(outcome)
            }
        };

        if prepared.owns_batch {
            self.dispatch.close_batch();
        }
        self.dispatch
            .restore_dispatch(prepared.previous_dispatch_deferral);
        DeferredEvents {
            outcome: result,
            previous_actor: prepared.previous_actor,
            journal: None,
        }
    }

    /// Chiude il frame del comando senza consegnare eventi. L'attore precedente
    /// resta nel token: storicamente veniva ripristinato soltanto *dopo* il
    /// dispatch e il percorso staccato conserva lo stesso ordine.
    pub fn finish_provider_command_deferred(
        &mut self,
        prepared: PreparedCommand,
        outcome: std::result::Result<CommandOutcome, PluginError>,
    ) -> DeferredEvents<std::result::Result<CommandOutcome, PluginError>> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let popped = self.providers.command_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.command.as_str()));

        let outcome = outcome.and_then(|outcome| {
            self.guard_command_intent(&prepared.owner, &outcome)
                .map(|()| outcome)
        });
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
                Ok(outcome)
            }
        };

        if prepared.owns_batch {
            self.dispatch.close_batch();
        }
        DeferredEvents {
            outcome: result,
            previous_actor: prepared.previous_actor,
            journal: None,
        }
    }

    /// Il grado di chi ha scritto il comando decide se il suo intento
    /// `Custom` può arrivare alla shell ([`guard_intent`]). Vale per il
    /// percorso sincrono e per quello staccato, che finiscono entrambi qui.
    fn guard_command_intent(
        &self,
        owner: &str,
        outcome: &CommandOutcome,
    ) -> std::result::Result<(), PluginError> {
        match &outcome.effect {
            CommandEffect::Custom { ns, .. } => {
                guard_intent(self.trust_of(owner).unwrap_or_default(), ns)
            }
            _ => Ok(()),
        }
    }

    /// Rientra dopo una [`PreparedCommand`] e riproduce l'epilogo del percorso
    /// sincrono: ripristino del flag, pila, localizzazione, undo, batch, dispatch
    /// e infine attore. Il provider non gira in questa funzione.
    pub fn finish_provider_command(
        &mut self,
        prepared: PreparedCommand,
        outcome: std::result::Result<CommandOutcome, PluginError>,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let deferred = self.finish_provider_command_deferred(prepared, outcome);
        self.dispatch_pending();
        self.finish_deferred_events(deferred)
    }

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

    /// L'invocazione **annidata**: quella di
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
    pub(crate) fn invoke_command_nested(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.user_gesture_gate(command, None)?;
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

        // Il giro (decisione 0013). Un comando che rientra su sé stesso non è una
        // profondità da limitare con un numero: è un errore di chi lo ha
        // scritto, e l'unica risposta utile lo nomina.
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

        // **La manutenzione la esegue il kernel** (§15.2). L'id è passato dalla
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
        let owner = self.providers.commands[at].id.clone();
        let provider = Arc::clone(&self.providers.commands[at].provider);
        self.providers.command_stack.push(command.to_string());
        // **La manutenzione la esegue il kernel** (§15.2). L'id è passato dalla
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
            // Il rifiuto è un wrapper (§7.1): la politica dice quali famiglie
            // servire, e l'host sottostante gira in simulazione — così una
            // macro simulata compone i piani dei suoi passi invece di
            // rispondere `permission-denied` a ogni riga.
            // Due politiche insieme: quella del plugin e quella del divieto.
            // È la combinatoria del §7.3 senza un tipo per combinazione.
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
        // Il `pop` è **fuori** dalla rete e prima del `?`: un comando che pania
        // non deve restare per sempre "in giro" nella pila, o la prossima
        // invocazione si rifiuterebbe da sé dicendo che sta chiamando sé stesso.
        self.providers.command_stack.pop();

        let mut outcome = outcome.map_err(|and| self.localized(&owner, and))?;
        self.guard_command_intent(&owner, &outcome)?;
        if let CommandEffect::Plan(plan) = &mut outcome.effect {
            // L'insieme impattato è ciò che l'utente approva: lo completa
            // l'host, invece di fidarsi che chi ha scritto il piano si sia
            // ricordato di elencare ogni documento che i suoi edit nominano.
            plan.complete();
        }
        // I testi dell'esito — la notifica, il riassunto di un piano — col
        // catalogo di chi ha eseguito. `run_command` annidato passa da qui come
        // l'invocazione dall'esterno: chi rientra riceve l'esito dell'altro già
        // risolto, che è giusto, perché il catalogo giusto è quello di chi ha
        // scritto la frase e non quello di chi la inoltra.
        self.localize(&owner, &mut outcome);
        // La pila dell'annullamento si riempie **a profondità zero** (§13.3):
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
        if mode == InvokeMode::Apply && self.providers.command_stack.is_empty() {
            if let Some(undo) = outcome.undo.clone() {
                self.undo.push(undo, outcome.partial.clone());
            }
        }
        self.dispatch_pending();
        Ok(outcome)
    }

    /// Annulla l'ultima operazione annullabile, e dice quale era (§13.3).
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
    pub fn prepare_undo_replay(&mut self) -> Option<UndoReplay> {
        let entry = self.undo.pop()?;
        Some(UndoReplay {
            entry,
            next: 0,
            done: 0,
            failure: None,
            before_replay: self.undo.begin_replay(),
            // Tutto dentro un lotto solo: annullare una rinomina che aveva
            // riscritto quaranta sorgenti è un gesto, quindi un `batch-ended` e
            // un ridisegno.
            owns_batch: self.dispatch.open_batch(),
        })
    }

    /// Chiude il batch senza chiamare handler. Replay resta attivo nel token:
    /// come nella via sincrona, verrà ripristinato soltanto dopo che gli eventi
    /// del batch sono stati consegnati.
    pub fn finish_undo_replay_deferred(&mut self, replay: UndoReplay) -> DeferredUndo {
        let UndoReplay {
            entry,
            done,
            failure,
            before_replay,
            owns_batch,
            ..
        } = replay;
        if owns_batch {
            self.dispatch.close_batch();
        }
        DeferredUndo {
            entry,
            done,
            failure,
            before_replay,
        }
    }

    /// Ripristina replay e produce lo stesso esito per il driver diretto e per
    /// quello staccato. Va chiamato dopo il drain degli eventi.
    pub fn finish_undo_replay(
        &mut self,
        deferred: DeferredUndo,
    ) -> std::result::Result<Option<Undone>, PluginError> {
        let DeferredUndo {
            entry,
            done,
            failure,
            before_replay,
        } = deferred;
        let count = entry.undo.steps.len();
        self.undo.end_replay(before_replay);

        match failure {
            None => Ok(Some(Undone {
                label: entry.undo.label,
                operation: entry.partial,
                replay: None,
            })),
            Some(failure) if done == 0 => {
                // Niente è cambiato: resta un errore, ma la voce torna in pila.
                // Il conflitto può essere transitorio e chi riprova deve
                // ritrovare lo stesso annullamento invece di una pila vuota.
                // `end_replay` è già passato qui sopra, quindi
                // `UndoStack::push` non scarta la voce come riproduzione
                // ricorsiva.
                let error = failure.error;
                self.undo.push(entry.undo, entry.partial);
                Err(error)
            }
            Some(failure) => Ok(Some(Undone {
                label: entry.undo.label,
                operation: entry.partial,
                replay: Partial::of(count, done, vec![failure]),
            })),
        }
    }

    /// Via sincrona del kernel: guida lo stesso token usato dagli host che
    /// devono rilasciare il workspace fra un passo e l'altro.
    pub(crate) fn undo_last(&mut self) -> std::result::Result<Option<Undone>, PluginError> {
        let Some(mut replay) = self.prepare_undo_replay() else {
            return Ok(None);
        };
        let replayed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            while let Some(step) = replay.next_step() {
                let outcome = match step {
                    UndoStep::Edit(planned) => self
                        .apply_edit(&planned.doc, planned.edit)
                        .map(|_| ())
                        .map_err(|and| Failure::of(planned.doc, and.into())),
                    UndoStep::Command { command, args } => self
                        .invoke_command_here(&command, args, InvokeMode::Apply)
                        .map(|_| ())
                        .map_err(Failure::other),
                };
                replay.finish_step(outcome);
            }
        }));
        if replayed.is_err() {
            replay.finish_unwind();
        }

        let deferred = self.finish_undo_replay_deferred(replay);
        let dispatched = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.dispatch_pending();
        }));
        let outcome = self.finish_undo_replay(deferred);

        if let Err(payload) = replayed {
            std::panic::resume_unwind(payload);
        }
        if let Err(payload) = dispatched {
            std::panic::resume_unwind(payload);
        }
        outcome
    }

    /// Chi possiede un comando, per posizione. `UnknownCommand` se nessuno.
    fn command_owner(&self, command: &str) -> std::result::Result<usize, PluginError> {
        self.providers.command_owner(command)
    }

    // --- import ed export ---------------------------------------------------
    //
    // Il kernel non sa cosa sia un formato di scambio: sa scegliere chi lo sa e
    // prestargli le capacità. Vedi `fub_abi::transfer`.

    /// Registra un [`ImportProvider`] sotto un id. L'ordine di registrazione è
    /// l'ordine in cui i provider vengono interpellati da
    /// [`import`](Workspace::import).
    ///
    /// Come per gli altri provider, `id` è un nome semplice e determina lo
    /// spazio dati autorevole (`.fub/plugins/<id>/`), con cache derivata in `.fub/data/plugins/<id>/`.
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

    /// Registra un [`ExportProvider`] per conto di un plugin dichiarato.
    ///
    /// Gli id delle **destinazioni** (`markdown.files`) sono nomi in uno spazio
    /// condiviso: valgono la regola del §7.4 e il conflitto, come per le view.
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

    /// **Apre** una sorgente perché un provider la legga a pezzi invece che
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

    /// Chiude una sorgente aperta. Chiudere ciò che non c'è riesce.
    pub fn close_source(&mut self, handle: SourceHandle) {
        self.sources.acquire().close(handle);
    }

    /// Legge da una sorgente aperta: il lato host di
    /// [`TransferRead::read_source`](fub_abi::traits::TransferRead::read_source).
    pub(crate) fn read_open_source(
        &self,
        handle: SourceHandle,
        offset: u64,
        len: u32,
    ) -> std::result::Result<Vec<u8>, PluginError> {
        self.sources.acquire().read(handle, offset, len)
    }

    /// Quanti byte ha una sorgente aperta, se lo è.
    pub fn source_len(&self, handle: SourceHandle) -> Option<u64> {
        self.sources.acquire().len(handle)
    }

    /// Gli importer registrati, per chiamarli fuori dal lock del workspace.
    pub fn prepare_import(&self) -> PreparedImport {
        PreparedImport {
            candidates: self
                .providers
                .imports
                .iter()
                .map(|(owner, provider)| (owner.clone(), Arc::clone(provider)))
                .collect(),
        }
    }

    /// Gli exporter registrati, per chiamarli fuori dal lock del workspace.
    pub fn prepare_export(&self) -> PreparedExport {
        PreparedExport {
            candidates: self
                .providers
                .exports
                .iter()
                .map(|(owner, provider)| (owner.clone(), Arc::clone(provider)))
                .collect(),
        }
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
        self.import_in_mode(source, request, InvokeMode::Apply)
    }

    /// Come [`import`](Workspace::import), chiesto da un host in `mode`.
    ///
    /// L'importer riceve le **proprie** capacità, come un servizio; in
    /// simulazione però le riceve dietro la stessa politica di sola lettura
    /// del comando che lo chiede, così un'anteprima dentro un `dry-run` non
    /// ha una scala per scrivere.
    pub(crate) fn import_in_mode(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        mode: InvokeMode,
    ) -> std::result::Result<ImportReport, PluginError> {
        let prepared = self.prepare_import();
        let at = prepared.choose(source)?;
        let owner = prepared.owner(at).to_string();
        // La stessa disciplina di tutti gli altri, e non più una quarta copia:
        // vedi `Workspace::with_provider_call`.
        let report = self.with_provider_call(|ws| {
            if mode.is_dry_run() {
                let granted = ws.providers.plugins.granted(&owner);
                let mut host = Guard::new(
                    KernelHost {
                        ws,
                        plugin: &owner,
                        mode: InvokeMode::DryRun,
                        instance: None,
                    },
                    (
                        ReadOnly {
                            why: "una simulazione non scrive",
                        },
                        granted,
                    ),
                );
                prepared.invoke(at, source, request, &mut host)
            } else {
                let mut host = ws.host_for(&owner, InvokeMode::Apply);
                prepared.invoke(at, source, request, &mut host)
            }
        });
        self.dispatch_pending();
        report
    }

    /// Le destinazioni di export offerte dai provider registrati.
    pub fn export_targets(&self) -> Vec<ExportTarget> {
        self.providers.export_targets()
    }

    /// Esporta secondo la richiesta, col provider che possiede la destinazione.
    ///
    /// Prende `&self`, come [`render_view`](Workspace::render_view) e per la
    /// stessa ragione: un export è una lettura, e le letture girano sotto
    /// prestito condiviso invece di mettersi in fila dietro una scrittura. Il
    /// provider durante l'export vede il mondo intero attraverso un host di
    /// sola lettura — indici compresi, che è ciò che serve a una selezione per
    /// query.
    pub fn export(
        &self,
        request: &ExportRequest,
    ) -> std::result::Result<ExportReport, PluginError> {
        let mut sink = MemorySink::default();
        self.export_to(request, &mut sink)
    }

    /// Come [`export`](Workspace::export), ma versando gli artefatti dove dice
    /// chi chiama (decisione 0102).
    ///
    /// I due non sono due modi di fare la stessa cosa: `export` tiene tutto in
    /// memoria — che è ciò che il contratto faceva sempre, e che va benissimo
    /// per tre note — mentre qui l'esito può non entrarci. Un export del vault
    /// intero in PDF è il caso per cui questa esiste.
    pub fn export_to(
        &self,
        request: &ExportRequest,
        out: &mut dyn ArtifactSink,
    ) -> std::result::Result<ExportReport, PluginError> {
        let prepared = self.prepare_export();
        let at = prepared.choose(&request.target)?;
        let host = self.read_host_for(prepared.owner(at));
        prepared.invoke(at, request, &host, out)
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
    pub(crate) fn emit_event(&mut self, event: Event) {
        self.dispatch.emit(event);
    }

    /// **Qualcosa è andato storto, e adesso c'è dove dirlo** (§20.2, decisione
    /// 0052).
    ///
    /// L'unico punto da cui il kernel emette un guasto. Passa da `emit_event`
    /// come tutto il resto — quindi porta l'origine e sta dentro il lotto — e
    /// non fa niente di più: non decide se si vede, non sceglie un tono per
    /// chi disegna, non scrive su `stderr`. Chi ha una superficie si abbona.
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

    /// Le perdite dell'alimentazione (§20.1) diventano guasti (§20.2): è la
    /// giunzione fra le due voci, ed è l'unica ragione per cui vanno decise
    /// nella stessa seduta — un esito che nomina i documenti perduti e nessun
    /// posto dove portarlo è un canale senza destinazione.
    ///
    /// Sono [`Severity::Warning`] tutte, e per la regola scritta nel contratto:
    /// un indice è un **derivato**, il vault è la verità, e ciò che si è perso
    /// torna riaprendo il vault. Non «non è grave» — chi cerca, fino ad allora,
    /// riceve una risposta incompleta senza sapere che lo è, ed è esattamente
    /// per questo che lo si dice.
    pub(crate) fn report_losses(&mut self, lost: Vec<IndexLoss>) {
        for loss in lost {
            self.report_trouble(Severity::Warning, Some(loss.id), loss.why, None);
        }
    }

    /// Esegue `f` attribuendo a `actor` tutto ciò che ne nasce, e rimette
    /// l'attore di prima quando `f` è tornata.
    ///
    /// L'attore è **chi ha chiesto**, non chi esegue: per questo lo alzano il
    /// watcher (il vault è cambiato senza passare da noi), il dispatch verso un
    /// handler (il plugin agisce di propria iniziativa) e `invoke_command` — dove
    /// però l'attore è il *chiamante* del comando, non il provider che lo
    /// esegue. Vedi `fub_abi::event`.
    fn as_actor<R>(&mut self, actor: Actor, f: impl FnOnce(&mut Self) -> R) -> R {
        let prev = self.dispatch.swap_actor(actor);
        let result = f(self);
        self.dispatch.restore_actor(prev);
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
    pub fn batch<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        let mut batch = Batch::open(self);
        f(&mut batch)
    }

    /// Chiude il lotto più esterno: emette il terminale (se c'è qualcosa da
    /// dire) e drena.
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
    fn dispatch_pending(&mut self) {
        // Il ciclo consegna e basta: quando fermarsi, cosa scartare e cosa
        // mettere al posto di ciò che si scarta lo decide il [`Dispatcher`]
        // (§8.1). Qui resta ciò che il componente non può fare — chiamare un
        // provider, che vuole `&mut Workspace` da prestare come `HostApi`.
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

    /// **Presta i provider di una tabella per la durata di una chiamata**: la
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

    /// Esegue `f` col flag `in_provider_call` alzato: qualunque
    /// `dispatch_pending` innescato dentro `f` (un provider che scrive via
    /// `HostApi`) viene rimandato. Chi chiama è responsabile di drenare la
    /// coda **dopo** — è il "dopo che la tua chiamata è tornata" del contratto.
    fn with_provider_call<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        let prev = self.dispatch.enter_provider_call();
        let result = f(self);
        self.dispatch.restore_provider_call(prev);
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
        let troubles = self.lend(
            |ws| &mut ws.providers.handlers,
            |ws, handlers| {
                let mut troubles: Vec<(String, PluginError)> = Vec::new();
                for (id, handler) in handlers.iter_mut() {
                    // La maschera per intero: la specie, il prefisso di topic
                    // per i custom, il soggetto (§10.1) e **cosa è cambiato**
                    // nel documento (§22.2, decisione 0069). La regola sta nel
                    // contratto (`fub_abi::rules::events`) e non qui, perché
                    // il secondo lettore è la shell — che decide da sé quando
                    // ridisegnare una view dichiarata.
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
                        // L'errore di un handler non deve far fallire
                        // l'operazione che ha emesso l'evento — quella parte
                        // del vecchio commento era giusta ed è rimasta — ma
                        // «non far fallire» non vuol dire «non dirlo» (§20.3):
                        // qui c'era un `let _ =` e un panico che finiva su
                        // `stderr`, e la sola feature che esiste per esserci
                        // quando qualcosa va storto — il versioning, che è un
                        // `EventHandler` e nient'altro — smetteva di fare
                        // snapshot in un modo indistinguibile dal funzionare.
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
        // **Il guasto della consegna di un guasto non si emette** (decisione
        // 0052). È l'unico ciclo che questa variante rende possibile — un
        // handler che fallisce ricevendo un `Trouble` ne produrrebbe un
        // secondo, che ripasserebbe da lui — e si chiude dove nasce, cioè qui,
        // perché è il kernel a emettere. Il budget del dispatch lo fermerebbe
        // comunque: ma quello è una rete di sicurezza, non una semantica, e
        // ciò che troncherebbe sono gli eventi degli altri.
        if matches!(notice.event, Event::Trouble { .. }) {
            return;
        }
        // Emesso **fuori** dal prestito: dentro `lend` la tabella degli
        // handler è in mano a chi consegna, e un evento emesso lì dentro
        // arriverebbe a una lista vuota. Il soggetto è il documento che
        // l'evento nominava — chi guarda quella nota è chi ha interesse a
        // sapere che qualcuno non è riuscito a reagirle.
        let subject = notice.event.touched().cloned();
        for (id, error) in troubles {
            // **Chi** ha fallito lo dice l'origine, non un campo nuovo: il
            // guasto si emette a nome del plugin (decisione 0012), che è la
            // stessa meccanica con cui un handler riconosce le proprie
            // scritture. Un campo `plugin` dentro il record avrebbe duplicato
            // ciò che il notice porta già.
            //
            // `Failure` e non `Warning`: il kernel non sa cosa **non** è
            // successo. Dietro un `EventHandler` c'è il versioning tanto
            // quanto un contatore, e sottostimare la perdita di uno snapshot è
            // peggio che sovrastimare quella di un contatore.
            let subject = subject.clone();
            self.as_actor(Actor::Plugin { id }, |ws| {
                ws.report_trouble(Severity::Failure, subject, error, Some(Gate::Event))
            });
        }
    }

    // --- job (lavoro lungo, fuori dal giro sincrono) -----------------------

    /// Accoda un job richiesto via
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
        let since = self.now_unix_millis();
        self.indexes.core.jobs.accepted(id, &job, plugin, since);
        self.emit_event(Event::JobStarted { id, job });
        Ok(id)
    }
    /// Riserva un job per una chiamata sincrona dell'host senza inserirlo nella
    /// coda del runner. Usa lo stesso contatore, tabella ed evento di
    /// [`enqueue_job`]; il composition root lo esegue poi con la stessa
    /// ammissione dei job drenati dal pool.
    pub fn issue_direct_job(
        &mut self,
        plugin: &str,
        spec: JobSpec,
    ) -> std::result::Result<PendingJob, PluginError> {
        if self.closed {
            return Err(PluginError::Cancelled(
                format!("il vault si sta chiudendo: il job `{}` non parte", spec.job).into(),
            ));
        }
        let job = spec.job.clone();
        let id = self.dispatch.next_job_id();
        let since = self.now_unix_millis();
        self.indexes.core.jobs.accepted(id, &job, plugin, since);
        self.emit_event(Event::JobStarted { id, job });
        Ok(PendingJob {
            id,
            plugin: plugin.to_string(),
            spec,
        })
    }

    /// **Dichiara viva la seconda fase dell'apertura**, e le dà un'identità
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
    pub fn begin_index_job(&mut self) -> JobId {
        let id = self.dispatch.next_job_id();
        let since = self.now_unix_millis();
        self.indexes
            .core
            .jobs
            .accepted(id, INDEX_JOB, crate::index::CORE_ID, since);
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::JobStarted {
                id,
                job: INDEX_JOB.to_string(),
            });
            ws.dispatch_pending();
        });
        id
    }

    /// **A che punto è** un job (§10.3, decisione 0035).
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

    /// **Il campanello dei job** (§9.3), da dare a chi possiede i thread.
    ///
    /// Il kernel non sa che esistono dei thread, e non deve: sa che qualcuno
    /// potrebbe stare aspettando un job, e presta il pezzetto di stato che serve
    /// a svegliarlo — esattamente come presta la bandiera del rilevamento a chi
    /// tiene un watcher ([`watch_flag`](Workspace::watch_flag), decisione 0030).
    /// Senza, chi drena la coda dovrebbe interrogarla a intervalli, cioè
    /// scegliere una politica al posto di un fatto.
    pub fn job_bell(&self) -> Arc<JobBell> {
        self.dispatch.bell()
    }

    /// Preleva i job richiesti dai provider via
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
    pub fn take_pending_jobs(&mut self) -> Vec<PendingJob> {
        self.dispatch.take_pending_jobs()
    }

    /// **Quante identità di job il kernel ha emesso finora**: il primo numero
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
    pub fn jobs_issued(&self) -> u64 {
        self.dispatch.jobs_issued()
    }

    /// Le **sveglie dichiarate** da chi è registrato adesso (§22.1, decisione
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
    pub fn declared_timers(&self) -> Vec<(String, TimerSpec)> {
        self.providers
            .plugins
            .timers()
            .into_iter()
            .map(|(owner, spec)| (owner.to_string(), spec.clone()))
            .collect()
    }

    /// Fa suonare una sveglia: emette [`Event::TimerFired`] sul giro sincrono
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
        // Come `complete_job`, e per la stessa ragione: chi chiama arriva da
        // fuori del giro sincrono — è il pool — quindi l'evento non trova
        // nessuno che stia già drenando, e senza questa riga resterebbe in coda
        // fino alla prossima scrittura di qualcun altro.
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::TimerFired {
                owner: owner.to_string(),
                timer: timer.to_string(),
            });
            ws.dispatch_pending();
        });
        true
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
    ///
    /// È anche il momento in cui il job **smette di essere vivo**: la riga esce
    /// dalla tabella del §10.3 *prima* che l'evento parta, o chi riceve
    /// `job-done` e ricontrolla l'elenco troverebbe ancora là dentro il lavoro
    /// che gli è appena stato detto finito.
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

    // --- le impostazioni (§11.1) -------------------------------------------
    //
    // Il workspace è l'unico che le può servire: lo schema lo tiene il registro
    // dei plugin (arriva dal manifest, alla dichiarazione) e il valore lo tiene
    // lo store, e le due cose si incontrano solo qui.

    /// Il valore che vale adesso per una chiave dichiarata.
    pub fn setting(&self, key: &str) -> std::result::Result<SettingValue, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .effective(key)
            .map(|(value, _)| value)
    }

    /// Come [`setting`](Workspace::setting), ma dice anche **da dove viene**.
    pub fn setting_source(
        &self,
        key: &str,
    ) -> std::result::Result<(SettingValue, SettingSource), PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .effective(key)
    }

    /// Valida schema e scrivibilità prima di staccare la persistenza dal
    /// workspace. Il token conserva soltanto dati owned e lo store condiviso.
    pub fn prepare_program_setting_mutation(
        &self,
        key: &str,
        value: Option<SettingValue>,
    ) -> std::result::Result<PreparedSettingMutation, PluginError> {
        let scope = {
            let settings = self.settings.read().expect("store di configurazione");
            let spec = settings.spec(key).ok_or_else(|| {
                PluginError::BadArgs(format!("nobody declared setting `{key}`").into())
            })?;
            if !spec.program_writable {
                return Err(PluginError::PermissionDenied(
                    format!(
                        "setting `{key}` was not declared writable by a \
                         program: the person looking at it is the one who changes it"
                    )
                    .into(),
                ));
            }
            if let Some(value) = value.as_ref() {
                if let Some(why) = spec.kind.rejects(value) {
                    return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
                }
            }
            spec.scope
        };
        Ok(PreparedSettingMutation {
            settings: Arc::clone(&self.settings),
            key: key.to_owned(),
            scope,
            mutation: match value {
                Some(value) => SettingMutation::Set(value),
                None => SettingMutation::Reset,
            },
        })
    }

    /// Annuncia una mutazione già persistita, rimandando ogni callback a dopo
    /// il rilascio della custodia.
    pub fn finish_setting_mutation_deferred(
        &mut self,
        applied: AppliedSettingMutation,
    ) -> DeferredEvents<()> {
        let deferred = self.defer_event_dispatch();
        self.announce_setting(&applied.key, applied.scope);
        self.restore_event_dispatch(deferred);
        DeferredEvents::outcome(())
    }

    /// Scrive una chiave, e **lo dice**: la scrittura di un'impostazione è un
    /// fatto che riguarda chi la legge, e senza l'evento un interruttore
    /// spostato in una finestra resterebbe invisibile a tutto il resto finché
    /// qualcuno non ricarica.
    ///
    /// L'attore è quello corrente, come per ogni altra scrittura: chi ha chiesto
    /// è chi è entrato nel kernel (decisione 0012), e questa capacità passa da
    /// un comando o da un plugin, mai dal kernel di sua iniziativa.
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

    /// Azzera una chiave: ricade al livello sotto (vedi
    /// [`SettingsWrite::reset_setting`](fub_abi::traits::SettingsWrite::reset_setting)).
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
        // Una chiave che è un recinto rifà il recinto, **prima** di dirlo
        // (§23.17): chi riceve l'evento può chiamare, e riceverebbe un cancello
        // ancora aperto. Passa di qui e non dai due chiamanti perché scrivere e
        // azzerare sono la stessa cosa vista da due lati — azzerare una chiave
        // negata è precisamente il modo in cui si riconcede.
        if let Some((plugin, _)) = fub_abi::settings::permission_of_key(key) {
            let plugin = plugin.to_string();
            self.reapply_permissions(&plugin);
        }
        // E una chiave che è una **finestra** ripota il registro, subito e non
        // alla prossima apertura: chi stringe la conservazione a trenta giorni
        // lo fa per far cadere ciò che c'è adesso, non ciò che ci sarà. Stessa
        // riga del recinto qui sopra, stessa ragione (§23.9).
        if key == crate::journal::RETENTION_DAYS {
            self.prunes_the_record();
        }
        let key = key.to_string();
        self.emit_event(Event::SettingChanged { key, scope });
        if !self.dispatch.in_provider_call() {
            self.dispatch_pending();
        }
    }

    /// Named vault preferences live in the settings file, not in view state.
    pub fn settings_profiles(&self) -> std::result::Result<Vec<String>, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .profiles()
            .map_err(|e| PluginError::Internal(e.into()))
    }

    pub fn active_settings_profile(&self) -> std::result::Result<String, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .active_profile()
            .map_err(|e| PluginError::Internal(e.into()))
    }

    pub fn export_settings_profile(&self, name: &str) -> std::result::Result<String, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .export_profile(name)
            .map_err(|e| PluginError::BadArgs(e.into()))
    }

    pub fn import_settings_profile(&mut self, json: &str) -> std::result::Result<(), PluginError> {
        self.settings
            .write()
            .expect("store di configurazione")
            .import_profile(json)
            .map_err(|e| PluginError::BadArgs(e.into()))
    }

    pub fn duplicate_settings_profile(
        &mut self,
        source: &str,
        name: &str,
    ) -> std::result::Result<(), PluginError> {
        self.settings
            .write()
            .expect("store di configurazione")
            .duplicate_profile(source, name)
            .map_err(|e| PluginError::BadArgs(e.into()))
    }

    pub fn switch_settings_profile(&mut self, name: &str) -> std::result::Result<(), PluginError> {
        let before = self
            .settings
            .read()
            .expect("store di configurazione")
            .entries(None);
        let after = {
            let mut settings = self.settings.write().expect("store di configurazione");
            settings
                .switch_profile(name)
                .map_err(|e| PluginError::BadArgs(e.into()))?;
            settings.entries(None)
        };
        for (old, new) in before.into_iter().zip(after) {
            if old.value != new.value || old.source != new.source {
                self.announce_setting(&new.spec.key, new.spec.scope);
            }
        }
        Ok(())
    }

    pub fn reset_settings_profile(&mut self, name: &str) -> std::result::Result<(), PluginError> {
        let active = self.active_settings_profile()? == name;
        let before = if active {
            self.settings
                .read()
                .expect("store di configurazione")
                .entries(None)
        } else {
            Vec::new()
        };
        let after = {
            let mut settings = self.settings.write().expect("store di configurazione");
            settings
                .reset_profile(name)
                .map_err(|e| PluginError::BadArgs(e.into()))?;
            if active {
                settings.entries(None)
            } else {
                Vec::new()
            }
        };
        for (old, new) in before.into_iter().zip(after) {
            if old.value != new.value || old.source != new.source {
                self.announce_setting(&new.spec.key, new.spec.scope);
            }
        }
        Ok(())
    }

    /// Le scorciatoie che il file di questo vault dichiara (§23.13), come
    /// chiave → accordo. La chiede chi monta, per sapere cosa questo vault
    /// propone alla tastiera di chi lo apre.
    pub fn vault_keybindings(&self) -> std::collections::BTreeMap<String, String> {
        self.settings
            .read()
            .expect("store di configurazione")
            .vault_keybindings()
    }

    /// Sospende il valore del vault di queste chiavi (§23.13): finché sono
    /// sospese si leggono come se il file non ne parlasse.
    ///
    /// **Non emette l'evento** delle impostazioni, e la ragione è che non
    /// succede a impostazioni cambiate: succede all'apertura, prima che ci sia
    /// qualcuno in ascolto, e ciò che chi legge vede è un valore che non è mai
    /// stato altro. Scioglierla invece è un cambiamento come gli altri, e passa
    /// da [`announce_setting`](Workspace::announce_setting) come tutti.
    pub fn suspend_settings(&mut self, keys: std::collections::BTreeSet<String>) {
        self.settings
            .write()
            .expect("store di configurazione")
            .suspend(keys);
    }

    /// Le chiavi sospese adesso (§23.13).
    pub fn suspended_settings(&self) -> std::collections::BTreeSet<String> {
        self.settings
            .read()
            .expect("store di configurazione")
            .suspended()
            .clone()
    }

    /// Scioglie la sospensione di queste chiavi — l'utente le ha guardate — e
    /// **lo dice**, una per una: chi disegna la tastiera rilegge gli accordi
    /// quando sente cambiare un'impostazione, e un risveglio silenzioso
    /// lascerebbe la scorciatoia nuova scritta nel pannello e non premibile fino
    /// alla riapertura.
    ///
    /// Prende un elenco e non scioglie tutto perché chi risponde ha risposto su
    /// ciò che ha visto: una chiave che nessuno gli ha mostrato — perché nessuno
    /// la dichiara — non è compresa nel sì.
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

    /// Qualcuno dichiara questa chiave in questo montaggio?
    ///
    /// È una domanda diversa da «c'è un valore»: un file può portare la
    /// scorciatoia di un comando di un componente che oggi è spento, e quella
    /// chiave non ha uno schema, non si legge e non si scrive. Chi chiede è chi
    /// deve **mostrarla a qualcuno** (§23.13), e una riga senza schema non ha né
    /// un titolo da scrivere né un modo di essere azzerata.
    pub fn setting_is_declared(&self, key: &str) -> bool {
        self.settings
            .read()
            .expect("store di configurazione")
            .spec(key)
            .is_some()
    }

    /// Questa chiave si è dichiarata scrivibile da un programma? `None` = non
    /// è dichiarata affatto, che è un no diverso e va detto diverso.
    ///
    /// Lo chiede l'host dei plugin prima di scrivere (§11.1): il permesso dice
    /// *chi*, questo dice *cosa*.
    pub fn setting_is_program_writable(&self, key: &str) -> Option<bool> {
        self.settings
            .read()
            .expect("store di configurazione")
            .spec(key)
            .map(|spec| spec.program_writable)
    }

    /// Le impostazioni risolte, tutte o di un plugin: è la risposta che il
    /// canale dati restituisce a [`IndexQuery::Settings`].
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

    // --- lo stato di vista (§11.2) -----------------------------------------
    //
    // Le due porte sono **due**, come per le impostazioni e per la stessa
    // ragione: queste prendono il proprietario come argomento perché le chiama
    // chi *è* la shell (che non è un plugin e non ha un id da timbrare); un
    // provider passa invece dalle capacità, dove il proprietario e l'esemplare
    // li mette l'host e non si possono nominare.

    /// Ciò che questo esemplare aveva salvato sotto questa chiave, su questa
    /// macchina e per questo vault.
    pub fn view_state(&self, owner: &str, instance: &str, key: &str) -> Option<serde_json::Value> {
        self.view_states
            .get(self.root().as_str(), owner, instance, key)
    }

    /// Salva (`Some`) o dimentica (`None`) lo stato di vista di un esemplare.
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

    /// Lo stato di vista della macchina, da condividere col prossimo vault che
    /// si apre. Gemello di [`machine_settings`](Workspace::machine_settings).
    pub fn view_states(&self) -> Arc<ViewStates> {
        Arc::clone(&self.view_states)
    }

    // --- l'organizzazione del vault (§11.3) --------------------------------
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
    pub fn organization(&self) -> fub_abi::organization::Organization {
        self.organization.snapshot()
    }
    /// Lo store owned dell'organizzazione, per i confini host che devono
    /// rilasciare il prestito del workspace prima della persistenza.
    pub fn organization_store(&self) -> Arc<OrganizationStore> {
        Arc::clone(&self.organization)
    }

    /// L'emoji accanto a una nota o a una cartella (`None` la toglie).
    pub fn set_icon(&self, path: &str, icon: Option<String>) -> std::result::Result<(), String> {
        self.organization.set_icon(path, icon)
    }

    /// Appunta o spunta una nota.
    pub fn set_pinned(&self, id: &str, pinned: bool) -> std::result::Result<(), String> {
        self.organization.set_pinned(id, pinned)
    }

    /// Registra o toglie una cartella dagli spazi.
    pub fn set_space(&self, path: &str, is_space: bool) -> std::result::Result<(), String> {
        self.organization.set_space(path, is_space)
    }

    /// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
    pub fn set_order(&self, folder: &str, names: Vec<String>) -> std::result::Result<(), String> {
        self.organization.set_order(folder, names)
    }

    /// Cosa è andato storto con l'organizzazione: il file illeggibile
    /// all'apertura, o una migrazione che non si è potuta scrivere. Chi monta le
    /// mostra, e svuotandole se ne fa carico.
    pub fn organization_warnings(&self) -> Vec<String> {
        self.organization.take_warnings()
    }

    /// Quali spazi per-documento non hanno potuto seguire una rinomina (§13.2).
    /// Chi monta le mostra, e svuotandole se ne fa carico.
    pub fn doc_data_warnings(&mut self) -> Vec<String> {
        std::mem::take(&mut self.doc_data_warnings)
    }

    /// Porta dietro a una rinomina lo stato per-documento di **ogni** plugin
    /// (§13.2), e annota chi non ce l'ha fatta.
    ///
    /// Non torna un `Result` e non può tornarlo: chi la chiama ha già spostato
    /// il file, e annullare una rinomina riuscita perché un plugin non ha potuto
    /// seguirla sarebbe il verso sbagliato. È la stessa regola
    /// dell'organizzazione, applicata a chi non è il kernel.
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

    /// Toglie lo stato per-documento delle note che non esistono più (§13.2).
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
            // Il piano è **vuoto di documenti** per tutti e quattro, e non è una
            // lacuna: nessuno tocca una nota, quindi l'insieme impattato è
            // davvero vuoto. Il sommario però non è vuoto per tutti — è il campo
            // che esiste per dire «cosa succede» in una riga, e i tre che
            // riparano non hanno niente da dire mentre il quarto **perde
            // qualcosa** e chi approva deve vederne il conto.
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
                Ok(self.rebuild_index_outcome(opening))
            }
            VAULT_REPAIR => {
                // Il rebuild rifà il derivato; questo raccoglie ciò che il
                // rebuild non guarda — i dati attaccati a note che non ci sono
                // più — e **dice** ciò che non ripara, invece di tacerlo.
                let collected = self.collect_doc_data()?;
                let journal = self.journal()?;
                let drafts = self.drafts()?;
                let orfane = drafts
                    .drafts
                    .iter()
                    .filter(|b| !self.indexes.core.entries.contains_key(&b.doc))
                    .count();
                // Il messaggio è **una chiave per caso**, e non una frase
                // composta a pezzi: concatenare stringhe tradotte produce testo
                // che nella lingua dopo non sta in piedi (0040).
                let key = if journal.pruned > 0 || drafts.pruned > 0 || orfane > 0 {
                    crate::maintenance::T_REPAIRED_PARZIALE
                } else {
                    crate::maintenance::T_REPAIRED
                };
                // Le due righe che questo comando **non** ripara si dicono, e
                // sono due specie diverse di cosa: una riga di registro rotta è
                // perduta, una bozza orfana è l'unica copia di un testo — e la
                // seconda si ripara solo decidendo, cioè non qui.
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
                // Il primo lettore vero di `IndexQuery::VaultHealth`: quella
                // query esisteva e non la chiedeva nessuno.
                //
                // L'elenco è `HealthCheck::ALL` e non tre righe scritte qui: un
                // elenco a mano che si dimentica un controllo lascia il rapporto
                // valido — è ancora un array — con una riga in meno, e nessun
                // presidio guarda dentro quell'array.
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
                    at: self.now_unix_millis(),
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
                // Dal **supporto**, come ogni altro byte sotto la linea del
                // vault: un rapporto scritto con `std::fs` sarebbe il primo file
                // di Fub a non essere né atomico né cifrabile.
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
                // L'unico dei quattro il cui esito **risale**: gli altri tre non
                // perdono niente, quindi un guasto si può raccontare e basta.
                // Qui l'utente ha chiesto che una cosa sparisca, e una richiesta
                // di far sparire qualcosa che fallisce in silenzio è la peggiore
                // delle risposte — chi l'ha chiesta se ne va credendo che sia
                // sparita.
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

    fn rebuild_index_outcome(&self, opening: Opening) -> CommandOutcome {
        CommandOutcome::notify(Text::message(
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
                fub_abi::text::Arg::int(
                    crate::maintenance::A_SKIPPED,
                    opening.discarded.len() as i64,
                ),
            ],
        ))
    }

    /// **Toglie lo spazio per-documento delle note che non ci sono più** (§13.2),
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
    pub fn collect_doc_data(&self) -> Result<usize> {
        // **Una raccolta si fa su un'anagrafe che si dichiara completa, o non si
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
        // Un allegato non è un documento ma è una voce dell'anagrafe, e il suo
        // spazio per-documento è vivo quanto quello di una nota: è la stessa
        // domanda di [`is_trashable`](Workspace::is_trashable).
        let entries = &self.indexes.core.entries;
        // Ciò che il ricongiungimento ha messo in dubbio non si raccoglie: è la
        // terza regola di [`rejoin_renamed_while_closed`], e vive qui perché la
        // raccolta ha due chiamanti — l'apertura e `vault.repair` — e uno di
        // essi gira quando quel dubbio non è più in vista.
        let suspended = &self.suspended_from_rejoin;
        let storage = Arc::clone(self.docs.vault.storage());
        crate::docdata::collect(storage.as_ref(), &roots, &|doc: &DocId| {
            metas.contains_key(doc)
                || entries.contains_key(doc)
                || trashed.contains(doc)
                || suspended.contains(doc)
        })
    }

    /// I documenti da cui il cestino è passato: ciò che sta lì dentro **non è
    /// sparito**, è recuperabile.
    fn trashed_originals(&self) -> std::collections::HashSet<DocId> {
        self.docs
            .list_trash()
            .unwrap_or_default()
            .into_iter()
            .map(|and| and.original)
            .collect()
    }

    /// **Riconosce le rinomine che non ha visto nessuno** (§23.1), e restituisce
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
    fn rejoin_renamed_while_closed(&mut self) -> BTreeSet<DocId> {
        let trashed = self.trashed_originals();
        // C'era ieri, oggi non c'è, e portava l'impronta di un contenuto.
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

        // Oggi c'è, ieri non c'era. Si guardano solo le impronte per cui
        // qualcosa è sparito: un vault appena aperto per la prima volta ha
        // tutto «comparso» e niente «sparito», e non deve costare una mappa
        // grande quanto il vault per scoprirlo.
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
                // Nessun candidato: non è una rinomina, è una cancellazione. La
                // raccolta se ne occupa come si è sempre occupata.
                continue;
            };
            if from.len() == 1 && a.len() == 1 {
                pairs.push((from.remove(0), a[0].clone()));
            } else {
                suspended.extend(from);
            }
        }

        for (from, to) in &pairs {
            // Il pavimento e la porta insieme (0062): una riga nel log per chi
            // fa assistenza, e l'evento qui sotto per chi sta dentro l'app.
            tracing::info!(
                target: "fub.kernel",
                "rinomina fatta ad app chiusa riconosciuta dall'impronta: {from} → {to}"
            );
            self.migrate_side_data(from, to);
        }
        if !pairs.is_empty() {
            // **E poi si dice**, con lo stesso evento della rinomina vista: chi
            // tiene stato per-documento fuori dallo spazio dichiarato — il
            // versioning, che ha uno store suo perché deve sopravvivere alla
            // cancellazione (0044) — non ha altro modo di saperlo, e questo è
            // l'unico posto in cui qualcuno lo sa. Che la coda possa troncare
            // (0034) è la ragione per cui i tre dati autorevoli che il kernel sa
            // spostare li ha spostati **prima**, e non aspettando che qualcuno
            // ascoltasse.
            self.as_actor(Actor::Kernel, |ws| {
                for (from, to) in pairs {
                    ws.emit_event(Event::DocumentRenamed { from, to });
                }
            });
        }
        suspended
    }

    /// Cosa è andato storto **leggendo** la configurazione: un file malformato,
    /// una chiave di macchina scritta dentro un vault, un valore che non regge
    /// la specie dichiarata. Chi monta le mostra, e svuotandole se ne fa carico.
    pub fn settings_warnings(&mut self) -> Vec<String> {
        self.settings
            .write()
            .expect("store di configurazione")
            .take_warnings()
    }

    /// Il livello macchina di questo workspace, da condividere con il prossimo
    /// vault che si apre (§11.1): la configurazione della macchina è **una**, e
    /// N copie sarebbero N idee del tema.
    pub fn machine_settings(&self) -> Arc<MachineSettings> {
        Arc::clone(
            self.settings
                .read()
                .expect("store di configurazione")
                .machine(),
        )
    }

    // --- interni ---------------------------------------------------------

    // --- storage persistente dei plugin ------------------------------------

    /// La radice dello spazio dati di un plugin, **come cartella del
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
    pub fn plugin_data_dir(&self, plugin: &str) -> std::result::Result<Utf8PathBuf, PluginError> {
        self.plugin_data_path(plugin, "")
    }

    /// La radice dello spazio dati di un plugin.
    pub(crate) fn plugin_data_root(&self, plugin: &str) -> Utf8PathBuf {
        self.docs.plugin_data_root(plugin)
    }

    /// La radice derivata della cache di un plugin.
    pub(crate) fn plugin_cache_root(&self, plugin: &str) -> Utf8PathBuf {
        self.docs.plugin_cache_root(plugin)
    }

    /// Il supporto del vault (§15.1), per chi implementa `data_*`: lo spazio
    /// dati di un plugin sta **dentro** il vault, e ci si scrive con lo stesso
    /// supporto con cui si scrivono i documenti.
    pub(crate) fn storage(&self) -> &Arc<dyn crate::storage::VaultStorage> {
        self.docs.vault.storage()
    }

    /// Traduce un path relativo dello spazio di un plugin in un path assoluto,
    /// rifiutando **tutto** ciò che proverebbe a uscirne.
    ///
    /// Il recinto è qui e in nessun altro posto: il plugin nomina blob, non
    /// path del filesystem, e non ha modo di sapere dove sia la radice del
    /// vault. `rel` vuoto è la radice stessa (serve a `data_list`).
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

    /// Congela supporto, namespace e path validati per una singola operazione
    /// `data_*`; il token non esegue I/O finché non viene invocato.
    pub fn prepare_plugin_data_io(
        &self,
        plugin: &str,
        rel: &str,
    ) -> std::result::Result<PreparedPluginDataIo, PluginError> {
        let canonical_root = self.plugin_data_root(plugin);
        let cache_root = self.plugin_cache_root(plugin);
        let canonical_path = self.plugin_data_path(plugin, rel)?;
        let relative = canonical_path
            .strip_prefix(&canonical_root)
            .map_err(|_| PluginError::Internal("cache path outside plugin root".into()))?;
        let cache_path = cache_root.join(relative);
        Ok(PreparedPluginDataIo {
            storage: Arc::clone(self.storage()),
            cache_mark: cache_root.join(PLUGIN_CACHE_MARK),
            canonical_root,
            cache_root,
            canonical_path,
            cache_path,
        })
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

    /// Freeze the storage handle and timer-cursor path without performing I/O.
    ///
    /// The returned token owns everything needed by a caller that must release
    /// its `Workspace` guard before touching the storage backend.
    pub fn prepare_timer_cursors(
        &self,
        owner: &str,
    ) -> std::result::Result<PreparedTimerCursors, PluginError> {
        Ok(PreparedTimerCursors {
            storage: Arc::clone(self.storage()),
            path: self.plugin_data_path(owner, TIMER_CURSORS_FILE)?,
        })
    }

    /// Legge i cursori dei timer del plugin dal dato autorevole del vault.
    ///
    /// Il file vive nello spazio dati del plugin (`.fub/plugins/<id>/`), la
    /// stessa radice centralizzata da `plugin_data_path`; non è una cache.
    pub fn timer_cursors(
        &self,
        owner: &str,
    ) -> std::result::Result<BTreeMap<String, CivilTime>, PluginError> {
        self.prepare_timer_cursors(owner)?.read()
    }

    /// Aggiorna atomicamente il cursore di un timer.
    ///
    /// Il valore durevole è un cursore cronologico: due worker possono avere
    /// preso fotografie in ordine diverso da quello in cui arrivano alla
    /// scrittura, ma una fotografia più vecchia non può riportare indietro
    /// quella già persistita. Il confronto avviene dentro l'update atomico,
    /// dopo la rilettura sotto il lock dello storage.
    pub fn set_timer_cursor(
        &self,
        owner: &str,
        timer: &str,
        cursor: CivilTime,
    ) -> std::result::Result<(), PluginError> {
        self.prepare_timer_cursors(owner)?.write(timer, cursor)
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
pub(crate) fn collect_data_files(
    storage: &dyn crate::storage::VaultStorage,
    root: &Utf8Path,
    dir: &Utf8Path,
    out: &mut Vec<String>,
) {
    let Ok(entries) = storage.list(dir) else {
        // Una cartella che non c'è è una lista vuota, non un errore: chi
        // interroga uno storage vuoto non sta sbagliando niente.
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
