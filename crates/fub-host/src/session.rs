//! L'host e le sessioni: chi tiene aperti i vault, e chi li chiude.
//!
//! `Host` è ciò che prima si chiamava `AppState` e viveva nella colla Tauri.
//! La differenza non è il nome: è che le tre cose che rendevano quel tipo
//! inutilizzabile fuori dall'app — il montaggio cablato dentro un comando, il
//! watcher costruito sul posto e il ponte eventi che parlava a un webview —
//! adesso sono [`mount`](crate::mount()), un [`WatcherFactory`] e un
//! [`EventSink`]. Chi non ha un webview passa un `NoWatcher` e nessun sink, e
//! ottiene lo stesso vault.
//!
//! **Le sessioni sono una mappa** (§9.6,
//! [decisione 0029](../../../docs/decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)).
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
//! ([decisione 0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)),
//! e chi prende quale prestito **non è una convenzione**: da un
//! `RwLockReadGuard` non si chiama `write_document`, perché il `Workspace`
//! prende `&mut self` per scrivere e `&self` per leggere. Il compilatore fa la
//! classificazione, e i presidi in `tests/concorrenza.rs` guardano l'unico
//! errore che gli resta possibile — prendere il prestito esclusivo per una
//! lettura, che compila e rimette tutti in fila in silenzio.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::traits::JobId;
use fub_abi::{Notice, PluginError};
#[cfg(feature = "versioning")]
use fub_features::{VersionRef, VersionStore, VERSIONING_ID};
use fub_kernel::{MachineSettings, SystemLocale, ViewStates, Workspace};

use crate::config::{config_dir, machine_settings_path, vault_registry_path, view_states_path};
use crate::mount::mount;
use crate::records::{UnreadDoc, VaultInfo};
use crate::registry::{BundleInfo, BundleRegistry};
use crate::runner::{JobRunner, DEFAULT_JOB_THREADS};
use crate::vaults::{VaultEntry, VaultRegistry};
use crate::watcher::{VaultWatcher, WatcherFactory};

/// Dove finiscono gli eventi del kernel una volta usciti dall'host.
///
/// Il kernel ha già un bus e chiunque può abbonarsi: questo trait esiste perché
/// il ponte va **acceso nel momento giusto** — dopo la scansione iniziale e
/// prima che il watcher possa emettere il primo evento — e quel momento lo
/// conosce solo chi apre. Lasciarlo al chiamante voleva dire lasciargli una
/// finestra in cui gli eventi si perdono.
///
/// Per l'app è il webview (`fub://event`); per un'API locale sarebbero SSE o
/// websocket; per una CLI stdout; per un e2e headless, niente — e "niente" qui
/// si dice non passando nessun sink, non passandone uno che butta via, così il
/// thread del ponte non nasce nemmeno.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, notice: &Notice);
}

/// Sessione di un vault aperto: il workspace condiviso, la metà leggibile del
/// versioning, e il rilevatore tenuto vivo.
pub struct VaultSession {
    /// La radice, **canonica**: è la chiave con cui questa sessione si trova, e
    /// due nomi diversi dello stesso vault non devono essere due sessioni — la
    /// seconda troverebbe il lock dell'indice della prima.
    root: Utf8PathBuf,
    /// Il workspace, dietro il lock che distingue chi legge da chi scrive.
    ///
    /// Era un `Mutex`, ed è la §8.3. Il cambio non ha voluto niente — il
    /// `Workspace` era già `Sync`, perché i trait di provider dell'ABI sono
    /// `Send + Sync` — e ha comprato due cose, di cui la seconda non era
    /// prevista: N view che si ridisegnano insieme (da 7 a 25 volte più
    /// veloci), e soprattutto **chi salva che non viene più affamato**. Sotto
    /// il `Mutex` i lettori in ciclo stretto scavalcavano chi aspettava di
    /// scrivere, senza nessun limite: 6,4 secondi di attesa misurati per un
    /// salvataggio, contro 0,12 ms adesso. Il banco è `examples/contesa.rs`.
    workspace: Arc<RwLock<Workspace>>,
    /// **Chi possiede i bundle** di questo vault (§9.3): i plugin montati, in
    /// ordine di montaggio. Vive quanto la sessione perché è chi chiama
    /// `Plugin::deactivate` quando si chiude — il kernel quei plugin non li ha
    /// mai avuti.
    ///
    /// Condiviso col runner, che da qui prende il **corpo** di un job. Il lock
    /// lo si tiene per il tempo di una `body`, mai per la durata di un job: chi
    /// chiude deve poterci passare mentre un export cammina il vault.
    registry: Arc<Mutex<BundleRegistry>>,
    /// **Cosa questa apertura non ha letto** (§15.7): l'esito dell'apertura,
    /// tenuto per la vita della sessione.
    ///
    /// Sta qui e non lo si ricalcola perché è un fatto **di questa apertura**:
    /// riaprire lo stesso vault non lo rimonta, quindi chi chiede l'informazione
    /// dopo deve ricevere quella di quando il vault è stato scandito, non un
    /// silenzio che sembrerebbe dire «adesso è tutto a posto».
    ///
    /// È **condiviso e mutabile** da quando l'apertura è a fasi: chi apre non
    /// aspetta più di aver letto, quindi al ritorno di `open` questa lista è
    /// necessariamente vuota e si riempie mentre l'indicizzazione cammina. Il
    /// campo non dice più «cosa non si è letto» ma «cosa non si è letto
    /// **finora**», e le due frasi coincidono solo da `IndexUpdated` in poi.
    unread: Arc<Mutex<Vec<UnreadDoc>>>,
    /// **Quando l'indicizzazione di questa apertura ha finito** (§15.7): la
    /// condizione su cui aspetta chi non può proseguire con una ricerca
    /// parziale — un test, e la CLI che indicizza ed esce.
    ///
    /// L'app non la usa e non deve: il verso giusto per lei è disegnare subito
    /// e aggiornare, che è tutto ciò per cui l'apertura è a fasi.
    indicizzato: Arc<(Mutex<bool>, std::sync::Condvar)>,
    /// **Chi esegue il lavoro lungo** (§9.3): il pool che drena la coda dei job.
    /// Va fermato **prima** di chiudere, ed è il gemello del watcher — quello
    /// smette di guardare, questo smette di lavorare.
    runner: JobRunner,
    /// Copia dello store delle versioni, se il versioning è acceso. L'altra
    /// vive dentro l'handler registrato nel workspace: il kernel non sa che il
    /// versioning esiste, ed è l'host a comporre le due metà.
    #[cfg(feature = "versioning")]
    versions: Option<VersionStore>,
    /// Va tenuto in vita, e **lasciato andare per primo**: quando smette di
    /// guardare, il vault non cambia più da sotto a chi lo sta chiudendo.
    watcher: Box<dyn VaultWatcher>,
}

