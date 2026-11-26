//! Plugin accesi, scorciatoie, impostazioni e profili, impostazioni della macchina.

use super::*;

impl Host {
    /// **Accende o spegne un componente**, adesso e per i prossimi avvii.
    ///
    /// Due cose, e nessuna delle due basta da sola: il montaggio (o lo
    /// smontaggio) *adesso* — che è `BundleRegistry`, ed è host-side per
    /// costruzione ([decisione 0031](../../../docs/decisions/0183-composizione-host-kernel.md):
    /// l'`HostApi` non ha capacità di registrazione, quindi un plugin non può
    /// montarsi da sé — e la riga scritta in `plugins.disabled`, che è ciò che
    /// mancava al §11.1: «dove stare scritto fra un avvio e l'altro».
    ///
    /// Passa da qui e non da un comando del registro per la stessa ragione:
    /// un comando gira dentro il kernel con un `HostApi`, e da lì il registry
    /// dei bundle non si vede nemmeno. Ed è anche giusto che sia così — chi
    /// accende e spegne un componente è **l'utente**, non un programma, e questa
    /// è la porta da cui passa l'utente (`plugins.disabled` non si è dichiarata
    /// scrivibile da un programma, apposta).
    ///
    /// **Ciò che torna sono gli errori dello spegnimento interi**, non le frasi
    /// che li descrivono: spegnere non si annulla perché un `deactivate` è
    /// andato storto, e chi riceve l'elenco deve poterci ramificare sopra. Una
    /// `String` qui avrebbe fatto la stessa figura sullo schermo e tolto il
    /// `kind` ([decisione 0041](../../../docs/decisions/0192-impostazioni-locale-e-temi.md))
    /// a un passo dal confine che quel tipo lo sa attraversare da sé — che è
    /// come lo restituisce già [`Host::close_vault`], ed è la stessa lista.
    pub fn set_plugin_enabled(
        &self,
        vault: Option<&str>,
        id: &str,
        enabled: bool,
    ) -> Result<Vec<PluginError>, PluginError> {
        if id == crate::settings::CORE_ID {
            return Err(PluginError::BadArgs(
                format!("`{id}` non si spegne: è chi tiene l'elenco di ciò che è spento").into(),
            ));
        }
        if !enabled {
            // Il permesso di shutdown è posseduto, quindi anche il guard della
            // mappa sessioni termina prima della callback del plugin.
            let (workspace, registry, _shutdown) = self.in_session(vault, |session| {
                if session.registry.read()?.is_claimed(id) {
                    return Err(PluginError::BadArgs(
                        format!("`{id}` appartiene a una sorgente runtime.").into(),
                    ));
                }
                Ok((
                    session.workspace.clone(),
                    session.registry.clone(),
                    session.runner.shutdown_bundle(id),
                ))
            })?;
            let _workspace_turn = workspace.write_turn();
            let _registry_turn = registry.write_turn();
            if registry.read()?.is_claimed(id) {
                return Err(PluginError::BadArgs(
                    format!("`{id}` appartiene a una sorgente runtime.").into(),
                ));
            }
            let (deferred, persisted) = {
                let mut ws = workspace.write()?;
                let deferred = ws.defer_event_dispatch();
                let mut disabled = crate::settings::disabled_plugins(&ws);
                disabled.retain(|other| other != id);
                disabled.push(id.to_string());
                disabled.sort();
                let persisted = ws.set_setting(
                    crate::settings::PLUGINS_DISABLED,
                    fub_abi::settings::SettingValue::List(disabled),
                );
                (deferred, persisted)
            };
            // Il teardown tratta come no-op soltanto l'`UnknownPlugin` del
            // kernel quando il registry conosce ancora il bundle ma non ne ha
            // alcun corpo: un corpo residuo o un id sconosciuto resta un errore.
            let outcome =
                persisted.and_then(|()| crate::teardown::unmount(&workspace, &registry, id));
            workspace.write()?.restore_event_dispatch(deferred);
            drain_events(&workspace)?;
            return outcome;
        }
        // La preferenza nativa e il mount condividono i writer turn, ma nessuna
        // callback attraversa il prestito della mappa sessioni.
        let (workspace, registry) = self.in_session(vault, |session| {
            Ok((session.workspace.clone(), session.registry.clone()))
        })?;
        let _workspace_turn = workspace.write_turn();
        let _registry_turn = registry.write_turn();
        {
            let registry = registry.read()?;
            if registry.is_claimed(id) {
                return Err(PluginError::BadArgs(
                    format!("`{id}` appartiene a una sorgente runtime.").into(),
                ));
            }
            if !registry.knows(id) {
                return Err(crate::registry::BundleError::Unknown(id.to_string()).into());
            }
        }

        with_event_drain(&workspace, |ws| {
            let mut disabled = crate::settings::disabled_plugins(ws);
            disabled.retain(|other| other != id);
            disabled.sort();
            ws.set_setting(
                crate::settings::PLUGINS_DISABLED,
                fub_abi::settings::SettingValue::List(disabled),
            )?;
            Ok::<_, PluginError>(())
        })??;

        BundleRegistry::enable_guarded(&registry, &workspace, id).map_err(PluginError::from)?;
        Ok(Vec::new())
    }

