//! Impostazioni del vault e della macchina, profili e stato delle viste.

use super::*;

/// Receipt for the exact machine-setting write that materialized default deny.
/// It can only undo that write while it is still the latest write to the key.
pub struct PermissionInitialization(pub(super) crate::settings::MachineSettingRevision);

pub(super) enum SettingMutation {
    Set(SettingValue),
    Reset,
}

/// Mutazione di configurazione validata che può persistere fuori dalla
/// custodia del workspace.
pub struct PreparedSettingMutation {
    pub(super) settings: SharedSettings,
    pub(super) key: String,
    pub(super) scope: SettingScope,
    pub(super) mutation: SettingMutation,
}

/// Esito persistito che autorizza il solo epilogo in memoria.
pub struct AppliedSettingMutation {
    pub(super) key: String,
    pub(super) scope: SettingScope,
}

impl PreparedSettingMutation {
    pub fn invoke(self) -> std::result::Result<AppliedSettingMutation, PluginError> {
        let mut settings = self.settings.write().expect("store di configurazione");
        let scope = match self.mutation {
            SettingMutation::Set(value) => settings.set(&self.key, value)?,
            SettingMutation::Reset => settings.reset(&self.key)?,
        };
        debug_assert_eq!(scope, self.scope);
        Ok(AppliedSettingMutation {
            key: self.key,
            scope,
        })
    }
}

impl Workspace {
    // --- le impostazioni (§11.1) -------------------------------------------
    //
    // Il workspace è l'unico che le può servire: lo schema lo tiene il registro
    // dei plugin (arriva dal manifest, alla dichiarazione) e il valore lo tiene
    // lo store, e le due cose si incontrano solo qui.

