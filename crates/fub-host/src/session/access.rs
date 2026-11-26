//! Avvisi della sessione, chiusura del vault e accesso alla sessione corrente.

use super::*;

impl Host {
    /// **Scrivere si dice**, anche quando a scrivere non è stato un vault.
    ///
    /// Con un vault aperto l'evento lo emette il `Workspace`, e chi ascolta —
    /// la tastiera, che rilegge gli accordi; il pannello, che si ridisegna — non
    /// sa da dove venga. Senza vault il `Workspace` non c'è, e senza questa riga
    /// una scorciatoia rimappata nella finestra vuota resterebbe scritta, letta
    /// e mostrata giusta mentre la tastiera continua a rispondere a quella
    /// vecchia: è il difetto che la 0090 aveva già trovato una volta per l'altra
    /// metà della stessa famiglia, e la risposta è la stessa.
    ///
    /// [`Actor::User`], perché di qui passa la persona davanti allo schermo: è
    /// la stessa distinzione per cui `set_setting` è un comando IPC e non
    /// `settings.set` del registro.
    /// **La porta dell'avviso di sessione** (§25.5): la diagnosi «la cartella
    /// di configurazione non si può scrivere» — o non c'è — come
    /// `Event::Trouble` di severità `Warning`, consegnata **una volta** per
    /// sessione.
    ///
    /// Perché è un tiraggio e non una spinta: la diagnosi nasce in
    /// `install_logging`, prima che questo host esista e che qualunque
    /// ascoltatore sia in piedi — il ponte verso la webview nasce solo al primo
    /// vault aperto ([`Host::open`]), e la shell si iscrive agli eventi ancora
    /// dopo. Una spinta a quell'ora sarebbe un evento emesso nel vuoto: verde e
    /// muta. L'unico istante garantito è un comando chiesto dalla shell
    /// **dopo** che il router è attaccato, e questo metodo è il suo lato host.
    ///
    /// Il `take` rende la «una volta per sessione» strutturale: la seconda
    /// chiamata — da un secondo comando, da un secondo thread — trova `None` e
    /// non consegna niente. Niente `AtomicU32`: la forma di
    /// [`Custodia::denuncia`](crate::custodia::Custodia) serve a chi deve
    /// rispondere a **ogni** chiamata, e qui la diagnosi nasce una volta e si
    /// consuma una volta. L'origine è `Kernel` (0012): la diagnosi non è di
    /// nessun altro — non l'ha chiesta la persona e non l'ha prodotta un
    /// plugin.
    ///
    /// Dopo la diagnosi vengono gli avvisi di [`Self::with_startup_notice`],
    /// uno per chiamata: la shell tira finché la risposta è `None`.
    pub fn session_notice(&self) -> Option<Notice> {
        let warning = self
            .session_notice
            .lock()
            .unwrap_or_else(|and| and.into_inner())
            .take();
        let Some(warning) = warning else {
            return self
                .startup_notices
                .lock()
                .unwrap_or_else(|and| and.into_inner())
                .pop_front();
        };
        Some(Notice::new(
            fub_abi::Event::Trouble {
                severity: fub_abi::event::Severity::Warning,
                subject: None,
                error: PluginError::Io(warning.into()),
                gate: None,
            },
            fub_abi::event::Origin::by(fub_abi::event::Actor::Kernel),
        ))
    }