impl VaultSession {
    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    pub fn workspace(&self) -> &Arc<RwLock<Workspace>> {
        &self.workspace
    }

    /// Chi possiede i bundle di questo vault (§9.3): serve a chi ne monta uno a
    /// mano — un test, e a M5 il caricatore che installa un plugin a vault già
    /// aperto.
    pub fn bundles(&self) -> &Arc<Mutex<BundleRegistry>> {
        &self.registry
    }

    #[cfg(feature = "versioning")]
    pub fn versions(&self) -> Option<&VersionStore> {
        self.versions.as_ref()
    }

    /// Questo vault ha il rilevamento delle modifiche esterne? (§9.7)
    pub fn is_watching(&self) -> bool {
        self.watcher.is_watching()
    }

    /// Chiude la sessione: **prima smette di guardare**, poi chiude il vault.
    ///
    /// L'ordine è il punto. Il watcher entra nel workspace da un thread suo:
    /// lasciarlo vivo durante la chiusura vorrebbe dire poter ricevere una
    /// sincronizzazione e un `flush_indexes` *dopo* che gli indici sono stati
    /// chiusi — cioè scrivere in un vault che si sta chiudendo, che è la
    /// versione a due thread del problema che questa funzione risolve.
    ///
    /// La chiusura passa dal registry e non dal workspace, ed è l'unica
    /// differenza col §9.5: l'ordine resta quello di [`Workspace::close`] —
    /// l'evento mentre tutti sono vivi, il flush, poi ognuno che smette a
    /// rovescio — con `Plugin::deactivate` di ogni bundle infilato al proprio
    /// posto (§9.3).
    ///
    /// Gli errori tornano a chi chiude: la chiusura non si interrompe per uno di
    /// loro ([`Workspace::close`]), e chi ha un canale per dirli li mostra.
    pub fn close(self) -> Vec<PluginError> {
        let VaultSession {
            workspace,
            watcher,
            registry,
            mut runner,
            ..
        } = self;
        // 1. smette di guardare, 2. smette di lavorare, 3. si chiude. I primi
        // due sono la stessa regola letta due volte: nessun altro thread deve
        // poter entrare nel vault mentre lo si chiude.
        drop(watcher);
        let mut errors = runner.stop();
        drop(runner);
        let mut ws = workspace.write().expect("workspace avvelenato");
        errors.extend(registry.lock().expect("registry avvelenato").close(&mut ws));
        errors
    }

    /// **Annulla** un job in volo (o che deve ancora partire): alzare la sua
    /// bandiera è tutto ciò che vuol dire, e alla capacità successiva il suo host
    /// gli dice di no.
    pub fn cancel_job(&self, id: JobId) {
        self.runner.cancel(id);
    }
}

/// I vault aperti, e quale è quello corrente.
#[derive(Default)]
struct Sessions {
    open: BTreeMap<Utf8PathBuf, VaultSession>,
    /// Il vault "corrente" è **della shell**: serve a chi non ne nomina uno, e
    /// non è un'assunzione del backend. Chi chiude il corrente ne lascia un
    /// altro corrente se ce n'è, e nessuno se non ce n'è.
    current: Option<Utf8PathBuf>,
}

