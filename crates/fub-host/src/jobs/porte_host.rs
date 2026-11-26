//! Le altre porte che `JobHost` offre ai lavori: stato delle viste, impostazioni, ambiente, eventi, interrogazioni, comandi, rete e servizi.

use super::*;

/// Un job normale non disegna una view e quindi non ha uno stato di view.
/// Lo stesso proxy, quando serve una callback di view staccata dal workspace,
/// porta invece `instance`: in quel caso queste due capacità ricevono il timbro
/// dell'esemplare. Comandi, servizi e job annidati non lo ereditano.
impl ViewStateRead for JobHost {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        self.read_result(|h| h.view_state(key))
    }
}

impl ViewStateWrite for JobHost {
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        self.write_result(|h| h.set_view_state(key, value.clone()))
    }
}

impl SettingsRead for JobHost {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        self.read_result(|h| h.setting(key))
    }
}

impl SettingsWrite for JobHost {
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        self.mutate_setting_detached(key, Some(value), format!("writing setting `{key}`"))
    }

    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError> {
        self.mutate_setting_detached(key, None, format!("resetting setting `{key}`"))
    }
}

impl HostEnv for JobHost {
    fn now_unix_millis(&self) -> u64 {
        self.reading(|h| h.now_unix_millis()).unwrap_or_default()
    }

    /// Come il contesto qui sotto: quello di **adesso**. Un job che dura può
    /// attraversare un cambio di lingua o l'ora legale, e ciò che scrive dopo va
    /// scritto come lo legge chi lo sta aspettando.
    fn user_locale(&self) -> Locale {
        self.reading(|h| h.user_locale()).unwrap_or_default()
    }

    /// La sola delle quattro capacità di `HostEnv` che passa da `read_result`, e
    /// non per scelta di questo modulo: è l'unica che ha un esito, e da quando
    /// ce l'ha (decisione 0094) la regola della
    /// [0032](../../../docs/decisions/0183-composizione-host-kernel.md) — *la
    /// cancellazione non aggiunge una capacità, toglie le altre* — la può
    /// raggiungere. Prima non poteva: un job annullato che chiedeva byte li
    /// riceveva, perché la firma non aveva un posto in cui dire di no.
    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
        self.read_result(|h| h.random_bytes(n))
    }

    /// Che pannello guarda l'utente **adesso**, non quando il job è partito: un
    /// job dura, e un contesto congelato all'avvio sarebbe una risposta vecchia
    /// che nessuno saprebbe riconoscere come tale.
    fn active_context(&self) -> Option<ViewContext> {
        self.reading(|h| h.active_context()).unwrap_or_default()
    }
}

impl HostEvents for JobHost {
    /// Emettere prende il prestito **esclusivo**: un evento entra nella coda del
    /// dispatcher e da lì raggiunge gli handler, che scrivono.
    ///
    /// **Senza esito, e quindi senza modo di dire «non ora»**: se il turno non si
    /// può avere perché chi lo ha aspetta l'istanza che questo job tiene, l'evento
    /// non parte, come quando la policy lo nega — «il silenzio è il no» (§9.3).
    /// Si scrive nel log perché non sia un silenzio muto: chi vuole *esserci* a
    /// ogni costo usa `spawn-job`, che un esito lo ha. La cancellazione invece
    /// non c'entra: un job annullato può ancora emettere.
    fn emit(&mut self, event: Event) {
        if let Err(refusal) = self.writing(|h| h.emit(event)) {
            tracing::warn!(
                target: "fub.host",
                "`{}`: un evento emesso dal componente non è partito: {refusal}",
                self.plugin,
            );
        }
    }

