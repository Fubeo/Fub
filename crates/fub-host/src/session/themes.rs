//! Chiavi dei vault e temi: lettura, collegamento a una cartella, installazione.

use super::*;

impl Host {
    /// **La chiave di una radice**: quella con cui è già conosciuta, se lo è, e
    /// solo altrimenti la sua forma canonica.
    ///
    /// Canonicalizzare è una domanda al filesystem, e una radice si
    /// canonicalizza **una volta, all'apertura** — è lì che `/vault`, `/vault/`
    /// e un link simbolico diventano la stessa chiave, ed è lì che si può
    /// ancora dire di no a chi nomina una cartella che non c'è. Rifarla a ogni
    /// uso non aggiunge niente e toglie tutto nel caso che conta: una chiavetta
    /// staccata, una cartella di rete caduta, un `rm -rf` di chi fa pulizia.
    /// Da quel momento il disco non risponde più, e le funzioni che
    /// ricanonicalizzavano rispondevano «non riesco a risolvere» a chi voleva
    /// **chiudere** quel vault, o smettere di preferirlo, o rinominarlo — cioè
    /// esattamente alle tre cose che si fanno su un vault che non c'è più.
    ///
    /// La risposta l'apertura l'ha già data: è la chiave della sessione e il
    /// `root` della voce in registro, ed è la sola forma che
    /// [`vaults`](Host::vaults) e [`known_vaults`](Host::known_vaults)
    /// restituiscono, cioè la sola che la shell abbia in mano. Quindi si guarda
    /// prima lì. Al disco si chiede solo per un nome che né le sessioni né il
    /// registro conoscono — un alias, un path con lo slash finale — e lì la
    /// canonicalizzazione serve ancora, per intero.
    ///
    /// Non è [`root_forms`], che risponde a un'altra domanda: chi
    /// **dimentica** cancella per ogni nome possibile e non può fallire, chi
    /// usa deve arrivare a *una* chiave o dire perché no.
    pub(super) fn key(&self, root: &Utf8Path) -> Result<Utf8PathBuf, PluginError> {
        if self.knows(root) {
            return Ok(root.to_owned());
        }
        canonical(root)
    }

    /// Questo host conosce questa radice **sotto questo nome**: c'è una
    /// sessione aperta con questa chiave, o una voce in registro.
    ///
    /// I due elenchi insieme e non uno solo, perché le due metà si aprono e si
    /// chiudono in momenti diversi: un vault chiuso esce dalle sessioni e resta
    /// in registro — ed è proprio allora che lo si preferisce o lo si rinomina.
    pub(super) fn knows(&self, root: &Utf8Path) -> bool {
        self.sessions
            .read()
            .is_ok_and(|sessions| sessions.slots.contains_key(root))
            || self.vaults.handle().knows(root)
    }

    // --- il registro dei vault (§11.1) -------------------------------------
    //
    // Ciò che questa macchina **conosce**, che è un'altra cosa da ciò che è
    // aperto adesso (`vaults()`): il secondo muore col processo, il primo è la
    // memoria fra un avvio e l'altro.

    /// Handle cloneable al registro di macchina, senza accesso al workspace.
    ///
    /// L'host ne possiede l'owner; il valore restituito è soltanto una porta
    /// tipizzata per l'elenco e le preferenze dei vault conosciuti.
    pub fn vault_registry(&self) -> VaultRegistryHandle {
        self.vaults.handle()
    }

    /// Elenca i temi installati con un manifest e fogli completi, e il tema
    /// collegato quando la sua cartella è pronta (fiducia `development`).
    pub fn themes(&self) -> Result<Vec<crate::theme::ThemeInfo>, PluginError> {
        let mut themes = self
            .config_dir
            .as_deref()
            .map(crate::theme::list_themes)
            .unwrap_or_default();
        if let Some(folder) = self.linked_theme_folder() {
            themes.extend(crate::theme::linked_theme_info(
                self.config_dir.as_deref(),
                &folder,
            ));
        }
        Ok(themes)
    }

