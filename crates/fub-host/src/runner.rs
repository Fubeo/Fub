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

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use fub_abi::traits::{JobId, JobProgress, TimerSchedule};
use fub_abi::PluginError;
use fub_kernel::{Indexing, JobBell, PendingJob, Workspace};
use jiff::Timestamp;

use crate::wall::{verdict, Position, Zone};

use crate::custody::Custody;
use crate::jobs::{with_event_drain, JobHost};
use crate::records::UnreadDoc;
use crate::registry::BundleRegistry;

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

/// Lo **scheduler delle sveglie** (§22.1, decisione 0069; §22.4, decisione
/// 0091): la metà che il contratto non guarda, e che sta qui perché il tempo è
/// di chi possiede i thread.
///
/// Il kernel dice **quali** sveglie sono dichiarate
/// ([`Workspace::declared_timers`]) e con che regola suonano
/// ([`TimerSchedule::nth_after`] per il tempo trascorso,
/// [`WallClock::next_after`] per l'ora civile); questa struttura tiene la sola
/// cosa che il kernel non può tenere senza leggere un orologio: dov'è arrivata.
///
/// # Due sorgenti di tempo, e perché non si mescolano
///
/// L'ancora di `every`/`after` è un [`Instant`] e non un orario di sistema, ed è
/// la ragione per cui «ogni ora» vuol dire un'ora anche se qualcuno sposta
/// l'orologio della macchina. Un orario di parete non si può misurare così — un
/// `Instant` non ha un calendario — e ne vuole una seconda, che è
/// [`crate::wall`].
///
/// Le due **non si sommano mai**: l'attesa resta sempre e solo monotona, perché
/// aspettare è «per quanto» e non «fino a quando». Il tempo di parete entra in
/// un punto solo — *fra quanti secondi accade quell'ora civile* — e da lì in poi
/// il campo [`next`](Quadrant::next) è dello stesso tipo per tutte e
/// tre le forme. Un orologio spostato allunga o accorcia una singola attesa e
/// poi si ricalcola; che una sveglia di parete non suoni due volte non dipende
/// dall'orologio ma dalla sua [`last`](Quadrant::last) occorrenza civile.
#[derive(Default)]
struct Alarms {
    /// Chiave: (componente, nome della sveglia).
    quadrants: HashMap<(String, String), Quadrant>,
    /// I recuperi di parete accumulati da [`wall`](Alarms::wall), da
    /// drenare una volta sola in [`expired`](Alarms::expired). Li accumula
    /// `wall` e non chi la chiama perché
    /// [`reconcile_with_cursors`](Alarms::reconcile_with_cursors)
    /// e [`expired`](Alarms::expired) la chiamano entrambe: se il risultato
    /// tornasse al chiamante, la riconciliazione lo butterebbe via e il
    /// recupero si perderebbe — [`position`](Quadrant::position) è già
    /// avanzato, e la chiamata dopo non lo rivede.
    recoveries: Vec<(String, String)>,
}

struct Quadrant {
    schedule: TimerSchedule,
    /// Da quando si conta: la prima volta che questo scheduler l'ha vista.
    /// Solo per il tempo trascorso — un orario di parete non conta da quando è
    /// stato registrato, conta dal calendario.
    still: Instant,
    /// Quante volte ha già suonato (tempo trascorso).
    fired: u64,
    /// Dove sta una sveglia di **parete**: l'ultima occorrenza civile
    /// considerata e quella che sta aspettando.
    ///
    /// È l'invariante «al più una suonata per occorrenza» reso un campo, ed è
    /// ciò che fa suonare una volta sola le 2:30 che l'uscita dell'ora legale fa
    /// accadere due volte.
    position: Position,
    /// Quando suona la prossima. `None` = ha finito (un `after` che è già
    /// suonato, o un orario di parete impossibile), e la voce **resta** in mappa
    /// proprio per non essere riseminata dalla riconciliazione al giro dopo.
    next: Option<Instant>,
}

impl Alarms {
    fn reconcile_with_cursors_at(
        &mut self,
        declared: &[(String, fub_abi::traits::TimerSpec)],
        now: Instant,
        machine_zone: &str,
        cursors: &HashMap<(String, String), fub_abi::traits::CivilTime>,
        timestamp: Timestamp,
    ) {
        self.reconcile_with_cursors_inner(declared, now, machine_zone, cursors, timestamp);
    }

    fn reconcile_with_cursors_inner(
        &mut self,
        declared: &[(String, fub_abi::traits::TimerSpec)],
        now: Instant,
        machine_zone: &str,
        cursors: &HashMap<(String, String), fub_abi::traits::CivilTime>,
        timestamp: Timestamp,
    ) {
        // Le coppie dichiarate, in un insieme: i due `retain` sotto le cercano
        // per appartenenza invece di rifare un `any` annidato per ogni voce.
        let declared_set: HashSet<(&str, &str)> = declared
            .iter()
            .map(|(or, spec)| (or.as_str(), spec.id.as_str()))
            .collect();
        self.quadrants
            .retain(|(owner, timer), _| declared_set.contains(&(owner.as_str(), timer.as_str())));
        self.recoveries
            .retain(|(owner, timer)| declared_set.contains(&(owner.as_str(), timer.as_str())));
        for (owner, spec) in declared {
            let key = (owner.clone(), spec.id.clone());
            let cursor = cursors.get(&key).copied();
            self.quadrants.entry(key).or_insert_with(|| Quadrant {
                schedule: spec.schedule.clone(),
                still: now,
                fired: 0,
                position: Position {
                    last: cursor,
                    wait_for: None,
                },
                next: spec
                    .schedule
                    .nth_after(0)
                    .map(|s| now + Duration::from_secs(s)),
            });
        }
        self.wall_at(now, machine_zone, timestamp);
    }

    /// Allinea i quadranti a ciò che è dichiarato **adesso**.
    ///
    /// È qui che una sveglia nasce e muore, e il fatto che la sorgente sia il
    /// manifest a ogni giro invece che una copia presa una volta è ciò che fa
    /// smettere di suonare un componente disattivato — senza che questo codice
    /// sappia niente della disattivazione.
    ///
    /// `machine_zone` è il nome IANA che il locale risolve
    /// ([`locale.timezone`](fub_kernel::locale::TIMEZONE)): vuoto = quello del
    /// sistema. Non è una chiave nuova, ed è la misura che ha risparmiato
    /// un'impostazione — vedi la decisione 0091.
    fn reconcile_with_cursors(
        &mut self,
        declared: &[(String, fub_abi::traits::TimerSpec)],
        now: Instant,
        machine_zone: &str,
        cursors: &HashMap<(String, String), fub_abi::traits::CivilTime>,
    ) {
        self.reconcile_with_cursors_at(declared, now, machine_zone, cursors, Timestamp::now());
    }

    /// Tutto il calcolo di parete passa dal timestamp, così il banco può
    /// simulare chiusura e riavvio senza dormire davvero.
    fn wall_at(&mut self, instant: Instant, machine_zone: &str, timestamp: Timestamp) {
        for (key, q) in self.quadrants.iter_mut() {
            let Some(alarm) = q.schedule.wall_clock() else {
                continue;
            };
            let Some(zone) = Zone::of(alarm, machine_zone) else {
                q.next = None;
                continue;
            };
            let v = verdict(alarm, &zone, timestamp, q.position);
            q.position = v.position;
            q.next = v.between.map(|d| instant + d);
            if v.ring && !self.recoveries.contains(key) {
                self.recoveries.push(key.clone());
            }
        }
    }

    /// Il cursore durevole dei timer di parete, pronto per il vault.
    fn cursors(&self) -> Vec<(String, String, fub_abi::traits::CivilTime)> {
        self.quadrants
            .iter()
            .filter_map(|((owner, timer), q)| {
                q.schedule.wall_clock().and_then(|_| {
                    q.position
                        .last
                        .map(|last| (owner.clone(), timer.clone(), last))
                })
            })
            .collect()
    }

    /// Fra quanto suona la prima. `None` = nessuna sveglia viva, e chi aspetta
    /// può dormire senza scadenza come faceva prima che le sveglie esistessero.
    fn time_until(&self, now: Instant) -> Option<Duration> {
        self.quadrants
            .values()
            .filter_map(|q| q.next)
            .min()
            .map(|p| p.saturating_duration_since(now))
    }

    /// Chi è scaduto, con il quadrante già avanzato al giro dopo.
    fn expired(&mut self, now: Instant, machine_zone: &str) -> Vec<(String, String)> {
        self.expired_at(now, machine_zone, Timestamp::now())
    }

    /// Versione a orologio finto per il banco di riavvio.
    fn expired_at(
        &mut self,
        now: Instant,
        machine_zone: &str,
        timestamp: Timestamp,
    ) -> Vec<(String, String)> {
        let mut ringing = Vec::new();
        for (key, q) in self.quadrants.iter_mut() {
            if q.schedule.wall_clock().is_some() {
                continue;
            }
            let Some(next) = q.next else { continue };
            if next > now {
                continue;
            }
            ringing.push(key.clone());
            q.fired += 1;
            q.next = q
                .schedule
                .nth_after(q.fired)
                .map(|s| q.still + Duration::from_secs(s));
        }
        ringing.sort();
        self.wall_at(now, machine_zone, timestamp);
        self.recoveries.sort();
        ringing.append(&mut self.recoveries);
        ringing
    }
}

