//! Il disco che cambia da fuori: ingest, sincronizzazione dei path, rinomine esterne, recupero.

use super::*;

impl Workspace {
    pub(super) fn ingest(&mut self, id: &DocId, source: &str) -> Result<()> {
        let model = self.docs.parse(id, source)?;
        self.ingest_model(id, model, Revision::of(source), None);
        Ok(())
    }

    /// La coda di ogni scrittura: indici, conteggi tag, grafo, metadati in
    /// cache, eventi. Prende il modello già parsato — è ciò che permette a
    /// `write_document` di parsare prima di toccare il disco.
    ///
    /// `posato` è **dimensione e data di ciò che sta sul disco, per chi le sa
    /// già**: chi ha appena scritto le ha ricevute dal supporto insieme
    /// all'esito, e non deve tornare a chiederle (difetto 0179, vedi
    /// [`set_entry`](Workspace::set_entry)). `None` per chi porta dentro un
    /// cambiamento che non ha fatto lui.
    pub(super) fn prepare_ingest_model(
        &mut self,
        id: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
        placed: Option<(u64, u64)>,
        journal: JournalOp,
    ) -> PreparedDocumentFeed {
        // L'anagrafe segue ogni scrittura (§14.1): dimensione, data e impronta
        // di un documento appena scritto sono cambiate, e una voce ferma a
        // prima direbbe che il file è quello di ieri — a chi la interroga
        // adesso, e alla prossima apertura, che sull'anagrafe decide cosa
        // rileggere.
        // **Prima** di toccare qualunque cosa: è l'unico momento in cui il
        // vecchio e il nuovo esistono insieme (§22.2, decisione 0069). Un
        // istante più in là l'anagrafe ha l'impronta nuova, `self.tags` i tag
        // nuovi e `self.metas` i metadati nuovi, e dire *cosa* è cambiato
        // costerebbe una lettura del disco invece di zero.
        let changes = self.indexes.core.changes_for(&model, &fingerprint);
        match placed {
            Some((size, mtime)) => {
                self.set_entry(id, size, mtime, Some(fingerprint.clone()));
            }
            None => {
                self.touch_entry(id, Some(fingerprint.clone()));
            }
        }
        // Gli indici vedono la modifica dalla stessa operazione del grafo:
        // stessa verità, nessun canale che può perdere pezzi per strada. E la
        // vedono sul modello intero, che il feed preparato qui porta agli
        // indici esterni fuori dal prestito: è l'unico momento in cui corpo e
        // testo esistono — la cache tiene i soli metadati.
        // Un lotto di uno: la scrittura singola È il caso normale, e la firma
        // a lotti non la trasforma in un'eccezione da spiegare.
        let lost = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let providers = self.indexes.feed_handles();
        PreparedDocumentFeed {
            id: id.clone(),
            model: Some(model),
            changes,
            revision: fingerprint,
            journal,
            providers,
            losses: lost,
        }
    }

    pub(super) fn ingest_model(
        &mut self,
        id: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
        placed: Option<(u64, u64)>,
    ) {
        let pending = self.prepare_ingest_model(
            id,
            model,
            fingerprint,
            placed,
            JournalOp::Written {
                doc: id.clone(),
                from: None,
                to: Revision::of(""),
            },
        );
        let pending = pending.invoke_indexes();
        self.finish_index_feed(pending);
    }

