//! Plugin: registrazione, servizi, disattivazione e chiusura del workspace.

use super::*;

/// Una chiamata a [`ServiceProvider`] preparata sotto lock e invocabile
/// senza tenere `Custody<Workspace>`.
pub struct PreparedService {
    pub(super) owner: String,
    pub(super) service: String,
    pub(super) method: String,
    pub(super) args: Option<serde_json::Value>,
    pub(super) provider: Arc<dyn ServiceProvider>,
    pub(super) previous_provider_call: bool,
}

impl PreparedService {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    /// Esegue soltanto il codice esterno. Stack e flag sono già stati impostati
    /// da `prepare_service_call` e verranno chiusi da `finish_service_call`.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        let args = self.args.take().ok_or_else(|| {
            PluginError::Internal(
                "una chiamata di servizio preparata è stata invocata due volte".into(),
            )
        })?;
        // La rete contro i panici sta **attorno alla chiamata del provider** e
        // a niente di più (§9.3): tutto ciò che viene dopo — la pila dei
        // servizi da svuotare, il dispatch da drenare, in
        // `finish_service_call` — è già scritto per girare sul ramo
        // dell'errore, e catturare più in alto lo salterebbe.
        crate::safety::calling(
            &self.owner,
            Gate::Service,
            &format!("{}.{}", self.service, self.method),
            || self.provider.call(&self.service, &self.method, args, host),
        )
    }
}

/// Un epilogo che ha già chiuso il frame dell'operazione ma deve ancora
/// consegnare gli eventi fuori da `Custody<Workspace>`.
///
/// Il valore resta opaco all'host: il kernel conserva qui anche lo stato che
/// va ripristinato *dopo* il drain (l'attore di un comando) e il journal che,
/// per una scrittura, deve restare nell'ordine storico
/// `indici -> eventi -> journal`.
pub struct DeferredEvents<T> {
    pub(super) outcome: T,
    pub(super) previous_actor: Option<Actor>,
    pub(super) journal: Option<JournalOp>,
}

/// Diritto monouso a completare una chiusura già annunciata.
///
/// [`Workspace::prepare_close`] alza la generazione terminale del workspace
/// (`closed`) e accoda `VaultClosed`; da quel momento nessun'altra prepare può
/// riuscire. Il token non è clonabile e i suoi campi sono privati: l'host lo
/// conserva mentre drena l'evento fuori da `Custody<Workspace>`, quindi lo
/// riconsegna una volta sola a [`Workspace::finish_close_with`]. Un nonce
/// process-local impedisce che venga accettato da un'altra istanza aperta sulla
/// stessa radice.
#[derive(Debug)]
pub struct PreparedClose {
    pub(super) root: String,
    pub(super) workspace_id: u64,
}

impl<T> DeferredEvents<T> {
    pub(super) fn outcome(outcome: T) -> Self {
        Self {
            outcome,
            previous_actor: None,
            journal: None,
        }
    }
}

impl Workspace {
    // --- il registro dei plugin (§7.3, §7.4, §7.6) --------------------------
    //
    // Chi registra qualcosa si **dichiara** prima. Non è burocrazia: è la sola
    // forma in cui l'host sa di chi siano le capacità che sta prestando, e in
    // cui un nome ha un proprietario invece di essere il primo arrivato.