/// Ciò che i thread condividono: il vault, i bundle, il campanello, lo stato
/// dei job e i quadranti delle sveglie.
struct Shared {
    workspace: Custody<Workspace>,
    bundles: Custody<BundleRegistry>,
    bell: Arc<JobBell>,
    stopping: AtomicBool,
    opening: Custody<Option<InProgress>>,
    flags: Custody<Flags>,
    alarms: Custody<Alarms>,
    in_flight: Arc<(Mutex<InFlight>, Condvar)>,
}

/// L'indicizzazione dell'apertura mentre gira: il lavoro, la sua identità di
/// job, e dove va a finire il suo esito.
pub struct InProgress {
    pub(crate) id: JobId,
    pub(crate) work: Indexing,
    /// Il totale non cambia più dopo la scansione, e si tiene qui perché il
    /// progresso lo vuole a ogni fetta.
    pub(crate) total: u64,
    /// Ciò che di questo vault non si è potuto leggere, per chi risponde a
    /// `Host::vaults()`. È condiviso perché la risposta esiste **prima** di
    /// questo esito: chi apre non aspetta l'indicizzazione, quindi il posto
    /// dove gli scarti si depositano deve esserci già quando ancora non ce n'è
    /// nessuno.
    pub(crate) unread: Custody<Vec<UnreadDoc>>,
    /// **Quando l'indicizzazione ha finito**, per chi deve aspettarla.
    ///
    /// Una condizione e non un'attesa a intervalli, per la stessa ragione per
    /// cui il campanello dei job non è un polling
    /// ([0032](../../../docs/decisions/0183-composizione-host-kernel.md)): un
    /// intervallo è una politica da scegliere — ogni quanto? a che costo? —
    /// dove basta un fatto.
    pub(crate) end: Arc<(Mutex<bool>, Condvar)>,
}

impl Shared {
    /// **Porta avanti l'apertura di una fetta**, e dice se c'era qualcosa da
    /// portare avanti (§15.7).
    ///
    /// Una fetta alla volta, e non il giro intero, perché fra una fetta e
    /// l'altra succedono le tre cose per cui questa voce esiste: il workspace
    /// si libera — `reindex` lo teneva in esclusiva ~780 ms su 2000 note
    /// ([0024](../../../docs/decisions/README.md)) —,
    /// il progresso si timbra, e la bandiera si guarda.
    ///
    /// **L'apertura ha la precedenza sui job**, e non è un caso: un job chiesto
    /// da un provider all'apertura del vault vede un indice che si sta
    /// popolando, e farlo aspettare la fine è il verso che gli fa vedere di
    /// più. Non è fame: una fetta è limitata, e fra due fette la coda si drena.
    fn advance_opening(&self) -> Result<bool, PluginError> {
        let Some(mut in_progress) = self.opening.write()?.take() else {
            return Ok(false);
        };
        // La bandiera è **quella di tutti**: annullare l'indicizzazione è
        // premere lo stesso pulsante che annulla un export, e passa dalla
        // stessa `Flags`. Senza questo, «annulla» avrebbe avuto due
        // implementazioni e una delle due sarebbe stata dimenticata.
        let flag = self.flag(in_progress.id)?;
        let stop = flag.load(Ordering::Relaxed) || self.stopping.load(Ordering::Acquire);

        if !stop && !in_progress.work.finished() {
            let label = in_progress.work.next().map(|id| id.to_string());
            // La fetta intera — piano e applicazione — è ciò che il banco conta
            // per dire quante iterazioni ha fatto l'apertura (§25.3).
            let _phase = tracing::info_span!(target: "fub.apertura", "fetta").entered();
            // **Il disco sotto prestito condiviso** (0119, secondo sito): la
            // fetta si legge e si parsa qui, dove chi guarda il vault appena
            // aperto — la ricerca, l'albero, l'autocompletamento — entra
            // accanto. Il piano si porta dietro l'impronta che l'anagrafe dava
            // a ogni documento adesso, e chi applica la confronta: fra le due
            // fasi il prestito esclusivo passa di mano, e su un'apertura che
            // dura secondi in mezzo ci sta un salvataggio dell'utente.
            let checked = {
                let ws = self.workspace.read()?;
                ws.prepare_index_batch_check(&mut in_progress.work)
            }
            .invoke();
            let parsed = {
                let ws = self.workspace.read()?;
                ws.prepare_index_batch_parse(checked)
            }
            .invoke(&mut in_progress.work);
            // Il turno serializza le mutazioni dell'apertura con le altre scritture,
            // ma non è il `RwLock<Workspace>`: durante il codice del provider i
            // lettori devono poter entrare. È la stessa forma di `write_document`:
            // prepare/commit sotto lock, callback fuori lock, finalize sotto lock.
            let _turn = self.workspace.write_turn();
            let pending = {
                let mut ws = self.workspace.write()?;
                ws.commit_index_batch_prepared(parsed)
            };
            let pending = pending.map(|pending| pending.invoke_indexes());
            with_event_drain(&self.workspace, |ws| {
                if let Some(pending) = pending {
                    ws.finalize_index_batch_prepared(pending);
                }
                // Il `total` c'è perché la scansione lo sa: l'apertura è il
                // caso in cui una barra può dire il vero, e
                // [`JobProgress::total`] è opzionale proprio per distinguerlo
                // da quelli in cui mentirebbe.
                ws.notes_job_progress(
                    in_progress.id,
                    JobProgress {
                        done: in_progress.work.done(),
                        total: Some(in_progress.total),
                        label,
                    },
                );
            })?;
            *self.opening.write()? = Some(in_progress);
            return Ok(true);
        }

        // Finita, o smessa: si chiude comunque. Il grafo è CPU sull'insieme
        // intero: si clona sotto prestito **condiviso**, si costruisce **senza**
        // lucchetto, si installa sotto quello esclusivo. `finish_index` sotto
        // esclusivo teneva l'UI ferma per tutto il vault (0024; a caldo è
        // l'unica costruzione del grafo, `il_grafo_di_un_apertura_a_caldo`).
        // Se in mezzo una scrittura ha toccato i metadati, `finish_index_with_graph`
        // rifà il grafo dai correnti invece di coprire la scrittura.
        let graph = {
            let sources = self.workspace.read()?.graph_sources();
            sources.build()
        };
        let _turn = self.workspace.write_turn();
        let prepared_finish = {
            let ws = self.workspace.read()?;
            ws.prepare_finish_index_with_graph(in_progress.work, graph)
        };
        let completed_finish = prepared_finish.invoke();
        let opening = with_event_drain(&self.workspace, |ws| {
            ws.finalize_finish_index(completed_finish)
        })?;
        // **Il flush degli indici è una fase sua** (difetto 0113), come la
        // terza fase di `ExternalSync::batch`: un prestito esclusivo separato
        // da quello della chiusura dell'indicizzazione. Fra i due prestiti il
        // lucchetto si rilascia, e un lettore concorrente non aspetta la somma
        // delle fasi — riconciliazione, ricongiungimento, flush, anagrafe —
        // ma la sola che sta correndo. Il flush tocca solo gli indici e il
        // disco, non lo stato condiviso del workspace.
        with_event_drain(&self.workspace, |ws| {
            let _ = ws.flush_indexes();
        })?;
        // **La persistenza dell'anagrafe e la raccolta dello spazio per-documento,
        // entrambe sotto prestito condiviso.**
        // Non bloccano l'UI né il lock di scrittura esclusivo durante il calcolo
        // e la scrittura su disco della fotografia del vault.
        self.workspace.read()?.store_entries();
        if let Err(and) = self.workspace.read()?.collect_doc_data() {
            tracing::warn!(target: "fub.host", "spazi per-documento non raccolti: {and}");
        }
        *in_progress.unread.write()? = opening
            .discarded
            .iter()
            .map(|discard| UnreadDoc {
                doc_id: discard.id.to_string(),
                why: discard.why.clone(),
            })
            .collect();

        // L'esito di un'indicizzazione annullata è un `Cancelled` come quello
        // di ogni altro job annullato: chi guarda il centro attività distingue
        // «finito» da «fermato» senza sapere che quel job era un'apertura.
        let outcome = if opening.interrupted {
            Err(PluginError::Cancelled(
                "l'indicizzazione del vault è stata interrupted: la ricerca è parziale finché non si riapre"
                    .into(),
            ))
        } else {
            Ok(serde_json::json!({ "discarded": opening.discarded.len() }))
        };
        self.forget(in_progress.id)?;
        with_event_drain(&self.workspace, |ws| {
            ws.complete_job(in_progress.id, fub_kernel::INDEX_JOB.to_string(), outcome);
        })?;
        // Ultimo, e dopo l'esito: chi si sveglia qui deve trovare il vault
        // nello stato in cui l'indicizzazione lo ha lasciato, non mentre ce lo
        // sta mettendo.
        let (done, bell) = &*in_progress.end;
        *done.lock().expect("fine avvelenata") = true;
        bell.notify_all();
        Ok(true)
    }

    /// Prende in carico un lotto appena drenato ([`Flags::claim`]).
    fn claim(&self, jobs: &[PendingJob]) -> Result<(), PluginError> {
        let mut flags = self.flags.write()?;
        for job in jobs {
            flags.claim(job.id);
        }
        Ok(())
    }

    /// La bandiera di un job, creandola se non c'è.
    fn flag(&self, id: JobId) -> Result<Arc<AtomicBool>, PluginError> {
        let mut flags = self.flags.write()?;
        flags.claim(id);
        Ok(Arc::clone(&flags.live[&id]))
    }

