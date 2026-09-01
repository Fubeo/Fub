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
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::model::DocId;
use fub_abi::session::ViewContext;
use fub_abi::traits::{JobId, ViewInstance, ViewSpec};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::{Actor, Notice, PluginError};
#[cfg(feature = "versioning")]
use fub_features::{VersionRef, VersionStore, VERSIONING_ID};
use fub_kernel::{Guard, MachineSettings, ReadOnly, SystemLocale, ViewStates, Workspace};

use crate::config::{config_dir, machine_settings_path, vault_registry_path, view_states_path};
use crate::custody::Custody;
use crate::jobs::JobHost;
use crate::mount::mount;
use crate::records::{UnreadDoc, VaultInfo};
use crate::registry::{Bundle, BundleInfo, BundleRegistry};
use crate::runner::{JobRunner, DEFAULT_JOB_THREADS};
use crate::vaults::{VaultEntry, VaultRegistry};
use crate::watcher::{VaultWatcher, WatcherFactory};

/// Dove finiscono gli eventi del kernel una volta usciti dall'host.
///
/// Il kernel ha già un bus e chiunque può abbonarsi: questo trait esiste perché
/// il subscriber live va **registrato dopo la scansione e prima che il
/// rilevatore possa emettere il primo evento verso di esso**, e quel momento lo
/// conosce solo chi apre. Il thread del ponte viene acceso subito dopo; un
/// subscriber temporaneo, registrato prima del rilevatore, copre il tratto
/// precedente senza esporre al sink gli eventi interni all'apertura.
///
/// Per l'app è il webview (`fub://event`); per un'API locale sarebbero SSE o
/// websocket; per una CLI stdout; per un e2e headless, niente — e "niente" qui
/// si dice non passando nessun sink, non passandone uno che butta via, così il
/// thread del ponte non nasce nemmeno.
pub trait EventSink: Send + Sync + 'static {
    /// Manda fuori un notice, e **dice se è uscito**.
    ///
    /// La risposta esiste perché senza di essa non c'era nessuno a cui dirlo: le
    /// due strade per cui un'uscita fallisce — il webview non c'è ancora, e la
    /// consegna torna con un errore — erano scritte tutte e due come un ramo
    /// vuoto e un `let _ =`, cioè come niente. Un evento che non esce non è un
    /// evento in meno: è una shell che resta ferma su uno stato vecchio, ed è
    /// esattamente il fatto per cui [`Event::Overflow`](fub_abi::Event::Overflow)
    /// esiste. Chi tiene il conto è il ponte, che è uno solo
    /// (`bridge::consegna`); chi implementa questo trait deve solo **non
    /// mentire**.
    #[must_use = "un'uscita che non dice se ha consegnato è una perdita silenziosa: \
                  chi riceve resta indietro e nessuno gli dice di riconciliare"]
    fn emit(&self, notice: &Notice) -> Delivery;
}

/// Cosa è successo a un notice arrivato a un'[uscita](EventSink).
///
/// Non è un `Result`: non c'è niente da fare con l'errore — chi emette è il
/// kernel, che non ha nessuno a cui rispondere ([decisione 0126]) — e ciò che
/// serve sapere è una cosa sola, se chi sta dall'altra parte l'ha visto.
///
/// [decisione 0126]: ../../../docs/decisions/0184-eventi-accodati-e-job.md
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Delivery {
    /// È uscito.
    Done,
    /// Non è uscito, e non uscirà: chi sta dall'altra parte ne resta in debito.
    Dropped,
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
    workspace: Custody<Workspace>,
    /// **Chi possiede i bundle** di questo vault (§9.3): i plugin montati, in
    /// ordine di montaggio. Vive quanto la sessione perché è chi chiama
    /// `Plugin::deactivate` quando si chiude — il kernel quei plugin non li ha
    /// mai avuti.
    ///
    /// Condiviso col runner, che da qui prende il **corpo** di un job. Il lock
    /// lo si tiene per il tempo di una `body`, mai per la durata di un job: chi
    /// chiude deve poterci passare mentre un export cammina il vault.
    registry: Custody<BundleRegistry>,
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
    unread: Custody<Vec<UnreadDoc>>,
    /// **Quando l'indicizzazione di questa apertura ha finito** (§15.7): la
    /// condizione su cui aspetta chi non può proseguire con una ricerca
    /// parziale — un test, e la CLI che indicizza ed esce.
    ///
    /// L'app non la usa e non deve: il verso giusto per lei è disegnare subito
    /// e aggiornare, che è tutto ciò per cui l'apertura è a fasi.
    indexed: Arc<(Mutex<bool>, std::sync::Condvar)>,
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
    /// **Quando questa sessione è stata usata l'ultima volta**, nel contatore
    /// di [`Sessions::usi`]. Da qui si legge il corrente, e per questo sta
    /// sulla sessione e non accanto alla mappa: una sessione porta con sé il
    /// proprio posto nell'ordine, e toglierla dalla mappa toglie anche quello.
    ///
    /// Zero è «aperta ma non ancora diventata corrente», che dura il tempo fra
    /// l'inserimento e [`Host::become_current`] e perde contro chiunque:
    /// aprire un vault lo rende corrente **quando l'apertura è finita**, non a
    /// metà.
    used: u64,
}

impl VaultSession {
    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    pub fn workspace(&self) -> &Custody<Workspace> {
        &self.workspace
    }

    /// Chi possiede i bundle di questo vault (§9.3): serve a chi ne monta uno a
    /// mano — un test, e a M5 il caricatore che installa un plugin a vault già
    /// aperto.
    pub fn bundles(&self) -> &Custody<BundleRegistry> {
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
    /// «Smette di guardare» vuol dire **e ha smesso**: lasciarlo andare aspetta
    /// il suo thread di consegna, ed è una riga del rilevatore e non di qui
    /// ([`VaultWatcher`], difetto 0159). Prima non lo aspettava, e questo
    /// commento raccontava un ordine che la riga sotto non teneva.
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
        // Il veleno, qui, **è** uno degli errori di chiusura: chi chiude ha già
        // un canale per ciò che va storto chiudendo, e non serviva inventarne
        // un secondo. Ciò che non si chiude non si chiude, e si dice.
        match (workspace.write(), registry.write()) {
            (Ok(mut ws), Ok(mut reg)) => errors.extend(reg.close(&mut ws)),
            (Err(and), _) | (Ok(_), Err(and)) => errors.push(and),
        }
        errors
    }

    /// **Annulla** un job in volo (o che deve ancora partire): alzare la sua
    /// bandiera è tutto ciò che vuol dire, e alla capacità successiva il suo host
    /// gli dice di no.
    pub fn cancel_job(&self, id: JobId) {
        self.runner.cancel(id);
    }
}

/// I vault aperti, **in ordine d'uso**.
///
/// Il vault "corrente" è **della shell**: serve a chi non ne nomina uno, e non
/// è un'assunzione del backend. Chi chiude il corrente ne lascia un altro
/// corrente se ce n'è, e nessuno se non ce n'è.
#[derive(Default)]
struct Sessions {
    open: BTreeMap<Utf8PathBuf, VaultSession>,
    /// Quanti «diventa corrente» sono passati di qui. È un **contatore** e non
    /// un orologio: la domanda è *chi è stato usato dopo chi*, e a un ordine
    /// non serve sapere che ore erano — un orologio di sistema, che può
    /// tornare indietro, saprebbe rispondere peggio alla stessa domanda.
    usi: u64,
}