    /// Legge una luce di un tema installato senza esporre il filesystem.
    pub fn read_theme(
        &self,
        id: &str,
        light: fub_abi::theme::ThemeLight,
    ) -> Result<crate::theme::ThemePayload, PluginError> {
        if let Some(folder) = self.linked_theme_folder() {
            if let Some(read) =
                crate::theme::read_linked_theme(self.config_dir.as_deref(), &folder, id, light)
            {
                return read.map_err(Into::into);
            }
        }
        let dir = self
            .config_dir
            .as_deref()
            .ok_or_else(|| PluginError::Unserved("theme inventory unavailable".into()))?;
        crate::theme::read_theme(dir, id, light).map_err(Into::into)
    }

    // --- il tema collegato (modalità sviluppatore) ---------------------------

    /// La cartella collegata, se la modalità sviluppatore è accesa e la chiave
    /// ne nomina una: è la sola fonte di [`Host::themes`], [`Host::read_theme`]
    /// e dell'osservatore.
    pub(super) fn linked_theme_folder(&self) -> Option<camino::Utf8PathBuf> {
        linked_folder(&self.machine)
    }

    /// Installa l'uscita degli eventi del tema collegato: l'app ci mette
    /// l'evento `fub://theme-changed` verso la finestra principale.
    pub fn set_theme_link_sink(&self, sink: crate::theme_watch::ThemeLinkSink) {
        self.theme_keeper.set_sink(sink);
    }

    /// Il tema collegato com'è adesso, `None` se nessuna cartella è collegata
    /// o la modalità sviluppatore è spenta. Lo chiede Aspetto, e l'app
    /// all'avvio per dire che la cartella non c'è più.
    ///
    /// Aspetta prima che un cambio di collegamento in volo sia deciso, così
    /// `watched` dice com'è davvero: chi la chiama è già fuori dal thread
    /// principale.
    ///
    /// Se la cartella è pronta ma nessuno la guarda (sparita e tornata, un
    /// osservatore che il sistema ha perso), chiede al custode di riprovare
    /// adesso: chiedere com'è vale anche come «riprova».
    pub fn theme_link(&self) -> Option<crate::theme::ThemeLink> {
        self.theme_keeper.settle();
        let folder = self.linked_theme_folder()?;
        let mut link = crate::theme::theme_link(self.config_dir.as_deref(), &folder);
        if link.state == crate::theme::ThemeLinkState::Ready
            && !self.theme_keeper.is_watching(&folder)
        {
            self.theme_keeper.revive();
        }
        link.watched = self.theme_keeper.is_watching(&folder);
        Some(link)
    }

    /// Monta o smonta l'osservatore secondo la chiave e la modalità
    /// sviluppatore, rilette adesso: la cartella collegata si guarda, niente
    /// altrimenti. Lo chiamano l'avvio dell'app e ogni scrittura di una delle
    /// due chiavi (`tell_observer`), quindi spegnere la modalità, azzerare la
    /// chiave o collegare un'altra cartella smonta il vecchio.
    ///
    /// Non si ferma: la lettura della chiave, della cartella e il montaggio
    /// girano su un thread del custode, perché chi chiama può essere un
    /// comando sincrono sul thread principale (`set_setting`, il cambio di
    /// profilo, l'avvio). Fra due sincronizzazioni vince l'ultima; nessun
    /// lucchetto del workspace attraversa la chiamata.
    pub fn sync_theme_link(&self) {
        let machine = Arc::clone(&self.machine);
        let config_dir = self.config_dir.clone();
        self.theme_keeper
            .request(move || (config_dir, linked_folder(&machine)));
    }

    /// Smonta l'osservatore alla chiusura dell'app; la chiave resta, e al
    /// prossimo avvio [`Host::sync_theme_link`] lo rimonta.
    pub fn close_theme_link(&self) {
        self.theme_keeper.close();
    }

    /// La cartella guardata adesso da un osservatore vivo, se c'è, dopo che
    /// i cambi in volo sono decisi: per i test del ciclo di vita.
    pub fn watched_theme_folder(&self) -> Option<camino::Utf8PathBuf> {
        self.theme_keeper.settle();
        self.theme_keeper.watched()
    }