    /// Il segno degli id emessi si prende **prima** del lock delle bandiere e
    /// non dentro: è una lettura del workspace, e annidarla sotto le bandiere
    /// sarebbe il secondo ordine fra due lock che altrove è già l'opposto.
    fn cancel(&self, id: JobId) -> Result<(), PluginError> {
        let issued = self.workspace.read()?.jobs_issued();
        self.flags.write()?.cancel(id, issued);
        Ok(())
    }

    fn forget(&self, id: JobId) -> Result<(), PluginError> {
        self.flags.write()?.live.remove(&id);
        Ok(())
    }

    fn cancel_all(&self) -> Result<(), PluginError> {
        self.flags.write()?.cancel_all();
        Ok(())
    }

    /// **Entra nel codice di un bundle**, se quel bundle non si sta spegnendo.
    ///
    /// `None` vuol dire «non entrare»: il job non parte, e riceve il proprio
    /// esito come ogni altro che non parte.
    fn enter(&self, plugin: &str, id: JobId, flag: &Arc<AtomicBool>) -> Option<Inside> {
        let (place, _) = &*self.in_flight;
        let mut in_flight = place.lock().expect(POISONED);
        if in_flight.stopped.contains(plugin) {
            return None;
        }
        in_flight
            .within
            .entry(plugin.to_string())
            .or_default()
            .insert(id, Arc::clone(flag));
        Some(Inside {
            in_flight: Arc::clone(&self.in_flight),
            plugin: plugin.to_string(),
            id,
        })
    }

    /// **Ferma i job di un bundle e aspetta che non ne resti nessuno dentro.**
    ///
    /// Le due metà sono una cosa sola e non due: chiudere la porta senza
    /// aspettare chi è già dentro lascerebbe esattamente il caso per cui questo
    /// esiste, e aspettare senza chiudere la porta non finirebbe mai.
    ///
    /// Chiedere a chi è dentro di smettere è **alzare la sua bandiera**, e non
    /// è più di così: un job che non chiama mai l'host arriva in fondo
    /// comunque, ed è il limite che la
    /// [0032](../../../docs/decisions/0183-composizione-host-kernel.md) dichiara —
    /// chi spegne aspetta chi lavora, come chi chiude.
    ///
    /// **Chi la chiama non deve tenere in mano né il workspace né il registry**:
    /// un job dentro `run_job` li chiede per finire, e aspettarlo tenendoli
    /// sarebbe aspettare sé stessi.
    fn shutdown(&self, plugin: &str) -> ShutDown {
        let (place, bell) = &*self.in_flight;
        let mut in_flight = place.lock().expect(POISONED);
        in_flight.stopped.insert(plugin.to_string());
        if let Some(within) = in_flight.within.get(plugin) {
            for flag in within.values() {
                flag.store(true, Ordering::Relaxed);
            }
        }
        while in_flight.within.contains_key(plugin) {
            in_flight = bell.wait(in_flight).expect(POISONED);
        }
        ShutDown {
            in_flight: Arc::clone(&self.in_flight),
            plugin: plugin.to_string(),
        }
    }

    /// Esegue un job e ne riconsegna l'esito. **Sempre** un esito: un job che
    /// sparisce senza dire niente è un chiamante che aspetta per sempre, ed è la
    /// regola che la [0028](../../../docs/decisions/0183-composizione-host-kernel.md)
    /// ha già scritto per i job di chi si disattiva.
    fn run(&self, job: PendingJob) -> Result<(), PluginError> {
        let outcome = self.outcome(&job);
        // Le bandiere si puliscono dopo l'esito e **prima** della riconsegna,
        // ma il loro guasto non la scavalca: un `?` qui buttava via un esito
        // che c'era già — il job aveva girato, la risposta era in mano — per un
        // lucchetto che con quella risposta non c'entra niente. Si riconsegna,
        // e poi lo si dice.
        let flags = self.forget(job.id);
        with_event_drain(&self.workspace, |ws| {
            ws.complete_job(job.id, job.spec.job, outcome);
        })?;
        flags
    }

    /// **Ciò che questo job risponde, comunque vada** — anche quando ciò che va
    /// storto non è il job ma il runner.
    ///
    /// È qui che sta la differenza fra «il job non è partito» e «il job non
    /// esiste più»: un lucchetto avvelenato, un componente che si sta
    /// spegnendo, un bundle smontato non sono un motivo per sparire, sono la
    /// **risposta**. Sparire lo è solo per il workspace, che è il canale stesso
    /// su cui la risposta viaggia.
    fn outcome(&self, job: &PendingJob) -> Result<serde_json::Value, PluginError> {
        let flag = self.flag(job.id)?;
        // **Ci si annuncia prima di prendere il corpo**, e il guard si dichiara
        // per primo perché cada per **ultimo**: fra queste due righe ci sta chi
        // spegne il componente, e se la copia del bundle si prendesse prima di
        // annunciarsi quell'attesa non la vedrebbe. Per la stessa ragione
        // `_inside` deve sopravvivere all'`Arc` del plugin — un `Drop` in
        // ordine inverso sveglierebbe chi spegne con una copia ancora in giro,
        // che è il difetto scritto al contrario.
        let Some(_inside) = self.enter(&job.plugin, job.id, &flag) else {
            return Err(refusal(
                job,
                "non parte: il suo componente si sta spegnendo",
            ));
        };
        // Il corpo lo tiene il registry, e lo si prende **senza tenere il suo
        // lock** per la durata del job: chi chiude deve poterci passare.
        let plugin = self.bundles.read()?.body(&job.plugin);

        match plugin {
            None => Err(PluginError::Internal(
                format!(
                    "`{}` non è un bundle montato: il job `{}` non ha un corpo",
                    job.plugin, job.spec.job
                )
                .into(),
            )),
            Some(_) if flag.load(Ordering::Relaxed) => Err(PluginError::Cancelled(
                format!(
                    "il job `{}` è stato annullato prima di partire",
                    job.spec.job
                )
                .into(),
            )),
            Some(plugin) => {
                // Le due cose che il job non sa di sé, e che sa il runner:
                // quando deve smettere (la bandiera) e come si chiama (l'id,
                // §10.3 — senza, non potrebbe raccontare a che punto è).
                let mut host = JobHost::new(self.workspace.clone(), &job.plugin)
                    .for_job(job.id)
                    .cancelled_by(Arc::clone(&flag));
                // Un job che pania costa il job. La rete è la stessa del
                // kernel, applicata all'ultima porta che ne era rimasta fuori —
                // e qui non ci sarebbe nemmeno un chiamante a cui il panico
                // possa arrivare: si porterebbe via un thread del pool, e con
                // lui ogni job successivo.
                fub_kernel::safety::calling(
                    &job.plugin,
                    fub_kernel::safety::Gate::Job,
                    &job.spec.job,
                    || plugin.run_job(&job.spec.job, job.spec.payload.clone(), &mut host),
                )
            }
        }
    }

    /// Riconsegna un job **senza eseguirlo**: è stato chiesto, e chi lo ha
    /// chiesto aspetta un `JobDone`.
    fn refuse(&self, job: PendingJob, why: &str) -> Result<PluginError, PluginError> {
        let refusal = refusal(&job, why);
        // Come in `run`: le bandiere prima, ma il loro guasto **dopo** la
        // riconsegna. Chi rifiuta è già dentro un guaio, ed è il momento in cui
        // un esito perso non lo nota nessuno.
        let flags = self.forget(job.id);
        with_event_drain(&self.workspace, |ws| {
            ws.complete_job(job.id, job.spec.job, Err(refusal.clone()));
        })?;
        flags?;
        Ok(refusal)
    }

    /// Il fuso della **macchina**, per le sveglie di parete che non ne
    /// dichiarano uno (§22.4).
    ///
    /// È [`locale.timezone`](fub_kernel::locale::TIMEZONE), risolto come ogni
    /// altra parte del locale: vuoto = quello del sistema. **Non è una chiave
    /// nuova**, ed è la misura che ha risparmiato un'impostazione — il locale di
    /// questo repo porta il nome IANA proprio perché serva a fare aritmetica su
    /// date, e lo dice per iscritto nel suo modulo.
    ///
    /// Si rilegge a ogni giro e non si tiene: il fuso cambia mentre l'app è viva
    /// — l'utente lo scrive nelle impostazioni, o si porta il portatile in un
    /// altro paese — e non c'è niente da invalidare perché non c'è niente di
    /// derivato.
    fn machine_zone(&self) -> Result<String, PluginError> {
        Ok(self.workspace.read()?.locale().timezone)
    }

    fn persist_cursors(
        &self,
        cursors: Vec<(String, String, fub_abi::traits::CivilTime)>,
    ) -> Result<(), PluginError> {
        let workspace = self.workspace.read()?;
        for (owner, timer, cursor) in cursors {
            workspace.set_timer_cursor(&owner, &timer, cursor)?;
        }
        Ok(())
    }

    /// Carica i cursori dal dato autorevole del vault.
    fn load_cursors(
        &self,
        declared: &[(String, fub_abi::traits::TimerSpec)],
    ) -> Result<HashMap<(String, String), fub_abi::traits::CivilTime>, PluginError> {
        let workspace = self.workspace.read()?;
        let owners: HashSet<&str> = declared.iter().map(|(owner, _)| owner.as_str()).collect();
        let mut cursors = HashMap::new();
        for owner in owners {
            for (timer, cursor) in workspace.timer_cursors(owner)? {
                cursors.insert((owner.to_owned(), timer), cursor);
            }
        }
        Ok(cursors)
    }