/// Chi monta Fub e tiene aperti i vault.
pub struct Host {
    sessions: Mutex<Sessions>,
    watcher: Box<dyn WatcherFactory>,
    sink: Option<Arc<dyn EventSink>>,
    /// Il **livello macchina** della configurazione (§11.1), condiviso da tutti
    /// i vault che questo host apre: la configurazione della macchina è una, e N
    /// copie sarebbero N idee del tema.
    machine: Arc<MachineSettings>,
    /// Lo **stato di vista** (§11.2): dove ogni esemplare di view era rimasto.
    /// Condiviso come il livello macchina e per la stessa ragione — i vault
    /// aperti sono N e la macchina è una — e potato da chi dimentica un vault
    /// ([`Host::forget_vault`]).
    view_states: Arc<ViewStates>,
    /// Il **registro dei vault** (§11.1): recenti, preferiti, icone. Vive nello
    /// stesso livello, che prima di questa voce non esisteva affatto — ed è la
    /// ragione per cui la 0029 non poteva chiudere questa metà del §9.6.
    vaults: VaultRegistry,
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
}

impl Default for Host {
    fn default() -> Self {
        Self::new()
    }
}

impl Host {
    /// Un host col rilevatore di default e nessun ponte eventi.
    ///
    /// Il rilevatore di default è `notify` se la cargo feature
    /// `notify-watcher` è accesa (lo è), e [`NoWatcher`](crate::NoWatcher)
    /// altrimenti — cioè su PWA e mobile, dove `notify` non esiste affatto.
    pub fn new() -> Self {
        #[cfg(feature = "notify-watcher")]
        let watcher: Box<dyn WatcherFactory> = Box::new(crate::watcher::NotifyWatcher);
        #[cfg(not(feature = "notify-watcher"))]
        let watcher: Box<dyn WatcherFactory> = Box::new(crate::watcher::NoWatcher);
        Self {
            sessions: Mutex::new(Sessions::default()),
            watcher,
            sink: None,
            // **In memoria di default**, come `Workspace::new`, e per la stessa
            // ragione: chi non ha un'installazione — un test, un e2e headless —
            // non deve scrivere nella cartella di configurazione di chi lo
            // esegue. Un'app vera chiama `installed()` o `with_config_dir`, e se
            // se ne dimentica il difetto si vede subito (il tema non sopravvive
            // alla chiusura) invece che mai.
            machine: MachineSettings::in_memory(),
            view_states: ViewStates::in_memory(),
            vaults: VaultRegistry::in_memory(),
            job_threads: DEFAULT_JOB_THREADS,
            system_locale: Arc::new(SystemLocale::default()),
            levels: Arc::new(fub_kernel::log::Levels::default()),
        }
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
        self.machine = machine;
        self.vaults = vaults;
        self.view_states = view_states;
        self
    }

    /// Sostituisce i livelli del log. Lo chiama chi ha installato il collettore
    /// — `fub_app::run` — per dare all'host lo stesso `Arc` su cui il
    /// collettore legge, così che il montaggio possa cambiare il livello mentre
    /// l'app gira.
    pub fn with_levels(mut self, levels: Arc<fub_kernel::log::Levels>) -> Self {
        self.levels = levels;
        self
    }

    /// Sostituisce il rilevatore. Un e2e headless passa `NoWatcher`.
    pub fn with_watcher(mut self, watcher: Box<dyn WatcherFactory>) -> Self {
        self.watcher = watcher;
        self
    }

    /// Accende il ponte eventi verso `sink`.
    pub fn with_sink(mut self, sink: Arc<dyn EventSink>) -> Self {
        self.sink = Some(sink);
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
        let condizione = self.with_session(vault, |s| Arc::clone(&s.indicizzato))?;
        let (fatto, campana) = &*condizione;
        let mut fatto = fatto.lock().expect("fine avvelenata");
        while !*fatto {
            fatto = campana.wait(fatto).expect("fine avvelenata");
        }
        Ok(())
    }