    pub(super) fn finish_index_feed(&mut self, pending: PreparedDocumentFeed) {
        self.report_losses(pending.losses);
        if pending.model.is_some() && self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            // Il rebuild legge la cache: va aggiornata prima.
            self.indexes.core.rebuild_graph();
        }
        // Il sorgente sotto la selezione è cambiato: gli offset pubblicati
        // dalla shell erano di un altro testo. La shell ne ripubblicherà uno
        // vero al prossimo movimento del cursore (o subito dopo un
        // salvataggio); fino ad allora il contesto dice "non so dove", che è
        // la verità.
        self.session
            .invalidate(&pending.id, ContextChange::Rewritten);
        let changes = pending.model.map(|_| pending.changes);
        self.announce_file_change(pending.id, changes);
    }

    /// Accoda il fatto già committato prima che gli indici esterni possano
    /// rientrare e produrre una modifica successiva dello stesso documento.
    pub(super) fn announce_index_feed(&mut self, pending: &PreparedDocumentFeed) {
        let changes = pending.model.as_ref().map(|_| pending.changes.clone());
        self.announce_file_change(pending.id.clone(), changes);
    }

    pub(super) fn announce_file_change(&mut self, id: DocId, changes: Option<DocChanges>) {
        let event = match changes {
            Some(changes) => Event::DocumentChanged {
                id,
                changes: Some(changes),
            },
            None => {
                let kind = self
                    .indexes
                    .core
                    .entries
                    .get(&id)
                    .map(|entry| entry.kind)
                    .unwrap_or(EntryKind::Unknown);
                Event::EntryChanged { id, kind }
            }
        };
        self.emit_event(event);
        self.emit_event(Event::IndexUpdated);
    }

    /// Chiude il solo feed watcher. Perdite e frame appartengono alla callback
    /// e vanno sempre recuperati; grafo e sessione, invece, possono seguire il
    /// risultato preparato soltanto finché quella revisione è ancora corrente.
    pub(super) fn finish_sync_index_feed(&mut self, pending: PreparedDocumentFeed, current: bool) {
        self.report_losses(pending.losses);
        if !current {
            return;
        }
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        self.session
            .invalidate(&pending.id, ContextChange::Rewritten);
    }

    /// Sincronizza un path assoluto dopo un evento del filesystem: riparsa se
    /// esiste ed è un documento, aggiorna l'anagrafe se è un file di
    /// un'altra specie, toglie se è sparito. Restituisce `true` se qualcosa è
    /// cambiato. Path fuori dal vault o ignorati dal vault: nessun effetto.
    ///
    /// **Un file senza provider non è più «nessun effetto»** (§14.1): era il
    /// ramo con cui un PNG copiato nel vault a Fub aperto spariva senza
    /// lasciare traccia, e il vault dichiarava di non saperne niente fino alla
    /// riapertura successiva — cioè fino a quando la scansione lo avrebbe visto
    /// comunque. Adesso entra in anagrafe e lo annuncia, con gli eventi che
    /// nominano ciò che è: un allegato, non un documento.
    ///
    /// Il filtro dei path ignorati è lo **stesso** della scansione
    /// ([`Vault::is_ignored`](crate::vault::Vault::is_ignored)) e non una sua copia: le due porte d'ingresso del
    /// vault devono avere la stessa idea di cosa sta fuori, altrimenti una nota
    /// cestinata resterebbe cercabile.
    ///
    /// **Un fallimento resta scritto anche se il chiamante non lo legge** (§9.7):
    /// i due chiamanti veri sono nel callback del watcher e scrivevano
    /// `let _ = ws.sync_path(…)`, quindi un file esterno che non si legge o non
    /// si parsa lasciava la cache, il grafo e l'indice fermi a *prima*, per
    /// sempre, senza che niente lo dicesse. Adesso lo dice
    /// [`IndexQuery::VaultStatus`].
    ///
    /// La porta sincrona orchestra lo stesso protocollo staged del watcher:
    /// pianifica senza I/O, invoca il piano detached e applica il risultato
    /// attraverso l'unico percorso che gestisce feed, rimozioni e rinomine.
    pub fn sync_path(&mut self, abs: &Utf8Path) -> Result<bool> {
        let prepared = self.plan_sync(abs).map(SyncPlan::invoke);
        self.sync_path_prepared(abs, prepared)
    }

    /// Cattura la politica e lo storage necessari al filtro di un path.
    ///
    /// Questa metà non fa I/O; il watcher invoca il token dopo aver rilasciato
    /// `Custody`, quindi rientra con il solo esito.
    pub fn prepare_is_ignored(&self, abs: &Utf8Path) -> PreparedIgnoreCheck {
        self.docs.vault.prepare_is_ignored(abs)
    }

    /// Le cartelle che un rilevatore per-cartella deve guardare, con la
    /// politica di esclusione che vale **adesso** (§15.6).
    ///
    /// Nessun I/O: si risolve la politica e basta, come in
    /// [`prepare_is_ignored`](Self::prepare_is_ignored). Chi guarda la
    /// richiede a ogni lotto e la confronta con quella con cui sta guardando.
    pub fn watch_scope(&self) -> crate::ignore::WatchScope {
        crate::ignore::WatchScope::new(self.docs.vault.ignore_policy())
    }

    /// Prepara una lettura del watcher conservando la porta sincrona storica.
    ///
    /// I chiamanti sotto `Custody` usano invece [`prepare_is_ignored`] e
    /// [`plan_sync_admitted`], separando il possibile `stat` dalla
    /// pianificazione pura.
    pub fn plan_sync(&self, abs: &Utf8Path) -> Option<SyncPlan> {
        if self.prepare_is_ignored(abs).invoke() {
            return None;
        }
        self.plan_sync_admitted(abs)
    }

    /// Prepara un path che il filtro owned ha già ammesso.
    ///
    /// Non interroga lo storage e non ricalcola la politica di esclusione.
    pub fn plan_sync_admitted(&self, abs: &Utf8Path) -> Option<SyncPlan> {
        let id = self.docs.vault.doc_id_for_path(abs).ok()?;
        self.plan_sync_known(abs.to_owned(), id)
    }

    /// Classifica una rinomina esterna conservando la porta sincrona storica.
    pub fn plan_external_rename(&self, from: &Utf8Path, to: &Utf8Path) -> ExternalRenamePlan {
        let from_admitted = !self.prepare_is_ignored(from).invoke();
        let to_admitted = !self.prepare_is_ignored(to).invoke();
        self.plan_external_rename_admitted(from, from_admitted, to, to_admitted)
    }

    /// Classifica una rinomina dai due esiti già valutati fuori da `Custody`.
    ///
    /// Documenti e asset riconosciuti portano handle owned; ogni caso ambiguo
    /// degrada agli stessi piani `Touched` della consegna ordinaria. Questa
    /// funzione non interroga lo storage né ricalcola il filtro.
    pub fn plan_external_rename_admitted(
        &self,
        from: &Utf8Path,
        from_admitted: bool,
        to: &Utf8Path,
        to_admitted: bool,
    ) -> ExternalRenamePlan {
        let sync_plan = |path: &Utf8Path, admitted: bool| {
            admitted.then(|| self.plan_sync_admitted(path)).flatten()
        };
        let fallback = |only_to: bool| {
            let paths = if only_to {
                vec![(to.to_owned(), to_admitted)]
            } else {
                vec![
                    (from.to_owned(), from_admitted),
                    (to.to_owned(), to_admitted),
                ]
            };
            ExternalRenamePlan::Sync(
                paths
                    .into_iter()
                    .map(|(path, admitted)| {
                        let plan = sync_plan(&path, admitted);
                        (path, plan)
                    })
                    .collect(),
            )
        };
        let identity = |path: &Utf8Path, admitted: bool| {
            admitted
                .then(|| self.docs.vault.doc_id_for_path(path).ok())
                .flatten()
        };
        let (Some(from_id), Some(to_id)) =
            (identity(from, from_admitted), identity(to, to_admitted))
        else {
            return fallback(false);
        };
        if from_id == to_id {
            return fallback(true);
        }

        let from_entry = self.indexes.core.entries.get(&from_id).cloned();
        let to_entry = self.indexes.core.entries.get(&to_id).cloned();
        let destination_free = to_entry.is_none() && !self.indexes.core.metas.contains_key(&to_id);
        let from_document = self.indexes.core.metas.contains_key(&from_id);
        let to_has_provider = self
            .docs
            .registry
            .provider_for_ext(&extension_of(&to_id).unwrap_or_default())
            .is_some();
        let to_kind = media::kind_of_ext(&to_id, |ext| self.docs.registry.has_doc_ext(ext));
        if from_document && destination_free && to_has_provider {
            let Some(from_entry) = from_entry.clone() else {
                return fallback(false);
            };
            let Some(descriptor) = self
                .docs
                .registry
                .descriptor_for_ext(&extension_of(&to_id).unwrap_or_default())
            else {
                return fallback(false);
            };
            let Ok(parser) = self.docs.prepare_parse(&to_id) else {
                return fallback(false);
            };
            let side_data = self.prepare_rename_side_data(&from_id, &to_id);
            return ExternalRenamePlan::Document(Box::new(PreparedExternalDocumentRename {
                snapshot: ExternalRenameSnapshot {
                    workspace_id: self.workspace_id,
                    from_path: from.to_owned(),
                    to_path: to.to_owned(),
                    from_id,
                    to_id,
                    from_entry,
                    to_entry,
                    syntax_generation: self.syntax_generation,
                    routing_generation: self.indexes.routing_generation(),
                },
                storage: Arc::clone(self.docs.vault.storage()),
                parser,
                source_kind: descriptor.source,
                side_data,
            }));
        }

        let from_has_provider = self
            .docs
            .registry
            .provider_for_ext(&extension_of(&from_id).unwrap_or_default())
            .is_some();
        let Some(from_entry) = from_entry else {
            return fallback(false);
        };
        if !destination_free
            || from_entry.kind != EntryKind::Asset
            || from_has_provider
            || to_has_provider
            || to_kind != EntryKind::Asset
        {
            return fallback(false);
        }

        let fallback_plans = [
            (from.to_owned(), from_admitted),
            (to.to_owned(), to_admitted),
        ]
        .into_iter()
        .map(|(path, admitted)| {
            let plan = sync_plan(&path, admitted);
            (path, plan)
        })
        .collect();
        ExternalRenamePlan::Asset(Box::new(PreparedExternalAssetRename {
            snapshot: ExternalRenameSnapshot {
                workspace_id: self.workspace_id,
                from_path: from.to_owned(),
                to_path: to.to_owned(),
                from_id,
                to_id,
                from_entry,
                to_entry,
                syntax_generation: self.syntax_generation,
                routing_generation: self.indexes.routing_generation(),
            },
            storage: Arc::clone(self.docs.vault.storage()),
            organization: Arc::clone(&self.organization),
            doc_data_roots: self.docs.plugin_data_roots(),
            fallback: fallback_plans,
        }))
    }

    /// Riconvalida la fotografia e installa remove+feed nel solo core.
    ///
    /// `None` è una rinomina **che non si è potuta convalidare**: destinazione
    /// sparita, instabile o illeggibile, oppure una fotografia che il workspace
    /// ha superato. Il file però si è spostato lo stesso, e chi chiama
    /// riconcilia i due path (`from` e `to` di
    /// [`paths`](ParsedExternalDocumentRename::paths)) come due `Touched`: senza,
    /// l'id vecchio restava in anagrafe fino alla riapertura.
    pub fn prepare_external_document_rename(
        &mut self,
        parsed: ParsedExternalDocumentRename,
    ) -> Result<Option<PendingExternalDocumentRename>> {
        let ParsedExternalDocumentRename {
            snapshot,
            state,
            side_data,
        } = parsed;
        let (model, fingerprint, stat) = match state {
            ParsedExternalDocumentState::Ready {
                model,
                fingerprint,
                stat,
            } => (model, fingerprint, stat),
            ParsedExternalDocumentState::Unverified => return Ok(None),
        };
        let current_from = self.indexes.core.entries.get(&snapshot.from_id);
        let current_to = self.indexes.core.entries.get(&snapshot.to_id);
        if snapshot.workspace_id != self.workspace_id
            || self
                .docs
                .vault
                .doc_id_for_path(&snapshot.from_path)
                .ok()
                .as_ref()
                != Some(&snapshot.from_id)
            || self
                .docs
                .vault
                .doc_id_for_path(&snapshot.to_path)
                .ok()
                .as_ref()
                != Some(&snapshot.to_id)
            || current_from != Some(&snapshot.from_entry)
            || current_to != snapshot.to_entry.as_ref()
            || !self.indexes.core.metas.contains_key(&snapshot.from_id)
            || self.indexes.core.metas.contains_key(&snapshot.to_id)
            || snapshot.from_entry.fingerprint != self.entry_fingerprint(&snapshot.from_id)
            || snapshot.syntax_generation != self.syntax_generation
            || snapshot.routing_generation != self.indexes.routing_generation()
            || model.id != snapshot.to_id
        {
            return Ok(None);
        }
        let removal = self
            .prepare_document_rename_removal(&snapshot.from_id)?
            .expect("il documento riconvalidato esiste");
        let changes = self.indexes.core.changes_for(&model, &fingerprint);
        let installed = VaultEntry {
            id: snapshot.to_id.clone(),
            kind: EntryKind::Document,
            size: stat.size,
            mtime: stat.mtime,
            fingerprint: Some(fingerprint.clone()),
        };
        self.indexes.core.ensure_folders_of(&snapshot.to_id);
        self.indexes.core.set_entry(installed.clone());
        let losses = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let feed = PreparedDocumentFeed {
            id: snapshot.to_id.clone(),
            model: Some(*model),
            changes,
            revision: fingerprint,
            journal: JournalOp::Renamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
            },
            providers: self.indexes.feed_handles(),
            losses,
        };
        self.session.invalidate(
            &snapshot.from_id,
            ContextChange::Renamed(snapshot.to_id.clone()),
        );
        self.as_actor(Actor::Watcher, |ws| {
            ws.record(JournalOp::Renamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
            });
            ws.emit_event(Event::DocumentRenamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
            });
            ws.emit_event(Event::IndexUpdated);
        });
        Ok(Some(PendingExternalDocumentRename {
            snapshot,
            installed,
            removal,
            feed,
            side_data,
        }))
    }

    /// Recupera sempre frame, perdite e warning; grafo e note di sync seguono
    /// il token soltanto se il core installato è ancora corrente.
    pub fn finish_external_document_rename(
        &mut self,
        completed: CompletedExternalDocumentRename,
    ) -> std::result::Result<bool, Box<(PluginError, CompletedExternalDocumentRename)>> {
        if completed.snapshot.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict(
                    "la rinomina documento appartiene a un altro workspace".into(),
                ),
                completed,
            )));
        }
        let CompletedExternalDocumentRename {
            snapshot,
            installed,
            removal,
            feed,
            side_data,
        } = completed;
        let removal_losses = match self.finish_document_rename_removal(removal) {
            Ok(losses) => losses,
            Err(removal) => {
                return Err(Box::new((
                    PluginError::Conflict(
                        "la rimozione della rinomina appartiene a un altro workspace".into(),
                    ),
                    CompletedExternalDocumentRename {
                        snapshot,
                        installed,
                        removal,
                        feed,
                        side_data,
                    },
                )));
            }
        };
        self.report_losses(removal_losses);
        self.report_losses(feed.losses);
        self.report_rename_side_data(side_data);
        let current = !self.indexes.core.entries.contains_key(&snapshot.from_id)
            && self.indexes.core.entries.get(&snapshot.to_id) == Some(&installed)
            && self.entry_fingerprint(&snapshot.to_id) == installed.fingerprint
            && self.indexes.core.metas.contains_key(&snapshot.to_id)
            && snapshot.syntax_generation == self.syntax_generation
            && snapshot.routing_generation == self.indexes.routing_generation();
        if !current {
            return Ok(false);
        }
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        let outcome: Result<bool> = Ok(true);
        self.notes_sync(&snapshot.to_path, &outcome);
        Ok(true)
    }

    /// Applica soltanto al core un asset già osservato sul path d'arrivo.
    /// Nessun filesystem, sidecar o provider viene attraversato qui.
    pub fn prepare_external_asset_rename(
        &mut self,
        parsed: ParsedExternalAssetRename,
    ) -> Option<PendingExternalAssetRename> {
        let ParsedExternalAssetRename {
            snapshot,
            stat,
            fingerprint,
            organization,
            storage,
            doc_data_roots,
        } = parsed;
        let current_from = self.indexes.core.entries.get(&snapshot.from_id);
        let current_to = self.indexes.core.entries.get(&snapshot.to_id);
        if snapshot.workspace_id != self.workspace_id
            || self
                .docs
                .vault
                .doc_id_for_path(&snapshot.from_path)
                .ok()
                .as_ref()
                != Some(&snapshot.from_id)
            || self
                .docs
                .vault
                .doc_id_for_path(&snapshot.to_path)
                .ok()
                .as_ref()
                != Some(&snapshot.to_id)
            || current_from != Some(&snapshot.from_entry)
            || current_to != snapshot.to_entry.as_ref()
            || snapshot.from_entry.fingerprint != self.entry_fingerprint(&snapshot.from_id)
            || self.indexes.core.metas.contains_key(&snapshot.to_id)
            || snapshot.syntax_generation != self.syntax_generation
            || snapshot.routing_generation != self.indexes.routing_generation()
        {
            return None;
        }
        let installed = VaultEntry {
            id: snapshot.to_id.clone(),
            kind: snapshot.from_entry.kind,
            size: stat.size,
            mtime: stat.mtime,
            fingerprint: Some(fingerprint),
        };
        self.as_actor(Actor::Watcher, |ws| {
            ws.indexes.core.remove_entry(&snapshot.from_id);
            ws.indexes.core.ensure_folders_of(&snapshot.to_id);
            ws.indexes.core.set_entry(installed.clone());
            ws.record(JournalOp::Renamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
            });
            ws.emit_event(Event::EntryRenamed {
                from: snapshot.from_id.clone(),
                to: snapshot.to_id.clone(),
                kind: installed.kind,
            });
            ws.emit_event(Event::IndexUpdated);
        });
        Some(PendingExternalAssetRename {
            snapshot,
            installed,
            organization,
            storage,
            doc_data_roots,
        })
    }

    /// Recupera sempre i warning detached; l'epilogo derivato resta subordinato
    /// all'identità installata dal token.
    pub fn finish_external_asset_rename(
        &mut self,
        completed: CompletedExternalAssetRename,
    ) -> std::result::Result<bool, Box<(PluginError, CompletedExternalAssetRename)>> {
        if completed.snapshot.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict("la rinomina asset appartiene a un altro workspace".into()),
                completed,
            )));
        }
        let CompletedExternalAssetRename {
            snapshot,
            installed,
            doc_data_errors,
        } = completed;
        for error in doc_data_errors {
            self.doc_data_warnings.push(format!(
                "lo stato per-documento di {} non ha potuto seguire la rinomina in {} — {error}",
                snapshot.from_id, snapshot.to_id
            ));
        }
        let current = !self.indexes.core.entries.contains_key(&snapshot.from_id)
            && self.indexes.core.entries.get(&snapshot.to_id) == Some(&installed)
            && self.entry_fingerprint(&snapshot.to_id) == installed.fingerprint
            && snapshot.syntax_generation == self.syntax_generation
            && snapshot.routing_generation == self.indexes.routing_generation();
        Ok(current)
    }

    /// Compone un piano da un'identità già recintata e filtrata.
    ///
    /// Non interroga il vault: la riconciliazione d'apertura usa questa metà
    /// dopo che la propria scansione detached ha deciso i candidati.
    pub(super) fn plan_sync_known(&self, path: Utf8PathBuf, id: DocId) -> Option<SyncPlan> {
        let ext = extension_of(&id).unwrap_or_default();
        let entry = self.indexes.core.entries.get(&id).cloned();
        let seen = entry.as_ref().and_then(|entry| entry.fingerprint.clone());
        let action = if let (Some(descriptor), Ok(parser)) = (
            self.docs.registry.descriptor_for_ext(&ext),
            self.docs.prepare_parse(&id),
        ) {
            SyncPlanAction::Parse {
                storage: Arc::clone(self.docs.vault.storage()),
                parser: Box::new(parser),
                source_kind: descriptor.source,
                already_ingested: self.indexes.core.metas.contains_key(&id),
            }
        } else {
            SyncPlanAction::Stat {
                storage: Arc::clone(self.docs.vault.storage()),
            }
        };
        Some(SyncPlan {
            snapshot: SyncSnapshot {
                workspace_id: self.workspace_id,
                path,
                id,
                seen,
                entry,
                syntax_generation: self.syntax_generation,
                routing_generation: self.indexes.routing_generation(),
            },
            action,
        })
    }

    /// Legge testo soltanto quando i due `stat` ai lati della lettura
    /// combaciano. Il percorso sincrono legacy usa ancora questa porta.
    ///
    /// Se dimensione o data cambiano, qualcun altro sta ancora scrivendo e
    /// questi byte sono una metà (difetto 0197).
    pub(super) fn source_if_stable(&self, id: &DocId) -> Result<Option<String>> {
        let Some(before) = self.docs.vault.stat(id) else {
            return Ok(None);
        };
        let source = self.docs.vault.read(id)?;
        let Some(after) = self.docs.vault.stat(id) else {
            return Ok(None);
        };
        Ok((before == after).then_some(source))
    }

    /// **Questi byte sono già quelli che il kernel ha in memoria?**
    ///
    /// L'impronta in anagrafe è quella dell'ultimo sorgente ingerito: se il
    /// file sul disco ne porta una uguale non c'è niente da fare: il modello in
    /// cache è già quello che un parse rifarebbe identico.
    ///
    /// È così che una scrittura si riconosce quando **rientra dal rilevatore**
    /// (difetto 0196). Ogni salvataggio del kernel passa da una rename, la
    /// rename è un evento del filesystem, e il lotto che ne segue riportava
    /// dentro il documento appena scritto: riletto, riparsato, reingerito, con
    /// un `DocumentChanged` a nome del rilevatore su una modifica che l'utente
    /// aveva appena fatto lui. Il conto si paga su ogni salvataggio di ogni
    /// nota.
    ///
    /// **Si riconosce dai byte e non dalla data**, e la differenza è
    /// correttezza: `mtime + size` è il criterio dell'anagrafe (§14.1) ma
    /// sbaglia nel verso caro — una scrittura altrui nello stesso millisecondo
    /// e della stessa lunghezza passerebbe per «immutato», e l'indice resterebbe
    /// fermo su un documento vecchio. L'impronta non ha quella finestra: costa
    /// la lettura del file, che il piano fa comunque, e non costa il parse né la
    /// coda di ingestione, che sono la parte cara.
    ///
    /// La cache dei metadati va **guardata insieme all'impronta**: un documento
    /// che sta in anagrafe ma non in cache — uno che alla scansione non si è
    /// potuto parsare — non è «già dentro», e va riprovato.
    pub(super) fn already_ingested(&self, id: &DocId, fingerprint: &Revision) -> bool {
        self.indexes.core.metas.contains_key(id)
            && self.entry_fingerprint(id).as_ref() == Some(fingerprint)
    }

    /// L'impronta che un piano porta con sé per rilevare una mutazione
    /// intervenuta prima della finalizzazione.
    pub(super) fn entry_fingerprint(&self, id: &DocId) -> Option<Revision> {
        self.indexes
            .core
            .entries
            .get(id)
            .and_then(|and| and.fingerprint.clone())
    }

    /// Valida e applica al solo core un risultato già invocato.
    ///
    /// Nessun filesystem o provider viene attraversato qui. Un token stale,
    /// una lettura instabile o un routing cambiato vengono scartati senza
    /// fallback e senza eventi.
    pub fn prepare_sync_path_prepared(
        &mut self,
        abs: &Utf8Path,
        prepared: Option<ParsedChange>,
    ) -> Result<Option<PendingSyncChange>> {
        let Some(parsed) = prepared else {
            return Ok(None);
        };
        let outcome = (|| {
            if parsed.snapshot.workspace_id != self.workspace_id
                || parsed.snapshot.path != abs
                || self.docs.vault.doc_id_for_path(abs).ok().as_ref() != Some(&parsed.snapshot.id)
                || self.indexes.core.entries.get(&parsed.snapshot.id)
                    != parsed.snapshot.entry.as_ref()
                || parsed.snapshot.syntax_generation != self.syntax_generation
                || parsed.snapshot.routing_generation != self.indexes.routing_generation()
            {
                return Ok(None);
            }
            let ParsedChange { snapshot, state } = parsed;
            match state {
                ParsedChangeState::Ready {
                    model,
                    fingerprint,
                    stat,
                } => {
                    self.indexes.ensure_mutation_available()?;
                    let previous_provider_call = self.dispatch.enter_provider_call();
                    let feed = self.as_actor(Actor::Watcher, |ws| {
                        let feed = ws.prepare_ingest_model(
                            &snapshot.id,
                            *model,
                            fingerprint,
                            Some((stat.size, stat.mtime)),
                            JournalOp::Written {
                                doc: snapshot.id.clone(),
                                from: snapshot.seen.clone(),
                                to: Revision::of(""),
                            },
                        );
                        ws.announce_index_feed(&feed);
                        feed
                    });
                    Ok(Some(PendingSyncChange {
                        snapshot,
                        state: PendingSyncState::Feed {
                            feed: Box::new(feed),
                            previous_provider_call,
                        },
                    }))
                }
                ParsedChangeState::Missing => {
                    let removal =
                        self.prepare_sync_document_removal(&snapshot.id)?
                            .map(|removal| PendingSyncChange {
                                snapshot,
                                state: PendingSyncState::Removal(removal),
                            });
                    Ok(removal)
                }
                ParsedChangeState::Entry(stat) => Ok(Some(PendingSyncChange {
                    snapshot,
                    state: PendingSyncState::Entry(stat),
                })),
                ParsedChangeState::Failed(error) => Err(error),
                ParsedChangeState::Unchanged(stat) => Ok(Some(PendingSyncChange {
                    snapshot,
                    state: PendingSyncState::Unchanged(stat),
                })),
                ParsedChangeState::Unstable => Ok(None),
            }
        })();
        self.notes_sync(abs, &outcome);
        outcome
    }

    /// Chiude feed, rimozione o aggiornamento d'anagrafe dopo la fase detached.
    ///
    /// Un errore conserva il token completo: in particolare una rimozione
    /// consegnata al workspace sbagliato deve poter tornare al proprietario,
    /// che è l'unico autorizzato a ripristinarne il frame provider.
    pub fn finish_sync_path_prepared(
        &mut self,
        completed: CompletedSyncChange,
    ) -> std::result::Result<bool, Box<(PluginError, CompletedSyncChange)>> {
        if completed.snapshot.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict("la sincronizzazione appartiene a un altro workspace".into()),
                completed,
            )));
        }
        let CompletedSyncChange { snapshot, state } = completed;
        match state {
            CompletedSyncState::Feed {
                feed,
                previous_provider_call,
            } => {
                self.dispatch.restore_provider_call(previous_provider_call);
                let current = self
                    .docs
                    .vault
                    .doc_id_for_path(&snapshot.path)
                    .ok()
                    .as_ref()
                    == Some(&snapshot.id)
                    && snapshot.routing_generation == self.indexes.routing_generation()
                    && snapshot.syntax_generation == self.syntax_generation
                    && self.entry_fingerprint(&snapshot.id).as_ref() == Some(&feed.revision);
                self.as_actor(Actor::Watcher, |ws| {
                    ws.finish_sync_index_feed(*feed, current)
                });
                Ok(current)
            }
            CompletedSyncState::Removal(removal) => {
                match self.finish_sync_document_removal(removal) {
                    Ok(()) => Ok(true),
                    Err((error, removal)) => Err(Box::new((
                        error,
                        CompletedSyncChange {
                            snapshot,
                            state: CompletedSyncState::Removal(removal),
                        },
                    ))),
                }
            }
            CompletedSyncState::Entry(stat) => {
                if self
                    .docs
                    .vault
                    .doc_id_for_path(&snapshot.path)
                    .ok()
                    .as_ref()
                    != Some(&snapshot.id)
                    || self.indexes.core.entries.get(&snapshot.id) != snapshot.entry.as_ref()
                    || snapshot.syntax_generation != self.syntax_generation
                    || snapshot.routing_generation != self.indexes.routing_generation()
                {
                    return Ok(false);
                }
                Ok(self.as_actor(Actor::Watcher, |ws| {
                    let before = ws.indexes.core.entries.get(&snapshot.id).cloned();
                    let Some(stat) = stat else {
                        let Some(kind) = ws.indexes.core.remove_entry(&snapshot.id) else {
                            return false;
                        };
                        ws.emit_event(Event::EntryRemoved {
                            id: snapshot.id,
                            kind,
                        });
                        return true;
                    };
                    let fingerprint = before.as_ref().and_then(|entry| {
                        (entry.size == stat.size && entry.mtime == stat.mtime)
                            .then(|| entry.fingerprint.clone())
                            .flatten()
                    });
                    let kind = ws.set_entry(&snapshot.id, stat.size, stat.mtime, fingerprint);
                    if ws.indexes.core.entries.get(&snapshot.id) == before.as_ref() {
                        return false;
                    }
                    ws.emit_event(Event::EntryChanged {
                        id: snapshot.id,
                        kind,
                    });
                    true
                }))
            }
            CompletedSyncState::Unchanged(stat) => {
                if self
                    .docs
                    .vault
                    .doc_id_for_path(&snapshot.path)
                    .ok()
                    .as_ref()
                    != Some(&snapshot.id)
                    || self.indexes.core.entries.get(&snapshot.id) != snapshot.entry.as_ref()
                    || snapshot.syntax_generation != self.syntax_generation
                    || snapshot.routing_generation != self.indexes.routing_generation()
                {
                    return Ok(false);
                }
                let Some(fingerprint) = snapshot.seen else {
                    return Ok(false);
                };
                self.set_entry(&snapshot.id, stat.size, stat.mtime, Some(fingerprint));
                Ok(false)
            }
        }
    }

    /// Compatibilità dei chiamanti kernel sincroni. Il watcher di processo usa
    /// le due porte separate sopra e non attraversa provider sotto `Custody`.
    pub fn sync_path_prepared(
        &mut self,
        abs: &Utf8Path,
        prepared: Option<ParsedChange>,
    ) -> Result<bool> {
        let Some(prepared) = self.prepare_sync_path_prepared(abs, prepared)? else {
            return Ok(false);
        };
        let completed = prepared.invoke();
        let outcome = match self.finish_sync_path_prepared(completed) {
            Ok(changed) => Ok(changed),
            Err(failure) => {
                let (error, _completed) = *failure;
                self.report_host_trouble(Severity::Warning, error);
                Ok(false)
            }
        };
        self.dispatch_pending();
        outcome
    }

    /// Cattura sotto prestito soltanto handle e anagrafe owned.
    ///
    /// La scansione non parte finché il chiamante non invoca il token dopo
    /// aver rilasciato il workspace.
    pub fn prepare_catch_up(&self) -> PreparedCatchUp {
        PreparedCatchUp {
            vault: self.docs.vault.clone(),
            within: None,
            entries: self.indexes.core.entries.clone(),
        }
    }

    /// La stessa fotografia di [`prepare_catch_up`](Self::prepare_catch_up),
    /// ristretta a ciò che sta sotto `abs`.
    ///
    /// Il rilevatore riferisce una cartella intera come un path solo: spostata
    /// dentro il vault, rinominata o portata via, i file che contiene non
    /// producono eventi propri. Senza questa riconciliazione l'anagrafe restava
    /// ferma ai path vecchi e non vedeva quelli nuovi fino alla riapertura, e
    /// chi la legge, come la sincronizzazione remota, propagava la sparizione
    /// dei vecchi senza mai conoscere i nuovi. Su un file o su un path che non
    /// nomina niente sotto di sé la scansione risponde vuota e costa una `stat`.
    pub fn prepare_catch_up_within(&self, abs: &Utf8Path) -> PreparedCatchUp {
        let entries = match self.docs.vault.doc_id_for_path(abs) {
            Ok(folder) => {
                let prefix = format!("{}/", folder.as_str());
                self.indexes
                    .core
                    .entries
                    .range(folder.clone()..)
                    .take_while(|(id, _)| id.as_str().starts_with(folder.as_str()))
                    .filter(|(id, _)| id.as_str().starts_with(&prefix))
                    .map(|(id, entry)| (id.clone(), entry.clone()))
                    .collect()
            }
            Err(_) => BTreeMap::new(),
        };
        PreparedCatchUp {
            vault: self.docs.vault.clone(),
            within: Some(abs.to_owned()),
            entries,
        }
    }

    /// **I piani che chiudono la finestra di apertura** (§15.7): ciò che è
    /// cambiato fra la scansione e l'accensione del rilevatore.
    ///
    /// La scansione fotografa il vault in un istante e il rilevatore comincia
    /// a guardare in un altro; in mezzo — tutta la seconda fase dell'apertura —
    /// un cambiamento esterno non è nella fotografia e non è ancora guardato,
    /// e nessun evento lo recuperava fino alla riapertura. Questi piani sono
    /// la differenza fra i due istanti: chi apre li applica con
    /// [`sync_path_prepared`](Workspace::sync_path_prepared) appena il
    /// rilevatore è acceso, e un cambiamento caduto nella finestra esce **una
    /// volta sola** — con lo stesso attore e lo stesso diritto all'impronta di
    /// un lotto vero, perché la porta è la stessa ([`plan_sync`]).
    ///
    /// L'insieme è **il disco adesso più l'anagrafe della scansione**: un file
    /// nuovo c'è solo nel disco, uno sparito solo nell'anagrafe, uno riscritto
    /// sta in entrambi. `size` e `mtime` sono il filtro economico; quando
    /// combaciano, l'impronta dei byte chiude la finestra delle riscritture
    /// della stessa lunghezza nello stesso millisecondo. Solo chi supera
    /// entrambi i confronti viene saltato.
    /// Un lotto del rilevatore che arrivasse dopo su un path già allineato non
    /// trova niente da fare: l'impronta in anagrafe è la stessa, e
    /// `sync_path_prepared` risponde senza parsare (difetto 0196).
    ///
    /// I piani si fanno sotto prestito condiviso, come [`plan_sync`], e chi li
    /// applica lo fa sotto quello esclusivo: è la regola della
    /// [0119](../../../docs/decisions/README.md)
    /// sull'unico sito che le mancava.
    ///
    /// Qui i piani nascono dai candidati di una scansione già completata, e
    /// questa fase è pura rispetto al vault: non cammina, non apre, non fa
    /// `stat` e non ricalcola la politica di esclusione.
    pub fn plan_catch_up(&self, snapshot: CatchUpSnapshot) -> Vec<(Utf8PathBuf, Option<SyncPlan>)> {
        snapshot
            .candidates
            .into_values()
            .map(|path| {
                let plan = self.plan_sync_admitted(&path);
                (path, plan)
            })
            .collect()
    }

    /// Registra l'esito di una sincronizzazione per-path nel fatto interrogabile
    /// del §9.7. Non cambia ciò che il chiamante riceve: aggiunge un secondo
    /// lettore, che è il vault stesso.
    ///
    /// **Pavimento e porta, non solo il registro** (0062, difetto 0200). Il
    /// fatto interrogabile è una risposta a chi chiede, e chi chiede deve prima
    /// sospettare: `VaultStatus` dice «è già andato storto qualcosa» a un
    /// pannello che nessuno apre finché non si accorge che qualcosa non torna,
    /// ed è la forma di notizia che arriva dopo il danno. Un documento che non
    /// si sincronizza resta indietro rispetto al disco per sempre — non c'è una
    /// riconciliazione periodica, `reindex` gira solo all'apertura —, quindi
    /// chi apre quella nota vede il testo di ieri e chi la cerca la trova col
    /// contenuto di ieri: è esattamente il caso per cui il canale esiste. Le
    /// tre uscite dicono tre cose diverse e nessuna sostituisce le altre: il
    /// registro **conta** (è già successo *n* volte), il log **resta** dopo che
    /// l'app si è chiusa, l'evento **arriva** mentre succede.
    ///
    /// Sta qui e non nei chiamanti per la ragione che questa funzione aveva già
    /// scritta accanto: i chiamanti veri scrivevano `let _ =`, e ciò che si
    /// appoggia alla loro attenzione si perde. Le tre porte pubbliche —
    /// [`sync_path`](Workspace::sync_path),
    /// [`sync_path_prepared`](Workspace::sync_path_prepared),
    /// [`sync_renamed_path`](Workspace::sync_renamed_path) — passano tutte di
    /// qui, e la quarta che verrà la eredita senza che nessuno se ne debba
    /// ricordare.
    ///
    /// [`Severity::Warning`], e per la regola di [`report_losses`]: il vault è
    /// la verità e ciò che è rimasto indietro torna riaprendo. Non «non è
    /// grave» — fino ad allora chi legge quella nota legge una versione vecchia
    /// senza sapere che lo è.
    ///
    /// Il soggetto è il documento e non il path, perché il soggetto di un
    /// guasto è ciò che l'utente ha in mano; se quel path un documento non lo
    /// nomina — è fuori dal vault, o non è UTF-8 — il guasto resta senza
    /// soggetto invece di inventarne uno.
    ///
    /// [`report_losses`]: Workspace::report_losses
    pub(super) fn notes_sync<T>(&mut self, abs: &Utf8Path, outcome: &Result<T>) {
        let Err(and) = outcome else {
            return;
        };
        self.indexes.core.notes_sync_failure(and);
        tracing::warn!(target: "fub.kernel", "sincronizzazione di {abs}: {and}");
        let subject = self.docs.vault.doc_id_for_path(abs).ok();
        let reason = PluginError::Internal(format!("sincronizzazione di {abs}: {and}").into());
        // Un documento che il provider non legge più dice la porta del formato,
        // come allo scarto dell'apertura: il messaggio è la prosa del codec, e
        // chi lo mostra lo sostituisce con la sua frase (IMP-117).
        let gate = matches!(and, KernelError::Format(_)).then_some(Gate::FormatParse);
        self.as_actor(Actor::Watcher, |ws| {
            ws.report_trouble(Severity::Warning, subject, reason, gate);
            ws.dispatch_pending();
        });
    }

    /// Registra un fallimento della scansione detached di catch-up sulle stesse
    /// superfici delle sincronizzazioni per-path.
    pub fn note_catch_up_failure(&mut self, error: KernelError) {
        let root = self.docs.vault.root().to_owned();
        let outcome: Result<()> = Err(error);
        self.notes_sync(&root, &outcome);
    }

    pub(super) fn sync_path_here(&mut self, abs: &Utf8Path) -> Result<bool> {
        if self.docs.vault.is_ignored(abs) {
            return Ok(false);
        }
        let id = match self.docs.vault.doc_id_for_path(abs) {
            Ok(id) => id,
            Err(_) => return Ok(false),
        };
        let ext = extension_of(&id).unwrap_or_default();
        if self.docs.registry.provider_for_ext(&ext).is_none() {
            return self.sync_entry_here(&id, abs);
        }
        if abs.exists() {
            self.refresh_from_disk(&id)
        } else {
            self.as_actor(Actor::Watcher, |ws| {
                let existed = ws.indexes.core.metas.contains_key(&id);
                ws.remove_document(&id);
                Ok(existed)
            })
        }
    }

    /// La stessa sincronizzazione per un file che **non è un documento**: si
    /// aggiorna l'anagrafe e si dice cosa è successo, senza leggere niente
    /// (§14.1).
    ///
    /// Non si legge e non si parsa perché non c'è niente da parsare, e non si
    /// calcola l'impronta perché costerebbe i byte di un file che nessuno ha
    /// chiesto: l'anagrafe dice che c'è, quanto è grande e di quando è, che è
    /// tutto ciò che si può sapere gratis.
    pub(super) fn sync_entry_here(&mut self, id: &DocId, abs: &Utf8Path) -> Result<bool> {
        self.as_actor(Actor::Watcher, |ws| {
            if abs.exists() {
                let before = ws.indexes.core.entries.get(id).cloned();
                let fingerprint = match (&before, ws.docs.vault.stat(id)) {
                    // Stessa dimensione e stessa data: è lo stesso contenuto, e
                    // un'impronta che qualcuno aveva calcolato vale ancora.
                    (Some(and), Some((size, mtime))) if and.size == size && and.mtime == mtime => {
                        and.fingerprint.as_ref().and_then(|fingerprint| {
                            ws.docs
                                .vault
                                .fingerprint(id)
                                .ok()
                                .filter(|current| current == fingerprint)
                        })
                    }
                    // Cambiato: l'impronta di prima descriveva un altro
                    // contenuto, e tenerla sarebbe scrivere una bugia in
                    // anagrafe. Chi la vorrà la calcolerà leggendo i byte.
                    _ => None,
                };
                let Some(kind) = ws.touch_entry(id, fingerprint) else {
                    return Ok(false);
                };
                if ws.indexes.core.entries.get(id) == before.as_ref() {
                    // Nessuna differenza: un rilevatore che riferisce due volte
                    // lo stesso fatto non è un fatto due volte.
                    return Ok(false);
                }
                ws.emit_event(Event::EntryChanged {
                    id: id.clone(),
                    kind,
                });
                ws.dispatch_pending();
                return Ok(true);
            }
            let Some(kind) = ws.indexes.core.remove_entry(id) else {
                return Ok(false);
            };
            ws.emit_event(Event::EntryRemoved {
                id: id.clone(),
                kind,
            });
            ws.dispatch_pending();
            Ok(true)
        })
    }

    /// Rimuove un documento (usato dal file watcher su cancellazione).
    pub fn remove_document(&mut self, id: &DocId) {
        match self.prepare_document_removal(id) {
            Ok(Some(prepared)) => {
                let completed = prepared.invoke();
                if let Err((error, _)) = self.finish_document_removal(completed) {
                    self.report_trouble(Severity::Warning, Some(id.clone()), error, None);
                }
                self.dispatch_pending();
            }
            Ok(None) => {}
            Err(error) => {
                self.report_trouble(Severity::Warning, Some(id.clone()), error.into(), None)
            }
        }
    }
}
