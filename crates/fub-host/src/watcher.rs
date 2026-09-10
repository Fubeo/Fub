//! Chi vede le scritture altrui, dietro un trait.
//!
//! Il watcher era un `Box<dyn Any + Send>` dentro la sessione dell'app: un
//! oggetto senza tipo, tenuto vivo e basta, e con un'unica implementazione
//! possibile perché il codice che lo costruiva era lo stesso che lo usava.
//! Dietro un trait diventa una **scelta di chi monta**, ed è la scelta che i
//! cinque clienti del §8.2 fanno diversa: sul desktop c'è `notify`, sugli e2e
//! headless non serve, su PWA (26.3) e mobile (26.2) non esiste.
//!
//! Due implementazioni fin da subito, e non per simmetria: un'astrazione con un
//! solo cliente non è un'astrazione — è la stessa ragione per cui il §15.1
//! chiede un `MemStorage` accanto a `FsStorage`.
//!
//! **E il rilevatore può morire** (§9.7,
//! [decisione 0030](../../../docs/decisions/0183-composizione-host-kernel.md)).
//! Prima [`VaultWatcher::is_watching`] rispondeva *per costruzione* — `false`
//! per [`NoWatcher`], `true` per un debouncer **avviato** — e nessuno gliela
//! chiedeva: un debouncer che moriva continuava a rispondere `true` per sempre.
//! Adesso la risposta è una bandiera condivisa che il kernel presta
//! (`Workspace::watch_flag`), il debouncer la abbassa quando riporta errori e
//! quando smette, e chiunque può leggerla dal canale dati
//! (`IndexQuery::VaultStatus`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::{PluginError, Severity};
use fub_kernel::workspace::{ParsedExternalDocumentRename, PreparedExternalDocumentRename};
use fub_kernel::{
    ExternalRenamePlan, ParsedChange, ParsedExternalAssetRename, ParsedExternalRename,
    PreparedExternalAssetRename, PreparedIgnoreCheck, SyncPlan, Workspace,
};

use crate::custody::{Custody, WriteTurn};
use crate::jobs::{drain_events, with_event_drain};

/// Un rilevatore vivo: si tiene, e quando cade smette di guardare.
///
/// Il metodo è uno solo perché uno solo è ciò che l'host vorrà davvero sapere
/// di un watcher. Senza di lui il trait sarebbe `Box<dyn Any + Send>` con un
/// nome nuovo, che è esattamente il punto di partenza.
/// **`Sync` e non solo `Send`**, e non è un vezzo: un rilevatore vive dentro la
/// mappa delle sessioni, e da quando quella mappa sta dietro la porta unica
/// della [decisione 0120] la si presta **in condivisione** a più thread insieme.
/// La premessa che quella decisione ha rotto è che «un `RwLock` sia un `Mutex`
/// con un permesso in più»: `Mutex<T>` è `Sync` per ogni `T: Send`, perché
/// presta a uno alla volta; `RwLock<T>` lo è solo per `T: Send + Sync`. Il
/// rilevatore stava in una mappa condivisa contando su un lucchetto che non lo
/// prestava mai a due lettori — cioè su una proprietà che nessuno aveva scelto.
///
/// **Lasciarne andare uno vuol dire che ha finito** (difetto 0159). Un
/// rilevatore consegna da un thread suo, e quel thread entra nel workspace in
/// scrittura: chi chiude un vault lascia andare il rilevatore **per primo**
/// proprio perché nessun altro possa più entrarci, e un `Drop` che torna mentre
/// una consegna è ancora in volo rende quell'ordine una dichiarazione senza
/// effetto. Chi implementa questo trait aspetta i propri thread dentro il
/// proprio `Drop`; chi non ne ha — [`NoWatcher`] — non ha niente da aspettare.
///
/// [decisione 0120]: ../../../docs/decisions/README.md
pub trait VaultWatcher: Send + Sync {
    /// `true` se questo vault ha il rilevamento delle modifiche esterne
    /// **adesso**.
    ///
    /// Non «è stato avviato»: un debouncer che riporta errori ha smesso di
    /// guardare, e da quel momento risponde `false` (§9.7). È la stessa
    /// risposta che il canale dati serve come
    /// `VaultStatus.watching`, perché è lo stesso `AtomicBool`: due copie
    /// sarebbero due verità, e la seconda mentirebbe in silenzio.
    fn is_watching(&self) -> bool;
}

/// Chi sa avviare un rilevatore su una radice.
///
/// Sta separato dal watcher perché è la parte che si sceglie **prima** di avere
/// un vault: `Host::with_watcher` la prende una volta, e ogni apertura la usa.
pub trait WatcherFactory: Send + Sync {
    /// Avvia il rilevamento su `root`, sincronizzando `workspace` a ogni
    /// cambiamento. L'apertura chiama questo metodo senza un read-lock o un
    /// write-lock del workspace: una fabbrica può quindi verificarlo, leggere o
    /// scrivere sincronicamente durante l'avvio. Il turno di apertura resta
    /// invece prenotato: i thread che consegnano cambiamenti aspettano che il
    /// subscriber live sia registrato prima di iniziare una mutazione.
    ///
    /// `watching` è la bandiera del kernel (`Workspace::watch_flag`): chi
    /// guarda davvero la alza avviandosi e la abbassa quando smette. Chi non
    /// guarda la lascia dov'è, che è `false`.
    fn start(
        &self,
        root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String>;
}

/// Un watcher consegnato alla sessione insieme al rollback della bandiera.
///
/// La fabbrica esterna può restituire un oggetto il cui `Drop` pania. La
/// bandiera non può quindi essere affidata a quel distruttore: questo involucro
/// la abbassa da codice host anche quando la rete trasforma il panico in errore.
pub(crate) struct RunningWatcher {
    watcher: Option<Box<dyn VaultWatcher>>,
    watching: Arc<AtomicBool>,
}

impl RunningWatcher {
    pub(crate) fn is_watching(&self) -> bool {
        let Some(watcher) = self.watcher.as_ref() else {
            return false;
        };
        let status = fub_kernel::safety::external(
            "il watcher è andato in panico mentre dichiarava il proprio stato",
            |message| PluginError::Internal(message.into()),
            || Ok(watcher.is_watching()),
        );
        match status {
            Ok(watching) => watching,
            Err(error) => {
                // Lo stato esterno non è più affidabile, quindi la risposta
                // conservativa è «non sta guardando». Il watcher resta però
                // posseduto dalla sessione: `close` ne esegue ancora il Drop e
                // il reset host della bandiera.
                tracing::error!(target: "fub.host", "watcher status failed: {error}");
                false
            }
        }
    }