    /// Il titolo della finestra di scelta nativa di «Collega una cartella…»,
    /// nella lingua di chi guarda: come [`Host::theme_folder_pick_title`].
    pub fn theme_link_pick_title(&self) -> String {
        let mut title = fub_abi::Text::key("host.theme_folder.link_title");
        self.localize_core(None, &mut title);
        title.to_string()
    }

    /// «Collega una cartella…»: `source` lo dà soltanto la finestra di scelta
    /// nativa dell'app, mai la webview, e solo con la modalità sviluppatore
    /// accesa. La cartella si legge con le porte dell'installazione
    /// ([`crate::theme::theme_link`]); se è pronta (e il suo id non è di un
    /// tema installato) il suo percorso canonico va nella chiave
    /// [`crate::settings::DEVELOPER_THEME_FOLDER`] sotto il lucchetto del suo
    /// id, e l'osservatore si rimonta su di lei. Un rifiuto lascia il
    /// collegamento di prima.
    pub fn link_theme_folder(
        &self,
        source: &camino::Utf8Path,
    ) -> Result<crate::theme::ThemeFolderLink, PluginError> {
        self.theme_folder_allowed()?;
        let folder = source
            .canonicalize_utf8()
            .unwrap_or_else(|_| source.to_owned());
        let (link, recorded) =
            crate::theme::link_folder(self.config_dir.as_deref(), &folder, || {
                let _turn = self
                    .local_keys_turn
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                self.machine.set(
                    crate::settings::DEVELOPER_THEME_FOLDER,
                    fub_abi::settings::SettingValue::Text(folder.to_string()),
                )
            })?;
        if !recorded {
            return Ok(crate::theme::ThemeFolderLink::Refused { link });
        }
        // La stessa cartella collegata di nuovo si guarda da capo; chi chiama è
        // già fuori dal thread principale.
        self.theme_keeper
            .watch_now(self.config_dir.as_deref(), Some(&folder), true);
        let mut link = link;
        link.watched = self.theme_keeper.is_watching(&folder);
        self.tell_observer(crate::settings::DEVELOPER_THEME_FOLDER)?;
        Ok(crate::theme::ThemeFolderLink::Linked { link })
    }

    /// «Scollega»: azzera la chiave e smonta l'osservatore. Senza modalità
    /// sviluppatore, come buttare un permesso: si può sempre.
    pub fn unlink_theme_folder(&self) -> Result<(), PluginError> {
        {
            let _turn = self
                .local_keys_turn
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            self.machine
                .reset(crate::settings::DEVELOPER_THEME_FOLDER)?;
        }
        self.tell_observer(crate::settings::DEVELOPER_THEME_FOLDER)
    }

    /// La modalità sviluppatore ([`crate::settings::DEVELOPER_MODE`]), riletta
    /// a ogni chiamata: spenta, o illeggibile, vuol dire no
    /// (`PermissionDenied`). L'app la chiede prima di aprire la finestra di
    /// scelta, e le due chiamate qui sotto la richiedono da sé.
    pub fn theme_folder_allowed(&self) -> Result<(), PluginError> {
        let on = matches!(
            self.machine.effective(crate::settings::DEVELOPER_MODE),
            Ok((fub_abi::settings::SettingValue::Toggle(true), _))
        );
        if on {
            Ok(())
        } else {
            Err(PluginError::PermissionDenied(fub_abi::Text::key(
                "host.theme_folder.developer_off",
            )))
        }
    }

    /// Il titolo della finestra di scelta nativa di «Installa da cartella…»,
    /// nella lingua di chi guarda. Lo decide l'host e non la webview: quella
    /// finestra è il punto in cui la persona dà il suo permesso.
    pub fn theme_folder_pick_title(&self) -> String {
        let mut title = fub_abi::Text::key("host.theme_folder.pick_title");
        self.localize_core(None, &mut title);
        title.to_string()
    }

    /// Scarta la cartella controllata, se c'è: la persona ha risposto «no» a
    /// «Sostituisci», la shell l'ha rifiutata col suo cancello, o sta per
    /// aprire una finestra di scelta nuova. Senza modalità sviluppatore: un
    /// permesso si può sempre buttare.
    pub fn forget_theme_folder(&self) {
        self.theme_folder_grant().forget();
    }

