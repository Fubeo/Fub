//! **Il runner dei job**: chi possiede i thread su cui gira il lavoro lungo
//! (§9.3, [decisione 0032](../../../docs/decisions/0183-composizione-host-kernel.md)).
//!
//! Il giro c'era per intero e non aveva un chiamante: `spawn_job` accodava
//! ([`Workspace::take_pending_jobs`]), `complete_job` riconsegnava, il test
//! copriva tutto — e in produzione la coda **non la drenava nessuno**. Un job
//! chiesto da una feature restava lì finché il vault non chiudeva.
//!
//! # La forma, in tre righe
//!
//! N thread dedicati. Ognuno aspetta il campanello del kernel
//! ([`JobBell`]), drena la coda, e per ogni job costruisce un [`JobHost`] e
//! chiama [`Plugin::run_job`](fub_abi::traits::Plugin::run_job). Nessuno
//! tiene niente in mano mentre il job gira: il prestito del workspace se lo
//! prende il `JobHost`, una chiamata alla volta
//! ([decisione 0027](../../../docs/decisions/0183-composizione-host-kernel.md)).
//! Il corpo del job lo dà chi possiede i bundle
//! ([decisione 0031](../../../docs/decisions/0183-composizione-host-kernel.md)): la
//! coda dice **quale plugin**, il registry dice **quale codice**.
//!
//! # Le tre cose che un pool deve saper fare, e che non si aggiungono dopo
//!
//! - **Aspettare senza chiedere.** Il campanello è del kernel e lo si prende in
//!   prestito: niente polling, quindi niente intervallo da scegliere.
//! - **Smettere.** La cancellazione è una bandiera per job, e non aggiunge
//!   nessuna capacità al contratto: chi è annullato riceve dei **rifiuti** dal
//!   proprio host. Un job puro che non chiama mai l'host arriva in fondo
//!   comunque, e questo va detto perché è il limite vero.
//! - **Non portarsi via niente.** Un job che pania costa il job: la rete è
//!   quella del kernel ([`fub_kernel::safety`]), qui applicata a `run_job`.
//!
//! # Chi chiude aspetta chi lavora
//!
//! È la domanda che il §9.3 poneva («chi chiude aspetta chi?») e la risposta è
//! la stessa forma della [0029](../../../docs/decisions/0183-composizione-host-kernel.md):
//! **prima si smette di guardare, poi si smette di lavorare, poi si chiude.**
//! Chiudere annulla ogni job in volo e **aspetta** che i thread tornino. Non
//! aspettarli vorrebbe dire lasciare un job che scrive mentre gli indici si
//! chiudono, che è esattamente il caso a due thread contro cui il watcher viene
//! lasciato andare per primo.

use std::any::Any;
use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(test)]
use std::sync::Barrier;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use fub_abi::event::{Actor, Event, Origin};
use fub_abi::traits::{JobId, JobProgress, JobSpec, TimerSchedule};
use fub_abi::{Notice, PluginError};
use fub_kernel::{EventBus, IndexBatchStep, Indexing, JobBell, PendingJob, Workspace};
use jiff::Timestamp;

use crate::wall::{verdict, Position, Zone};

use crate::custody::Custody;
use crate::jobs::{with_event_drain, JobHost};
use crate::records::UnreadDoc;
use crate::registry::BundleRegistry;

mod alarms;
mod pool;
mod shared;

use alarms::Alarms;
pub use pool::JobRunner;
pub use shared::InProgress;
use shared::Shared;

/// Quanti thread, se non lo dice nessuno.
///
/// **Due**, e nessuna delle due metà del numero è arbitraria. Non uno, perché un
/// job che aspetta la rete non deve tenere fermo un job che calcola — è la
/// ragione per cui un pool esiste invece di un worker. Non «quanti core»,
/// perché il parallelismo utile non lo limitano i core: lo limita il `RwLock`
/// del workspace ([decisione 0024](../../../docs/decisions/README.md)),
/// e due job che scrivono si mettono in fila comunque. Un pool grande
/// comprerebbe contesa, non velocità.
///
/// È un default e non una costante del disegno: chi monta lo cambia
/// (`Host::with_job_threads`), e il giorno che una misura dirà un altro numero
/// sarà quella a dirlo.
pub const DEFAULT_JOB_THREADS: usize = 2;

