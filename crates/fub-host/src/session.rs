//! L'host e le sessioni: chi tiene aperti i vault, e chi li chiude.
//!
//! `Host` è ciò che prima si chiamava `AppState` e viveva nella colla Tauri.
//! La differenza non è il nome: è che le tre cose che rendevano quel tipo
//! inutilizzabile fuori dall'app — il montaggio cablato dentro un comando, il
//! watcher costruito sul posto e il ponte eventi che parlava a un webview —
//! adesso il montaggio sceglie il watcher internamente e il ponte resta un
//! [`EventSink`]. Chi non ha un webview usa [`Host::without_watcher`] e nessun
//! sink, e ottiene lo stesso vault.
//!
//! **Le sessioni sono una mappa** (§9.6,
//! [decisione 0029](../../../docs/decisions/0183-composizione-host-kernel.md)).
//! Erano una `Option<VaultSession>` e aprire un vault chiudeva quello aperto:
//! il vault "corrente" non era una comodità della shell, era un'assunzione del
//! backend, e ogni cosa che avrà due vault davanti — una finestra per vault
//! (4.1), un confronto, un import da un vault all'altro (17), la CLI che ne
//! interroga uno mentre l'app ne tiene un altro — sarebbe passata da qui a
//! riscriverlo. Adesso `Host` tiene `root → VaultSession` e sa qual è il
//! corrente; chi non nomina un vault ottiene il corrente, che è ciò che la shell
//! fa oggi.
//!
//! Ne segue una cosa che prima costava un rimontaggio: **riaprire un vault già
//! aperto non lo riapre**. Prima la sessione vecchia veniva buttata e rifatta —
//! con la scansione, il lock di tantivy da riprendere e il rischio, se
//! l'apertura nuova falliva, di restare senza niente.
//!
//! **Due lock, e fanno due mestieri diversi.** Lo slot delle sessioni è un
//! `Mutex` e lo si tiene per il tempo di un `get` o di un `clone`; il
//! workspace è un [`RwLock`] e lo si tiene per il tempo di una lettura o di una
//! scrittura vera. Il secondo è il §8.3
//! ([decisione 0024](../../../docs/decisions/README.md)),
//! e chi prende quale prestito **non è una convenzione**: da un
//! `RwLockReadGuard` non si chiama `write_document`, perché il `Workspace`
//! prende `&mut self` per scrivere e `&self` per leggere. Il compilatore fa la
//! classificazione, e i presidi in `tests/concorrenza.rs` guardano l'unico
//! errore che gli resta possibile — prendere il prestito esclusivo per una
//! lettura, che compila e rimette tutti in fila in silenzio.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::format::DocumentFormat;
use fub_abi::grid::{GridApplyRequest, GridCommit, GridSurfaceSpec, GridWindowRequest};
use fub_abi::model::DocId;
use fub_abi::rules::path_policy::fenced_doc_id;
use fub_abi::session::ViewContext;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{JobId, JobSpec, ViewInstance, ViewSpec};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::{
    Actor, GridBytesSession, GridBytesWindow, GridCommandOutcome, GridCommandRequest,
    GridCommandState, GridJournal, GridSelection, Notice, PluginError,
};
#[cfg(feature = "versioning")]
use fub_features::{VersionRef, VersionStore, VERSIONING_ID};
use fub_kernel::host::authorize_path;
use fub_kernel::os_trash::{FallbackReason, OsTrashBackend, OsTrashReceipt, TrashVia};
use fub_kernel::same_content::SameContent;
use fub_kernel::{
    Capability, Guard, JournalRead, MachineSettings, MountRegistry, MountRoute, ReadOnly,
    Subscription, SystemLocale, ViewStates, Workspace,
};

use crate::automation::VaultWriterLock;
use crate::config::{config_dir, machine_settings_path, vault_registry_path, view_states_path};
use crate::custody::Custody;
use crate::engines::OpenKey;
use crate::jobs::{
    drain_events, finish_events, run_detached_rebuild_index, with_event_drain, JobHost,
};
use crate::mount::{RootedDisk, VaultStorageSource};
use crate::query::query_workspace;
use crate::records::{UnreadDoc, VaultInfo};
use crate::registry::{
    Bundle, BundleClaim, BundleInfo, BundleRegistry, StartupLease, StartupSnapshot, StartupSource,
};
use crate::runner::{JobRunner, DEFAULT_JOB_THREADS};
use crate::vaults::{VaultEntry, VaultRegistry, VaultRegistryHandle};
use crate::watcher::{OpeningWatcher, RunningWatcher, WatcherFactory};
use fub_abi::traits::HostNetwork;
use fub_kernel::storage::VaultStorage;

mod access;
mod commands;
mod documents;
mod host_commands;
pub(crate) use host_commands::*;
mod opening;
mod resources;
mod settings_access;
mod themes;
mod user_commands;
mod vault_session;
pub use vault_session::*;
mod vaults;