    pub(super) fn theme_folder_grant(
        &self,
    ) -> std::sync::MutexGuard<'_, crate::theme::ThemeFolderGrant> {
        self.theme_folder
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Legge la cartella di chi scrive un tema senza installarla
    /// ([`crate::theme::check_theme_folder`]), solo con la modalità
    /// sviluppatore accesa. `source` lo dà soltanto la finestra di scelta
    /// nativa dell'app, mai la webview: una cartella pronta resta qui come
    /// **la** cartella controllata, ed è il permesso di installarla una volta
    /// sola. Un controllo nuovo prende il posto del precedente; un rifiuto lo
    /// scarta. Un controllo o uno scarto arrivati mentre questo legge vincono:
    /// questo non dà più il permesso.
    pub fn check_theme_folder(
        &self,
        source: &camino::Utf8Path,
    ) -> Result<crate::theme::ThemeFolderCheck, PluginError> {
        let generation = self.theme_folder_grant().forget();
        self.theme_folder_allowed()?;
        let check = crate::theme::check_theme_folder(source);
        if let Ok(crate::theme::ThemeFolderCheck::Ready {
            digest, manifest, ..
        }) = &check
        {
            self.theme_folder_grant().grant(
                generation,
                crate::theme::CheckedThemeFolder {
                    source: source.to_owned(),
                    digest: digest.clone(),
                    manifest: manifest.clone(),
                    replace_only: false,
                },
            );
        }
        check.map_err(Into::into)
    }

    /// Installa la cartella che [`Host::check_theme_folder`] ha controllato
    /// ([`crate::theme::install_theme_from_folder`]), solo con la modalità
    /// sviluppatore accesa e solo se `digest` è l'impronta di quel controllo:
    /// la webview dice quale controllo ha visto, non quale path installare.
    ///
    /// Il controllo è un permesso che vale **una volta e per un esito**: la
    /// chiamata lo consuma. Una collisione lo rinnova solo per la risposta
    /// «Sostituisci» (`replace`), una volta; il «no», un rifiuto del cancello
    /// della shell o una scelta nuova lo scartano
    /// ([`Host::forget_theme_folder`]). Dopo una collisione una chiamata
    /// senza `replace` vale come quel «no»: consuma il permesso e risponde
    /// `Unchecked`, e un «Sostituisci» che arriva dopo trova `Unchecked` anche
    /// lui. La persona sceglie di nuovo la cartella, come dopo un «no» nella
    /// finestra. Senza permesso, o con un'impronta che
    /// non è la sua, l'esito è `Unchecked` e niente si scrive; un'impronta
    /// diversa non tocca il permesso di un controllo più recente.
    ///
    /// La regola sta qui e non nel bottone che la shell nasconde: la chiave si
    /// rilegge a ogni chiamata, quindi spegnerla fra la collisione e
    /// «Sostituisci» ferma la richiesta che arriva dopo (`PermissionDenied`).
    pub fn install_theme_from_folder(
        &self,
        replace: bool,
        digest: &str,
    ) -> Result<crate::theme::ThemeFolderInstall, PluginError> {
        self.theme_folder_allowed()?;
        let dir = self.config_dir.as_deref().ok_or_else(|| {
            PluginError::Unserved(fub_abi::Text::key("host.theme_folder.unavailable"))
        })?;
        let Some((generation, pending)) = self.theme_folder_grant().take(digest) else {
            return Ok(crate::theme::ThemeFolderInstall::Unchecked);
        };
        if pending.replace_only && !replace {
            // Il «no» alla domanda: il permesso preso non torna.
            return Ok(crate::theme::ThemeFolderInstall::Unchecked);
        }
        let outcome = crate::theme::install_theme_from_folder(dir, &pending, replace);
        if matches!(outcome, crate::theme::ThemeFolderInstall::Collision { .. }) && !replace {
            // Solo se niente ha controllato o scartato nel frattempo.
            self.theme_folder_grant().rearm(generation, pending);
        }
        Ok(outcome)
    }
}