    // --- i tasti che un vault propone (§23.13) -----------------------------

    /// Le scorciatoie che questo vault propone e che nessuno ha ancora
    /// guardato: chiave d'impostazione → accordo.
    ///
    /// Torna la **chiave** e non l'id del comando, e non è pigrizia: chi disegna
    /// ha già l'elenco dei comandi con i loro titoli localizzati, e ricomporre
    /// qui un titolo vorrebbe dire risolverlo nel catalogo di chi ha registrato
    /// il comando — cioè, per un comando di un componente, nel catalogo del
    /// componente. Ciò che attraversa di qui è un identificatore; la frase la
    /// scrive la shell, che è la stessa riga della 0098.
    /// Restano fuori le chiavi che **nessuno dichiara**: una scorciatoia scritta
    /// per un comando di un componente che oggi è spento non ha un titolo da
    /// mostrare né un modo di essere azzerata, e chiedere di una cosa che non fa
    /// niente insegna a rispondere senza guardare. Resta sospesa, e la domanda
    /// arriva il giorno che quel componente si accende — che è l'unico giorno in
    /// cui vale la pena farla.
    pub fn pending_keybindings(
        &self,
        vault: Option<&str>,
    ) -> Result<std::collections::BTreeMap<String, String>, PluginError> {
        self.in_session(vault, |session| {
            let ws = session.workspace.read()?;
            let proposti = ws.vault_keybindings();
            Ok(ws
                .suspended_settings()
                .into_iter()
                .filter(|key| ws.setting_is_declared(key))
                .filter_map(|key| proposti.get(&key).map(|c| (key, c.clone())))
                .collect())
        })
    }

    /// **Usa le sue**: l'utente ha guardato le scorciatoie del vault e le
    /// adotta. Da qui in poi valgono, e non gliele si chiede più — finché il
    /// file non ne cambia una.
    pub fn adopt_keybindings(&self, vault: Option<&str>) -> Result<(), PluginError> {
        let shown: std::collections::BTreeSet<String> =
            self.pending_keybindings(vault)?.into_keys().collect();
        with_event_drain(&self.session_workspace(vault)?, |ws| {
            ws.resume_settings(&shown)
        })?;
        self.remember_seen_keys(vault)
    }