/// Chi monta Fub e tiene aperti i vault.
pub struct Host {
    sessions: Custody<Sessions>,
    /// Unica sequenza di handle: una riapertura non riutilizza identità vecchie.
    resources: Custody<crate::resources::ResourceTable>,
    /// Chi apre il supporto di ogni vault (§15.1): il disco di serie.
    storage: Arc<dyn VaultStorageSource>,
    watcher: Box<dyn WatcherFactory>,
    /// Il filo verso fuori che ogni workspace montato riceve: `ureq` di serie
    /// quando il binario ha `http-client`, nessuno altrimenti.
    network: Option<Arc<dyn HostNetwork>>,
    clock: Arc<dyn fub_kernel::time::Clock>,
    sink: Option<Arc<dyn EventSink>>,
    os_trash: Arc<dyn OsTrashBackend>,
    startup_source: Option<Arc<dyn StartupSource>>,
    /// Sorgente dei provider di formato, interrogata prima del workspace.
    format_source: Option<Arc<dyn crate::FormatSource>>,
    /// **L'avviso di sessione** (§25.5): la diagnosi «la cartella di
    /// configurazione non si può scrivere — o non c'è» composta da
    /// `install_logging` prima che l'host esistesse. Si tiene qui perché
    /// `config.rs` non ha stato e `run()` è una chiamata: questo è il punto più
    /// basso che vive attraverso il buco dell'avvio. Un `Mutex<Option>` e non
    /// un atomico perché la «una volta per sessione» è **strutturale** — la
    /// diagnosi nasce una volta e si consuma una volta con un `take` — e la
    /// forma di `Custodia::denuncia` serve a chi deve rispondere a ogni
    /// chiamata, non a chi risponde alla prima.
    session_notice: Mutex<Option<String>>,
    /// Gli altri avvisi nati prima della shell, in coda dopo la diagnosi del
    /// log: oggi il percorso di disegno della webview che `fub_app::run`
    /// sceglie prima di GTK. Stessa forma di consegna, un tiraggio per volta.
    startup_notices: Mutex<std::collections::VecDeque<Notice>>,
    /// I `fub://` che il sistema ha consegnato e la shell non ha ancora
    /// preso: la coda è della macchina, come l'app che li riceve.
    uris: crate::uri_inbox::UriInbox,
    /// Il **livello macchina** della configurazione (§11.1), condiviso da tutti
    /// i vault che questo host apre: la configurazione della macchina è una, e N
    /// copie sarebbero N idee del tema.
    pub(crate) machine: Arc<MachineSettings>,
    /// Lo **stato di vista** (§11.2): dove ogni esemplare di view era rimasto.
    /// Condiviso come il livello macchina e per la stessa ragione — i vault
    /// aperti sono N e la macchina è una — e potato da chi dimentica un vault
    /// ([`Host::forget_vault`]).
    view_states: Arc<ViewStates>,
    /// Il **registro dei vault** (§11.1): recenti, preferiti, icone. Vive nello
    /// stesso livello, che prima di questa voce non esisteva affatto — ed è la
    /// ragione per cui la 0029 non poteva chiudere questa metà del §9.6.
    /// Il servizio di registro è posseduto dall'host; i percorsi concorrenti
    /// ricevono soltanto [`VaultRegistryHandle`] tramite [`Host::vault_registry`].
    vaults: VaultRegistry,
    /// La cartella di configurazione della macchina (§11.1), se questo host
    /// ne ha una. È la radice di cui [`themes_dir`](crate::config::themes_dir)
    /// è figlia: senza un posto dove scrivere i temi di terzi non esistono
    /// (si installano qui), e il tema di serie basta a sé stesso — la stessa
    /// regola di «perdere il tema è meglio di un'app che non parte».
    config_dir: Option<Utf8PathBuf>,
    /// Quanti thread esegue i job di **ogni** vault aperto (§9.3). Per vault e
    /// non in totale: i pool non si conoscono, come non si conoscono i vault.
    job_threads: usize,
    /// Il **locale di sistema** (§12.3): ciò che la shell riporta della lingua,
    /// del fuso e del calendario. Condiviso come il livello macchina e per la
    /// stessa ragione — la lingua di chi guarda è una, e N copie sarebbero N
    /// idee di che ore sono. Non si apre da un file: non è uno stato che dura,
    /// è ciò che il sistema **è adesso**, e chi lo sa lo ridice a ogni avvio.
    system_locale: Arc<SystemLocale>,
    /// **I livelli del log** (§17.3), condivisi come il livello macchina e per
    /// la stessa ragione: il log è uno per installazione, e N vault aperti
    /// sono N letture della stessa tendina. Il collettore vero — il
    /// `Subscriber` globale — lo installa chi fa partire il processo
    /// (`fub_app::run`), e questo `Arc` è il filo che lega quel collettore al
    /// montaggio, dove le impostazioni gli dicono quanto raccontare.
    levels: Arc<fub_kernel::log::Levels>,
    /// **I lease di scrittura** che questo processo tiene, per radice canonica.
    /// Deboli: li possiedono le sessioni e gli snapshot in corso, e il lock si
    /// rilascia quando l'ultimo di loro lo lascia. Due aperture concorrenti
    /// della stessa radice in questo host condividono lo stesso lease invece
    /// di escludersi a vicenda.
    writers: Mutex<BTreeMap<Utf8PathBuf, std::sync::Weak<VaultWriterLock>>>,
    /// **I disegni aperti nel motore del disegno**, per vault
    /// ([`crate::drawing`]): la chiusura di un vault chiude i suoi.
    pub(crate) drawings: crate::drawing::Drawings,
    /// **La cartella di tema controllata** ([`Host::check_theme_folder`]): il
    /// path che la finestra di scelta nativa ha dato e l'impronta dei byte
    /// letti. È il permesso, che vale una volta, di installarla
    /// ([`Host::install_theme_from_folder`]); la regola, con la sua
    /// generazione, sta in [`crate::theme::ThemeFolderGrant`].
    theme_folder: Mutex<crate::theme::ThemeFolderGrant>,
    /// **Il custode del tema collegato** ([`Host::link_theme_folder`]): la
    /// cartella guardata e il suo osservatore, montato e smontato secondo la
    /// chiave [`crate::settings::DEVELOPER_THEME_FOLDER`] e la modalità
    /// sviluppatore ([`Host::sync_theme_link`]).
    theme_keeper: Arc<crate::theme_watch::ThemeKeeper>,
    /// **Il turno delle chiavi locali** ([`PROFILE_LOCAL_KEYS`]): lo tengono
    /// il cambio e l'azzeramento di un profilo di macchina per tutto il passo
    /// (cambio e ripristino), e i gesti che scrivono la cartella collegata
    /// («Collega una cartella…», «Scollega»). Così un collegamento che arriva
    /// a metà di un cambio di profilo non viene sovrascritto dal ripristino.
    /// Il turno di scrittura della macchina è privato del kernel: questo è il
    /// turno dell'host, attorno a lui.
    local_keys_turn: Mutex<()>,
}