    /// Fra quanto suona la prima sveglia, riallineando prima i quadranti a ciò
    /// che è dichiarato adesso (§22.1).
    fn time_until_alarm(&self) -> Result<Option<Duration>, PluginError> {
        let declared = self.workspace.read()?.declared_timers();
        if declared.is_empty() {
            let mut alarms = self.alarms.write()?;
            alarms.quadrants.clear();
            alarms.recoveries.clear();
            return Ok(None);
        }
        let cursors = self.load_cursors(&declared)?;
        let zone = self.machine_zone()?;
        let now = Instant::now();
        let (until, changed) = {
            let mut alarms = self.alarms.write()?;
            alarms.reconcile_with_cursors(&declared, now, &zone, &cursors);
            (alarms.time_until(now), alarms.cursors())
        };
        self.persist_cursors(changed)?;
        Ok(until)
    }

    /// Fa suonare ciò che è scaduto.
    ///
    /// Il quadrante si avanza tenendo il lock delle sveglie, l'evento si emette
    /// **dopo** averlo lasciato; il cursore si scrive prima dell'evento, così un
    /// riavvio durante il dispatch non ripete l'occorrenza.
    fn ring(&self) -> Result<(), PluginError> {
        let zone = self.machine_zone()?;
        let (expired, cursors) = {
            let mut alarms = self.alarms.write()?;
            let expired = alarms.expired(Instant::now(), &zone);
            (expired, alarms.cursors())
        };
        self.persist_cursors(cursors)?;
        for (owner, timer) in expired {
            if self.stopping.load(Ordering::Acquire) {
                return Ok(());
            }
            with_event_drain(&self.workspace, |ws| ws.fire_timer(&owner, &timer))?;
        }
        Ok(())
    }

    /// Il mestiere di un thread del pool.
    ///
    /// **Un vault avvelenato ferma il pool** (decisione 0120). Qui non c'è un
    /// chiamante a cui dire di no: un thread di sfondo che trovasse il vault
    /// irrecuperabile e continuasse il giro girerebbe a vuoto per sempre — o,
    /// col vecchio `.expect("workspace avvelenato")`, si porterebbe via il
    /// thread e con lui ogni job successivo, in silenzio. Il giro esce, e alza
    /// `stopping` così che escano anche gli altri: da quel momento chi accoda un
    /// job riceve il rifiuto invece di aspettare per sempre.
    ///
    /// La riga che dice *perché* l'ha già scritta la porta, una volta sola:
    /// questa non la ripete, dice solo chi si è fermato.
    fn work(&self) {
        if let Err(and) = self.round() {
            tracing::error!(target: "fub.host", "il pool dei job si ferma: {and}");
            self.stopping.store(true, Ordering::Release);
            self.bell.ring();
        }
    }

    /// Il giro vero, fino a quando c'è da lavorare o fino al primo veleno.
    fn round(&self) -> Result<(), PluginError> {
        while !self.stopping.load(Ordering::Acquire) {
            // L'apertura prima di tutto, e **prima del biglietto**: finché c'è
            // una fetta da fare questo thread non deve nemmeno considerare di
            // dormire.
            if self.advance_opening()? {
                std::thread::yield_now();
                continue;
            }
            // Il biglietto si prende **prima** di drenare: un job accodato fra
            // il drenaggio e l'attesa cambia il conto, e l'attesa torna subito
            // invece di dormire su lavoro che c'è.
            let ticket = self.bell.ticket();
            let jobs = self.workspace.write()?.take_pending_jobs();
            if jobs.is_empty() {
                // La bandiera si rilegge **dopo** aver preso il biglietto, e non
                // basta quella in cima al ciclo: `stop` alza `stopping` e *poi*
                // suona, quindi un thread che passa il controllo in cima un
                // istante prima dello `store` prenderebbe il biglietto già
                // oltre la suonata, troverebbe la coda vuota e si metterebbe ad
                // aspettare una campana che non suonerà più — e chi chiude lo
                // aspetterebbe per sempre. Riletta qui la corsa non c'è: o il
                // biglietto è di prima della suonata, e allora `wait_beyond`
                // torna subito perché il conto è già cambiato; o è di dopo, e
                // allora `stopping` è già visibile (lo `store` è `Release`, e
                // il biglietto passa dal mutex del campanello che la suonata ha
                // rilasciato).
                if self.stopping.load(Ordering::Acquire) {
                    return Ok(());
                }
                // Le sveglie si guardano **qui**, cioè nel solo momento in cui
                // questo thread stava per non fare niente: uno scheduler che
                // gira accanto al pool sarebbe un thread in più, e uno che gira
                // dentro il ciclo dei job pagherebbe un orologio a ogni job.
                match self.time_until_alarm()? {
                    Some(between) => {
                        self.bell.wait_beyond_or(ticket, between);
                        self.ring()?;
                    }
                    None => {
                        self.bell.wait_beyond(ticket);
                    }
                }
                continue;
            }
            self.batch(jobs)?;
        }
        Ok(())
    }

    /// Un lotto **già drenato**, fino in fondo o fino al primo guasto.
    ///
    /// Il lotto è la parte fragile e non il singolo job: `take_pending_jobs`
    /// svuota la coda, quindi da questa riga in poi quei job non stanno più da
    /// nessuna parte tranne che in questo `Vec`. Un `?` in mezzo al ciclo li
    /// portava via con sé — chi li aveva chiesti restava ad aspettare un
    /// `JobDone` che non poteva più arrivare, perché `refuse_pending` alla
    /// chiusura guarda **la coda**, non le mani di questo thread — e il ramo che
    /// lo faceva è precisamente quello che si imbocca quando qualcosa è già
    /// andato storto (difetto 0203).
    ///
    /// Il guasto ferma il pool come prima: ciò che cambia è che se ne va dopo
    /// aver dato un esito a chi era in mano, e non prima.
    fn batch(&self, jobs: Vec<PendingJob>) -> Result<(), PluginError> {
        // La presa in carico è dentro il conto e non prima: se fallisce lei il
        // lotto è già fuori dalla coda uguale, e il posto dove va a finire è lo
        // stesso di ogni altro guasto. Una via d'uscita sola, che è anche il
        // modo in cui questa riparazione ha un presidio: due drenaggi scritti
        // due volte sono due, e uno dei due non lo prova nessuno.
        let mut failure = self.claim(&jobs).err();
        let mut remaining_jobs = jobs.into_iter();
        while failure.is_none() {
            let Some(job) = remaining_jobs.next() else {
                break;
            };
            // Il controllo è **dentro** il ciclo e non solo in cima: un
            // drenaggio prende tutta la coda, e senza questa riga chiudere
            // vorrebbe dire eseguire fino in fondo tutto ciò che un thread
            // si è trovato in mano. Chi chiude aspetta chi ha *già*
            // cominciato, non chi non è ancora partito.
            let done = if self.stopping.load(Ordering::Acquire) {
                self.refuse(job, "non parte: il vault si sta chiudendo")
                    .map(|_| ())
            } else {
                self.run(job)
            };
            failure = done.err();
        }
        match failure {
            // **L'unica via d'uscita che perde qualcosa**, e non perde niente:
            // ciò che resta in mano riceve il proprio esito prima che questo
            // thread se ne vada.
            Some(and) => {
                self.abandon(remaining_jobs);
                Err(and)
            }
            None => Ok(()),
        }
    }

    /// L'esito di chi non partirà: il pool si è fermato, e questi erano in mano.
    ///
    /// Il rifiuto può fallire a sua volta — se ad avvelenarsi è il workspace non
    /// c'è più nessun canale su cui rispondere, ed è il limite che la 0120
    /// dichiara — ma è l'ultima cosa che si prova, non la prima che si salta.
    fn abandon(&self, jobs: impl IntoIterator<Item = PendingJob>) {
        for job in jobs {
            let _ = self.refuse(job, "non parte: il pool si è fermato");
        }
    }
}

/// Il pool che esegue i job di un vault.
pub struct JobRunner {
    shared: Arc<Shared>,
    workers: Vec<JoinHandle<()>>,
}

impl JobRunner {
    /// Avvia il pool su un vault **scansionato**, e gli affida la seconda fase
    /// dell'apertura (§15.7).
    ///
    /// `opening` è ciò che [`Workspace::scan_vault`] ha consegnato, insieme
    /// all'identità di job che il kernel le ha dato e al posto dove
    /// depositare ciò che non si legge. Il pool parte *già con del lavoro in
    /// mano*, ed è la differenza fra un'apertura a fasi e un'apertura sincrona
    /// con un thread in più: nessuno accende niente dopo, e non c'è una
    /// finestra in cui l'indicizzazione esiste ma non la sta facendo nessuno.
    pub fn start(
        workspace: Custody<Workspace>,
        bundles: Custody<BundleRegistry>,
        threads: usize,
        opening: Option<InProgress>,
    ) -> Result<Self, PluginError> {
        // Un `Result` per una riga che in pratica non fallisce mai — questo
        // workspace lo ha appena costruito chi apre — e non è una formalità: è
        // che dopo la 0120 *prendere un prestito è una domanda*, e una funzione
        // che se la ponesse per conto suo sarebbe il secondo posto in cui la
        // politica è scritta.
        let bell = workspace.read()?.job_bell();
        let shared = Arc::new(Shared {
            workspace,
            bundles,
            bell,
            stopping: AtomicBool::new(false),
            opening: Custody::new("l'apertura in corso", opening),
            flags: Custody::empty("le bandiere dei job"),
            alarms: Custody::empty("le sveglie del vault"),
            in_flight: Arc::new((Mutex::new(InFlight::default()), Condvar::new())),
        });
        let workers = (0..threads.max(1))
            .map(|n| {
                let shared = Arc::clone(&shared);
                std::thread::Builder::new()
                    .name(format!("fub-job-{n}"))
                    .spawn(move || shared.work())
                    .expect("thread del pool")
            })
            .collect();
        Ok(JobRunner { shared, workers })
    }