    /// **Tieni le mie**: le scorciatoie che il vault proponeva escono dal suo
    /// file, e valgono quelle dichiarate dai comandi.
    ///
    /// Cancella davvero invece di lasciarle sospese per sempre, e la ragione è
    /// la riga della 0076: un valore che nessuno leggerà mai è la cosa peggiore
    /// che un file di configurazione possa contenere. Dopo una risposta — in
    /// tutti e due i versi — non resta niente di ambiguo nel file.
    ///
    /// Tocca **solo** le chiavi sospese: una scorciatoia che l'utente si era
    /// scelto su questa macchina e che il vault non ha cambiato non è in
    /// discussione, e rifiutare ciò che arriva da fuori non deve buttare ciò che
    /// era già proprio.
    pub fn discard_keybindings(&self, vault: Option<&str>) -> Result<(), PluginError> {
        let shown: Vec<String> = self.pending_keybindings(vault)?.into_keys().collect();
        let missing = self.in_session(vault, |session| {
            // Il `reset` **risveglia** la chiave che azzera — è la riga in
            // `SettingsStore::write` — quindi alla fine del giro non resta
            // sospeso niente di ciò che è stato mostrato, e non serve una
            // seconda mossa che potrebbe non essere d'accordo con la prima.
            //
            // I guasti si **raccolgono** invece di interrompere il giro, e la
            // ragione è la promessa qui sopra: uscire alla prima chiave che non
            // si azzera lascerebbe metà file cancellato e metà ancora sospeso,
            // cioè esattamente l'ambiguità che questa risposta esiste per
            // togliere — e senza nemmeno arrivare al promemoria, così la volta
            // dopo si richiede di un insieme che è già stato in parte distrutto.
            with_event_drain(&session.workspace, |ws| {
                shown
                    .iter()
                    .filter_map(|key| {
                        ws.reset_setting(key)
                            .err()
                            .map(|why| format!("`{key}`: {why}"))
                    })
                    .collect::<Vec<_>>()
            })
        })?;
        // Il promemoria si scrive **comunque**, e dice il vero da solo: ricorda
        // ciò che il file porta meno ciò che è rimasto sospeso, quindi le chiavi
        // che non si sono azzerate non risultano guardate.
        self.remember_seen_keys(vault)?;
        if missing.is_empty() {
            return Ok(());
        }
        Err(PluginError::Internal(
            format!(
                "{} scorciatoie del vault non si sono azzerate — {}",
                missing.len(),
                missing.join("; ")
            )
            .into(),
        ))
    }

    /// Scrive un'impostazione **per conto dell'utente**: è la porta della
    /// persona davanti allo schermo, quella che il §11.1 tiene distinta da
    /// `settings.set` del registro (da cui passa un programma).
    ///
    /// Esiste come metodo dell'host, e non come la riga di `Workspace` che
    /// chiama, per una ragione sola: una scorciatoia scritta qui è una
    /// scorciatoia **guardata**, e ricordarlo vuol dire toccare il registro dei
    /// vault — che il kernel non conosce e non deve conoscere. Senza questa
    /// riga la tastiera continuerebbe a funzionare e l'app chiederebbe alla
    /// riapertura di adottare un accordo che l'utente ha battuto lui: cioè la
    /// domanda inutile che insegna a rispondere senza guardare.
    pub fn set_setting_for_user(
        &self,
        vault: Option<&str>,
        key: &str,
        value: fub_abi::settings::SettingValue,
    ) -> Result<(), PluginError> {
        if key == crate::settings::DEVELOPER_THEME_FOLDER {
            // Il percorso lo dà solo la finestra nativa di «Collega una
            // cartella…» ([`Host::link_theme_folder`]), mai la webview.
            return Err(PluginError::PermissionDenied(fub_abi::Text::key(
                "host.theme_folder.link_only",
            )));
        }
        // Una forma che lo schema non sa dire (un fuso, un indirizzo): il
        // valore rifiutato non arriva a nessun livello, e il motivo esce nella
        // lingua di chi guarda.
        if let Some(mut problem) = crate::settings::user_value_problem(key, &value) {
            self.localize_core_waiting(vault, &mut problem);
            return Err(problem);
        }
        if self.machine_only(vault, key) {
            self.machine.set(key, value)?;
            crate::settings::reapply_log_levels(key, &self.machine, &self.levels);
            return self.tell_observer(key);
        }
        with_event_drain(&self.session_workspace(vault)?, |ws| {
            ws.set_setting(key, value)
        })??;
        crate::settings::reapply_log_levels(key, &self.machine, &self.levels);
        self.follow_theme_link_key(key);
        self.if_key_remember_it(vault, key)
    }