    /// # È la **seconda uscita**, e non passa dal ponte
    ///
    /// Zona cieca dichiarata: qui non c'è nessun vault, quindi non c'è nessun
    /// bus e nessun thread del ponte, quindi il conto del debito di
    /// `bridge::consegna` non copre questa riga. Di consegne fuori dal ponte ce
    /// n'è **una** [conta: uscite-fuori-dal-ponte], ed è questa; la si è
    /// scoperta perché il `#[must_use]` di [`EventSink::emit`] l'ha resa
    /// rumorosa, mentre prima era una chiamata il cui esito nessuno guardava.
    ///
    /// Ciò che non si fa è rispondere `Err`: la scrittura è **fatta**, e dire di
    /// no a chi ha scritto sarebbe mentire su un file che è già cambiato. Ciò
    /// che si fa è dirlo, perché l'unico modo in cui questo caso finiva era in
    /// silenzio.
    pub(super) fn tell_observer(&self, key: &str) -> Result<(), PluginError> {
        if key == crate::settings::DEVELOPER_MODE || key == crate::settings::DEVELOPER_THEME_FOLDER
        {
            // L'osservatore del tema collegato segue le due chiavi.
            self.sync_theme_link();
        }
        if let Some(sink) = &self.sink {
            // Una chiave della macchina non è di nessun vault.
            let delivers = sink.emit(
                &fub_abi::Notice::new(
                    fub_abi::Event::SettingChanged {
                        key: key.to_string(),
                        scope: fub_abi::settings::SettingScope::Machine,
                    },
                    fub_abi::event::Origin::by(fub_abi::event::Actor::User),
                ),
                None,
            );
            if delivers == Delivery::Dropped {
                tracing::error!(
                    target: "fub.host",
                    key = key,
                    "l'impostazione è scritta ma non l'ha saputo nessuno: chi ascolta \
                     — la tastiera, il pannello — continua a rispondere al valore \
                     vecchio finché non si riapre"
                );
            }
        }
        Ok(())
    }

    /// C'è un vault corrente? È la domanda che distingue «la shell sta lavorando
    /// su un archivio» da «la finestra è aperta e basta», e la pone chi deve
    /// decidere se una domanda si può servire senza vault.
    /// Un `fub://` che il sistema ha consegnato all'app: resta in coda finché
    /// la shell non lo prende con `uri.pending`, anche se arriva prima che
    /// la shell esista. `false` se la coda è piena e l'URI resta fuori. Un
    /// nuovo tentativo di una cattura già in coda o già scritta (stesso
    /// `nonce`) non si accoda di nuovo, e non è un rifiuto: dà `true`.
    pub fn receive_uri(&self, raw: &str) -> bool {
        self.uris.push(raw) != crate::uri_inbox::Received::Refused
    }

    pub fn has_current_vault(&self) -> bool {
        self.sessions.read().is_ok_and(|s| s.current().is_some())
    }

    /// Il promemoria costa una riscrittura del registro, quindi si paga solo
    /// quando la chiave è di quella famiglia — che è quasi mai.
    pub(super) fn if_key_remember_it(
        &self,
        vault: Option<&str>,
        key: &str,
    ) -> Result<(), PluginError> {
        if fub_abi::settings::command_of_keybinding_key(key).is_none() {
            return Ok(());
        }
        self.remember_seen_keys(vault)
    }

    /// Cosa, dei tasti di questo vault, l'utente ha guardato: ciò che il file
    /// porta **meno** ciò che resta sospeso.
    ///
    /// Una espressione sola per tutte e due le risposte, e il fatto che sia la
    /// stessa non è un'economia: dopo un «usa le sue» non c'è più niente di
    /// sospeso e ci finisce dentro tutto; dopo un «tieni le mie» il file non
    /// porta più niente di ciò che era in discussione. Ciò che resta escluso in
    /// entrambi i casi è la stessa cosa — le chiavi che nessuno dichiara, che
    /// non sono state mostrate e quindi non sono state approvate.
    pub(super) fn remember_seen_keys(&self, vault: Option<&str>) -> Result<(), PluginError> {
        let (root, seen) = self.in_session(vault, |session| {
            let ws = session.workspace.read()?;
            let suspended = ws.suspended_settings();
            let mut seen = ws.vault_keybindings();
            seen.retain(|key, _| !suspended.contains(key));
            Ok((session.root.clone(), seen))
        })?;
        self.vaults.handle().notes_keys_seen(&root, seen)
    }