    /// **Annulla** un job: alzare la sua bandiera è tutto ciò che vuol dire.
    ///
    /// Vale anche per un job che non è ancora partito — la bandiera nasce qui e
    /// il worker la trova già alzata. L'alternativa (rispondere «non lo
    /// conosco») vorrebbe dire che annullare un job un istante prima che parta è
    /// una corsa che si perde.
    ///
    /// Annullare un job **già concluso** non fa niente e non lascia niente: la
    /// bandiera nasce solo per un id oltre il segno di ciò che il pool ha già
    /// preso in carico. Senza quella distinzione ogni annullamento arrivato
    /// tardi — che è il caso normale di un pulsante premuto mentre il lavoro
    /// finisce — lascerebbe dietro di sé una bandiera che nessuno toglie.
    ///
    /// E annullare un id che **non è mai stato un job** non lascia niente
    /// nemmeno lui: l'id arriva da fuori, e il segno che lo giudica è quello
    /// degli id che il kernel ha emesso ([`Flags::cancel`]).
    pub fn cancel(&self, id: JobId) {
        // Su un vault avvelenato non c'è niente da annullare: il pool si è già
        // fermato da sé, e la riga che spiega perché è già stata scritta.
        let _ = self.shared.cancel(id);
    }

    /// **Ferma i job di un componente**, e torna quando nessuno è più dentro il
    /// suo codice: da lì in poi si può spegnere.
    ///
    /// È la seconda porta da cui si arriva a [`BundleRegistry::stop`]. La prima
    /// — chiudere il vault — ferma il pool **intero** e raccoglie i thread, e
    /// per quella non serviva niente: dopo `stop` non c'è nessuno dentro
    /// niente. Spegnere un componente dalle impostazioni (§11.1) non ferma il
    /// pool, e non deve: gli altri componenti non c'entrano.
    ///
    /// Il permesso che torna vale finché lo si tiene, e per quello che dura
    /// nessun job di quel bundle parte. **Va preso prima del prestito del
    /// workspace**, non dopo: chi è dentro `run_job` chiede il workspace per
    /// riconsegnare l'esito, e aspettarlo tenendolo sarebbe aspettare sé
    /// stessi. Vedi `Host::set_plugin_enabled`, che è l'unico chiamante.
    #[must_use = "il componente resta fermo solo finché si tiene questo permesso"]
    pub fn shutdown_bundle(&self, id: &str) -> ShutDown {
        self.shared.shutdown(id)
    }

    /// **Ferma il pool**: annulla tutti, sveglia chi dorme, aspetta chi lavora,
    /// e dà un esito ai job che non partiranno mai.
    ///
    /// Aspettare è la decisione, non un dettaglio: chi chiude aspetta chi ha già
    /// cominciato, dopo avergli detto di smettere. Il costo dichiarato è che un
    /// job che non chiama mai l'host non lo si può fermare — in Rust un thread
    /// non si uccide — e chi chiude aspetta che finisca. A M5 quel caso ha una
    /// risposta vera, ed è il deadline dell'host WASM.
    pub fn stop(&mut self) -> Vec<PluginError> {
        self.shared.stopping.store(true, Ordering::Release);
        let mut errors: Vec<PluginError> = self.shared.cancel_all().err().into_iter().collect();
        // Sveglia chi aspetta il campanello: si sveglia, vede `stopping`, esce.
        self.shared.bell.ring();
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
        // **L'apertura che nessuno ha finito riceve comunque un esito.** Un
        // worker che vede `stopping` in cima al ciclo esce senza passare da
        // `advance_opening`, quindi chiudere un vault a metà indicizzazione
        // lascerebbe un job vivo per sempre — e la regola che vale per i job
        // dei plugin («sempre un esito», 0028) non vale meno per questo.
        // `stopping` è già alto: la chiamata prende il ramo che chiude.
        // Ciò che va storto **chiudendo** si raccoglie e si dice: un vault
        // avvelenato è uno dei modi in cui l'apertura non arriva a un esito, ed
        // è la stessa lista in cui finiscono gli altri.
        errors.extend(self.shared.advance_opening().err());
        errors.extend(self.refuse_pending());
        errors
    }

    /// Ha ancora dei thread vivi?
    pub fn is_running(&self) -> bool {
        !self.workers.is_empty()
    }

    /// I job rimasti in coda quando il pool si ferma ricevono un esito: sono
    /// stati chiesti, e chi li ha chiesti aspetta un `JobDone`.
    fn refuse_pending(&self) -> Vec<PluginError> {
        // Se il vault è avvelenato la coda non si può nemmeno leggere: ciò che
        // resta da dire è *quello*, e va nella stessa lista in cui vanno gli
        // altri guasti della chiusura.
        let pending = match self.shared.workspace.write() {
            Ok(mut ws) => ws.take_pending_jobs(),
            Err(and) => return vec![and],
        };
        pending
            .into_iter()
            .map(|job| {
                self.shared
                    .refuse(job, "non parte: il vault si sta chiudendo")
                    .unwrap_or_else(|and| and)
            })
            .collect()
    }
}