    /// Dichiara un plugin: id, versione, versione di ABI, permessi, fiducia.
    ///
    /// Va **prima** di ogni `register_*` che nomini quell'id. Un id non
    /// dichiarato non è un plugin creato al volo: è un errore, e la ragione è
    /// la stessa per cui [`Trust::default`] è il grado più restrittivo fra
    /// quelli che girano — ciò che si ottiene dimenticandosi di dichiarare non
    /// può essere più di ciò che si ottiene dichiarando.
    ///
    /// Il [`Trust`] non sta nel manifest e non ci starà mai: è ciò che l'host
    /// pensa del plugin, non ciò che il plugin dice di sé.
    pub fn register_plugin(
        &mut self,
        manifest: PluginManifest,
        trust: Trust,
    ) -> std::result::Result<(), RegistryError> {
        // I servizi che offre sono nomi, e valgono la regola del §7.4: o è il
        // proprio id, o è dentro di esso.
        let owner = match trust {
            Trust::Core => fub_abi::rules::ids::Owner::Core,
            _ => fub_abi::rules::ids::Owner::Plugin(&manifest.id),
        };
        for service in &manifest.provides {
            fub_abi::rules::ids::check(service, owner).map_err(RegistryError::Namespace)?;
            if let Some(incumbent) = self.providers.plugins.provider_of(service) {
                return Err(RegistryError::Claimed {
                    kind: RegistrationKind::Service,
                    id: service.clone(),
                    incumbent: incumbent.to_string(),
                    challenger: manifest.id.clone(),
                });
            }
        }
        // E i requisiti devono essere **già offerti**: chi dipende da ciò che
        // non c'è non si dichiara affatto (§7.5). Ne segue che l'ordine di
        // dichiarazione dev'essere topologico, e a M5 è il caricatore a
        // ordinarlo — il kernel non riordina ciò che gli si passa, dice che non
        // sta in piedi.
        let missing = self.providers.plugins.missing_requirements(&manifest);
        if !missing.is_empty() {
            return Err(RegistryError::MissingRequirement {
                plugin: manifest.id.clone(),
                requires: missing,
            });
        }
        // E le **chiavi di impostazione** (§11.1), che sono nomi come i servizi
        // e valgono la stessa regola. Vanno dichiarate qui e non alla prima
        // lettura per la ragione che tiene lo schema nel manifest: il primo che
        // legge una chiave è l'`activate` del plugin che l'ha dichiarata, e
        // arriva **dopo** questa riga e prima di qualunque altra occasione.
        for spec in &manifest.settings {
            fub_abi::rules::ids::check(&spec.key, owner).map_err(RegistryError::Namespace)?;
        }
        // E i **nomi delle sveglie** (§22.1), che valgono la regola opposta:
        // nudi, come le chiavi di un catalogo di stringhe. Una sveglia vive
        // dentro il componente che l'ha dichiarata e nessun altro la può
        // nominare — la qualifica è strutturale, e a dire di chi è è
        // `TimerFired.owner`. Ciò che si verifica è quindi solo che il nome ci
        // sia e sia unico: due sveglie omonime dello stesso componente
        // sarebbero due eventi indistinguibili da chi li riceve.
        let mut seen = std::collections::BTreeSet::new();
        for timer in &manifest.timers {
            if timer.id.is_empty() || !seen.insert(timer.id.as_str()) {
                return Err(RegistryError::Timer {
                    plugin: manifest.id.clone(),
                    timer: timer.id.clone(),
                });
            }
        }
        let timers_declared = !manifest.timers.is_empty();
        let (id, specs) = (manifest.id.clone(), manifest.settings.clone());
        // La dichiarazione del plugin **prima** dello schema, e non per gusto
        // dell'ordine: se fosse al contrario, un id doppio lascerebbe dietro le
        // chiavi di un plugin che non è mai stato dichiarato — e a toglierle non
        // ci sarebbe nessuno, perché `deactivate_plugin` non conosce chi non è
        // mai entrato.
        self.providers.plugins.declare(manifest, trust)?;
        if let Err(why) = self
            .settings
            .write()
            .expect("store di configurazione")
            .declare(&id, &specs)
        {
            self.providers.plugins.retire(&id);
            return Err(RegistryError::Setting(why));
        }
        // E le chiavi con cui si **negano i suoi permessi** (§23.17). Sono
        // fabbricate qui e non dichiarate nel manifest per la ragione che le
        // rende utili: un componente non deve poter decidere se il proprio
        // recinto sia mostrabile. Vanno **dopo** lo schema suo, e ciò che ne
        // segue è la risposta giusta al caso brutto — un plugin che dichiarasse
        // di suo una chiave `<id>:permissions.…` fa fallire questa riga, e non
        // si monta affatto. Se l'ordine fosse rovesciato, a fallire sarebbe la
        // sua dichiarazione: stesso esito, ma il difetto verrebbe raccontato
        // come se fosse dell'host.
        let permissions = self.permission_specs(&id);
        let outcome = {
            let mut settings = self.settings.write().expect("store di configurazione");
            settings.declare(&id, &permissions).inspect_err(|_| {
                // E si **ritira il suo schema**, che è stato dichiarato una
                // riga più su e che `retire` non conosce. È il primo punto di
                // questa funzione che poteva lasciare qualcosa a metà: senza
                // questa riga le chiavi del manifest restavano nello store
                // attribuite a un plugin che non è registrato, e il secondo
                // tentativo con lo stesso id falliva **prima**, sul proprio
                // schema, con «già dichiarata da `<id>`» — cioè raccontando
                // come un difetto del manifest uno stato che aveva creato
                // l'host.
                settings.withdraw(&id);
            })
        };
        if let Err(why) = outcome {
            self.providers.plugins.retire(&id);
            return Err(RegistryError::Setting(why));
        }
        // E si applica **subito** ciò che l'utente aveva già negato: un vault
        // che si riapre non è un'occasione per ricominciare da capo.
        self.reapply_permissions(&id);
        // Se fra le chiavi appena dichiarate c'è la finestra del registro, il
        // registro si pota **adesso**: prima di questa riga quella chiave non si
        // poteva leggere, e il journal si era aperto col solo tetto. È l'altra
        // metà di `announce_setting` — la finestra vale da quando è dichiarata,
        // e da lì in poi a ogni cambiamento.
        if specs
            .iter()
            .any(|s| s.key == crate::journal::RETENTION_DAYS)
        {
            self.prunes_the_record();
        }
        if !timers_declared {
            return Ok(());
        }
        // Chi dorme non sa che è arrivata una sveglia (§22.1, decisione 0069).
        // Il pool aspetta senza scadenza finché nessuno dichiara timer — che è
        // la promessa fatta a chi non ne dichiara — quindi un componente montato
        // *dopo* che i thread si sono addormentati resterebbe senza sveglia fino
        // al primo job di qualcun altro. È la stessa mossa con cui `stop` sveglia
        // i dormienti: la campana non annuncia un job, annuncia che c'è da
        // ricontare.
        self.dispatch.bell().ring();
        Ok(())
    }