impl Default for Host {
    fn default() -> Self {
        Self::new()
    }
}

/// Dichiara al livello macchina le chiavi del core che gli appartengono (§16.3).
///
/// Passa di qui **ogni** livello macchina che un host adotta — quello in memoria
/// di [`Host::new`] e quello del file di [`Host::with_config_dir`] — perché uno
/// dei due senza schema sarebbe un host in cui `log.level` esiste e non si legge,
/// cioè il difetto di prima in metà dei casi.
///
/// Una dichiarazione che fallisce è un difetto di questo repo e non un caso
/// dell'utente — un doppione fra le chiavi del core, o una chiave di vault
/// arrivata nel filtro — quindi si **panica** invece di degradare in silenzio,
/// che è la stessa scelta di `mount` davanti a un bundle di core malformato.
fn with_the_schema(machine: Arc<MachineSettings>) -> Arc<MachineSettings> {
    machine
        .declare(&crate::settings::core_machine_settings())
        .expect("le chiavi di macchina del core");
    machine
}

/// Esegue la lettura del versioning con una capacità dati posseduta.
///
/// `JobHost` prende il prestito condiviso solo per preparare ogni token di
/// accesso allo spazio dati; il token contiene supporto, namespace e path
/// validati, quindi l'I/O del provider avviene dopo il rilascio del lock.
#[cfg(feature = "versioning")]
fn read_version_with_workspace(
    workspace: Custody<Workspace>,
    store: VersionStore,
    id: &DocId,
    ts: u64,
) -> Result<String, PluginError> {
    let host = JobHost::new(workspace, VERSIONING_ID);
    store.read(id, ts, &host)
}

/// Esegue una mutazione dell'organizzazione dopo avere estratto lo store owned:
/// il sidecar non attraversa mai il prestito di `Custody<Workspace>`.
fn update_organization<R>(
    workspace: &Custody<Workspace>,
    update: impl FnOnce(&fub_kernel::OrganizationStore) -> Result<R, String>,
) -> Result<R, PluginError> {
    let store = {
        let workspace = workspace.read()?;
        workspace.organization_store()
    };
    update(&store).map_err(|error| PluginError::Io(error.into()))
}

/// Salva lo stato di vista dopo avere estratto path e store owned dal workspace.
fn update_view_state(
    workspace: &Custody<Workspace>,
    owner: &str,
    instance: &str,
    key: &str,
    value: Option<serde_json::Value>,
) -> Result<(), PluginError> {
    let (root, states) = {
        let workspace = workspace.read()?;
        (workspace.root().to_string(), workspace.view_states())
    };
    states
        .set(&root, owner, instance, key, value)
        .map_err(|error| PluginError::Io(error.into()))
}