    /// Il valore che vale adesso per una chiave dichiarata.
    pub fn setting(&self, key: &str) -> std::result::Result<SettingValue, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .effective(key)
            .map(|(value, _)| value)
    }

    /// Come [`setting`](Workspace::setting), ma dice anche **da dove viene**.
    pub fn setting_source(
        &self,
        key: &str,
    ) -> std::result::Result<(SettingValue, SettingSource), PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .effective(key)
    }

    /// Valida schema e scrivibilità prima di staccare la persistenza dal
    /// workspace. Il token conserva soltanto dati owned e lo store condiviso.
    pub fn prepare_program_setting_mutation(
        &self,
        key: &str,
        value: Option<SettingValue>,
    ) -> std::result::Result<PreparedSettingMutation, PluginError> {
        let scope = {
            let settings = self.settings.read().expect("store di configurazione");
            let spec = settings.spec(key).ok_or_else(|| {
                PluginError::BadArgs(format!("nobody declared setting `{key}`").into())
            })?;
            if !spec.program_writable {
                return Err(PluginError::PermissionDenied(
                    format!(
                        "setting `{key}` was not declared writable by a \
                         program: the person looking at it is the one who changes it"
                    )
                    .into(),
                ));
            }
            if let Some(value) = value.as_ref() {
                if let Some(why) = spec.kind.rejects(value) {
                    return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
                }
            }
            spec.scope
        };
        Ok(PreparedSettingMutation {
            settings: Arc::clone(&self.settings),
            key: key.to_owned(),
            scope,
            mutation: match value {
                Some(value) => SettingMutation::Set(value),
                None => SettingMutation::Reset,
            },
        })
    }

    /// Annuncia una mutazione già persistita, rimandando ogni callback a dopo
    /// il rilascio della custodia.
    pub fn finish_setting_mutation_deferred(
        &mut self,
        applied: AppliedSettingMutation,
    ) -> DeferredEvents<()> {
        let deferred = self.defer_event_dispatch();
        self.announce_setting(&applied.key, applied.scope);
        self.restore_event_dispatch(deferred);
        DeferredEvents::outcome(())
    }

    /// Scrive una chiave, e **lo dice**: la scrittura di un'impostazione è un
    /// fatto che riguarda chi la legge, e senza l'evento un interruttore
    /// spostato in una finestra resterebbe invisibile a tutto il resto finché
    /// qualcuno non ricarica.
    ///
    /// L'attore è quello corrente, come per ogni altra scrittura: chi ha chiesto
    /// è chi è entrato nel kernel (decisione 0012), e questa capacità passa da
    /// un comando o da un plugin, mai dal kernel di sua iniziativa.
    pub fn set_setting(
        &mut self,
        key: &str,
        value: SettingValue,
    ) -> std::result::Result<(), PluginError> {
        let scope = self
            .settings
            .write()
            .expect("store di configurazione")
            .set(key, value)?;
        self.announce_setting(key, scope);
        Ok(())
    }

    /// Azzera una chiave: ricade al livello sotto (vedi
    /// [`SettingsWrite::reset_setting`](fub_abi::traits::SettingsWrite::reset_setting)).
    pub fn reset_setting(&mut self, key: &str) -> std::result::Result<(), PluginError> {
        let scope = self
            .settings
            .write()
            .expect("store di configurazione")
            .reset(key)?;
        self.announce_setting(key, scope);
        Ok(())
    }

    /// Writes a machine-scoped permission denial only while no machine choice
    /// exists, returning the exact write receipt needed by rollback.
    pub fn initialize_permission_denial(
        &mut self,
        key: &str,
    ) -> std::result::Result<Option<PermissionInitialization>, PluginError> {
        if fub_abi::settings::permission_of_key(key).is_none() {
            return Err(PluginError::BadArgs(
                format!("`{key}` is not a permission setting").into(),
            ));
        }
        let receipt = self
            .settings
            .read()
            .expect("store di configurazione")
            .initialize_machine_default_tracked(key, SettingValue::Toggle(false))?;
        if receipt.is_some() {
            self.announce_setting(key, SettingScope::Machine);
        }
        Ok(receipt.map(PermissionInitialization))
    }

    /// Undoes only the exact default-deny write represented by `receipt`.
    /// A later write, including an ABA write back to `false`, is preserved.
    pub fn rollback_permission_denial(
        &mut self,
        receipt: &PermissionInitialization,
    ) -> std::result::Result<bool, PluginError> {
        let reset = self
            .settings
            .read()
            .expect("store di configurazione")
            .rollback_machine_if_current(&receipt.0)?;
        if reset {
            self.announce_setting(receipt.0.key(), SettingScope::Machine);
        }
        Ok(reset)
    }

    pub(super) fn announce_setting(&mut self, key: &str, scope: SettingScope) {
        // Una chiave che è un recinto rifà il recinto, **prima** di dirlo
        // (§23.17): chi riceve l'evento può chiamare, e riceverebbe un cancello
        // ancora aperto. Passa di qui e non dai due chiamanti perché scrivere e
        // azzerare sono la stessa cosa vista da due lati — azzerare una chiave
        // negata è precisamente il modo in cui si riconcede.
        if let Some((plugin, _)) = fub_abi::settings::permission_of_key(key) {
            let plugin = plugin.to_string();
            self.reapply_permissions(&plugin);
        }
        // E una chiave che è una **finestra** ripota il registro, subito e non
        // alla prossima apertura: chi stringe la conservazione a trenta giorni
        // lo fa per far cadere ciò che c'è adesso, non ciò che ci sarà. Stessa
        // riga del recinto qui sopra, stessa ragione (§23.9).
        if key == crate::journal::RETENTION_DAYS {
            self.prunes_the_record();
        }
        let key = key.to_string();
        self.emit_event(Event::SettingChanged { key, scope });
        if !self.dispatch.in_provider_call() {
            self.dispatch_pending();
        }
    }

    /// Named vault preferences live in the settings file, not in view state.
    pub fn settings_profiles(&self) -> std::result::Result<Vec<String>, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .profiles()
            .map_err(|e| PluginError::Internal(e.into()))
    }

    pub fn active_settings_profile(&self) -> std::result::Result<String, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .active_profile()
            .map_err(|e| PluginError::Internal(e.into()))
    }

    pub fn export_settings_profile(&self, name: &str) -> std::result::Result<String, PluginError> {
        self.settings
            .read()
            .expect("store di configurazione")
            .export_profile(name)
            .map_err(|e| PluginError::BadArgs(e.into()))
    }

    pub fn import_settings_profile(&mut self, json: &str) -> std::result::Result<(), PluginError> {
        self.settings
            .write()
            .expect("store di configurazione")
            .import_profile(json)
            .map_err(|e| PluginError::BadArgs(e.into()))
    }

    pub fn duplicate_settings_profile(
        &mut self,
        source: &str,
        name: &str,
    ) -> std::result::Result<(), PluginError> {
        self.settings
            .write()
            .expect("store di configurazione")
            .duplicate_profile(source, name)
            .map_err(|e| PluginError::BadArgs(e.into()))
    }

    pub fn switch_settings_profile(&mut self, name: &str) -> std::result::Result<(), PluginError> {
        let before = self
            .settings
            .read()
            .expect("store di configurazione")
            .entries(None);
        let after = {
            let mut settings = self.settings.write().expect("store di configurazione");
            settings
                .switch_profile(name)
                .map_err(|e| PluginError::BadArgs(e.into()))?;
            settings.entries(None)
        };
        for (old, new) in before.into_iter().zip(after) {
            if old.value != new.value || old.source != new.source {
                self.announce_setting(&new.spec.key, new.spec.scope);
            }
        }
        Ok(())
    }

    pub fn reset_settings_profile(&mut self, name: &str) -> std::result::Result<(), PluginError> {
        let active = self.active_settings_profile()? == name;
        let before = if active {
            self.settings
                .read()
                .expect("store di configurazione")
                .entries(None)
        } else {
            Vec::new()
        };
        let after = {
            let mut settings = self.settings.write().expect("store di configurazione");
            settings
                .reset_profile(name)
                .map_err(|e| PluginError::BadArgs(e.into()))?;
            if active {
                settings.entries(None)
            } else {
                Vec::new()
            }
        };
        for (old, new) in before.into_iter().zip(after) {
            if old.value != new.value || old.source != new.source {
                self.announce_setting(&new.spec.key, new.spec.scope);
            }
        }
        Ok(())
    }

    /// Le scorciatoie che il file di questo vault dichiara (§23.13), come
    /// chiave → accordo. La chiede chi monta, per sapere cosa questo vault
    /// propone alla tastiera di chi lo apre.
    pub fn vault_keybindings(&self) -> std::collections::BTreeMap<String, String> {
        self.settings
            .read()
            .expect("store di configurazione")
            .vault_keybindings()
    }

    /// Sospende il valore del vault di queste chiavi (§23.13): finché sono
    /// sospese si leggono come se il file non ne parlasse.
    ///
    /// **Non emette l'evento** delle impostazioni, e la ragione è che non
    /// succede a impostazioni cambiate: succede all'apertura, prima che ci sia
    /// qualcuno in ascolto, e ciò che chi legge vede è un valore che non è mai
    /// stato altro. Scioglierla invece è un cambiamento come gli altri, e passa
    /// da [`announce_setting`](Workspace::announce_setting) come tutti.
    pub fn suspend_settings(&mut self, keys: std::collections::BTreeSet<String>) {
        self.settings
            .write()
            .expect("store di configurazione")
            .suspend(keys);
    }

    /// Le chiavi sospese adesso (§23.13).
    pub fn suspended_settings(&self) -> std::collections::BTreeSet<String> {
        self.settings
            .read()
            .expect("store di configurazione")
            .suspended()
            .clone()
    }

    /// Scioglie la sospensione di queste chiavi — l'utente le ha guardate — e
    /// **lo dice**, una per una: chi disegna la tastiera rilegge gli accordi
    /// quando sente cambiare un'impostazione, e un risveglio silenzioso
    /// lascerebbe la scorciatoia nuova scritta nel pannello e non premibile fino
    /// alla riapertura.
    ///
    /// Prende un elenco e non scioglie tutto perché chi risponde ha risposto su
    /// ciò che ha visto: una chiave che nessuno gli ha mostrato — perché nessuno
    /// la dichiara — non è compresa nel sì.
    pub fn resume_settings(&mut self, keys: &std::collections::BTreeSet<String>) {
        {
            let mut store = self.settings.write().expect("store di configurazione");
            let mut suspended = store.suspended().clone();
            suspended.retain(|k| !keys.contains(k));
            store.suspend(suspended);
        }
        for key in keys {
            self.announce_setting(key, SettingScope::Vault);
        }
    }

    /// Qualcuno dichiara questa chiave in questo montaggio?
    ///
    /// È una domanda diversa da «c'è un valore»: un file può portare la
    /// scorciatoia di un comando di un componente che oggi è spento, e quella
    /// chiave non ha uno schema, non si legge e non si scrive. Chi chiede è chi
    /// deve **mostrarla a qualcuno** (§23.13), e una riga senza schema non ha né
    /// un titolo da scrivere né un modo di essere azzerata.
    pub fn setting_is_declared(&self, key: &str) -> bool {
        self.settings
            .read()
            .expect("store di configurazione")
            .spec(key)
            .is_some()
    }

    /// Questa chiave si è dichiarata scrivibile da un programma? `None` = non
    /// è dichiarata affatto, che è un no diverso e va detto diverso.
    ///
    /// Lo chiede l'host dei plugin prima di scrivere (§11.1): il permesso dice
    /// *chi*, questo dice *cosa*.
    pub fn setting_is_program_writable(&self, key: &str) -> Option<bool> {
        self.settings
            .read()
            .expect("store di configurazione")
            .spec(key)
            .map(|spec| spec.program_writable)
    }

    /// Le impostazioni risolte, tutte o di un plugin: è la risposta che il
    /// canale dati restituisce a [`IndexQuery::Settings`].
    pub fn settings_entries(&self, plugin: Option<&str>) -> Vec<SettingEntry> {
        let rows = self
            .settings
            .read()
            .expect("store di configurazione")
            .entries_by_owner(plugin);
        rows.into_iter()
            .map(|(owner, mut entry)| {
                self.localize(&owner, &mut entry);
                entry
            })
            .collect()
    }

    // --- lo stato di vista (§11.2) -----------------------------------------
    //
    // Le due porte sono **due**, come per le impostazioni e per la stessa
    // ragione: queste prendono il proprietario come argomento perché le chiama
    // chi *è* la shell (che non è un plugin e non ha un id da timbrare); un
    // provider passa invece dalle capacità, dove il proprietario e l'esemplare
    // li mette l'host e non si possono nominare.

    /// Ciò che questo esemplare aveva salvato sotto questa chiave, su questa
    /// macchina e per questo vault.
    pub fn view_state(&self, owner: &str, instance: &str, key: &str) -> Option<serde_json::Value> {
        self.view_states
            .get(self.root().as_str(), owner, instance, key)
    }

    /// Salva (`Some`) o dimentica (`None`) lo stato di vista di un esemplare.
    pub fn set_view_state(
        &self,
        owner: &str,
        instance: &str,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> std::result::Result<(), String> {
        self.view_states
            .set(self.root().as_str(), owner, instance, key, value)
    }

    /// Lo stato di vista della macchina, da condividere col prossimo vault che
    /// si apre. Gemello di [`machine_settings`](Workspace::machine_settings).
    pub fn view_states(&self) -> Arc<ViewStates> {
        Arc::clone(&self.view_states)
    }
}