    /// Azzera un'impostazione per conto dell'utente. Stessa porta, stesso
    /// promemoria: azzerare una scorciatoia è guardarla quanto scriverla.
    pub fn reset_setting_for_user(
        &self,
        vault: Option<&str>,
        key: &str,
    ) -> Result<(), PluginError> {
        if self.machine_only(vault, key) {
            self.machine.reset(key)?;
            crate::settings::reapply_log_levels(key, &self.machine, &self.levels);
            return self.tell_observer(key);
        }
        with_event_drain(&self.session_workspace(vault)?, |ws| ws.reset_setting(key))??;
        crate::settings::reapply_log_levels(key, &self.machine, &self.levels);
        self.follow_theme_link_key(key);
        self.if_key_remember_it(vault, key)
    }

    /// Surface-specific frame support and restart metadata for user settings.
    pub fn frame_capabilities(&self) -> crate::settings::FrameCapabilities {
        crate::settings::frame_capabilities()
    }

    pub fn setting_requires_reopen(&self, key: &str) -> bool {
        crate::settings::setting_requires_reopen(key)
    }

    /// Profile operations are user-only, never delegated to plugin commands.
    pub fn settings_profiles(
        &self,
        vault: Option<&str>,
        scope: fub_abi::settings::SettingScope,
    ) -> Result<(String, Vec<String>), PluginError> {
        match scope {
            fub_abi::settings::SettingScope::Machine => Ok((
                self.machine
                    .active_profile()
                    .map_err(|e| PluginError::Internal(e.into()))?,
                self.machine
                    .profiles()
                    .map_err(|e| PluginError::Internal(e.into()))?,
            )),
            fub_abi::settings::SettingScope::Vault => self.in_session(vault, |session| {
                let ws = session.workspace.read()?;
                Ok((ws.active_settings_profile()?, ws.settings_profiles()?))
            }),
        }
    }

    pub fn export_settings_profile(
        &self,
        vault: Option<&str>,
        scope: fub_abi::settings::SettingScope,
        name: &str,
    ) -> Result<String, PluginError> {
        match scope {
            fub_abi::settings::SettingScope::Machine => self
                .machine
                .export_profile(name)
                .and_then(|json| without_local_keys(&json, None))
                .map_err(|e| PluginError::BadArgs(e.into())),
            fub_abi::settings::SettingScope::Vault => self.in_session(vault, |session| {
                session.workspace.read()?.export_settings_profile(name)
            }),
        }
    }

    pub fn import_settings_profile(
        &self,
        vault: Option<&str>,
        scope: fub_abi::settings::SettingScope,
        json: &str,
    ) -> Result<(), PluginError> {
        match scope {
            fub_abi::settings::SettingScope::Machine => without_local_keys(json, None)
                .and_then(|json| self.machine.import_profile(&json))
                .map_err(|e| PluginError::BadArgs(e.into())),
            fub_abi::settings::SettingScope::Vault => self.in_session(vault, |session| {
                with_event_drain(&session.workspace, |ws| ws.import_settings_profile(json))?
            }),
        }
    }