impl Sessions {
    /// **Il vault corrente**: il più recente fra gli aperti.
    ///
    /// È un'espressione e non un campo, ed è la differenza che conta: un campo
    /// va tenuto allineato alla mappa, e chi lo aggiornava lo faceva con un
    /// criterio suo — chiudendo il corrente toccava al primo path in ordine,
    /// che è l'ordine della [`BTreeMap`] e non una politica che qualcuno abbia
    /// scelto. Qui chi non è aperto non può essere corrente, e chi chiude il
    /// corrente lascia il posto al più recente di chi resta senza che nessuno
    /// scelga niente.
    fn current(&self) -> Option<&Utf8PathBuf> {
        self.open
            .iter()
            .max_by_key(|(_, session)| session.used)
            .map(|(root, _)| root)
    }

    /// Questo vault è il più recente. `false` se non è aperto — ed è la
    /// risposta di chi lo chiede per un path che nessuno ha aperto.
    fn make_current(&mut self, root: &Utf8Path) -> bool {
        self.usi += 1;
        let usi = self.usi;
        match self.open.get_mut(root) {
            Some(session) => {
                session.used = usi;
                true
            }
            None => false,
        }
    }
}

/// Chi monta Fub e tiene aperti i vault.
pub struct Host {
    sessions: Custody<Sessions>,
    watcher: Box<dyn WatcherFactory>,
    sink: Option<Arc<dyn EventSink>>,
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

/// Esegue una lettura del versioning con il prestito condiviso del workspace.
///
/// È un seam privato, così il percorso lock-sensitive di [`Host::read_version`]
/// resta verificabile senza esporre un'API solo ai test.
#[cfg(all(feature = "versioning", test))]
fn with_read_version_host<R>(
    workspace: &Custody<Workspace>,
    f: impl FnOnce(&dyn fub_abi::traits::ReadApi) -> R,
) -> Result<R, PluginError> {
    let workspace = workspace.read()?;
    Ok(workspace.with_read_host(VERSIONING_ID, f))
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
            sessions: Custody::empty("le sessioni aperte"),
            watcher,
            sink: None,
            session_notice: Mutex::new(None),
            machine: with_the_schema(MachineSettings::in_memory()),
            view_states: ViewStates::in_memory(),
            vaults: VaultRegistry::in_memory(),
            config_dir: None,
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
        self.machine = with_the_schema(machine);
        self.vaults = vaults;
        self.view_states = view_states;
        self.config_dir = Some(dir.to_owned());
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

    /// Apre un vault — monta, prepara il subscriber temporaneo, avvia il
    /// rilevatore, scansiona, registra il subscriber live e accende il ponte —
    /// e lo rende **corrente**.
    ///
    /// Un vault **già aperto** non si riapre: diventa corrente e basta. Prima
    /// riaprirlo voleva dire buttare la sessione e rifarla, con la scansione da
    /// ripagare e il lock dell'indice da riprendere — e se la seconda apertura
    /// falliva non si tornava alla prima. Succedeva riaprendo lo stesso vault
    /// dal dialogo, e in sviluppo a ogni ricarica della pagina.
    ///
    /// **Le due vie escono dallo stesso posto**, e non è un vezzo: finché la
    /// via corta usciva per conto suo, riaprire un vault già aperto ne
    /// spostava il corrente e lasciava i recenti nell'ordine vecchio — cioè
    /// l'unica delle due cose che l'utente rivede al prossimo avvio.
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

        let _phase = tracing::info_span!(target: "fub.apertura", "open").entered();

        let already_open = {
            let sessions = self.sessions.read()?;
            sessions.open.get(&root).map(info_of).transpose()?
        };
        let info = match already_open {
            Some(info) => info,
            None => self.mounts(&root)?,
        };
        self.become_current(&root)?;
        Ok(info)
    }

