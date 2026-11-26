//! Le viste dei provider: montaggio, resa, interessi e azioni.

use super::*;

/// Un render di [`ViewProvider`] risolto sotto lock e invocabile senza tenere
/// `Custody<Workspace>`. Il provider resta registrato tramite un `Arc`; il lock
/// qui è del solo provider, non del workspace, e consente render concorrenti.
pub struct PreparedViewRender {
    pub(super) owner: String,
    pub(super) view: String,
    pub(super) instance: ViewInstance,
    pub(super) trust: Trust,
    pub(super) provider: Arc<SharedShelter<Box<dyn ViewProvider>>>,
    pub(super) generation: Arc<()>,
}

impl PreparedViewRender {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn instance_id(&self) -> &str {
        &self.instance.instance
    }

    /// Esegue soltanto il codice esterno del provider. Le letture richieste dal
    /// provider passano dal proxy host e prendono il workspace per capacità.
    pub fn invoke(&self, host: &dyn ReadApi) -> std::result::Result<UiNode, PluginError> {
        let provider = self.provider.read();
        crate::safety::calling(&self.owner, Gate::ViewRender, &self.view, || {
            provider.render_view(&self.instance, host)
        })
    }
}

/// Interests di [`ViewProvider`] risolti sotto lock e invocabili senza tenere
/// una guardia di [`Workspace`]. Il provider resta registrato tramite un
/// `Arc`, mentre la consistenza della registrazione viene verificata in
/// `Workspace::finish_view_interests`.
pub struct PreparedViewInterests {
    pub(super) owner: String,
    pub(super) view: String,
    pub(super) instance: ViewInstance,
    pub(super) provider: Arc<SharedShelter<Box<dyn ViewProvider>>>,
    pub(super) generation: Arc<()>,
}

impl PreparedViewInterests {
    /// Esegue soltanto la callback esterna del provider.
    pub fn invoke(&self) -> std::result::Result<ViewInterests, PluginError> {
        let provider = self.provider.read();
        crate::safety::calling(&self.owner, Gate::ViewRender, &self.view, || {
            Ok(provider.interests(&self.instance))
        })
    }
}

/// Un'azione di [`ViewProvider`] risolta sotto lock e invocabile senza tenere
/// `Custody<Workspace>`. Il frame di provider resta logicamente aperto fino al
/// finalize, mentre l'esclusione sulla mutabilità riguarda il solo provider.
pub struct PreparedViewAction {
    pub(super) owner: String,
    pub(super) view: String,
    pub(super) instance: ViewInstance,
    pub(super) action: Option<UiAction>,
    pub(super) trust: Trust,
    pub(super) provider: Arc<SharedShelter<Box<dyn ViewProvider>>>,
    pub(super) generation: Arc<()>,
    pub(super) previous_provider_call: bool,
}

impl PreparedViewAction {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn instance_id(&self) -> &str {
        &self.instance.instance
    }

    /// Esegue soltanto il codice esterno. Il provider ha il proprio lock; il
    /// workspace viene ripreso dal proxy soltanto per la singola capacità che
    /// la callback usa.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let action = self
            .action
            .take()
            .expect("a prepared view action is invoked exactly once");
        let mut provider = self.provider.write();
        crate::safety::calling(&self.owner, Gate::ViewAction, &self.view, || {
            provider.on_action(&self.instance, action, host)
        })
    }
}

impl Workspace {
    // --- view dichiarative -------------------------------------------------

