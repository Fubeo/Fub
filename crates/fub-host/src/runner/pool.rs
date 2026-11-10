//! Il pool dei worker: il via dei thread, `JobRunner` e `JobInvoker`.

use super::*;

/// Il via dei worker è una decisione del pool, non del singolo thread.
///
/// Finché tutti i thread richiesti non esistono nessuno può entrare nel
/// workspace: se una `spawn` fallisce, chi è già nato riceve invece
/// l'annullamento e termina senza toccare il lavoro dell'apertura.
#[derive(Clone, Copy, Eq, PartialEq)]
enum WorkerStart {
    Waiting,
    Running,
    Cancelled,
}

struct WorkerStartGate {
    state: Mutex<WorkerStart>,
    changed: Condvar,
}

impl WorkerStartGate {
    fn new() -> Self {
        Self {
            state: Mutex::new(WorkerStart::Waiting),
            changed: Condvar::new(),
        }
    }

    /// Torna `true` soltanto quando il pool è nato per intero.
    fn wait(&self) -> bool {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while *state == WorkerStart::Waiting {
            state = self
                .changed
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        *state == WorkerStart::Running
    }

    fn release(&self, state: WorkerStart) {
        *self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = state;
        self.changed.notify_all();
    }
}

/// Il pool che esegue i job di un vault.
pub struct JobRunner {
    pub(super) shared: Arc<Shared>,
    pub(super) workers: Vec<JoinHandle<()>>,
}

/// Handle clonabile per l'invocazione sincrona.
///
/// Non possiede i thread del pool: serve all'host per staccare l'`Arc` del
/// runner dal registro delle sessioni e rilasciare quel lock prima di eseguire
/// codice del bundle.
#[derive(Clone)]
pub(crate) struct JobInvoker {
    shared: Arc<Shared>,
}

impl JobInvoker {
    pub(crate) fn invoke_job(
        &self,
        plugin: &str,
        job: impl Into<String>,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        if self.shared.bundles.read()?.body(plugin).is_none() {
            return Err(PluginError::NotFound(
                format!("plugin not mounted: {plugin}").into(),
            ));
        }
        let pending = {
            let mut workspace = self.shared.workspace.write()?;
            workspace.issue_direct_job(
                plugin,
                JobSpec {
                    job: job.into(),
                    payload,
                },
            )?
        };
        self.shared.run_direct(pending)
    }
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
        let (bell, bus) = {
            let workspace = workspace.read()?;
            (workspace.job_bell(), workspace.bus().clone())
        };
        let shared = Arc::new(Shared {
            workspace,
            bundles,
            bell,
            bus,
            #[cfg(test)]
            stop_race_probe: None,

            stopping: AtomicBool::new(false),
            opening: Custody::new("l'apertura in corso", opening),
            flags: Custody::empty("le bandiere dei job"),
            alarms: Custody::empty("le sveglie del vault"),
            in_flight: Arc::new((Mutex::new(InFlight::default()), Condvar::new())),
        });
        Self::start_workers_with(shared, threads, |builder, worker| builder.spawn(worker))
    }
    /// Avvia il pool con il presidio deterministico della corsa di chiusura.
    ///
    /// Il gancio vive solo nei test: il percorso di produzione continua a
    /// costruire esattamente lo stesso `Shared`, senza stato aggiuntivo.
    #[cfg(test)]
    pub(crate) fn start_with_stop_probe(
        workspace: Custody<Workspace>,
        bundles: Custody<BundleRegistry>,
        threads: usize,
        opening: Option<InProgress>,
        probe: Arc<StopRaceProbe>,
    ) -> Result<Self, PluginError> {
        let (bell, bus) = {
            let workspace = workspace.read()?;
            (workspace.job_bell(), workspace.bus().clone())
        };
        let shared = Arc::new(Shared {
            workspace,
            bundles,
            bell,
            stop_race_probe: Some(probe),

            stopping: AtomicBool::new(false),
            opening: Custody::new("l'apertura in corso", opening),
            bus,
            flags: Custody::empty("le bandiere dei job"),
            alarms: Custody::empty("le sveglie del vault"),
            in_flight: Arc::new((Mutex::new(InFlight::default()), Condvar::new())),
        });
        Self::start_workers_with(shared, threads, |builder, worker| builder.spawn(worker))
    }

    /// Il solo giunto privato della creazione dei thread.
    ///
    /// La funzione iniettata permette al presidio di far fallire una `spawn`
    /// precisa; in produzione resta esattamente `Builder::spawn`.
    pub(super) fn start_workers_with<S>(
        shared: Arc<Shared>,
        threads: usize,
        mut spawn: S,
    ) -> Result<Self, PluginError>
    where
        S: FnMut(
            std::thread::Builder,
            Box<dyn FnOnce() + Send + 'static>,
        ) -> std::io::Result<JoinHandle<()>>,
    {
        let gate = Arc::new(WorkerStartGate::new());
        let mut workers = Vec::with_capacity(threads.max(1));
        for n in 0..threads.max(1) {
            let worker_shared = Arc::clone(&shared);
            let worker_gate = Arc::clone(&gate);
            let worker = Box::new(move || {
                if worker_gate.wait() {
                    worker_shared.work();
                }
            });
            match spawn(
                std::thread::Builder::new().name(format!("fub-job-{n}")),
                worker,
            ) {
                Ok(worker) => workers.push(worker),
                Err(error) => {
                    let root = PluginError::Io(
                        format!("impossibile avviare il thread del pool: {error}").into(),
                    );
                    // Non è `stop`: nessun worker ha ancora ricevuto il via,
                    // dunque non c'è lavoro da annullare né un'apertura da
                    // avanzare. Il chiamante conserva la propria transazione
                    // e ne percorre il rollback dopo che tutti i nati sono
                    // stati raccolti.
                    gate.release(WorkerStart::Cancelled);
                    for worker in workers {
                        let _ = worker.join();
                    }
                    return Err(root);
                }
            }
        }
        gate.release(WorkerStart::Running);
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
    /// Restituisce il solo handle owned necessario a invocare un job.
    pub(crate) fn invoker(&self) -> JobInvoker {
        JobInvoker {
            shared: Arc::clone(&self.shared),
        }
    }

    /// Esegue direttamente un job richiesto dall'host, senza creare una
    /// seconda contabilità: l'id viene riservato dal workspace e il corpo passa
    /// dalla stessa `Shared::outcome` usata dai worker.
    pub fn invoke_job(
        &self,
        plugin: &str,
        job: impl Into<String>,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.invoker().invoke_job(plugin, job, payload)
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
        #[cfg(test)]
        if let Some(probe) = &self.shared.stop_race_probe {
            probe.stop_requested();
        }
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