    /// Apre un vault — monta, scansiona, accende il ponte, avvia il rilevatore —
    /// e lo rende **corrente**.
    ///
    /// Un vault **già aperto** non si riapre: diventa corrente e basta. Prima
    /// riaprirlo voleva dire buttare la sessione e rifarla, con la scansione da
    /// ripagare e il lock dell'indice da riprendere — e se la seconda apertura
    /// falliva non si tornava alla prima. Succedeva riaprendo lo stesso vault
    /// dal dialogo, e in sviluppo a ogni ricarica della pagina.
    pub fn open(&self, root: &Utf8Path) -> Result<VaultInfo, PluginError> {
        if !root.is_dir() {
            // `NotFound` e non `BadArgs`: chi arriva qui ha scelto una cartella
            // da un dialogo, o ha riaperto un recente. Non ha sbagliato a
            // scrivere — quella cartella non c'è (più).
            return Err(PluginError::NotFound(
                format!("Non è una cartella valida: {root}").into(),
            ));
        }
        let root = canonical(root)?;

        {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(session) = sessions.open.get(&root) {
                let info = info_of(session);
                sessions.current = Some(root);
                return Ok(info);
            }
        }

        let crate::mount::Mounted {
            workspace: mut ws,
            registry,
            #[cfg(feature = "versioning")]
            versions,
        } = mount(
            &root,
            Arc::clone(&self.machine),
            Arc::clone(&self.view_states),
            Arc::clone(&self.system_locale),
            &self.levels,
        )
        // Le due cose che fanno fallire il montaggio sono un provider di formato
        // in conflitto con sé stesso e il bundle di core che non si monta: è
        // ciò che questo binario si porta dietro, non il disco di chi apre.
        .map_err(|e| PluginError::Internal(e.into()))?;
        let registry = Arc::new(Mutex::new(registry));

        // **La prima fase, e solo quella** (§15.7): si guarda cosa c'è, e da
        // qui il vault è utilizzabile. Il `?` che resta riguarda il vault
        // intero — la scansione — e non i suoi documenti: quelli che non si
        // leggono diventano scarti, e li raccoglie la seconda fase.
        //
        // Ciò che questa riga **non** fa più è leggere, parsare e indicizzare:
        // è il lavoro che teneva `open` — e con lei l'intera app all'avvio —
        // ferma per tutto il tempo di camminare il vault.
        let work = ws.scan_vault().map_err(PluginError::from)?;

        // Ponte eventi kernel → sink (thread dedicato che vive quanto il bus).
        //
        // Acceso **dopo** la scansione: gli eventi che `reindex` emette sono il
        // vault che si popola, non il vault che cambia, e la shell li leggerebbe
        // come un temporale di modifiche. Il freno e il raggruppamento stanno
        // dentro il ponte (§10.2, [`crate::bridge`]) e non qui: questa riga
        // decide *quando* accendere, quella *cosa passa*.
        if let Some(sink) = &self.sink {
            crate::bridge::spawn(ws.bus().subscribe(), sink.clone());
        }

        // **La seconda fase nasce dopo il ponte**, e l'ordine è la sostanza:
        // `begin_index_job` emette un `JobStarted`, cioè la prima riga del
        // racconto dell'apertura. Nascendo prima, quella riga sarebbe finita
        // nello stesso silenzio della scansione — e la shell avrebbe visto un
        // lavoro progredire e finire senza averlo mai visto cominciare.
        let index_job = ws.begin_index_job();
        let unread: Arc<Mutex<Vec<UnreadDoc>>> = Arc::new(Mutex::new(Vec::new()));
        let indicizzato = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let in_corso = crate::runner::InCorso {
            id: index_job,
            totale: work.totale(),
            work,
            unread: Arc::clone(&unread),
            fine: Arc::clone(&indicizzato),
        };

        let workspace = Arc::new(RwLock::new(ws));
        // La bandiera del rilevamento è **del kernel** e la tiene chi guarda
        // (§9.7): così `Host::is_watching` e `IndexQuery::VaultStatus`
        // rispondono dallo stesso bit, e non da due idee di com'è andata.
        let watching = workspace.read().expect("workspace avvelenato").watch_flag();
        // La fabbrica del watcher resta a `String`: è una cucitura interna
        // dell'host — chi la sostituisce sostituisce un modo di guardare una
        // cartella, non parla col contratto — e il suo unico fallimento è il
        // sistema che non concede di guardare. Si nomina qui, una volta.
        let watcher = self
            .watcher
            .start(&root, workspace.clone(), watching)
            .map_err(|e| PluginError::Io(e.into()))?;

        // Il pool parte **dopo** la scansione e dopo il ponte eventi: i job che
        // la scansione ha fatto accodare sono già in coda, e il primo giro del
        // pool li trova lì — drenare prima di aspettare è ciò che rende il
        // campanello sufficiente. Dopo il ponte anche per un'altra ragione, che
        // prima non c'era: il progresso dell'indicizzazione è un evento, e
        // accendere il ponte dopo averla avviata vorrebbe dire perdere le prime
        // fette proprio del lavoro che questa voce esiste per mostrare.
        //
        // E riceve la **seconda fase dell'apertura** insieme ai propri thread:
        // da questa riga in poi il vault si indicizza da sé, con un progresso e
        // un pulsante per fermarlo.
        let runner = JobRunner::start(
            workspace.clone(),
            registry.clone(),
            self.job_threads,
            Some(in_corso),
        );

        let session = VaultSession {
            root: root.clone(),
            workspace,
            registry,
            unread,
            indicizzato,
            runner,
            #[cfg(feature = "versioning")]
            versions,
            watcher,
        };

        // **Chi arriva secondo lascia cadere ciò che ha montato.** Il controllo
        // in cima non basta: fra lì e qui il lock delle sessioni è libero — deve
        // esserlo, o montare un vault fermerebbe ogni altro comando per tutta la
        // scansione — quindi due aperture concorrenti sulla stessa radice ci
        // arrivano entrambe. Inserire e basta vorrebbe dire che una delle due
        // sessioni sparisce dalla mappa **senza essere chiusa**: indici mai
        // messi al sicuro, `Plugin::deactivate` mai chiamato, e il rilevatore
        // dell'altra ancora vivo su un vault che nessuno guarda più.
        //
        // Quello che questo **non** ripara, ed è nominato: le due aperture hanno
        // già montato entrambe, e il lock del writer di tantivy lo prende una
        // sola: se lo prende la perdente, la sessione che resta è quella senza
        // ricerca — un avviso, non un errore («indice di ricerca non
        // disponibile»). Chiudere la perdente rilascia quel lock, ma non lo
        // ridà alla vincente. Toglierlo davvero vuol dire non far montare due
        // volte, cioè una porta d'ingresso che serializza le aperture sulla
        // stessa radice, ed è una decisione che va a verbale — la metà del
        // §15.7 che resta aperta, cioè la **forma** dell'apertura: la 0068 le
        // ha tolto il tutto-o-niente, non la sincronia.
        let (info, perdente) = {
            let mut sessions = self.sessions.lock().unwrap();
            let perdente = if sessions.open.contains_key(&root) {
                // Ha vinto l'altro: la sessione buona è la sua — riaprire un
                // vault già aperto non lo riapre, e vale anche quando il
                // "già" è di un istante fa.
                Some(session)
            } else {
                sessions.open.insert(root.clone(), session);
                None
            };
            let vinta = sessions.open.get(&root).expect("appena inserita, o già lì");
            let info = info_of(vinta);
            sessions.current = Some(root.clone());
            (info, perdente)
        };
        // Chiudere sta **fuori** dal lock delle sessioni, per la stessa ragione
        // di [`close_vault`](Host::close_vault): chiudere chiama i provider.
        if let Some(perdente) = perdente {
            perdente.close();
        }
        // Il vault entra fra i conosciuti (§11.1). Va **dopo** l'apertura
        // riuscita, e non prima: un path che non si apre non è un vault
        // recente, è un errore — e un elenco di recenti pieno di cartelle che
        // non aprono è peggio di un elenco vuoto. Un registro che non riesce a
        // scriversi non fa fallire l'apertura: è una comodità, non il vault.
        if let Err(e) = self
            .vaults
            .note_opened(&root, fub_kernel::time::now_unix_millis())
        {
            // Solo log: il registro dei recenti è una comodità, non il vault,
            // e non scriversi non perde un dato dell'utente — perde al più un
            // path nell'elenco di chi è stato aperto. Pavimento e basta (0062).
            tracing::warn!(target: "fub.host", "registro dei vault: {e}");
        }
        Ok(info)
    }