impl Drop for JobRunner {
    /// Rete di sicurezza: una sessione lasciata cadere senza `stop` non lascia
    /// dietro dei thread che scrivono in un vault che nessuno guarda più.
    ///
    /// Chi chiude passa da [`stop`](JobRunner::stop) e arriva qui con i thread
    /// già raccolti, quindi questo `Drop` non fa niente: è quello che deve fare
    /// una rete.
    fn drop(&mut self) {
        if self.is_running() {
            self.stop();
        }
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
mod tests {
    use super::*;
    use fub_abi::traits::WallClock;

    /// Cosa dice la bandiera di un job, o `None` se non ne ha una.
    fn flag(flags: &Flags, id: u64) -> Option<bool> {
        flags
            .live
            .get(&JobId(id))
            .map(|f| f.load(Ordering::Relaxed))
    }

    /// Annullare un job **preso in carico** lo raggiunge: è il caso normale.
    #[test]
    fn undo_a_job_live_raises_the_its_flag() {
        let mut flags = Flags::default();
        flags.claim(JobId(7));
        flags.cancel(JobId(7), 8);
        assert_eq!(flag(&flags, 7), Some(true));
    }

    /// Annullare un job che il pool **non ha ancora visto** deve valere: è la
    /// corsa che la 0032 ha deciso di non perdere. La bandiera nasce alzata, e
    /// il drenaggio la trova così invece di rimetterla a zero.
    #[test]
    fn undo_a_job_again_in_queue_the_waits() {
        let mut flags = Flags::default();
        flags.claim(JobId(3));
        // Il kernel ha già emesso fino al 9 compreso: quel job esiste, è in
        // coda, e il pool non l'ha ancora drenato.
        flags.cancel(JobId(9), 10);
        assert_eq!(flag(&flags, 9), Some(true));
        flags.claim(JobId(9));
        assert_eq!(flag(&flags, 9), Some(true));
    }

    /// Annullare un id che il kernel **non ha mai emesso** non lascia niente.
    ///
    /// È il caso che entra da fuori: l'id di un annullamento arriva sull'IPC
    /// come stringa, e nessuno garantisce che sia di questo vault — un elenco
    /// del centro attività rimasto indietro, o un altro vault diventato
    /// corrente, e il numero è di un job che qui non è mai esistito. Sopra il
    /// segno di `seen` sembrava «uno che deve ancora partire», e ogni pressione
    /// lasciava una bandiera per la vita della sessione.
    #[test]
    fn undo_a_id_never_issued_not_leaves_nothing() {
        let mut flags = Flags::default();
        flags.claim(JobId(1));
        // Il kernel ha emesso 0 e 1: il 42 non è mai stato un job.
        flags.cancel(JobId(42), 2);
        assert_eq!(flag(&flags, 42), None);
        assert_eq!(
            flags.live.len(),
            1,
            "un id mai emesso ha lasciato una bandiera che nessuno toglierà"
        );
        // E il confine è **esatto**, non prudenziale: l'ultimo emesso resta
        // annullabile prima che il pool lo veda.
        flags.cancel(JobId(1), 2);
        assert_eq!(flag(&flags, 1), Some(true));
    }

    /// Annullare un job **già concluso** non lascia niente dietro.
    ///
    /// È il pulsante premuto un istante troppo tardi, cioè il più comune dei
    /// tre casi: senza il segno ogni pressione lascerebbe una bandiera che
    /// nessuno toglie, e la mappa crescerebbe per tutta la vita del vault.
    #[test]
    fn undo_a_job_finished_not_leaves_nothing() {
        let mut flags = Flags::default();
        for id in [1, 2, 3] {
            flags.claim(JobId(id));
        }
        // Il pool ne ha riconsegnato l'esito: `Shared::forget` li toglie.
        for id in [1, 2, 3] {
            flags.live.remove(&JobId(id));
        }
        for id in [1, 2, 3] {
            flags.cancel(JobId(id), 4);
        }
        assert!(
            flags.live.is_empty(),
            "un annullamento arrivato tardi ha lasciato una bandiera"
        );
    }

    /// Un job ancora **in mano** al proprio thread è vivo quanto quello che
    /// gira, anche se il segno è già andato oltre.
    ///
    /// È la ragione per cui le bandiere nascono al drenaggio e non all'avvio: un
    /// lotto si esegue uno alla volta, e nel frattempo un altro thread può
    /// averne drenato uno più avanti. Col solo segno, i job in attesa del
    /// proprio turno sarebbero scambiati per job già finiti — e annullarli non
    /// farebbe niente.
    /// **La bandiera si guarda fra una fetta e l'altra**, ed è ciò che rende
    /// annullabile un lavoro che non chiama mai l'host (§15.7).
    ///
    /// Sta qui, su [`Shared::advance_opening`] chiamata a mano, e non su un
    /// pool acceso, per la ragione in testa a questo modulo: con dei thread
    /// veri la differenza fra «la bandiera ha fermato l'indicizzazione» e «il
    /// disco è arrivato in fondo prima che la si alzasse» è un istante da
    /// indovinare, e un presidio che si indovina non presidia. Chiamata da qui,
    /// nessuna fetta è ancora partita: se la bandiera vale, ne parte zero.
    #[test]
    fn with_the_flag_raised_no_one_slice_part() {
        let (_dir, shared, id) = a_vault_to_index();
        shared.flags.write().unwrap().claim(id);
        shared.flags.write().unwrap().cancel(id, id.0 + 1);

        assert!(
            shared.advance_opening().unwrap(),
            "c'era un'apertura da portare avanti"
        );

        assert!(
            shared.workspace.read().unwrap().documents().is_empty(),
            "una fetta è partita lo stesso: la bandiera non l'ha fermata"
        );
        // E l'apertura è **chiusa**, non sospesa: chi smette riceve un esito
        // come chiunque altro (0028), e non resta niente da portare avanti.
        assert!(
            !shared.advance_opening().unwrap(),
            "l'apertura annullata è rimasta in mano a qualcuno"
        );
    }

    /// **Chi ferma il pool chiude anche l'apertura che nessun thread ha
    /// finito** (§15.7).
    ///
    /// Il caso è quello di un worker che vede `stopping` in cima al proprio
    /// ciclo ed esce **senza passare da `advance_opening`**: da fuori quel
    /// momento non si provoca — dipende da dove il thread si trovava — e qui lo
    /// si mette in scena esattamente, con un pool che non ha thread. Senza la
    /// riga in fondo a [`JobRunner::stop`] l'apertura resterebbe in mano a
    /// nessuno, cioè un job vivo per sempre e un `wait_indexed` che non torna.
    #[test]
    fn stop_the_pool_from_a_outcome_all_opening_remaining() {
        let (_dir, shared, _id) = a_vault_to_index();
        let end = {
            let opening = shared.opening.read().unwrap();
            Arc::clone(&opening.as_ref().expect("un'apertura in corso").end)
        };
        let mut runner = JobRunner {
            shared: Arc::clone(&shared),
            workers: Vec::new(),
        };

        runner.stop();

        assert!(
            shared.opening.read().unwrap().is_none(),
            "l'apertura è rimasta appesa a pool fermo"
        );
        assert!(
            *end.0.lock().unwrap(),
            "chi aspettava l'indicizzazione non è stato svegliato"
        );
    }

    /// Il cancello che rende **osservabile** un parse lento senza dormire.
    ///
    /// `within` dice al test che il parse è cominciato, `via` gli lascia
    /// decidere quando finisce. Finché non è armato il formato parsa come
    /// qualunque altro.
    #[derive(Default)]
    struct Gate {
        within: Mutex<Option<std::sync::mpsc::Sender<()>>>,
        via: Mutex<Option<std::sync::mpsc::Receiver<()>>>,
    }

    impl Gate {
        fn arm(&self) -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>) {
            let (inside_tx, inside_rx) = std::sync::mpsc::channel();
            let (via_tx, via_rx) = std::sync::mpsc::channel();
            *self.within.lock().unwrap() = Some(inside_tx);
            *self.via.lock().unwrap() = Some(via_rx);
            (inside_rx, via_tx)
        }

        fn cross(&self) {
            let within = self.within.lock().unwrap().take();
            let via = self.via.lock().unwrap().take();
            if let (Some(within), Some(via)) = (within, via) {
                within.send(()).expect("il test aspetta il parse");
                via.recv().expect("il test lascia uscire il parse");
            }
        }
    }

    /// Un formato di testo nudo che, a cancello armato, si ferma dentro `parse`.
    struct Slow(Arc<Gate>);

    impl fub_abi::FormatProvider for Slow {
        fn descriptor(&self) -> fub_abi::format::FormatDescriptor {
            fub_abi::format::FormatDescriptor::text("prova.lento", "Lento", &["md"])
        }
        fn capabilities(&self) -> fub_abi::format::FormatCapabilities {
            fub_abi::format::FormatCapabilities::default()
        }
        fn parse(
            &self,
            source: &fub_abi::format::DocumentSource,
            ctx: &fub_abi::format::ParseContext,
        ) -> Result<fub_abi::model::DocumentModel, fub_abi::error::FormatError> {
            self.0.cross();
            let mut model = fub_abi::model::DocumentModel::empty(fub_abi::model::DocId::new(
                ctx.doc_id.clone(),
            ));
            model.text = source.text().unwrap_or_default().to_string();
            Ok(model)
        }
        fn render_html(
            &self,
            m: &fub_abi::model::DocumentModel,
            _or: &fub_abi::format::RenderOptions,
        ) -> Result<String, fub_abi::error::FormatError> {
            Ok(m.text.clone())
        }
        fn serialize(
            &self,
            m: &fub_abi::model::DocumentModel,
        ) -> Result<String, fub_abi::error::FormatError> {
            Ok(m.text.clone())
        }
    }

    struct OpeningIndexFeedLockProbe {
        entered: std::sync::mpsc::SyncSender<()>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }

    impl fub_abi::traits::IndexProvider for OpeningIndexFeedLockProbe {
        fn routes(&self) -> Vec<fub_abi::traits::QueryRoute> {
            Vec::new()
        }

        fn activate(&mut self, _: &mut dyn fub_abi::traits::HostApi) -> Result<(), PluginError> {
            Ok(())
        }

        fn on_documents_indexed(
            &mut self,
            _: &[fub_abi::model::DocumentModel],
        ) -> Vec<fub_abi::traits::IndexLoss> {
            self.entered.send(()).expect("il test aspetta il feed");
            self.release
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .recv_timeout(Duration::from_secs(10))
                .expect("il test lascia uscire il feed");
            Vec::new()
        }

        fn on_documents_removed(
            &mut self,
            _: &[fub_abi::model::DocId],
        ) -> Vec<fub_abi::traits::IndexLoss> {
            Vec::new()
        }

        fn reconcile(&mut self, _: &[fub_abi::model::DocId]) -> Vec<fub_abi::traits::IndexLoss> {
            Vec::new()
        }

        fn flush(&mut self, _: &mut dyn fub_abi::traits::HostApi) -> Result<(), PluginError> {
            Ok(())
        }

        fn close(&mut self, _: &mut dyn fub_abi::traits::HostApi) -> Result<(), PluginError> {
            Ok(())
        }

        fn query(
            &self,
            _: fub_abi::traits::IndexQuery,
        ) -> Result<fub_abi::traits::IndexResult, PluginError> {
            Err(PluginError::Unserved("feed-only probe".into()))
        }

        fn up_to_date(&self, _: &[fub_abi::traits::VaultEntry]) -> Vec<fub_abi::model::DocId> {
            Vec::new()
        }
    }

    #[test]
    fn reader_enters_while_opening_feeds_an_external_index() {
        let mut formats = fub_kernel::FormatRegistry::new();
        formats
            .register(fub_format_markdown::MarkdownProvider::boxed())
            .expect("un provider di formato solo non confligge");
        let (_dir, shared, _id, _root) = a_vault_scanned(1, formats);
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        {
            let mut ws = shared.workspace.write().expect("il vault è vivo");
            ws.register_plugin(
                fub_abi::traits::PluginManifest::new(
                    "fub.audit-index-feed-opening",
                    "Audit detached opening index feed",
                ),
                fub_kernel::Trust::Community,
            )
            .expect("l'owner dell'indice si dichiara");
            ws.register_index_provider(
                "fub.audit-index-feed-opening",
                Box::new(OpeningIndexFeedLockProbe {
                    entered: entered_tx,
                    release: Mutex::new(release_rx),
                }),
            )
            .expect("il probe dell'indice si registra");
        }

        let slice = {
            let shared = Arc::clone(&shared);
            std::thread::spawn(move || shared.advance_opening())
        };
        entered_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("IndexProvider::on_documents_indexed entra durante l'apertura");
        let reader_progressed = shared.workspace.try_read().is_some();
        release_tx.send(()).expect("il feed può terminare");
        let outcome = slice.join().expect("il thread dell'apertura non panica");

        assert!(
            reader_progressed,
            "la seconda fase dell'apertura ha tenuto Custody<Workspace> durante \
             IndexProvider::on_documents_indexed"
        );
        assert!(
            outcome.expect("nessun veleno"),
            "c'era una fetta di apertura da portare avanti"
        );
    }

    /// **La proprietà** (0119, secondo sito): mentre la fetta dell'apertura
    /// legge e parsa il disco, chi legge entra nel workspace.
    ///
    /// È la stessa proprietà del lotto del watcher
    /// (`tests/il_lotto_del_watcher.rs`) sul percorso dove i file non sono
    /// quattro ma quattromila — cioè dove l'attesa è l'app ferma all'avvio di un
    /// vault grosso. Qui non si cronometra niente: un tempo su una macchina
    /// condivisa non è un segnale, e la proprietà comprata non è «più veloce» —
    /// è che *durante* quella lettura il prestito condiviso si prende ancora.
    ///
    /// `try_read` e non `read`: un `read` che aspettasse sarebbe verde anche col
    /// prestito esclusivo, perché aspetterebbe la fine del parse e poi
    /// passerebbe.
    #[test]
    fn who_reads_enters_while_the_opening_slice_reads_the_disk() {
        let gate: Arc<Gate> = Arc::default();
        let mut formats = fub_kernel::FormatRegistry::new();
        formats
            .register(Box::new(Slow(gate.clone())))
            .expect("un provider solo non va in conflitto");
        // Una nota sola: una fetta sola, quindi il cancello si attraversa una
        // volta e il test non deve indovinare quante.
        let (_dir, shared, _id, _root) = a_vault_scanned(1, formats);

        let (within, via) = gate.arm();
        let slice = {
            let shared = Arc::clone(&shared);
            std::thread::spawn(move || shared.advance_opening())
        };

        // Il parse è cominciato: da qui in poi la fetta sta facendo I/O.
        within.recv().expect("la fetta entra nel parse");
        let read_value = shared.workspace.try_read();
        assert!(
            read_value.is_some(),
            "il workspace non si presta mentre la fetta dell'apertura legge il \
             disco: la fase che legge e parsa tiene il prestito esclusivo, e chi \
             guarda il vault appena aperto — la ricerca, l'albero — aspetta \
             un'I/O che non lo riguarda (0024, 0119)"
        );
        // E non è un prestito vuoto: da lì si interroga davvero.
        assert!(read_value
            .expect("il prestito condiviso c'è")
            .query_index(fub_abi::traits::IndexQuery::VaultStatus)
            .is_ok());
        via.send(()).expect("la fetta può finire");
        assert!(
            slice
                .join()
                .expect("il thread finisce")
                .expect("nessun veleno"),
            "c'era un'apertura da portare avanti"
        );

        // E la fetta ha fatto il suo lavoro.
        assert_eq!(
            shared.workspace.read().unwrap().documents().len(),
            1,
            "la fetta ha letto e parsato, ma non ha applicato niente"
        );
    }

    /// **Un job che il runner non riesce nemmeno a preparare ha comunque un
    /// esito** (0028, e il difetto 0203).
    ///
    /// La bandiera nasce prima del corpo, e prenderla vuol dire prendere un
    /// lucchetto che con la risposta di questo job non c'entra niente: se è
    /// avvelenato il job non parte, ma il canale su cui rispondere — il
    /// workspace — è vivo e ha tutto ciò che serve. Un `?` lì buttava via il
    /// job insieme al guasto, e chi lo aveva chiesto aspettava un `JobDone`
    /// che non sarebbe mai arrivato.
    #[test]
    fn a_job_that_not_is_succeeds_a_prepare_has_anyway_a_outcome() {
        let (_dir, shared, _id) = a_vault_to_index();
        let subscription = shared.workspace.read().unwrap().bus().subscribe();
        poison(&shared.flags);

        let outcome = shared.run(a_job(7));

        assert!(
            outcome.is_err(),
            "il veleno delle bandiere deve restare visibile: è ciò che ferma il pool"
        );
        assert_eq!(
            completed(&subscription),
            vec!["lavoro-7".to_string()],
            "il job è sparito senza dire niente: chi lo ha chiesto aspetta un \
             `JobDone` che non arriverà, e il workspace era vivo"
        );
    }

    /// **Un lotto già drenato non sparisce insieme al pool che si ferma.**
    ///
    /// `take_pending_jobs` svuota la coda: da lì in poi quei job stanno solo
    /// nelle mani di questo thread, e `refuse_pending` alla chiusura guarda la
    /// coda. Un `?` in mezzo al ciclo li portava via tutti — non solo quello su
    /// cui si è inciampato — e succedeva nel ramo che si imbocca quando
    /// qualcosa è già andato storto, cioè quando nessuno sta guardando.
    #[test]
    fn a_drained_batch_does_not_disappear_from_pool() {
        let (_dir, shared, _id) = a_vault_to_index();
        let subscription = shared.workspace.read().unwrap().bus().subscribe();
        poison(&shared.flags);

        let outcome = shared.batch(vec![a_job(1), a_job(2), a_job(3)]);

        assert!(
            outcome.is_err(),
            "il guasto che ferma il pool resta un guasto"
        );
        assert_eq!(
            completed(&subscription),
            vec![
                "lavoro-1".to_string(),
                "lavoro-2".to_string(),
                "lavoro-3".to_string()
            ],
            "il lotto è uscito dalla coda e non è arrivato da nessuna parte: \
             chi aveva chiesto quei job li aspetta per sempre"
        );
    }

    /// Un job da eseguire, di un componente che non esiste: qui non si guarda
    /// cosa risponde: si guarda **se** risponde.
    fn a_job(id: u64) -> PendingJob {
        PendingJob {
            id: JobId(id),
            plugin: "prova.componente".to_string(),
            spec: fub_abi::traits::JobSpec {
                job: format!("lavoro-{id}"),
                payload: serde_json::Value::Null,
            },
        }
    }

    /// I job che hanno ricevuto un esito, nell'ordine in cui l'hanno ricevuto.
    fn completed(subscription: &fub_kernel::bus::Subscription) -> Vec<String> {
        let mut done = Vec::new();
        while let Ok(notice) = subscription.try_recv() {
            if let fub_abi::Event::JobDone { job, .. } = notice.event {
                done.push(job);
            }
        }
        done
    }

    /// Avvelena una custodia come la avvelena la vita: un thread che pania
    /// tenendo il prestito **esclusivo**. Il panico è di proposito e non deve
    /// sporcare l'output del banco.
    fn poison<T: Send + Sync + 'static>(c: &Custody<T>) {
        let copy = c.clone();
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::thread::spawn(move || {
            let _g = copy.write().expect("viva prima del misfatto");
            panic!("a metà");
        })
        .join();
        std::panic::set_hook(hook);
    }