impl Host {
    /// Un host col rilevatore di default e nessun ponte eventi.
    ///
    /// Il rilevatore di default è `notify` se la cargo feature
    /// `notify-watcher` è accesa (lo è), e l'implementazione interna senza
    /// rilevamento altrimenti — cioè su PWA e mobile, dove `notify` non esiste
    /// affatto.
    pub fn new() -> Self {
        #[cfg(feature = "notify-watcher")]
        let watcher: Box<dyn WatcherFactory> = Box::new(crate::watcher::NotifyWatcher);
        #[cfg(not(feature = "notify-watcher"))]
        let watcher: Box<dyn WatcherFactory> = Box::new(crate::watcher::NoWatcher);
        Self {
            sessions: Custody::empty("le sessioni aperte"),
            resources: Custody::empty("le risorse binarie aperte"),
            storage: Arc::new(RootedDisk),
            watcher,
            network: crate::mount::default_network(),
            clock: Arc::new(fub_kernel::time::SystemClock),
            os_trash: Arc::new(fub_kernel::FsStorage),
            sink: None,
            format_source: None,
            startup_source: None,
            session_notice: Mutex::new(None),
            theme_folder: Mutex::new(crate::theme::ThemeFolderGrant::default()),
            theme_keeper: Arc::default(),
            local_keys_turn: Mutex::new(()),
            startup_notices: Mutex::new(std::collections::VecDeque::new()),
            uris: Default::default(),
            machine: with_the_schema(MachineSettings::in_memory()),
            view_states: ViewStates::in_memory(),
            vaults: VaultRegistry::in_memory(),
            config_dir: None,
            job_threads: DEFAULT_JOB_THREADS,
            system_locale: Arc::new(SystemLocale::default()),
            levels: Arc::new(fub_kernel::log::Levels::default()),
            writers: Mutex::new(BTreeMap::new()),
            drawings: crate::drawing::Drawings::default(),
        }
    }

    /// Sostituisce il solo backend OS; il writer interno resta quello del vault.
    pub fn with_os_trash_backend(mut self, backend: Arc<dyn OsTrashBackend>) -> Self {
        self.os_trash = backend;
        self
    }

    /// Sostituisce il supporto su cui ogni vault viene montato (§15.1). Di
    /// serie è il disco ancorato alla radice; un banco passa un supporto in
    /// memoria o uno che fallisce la mossa da studiare, e l'host non ha nessun
    /// altro canale verso il vault: registro dei mount compreso.
    pub fn with_storage(mut self, source: Arc<dyn VaultStorageSource>) -> Self {
        self.storage = source;
        self
    }

    /// Sostituisce il client di rete che ogni workspace montato riceve
    /// (§23.3). Di serie è `ureq` quando il binario ha `http-client`; un banco
    /// passa un client che conta, risponde o rifiuta a comando.
    pub fn with_network(mut self, network: Arc<dyn HostNetwork>) -> Self {
        self.network = Some(network);
        self
    }

    /// Sostituisce l'orologio che ogni workspace montato legge per registro,
    /// cestino, bozze e job. Di serie è quello di sistema; un banco passa un
    /// orologio che avanza a comando.
    pub fn with_clock(mut self, clock: Arc<dyn fub_kernel::time::Clock>) -> Self {
        self.clock = clock;
        self
    }

    /// Il client di rete di questo host, se ne ha uno: è lo stesso che i
    /// workspace montati usano, così chi deve chiedere fuori dal vault — il
    /// visore che salva una risorsa remota — non se ne costruisce un altro.
    pub fn network(&self) -> Option<Arc<dyn HostNetwork>> {
        self.network.clone()
    }

    /// Il locale di sistema condiviso: la shell ci scrive ciò che il sistema
    /// dice ([`Host::publish_locale`]), e ogni vault aperto lo legge.
    pub fn system_locale(&self) -> Arc<SystemLocale> {
        Arc::clone(&self.system_locale)
    }

    /// La shell riporta lingua, fuso e calendario del sistema (§12.3). Rende
    /// `true` se è cambiato qualcosa rispetto all'ultima volta.
    ///
    /// Vale per **tutti** i vault aperti in un colpo solo, ed è il punto: un
    /// `set_active_context` si pubblica per vault perché il contesto è di un
    /// pannello, questo no — la lingua non è di un vault.
    pub fn publish_locale(&self, locale: fub_abi::Locale) -> bool {
        self.system_locale.publish(locale)
    }

    /// L'host di un'**installazione**: legge e scrive la configurazione della
    /// macchina dove il sistema dice ([`config_dir`](crate::config_dir)).
    ///
    /// Un sistema che non sa dire dove sia — nessun `HOME` — lascia l'host in
    /// memoria: perdere il tema è meglio di un'app che non parte.
    pub fn installed() -> Self {
        match config_dir() {
            Some(dir) => Host::new().with_config_dir(dir.as_path()),
            None => Host::new(),
        }
    }