    /// Il montaggio vero e proprio, che è la via lunga di [`open`](Host::open):
    /// monta, prende il lock di apertura, avvia il rilevatore, scansiona,
    /// registra il subscriber live, accende il ponte e avvia il pool, e
    /// mette la sessione nella mappa. **Non decide chi è corrente**: quello lo
    /// fa chi l'ha chiamata, con la stessa riga che lo fa per un vault che era
    /// già aperto.
    fn mounts(&self, root: &Utf8Path) -> Result<VaultInfo, PluginError> {
        let root = root.to_owned();
        let crate::mount::Mounted {
            workspace: mut ws,
            mut registry,
            #[cfg(feature = "versioning")]
            versions,
        } = mount(
            &root,
            Arc::clone(&self.machine),
            Arc::clone(&self.view_states),
            Arc::clone(&self.system_locale),
            &self.levels,
        )
        // Le tre cose che fanno fallire il montaggio sono un provider di
        // formato in conflitto con sé stesso, un bundle di core che non si
        // monta — ciò che questo binario si porta dietro — e, da quando
        // l'apertura verifica la radice (0160), un posto che non esiste, che
        // non è una cartella o su cui non si ha permesso di scrivere: per chi
        // apre dal dialogo la prima delle tre filtra già in `Host::open`, le
        // altre arrivano qui con il perché nel messaggio.
        .map_err(|and| PluginError::Internal(and.into()))?;

        // **I temi installati sulla macchina** (§29.4): l'unica porta è il
        // `BundleRegistry` appena montato, come per le feature ufficiali —
        // niente seconda porta. Il tema di serie è già nella tabella di
        // `mount`; qui si aggiungono quelli che stanno in
        // `config_dir/themes/<id>/` (vedi [`themes_dir`](crate::config::themes_dir)).
        // Un tema **spento** (`plugins.disabled`) resta conosciuto e non si
        // accende: «spento» e «non c'è» sono due stati, ed è la riga di
        // [`BundleInfo::mounted`](crate::registry::BundleInfo::mounted).
        //
        // Un tema rotto non blocca l'apertura del vault: è un tema, non il
        // vault — la stessa regola del bundle ufficiale che non si monta. Ma si
        // dice, e nel log: un tema che esiste e non entra non deve sparire
        // senza una parola.
        if let Some(config_dir) = &self.config_dir {
            let disabled = crate::settings::disabled_plugins(&ws);
            let (themes, errors) = crate::theme::discover_themes(config_dir);
            for theme in themes {
                let bundle = std::sync::Arc::new(theme);
                let id = bundle.manifest().id;
                registry.remember(bundle);
                if !disabled.contains(&id) {
                    if let Err(and) = registry.enable(&mut ws, &id) {
                        tracing::error!(target: "fub.host", "theme not mounted: {and}");
                    }
                }
            }
            for problem in errors {
                tracing::error!(target: "fub.host", "theme skipped: {problem}");
            }
        }
        let registry = Custody::new("i componenti montati", registry);

        // **I tasti che questo vault propone e che nessuno ha guardato**
        // (§23.13). Qui, e non più tardi: da questa riga in poi il vault è
        // utilizzabile — la scansione parte subito sotto — e una scorciatoia che
        // fosse attiva anche per un solo istante sarebbe un tasto premuto.
        //
        // La regola la scrive `crate::settings::keys_to_watch` e la sospende
        // il kernel: il criterio ha bisogno di una cosa che nel vault non c'è —
        // cosa questa macchina ha già visto — e uno store di configurazione che
        // leggesse il registro dei vault per rispondere a una lettura sarebbe il
        // kernel che conosce l'installazione.
        let suspended =
            crate::settings::keys_to_watch(&ws.vault_keybindings(), &self.vaults.seen_keys(&root));
        ws.suspend_settings(suspended);

        let workspace = Custody::new("il vault aperto", ws);

        // Il rilevatore parte **sotto il write-lock di apertura**. Una factory
        // può quindi avviare un thread che tenta subito una lettura: quel
        // thread resta fermo finché scansione, subscriber live e JobStarted
        // non sono tutti installati. `WatcherFactory::start` non deve dunque
        // prendere sincronicamente questo lock, ma solo avviare il rilevatore.
        let (work, index_job, work_total, live, watcher) = {
            let mut ws = workspace.write()?;
            let watching = ws.watch_flag();
            let watcher = self
                .watcher
                .start(&root, workspace.clone(), watching)
                .map_err(|and| PluginError::Io(and.into()))?;
            let work = ws.scan_vault().map_err(PluginError::from)?;
            let work_total = work.total();
            let live = if self.sink.is_some() {
                Some(ws.bus().subscribe())
            } else {
                None
            };
            let index_job = ws.begin_index_job();
            (work, index_job, work_total, live, watcher)
        };

        if let (Some(sink), Some(live)) = (&self.sink, live) {
            crate::bridge::spawn(live, sink.clone());
        }

        // **La seconda fase nasce dopo il subscriber live**, e l'ordine è la
        // sostanza: `begin_index_job` emette un `JobStarted`, cioè la prima riga
        // del racconto dell'apertura; il thread del ponte parte subito dopo,
        // drenando ciò che il subscriber ha già accodato.
        let unread: Custody<Vec<UnreadDoc>> = Custody::empty("gli scarti dell'apertura");
        let indexed = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let in_progress = crate::runner::InProgress {
            id: index_job,
            total: work_total,
            work,
            unread: unread.clone(),
            end: Arc::clone(&indexed),
        };

        // Il pool parte dopo la scansione e riceve la seconda fase dell'apertura.
        let runner = JobRunner::start(
            workspace.clone(),
            registry.clone(),
            self.job_threads,
            Some(in_progress),
        )?;

        let session = VaultSession {
            root: root.clone(),
            workspace,
            registry,
            unread,
            indexed,
            runner,
            #[cfg(feature = "versioning")]
            versions,
            watcher,
            // Aperta, non ancora corrente: lo diventa quando l'apertura è
            // finita, e a dirlo è una riga sola per tutte e due le vie.
            used: 0,
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
        let (info, loser) = {
            let mut sessions = self.sessions.write()?;
            let loser = if sessions.open.contains_key(&root) {
                // Ha vinto l'altro: la sessione buona è la sua — riaprire un
                // vault già aperto non lo riapre, e vale anche quando il
                // "già" è di un istante fa.
                Some(session)
            } else {
                sessions.open.insert(root.clone(), session);
                None
            };
            let winner = sessions.open.get(&root).expect("appena inserita, o già lì");
            let info = info_of(winner)?;
            (info, loser)
        };
        // Chiudere sta **fuori** dal lock delle sessioni, per la stessa ragione
        // di [`close_vault`](Host::close_vault): chiudere chiama i provider.
        if let Some(loser) = loser {
            loser.close();
        }
        Ok(info)
    }

    /// **Un vault diventa il corrente**, e questa è l'unica riga che lo dice.
    ///
    /// Due cose insieme, ed è la ragione per cui è una funzione sola:
    ///
    /// - l'**ordine d'uso** dei vault aperti, da cui il corrente si legge
    ///   ([`Sessions::corrente`]) e da cui si rilegge da sé quando il corrente
    ///   si chiude;
    /// - il **timbro nel registro** (§11.1), che è l'ordine in cui l'utente
    ///   rivede i recenti al prossimo avvio.
    ///
    /// Erano due cose in due posti, e ogni chiamante ne aggiornava un
    /// sottoinsieme diverso: aprire un vault già aperto spostava il corrente e
    /// non i recenti, `set_current` non toccava nessuno dei due, e chi chiudeva
    /// il corrente sceglieva il successore con un terzo criterio ancora. Un
    /// posto solo, e il criterio è lo stesso per tutti perché è **la stessa
    /// espressione**.
    ///
    /// Il vault entra fra i conosciuti **dopo** un'apertura riuscita e non
    /// prima: un path che non si apre non è un vault recente, è un errore — e
    /// un elenco di recenti pieno di cartelle che non aprono è peggio di un
    /// elenco vuoto.
    fn become_current(&self, root: &Utf8Path) -> Result<(), PluginError> {
        if !self.sessions.write()?.make_current(root) {
            return Err(PluginError::NotFound(
                format!("Nessun vault aperto su {root}.").into(),
            ));
        }
        // Il registro sta **fuori** dal lock delle sessioni: scrive sul disco,
        // e tenerlo dentro fermerebbe ogni comando dell'host per il tempo di
        // una scrittura di comodità.
        if let Err(and) = self
            .vaults
            .notes_opened(root, fub_kernel::time::now_unix_millis())
        {
            // Solo log: il registro dei recenti è una comodità, non il vault,
            // e non scriversi non perde un dato dell'utente — perde al più un
            // path nell'elenco di chi è stato aperto. Pavimento e basta (0062).
            tracing::warn!(target: "fub.host", "registro dei vault: {and}");
        }
        Ok(())
    }

    /// **La chiave di una radice**: quella con cui è già conosciuta, se lo è, e
    /// solo altrimenti la sua forma canonica.
    ///
    /// Canonicalizzare è una domanda al filesystem, e una radice si
    /// canonicalizza **una volta, all'apertura** — è lì che `/vault`, `/vault/`
    /// e un link simbolico diventano la stessa chiave, ed è lì che si può
    /// ancora dire di no a chi nomina una cartella che non c'è. Rifarla a ogni
    /// uso non aggiunge niente e toglie tutto nel caso che conta: una chiavetta
    /// staccata, una cartella di rete caduta, un `rm -rf` di chi fa pulizia.
    /// Da quel momento il disco non risponde più, e le funzioni che
    /// ricanonicalizzavano rispondevano «non riesco a risolvere» a chi voleva
    /// **chiudere** quel vault, o smettere di preferirlo, o rinominarlo — cioè
    /// esattamente alle tre cose che si fanno su un vault che non c'è più.
    ///
    /// La risposta l'apertura l'ha già data: è la chiave della sessione e il
    /// `root` della voce in registro, ed è la sola forma che
    /// [`vaults`](Host::vaults) e [`known_vaults`](Host::known_vaults)
    /// restituiscono, cioè la sola che la shell abbia in mano. Quindi si guarda
    /// prima lì. Al disco si chiede solo per un nome che né le sessioni né il
    /// registro conoscono — un alias, un path con lo slash finale — e lì la
    /// canonicalizzazione serve ancora, per intero.
    ///
    /// Non è [`root_forms`], che risponde a un'altra domanda: chi
    /// **dimentica** cancella per ogni nome possibile e non può fallire, chi
    /// usa deve arrivare a *una* chiave o dire perché no.
    fn key(&self, root: &Utf8Path) -> Result<Utf8PathBuf, PluginError> {
        if self.knows(root) {
            return Ok(root.to_owned());
        }
        canonical(root)
    }

    /// Questo host conosce questa radice **sotto questo nome**: c'è una
    /// sessione aperta con questa chiave, o una voce in registro.
    ///
    /// I due elenchi insieme e non uno solo, perché le due metà si aprono e si
    /// chiudono in momenti diversi: un vault chiuso esce dalle sessioni e resta
    /// in registro — ed è proprio allora che lo si preferisce o lo si rinomina.
    fn knows(&self, root: &Utf8Path) -> bool {
        self.sessions
            .read()
            .is_ok_and(|sessions| sessions.open.contains_key(root))
            || self.vaults.knows(root)
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

    /// Il **vault da aprire all'avvio**, se la shell non ha ricevuto un
    /// `FUB_VAULT`: scorre i candidati del registro dal più recente e
    /// restituisce la radice del primo la cui cartella esiste ancora sul disco.
    ///
    /// Non lo apre — solo il path. Un preferito più vecchio non salta davanti
    /// all'ultimo aperto: il registro è memoria di recency, e l'avvio chiede
    /// *l'ultimo*, non il *preferito*. Un path sparito non fa fallire l'avvio:
    /// si passa al successivo e la shell resta libera di aprirne uno dal
    /// dialogo.
    ///
    /// Il `Utf8Path::is_dir` è l'unica domanda al disco, ed è intenzionale:
    /// [`VaultEntry::root`] è canonica per contratto, quindi non si
    /// ricanonicalizza (la cartella potrebbe essere sparita, e
    /// `canonicalize` non risponde su ciò che non c'è).
    pub fn last_vault(&self) -> Option<String> {
        self.vaults
            .in_recency_order()
            .into_iter()
            .find(|and| Utf8Path::new(&and.root).is_dir())
            .map(|and| and.root)
    }

    /// Appunta (o spunta) un vault. Il path **non** deve essere aperto: si
    /// preferisce un vault anche quando è chiuso, ed è quasi sempre allora.
    pub fn set_vault_favorite(&self, root: &Utf8Path, favorite: bool) -> Result<(), PluginError> {
        self.vaults.set_favorite(&self.key(root)?, favorite)
    }

    /// L'icona e il nome con cui un vault compare nell'elenco: **l'aspetto
    /// intero**, nelle stesse forme in cui `known_vaults` lo restituisce —
    /// l'icona assente è `None`, il nome non scelto è il vuoto.
    pub fn set_vault_look(
        &self,
        root: &Utf8Path,
        icon: Option<String>,
        name: String,
    ) -> Result<(), PluginError> {
        self.vaults.set_look(&self.key(root)?, icon, name)
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
        let forms = root_forms(root);
        self.vaults.forget(&forms)?;
        // **Le forme insieme, non una per volta**: sono due file diversi, quindi
        // due scritture ci vogliono per forza, ma dentro ciascuno la potatura è
        // *una* mossa. Il ciclo che stava qui ne faceva N sullo stesso file, e
        // bastava che la seconda non riuscisse per lasciare il vault mezzo
        // dimenticato — dimenticato sotto il nome dato, ancora lì sotto quello
        // canonico. Adesso quella metà non è più esprimibile: la firma prende
        // l'insieme, come `Registry::forget` qui sopra.
        self.view_states
            .forget_vault(&forms)
            .map_err(|and| PluginError::Io(and.into()))?;
        Ok(())
    }

    // --- accendere e spegnere un componente (§11.1) -------------------------

    /// Chi questo host sa montare, e chi è acceso in questo vault.
    pub fn bundles(&self, vault: Option<&str>) -> Result<Vec<BundleInfo>, PluginError> {
        self.in_session(vault, |s| Ok(s.registry.write()?.inventory()))
    }

    /// **Accende o spegne un componente**, adesso e per i prossimi avvii.
    ///
    /// Due cose, e nessuna delle due basta da sola: il montaggio (o lo
    /// smontaggio) *adesso* — che è `BundleRegistry`, ed è host-side per
    /// costruzione ([decisione 0031](../../../docs/decisions/0183-composizione-host-kernel.md):
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
    ///
    /// **Ciò che torna sono gli errori dello spegnimento interi**, non le frasi
    /// che li descrivono: spegnere non si annulla perché un `deactivate` è
    /// andato storto, e chi riceve l'elenco deve poterci ramificare sopra. Una
    /// `String` qui avrebbe fatto la stessa figura sullo schermo e tolto il
    /// `kind` ([decisione 0041](../../../docs/decisions/0192-impostazioni-locale-e-temi.md))
    /// a un passo dal confine che quel tipo lo sa attraversare da sé — che è
    /// come lo restituisce già [`Host::close_vault`], ed è la stessa lista.
    pub fn set_plugin_enabled(
        &self,
        vault: Option<&str>,
        id: &str,
        enabled: bool,
    ) -> Result<Vec<PluginError>, PluginError> {
        if id == crate::settings::CORE_ID {
            return Err(PluginError::BadArgs(
                format!("`{id}` non si spegne: è chi tiene l'elenco di ciò che è spento").into(),
            ));
        }
        self.with_session(vault, |session| {
            // **Prima i job, poi i prestiti**, e in quest'ordine soltanto.
            //
            // Chi esegue un job tiene una copia del bundle finché il job dura
            // ([`BundleRegistry::body`]), e `Plugin::deactivate` vuole essere
            // solo: spegnere un componente con un suo job in volo saltava il
            // commiato e lo diceva in un errore. Aspettarlo qui è la stessa
            // regola con cui si chiude un vault — chi spegne aspetta chi
            // lavora ([0032](../../../docs/decisions/0183-composizione-host-kernel.md))
            // — applicata a un componente invece che a tutti.
            //
            // E **prima** dei due prestiti, non dopo: un job dentro `run_job`
            // chiede il workspace per riconsegnare il proprio esito, e
            // aspettarlo tenendoglielo sarebbe aspettare sé stessi. Il permesso
            // si dichiara per primo anche perché cada per ultimo: finché vive,
            // nessun job di quel bundle riparte da dietro.
            let _shutdown = (!enabled).then(|| session.runner.shutdown_bundle(id));
            let mut ws = session.workspace.write()?;
            let mut registry = session.registry.write()?;

            // **La domanda mal posta si respinge prima di toccare qualunque
            // cosa.** Accendere un id che nessuno conosce non è un guasto a
            // metà strada: è un id scritto male, e la risposta è la stessa che
            // dà [`BundleRegistry::enable`] — solo, arriva *prima* della
            // scrittura invece che dopo. È l'unico pezzo di `enable` che non
            // ha bisogno del workspace per rispondere, ed è quello che va
            // portato davanti al punto di non ritorno: ciò che resta dietro è
            // il montaggio, che il workspace lo tocca per forza.
            if enabled && !registry.knows(id) {
                return Err(crate::registry::BundleError::Unknown(id.to_string()).into());
            }

            // **Il disco prima, la memoria dopo** — la riga di famiglia, qui a
            // mano perché le due memorie non sono la copia di un file (quelle
            // le tiene `Durevole`): sono la riga in `plugins.disabled` e il
            // *montaggio*, che è il registry più il kernel.
            //
            // Nel verso dello spegnimento l'ordine è gratis e non c'è niente da
            // scambiare: `unmount` **non fallisce** — raccoglie i guasti del
            // commiato e li rende, ma smonta comunque — quindi la mossa che può
            // andare storta è una sola ed è la scrittura, e sta davanti. Se non
            // riesce non è stato smontato niente: il vuoto fra le due metà non
            // è più esprimibile.
            //
            // Nel verso dell'accensione, invece, di mosse che possono fallire
            // ne restano due (la scrittura e il montaggio) e l'ordine è una
            // scelta. Va così, e non al contrario, per due ragioni. La prima:
            // `plugins.disabled` è ciò che l'utente **vuole**, non lo specchio
            // di ciò che è montato — non a caso non è `program_writable`. La
            // seconda: «scritto come acceso, non montato» non è uno stato
            // inventato qui, è quello che ogni avvio produce quando un bundle
            // non si monta (`mount.rs`: l'errore si scrive nel log e si tira
            // avanti), quindi è uno stato che il resto del programma sa già
            // abitare, e il prossimo avvio ci riprova. Lo stato opposto —
            // montato adesso, spento nel file — nessun avvio lo sa produrre, e
            // si disfa da sé alla prima riapertura senza dire niente. Il
            // commento che stava qui prometteva che «se il montaggio fallisce
            // non resta scritto che il componente è acceso»: non era vero
            // nemmeno allora, perché all'avvio resta scritto eccome.
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

            let mut errors = Vec::new();
            if enabled {
                registry.enable(&mut ws, id).map_err(PluginError::from)?;
            } else {
                errors.extend(registry.unmount(&mut ws, id));
            }
            Ok(errors)
        })?
    }

    // --- i tasti che un vault propone (§23.13) -----------------------------

    /// Le scorciatoie che questo vault propone e che nessuno ha ancora
    /// guardato: chiave d'impostazione → accordo.
    ///
    /// Torna la **chiave** e non l'id del comando, e non è pigrizia: chi disegna
    /// ha già l'elenco dei comandi con i loro titoli localizzati, e ricomporre
    /// qui un titolo vorrebbe dire risolverlo nel catalogo di chi ha registrato
    /// il comando — cioè, per un comando di un componente, nel catalogo del
    /// componente. Ciò che attraversa di qui è un identificatore; la frase la
    /// scrive la shell, che è la stessa riga della 0098.
    /// Restano fuori le chiavi che **nessuno dichiara**: una scorciatoia scritta
    /// per un comando di un componente che oggi è spento non ha un titolo da
    /// mostrare né un modo di essere azzerata, e chiedere di una cosa che non fa
    /// niente insegna a rispondere senza guardare. Resta sospesa, e la domanda
    /// arriva il giorno che quel componente si accende — che è l'unico giorno in
    /// cui vale la pena farla.
    pub fn pending_keybindings(
        &self,
        vault: Option<&str>,
    ) -> Result<std::collections::BTreeMap<String, String>, PluginError> {
        self.in_session(vault, |session| {
            let ws = session.workspace.read()?;
            let proposti = ws.vault_keybindings();
            Ok(ws
                .suspended_settings()
                .into_iter()
                .filter(|key| ws.setting_is_declared(key))
                .filter_map(|key| proposti.get(&key).map(|c| (key, c.clone())))
                .collect())
        })
    }

    /// **Usa le sue**: l'utente ha guardato le scorciatoie del vault e le
    /// adotta. Da qui in poi valgono, e non gliele si chiede più — finché il
    /// file non ne cambia una.
    pub fn adopt_keybindings(&self, vault: Option<&str>) -> Result<(), PluginError> {
        let shown: std::collections::BTreeSet<String> =
            self.pending_keybindings(vault)?.into_keys().collect();
        self.in_session(vault, |session| {
            session.workspace.write()?.resume_settings(&shown);
            Ok(())
        })?;
        self.remember_seen_keys(vault)
    }

    /// **Tieni le mie**: le scorciatoie che il vault proponeva escono dal suo
    /// file, e valgono quelle dichiarate dai comandi.
    ///
    /// Cancella davvero invece di lasciarle sospese per sempre, e la ragione è
    /// la riga della 0076: un valore che nessuno leggerà mai è la cosa peggiore
    /// che un file di configurazione possa contenere. Dopo una risposta — in
    /// tutti e due i versi — non resta niente di ambiguo nel file.
    ///
    /// Tocca **solo** le chiavi sospese: una scorciatoia che l'utente si era
    /// scelto su questa macchina e che il vault non ha cambiato non è in
    /// discussione, e rifiutare ciò che arriva da fuori non deve buttare ciò che
    /// era già proprio.
    pub fn discard_keybindings(&self, vault: Option<&str>) -> Result<(), PluginError> {
        let shown: Vec<String> = self.pending_keybindings(vault)?.into_keys().collect();
        let missing = self.in_session(vault, |session| {
            let mut ws = session.workspace.write()?;
            // Il `reset` **risveglia** la chiave che azzera — è la riga in
            // `SettingsStore::write` — quindi alla fine del giro non resta
            // sospeso niente di ciò che è stato mostrato, e non serve una
            // seconda mossa che potrebbe non essere d'accordo con la prima.
            //
            // I guasti si **raccolgono** invece di interrompere il giro, e la
            // ragione è la promessa qui sopra: uscire alla prima chiave che non
            // si azzera lascerebbe metà file cancellato e metà ancora sospeso,
            // cioè esattamente l'ambiguità che questa risposta esiste per
            // togliere — e senza nemmeno arrivare al promemoria, così la volta
            // dopo si richiede di un insieme che è già stato in parte distrutto.
            Ok(shown
                .iter()
                .filter_map(|key| {
                    ws.reset_setting(key)
                        .err()
                        .map(|why| format!("`{key}`: {why}"))
                })
                .collect::<Vec<_>>())
        })?;
        // Il promemoria si scrive **comunque**, e dice il vero da solo: ricorda
        // ciò che il file porta meno ciò che è rimasto sospeso, quindi le chiavi
        // che non si sono azzerate non risultano guardate.
        self.remember_seen_keys(vault)?;
        if missing.is_empty() {
            return Ok(());
        }
        Err(PluginError::Internal(
            format!(
                "{} scorciatoie del vault non si sono azzerate — {}",
                missing.len(),
                missing.join("; ")
            )
            .into(),
        ))
    }

    /// Scrive un'impostazione **per conto dell'utente**: è la porta della
    /// persona davanti allo schermo, quella che il §11.1 tiene distinta da
    /// `settings.set` del registro (da cui passa un programma).
    ///
    /// Esiste come metodo dell'host, e non come la riga di `Workspace` che
    /// chiama, per una ragione sola: una scorciatoia scritta qui è una
    /// scorciatoia **guardata**, e ricordarlo vuol dire toccare il registro dei
    /// vault — che il kernel non conosce e non deve conoscere. Senza questa
    /// riga la tastiera continuerebbe a funzionare e l'app chiederebbe alla
    /// riapertura di adottare un accordo che l'utente ha battuto lui: cioè la
    /// domanda inutile che insegna a rispondere senza guardare.
    pub fn set_setting_for_user(
        &self,
        vault: Option<&str>,
        key: &str,
        value: fub_abi::settings::SettingValue,
    ) -> Result<(), PluginError> {
        if self.machine_only(vault, key) {
            self.machine.set(key, value)?;
            return self.tell_observer(key);
        }
        self.with_session(vault, |session| {
            session.workspace.write()?.set_setting(key, value)
        })??;
        self.if_key_remember_it(vault, key)
    }

    /// Azzera un'impostazione per conto dell'utente. Stessa porta, stesso
    /// promemoria: azzerare una scorciatoia è guardarla quanto scriverla.
    pub fn reset_setting_for_user(
        &self,
        vault: Option<&str>,
        key: &str,
    ) -> Result<(), PluginError> {
        if self.machine_only(vault, key) {
            self.machine.reset(key)?;
            return self.tell_observer(key);
        }
        self.with_session(vault, |session| {
            session.workspace.write()?.reset_setting(key)
        })??;
        self.if_key_remember_it(vault, key)
    }

    /// Le impostazioni **che esistono senza un vault**: le righe del livello
    /// macchina, risolte (§16.3).
    ///
    /// È la risposta a [`IndexQuery::Settings`] quando non c'è nessun vault
    /// aperto, e non è un ripiego: `log.*` e le scorciatoie della shell sono
    /// dichiarate di macchina proprio perché il caso in cui servono è questo.
    /// Con un vault aperto la domanda passa dal canale dati come sempre, e le
    /// stesse chiavi arrivano di là con lo stesso valore — la mappa è una sola.
    ///
    /// [`IndexQuery::Settings`]: fub_abi::traits::IndexQuery::Settings
    ///
    /// # Perché risolve qui, e non nello store
    ///
    /// «Risolte» vuol dire due cose, e per un pezzo ne valeva una sola.
    /// [`MachineSettings::entries`] risolve il **valore** — quale livello vince,
    /// e da dove viene — e non può risolvere il **testo**: i cataloghi arrivano
    /// coi bundle, i bundle stanno nel montaggio di un vault, e questa porta
    /// esiste proprio per il caso in cui un vault non c'è. Lo store non ha
    /// niente con cui tradurre, e chiederglielo vorrebbe dire fargli tenere una
    /// copia dei cataloghi che il montaggio già tiene.
    ///
    /// Il risultato, finché ha risolto solo il valore, era un
    /// [`Text::Message`](fub_abi::text::Text::Message) che usciva dal contratto
    /// intatto: sul filo `{"key": "core.log.level"}` dove la shell aspetta una
    /// stringa, cioè `[object Object]` scritto in ogni etichetta del pannello —
    /// e per giunta nel momento peggiore, perché la porta senza vault è quella
    /// che risponde a chi sta cercando l'interruttore del log per capire perché
    /// un vault non si apre. È lo stesso difetto che il canale dati aveva dal
    /// lato vault, riparato mandando `IndexQuery::Settings` a
    /// `Workspace::query_index`: qui non c'è un `Workspace` a cui mandarlo, e
    /// la riparazione è la stessa fatta con ciò che l'host ha in mano.
    ///
    /// Il catalogo è quello di **core** e non c'è da sceglierlo: al livello
    /// macchina dichiara solo lui (`core_machine_settings()`, in `open`), e chi
    /// aggiungesse un secondo dichiarante troverebbe qui una riga da cambiare
    /// invece di un difetto da scoprire. La lingua è quella del **sistema** e
    /// basta: le `locale.*` sono del vault
    /// ([0076](../../../docs/decisions/0192-impostazioni-locale-e-temi.md)),
    /// quindi senza vault la scala di `Workspace::locale` collassa sull'unico
    /// gradino che le resta.
    ///
    /// Presidiata da `tests/la_macchina_senza_vault.rs`, che guarda ogni `Text`
    /// dell'albero e non le sole etichette: il difetto si era già nascosto una
    /// volta nelle opzioni di una `Choice`, che nessuno guardava.
    pub fn machine_settings(&self) -> Vec<fub_abi::settings::SettingEntry> {
        let mut rows = self.machine.entries();
        let all_catalogs = crate::settings::core_catalog_assembled();
        let locale = self.system_locale.get();
        let strings = fub_abi::text::Strings::new(
            &all_catalogs,
            crate::settings::CORE_DEFAULT_LOCALE,
            &locale,
        );
        for row in &mut rows {
            strings.localize(row);
        }
        rows
    }

    /// **Il canale dati**, con la sola domanda che si può servire senza vault.
    ///
    /// Le impostazioni di macchina esistono anche a finestra vuota (§16.3):
    /// `log.*` è dichiarata così perché il momento in cui serve è quello in cui
    /// un vault non si apre, e le scorciatoie della shell perché
    /// `shell.vault.open` è il comando che apre il primo. È una famiglia sola e
    /// resta su **questa** porta invece di averne una sua, perché un elenco è
    /// dati e i dati hanno un canale solo (0019).
    ///
    /// Sta qui e non nel comando IPC per la ragione di sempre: il livello
    /// macchina è dell'host, e la regola che decide quando risponde lui va dove
    /// un banco la può interrogare.
    pub fn query_index(
        &self,
        vault: Option<&str>,
        query: fub_abi::traits::IndexQuery,
    ) -> Result<fub_abi::traits::IndexResult, PluginError> {
        if vault.is_none()
            && !self.has_current_vault()
            && matches!(
                query,
                fub_abi::traits::IndexQuery::Settings { plugin: None }
            )
        {
            return Ok(fub_abi::traits::IndexResult::Settings(
                self.machine_settings(),
            ));
        }
        self.read_workspace(vault, |workspace| workspace.query_index(query))
    }

    /// Questa scrittura riguarda una chiave che **un vault non le serve**, e
    /// vault aperti non ce ne sono?
    ///
    /// Le tre condizioni insieme, e nessuna si può togliere. Senza la prima, chi
    /// nomina un vault che non è aperto riceverebbe un successo dal livello
    /// sbagliato; senza la seconda, una chiave di macchina scritta con un vault
    /// aperto salterebbe il `Workspace`, cioè l'evento `setting_changed` che i
    /// pannelli aspettano; senza la terza, una chiave di vault scritta senza
    /// vault direbbe «non dichiarata» invece di «nessun vault aperto», che è la
    /// frase che dice cosa fare.
    fn machine_only(&self, vault: Option<&str>, key: &str) -> bool {
        vault.is_none() && !self.has_current_vault() && self.machine.declares(key)
    }

    /// **Scrivere si dice**, anche quando a scrivere non è stato un vault.
    ///
    /// Con un vault aperto l'evento lo emette il `Workspace`, e chi ascolta —
    /// la tastiera, che rilegge gli accordi; il pannello, che si ridisegna — non
    /// sa da dove venga. Senza vault il `Workspace` non c'è, e senza questa riga
    /// una scorciatoia rimappata nella finestra vuota resterebbe scritta, letta
    /// e mostrata giusta mentre la tastiera continua a rispondere a quella
    /// vecchia: è il difetto che la 0090 aveva già trovato una volta per l'altra
    /// metà della stessa famiglia, e la risposta è la stessa.
    ///
    /// [`Actor::User`], perché di qui passa la persona davanti allo schermo: è
    /// la stessa distinzione per cui `set_setting` è un comando IPC e non
    /// `settings.set` del registro.
    /// **La porta dell'avviso di sessione** (§25.5): la diagnosi «la cartella
    /// di configurazione non si può scrivere» — o non c'è — come
    /// `Event::Trouble` di severità `Warning`, consegnata **una volta** per
    /// sessione.
    ///
    /// Perché è un tiraggio e non una spinta: la diagnosi nasce in
    /// `install_logging`, prima che questo host esista e che qualunque
    /// ascoltatore sia in piedi — il ponte verso la webview nasce solo al primo
    /// vault aperto ([`Host::open`]), e la shell si iscrive agli eventi ancora
    /// dopo. Una spinta a quell'ora sarebbe un evento emesso nel vuoto: verde e
    /// muta. L'unico istante garantito è un comando chiesto dalla shell
    /// **dopo** che il router è attaccato, e questo metodo è il suo lato host.
    ///
    /// Il `take` rende la «una volta per sessione» strutturale: la seconda
    /// chiamata — da un secondo comando, da un secondo thread — trova `None` e
    /// non consegna niente. Niente `AtomicU32`: la forma di
    /// [`Custodia::denuncia`](crate::custodia::Custodia) serve a chi deve
    /// rispondere a **ogni** chiamata, e qui la diagnosi nasce una volta e si
    /// consuma una volta. L'origine è `Kernel` (0012): la diagnosi non è di
    /// nessun altro — non l'ha chiesta la persona e non l'ha prodotta un
    /// plugin.
    pub fn session_notice(&self) -> Option<Notice> {
        let warning = self
            .session_notice
            .lock()
            .unwrap_or_else(|and| and.into_inner())
            .take()?;
        Some(Notice::new(
            fub_abi::Event::Trouble {
                severity: fub_abi::event::Severity::Warning,
                subject: None,
                error: PluginError::Io(warning.into()),
                gate: None,
            },
            fub_abi::event::Origin::by(fub_abi::event::Actor::Kernel),
        ))
    }

    /// # È la **seconda uscita**, e non passa dal ponte
    ///
    /// Zona cieca dichiarata: qui non c'è nessun vault, quindi non c'è nessun
    /// bus e nessun thread del ponte, quindi il conto del debito di
    /// `bridge::consegna` non copre questa riga. Di consegne fuori dal ponte ce
    /// n'è **una** [conta: uscite-fuori-dal-ponte], ed è questa; la si è
    /// scoperta perché il `#[must_use]` di [`EventSink::emit`] l'ha resa
    /// rumorosa, mentre prima era una chiamata il cui esito nessuno guardava.
    ///
    /// Ciò che non si fa è rispondere `Err`: la scrittura è **fatta**, e dire di
    /// no a chi ha scritto sarebbe mentire su un file che è già cambiato. Ciò
    /// che si fa è dirlo, perché l'unico modo in cui questo caso finiva era in
    /// silenzio.
    fn tell_observer(&self, key: &str) -> Result<(), PluginError> {
        if let Some(sink) = &self.sink {
            let delivers = sink.emit(&fub_abi::Notice::new(
                fub_abi::Event::SettingChanged {
                    key: key.to_string(),
                    scope: fub_abi::settings::SettingScope::Machine,
                },
                fub_abi::event::Origin::by(fub_abi::event::Actor::User),
            ));
            if delivers == Delivery::Dropped {
                tracing::error!(
                    target: "fub.host",
                    key = key,
                    "l'impostazione è scritta ma non l'ha saputo nessuno: chi ascolta \
                     — la tastiera, il pannello — continua a rispondere al valore \
                     vecchio finché non si riapre"
                );
            }
        }
        Ok(())
    }

    /// C'è un vault corrente? È la domanda che distingue «la shell sta lavorando
    /// su un archivio» da «la finestra è aperta e basta», e la pone chi deve
    /// decidere se una domanda si può servire senza vault.
    pub fn has_current_vault(&self) -> bool {
        self.sessions.read().is_ok_and(|s| s.current().is_some())
    }

    /// Il promemoria costa una riscrittura del registro, quindi si paga solo
    /// quando la chiave è di quella famiglia — che è quasi mai.
    fn if_key_remember_it(&self, vault: Option<&str>, key: &str) -> Result<(), PluginError> {
        if fub_abi::settings::command_of_keybinding_key(key).is_none() {
            return Ok(());
        }
        self.remember_seen_keys(vault)
    }

    /// Cosa, dei tasti di questo vault, l'utente ha guardato: ciò che il file
    /// porta **meno** ciò che resta sospeso.
    ///
    /// Una espressione sola per tutte e due le risposte, e il fatto che sia la
    /// stessa non è un'economia: dopo un «usa le sue» non c'è più niente di
    /// sospeso e ci finisce dentro tutto; dopo un «tieni le mie» il file non
    /// porta più niente di ciò che era in discussione. Ciò che resta escluso in
    /// entrambi i casi è la stessa cosa — le chiavi che nessuno dichiara, che
    /// non sono state mostrate e quindi non sono state approvate.
    fn remember_seen_keys(&self, vault: Option<&str>) -> Result<(), PluginError> {
        let (root, seen) = self.in_session(vault, |session| {
            let ws = session.workspace.read()?;
            let suspended = ws.suspended_settings();
            let mut seen = ws.vault_keybindings();
            seen.retain(|key, _| !suspended.contains(key));
            Ok((session.root.clone(), seen))
        })?;
        self.vaults.notes_keys_seen(&root, seen)
    }

    /// Chiude **un** vault: flush, `close` degli indici, disattivazione di ogni
    /// plugin (§9.5). Un vault che non è aperto è un errore, non un no-op: chi
    /// chiude nomina qualcosa che crede aperto.
    ///
    /// Se era il corrente, corrente diventa un altro dei vault aperti — o
    /// nessuno, se non ne restano.
    pub fn close_vault(&self, root: &Utf8Path) -> Result<Vec<PluginError>, PluginError> {
        // **Fuori dal prestito esclusivo**, perché nel ramo che non conosce il
        // nome dato questa riga chiede al disco: e il lock che ferma ogni
        // comando dell'host non attraversa una domanda al filesystem.
        let root = self.key(root)?;
        let session = {
            let mut sessions = self.sessions.write()?;
            let Some(session) = sessions.open.remove(&root) else {
                return Err(PluginError::NotFound(
                    format!("Nessun vault aperto su {root}.").into(),
                ));
            };
            // Chi è corrente adesso non si decide qui, e non c'era modo di
            // deciderlo bene: il corrente è il più recente degli aperti, e
            // togliere una sessione dalla mappa toglie con lei il suo posto
            // nell'ordine. Prima toccava al primo path in ordine — l'ordine
            // della `BTreeMap`, che nessuno aveva scelto come politica.
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
            // La mappa non è più leggibile: non si sa più *cosa* chiudere, e
            // rispondere con un elenco vuoto vorrebbe dire «chiuso tutto».
            let mut sessions = match self.sessions.write() {
                Ok(sessions) => sessions,
                Err(and) => return vec![and],
            };
            // Svuotare la mappa è già «non c'è più un corrente»: non c'è un
            // secondo campo da azzerare, e quindi non c'è modo di scordarselo.
            std::mem::take(&mut sessions.open)
        };
        sessions
            .into_values()
            .flat_map(VaultSession::close)
            .collect()
    }

    /// I vault aperti, in ordine di path.
    pub fn vaults(&self) -> Vec<Utf8PathBuf> {
        // Queste due firme un canale d'errore non ce l'hanno, e non gliene si
        // aggiunge uno per un caso in cui la porta ha **già** scritto la sua
        // riga: chi chiede quali vault siano aperti riceve ciò che se ne sa
        // ancora, che è niente.
        self.sessions
            .read()
            .map(|s| s.open.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Il vault corrente, se ce n'è uno.
    pub fn current(&self) -> Option<Utf8PathBuf> {
        self.sessions.read().ok().and_then(|s| s.current().cloned())
    }

    /// Rende corrente un vault già aperto.
    ///
    /// Passa da [`become_current`](Host::diventa_corrente) come `open`, e per
    /// la ragione che rende quella funzione una sola: **sceglierlo è usarlo**.
    /// Chi torna su un vault e poi spegne l'app deve ritrovarselo in cima ai
    /// recenti, o l'elenco racconterebbe l'ultimo *montaggio* invece
    /// dell'ultimo lavoro — e sarebbe di nuovo un ordine che dice una cosa e un
    /// corrente che ne dice un'altra.
    pub fn set_current(&self, root: &Utf8Path) -> Result<(), PluginError> {
        self.become_current(&self.key(root)?)
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
        // La chiave si risolve **prima** del prestito, per la ragione di
        // [`key`](Host::key): nel ramo che non conosce il nome dato c'è
        // una domanda al disco, e il prestito delle sessioni non la attraversa.
        let named = vault
            .map(|path| self.key(Utf8Path::new(path)))
            .transpose()?;
        let sessions = self.sessions.read()?;
        let key = match named {
            Some(key) => key,
            None => sessions
                .current()
                .cloned()
                .ok_or_else(|| PluginError::NotFound("Nessun vault aperto.".into()))?,
        };
        let session = sessions.open.get(&key).ok_or_else(|| {
            PluginError::NotFound(format!("Nessun vault aperto su {key}.").into())
        })?;
        Ok(f(session))
    }

    /// Come [`with_session`](Host::with_session), per chi **dentro** la sessione
    /// può fallire — cioè per chiunque prenda un prestito del workspace, da
    /// quando prenderlo è una domanda che può rispondere di no (decisione 0120).
    ///
    /// Esiste per non lasciare in giro `Result<Result<_, _>, _>`: due errori
    /// della stessa specie, uno dentro l'altro, si appiattiscono qui una volta
    /// invece che a ogni chiamante.
    pub fn in_session<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&VaultSession) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.with_session(vault, f)?
    }

    /// Esegue una lettura breve sul workspace selezionato. La custodia non
    /// attraversa questa porta: i consumer dell'host ricevono operazioni, non
    /// l'oggetto monolitico che le implementa.
    fn read_workspace<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&Workspace) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.in_session(vault, |session| {
            let workspace = session.workspace.read()?;
            f(&workspace)
        })
    }

