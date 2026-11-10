//! Ciò che i thread del pool condividono (`Shared`), l'apertura a fasi e il
//! giro di un worker: presa, esecuzione, rifiuto e sveglie.

use super::*;

/// Ciò che i thread condividono: il vault, i bundle, il campanello, lo stato
/// dei job e i quadranti delle sveglie.
pub(super) struct Shared {
    pub(super) workspace: Custody<Workspace>,
    pub(super) bundles: Custody<BundleRegistry>,
    pub(super) bell: Arc<JobBell>,
    #[cfg(test)]
    pub(super) stop_race_probe: Option<Arc<StopRaceProbe>>,
    pub(super) stopping: AtomicBool,
    pub(super) opening: Custody<Option<InProgress>>,
    pub(super) bus: EventBus,
    pub(super) flags: Custody<Flags>,
    pub(super) alarms: Custody<Alarms>,
    pub(super) in_flight: Arc<(Mutex<InFlight>, Condvar)>,
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

enum OpeningAdvance {
    More(InProgress),
    Finished(Result<serde_json::Value, PluginError>),
}

/// Completes the opening job and wakes waiters even when an opening phase
/// returns an error or unwinds.
struct OpeningCompletion<'a> {
    shared: &'a Shared,
    id: JobId,
    end: Arc<(Mutex<bool>, Condvar)>,
    armed: bool,
}

impl<'a> OpeningCompletion<'a> {
    pub(super) fn new(shared: &'a Shared, in_progress: &InProgress) -> Self {
        Self {
            shared,
            id: in_progress.id,
            end: Arc::clone(&in_progress.end),
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }

    fn finish(
        &mut self,
        outcome: Result<serde_json::Value, PluginError>,
    ) -> Result<(), PluginError> {
        if !self.armed {
            return Ok(());
        }
        self.armed = false;
        let fallback_bus = self.shared.bus.clone();
        let fallback_outcome = outcome.clone();
        let mut queued = false;
        let completion = catch_unwind(AssertUnwindSafe(|| {
            let _ = self.shared.forget(self.id);
            with_event_drain(&self.shared.workspace, |ws| {
                ws.complete_job(self.id, fub_kernel::INDEX_JOB.to_string(), outcome);
                queued = true;
            })
        }));

        if !queued {
            let _ = catch_unwind(AssertUnwindSafe(|| {
                fallback_bus.emit(Notice::new(
                    Event::JobDone {
                        id: self.id,
                        job: fub_kernel::INDEX_JOB.to_string(),
                        result: fallback_outcome,
                    },
                    Origin::by(Actor::Kernel),
                ));
            }));
        }
        signal_opening_end(&self.end);

        match completion {
            Ok(result) => result,
            Err(payload) => Err(panic_error(
                payload,
                "la chiusura dell'apertura è andata in panico",
            )),
        }
    }
}

impl Drop for OpeningCompletion<'_> {
    fn drop(&mut self) {
        if self.armed {
            let _ = self.finish(Err(PluginError::Internal(
                "l'indicizzazione del vault è terminata per un guasto del runner"
                    .to_string()
                    .into(),
            )));
        }
    }
}

fn signal_opening_end(end: &Arc<(Mutex<bool>, Condvar)>) {
    let (done, bell) = &**end;
    match done.lock() {
        Ok(mut done) => *done = true,
        Err(poisoned) => *poisoned.into_inner() = true,
    }
    bell.notify_all();
}