    /// Come [`installed`](Host::installed), su una cartella scelta: è la porta
    /// di chi impacchetta, di chi ne tiene due, e dei test.
    pub fn with_config_dir(mut self, dir: &Utf8Path) -> Self {
        let (machine, warning) = MachineSettings::open(&machine_settings_path(dir));
        if let Some(warning) = warning {
            tracing::warn!(target: "fub.host", "impostazioni della macchina: {warning}");
        }
        let (vaults, warning) = VaultRegistry::open(&vault_registry_path(dir));
        if let Some(warning) = warning {
            tracing::warn!(target: "fub.host", "registro dei vault: {warning}");
        }
        let (view_states, warning) = ViewStates::open(&view_states_path(dir));
        if let Some(warning) = warning {
            tracing::warn!(target: "fub.host", "stato di vista: {warning}");
        }
        self.machine = with_the_schema(machine);
        self.vaults = vaults;
        self.view_states = view_states;
        self.config_dir = Some(dir.to_owned());
        self
    }

    /// Radice scelta per questa istanza, senza ricalcolare ambiente o directory utente.
    pub fn configuration_root(&self) -> Option<&Utf8Path> {
        self.config_dir.as_deref()
    }

    /// Sostituisce i livelli del log. Lo chiama chi ha installato il collettore
    /// — `fub_app::run` — per dare all'host lo stesso `Arc` su cui il
    /// collettore legge, così che il montaggio possa cambiare il livello mentre
    /// l'app gira.
    pub fn with_levels(mut self, levels: Arc<fub_kernel::log::Levels>) -> Self {
        self.levels = levels;
        self
    }

    /// Sostituisce il rilevatore con l'implementazione interna che non osserva
    /// il filesystem: la scorciatoia di [`with_watcher`](Host::with_watcher)
    /// con [`NoWatcher`](crate::NoWatcher), per gli host senza un backend.
    pub fn without_watcher() -> Self {
        Self::new().with_watcher(Box::new(crate::watcher::NoWatcher))
    }

    /// Sostituisce chi avvia il rilevamento delle modifiche esterne su ogni
    /// vault aperto: `notify` di serie, [`NoWatcher`](crate::NoWatcher), o
    /// una fabbrica del banco che consegna i cambiamenti a comando.
    pub fn with_watcher(mut self, watcher: Box<dyn WatcherFactory>) -> Self {
        self.watcher = watcher;
        self
    }
    /// Registers an unclaimed native bundle in the selected vault without
    /// exposing the workspace or registry locks to callers.
    pub fn remember_unclaimed_bundle(
        &self,
        vault: Option<&str>,
        bundle: Arc<dyn Bundle>,
    ) -> Result<(), PluginError> {
        let registry = self.in_session(vault, |session| Ok(session.registry.clone()))?;
        BundleRegistry::remember_guarded(&registry, bundle)
    }

    /// Mounts a native bundle through the host's typed registration boundary.
    pub fn mount_bundle(
        &self,
        vault: Option<&str>,
        bundle: Arc<dyn Bundle>,
    ) -> Result<(), PluginError> {
        let id = bundle.manifest().id;
        self.remember_unclaimed_bundle(vault, bundle)?;
        self.set_plugin_enabled(vault, &id, true).map(|_| ())
    }

    /// Unmounts a previously mounted bundle without exposing custody handles.
    pub fn unmount_bundle(
        &self,
        vault: Option<&str>,
        id: &str,
    ) -> Result<Vec<PluginError>, PluginError> {
        let (workspace, registry, _shutdown) = self.in_session(vault, |session| {
            Ok((
                session.workspace.clone(),
                session.registry.clone(),
                session.runner.shutdown_bundle(id),
            ))
        })?;
        Ok(BundleRegistry::unmount_guarded(&registry, &workspace, id))
    }