    /// Un vault seminato, scansionato e con la sua identità di job: il punto in
    /// cui `Host::open` consegna la seconda fase al pool.
    fn a_vault_to_index() -> (tempfile::TempDir, Arc<Shared>, JobId) {
        let mut formats = fub_kernel::FormatRegistry::new();
        formats
            .register(fub_format_markdown::MarkdownProvider::boxed())
            .expect("un provider solo non va in conflitto");
        let (dir, shared, id, _) = a_vault_scanned(3, formats);
        (dir, shared, id)
    }

    /// Lo stesso, con il registro dei formati in mano al chiamante: è la leva
    /// con cui il presidio del prestito mette un parse **lento** sul percorso
    /// dell'apertura.
    fn a_vault_scanned(
        count: usize,
        formats: fub_kernel::FormatRegistry,
    ) -> (tempfile::TempDir, Arc<Shared>, JobId, camino::Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root =
            camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("una radice utf8");
        for n in 0..count {
            std::fs::write(root.join(format!("Nota{n}.md")), "# Titolo\n\nCorpo.\n")
                .expect("semina");
        }

        let mut ws = Workspace::new(&root, formats).expect("la radice appena creata si apre");
        let work = ws.scan_vault().expect("la scansione riesce");
        assert_eq!(work.total(), count as u64, "le note seminate si leggono");
        let id = ws.begin_index_job();

        let shared = Shared {
            workspace: Custody::new("il vault di prova", ws),
            bundles: Custody::new("i componenti di prova", BundleRegistry::new()),
            bell: Arc::new(JobBell::default()),
            stopping: AtomicBool::new(false),
            opening: Custody::new(
                "l'apertura di prova",
                Some(InProgress {
                    id,
                    total: work.total(),
                    work,
                    unread: Custody::empty("gli scarti di prova"),
                    end: Arc::new((Mutex::new(false), Condvar::new())),
                }),
            ),
            flags: Custody::empty("le bandiere di prova"),
            alarms: Custody::empty("le sveglie di prova"),
            in_flight: Arc::new((Mutex::new(InFlight::default()), Condvar::new())),
        };
        (dir, Arc::new(shared), id, root)
    }

    #[test]
    fn a_job_in_wait_of_the_own_turn_is_cancels() {
        let mut flags = Flags::default();
        flags.claim(JobId(4)); // il lotto di un thread
        flags.claim(JobId(5));
        flags.claim(JobId(6)); // il lotto di un altro, già più avanti
        flags.claim(JobId(7));
        flags.live.remove(&JobId(4)); // il 4 è finito
        flags.cancel(JobId(5), 8); // il 5 aspetta ancora il proprio turno
        assert_eq!(flag(&flags, 5), Some(true));
        assert_eq!(flag(&flags, 4), None);
    }
    // -----------------------------------------------------------------------
    // Le due sorgenti di tempo dentro lo stesso quadrante (§22.4, 0091).
    // -----------------------------------------------------------------------

    fn declare(id: &str, schedule: TimerSchedule) -> (String, fub_abi::traits::TimerSpec) {
        (
            "test.sveglia".to_string(),
            fub_abi::traits::TimerSpec {
                id: id.to_string(),
                schedule,
            },
        )
    }