    /// Un job può chiederne un altro: la coda è la stessa, e a drenarla è sempre
    /// chi possiede i thread.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError> {
        self.write_result(|h| h.spawn_job(spec))
    }

    /// **Il timbro**: il job dice a che punto è, e chi lo dice per lui è questo
    /// host, che l'identità ce l'ha (§10.3).
    ///
    /// Non passa da `with_host` come tutto il resto, e non è una scorciatoia: le
    /// capacità sono ciò che si presta a un *plugin*, e qui il fatto da
    /// registrare non è del plugin — è di **questo job**, che il contratto non
    /// dà modo di nominare. Il prestito esclusivo lo prende lo stesso, perché
    /// dall'altra parte c'è una tabella da aggiornare e una coda da drenare.
    ///
    /// Non si nega a un job annullato, come `emit`: l'ultima cosa che un job che
    /// sta smettendo può voler dire è a che punto era arrivato.
    fn report_progress(&mut self, progress: JobProgress) {
        let Some(id) = self.job else {
            return;
        };
        let workspace = self.workspace.clone();
        // Un progresso è un'informazione, non un effetto: se un salvataggio
        // aspetta l'istanza di questo job si rinuncia al timbro invece di
        // tenere fermo il lavoro. Un job annullato lo può dare lo stesso.
        let Ok(_turn) = workspace.write_turn_yielding(&|| Ok(())) else {
            return;
        };
        let _ = with_event_drain(&workspace, |ws| ws.notes_job_progress(id, progress));
    }
}

impl HostQuery for JobHost {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        self.stopped()?;
        let policy = self.workspace.read()?.granted_policy(&self.plugin);
        let capability = authorize_query(&policy, &query.kind())?;
        let result = query_workspace(&self.workspace, query)?;
        Ok(filter_query_result(&policy, capability, result))
    }
}

impl HostCommands for JobHost {
    /// Un comando annidato conserva il turno di mutazione ma **rilascia il
    /// `RwLock`** durante `CommandProvider::invoke`, come il percorso top-level.
    /// Il proxy figlio riacquisisce capacità strette una chiamata alla volta.
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        self.stopped()?;
        self.authorize_caller(Capability::Commands, || format!("invoking `{command}`"))?;
        let workspace = self.workspace.clone();
        // Un comando di sola lettura ha il suo frame e non prende il turno:
        // annidato o no, non ferma chi scrive. Ha una bandiera sua: chi spegne
        // il suo plugin ferma la lettura, non questo host.
        let own = Arc::new(AtomicBool::new(false));
        let mut outer_stops = self.outer_stops.clone();
        outer_stops.push(Arc::clone(&self.cancelled));
        let read_only = workspace.read()?.prepare_read_only_provider_command(
            command,
            args.clone(),
            self.mode,
            &self.chain,
            &own,
            &outer_stops,
        )?;
        if let Some(prepared) = read_only {
            let host = self.for_read(prepared.owner().to_string(), prepared.host_mode(), own);
            return run_read_only_command(&workspace, host, prepared);
        }
        let _turn = self.turn(&workspace)?;
        let mut prepared = {
            let mut ws = workspace.write()?;
            match ws.prepare_nested_provider_command(command, args.clone(), self.mode)? {
                Some(prepared) => prepared,
                None => {
                    if let Some(rebuild) =
                        ws.prepare_maintenance_rebuild(command, args.clone(), self.mode, None)?
                    {
                        drop(ws);
                        return run_detached_rebuild_index(&workspace, rebuild);
                    }
                    let deferred = ws.defer_event_dispatch();
                    let outcome = ws.invoke_nested_maintenance_command(command, args, self.mode);
                    ws.restore_event_dispatch(deferred);
                    drop(ws);
                    drain_events(&workspace)?;
                    return outcome;
                }
            }
        };