    /// Gemello esclusivo di [`read_workspace`](Self::read_workspace). Resta
    /// privato proprio per impedire che il vecchio `Host::workspace` rinasca
    /// come una closure generica esposta ai consumer.
    fn write_workspace<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&mut Workspace) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.in_session(vault, |session| {
            let mut workspace = session.workspace.write()?;
            f(&mut workspace)
        })
    }

    /// Sorgente e revisione dalla stessa lettura.
    pub fn read_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<(String, Revision), PluginError> {
        self.read_workspace(vault, |workspace| {
            let source = workspace.read_source(id).map_err(PluginError::from)?;
            let revision = Revision::of(&source);
            Ok((source, revision))
        })
    }

    pub fn write_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace
                .write_document(id, source, base)
                .map_err(PluginError::from)
        })
    }

    pub fn save_draft(
        &self,
        vault: Option<&str>,
        id: &DocId,
        text: &str,
        base: Option<Revision>,
    ) -> Result<(), PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace.save_draft(id, text, base).map_err(|error| {
                PluginError::Internal(format!("draft not written: {error}").into())
            })
        })
    }

    pub fn discard_draft(&self, vault: Option<&str>, id: &DocId) -> Result<(), PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace.discard_draft(id).map_err(|error| {
                PluginError::Internal(format!("draft not discarded: {error}").into())
            })
        })
    }

    pub fn set_active_context(
        &self,
        vault: Option<&str>,
        context: Option<ViewContext>,
    ) -> Result<Vec<String>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.set_active_context(context)))
    }

    pub fn views(&self, vault: Option<&str>) -> Result<Vec<ViewSpec>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.views()))
    }

    pub fn render_view(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
    ) -> Result<UiNode, PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        let prepared = {
            let ws = workspace.read()?;
            ws.prepare_view_render(instance)?
        };
        let detached = JobHost::new(workspace.clone(), prepared.owner().to_string())
            .for_view_instance(prepared.instance_id().to_string());
        let outcome = prepared.invoke(&detached);
        let ws = workspace.read()?;
        ws.finish_view_render(prepared, outcome)
    }

    pub fn view_action(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
        action: UiAction,
    ) -> Result<ViewUpdate, PluginError> {
        self.write_workspace(vault, |workspace| workspace.view_action(instance, action))
    }

    pub fn commands(&self, vault: Option<&str>) -> Result<Vec<CommandSpec>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.commands()))
    }

    pub fn invoke_user_command(
        &self,
        vault: Option<&str>,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        // La sessione si risolve prima e si conserva soltanto la Custody: il
        // registro delle sessioni non attraversa codice del provider.
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        // Il turno serializza gli altri writer ma **non** è il RwLock del
        // workspace: fra prepare e finalize i reader possono entrare, e il
        // callback può rientrare sullo stesso thread per singola capacità.
        let _turn = workspace.write_turn();
        let mut prepared = {
            let mut ws = workspace.write()?;
            match ws.prepare_provider_command(command, args.clone(), mode, Actor::User)? {
                Some(prepared) => prepared,
                None => return ws.invoke_command(command, args, mode, Actor::User),
            }
        };

        let owner = prepared.owner().to_string();
        let host_mode = prepared.host_mode();
        let outcome = if let Some(why) = prepared.read_only_reason() {
            let host = JobHost::new(workspace.clone(), owner).in_mode(host_mode);
            let mut host = Guard::new(host, ReadOnly { why });
            prepared.invoke(&mut host)
        } else {
            let mut host = JobHost::new(workspace.clone(), owner).in_mode(host_mode);
            prepared.invoke(&mut host)
        };

        let mut ws = workspace.write()?;
        ws.finish_provider_command(prepared, outcome)
    }

    pub fn view_state(
        &self,
        vault: Option<&str>,
        owner: &str,
        instance: &str,
        key: &str,
    ) -> Result<Option<serde_json::Value>, PluginError> {
        self.read_workspace(vault, |workspace| {
            Ok(workspace.view_state(owner, instance, key))
        })
    }

    pub fn set_view_state(
        &self,
        vault: Option<&str>,
        owner: &str,
        instance: &str,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        self.read_workspace(vault, |workspace| {
            workspace
                .set_view_state(owner, instance, key, value)
                .map_err(|error| PluginError::Io(error.into()))
        })
    }

    /// Accesso al workspace soltanto nei build di debug, per i banchi interni.
    /// La shell e i consumer di produzione non ricevono più questa capacità.
    #[cfg(debug_assertions)]
    #[doc(hidden)]
    pub fn debug_workspace(&self, vault: Option<&str>) -> Result<Custody<Workspace>, PluginError> {
        self.with_session(vault, |session| session.workspace.clone())
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

    /// Rileggere una versione passa dall'host come tutto il resto: l'host presta
    /// al versioning le sue stesse capacità, non una scorciatoia sul filesystem.
    ///
    /// **`with_read_host` e non `with_host`**, cioè il prestito **condiviso**.
    /// Rileggere una versione è una lettura, e prendere qui l'esclusivo ferma
    /// chi scrive per il tempo di una lettura da disco — il difetto che la
    /// [0024] ha misurato e per cui il workspace sta dietro un `RwLock`. Ci si
    /// arrivava per una premessa che oggi è falsa: che un host lo desse solo un
    /// `&mut Workspace`. Ne esiste uno di sola lettura dalla [0021], e da lì una
    /// lettura si serve leggendo.
    ///
    /// **A dirlo è un banco e non il compilatore**, e va scritto perché la cosa
    /// ovvia è sbagliata: `VersionStore::read` chiede un `&dyn ReadApi`, ma un
    /// `&mut dyn HostApi` ci si converte da sé — `HostApi: ReadApi`, e Rust sa
    /// risalire una supertrait. Rimettere qui `write()` compila senza una parola.
    /// Chi se ne accorge è
    /// `rileggere_una_versione_non_ferma_chi_scrive` (`tests/concorrenza.rs`),
    /// accanto ai tre presidi che la 0024 aveva già lasciato.
    ///
    /// [0024]: ../../../docs/decisions/README.md
    /// [0021]: ../../../docs/decisions/0185-capability-un-solo-guard.md
    #[cfg(feature = "versioning")]
    pub fn read_version(
        &self,
        vault: Option<&str>,
        id: &DocId,
        ts: u64,
    ) -> Result<String, PluginError> {
        let store = self.versions(vault)?;
        self.read_workspace(vault, |workspace| {
            workspace.with_read_host(VERSIONING_ID, |host| store.read(id, ts, host))
        })
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
        // **Detta**, come l'importer (§18.1): un ripristino non discende dal
        // testo che c'è adesso — lo sostituisce **apposta**.
        self.write_document(vault, id, &source, WriteBase::Dictated)
            .map(|_| ())
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
                .map_err(|and| PluginError::Io(and.into()))
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
                .map_err(|and| PluginError::Io(and.into()))
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
                .map_err(|and| PluginError::Io(and.into()))
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
                .map_err(|and| PluginError::Io(and.into()))
        })?
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