    /// Registra un [`ViewProvider`] sotto un id, dichiarando **quanto ci si
    /// fida** di ciò che produce.
    ///
    /// `id` è l'identità del provider, come per gli handler e gli indici:
    /// determina lo spazio dati che l'[`HostApi`] gli concede.
    pub fn register_view_provider(
        &mut self,
        plugin: impl Into<String>,
        provider: Box<dyn ViewProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared =
            PreparedRegistration::views(provider).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Registra un `ViewProvider` **sostituendo** chi possedeva gli stessi id
    /// di view.
    ///
    /// È la stessa disciplina delle rotte (decisione 0019) e del registro dei
    /// formati (decisione 0017), portata all'ultima famiglia che risolveva un
    /// id per tentativi: sostituire resta possibile, ma **si chiede per nome**
    /// invece di succedere a chi si registra per primo.
    pub fn replace_view_provider(
        &mut self,
        plugin: impl Into<String>,
        provider: Box<dyn ViewProvider>,
    ) -> std::result::Result<(), RegistryError> {
        self.mount_views(plugin.into(), provider, true)
    }

    pub(super) fn mount_views(
        &mut self,
        plugin: String,
        provider: Box<dyn ViewProvider>,
        replacing: bool,
    ) -> std::result::Result<(), RegistryError> {
        let specs = crate::providers::declared_specs(provider.as_ref());
        let ids: Vec<String> = specs.iter().map(|s| s.id.clone()).collect();
        // Il permesso **prima** di togliere chi c'era: una sostituzione ha due
        // effetti, e un rifiuto in mezzo lascerebbe il primo fatto e il secondo
        // no — cioè una view del core cancellata da chi non poteva nemmeno
        // nominarla, con in mano un errore che dice «non è registrato».
        // Il token nasce insieme all'entry: non c'è un contatore condiviso che
        // renda obsolete view estranee quando questa viene sostituita.
        let generation = Arc::new(());
        if replacing {
            self.providers
                .plugins
                .admit_replacing(&plugin, RegistrationKind::View, &ids)?;
            self.providers.plugins.forget(RegistrationKind::View, &ids);
            self.providers
                .views
                .retain(|v| !v.specs.iter().any(|s| ids.contains(&s.id)));
        } else {
            self.providers
                .plugins
                .admit(&plugin, RegistrationKind::View, &ids)?;
        }
        // Il grado di fiducia è quello del plugin: era un parametro di questa
        // sola registrazione, ed è la ragione per cui un `IndexProvider` di
        // terzi avrebbe ricevuto ogni documento del vault senza che nessuno gli
        // avesse dato un grado (§7.3).
        let trust = self.providers.plugins.trust_of(&plugin).unwrap_or_default();
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::View, &ids);
        self.providers.views.push(RegisteredView {
            id: plugin,
            specs,
            provider: Arc::new(SharedShelter::new(provider)),
            generation,
            trust,
        });
        Ok(())
    }

    /// Rilegge ciò che un provider dichiara: view e comandi.
    ///
    /// È l'altra metà di «le spec sono dato di registrazione»: il kernel tiene
    /// la verità, e chi cambia idea **lo dice**. Non è una capacità
    /// dell'[`HostApi`] e non attraversa il contratto, per la regola della
    /// decisione 0013 — una capacità entra quando la chiede un cliente vero, e
    /// oggi nessun provider cambia il proprio elenco a runtime. Il giorno che
    /// succederà (un plugin che registra una view per ogni database aperto) è un
    /// metodo additivo, e questa è la sua metà kernel già in piedi.
    ///
    /// **Cambiare idea non scavalca la regola dei nomi** (§7.4): i nomi nuovi
    /// passano dallo stesso varco della registrazione, e quelli che erano già
    /// suoi non sono una contesa con sé stesso. Era l'ultimo modo di aggirarla —
    /// registrarsi con un id ammissibile e poi dichiararne un altro — e valeva
    /// anche per l'inventario, che restava a raccontare la registrazione invece
    /// dello stato.
    ///
    /// Un rifiuto non cambia niente: le due famiglie si convalidano **prima**
    /// che l'una o l'altra si muova.
    pub fn refresh_specs(&mut self, id: &str) -> std::result::Result<(), RegistryError> {
        self.providers.refresh_specs(id)
    }

    /// Le view offerte dai provider registrati, in ordine di registrazione,
    /// **coi titoli risolti** nella lingua di chi guarda (§12.1).
    ///
    /// Le due maschere che escono di qui sono quelle dell'**esemplare unico**
    /// (§22.3): le risolve
    /// [`declared_specs`](crate::providers::declared_specs) al momento della
    /// registrazione, che è dove le spec si chiedono — una volta sola, come
    /// tutto il resto di ciò che un provider dichiara.
    pub fn views(&self) -> Vec<ViewSpec> {
        self.providers
            .view_specs_by_owner()
            .into_iter()
            .map(|(owner, mut spec)| {
                self.localize(&owner, &mut spec);
                spec
            })
            .collect()
    }