    /// Ferma esplicitamente il watcher e conserva l'errore per chi chiude.
    pub(crate) fn stop(mut self) -> Result<(), PluginError> {
        self.stop_inner()
    }

    fn stop_inner(&mut self) -> Result<(), PluginError> {
        // Nasce prima della chiamata esterna e vive fuori dalla closure: anche
        // se `drop` pania, `external` prende il panico e poi questo guardiano
        // abbassa la bandiera prima che il risultato torni al chiamante.
        let reset = WatchFlagReset::new(Arc::clone(&self.watching));
        let result = match self.watcher.take() {
            Some(watcher) => fub_kernel::safety::external(
                "il watcher è andato in panico mentre smetteva di guardare il vault",
                |message| PluginError::Internal(message.into()),
                || {
                    drop(watcher);
                    Ok(())
                },
            ),
            None => Ok(()),
        };
        drop(reset);
        result
    }
}

impl Drop for RunningWatcher {
    fn drop(&mut self) {
        if let Err(error) = self.stop_inner() {
            tracing::error!(target: "fub.host", "watcher rollback failed: {error}");
        }
    }
}

/// Abbassa una bandiera su ogni uscita finché il proprietario non lo disarma.
struct WatchFlagReset {
    watching: Arc<AtomicBool>,
    armed: bool,
}

impl WatchFlagReset {
    fn new(watching: Arc<AtomicBool>) -> Self {
        Self {
            watching,
            armed: true,
        }
    }

    fn disarm(mut self) {
        self.armed = false;
    }
}

impl Drop for WatchFlagReset {
    fn drop(&mut self) {
        if self.armed {
            self.watching.store(false, Ordering::Relaxed);
        }
    }
}

/// Il tratto d'apertura che possiede insieme writer turn e watcher.
///
/// Su qualunque `?` successivo a `start`, il `Drop` rilascia prima il turno e
/// soltanto dopo lascia che il watcher fermi o raggiunga i propri thread. Un
/// worker già in attesa di scrivere può così progredire e terminare invece di
/// essere atteso da chi conserva ancora il turno che gli serve.
pub(crate) struct OpeningWatcher<'a> {
    turn: Option<WriteTurn<'a, Workspace>>,
    watcher: Option<RunningWatcher>,
}

impl<'a> OpeningWatcher<'a> {
    pub(crate) fn new(workspace: &'a Custody<Workspace>) -> Self {
        Self {
            turn: Some(workspace.write_turn()),
            watcher: None,
        }
    }

    pub(crate) fn start(
        &mut self,
        factory: &dyn WatcherFactory,
        root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<(), PluginError> {
        assert!(
            self.watcher.is_none(),
            "an opening can start exactly one watcher"
        );
        self.watcher = Some(start_safely(factory, root, workspace, watching)?);
        Ok(())
    }

    /// Pubblica il watcher solo dopo avere liberato il writer turn.
    pub(crate) fn finish(mut self) -> RunningWatcher {
        drop(self.turn.take());
        self.watcher
            .take()
            .expect("an opening watcher is finished only after start")
    }
}

impl Drop for OpeningWatcher<'_> {
    fn drop(&mut self) {
        drop(self.turn.take());
        drop(self.watcher.take());
    }
}

/// Attraversa la fabbrica esterna con la rete dei provider, prima che esista un
/// bus su cui poter riportare il guasto.
fn start_safely(
    factory: &dyn WatcherFactory,
    root: &Utf8Path,
    workspace: Custody<Workspace>,
    watching: Arc<AtomicBool>,
) -> Result<RunningWatcher, PluginError> {
    // Una fabbrica può alzare la bandiera e poi rispondere con errore o
    // paniare. Finché non esiste un `RunningWatcher`, il rollback appartiene a
    // questa chiamata e deve coprire entrambe le uscite.
    let reset = WatchFlagReset::new(Arc::clone(&watching));
    let watcher = fub_kernel::safety::external(
        "la fabbrica del watcher è andata in panico durante l'avvio",
        |message| PluginError::Internal(message.into()),
        || {
            factory
                .start(root, workspace, Arc::clone(&watching))
                .map_err(|message| PluginError::Io(message.into()))
        },
    )?;
    reset.disarm();
    Ok(RunningWatcher {
        watcher: Some(watcher),
        watching,
    })
}

/// Nessun rilevamento: il vault cambia solo attraverso Fub.
///
/// È l'implementazione onesta per chi non ha un watcher — e non un ripiego: un
/// e2e headless (27.4) che aprisse un debouncer vero starebbe provando anche il
/// debouncer, e un test che fallisce per il filesystem non dice più niente su
/// ciò che doveva provare.
///
/// Serve sia da fabbrica sia da rilevatore: non c'è niente da tenere vivo.
pub struct NoWatcher;

impl VaultWatcher for NoWatcher {
    fn is_watching(&self) -> bool {
        false
    }
}

impl WatcherFactory for NoWatcher {
    /// La bandiera resta com'è, cioè `false`: non alzarla è l'unica cosa da
    /// fare, ed è ciò che rende «qui nessuno vede le scritture altrui» un fatto
    /// che si può chiedere invece di una proprietà del montaggio che nessuno
    /// scrive da nessuna parte.
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: Custody<Workspace>,
        _watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        Ok(Box::new(NoWatcher))
    }
}

/// Un cambiamento visto da fuori, **nel vocabolario di nessun rilevatore**.
///
/// I tipi di `notify` restano di là dietro la cargo feature: qui passa ciò che
/// un lotto significa, e significa la stessa cosa se un giorno a formarlo sarà
/// il rilevamento di una piattaforma diversa — o un test, che è il primo
/// cliente non-`notify` che questo tipo ha.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalChange {
    /// Un path che è cambiato: creato, riscritto, sparito. Chi lo riceve non sa
    /// quale dei tre, e non deve: lo scopre il kernel guardando il disco.
    Touched(Utf8PathBuf),
    /// Una rinomina **accoppiata**: la stessa identità, un nome nuovo. Non è
    /// remove+add — la storia del versioning resta attaccata alla nota, e
    /// `DocumentRenamed` viene emesso anche per i rename fatti da
    /// Finder/Obsidian/sync.
    Renamed { from: Utf8PathBuf, to: Utf8PathBuf },
}

/// Ciclo di vita condiviso fra il debouncer e il sincronizzatore.
///
/// Il contatore permette al proprietario del watcher di chiudere gli ingressi
/// e aspettare le sole operazioni già accettate. La `Condvar` rilascia il mutex
/// mentre aspetta.
struct SyncLifecycle {
    state: Mutex<SyncLifecycleState>,
    settled: Condvar,
}

struct SyncLifecycleState {
    accepting: bool,
    in_flight: usize,
}

