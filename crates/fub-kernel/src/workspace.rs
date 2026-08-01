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
use fub_abi::command::{CommandEffect, CommandOutcome, CommandSpec, InvokeMode, UndoStep};
use fub_abi::custom::{CustomRenderer, SyntaxRule};
use fub_abi::edit::{EditReport, EditRequest, Revision, TextEdit};
use fub_abi::format::{DocumentFormat, RenderOptions};
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, DocumentModel, LinkTarget, Span};
use fub_abi::session::ViewContext;
use fub_abi::settings::{SettingEntry, SettingScope, SettingSource, SettingValue};
use fub_abi::text::{Localize, Strings, Text};
use fub_abi::traits::{
    BacklinkRef, CommandProvider, DocPosition, DocumentMatch, EntryKind, EventHandler, HostApi,
    IndexLoss, IndexProvider, IndexQuery, IndexResult, JobId, JobProgress, JobSpec, Page, Paged,
    PluginManifest, QueryRoute, ReadApi, ServiceProvider, VaultEntry, ViewInstance, ViewInterests,
    ViewProvider, ViewSpec,
};
use fub_abi::transfer::{
    ExportProvider, ExportReport, ExportRequest, ExportTarget, ImportProvider, ImportReport,
    ImportRequest, ImportSource,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::{Actor, Event, Notice, PluginError, Severity};
use serde::{Deserialize, Serialize};

use fub_abi::rules::media;
use fub_abi::rules::path as rules_path;
use fub_abi::rules::path::{resolution_key, strip_ext};
use fub_abi::rules::path_policy::{self, Naming};

use crate::bus::EventBus;
use crate::dispatcher::{Dispatcher, JobBell, PendingJob, ToDeliver};
use crate::documents::{extension_of, DocumentStore};
use crate::entries::{EntryStore, StoredEntry};
use crate::error::{KernelError, Result};
use crate::host::{Granted, Guard, KernelHost, ReadHost, ReadOnly};
use crate::index::plan::QueryPlan;
use crate::index::Indexes;
use crate::locale::SystemLocale;
use crate::occurrences;
use crate::organization::OrganizationStore;
use crate::plugins::{self, PluginInfo, RegistrationKind, RegistryError};
use crate::providers::{ProviderRegistry, ProviderTable, RegisteredCommand, RegisteredView};
use crate::registry::FormatRegistry;
use crate::renderer::{self, RenderedDocument};
use crate::session::{ContextChange, Session};
use crate::settings::{MachineSettings, SettingsStore, SharedSettings};
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

pub struct Workspace {
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
    /// Quali spazi per-documento non hanno potuto seguire una rinomina (§13.2).
    ///
    /// Un `Vec` nudo e non un `Arc<RwLock<…>>` come le altre due liste di
    /// avvisi: qui a scrivere è **solo** `migrate_identity`, che ha già il
    /// prestito esclusivo del workspace. Un lucchetto in più non renderebbe
    /// visibile niente a nessuno che non lo veda già.
    doc_data_warnings: Vec<String>,
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
    pub fn new(root: impl AsRef<Utf8Path>, registry: FormatRegistry) -> Self {
        Workspace::with_machine_settings(root, registry, MachineSettings::in_memory())
    }

    /// Come [`new`](Workspace::new), col livello macchina **condiviso** fra
    /// tutti i vault aperti da questo host (§11.1).
    pub fn with_machine_settings(
        root: impl AsRef<Utf8Path>,
        registry: FormatRegistry,
        machine: Arc<MachineSettings>,
    ) -> Self {
        // Il registry è condiviso con l'indice del kernel invece che copiato:
        // "quali estensioni sono documenti" è una domanda sola (vedi
        // `CoreIndex::registry`).
        let registry = Arc::new(registry);
        let root = root.as_ref();
        let settings: SharedSettings = Arc::new(RwLock::new(SettingsStore::open(root, machine)));
        // L'organizzazione è **del vault**, quindi si apre col root e non si
        // riceve da chi monta: è la differenza con il livello macchina e con lo
        // stato di vista, che sono della macchina e valgono per N vault.
        let (organization, warning) = OrganizationStore::open(root);
        if let Some(warning) = warning {
            organization.warn(warning);
        }
        Workspace {
            docs: DocumentStore::new(root, Arc::clone(&registry)),
            indexes: Indexes::new(registry, Arc::clone(&settings), Arc::clone(&organization)),
            providers: ProviderRegistry::new(),
            dispatch: Dispatcher::new(EventBus::new()),
            session: Session::default(),
            closed: false,
            settings,
            view_states: ViewStates::in_memory(),
            organization,
            system_locale: Arc::new(SystemLocale::default()),
            undo: UndoStack::default(),
            // L'anagrafe è **del vault**, come l'organizzazione: si apre col
            // root e non si riceve da chi monta.
            entry_store: EntryStore::open(root),
            doc_data_warnings: Vec::new(),
        }
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
    pub(crate) fn localized(&self, plugin: &str, mut e: PluginError) -> PluginError {
        self.localize(plugin, &mut e);
        e
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
        let provides = self
            .providers
            .plugins
            .get(&plugin)
            .map(|e| e.manifest.provides.clone())
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
            let mut giro = self.providers.service_stack.clone();
            giro.push(service.to_string());
            return Err(PluginError::BadArgs(
                format!(
                    "un servizio non può chiamare sé stesso: {}",
                    giro.join(" → ")
                )
                .into(),
            ));
        }

        let provider = Arc::clone(&self.providers.services[at].1);
        self.providers.service_stack.push(service.to_string());
        let out = self.with_provider_call(|ws| {
            let mut host = ws.host_for(&owner, InvokeMode::Apply);
            // La rete contro i panici sta **attorno alla chiamata del
            // provider** e a niente di più (§9.3): tutto ciò che viene dopo —
            // la pila dei servizi da svuotare, il dispatch da drenare — è già
            // scritto per girare sul ramo dell'errore, e catturare più in alto
            // lo salterebbe.
            crate::safety::calling(&owner, &format!("servendo `{service}.{method}`"), || {
                provider.call(service, method, args, &mut host)
            })
        });
        self.providers.service_stack.pop();
        self.dispatch_pending();
        out
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
    ///    ([decisione 0031](../../../docs/decisions/0031-chi-possiede-i-bundle.md)),
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

        let mut errors = Vec::new();
        let indexes = self.indexes.remove(plugin);
        let removed_indexes = !indexes.is_empty();
        for (id, mut index) in indexes {
            let out = self.with_provider_call(|ws| {
                let mut host = ws.host_for(&id, InvokeMode::Apply);
                // Il flush **prima** della chiusura, come dice il contratto: chi
                // arriva a `close` ha già avuto il proprio punto di persistenza,
                // e ciò che scrive lì dentro è roba della chiusura.
                let flushed = index.flush(&mut host);
                let closed = index.close(&mut host);
                [flushed, closed]
            });
            errors.extend(out.into_iter().filter_map(|outcome| outcome.err()));
            // Qui il `Box` cade, ed è il momento in cui un provider nativo
            // lascia andare ciò che il `close` non ha saputo lasciare.
            drop(index);
        }

        self.providers.handlers.retain(|(id, _)| id != plugin);
        self.providers.views.retain(|v| v.id != plugin);
        self.providers.commands.retain(|c| c.id != plugin);
        self.providers.services.retain(|(id, _)| id != plugin);
        self.providers.imports.retain(|(id, _)| id != plugin);
        self.providers.exports.retain(|(id, _)| id != plugin);

        // Regole sintattiche e renderer non sono in una tabella di provider: i
        // loro registri conoscono l'id della *regola*, non quello di chi l'ha
        // registrata. Chi lo sa è l'inventario, ed è da lì che si prendono i
        // nomi da togliere.
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
        // Lo schema delle sue impostazioni se ne va con lui: da qui in poi le
        // sue chiavi non si leggono e non si scrivono, che è ciò che vuol dire
        // «quella feature non c'è». I **valori** restano scritti dov'erano —
        // spegnere una feature non è riconfigurarla, e riaccenderla ritrova come
        // l'avevi lasciata.
        self.settings
            .write()
            .expect("store di configurazione")
            .withdraw(plugin);

        // I job che aveva in coda non partiranno: il loro corpo è
        // `Plugin::run_job`, e quel plugin non c'è più. Ognuno riceve il proprio
        // esito, perché un job che sparisce senza dire niente è un chiamante che
        // aspetta per sempre — ed è la terza faccia del §9.2, quella che la
        // decisione 0027 aveva lasciato aperta.
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

        // Il canale dati non risponde più come prima: chi disegna da una query
        // sta mostrando il passato. Non lo ha chiesto un documento né un plugin
        // — è il kernel che dichiara di aver cambiato forma (decisione 0012).
        if removed_indexes {
            self.as_actor(Actor::Kernel, |ws| {
                ws.emit_event(Event::IndexUpdated);
                ws.dispatch_pending();
            });
        }
        Ok(errors)
    }

    /// **Chiude il vault**: l'ultimo giro sincrono, un punto di consistenza per
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
    ///    ([decisione 0028](../../../docs/decisions/0028-come-un-componente-smette.md)).
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
            .map(|e| e.manifest.id.clone())
            .rev()
            .collect();
        for id in plugins {
            errors.extend(stopping(self, &id));
            match self.deactivate_plugin(&id) {
                Ok(errs) => errors.extend(errs),
                // Un `Busy` qui vorrebbe dire che si sta chiudendo il vault da
                // dentro la chiamata di un provider, cioè che chi chiude è
                // qualcuno che il vault lo sta usando. Non fa danno e va detto.
                Err(e) => errors.push(PluginError::Internal(e.to_string().into())),
            }
        }
        errors
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
    /// persistente che l'`HostApi` gli concede (`.fub/data/plugins/<id>/`) e
    /// **i permessi con cui girerà**. Un handler non nomina niente di suo, e
    /// quindi non ha id da far collidere: l'unico nome in gioco è quello del
    /// plugin.
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
        // Anche questa è una "chiamata di provider" ai fini della consegna:
        // ciò che `f` emette arriva agli handler quando `f` è tornata.
        let result = self.with_provider_call(|ws| {
            let mut host = ws.host_for(plugin, InvokeMode::Apply);
            f(&mut host)
        });
        self.dispatch_pending();
        result
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
        // I `ns` delle query custom sono nomi in uno spazio condiviso, e la
        // regola del §7.4 vale per loro come per gli id di view: chi rivendica
        // `acme:tasks` deve essere `acme`. Le rotte del contratto invece non
        // sono nomi di nessuno — chi le rivendica non le nomina, le serve — e il
        // loro conflitto lo vede la tabella delle rotte.
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
        self.indexes.providers.push((id, index));
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
    pub fn reindex(&mut self) -> Result<()> {
        let scanned = self.docs.vault.scan()?;
        let doc_extensions = self.docs.registry.all_extensions();

        // La specie si **ricalcola** e non si rilegge dalla tabella: dipende da
        // chi è registrato adesso, e un `.canvas` diventa un documento il giorno
        // che qualcuno rivendica quell'estensione, senza essere cambiato.
        let mut entries: Vec<VaultEntry> = scanned
            .files
            .into_iter()
            .map(|file| VaultEntry {
                fingerprint: self
                    .entry_store
                    .known(&file.id)
                    .filter(|known| known.describes(file.size, file.mtime))
                    .and_then(|known| known.fingerprint.clone()),
                kind: media::kind_of(&file.id, &doc_extensions),
                id: file.id,
                size: file.size,
                mtime: file.mtime,
            })
            .collect();

        // Ciò che non si sa lo si legge, e leggendolo se ne prende l'impronta:
        // dopo un `git checkout` che ha ritimbrato mille file senza cambiarne
        // uno, la data non combacia ma il contenuto sì — e chi tiene l'impronta
        // (l'anagrafe, e chi risponde alla domanda del punto 4) li riconosce
        // tutti e mille.
        let mut sources: BTreeMap<DocId, String> = BTreeMap::new();
        for entry in entries.iter_mut() {
            if entry.kind != EntryKind::Document || entry.fingerprint.is_some() {
                continue;
            }
            let source = self.docs.vault.read(&entry.id)?;
            entry.fingerprint = Some(Revision::of(&source));
            sources.insert(entry.id.clone(), source);
        }

        let documents: Vec<VaultEntry> = entries
            .iter()
            .filter(|e| e.kind == EntryKind::Document)
            .cloned()
            .collect();
        let already = self.indexes.up_to_date(&documents);

        // Prima si parsa TUTTO, poi si muta: un parse fallito a metà lascia il
        // workspace com'era. I modelli interi vivono solo qui, il tempo di
        // alimentare indici e conteggi: in cache restano i metadati.
        let mut models = Vec::new();
        let mut restored = Vec::new();
        for entry in &documents {
            let remembered = self
                .entry_store
                .known(&entry.id)
                .filter(|known| known.fingerprint == entry.fingerprint)
                .and_then(|known| known.meta.clone());
            match remembered {
                Some(meta) if already.contains(&entry.id) => {
                    restored.push((entry.id.clone(), meta))
                }
                _ => {
                    let source = match sources.remove(&entry.id) {
                        Some(source) => source,
                        None => self.docs.vault.read(&entry.id)?,
                    };
                    models.push(self.docs.parse(&entry.id, &source)?);
                }
            }
        }
        drop(sources);

        self.indexes.core.clear();
        // Le cartelle prima delle voci, e dalla **camminata** e non dai path
        // dei file (§14.3): una cartella vuota non compare in nessun path, e
        // dedurle dai file vorrebbe dire che l'unica cartella che esiste è
        // quella che ha già qualcosa dentro.
        for folder in scanned.folders {
            self.indexes.core.set_folder(folder);
        }
        for entry in entries.drain(..) {
            self.indexes.core.set_entry(entry);
        }
        for (id, meta) in restored {
            self.indexes.core.restore(&id, meta);
        }
        // **Il kernel taglia** (§20.1): l'alimentazione è a lotti, e qui il
        // lotto è tutto ciò che questa funzione ha in mano — che su un vault
        // vero sono decine di migliaia di modelli. Si taglia in fette perché
        // la dimensione di un lotto non è un dettaglio di chi lo riceve: a M5
        // ogni fetta è una serializzazione, e una sola da 100k note vuol dire
        // costruirne il buffer intero prima che l'indice ne veda una.
        for fetta in models.chunks(FEED_BATCH) {
            let lost = self.indexes.on_documents_indexed(fetta);
            self.report_losses(lost);
        }
        drop(models);
        // L'apertura ricostruisce il grafo in blocco anche in modalità
        // incrementale: gli `upsert` uno per uno l'hanno già costruito, ma la
        // risoluzione dei wikilink dipende dall'insieme intero (un alias
        // dichiarato dall'ultima nota vale anche per la prima).
        self.indexes.core.rebuild_graph();

        let ids: Vec<DocId> = self.documents();
        let lost = self.indexes.reconcile(&ids);
        self.report_losses(lost);
        // Gli errori di flush non fanno fallire l'apertura del vault: un
        // indice è stato derivato, il vault è la verità (M4: notifica).
        let _ = self.flush_indexes();

        // La raccolta dello stato per-documento (§13.2) passa di qui e non da
        // un evento: la cancellazione definitiva si può perdere — svuotare il
        // cestino ad app chiusa non lo annuncia nessuno — mentre un giro sul
        // disco no. È il momento giusto perché l'anagrafe è appena stata
        // ricostruita, cioè è al suo massimo di verità.
        self.collect_doc_data();
        self.store_entries();

        // L'apertura non l'ha chiesta un documento né un plugin: è il kernel che
        // dichiara di esistere (decisione 0012).
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::VaultOpened {
                root: ws.docs.vault.root().to_string(),
            });
            ws.emit_event(Event::IndexUpdated);
            ws.dispatch_pending();
        });
        Ok(())
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
        let kind = media::kind_of(id, &self.docs.registry.all_extensions());
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
        Some(kind)
    }

    /// Scrive l'anagrafe, perché la prossima apertura non debba rifare ciò che
    /// questa ha appena fatto (§14.2).
    ///
    /// Si scrive **qui e alla chiusura**, non a ogni salvataggio: è un file che
    /// contiene una riga per file del vault, e riscriverlo a ogni battuta
    /// sarebbe pagare l'intero vault per un documento. Fra un giro e l'altro
    /// l'anagrafe vive in memoria; se il processo muore prima di scriverla, la
    /// riapertura rilegge tutto — cioè si comporta come prima che questa voce
    /// esistesse, che è il degrado giusto per un dato derivato.
    ///
    /// L'esito non risale, e non perché non interessi: un'apertura riuscita non
    /// deve fallire perché una cache non si è scritta. Non finisce nemmeno in
    /// [`IndexQuery::VaultStatus`](fub_abi::traits::IndexQuery::VaultStatus),
    /// che è il fatto interrogabile del §9.7 e dice un'altra cosa — *questo
    /// vault vede le scritture altrui* —: allargarlo a «e poi non ho scritto una
    /// cache» renderebbe quel numero la somma di due incidenti diversi. Va su
    /// `stderr` come il sidecar del cestino, ed è il §20.2 che gli darà una
    /// destinazione vera.
    fn store_entries(&mut self) {
        let table = self
            .indexes
            .core
            .entries
            .values()
            .map(|entry| {
                (
                    entry.id.clone(),
                    StoredEntry {
                        size: entry.size,
                        mtime: entry.mtime,
                        fingerprint: entry.fingerprint.clone(),
                        meta: self.indexes.core.stored_meta(&entry.id),
                    },
                )
            })
            .collect();
        if let Err(e) = self.entry_store.store(table) {
            tracing::warn!(target: "fub.kernel", "anagrafe: {e}");
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

    /// Scrive la sorgente, riparsa il documento, aggiorna il grafo ed emette
    /// gli eventi. Il grafo si aggiorna per-documento ([`GraphUpdate`]).
    pub fn write_document(&mut self, id: &DocId, source: &str) -> Result<()> {
        // Il parse è puro: farlo PRIMA di scrivere tiene la mutazione atomica.
        // Nell'ordine inverso un parse fallito lascerebbe il disco avanti
        // rispetto a modelli/grafo/indici — e il chiamante riceverebbe `Err`
        // pur avendo scritto.
        let model = self.docs.parse(id, source)?;
        self.docs.vault.write(id, source)?;
        self.ingest_model(id, model, Revision::of(source));
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
            let src = ws.docs.vault.read(id)?;
            ws.ingest(id, &src)?;
            ws.dispatch_pending();
            Ok(())
        })
    }

    fn ingest(&mut self, id: &DocId, source: &str) -> Result<()> {
        let model = self.docs.parse(id, source)?;
        self.ingest_model(id, model, Revision::of(source));
        Ok(())
    }

    /// La coda di ogni scrittura: indici, conteggi tag, grafo, metadati in
    /// cache, eventi. Prende il modello già parsato — è ciò che permette a
    /// `write_document` di parsare prima di toccare il disco.
    fn ingest_model(&mut self, id: &DocId, model: DocumentModel, fingerprint: Revision) {
        // L'anagrafe segue ogni scrittura (§14.1): dimensione, data e impronta
        // di un documento appena scritto sono cambiate, e una voce ferma a
        // prima direbbe che il file è quello di ieri — a chi la interroga
        // adesso, e alla prossima apertura, che sull'anagrafe decide cosa
        // rileggere.
        self.touch_entry(id, Some(fingerprint));
        // Gli indici vedono la modifica nella stessa operazione del grafo:
        // stessa verità, nessun canale che può perdere pezzi per strada. E la
        // vedono ADESSO, sul modello intero: è l'unico momento in cui corpo e
        // testo esistono — la cache tiene i soli metadati.
        // Un lotto di uno: la scrittura singola È il caso normale, e la firma
        // a lotti non la trasforma in un'eccezione da spiegare.
        let lost = self
            .indexes
            .on_documents_indexed(std::slice::from_ref(&model));
        self.report_losses(lost);
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            // Il rebuild legge la cache: va aggiornata prima.
            self.indexes.core.rebuild_graph();
        }
        // Il sorgente sotto la selezione è cambiato: gli offset pubblicati
        // dalla shell erano di un altro testo. La shell ne ripubblicherà uno
        // vero al prossimo movimento del cursore (o subito dopo un
        // salvataggio); fino ad allora il contesto dice "non so dove", che è
        // la verità.
        self.session.invalidate(id, ContextChange::Rewritten);
        self.emit_event(Event::DocumentChanged { id: id.clone() });
        self.emit_event(Event::IndexUpdated);
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
    pub fn sync_path(&mut self, abs: &Utf8Path) -> Result<bool> {
        let outcome = self.sync_path_here(abs);
        self.note_sync(&outcome);
        outcome
    }

    /// Registra l'esito di una sincronizzazione per-path nel fatto interrogabile
    /// del §9.7. Non cambia ciò che il chiamante riceve: aggiunge un secondo
    /// lettore, che è il vault stesso.
    fn note_sync(&mut self, outcome: &Result<bool>) {
        if let Err(e) = outcome {
            self.indexes.core.note_sync_failure(e);
        }
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
            self.refresh_from_disk(&id)?;
            Ok(true)
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
                let prima = ws.indexes.core.entries.get(id).cloned();
                let fingerprint = match (&prima, ws.docs.vault.stat(id)) {
                    // Stessa dimensione e stessa data: è lo stesso contenuto, e
                    // un'impronta che qualcuno aveva calcolato vale ancora.
                    (Some(e), Some((size, mtime))) if e.size == size && e.mtime == mtime => {
                        e.fingerprint.clone()
                    }
                    // Cambiato: l'impronta di prima descriveva un altro
                    // contenuto, e tenerla sarebbe scrivere una bugia in
                    // anagrafe. Chi la vorrà la calcolerà leggendo i byte.
                    _ => None,
                };
                let Some(kind) = ws.touch_entry(id, fingerprint) else {
                    return Ok(false);
                };
                if ws.indexes.core.entries.get(id) == prima.as_ref() {
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
        if self.indexes.core.contains(id) {
            // La nota con il focus non esiste più: `active_context` non deve
            // continuare a nominarla alle view (né tenerne una selezione).
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
                    .docs
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
    pub(crate) fn is_taken(&self, id: &DocId) -> bool {
        self.indexes.core.metas.contains_key(id) || self.docs.vault.exists(id)
    }

    /// Il [`DocId`] di una nota che nasce col nome dato: separatori normalizzati
    /// e, se il nome non porta già un'estensione gestita, quella di default.
    fn new_note_id(&self, name: &str) -> Result<DocId> {
        // Un nome che nasce: la tolleranza stretta del §15.5.
        let id = new_doc_id(name)?;
        let ha_estensione = self.docs.has_provider_for(&id);
        if ha_estensione {
            return Ok(id);
        }
        let ext = self
            .docs
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
        if !self.indexes.core.metas.contains_key(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let (trashed, sidecar_fault) = self.docs.vault.trash(id)?;
        self.remove_document(id);
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
            );
        }
        Ok(trashed)
    }

    /// Il contenuto del cestino, dal più recente al più vecchio.
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        self.docs.vault.list_trash()
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
            .docs
            .vault
            .list_trash()?
            .into_iter()
            .find(|e| &e.id == trash_id)
            .ok_or_else(|| KernelError::NotFound(trash_id.to_string()))?;
        // `entry.original` nasce da un basename o dal sidecar scritto dal
        // vault, ed è sano per costruzione; il `to` del chiamante invece
        // arriva dall'IPC e va validato.
        //
        // Validato col recinto e **non** con la portabilità (§15.5): ripristinare
        // non fa nascere un nome, ne rimette uno che c'era. Una nota che si
        // chiamava `CON.md` prima di finire nel cestino deve poter tornare — e
        // sarebbe un modo curioso di perdere un file, rifiutarsi di restituirlo
        // per un nome che il vault conteneva già.
        let original = entry.original.clone();
        let target = match to {
            Some(to) => valid_doc_id(to.as_str())?,
            None => entry.original,
        };
        if self.indexes.core.metas.contains_key(&target) || self.docs.vault.exists(&target) {
            return Err(KernelError::AlreadyExists(target.to_string()));
        }
        let ext = extension_of(&target).unwrap_or_default();
        if self.docs.registry.provider_for_ext(&ext).is_none() {
            return Err(KernelError::NoProvider(ext));
        }

        let source = self.docs.vault.read(trash_id)?;
        self.write_document(&target, &source)?;
        // Se il ripristino approda su un path diverso dall'origine (il path
        // era di nuovo occupato e l'utente ha scelto un altro nome), lo stato
        // per-documento — storia del versioning, meta del frontend — vive
        // ancora sotto la chiave d'origine: è un rename a tutti gli effetti,
        // anche se il documento non era indicizzato, e chi tiene stato migra
        // la chiave sull'evento.
        if target != original {
            // Lo stato per-documento segue la chiave anche qui, e va fatto nel
            // kernel per la ragione di sempre: l'evento dice la stessa cosa, ma
            // la coda ha un budget e può troncare (decisione 0034), e chi tiene
            // stato autorevole non può dipendere da una consegna best-effort.
            self.migrate_doc_data(&original, &target);
            self.emit_event(Event::DocumentRenamed {
                from: original,
                to: target.clone(),
            });
            self.dispatch_pending();
        }
        // La copia nel cestino se ne va per ultima: se la cancellazione
        // fallisce restano due copie della nota, il che è un fastidio. Fare il
        // contrario significherebbe rischiare di non averne nessuna.
        self.docs.vault.remove_trashed(trash_id)?;
        Ok(target)
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
        // Rename "case-only" (`nota.md` → `Nota.md`): su un filesystem
        // case-insensitive (macOS/Windows) `vault.exists(to)` vede lo STESSO
        // file, non una collisione — il check sul disco va saltato. Un vero
        // omonimo-per-case su filesystem case-sensitive è comunque intercettato
        // da `models` (il vault è l'unica fonte dei DocId, quindi lo conosce).
        let case_only = from.as_str().to_lowercase() == to.as_str().to_lowercase();
        if self.indexes.core.metas.contains_key(to) || (!case_only && self.docs.vault.exists(to)) {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }
        let ext = extension_of(to).unwrap_or_default();
        if self.docs.registry.provider_for_ext(&ext).is_none() {
            return Err(KernelError::NoProvider(ext));
        }

        // Il piano di riscrittura va calcolato PRIMA di toccare il grafo:
        // serve la risoluzione con il vecchio nome ancora in vigore.
        let plan = self.link_rewrite_plan(from, to);

        self.docs.vault.rename(from, to)?;
        let source = self.docs.vault.read(to)?;
        let model = self.docs.parse(to, &source)?;
        self.migrate_identity(from, to, model, Revision::of(&source));

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
        let case_only = from.as_str().to_lowercase() == to.as_str().to_lowercase();
        if self.indexes.core.entries.contains_key(to)
            || self.indexes.core.metas.contains_key(to)
            || (!case_only && self.docs.vault.exists(to))
        {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }

        // Il piano PRIMA di spostare: si risolve con il vecchio path ancora in
        // vigore, come per i documenti.
        let plan = self.entry_rewrite_plan(from, to);
        self.docs.vault.rename(from, to)?;

        let fingerprint = self
            .indexes
            .core
            .entries
            .get(from)
            .and_then(|e| e.fingerprint.clone());
        self.indexes.core.remove_entry(from);
        // L'impronta segue il file: un rename sposta i byte senza toccarli.
        let kind = self
            .touch_entry(to, fingerprint)
            .unwrap_or(EntryKind::Unknown);
        // E lo seguono anche le due cose che seguono ogni identità che cambia:
        // ciò che l'utente gli ha attaccato addosso (§11.3) e lo spazio
        // per-documento di chiunque altro (§13.2). Un allegato può essere
        // appuntato e può avere una miniatura, e nessuna delle due è meno sua
        // per il fatto che nessuno lo parsa.
        if let Err(e) = self.organization.migrate(from.as_str(), to.as_str()) {
            self.organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in {to}: {e}"
            ));
        }
        self.migrate_doc_data(from, to);

        let mut falliti: Vec<String> = Vec::new();
        for (src, request) in plan {
            if let Err(e) = self.apply_edit(&src, request) {
                falliti.push(format!("{src}: {e}"));
            }
        }
        self.emit_event(Event::EntryRenamed {
            from: from.clone(),
            to: to.clone(),
            kind,
        });
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        if !falliti.is_empty() {
            return Err(KernelError::LinkRewrite(falliti.join("; ")));
        }
        Ok(())
    }

    /// Per ogni documento che **mostra** o nomina `from`, la modifica che
    /// riscrive il suo riferimento verso `to` (§14.1).
    ///
    /// Le sorgenti non si chiedono al grafo, e non è una scorciatoia: un
    /// allegato non è un nodo del grafo — non ha backlink, perché non ha link
    /// uscenti e non partecipa alla risoluzione per nome delle note. Si cammina
    /// quindi la cache dei metadati, che i link ce li ha tutti. È un giro
    /// sull'intero vault, e si paga quando qualcuno sposta un allegato: cioè
    /// quanto costa già un rename di nota con molti backlink.
    fn entry_rewrite_plan(&self, from: &DocId, to: &DocId) -> Vec<(DocId, EditRequest)> {
        let mut plan = Vec::new();
        for (src, meta) in &self.indexes.core.metas {
            let Ok(source_text) = self.docs.vault.read(src) else {
                continue;
            };
            let mut edits: Vec<TextEdit> = Vec::new();
            for link in &meta.links {
                if self.indexes.core.resolve_entry(src, &link.target).as_ref() != Some(from) {
                    continue;
                }
                let (written, replacement, from_end) = match &link.target {
                    // Un wikilink nomina per nome: il nome nuovo, che è il nome
                    // del file con la sua estensione. Se il vault ha già un
                    // omonimo del nome d'arrivo si scrive il path intero, che è
                    // sempre univoco — la stessa regola delle note.
                    LinkTarget::Wiki { page, .. } => {
                        let name = to.as_str().rsplit('/').next().unwrap_or(to.as_str());
                        let contended = self.indexes.core.entries.keys().any(|id| {
                            // Né il nome d'arrivo né quello di partenza contano
                            // come omonimi: il piano si calcola con il vecchio
                            // path **ancora in anagrafe**, e senza escluderlo
                            // uno spostamento che non cambia il nome del file
                            // risulterebbe conteso da sé stesso — cioè ogni
                            // `![[foto.png]]` diventerebbe un path intero anche
                            // quando nel vault c'è una foto sola.
                            id != to
                                && id != from
                                && fub_abi::rules::path::resolution_key(
                                    id.as_str().rsplit('/').next().unwrap_or(id.as_str()),
                                ) == fub_abi::rules::path::resolution_key(name)
                        });
                        let nuovo = if contended {
                            to.as_str().to_string()
                        } else {
                            name.to_string()
                        };
                        (page.as_str(), nuovo, false)
                    }
                    LinkTarget::Path(written) => {
                        let (path, fragment) = rules_path::split_fragment(written);
                        let nuovo = if path.trim_start().starts_with('/') {
                            // Un link dalla radice resta dalla radice: è una
                            // scelta di stile di chi scrive, e il rename non è il
                            // momento di discuterla.
                            format!("/{}", rules_path::percent_encode_path(to.as_str()))
                        } else {
                            rules_path::relative_ref(src, to)
                        };
                        let rewritten = format!("{nuovo}{fragment}");
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

    /// Migra l'identità di un documento il cui file è **già** al path nuovo:
    /// modelli, documento attivo, grafo, indici, evento [`Event::DocumentRenamed`].
    ///
    /// È il tratto comune di [`rename_document`](Workspace::rename_document)
    /// (che prima sposta il file) e di
    /// [`sync_renamed_path`](Workspace::sync_renamed_path) (dove il file lo ha
    /// già spostato qualcun altro).
    fn migrate_identity(
        &mut self,
        from: &DocId,
        to: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
    ) {
        // L'anagrafe migra come tutto il resto: la chiave è il path, e il path
        // è cambiato.
        self.indexes.core.remove_entry(from);
        self.touch_entry(to, Some(fingerprint));
        // La nota aperta segue il rename anche qui: senza, `active_context`
        // risponderebbe col path vecchio e outline/backlink si svuoterebbero
        // fino al prossimo cambio nota. Va fatto nel kernel, non nella shell:
        // vale anche per i rename non innescati da lei.
        self.session
            .invalidate(from, ContextChange::Renamed(to.clone()));
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
        //
        // L'errore non risale: il file è già stato spostato, e far fallire una
        // rinomina riuscita perché un'icona non si è spostata sarebbe il verso
        // sbagliato. La rinomina vale, l'icona resta indietro, e qualcuno lo
        // dice (`organization_warnings`).
        if let Err(e) = self.organization.migrate(from.as_str(), to.as_str()) {
            self.organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in \
                 {to}: {e}"
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
        // Per ogni indice — quello del kernel compreso — il rename è
        // remove+add: l'identità è la chiave, e la chiave è cambiata. (Chi
        // tiene stato *per-documento* invece migra la chiave sull'evento
        // `DocumentRenamed`.)
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
        self.note_sync(&outcome);
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
            let partito = self.sync_path_here(from)?;
            return Ok(self.sync_path_here(to)? || partito);
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
        if !to.exists() {
            self.remove_document(&from_id);
            return Ok(true);
        }
        let source = self.docs.vault.read(&to_id)?;
        let model = self.docs.parse(&to_id, &source)?;
        self.migrate_identity(&from_id, &to_id, model, Revision::of(&source));
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
        let from_name = resolution_key(from.page_name());
        let from_path = resolution_key(&strip_ext(from.as_str()));

        // Nuovo riferimento: il nome pagina se nessun altro documento lo
        // contende (a quel punto la risoluzione per nome è certa), altrimenti
        // il path senza estensione, che è sempre univoco.
        let to_name = to.page_name();
        let ambiguous = self
            .indexes
            .core
            .metas
            .keys()
            .any(|id| id != from && resolution_key(id.page_name()) == resolution_key(to_name));
        let new_ref = if ambiguous {
            strip_ext(to.as_str())
        } else {
            to_name.to_string()
        };

        let mut sources: BTreeSet<DocId> = self
            .indexes
            .core
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
            let Some(meta) = self.indexes.core.metas.get(&src) else {
                continue;
            };
            let Ok(source_text) = self.docs.vault.read(&src) else {
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
        let spec = rule.spec();
        let id = spec.id;
        // La regola dei nomi è **una** (§7.4): questa famiglia aveva la
        // propria — «serve un `ns:nome`», senza sapere di chi — e chiedeva un
        // namespace anche al core mentre non chiedeva a nessuno che fosse il
        // *suo*. Adesso passa di qui come le altre.
        self.providers.plugins.admit(
            &plugin,
            RegistrationKind::Syntax,
            std::slice::from_ref(&id),
        )?;
        // E vale anche per i `custom_kind` che la regola si impegna a emettere:
        // sono nomi che entrano nel modello, e senza questa riga un terzo
        // dichiara `callout` e si fa disegnare dal core. Non passano da `admit`
        // perché produrre lo stesso kind in due non è una contesa — è come si
        // scrivono due dialetti della stessa famiglia.
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

    /// I `custom_kind` che qualcuno **produce** e nessuno **disegna**.
    ///
    /// È il conto che il §3.2 chiedeva di poter fare: ogni nome qui dentro è un
    /// blocco che l'utente leggerà crudo — il degrado generico funziona, ma
    /// nessuno ha detto chi lo disegnerebbe. Chi monta l'app può guardarlo; oggi
    /// non c'è ancora una superficie dove mostrarlo (§20.4).
    pub fn undrawn_kinds(&self) -> Vec<String> {
        self.docs.undrawn_kinds()
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
    /// Un documento che il workspace non conosce è `NotFound`, e la prova è la
    /// stessa di `render_preview`: la cache dei metadati **è** l'insieme dei
    /// documenti indicizzati.
    pub fn read_model(&self, id: &DocId) -> Result<DocumentModel> {
        if !self.indexes.core.metas.contains_key(id) {
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

    /// Rende l'anteprima di un documento: l'HTML del provider, e le parti
    /// **dichiarative** che i renderer registrati hanno prodotto.
    ///
    /// Il corpo non sta in cache (split metadata/body): si rilegge e riparsa
    /// dal disco, nella forma che il provider ha dichiarato (§3.4). Il render è
    /// per-documento e on demand — è esattamente il tipo di lettura che il disco
    /// serve bene, mentre la cache calda serve le mutazioni.
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
        if !self.indexes.core.metas.contains_key(&id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        // Come `render_preview`: il corpo si riparsa dal disco on demand.
        let model = self.docs.parse_from_disk(&id)?;
        let provider = self.docs.provider_for(&id)?;
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
            renderer::compose(&model, provider, &self.docs.renderers, &opts)?,
        ))
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
    pub fn set_active_context(&mut self, context: Option<ViewContext>) -> Vec<String> {
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
        self.session.context()
    }

    /// Il documento del contesto attivo: la lettura che il kernel usa dove il
    /// pannello non c'entra (rename, rimozione, comodità dei test).
    pub fn active_document(&self) -> Option<&DocId> {
        self.session.document()
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
    /// — resta la fonte, e questo passaggio è il ripiego di chi non lo sa dire.
    pub fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        let needles = occurrences::wanted(&query);
        let result = self.indexes.query(query)?;
        match result {
            IndexResult::Documents(page) if !needles.is_empty() => {
                Ok(IndexResult::Documents(self.locate(page, &needles)))
            }
            other => Ok(other),
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
    /// L'errore di un indice non fa fallire il chiamante — un indice è stato
    /// *derivato*, la verità è il vault e si ricostruisce.
    ///
    /// **Li racconta da sé** (§20.3, decisione 0052), e continua a
    /// restituirli. È la forma della
    /// [decisione 0030](../../../docs/decisions/0030-il-rilevamento-si-puo-chiedere.md):
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
                for (id, index) in indexes.iter_mut() {
                    let mut host = ws.host_for(id, InvokeMode::Apply);
                    if let Err(e) = index.flush(&mut host) {
                        errors.push(e);
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
            self.report_trouble(Severity::Warning, None, error);
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
        self.mount_views(plugin.into(), provider, false)
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
        let specs = crate::providers::specs_dichiarate(provider.as_ref());
        let ids: Vec<String> = specs.iter().map(|s| s.id.clone()).collect();
        // Il permesso **prima** di togliere chi c'era: una sostituzione ha due
        // effetti, e un rifiuto in mezzo lascerebbe il primo fatto e il secondo
        // no — cioè una view del core cancellata da chi non poteva nemmeno
        // nominarla, con in mano un errore che dice «non è registrato».
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
            provider,
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
    /// [`specs_dichiarate`](crate::providers::specs_dichiarate) al momento della
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
        let registered = &self.providers.views[at];
        self.check_params(at, instance)?;
        // Anche il percorso di lettura passa dal punto di applicazione: un
        // provider senza `read_vault` non legge il vault **mentre disegna** più
        // di quanto lo legga da un'azione. Che il guard qui avvolga un
        // `ReadHost` invece di un `KernelHost` non cambia niente per la
        // politica — è la stessa, e non sa cosa ci sia sotto.
        let host = self.read_host_for_view(&registered.id, Some(instance.instance.as_str()));
        let mut tree = crate::safety::calling(
            &registered.id,
            &format!("disegnando `{}`", instance.view),
            || registered.provider.render_view(instance, &host),
        )
        .map_err(|e| self.localized(&registered.id, e))?;
        guard_ui(registered.trust, &tree)?;
        // **Dopo** la validazione del confine di fiducia, non prima: risolvere
        // una chiave non può trasformare un nodo innocuo in uno riservato — i
        // `Text` non diventano markup — ma l'ordine giusto è comunque quello che
        // non fa passare niente dal catalogo prima del controllo.
        self.localize(&registered.id, &mut tree);
        Ok(tree)
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
        let registered = &self.providers.views[at];
        Ok(registered.provider.interests(instance))
    }

    /// Consegna un'azione della UI al provider della view e restituisce il suo
    /// aggiornamento. Ogni albero che l'aggiornamento porta con sé —
    /// [`ViewUpdate::Replace`] e [`ViewUpdate::Patch`] — passa dalla stessa
    /// validazione di [`render_view`](Workspace::render_view): un provider non
    /// fidato non può iniettare contenuto attivo *in risposta a un click*
    /// invece che al rendering, né per la via stretta invece che per quella
    /// larga.
    pub fn view_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let at = self.view_owner(&instance.view)?;
        self.check_params(at, instance)?;
        // Prima del `take`: dopo, il registro è vuoto.
        let trust = self.providers.views[at].trust;
        // Il prestito rimanda il dispatch: se il provider scrive via `HostApi`
        // dentro `on_action`, gli handler NON girano nel suo frame — girano
        // nel `dispatch_pending` qui sotto, a chiamata tornata. Senza, un
        // plugin che è sia view sia handler (il caso versioning) sarebbe
        // rientrato nella propria istanza: in nativo funziona, a M5 trappa.
        let updated = self.lend(
            |ws| &mut ws.providers.views,
            |ws, views| {
                let registered = &mut views[at];
                let mut host =
                    ws.host_for_view(&registered.id, InvokeMode::Apply, Some(&instance.instance));
                // Dentro il prestito, non attorno: il `lend` deve **rimettere a
                // posto** la tabella delle view anche quando il provider pania,
                // e lo fa perché il panico non arriva fin qui.
                crate::safety::calling(
                    &registered.id,
                    &format!("reagendo a un'azione di `{}`", instance.view),
                    || registered.provider.on_action(instance, action, &mut host),
                )
            },
        );
        // Il proprietario è quello della view: un aggiornamento porta le
        // stringhe di chi l'ha scritto, come l'albero che sostituisce — e come
        // l'errore con cui, invece dell'aggiornamento, può rispondere.
        let owner = self.providers.views[at].id.clone();
        let mut update = updated.map_err(|e| self.localized(&owner, e))?;
        // **Ogni** albero che l'aggiornamento porta con sé, non solo quello di
        // `Replace`: una `Patch` è un nodo che entra nella webview come gli
        // altri, ed è più piccola solo nella dimensione. Il `match` è esaustivo
        // di proposito — è la stessa lezione di `UiNode::children`, che elencava
        // a mano i contenitori che c'erano: una variante nuova che portasse un
        // nodo deve rompere la compilazione qui, non passare in silenzio.
        let albero = match &update {
            ViewUpdate::Replace { root } => Some(root),
            ViewUpdate::Patch { node, .. } => Some(node),
            ViewUpdate::None
            | ViewUpdate::Navigate { .. }
            | ViewUpdate::Reveal { .. }
            | ViewUpdate::RunSearch { .. }
            | ViewUpdate::Custom { .. } => None,
        };
        if let Some(albero) = albero {
            guard_ui(trust, albero)?;
        }
        self.localize(&owner, &mut update);
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
        let specs = provider.commands();
        let ids: Vec<String> = specs.iter().map(|s| s.id.clone()).collect();
        self.providers
            .plugins
            .admit(&plugin, RegistrationKind::Command, &ids)?;
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Command, &ids);
        // La firma resta `Box` — è quella degli altri `register_*`, e chi
        // registra non deve sapere perché qui dentro serve un `Arc` (decisione 0013:
        // `run_command` rientra nel registro mentre il registro è in uso).
        self.providers.commands.push(RegisteredCommand {
            id: plugin,
            specs,
            provider: Arc::from(provider),
        });
        Ok(())
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
        self.as_actor(by, |ws| {
            ws.batch(|ws| ws.invoke_command_here(command, args, mode))
        })
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
            let mut giro = self.providers.command_stack.clone();
            giro.push(command.to_string());
            return Err(PluginError::BadArgs(
                format!(
                    "un comando non può invocare sé stesso: {}",
                    giro.join(" → ")
                )
                .into(),
            ));
        }

        // Il provider **resta** nel registro: si condivide il puntatore (vedi
        // il campo `commands`). È ciò che permette a `run_command` di trovare
        // gli altri comandi — e anche gli altri comandi dello stesso provider —
        // mentre questo è in corso.
        let owner = self.providers.commands[at].id.clone();
        let provider = Arc::clone(&self.providers.commands[at].provider);
        self.providers.command_stack.push(command.to_string());
        let outcome = if spec.scope.writes && mode == InvokeMode::Apply {
            self.with_provider_call(|ws| {
                let mut host = ws.host_for(&owner, mode);
                crate::safety::calling(&owner, &format!("eseguendo `{command}`"), || {
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
            crate::safety::calling(&owner, &format!("eseguendo `{command}`"), || {
                provider.invoke(command, args, mode, &mut host)
            })
        };
        // Il `pop` è **fuori** dalla rete e prima del `?`: un comando che pania
        // non deve restare per sempre "in giro" nella pila, o la prossima
        // invocazione si rifiuterebbe da sé dicendo che sta chiamando sé stesso.
        self.providers.command_stack.pop();

        let mut outcome = outcome.map_err(|e| self.localized(&owner, e))?;
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
        if mode == InvokeMode::Apply && self.providers.command_stack.is_empty() {
            if let Some(undo) = outcome.undo.clone() {
                self.undo.push(undo);
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
    pub(crate) fn undo_last(&mut self) -> std::result::Result<Option<Text>, PluginError> {
        let Some(undo) = self.undo.pop() else {
            return Ok(None);
        };
        // Tutto dentro un lotto solo: annullare una rinomina che aveva riscritto
        // quaranta sorgenti è un gesto, quindi un `batch-ended` e un ridisegno.
        let prima = self.undo.begin_replay();
        let esito = self.batch(|ws| {
            for step in &undo.steps {
                match step {
                    UndoStep::Edit(planned) => {
                        ws.apply_edit(&planned.doc, planned.edit.clone())?;
                    }
                    UndoStep::Command { command, args } => {
                        ws.invoke_command_here(command, args.clone(), InvokeMode::Apply)?;
                    }
                }
            }
            Ok::<(), PluginError>(())
        });
        self.undo.end_replay(prima);
        esito.map(|()| Some(undo.label))
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
    /// spazio dati (`.fub/data/plugins/<id>/`).
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
        // La stessa disciplina di tutti gli altri, e non più una quarta copia:
        // vedi `Workspace::lend`.
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

    /// Le destinazioni di export offerte dai provider registrati.
    pub fn export_targets(&self) -> Vec<ExportTarget> {
        self.providers.export_targets()
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
    ) {
        self.emit_event(Event::Trouble {
            severity,
            subject,
            error,
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
            self.report_trouble(Severity::Warning, Some(loss.id), loss.why);
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
    /// tutto-o-niente vuole il journal del §15.2). Ciò che è andato storto lo
    /// riporta `f` col proprio valore di ritorno, che questa funzione passa
    /// intatto.
    ///
    /// Annidato, entra nel lotto che c'è invece di aprirne un secondo: chiudere
    /// quello interno farebbe arrivare un `batch-ended` mentre l'operazione
    /// esterna è ancora in corso.
    pub fn batch<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        if !self.dispatch.open_batch() {
            // Entra in quello che c'è, e non lo chiude: a chiudere è chi lo ha
            // aperto. Contare le aperture non servirebbe a niente — chi trova il
            // campo pieno non lo tocca in nessun caso.
            return f(self);
        }
        let result = f(self);
        self.end_batch();
        result
    }

    /// Chiude il lotto più esterno: emette il terminale (se c'è qualcosa da
    /// dire) e drena.
    fn end_batch(&mut self) {
        self.dispatch.close_batch();
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
        while let Some(next) = self.dispatch.next_to_deliver(&mut budget) {
            match next {
                ToDeliver::Notice(notice) => self.deliver_to_handlers(&notice),
                ToDeliver::Overflow(overflow) => {
                    self.deliver_to_handlers(&overflow);
                    // Ciò che gli handler hanno emesso gestendo l'Overflow è
                    // scartato: la coda deve terminare qui.
                    self.dispatch.drop_pending();
                    break;
                }
            }
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
                    // La maschera per intero (§10.1): la specie, il prefisso di
                    // topic per i custom, il soggetto. La regola sta nel
                    // contratto (`fub_abi::rules::events`) e non qui, perché
                    // il secondo lettore è la shell — che decide da sé quando
                    // ridisegnare una view dichiarata.
                    if !handler.subscribed().wants(&notice.event) {
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
                        let mut fault = None;
                        if let Some(panico) =
                            crate::safety::reporting(id, "ricevendo un evento", || {
                                fault = handler.handle(notice, &mut host).err();
                            })
                        {
                            fault = Some(panico);
                        }
                        fault
                    });
                    troubles.extend(fault.map(|e| (id.clone(), e)));
                }
                troubles
            },
        );
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
                ws.report_trouble(Severity::Failure, subject, error)
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
    pub(crate) fn enqueue_job(&mut self, plugin: &str, spec: JobSpec) -> JobId {
        let job = spec.job.clone();
        let id = self.dispatch.enqueue_job(plugin, spec);
        self.indexes.core.jobs.accepted(id, &job, plugin);
        self.emit_event(Event::JobStarted { id, job });
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
    pub fn note_job_progress(&mut self, id: JobId, progress: JobProgress) {
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
    /// ([decisione 0032](../../../docs/decisions/0032-il-runner-dei-job.md)), a
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

    fn announce_setting(&mut self, key: &str, scope: SettingScope) {
        let key = key.to_string();
        self.emit_event(Event::SettingChanged { key, scope });
        if !self.dispatch.in_provider_call() {
            self.dispatch_pending();
        }
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
        let righe = self
            .settings
            .read()
            .expect("store di configurazione")
            .entries_by_owner(plugin);
        righe
            .into_iter()
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
        for errore in crate::docdata::migrate(&roots, from, to) {
            self.doc_data_warnings.push(format!(
                "lo stato per-documento di {from} non ha potuto seguire la rinomina \
                 in {to} — {errore}"
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
    fn collect_doc_data(&mut self) -> usize {
        let roots = self.docs.plugin_data_roots();
        if roots.is_empty() {
            return 0;
        }
        let cestinate: std::collections::HashSet<DocId> = self
            .docs
            .list_trash()
            .unwrap_or_default()
            .into_iter()
            .map(|e| e.original)
            .collect();
        let metas = &self.indexes.core.metas;
        crate::docdata::collect(&roots, &|doc: &DocId| {
            metas.contains_key(doc) || cestinate.contains(doc)
        })
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
    pub(crate) fn plugin_data_root(&self, plugin: &str) -> Utf8PathBuf {
        self.docs.plugin_data_root(plugin)
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
}

/// Valida un nome/path che **nomina un documento che esiste** (o che potrebbe
/// esistere): normalizza i separatori `\` → `/`, toglie spazi e slash iniziali, e
/// pretende che ciò che resta stia dentro il vault.
///
/// Il giudizio è del contratto — [`path_policy::check`] con
/// [`Naming::Existing`] — e non più di questa funzione: la stessa regola serve a
/// un indice di terzi e a un guest WASM, che `fub-kernel` non lo hanno
/// (decisione 0020). Qui resta la **tolleranza del varco**: la conversione dei
/// separatori Windows e il trim, che sono di questo ingresso e non della regola.
///
/// È la regola di ogni percorso che trasforma input esterno in un `DocId`:
/// rename, restore, i comandi IPC e il confine delle capacità
/// ([`fenced_doc_id`]). Chi invece fa **nascere** un nome passa da
/// [`new_doc_id`], che è più stretta — e la differenza è il §15.5.
pub fn valid_doc_id(name: &str) -> Result<DocId> {
    let normalizzato = name.replace('\\', "/");
    let pulito = normalizzato.trim().trim_start_matches('/');
    path_policy::check(pulito, Naming::Existing).map_err(|why| KernelError::BadName {
        name: name.to_string(),
        why: why.to_string(),
    })?;
    Ok(DocId::new(pulito))
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
pub fn new_doc_id(name: &str) -> Result<DocId> {
    let id = valid_doc_id(name)?;
    let normalizzato = path_policy::normalized(id.as_str());
    path_policy::check(&normalizzato, Naming::New).map_err(|why| KernelError::BadName {
        name: name.to_string(),
        why: why.to_string(),
    })?;
    Ok(DocId::new(normalizzato))
}

/// Il [`DocId`] con cui un **plugin** può nominare un documento, o
/// `PermissionDenied`.
///
/// È [`valid_doc_id`] applicata sul confine delle capacità: stessa regola dei
/// comandi IPC, altro varco. L'errore è `PermissionDenied` e non `BadArgs`
/// perché è la stessa risposta che `data_*` dà a una risalita — per chi la
/// riceve, i due recinti si comportano allo stesso modo.
pub(crate) fn fenced_doc_id(id: &DocId) -> std::result::Result<DocId, PluginError> {
    valid_doc_id(id.as_str()).map_err(|_| {
        PluginError::PermissionDenied(
            format!("`{id}`: un documento si nomina con un path relativo dentro il vault").into(),
        )
    })
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
pub(crate) fn collect_data_files(root: &Utf8Path, dir: &Utf8Path, out: &mut Vec<String>) {
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

/// Sottomodello con i soli blocchi della sezione di un heading: da esso
/// (incluso) fino al prossimo heading di livello pari o superiore. `heading`
/// matcha per slug o per testo, case-insensitive.
fn section_of(model: &DocumentModel, heading: &str) -> Option<DocumentModel> {
    let want = resolution_key(heading);
    let idx = model
        .outline
        .iter()
        .position(|h| resolution_key(&h.slug) == want || resolution_key(&h.text) == want)?;
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