    /// Prepara il render di una view senza eseguire codice del provider.
    pub fn prepare_view_render(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<PreparedViewRender, PluginError> {
        let at = self.view_owner(&instance.view)?;
        let registered = &self.providers.views[at];
        self.check_params(at, instance)?;
        Ok(PreparedViewRender {
            owner: registered.id.clone(),
            view: instance.view.clone(),
            instance: instance.clone(),
            trust: registered.trust,
            provider: Arc::clone(&registered.provider),
            generation: Arc::clone(&registered.generation),
        })
    }

    /// Congela la view e i dati necessari a interrogare gli interessi senza
    /// eseguire codice esterno sotto la guardia del workspace.
    pub fn prepare_view_interests(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<PreparedViewInterests, PluginError> {
        let at = self.view_owner(&instance.view)?;
        let registered = &self.providers.views[at];
        self.check_params(at, instance)?;
        Ok(PreparedViewInterests {
            owner: registered.id.clone(),
            view: instance.view.clone(),
            instance: instance.clone(),
            provider: Arc::clone(&registered.provider),
            generation: Arc::clone(&registered.generation),
        })
    }

    /// Una callback preparata può terminare soltanto se la stessa entry
    /// possiede ancora la view. L'`Arc` distingue rimozione e nuova
    /// registrazione; il token di generazione distingue invece un refresh
    /// delle spec sullo stesso provider.
    pub(super) fn ensure_view_is_current(
        &self,
        owner: &str,
        view: &str,
        generation: &Arc<()>,
        provider: &Arc<SharedShelter<Box<dyn ViewProvider>>>,
    ) -> std::result::Result<(), PluginError> {
        let current = self.providers.views.iter().any(|registered| {
            registered.id == owner
                && Arc::ptr_eq(&registered.generation, generation)
                && Arc::ptr_eq(&registered.provider, provider)
                && registered.specs.iter().any(|spec| spec.id == view)
        });
        if current {
            Ok(())
        } else {
            Err(PluginError::Conflict(
                format!("la registrazione della view `{view}` è cambiata durante la callback")
                    .into(),
            ))
        }
    }

    /// Applica il confine di fiducia e la localizzazione dopo che il provider è
    /// tornato. Nessun codice del provider viene eseguito in questa fase.
    pub fn finish_view_render(
        &self,
        prepared: PreparedViewRender,
        outcome: std::result::Result<UiNode, PluginError>,
    ) -> std::result::Result<UiNode, PluginError> {
        let mut tree = outcome.map_err(|and| self.localized(&prepared.owner, and))?;
        self.ensure_view_is_current(
            &prepared.owner,
            &prepared.view,
            &prepared.generation,
            &prepared.provider,
        )?;
        guard_ui(prepared.trust, &tree)?;
        // **Dopo** la validazione del confine di fiducia, non prima: risolvere
        // una chiave non può trasformare un nodo innocuo in uno riservato — i
        // `Text` non diventano markup — ma l'ordine giusto è comunque quello che
        // non fa passare niente dal catalogo prima del controllo.
        self.localize(&prepared.owner, &mut tree);
        Ok(tree)
    }

    /// Conclude la callback degli interessi verificando che la registrazione
    /// fotografata sia ancora quella pubblicata.
    pub fn finish_view_interests(
        &self,
        prepared: PreparedViewInterests,
        outcome: std::result::Result<ViewInterests, PluginError>,
    ) -> std::result::Result<ViewInterests, PluginError> {
        let interests = outcome.map_err(|error| self.localized(&prepared.owner, error))?;
        self.ensure_view_is_current(
            &prepared.owner,
            &prepared.view,
            &prepared.generation,
            &prepared.provider,
        )?;
        Ok(interests)
    }

    /// Rende una view e restituisce il suo albero di UI.
    ///
    /// **È il punto di enforcement del confine di fiducia della UI.** Ogni
    /// albero che entra nell'host passa da qui, e da un provider non fidato le
    /// varianti con contenuto attivo (`Html`, `WebView`) vengono rifiutate a
    /// qualunque profondità. Oggi tutti i provider registrabili sono fidati e la
    /// validazione è un no-op: il punto esiste **prima** del primo non fidato,
    /// perché aggiungerlo dopo significherebbe cercarlo fra N chiamanti.
    ///
    /// Prende `&self`: il render è una **lettura**, e gira sotto prestito
    /// condiviso del workspace — è esattamente il carico che il futuro
    /// `RwLock` deve poter parallelizzare (N view che si ridisegnano non si
    /// mettono in coda dietro una scrittura). Ha anche un effetto di
    /// visibilità: il provider non viene estratto (`mem::take`) per la durata
    /// della chiamata, quindi durante il render vede il mondo intero — indici
    /// e view registrate compresi. La mutilazione del mondo osservabile resta
    /// confinata ai callback in scrittura (vedi il doc di `HostApi`).
    pub fn render_view(&self, instance: &ViewInstance) -> std::result::Result<UiNode, PluginError> {
        let prepared = self.prepare_view_render(instance)?;
        let owner = prepared.owner().to_string();
        let instance_id = prepared.instance_id().to_string();
        // Anche il percorso di lettura passa dal punto di applicazione: un
        // provider senza `read_vault` non legge il vault **mentre disegna** più
        // di quanto lo legga da un'azione. Che il guard qui avvolga un
        // `ReadHost` invece di un `KernelHost` non cambia niente per la
        // politica — è la stessa, e non sa cosa ci sia sotto.
        let host = self.read_host_for_view(&owner, Some(instance_id.as_str()));
        let outcome = prepared.invoke(&host);
        self.finish_view_render(prepared, outcome)
    }

    /// La dichiarazione di interesse di **un esemplare** (§22.3).
    ///
    /// A differenza dei campi omonimi della spec — dichiarati prima che un
    /// esemplare esistesse — questa la risponde il provider, che ha davanti i
    /// parametri con cui l'esemplare è stato aperto. Per l'esemplare unico la
    /// risposta è già dentro [`views`](Self::views); serve a chi ne apre uno
    /// **con parametri**, ed è il verso in cui il §22.3 continua.
    pub fn view_interests(
        &self,
        instance: &ViewInstance,
    ) -> std::result::Result<ViewInterests, PluginError> {
        let at = self.view_owner(&instance.view)?;
        self.check_params(at, instance)?;
        let registered = &self.providers.views[at];
        let provider = registered.provider.read();
        crate::safety::calling_callback(&registered.id, "ViewProvider::interests", || {
            Ok(provider.interests(instance))
        })
    }

    /// Prepara un'azione di view senza eseguire codice del provider. Il flag di
    /// provider-call viene aperto qui e chiuso in `finish_view_action`, così gli
    /// eventi prodotti dalla callback non possono rientrare nel suo frame.
    pub fn prepare_view_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
    ) -> std::result::Result<PreparedViewAction, PluginError> {
        let at = self.view_owner(&instance.view)?;
        self.check_params(at, instance)?;
        let (owner, trust, provider, generation) = {
            let registered = &self.providers.views[at];
            (
                registered.id.clone(),
                registered.trust,
                Arc::clone(&registered.provider),
                Arc::clone(&registered.generation),
            )
        };
        let previous_provider_call = self.dispatch.enter_provider_call();
        Ok(PreparedViewAction {
            owner,
            view: instance.view.clone(),
            instance: instance.clone(),
            action: Some(action),
            trust,
            provider,
            generation,
            previous_provider_call,
        })
    }

    /// Chiude il frame dell'azione senza consegnare eventi. Il valore opaco
    /// permette all'host di eseguire il drain dopo aver rilasciato il guard.
    pub fn finish_view_action_deferred(
        &mut self,
        prepared: PreparedViewAction,
        outcome: std::result::Result<ViewUpdate, PluginError>,
    ) -> DeferredEvents<std::result::Result<ViewUpdate, PluginError>> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let result = (|| {
            // Il proprietario è quello della view: un aggiornamento porta le
            // stringhe di chi l'ha scritto, come l'albero che sostituisce — e
            // come l'errore con cui, invece dell'aggiornamento, può rispondere.
            let mut update = outcome.map_err(|and| self.localized(&prepared.owner, and))?;
            self.ensure_view_is_current(
                &prepared.owner,
                &prepared.view,
                &prepared.generation,
                &prepared.provider,
            )?;
            // **Ogni** albero che l'aggiornamento porta con sé, non solo quello
            // di `Replace`: una `Patch` è un nodo che entra nella webview come
            // gli altri, ed è più piccola solo nella dimensione. Il `match` è
            // esaustivo di proposito — è la stessa lezione di
            // `UiNode::children`, che elencava a mano i contenitori che
            // c'erano: una variante nuova che portasse un nodo deve rompere la
            // compilazione qui, non passare in silenzio.
            let tree = match &update {
                ViewUpdate::Replace { root } => Some(root),
                ViewUpdate::Patch { node, .. } => Some(node),
                ViewUpdate::None
                | ViewUpdate::Navigate { .. }
                | ViewUpdate::Reveal { .. }
                | ViewUpdate::RunSearch { .. }
                | ViewUpdate::Custom { .. } => None,
            };
            if let Some(tree) = tree {
                guard_ui(prepared.trust, tree)?;
            }
            if let ViewUpdate::Custom { ns, .. } = &update {
                guard_intent(prepared.trust, ns)?;
            }
            self.localize(&prepared.owner, &mut update);
            Ok(update)
        })();
        DeferredEvents::outcome(result)
    }