    pub fn duplicate_settings_profile(
        &self,
        vault: Option<&str>,
        scope: fub_abi::settings::SettingScope,
        source: &str,
        name: &str,
    ) -> Result<(), PluginError> {
        match scope {
            // La copia passa da fuori, come un'esportazione e un'importazione:
            // così le chiavi di questa macchina restano fuori anche da lei.
            fub_abi::settings::SettingScope::Machine => self
                .machine
                .export_profile(source)
                .and_then(|json| without_local_keys(&json, Some(name)))
                .and_then(|json| self.machine.import_profile(&json))
                .map_err(|e| PluginError::BadArgs(e.into())),
            fub_abi::settings::SettingScope::Vault => self.in_session(vault, |session| {
                with_event_drain(&session.workspace, |ws| {
                    ws.duplicate_settings_profile(source, name)
                })?
            }),
        }
    }

    pub fn switch_settings_profile(
        &self,
        vault: Option<&str>,
        scope: fub_abi::settings::SettingScope,
        name: &str,
    ) -> Result<(), PluginError> {
        match scope {
            fub_abi::settings::SettingScope::Machine => {
                let restored = self.keeping_local_keys(|machine| {
                    machine
                        .switch_profile(name)
                        .map_err(|e| PluginError::BadArgs(e.into()))
                })?;
                // A profile can alter any machine key; subscribers must reread
                // the index, even when restoring a local key failed.
                for entry in self.machine.entries() {
                    self.tell_observer(&entry.spec.key)?;
                }
                restored
            }
            fub_abi::settings::SettingScope::Vault => {
                with_event_drain(&self.session_workspace(vault)?, |ws| {
                    ws.switch_settings_profile(name)
                })??;
                self.remember_seen_keys(vault)
            }
        }
    }

    pub fn reset_settings_profile(
        &self,
        vault: Option<&str>,
        scope: fub_abi::settings::SettingScope,
        name: &str,
    ) -> Result<(), PluginError> {
        match scope {
            fub_abi::settings::SettingScope::Machine => {
                let restored = self.keeping_local_keys(|machine| {
                    machine
                        .reset_profile(name)
                        .map_err(|e| PluginError::BadArgs(e.into()))
                })?;
                // A profile can alter any machine key; subscribers must reread
                // the index, even when restoring a local key failed.
                for entry in self.machine.entries() {
                    self.tell_observer(&entry.spec.key)?;
                }
                restored
            }
            fub_abi::settings::SettingScope::Vault => self.in_session(vault, |session| {
                with_event_drain(&session.workspace, |ws| ws.reset_settings_profile(name))?
            }),
        }
    }