    /// Queues a job for a mounted plugin through its typed host port.
    pub fn spawn_job(
        &self,
        vault: Option<&str>,
        plugin: &str,
        job: impl Into<String>,
        payload: serde_json::Value,
    ) -> Result<JobId, PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace.with_host(plugin, |host| {
                host.spawn_job(JobSpec {
                    job: job.into(),
                    payload,
                })
            })
        })
    }
    /// Invokes one plugin job through the runner's normal admission boundary.
    ///
    /// L'handle del runner viene clonato sotto il prestito delle sessioni; il
    /// codice del bundle gira dopo che quel prestito è stato rilasciato.
    pub fn invoke_job(
        &self,
        vault: Option<&str>,
        plugin: &str,
        job: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        let runner = self.with_session(vault, |session| session.runner.invoker())?;
        runner.invoke_job(plugin, job, payload)
    }

    /// Subscribes to events from the selected vault without exposing its bus.
    pub fn subscribe(&self, vault: Option<&str>) -> Result<Subscription, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.bus().subscribe()))
    }

    /// Emits one event through the selected vault's typed event port.
    pub fn emit_event(
        &self,
        vault: Option<&str>,
        event: fub_abi::Event,
    ) -> Result<(), PluginError> {
        self.read_workspace(vault, |workspace| {
            workspace.bus().emit(Notice::of(event));
            Ok(())
        })
    }

    /// IDs of plugins declared by the selected vault.
    pub fn plugin_ids(&self, vault: Option<&str>) -> Result<Vec<String>, PluginError> {
        self.read_workspace(vault, |workspace| {
            Ok(workspace
                .plugins()
                .into_iter()
                .map(|plugin| plugin.id)
                .collect())
        })
    }

    /// Declares a native plugin manifest in the selected vault.
    pub fn declare_plugin(
        &self,
        vault: Option<&str>,
        manifest: fub_abi::traits::PluginManifest,
        trust: fub_kernel::Trust,
    ) -> Result<(), PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace
                .register_plugin(manifest, trust)
                .map_err(|error| PluginError::BadArgs(error.to_string().into()))
        })
    }

    /// Reads the journal snapshot for the selected vault.
    pub fn journal(&self, vault: Option<&str>) -> Result<JournalRead, PluginError> {
        self.read_workspace(vault, |workspace| {
            workspace.journal().map_err(PluginError::from)
        })
    }
    /// Returns the interest declaration for one view instance.
    pub fn view_interests(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
    ) -> Result<fub_abi::traits::ViewInterests, PluginError> {
        let prepared = self.read_workspace(vault, |workspace| {
            workspace.prepare_view_interests(instance)
        })?;
        let outcome = prepared.invoke();
        self.read_workspace(vault, |workspace| {
            workspace.finish_view_interests(prepared, outcome)
        })
    }
    /// Imposta la sorgente runtime interrogata per ogni nuova apertura.
    ///
    /// La sorgente decide quali bundle richiedere; l'host non persiste né
    /// reinterpreta quella decisione.
    pub fn with_startup_source(mut self, source: Arc<dyn StartupSource>) -> Self {
        self.startup_source = Some(source);
        self
    }

    /// Imposta la sorgente dei provider di formato per ogni nuova apertura.
    pub fn with_format_source(mut self, source: Arc<dyn crate::FormatSource>) -> Self {
        self.format_source = Some(source);
        self
    }

    /// Accende il ponte eventi verso `sink`.
    pub fn with_sink(mut self, sink: Arc<dyn EventSink>) -> Self {
        self.sink = Some(sink);
        self
    }

    /// Porta nell'host la diagnosi che il pavimento ha composto prima che
    /// l'host esistesse (`install_logging`). La chiama `fub_app::run`, l'unico
    /// che la riceve da lì; chi costruisce un host per un test non la passa e
    /// non ha nessun avviso da consegnare.
    pub fn with_session_notice(self, warning: Option<String>) -> Self {
        *self
            .session_notice
            .lock()
            .unwrap_or_else(|and| and.into_inner()) = warning;
        self
    }

    /// Mette in coda un avviso nato prima della shell, dopo la diagnosi del
    /// log: [`Self::session_notice`] li consegna uno per chiamata, nell'ordine.
    /// Lo chiama `fub_app::run` con l'esito del percorso di disegno
    /// (`disegno.rs`), che esiste prima di GTK e quindi prima di ogni
    /// ascoltatore.
    pub fn with_startup_notice(self, notice: Notice) -> Self {
        self.startup_notices
            .lock()
            .unwrap_or_else(|and| and.into_inner())
            .push_back(notice);
        self
    }

    /// Quanti thread eseguono i job di ogni vault (§9.3). Zero vale uno: un
    /// vault senza nessuno che drena la coda è ciò che questa decisione esiste
    /// per non lasciare più in giro.
    pub fn with_job_threads(mut self, threads: usize) -> Self {
        self.job_threads = threads.max(1);
        self
    }

    /// Annulla un job di un vault (o del corrente).
    ///
    /// Non c'è un «job sconosciuto»: annullare un job un istante prima che parta
    /// deve valere quanto annullarne uno in volo, e una risposta negativa lo
    /// renderebbe una corsa. L'altro lato — il pulsante — è il §10.3.
    pub fn cancel_job(&self, vault: Option<&str>, id: JobId) -> Result<(), PluginError> {
        self.with_session(vault, |s| s.cancel_job(id))
    }

    /// **Aspetta che l'indicizzazione di un vault abbia finito** (§15.7).
    ///
    /// Torna subito se ha già finito, e torna anche se è stata **interrotta**:
    /// la domanda è «l'apertura ha smesso di lavorare», non «l'indice è
    /// completo» — chi vuole sapere la seconda cosa la chiede a
    /// [`IndexQuery::VaultStatus`](fub_abi::traits::IndexQuery::VaultStatus),
    /// che distingue `Ready` da `Stopped`.
    ///
    /// Esiste per chi **non può** proseguire con una ricerca parziale: i test,
    /// e un uso da riga di comando che apre, indicizza ed esce. L'app non la
    /// chiama — se la chiamasse all'avvio si ricomprerebbe esattamente l'attesa
    /// che questa voce ha tolto.
    pub fn wait_indexed(&self, vault: Option<&str>) -> Result<(), PluginError> {
        let condition = self.with_session(vault, |s| Arc::clone(&s.indexed))?;
        let (done, bell) = &*condition;
        let mut done = done.lock().expect("fine avvelenata");
        while !*done {
            done = bell.wait(done).expect("fine avvelenata");
        }
        Ok(())
    }

    /// [`Self::wait_indexed`] con un tetto: `true` se l'apertura ha smesso di
    /// lavorare entro `timeout`, `false` se sta ancora indicizzando. È per chi
    /// aspetta e intanto deve poter rinunciare: la CLI, che fra un giro e
    /// l'altro guarda se è arrivato un SIGINT.
    pub fn wait_indexed_for(
        &self,
        vault: Option<&str>,
        timeout: std::time::Duration,
    ) -> Result<bool, PluginError> {
        let condition = self.with_session(vault, |s| Arc::clone(&s.indexed))?;
        let (done, bell) = &*condition;
        let done = done.lock().expect("fine avvelenata");
        let (done, _) = bell
            .wait_timeout_while(done, timeout, |done| !*done)
            .expect("fine avvelenata");
        Ok(*done)
    }
}