    // --- il registro dei vault (§11.1) -------------------------------------
    //
    // Ciò che questa macchina **conosce**, che è un'altra cosa da ciò che è
    // aperto adesso (`vaults()`): il secondo muore col processo, il primo è la
    // memoria fra un avvio e l'altro.

    /// I vault conosciuti: prima i preferiti, poi i recenti.
    pub fn known_vaults(&self) -> Vec<VaultEntry> {
        self.vaults.list()
    }

    /// Appunta (o spunta) un vault. Il path **non** deve essere aperto: si
    /// preferisce un vault anche quando è chiuso, ed è quasi sempre allora.
    pub fn set_vault_favorite(&self, root: &Utf8Path, favorite: bool) -> Result<(), PluginError> {
        self.vaults.set_favorite(&canonical(root)?, favorite)
    }

    /// L'icona e il nome con cui un vault compare nell'elenco.
    pub fn set_vault_look(
        &self,
        root: &Utf8Path,
        icon: Option<String>,
        name: Option<String>,
    ) -> Result<(), PluginError> {
        self.vaults.set_look(&canonical(root)?, icon, name)
    }

    /// Toglie un vault dall'elenco. **Non lo cancella dal disco**: dimenticare
    /// una scorciatoia non è distruggere ciò a cui punta.
    ///
    /// Non *pretende* di canonicalizzare: si dimentica anche una cartella che
    /// non esiste più, che è il caso più comune per cui lo si fa, e su un path
    /// che non esiste `canonicalize` non risponde. Ma non può nemmeno ignorare
    /// la forma canonica, perché è **quella** la chiave con cui l'apertura ha
    /// scritto la voce ([`canonical`]): dimenticare la sola forma data lascerebbe
    /// in elenco ogni vault nominato in un modo diverso da come è stato aperto —
    /// e su macOS o Windows, dove la canonica differisce quasi sempre dal path
    /// che l'utente sceglie (`/var` → `/private/var`, il prefisso UNC), sarebbe
    /// *ogni* vault. Quindi si dimenticano entrambe le forme.
    ///
    /// **Dimentica anche come lo si stava guardando** (§11.2): senza questa riga
    /// il file dello stato di vista sarebbe l'unico posto del progetto che cresce
    /// e non cala mai, e riaprendo fra un anno un vault dimenticato le cartelle
    /// sarebbero ancora aperte com'erano. Il registro per primo, perché è lui che
    /// l'utente vede: se la potatura fallisce dopo, resta un residuo in un file
    /// di cache — e lo si dice — invece di uno scroll perso per un vault che è
    /// rimasto in elenco.
    pub fn forget_vault(&self, root: &Utf8Path) -> Result<(), PluginError> {
        let forme = forme_della_radice(root);
        self.vaults.forget(&forme)?;
        // Il sidecar dello stato di vista ha un fallimento solo — scriverlo —
        // e chi lo riceve non ha altro da fare che riprovare. Una forma che non
        // è là dentro non costa una scrittura: `forget_vault` esce prima.
        for forma in &forme {
            self.view_states
                .forget_vault(forma.as_str())
                .map_err(|e| PluginError::Io(e.into()))?;
        }
        Ok(())
    }

