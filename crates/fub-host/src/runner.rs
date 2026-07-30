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

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;

use fub_abi::traits::JobId;
use fub_abi::PluginError;
use fub_kernel::{JobBell, PendingJob, Workspace};

use crate::jobs::JobHost;
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
    fn cancel(&mut self, id: JobId) {
        if let Some(flag) = self.live.get(&id) {
            flag.store(true, Ordering::Relaxed);
            return;
        }
        let da_venire = match self.seen {
            Some(seen) => id.0 > seen,
            None => true,
        };
        if da_venire {
            self.live.insert(id, Arc::new(AtomicBool::new(true)));
        }
    }

    fn cancel_all(&self) {
        for flag in self.live.values() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// Ciò che i thread condividono: il vault, chi possiede i bundle, il campanello,
/// e le bandiere di chi è stato annullato.
struct Shared {
    workspace: Arc<RwLock<Workspace>>,
    bundles: Arc<Mutex<BundleRegistry>>,
    bell: Arc<JobBell>,
    /// Il pool sta chiudendo: nessun job nuovo parte.
    stopping: AtomicBool,
    flags: Mutex<Flags>,
}

impl Shared {
    /// Prende in carico un lotto appena drenato ([`Flags::claim`]).
    fn claim(&self, jobs: &[PendingJob]) {
        let mut flags = self.flags.lock().expect("bandiere avvelenate");
        for job in jobs {
            flags.claim(job.id);
        }
    }

    /// La bandiera di un job, creandola se non c'è.
    fn flag(&self, id: JobId) -> Arc<AtomicBool> {
        let mut flags = self.flags.lock().expect("bandiere avvelenate");
        flags.claim(id);
        Arc::clone(&flags.live[&id])
    }

    fn cancel(&self, id: JobId) {
        self.flags.lock().expect("bandiere avvelenate").cancel(id);
    }

    fn forget(&self, id: JobId) {
        self.flags
            .lock()
            .expect("bandiere avvelenate")
            .live
            .remove(&id);
    }

    fn cancel_all(&self) {
        self.flags.lock().expect("bandiere avvelenate").cancel_all();
    }

    /// Esegue un job e ne riconsegna l'esito. **Sempre** un esito: un job che
    /// sparisce senza dire niente è un chiamante che aspetta per sempre, ed è la
    /// regola che la [0028](../../../docs/decisions/0028-come-un-componente-smette.md)
    /// ha già scritto per i job di chi si disattiva.
    fn run(&self, job: PendingJob) {
        let flag = self.flag(job.id);
        // Il corpo lo tiene il registry, e lo si prende **senza tenere il suo
        // lock** per la durata del job: chi chiude deve poterci passare.
        let plugin = self
            .bundles
            .lock()
            .expect("registry avvelenato")
            .body(&job.plugin);

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
                    &format!("eseguendo il job `{}`", job.spec.job),
                    || plugin.run_job(&job.spec.job, job.spec.payload.clone(), &mut host),
                )
            }
        };

        self.forget(job.id);
        self.workspace
            .write()
            .expect("workspace avvelenato")
            .complete_job(job.id, job.spec.job, outcome);
    }

    /// Riconsegna un job **senza eseguirlo**: è stato chiesto, e chi lo ha
    /// chiesto aspetta un `JobDone`.
    fn refuse(&self, job: PendingJob, why: &str) -> PluginError {
        let refusal = PluginError::Cancelled(format!("il job `{}` {why}", job.spec.job).into());
        self.forget(job.id);
        self.workspace
            .write()
            .expect("workspace avvelenato")
            .complete_job(job.id, job.spec.job, Err(refusal.clone()));
        refusal
    }

    /// Il mestiere di un thread del pool.
    fn work(&self) {
        while !self.stopping.load(Ordering::Acquire) {
            // Il biglietto si prende **prima** di drenare: un job accodato fra
            // il drenaggio e l'attesa cambia il conto, e l'attesa torna subito
            // invece di dormire su lavoro che c'è.
            let ticket = self.bell.ticket();
            let jobs = self
                .workspace
                .write()
                .expect("workspace avvelenato")
                .take_pending_jobs();
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
                    return;
                }
                self.bell.wait_beyond(ticket);
                continue;
            }
            self.claim(&jobs);
            for job in jobs {
                // Il controllo è **dentro** il ciclo e non solo in cima: un
                // drenaggio prende tutta la coda, e senza questa riga chiudere
                // vorrebbe dire eseguire fino in fondo tutto ciò che un thread
                // si è trovato in mano. Chi chiude aspetta chi ha *già*
                // cominciato, non chi non è ancora partito.
                if self.stopping.load(Ordering::Acquire) {
                    self.refuse(job, "non parte: il vault si sta chiudendo");
                    continue;
                }
                self.run(job);
            }
        }
    }
}