        let owner = prepared.owner().to_string();
        let host_mode = prepared.host_mode();
        let outcome = if let Some(why) = prepared.read_only_reason() {
            let host = self.for_provider(owner, host_mode);
            let mut host = Guard::new(host, ReadOnly { why });
            prepared.invoke(&mut host)
        } else {
            let mut host = self.for_provider(owner, host_mode);
            prepared.invoke(&mut host)
        };

        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_provider_command_deferred(prepared, outcome)
        };
        finish_events(&workspace, deferred)?
    }

    /// L'annullamento tiene replay e batch nel token del kernel, ma non il
    /// prestito del workspace. Ogni passo attraversa così lo stesso percorso
    /// staccato della capacità corrispondente.
    fn undo_last(&mut self) -> Result<Option<fub_abi::command::Undone>, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;

        {
            let ws = workspace.read()?;
            let policy = ws.granted_policy(&self.plugin);
            for capability in std::iter::once(Capability::Commands).chain(
                Capability::ALL
                    .into_iter()
                    .filter(|cap| cap.writes_the_vault()),
            ) {
                if let Some(why) = policy.denies(capability) {
                    return Err(PluginError::PermissionDenied(
                        format!("undoing: {why}").into(),
                    ));
                }
            }
            authorize_path(&policy, Capability::VaultWrite, "", || "undoing".into())?;
        }
        if self.mode.is_dry_run() {
            return Err(PluginError::PermissionDenied(
                "undo: a simulation does not write".into(),
            ));
        }

        let Some(mut replay) = ({
            let mut ws = workspace.write()?;
            ws.prepare_undo_replay()
        }) else {
            return Ok(None);
        };

        let replayed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            while let Some(step) = replay.next_step() {
                let outcome = match step {
                    UndoStep::Edit(planned) => self
                        .apply_edit_detached(&planned.doc, planned.edit)
                        .map(|_| ())
                        .map_err(|and| Failure::of(planned.doc, and)),
                    UndoStep::Command { command, args } => self
                        .run_command(&command, args)
                        .map(|_| ())
                        .map_err(Failure::other),
                };
                replay.finish_step(outcome);
            }
        }));
        if replayed.is_err() {
            replay.finish_unwind();
        }

        let deferred = {
            let mut ws = workspace
                .write()
                .expect("un callback di undo gira senza il lock del workspace");
            ws.finish_undo_replay_deferred(replay)
        };
        let drained =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drain_events(&workspace)));
        let outcome = {
            let mut ws = workspace
                .write()
                .expect("il drain degli eventi gira senza il lock del workspace");
            ws.finish_undo_replay(deferred)
        };

        if let Err(payload) = replayed {
            std::panic::resume_unwind(payload);
        }
        match drained {
            Err(payload) => std::panic::resume_unwind(payload),
            Ok(Err(error)) => Err(error),
            Ok(Ok(())) => outcome,
        }
    }
}

/// Sotto prestito **condiviso**, e la decisione 0102 lo scrive dove conta: un
/// import di un vault intero legge la sorgente per minuti, e servirlo da
/// `writing` terrebbe il lock esclusivo per tutto quel tempo — cioè affamerebbe
/// chi scrive esattamente come farebbe una lettura di documento, ma per minuti
/// invece che per microsecondi. È la ragione per cui `TransferRead` sta in
/// [`ReadApi`](fub_abi::traits::ReadApi) e non su `HostApi`.
impl TransferRead for JobHost {
    fn read_source(
        &self,
        handle: fub_abi::transfer::SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        self.read_result(|h| h.read_source(handle, offset, len))
    }
}

