//! Aprire un vault, ripristinare una fotografia, montare e smontare le cartelle.

use super::*;

impl Host {
    /// Apre un vault — monta, prepara il subscriber temporaneo, avvia il
    /// rilevatore, scansiona, registra il subscriber live e accende il ponte —
    /// e lo rende **corrente**.
    ///
    /// Un vault **già aperto** non si riapre: diventa corrente e basta. Prima
    /// riaprirlo voleva dire buttare la sessione e rifarla, con la scansione da
    /// ripagare e il lock dell'indice da riprendere — e se la seconda apertura
    /// falliva non si tornava alla prima. Succedeva riaprendo lo stesso vault
    /// dal dialogo, e in sviluppo a ogni ricarica della pagina.
    ///
    /// **Le due vie escono dallo stesso posto**, e non è un vezzo: finché la
    /// via corta usciva per conto suo, riaprire un vault già aperto ne
    /// spostava il corrente e lasciava i recenti nell'ordine vecchio — cioè
    /// l'unica delle due cose che l'utente rivede al prossimo avvio.
    pub fn open(&self, root: &Utf8Path) -> Result<VaultInfo, PluginError> {
        let root_is_directory = match std::fs::metadata(root.as_std_path()) {
            Ok(metadata) if metadata.is_dir() => true,
            Ok(_) => {
                return Err(PluginError::NotFound(
                    format!("Non è una cartella valida: {root}").into(),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => {
                return Err(PluginError::Io(
                    format!("non riesco a leggere {root}: {error}").into(),
                ));
            }
        };
        if !root_is_directory {
            let parent = root
                .parent()
                .filter(|parent| !parent.as_str().is_empty())
                .unwrap_or(Utf8Path::new("."));
            let parent_is_directory = std::fs::metadata(parent.as_std_path())
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false);
            if !parent_is_directory {
                return Err(PluginError::NotFound(
                    format!("Non è una cartella valida: {root}").into(),
                ));
            }
        }
        let recovery_root = snapshot_recovery_root(root)?;
        let existing_root = root_is_directory.then(|| canonical(root)).transpose()?;
        let (root, writer) = if let Some(root) = existing_root {
            let already_open = {
                let sessions = self.sessions.read()?;
                match sessions.slots.get(&root) {
                    Some(SessionSlot::Open(session)) => Some(info_of(session)?),
                    Some(SessionSlot::Closing(_)) => return Err(closing_conflict(&root)),
                    Some(SessionSlot::Applying(_)) => return Err(applying_conflict(&root)),
                    None => None,
                }
            };
            if let Some(info) = already_open {
                self.become_current(&root)?;
                return Ok(info);
            }
            // Il lease prima della recovery: anche completare uno snapshot
            // interrotto è scrivere nel vault.
            let writer = self.writer_lease(&root)?;
            fub_kernel::snapshot::recover_snapshots(&recovery_root)
                .map_err(|error| PluginError::Io(error.to_string().into()))?;
            if root != recovery_root {
                fub_kernel::snapshot::recover_snapshots(&root)
                    .map_err(|error| PluginError::Io(error.to_string().into()))?;
            }
            (root, writer)
        } else {
            let writer = self.writer_lease(&recovery_root)?;
            fub_kernel::snapshot::recover_snapshots(&recovery_root)
                .map_err(|error| PluginError::Io(error.to_string().into()))?;
            if !root.is_dir() {
                // `NotFound` e non `BadArgs`: chi arriva qui ha scelto una cartella
                // da un dialogo, o ha riaperto un recente. Non ha sbagliato a
                // scrivere — quella cartella non c'è (più).
                return Err(PluginError::NotFound(
                    format!("Non è una cartella valida: {root}").into(),
                ));
            }
            let root = canonical(root)?;
            if root != recovery_root {
                // La radice nominata si risolve altrove: il lease giusto è il
                // suo, non quello del nome.
                let writer = self.writer_lease(&root)?;
                fub_kernel::snapshot::recover_snapshots(&root)
                    .map_err(|error| PluginError::Io(error.to_string().into()))?;
                (root, writer)
            } else {
                (root, writer)
            }
        };

        let _phase = tracing::info_span!(target: "fub.apertura", "open").entered();
        let info = self.mounts(&root, writer)?;
        self.become_current(&root)?;
        Ok(info)
    }

    /// Esegue la recovery di eventuali snapshot globali lasciati da un crash
    /// mentre il vault è chiuso. Prende lo stesso claim `Applying` di
    /// [`Host::apply_snapshot`], anche quando la root live è assente, e non
    /// prende il lock del workspace.
    pub fn recover_snapshot_artifacts(
        &self,
        root: &Utf8Path,
    ) -> Result<fub_kernel::snapshot::SnapshotRecoveryReport, SnapshotHostError> {
        if root.exists() && !root.is_dir() {
            return Err(SnapshotHostError::Lifecycle(PluginError::NotFound(
                format!("Non è una cartella valida: {root}").into(),
            )));
        }
        let recovery_root = if root.is_dir() {
            canonical(root).map_err(SnapshotHostError::Lifecycle)?
        } else {
            snapshot_recovery_root(root).map_err(SnapshotHostError::Lifecycle)?
        };
        let claim = self.claim_snapshot(&recovery_root)?;
        let result = fub_kernel::snapshot::recover_snapshots(&recovery_root).map_err(Into::into);
        drop(claim);
        result
    }

    /// Applica uno snapshot globale con il vault chiuso e lo riapre.
    ///
    /// Il chiamante deve fornire la radice già canonica e priva di symlink:
    /// l'applicazione non accetta alias, perché il record persistente deve
    /// restare recuperabile anche se il nome alternativo sparisce.
    ///
    /// Un vault aperto o in chiusura viene rifiutato invece di tentare una
    /// quiescenza implicita: watcher, job e provider devono essere terminati
    /// dal chiamante tramite [`Host::close_vault`] prima dell'I/O offline.
    pub fn apply_snapshot(
        &self,
        root: &Utf8Path,
        snapshot: &fub_kernel::snapshot::SnapshotBundle,
    ) -> Result<fub_kernel::snapshot::SnapshotApplyReport, SnapshotHostError> {
        if !root.is_dir() {
            return Err(SnapshotHostError::Lifecycle(PluginError::NotFound(
                format!("Non è una cartella valida: {root}").into(),
            )));
        }
        let canonical_root = canonical(root).map_err(SnapshotHostError::Lifecycle)?;
        if canonical_root != root {
            return Err(SnapshotHostError::Lifecycle(PluginError::Conflict(
                format!("La radice snapshot deve essere canonica: {root}.").into(),
            )));
        }
        let claim = self.claim_snapshot(&canonical_root)?;
        let report = fub_kernel::snapshot::apply_snapshot(&canonical_root, snapshot)?;
        self.mounts_after_apply(&canonical_root, claim.token(), claim.writer())
            .map_err(SnapshotHostError::Reopen)?;
        self.become_current(&canonical_root)
            .map_err(SnapshotHostError::Reopen)?;
        drop(claim);
        Ok(report)
    }

    pub(super) fn claim_snapshot(
        &self,
        root: &Utf8Path,
    ) -> Result<ApplyClaim<'_>, SnapshotHostError> {
        let token = Arc::new(ApplyingToken);
        let writer = self
            .writer_lease(root)
            .map_err(SnapshotHostError::Lifecycle)?;
        let mut sessions = self
            .sessions
            .write()
            .map_err(SnapshotHostError::Lifecycle)?;
        if sessions.slots.contains_key(root) {
            return Err(SnapshotHostError::Lifecycle(applying_conflict(root)));
        }
        sessions
            .slots
            .insert(root.to_owned(), SessionSlot::Applying(Arc::clone(&token)));
        Ok(ApplyClaim {
            sessions: &self.sessions,
            root: root.to_owned(),
            token,
            writer,
        })
    }

    /// Il lease di scrittura su `root` (canonica): quello che questo processo
    /// tiene già, se una sessione o uno snapshot lo possiede, altrimenti preso
    /// dal disco senza aspettare.
    ///
    /// Un altro processo che lo tiene dà un `Conflict` con
    /// [`E_WRITER_BUSY`](crate::automation::E_WRITER_BUSY): due scrittori sullo
    /// stesso vault (l'app e la CLI, due finestre di due istanze) non si
    /// sovrascrivono a vicenda, si rifiutano all'apertura.
    pub(crate) fn writer_lease(
        &self,
        root: &Utf8Path,
    ) -> Result<Arc<VaultWriterLock>, PluginError> {
        let mut writers = self
            .writers
            .lock()
            .map_err(|_| PluginError::Internal("i lease di scrittura sono avvelenati".into()))?;
        if let Some(held) = writers.get(root).and_then(std::sync::Weak::upgrade) {
            return Ok(held);
        }
        writers.retain(|_, lease| lease.strong_count() > 0);
        let lock = crate::automation::lock_vault_writer(root.as_std_path()).map_err(|error| {
            if error.kind() == std::io::ErrorKind::WouldBlock {
                PluginError::Conflict(Text::message(
                    crate::automation::E_WRITER_BUSY,
                    vec![Arg::text("root", root.as_str())],
                ))
            } else {
                PluginError::Io(
                    format!("non riesco a prendere il lock di scrittura di {root}: {error}").into(),
                )
            }
        })?;
        let lease = Arc::new(lock);
        writers.insert(root.to_owned(), Arc::downgrade(&lease));
        Ok(lease)
    }

    /// Il montaggio vero e proprio, che è la via lunga di [`open`](Host::open):
    /// monta, prende il writer turn di apertura, avvia il rilevatore, scansiona,
    /// registra il subscriber live, accende il ponte e avvia il pool, e
    /// mette la sessione nella mappa. **Non decide chi è corrente**: quello lo
    /// fa chi l'ha chiamata, con la stessa riga che lo fa per un vault che era
    /// già aperto.
    pub(super) fn mounts(
        &self,
        root: &Utf8Path,
        writer: Arc<VaultWriterLock>,
    ) -> Result<VaultInfo, PluginError> {
        self.mounts_with_info(root, info_of, writer)
    }

    pub(super) fn mounts_after_apply(
        &self,
        root: &Utf8Path,
        token: Arc<ApplyingToken>,
        writer: Arc<VaultWriterLock>,
    ) -> Result<VaultInfo, PluginError> {
        self.mounts_with_claim(root, info_of, Some(token), writer)
    }

    /// Variante privata che rende iniettabile la sola lettura pre-pubblicazione.
    ///
    /// Il seam resta dentro il modulo: i test possono far fallire `VaultInfo`
    /// senza avvelenare un lock o aggiungere una leva all'API pubblica.
    pub(super) fn mounts_with_info(
        &self,
        root: &Utf8Path,
        session_info: impl Fn(&VaultSession) -> Result<VaultInfo, PluginError>,
        writer: Arc<VaultWriterLock>,
    ) -> Result<VaultInfo, PluginError> {
        self.mounts_with_claim(root, session_info, None, writer)
    }

    pub(super) fn mounts_with_claim(
        &self,
        root: &Utf8Path,
        session_info: impl Fn(&VaultSession) -> Result<VaultInfo, PluginError>,
        applying: Option<Arc<ApplyingToken>>,
        writer: Arc<VaultWriterLock>,
    ) -> Result<VaultInfo, PluginError> {
        let root = root.to_owned();
        // Il supporto si apre prima di ogni lettura dentro la radice: il
        // registro dei mount e il workspace stanno sullo stesso.
        let storage = self
            .storage
            .open(&root)
            .map_err(|source| fub_kernel::KernelError::InvalidRoot {
                path: root.clone(),
                source,
            })
            .map_err(PluginError::from)?;
        let external_mounts = MountRegistry::load(&*storage, &fub_kernel::FsStorage, &root)
            .map_err(PluginError::from)?;
        let startup = self
            .startup_source
            .as_ref()
            .map(|source| {
                fub_kernel::safety::external(
                    "startup source preparation",
                    |message| PluginError::Internal(message.into()),
                    || source.prepare(),
                )
            })
            .unwrap_or_else(|| Ok(StartupSnapshot::new(Vec::new())));
        let StartupSnapshot {
            bundles: startup_bundles,
            formats: mut prepared_formats,
            diagnostics: mut startup_diagnostics,
            validity: startup_validity,
            lease: startup_lease,
        } = match startup {
            Ok(snapshot) => snapshot,
            Err(error @ (PluginError::Cancelled(_) | PluginError::Conflict(_))) => {
                return Err(error)
            }
            Err(error) => {
                tracing::warn!(
                    target: "fub.host",
                    startup_source_error = ?error,
                    "startup source unavailable; continuing without startup bundles"
                );
                StartupSnapshot::new(Vec::new())
            }
        };
        startup_diagnostics.extend(external_mounts.diagnostics().iter().map(|diagnostic| {
            PluginError::Io(
                format!(
                    "mount {} disattivato ({}): {}",
                    diagnostic.name, diagnostic.target, diagnostic.message
                )
                .into(),
            )
        }));
        for diagnostic in &startup_diagnostics {
            tracing::warn!(
                target: "fub.host",
                startup_diagnostic = ?diagnostic,
                "startup diagnostic"
            );
        }
        let independent_formats = self
            .format_source
            .as_ref()
            .map(|source| {
                fub_kernel::safety::external(
                    "format source preparation",
                    |message| PluginError::Internal(message.into()),
                    || source.prepare(),
                )
            })
            .unwrap_or_else(|| Ok(crate::PreparedFormatSource::empty()));
        let independent_formats = match independent_formats {
            Ok(formats) => formats,
            Err(error) => {
                for cleanup_error in prepared_formats.dispose() {
                    tracing::error!(
                        target: "fub.host",
                        cleanup_error = ?cleanup_error,
                        "prepared format cleanup failed after independent source error"
                    );
                }
                return Err(error);
            }
        };
        prepared_formats.extend(independent_formats);
        let crate::mount::Mounted {
            workspace: mut ws,
            mut registry,
            format_resources,
            format_diagnostics,
            #[cfg(feature = "versioning")]
            versions,
        } = crate::mount::mount_with_formats(
            &root,
            Arc::clone(&storage),
            Arc::clone(&self.machine),
            Arc::clone(&self.view_states),
            Arc::clone(&self.system_locale),
            &self.levels,
            prepared_formats,
            self.configuration_root(),
            self.network.clone(),
            Arc::clone(&self.clock),
        )
        // Le tre cose che fanno fallire il montaggio sono un formato di serie
        // in conflitto con un altro formato di serie, un bundle di core che non
        // si monta — ciò che questo binario si porta dietro — e, da quando
        // l'apertura verifica la radice (0160), un posto che non esiste, che
        // non è una cartella o su cui non si ha permesso di scrivere. Un
        // provider esterno in conflitto non fa cadere il vault: è rifiutato da
        // solo e finisce nella diagnostica di apertura.
        .map_err(|and| PluginError::Internal(and.into()))?;
        for diagnostic in &format_diagnostics {
            tracing::warn!(
                target: "fub.host",
                startup_diagnostic = ?diagnostic,
                "startup diagnostic"
            );
        }
        startup_diagnostics.extend(format_diagnostics);

        // **I temi installati sulla macchina** (§29.4): l'unica porta è il
        // `BundleRegistry` appena montato, come per le feature ufficiali —
        // niente seconda porta. Il tema di serie è già nella tabella di
        // `mount`; qui si aggiungono quelli che stanno in
        // `config_dir/themes/<id>/` (vedi [`themes_dir`](crate::config::themes_dir)).
        // Un tema **spento** (`plugins.disabled`) resta conosciuto e non si
        // accende: «spento» e «non c'è» sono due stati, ed è la riga di
        // [`BundleInfo::mounted`](crate::registry::BundleInfo::mounted).
        //
        // Un tema rotto non blocca l'apertura del vault: è un tema, non il
        // vault — la stessa regola del bundle ufficiale che non si monta. Ma si
        // dice, e nel log: un tema che esiste e non entra non deve sparire
        // senza una parola.
        if let Some(config_dir) = &self.config_dir {
            let disabled = crate::settings::disabled_plugins(&ws);
            let (themes, errors) = crate::theme::discover_themes(config_dir);
            for theme in themes {
                let bundle = std::sync::Arc::new(theme);
                let (id, remembered) = registry.remember_first(bundle);
                if !remembered {
                    tracing::error!(
                        target: "fub.host",
                        "theme `{id}` skipped: id already claimed"
                    );
                    continue;
                }
                if !disabled.contains(&id) {
                    if let Err(and) = registry.enable(&mut ws, &id) {
                        tracing::error!(target: "fub.host", "theme not mounted: {and}");
                    }
                }
            }
            for problem in errors {
                tracing::error!(target: "fub.host", "theme skipped: {problem}");
            }
        }
        // I bundle del composition root entrano per ultimi: feature ufficiali,
        // temi di macchina e la prima voce di startup che rivendica un id non
        // possono essere sostituiti da una voce successiva.
        let mut requested = Vec::new();
        for startup in startup_bundles {
            let (bundle, should_enable, claim) = startup.parts();
            let (id, known) = BundleRegistry::claimed(bundle, claim);
            let mut candidate = Some(known);
            match registry.remember_claimed(&mut candidate) {
                Ok(_) => {
                    if should_enable {
                        requested.push(id);
                    }
                }
                Err(error) => {
                    tracing::error!(
                        target: "fub.host",
                        "startup bundle `{id}` skipped: {error}"
                    );
                }
            }
        }
        for (id, error) in registry.enable_in_dependency_order(&mut ws, requested) {
            tracing::error!(target: "fub.host", "startup bundle `{id}` not mounted: {error}");
        }

        let registry = Custody::new("i componenti montati", registry);

        // **I tasti che questo vault propone e che nessuno ha guardato**
        // (§23.13). Qui, e non più tardi: da questa riga in poi il vault è
        // utilizzabile — la scansione parte subito sotto — e una scorciatoia che
        // fosse attiva anche per un solo istante sarebbe un tasto premuto.
        //
        // La regola la scrive `crate::settings::keys_to_watch` e la sospende
        // il kernel: il criterio ha bisogno di una cosa che nel vault non c'è —
        // cosa questa macchina ha già visto — e uno store di configurazione che
        // leggesse il registro dei vault per rispondere a una lettura sarebbe il
        // kernel che conosce l'installazione.
        let suspended = crate::settings::keys_to_watch(
            &ws.vault_keybindings(),
            &self.vaults.handle().seen_keys(&root),
        );
        ws.suspend_settings(suspended);

        let workspace = Custody::new("il vault aperto", ws);

        // Il turno di apertura serializza ogni writer fino a subscriber e job
        // installati, ma non è il `RwLock`: sia `IndexProvider::up_to_date` sia
        // `WatcherFactory::start` girano fuori dalla guardia e possono rientrare
        // sul workspace. La transazione possiede turno, risorse e thread: ogni
        // uscita prima della pubblicazione libera il turno, ferma watcher e
        // runner, quindi percorre il teardown completo.
        let mut opening = OpeningTransaction::new(
            &workspace,
            &registry,
            storage,
            format_resources,
            startup_diagnostics,
            startup_lease,
        );
        let watching = {
            let ws = opening.workspace().write()?;
            ws.watch_flag()
        };
        let watcher_workspace = opening.workspace().clone();
        opening
            .watcher()
            .start(self.watcher.as_ref(), &root, watcher_workspace, watching)?;
        let prepared_scan = {
            let ws = opening.workspace().write()?;
            ws.prepare_scan_vault().map_err(PluginError::from)?
        };
        let completed_scan = prepared_scan.invoke();
        let (work, index_job, work_total, live) = with_event_drain(opening.workspace(), |ws| {
            let work = ws.finalize_scan_vault(completed_scan);
            let work_total = work.total();
            let live = if self.sink.is_some() {
                Some(ws.bus().subscribe())
            } else {
                None
            };
            let index_job = ws.begin_index_job();
            (work, index_job, work_total, live)
        })?;

        if let (Some(sink), Some(live)) = (&self.sink, live) {
            crate::bridge::spawn(live, sink.clone(), root.to_string());
        }

        // **La seconda fase nasce dopo il subscriber live**, e l'ordine è la
        // sostanza: `begin_index_job` emette un `JobStarted`, cioè la prima riga
        // del racconto dell'apertura; il thread del ponte parte subito dopo,
        // drenando ciò che il subscriber ha già accodato.
        let unread: Custody<Vec<UnreadDoc>> = Custody::empty("gli scarti dell'apertura");
        let indexed = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let in_progress = crate::runner::InProgress {
            id: index_job,
            total: work_total,
            work,
            unread: unread.clone(),
            end: Arc::clone(&indexed),
        };

        // Il pool parte dopo la scansione e riceve la seconda fase dell'apertura.
        let runner = JobRunner::start(
            opening.workspace().clone(),
            opening.registry().clone(),
            self.job_threads,
            Some(in_progress),
        )?;
        opening.set_runner(runner);
        opening.finish_session(
            root.clone(),
            unread,
            indexed,
            #[cfg(feature = "versioning")]
            versions,
            external_mounts,
            writer,
        );

        // **Chi arriva secondo lascia cadere ciò che ha montato.** Il controllo
        // in cima non basta: fra lì e qui il lock delle sessioni è libero — deve
        // esserlo, o montare un vault fermerebbe ogni altro comando per tutta la
        // scansione — quindi due aperture concorrenti sulla stessa radice ci
        // arrivano entrambe. Inserire e basta vorrebbe dire che una delle due
        // sessioni sparisce dalla mappa **senza essere chiusa**: indici mai
        // messi al sicuro, `Plugin::deactivate` mai chiamato, e il rilevatore
        // dell'altra ancora vivo su un vault che nessuno guarda più.
        //
        // Quello che questo **non** ripara, ed è nominato: le due aperture hanno
        // già montato entrambe, e il lock del writer di tantivy lo prende una
        // sola: se lo prende la perdente, la sessione che resta è quella senza
        // ricerca — un avviso, non un errore («indice di ricerca non
        // disponibile»). Chiudere la perdente rilascia quel lock, ma non lo
        // ridà alla vincente. Toglierlo davvero vuol dire non far montare due
        // volte, cioè una porta d'ingresso che serializza le aperture sulla
        // stessa radice, ed è una decisione che va a verbale — la metà del
        // §15.7 che resta aperta, cioè la **forma** dell'apertura: la 0068 le
        // ha tolto il tutto-o-niente, non la sincronia.
        let (info, loser) = {
            let mut sessions = self.sessions.write()?;
            match sessions.slots.get(&root) {
                Some(SessionSlot::Open(winner)) => {
                    // Ha vinto l'altro: la sessione buona è la sua — riaprire
                    // un vault già aperto non lo rimonta. Anche se leggerne le
                    // informazioni fallisce, la perdente viene trasferita
                    // soltanto dopo e chiusa fuori dal lock.
                    let info = session_info(winner);
                    let (session, lease) = opening.into_session_with_lease();
                    (info, Some((session, lease)))
                }
                Some(SessionSlot::Closing(_)) => {
                    // La pubblicazione ha perso contro una chiusura iniziata
                    // mentre il mount era in corso. Il marker non si sovrascrive.
                    let (session, lease) = opening.into_session_with_lease();
                    (Err(closing_conflict(&root)), Some((session, lease)))
                }
                Some(SessionSlot::Applying(current)) => {
                    let owns = applying
                        .as_ref()
                        .is_some_and(|expected| Arc::ptr_eq(expected, current));
                    if !owns {
                        let (session, lease) = opening.into_session_with_lease();
                        (Err(applying_conflict(&root)), Some((session, lease)))
                    } else {
                        match session_info(opening.session()) {
                            Ok(info) => {
                                let validity = startup_validity
                                    .as_ref()
                                    .map(|validity| validity.read())
                                    .transpose()?;
                                if validity.as_ref().is_some_and(|valid| !**valid) {
                                    (
                                        Err(PluginError::Conflict(
                                            "La decisione dei componenti è cambiata durante l'apertura."
                                                .into(),
                                        )),
                                        None,
                                    )
                                } else {
                                    let (session, lease) = opening.into_session_with_lease();
                                    sessions
                                        .slots
                                        .insert(root.clone(), SessionSlot::Open(Box::new(session)));
                                    drop(lease);
                                    (Ok(info), None)
                                }
                            }
                            Err(error) => (Err(error), None),
                        }
                    }
                }
                None => match session_info(opening.session()) {
                    // `VaultInfo` è l'ultima operazione fallibile. Il token di
                    // startup viene letto soltanto dopo: la sua guardia resta
                    // viva attraverso controllo e inserimento, così una
                    // invalidazione conclusa non può essere scavalcata.
                    Ok(info) => {
                        let validity = startup_validity
                            .as_ref()
                            .map(|validity| validity.read())
                            .transpose()?;
                        if validity.as_ref().is_some_and(|valid| !**valid) {
                            (
                                Err(PluginError::Conflict(
                                    "La decisione dei componenti è cambiata durante l'apertura."
                                        .into(),
                                )),
                                None,
                            )
                        } else {
                            let (session, lease) = opening.into_session_with_lease();
                            sessions
                                .slots
                                .insert(root.clone(), SessionSlot::Open(Box::new(session)));
                            drop(lease);
                            (Ok(info), None)
                        }
                    }
                    Err(error) => (Err(error), None),
                },
            }
        };
        // Chiudere la sessione perdente sta **fuori** dal lock delle sessioni,
        // anche quando ha perso contro un marker di chiusura. Ogni errore viene
        // denunciato senza sostituire l'esito primario dell'apertura.
        if let Some((loser, lease)) = loser {
            for error in loser.close() {
                tracing::error!(target: "fub.host", "losing session close failed: {error}");
            }
            drop(lease);
        }
        info
    }

    /// **Un vault diventa il corrente**, e questa è l'unica riga che lo dice.
    ///
    /// Due cose insieme, ed è la ragione per cui è una funzione sola:
    ///
    /// - l'**ordine d'uso** dei vault aperti, da cui il corrente si legge
    ///   ([`Sessions::corrente`]) e da cui si rilegge da sé quando il corrente
    ///   si chiude;
    /// - il **timbro nel registro** (§11.1), che è l'ordine in cui l'utente
    ///   rivede i recenti al prossimo avvio.
    ///
    /// Erano due cose in due posti, e ogni chiamante ne aggiornava un
    /// sottoinsieme diverso: aprire un vault già aperto spostava il corrente e
    /// non i recenti, `set_current` non toccava nessuno dei due, e chi chiudeva
    /// il corrente sceglieva il successore con un terzo criterio ancora. Un
    /// posto solo, e il criterio è lo stesso per tutti perché è **la stessa
    /// espressione**.
    ///
    /// Il vault entra fra i conosciuti **dopo** un'apertura riuscita e non
    /// prima: un path che non si apre non è un vault recente, è un errore — e
    /// un elenco di recenti pieno di cartelle che non aprono è peggio di un
    /// elenco vuoto.
    pub(super) fn become_current(&self, root: &Utf8Path) -> Result<(), PluginError> {
        if !self.sessions.write()?.make_current(root)? {
            return Err(PluginError::NotFound(
                format!("Nessun vault aperto su {root}.").into(),
            ));
        }
        // Il registro sta **fuori** dal lock delle sessioni: scrive sul disco,
        // e tenerlo dentro fermerebbe ogni comando dell'host per il tempo di
        // una scrittura di comodità.
        if let Err(and) = self
            .vaults
            .handle()
            .notes_opened(root, fub_kernel::time::now_unix_millis())
        {
            // Solo log: il registro dei recenti è una comodità, non il vault,
            // e non scriversi non perde un dato dell'utente — perde al più un
            // path nell'elenco di chi è stato aperto. Pavimento e basta (0062).
            tracing::warn!(target: "fub.host", "registro dei vault: {and}");
        }
        Ok(())
    }
}