    // --- accendere e spegnere un componente (§11.1) -------------------------

    /// Chi questo host sa montare, e chi è acceso in questo vault.
    pub fn bundles(&self, vault: Option<&str>) -> Result<Vec<BundleInfo>, PluginError> {
        self.with_session(vault, |s| {
            s.registry.lock().expect("registry avvelenato").inventory()
        })
    }

    /// **Accende o spegne un componente**, adesso e per i prossimi avvii.
    ///
    /// Due cose, e nessuna delle due basta da sola: il montaggio (o lo
    /// smontaggio) *adesso* — che è `BundleRegistry`, ed è host-side per
    /// costruzione ([decisione 0031](../../../docs/decisions/0031-chi-possiede-i-bundle.md):
    /// l'`HostApi` non ha capacità di registrazione, quindi un plugin non può
    /// montarsi da sé — e la riga scritta in `plugins.disabled`, che è ciò che
    /// mancava al §11.1: «dove stare scritto fra un avvio e l'altro».
    ///
    /// Passa da qui e non da un comando del registro per la stessa ragione:
    /// un comando gira dentro il kernel con un `HostApi`, e da lì il registry
    /// dei bundle non si vede nemmeno. Ed è anche giusto che sia così — chi
    /// accende e spegne un componente è **l'utente**, non un programma, e questa
    /// è la porta da cui passa l'utente (`plugins.disabled` non si è dichiarata
    /// scrivibile da un programma, apposta).
    pub fn set_plugin_enabled(
        &self,
        vault: Option<&str>,
        id: &str,
        enabled: bool,
    ) -> Result<Vec<String>, PluginError> {
        if id == crate::settings::CORE_ID {
            return Err(PluginError::BadArgs(
                format!("`{id}` non si spegne: è chi tiene l'elenco di ciò che è spento").into(),
            ));
        }
        self.with_session(vault, |session| {
            let mut ws = session.workspace.write().expect("workspace avvelenato");
            let mut registry = session.registry.lock().expect("registry avvelenato");
            let mut errors = Vec::new();

            // Prima il fatto, poi la memoria del fatto: se il montaggio fallisce
            // non resta scritto che il componente è acceso.
            if enabled {
                registry.enable(&mut ws, id).map_err(PluginError::from)?;
            } else {
                errors.extend(registry.unmount(&mut ws, id).iter().map(|e| e.to_string()));
            }

            let mut disabled = crate::settings::disabled_plugins(&ws);
            disabled.retain(|d| d != id);
            if !enabled {
                disabled.push(id.to_string());
            }
            disabled.sort();
            ws.set_setting(
                crate::settings::PLUGINS_DISABLED,
                fub_abi::settings::SettingValue::List(disabled),
            )?;
            Ok(errors)
        })?
    }

    /// Chiude **un** vault: flush, `close` degli indici, disattivazione di ogni
    /// plugin (§9.5). Un vault che non è aperto è un errore, non un no-op: chi
    /// chiude nomina qualcosa che crede aperto.
    ///
    /// Se era il corrente, corrente diventa un altro dei vault aperti — o
    /// nessuno, se non ne restano.
    pub fn close_vault(&self, root: &Utf8Path) -> Result<Vec<PluginError>, PluginError> {
        let root = canonical(root)?;
        let session = {
            let mut sessions = self.sessions.lock().unwrap();
            let Some(session) = sessions.open.remove(&root) else {
                return Err(PluginError::NotFound(
                    format!("Nessun vault aperto su {root}.").into(),
                ));
            };
            if sessions.current.as_ref() == Some(&root) {
                sessions.current = sessions.open.keys().next().cloned();
            }
            session
        };
        // Fuori dal lock delle sessioni: chiudere chiama i provider, e un
        // provider che chiedesse un altro vault si troverebbe davanti sé stesso.
        Ok(session.close())
    }