/// Le bandiere dell'annullamento, e **fin dove il pool è arrivato**.
///
/// Le due cose stanno sotto lo stesso lock perché una si legge solo insieme
/// all'altra: senza il secondo campo, «annulla» non saprebbe distinguere un job
/// che deve ancora partire da uno che è già finito, e siccome il primo caso
/// obbliga a creare la bandiera, il secondo ne creerebbe una che nessuno
/// toglierà mai — una perdita piccola, per sempre, a ogni pulsante premuto
/// tardi (§10.3).
#[derive(Default)]
struct Flags {
    /// Una bandiera per job **vivo**: dal momento in cui il pool lo prende in
    /// carico a quello in cui ne riconsegna l'esito. Ci finisce prima anche un
    /// job annullato mentre è ancora in coda, perché annullarlo un istante
    /// prima che parta deve valere quanto annullarlo in volo.
    live: HashMap<JobId, Arc<AtomicBool>>,
    /// L'id più alto che il pool abbia mai preso in carico, o `None` finché non
    /// ha drenato niente.
    ///
    /// È un confine e non una statistica: il kernel assegna gli id in ordine e
    /// un drenaggio prende **tutta** la coda, quindi un id oltre questo segno è
    /// un job che deve ancora arrivare, e un id sotto che non è fra i vivi è un
    /// job già finito.
    seen: Option<u64>,
}

impl Flags {
    /// **Prende in carico** un job appena drenato: da qui ha una bandiera, e il
    /// segno si sposta fin dove il pool è arrivato.
    ///
    /// Le bandiere nascono qui e non quando il job parte, ed è ciò che rende
    /// vero il confine: un lotto si esegue uno alla volta, quindi fra il
    /// drenaggio e l'esecuzione i suoi job aspettano il proprio turno dentro un
    /// thread — e in quella finestra sono vivi quanto quello che gira, mentre il
    /// segno può già essere andato avanti per il lotto di un altro.
    fn claim(&mut self, id: JobId) {
        self.live
            .entry(id)
            .or_insert_with(|| Arc::new(AtomicBool::new(false)));
        self.seen = Some(match self.seen {
            Some(seen) => seen.max(id.0),
            None => id.0,
        });
    }

    /// Alza la bandiera di un job, **se ce n'è ancora una da alzare**.
    ///
    /// I due modi di non essere fra i vivi vogliono risposte opposte: oltre il
    /// segno è un job che il pool non ha ancora visto — la bandiera nasce qui,
    /// alzata, e il drenaggio la troverà — mentre sotto il segno è un job già
    /// concluso, e annullarlo non vuol dire niente.
    ///
    /// # Il terzo modo: un id che non è mai stato un job
    ///
    /// «Oltre il segno» da solo non dice «deve ancora partire»: dice «non è
    /// ancora passato di qui», e i numeri che non ci passeranno mai sono
    /// infiniti. L'id di un annullamento **arriva da fuori** — dal pulsante del
    /// centro attività, e sull'IPC come stringa che chiunque può comporre —
    /// quindi un id di un altro vault, o di un elenco vecchio, o inventato,
    /// entrava qui e lasciava una bandiera che nessuno avrebbe mai tolto: solo
    /// `Shared::run` e `advance_opening` chiamano `forget`, e un job che non
    /// esiste non passa né dall'uno né dall'altro.
    ///
    /// Chi sa distinguere i due casi è il kernel, che gli id li **emette**
    /// ([`Workspace::jobs_issued`]): sotto quel segno l'id è stato dato a
    /// qualcuno e la coda lo consegnerà, da lì in su non è mai stato un job e
    /// non c'è niente da aspettare. Non è un tetto prudenziale — è la stessa
    /// domanda del campo `seen`, posta all'unico che ne ha la risposta esatta.
    fn cancel(&mut self, id: JobId, issued: u64) {
        if let Some(flag) = self.live.get(&id) {
            flag.store(true, Ordering::Relaxed);
            return;
        }
        let upcoming = match self.seen {
            Some(seen) => id.0 > seen,
            None => true,
        };
        if upcoming && id.0 < issued {
            self.live.insert(id, Arc::new(AtomicBool::new(true)));
        }
    }