    /// Le impostazioni **che esistono senza un vault**: le righe del livello
    /// macchina, risolte (§16.3).
    ///
    /// È la risposta a [`IndexQuery::Settings`] quando non c'è nessun vault
    /// aperto, e non è un ripiego: `log.*` e le scorciatoie della shell sono
    /// dichiarate di macchina proprio perché il caso in cui servono è questo.
    /// Con un vault aperto la domanda passa dal canale dati come sempre, e le
    /// stesse chiavi arrivano di là con lo stesso valore — la mappa è una sola.
    ///
    /// [`IndexQuery::Settings`]: fub_abi::traits::IndexQuery::Settings
    ///
    /// # Perché risolve qui, e non nello store
    ///
    /// «Risolte» vuol dire due cose, e per un pezzo ne valeva una sola.
    /// [`MachineSettings::entries`] risolve il **valore** — quale livello vince,
    /// e da dove viene — e non può risolvere il **testo**: i cataloghi arrivano
    /// coi bundle, i bundle stanno nel montaggio di un vault, e questa porta
    /// esiste proprio per il caso in cui un vault non c'è. Lo store non ha
    /// niente con cui tradurre, e chiederglielo vorrebbe dire fargli tenere una
    /// copia dei cataloghi che il montaggio già tiene.
    ///
    /// Il risultato, finché ha risolto solo il valore, era un
    /// [`Text::Message`](fub_abi::text::Text::Message) che usciva dal contratto
    /// intatto: sul filo `{"key": "core.log.level"}` dove la shell aspetta una
    /// stringa, cioè `[object Object]` scritto in ogni etichetta del pannello —
    /// e per giunta nel momento peggiore, perché la porta senza vault è quella
    /// che risponde a chi sta cercando l'interruttore del log per capire perché
    /// un vault non si apre. È lo stesso difetto che il canale dati aveva dal
    /// lato vault, riparato mandando `IndexQuery::Settings` a
    /// `Workspace::query_index`: qui non c'è un `Workspace` a cui mandarlo, e
    /// la riparazione è la stessa fatta con ciò che l'host ha in mano.
    ///
    /// Il catalogo è quello di **core** e non c'è da sceglierlo: al livello
    /// macchina dichiara solo lui (`core_machine_settings()`, in `open`), e chi
    /// aggiungesse un secondo dichiarante troverebbe qui una riga da cambiare
    /// invece di un difetto da scoprire. La lingua è quella del **sistema** e
    /// basta: le `locale.*` sono del vault
    /// ([0076](../../../docs/decisions/0192-impostazioni-locale-e-temi.md)),
    /// quindi senza vault la scala di `Workspace::locale` collassa sull'unico
    /// gradino che le resta.
    ///
    /// Presidiata da `tests/la_macchina_senza_vault.rs`, che guarda ogni `Text`
    /// dell'albero e non le sole etichette: il difetto si era già nascosto una
    /// volta nelle opzioni di una `Choice`, che nessuno guardava.
    pub fn machine_settings(&self) -> Vec<fub_abi::settings::SettingEntry> {
        let mut rows = self.machine.entries();
        let all_catalogs = crate::settings::core_catalog_assembled();
        let locale = self.system_locale.get();
        let strings = fub_abi::text::Strings::new(
            &all_catalogs,
            crate::settings::CORE_DEFAULT_LOCALE,
            &locale,
        );
        for row in &mut rows {
            strings.localize(row);
        }
        rows
    }

    /// **Il canale dati**, con la sola domanda che si può servire senza vault.
    ///
    /// Le impostazioni di macchina esistono anche a finestra vuota (§16.3):
    /// `log.*` è dichiarata così perché il momento in cui serve è quello in cui
    /// un vault non si apre, e le scorciatoie della shell perché
    /// `shell.vault.open` è il comando che apre il primo. È una famiglia sola e
    /// resta su **questa** porta invece di averne una sua, perché un elenco è
    /// dati e i dati hanno un canale solo (0019).
    ///
    /// Sta qui e non nel comando IPC per la ragione di sempre: il livello
    /// macchina è dell'host, e la regola che decide quando risponde lui va dove
    /// un banco la può interrogare.
    pub fn query_index(
        &self,
        vault: Option<&str>,
        query: fub_abi::traits::IndexQuery,
    ) -> Result<fub_abi::traits::IndexResult, PluginError> {
        if vault.is_none()
            && !self.has_current_vault()
            && matches!(
                query,
                fub_abi::traits::IndexQuery::Settings { plugin: None }
            )
        {
            return Ok(fub_abi::traits::IndexResult::Settings(
                self.machine_settings(),
            ));
        }
        // Il prestito delle sessioni si rilascia prima della query: dentro ci
        // sono i provider, anche di terze parti, e chi aspetta di aprire o
        // chiudere un vault bloccherebbe ogni nuova lettura delle sessioni —
        // compresa quella con cui il provider stesso torna sull'host.
        query_workspace(&self.session_workspace(vault)?, query)
    }

    /// Il `Guard` di un componente concede questa famiglia, **adesso**?
    ///
    /// È per chi agisce a nome di un componente fuori dal kernel, con una
    /// capacità che nessun metodo dell'host esercita: il notificatore dei
    /// promemoria dell'app, che mostra una notifica a nome di `fub.tasks` solo
    /// se il permesso `fub:notifications` è dichiarato e non spento. La politica
    /// si legge a ogni chiamata, come la legge il cancello: un interruttore
    /// spento vale dalla notifica dopo. Un componente spento o sconosciuto
    /// non è dichiarato, e la risposta è no.
    pub fn component_allows(
        &self,
        vault: Option<&str>,
        component: &str,
        capability: Capability,
    ) -> Result<bool, PluginError> {
        let workspace = self.session_workspace(vault)?;
        let ws = workspace.read()?;
        Ok(fub_kernel::Policy::denies(&ws.granted_policy(component), capability).is_none())
    }