    /// Chiude **tutti** i vault aperti: è ciò che fa chi spegne l'app.
    ///
    /// «Chiuderne uno» e «chiuderli tutti» sono lo stesso codice, ed è la
    /// ragione per cui il §9.5 e il §9.6 sono stati decisi insieme.
    ///
    /// Fra vault diversi **non c'è un ordine che conti**: due vault non si
    /// conoscono, non condividono provider e non condividono spazio dati.
    /// L'ordine che conta è dentro ciascuno — l'inverso della dichiarazione dei
    /// suoi plugin — e lo tiene [`Workspace::close`].
    pub fn close(&self) -> Vec<PluginError> {
        let sessions = {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.current = None;
            std::mem::take(&mut sessions.open)
        };
        sessions
            .into_values()
            .flat_map(VaultSession::close)
            .collect()
    }

    /// I vault aperti, in ordine di path.
    pub fn vaults(&self) -> Vec<Utf8PathBuf> {
        self.sessions.lock().unwrap().open.keys().cloned().collect()
    }

    /// Il vault corrente, se ce n'è uno.
    pub fn current(&self) -> Option<Utf8PathBuf> {
        self.sessions.lock().unwrap().current.clone()
    }

    /// Rende corrente un vault già aperto.
    pub fn set_current(&self, root: &Utf8Path) -> Result<(), PluginError> {
        let root = canonical(root)?;
        let mut sessions = self.sessions.lock().unwrap();
        if !sessions.open.contains_key(&root) {
            return Err(PluginError::NotFound(
                format!("Nessun vault aperto su {root}.").into(),
            ));
        }
        sessions.current = Some(root);
        Ok(())
    }

