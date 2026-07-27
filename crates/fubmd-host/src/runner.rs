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
//! ([`JobBell`](fubmd_kernel::JobBell)), drena la coda, e per ogni job costruisce
//! un [`JobHost`] e chiama [`Plugin::run_job`]. Nessuno tiene niente in mano
//! mentre il job gira: il prestito del workspace se lo prende il `JobHost`, una
//! chiamata alla volta ([decisione 0027](../../../docs/decisions/0027-il-lavoro-lungo-vede-il-vault.md)).
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
//!   quella del kernel ([`fubmd_kernel::safety`]), qui applicata a `run_job`.
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

use fubmd_abi::traits::JobId;
use fubmd_abi::PluginError;
use fubmd_kernel::{JobBell, PendingJob, Workspace};

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

/// Ciò che i thread condividono: il vault, chi possiede i bundle, il campanello,
/// e le bandiere di chi è stato annullato.
struct Shared {
    workspace: Arc<RwLock<Workspace>>,
    bundles: Arc<Mutex<BundleRegistry>>,
    bell: Arc<JobBell>,
    /// Il pool sta chiudendo: nessun job nuovo parte.
    stopping: AtomicBool,
    /// Una bandiera per job, creata da chi lo annulla o da chi lo avvia — chi
    /// arriva prima. Annullare un job che non è ancora partito deve valere
    /// quanto annullarne uno in volo, o «annulla» sarebbe una corsa.
    flags: Mutex<HashMap<JobId, Arc<AtomicBool>>>,
}

impl Shared {
    /// La bandiera di un job, creandola se non c'è.
    fn flag(&self, id: JobId) -> Arc<AtomicBool> {
        Arc::clone(
            self.flags
                .lock()
                .expect("bandiere avvelenate")
                .entry(id)
                .or_insert_with(|| Arc::new(AtomicBool::new(false))),
        )
    }

    fn forget(&self, id: JobId) {
        self.flags.lock().expect("bandiere avvelenate").remove(&id);
    }

    fn cancel_all(&self) {
        for flag in self.flags.lock().expect("bandiere avvelenate").values() {
            flag.store(true, Ordering::Relaxed);
        }
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
            None => Err(PluginError::Internal(format!(
                "`{}` non è un bundle montato: il job `{}` non ha un corpo",
                job.plugin, job.spec.job
            ))),
            Some(_) if flag.load(Ordering::Relaxed) => Err(PluginError::Cancelled(format!(
                "il job `{}` è stato annullato prima di partire",
                job.spec.job
            ))),
            Some(plugin) => {
                let mut host = JobHost::new(self.workspace.clone(), &job.plugin)
                    .cancelled_by(Arc::clone(&flag));
                // Un job che pania costa il job. La rete è la stessa del
                // kernel, applicata all'ultima porta che ne era rimasta fuori —
                // e qui non ci sarebbe nemmeno un chiamante a cui il panico
                // possa arrivare: si porterebbe via un thread del pool, e con
                // lui ogni job successivo.
                fubmd_kernel::safety::calling(
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
        let refusal = PluginError::Cancelled(format!("il job `{}` {why}", job.spec.job));
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
                self.bell.wait_beyond(ticket);
                continue;
            }
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
            flags: Mutex::new(HashMap::new()),
        });
        let workers = (0..threads.max(1))
            .map(|n| {
                let shared = Arc::clone(&shared);
                std::thread::Builder::new()
                    .name(format!("fubmd-job-{n}"))
                    .spawn(move || shared.work())
                    .expect("thread del pool")
            })
            .collect();
        JobRunner { shared, workers }
    }

    /// **Annulla** un job: alzare la sua bandiera è tutto ciò che vuol dire.
    ///
    /// Vale anche per un job che non è ancora partito — la bandiera nasce qui e
    /// il worker la trova già alzata — e per uno che non è mai esistito, che è
    /// una bandiera che nessuno guarderà. L'alternativa (rispondere «non lo
    /// conosco») vorrebbe dire che annullare un job un istante prima che parta è
    /// una corsa che si perde.
    pub fn cancel(&self, id: JobId) {
        self.shared.flag(id).store(true, Ordering::Relaxed);
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
