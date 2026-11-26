//! Eventi: emissione, consegna agli handler, job e timer.

use super::*;

/// Token opaco usato dal proxy dei job per rimandare il dispatch finché il
/// suo write guard non è stato rilasciato.
pub struct EventDispatchDeferral {
    pub(super) previous_dispatch_deferral: bool,
}

/// Cursore di un drenaggio eventi eseguito dall'host fuori dal lock.
///
/// Il budget appartiene all'intero drenaggio, non a una singola callback: una
/// cascata rientrante conserva quindi lo stesso limite del percorso diretto di
/// [`Workspace`].
pub struct EventDrain {
    pub(super) budget: usize,
    pub(super) active: bool,
    pub(super) lent: bool,
    pub(super) done: bool,
}

impl EventDrain {
    pub fn new() -> Self {
        Self {
            budget: Dispatcher::budget(),
            active: false,
            lent: false,
            done: false,
        }
    }
}

impl Default for EventDrain {
    fn default() -> Self {
        Self::new()
    }
}

/// Una consegna preparata sotto il write guard e invocabile senza alcun
/// prestito di `Custody<Workspace>`.
pub struct PreparedEventDelivery {
    pub(super) notice: Notice,
    pub(super) handlers: Vec<(String, Box<dyn EventHandler>)>,
    pub(super) previous_provider_call: bool,
}

/// La parte che deve rientrare nel workspace anche quando uno o più handler
/// hanno risposto con errore o sono andati in panico.
pub struct CompletedEventDelivery {
    pub(super) notice: Notice,
    pub(super) handlers: Vec<(String, Box<dyn EventHandler>)>,
    pub(super) previous_provider_call: bool,
    pub(super) troubles: Vec<(String, PluginError)>,
}

impl PreparedEventDelivery {
    /// Esegue `subscribed` e `handle` fuori dal workspace. La closure presta
    /// l'host stretto del singolo plugin e viene chiamata soltanto dopo che il
    /// chiamante ha rilasciato il write guard.
    pub fn invoke(
        mut self,
        mut with_host: impl FnMut(
            &str,
            &mut dyn FnMut(&mut dyn HostApi),
        ) -> std::result::Result<(), PluginError>,
    ) -> CompletedEventDelivery {
        let mut troubles = Vec::new();
        for (id, handler) in &mut self.handlers {
            let subscribed = crate::safety::calling(id, Gate::Event, "", || {
                Ok::<_, PluginError>(handler.subscribed())
            });
            let mask = match subscribed {
                Ok(mask) => mask,
                Err(error) => {
                    troubles.push((id.clone(), error));
                    continue;
                }
            };
            if !mask.wants(&self.notice.event) {
                continue;
            }

            let mut outcome = None;
            let mut invoke = |host: &mut dyn HostApi| {
                outcome = Some(crate::safety::calling(id, Gate::Event, "", || {
                    handler.handle(&self.notice, host)
                }));
            };
            if let Err(error) = with_host(id, &mut invoke) {
                troubles.push((id.clone(), error));
                continue;
            }
            match outcome {
                Some(Ok(())) => {}
                Some(Err(error)) => troubles.push((id.clone(), error)),
                None => troubles.push((
                    id.clone(),
                    PluginError::Internal(
                        "l'host non ha invocato la consegna evento preparata".into(),
                    ),
                )),
            }
        }

        CompletedEventDelivery {
            notice: self.notice,
            handlers: self.handlers,
            previous_provider_call: self.previous_provider_call,
            troubles,
        }
    }
}

impl Workspace {
    // --- eventi ------------------------------------------------------------

    /// Unico punto di emissione: ponte verso i subscriber esterni + coda per
    /// gli handler registrati.
    ///
    /// È anche il punto unico in cui l'origine (decisione 0012) viene apposta e in cui il
    /// lotto (decisione 0011) fa il proprio lavoro. Che siano la stessa riga non è
    /// economia: un secondo posto da cui emettere sarebbe un posto da cui uscire
    /// senza origine o fuori dal lotto, e un evento non attribuito è
    /// indistinguibile da uno attribuito male.
    pub(crate) fn emit_event(&mut self, event: Event) {
        self.dispatch.emit(event);
    }

    /// **Qualcosa è andato storto, e adesso c'è dove dirlo** (§20.2, decisione
    /// 0052).
    ///
    /// L'unico punto da cui il kernel emette un guasto. Passa da `emit_event`
    /// come tutto il resto — quindi porta l'origine e sta dentro il lotto — e
    /// non fa niente di più: non decide se si vede, non sceglie un tono per
    /// chi disegna, non scrive su `stderr`. Chi ha una superficie si abbona.
    pub(crate) fn report_trouble(
        &mut self,
        severity: Severity,
        subject: Option<DocId>,
        error: PluginError,
        gate: Option<Gate>,
    ) {
        self.emit_event(Event::Trouble {
            severity,
            subject,
            error,
            gate,
        });
    }