/// Il pool che esegue i job di un vault.
pub struct JobRunner {
    shared: Arc<Shared>,
    workers: Vec<JoinHandle<()>>,
}

impl JobRunner {
    /// Avvia il pool su un vault aperto.
    pub fn start(
        workspace: Arc<RwLock<Workspace>>,
        bundles: Arc<Mutex<BundleRegistry>>,
        threads: usize,
    ) -> Self {
        let bell = workspace.read().expect("workspace avvelenato").job_bell();
        let shared = Arc::new(Shared {
            workspace,
            bundles,
            bell,
            stopping: AtomicBool::new(false),
            flags: Mutex::new(Flags::default()),
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
        JobRunner { shared, workers }
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
    pub fn cancel(&self, id: JobId) {
        self.shared.cancel(id);
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
        self.shared.cancel_all();
        // Sveglia chi aspetta il campanello: si sveglia, vede `stopping`, esce.
        self.shared.bell.ring();
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
        self.refuse_pending()
    }

    /// Ha ancora dei thread vivi?
    pub fn is_running(&self) -> bool {
        !self.workers.is_empty()
    }

    /// I job rimasti in coda quando il pool si ferma ricevono un esito: sono
    /// stati chiesti, e chi li ha chiesti aspetta un `JobDone`.
    fn refuse_pending(&self) -> Vec<PluginError> {
        let pending = self
            .shared
            .workspace
            .write()
            .expect("workspace avvelenato")
            .take_pending_jobs();
        pending
            .into_iter()
            .map(|job| {
                self.shared
                    .refuse(job, "non parte: il vault si sta chiudendo")
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

/// Le tre risposte di [`Flags::cancel`], provate **su [`Flags`]** e non su un
/// pool acceso.
///
/// Farle girare per davvero — un vault, dei bundle, dei thread — vorrebbe dire
/// che un rosso non dice più quale dei quattro ha sbagliato, e che la terza
/// (quella che non deve lasciare niente) si può osservare solo indovinando un
/// istante. Qui sono tre asserzioni su una mappa.
#[cfg(test)]
mod tests {
    use super::*;

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
        flags.cancel(JobId(7));
        assert_eq!(bandiera(&flags, 7), Some(true));
    }

    /// Annullare un job che il pool **non ha ancora visto** deve valere: è la
    /// corsa che la 0032 ha deciso di non perdere. La bandiera nasce alzata, e
    /// il drenaggio la trova così invece di rimetterla a zero.
    #[test]
    fn annullare_un_job_ancora_in_coda_lo_aspetta() {
        let mut flags = Flags::default();
        flags.claim(JobId(3));
        flags.cancel(JobId(9));
        assert_eq!(bandiera(&flags, 9), Some(true));
        flags.claim(JobId(9));
        assert_eq!(bandiera(&flags, 9), Some(true));
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
            flags.cancel(JobId(id));
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
    #[test]
    fn un_job_in_attesa_del_proprio_turno_si_annulla() {
        let mut flags = Flags::default();
        flags.claim(JobId(4)); // il lotto di un thread
        flags.claim(JobId(5));
        flags.claim(JobId(6)); // il lotto di un altro, già più avanti
        flags.claim(JobId(7));
        flags.live.remove(&JobId(4)); // il 4 è finito
        flags.cancel(JobId(5)); // il 5 aspetta ancora il proprio turno
        assert_eq!(bandiera(&flags, 5), Some(true));
        assert_eq!(bandiera(&flags, 4), None);
    }
}
