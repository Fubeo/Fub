//! Lingua dei messaggi, comandi dell'utente, stato delle viste, versioni e organizzazione.

use super::*;

impl Host {
    /// **La lingua di chi guarda** il vault `vault`: le sue `locale.*` sopra la
    /// lingua del sistema (`Workspace::locale`), o la sola lingua del sistema
    /// se il vault non c'è.
    ///
    /// Serve ai testi che l'host scrive da sé con un catalogo che non è di un
    /// bundle montato — i nomi della mappa dei componenti
    /// ([`crate::componenti::Testi`]). A differenza di
    /// [`localize_core`](Self::localize_core) **aspetta** il workspace: chi la
    /// chiama ha appena letto il vault e non sta dentro un `mount.*`, e un nome
    /// che esce nella lingua sbagliata perché un altro scriveva sarebbe un
    /// cambio di lingua a caso.
    pub fn speaking_locale(&self, vault: Option<&str>) -> fub_abi::locale::Locale {
        self.with_session(vault, |session| session.workspace.clone())
            .ok()
            .and_then(|workspace| workspace.read().ok().map(|ws| ws.locale()))
            .unwrap_or_else(|| self.system_locale.get())
    }

    /// Un valore dell'host nella lingua di chi guarda, col catalogo del core.
    /// Non **aspetta** il workspace: `mount.*` deve finire anche mentre un
    /// altro writer lo tiene, quindi se il lock non è libero — o un vault non
    /// c'è ancora — la frase esce nella lingua del sistema, mai come chiave
    /// grezza. Dopo uno snapshot la sessione è quella riaperta.
    pub(super) fn localize_core<T: fub_abi::text::Localize + ?Sized>(
        &self,
        vault: Option<&str>,
        value: &mut T,
    ) {
        let workspace = self
            .with_session(vault, |session| session.workspace.clone())
            .ok();
        match workspace
            .as_ref()
            .and_then(|workspace| workspace.try_read())
        {
            Some(ws) => ws.localize_as(crate::settings::CORE_ID, value),
            None => self.localize_core_as_system(value),
        };
    }

    /// Come [`localize_core`](Self::localize_core), ma **aspetta** il
    /// workspace, come [`speaking_locale`](Self::speaking_locale): per chi
    /// risponde a un gesto della persona, fuori da ogni `mount.*` e senza
    /// prestiti in mano. Subito dopo l'apertura l'indice lavora a fette e
    /// tiene il workspace un attimo alla volta; non aspettarlo voleva dire
    /// rispondere a caso nella lingua del sistema invece che in quella del
    /// vault (il rifiuto di un fuso in italiano a chi ha scelto l'inglese).
    pub(super) fn localize_core_waiting<T: fub_abi::text::Localize + ?Sized>(
        &self,
        vault: Option<&str>,
        value: &mut T,
    ) {
        let workspace = self
            .with_session(vault, |session| session.workspace.clone())
            .ok();
        match workspace.as_ref().map(|workspace| workspace.read()) {
            Some(Ok(ws)) => ws.localize_as(crate::settings::CORE_ID, value),
            _ => self.localize_core_as_system(value),
        };
    }

    /// Il catalogo del core nella lingua del sistema: quando un vault non c'è,
    /// o non risponde.
    pub(super) fn localize_core_as_system<T: fub_abi::text::Localize + ?Sized>(
        &self,
        value: &mut T,
    ) {
        let catalogs = crate::settings::core_catalog_assembled();
        let locale = self.system_locale.get();
        fub_abi::text::Strings::new(&catalogs, crate::settings::CORE_DEFAULT_LOCALE, &locale)
            .localize(value);
    }

    /// L'esito (o l'errore) di un comando dell'host nella lingua di chi guarda.
    pub(super) fn localized_host_result(
        &self,
        vault: Option<&str>,
        mut result: Result<CommandOutcome, PluginError>,
    ) -> Result<CommandOutcome, PluginError> {
        match &mut result {
            Ok(outcome) => self.localize_core(vault, outcome),
            Err(error) => self.localize_core(vault, error),
        }
        result
    }