impl SyncLifecycle {
    fn new() -> Self {
        Self {
            state: Mutex::new(SyncLifecycleState {
                accepting: true,
                in_flight: 0,
            }),
            settled: Condvar::new(),
        }
    }

    fn enter(self: &Arc<Self>) -> Option<SyncOperation> {
        let mut state = self.state.lock().unwrap_or_else(|and| and.into_inner());
        if !state.accepting {
            return None;
        }
        state.in_flight += 1;
        Some(SyncOperation {
            lifecycle: Arc::clone(self),
        })
    }

    fn invalidate_and_wait(&self) {
        let mut state = self.state.lock().unwrap_or_else(|and| and.into_inner());
        state.accepting = false;
        self.settled.notify_all();
        while state.in_flight != 0 {
            state = self
                .settled
                .wait(state)
                .unwrap_or_else(|and| and.into_inner());
        }
    }

    #[cfg(test)]
    fn wait_until_invalidated(&self) {
        let mut state = self.state.lock().unwrap_or_else(|and| and.into_inner());
        while state.accepting {
            state = self
                .settled
                .wait(state)
                .unwrap_or_else(|and| and.into_inner());
        }
    }
}

struct SyncOperation {
    lifecycle: Arc<SyncLifecycle>,
}

impl Drop for SyncOperation {
    fn drop(&mut self) {
        let mut state = self
            .lifecycle
            .state
            .lock()
            .unwrap_or_else(|and| and.into_inner());
        state.in_flight -= 1;
        if state.in_flight == 0 {
            self.lifecycle.settled.notify_all();
        }
    }
}

/// Chi porta nel workspace ciò che è cambiato da fuori, **un lotto alla volta**.
///
/// # Perché è un tipo e non una funzione
///
/// Perché `batch` prende `&mut self`, e questo è l'unico posto in cui l'ordine
/// dei lotti è scritto invece che sperato. Un lotto legge il disco in una fase
/// e muta in un'altra: due lotti che si accavallassero potrebbero applicare in
/// ordine invertito, e il secondo lascerebbe nel workspace lo stato più vecchio
/// dei due. Oggi non si accavallano — il debouncer di `notify` chiama il
/// proprio handler da un thread solo, e l'handler è un `FnMut` — ma «oggi non
/// succede» è la forma di garanzia che la
/// [0024](../../../docs/decisions/README.md) ha
/// già dovuto scrivere in prosa una volta. Qui la dice il prestito: da un
/// `&mut ExternalSync` non se ne ricava un secondo, quindi due lotti sullo
/// stesso sincronizzatore non compilano.
///
/// # Ciclo di vita
///
/// Lo shutdown impedisce nuovi ingressi e aspetta quelli già in volo senza
/// conservare il mutex durante l'attesa. Un lotto accettato completa tutte le
/// sue fasi, compreso il flush, prima che il teardown possa tornare.
///
/// # Le tre fasi, e perché sono tre
///
/// È la regola della 0024 applicata alla porta da cui il vault cambia da fuori:
///
/// 1. **leggere e parsare** i file cambiati sotto prestito **condiviso** — è
///    l'I/O più lungo del lotto, e chi legge (la ricerca, il disegno dei
///    pannelli) non ha niente a che farci;
/// 2. **mutare** il workspace sotto quello esclusivo, con i modelli già in
///    mano;
/// 3. **rendere durevole** con un prestito suo.
///
/// # E il lotto sente rientrare le scritture di Fub
///
/// Non c'è nessun filtro qui che le tolga, e non ci deve essere: un salvataggio
/// del kernel è una rename, `notify` la riporta come qualunque altra, e un
/// rilevatore che provasse a indovinare quali eventi sono suoi si sbaglierebbe
/// nel verso caro — su una rename fatta da un altro processo nello stesso
/// momento. A riconoscerle è il kernel, che le riconosce **per impronta**:
/// `plan_sync` legge il file, e se ne porta l'impronta che l'anagrafe già ha non
/// parsa niente e la fase 2 non applica niente (difetto 0196). Prima, ogni
/// salvataggio di ogni nota tornava dentro riletto, riparsato e reingerito, con
/// un `DocumentChanged` a nome del rilevatore su una modifica che l'utente
/// aveva appena fatto lui.
///
/// La terza fase resta esclusiva, e non per distrazione: `IndexProvider::flush`
/// riceve un `&mut dyn HostApi`, che il kernel costruisce su `&mut Workspace` —
/// finché la firma è quella, la durevolezza degli indici *non può* stare fuori
/// dal prestito esclusivo. Ciò che si compra tenendola in una fase sua è che
/// chi aspetta non aspetta più il lotto **intero**: fra la 2 e la 3 il lucchetto
/// si rilascia, e i lettori in coda passano.
enum WatcherPreflight {
    Sync {
        path: Utf8PathBuf,
        ignore: PreparedIgnoreCheck,
    },
    Rename {
        from: Utf8PathBuf,
        from_ignore: PreparedIgnoreCheck,
        to: Utf8PathBuf,
        to_ignore: PreparedIgnoreCheck,
    },
}

enum PreflightedWatcherChange {
    Sync {
        path: Utf8PathBuf,
        admitted: bool,
    },
    Rename {
        from: Utf8PathBuf,
        from_admitted: bool,
        to: Utf8PathBuf,
        to_admitted: bool,
    },
}

impl WatcherPreflight {
    fn invoke(self) -> PreflightedWatcherChange {
        match self {
            WatcherPreflight::Sync { path, ignore } => PreflightedWatcherChange::Sync {
                path,
                admitted: !ignore.invoke(),
            },
            WatcherPreflight::Rename {
                from,
                from_ignore,
                to,
                to_ignore,
            } => PreflightedWatcherChange::Rename {
                from,
                from_admitted: !from_ignore.invoke(),
                to,
                to_admitted: !to_ignore.invoke(),
            },
        }
    }
}

impl PreflightedWatcherChange {
    fn plan(self, workspace: &Workspace) -> Vec<PlannedWatcherChange> {
        match self {
            PreflightedWatcherChange::Sync { path, admitted } => {
                let plan = admitted
                    .then(|| workspace.plan_sync_admitted(&path))
                    .flatten();
                vec![PlannedWatcherChange::Sync(path, plan)]
            }
            PreflightedWatcherChange::Rename {
                from,
                from_admitted,
                to,
                to_admitted,
            } => match workspace.plan_external_rename_admitted(
                &from,
                from_admitted,
                &to,
                to_admitted,
            ) {
                ExternalRenamePlan::Asset(plan) => {
                    vec![PlannedWatcherChange::Asset(plan)]
                }
                ExternalRenamePlan::Document(plan) => {
                    vec![PlannedWatcherChange::Document(plan)]
                }
                ExternalRenamePlan::Sync(plans) => plans
                    .into_iter()
                    .map(|(path, plan)| PlannedWatcherChange::Sync(path, plan))
                    .collect(),
            },
        }
    }
}