#[cfg(all(test, feature = "versioning"))]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use camino::Utf8PathBuf;
    use fub_kernel::FormatRegistry;

    use super::*;

    #[test]
    fn read_version_host_takes_a_shared_workspace_borrow() {
        let dir = match tempfile::tempdir() {
            Ok(dir) => dir,
            Err(error) => panic!("tempdir: {error}"),
        };
        let root = match Utf8PathBuf::from_path_buf(dir.path().to_path_buf()) {
            Ok(root) => root,
            Err(path) => panic!("path is not utf8: {path:?}"),
        };
        let registry = FormatRegistry::new();
        let workspace = match Workspace::new(&root, registry) {
            Ok(workspace) => workspace,
            Err(error) => panic!("workspace opens: {error}"),
        };
        let mut workspace = workspace;
        if let Err(error) = workspace.register_core_feature(VERSIONING_ID, "Versioning") {
            panic!("versioning registers: {error}");
        }
        let workspace = Custody::new("test workspace", workspace);
        let inside = match workspace.read() {
            Ok(inside) => inside,
            Err(error) => panic!("workspace is not poisoned: {error}"),
        };
        let (send, receive) = mpsc::channel();
        let worker_workspace = workspace.clone();
        let worker = std::thread::spawn(move || {
            let result = with_read_version_host(&worker_workspace, |_| ());
            let _ = send.send(result);
        });

        let result = match receive.recv_timeout(Duration::from_secs(1)) {
            Ok(result) => result,
            Err(error) => panic!("a shared reader is blocked by another shared reader: {error}"),
        };
        drop(inside);
        if let Err(error) = worker.join() {
            panic!("reader thread panicked: {error:?}");
        }
        assert!(result.is_ok(), "read host is unavailable: {result:?}");
    }
}