    /// Accoda un guasto prodotto dal composition root dell'host.
    ///
    /// Il watcher non è un plugin e non deve attraversare un [`HostApi`]
    /// intestato a un id fittizio: la guardia delle capacità filtrerebbe
    /// correttamente quell'emissione. L'host chiama questa porta dentro il
    /// proprio `with_event_drain`; qui si attribuisce il fatto al kernel e si
    /// accoda soltanto il notice, così gli handler verranno invocati dopo che
    /// il composition root avrà rilasciato la guardia del workspace.
    pub fn report_host_trouble(&mut self, severity: Severity, error: PluginError) {
        self.as_actor(Actor::Kernel, |ws| {
            ws.report_trouble(severity, None, error, None)
        });
    }

    /// Le perdite dell'alimentazione (§20.1) diventano guasti (§20.2): è la
    /// giunzione fra le due voci, ed è l'unica ragione per cui vanno decise
    /// nella stessa seduta — un esito che nomina i documenti perduti e nessun
    /// posto dove portarlo è un canale senza destinazione.
    ///
    /// Sono [`Severity::Warning`] tutte, e per la regola scritta nel contratto:
    /// un indice è un **derivato**, il vault è la verità, e ciò che si è perso
    /// torna riaprendo il vault. Non «non è grave» — chi cerca, fino ad allora,
    /// riceve una risposta incompleta senza sapere che lo è, ed è esattamente
    /// per questo che lo si dice.
    pub(crate) fn report_losses(&mut self, lost: Vec<IndexLoss>) {
        for loss in lost {
            self.report_trouble(Severity::Warning, Some(loss.id), loss.why, None);
        }
    }

    /// Esegue `f` attribuendo a `actor` tutto ciò che ne nasce, e rimette
    /// l'attore di prima quando `f` è tornata.
    ///
    /// L'attore è **chi ha chiesto**, non chi esegue: per questo lo alzano il
    /// watcher (il vault è cambiato senza passare da noi), il dispatch verso un
    /// handler (il plugin agisce di propria iniziativa) e `invoke_command` — dove
    /// però l'attore è il *chiamante* del comando, non il provider che lo
    /// esegue. Vedi `fub_abi::event`.
    pub(super) fn as_actor<R>(&mut self, actor: Actor, f: impl FnOnce(&mut Self) -> R) -> R {
        let prev = self.dispatch.swap_actor(actor);
        let result = f(self);
        self.dispatch.restore_actor(prev);
        result
    }

