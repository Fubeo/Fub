//! **Il runner dei job**: chi possiede i thread su cui gira il lavoro lungo
//! (§9.3, [decisione 0032](../../../docs/decisions/0032-il-runner-dei-job.md)).
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
//! ([decisione 0027](../../../docs/decisions/0027-il-lavoro-lungo-vede-il-vault.md)).
//! Il corpo del job lo dà chi possiede i bundle
//! ([decisione 0031](../../../docs/decisions/0031-chi-possiede-i-bundle.md)): la
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
//! la stessa forma della [0029](../../../docs/decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md):
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
use fub_kernel::{Indicizzazione, JobBell, PendingJob, Workspace};
use jiff::Timestamp;

use crate::parete::{verdetto, Fuso, Posizione};

use crate::custodia::Custodia;
use crate::jobs::JobHost;
use crate::records::UnreadDoc;
use crate::registry::BundleRegistry;

/// Quanti thread, se non lo dice nessuno.
///
/// **Due**, e nessuna delle due metà del numero è arbitraria. Non uno, perché un
/// job che aspetta la rete non deve tenere fermo un job che calcola — è la
/// ragione per cui un pool esiste invece di un worker. Non «quanti core»,
/// perché il parallelismo utile non lo limitano i core: lo limita il `RwLock`
/// del workspace ([decisione 0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)),
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
    /// `Shared::run` e `avanza_apertura` chiamano `forget`, e un job che non
    /// esiste non passa né dall'uno né dall'altro.
    ///
    /// Chi sa distinguere i due casi è il kernel, che gli id li **emette**
    /// ([`Workspace::jobs_issued`]): sotto quel segno l'id è stato dato a
    /// qualcuno e la coda lo consegnerà, da lì in su non è mai stato un job e
    /// non c'è niente da aspettare. Non è un tetto prudenziale — è la stessa
    /// domanda del campo `seen`, posta all'unico che ne ha la risposta esatta.
    fn cancel(&mut self, id: JobId, emessi: u64) {
        if let Some(flag) = self.live.get(&id) {
            flag.store(true, Ordering::Relaxed);
            return;
        }
        let da_venire = match self.seen {
            Some(seen) => id.0 > seen,
            None => true,
        };
        if da_venire && id.0 < emessi {
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
const VELENO: &str = "il conto dei job in volo è avvelenato";

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
struct InVolo {
    /// Le bandiere dei job che sono **dentro** `run_job` adesso, per bundle.
    ///
    /// La bandiera e non il solo conto: chi aspetta la alza, ed è tutto ciò che
    /// vuol dire chiedere a un job di smettere.
    dentro: HashMap<String, HashMap<JobId, Arc<AtomicBool>>>,
    /// I bundle che si stanno spegnendo: un loro job non parte più.
    ///
    /// Senza, il pool riempirebbe da dietro ciò che chi spegne sta svuotando —
    /// un drenaggio prende **tutta** la coda, e aspettare che esca uno mentre
    /// parte il successivo è un'attesa che non finisce.
    fermi: HashSet<String>,
}

/// Un job **dentro** il codice del suo bundle: finché questo vive, chi vuole
/// spegnere quel bundle aspetta.
///
/// È la forma del `Lotto` del kernel: uscire non si può dimenticare, perché non
/// lo fa nessuno — lo fa il `Drop`. Un job che panicasse a metà, o che tornasse
/// da un ramo d'errore scritto domani, esce lo stesso; e chi spegne resterebbe
/// ad aspettare per sempre se uscire fosse una riga da ricordarsi.
struct Dentro {
    volo: Arc<(Mutex<InVolo>, Condvar)>,
    plugin: String,
    id: JobId,
}

impl Drop for Dentro {
    fn drop(&mut self) {
        let (posto, campana) = &*self.volo;
        // Un `Drop` non pania: durante uno srotolamento costerebbe il processo
        // invece del job. Il veleno qui lo si prende com'è — ciò che resta da
        // fare è togliersi dal conto, e va fatto comunque.
        let mut volo = posto.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(dentro) = volo.dentro.get_mut(&self.plugin) {
            dentro.remove(&self.id);
            if dentro.is_empty() {
                volo.dentro.remove(&self.plugin);
            }
        }
        campana.notify_all();
    }
}

/// **Il diritto di spegnere un bundle**: finché vive, nessun job di quel bundle
/// parte e nessuno è dentro il suo codice.
///
/// Lo si tiene per il tempo dello spegnimento e lo si lascia cadere dopo: è un
/// permesso, non uno stato. Lasciarlo alzato per sempre vorrebbe dire che
/// riaccendere un componente non gli restituisce i job.
pub struct Fermo {
    volo: Arc<(Mutex<InVolo>, Condvar)>,
    plugin: String,
}

impl Drop for Fermo {
    fn drop(&mut self) {
        let (posto, campana) = &*self.volo;
        let mut volo = posto.lock().unwrap_or_else(|e| e.into_inner());
        volo.fermi.remove(&self.plugin);
        campana.notify_all();
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
/// [`crate::parete`].
///
/// Le due **non si sommano mai**: l'attesa resta sempre e solo monotona, perché
/// aspettare è «per quanto» e non «fino a quando». Il tempo di parete entra in
/// un punto solo — *fra quanti secondi accade quell'ora civile* — e da lì in poi
/// il campo [`prossima`](Quadrante::prossima) è dello stesso tipo per tutte e
/// tre le forme. Un orologio spostato allunga o accorcia una singola attesa e
/// poi si ricalcola; che una sveglia di parete non suoni due volte non dipende
/// dall'orologio ma dalla sua [`ultima`](Quadrante::ultima) occorrenza civile.
#[derive(Default)]
struct Sveglie {
    /// Chiave: (componente, nome della sveglia).
    quadranti: HashMap<(String, String), Quadrante>,
}

struct Quadrante {
    schedule: TimerSchedule,
    /// Da quando si conta: la prima volta che questo scheduler l'ha vista.
    /// Solo per il tempo trascorso — un orario di parete non conta da quando è
    /// stato registrato, conta dal calendario.
    ancora: Instant,
    /// Quante volte ha già suonato (tempo trascorso).
    suonate: u64,
    /// Dove sta una sveglia di **parete**: l'ultima occorrenza civile
    /// considerata e quella che sta aspettando.
    ///
    /// È l'invariante «al più una suonata per occorrenza» reso un campo, ed è
    /// ciò che fa suonare una volta sola le 2:30 che l'uscita dell'ora legale fa
    /// accadere due volte.
    dove: Posizione,
    /// Quando suona la prossima. `None` = ha finito (un `after` che è già
    /// suonato, o un orario di parete impossibile), e la voce **resta** in mappa
    /// proprio per non essere riseminata dalla riconciliazione al giro dopo.
    prossima: Option<Instant>,
}

impl Sveglie {
    /// Allinea i quadranti a ciò che è dichiarato **adesso**.
    ///
    /// È qui che una sveglia nasce e muore, e il fatto che la sorgente sia il
    /// manifest a ogni giro invece che una copia presa una volta è ciò che fa
    /// smettere di suonare un componente disattivato — senza che questo codice
    /// sappia niente della disattivazione.
    ///
    /// `fuso_macchina` è il nome IANA che il locale risolve
    /// ([`locale.timezone`](fub_kernel::locale::TIMEZONE)): vuoto = quello del
    /// sistema. Non è una chiave nuova, ed è la misura che ha risparmiato
    /// un'impostazione — vedi la decisione 0091.
    fn riconcilia(
        &mut self,
        dichiarate: &[(String, fub_abi::traits::TimerSpec)],
        ora: Instant,
        fuso_macchina: &str,
    ) {
        self.quadranti.retain(|(owner, timer), _| {
            dichiarate
                .iter()
                .any(|(o, spec)| o == owner && &spec.id == timer)
        });
        for (owner, spec) in dichiarate {
            self.quadranti
                .entry((owner.clone(), spec.id.clone()))
                .or_insert_with(|| Quadrante {
                    schedule: spec.schedule.clone(),
                    ancora: ora,
                    suonate: 0,
                    dove: Posizione::default(),
                    prossima: spec
                        .schedule
                        .nth_after(0)
                        .map(|s| ora + Duration::from_secs(s)),
                });
        }
        // Gli orari di parete si ricalcolano **a ogni giro** e non solo alla
        // nascita, perché la loro prossima non è una funzione di quante volte
        // hanno suonato: è una funzione di che giorno è. Ricalcolarla qui è
        // anche ciò che rende gratis il caso in cui l'utente sposta l'orologio o
        // cambia `locale.timezone` mentre l'app è viva — non c'è niente da
        // invalidare, perché non c'era niente di derivato da tenere.
        self.parete(ora, fuso_macchina);
    }

    /// Riporta i quadranti di parete a ciò che dice il calendario adesso, e
    /// raccoglie chi va suonato **per recupero**.
    ///
    /// È l'unico punto in cui questo modulo tocca il tempo di sistema. Il fatto
    /// che restituisca già le suonate invece di lasciarle a
    /// [`scadute`](Sveglie::scadute) non è comodità: un recupero è per
    /// definizione un'occorrenza già passata, e passarla per un `prossima` nel
    /// passato l'avrebbe fatta suonare *anche* la volta dopo.
    fn parete(&mut self, ora: Instant, fuso_macchina: &str) -> Vec<(String, String)> {
        let adesso = Timestamp::now();
        let mut recuperi = Vec::new();
        for (chiave, q) in self.quadranti.iter_mut() {
            let Some(sveglia) = q.schedule.wall_clock() else {
                continue;
            };
            let Some(fuso) = Fuso::della(sveglia, fuso_macchina) else {
                // Fuso irrisolvibile: la sveglia non suona, e resta in mappa a
                // non suonare — non ripiega su UTC.
                q.prossima = None;
                continue;
            };
            let v = verdetto(sveglia, &fuso, adesso, q.dove);
            q.dove = v.dove;
            q.prossima = v.fra.map(|d| ora + d);
            if v.suona {
                recuperi.push(chiave.clone());
            }
        }
        recuperi.sort();
        recuperi
    }

    /// Fra quanto suona la prima. `None` = nessuna sveglia viva, e chi aspetta
    /// può dormire senza scadenza come faceva prima che le sveglie esistessero.
    fn fra_quanto(&self, ora: Instant) -> Option<Duration> {
        self.quadranti
            .values()
            .filter_map(|q| q.prossima)
            .min()
            .map(|p| p.saturating_duration_since(ora))
    }

    /// Chi è scaduto, con il quadrante già avanzato al giro dopo.
    fn scadute(&mut self, ora: Instant, fuso_macchina: &str) -> Vec<(String, String)> {
        let mut suonano = Vec::new();
        for (chiave, q) in self.quadranti.iter_mut() {
            // Un orario di parete non si avanza qui: la sua prossima non è una
            // funzione di quante volte ha suonato, e a ricalcolarla è
            // [`parete`](Sveglie::parete), che gira subito sotto.
            if q.schedule.wall_clock().is_some() {
                continue;
            }
            let Some(prossima) = q.prossima else { continue };
            if prossima > ora {
                continue;
            }
            suonano.push(chiave.clone());
            q.suonate += 1;
            // Dall'**ancora** e non da adesso: contare dal risveglio farebbe
            // slittare in avanti «ogni ora» di quanto il pool ha tardato, e
            // dopo un giorno la sveglia delle nove sarebbe delle nove e un
            // quarto senza che nessuno abbia cambiato niente.
            q.prossima = q
                .schedule
                .nth_after(q.suonate)
                .map(|s| q.ancora + Duration::from_secs(s));
        }
        suonano.sort();
        // I due modi di essere scaduti si uniscono qui e non prima, perché sono
        // due domande diverse fatte allo stesso orologio: «è passato
        // l'intervallo?» e «è passata l'ora?».
        suonano.extend(self.parete(ora, fuso_macchina));
        suonano
    }
}

/// Ciò che i thread condividono: il vault, chi possiede i bundle, il campanello,
/// le bandiere di chi è stato annullato, e i quadranti delle sveglie.
struct Shared {
    workspace: Custodia<Workspace>,
    bundles: Custodia<BundleRegistry>,
    bell: Arc<JobBell>,
    /// Il pool sta chiudendo: nessun job nuovo parte.
    stopping: AtomicBool,
    /// **La seconda fase dell'apertura**, finché non è finita (§15.7).
    ///
    /// Sta qui e non in un thread suo perché il pool è già ciò che serve: sa
    /// aspettare senza chiedere, sa smettere, e ha le bandiere. Un thread
    /// dedicato all'indicizzazione avrebbe voluto una seconda cancellazione, un
    /// secondo modo di chiudere e un secondo posto da cui il workspace si
    /// prende in esclusiva — cioè tre cose che il §9.3 ha già deciso una volta.
    apertura: Custodia<Option<InCorso>>,
    flags: Custodia<Flags>,
    /// Le sveglie sono **una** per pool e non una per thread: due thread con due
    /// quadranti farebbero suonare ogni sveglia due volte.
    sveglie: Custodia<Sveglie>,
    /// Chi è dentro il codice di un bundle, e chi si sta spegnendo.
    ///
    /// Un `Mutex` con una `Condvar` e non una [`Custodia`]: qui non si prende
    /// un prestito, si **aspetta un fatto**, e la 0120 presta e basta. È la
    /// stessa coppia di [`InCorso::fine`], per la stessa ragione.
    volo: Arc<(Mutex<InVolo>, Condvar)>,
}

/// La prima fotografia del vault: una chiusura che riceve il workspace — già
/// sotto l'esclusivo — e scatta la passata, prima della prima fetta (§25.3).
#[cfg(feature = "versioning")]
pub(crate) type PrimaFotografia =
    Box<dyn FnOnce(&mut Workspace) -> Result<(), PluginError> + Send + Sync>;

/// L'indicizzazione dell'apertura mentre gira: il lavoro, la sua identità di
/// job, e dove va a finire il suo esito.
pub struct InCorso {
    pub(crate) id: JobId,
    pub(crate) work: Indicizzazione,
    /// Il totale non cambia più dopo la scansione, e si tiene qui perché il
    /// progresso lo vuole a ogni fetta.
    pub(crate) totale: u64,
    /// Ciò che di questo vault non si è potuto leggere, per chi risponde a
    /// `Host::vaults()`. È condiviso perché la risposta esiste **prima** di
    /// questo esito: chi apre non aspetta l'indicizzazione, quindi il posto
    /// dove gli scarti si depositano deve esserci già quando ancora non ce n'è
    /// nessuno.
    pub(crate) unread: Custodia<Vec<UnreadDoc>>,
    /// **Quando l'indicizzazione ha finito**, per chi deve aspettarla.
    ///
    /// Una condizione e non un'attesa a intervalli, per la stessa ragione per
    /// cui il campanello dei job non è un polling
    /// ([0032](../../../docs/decisions/0032-il-runner-dei-job.md)): un
    /// intervallo è una politica da scegliere — ogni quanto? a che costo? —
    /// dove basta un fatto.
    pub(crate) fine: Arc<(Mutex<bool>, Condvar)>,
    /// La prima fotografia del vault, da scattare una volta per apertura,
    /// prima della prima fetta (§25.3). La chiusura esiste solo col versioning
    /// acceso; `take()` la consuma, quindi la garanzia una-sola-volta è il
    /// tipo, non un flag.
    #[cfg(feature = "versioning")]
    pub(crate) fotografia: Option<PrimaFotografia>,
}

impl Shared {
    /// **Porta avanti l'apertura di una fetta**, e dice se c'era qualcosa da
    /// portare avanti (§15.7).
    ///
    /// Una fetta alla volta, e non il giro intero, perché fra una fetta e
    /// l'altra succedono le tre cose per cui questa voce esiste: il workspace
    /// si libera — `reindex` lo teneva in esclusiva ~780 ms su 2000 note
    /// ([0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)) —,
    /// il progresso si timbra, e la bandiera si guarda.
    ///
    /// **L'apertura ha la precedenza sui job**, e non è un caso: un job chiesto
    /// da un provider all'apertura del vault vede un indice che si sta
    /// popolando, e farlo aspettare la fine è il verso che gli fa vedere di
    /// più. Non è fame: una fetta è limitata, e fra due fette la coda si drena.
    fn avanza_apertura(&self) -> Result<bool, PluginError> {
        let Some(mut in_corso) = self.apertura.write()?.take() else {
            return Ok(false);
        };
        // La prima fotografia: fuori dalla fase 1, prima della prima fetta.
        // Gira sotto l'esclusivo, come in fase 1: la passata tiene il lock
        // interno dello store attraverso le proprie scritture, e le scritture
        // normali tengono il workspace attraverso le chiamate alla feature —
        // un host per-capacità chiuderebbe il ciclo. Un errore qui non deve
        // fermare il pool: la passata interrotta si riprende alla riapertura.
        #[cfg(feature = "versioning")]
        if let Some(foto) = in_corso.fotografia.take() {
            let mut ws = self.workspace.write()?;
            if let Err(e) = foto(&mut ws) {
                tracing::warn!(target: "fub.host", "la prima fotografia non è riuscita: {e}");
            }
        }
        // La bandiera è **quella di tutti**: annullare l'indicizzazione è
        // premere lo stesso pulsante che annulla un export, e passa dalla
        // stessa `Flags`. Senza questo, «annulla» avrebbe avuto due
        // implementazioni e una delle due sarebbe stata dimenticata.
        let flag = self.flag(in_corso.id)?;
        let smettere = flag.load(Ordering::Relaxed) || self.stopping.load(Ordering::Acquire);

        if !smettere && !in_corso.work.finita() {
            let label = in_corso.work.prossimo().map(|id| id.to_string());
            // **Il disco sotto prestito condiviso** (0119, secondo sito): la
            // fetta si legge e si parsa qui, dove chi guarda il vault appena
            // aperto — la ricerca, l'albero, l'autocompletamento — entra
            // accanto. Il piano si porta dietro l'impronta che l'anagrafe dava
            // a ogni documento adesso, e chi applica la confronta: fra le due
            // fasi il prestito esclusivo passa di mano, e su un'apertura che
            // dura secondi in mezzo ci sta un salvataggio dell'utente.
            let prepared = {
                let ws = self.workspace.read()?;
                ws.plan_batch(&mut in_corso.work)
            };
            {
                let mut ws = self.workspace.write()?;
                ws.index_batch_prepared(prepared);
                // Il `total` c'è perché la scansione lo sa: l'apertura è il
                // caso in cui una barra può dire il vero, e
                // [`JobProgress::total`] è opzionale proprio per distinguerlo
                // da quelli in cui mentirebbe.
                ws.note_job_progress(
                    in_corso.id,
                    JobProgress {
                        done: in_corso.work.fatti(),
                        total: Some(in_corso.totale),
                        label,
                    },
                );
            }
            *self.apertura.write()? = Some(in_corso);
            return Ok(true);
        }

        // Finita, o smessa: si chiude comunque — `finish_index` fa il grafo e
        // il flush di ciò che è stato alimentato, e **non riconcilia** se il
        // giro non è arrivato in fondo.
        let apertura = {
            let mut ws = self.workspace.write()?;
            ws.finish_index(in_corso.work)
        };
        // **La raccolta dello spazio per-documento, sotto prestito condiviso.**
        // Cammina il disco degli spazi dati e il cestino, e non tocca il
        // workspace: stava dentro `finish_index`, cioè dentro l'esclusivo, e in
        // fondo a un'apertura è l'ultima cosa che chi guarda il vault aspetta
        // senza motivo. Che il condiviso basti è la sua proprietà, non un
        // rilassamento: chi potrebbe far tornare una nota fra il giudizio e la
        // cancellazione vuole l'esclusivo, e da qui non lo ottiene.
        // L'esito non ferma l'apertura — è la stessa regola di `reindex` — ma
        // non si perde: ciò che non si è potuto raccogliere si registra.
        if let Err(e) = self.workspace.read()?.collect_doc_data() {
            tracing::warn!(target: "fub.host", "spazi per-documento non raccolti: {e}");
        }
        *in_corso.unread.write()? = apertura
            .scartati
            .iter()
            .map(|scarto| UnreadDoc {
                doc_id: scarto.id.to_string(),
                why: scarto.why.clone(),
            })
            .collect();

        // L'esito di un'indicizzazione annullata è un `Cancelled` come quello
        // di ogni altro job annullato: chi guarda il centro attività distingue
        // «finito» da «fermato» senza sapere che quel job era un'apertura.
        let outcome = if apertura.interrotta {
            Err(PluginError::Cancelled(
                "l'indicizzazione del vault è stata interrotta: la ricerca è parziale finché non si riapre"
                    .into(),
            ))
        } else {
            Ok(serde_json::json!({ "scartati": apertura.scartati.len() }))
        };
        self.forget(in_corso.id)?;
        self.workspace.write()?.complete_job(
            in_corso.id,
            fub_kernel::INDEX_JOB.to_string(),
            outcome,
        );
        // Ultimo, e dopo l'esito: chi si sveglia qui deve trovare il vault
        // nello stato in cui l'indicizzazione lo ha lasciato, non mentre ce lo
        // sta mettendo.
        let (fatto, campana) = &*in_corso.fine;
        *fatto.lock().expect("fine avvelenata") = true;
        campana.notify_all();
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
        let emessi = self.workspace.read()?.jobs_issued();
        self.flags.write()?.cancel(id, emessi);
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
    fn entra(&self, plugin: &str, id: JobId, flag: &Arc<AtomicBool>) -> Option<Dentro> {
        let (posto, _) = &*self.volo;
        let mut volo = posto.lock().expect(VELENO);
        if volo.fermi.contains(plugin) {
            return None;
        }
        volo.dentro
            .entry(plugin.to_string())
            .or_default()
            .insert(id, Arc::clone(flag));
        Some(Dentro {
            volo: Arc::clone(&self.volo),
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
    /// [0032](../../../docs/decisions/0032-il-runner-dei-job.md) dichiara —
    /// chi spegne aspetta chi lavora, come chi chiude.
    ///
    /// **Chi la chiama non deve tenere in mano né il workspace né il registry**:
    /// un job dentro `run_job` li chiede per finire, e aspettarlo tenendoli
    /// sarebbe aspettare sé stessi.
    fn ferma(&self, plugin: &str) -> Fermo {
        let (posto, campana) = &*self.volo;
        let mut volo = posto.lock().expect(VELENO);
        volo.fermi.insert(plugin.to_string());
        if let Some(dentro) = volo.dentro.get(plugin) {
            for flag in dentro.values() {
                flag.store(true, Ordering::Relaxed);
            }
        }
        while volo.dentro.contains_key(plugin) {
            volo = campana.wait(volo).expect(VELENO);
        }
        Fermo {
            volo: Arc::clone(&self.volo),
            plugin: plugin.to_string(),
        }
    }

    /// Esegue un job e ne riconsegna l'esito. **Sempre** un esito: un job che
    /// sparisce senza dire niente è un chiamante che aspetta per sempre, ed è la
    /// regola che la [0028](../../../docs/decisions/0028-come-un-componente-smette.md)
    /// ha già scritto per i job di chi si disattiva.
    fn run(&self, job: PendingJob) -> Result<(), PluginError> {
        let flag = self.flag(job.id)?;
        // **Ci si annuncia prima di prendere il corpo**, e il guard si dichiara
        // per primo perché cada per **ultimo**: fra queste due righe ci sta chi
        // spegne il componente, e se la copia del bundle si prendesse prima di
        // annunciarsi quell'attesa non la vedrebbe. Per la stessa ragione
        // `_dentro` deve sopravvivere all'`Arc` del plugin — un `Drop` in
        // ordine inverso sveglierebbe chi spegne con una copia ancora in giro,
        // che è il difetto scritto al contrario.
        let Some(_dentro) = self.entra(&job.plugin, job.id, &flag) else {
            self.refuse(job, "non parte: il suo componente si sta spegnendo")?;
            return Ok(());
        };
        // Il corpo lo tiene il registry, e lo si prende **senza tenere il suo
        // lock** per la durata del job: chi chiude deve poterci passare.
        let plugin = self.bundles.read()?.body(&job.plugin);

        let outcome = match plugin {
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
        };

        self.forget(job.id)?;
        self.workspace
            .write()?
            .complete_job(job.id, job.spec.job, outcome);
        Ok(())
    }

    /// Riconsegna un job **senza eseguirlo**: è stato chiesto, e chi lo ha
    /// chiesto aspetta un `JobDone`.
    fn refuse(&self, job: PendingJob, why: &str) -> Result<PluginError, PluginError> {
        let refusal = PluginError::Cancelled(format!("il job `{}` {why}", job.spec.job).into());
        self.forget(job.id)?;
        self.workspace
            .write()?
            .complete_job(job.id, job.spec.job, Err(refusal.clone()));
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
    fn fuso_macchina(&self) -> Result<String, PluginError> {
        Ok(self.workspace.read()?.locale().timezone)
    }

    /// Fra quanto suona la prima sveglia, riallineando prima i quadranti a ciò
    /// che è dichiarato adesso (§22.1).
    fn fra_quanto_suona(&self) -> Result<Option<Duration>, PluginError> {
        let dichiarate = self.workspace.read()?.declared_timers();
        if dichiarate.is_empty() {
            // Nessuna sveglia: si torna esattamente al pool di prima, che
            // dorme senza scadenza. Vale la pena che sia un ramo e non un
            // `Duration::MAX`, perché è la promessa che chi non dichiara timer
            // non paga nemmeno un risveglio.
            self.sveglie.write()?.quadranti.clear();
            return Ok(None);
        }
        let fuso = self.fuso_macchina()?;
        let ora = Instant::now();
        let mut sveglie = self.sveglie.write()?;
        sveglie.riconcilia(&dichiarate, ora, &fuso);
        Ok(sveglie.fra_quanto(ora))
    }

    /// Fa suonare ciò che è scaduto.
    ///
    /// Il quadrante si avanza tenendo il lock delle sveglie, l'evento si emette
    /// **dopo** averlo lasciato: emettere è un giro sincrono del kernel, e
    /// tenere due lock nello stesso ordine in due posti è il modo di scoprire un
    /// giorno che l'ordine era tre.
    fn suona(&self) -> Result<(), PluginError> {
        // Il fuso si prende **prima** del lock delle sveglie, e non dentro: è
        // una lettura del workspace, e l'ordine fra i due lock è già stabilito
        // da `fra_quanto_suona`. Invertirlo qui sarebbe la seconda metà di un
        // abbraccio mortale che nessuno vedrebbe finché non capita.
        let fuso = self.fuso_macchina()?;
        let scadute = {
            let mut sveglie = self.sveglie.write()?;
            sveglie.scadute(Instant::now(), &fuso)
        };
        for (owner, timer) in scadute {
            if self.stopping.load(Ordering::Acquire) {
                return Ok(());
            }
            self.workspace.write()?.fire_timer(&owner, &timer);
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
        if let Err(e) = self.giro() {
            tracing::error!(target: "fub.host", "il pool dei job si ferma: {e}");
            self.stopping.store(true, Ordering::Release);
            self.bell.ring();
        }
    }

    /// Il giro vero, fino a quando c'è da lavorare o fino al primo veleno.
    fn giro(&self) -> Result<(), PluginError> {
        while !self.stopping.load(Ordering::Acquire) {
            // L'apertura prima di tutto, e **prima del biglietto**: finché c'è
            // una fetta da fare questo thread non deve nemmeno considerare di
            // dormire.
            if self.avanza_apertura()? {
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
                match self.fra_quanto_suona()? {
                    Some(fra) => {
                        self.bell.wait_beyond_or(ticket, fra);
                        self.suona()?;
                    }
                    None => {
                        self.bell.wait_beyond(ticket);
                    }
                }
                continue;
            }
            self.claim(&jobs)?;
            for job in jobs {
                // Il controllo è **dentro** il ciclo e non solo in cima: un
                // drenaggio prende tutta la coda, e senza questa riga chiudere
                // vorrebbe dire eseguire fino in fondo tutto ciò che un thread
                // si è trovato in mano. Chi chiude aspetta chi ha *già*
                // cominciato, non chi non è ancora partito.
                if self.stopping.load(Ordering::Acquire) {
                    self.refuse(job, "non parte: il vault si sta chiudendo")?;
                    continue;
                }
                self.run(job)?;
            }
        }
        Ok(())
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
    /// `apertura` è ciò che [`Workspace::scan_vault`] ha consegnato, insieme
    /// all'identità di job che il kernel le ha dato e al posto dove
    /// depositare ciò che non si legge. Il pool parte *già con del lavoro in
    /// mano*, ed è la differenza fra un'apertura a fasi e un'apertura sincrona
    /// con un thread in più: nessuno accende niente dopo, e non c'è una
    /// finestra in cui l'indicizzazione esiste ma non la sta facendo nessuno.
    pub fn start(
        workspace: Custodia<Workspace>,
        bundles: Custodia<BundleRegistry>,
        threads: usize,
        apertura: Option<InCorso>,
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
            apertura: Custodia::new("l'apertura in corso", apertura),
            flags: Custodia::vuota("le bandiere dei job"),
            sveglie: Custodia::vuota("le sveglie del vault"),
            volo: Arc::new((Mutex::new(InVolo::default()), Condvar::new())),
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
    pub fn ferma_bundle(&self, id: &str) -> Fermo {
        self.shared.ferma(id)
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
        // `avanza_apertura`, quindi chiudere un vault a metà indicizzazione
        // lascerebbe un job vivo per sempre — e la regola che vale per i job
        // dei plugin («sempre un esito», 0028) non vale meno per questo.
        // `stopping` è già alto: la chiamata prende il ramo che chiude.
        // Ciò che va storto **chiudendo** si raccoglie e si dice: un vault
        // avvelenato è uno dei modi in cui l'apertura non arriva a un esito, ed
        // è la stessa lista in cui finiscono gli altri.
        errors.extend(self.shared.avanza_apertura().err());
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
            Err(e) => return vec![e],
        };
        pending
            .into_iter()
            .map(|job| {
                self.shared
                    .refuse(job, "non parte: il vault si sta chiudendo")
                    .unwrap_or_else(|e| e)
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
    fn bandiera(flags: &Flags, id: u64) -> Option<bool> {
        flags
            .live
            .get(&JobId(id))
            .map(|f| f.load(Ordering::Relaxed))
    }

    /// Annullare un job **preso in carico** lo raggiunge: è il caso normale.
    #[test]
    fn annullare_un_job_vivo_alza_la_sua_bandiera() {
        let mut flags = Flags::default();
        flags.claim(JobId(7));
        flags.cancel(JobId(7), 8);
        assert_eq!(bandiera(&flags, 7), Some(true));
    }

    /// Annullare un job che il pool **non ha ancora visto** deve valere: è la
    /// corsa che la 0032 ha deciso di non perdere. La bandiera nasce alzata, e
    /// il drenaggio la trova così invece di rimetterla a zero.
    #[test]
    fn annullare_un_job_ancora_in_coda_lo_aspetta() {
        let mut flags = Flags::default();
        flags.claim(JobId(3));
        // Il kernel ha già emesso fino al 9 compreso: quel job esiste, è in
        // coda, e il pool non l'ha ancora drenato.
        flags.cancel(JobId(9), 10);
        assert_eq!(bandiera(&flags, 9), Some(true));
        flags.claim(JobId(9));
        assert_eq!(bandiera(&flags, 9), Some(true));
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
    fn annullare_un_id_mai_emesso_non_lascia_niente() {
        let mut flags = Flags::default();
        flags.claim(JobId(1));
        // Il kernel ha emesso 0 e 1: il 42 non è mai stato un job.
        flags.cancel(JobId(42), 2);
        assert_eq!(bandiera(&flags, 42), None);
        assert_eq!(
            flags.live.len(),
            1,
            "un id mai emesso ha lasciato una bandiera che nessuno toglierà"
        );
        // E il confine è **esatto**, non prudenziale: l'ultimo emesso resta
        // annullabile prima che il pool lo veda.
        flags.cancel(JobId(1), 2);
        assert_eq!(bandiera(&flags, 1), Some(true));
    }

    /// Annullare un job **già concluso** non lascia niente dietro.
    ///
    /// È il pulsante premuto un istante troppo tardi, cioè il più comune dei
    /// tre casi: senza il segno ogni pressione lascerebbe una bandiera che
    /// nessuno toglie, e la mappa crescerebbe per tutta la vita del vault.
    #[test]
    fn annullare_un_job_finito_non_lascia_niente() {
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
    /// Sta qui, su [`Shared::avanza_apertura`] chiamata a mano, e non su un
    /// pool acceso, per la ragione in testa a questo modulo: con dei thread
    /// veri la differenza fra «la bandiera ha fermato l'indicizzazione» e «il
    /// disco è arrivato in fondo prima che la si alzasse» è un istante da
    /// indovinare, e un presidio che si indovina non presidia. Chiamata da qui,
    /// nessuna fetta è ancora partita: se la bandiera vale, ne parte zero.
    #[test]
    fn con_la_bandiera_alzata_nessuna_fetta_parte() {
        let (_dir, shared, id) = un_vault_da_indicizzare();
        shared.flags.write().unwrap().claim(id);
        shared.flags.write().unwrap().cancel(id, id.0 + 1);

        assert!(
            shared.avanza_apertura().unwrap(),
            "c'era un'apertura da portare avanti"
        );

        assert!(
            shared.workspace.read().unwrap().documents().is_empty(),
            "una fetta è partita lo stesso: la bandiera non l'ha fermata"
        );
        // E l'apertura è **chiusa**, non sospesa: chi smette riceve un esito
        // come chiunque altro (0028), e non resta niente da portare avanti.
        assert!(
            !shared.avanza_apertura().unwrap(),
            "l'apertura annullata è rimasta in mano a qualcuno"
        );
    }

    /// **Chi ferma il pool chiude anche l'apertura che nessun thread ha
    /// finito** (§15.7).
    ///
    /// Il caso è quello di un worker che vede `stopping` in cima al proprio
    /// ciclo ed esce **senza passare da `avanza_apertura`**: da fuori quel
    /// momento non si provoca — dipende da dove il thread si trovava — e qui lo
    /// si mette in scena esattamente, con un pool che non ha thread. Senza la
    /// riga in fondo a [`JobRunner::stop`] l'apertura resterebbe in mano a
    /// nessuno, cioè un job vivo per sempre e un `wait_indexed` che non torna.
    #[test]
    fn fermare_il_pool_da_un_esito_all_apertura_rimasta() {
        let (_dir, shared, _id) = un_vault_da_indicizzare();
        let fine = {
            let apertura = shared.apertura.read().unwrap();
            Arc::clone(&apertura.as_ref().expect("un'apertura in corso").fine)
        };
        let mut runner = JobRunner {
            shared: Arc::clone(&shared),
            workers: Vec::new(),
        };

        runner.stop();

        assert!(
            shared.apertura.read().unwrap().is_none(),
            "l'apertura è rimasta appesa a pool fermo"
        );
        assert!(
            *fine.0.lock().unwrap(),
            "chi aspettava l'indicizzazione non è stato svegliato"
        );
    }

    /// Il cancello che rende **osservabile** un parse lento senza dormire.
    ///
    /// `dentro` dice al test che il parse è cominciato, `via` gli lascia
    /// decidere quando finisce. Finché non è armato il formato parsa come
    /// qualunque altro.
    #[derive(Default)]
    struct Cancello {
        dentro: Mutex<Option<std::sync::mpsc::Sender<()>>>,
        via: Mutex<Option<std::sync::mpsc::Receiver<()>>>,
    }

    impl Cancello {
        fn arma(&self) -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>) {
            let (dentro_tx, dentro_rx) = std::sync::mpsc::channel();
            let (via_tx, via_rx) = std::sync::mpsc::channel();
            *self.dentro.lock().unwrap() = Some(dentro_tx);
            *self.via.lock().unwrap() = Some(via_rx);
            (dentro_rx, via_tx)
        }

        fn attraversa(&self) {
            let dentro = self.dentro.lock().unwrap().take();
            let via = self.via.lock().unwrap().take();
            if let (Some(dentro), Some(via)) = (dentro, via) {
                dentro.send(()).expect("il test aspetta il parse");
                via.recv().expect("il test lascia uscire il parse");
            }
        }
    }

    /// Un formato di testo nudo che, a cancello armato, si ferma dentro `parse`.
    struct Lento(Arc<Cancello>);

    impl fub_abi::FormatProvider for Lento {
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
            self.0.attraversa();
            let mut model = fub_abi::model::DocumentModel::empty(fub_abi::model::DocId::new(
                ctx.doc_id.clone(),
            ));
            model.text = source.text().unwrap_or_default().to_string();
            Ok(model)
        }
        fn render_html(
            &self,
            m: &fub_abi::model::DocumentModel,
            _o: &fub_abi::format::RenderOptions,
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
    fn chi_legge_entra_mentre_la_fetta_dell_apertura_legge_il_disco() {
        let cancello: Arc<Cancello> = Arc::default();
        let mut formats = fub_kernel::FormatRegistry::new();
        formats
            .register(Box::new(Lento(cancello.clone())))
            .expect("un provider solo non va in conflitto");
        // Una nota sola: una fetta sola, quindi il cancello si attraversa una
        // volta e il test non deve indovinare quante.
        let (_dir, shared, _id, _root) = un_vault_scansionato(1, formats);

        let (dentro, via) = cancello.arma();
        let fetta = {
            let shared = Arc::clone(&shared);
            std::thread::spawn(move || shared.avanza_apertura())
        };

        // Il parse è cominciato: da qui in poi la fetta sta facendo I/O.
        dentro.recv().expect("la fetta entra nel parse");
        let letto = shared.workspace.try_read();
        assert!(
            letto.is_some(),
            "il workspace non si presta mentre la fetta dell'apertura legge il \
             disco: la fase che legge e parsa tiene il prestito esclusivo, e chi \
             guarda il vault appena aperto — la ricerca, l'albero — aspetta \
             un'I/O che non lo riguarda (0024, 0119)"
        );
        // E non è un prestito vuoto: da lì si interroga davvero.
        assert!(letto
            .expect("il prestito condiviso c'è")
            .query_index(fub_abi::traits::IndexQuery::VaultStatus)
            .is_ok());
        via.send(()).expect("la fetta può finire");
        assert!(
            fetta
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

    /// Un vault seminato, scansionato e con la sua identità di job: il punto in
    /// cui `Host::open` consegna la seconda fase al pool.
    fn un_vault_da_indicizzare() -> (tempfile::TempDir, Arc<Shared>, JobId) {
        let mut formats = fub_kernel::FormatRegistry::new();
        formats
            .register(fub_format_markdown::MarkdownProvider::boxed())
            .expect("un provider solo non va in conflitto");
        let (dir, shared, id, _) = un_vault_scansionato(3, formats);
        (dir, shared, id)
    }

    /// Lo stesso, con il registro dei formati in mano al chiamante: è la leva
    /// con cui il presidio del prestito mette un parse **lento** sul percorso
    /// dell'apertura.
    fn un_vault_scansionato(
        quante: usize,
        formats: fub_kernel::FormatRegistry,
    ) -> (tempfile::TempDir, Arc<Shared>, JobId, camino::Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root =
            camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("una radice utf8");
        for n in 0..quante {
            std::fs::write(root.join(format!("Nota{n}.md")), "# Titolo\n\nCorpo.\n")
                .expect("semina");
        }

        let mut ws = Workspace::new(&root, formats).expect("la radice appena creata si apre");
        let work = ws.scan_vault().expect("la scansione riesce");
        assert_eq!(work.totale(), quante as u64, "le note seminate si leggono");
        let id = ws.begin_index_job();

        let shared = Shared {
            workspace: Custodia::new("il vault di prova", ws),
            bundles: Custodia::new("i componenti di prova", BundleRegistry::new()),
            bell: Arc::new(JobBell::default()),
            stopping: AtomicBool::new(false),
            apertura: Custodia::new(
                "l'apertura di prova",
                Some(InCorso {
                    id,
                    totale: work.totale(),
                    work,
                    unread: Custodia::vuota("gli scarti di prova"),
                    fine: Arc::new((Mutex::new(false), Condvar::new())),
                    #[cfg(feature = "versioning")]
                    fotografia: None,
                }),
            ),
            flags: Custodia::vuota("le bandiere di prova"),
            sveglie: Custodia::vuota("le sveglie di prova"),
            volo: Arc::new((Mutex::new(InVolo::default()), Condvar::new())),
        };
        (dir, Arc::new(shared), id, root)
    }

    #[test]
    fn un_job_in_attesa_del_proprio_turno_si_annulla() {
        let mut flags = Flags::default();
        flags.claim(JobId(4)); // il lotto di un thread
        flags.claim(JobId(5));
        flags.claim(JobId(6)); // il lotto di un altro, già più avanti
        flags.claim(JobId(7));
        flags.live.remove(&JobId(4)); // il 4 è finito
        flags.cancel(JobId(5), 8); // il 5 aspetta ancora il proprio turno
        assert_eq!(bandiera(&flags, 5), Some(true));
        assert_eq!(bandiera(&flags, 4), None);
    }
    // -----------------------------------------------------------------------
    // Le due sorgenti di tempo dentro lo stesso quadrante (§22.4, 0091).
    // -----------------------------------------------------------------------

    fn dichiara(id: &str, schedule: TimerSchedule) -> (String, fub_abi::traits::TimerSpec) {
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
    fn le_due_famiglie_convivono_nello_stesso_quadrante() {
        let mut sveglie = Sveglie::default();
        let ora = Instant::now();
        sveglie.riconcilia(
            &[
                dichiara("battito", TimerSchedule::Every { seconds: 3600 }),
                dichiara(
                    "digest",
                    // Mezzanotte e un minuto: sempre nel futuro, salvo il minuto
                    // in cui questo test giri esattamente lì.
                    TimerSchedule::AtWallClock(WallClock::daily(0, 1).anchored("Europe/Rome")),
                ),
            ],
            ora,
            "",
        );
        assert_eq!(sveglie.quadranti.len(), 2);

        let parete = &sveglie.quadranti[&("test.sveglia".into(), "digest".into())];
        assert!(
            parete.prossima.is_some(),
            "una sveglia di parete ha una prossima: gliela dà il calendario"
        );
        assert!(
            parete.dove.attesa.is_some(),
            "e sa quale occorrenza sta aspettando, che è ciò che le fa \
             distinguere una suonata puntuale da un recupero"
        );
        assert_eq!(parete.dove.attesa.map(|a| (a.hour, a.minute)), Some((0, 1)));

        // Il trascorso non ha imparato niente dal calendario: la sua prossima è
        // ancora un'ora dall'ancora, come è sempre stata.
        let trascorso = &sveglie.quadranti[&("test.sveglia".into(), "battito".into())];
        assert_eq!(trascorso.dove, Posizione::default());
        assert_eq!(
            trascorso.prossima,
            Some(trascorso.ancora + Duration::from_secs(3600))
        );
    }

    /// **Un fuso che il database non conosce non fa suonare la sveglia.**
    ///
    /// E la voce resta in mappa a non suonare, invece di sparire: sparire
    /// vorrebbe dire farla riseminare dalla riconciliazione al giro dopo, e il
    /// pool si sveglierebbe a vuoto per sempre.
    #[test]
    fn un_fuso_irrisolvibile_non_ripiega_e_non_suona() {
        let mut sveglie = Sveglie::default();
        let ora = Instant::now();
        sveglie.riconcilia(
            &[dichiara(
                "digest",
                TimerSchedule::AtWallClock(WallClock::daily(9, 0).anchored("Europa/Roma")),
            )],
            ora,
            "",
        );
        let q = &sveglie.quadranti[&("test.sveglia".into(), "digest".into())];
        assert_eq!(q.prossima, None, "non suona");
        assert_eq!(
            sveglie.fra_quanto(ora),
            None,
            "e chi aspetta non si sveglia per lei"
        );
        assert!(sveglie.scadute(ora, "").is_empty());
        assert_eq!(sveglie.quadranti.len(), 1, "ma resta dichiarata");
    }

    /// Una sveglia di parete che sparisce dal manifest sparisce dai quadranti,
    /// come ogni altra: la sorgente resta il manifest a ogni giro.
    #[test]
    fn anche_una_sveglia_di_parete_muore_col_manifest() {
        let mut sveglie = Sveglie::default();
        let ora = Instant::now();
        let dichiarata = [dichiara(
            "digest",
            TimerSchedule::AtWallClock(WallClock::daily(9, 0)),
        )];
        sveglie.riconcilia(&dichiarata, ora, "");
        assert_eq!(sveglie.quadranti.len(), 1);
        sveglie.riconcilia(&[], ora, "");
        assert!(sveglie.quadranti.is_empty());
    }
}