    /// L'orologio e il locale del vault, dalla stessa fotografia: i
    /// millisecondi UTC e la lingua e il fuso con cui li legge chi guarda.
    /// Sono quelli che l'`HostEnv` dà ai componenti, così l'ora del muro del
    /// notificatore è la stessa che leggerebbe un provider.
    pub fn vault_clock(&self, vault: Option<&str>) -> Result<(u64, fub_abi::Locale), PluginError> {
        let workspace = self.session_workspace(vault)?;
        let ws = workspace.read()?;
        Ok((ws.now_unix_millis(), ws.locale()))
    }

    /// Questa scrittura riguarda una chiave che **un vault non le serve**, e
    /// vault aperti non ce ne sono?
    ///
    /// Le tre condizioni insieme, e nessuna si può togliere. Senza la prima, chi
    /// nomina un vault che non è aperto riceverebbe un successo dal livello
    /// sbagliato; senza la seconda, una chiave di macchina scritta con un vault
    /// aperto salterebbe il `Workspace`, cioè l'evento `setting_changed` che i
    /// pannelli aspettano; senza la terza, una chiave di vault scritta senza
    /// vault direbbe «non dichiarata» invece di «nessun vault aperto», che è la
    /// frase che dice cosa fare.
    /// Una scrittura passata da un vault aperto (il `Workspace` la dice sul suo
    /// bus, non a [`Host::tell_observer`]): l'osservatore del tema collegato
    /// segue lo stesso le sue due chiavi.
    pub(super) fn follow_theme_link_key(&self, key: &str) {
        if key == crate::settings::DEVELOPER_MODE || key == crate::settings::DEVELOPER_THEME_FOLDER
        {
            self.sync_theme_link();
        }
    }

    /// Cambia o azzera un profilo di macchina tenendo le chiavi che non
    /// viaggiano coi profili ([`PROFILE_LOCAL_KEYS`]): il loro valore di
    /// prima torna com'era, qualunque cosa il profilo portasse. Un profilo
    /// non collega una cartella, e non la scollega.
    ///
    /// Tiene il turno delle chiavi locali per tutto il passo. Il risultato di
    /// fuori dice se il cambio è riuscito (se no niente è cambiato); quello di
    /// dentro se il ripristino è riuscito: se no il profilo è cambiato lo
    /// stesso, e chi chiama deve dirlo agli osservatori prima di rispondere
    /// con l'errore.
    pub(super) fn keeping_local_keys(
        &self,
        change: impl FnOnce(&MachineSettings) -> Result<(), PluginError>,
    ) -> Result<Result<(), PluginError>, PluginError> {
        let _turn = self
            .local_keys_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let before: Vec<_> = PROFILE_LOCAL_KEYS
            .iter()
            .map(|key| (*key, explicit_value(&self.machine, key)))
            .collect();
        change(&self.machine)?;
        let mut restored = Ok(());
        for (key, value) in before {
            if explicit_value(&self.machine, key) == value {
                continue;
            }
            let put_back = match value {
                Some(value) => self.machine.set(key, value),
                None => self.machine.reset(key),
            };
            if let Err(error) = put_back {
                tracing::warn!(
                    target: "fub.host",
                    key,
                    "a machine-local key could not be restored after a profile change: {error:?}"
                );
                if restored.is_ok() {
                    restored = Err(error);
                }
            }
        }
        Ok(restored)
    }

    pub(super) fn machine_only(&self, vault: Option<&str>, key: &str) -> bool {
        vault.is_none() && !self.has_current_vault() && self.machine.declares(key)
    }
}