    /// **Le due famiglie convivono nello stesso scheduler e non si mescolano.**
    ///
    /// Un `every` prende la propria prossima da `nth_after` e un orario di parete
    /// dal calendario, e nessuno dei due passa dalla regola dell'altro: se ci
    /// passassero, o «ogni ora» slitterebbe con l'ora legale, o «alle 9»
    /// diventerebbe «ogni 86400 secondi da adesso», che è la cosa che questa
    /// voce esiste per non fare.
    #[test]
    fn the_two_families_coexist_in_the_same_quadrant() {
        let mut alarms = Alarms::default();
        let now = Instant::now();
        alarms.reconcile_with_cursors(
            &[
                declare("battito", TimerSchedule::Every { seconds: 3600 }),
                declare(
                    "digest",
                    // Mezzanotte e un minuto: sempre nel futuro, salvo il minuto
                    // in cui questo test giri esattamente lì.
                    TimerSchedule::AtWallClock(WallClock::daily(0, 1).anchored("Europe/Rome")),
                ),
            ],
            now,
            "",
            &HashMap::new(),
        );
        assert_eq!(alarms.quadrants.len(), 2);

        let wall = &alarms.quadrants[&("test.sveglia".into(), "digest".into())];
        assert!(
            wall.next.is_some(),
            "una sveglia di parete ha una prossima: gliela dà il calendario"
        );
        assert!(
            wall.position.wait_for.is_some(),
            "e sa quale occorrenza sta aspettando, che è ciò che le fa \
             distinguere una suonata puntuale da un recupero"
        );
        assert_eq!(
            wall.position.wait_for.map(|a| (a.hour, a.minute)),
            Some((0, 1))
        );

        // Il trascorso non ha imparato niente dal calendario: la sua prossima è
        // ancora un'ora dall'ancora, come è sempre stata.
        let elapsed = &alarms.quadrants[&("test.sveglia".into(), "battito".into())];
        assert_eq!(elapsed.position, Position::default());
        assert_eq!(
            elapsed.next,
            Some(elapsed.still + Duration::from_secs(3600))
        );
    }

    /// **Un fuso che il database non conosce non fa suonare la sveglia.**
    ///
    /// E la voce resta in mappa a non suonare, invece di sparire: sparire
    /// vorrebbe dire farla riseminare dalla riconciliazione al giro dopo, e il
    /// pool si sveglierebbe a vuoto per sempre.
    #[test]
    fn a_timezone_unresolvable_not_falls_back_and_not_rings() {
        let mut alarms = Alarms::default();
        let now = Instant::now();
        alarms.reconcile_with_cursors(
            &[declare(
                "digest",
                TimerSchedule::AtWallClock(WallClock::daily(9, 0).anchored("Europa/Roma")),
            )],
            now,
            "",
            &HashMap::new(),
        );
        let q = &alarms.quadrants[&("test.sveglia".into(), "digest".into())];
        assert_eq!(q.next, None, "non suona");
        assert_eq!(
            alarms.time_until(now),
            None,
            "e chi aspetta non si sveglia per lei"
        );
        assert!(alarms.expired(now, "").is_empty());
        assert_eq!(alarms.quadrants.len(), 1, "ma resta dichiarata");
    }

    /// Una sveglia di parete che sparisce dal manifest sparisce dai quadranti,
    /// come ogni altra: la sorgente resta il manifest a ogni giro.
    #[test]
    fn also_a_alarm_of_wall_dies_col_manifest() {
        let mut alarms = Alarms::default();
        let now = Instant::now();
        let declared = [declare(
            "digest",
            TimerSchedule::AtWallClock(WallClock::daily(9, 0)),
        )];
        alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
        assert_eq!(alarms.quadrants.len(), 1);
        alarms.reconcile_with_cursors(&[], now, "", &HashMap::new());
        assert!(alarms.quadrants.is_empty());
    }

    /// **Un recupero di parete calcolato in `reconcile` non si perde**: viene
    /// conservato e drenato una volta sola da `expired`.
    ///
    /// È il difetto che aveva `reconcile` a chiamare `wall` e a buttarne via
    /// il risultato — [`position`](Quadrant::position) era già avanzato, e la
    /// `wall` di `expired` non l'avrebbe più visto. Qui lo si mette in scena senza
    /// dormire: si torna indietro l'ultima occorrenza considerata di un giorno,
    /// e la riconciliazione successiva la vede come un recupero dovuto.
    #[test]
    fn a_recovery_of_wall_is_preserves_and_is_drains_a_time() {
        let mut alarms = Alarms::default();
        let now = Instant::now();
        let declared = [declare(
            "digest",
            TimerSchedule::AtWallClock(WallClock::daily(0, 0).catching_up(86400)),
        )];
        alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());

        // Simula il passare di un'occorrenza mentre il pool dormiva: l'ultima
        // occorrenza considerata torna indietro di un giorno, come se la
        // sveglia fosse stata in letargo dall'occorrenza precedente.
        {
            let q = alarms
                .quadrants
                .get_mut(&("test.sveglia".into(), "digest".into()))
                .expect("la sveglia è dichiarata");
            q.position.last = q.position.last.map(|u| u.prev_day());
        }

        alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
        let fired = alarms.expired(now, "");
        assert_eq!(
            fired,
            vec![("test.sveglia".to_string(), "digest".to_string())],
            "il recupero accumulato in riconcilia non è arrivato a scadute"
        );
        // Drenato una volta sola: una seconda chiamata non lo ridà.
        assert!(
            alarms.expired(now, "").is_empty(),
            "il recupero drenato si è ripresentato"
        );
    }

    /// Più riconciliazioni prima di un drenaggio non duplicano il recupero.
    #[test]
    fn more_reconciliations_not_duplicate_a_recovery() {
        let mut alarms = Alarms::default();
        let now = Instant::now();
        let declared = [declare(
            "digest",
            TimerSchedule::AtWallClock(WallClock::daily(0, 0).catching_up(86400)),
        )];
        alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
        {
            let q = alarms
                .quadrants
                .get_mut(&("test.sveglia".into(), "digest".into()))
                .expect("la sveglia è dichiarata");
            q.position.last = q.position.last.map(|u| u.prev_day());
        }
        alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
        // Una seconda riconciliazione prima che `expired` dreni.
        alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
        assert_eq!(
            alarms.expired(now, "").len(),
            1,
            "due riconciliazioni hanno duplicato un recupero"
        );
    }

    /// Una sveglia rimossa dal manifest non suona per un recupero accumulato
    /// prima di sparire.
    #[test]
    fn a_alarm_removed_not_recovers() {
        let mut alarms = Alarms::default();
        let now = Instant::now();
        let declared = [declare(
            "digest",
            TimerSchedule::AtWallClock(WallClock::daily(0, 0).catching_up(86400)),
        )];
        alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
        {
            let q = alarms
                .quadrants
                .get_mut(&("test.sveglia".into(), "digest".into()))
                .expect("la sveglia è dichiarata");
            q.position.last = q.position.last.map(|u| u.prev_day());
        }
        alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
        // La sveglia sparisce dal manifest: il suo recupero accumulato sparisce
        // con lei.
        alarms.reconcile_with_cursors(&[], now, "", &HashMap::new());
        assert!(
            alarms.expired(now, "").is_empty(),
            "una sveglia rimossa suona per un recupero accumulato prima di sparire"
        );
    }
    /// Il cursore sopravvive alla ricostruzione dello scheduler: la suonata
    /// mancata entro finestra arriva, quella oltre finestra viene consumata, e
    /// un timer trascorso futuro non cambia ancora.
    #[test]
    fn a_wall_clock_cursor_survives_a_restart_with_window_and_future_intact() {
        let now = Instant::now();
        let declared = [
            declare(
                "digest",
                TimerSchedule::AtWallClock(
                    WallClock::daily(9, 0).anchored("UTC").catching_up(3600),
                ),
            ),
            declare("heartbeat", TimerSchedule::Every { seconds: 3600 }),
        ];
        let first_time: Timestamp = "2026-01-15T08:00:00Z".parse().expect("timestamp");
        let mut first = Alarms::default();
        first.reconcile_with_cursors_at(&declared, now, "", &HashMap::new(), first_time);
        let cursors: HashMap<_, _> = first
            .cursors()
            .into_iter()
            .map(|(owner, timer, cursor)| ((owner, timer), cursor))
            .collect();

        let mut resumed = Alarms::default();
        let within_window: Timestamp = "2026-01-15T09:20:00Z".parse().expect("timestamp");
        resumed.reconcile_with_cursors_at(&declared, now, "", &cursors, within_window);
        assert_eq!(
            resumed.expired_at(now, "", within_window),
            vec![("test.sveglia".into(), "digest".into())]
        );
        let elapsed = &resumed.quadrants[&("test.sveglia".into(), "heartbeat".into())];
        assert_eq!(elapsed.next, Some(now + Duration::from_secs(3600)));

        let mut late = Alarms::default();
        let outside_window: Timestamp = "2026-01-15T13:00:00Z".parse().expect("timestamp");
        late.reconcile_with_cursors_at(&declared, now, "", &cursors, outside_window);
        assert!(
            late.expired_at(now, "", outside_window).is_empty(),
            "un'occorrenza oltre catch_up_seconds non deve suonare"
        );
        let elapsed = &late.quadrants[&("test.sveglia".into(), "heartbeat".into())];
        assert_eq!(elapsed.next, Some(now + Duration::from_secs(3600)));
    }
}