    fn cancel_all(&self) {
        for flag in self.live.values() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// La frase che si dice se il conto dei job in volo è avvelenato.
///
/// Sotto questo lock non gira mai codice di nessuno — ci si scrive un id e si
/// esce — quindi avvelenarlo vuol dire che è panicato il runner stesso, e
/// continuare vorrebbe dire spegnere un componente mentre un suo job è dentro.
/// Al più quanto una fetta dell'indicizzazione aspetta, fra due prese, che
/// chi è in fila sul workspace entri: un lettore entra in microsecondi, e il
/// tetto c'è perché una fila che non si svuota non fermi l'apertura.
pub(crate) const MAKE_WAY: std::time::Duration = std::time::Duration::from_millis(50);

const POISONED: &str = "il conto dei job in volo è avvelenato";

/// Come si dice a un job che non parte, e perché.
///
/// Una funzione e non due frasi uguali in due punti: la stessa riga la scrive
/// chi rifiuta un job intero e chi ne calcola l'esito senza eseguirlo, e sono lo
/// stesso fatto visto da due altezze.
fn refusal(job: &PendingJob, why: &str) -> PluginError {
    PluginError::Cancelled(format!("il job `{}` {why}", job.spec.job).into())
}

/// **Chi è dentro il codice di un bundle adesso, e chi non ci deve più
/// entrare.**
///
/// Risponde a una domanda sola, e nient'altro qui dentro la sa rispondere:
/// *questo componente si può spegnere adesso?* Chi esegue un job tiene una
/// copia del bundle per tutta la durata — [`BundleRegistry::body`] rende un
/// `Arc` apposta, perché un prestito legherebbe il registry per minuti — e
/// finché quella copia esiste `Plugin::deactivate` non si può nemmeno chiamare:
/// vuole `&mut`, e `Arc::get_mut` non lo dà a chi non è solo. Le bandiere non
/// bastano a saperlo: sono per job, non dicono di **chi** è il job, e non
/// distinguono «accodato» da «dentro».
#[derive(Default)]
struct InFlight {
    /// Le bandiere dei job che sono **dentro** `run_job` adesso, per bundle.
    ///
    /// La bandiera e non il solo conto: chi aspetta la alza, ed è tutto ciò che
    /// vuol dire chiedere a un job di smettere.
    within: HashMap<String, HashMap<JobId, Arc<AtomicBool>>>,
    /// I bundle che si stanno spegnendo: un loro job non parte più.
    ///
    /// Senza, il pool riempirebbe da dietro ciò che chi spegne sta svuotando —
    /// un drenaggio prende **tutta** la coda, e aspettare che esca uno mentre
    /// parte il successivo è un'attesa che non finisce.
    stopped: HashSet<String>,
}

/// Un job **dentro** il codice del suo bundle: finché questo vive, chi vuole
/// spegnere quel bundle aspetta.
///
/// È la forma del `Lotto` del kernel: uscire non si può dimenticare, perché non
/// lo fa nessuno — lo fa il `Drop`. Un job che panicasse a metà, o che tornasse
/// da un ramo d'errore scritto domani, esce lo stesso; e chi spegne resterebbe
/// ad aspettare per sempre se uscire fosse una riga da ricordarsi.
struct Inside {
    in_flight: Arc<(Mutex<InFlight>, Condvar)>,
    plugin: String,
    id: JobId,
}

impl Drop for Inside {
    fn drop(&mut self) {
        let (place, bell) = &*self.in_flight;
        // Un `Drop` non pania: durante uno srotolamento costerebbe il processo
        // invece del job. Il veleno qui lo si prende com'è — ciò che resta da
        // fare è togliersi dal conto, e va fatto comunque.
        let mut in_flight = place.lock().unwrap_or_else(|and| and.into_inner());
        if let Some(within) = in_flight.within.get_mut(&self.plugin) {
            within.remove(&self.id);
            if within.is_empty() {
                in_flight.within.remove(&self.plugin);
            }
        }
        bell.notify_all();
    }
}

/// **Il diritto di spegnere un bundle**: finché vive, nessun job di quel bundle
/// parte e nessuno è dentro il suo codice.
///
/// Lo si tiene per il tempo dello spegnimento e lo si lascia cadere dopo: è un
/// permesso, non uno stato. Lasciarlo alzato per sempre vorrebbe dire che
/// riaccendere un componente non gli restituisce i job.
pub struct ShutDown {
    in_flight: Arc<(Mutex<InFlight>, Condvar)>,
    plugin: String,
}

impl Drop for ShutDown {
    fn drop(&mut self) {
        let (place, bell) = &*self.in_flight;
        let mut in_flight = place.lock().unwrap_or_else(|and| and.into_inner());
        in_flight.stopped.remove(&self.plugin);
        bell.notify_all();
    }
}

/// Presidia la finestra fra il controllo di `stopping` e la presa del biglietto.
///
/// Il banco della corsa deve poter mettere in scena quell'ordine senza
/// aspettare che lo scheduler lo scelga. È un gancio solo per i test: in
/// produzione non esiste né stato né attesa aggiuntiva.
#[cfg(test)]
pub(crate) struct StopRaceProbe {
    reached: Barrier,
    stopping: Barrier,
}

#[cfg(test)]
impl StopRaceProbe {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            reached: Barrier::new(2),
            stopping: Barrier::new(2),
        })
    }

    fn pause_before_ticket(&self) {
        self.reached.wait();
        self.stopping.wait();
    }

    pub(crate) fn reached(&self) {
        self.reached.wait();
    }

    fn stop_requested(&self) {
        self.stopping.wait();
    }
}

/// Le risposte di [`Flags::cancel`] e le due dell'apertura a fasi, provate
/// **senza un pool acceso**.
///
/// Farle girare per davvero — un vault, dei bundle, dei thread — vorrebbe dire
/// che un rosso non dice più quale ha sbagliato, e che quelle che riguardano un
/// momento (la bandiera che non deve lasciare niente, la fetta che non deve
/// partire, il pool che si ferma prima che l'apertura finisca) si possono
/// osservare solo indovinando un istante. Qui il momento si **mette in scena**:
/// le prime quattro sono asserzioni su una mappa, e le due del §15.7 chiamano a
/// mano ciò che un worker chiamerebbe da sé.
#[cfg(test)]
mod tests;