impl HostNetwork for JobHost {
    /// **L'unica capacità che non passa dal prestito del workspace**, e non è
    /// una scorciatoia: è la sola la cui durata l'host non governa.
    ///
    /// Tutte le altre righe di questo file delegano dentro `reading` o
    /// `writing`, cioè tenendo il lock per il tempo della chiamata — che per
    /// una lettura di documento è microscopico. Una richiesta di rete dura
    /// quanto la rete: tenere il prestito condiviso per quel tempo affamerebbe
    /// chi scrive, che è precisamente il difetto contro cui la
    /// [0024](../../../docs/decisions/README.md)
    /// ha scelto l'`RwLock` — e lo farebbe su una chiamata che **il vault non
    /// lo tocca affatto**.
    ///
    /// Quindi il lock si prende due volte e per un istante: una per il permesso
    /// e il filo, una — implicita — per ciò che chi chiama farà del risultato.
    /// Il permesso si rilegge **adesso** invece di catturarlo all'avvio del job,
    /// perché un plugin revocato mentre una richiesta è in volo deve trovare il
    /// cancello chiuso alla successiva, non alla fine del job.
    ///
    /// La cancellazione si guarda **due volte**, prima e dopo aver preso il
    /// filo, ed è la lezione della
    /// [0094](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md) presa
    /// sul serio: questa è la cosa più lunga che un job possa fare, quindi è
    /// quella in cui *la cancellazione toglie le altre capacità* conta di più.
    /// Fermare la richiesta **già partita** è parte della stessa domanda: il
    /// token arriva al transport e il suo reader chiude la connessione al primo
    /// controllo, senza aspettare il tetto globale dell'host.
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.on_wire(None, |guard, stop| guard.fetch_cancelled(request, stop))
    }

    /// Come [`fetch`](HostNetwork::fetch), fermata anche dalla bandiera del
    /// chiamante.
    fn fetch_cancelled(
        &self,
        request: HttpRequest,
        cancelled: &AtomicBool,
    ) -> Result<HttpResponse, PluginError> {
        self.on_wire(Some(cancelled), |guard, stop| {
            guard.fetch_cancelled(request, stop)
        })
    }

    /// Come [`fetch_cancelled`](HostNetwork::fetch_cancelled), con il tetto
    /// di byte del chiamante portato fino al filo.
    fn fetch_limited(
        &self,
        request: HttpRequest,
        cancelled: &AtomicBool,
        max_bytes: u64,
    ) -> Result<HttpResponse, LimitedFetchError> {
        self.on_wire(Some(cancelled), |guard, stop| {
            guard.fetch_limited(request, stop, max_bytes)
        })
    }
}

impl JobHost {
    /// **Una regola per le tre porte della rete**: la richiesta passa dal
    /// `Guard` di tutti gli altri (il cancello è uno solo, e chi gira dentro
    /// un job non ne attraversa uno più largo), e il trasferimento si ferma
    /// quando si alza **una qualunque** delle bandiere — quella del chiamante,
    /// se c'è (per esempio il cane da guardia di un suo tempo limite), quella
    /// di questo host e quelle di chi lo contiene. Il filo ne guarda una sola,
    /// e [`StopRelay`] gliela dà.
    ///
    /// Una bandiera già alzata ferma la richiesta prima del filo: non parte
    /// nemmeno.
    pub(super) fn on_wire<T, E: From<PluginError>>(
        &self,
        caller: Option<&AtomicBool>,
        send: impl FnOnce(&dyn HostNetwork, &AtomicBool) -> Result<T, E>,
    ) -> Result<T, E> {
        let (client, granted) = self.network_wire()?;
        let relay = StopRelay::watching(
            caller
                .into_iter()
                .chain(std::iter::once(self.cancelled.as_ref()))
                .chain(self.outer_stops.iter().map(Arc::as_ref)),
        );
        if relay.raised() {
            return Err(self.cancelled_error().into());
        }
        let guard = Guard::new(client.as_ref(), granted);
        relay
            .run(|stop| send(&guard, stop))
            .map_err(PluginError::from)?
    }
}

impl JobHost {
    /// Il filo e il permesso di adesso, presi per un istante: vedi
    /// [`fetch`](HostNetwork::fetch) qui sopra per il perché.
    pub(super) fn network_wire(
        &self,
    ) -> Result<(Arc<dyn HostNetwork>, fub_kernel::host::Granted), PluginError> {
        self.stopped()?;
        if self.mode == InvokeMode::DryRun {
            authorize_family(
                &ReadOnly {
                    why: "simulazione del comando",
                },
                Capability::Network,
                || "performing a network request".into(),
            )?;
        }
        let (client, granted) = {
            let ws = self.workspace.read()?;
            (ws.network(), ws.granted_policy(&self.plugin))
        };
        self.stopped()?;
        let Some(client) = client else {
            return Err(PluginError::Unserved(
                "this host is mounted without a network client".into(),
            ));
        };
        Ok((client, granted))
    }
}