    /// Esegue `f` dentro un **lotto** (decisione 0011): ciò che vi succede è una cosa
    /// sola.
    ///
    /// Cosa cambia, dentro: gli eventi portano l'id del lotto sulla propria
    /// origine, `index-updated` non viene emesso, e il dispatch verso gli
    /// handler è rimandato alla chiusura — un handler che vedesse la sorgente
    /// numero 1 di una rinomina mentre la 200 non è ancora riscritta vedrebbe un
    /// vault a metà, e reagirebbe a uno stato che non è mai esistito per
    /// nessuno.
    ///
    /// Alla chiusura, se qualcosa è stato toccato, arriva un
    /// [`Event::BatchEnded`] con l'elenco dei documenti; poi la coda si drena.
    ///
    /// **Il lotto da solo non è una transazione.** Se una delle scritture dentro
    /// `f` fallisce, le altre restano fatte: il lotto raggruppa ciò che si dice a
    /// chi ascolta, non ciò che si scrive. Ciò che è andato storto lo riporta `f`
    /// col proprio valore di ritorno, che questa funzione passa intatto.
    ///
    /// Il tutto-o-niente c'è, ed è un altro attrezzo che dentro il lotto ci
    /// gira: un comando che scrive più documenti li consegna come
    /// [`WritePlan`](fub_abi::command::WritePlan), che controlla ogni revisione
    /// prima di scrivere e disfa all'indietro se un passo cade
    /// ([`fub_abi::rules::plan`]). Sta nel contratto e non qui perché chi lo usa
    /// riceve soltanto un `HostApi`, e passa così da ogni guardia e da ogni
    /// turno come le capacità che compone; il lotto del comando che lo apre fa
    /// uscire scritture e ritorni **una volta, dopo**, come fatti in coda.
    ///
    /// Annidato, entra nel lotto che c'è invece di aprirne un secondo: chiudere
    /// quello interno farebbe arrivare un `batch-ended` mentre l'operazione
    /// esterna è ancora in corso.
    ///
    /// **La chiusura è un `Drop`, non una riga da ricordare.** `f` è codice del
    /// kernel e dei provider, e può panicare: con la chiusura scritta *dopo* la
    /// chiamata, un panico la saltava e il lotto restava aperto — cioè
    /// `dispatch_pending` trovava `batch.is_some()` e tornava subito **per
    /// sempre**, senza consegnare più niente a nessun handler. Non è il panico
    /// che si vuole gestire (chi pania se lo tiene, decisione 0032): è che
    /// l'uscita da un lotto non dipenda da chi la scrive.
    pub fn batch<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        let mut batch = Batch::open(self);
        f(&mut batch)
    }

    /// Chiude il lotto più esterno: emette il terminale (se c'è qualcosa da
    /// dire) e drena.
    pub(super) fn end_batch(&mut self) {
        self.dispatch.close_batch();
        self.dispatch_pending();
    }

    /// Rimanda il dispatch avviato da una capacità del proxy host. Il token va
    /// sempre restituito a [`restore_event_dispatch`](Self::restore_event_dispatch)
    /// prima di rilasciare il guard.
    pub fn defer_event_dispatch(&mut self) -> EventDispatchDeferral {
        EventDispatchDeferral {
            previous_dispatch_deferral: self.dispatch.defer_dispatch(),
        }
    }

    /// Ripristina il frame aperto da [`defer_event_dispatch`](Self::defer_event_dispatch).
    pub fn restore_event_dispatch(&mut self, deferred: EventDispatchDeferral) {
        self.dispatch
            .restore_dispatch(deferred.previous_dispatch_deferral);
    }

    /// Completa un epilogo dopo che l'host ha drenato gli eventi. Non chiama
    /// codice esterno.
    pub fn finish_deferred_events<T>(&mut self, deferred: DeferredEvents<T>) -> T {
        if let Some(journal) = deferred.journal {
            self.record(journal);
        }
        if let Some(previous_actor) = deferred.previous_actor {
            self.dispatch.restore_actor(previous_actor);
        }
        deferred.outcome
    }

    /// Come [`finish_deferred_events`](Self::finish_deferred_events), ma la
    /// riga del registro **non** si scrive qui: torna a chi chiama, che la
    /// appende dopo aver lasciato il prestito esclusivo e prima di lasciare il
    /// turno di scrittura ([`PendingJournalRecord`]).
    pub fn finish_deferred_events_detached<T>(
        &mut self,
        deferred: DeferredEvents<T>,
    ) -> (T, Option<PendingJournalRecord>) {
        let record = deferred.journal.map(|op| PendingJournalRecord {
            journal: Arc::clone(&self.journal),
            origin: self.dispatch.origin(),
            op,
        });
        if let Some(previous_actor) = deferred.previous_actor {
            self.dispatch.restore_actor(previous_actor);
        }
        (deferred.outcome, record)
    }

    /// Dice un'appendice del registro non riuscita, con la stessa riga di
    /// [`record`](Self::record): un guasto del registro non annulla
    /// l'operazione, che è già avvenuta.
    pub fn report_journal_failure(&mut self, failure: JournalFailure) {
        self.report_trouble(
            Severity::Failure,
            None,
            PluginError::Internal(format!("registro: {}", failure.0).into()),
            None,
        );
    }

    /// Prepara una sola consegna del drenaggio `drain` senza eseguire callback.
    ///
    /// Dopo `Some`, chi chiama deve rilasciare il guard, invocare
    /// [`PreparedEventDelivery::invoke`] e riconsegnare sempre il risultato a
    /// [`finish_event_delivery`](Self::finish_event_delivery). `None` chiude
    /// il drenaggio (o dice che, per le regole consuete, va rimandato).
    pub fn prepare_event_delivery(
        &mut self,
        drain: &mut EventDrain,
    ) -> Option<PreparedEventDelivery> {
        if drain.done {
            return None;
        }
        debug_assert!(
            !drain.lent,
            "una consegna va finalizzata prima di prepararne un'altra"
        );
        if !drain.active {
            if !self
                .dispatch
                .begin_drain(!self.providers.handlers.is_empty())
            {
                drain.done = true;
                return None;
            }
            drain.active = true;
        }

        let Some(notice) = self.dispatch.next_to_deliver(&mut drain.budget) else {
            self.dispatch.end_drain();
            drain.active = false;
            drain.done = true;
            return None;
        };
        let handlers = self.providers.handlers.take();
        let previous_provider_call = self.dispatch.enter_provider_call();
        drain.lent = true;
        Some(PreparedEventDelivery {
            notice,
            handlers,
            previous_provider_call,
        })
    }

    /// Ripristina tabella e flag della consegna, quindi trasforma gli errori
    /// raccolti nei `Trouble` previsti dal contratto. Gira anche sul ramo
    /// errore/panico, perché entrambi sono già valori nel completamento.
    pub fn finish_event_delivery(
        &mut self,
        drain: &mut EventDrain,
        completed: CompletedEventDelivery,
    ) {
        let CompletedEventDelivery {
            notice,
            handlers,
            previous_provider_call,
            troubles,
        } = completed;
        self.dispatch.restore_provider_call(previous_provider_call);
        self.providers.handlers.restore(handlers);
        drain.lent = false;
        self.report_handler_troubles(&notice, troubles);
    }

    /// Attribuisce le capacità rientranti al plugin che sta ricevendo
    /// l'evento. Il token va sempre riconsegnato a
    /// [`finish_event_handler`](Self::finish_event_handler).
    pub fn prepare_event_handler(&mut self, plugin: &str) -> Actor {
        self.dispatch.swap_actor(Actor::Plugin {
            id: plugin.to_string(),
        })
    }

    /// Ripristina l'attore installato da [`prepare_event_handler`](Self::prepare_event_handler).
    pub fn finish_event_handler(&mut self, previous: Actor) {
        self.dispatch.restore_actor(previous);
    }

    /// Drena la coda eventi verso gli handler. Mai rientrante: chiamato
    /// durante un dispatch (es. da un `write_document` fatto da un handler)
    /// ritorna subito e lascia drenare il ciclo esterno.
    ///
    /// Se il budget si esaurisce (handler che si rimbalzano eventi senza
    /// convergere) il troncamento è **rumoroso e non cieco**: ciò che si
    /// riscopre riguardando il vault viene scartato e al suo posto viene
    /// consegnato — al bus e agli handler — un [`Event::Overflow`] con il
    /// conteggio dei persi, mentre ciò che porta l'unica copia di un fatto
    /// viene consegnato lo stesso (§20.5). Gli eventi emessi *durante* quel
    /// tratto finale non si consegnano — la coda deve terminare — ma si
    /// contano, e il conto esce in un ultimo `Overflow`.
    ///
    /// Un lotto aperto rimanda il drenaggio come lo rimanda una chiamata a un
    /// provider, e per la stessa ragione: dentro, il vault è a metà di
    /// un'operazione che nessuno ha ancora finito di chiedere.
    ///
    /// **Un lotto non è al riparo dal troncamento.** Se il budget si esaurisce
    /// mentre la coda si drena, fra gli eventi persi può esserci il
    /// `batch-ended`: l'`Overflow` che arriva al suo posto dice «riconcilia da
    /// zero», che è una richiesta più forte di «ridisegna questi documenti», e
    /// una garanzia in più per il solo terminale sarebbe una seconda promessa
    /// più debole accanto a una che già copre il caso.
    pub(super) fn dispatch_pending(&mut self) {
        // Il ciclo consegna e basta: quando fermarsi, cosa scartare e cosa
        // mettere al posto di ciò che si scarta lo decide il [`Dispatcher`]
        // (§8.1). Qui resta ciò che il componente non può fare — chiamare un
        // provider, che vuole `&mut Workspace` da prestare come `HostApi`.
        if !self
            .dispatch
            .begin_drain(!self.providers.handlers.is_empty())
        {
            return;
        }
        let mut budget = Dispatcher::budget();
        while let Some(notice) = self.dispatch.next_to_deliver(&mut budget) {
            self.deliver_to_handlers(&notice);
        }
        self.dispatch.end_drain();
    }

    /// **Presta i provider di una tabella per la durata di una chiamata**: la
    /// disciplina di consegna, scritta una volta sola (§7.2).
    ///
    /// Estrae le voci dal workspace (l'host presta `&mut Workspace`, e un
    /// provider che vi restasse dentro sarebbe un alias), chiama `f` col flag
    /// `in_provider_call` alzato — così ciò che il provider emette arriva agli
    /// handler *dopo* che la sua chiamata è tornata — e rimette le voci al loro
    /// posto, in coda a quelle registrate nel frattempo.
    ///
    /// Erano tre copie (`deliver_to_handlers`, `flush_indexes`, `view_action`)
    /// e ognuna delle tre poteva sbagliare l'ultimo passo in silenzio. Il
    /// drenaggio della coda **non** è qui: `deliver_to_handlers` gira già
    /// dentro un dispatch, e gli altri due devono drenare dopo aver finito il
    /// proprio lavoro (validare un albero, raccogliere gli errori).
    ///
    /// `field` è un puntatore a funzione e non una chiusura perché deve poter
    /// essere richiamato **due volte** su `self` — prima per svuotare, poi per
    /// ripristinare — e una chiusura che catturasse `&mut self` non lo
    /// permetterebbe.
    pub(super) fn lend<T, R>(
        &mut self,
        field: fn(&mut Self) -> &mut ProviderTable<T>,
        f: impl FnOnce(&mut Self, &mut [T]) -> R,
    ) -> R {
        let mut lent = field(self).take();
        let out = self.with_provider_call(|ws| f(ws, &mut lent));
        field(self).restore(lent);
        out
    }

    /// Esegue `f` col flag `in_provider_call` alzato: qualunque
    /// `dispatch_pending` innescato dentro `f` (un provider che scrive via
    /// `HostApi`) viene rimandato. Chi chiama è responsabile di drenare la
    /// coda **dopo** — è il "dopo che la tua chiamata è tornata" del contratto.
    pub(super) fn with_provider_call<R>(&mut self, f: impl FnOnce(&mut Self) -> R) -> R {
        let prev = self.dispatch.enter_provider_call();
        let result = f(self);
        self.dispatch.restore_provider_call(prev);
        result
    }

    /// Consegna un singolo evento a tutti gli handler abbonati. Gli handler
    /// escono dal workspace per la durata della chiamata: così `KernelHost`
    /// può prestare `&mut Workspace` senza aliasing.
    ///
    /// Per la durata di `handle` l'attore è il **plugin** (decisione 0012): ciò che
    /// scrive lì dentro lo ha chiesto lui, di propria iniziativa, ed è così che
    /// alla prossima consegna riconosce le proprie scritture senza tenerne una
    /// contabilità privata. L'origine dell'evento che sta *ricevendo* è un'altra
    /// cosa e sta nel [`Notice`], dove il plugin la legge.
    pub(super) fn deliver_to_handlers(&mut self, notice: &Notice) {
        let troubles = self.lend(
            |ws| &mut ws.providers.handlers,
            |ws, handlers| {
                let mut troubles: Vec<(String, PluginError)> = Vec::new();
                for (id, handler) in handlers.iter_mut() {
                    // La maschera per intero: la specie, il prefisso di topic
                    // per i custom, il soggetto (§10.1) e **cosa è cambiato**
                    // nel documento (§22.2, decisione 0069). La regola sta nel
                    // contratto (`fub_abi::rules::events`) e non qui, perché
                    // il secondo lettore è la shell — che decide da sé quando
                    // ridisegnare una view dichiarata.
                    let subscribed = crate::safety::calling(id, Gate::Event, "", || {
                        Ok::<_, PluginError>(handler.subscribed())
                    });
                    let mask = match subscribed {
                        Ok(mask) => mask,
                        Err(error) => {
                            troubles.push((id.clone(), error));
                            continue;
                        }
                    };
                    if !mask.wants(&notice.event) {
                        continue;
                    }
                    let attore = Actor::Plugin { id: id.clone() };
                    let fault = ws.as_actor(attore, |ws| {
                        let mut host = ws.host_for(id, InvokeMode::Apply);
                        // L'errore di un handler non deve far fallire
                        // l'operazione che ha emesso l'evento — quella parte
                        // del vecchio commento era giusta ed è rimasta — ma
                        // «non far fallire» non vuol dire «non dirlo» (§20.3):
                        // qui c'era un `let _ =` e un panico che finiva su
                        // `stderr`, e la sola feature che esiste per esserci
                        // quando qualcosa va storto — il versioning, che è un
                        // `EventHandler` e nient'altro — smetteva di fare
                        // snapshot in un modo indistinguibile dal funzionare.
                        crate::safety::calling(id, Gate::Event, "", || {
                            handler.handle(notice, &mut host)
                        })
                        .err()
                    });
                    troubles.extend(fault.map(|and| (id.clone(), and)));
                }
                troubles
            },
        );
        self.report_handler_troubles(notice, troubles);
    }

    pub(super) fn report_handler_troubles(
        &mut self,
        notice: &Notice,
        troubles: Vec<(String, PluginError)>,
    ) {
        // **Il guasto della consegna di un guasto non si emette** (decisione
        // 0052). È l'unico ciclo che questa variante rende possibile — un
        // handler che fallisce ricevendo un `Trouble` ne produrrebbe un
        // secondo, che ripasserebbe da lui — e si chiude dove nasce, cioè qui,
        // perché è il kernel a emettere. Il budget del dispatch lo fermerebbe
        // comunque: ma quello è una rete di sicurezza, non una semantica, e
        // ciò che troncherebbe sono gli eventi degli altri.
        if matches!(notice.event, Event::Trouble { .. }) {
            return;
        }
        // Emesso **fuori** dal prestito: dentro `lend` la tabella degli
        // handler è in mano a chi consegna, e un evento emesso lì dentro
        // arriverebbe a una lista vuota. Il soggetto è il documento che
        // l'evento nominava — chi guarda quella nota è chi ha interesse a
        // sapere che qualcuno non è riuscito a reagirle.
        let subject = notice.event.touched().cloned();
        for (id, error) in troubles {
            // **Chi** ha fallito lo dice l'origine, non un campo nuovo: il
            // guasto si emette a nome del plugin (decisione 0012), che è la
            // stessa meccanica con cui un handler riconosce le proprie
            // scritture. Un campo `plugin` dentro il record avrebbe duplicato
            // ciò che il notice porta già.
            //
            // `Failure` e non `Warning`: il kernel non sa cosa **non** è
            // successo. Dietro un `EventHandler` c'è il versioning tanto
            // quanto un contatore, e sottostimare la perdita di uno snapshot è
            // peggio che sovrastimare quella di un contatore.
            let subject = subject.clone();
            self.as_actor(Actor::Plugin { id }, |ws| {
                ws.report_trouble(Severity::Failure, subject, error, Some(Gate::Event))
            });
        }
    }

    // --- job (lavoro lungo, fuori dal giro sincrono) -----------------------

    /// Accoda un job richiesto via
    /// [`HostEvents::spawn_job`](fub_abi::traits::HostEvents::spawn_job) e ne
    /// restituisce l'identità.
    ///
    /// Sta qui e non nell'host perché il contatore è del workspace: un host è
    /// un prestito per la durata di una chiamata, e un'identità che si conta
    /// dentro un prestito ricomincerebbe da capo a ogni prestito.
    ///
    /// Da qui il job è **vivo e visibile** (§10.3): entra nella tabella che
    /// [`IndexQuery::Jobs`](fub_abi::traits::IndexQuery::Jobs) racconta, e ne
    /// esce un [`Event::JobStarted`]. L'origine non la si tocca: è quella del
    /// giro in corso, cioè di **chi ha chiesto** il lavoro — che è la sola cosa
    /// che l'evento non porta nei propri campi.
    ///
    /// **Su un vault che sta chiudendo non entra, e lo dice.** Da quando
    /// `closed` è alzato nessuno può più eseguire un job — il runner del vault
    /// è già fermo, e l'unico drenaggio è già girato — quindi accodarne uno
    /// vorrebbe dire un chiamante che aspetta un `JobDone` che non arriva mai.
    /// La guardia risponde subito con un
    /// [`Cancelled`](PluginError::Cancelled) e la coda resta vuota. È **per
    /// generazione**: chi riapre il vault è un workspace nuovo col suo `closed`
    /// a posto, e la chiusura vecchia non lo lascia chiuso.
    pub(crate) fn enqueue_job(
        &mut self,
        plugin: &str,
        spec: JobSpec,
    ) -> std::result::Result<JobId, PluginError> {
        if self.closed {
            return Err(PluginError::Cancelled(
                format!("il vault si sta chiudendo: il job `{}` non parte", spec.job).into(),
            ));
        }
        let job = spec.job.clone();
        let id = self.dispatch.enqueue_job(plugin, spec);
        let since = self.now_unix_millis();
        self.indexes.core.jobs.accepted(id, &job, plugin, since);
        self.emit_event(Event::JobStarted { id, job });
        Ok(id)
    }

    /// Riserva un job per una chiamata sincrona dell'host senza inserirlo nella
    /// coda del runner. Usa lo stesso contatore, tabella ed evento di
    /// [`enqueue_job`]; il composition root lo esegue poi con la stessa
    /// ammissione dei job drenati dal pool.
    pub fn issue_direct_job(
        &mut self,
        plugin: &str,
        spec: JobSpec,
    ) -> std::result::Result<PendingJob, PluginError> {
        if self.closed {
            return Err(PluginError::Cancelled(
                format!("il vault si sta chiudendo: il job `{}` non parte", spec.job).into(),
            ));
        }
        let job = spec.job.clone();
        let id = self.dispatch.next_job_id();
        let since = self.now_unix_millis();
        self.indexes.core.jobs.accepted(id, &job, plugin, since);
        self.emit_event(Event::JobStarted { id, job });
        Ok(PendingJob {
            id,
            plugin: plugin.to_string(),
            spec,
        })
    }

    /// **Dichiara viva la seconda fase dell'apertura**, e le dà un'identità
    /// (§15.7).
    ///
    /// L'indicizzazione è un job *vero* e non un meccanismo accanto ai job: da
    /// qui compare in
    /// [`IndexQuery::Jobs`](fub_abi::traits::IndexQuery::Jobs), si racconta con
    /// [`note_job_progress`](Workspace::note_job_progress), si ferma dal
    /// pulsante che ferma gli altri (§10.3) e si chiude con
    /// [`complete_job`](Workspace::complete_job). Riusarli invece di
    /// costruirne un secondo giro non è un risparmio di righe: è ciò che fa sì
    /// che il centro attività mostri l'apertura senza sapere che l'apertura
    /// esiste.
    ///
    /// **Non entra nella coda** ([`take_pending_jobs`](Workspace::take_pending_jobs)):
    /// un job in coda dice *quale plugin* lo esegue, e il registry ne cerca il
    /// corpo. Questo corpo non sta in nessun bundle — è il kernel — e mettercelo
    /// vorrebbe dire o un bundle finto o una capacità con cui «alimenta gli
    /// indici» sia esprimibile al confine. Chi ha i thread lo sa e lo porta
    /// avanti a fette, che è la ragione per cui l'[`Indicizzazione`] è un valore
    /// che si passa e non uno stato del kernel.
    ///
    /// L'intestatario è [`CORE_ID`](crate::index::CORE_ID) e l'origine è
    /// [`Actor::Kernel`]: l'apertura non l'ha chiesta nessun plugin
    /// (decisione 0012).
    pub fn begin_index_job(&mut self) -> JobId {
        let id = self.dispatch.next_job_id();
        let since = self.now_unix_millis();
        self.indexes
            .core
            .jobs
            .accepted(id, INDEX_JOB, crate::index::CORE_ID, since);
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::JobStarted {
                id,
                job: INDEX_JOB.to_string(),
            });
            ws.dispatch_pending();
        });
        id
    }

    /// **A che punto è** un job (§10.3, decisione 0035).
    ///
    /// Non è una capacità e non passa dall'[`HostApi`](fub_abi::traits::HostApi):
    /// è la porta di chi *esegue* il job — il `JobHost` di `fub-host`, che
    /// l'identità ce l'ha — e proprio per questo l'id non è un parametro che un
    /// job possa sbagliare o fingere. Il job dal canto suo chiama
    /// [`report_progress`](fub_abi::traits::HostEvents::report_progress), che
    /// non nomina nessuno.
    ///
    /// Un progresso per un job **non più vivo** non si registra e non si emette:
    /// chi lo timbra gira su un altro thread, e fra il suo ultimo passo e
    /// l'esito ci sta di tutto — far ricomparire una riga già chiusa sarebbe un
    /// centro attività che mostra un lavoro finito.
    ///
    /// L'origine è il **plugin di cui il job è**, e non il kernel come per
    /// l'esito: `JobDone` lo emette il kernel perché il job lo ha eseguito lui e
    /// chi lo ha chiesto si riconosce dall'`id`, mentre un progresso è il
    /// racconto che il job fa di sé — «questo lo sto facendo io».
    pub fn notes_job_progress(&mut self, id: JobId, progress: JobProgress) {
        if !self.indexes.core.jobs.progressed(id, progress.clone()) {
            return;
        }
        let plugin = self.indexes.core.jobs.owner(id);
        self.as_actor(Actor::Plugin { id: plugin }, |ws| {
            ws.emit_event(Event::JobProgress { id, progress });
            ws.dispatch_pending();
        });
    }

    /// **Il campanello dei job** (§9.3), da dare a chi possiede i thread.
    ///
    /// Il kernel non sa che esistono dei thread, e non deve: sa che qualcuno
    /// potrebbe stare aspettando un job, e presta il pezzetto di stato che serve
    /// a svegliarlo — esattamente come presta la bandiera del rilevamento a chi
    /// tiene un watcher ([`watch_flag`](Workspace::watch_flag), decisione 0030).
    /// Senza, chi drena la coda dovrebbe interrogarla a intervalli, cioè
    /// scegliere una politica al posto di un fatto.
    pub fn job_bell(&self) -> Arc<JobBell> {
        self.dispatch.bell()
    }

    /// Preleva i job richiesti dai provider via
    /// [`HostEvents::spawn_job`](fub_abi::traits::HostEvents::spawn_job).
    ///
    /// Il kernel è sincrono e non possiede thread: chi li possiede — il
    /// `JobRunner` di `fub-host`
    /// ([decisione 0032](../../../docs/decisions/0183-composizione-host-kernel.md)), a
    /// M5 l'host WASM — drena questa coda, esegue ogni job **fuori** dal lock
    /// del workspace (`Plugin::run_job`, a M5 su un'istanza separata del
    /// componente) e riconsegna l'esito con [`Workspace::complete_job`].
    ///
    /// Chi drena non deve chiedere «ce n'è uno?» a intervalli: aspetta il
    /// [campanello](Workspace::job_bell), che suona quando uno entra.
    ///
    /// «Fuori dal lock» è la parte che chi drena non può sbagliare senza
    /// rompere tutto: dalla decisione 0027 il job ha l'host, quindi la prima
    /// capacità che usa prende il prestito del workspace, e chi lo eseguisse
    /// tenendolo aspetterebbe sé stesso. Il ponte che serve — un host che prende
    /// il prestito per **chiamata** — è `JobHost` in `fub-host`.
    pub fn take_pending_jobs(&mut self) -> Vec<PendingJob> {
        self.dispatch.take_pending_jobs()
    }

    /// **Quante identità di job il kernel ha emesso finora**: il primo numero
    /// che non è ancora di nessuno.
    ///
    /// È un confine, non una statistica, e serve a una domanda sola: *questo id
    /// è mai stato dato a qualcuno?* Chi annulla riceve l'id da fuori — dal
    /// pulsante del centro attività, e sull'IPC come stringa — e senza questo
    /// numero non c'è modo di distinguere «un job che deve ancora partire» da
    /// «un numero che non è mai stato un job». Le due cose vogliono risposte
    /// opposte: la prima vuole che l'annullamento **aspetti** il job, la seconda
    /// che non lasci niente dietro di sé.
    ///
    /// Il contatore è **uno** per workspace e non cala mai: un id sotto questo
    /// segno è stato emesso, uno pari o sopra no, e nessun riuso lo rimette in
    /// discussione.
    pub fn jobs_issued(&self) -> u64 {
        self.dispatch.jobs_issued()
    }

    /// Le **sveglie dichiarate** da chi è registrato adesso (§22.1, decisione
    /// 0069): l'id del componente e la sua `TimerSpec`.
    ///
    /// È ciò che uno scheduler legge per sapere quando deve svegliarsi. Il
    /// kernel non lo tiene: lo tiene il manifest, che è dove la dichiarazione è
    /// stata scritta, e lo perde quando il componente si ritira — che è la
    /// proprietà per cui non c'è un secondo registro da tenere allineato.
    ///
    /// **Il kernel non legge l'orologio.** Questa firma non dice *quando* è
    /// adesso e non ha un `Instant` da nessuna parte: il tempo di parete è di
    /// chi possiede i thread, e la 0032 ha già stabilito che è l'host. Il
    /// contratto ci mette la regola ([`TimerSchedule::nth_after`](fub_abi::traits::TimerSchedule::nth_after)) perché due
    /// host non abbiano due idee di cosa voglia dire «ogni ora».
    pub fn declared_timers(&self) -> Vec<(String, TimerSpec)> {
        self.providers
            .plugins
            .timers()
            .into_iter()
            .map(|(owner, spec)| (owner.to_string(), spec.clone()))
            .collect()
    }

    /// Fa suonare una sveglia: emette [`Event::TimerFired`] sul giro sincrono
    /// normale, come ogni altro evento.
    ///
    /// Risponde `false` — e non emette niente — se quel componente non dichiara
    /// (più) quella sveglia. È la riga che rende la dichiarazione **valutata**
    /// invece che decorativa: senza, uno scheduler che si tiene una copia
    /// dell'elenco continuerebbe a svegliare un plugin disattivato, e il
    /// contratto direbbe che la sveglia è del manifest mentre in realtà è di
    /// chi l'ha copiata.
    ///
    /// L'origine è [`Actor::Kernel`] per la ragione di [`Event::JobDone`]: a
    /// far scattare la sveglia non è stato il plugin, è stato il tempo. Chi si
    /// riconosce lo fa da `owner`, che è il campo fatto apposta.
    pub fn fire_timer(&mut self, owner: &str, timer: &str) -> bool {
        let declared = self
            .providers
            .plugins
            .timers()
            .iter()
            .any(|(or, spec)| *or == owner && spec.id == timer);
        if !declared {
            return false;
        }
        // Come `complete_job`, e per la stessa ragione: chi chiama arriva da
        // fuori del giro sincrono — è il pool — quindi l'evento non trova
        // nessuno che stia già drenando, e senza questa riga resterebbe in coda
        // fino alla prossima scrittura di qualcun altro.
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::TimerFired {
                owner: owner.to_string(),
                timer: timer.to_string(),
            });
            ws.dispatch_pending();
        });
        true
    }

    /// Riconsegna l'esito di un job: emette [`Event::JobDone`] sul giro
    /// sincrono normale (bus + handler). Chi ha lanciato il job riconosce il
    /// proprio `id`.
    ///
    /// L'origine è [`Actor::Kernel`] e non il plugin che ha lanciato il job: il
    /// job lo ha eseguito l'host, fuori dal lock, e il lanciatore si riconosce
    /// dall'`id` — che è il campo fatto apposta. Intestarglielo direbbe «questo
    /// lo hai chiesto tu adesso», che è vero solo a metà e proprio nel senso
    /// sbagliato per un handler che salta le proprie scritture.
    ///
    /// È anche il momento in cui il job **smette di essere vivo**: la riga esce
    /// dalla tabella del §10.3 *prima* che l'evento parta, o chi riceve
    /// `job-done` e ricontrolla l'elenco troverebbe ancora là dentro il lavoro
    /// che gli è appena stato detto finito.
    pub fn complete_job(
        &mut self,
        id: JobId,
        job: impl Into<String>,
        result: std::result::Result<serde_json::Value, PluginError>,
    ) {
        self.indexes.core.jobs.finished(id);
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::JobDone {
                id,
                job: job.into(),
                result,
            });
            ws.dispatch_pending();
        });
    }
}