enum PlannedWatcherChange {
    Sync(Utf8PathBuf, Option<SyncPlan>),
    Asset(PreparedExternalAssetRename),
    Document(PreparedExternalDocumentRename),
}

enum InvokedWatcherChange {
    Sync(Utf8PathBuf, Option<ParsedChange>),
    Asset(ParsedExternalAssetRename),
    Document(ParsedExternalDocumentRename),
}

impl PlannedWatcherChange {
    fn invoke(self) -> Vec<InvokedWatcherChange> {
        match self {
            PlannedWatcherChange::Sync(path, plan) => {
                vec![InvokedWatcherChange::Sync(path, plan.map(SyncPlan::invoke))]
            }
            PlannedWatcherChange::Asset(plan) => match plan.invoke() {
                ParsedExternalRename::Asset(parsed) => {
                    vec![InvokedWatcherChange::Asset(parsed)]
                }
                ParsedExternalRename::Sync(changes) => changes
                    .into_iter()
                    .map(|(path, parsed)| InvokedWatcherChange::Sync(path, parsed))
                    .collect(),
            },
            PlannedWatcherChange::Document(plan) => {
                vec![InvokedWatcherChange::Document(plan.invoke())]
            }
        }
    }
}

/// Ripristina sempre il frame di dispatch aperto dal lotto, anche se una fase
/// preparata restituisce un errore o propaga un panico. Il distruttore prende
/// soltanto il breve prestito necessario al kernel: il drain, che può invocare
/// provider, resta esplicitamente fuori.
struct EventDispatchGuard {
    workspace: Custody<Workspace>,
    deferred: Option<fub_kernel::workspace::EventDispatchDeferral>,
}

impl EventDispatchGuard {
    fn new(workspace: &Custody<Workspace>) -> Result<Self, PluginError> {
        let deferred = workspace.write()?.defer_event_dispatch();
        Ok(Self {
            workspace: workspace.clone(),
            deferred: Some(deferred),
        })
    }

    fn restore(mut self) -> Result<(), PluginError> {
        let mut workspace = self.workspace.write()?;
        workspace.restore_event_dispatch(
            self.deferred
                .take()
                .expect("il guard di dispatch è ancora armato"),
        );
        Ok(())
    }
}

impl Drop for EventDispatchGuard {
    fn drop(&mut self) {
        let Some(deferred) = self.deferred.take() else {
            return;
        };
        if let Ok(mut workspace) = self.workspace.write() {
            workspace.restore_event_dispatch(deferred);
        }
    }
}

pub struct ExternalSync {
    workspace: Custody<Workspace>,
    lifecycle: Arc<SyncLifecycle>,
}

impl ExternalSync {
    pub fn new(workspace: Custody<Workspace>) -> Self {
        ExternalSync {
            workspace,
            lifecycle: Arc::new(SyncLifecycle::new()),
        }
    }

    fn lifecycle(&self) -> Arc<SyncLifecycle> {
        Arc::clone(&self.lifecycle)
    }

    /// Applica un lotto di cambiamenti. Vedi le tre fasi nel doc del tipo.
    /// **Un vault avvelenato smette di sincronizzarsi** (decisione 0120), e
    /// smette in silenzio *qui*: la riga che dice perché l'ha già scritta la
    /// porta, una volta sola. Ciò che si perde è il rilevamento — cioè un
    /// derivato — su un vault che è già irrecuperabile.
    pub fn batch(&mut self, changes: &[ExternalChange]) {
        let Some(_operation) = self.lifecycle.enter() else {
            return;
        };
        if changes.is_empty() {
            return;
        }
        // Fase 1a — politica e handle owned, senza I/O, sotto read.
        let preflights = {
            let Ok(ws) = self.workspace.read() else {
                return;
            };
            changes
                .iter()
                .map(|change| match change {
                    ExternalChange::Touched(path) => WatcherPreflight::Sync {
                        path: path.clone(),
                        ignore: ws.prepare_is_ignored(path),
                    },
                    ExternalChange::Renamed { from, to } => WatcherPreflight::Rename {
                        from: from.clone(),
                        from_ignore: ws.prepare_is_ignored(from),
                        to: to.clone(),
                        to_ignore: ws.prepare_is_ignored(to),
                    },
                })
                .collect::<Vec<_>>()
        };
        // Fase 1b — l'eventuale stat file/cartella, fuori da Custody.
        let preflighted = preflights
            .into_iter()
            .map(WatcherPreflight::invoke)
            .collect::<Vec<_>>();
        // Fase 1c — routing e piani puri sotto read, dai soli esiti del filtro.
        let planned = {
            let Ok(ws) = self.workspace.read() else {
                return;
            };
            preflighted
                .into_iter()
                .flat_map(|change| change.plan(&ws))
                .collect::<Vec<_>>()
        };
        // Fase 1d — stat/read/parse e side-data restano fuori da Custody.
        let invoked = planned.into_iter().flat_map(PlannedWatcherChange::invoke);
        if self.apply_batch_prepared(invoked).is_err() {
            return;
        }
        // Fase 3 — la durevolezza.
        self.flush();
    }