    /// Chiude il frame aperto da `prepare_view_action` e riproduce l'epilogo
    /// del vecchio percorso: ripristino flag, errore localizzato, trust gate,
    /// localizzazione e soltanto alla fine consegna degli eventi accodati.
    pub fn finish_view_action(
        &mut self,
        prepared: PreparedViewAction,
        outcome: std::result::Result<ViewUpdate, PluginError>,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let deferred = self.finish_view_action_deferred(prepared, outcome);
        // Gli eventi accodati durante `on_action` arrivano ADESSO, dopo che la
        // chiamata del provider è tornata: è il contratto di consegna.
        self.dispatch_pending();
        self.finish_deferred_events(deferred)
    }

    /// Consegna un'azione della UI al provider della view e restituisce il suo
    /// aggiornamento. Ogni albero che l'aggiornamento porta con sé —
    /// [`ViewUpdate::Replace`] e [`ViewUpdate::Patch`] — passa dalla stessa
    /// validazione di [`render_view`](Workspace::render_view): un provider non
    /// fidato non può iniettare contenuto attivo *in risposta a un click*
    /// invece che al rendering, né per la via stretta invece che per quella
    /// larga.
    ///
    /// Compatibilità per i chiamanti diretti del kernel. L'host di processo usa
    /// le tre fasi separatamente, perché solo lui possiede `Custody<Workspace>`.
    pub fn view_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
    ) -> std::result::Result<ViewUpdate, PluginError> {
        let mut prepared = self.prepare_view_action(instance, action)?;
        let owner = prepared.owner().to_string();
        let instance_id = prepared.instance_id().to_string();
        let outcome = {
            let mut host = self.host_for_view(&owner, InvokeMode::Apply, Some(&instance_id));
            prepared.invoke(&mut host)
        };
        self.finish_view_action(prepared, outcome)
    }

    /// I parametri di questa istanza reggono la spec della sua view?
    ///
    /// È l'unico punto di convalida, e sta qui per la stessa ragione per cui ci
    /// stanno gli argomenti di un comando: uno schema che a farlo rispettare è
    /// chi lo pubblica non è uno schema, è un commento. Il provider riceve
    /// `params` già buoni e non deve difendersi da chi apre.
    pub(super) fn check_params(
        &self,
        at: usize,
        instance: &ViewInstance,
    ) -> std::result::Result<(), PluginError> {
        self.providers.check_params(at, instance)
    }

    /// Chi possiede una view, per posizione. `UnknownView` se nessuno.
    pub(super) fn view_owner(&self, view: &str) -> std::result::Result<usize, PluginError> {
        self.providers.view_owner(view)
    }
}