impl HostServices for JobHost {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.stopped()?;
        if self.mode == InvokeMode::DryRun {
            authorize_family(
                &ReadOnly {
                    why: "simulazione del comando",
                },
                Capability::Services,
                || format!("calling `{service}.{method}`"),
            )?;
        }
        self.authorize_caller(Capability::Services, || {
            format!("calling `{service}.{method}`")
        })?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        let mut prepared = {
            let mut ws = workspace.write()?;
            ws.prepare_service_call(service, method, args)?
        };

        let owner = prepared.owner().to_string();
        let mut host = self.for_provider(owner, self.mode);
        let outcome = prepared.invoke(&mut host);

        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_service_call_deferred(prepared, outcome)
        };
        finish_events(&workspace, deferred)?
    }

    fn export_targets(&self) -> Result<Vec<ExportTarget>, PluginError> {
        self.stopped()?;
        Ok(self.workspace.read()?.export_targets())
    }

    /// L'exporter gira **fuori** dal prestito del workspace, con un host suo
    /// di sola lettura: un export del vault intero non tiene in fila chi
    /// scrive. I byte tornano nel rapporto, col tetto di
    /// [`PLUGIN_EXPORT_LIMIT`].
    ///
    /// L'errore dell'exporter esce nel catalogo di **chi l'ha scritto** (§12.2),
    /// come ogni errore di un provider: il job che lo chiama è di un altro
    /// bundle, e il suo catalogo quella chiave non ce l'ha. Senza, la chiave
    /// arrivava al centro attività non risolta e si leggeva «bad_args»
    /// (IMP-130).
    fn run_export(&mut self, request: &ExportRequest) -> Result<ExportReport, PluginError> {
        self.stopped()?;
        let prepared = {
            let ws = self.workspace.read()?;
            authorize_export(&ws.granted_policy(&self.plugin), request)?;
            ws.prepare_export()
        };
        let at = prepared.choose(&request.target)?;
        let owner = prepared.owner(at).to_owned();
        let host = self.for_provider(owner.as_str(), self.mode);
        let mut sink = MemorySink::bounded(PLUGIN_EXPORT_LIMIT);
        prepared
            .invoke(at, request, &host, &mut sink)
            .map_err(|mut error| {
                // Il workspace si riprende solo per le parole, dopo l'export:
                // l'exporter ha girato fuori dal prestito.
                if let Ok(ws) = self.workspace.read() {
                    ws.localize_as(&owner, &mut error);
                }
                error
            })
    }

    /// L'importer gira fuori dal prestito e senza il turno di scrittura: un
    /// import può durare quanto la rete che lo alimenta, e ogni sua scrittura
    /// prende il turno da sé, come quelle di un job.
    ///
    /// L'errore dell'importer esce nel catalogo di **chi l'ha scritto**
    /// (§12.2), come quello di un exporter in [`run_export`](Self::run_export):
    /// il job che lo chiama è di un altro bundle, e la chiave arrivava al
    /// centro attività non risolta.
    fn run_import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
    ) -> Result<ImportReport, PluginError> {
        self.stopped()?;
        let read_only = ReadOnly {
            why: "simulazione del comando",
        };
        let prepared = {
            let ws = self.workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_import(&read_only, source, request)?;
            }
            authorize_import(&ws.granted_policy(&self.plugin), source, request)?;
            ws.prepare_import()
        };
        let at = prepared.choose(source)?;
        let owner = prepared.owner(at).to_owned();
        let host = self.for_provider(owner.as_str(), self.mode);
        let outcome = if self.mode == InvokeMode::DryRun {
            let mut host = Guard::new(host, read_only);
            prepared.invoke(at, source, request, &mut host)
        } else {
            let mut host = host;
            prepared.invoke(at, source, request, &mut host)
        };
        outcome.map_err(|mut error| {
            // Il workspace si riprende solo per le parole, dopo l'import:
            // l'importer ha girato fuori dal prestito.
            if let Ok(ws) = self.workspace.read() {
                ws.localize_as(&owner, &mut error);
            }
            error
        })
    }
}