    /// **Il primo lotto del rilevatore, calcolato per differenza** (§15.7).
    ///
    /// Il rilevatore comincia a guardare quando chi apre lo avvia, e la
    /// scansione ha fotografato il vault **prima**: in mezzo — tutta la seconda
    /// fase dell'apertura — un cambiamento esterno non è nella fotografia e
    /// non è ancora guardato, e nessun evento lo recuperava fino alla
    /// riapertura. Chi apre chiama questo subito dopo `start`, e la finestra si
    /// chiude: i piani sono la differenza fra il disco adesso e l'anagrafe
    /// della scansione, e si applicano con la stessa porta dei lotti veri —
    /// stesso attore, stesso diritto all'impronta. Un cambiamento caduto nella
    /// finestra esce **una volta sola**: chi è rimasto com'era non si legge
    /// (la cache dei metadati, §14.1), e un lotto del rilevatore che arrivasse
    /// dopo su un path già allineato non trova niente da fare (l'impronta è la
    /// stessa, difetto 0196).
    ///
    /// La scansione, la lettura, il parse e i feed agli indici attraversano
    /// soltanto token owned fuori da `Custody`; sotto prestito restano le
    /// fotografie e le brevi mutazioni del core. Anche un vault senza
    /// rilevatore la chiama: la finestra c'è per ogni fabbrica, e ciò che il
    /// rilevatore avrebbe visto se fosse stato acceso lo vede il workspace.
    pub fn catch_up(&mut self) {
        let Some(_operation) = self.lifecycle.enter() else {
            return;
        };
        let _phase = tracing::info_span!(target: "fub.opening", "catch_up").entered();
        // Fase 1a — soltanto handle e cache owned sotto prestito condiviso.
        let scan = {
            let Ok(ws) = self.workspace.read() else {
                return;
            };
            ws.prepare_catch_up()
        };
        // Fase 1b — camminata e filtro delle impronte fuori da Custody.
        let snapshot = match scan.invoke() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                if let Ok(mut ws) = self.workspace.write() {
                    ws.note_catch_up_failure(error);
                }
                let _ = drain_events(&self.workspace);
                return;
            }
        };
        // Fase 1c — piani puri sullo stato corrente del kernel.
        let plans = {
            let Ok(ws) = self.workspace.read() else {
                return;
            };
            ws.plan_catch_up(snapshot)
        };
        if plans.is_empty() {
            return;
        }
        // Fase 1d — stat-read-stat e Format/Syntax fuori da Custody.
        let prepared = plans
            .into_iter()
            .map(|(path, plan)| InvokedWatcherChange::Sync(path, plan.map(SyncPlan::invoke)));
        if self.apply_batch_prepared(prepared).is_err() {
            return;
        }
        // Fase 3 — la durevolezza.
        self.flush();
    }

    // Il lotto conserva un solo drain, ma ogni feed/rimozione lascia il guard
    // prima di notificare gli indici. Il turno conserva la stessa unità di
    // scrittura.
    fn apply_batch_prepared(
        &self,
        changes: impl IntoIterator<Item = InvokedWatcherChange>,
    ) -> Result<(), PluginError> {
        let _turn = self.workspace.write_turn();
        let dispatch = EventDispatchGuard::new(&self.workspace)?;
        let outcome = (|| {
            for change in changes {
                match change {
                    InvokedWatcherChange::Sync(path, parsed) => {
                        let pending = self
                            .workspace
                            .write()?
                            .prepare_sync_path_prepared(&path, parsed)?;
                        let Some(pending) = pending else {
                            continue;
                        };
                        let completed = pending.invoke();
                        match self.workspace.write()?.finish_sync_path_prepared(completed) {
                            Ok(true) => {}
                            Ok(false) => continue,
                            Err((error, completed)) => {
                                drop(completed);
                                return Err(error);
                            }
                        }
                    }
                    InvokedWatcherChange::Asset(parsed) => {
                        let pending = self
                            .workspace
                            .write()?
                            .prepare_external_asset_rename(parsed);
                        let Some(pending) = pending else {
                            continue;
                        };
                        let completed = pending.invoke();
                        match self
                            .workspace
                            .write()?
                            .finish_external_asset_rename(completed)
                        {
                            Ok(true) => {}
                            Ok(false) => continue,
                            Err((error, completed)) => {
                                drop(completed);
                                return Err(error);
                            }
                        }
                    }
                    InvokedWatcherChange::Document(parsed) => {
                        let pending = self
                            .workspace
                            .write()?
                            .prepare_external_document_rename(parsed)?;
                        let Some(pending) = pending else {
                            continue;
                        };
                        let completed = pending.invoke();
                        match self
                            .workspace
                            .write()?
                            .finish_external_document_rename(completed)
                        {
                            Ok(true) => {}
                            Ok(false) => continue,
                            Err((error, completed)) => {
                                drop(completed);
                                return Err(error);
                            }
                        }
                    }
                }
            }
            Ok(())
        })();
        let restored = dispatch.restore();
        let drained = drain_events(&self.workspace);
        outcome.and(restored).and(drained)
    }

    /// Fine del lotto: è il punto tranquillo in cui rendere durevoli gli indici.
    /// Il kernel non sa quando finisce un lotto — lo sa chi il lotto lo ha
    /// formato.
    ///
    /// Un flush che non scrive perde un **derivato** (0052: `Warning`), ed è una
    /// perdita che l'utente ha il diritto di sapere: chi cerca, fino alla
    /// prossima apertura, riceve una risposta incompleta. Pavimento e porta
    /// insieme (0062): una riga nel log, una nel canale.
    fn flush(&mut self) {
        let Ok(flush_errors) = crate::teardown::flush_indexes(&self.workspace) else {
            return;
        };
        if flush_errors.is_empty() {
            return;
        }
        for error in &flush_errors {
            tracing::warn!(target: "fub.host", "flush index: {error}");
        }
        let _ = with_event_drain(&self.workspace, |ws| {
            for error in flush_errors {
                ws.report_host_trouble(
                    Severity::Warning,
                    PluginError::Internal(format!("flush index: {error}").into()),
                );
            }
        });
    }

    /// **Il rilevamento è finito, e da adesso si vede** (§9.7). Un errore del
    /// debouncer non è un evento perso: è che questo vault ha smesso di sapere
    /// quando cambia da fuori — limite di inotify su un vault grande, un network
    /// share che si stacca. Non è la perdita di un dato ma la perdita di un
    /// meccanismo: da qui in poi l'indice drifta in silenzio, e non sapere che
    /// il rilevamento è morto è esattamente il caso in cui il canale serve.
    /// `Failure` perché ciò che si perde non si ricostruisce riaprendo il vault
    /// — il rilevamento va riallacciato a mano.
    /// È `pub` come `batch`, e per la stessa ragione: le due cose che un
    /// rilevatore ha da dire al workspace sono «ecco cosa è cambiato» e «ho
    /// smesso di vedere», e la seconda non è meno di `notify` della prima.
    pub fn watch_died(&mut self, reasons: Vec<String>) {
        // I motivi si scrivono nel log **prima** del prestito: se il vault è
        // avvelenato il canale degli eventi non c'è più, e la ragione per cui
        // il rilevamento è morto resterebbe l'unica cosa che nessuno ha detto.
        for reason in &reasons {
            tracing::error!(target: "fub.host", "{reason}");
        }
        let _ = with_event_drain(&self.workspace, |ws| {
            for reason in reasons {
                ws.report_host_trouble(Severity::Failure, PluginError::Internal(reason.into()));
            }
        });
    }
}

#[cfg(feature = "notify-watcher")]
pub use notify_watcher::NotifyWatcher;

#[cfg(feature = "notify-watcher")]
mod notify_watcher {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use crate::custody::Custody;
    use std::time::Duration;

    use camino::{Utf8Path, Utf8PathBuf};
    use fub_kernel::Workspace;
    use notify::event::{EventKind, MetadataKind, ModifyKind, RenameMode};
    use notify::{RecommendedWatcher, RecursiveMode};
    use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