    /// Fa qualcosa con una sessione: quella nominata, o la corrente se `vault` è
    /// `None`.
    ///
    /// È il punto unico in cui «quale vault» si risolve, ed è per questo che
    /// nessun chiamante deve saperlo: la shell passa ciò che ha (spesso niente),
    /// e chi ne ha due passa quale.
    pub fn with_session<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&VaultSession) -> R,
    ) -> Result<R, PluginError> {
        let sessions = self.sessions.lock().unwrap();
        let key = match vault {
            Some(path) => canonical(Utf8Path::new(path))?,
            None => sessions
                .current
                .clone()
                .ok_or_else(|| PluginError::NotFound("Nessun vault aperto.".into()))?,
        };
        let session = sessions.open.get(&key).ok_or_else(|| {
            PluginError::NotFound(format!("Nessun vault aperto su {key}.").into())
        })?;
        Ok(f(session))
    }

    /// Un handle clonato al workspace di un vault (o del corrente), o l'errore
    /// se non è aperto.
    pub fn workspace(&self, vault: Option<&str>) -> Result<Arc<RwLock<Workspace>>, PluginError> {
        self.with_session(vault, |s| s.workspace.clone())
    }

    /// La radice del vault (o del corrente).
    pub fn root(&self, vault: Option<&str>) -> Result<Utf8PathBuf, PluginError> {
        self.with_session(vault, |s| s.root.clone())
    }

    /// Questo vault ha il rilevamento delle modifiche esterne? `false` anche
    /// quando non è aperto (§9.7).
    pub fn is_watching(&self, vault: Option<&str>) -> bool {
        self.with_session(vault, VaultSession::is_watching)
            .unwrap_or(false)
    }

    // --- versioning --------------------------------------------------------
    //
    // Il kernel non sa che il versioning esiste: le versioni le tiene un
    // `EventHandler`, e il ripristino è una scrittura normale (D8). L'host
    // compone le due metà, che è esattamente ciò che dovrà fare per un plugin
    // di terzi.

    #[cfg(feature = "versioning")]
    /// Lo store delle versioni di un vault, o l'errore se il versioning è
    /// spento: un chiamante che risponde "vuoto" quando la feature non c'è
    /// racconterebbe che non ci sono versioni, che è un'altra cosa.
    pub fn versions(&self, vault: Option<&str>) -> Result<VersionStore, PluginError> {
        self.with_session(vault, |s| s.versions.clone())?
            // `Unserved` e non `Internal`: nessuno serve le versioni in questo
            // vault perche' la feature e' spenta, e chi disegna deve poter dire
            // «accendi il versioning» invece di «qualcosa e' andato storto».
            .ok_or_else(|| PluginError::Unserved("Versioning disattivato.".into()))
    }

    #[cfg(feature = "versioning")]
    pub fn list_versions(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<Vec<VersionRef>, PluginError> {
        Ok(self.versions(vault)?.list(id))
    }

    /// Rileggere una versione passa dall'`HostApi` come tutto il resto: l'host
    /// presta al versioning le sue stesse capacità (`Workspace::with_host`), non
    /// una scorciatoia sul filesystem.
    #[cfg(feature = "versioning")]
    pub fn read_version(
        &self,
        vault: Option<&str>,
        id: &DocId,
        ts: u64,
    ) -> Result<String, PluginError> {
        let store = self.versions(vault)?;
        let ws = self.workspace(vault)?;
        let mut ws = ws.write().unwrap();
        ws.with_host(VERSIONING_ID, |host| store.read(id, ts, host))
    }

    /// Ripristina una versione riscrivendo il documento (D8): passa da parse,
    /// grafo, indici ed eventi come ogni altra modifica — e siccome passa dagli
    /// eventi, genera a sua volta uno snapshot. Il ripristino è annullabile.
    #[cfg(feature = "versioning")]
    pub fn restore_version(
        &self,
        vault: Option<&str>,
        id: &DocId,
        ts: u64,
    ) -> Result<(), PluginError> {
        let source = self.read_version(vault, id, ts)?;
        let ws = self.workspace(vault)?;
        let mut ws = ws.write().unwrap();
        // **Detta**, come l'importer (§18.1): un ripristino non discende dal
        // testo che c'è adesso — lo sostituisce **apposta**, ed è il gesto con
        // cui l'utente dice che quello di adesso non gli va bene. È l'altra
        // metà del ripristino che il comando `version.restore` dichiara allo
        // stesso modo, e le due righe dicono adesso la stessa parola.
        ws.write_document(id, &source, WriteBase::Dictated)
            .map(|_| ())
            .map_err(PluginError::from)
    }

    // --- organizzazione del vault (§11.3) ----------------------------------
    //
    // **Leggerla non è qui**: passa da `query_index` (`IndexQuery::Organization`),
    // come le impostazioni e i tag — un elenco è dati, e i dati hanno un canale
    // solo. Qui c'è solo lo scrivere, e **per chiave**: prima erano due funzioni
    // che leggevano e riscrivevano il blob intero, quindi due finestre sullo
    // stesso vault erano una lost update.

    /// L'emoji accanto a una nota o a una cartella (`None` la toglie).
    pub fn set_icon(
        &self,
        vault: Option<&str>,
        path: &str,
        icon: Option<String>,
    ) -> Result<(), PluginError> {
        self.with_session(vault, |s| {
            s.workspace
                .read()
                .unwrap()
                .set_icon(path, icon.clone())
                .map_err(|e| PluginError::Io(e.into()))
        })?
    }

    /// Appunta o spunta una nota.
    pub fn set_pinned(
        &self,
        vault: Option<&str>,
        id: &str,
        pinned: bool,
    ) -> Result<(), PluginError> {
        self.with_session(vault, |s| {
            s.workspace
                .read()
                .unwrap()
                .set_pinned(id, pinned)
                .map_err(|e| PluginError::Io(e.into()))
        })?
    }

    /// Registra o toglie una cartella dagli spazi.
    pub fn set_space(
        &self,
        vault: Option<&str>,
        path: &str,
        is_space: bool,
    ) -> Result<(), PluginError> {
        self.with_session(vault, |s| {
            s.workspace
                .read()
                .unwrap()
                .set_space(path, is_space)
                .map_err(|e| PluginError::Io(e.into()))
        })?
    }

    /// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
    pub fn set_order(
        &self,
        vault: Option<&str>,
        folder: &str,
        names: Vec<String>,
    ) -> Result<(), PluginError> {
        self.with_session(vault, |s| {
            s.workspace
                .read()
                .unwrap()
                .set_order(folder, names.clone())
                .map_err(|e| PluginError::Io(e.into()))
        })?
    }
}

/// Ciò che la shell sa di un vault appena aperto.
fn info_of(session: &VaultSession) -> VaultInfo {
    let ws = session.workspace.read().expect("workspace avvelenato");
    VaultInfo {
        root: ws.root().to_string(),
        extensions: ws.extensions(),
        plugins: ws.plugins(),
        unread: session.unread.lock().expect("scarti avvelenati").clone(),
    }
}

/// La forma **canonica** di una radice: è la chiave delle sessioni.
///
/// Senza, `/vault` e `/vault/` — o un link simbolico e la sua destinazione —
/// sarebbero due sessioni sullo stesso vault, e la seconda si fermerebbe sul
/// lock che l'indice della prima tiene sulla propria cartella. Un path che non
/// si canonicalizza (non esiste, o non è leggibile) è un errore qui, dove si può
/// ancora dire quale.
fn canonical(root: &Utf8Path) -> Result<Utf8PathBuf, PluginError> {
    let canonical = root
        .canonicalize()
        .map_err(|e| PluginError::Io(format!("non riesco a risolvere {root}: {e}").into()))?;
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
fn forme_della_radice(root: &Utf8Path) -> Vec<Utf8PathBuf> {
    let mut forme = vec![root.to_owned()];
    if let Ok(canonica) = canonical(root) {
        if canonica != forme[0] {
            forme.push(canonica);
        }
    }
    forme
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