/// Ciò che la shell sa di un vault appena aperto.
fn info_of(session: &VaultSession) -> Result<VaultInfo, PluginError> {
    let ws = session.workspace.read()?;
    Ok(VaultInfo {
        root: ws.root().to_string(),
        extensions: ws.extensions(),
        plugins: ws.plugins(),
        unread: session.unread.read()?.clone(),
    })
}

/// Risolve il contenitore sibling anche quando la root live è assente dopo una
/// `OldMoved` o una `Published` interrotta.
fn snapshot_recovery_root(root: &Utf8Path) -> Result<Utf8PathBuf, PluginError> {
    let Some(leaf) = root.file_name() else {
        return if root.is_dir() {
            canonical(root)
        } else {
            Err(PluginError::NotFound(
                format!("Root snapshot non valida: {root}").into(),
            ))
        };
    };
    let parent = root
        .parent()
        .filter(|parent| !parent.as_str().is_empty())
        .unwrap_or(Utf8Path::new("."));
    match std::fs::metadata(parent.as_std_path()) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => {
            return Err(PluginError::NotFound(
                format!("Parent snapshot non valida: {parent}").into(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(PluginError::NotFound(
                format!("Parent snapshot non trovata: {parent}").into(),
            ));
        }
        Err(error) => {
            return Err(PluginError::Io(
                format!("non riesco a leggere {parent}: {error}").into(),
            ));
        }
    }
    let parent = canonical(parent)?;
    Ok(parent.join(leaf))
}

/// La forma **canonica** di una radice: è la chiave delle sessioni, e si conia
/// **all'apertura**.
///
/// Senza, `/vault` e `/vault/` — o un link simbolico e la sua destinazione —
/// sarebbero due sessioni sullo stesso vault, e la seconda si fermerebbe sul
/// lock che l'indice della prima tiene sulla propria cartella. Un path che non
/// si canonicalizza (non esiste, o non è leggibile) è un errore qui, dove si può
/// ancora dire quale.
///
/// **Chi la chiama diretta è chi conia**: [`Host::open`], che una cartella l'ha
/// già pretesa una riga sopra. Chi *usa* una radice coniata passa da
/// [`Host::key`] e chi la dimentica da [`root_forms`], e in nessuno
/// dei due casi si torna a chiedere al disco una risposta che si ha già.
fn canonical(root: &Utf8Path) -> Result<Utf8PathBuf, PluginError> {
    let canonical = root
        .canonicalize()
        .map_err(|and| PluginError::Io(format!("non riesco a risolvere {root}: {and}").into()))?;
    Utf8PathBuf::from_path_buf(canonical)
        .map_err(|p| PluginError::Io(format!("path non UTF-8: {}", p.display()).into()))
}

/// **I nomi di una stessa radice**: quello dato, e la forma canonica se il path
/// esiste ancora — in quest'ordine, senza ripetizioni.
///
/// È [`canonical`] per chi non può fallire. Canonicalizzare è l'operazione che
/// rende `/vault`, `/vault/` e un link simbolico *la stessa* chiave, ma è anche
/// una domanda al filesystem, e su una cartella sparita non ha risposta. Chi
/// apre può quindi pretendere la canonica; chi dimentica no, e deve accettare
/// che la stessa radice sia nominabile in due modi.
///
/// Non è [`Host::key`], che risponde alla terza domanda: chi **usa** un
/// vault deve arrivare a *una* chiave o dire perché no, e ci arriva guardando
/// quelle che già conosce invece di cancellare per ogni nome possibile.
fn root_forms(root: &Utf8Path) -> Vec<Utf8PathBuf> {
    let mut forms = vec![root.to_owned()];
    if let Ok(canonical) = canonical(root) {
        if canonical != forms[0] {
            forms.push(canonical);
        }
    }
    forms
}

/// [`DocId`] da input non fidato: la stessa validazione del kernel
/// (`fub_kernel::valid_doc_id`), applicata sul confine — nessun chiamante
/// costruisce un `DocId` non sanitizzato da ciò che arriva da fuori.
///
/// Sta qui e non nella colla Tauri perché il webview non è l'unico "fuori": la
/// CLI riceve argomenti, l'API locale riceve path, e una seconda copia di
/// questa riga sarebbe una seconda idea di cosa sia un id accettabile.
pub fn doc_id(raw: &str) -> Result<DocId, PluginError> {
    fub_kernel::valid_doc_id(raw).map_err(PluginError::from)
}

/// Che cosa la shell tiene come testo di un documento: il sorgente che la
/// porta di scrittura riceve, o il giornale delle celle di una cartella di
/// Excel, i cui byte restano all'host (ADR 0216). Dopo un salvataggio il testo
/// pulito di un giornale è vuoto: le sue voci sono nei byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentText {
    Source,
    GridJournal,
}

/// Il testo di un documento del formato `format`, come lo legge
/// [`Host::read_document_with_format`].
pub fn document_text(format: Option<&DocumentFormat>) -> DocumentText {
    if crate::workbook::is_workbook(format) {
        DocumentText::GridJournal
    } else {
        DocumentText::Source
    }
}

/// Le chiavi di macchina che **non viaggiano coi profili**: non entrano da
/// un'importazione o da una copia, non escono da un'esportazione, e cambiare
/// o azzerare un profilo lascia il loro valore. Sono le chiavi che solo un
/// gesto dell'host scrive: la cartella del tema collegato, che sceglie la
/// finestra nativa di «Collega una cartella…». Un profilo arrivato da fuori
/// (anche da una webview che non regge) non le scrive mai.
const PROFILE_LOCAL_KEYS: &[&str] = &[crate::settings::DEVELOPER_THEME_FOLDER];

/// Il profilo `json` senza [`PROFILE_LOCAL_KEYS`] fra i valori, e col nome
/// `rename` se c'è. Si legge con la forma del kernel
/// ([`fub_kernel::settings::SettingsProfile`]), quindi un JSON che non è un
/// profilo, o con una chiave doppia, si rifiuta come prima.
fn without_local_keys(json: &str, rename: Option<&str>) -> Result<String, String> {
    let mut profile: fub_kernel::settings::SettingsProfile =
        serde_json::from_str(json).map_err(|e| e.to_string())?;
    if let Some(name) = rename {
        profile.name = name.into();
    }
    for key in PROFILE_LOCAL_KEYS {
        profile.values.remove(*key);
    }
    serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())
}