    use super::{ExternalChange, ExternalSync, SyncLifecycle, VaultWatcher, WatcherFactory};

    /// Il rilevatore di default: `notify` con un debouncer da 300 ms.
    pub struct NotifyWatcher;

    /// Il debouncer vivo, **e il thread che consegna i lotti**.
    ///
    /// Il tipo concreto di `notify_debouncer_full` è parametrico sul backend
    /// della piattaforma, e per questo stava dietro un `dyn Any`: interessava
    /// solo che stesse in piedi finché la sessione è aperta. Ma non interessava
    /// solo quello (difetto 0159): interessa anche **smettere per davvero**, e
    /// smettere aspettando è `Debouncer::stop`, che prende il `self` concreto —
    /// un `Any` non lo sa fare. Il prezzo è il nome del backend scritto qui; ciò
    /// che si compra è che chiudere un vault voglia dire che nessuno ci sta più
    /// scrivendo dentro.
    struct Debounced {
        /// `Option` perché `stop` vuole il debouncer per valore e un `drop` ha
        /// solo un `&mut`: la `take` è il ponte fra i due.
        ///
        /// `+ Sync` (decisione 0120, le sessioni si prestano in condivisione) è
        /// una proprietà del tipo concreto e non più una richiesta scritta qui:
        /// se un backend smettesse di averlo, a dirlo sarebbe il compilatore su
        /// `Box<dyn VaultWatcher>`.
        debouncer: Option<Debouncer<RecommendedWatcher, RecommendedCache>>,
        /// La bandiera del kernel, che questo debouncer possiede finché è vivo.
        watching: Arc<AtomicBool>,
        lifecycle: Arc<SyncLifecycle>,
    }

    impl VaultWatcher for Debounced {
        fn is_watching(&self) -> bool {
            self.watching.load(Ordering::Relaxed)
        }
    }

    impl Drop for Debounced {
        /// **Chi smette lo dice, e chi chiude aspetta che abbia smesso.**
        ///
        /// La bandiera è la metà che c'era già: senza, resterebbe alzata su una
        /// sessione che non guarda più niente, che è la stessa bugia di prima
        /// spostata di un momento (§9.7).
        ///
        /// L'altra metà è la 0159. Prima lo shutdown dipendeva soltanto dal
        /// comportamento interno del debouncer. Adesso chiude gli ingressi di
        /// [`ExternalSync`] e aspetta che le consegne già accettate completino
        /// anche la propria durevolezza; solo dopo ferma il worker e abbassa la
        /// bandiera. La `Condvar` rilascia il proprio mutex mentre aspetta,
        /// quindi un lotto in volo può uscire e notificare la chiusura.
        fn drop(&mut self) {
            self.lifecycle.invalidate_and_wait();
            if let Some(debouncer) = self.debouncer.take() {
                debouncer.stop();
            }
            self.watching.store(false, Ordering::Release);
        }
    }

    /// Se questo evento dice che **qualcosa è cambiato**, o solo che qualcuno
    /// ha guardato.
    ///
    /// La distinzione non è un'ottimizzazione: un rilevatore che confonde la
    /// lettura con la scrittura non rileva le scritture altrui — rileva anche le
    /// proprie letture, e le proprie letture le fa in risposta a ciò che ha
    /// rilevato. Il verso in cui si sbaglia, nel dubbio, è quello di
    /// **considerarlo un cambiamento**: `Any` e `Other` arrivano dai backend che
    /// non sanno dire cosa è successo, e lì una rilettura di troppo costa un
    /// file aperto, mentre una di meno costa un indice che drifta in silenzio.
    fn is_a_change(event: &notify_debouncer_full::DebouncedEvent) -> bool {
        is_a_change_kind(&event.kind)
    }

    /// Il vocabolario di `notify` tradotto in quello del lotto.
    ///
    /// `Both` porta già i due path ed è una migrazione esplicita. Due metà
    /// `From`/`To` diventano una migrazione soltanto quando lo stesso tracker
    /// non nullo identifica esattamente una partenza e un arrivo nel lotto.
    /// Metà orfane, tracker assenti e tracker ambigui restano path toccati: i
    /// byte uguali non sono una prova d'identità.
    fn changes(events: Vec<notify_debouncer_full::DebouncedEvent>) -> Vec<ExternalChange> {
        let mut halves: HashMap<usize, (Option<usize>, Option<usize>, bool)> = HashMap::new();
        for (index, event) in events.iter().enumerate() {
            let slot = match &event.kind {
                EventKind::Modify(ModifyKind::Name(RenameMode::From)) => 0,
                EventKind::Modify(ModifyKind::Name(RenameMode::To)) => 1,
                _ => continue,
            };
            let Some(tracker) = event.tracker() else {
                continue;
            };
            let pair = halves.entry(tracker).or_default();
            let occupied = if slot == 0 {
                pair.0.replace(index).is_some()
            } else {
                pair.1.replace(index).is_some()
            };
            pair.2 |= occupied;
        }

        let mut out = Vec::new();
        for (index, event) in events.iter().enumerate() {
            if matches!(
                &event.kind,
                EventKind::Modify(ModifyKind::Name(RenameMode::Both))
            ) && event.paths.len() == 2
            {
                if let (Ok(from), Ok(to)) = (
                    Utf8PathBuf::from_path_buf(event.paths[0].clone()),
                    Utf8PathBuf::from_path_buf(event.paths[1].clone()),
                ) {
                    out.push(ExternalChange::Renamed { from, to });
                    continue;
                }
            }

            if matches!(
                &event.kind,
                EventKind::Modify(ModifyKind::Name(RenameMode::From | RenameMode::To))
            ) {
                if let Some((Some(from_index), Some(to_index), false)) =
                    event.tracker().and_then(|tracker| halves.get(&tracker))
                {
                    let from = &events[*from_index];
                    let to = &events[*to_index];
                    if from.paths.len() == 1 && to.paths.len() == 1 {
                        if let (Ok(from), Ok(to)) = (
                            Utf8PathBuf::from_path_buf(from.paths[0].clone()),
                            Utf8PathBuf::from_path_buf(to.paths[0].clone()),
                        ) {
                            if index == *from_index {
                                out.push(ExternalChange::Renamed { from, to });
                            }
                            continue;
                        }
                    }
                }
            }

            for path in &event.paths {
                if let Ok(p) = Utf8PathBuf::from_path_buf(path.clone()) {
                    out.push(ExternalChange::Touched(p));
                }
            }
        }
        out
    }