    /// Chiude **un** vault: flush, `close` degli indici, disattivazione di ogni
    /// plugin (§9.5). Un vault che non è aperto è un errore, non un no-op: chi
    /// chiude nomina qualcosa che crede aperto.
    ///
    /// Se era il corrente, corrente diventa un altro dei vault aperti — o
    /// nessuno, se non ne restano.
    pub fn close_vault(&self, root: &Utf8Path) -> Result<Vec<PluginError>, PluginError> {
        // **Fuori dal prestito esclusivo**, perché nel ramo che non conosce il
        // nome dato questa riga chiede al disco: e il lock che ferma ogni
        // comando dell'host non attraversa una domanda al filesystem.
        let root = self.key(root)?;
        let token = Arc::new(ClosingToken);
        let session = {
            let mut sessions = self.sessions.write()?;
            let Some(slot) = sessions.slots.get_mut(&root) else {
                return Err(PluginError::NotFound(
                    format!("Nessun vault aperto su {root}.").into(),
                ));
            };
            match slot {
                SessionSlot::Open(_) => {
                    let SessionSlot::Open(session) =
                        std::mem::replace(slot, SessionSlot::Closing(Arc::clone(&token)))
                    else {
                        unreachable!("lo slot verificato era aperto")
                    };
                    *session
                }
                SessionSlot::Closing(_) => return Err(closing_conflict(&root)),
                SessionSlot::Applying(_) => return Err(applying_conflict(&root)),
            }
        };
        // I disegni del vault cadono con lui, fuori dal lock delle sessioni;
        // un gesto in corso tiene il suo finché non finisce.
        self.drawings.forget_vault(&session.root);
        // Il claim conserva il marker, ma non la guardia della mappa: watcher,
        // runner e provider terminano tutti fuori dal lock delle sessioni.
        Ok(CloseClaim {
            sessions: &self.sessions,
            resources: Some(&self.resources),
            root,
            token,
            session: Some(session),
        }
        .close())
    }

    /// Chiude **tutti** i vault aperti: è ciò che fa chi spegne l'app.
    ///
    /// «Chiuderne uno» e «chiuderli tutti» sono lo stesso codice, ed è la
    /// ragione per cui il §9.5 e il §9.6 sono stati decisi insieme.
    ///
    /// Fra vault diversi **non c'è un ordine che conti**: due vault non si
    /// conoscono, non condividono provider e non condividono spazio dati.
    /// L'ordine che conta è dentro ciascuno — l'inverso della dichiarazione dei
    /// suoi plugin — e lo tiene [`Workspace::close`].
    pub fn close(&self) -> Vec<PluginError> {
        let claimed =
            {
                let mut sessions = match self.sessions.write() {
                    Ok(sessions) => sessions,
                    Err(and) => return vec![and],
                };
                if let Some(root) = sessions.slots.iter().find_map(|(root, slot)| {
                    matches!(slot, SessionSlot::Applying(_)).then_some(root)
                }) {
                    return vec![applying_conflict(root)];
                }
                let mut claimed = Vec::new();
                for (root, slot) in &mut sessions.slots {
                    if matches!(slot, SessionSlot::Open(_)) {
                        let token = Arc::new(ClosingToken);
                        let SessionSlot::Open(session) =
                            std::mem::replace(slot, SessionSlot::Closing(Arc::clone(&token)))
                        else {
                            unreachable!("lo slot verificato era aperto")
                        };
                        claimed.push((root.clone(), token, *session));
                    }
                }
                claimed
            };
        let claimed: Vec<_> = claimed
            .into_iter()
            .map(|(root, token, session)| CloseClaim {
                sessions: &self.sessions,
                resources: Some(&self.resources),
                root,
                token,
                session: Some(session),
            })
            .collect();
        self.drawings.forget_all();
        // Costruire prima tutti i claim è parte della garanzia di unwind: se
        // una chiusura panica, gli elementi non ancora visitati vengono
        // comunque lasciati cadere e ritirano ciascuno il proprio marker.
        claimed.into_iter().flat_map(CloseClaim::close).collect()
    }

    /// Restituisce la diagnostica tipizzata conservata dall'apertura del vault.
    pub fn startup_diagnostics(
        &self,
        vault: Option<&str>,
    ) -> Result<Vec<PluginError>, PluginError> {
        self.with_session(vault, VaultSession::startup_diagnostics)
    }