/// Il valore scritto di `key` nel livello macchina, `None` se vale il default.
fn explicit_value(machine: &MachineSettings, key: &str) -> Option<fub_abi::settings::SettingValue> {
    match machine.effective(key) {
        Ok((value, source)) if source != fub_abi::settings::SettingSource::Default => Some(value),
        _ => None,
    }
}

/// La cartella collegata, se la modalità sviluppatore è accesa e la chiave ne
/// nomina una.
fn linked_folder(machine: &MachineSettings) -> Option<camino::Utf8PathBuf> {
    let on = matches!(
        machine.effective(crate::settings::DEVELOPER_MODE),
        Ok((fub_abi::settings::SettingValue::Toggle(true), _))
    );
    if !on {
        return None;
    }
    match machine.effective(crate::settings::DEVELOPER_THEME_FOLDER) {
        Ok((fub_abi::settings::SettingValue::Text(folder), _)) if !folder.trim().is_empty() => {
            Some(camino::Utf8PathBuf::from(folder))
        }
        _ => None,
    }
}

#[cfg(test)]
mod opening_publication_tests;

#[cfg(test)]
mod side_data_lock_tests;

#[cfg(test)]
mod vanished_session_key_tests;

#[cfg(all(test, feature = "versioning"))]
mod tests;

#[cfg(test)]
mod independent_service_lock_tests;

#[cfg(test)]
mod os_trash_command_tests;

#[cfg(test)]
mod mount_command_tests;

#[cfg(test)]
mod folder_create_command_tests;

#[cfg(test)]
mod snapshot_command_tests;

#[cfg(test)]
mod command_titles_tests;

#[cfg(test)]
mod user_value_refusal_tests;