    /// L'errore di una chiamata dell'host pronto a uscire dal processo così
    /// com'è, nella lingua di chi guarda.
    ///
    /// Dentro l'host un errore può restare una chiave del catalogo del core,
    /// ed è ciò che permette a chi lo riceve in Rust di riconoscerlo
    /// ([`is_writer_busy`](crate::automation::is_writer_busy)). Sul filo JSON
    /// invece un `Text` non risolto è un oggetto e non una frase: chi porta
    /// l'errore alla shell lo passa di qui, come fanno i comandi dell'host con
    /// il proprio esito.
    pub fn localized_error(&self, vault: Option<&str>, mut error: PluginError) -> PluginError {
        self.localize_core(vault, &mut error);
        error
    }

    pub fn invoke_user_command(
        &self,
        vault: Option<&str>,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        // La sessione si risolve prima e si conserva soltanto la Custody: il
        // registro delle sessioni non attraversa codice del provider.
        if let Some(spec) = snapshot_specs().into_iter().find(|spec| spec.id == command) {
            let root = self.with_session(vault, |session| session.root.clone())?;
            let result = self.invoke_snapshot_command(root, spec, args, mode);
            return self.localized_host_result(vault, result);
        }
        // La cattura compone altri comandi del registro: nessun prestito del
        // workspace deve essere preso qui, perché ognuno prende il suo.
        if command == crate::capture::CAPTURE_APPLY {
            let result = crate::capture::invoke(self, vault, args, mode);
            return self.localized_host_result(vault, result);
        }
        // Come la cattura, che compone: la rete si chiama senza prestiti.
        if command == crate::web_clip::WEB_CLIP {
            let result = crate::web_clip::invoke(self, vault, args, mode);
            return self.localized_host_result(vault, result);
        }
        if command == crate::export_folder::EXPORT_FOLDER {
            let (root, workspace) = self.with_session(vault, |session| {
                (session.root.clone(), session.workspace.clone())
            })?;
            let result = crate::export_folder::invoke(&root, &workspace, args, mode);
            return self.localized_host_result(vault, result);
        }
        if let Some(spec) = crate::uri_inbox::specs()
            .into_iter()
            .find(|spec| spec.id == command)
        {
            // La coda è della macchina e l'azione compone comandi del
            // registro, ognuno col suo prestito: niente sessione presa qui.
            let result = crate::uri_inbox::invoke(self, &self.uris, &spec, args, mode);
            return self.localized_host_result(vault, result);
        }
        if command == crate::obsidian_import::OBSIDIAN_IMPORT {
            // Scrive con la porta del pannello, che prende i suoi prestiti:
            // qui si prende soltanto la radice.
            let root = self.with_session(vault, |session| session.root.clone())?;
            let result = crate::obsidian_import::invoke(self, vault, &root, args, mode);
            return self.localized_host_result(vault, result);
        }
        if let Some(spec) = crate::connector_tokens::specs()
            .into_iter()
            .find(|spec| spec.id == command)
        {
            // I token sono della macchina, non del vault: nessun prestito.
            let result =
                crate::connector_tokens::invoke(self.configuration_root(), &spec, args, mode);
            return self.localized_host_result(vault, result);
        }
        let (workspace, mounts, storage) = self.with_session(vault, |session| {
            (
                session.workspace.clone(),
                session.mounts.clone(),
                Arc::clone(&session.storage),
            )
        })?;
        if let Some(spec) = mount_specs().into_iter().find(|spec| spec.id == command) {
            let result = self.invoke_mount_command(mounts, storage, spec, args, mode);
            return self.localized_host_result(vault, result);
        }
        if command == os_trash_spec().id {
            let result = self.invoke_os_trash_command(&workspace, args, mode);
            return self.localized_host_result(vault, result);
        }
        if command == FOLDER_CREATE {
            let result = invoke_folder_create(&workspace, args, mode);
            return self.localized_host_result(vault, result);
        }
        // Un comando che si è dichiarato di sola lettura ha il suo frame e
        // **non** prende il turno: una lettura lunga (un'anteprima, uno
        // strumento dell'AI) non ferma i salvataggi di chi scrive.
        // La bandiera è quella che la chiusura del vault o lo spegnimento del
        // suo plugin alzano per fermarlo; fuori non c'è nessuno da fermare.
        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let read_only = workspace.read()?.prepare_read_only_provider_command(
            command,
            args.clone(),
            mode,
            &[],
            &cancel,
            &[],
        )?;
        if let Some(prepared) = read_only {
            let host = JobHost::new(workspace.clone(), prepared.owner().to_string())
                .in_mode(prepared.host_mode())
                .cancelled_by(cancel);
            return crate::jobs::run_read_only_command(&workspace, host, prepared);
        }
        // Il turno serializza gli altri writer ma **non** è il RwLock del
        // workspace: fra prepare e finalize i reader possono entrare, e il
        // callback può rientrare sullo stesso thread per singola capacità.
        let _turn = workspace.write_turn();
        let mut prepared = {
            let mut ws = workspace.write()?;
            match ws.prepare_provider_command(command, args.clone(), mode, Actor::User)? {
                Some(prepared) => prepared,
                None => {
                    if let Some(rebuild) = ws.prepare_maintenance_rebuild(
                        command,
                        args.clone(),
                        mode,
                        Some(Actor::User),
                    )? {
                        drop(ws);
                        return run_detached_rebuild_index(&workspace, rebuild);
                    }
                    let deferred = ws.defer_event_dispatch();
                    let outcome = ws.invoke_command(command, args, mode, Actor::User);
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
            let host = JobHost::new(workspace.clone(), owner).in_mode(host_mode);
            let mut host = Guard::new(host, ReadOnly { why });
            prepared.invoke(&mut host)
        } else {
            let mut host = JobHost::new(workspace.clone(), owner).in_mode(host_mode);
            prepared.invoke(&mut host)
        };

        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_provider_command_deferred(prepared, outcome)
        };
        finish_events(&workspace, deferred)?
    }

    pub fn view_state(
        &self,
        vault: Option<&str>,
        owner: &str,
        instance: &str,
        key: &str,
    ) -> Result<Option<serde_json::Value>, PluginError> {
        self.read_workspace(vault, |workspace| {
            Ok(workspace.view_state(owner, instance, key))
        })
    }

    pub fn set_view_state(
        &self,
        vault: Option<&str>,
        owner: &str,
        instance: &str,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        update_view_state(&workspace, owner, instance, key, value)
    }

    /// Accesso al workspace soltanto nei build di debug, per i banchi interni.
    /// La shell e i consumer di produzione non ricevono più questa capacità.
    #[cfg(test)]
    #[doc(hidden)]
    pub(crate) fn debug_workspace(
        &self,
        vault: Option<&str>,
    ) -> Result<Custody<Workspace>, PluginError> {
        self.with_session(vault, |session| session.workspace.clone())
    }

    /// Il turno di scrittura del vault è in mano a qualcuno? Una sonda, non una
    /// porta: dice di chi non è, non dà modo di prenderlo. Serve ai banchi che
    /// fissano l'ordine fra due thread aspettando un fatto invece di un orologio.
    #[doc(hidden)]
    pub fn is_write_turn_held(&self, vault: Option<&str>) -> Result<bool, PluginError> {
        self.with_session(vault, |session| session.workspace.writer_turn_held())
    }

    #[cfg(test)]
    pub(crate) fn debug_sessions_write_available(&self) -> bool {
        crate::legacy_tests::write_comes_free(&self.sessions)
    }

    pub fn root(&self, vault: Option<&str>) -> Result<Utf8PathBuf, PluginError> {
        self.with_session(vault, |s| s.root.clone())
    }

    /// Questo vault ha il rilevamento delle modifiche esterne? `false` anche
    /// quando non è aperto (§9.7).
    pub fn is_watching(&self, vault: Option<&str>) -> bool {
        self.with_session(vault, VaultSession::is_watching)
            .unwrap_or(false)
    }

    // --- versioning --------------------------------------------------------
    //
    // Il kernel non sa che il versioning esiste: le versioni le tiene un
    // `EventHandler`, e il ripristino è una scrittura normale (D8). L'host
    // compone le due metà, che è esattamente ciò che dovrà fare per un plugin
    // di terzi.
    //
    // Le tre funzioni qui sotto sono il banco dei test headless, non una porta
    // del prodotto: la shell legge la storia dalla view `history` e ripristina
    // col comando `version.restore`, come farebbe un plugin. Restano nascoste
    // dalla documentazione finché un consumer vero non ne fa un'API.

    /// Lo store delle versioni di un vault, o l'errore se il versioning è
    /// spento: un chiamante che risponde "vuoto" quando la feature non c'è
    /// racconterebbe che non ci sono versioni, che è un'altra cosa.
    #[cfg(feature = "versioning")]
    #[doc(hidden)]
    pub fn versions(&self, vault: Option<&str>) -> Result<VersionStore, PluginError> {
        self.with_session(vault, |s| s.versions.clone())?
            // `Unserved` e non `Internal`: nessuno serve le versioni in questo
            // vault perche' la feature e' spenta, e chi disegna deve poter dire
            // «accendi il versioning» invece di «qualcosa e' andato storto».
            .ok_or_else(|| PluginError::Unserved("Versioning disattivato.".into()))
    }

    #[cfg(feature = "versioning")]
    #[doc(hidden)]
    pub fn list_versions(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<Vec<VersionRef>, PluginError> {
        Ok(self.versions(vault)?.list(id))
    }

    /// Rileggere una versione passa dall'host come tutto il resto: l'host presta
    /// al versioning le sue stesse capacità, non una scorciatoia sul filesystem.
    ///
    /// La capacità dati viene preparata dal [`JobHost`] sotto un prestito
    /// condiviso breve; il token posseduto rilascia il lock prima che
    /// `VersionStore::read` invochi il provider e attraversi lo storage. Così
    /// una lettura di cronologia non trattiene il workspace durante l'I/O.
    #[cfg(feature = "versioning")]
    #[doc(hidden)]
    pub fn read_version(
        &self,
        vault: Option<&str>,
        id: &DocId,
        ts: u64,
    ) -> Result<String, PluginError> {
        let (workspace, store) = self.in_session(vault, |session| {
            let store = session
                .versions
                .clone()
                .ok_or_else(|| PluginError::Unserved("Versioning disattivato.".into()))?;
            Ok((session.workspace.clone(), store))
        })?;
        read_version_with_workspace(workspace, store, id, ts)
    }

    // --- organizzazione del vault (§11.3) ----------------------------------
    //
    // **Leggerla non è qui**: passa da `query_index` (`IndexQuery::Organization`),
    // come le impostazioni e i tag — un elenco è dati, e i dati hanno un canale
    // solo. Qui c'è solo lo scrivere, e **per chiave**: prima erano due funzioni
    // che leggevano e riscrivevano il blob intero, quindi due finestre sullo
    // stesso vault erano una lost update.

    /// L'emoji accanto a una nota o a una cartella (`None` la toglie).
    pub fn set_icon(
        &self,
        vault: Option<&str>,
        path: &str,
        icon: Option<String>,
    ) -> Result<(), PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        update_organization(&workspace, |store| store.set_icon(path, icon))
    }

    /// Appunta o spunta una nota.
    pub fn set_pinned(
        &self,
        vault: Option<&str>,
        id: &str,
        pinned: bool,
    ) -> Result<(), PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        update_organization(&workspace, |store| store.set_pinned(id, pinned))
    }

    /// Registra o toglie una cartella dagli spazi.
    pub fn set_space(
        &self,
        vault: Option<&str>,
        path: &str,
        is_space: bool,
    ) -> Result<(), PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        update_organization(&workspace, |store| store.set_space(path, is_space))
    }

    /// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
    pub fn set_order(
        &self,
        vault: Option<&str>,
        folder: &str,
        names: Vec<String>,
    ) -> Result<(), PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        update_organization(&workspace, |store| store.set_order(folder, names))
    }
}