    fn is_a_change_kind(kind: &EventKind) -> bool {
        match kind {
            // Aperture, letture, chiusure: nessun byte è diverso da prima.
            EventKind::Access(_) => false,
            // L'atime è la traccia di una lettura, scritta dal filesystem: è la
            // stessa cosa detta come metadato.
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)) => false,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => true,
            EventKind::Any | EventKind::Other => true,
        }
    }

    impl WatcherFactory for NotifyWatcher {
        fn start(
            &self,
            root: &Utf8Path,
            workspace: Custody<Workspace>,
            watching: Arc<AtomicBool>,
        ) -> Result<Box<dyn VaultWatcher>, String> {
            let failed = watching.clone();
            // Il sincronizzatore è **uno** e la chiusura lo possiede: è il modo
            // in cui l'ordine dei lotti smette di dipendere da quanti thread
            // `notify` decide di usare (vedi il doc di `ExternalSync`).
            let mut sync = ExternalSync::new(workspace);
            let lifecycle = sync.lifecycle();
            let mut debouncer = new_debouncer(
                Duration::from_millis(300),
                None,
                move |result: DebounceEventResult| match result {
                    Ok(events) => {
                        // **Leggere un file non è cambiarlo.** inotify riporta
                        // anche le aperture e gli accessi (`Access(Open)`,
                        // `Access(Close(Read))`, e l'atime che ne segue), e chi
                        // apre i documenti di questo vault più spesso di
                        // chiunque altro è Fub stesso: la localizzazione delle
                        // occorrenze (§21.3) apre il sorgente di ogni riga di
                        // una pagina di risultati. Trattare quelle aperture come
                        // cambiamenti chiudeva un anello: una ricerca leggeva
                        // sessanta note, il rilevatore riferiva sessanta
                        // «modifiche», il kernel rileggeva quelle note per
                        // scoprire che erano identiche — e quelle riletture
                        // erano altre sessanta aperture. Il giro si alimentava
                        // da solo, con un `DocumentChanged` a vuoto e un
                        // `IndexUpdated` per ogni passaggio, finché il ponte non
                        // andava in overflow e la shell non rispondeva più.
                        let events: Vec<_> = events.into_iter().filter(is_a_change).collect();
                        // Un lotto di sole letture non è un lotto: non c'è
                        // niente da sincronizzare e niente da rendere durevole,
                        // e prendere il lucchetto esclusivo per non fare niente
                        // toglierebbe il vault ai lettori a ogni ricerca.
                        if events.is_empty() {
                            return;
                        }
                        sync.batch(&changes(events));
                    }
                    Err(errors) => {
                        let Some(_operation) = sync.lifecycle.enter() else {
                            return;
                        };
                        // Il rilevamento è finito, e da adesso si vede (§9.7):
                        // il perché sta sul metodo che lo racconta.
                        failed.store(false, Ordering::Relaxed);
                        sync.watch_died(
                            errors
                                .iter()
                                .map(|and| format!("watch error: {and:?}"))
                                .collect(),
                        );
                    }
                },
            )
            .map_err(|and| and.to_string())?;
            debouncer
                .watch(root.as_std_path(), RecursiveMode::Recursive)
                .map_err(|and| and.to_string())?;
            // Alzata **dopo** che `watch` è riuscita: fra il debouncer costruito
            // e la radice osservata c'è un errore possibile, e in mezzo la
            // risposta giusta è ancora `false`.
            watching.store(true, Ordering::Relaxed);
            Ok(Box::new(Debounced {
                debouncer: Some(debouncer),
                watching,
                lifecycle,
            }))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use notify::event::{AccessKind, AccessMode, CreateKind, DataChange, RemoveKind};

        /// 0159 — **chi lascia andare il rilevatore aspetta che abbia finito.**
        ///
        /// `VaultSession::close` lascia andare il watcher per primo, e dice
        /// perché: «nessun altro thread deve poter entrare nel vault mentre lo
        /// si chiude». Ma lasciarlo andare non era aspettare che avesse finito —
        /// il `Drop` del debouncer alza una bandiera e torna — e un lotto già
        /// partito continuava per conto suo a sincronizzare e a scrivere indici
        /// dentro un vault chiuso.
        ///
        /// Qui una consegna — riuscita o fallita — resta aperta su un canale.
        /// Il teardown raggiunge deterministicamente l'invalidazione e non può
        /// tornare né abbassare `watching` finché il test non la libera. Nessuno
        /// `sleep` trasforma il tempo della macchina in un segnale.
        #[test]
        fn dropping_the_watcher_waits_for_the_in_flight_delivery() {
            let dir = tempfile::tempdir().expect("a folder to watch");
            let (inside_tx, inside_rx) = std::sync::mpsc::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let lifecycle = Arc::new(SyncLifecycle::new());
            let callback_lifecycle = Arc::clone(&lifecycle);
            let observed_lifecycle = Arc::clone(&lifecycle);
            let delivered = Arc::new(AtomicBool::new(false));
            let batch_done = Arc::clone(&delivered);
            let mut debouncer = new_debouncer(
                Duration::from_millis(20),
                None,
                move |_result: DebounceEventResult| {
                    let Some(operation) = callback_lifecycle.enter() else {
                        return;
                    };
                    inside_tx.send(()).expect("the test waits for the callback");
                    release_rx.recv().expect("the test releases the callback");
                    batch_done.store(true, Ordering::SeqCst);
                    drop(operation);
                },
            )
            .expect("the debouncer starts");
            debouncer
                .watch(dir.path(), RecursiveMode::Recursive)
                .expect("the root is watched");
            let watching = Arc::new(AtomicBool::new(true));
            let watcher = Debounced {
                debouncer: Some(debouncer),
                watching: Arc::clone(&watching),
                lifecycle,
            };

            std::fs::write(dir.path().join("note.md"), b"hello").expect("a file that changes");
            inside_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("the watcher enters its callback");

            let (stopped_tx, stopped_rx) = std::sync::mpsc::channel();
            let stopping = std::thread::spawn(move || {
                drop(watcher);
                stopped_tx.send(()).expect("the test waits for teardown");
            });
            observed_lifecycle.wait_until_invalidated();
            assert!(
                stopped_rx.try_recv().is_err() && watching.load(Ordering::Acquire),
                "teardown returned or lowered watching while a callback was still in flight"
            );
            release_tx.send(()).expect("the callback can finish");
            stopped_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("teardown finishes after the callback");
            stopping.join().expect("teardown does not panic");

            assert!(
                delivered.load(Ordering::SeqCst),
                "the vault closed with a batch still in flight"
            );
            assert!(
                !watching.load(Ordering::Acquire),
                "the watcher lowered its flag before teardown completed"
            );
        }

        /// riporta quando Fub apre un documento per localizzare le occorrenze
        /// di una ricerca: se contassero come cambiamenti, il rilevatore
        /// chiederebbe al kernel di rileggere ciò che il kernel ha appena
        /// letto — e la rilettura sarebbe un'altra apertura.
        /// E ciò che cambia davvero continua ad arrivare: il filtro sta fra le
        #[test]
        fn reading_a_document_is_not_changing_it() {
            for kind in [
                EventKind::Access(AccessKind::Open(AccessMode::Any)),
                EventKind::Access(AccessKind::Read),
                EventKind::Access(AccessKind::Close(AccessMode::Read)),
                EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)),
            ] {
                assert!(!is_a_change_kind(&kind), "{kind:?} is not a change");
            }
        }

        /// letture e le scritture, non fra il rilevatore e il vault.
        // Chi non sa dire cosa è successo va creduto: meglio una
        #[test]
        fn what_changes_still_gets_through() {
            for kind in [
                EventKind::Create(CreateKind::File),
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                EventKind::Remove(RemoveKind::File),
                // rilettura in più di un indice che drifta.
                // **Una rinomina orfana esce lo stesso** (difetto 0199, premessa
                EventKind::Any,
                EventKind::Other,
            ] {
                assert!(is_a_change_kind(&kind), "{kind:?} is a change");
            }
        }

        fn rename_half(
            mode: RenameMode,
            tracker: Option<usize>,
            paths: &[&str],
        ) -> notify_debouncer_full::DebouncedEvent {
            let mut event = notify::Event::new(EventKind::Modify(ModifyKind::Name(mode)));
            for path in paths {
                event = event.add_path((*path).into());
            }
            if let Some(tracker) = tracker {
                event = event.set_tracker(tracker);
            }
            notify_debouncer_full::DebouncedEvent::new(event, std::time::Instant::now())
        }

        #[test]
        fn rename_halves_require_one_shared_tracker_in_the_same_batch() {
            let changes = changes(vec![
                rename_half(RenameMode::From, Some(7), &["tracked-from.md"]),
                rename_half(RenameMode::To, Some(7), &["tracked-to.md"]),
                rename_half(RenameMode::From, None, &["untracked-from.md"]),
                rename_half(RenameMode::To, None, &["untracked-to.md"]),
                rename_half(RenameMode::From, Some(9), &["ambiguous-a.md"]),
                rename_half(RenameMode::From, Some(9), &["ambiguous-b.md"]),
                rename_half(RenameMode::To, Some(9), &["ambiguous-to.md"]),
                rename_half(RenameMode::Both, None, &["both-from.md", "both-to.md"]),
            ]);

            assert_eq!(
                changes,
                vec![
                    ExternalChange::Renamed {
                        from: "tracked-from.md".into(),
                        to: "tracked-to.md".into(),
                    },
                    ExternalChange::Touched("untracked-from.md".into()),
                    ExternalChange::Touched("untracked-to.md".into()),
                    ExternalChange::Touched("ambiguous-a.md".into()),
                    ExternalChange::Touched("ambiguous-b.md".into()),
                    ExternalChange::Touched("ambiguous-to.md".into()),
                    ExternalChange::Renamed {
                        from: "both-from.md".into(),
                        to: "both-to.md".into(),
                    },
                ]
            );
        }

        /// caduta).
        ///
        /// La riga temeva che la metà «da» di una rinomina restasse appesa in
        /// attesa del gemello: chi porta una nota fuori dal vault dal Finder un
        /// evento di arrivo non ce l'ha mai, e il documento sparito dal disco
        /// sarebbe rimasto vivo in anagrafe fino alla riapertura del vault.
        /// Rimisurata, la paura non regge, e il perché sta nel debouncer:
        /// `handle_rename_from` l'evento lo tiene da parte **e** lo mette nella
        /// coda del suo path, e a toglierlo di lì è solo il gemello che si
        /// connette — `push_rename_event` fa `pop_back` sulla coda di partenza
        /// proprio per non dire due volte la stessa mossa. Senza gemello non lo
        /// toglie nessuno, e la coda lo consegna alla scadenza come qualunque
        /// altro evento. Di qua `changes` lo vede a **un path solo** — il ramo
        /// accoppiato pretende `paths.len() == 2` — e lo rende un path toccato,
        /// che è la domanda giusta: il kernel guarda il disco, non trova più
        /// niente e toglie il documento.
        ///
        /// Il banco pretende un ordine fra due fatti e non un tempo (§23.16):
        /// prima la nascita della nota dev'essere stata consegnata, poi la sua
        /// sparizione dev'essere un secondo lotto. Se la metà «da» non uscisse,
        /// il secondo lotto non arriverebbe mai.
        // Fuori dalla cartella guardata: una partenza che non avrà mai un
        #[test]
        fn an_orphan_rename_emerges_as_a_touched_path() {
            let inside = tempfile::tempdir().expect("the watched folder");
            let outside = tempfile::tempdir().expect("a folder nobody watches");
            // FSEvents reports canonical paths on macOS (for example
            // `/private/var` instead of `/var`), so keep the watched root and
            // the expected event path in the same representation.
            let root = inside
                .path()
                .canonicalize()
                .expect("the canonical watched folder");
            let (sender, receiver) = std::sync::mpsc::channel();
            let mut debouncer = new_debouncer(
                Duration::from_millis(20),
                None,
                move |result: DebounceEventResult| {
                    let Ok(events) = result else { return };
                    let events: Vec<_> = events.into_iter().filter(is_a_change).collect();
                    if events.is_empty() {
                        return;
                    }
                    let _ = sender.send(changes(events));
                },
            )
            .expect("a watcher");
            debouncer
                .watch(&root, RecursiveMode::Recursive)
                .expect("watching the folder");

            let notes = root.join("note.md");
            let touched = ExternalChange::Touched(
                Utf8PathBuf::from_path_buf(notes.clone()).expect("a utf-8 path"),
            );
            let arrives = || {
                for _ in 0..50 {
                    if let Ok(batch) = receiver.recv_timeout(Duration::from_millis(100)) {
                        if batch.contains(&touched) {
                            return true;
                        }
                    }
                }
                false
            };

            std::fs::write(&notes, b"hello").expect("a note");
            assert!(
                arrives(),
                "the birth of the note was not delivered: without this \
                 first half the test proves nothing"
            );

            // arrivo da accoppiarci.
            // arrivo da accoppiarci.
            std::fs::rename(&notes, outside.path().join("note.md")).expect("the orphan rename");
            assert!(
                arrives(),
                "the 'from' half of an orphan rename did not come out: the note \
                 is gone from disk and stays alive in the registry until someone \
                 reopens the vault"
            );
        }
    }
}