    /// I vault aperti, in ordine di path.
    pub fn vaults(&self) -> Vec<Utf8PathBuf> {
        // Queste due firme un canale d'errore non ce l'hanno, e non gliene si
        // aggiunge uno per un caso in cui la porta ha **già** scritto la sua
        // riga: chi chiede quali vault siano aperti riceve ciò che se ne sa
        // ancora, che è niente.
        self.sessions
            .read()
            .map(|s| {
                s.slots
                    .iter()
                    .filter(|(_, slot)| matches!(slot, SessionSlot::Open(_)))
                    .map(|(root, _)| root.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Il vault corrente, se ce n'è uno.
    pub fn current(&self) -> Option<Utf8PathBuf> {
        self.sessions.read().ok().and_then(|s| s.current().cloned())
    }

    /// Rende corrente un vault già aperto.
    ///
    /// Passa da [`become_current`](Host::diventa_corrente) come `open`, e per
    /// la ragione che rende quella funzione una sola: **sceglierlo è usarlo**.
    /// Chi torna su un vault e poi spegne l'app deve ritrovarselo in cima ai
    /// recenti, o l'elenco racconterebbe l'ultimo *montaggio* invece
    /// dell'ultimo lavoro — e sarebbe di nuovo un ordine che dice una cosa e un
    /// corrente che ne dice un'altra.
    pub fn set_current(&self, root: &Utf8Path) -> Result<(), PluginError> {
        self.become_current(&self.key(root)?)
    }

    /// Fa qualcosa con una sessione: quella nominata, o la corrente se `vault` è
    /// `None`.
    ///
    /// È il punto unico in cui «quale vault» si risolve, ed è per questo che
    /// nessun chiamante deve saperlo: la shell passa ciò che ha (spesso niente),
    /// e chi ne ha due passa quale.
    pub(crate) fn with_session<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&VaultSession) -> R,
    ) -> Result<R, PluginError> {
        // La chiave si risolve **prima** del prestito, per la ragione di
        // [`key`](Host::key): nel ramo che non conosce il nome dato c'è
        // una domanda al disco, e il prestito delle sessioni non la attraversa.
        let named = vault
            .map(|path| self.key(Utf8Path::new(path)))
            .transpose()?;
        let sessions = self.sessions.read()?;
        let key = match named {
            Some(key) => key,
            None => sessions
                .current()
                .cloned()
                .ok_or_else(|| PluginError::NotFound("Nessun vault aperto.".into()))?,
        };
        Ok(f(sessions.session(&key)?))
    }

    /// Come [`with_session`](Host::with_session), per chi **dentro** la sessione
    /// può fallire — cioè per chiunque prenda un prestito del workspace, da
    /// quando prenderlo è una domanda che può rispondere di no (decisione 0120).
    ///
    /// Esiste per non lasciare in giro `Result<Result<_, _>, _>`: due errori
    /// della stessa specie, uno dentro l'altro, si appiattiscono qui una volta
    /// invece che a ogni chiamante.
    pub(crate) fn in_session<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&VaultSession) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.with_session(vault, f)?
    }

    /// La radice canonica della sessione di `vault` (`None`: la corrente).
    pub(crate) fn session_root(&self, vault: Option<&str>) -> Result<Utf8PathBuf, PluginError> {
        self.with_session(vault, |session| session.root.clone())
    }

    /// Il valore di alcune chiavi del vault, e da dove viene ciascuno: per
    /// chi deve sapere se una chiave sta davvero nel file (`crate::componenti`).
    pub(crate) fn settings_with_source(
        &self,
        vault: Option<&str>,
        keys: &[&str],
    ) -> Result<
        Vec<(
            fub_abi::settings::SettingValue,
            fub_abi::settings::SettingSource,
        )>,
        PluginError,
    > {
        self.read_workspace(vault, |workspace| {
            keys.iter()
                .map(|key| workspace.setting_source(key))
                .collect()
        })
    }

