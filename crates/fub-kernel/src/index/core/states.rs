//! Lo stato del watcher e dei job che l'indice tiene per il workspace.

use super::*;

/// Il fatto che il §9.7 rende interrogabile: se qualcuno vede le scritture
/// altrui, e cosa è già andato storto nel leggerle.
#[derive(Default)]
pub(crate) struct WatchState {
    /// **Condiviso** con chi tiene vivo il rilevatore (`fub-host`): il kernel
    /// non sa cosa sia un watcher, e questo è tutto ciò che gliene serve sapere.
    ///
    /// Un `Arc<AtomicBool>` e non un `bool`, perché la risposta deve poter
    /// diventare `false` **mentre il vault è aperto**. Prima
    /// `VaultWatcher::is_watching` rispondeva *per costruzione* — distingueva
    /// «non ho avviato un debouncer» da «ne ho avviato uno», e un debouncer
    /// morto continuava a rispondere `true`.
    pub(crate) watching: Arc<AtomicBool>,
    failures: u32,
    last_error: Option<String>,
    /// **A che punto è l'indicizzazione dell'apertura** (§15.7).
    ///
    /// Il *lavoro* dell'indicizzazione sta fuori dal kernel — è
    /// l'[`Indicizzazione`](crate::Indicizzazione), che chi ha i thread si passa
    /// di fetta in fetta — e qui sta solo ciò che se ne **osserva**. È la stessa
    /// divisione della bandiera del rilevamento
    /// ([0030](../../../../docs/decisions/0183-composizione-host-kernel.md))
    /// e del campanello dei job
    /// ([0032](../../../../docs/decisions/0183-composizione-host-kernel.md)): il kernel
    /// non fa il mestiere, ma è l'unico posto da cui la domanda si può fare.
    pub(crate) indexing: IndexingState,
}

impl WatchState {
    /// Registra l'esito di una sincronizzazione per-path.
    ///
    /// Sta **dentro** il kernel, ed è il punto: i due chiamanti veri scrivevano
    /// `let _ = ws.sync_path(…)`, quindi il `Result` c'era e non lo leggeva
    /// nessuno. Registrandolo qui, un chiamante distratto non può più nasconderlo
    /// — al più non lo guarda lui, ma il vault se lo ricorda.
    pub(super) fn notes(&mut self, error: impl std::fmt::Display) {
        self.failures = self.failures.saturating_add(1);
        self.last_error = Some(error.to_string());
    }

    pub(super) fn status(&self) -> VaultStatus {
        VaultStatus {
            watching: self.watching.load(Ordering::Relaxed),
            sync_failures: self.failures,
            last_sync_error: self.last_error.clone(),
            indexing: self.indexing,
        }
    }
}

/// **I lavori lunghi vivi** (§10.3, decisione 0035): da quando il kernel
/// accetta un job a quando ne riconsegna l'esito.
///
/// È una tabella e non un conto, ed è ciò che permette al centro attività di
/// **riconciliare**: gli eventi del ciclo di un job sono recuperabili
/// ([`Event::is_recoverable`](fub_abi::Event::is_recoverable)) proprio perché
/// c'è questa, e senza di essa il canale più fitto del contratto sarebbe l'unico
/// che non si può frenare.
///
/// `BTreeMap` per l'ordine, e la chiave è il **numero** dentro il [`JobId`] e
/// non l'id: un `JobId` è opaco per contratto — chi lo ordina sta assumendo
/// qualcosa che l'host non gli deve — e l'unico che quell'assunzione la può
/// fare è chi i numeri li assegna, cioè questo kernel. Ne esce l'elenco
/// nell'ordine in cui il lavoro è stato chiesto, che è l'unico che chi guarda
/// riconosce.
#[derive(Default)]
pub(crate) struct JobsState {
    live: BTreeMap<u64, JobStatus>,
}

impl JobsState {
    /// Un job è stato accettato: da qui è vivo, e da qui si vede.
    ///
    /// Il `since` lo prende chi accetta e non chi chiede: è il momento in cui il
    /// kernel se ne è fatto carico, e un job che aspetta un thread libero è già
    /// in attesa da allora.
    pub(crate) fn accepted(&mut self, id: JobId, job: &str, plugin: &str, since: u64) {
        self.live.insert(
            id.0,
            JobStatus {
                id,
                job: job.to_string(),
                plugin: plugin.to_string(),
                since,
                progress: None,
            },
        );
    }

    /// Registra un progresso, e dice se il job era **vivo**.
    ///
    /// Il `false` non è pignoleria: un progresso che arriva per un job già
    /// concluso — l'host che lo timbra gira su un altro thread, e fra il suo
    /// ultimo passo e l'esito ci sta di tutto — non deve far ricomparire una
    /// riga nel centro attività. Chi lo riceve non lo emette nemmeno.
    pub(crate) fn progressed(&mut self, id: JobId, progress: JobProgress) -> bool {
        match self.live.get_mut(&id.0) {
            Some(status) => {
                status.progress = Some(progress);
                true
            }
            None => false,
        }
    }

    /// Di chi è questo job, se è ancora vivo. Serve a intestargli il proprio
    /// progresso: l'origine di un `job-progress` è il plugin che sta lavorando,
    /// e chi timbra l'evento ha in mano l'id, non il nome.
    pub(crate) fn owner(&self, id: JobId) -> String {
        self.live
            .get(&id.0)
            .map(|status| status.plugin.clone())
            .unwrap_or_default()
    }

    /// L'esito è tornato: il job smette di essere vivo.
    pub(crate) fn finished(&mut self, id: JobId) {
        self.live.remove(&id.0);
    }

    pub(crate) fn live(&self) -> Vec<JobStatus> {
        self.live.values().cloned().collect()
    }
}