    /// Registra chi **offre** i servizi che il suo manifest dichiara (§7.5).
    ///
    /// I `ns` non si passano qui: sono già nel manifest, e sono già stati
    /// verificati alla dichiarazione. Registrare un provider per un plugin che
    /// non offre niente è un errore che nomina la dimenticanza — è quasi certo
    /// che manchi il `provides`, non che il provider sia di troppo.
    pub fn register_service_provider(
        &mut self,
        plugin: impl Into<String>,
        provider: Box<dyn ServiceProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let permit = self.registration_permit(&plugin)?;
        let provides = self.registration_services(&permit)?;
        let mut prepared = PreparedRegistration::service(provides, provider);
        self.commit_registration(&permit, &mut prepared)
    }

    /// Chiama un servizio offerto da un plugin (§7.5).
    ///
    /// Chi esegue gira con le **proprie** capacità: un servizio non presta i
    /// suoi permessi a chi lo chiama, e chi lo chiama non presta i propri a
    /// lui. È la differenza fra una superficie fra pari e una scala per
    /// scavalcare i permessi.
    ///
    /// Nessuno lo offre → [`PluginError::Unserved`], che è distinguibile da
    /// «chi lo offre ha fallito»: è la stessa distinzione del canale dati
    /// (decisione 0019), e serve a chi disegna per scegliere fra «installa il
    /// plugin» e «qualcosa è andato storto».
    pub fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        let mut prepared = self.prepare_service_call(service, method, args)?;
        let owner = prepared.owner().to_string();
        let outcome = {
            let mut host = self.host_for(&owner, InvokeMode::Apply);
            prepared.invoke(&mut host)
        };
        self.finish_service_call(prepared, outcome)
    }

    /// Risolve e apre il frame di una chiamata a servizio senza eseguire codice
    /// esterno. Chi riceve il valore deve sempre riconsegnarlo a
    /// [`finish_service_call`](Self::finish_service_call).
    pub fn prepare_service_call(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> std::result::Result<PreparedService, PluginError> {
        let owner = self
            .providers
            .plugins
            .provider_of(service)
            .ok_or_else(|| {
                PluginError::Unserved(format!("nessun plugin offre il servizio `{service}`").into())
            })?
            .to_string();
        let at = self
            .providers
            .services
            .position(|(id, _)| *id == owner)
            .ok_or_else(|| {
                PluginError::Unserved(
                    format!("`{owner}` dichiara `{service}` e non ha registrato chi lo serve")
                        .into(),
                )
            })?;

        // Il giro. Come per i comandi (decisione 0013), un servizio che rientra
        // su sé stesso non è una profondità da limitare con un numero: è un
        // errore di chi lo ha scritto, e l'unica risposta utile lo nomina.
        if self.providers.service_stack.iter().any(|s| s == service) {
            let mut round = self.providers.service_stack.clone();
            round.push(service.to_string());
            return Err(PluginError::BadArgs(
                format!(
                    "un servizio non può chiamare sé stesso: {}",
                    round.join(" → ")
                )
                .into(),
            ));
        }

        let provider = Arc::clone(&self.providers.services[at].1);
        self.providers.service_stack.push(service.to_string());
        let previous_provider_call = self.dispatch.enter_provider_call();
        Ok(PreparedService {
            owner,
            service: service.to_string(),
            method: method.to_string(),
            args: Some(args),
            provider,
            previous_provider_call,
        })
    }

    /// Chiude flag e stack senza consegnare eventi. L'host usa questa forma per
    /// rilasciare `Custody<Workspace>` prima degli [`EventHandler`].
    pub fn finish_service_call_deferred(
        &mut self,
        prepared: PreparedService,
        outcome: std::result::Result<serde_json::Value, PluginError>,
    ) -> DeferredEvents<std::result::Result<serde_json::Value, PluginError>> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let popped = self.providers.service_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.service.as_str()));
        DeferredEvents::outcome(outcome)
    }

    /// Chiude il frame aperto da [`prepare_service_call`](Self::prepare_service_call)
    /// nello stesso ordine del vecchio percorso sincrono: flag, stack, dispatch.
    pub fn finish_service_call(
        &mut self,
        prepared: PreparedService,
        outcome: std::result::Result<serde_json::Value, PluginError>,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        let deferred = self.finish_service_call_deferred(prepared, outcome);
        self.dispatch_pending();
        self.finish_deferred_events(deferred)
    }

    /// Dichiara una **feature ufficiale** di questo repo: [`Trust::Core`] e i
    /// permessi di
    /// [`PluginPermissions::core`](fub_abi::traits::PluginPermissions::core).
    ///
    /// È zucchero su [`register_plugin`](Workspace::register_plugin) e non un
    /// secondo percorso: passa dallo stesso registro, con lo stesso manifest,
    /// e prende gli stessi rifiuti. Se fosse un percorso privilegiato, il §7.3
    /// sarebbe applicato solo a chi non esiste ancora.
    pub fn register_core_feature(
        &mut self,
        id: &str,
        name: &str,
    ) -> std::result::Result<(), RegistryError> {
        self.register_plugin(PluginManifest::core(id, name), Trust::Core)
    }

    /// **Spegne un plugin**: chiude i suoi indici, toglie tutto ciò che ha
    /// registrato, e ritira la sua dichiarazione (§9.4).
    ///
    /// È l'inverso esatto della strada di registrazione, e prima non c'era:
    /// `register_*` faceva `push` e basta, quindi "spento" poteva voler dire
    /// una cosa sola — *non registrato all'avvio*, deciso da una variabile
    /// d'ambiente (D7). Con le impostazioni del §11.1 la decisione si prende a
    /// runtime, e senza un modo di togliere un provider quella parola non
    /// significherebbe più niente.
    ///
    /// # Cosa succede, nell'ordine
    ///
    /// 1. **Gli indici**: `flush` e poi `close` (decisione 0028), ognuno con
    ///    l'host intestato a sé — è il loro ultimo momento per rendere durevole
    ///    ciò che hanno e lasciare andare ciò che tengono. Le loro rotte
    ///    spariscono dalla tabella: chi le chiede riceve `Unserved`, non la
    ///    risposta di chi gli stava dietro nell'elenco.
    /// 2. **Gli altri provider** — handler, view, comandi, servizi, import,
    ///    export, regole sintattiche, renderer — che non hanno un momento di
    ///    chiusura perché non tengono niente: il punto in cui un bundle libera
    ///    ciò che possiede è `Plugin::deactivate`, e lo chiama chi possiede il
    ///    bundle — il `BundleRegistry` di `fub-host`
    ///    ([decisione 0031](../../../docs/decisions/0183-composizione-host-kernel.md)),
    ///    non il kernel. Lo chiama **prima** di questa funzione, che è l'unico
    ///    momento in cui il bundle è ancora intero: dopo, l'host intestato a
    ///    quell'id nega tutto, perché la dichiarazione non c'è più.
    /// 3. **La dichiarazione**, che sparisce dall'inventario del §7.6.
    ///
    /// Gli errori tornano al chiamante e **non fermano niente**: chi smette
    /// smette comunque, e un `close` fallito non è una ragione per lasciare
    /// mezzo plugin registrato. È la stessa regola di
    /// [`flush_indexes`](Workspace::flush_indexes).
    ///
    /// # Da dentro una chiamata di provider non si può
    ///
    /// [`RegistryError::Busy`], e non è prudenza: lì i provider sono **in
    /// prestito** (§7.2), la loro tabella è vuota, e una rimozione calcolata su
    /// una tabella vuota toglie zero e vede tornare tutti. Chi lo riceve
    /// richiede a chiamata tornata.
    pub fn deactivate_plugin(
        &mut self,
        plugin: &str,
    ) -> std::result::Result<Vec<PluginError>, RegistryError> {
        if self.providers.plugins.get(plugin).is_none() {
            return Err(RegistryError::UnknownPlugin(plugin.to_string()));
        }
        if self.dispatch.in_provider_call() || self.reads_in_flight.busy(plugin) {
            return Err(RegistryError::Busy(plugin.to_string()));
        }

        // Percorso sincrono legacy: chi arriva a close ha già ricevuto il flush.
        let mut prepared = self.prepare_plugin_teardown(plugin)?;
        self.take_plugin_teardown_indexes(&mut prepared)
            .map_err(RegistryError::Activate)?;
        let mut errors = prepared.invoke_grids();
        {
            let mut host = self.host_for(plugin, InvokeMode::Apply);
            errors.extend(prepared.invoke_indexes(&mut host));
        }
        let outcome = self
            .finish_plugin_teardown(prepared, errors)
            .map(RetiredPlugin::dispose)
            .map_err(|failure| RegistryError::Activate(failure.error));
        self.dispatch_pending();
        outcome
    }

    /// Ritira soltanto registrazioni e dichiarazione, dopo le callback.
    pub(super) fn retire_plugin(
        &mut self,
        plugin: &str,
        removed_indexes: bool,
    ) -> lifecycle::RetiredResources {
        let mut retired = lifecycle::RetiredResources::default();
        retired.take("event handler", &mut self.providers.handlers, |(id, _)| {
            id == plugin
        });
        retired.take("view", &mut self.providers.views, |v| v.id == plugin);
        retired.take("command", &mut self.providers.commands, |c| c.id == plugin);
        retired.take("service", &mut self.providers.services, |(id, _)| {
            id == plugin
        });
        retired.take("import", &mut self.providers.imports, |(id, _)| {
            id == plugin
        });
        retired.take("export", &mut self.providers.exports, |(id, _)| {
            id == plugin
        });
        let (retiring, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.before_write)
            .into_iter()
            .partition(|(owner, _)| owner == plugin);
        self.before_write = kept;
        for hook in retiring {
            retired.push("before-write hook", hook);
        }

        // Regole sintattiche e renderer hanno registri propri che conoscono
        // l'id della regola, non quello dell'owner. L'inventario conserva
        // l'associazione e fornisce i nomi da ritirare.
        let mut syntax_changed = false;
        for id in self
            .providers
            .plugins
            .ids_of(plugin, RegistrationKind::Syntax)
        {
            if let Some(rule) = self.docs.syntax.take(&id) {
                syntax_changed = true;
                retired.push("syntax rule", rule);
            }
        }
        let mut renderer_changed = false;
        for id in self
            .providers
            .plugins
            .ids_of(plugin, RegistrationKind::Renderer)
        {
            if let Some(renderer) = self.docs.renderers.take(&id) {
                renderer_changed = true;
                retired.push("custom renderer", renderer);
            }
        }
        if syntax_changed {
            self.syntax_generation = self.syntax_generation.wrapping_add(1);
        }
        if syntax_changed || renderer_changed {
            self.projection_generation = self.projection_generation.wrapping_add(1);
        }

        self.providers.plugins.retire(plugin);
        // Lo schema delle impostazioni se ne va con l'owner: le sue chiavi non
        // sono più accessibili, ma i valori restano per la prossima attivazione.
        self.settings
            .write()
            .expect("store di configurazione")
            .withdraw(plugin);

        // I job ancora accodati non partiranno: il loro Plugin::run_job non
        // esiste più. Ognuno riceve comunque un esito terminale (§9.2).
        for job in self.dispatch.take_jobs_of(plugin) {
            self.complete_job(
                job.id,
                job.spec.job.clone(),
                Err(PluginError::Internal(
                    format!(
                        "`{plugin}` è stato disattivato prima che il job `{}` partisse",
                        job.spec.job
                    )
                    .into(),
                )),
            );
        }

        // Le query degli indici sono cambiate: il kernel annuncia il ritiro
        // ai consumer, dopo la restituzione dalle callback (decisione 0012).
        if removed_indexes {
            self.as_actor(Actor::Kernel, |ws| {
                ws.emit_event(Event::IndexUpdated);
                ws.dispatch_pending();
            });
        }
        retired
    }

    /// Chiude il vault: punto di consistenza globale, poi teardown (§9.5).
    ///
    /// È il gemello di [`reindex`](Workspace::reindex), che è l'apertura, e
    /// prima non esisteva: `flush_indexes` aveva **un solo chiamante in
    /// produzione**, il callback del watcher, quindi la durabilità di un indice
    /// dipendeva da un componente **opzionale**. Dove il watcher non c'è — un
    /// network share, una cartella cloud, la CLI, un e2e headless, PWA e mobile
    /// — le scritture di un indice non diventavano mai durevoli, e il sintomo
    /// era solo una riapertura lenta: nessuno se ne accorgeva finché non
    /// contava.
    ///
    /// # L'ordine, e perché è quello
    ///
    /// 1. **[`Event::VaultClosed`]**, con la coda drenata subito dopo. È
    ///    l'ultimo momento in cui il vault è ancora quello di prima: chi lo
    ///    riceve è ancora registrato, ha ancora l'`HostApi` e può ancora
    ///    scrivere. Emetterlo dopo aver spento qualcuno sarebbe stato
    ///    annunciare una chiusura a chi non c'è più.
    /// 2. **Un flush di tutti gli indici**, che è il punto di consistenza che
    ///    non è il watcher. Prima delle disattivazioni, e non dentro: ciò che
    ///    l'evento ha fatto scrivere agli handler dev'essere già indicizzato
    ///    quando il primo indice si chiude.
    /// 3. **Ogni plugin, in ordine inverso di dichiarazione** — `flush` e
    ///    `close` sui suoi indici, via tutto il resto
    ///    ([decisione 0028](../../../docs/decisions/0183-composizione-host-kernel.md)).
    ///    All'inverso perché è l'ordine in cui si smontano le cose che si sono
    ///    montate in ordine: chi è arrivato per ultimo può dipendere da chi
    ///    c'era già (§7.5), mai il contrario.
    ///
    /// Gli errori non fermano niente e tornano tutti insieme: una chiusura che
    /// si interrompesse a metà lascerebbe il resto aperto, che è il caso che
    /// questa funzione esiste per non produrre. È la stessa regola di
    /// [`flush_indexes`](Workspace::flush_indexes) — chi ha un canale per dirlo
    /// li mostra.
    ///
    /// Chiuderlo due volte non fa niente: la seconda chiamata rende una lista
    /// vuota senza emettere un secondo `VaultClosed`.
    ///
    /// **L'indice del kernel non riceve `close`**, e non è una dimenticanza: non
    /// persiste niente per conto proprio (la sua verità è il vault, e la
    /// ricostruisce all'apertura), non ha uno spazio dati, e non potrebbe
    /// riceverlo senza uscire da sé stesso — l'host che gli si presterebbe è
    /// costruito sul workspace che lo contiene.
    pub fn close(&mut self) -> Vec<PluginError> {
        self.close_with(|_, _| Vec::new())
    }

    /// Annuncia una chiusura senza chiamare alcun provider.
    ///
    /// `closed` è la versione che invalida un secondo tentativo: una volta
    /// prodotto il token, lo stesso workspace non può essere preparato di
    /// nuovo. Le scritture compiute da un handler di `VaultClosed` sono invece
    /// compatibili e intenzionali: chi monta dietro `Custody` conserva il
    /// writer turn, drena gli handler senza guardie e le include nel flush che
    /// segue. La sostituzione concorrente di un provider non può attraversare
    /// quel turno; il token, monouso, impedisce la doppia finalizzazione.
    pub fn prepare_close(&mut self) -> Option<PreparedClose> {
        if self.closed {
            return None;
        }
        self.closed = true;
        self.resource_readers_vault.acquire().take();

        let root = self.docs.vault.root().to_string();
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::VaultClosed { root: root.clone() });
        });
        Some(PreparedClose {
            root,
            workspace_id: self.workspace_id,
        })
    }

    /// [`close`](Workspace::close), con **un passo in più su ogni plugin**:
    /// `stopping` gira su ciascuno subito prima che il kernel lo disattivi, ed è
    /// il posto in cui chi possiede i bundle chiama
    /// [`Plugin::deactivate`](fub_abi::traits::Plugin::deactivate) (§9.3).
    ///
    /// Esiste perché quel passo **non può stare né prima né dopo**. Il kernel
    /// non possiede i `Box<dyn Plugin>` — li possiede il registry, che vive in
    /// `fub-host` — quindi chiuderli non è cosa sua; e chi li possiede non può
    /// farlo fuori da qui, perché prima di questa funzione il vault non ha
    /// ancora avuto il suo [`Event::VaultClosed`] e dopo non c'è più nessuno a
    /// cui dirlo: [`deactivate_plugin`](Workspace::deactivate_plugin) ritira la
    /// dichiarazione, e da lì in poi un host intestato a quell'id nega tutto.
    ///
    /// L'ordine è quindi, per ogni plugin e a rovescio della dichiarazione:
    /// **`stopping` mentre il bundle è ancora intero** — provider registrati,
    /// capacità vive — e poi il kernel che gli toglie tutto. È la stessa forma
    /// del punto 1 qui sopra: si dice a chi c'è ancora.
    ///
    /// Gli errori di `stopping` si accodano agli altri e non fermano niente,
    /// come tutto il resto della chiusura.
    pub fn close_with(
        &mut self,
        stopping: impl FnMut(&mut Workspace, &str) -> Vec<PluginError>,
    ) -> Vec<PluginError> {
        let Some(prepared) = self.prepare_close() else {
            return Vec::new();
        };
        self.dispatch_pending();
        match self.finish_close_with(prepared, stopping) {
            Ok(errors) => errors,
            Err((_prepared, error)) => vec![error],
        }
    }

    /// Completa una chiusura preparata dopo che `VaultClosed` è stato drenato.
    ///
    /// Il metodo non riemette il terminale e consuma il token. L'identità
    /// process-local valida il token anche se due istanze hanno la **stessa**
    /// radice; un mismatch restituisce token ed errore senza toccare il
    /// workspace, così il chiamante può riconsegnarlo al proprietario giusto.
    /// Nel percorso host il writer turn tenuto fra prepare e finalize esclude
    /// inoltre qualsiasi writer concorrente.
    ///
    /// Questo confine riguarda soltanto gli `EventHandler` del terminale:
    /// `flush_indexes`, `IndexProvider::close`, `stopping` e la disattivazione
    /// restano il seguito sincrono preesistente e richiedono ciascuno la
    /// propria migrazione prima che l'intera lifecycle possa dirsi staccata.
    pub fn finish_close_with(
        &mut self,
        prepared: PreparedClose,
        mut stopping: impl FnMut(&mut Workspace, &str) -> Vec<PluginError>,
    ) -> std::result::Result<Vec<PluginError>, (PreparedClose, PluginError)> {
        if prepared.workspace_id != self.workspace_id || !self.closed {
            let error = PluginError::Conflict(
                format!(
                    "close prepared by workspace {} on `{}` cannot finalize workspace {} on `{}`",
                    prepared.workspace_id,
                    prepared.root,
                    self.workspace_id,
                    self.docs.vault.root()
                )
                .into(),
            );
            return Err((prepared, error));
        }

        let mut errors = self.flush_indexes();

        let plugins: Vec<String> = self
            .providers
            .plugins
            .iter()
            .map(|and| and.manifest.id.clone())
            .rev()
            .collect();
        for id in plugins {
            errors.extend(stopping(self, &id));
            match self.deactivate_plugin(&id) {
                Ok(errs) => errors.extend(errs),
                // Un `Busy` qui vorrebbe dire che si sta chiudendo il vault da
                // dentro la chiamata di un provider, cioè che chi chiude è
                // qualcuno che il vault lo sta usando. Non fa danno e va detto.
                Err(and) => errors.push(PluginError::Internal(and.to_string().into())),
            }
        }

        // **L'anagrafe si scrive qui**, ed è l'ultima riga della chiusura: è
        // l'ultimo momento in cui qualcuno sa che sta chiudendo (§9.5). Fra
        // l'apertura e questa riga `touch_entry` ha aggiornato la sola memoria
        // — cinque siti: un salvataggio, una scrittura vista dal rilevatore, il
        // cestino, il ripristino, la rinomina — e senza questa riga tutto ciò
        // che si è toccato dopo l'apertura veniva riletto e riparsato alla
        // riapertura, cioè il lavoro che l'anagrafe esiste per evitare.
        //
        // **Non copre il processo ucciso**, e non deve: chi muore senza passare
        // di qui ricade su ciò che c'era prima — l'anagrafe di fine apertura,
        // che rilegge i soli documenti toccati dopo. È il degrado di un
        // derivato, non una perdita, quindi qui non si baratta niente: questa
        // riga toglie del lavoro nel caso normale e non ne aggiunge in nessuno.
        //
        // **Ultima, e non a metà** (difetto 0190). Dove esattamente cada non è
        // una preferenza, perché i due stati a metà che un'interruzione può
        // lasciare non si equivalgono: l'anagrafe è ciò che alla riapertura
        // *risparmia* il lavoro — una voce la cui impronta combacia col disco
        // non si rilegge, non si riparsa e non torna agli indici, si riprende
        // dalla cache —, quindi scriverla prima che gli indici abbiano finito
        // vuol dire lasciare, per tutto il resto della chiusura, un disco che
        // dichiara indicizzato ciò che nessun indice ha ancora scritto. Chi
        // muore lì dentro riapre un vault in cui quelle note esistono, si
        // aprono e si leggono, e dalla ricerca sono sparite in silenzio finché
        // qualcuno non chiede una ricostruzione. Il verso opposto — indici
        // scritti e anagrafe no — è il degrado del capoverso qui sopra: si
        // rilegge, e non si perde niente. Fra i due si sceglie quello che costa
        // lavoro invece di quello che costa verità.
        //
        // «Gli indici hanno finito» è più tardi di quanto sembri, ed è la parte
        // che stava storta: non basta [`flush_indexes`](Workspace::flush_indexes),
        // perché la disattivazione qui sopra dà a ogni indice un altro `flush` e
        // poi il suo `close` — è il contratto (decisione 0028) —, e `stopping`
        // in mezzo può far scrivere ancora. L'ordine che
        // [`finish_index`](Workspace::finish_index) teneva già è lo stesso letto
        // in una funzione più lunga: **l'anagrafe per ultima**, quando non c'è
        // più nessuno che possa scrivere dopo di lei.
        self.store_entries();

        Ok(errors)
    }

    /// Ordine terminale di una chiusura valida, senza chiamate ai provider.
    pub fn closing_plugins(
        &self,
        prepared: &PreparedClose,
    ) -> std::result::Result<Vec<String>, PluginError> {
        if prepared.workspace_id != self.workspace_id || !self.closed {
            return Err(PluginError::Conflict("stale workspace close".into()));
        }
        Ok(self
            .providers
            .plugins
            .iter()
            .rev()
            .map(|entry| entry.manifest.id.clone())
            .collect())
    }

    /// Ultimo passo della chiusura staccata: nessun plugin può scrivere dopo
    /// l'anagrafe. Un token errato torna al proprietario senza mutazioni.
    pub fn finish_detached_close(
        &mut self,
        prepared: PreparedClose,
    ) -> std::result::Result<(), (PreparedClose, PluginError)> {
        if let Err(error) = self.closing_plugins(&prepared) {
            return Err((prepared, error));
        }
        if self.providers.plugins.iter().next().is_some() {
            return Err((
                prepared,
                PluginError::Conflict("cannot finish close while plugins remain declared".into()),
            ));
        }
        self.store_entries();
        Ok(())
    }

    /// Il vault è già stato chiuso?
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// La bandiera del **rilevamento delle modifiche esterne** (§9.7), da dare a
    /// chi tiene vivo un rilevatore.
    ///
    /// È l'unico modo che il kernel ha di sapere una cosa che non gli
    /// appartiene: il watcher vive in `fub-host`, il kernel non sa cosa sia, e
    /// però è il kernel che deve **rispondere**
    /// ([`IndexQuery::VaultStatus`]),
    /// perché è l'unico che conosce anche l'altra metà della risposta — quante
    /// sincronizzazioni sono fallite.
    ///
    /// Una bandiera **condivisa** e non un valore copiato, perché la copia
    /// sarebbe una seconda verità: chi monta la alzerebbe all'avvio e nessuno la
    /// abbasserebbe quando il rilevatore muore. Chi la tiene la abbassa — quando
    /// fallisce e quando smette — e la risposta del kernel cambia da sé.
    pub fn watch_flag(&self) -> Arc<AtomicBool> {
        self.indexes.core.watch.watching.clone()
    }

    /// Riserva all'host gli id dei comandi che esegue in proprio, fuori dal
    /// registro. Lo chiama chi monta, una volta, prima dei provider: da qui in
    /// poi un plugin che li invoca riceve [`PluginError::Unserved`] invece di
    /// un `UnknownCommand` che non spiega, e un provider che ne dichiara un
    /// omonimo è rifiutato come davanti a un id già rivendicato.
    pub fn reserve_host_commands(
        &mut self,
        ids: &[&str],
    ) -> std::result::Result<(), RegistryError> {
        for (owner, spec) in self.providers.command_specs_by_owner() {
            if ids.contains(&spec.id.as_str()) {
                return Err(RegistryError::Claimed {
                    kind: RegistrationKind::Command,
                    id: spec.id,
                    incumbent: owner,
                    challenger: crate::providers::HOST_OWNER.to_string(),
                });
            }
        }
        self.providers
            .host_commands
            .extend(ids.iter().map(|id| (*id).to_string()));
        Ok(())
    }

    /// L'orologio del vault al posto di quello di sistema: il registro, il
    /// cestino, le bozze, i job e l'`HostEnv` dei plugin leggono questo. Lo
    /// chiama chi monta, prima che qualcuno scriva.
    pub fn with_clock(mut self, clock: Arc<dyn crate::time::Clock>) -> Self {
        self.docs.set_clock(Arc::clone(&clock));
        self.journal = Arc::new(self.journal.with_clock(Arc::clone(&clock)));
        self.clock = clock;
        self
    }

    /// Adesso, sull'orologio del vault.
    pub fn now_unix_millis(&self) -> u64 {
        self.clock.now_unix_millis()
    }

    /// Monta il filo verso fuori (§23.3). Lo chiama chi monta, una volta.
    pub fn set_network(&mut self, client: Arc<dyn fub_abi::traits::HostNetwork>) {
        self.network = Some(client);
    }

    /// Il client di rete montato, se c'è.
    ///
    /// È pubblico perché serve a chi esegue un **job**: la richiesta si fa
    /// fuori dal prestito, quindi il client si prende di qui e il permesso da
    /// [`Workspace::granted`].
    pub fn network(&self) -> Option<Arc<dyn fub_abi::traits::HostNetwork>> {
        self.network.clone()
    }

    /// La politica di un plugin, così com'è **adesso**.
    ///
    /// Serve allo stesso caso, e la parola *adesso* è tutta la ragione per cui
    /// non la si cattura all'avvio di un job: un plugin revocato mentre una sua
    /// richiesta è in volo deve trovare il cancello chiuso alla successiva, non
    /// alla fine del job.
    pub fn granted_policy(&self, plugin: &str) -> crate::host::Granted {
        self.providers.plugins.granted(plugin)
    }

    /// Questo plugin può nominare questo id? La regola del §7.4, per chi non
    /// passa da una registrazione.
    ///
    /// Serve al topic di un [`Event::Custom`], che è l'unico nome del contratto
    /// senza un momento di registrazione in cui verificarlo: si controlla
    /// quando lo si emette.
    pub(crate) fn owns_name(
        &self,
        plugin: &str,
        id: &str,
    ) -> std::result::Result<(), fub_abi::rules::ids::IdFault> {
        self.providers.owns_name(plugin, id)
    }

    /// L'inventario di ciò che è **attivo** (§7.6): chi è registrato, con quale
    /// manifest, quale fiducia, quali permessi, e cosa ha registrato.
    ///
    /// È ciò che fa sparire `VaultInfo.versioning: bool` — un booleano per
    /// feature dentro un record IPC, che con i moduli del 21.2 sarebbero
    /// diventati venti booleani, ognuno una modifica al record, al mirror e
    /// alla fixture.
    pub fn plugins(&self) -> Vec<PluginInfo> {
        self.providers.inventory()
    }

    /// Il grado di fiducia di un plugin dichiarato.
    pub fn trust_of(&self, plugin: &str) -> Option<Trust> {
        self.providers.trust_of(plugin)
    }
}