fn panic_error(payload: Box<dyn Any + Send>, context: &str) -> PluginError {
    let message = payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("payload di panico non testuale");
    PluginError::Internal(format!("{context}: {message}").into())
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
    pub(super) fn advance_opening(&self) -> Result<bool, PluginError> {
        let Some(in_progress) = self.opening.write()?.take() else {
            return Ok(false);
        };
        let mut completion = OpeningCompletion::new(self, &in_progress);
        match catch_unwind(AssertUnwindSafe(|| self.advance_opening_step(in_progress))) {
            Ok(Ok(OpeningAdvance::More(in_progress))) => match self.opening.write() {
                Ok(mut opening) => {
                    *opening = Some(in_progress);
                    completion.disarm();
                    Ok(true)
                }
                Err(error) => Err(error),
            },
            Ok(Ok(OpeningAdvance::Finished(outcome))) => completion.finish(outcome).map(|()| true),
            Ok(Err(error)) => {
                let _ = completion.finish(Err(error.clone()));
                Err(error)
            }
            Err(payload) => {
                let error = panic_error(payload, "una fase dell'apertura è andata in panico");
                let _ = completion.finish(Err(error.clone()));
                Err(error)
            }
        }
    }

    fn advance_opening_step(
        &self,
        mut in_progress: InProgress,
    ) -> Result<OpeningAdvance, PluginError> {
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
            // dura secondi in mezzo ci sta comodo un salvataggio dell'utente.
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
            // Il core prende la fetta a prese brevi (`INDEX_WRITE_BUDGET`): fra
            // una e l'altra il workspace è di chi aspetta, chi apre una nota o
            // chi salva, e la presa dopo rifà il confronto delle impronte.
            //
            // L'ultima presa tiene il turno fino al finalize. Il turno
            // serializza le mutazioni dell'apertura con le altre scritture, ma
            // non è il `RwLock<Workspace>`: durante il codice del provider i
            // lettori devono poter entrare. È la stessa forma di
            // `write_document`: prepare/commit sotto lock, callback fuori lock,
            // finalize sotto lock.
            let mut parsed = parsed;
            let (_turn, pending) = loop {
                let turn = self.workspace.write_turn();
                let step = {
                    let mut ws = self.workspace.write()?;
                    ws.commit_index_batch_within(parsed, fub_kernel::INDEX_WRITE_BUDGET)
                };
                match step {
                    IndexBatchStep::Done(pending) => break (turn, pending),
                    IndexBatchStep::More(rest) => {
                        parsed = rest;
                        drop(turn);
                        self.workspace.make_way(MAKE_WAY);
                    }
                }
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
            return Ok(OpeningAdvance::More(in_progress));
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
        // Il flush è una fase esterna separata: il token conserva gli indici,
        // mentre i lettori e la re-entry possono progredire senza guard Workspace.
        let _ = crate::teardown::flush_indexes(&self.workspace)?;
        if !opening.interrupted {
            // Gli intent possono dipendere dai provider di formato: il replay
            // parte soltanto dopo l'indice completo e senza il lock Workspace.
            // Il protocollo kernel resta disponibile anche nelle build senza
            // la feature comandi; soltanto il batch `vault.archive` è opzionale.
            let mut recovery_host = JobHost::new(self.workspace.clone(), crate::settings::CORE_ID);
            let _resume_archive = match recovery_host.recover_explicit_renames() {
                Ok(failures) => {
                    for error in &failures {
                        tracing::warn!(
                            target: "fub.host",
                            "rinomina lasciata in recupero per conflitto: {error}"
                        );
                    }
                    failures.is_empty()
                }
                Err(error) => {
                    tracing::warn!(
                        target: "fub.host",
                        "scansione degli intent di rinomina non completata: {error}"
                    );
                    false
                }
            };
            #[cfg(feature = "commands")]
            if _resume_archive {
                let mut archive_host =
                    JobHost::new(self.workspace.clone(), fub_features::COMMANDS_ID);
                match fub_features::commands::recover_archive_batch(&mut archive_host) {
                    Ok(report) => {
                        for failure in report.failures {
                            tracing::warn!(
                                target: "fub.host",
                                subject = ?failure.subject,
                                "elemento archive lasciato in conflitto: {}",
                                failure.error
                            );
                        }
                    }
                    Err(error) => tracing::warn!(
                        target: "fub.host",
                        "batch archive non recuperato: {error}"
                    ),
                }
            }
        }
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
        Ok(OpeningAdvance::Finished(outcome))
    }

    /// Prende in carico un lotto appena drenato ([`Flags::claim`]).
    pub(super) fn claim(&self, jobs: &[PendingJob]) -> Result<(), PluginError> {
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
    pub(super) fn cancel(&self, id: JobId) -> Result<(), PluginError> {
        let issued = self.workspace.read()?.jobs_issued();
        self.flags.write()?.cancel(id, issued);
        Ok(())
    }

    fn forget(&self, id: JobId) -> Result<(), PluginError> {
        self.flags.write()?.live.remove(&id);
        Ok(())
    }

    pub(super) fn cancel_all(&self) -> Result<(), PluginError> {
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
    pub(super) fn shutdown(&self, plugin: &str) -> ShutDown {
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
    pub(super) fn run(&self, job: PendingJob) -> Result<(), PluginError> {
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
    /// Esegue una richiesta sincrona usando la stessa ammissione, cancellazione,
    /// contenimento dei panic e contabilità del percorso in coda.
    pub(super) fn run_direct(&self, job: PendingJob) -> Result<serde_json::Value, PluginError> {
        let outcome = self.outcome(&job);
        let flags = self.forget(job.id);
        let completion = with_event_drain(&self.workspace, |ws| {
            ws.complete_job(job.id, job.spec.job, outcome.clone());
        });
        completion?;
        flags?;
        outcome
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
    pub(super) fn refuse(&self, job: PendingJob, why: &str) -> Result<PluginError, PluginError> {
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
        workspace: &Custody<Workspace>,
        cursors: Vec<(String, String, fub_abi::traits::CivilTime)>,
    ) -> Result<(), PluginError> {
        let prepared = {
            let workspace = workspace.read()?;
            cursors
                .into_iter()
                .map(|(owner, timer, cursor)| {
                    workspace
                        .prepare_timer_cursors(&owner)
                        .map(|token| (token, timer, cursor))
                })
                .collect::<Result<Vec<_>, PluginError>>()?
        };
        for (token, timer, cursor) in prepared {
            token.write(&timer, cursor)?;
        }
        Ok(())
    }

    /// Carica i cursori dal dato autorevole del vault.
    fn load_cursors(
        &self,
        declared: &[(String, fub_abi::traits::TimerSpec)],
    ) -> Result<HashMap<(String, String), fub_abi::traits::CivilTime>, PluginError> {
        let prepared = {
            let workspace = self.workspace.read()?;
            let owners: HashSet<&str> = declared.iter().map(|(owner, _)| owner.as_str()).collect();
            owners
                .into_iter()
                .map(|owner| {
                    workspace
                        .prepare_timer_cursors(owner)
                        .map(|token| (owner.to_owned(), token))
                })
                .collect::<Result<Vec<_>, PluginError>>()?
        };
        let mut cursors = HashMap::new();
        for (owner, token) in prepared {
            for (timer, cursor) in token.read()? {
                cursors.insert((owner.clone(), timer), cursor);
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
        // Snapshot e persistenza stanno sotto lo stesso lock delle sveglie:
        // un worker che ha preso una fotografia più vecchia non può scriverla
        // dopo che un altro worker ha già avanzato il quadrante.
        let mut alarms = self.alarms.write()?;
        alarms.reconcile_with_cursors(&declared, now, &zone, &cursors);
        let until = alarms.time_until(now);
        Self::persist_cursors(&self.workspace, alarms.cursors())?;
        Ok(until)
    }

    /// Fa suonare ciò che è scaduto.
    ///
    /// Il quadrante si avanza e la fotografia si scrive tenendo il lock delle
    /// sveglie; l'evento si emette **dopo** averlo lasciato. Il cursore si scrive
    /// prima dell'evento, così un riavvio durante il dispatch non ripete
    /// l'occorrenza e due worker non possono invertire le fotografie persistite.
    pub(super) fn ring(&self) -> Result<(), PluginError> {
        let zone = self.machine_zone()?;
        let expired = {
            let mut alarms = self.alarms.write()?;
            let expired = alarms.expired(Instant::now(), &zone);
            Self::persist_cursors(&self.workspace, alarms.cursors())?;
            expired
        };
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
    pub(super) fn work(&self) {
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
            #[cfg(test)]
            if let Some(probe) = &self.stop_race_probe {
                probe.pause_before_ticket();
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
    pub(super) fn batch(&self, jobs: Vec<PendingJob>) -> Result<(), PluginError> {
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