    /// Scrive (`Some`) o azzera (`None`) chiavi del vault per conto
    /// dell'utente, in un turno solo. Solo per chiavi che non sono di
    /// macchina e non sono scorciatoie: chi le ha (`crate::componenti`) lo sa.
    pub(crate) fn write_vault_settings(
        &self,
        vault: Option<&str>,
        writes: Vec<(&str, Option<fub_abi::settings::SettingValue>)>,
    ) -> Result<(), PluginError> {
        self.write_workspace(vault, |workspace| {
            for (key, value) in writes {
                match value {
                    Some(value) => workspace.set_setting(key, value)?,
                    None => workspace.reset_setting(key)?,
                }
            }
            Ok(())
        })
    }

    /// Chiude e riapre il vault di `root` (canonica), per ciò che si decide
    /// solo montando: i formati registrati, come la lavagna. Il lease di
    /// scrittura resta di questo processo fra la chiusura e la riapertura,
    /// come per lo snapshot; il corrente resta quello di prima.
    ///
    /// **E lo dice a chi guarda.** La chiusura esce dal ponte come
    /// `VaultClosed`; il `VaultOpened` della riapertura invece no, perché il
    /// kernel lo emette durante la scansione, prima che il ponte nuovo si
    /// abboni (è voluto: l'apertura non è un temporale di eventi). Senza un
    /// secondo avviso la shell vedrebbe un vault chiuso e mai riaperto: qui
    /// lo si emette sul bus del vault riaperto, che lo porta soltanto agli
    /// abbonati (il ponte, cioè `fub://event`) e non agli handler dei plugin,
    /// che il loro `VaultOpened` l'hanno già ricevuto dal kernel. Vale per
    /// ogni strada che arriva qui: `components_apply` dell'app e il canale di
    /// controllo (CLI, MCP).
    pub(crate) fn remount(&self, root: &Utf8Path) -> Result<Vec<PluginError>, PluginError> {
        let current = self.current();
        let _writer = self.writer_lease(root)?;
        let faults = self.close_vault(root)?;
        self.open(root)?;
        self.read_workspace(Some(root.as_str()), |workspace| {
            workspace
                .bus()
                .emit(Notice::of(fub_abi::Event::VaultOpened {
                    root: workspace.root().to_string(),
                }));
            Ok(())
        })?;
        if let Some(current) = current.filter(|current| current != root) {
            self.set_current(&current)?;
        }
        Ok(faults)
    }

    /// Esegue una lettura breve sul workspace selezionato. La custodia non
    /// attraversa questa porta: i consumer dell'host ricevono operazioni, non
    /// l'oggetto monolitico che le implementa.
    pub(super) fn read_workspace<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&Workspace) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.in_session(vault, |session| {
            let workspace = session.workspace.read()?;
            f(&workspace)
        })
    }

    /// Gemello esclusivo di [`read_workspace`](Self::read_workspace). Resta
    /// privato proprio per impedire che il vecchio `Host::workspace` rinasca
    /// come una closure generica esposta ai consumer.
    pub(super) fn write_workspace<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&mut Workspace) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        // Fuori dal prestito delle sessioni, per la ragione di `query_index`:
        // il drenaggio consegna gli eventi agli handler dei plugin.
        with_event_drain(&self.session_workspace(vault)?, f)?
    }

    /// La custodia del workspace di una sessione, **fuori** dal prestito delle
    /// sessioni.
    ///
    /// Chi chiama un provider, un handler o altro codice esterno parte da qui:
    /// tenere `sessions.read()` durante quella chiamata è la regola che
    /// `CLAUDE.md` vieta per il workspace, e un writer in attesa su `sessions`
    /// (aprire, chiudere) basta a trasformarla in un blocco circolare.
    pub(super) fn session_workspace(
        &self,
        vault: Option<&str>,
    ) -> Result<Custody<Workspace>, PluginError> {
        self.with_session(vault, |session| session.workspace.clone())
    }
}
