//! Rinominare e spostare documenti e allegati, con la riscrittura dei link.

use super::*;

impl Workspace {
    /// Rinomina/sposta un documento **preservando l'identità**: file sul disco,
    /// modello, grafo, e riscrittura chirurgica dei wikilink entranti che
    /// puntavano al vecchio nome o path (stile Obsidian). I link per **alias**
    /// non vengono toccati: l'alias vive nel frontmatter del documento e
    /// sopravvive al rename.
    ///
    /// Emette [`Event::DocumentRenamed`] (non `Removed`+`Changed`): chi tiene
    /// stato per-documento migra la chiave.
    ///
    /// È un **lotto** (decisione 0011), ed è il caso che ha fatto nascere la voce: una
    /// nota con 200 backlink riscrive 200 sorgenti, e prima di questo giro erano
    /// 200 `index-updated` — cioè 200 ridisegni completi della shell, con 200
    /// `list_documents`, per un'operazione che l'utente ha chiesto una volta.
    /// Adesso è un `batch-ended` solo, con dentro l'elenco.
    pub fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        self.indexes.ensure_mutation_available()?;
        self.batch(|ws| ws.rename_document_in_batch(from, to))
    }

    pub(super) fn rename_document_in_batch(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        // `to` arriva dall'IPC: senza validazione `../fuori.md` sposterebbe il
        // file fuori dal vault. E la destinazione di un rename è un nome che
        // **nasce**, quindi vale la tolleranza stretta del §15.5: rinominare
        // *verso* `CON.md` è creare un file che su Windows non si apre, mentre
        // rinominare *via da* `CON.md` è precisamente il modo di sistemarlo — ed
        // è per questo che qui si valida `to` e non `from`.
        let to = &new_doc_id(to.as_str())?;
        if from == to {
            return Ok(());
        }
        if !self.indexes.core.metas.contains_key(from) {
            // Non è un documento, ma il vault potrebbe conoscerlo lo stesso
            // (§14.1): spostare un allegato è la stessa operazione, con una
            // coda diversa — non c'è niente da riparsare, e i riferimenti che
            // lo seguono sono quelli che lo mostrano.
            if self.indexes.core.entries.contains_key(from) {
                return self.rename_entry_in_batch(from, to);
            }
            return Err(KernelError::NotFound(from.to_string()));
        }

        let prepared = self
            .prepare_explicit_rename(from, to)?
            .expect("il documento è già stato classificato");
        let parsed = prepared.invoke()?;
        let pending = match self.commit_explicit_rename(parsed) {
            Ok(pending) => pending,
            Err(failure) => {
                let (error, parsed) = *failure;
                parsed.rollback()?;
                return Err(error);
            }
        };
        // `apply_edit` riparsa, aggiorna il grafo ed emette gli eventi come ogni
        // scrittura — con in più la base: se qualcuno ha riscritto una di queste
        // sorgenti da quando il piano è stato calcolato, quella riscrittura non
        // viene cancellata in silenzio, il suo link resta vecchio e il
        // fallimento lo nomina `finish_explicit_rename`, qui sotto.
        let completed = pending
            .invoke()
            .invoke_rewrites(|source, request| self.apply_edit(source, request.clone()).map(drop));
        match self.finish_explicit_rename(completed) {
            Ok(outcome) => outcome,
            Err(_) => unreachable!("il commit ha già validato l'identità del workspace"),
        }
    }

    /// Classifica e fotografa core, routing e pipeline di parse senza I/O né
    /// callback. `None` conserva i due percorsi che non hanno lavoro detached:
    /// no-op e rinomina di una voce non-documento.
    pub fn prepare_explicit_rename(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Result<Option<PreparedExplicitRename>> {
        let to = new_doc_id(to.as_str())?;
        if from == &to {
            return Ok(None);
        }
        if !self.indexes.core.metas.contains_key(from) {
            if self.indexes.core.entries.contains_key(from) {
                return Ok(None);
            }
            return Err(KernelError::NotFound(from.to_string()));
        }
        let to_entry = self.indexes.core.entries.get(&to).cloned();
        if to_entry.is_some() || self.indexes.core.metas.contains_key(&to) {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }
        let ext = extension_of(&to).unwrap_or_default();
        let descriptor = self
            .docs
            .registry
            .descriptor_for_ext(&ext)
            .ok_or_else(|| KernelError::NoProvider(ext.clone()))?;
        let parser = self.docs.prepare_parse(&to)?;
        let from_entry = self
            .indexes
            .core
            .entries
            .get(from)
            .cloned()
            .ok_or_else(|| KernelError::NotFound(from.to_string()))?;
        Ok(Some(PreparedExplicitRename {
            snapshot: ExplicitRenameSnapshot {
                workspace_id: self.workspace_id,
                from_path: self.docs.vault.path_for(from)?,
                to_path: self.docs.vault.path_for(&to)?,
                from: from.clone(),
                to: to.clone(),
                from_entry,
                to_entry,
                syntax_generation: self.syntax_generation,
                routing_generation: self.indexes.routing_generation(),
            },
            storage: Arc::clone(self.docs.vault.storage()),
            parser,
            source_kind: descriptor.source,
            // Il piano di riscrittura va calcolato PRIMA di toccare il grafo:
            // serve la risoluzione con il vecchio nome ancora in vigore.
            rewrites: self.prepare_explicit_link_rewrites(from, &to, false),
            side_data: self.prepare_rename_side_data(from, &to),
            recovery_root: self.docs.vault.root().to_owned(),
        }))
    }

    /// Riconvalida il solo core della rinomina. Il file e i side-data sono già
    /// stati mossi dal token detached; in caso di rifiuto il chiamante recupera
    /// lo stesso token per il rollback fuori dal guard.
    pub fn commit_explicit_rename(
        &mut self,
        parsed: ParsedExplicitRename,
    ) -> std::result::Result<PendingExplicitRename, Box<(KernelError, ParsedExplicitRename)>> {
        let owns_batch = self.dispatch.open_batch();
        match self.commit_explicit_rename_in_batch(parsed) {
            Ok(mut pending) => {
                pending.owns_batch = owns_batch;
                Ok(pending)
            }
            Err(failure) => {
                if owns_batch {
                    self.dispatch.close_batch();
                }
                Err(failure)
            }
        }
    }

    /// Riconvalida integralmente workspace, generazioni, fotografia del core e
    /// contenuto del token prima della prima mutazione autorevole. Non consulta
    /// lo storage.
    pub(super) fn commit_explicit_rename_in_batch(
        &mut self,
        parsed: ParsedExplicitRename,
    ) -> std::result::Result<PendingExplicitRename, Box<(KernelError, ParsedExplicitRename)>> {
        let snapshot = &parsed.snapshot;
        let current_from = self.indexes.core.entries.get(&snapshot.from);
        let current_to = self.indexes.core.entries.get(&snapshot.to);
        let source_matches = snapshot.from_entry.fingerprint.as_ref() == Some(&parsed.fingerprint)
            && snapshot.from_entry.size == parsed.stat.size
            && snapshot.from_entry.mtime == parsed.stat.mtime;
        if snapshot.workspace_id != self.workspace_id
            || current_from != Some(&snapshot.from_entry)
            || current_to != snapshot.to_entry.as_ref()
            || !self.indexes.core.metas.contains_key(&snapshot.from)
            || self.indexes.core.metas.contains_key(&snapshot.to)
            || snapshot.syntax_generation != self.syntax_generation
            || snapshot.routing_generation != self.indexes.routing_generation()
            || parsed.model.id != snapshot.to
            || !source_matches
        {
            return Err(Box::new((
                KernelError::Stale(snapshot.from.to_string()),
                parsed,
            )));
        }
        if let Err(error) = self.indexes.ensure_mutation_available() {
            return Err(Box::new((error, parsed)));
        }

        let ParsedExplicitRename {
            snapshot,
            storage: _,
            model,
            fingerprint,
            stat: _,
            identity: _,
            rewrites,
            stale_byte_links,
            side_data,
            recovery,
        } = parsed;
        let identity = self
            .migrate_identity_core(&snapshot.from, &snapshot.to, model, fingerprint)
            .expect("la fotografia del core è stata appena riconvalidata");
        Ok(PendingExplicitRename {
            identity,
            rewrites,
            stale_byte_links,
            side_data,
            recovery,
            journal: Arc::clone(&self.journal),
            origin: self.dispatch.origin(),
            from: snapshot.from,
            to: snapshot.to,
            owns_batch: false,
        })
    }

    /// Recupera frame e perdite, riporta l'eventuale guasto del registro e
    /// completa il lotto storico. Le riscritture e l'append sono già stati
    /// invocati dal token senza trattenere un prestito del workspace.
    pub fn finish_explicit_rename(
        &mut self,
        completed: CompletedExplicitRename,
    ) -> std::result::Result<Result<()>, Box<(PluginError, CompletedExplicitRename)>> {
        if completed.identity.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict(
                    "la rinomina esplicita appartiene a un altro workspace".into(),
                ),
                completed,
            )));
        }
        let CompletedExplicitRename {
            identity,
            rewrites: _,
            side_data,
            recovery: _,
            owns_batch,
            rewrite_failures,
            stale_byte_links,
            journal_fault,
        } = completed;
        if self.finish_identity_migration(identity).is_err() {
            unreachable!("l'identità è già stata legata a questo workspace");
        }
        self.report_rename_side_data(side_data);
        if let Some(and) = journal_fault {
            self.report_trouble(
                Severity::Failure,
                None,
                PluginError::Internal(format!("registro: {and}").into()),
                None,
            );
        }
        // Le righe dei file a byte vanno in coda solo qui: l'intent di recupero
        // si chiude quando le riscritture vere sono riuscite, e un file a byte
        // che non si riscrive non ha niente da recuperare.
        let mut failed = rewrite_failures;
        failed.extend(stale_byte_links);
        // Dentro il lotto questo `index-updated` non esce: diventa il
        // `batch-ended` che la chiusura emette. Resta scritto qui perché il
        // rename **ha** aggiornato l'indice, e chi legge questo metodo non deve
        // dedurlo dal fatto che è avvolto in un lotto.
        self.emit_event(Event::IndexUpdated);
        if owns_batch {
            self.dispatch.close_batch();
        }
        // Il lotto non annulla: le sorgenti riscritte restano riscritte anche
        // se una è fallita, ed è la scelta giusta *per il rename* — abortire a
        // metà lascerebbe link misti senza possibilità di retry. Chi vuole il
        // contrario (import, migrazioni) vuole il registro delle mutazioni, che
        // adesso c'è (0067) e di questo lotto tiene i confini — non un campo in
        // più qui.
        if failed.is_empty() {
            Ok(Ok(()))
        } else {
            Ok(Err(KernelError::LinkRewrite(failed.join("; "))))
        }
    }

    /// Fotografa una voce senza modello, i suoi riferimenti e gli handle dei
    /// side-data senza leggere il filesystem né invocare provider.
    pub fn prepare_explicit_asset_rename(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Result<Option<PreparedExplicitAssetRename>> {
        let to = new_doc_id(to.as_str())?;
        if from == &to {
            return Ok(None);
        }
        if self.indexes.core.metas.contains_key(from) {
            return Ok(None);
        }
        let from_entry = self
            .indexes
            .core
            .entries
            .get(from)
            .cloned()
            .ok_or_else(|| KernelError::NotFound(from.to_string()))?;
        let to_entry = self.indexes.core.entries.get(&to).cloned();
        if to_entry.is_some() || self.indexes.core.metas.contains_key(&to) {
            return Err(KernelError::AlreadyExists(to.to_string()));
        }
        Ok(Some(PreparedExplicitAssetRename {
            snapshot: ExplicitRenameSnapshot {
                workspace_id: self.workspace_id,
                from_path: self.docs.vault.path_for(from)?,
                to_path: self.docs.vault.path_for(&to)?,
                from: from.clone(),
                to: to.clone(),
                from_entry,
                to_entry,
                syntax_generation: self.syntax_generation,
                routing_generation: self.indexes.routing_generation(),
            },
            storage: Arc::clone(self.docs.vault.storage()),
            // Il piano PRIMA di spostare: si risolve con il vecchio path ancora in
            // vigore, come per i documenti.
            rewrites: self.prepare_explicit_entry_link_rewrites(from, &to),
            side_data: PreparedAssetRenameSideData {
                from: from.clone(),
                to,
                organization: Arc::clone(&self.organization),
                storage: Arc::clone(self.docs.vault.storage()),
                doc_data_roots: self.docs.plugin_data_roots(),
            },
            recovery_root: self.docs.vault.root().to_owned(),
        }))
    }

    /// Riconvalida e installa nel core un asset già spostato. In caso di stale
    /// restituisce intatto il token, che il chiamante deve annullare fuori dal
    /// guard.
    pub fn commit_explicit_asset_rename(
        &mut self,
        moved: MovedExplicitAssetRename,
    ) -> std::result::Result<PendingExplicitAssetRename, Box<(KernelError, MovedExplicitAssetRename)>>
    {
        let owns_batch = self.dispatch.open_batch();
        match self.commit_explicit_asset_rename_in_batch(moved) {
            Ok(mut pending) => {
                pending.owns_batch = owns_batch;
                Ok(pending)
            }
            Err(failure) => {
                if owns_batch {
                    self.dispatch.close_batch();
                }
                Err(failure)
            }
        }
    }

    pub(super) fn commit_explicit_asset_rename_in_batch(
        &mut self,
        moved: MovedExplicitAssetRename,
    ) -> std::result::Result<PendingExplicitAssetRename, Box<(KernelError, MovedExplicitAssetRename)>>
    {
        let snapshot = &moved.snapshot;
        let current_from = self.indexes.core.entries.get(&snapshot.from);
        let current_to = self.indexes.core.entries.get(&snapshot.to);
        // Una voce senza impronta — un allegato arrivato dal rilevatore o dal
        // cestino, che la prende solo alla prossima apertura — si riconosce da
        // dimensione e data, il criterio dell'anagrafe (§14.1). Chiedere
        // un'impronta che non c'è rispondeva `Stale` a ogni rinomina.
        let source_matches = snapshot
            .from_entry
            .fingerprint
            .as_ref()
            .is_none_or(|fingerprint| *fingerprint == moved.fingerprint)
            && snapshot.from_entry.size == moved.stat.size
            && snapshot.from_entry.mtime == moved.stat.mtime;
        let paths_match = self.docs.vault.path_for(&snapshot.from).ok().as_ref()
            == Some(&snapshot.from_path)
            && self.docs.vault.path_for(&snapshot.to).ok().as_ref() == Some(&snapshot.to_path);
        if snapshot.workspace_id != self.workspace_id
            || current_from != Some(&snapshot.from_entry)
            || current_to != snapshot.to_entry.as_ref()
            || self.indexes.core.metas.contains_key(&snapshot.from)
            || self.indexes.core.metas.contains_key(&snapshot.to)
            || snapshot.syntax_generation != self.syntax_generation
            || snapshot.routing_generation != self.indexes.routing_generation()
            || !source_matches
            || !paths_match
        {
            return Err(Box::new((
                KernelError::Stale(snapshot.from.to_string()),
                moved,
            )));
        }
        if let Err(error) = self.indexes.ensure_mutation_available() {
            return Err(Box::new((error, moved)));
        }

        let MovedExplicitAssetRename {
            snapshot,
            storage: _,
            fingerprint,
            stat,
            identity: _,
            rewrites,
            stale_byte_links,
            side_data,
            recovery,
        } = moved;
        // L'impronta segue il file: un rename sposta i byte senza toccarli.
        let installed = VaultEntry {
            id: snapshot.to.clone(),
            kind: snapshot.from_entry.kind,
            size: stat.size,
            mtime: stat.mtime,
            fingerprint: Some(fingerprint),
        };
        self.indexes.core.remove_entry(&snapshot.from);
        self.indexes.core.ensure_folders_of(&snapshot.to);
        self.indexes.core.set_entry(installed.clone());
        Ok(PendingExplicitAssetRename {
            workspace_id: snapshot.workspace_id,
            installed,
            rewrites,
            stale_byte_links,
            side_data,
            recovery,
            journal: Arc::clone(&self.journal),
            origin: self.dispatch.origin(),
            from: snapshot.from,
            to: snapshot.to,
            owns_batch: false,
        })
    }

    /// Converte callback e side-data completati nell'unico fatto di rename e
    /// chiude il lotto sotto il guard del workspace.
    pub fn finish_explicit_asset_rename(
        &mut self,
        completed: CompletedExplicitAssetRename,
    ) -> std::result::Result<Result<()>, Box<(PluginError, CompletedExplicitAssetRename)>> {
        if completed.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict(
                    "la rinomina asset esplicita appartiene a un altro workspace".into(),
                ),
                completed,
            )));
        }
        let CompletedExplicitAssetRename {
            workspace_id: _,
            installed,
            side_data,
            from,
            to,
            owns_batch,
            mut rewrite_failures,
            stale_byte_links,
            journal_fault,
        } = completed;
        rewrite_failures.extend(stale_byte_links);
        for error in side_data.errors {
            self.doc_data_warnings.push(format!(
                "lo stato per-documento di {} non ha potuto seguire la rinomina in {} — {error}",
                side_data.from, side_data.to
            ));
        }
        if let Some(and) = journal_fault {
            self.report_trouble(
                Severity::Failure,
                None,
                PluginError::Internal(format!("registro: {and}").into()),
                None,
            );
        }
        self.emit_event(Event::EntryRenamed {
            from,
            to,
            kind: installed.kind,
        });
        self.emit_event(Event::IndexUpdated);
        if owns_batch {
            self.dispatch.close_batch();
        }
        if rewrite_failures.is_empty() {
            Ok(Ok(()))
        } else {
            Ok(Err(KernelError::LinkRewrite(rewrite_failures.join("; "))))
        }
    }

    /// Sposta un file che **non è un documento**, e porta i riferimenti con sé
    /// (§14.1).
    ///
    /// È il gemello di [`rename_document_in_batch`](Workspace::rename_document_in_batch)
    /// e le differenze sono tutte per sottrazione: non si legge, non si parsa,
    /// non c'è un modello da rimettere in cache e non c'è un provider da
    /// pretendere — anzi, **pretenderlo sarebbe il difetto**: rinominare
    /// `foto.png` in `foto2.png` non deve richiedere che qualcuno sappia parsare
    /// i PNG.
    ///
    /// Ciò che resta identico è la parte che conta per chi guarda: i documenti
    /// che mostravano quell'immagine continuano a mostrarla, perché i loro
    /// riferimenti vengono riscritti nella stessa operazione. Senza, spostare un
    /// allegato in una cartella «allegati» — cioè la prima cosa che si fa
    /// mettendo ordine — romperebbe ogni nota che lo incorpora.
    pub(super) fn rename_entry_in_batch(&mut self, from: &DocId, to: &DocId) -> Result<()> {
        let prepared = self
            .prepare_explicit_asset_rename(from, to)?
            .expect("la voce senza modello è già stata classificata");
        let moved = prepared.invoke()?;
        let pending = match self.commit_explicit_asset_rename(moved) {
            Ok(pending) => pending,
            Err(failure) => {
                let (error, moved) = *failure;
                moved.rollback()?;
                return Err(error);
            }
        };
        let completed = pending
            .invoke_rewrites(|source, request| self.apply_edit(source, request.clone()).map(drop));
        match self.finish_explicit_asset_rename(completed) {
            Ok(outcome) => outcome,
            Err(_) => unreachable!("il commit ha già validato l'identità del workspace"),
        }
    }

    /// Prepara, senza leggere le sorgenti, le sostituzioni dei riferimenti che
    /// risolvono verso l'asset rinominato.
    ///
    /// Le sorgenti non si chiedono al grafo: un allegato non è un nodo del
    /// grafo, perché non ha link uscenti. Si cammina quindi la cache dei
    /// metadati e si consegnano path, span e testo atteso al token owned, che
    /// leggerà le sorgenti e costruirà le CAS fuori dal workspace.
    pub(super) fn prepare_explicit_entry_link_rewrites(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Vec<PreparedExplicitLinkRewrite> {
        let mut plan = Vec::new();
        // Il riferimento wiki nuovo dipende solo da `from` e `to`: si chiede
        // all'anagrafe alla prima wikilink che lo richiede, non a ognuna.
        let mut wiki_ref: Option<String> = None;
        for (src, metadata) in &self.indexes.core.metas {
            let mut rewrites = Vec::new();
            for link in &metadata.links {
                if self.indexes.core.resolve_entry(src, &link.target).as_ref() != Some(from) {
                    continue;
                }
                let replacement = match &link.target {
                    LinkTarget::Wiki { .. } => wiki_ref
                        .get_or_insert_with(|| {
                            let name = to.as_str().rsplit('/').next().unwrap_or(to.as_str());
                            let key = fub_abi::rules::path::resolution_key(name);
                            let contended = self.indexes.core.entries.keys().any(|id| {
                                id != to
                                    && id != from
                                    && fub_abi::rules::path::resolution_key(
                                        id.as_str().rsplit('/').next().unwrap_or(id.as_str()),
                                    ) == key
                            });
                            if contended {
                                to.as_str().to_string()
                            } else {
                                name.to_string()
                            }
                        })
                        .clone(),
                    LinkTarget::Path(written) => {
                        let (path, fragment) = rules_path::split_fragment(written);
                        let new = if path.trim_start().starts_with('/') {
                            format!("/{}", rules_path::percent_encode_path(to.as_str()))
                        } else {
                            rules_path::relative_ref(src, to)
                        };
                        let rewritten = format!("{new}{fragment}");
                        if rewritten == *written {
                            continue;
                        }
                        rewritten
                    }
                    LinkTarget::Url(_) => continue,
                };
                rewrites.push(LinkRewrite {
                    span: link.span,
                    target: link.target.clone(),
                    replacement,
                });
            }
            if rewrites.is_empty() {
                continue;
            }
            let Ok(source_path) = self.docs.vault.path_for(src) else {
                continue;
            };
            match self.rewrite_plan_for(src) {
                Some(format_plan) => plan.push(PreparedExplicitLinkRewrite {
                    source_path,
                    destination: src.clone(),
                    provider: Some(format_plan.provider),
                    provider_id: format_plan.provider_id,
                    ctx: format_plan.ctx,
                    source_kind: format_plan.source_kind,
                    rewrites,
                }),
                None => plan.push(PreparedExplicitLinkRewrite {
                    source_path,
                    destination: src.clone(),
                    provider: None,
                    provider_id: String::new(),
                    ctx: ParseContext::obsidian(src.as_str()),
                    source_kind: SourceKind::Text,
                    rewrites,
                }),
            };
        }
        plan
    }

    /// Fotografia provider-owned per una sorgente del piano di riscrittura:
    /// `Arc` + id + contesto + specie, senza eseguire codice esterno sotto lock.
    /// `None` = nessuna riscrittura format-owned possibile per questa sorgente
    /// (nessun provider): il chiamante decide se errore esplicito o skip, mai
    /// fallback raw silenzioso.
    pub(super) fn rewrite_plan_for(&self, source: &DocId) -> Option<RewritePlan> {
        let ext = extension_of(source).unwrap_or_default();
        let provider = self.docs.registry.provider_arc_for_ext(&ext)?;
        let descriptor = self.docs.registry.descriptor_for_ext(&ext)?.clone();
        Some(RewritePlan {
            provider,
            provider_id: descriptor.id,
            ctx: ParseContext::obsidian(source.as_str()),
            source_kind: descriptor.source,
        })
    }

    /// Installa il cambio d'identità nel core e fotografa gli handle esterni
    /// senza invocare alcun `IndexProvider`.
    pub(super) fn migrate_identity_core(
        &mut self,
        from: &DocId,
        to: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
    ) -> Result<PendingIdentityMigration> {
        // Per ogni indice — quello del kernel compreso — il rename è
        // remove+add: l'identità è la chiave, e la chiave è cambiata. (Chi
        // tiene stato *per-documento* invece migra la chiave sull'evento
        // `DocumentRenamed`.)
        let removal = self
            .prepare_document_rename_removal(from)?
            .ok_or_else(|| KernelError::NotFound(from.to_string()))?;
        let changes = self.indexes.core.changes_for(&model, &fingerprint);
        // L'anagrafe migra come tutto il resto: la chiave è il path, e il path
        // è cambiato.
        self.touch_entry(to, Some(fingerprint.clone()));
        let installed = self
            .indexes
            .core
            .entries
            .get(to)
            .cloned()
            .expect("touch_entry installa l'identità");
        let losses = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let feed = PreparedDocumentFeed {
            id: to.clone(),
            model: Some(model),
            changes,
            revision: fingerprint,
            journal: JournalOp::Renamed {
                from: from.clone(),
                to: to.clone(),
            },
            providers: self.indexes.feed_handles(),
            losses,
        };
        // La nota aperta segue il rename anche qui: senza, `active_context`
        // risponderebbe col path vecchio e outline/backlink si svuoterebbero
        // fino al prossimo cambio nota. Va fatto nel kernel, non nella shell:
        // vale anche per i rename non innescati da lei.
        self.session
            .invalidate(from, ContextChange::Renamed(to.clone()));
        Ok(PendingIdentityMigration {
            workspace_id: self.workspace_id,
            from: from.clone(),
            to: to.clone(),
            installed,
            removal,
            feed,
        })
    }

    pub(super) fn finish_identity_migration(
        &mut self,
        completed: CompletedIdentityMigration,
    ) -> std::result::Result<bool, Box<CompletedIdentityMigration>> {
        if completed.workspace_id != self.workspace_id {
            return Err(Box::new(completed));
        }
        let CompletedIdentityMigration {
            from,
            to,
            installed,
            removal,
            feed,
            ..
        } = completed;
        let removal_losses = match self.finish_document_rename_removal(removal) {
            Ok(losses) => losses,
            Err(_) => unreachable!("la rimozione condivide l'identità del workspace"),
        };
        self.report_losses(removal_losses);
        self.report_losses(feed.losses);
        let current = !self.indexes.core.entries.contains_key(&from)
            && self.indexes.core.entries.get(&to) == Some(&installed)
            && self.entry_fingerprint(&to) == installed.fingerprint
            && self.indexes.core.metas.contains_key(&to);
        if current && self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        self.emit_event(Event::DocumentRenamed { from, to });
        Ok(current)
    }

    /// Percorso sincrono usato dal watcher storico.
    pub(super) fn migrate_identity(
        &mut self,
        from: &DocId,
        to: &DocId,
        model: DocumentModel,
        fingerprint: Revision,
    ) {
        let pending = self
            .migrate_identity_core(from, to, model, fingerprint)
            .expect("la rinomina ha già validato l'identità");
        self.migrate_side_data(from, to);
        let completed = pending.invoke();
        if self.finish_identity_migration(completed).is_err() {
            unreachable!("la migrazione appartiene a questo workspace");
        }
    }

    /// Ciò che l'utente ha attaccato addosso a un **allegato** rinominato da
    /// un'altra applicazione (difetto 0184).
    ///
    /// È la metà di [`migrate_side_data`](Workspace::migrate_side_data) che vale
    /// per chi non ha un modello: l'organizzazione e lo stato per-documento di
    /// chiunque altro. La bozza no, e non per dimenticanza — una bozza è il
    /// buffer sporco di un editor di testo, e un allegato non si apre in un
    /// editor di testo.
    ///
    /// Il resto della rinomina lo fanno le due mezze verità che seguono, che
    /// l'anagrafe la sistemano già: qui non si sposta niente sul disco, si
    /// sposta ciò che sta **accanto** al disco.
    ///
    /// I cancelli sono quelli dei documenti, letti per la stessa ragione: la
    /// sorgente dev'essere qualcosa che il vault conosceva davvero, e la
    /// destinazione dev'essere **libera** — una rinomina che atterra su
    /// un'identità viva non è una rinomina (§25.1, decisione 0135), e qui
    /// varrebbe scrivere il pin di `from` sopra quello di `to`.
    pub(super) fn migrate_attachment_state(&mut self, from: &Utf8Path, to: &Utf8Path) {
        let identity = |ws: &Self, p: &Utf8Path| {
            (!ws.docs.vault.is_ignored(p))
                .then(|| ws.docs.vault.doc_id_for_path(p).ok())
                .flatten()
        };
        let (Some(from_id), Some(to_id)) = (identity(self, from), identity(self, to)) else {
            return;
        };
        if from_id == to_id {
            return;
        }
        // In anagrafe e non fra i documenti: chi ha un modello è già passato di
        // sopra, e non arriva mai qui.
        if !self.indexes.core.entries.contains_key(&from_id) {
            return;
        }
        if self.indexes.core.entries.contains_key(&to_id)
            || self.indexes.core.metas.contains_key(&to_id)
        {
            return;
        }
        // Se a destinazione non c'è niente questa non è una rinomina ma una
        // sparizione, e portarci lo stato vorrebbe dire metterlo sotto una
        // chiave che la prima raccolta spazza: sotto quella vecchia almeno
        // resta finché il file può tornare.
        if !self.docs.vault.exists(&to_id) {
            return;
        }
        if let Err(and) = self.organization.migrate(from_id.as_str(), to_id.as_str()) {
            self.organization.warn(format!(
                "l'organizzazione di {from_id} non ha potuto seguire la rinomina \
                 in {to_id}: {and}"
            ));
        }
        self.migrate_doc_data(&from_id, &to_id);
    }

    pub(super) fn prepare_rename_side_data(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> PreparedRenameSideData {
        PreparedRenameSideData {
            from: from.clone(),
            to: to.clone(),
            organization: Arc::clone(&self.organization),
            drafts: Arc::clone(&self.drafts),
            storage: Arc::clone(self.docs.vault.storage()),
            doc_data_roots: self.docs.plugin_data_roots(),
        }
    }

    pub(super) fn report_rename_side_data(&mut self, completed: CompletedRenameSideData) {
        for error in completed.errors {
            self.doc_data_warnings.push(format!(
                "lo stato di {} non ha potuto seguire la rinomina in {} — {error}",
                completed.from, completed.to
            ));
        }
    }

    /// Porta dietro a una rinomina **tutto ciò che sta attaccato al documento e
    /// non è il documento**: l'organizzazione del kernel, lo spazio
    /// per-documento di chiunque altro, la bozza non salvata.
    ///
    /// Sta in una funzione sua perché i chiamanti sono **due**, e sono due
    /// mondi: [`migrate_identity`](Workspace::migrate_identity) — la rinomina
    /// che il kernel fa o vede fare — e
    /// [`rejoin_renamed_while_closed`](Workspace::rejoin_renamed_while_closed),
    /// la rinomina che non ha visto nessuno (§23.1). Tenerle in due copie
    /// sarebbe il difetto che la [decisione 0044] ha appena finito di togliere,
    /// rifatto dentro il kernel invece che fuori: *il rename è un rito che
    /// ognuno celebra per conto proprio, e ognuno lo celebra col proprio buco*.
    /// Il modo in cui si vedrebbe è preciso — un quarto posto per-documento
    /// aggiunto qui e non là, e la rinomina ad app chiusa che ne perde uno solo.
    ///
    /// **La destinazione è libera, e non è un'ipotesi**: i tre canali qui
    /// sotto scrivono ciascuno *sopra* ciò che sta a `to`, quindi chiamare
    /// questa funzione con un `to` vivo in anagrafe vuol dire perdere il dato
    /// di qualcun altro senza dirlo. Chi entra da
    /// [`rename_document`](Workspace::rename_document) ha un `AlreadyExists`
    /// davanti; chi entra da
    /// [`rejoin_renamed_while_closed`](Workspace::rejoin_renamed_while_closed)
    /// accoppia solo id che ieri non erano in anagrafe; chi entra dal watcher
    /// ha la guardia di [`sync_renamed_path_here`] (decisione 0135).
    ///
    /// [`sync_renamed_path_here`]: Workspace::sync_renamed_path_here
    ///
    /// **Nessuno di questi tre errori risale**, ed è la regola dell'§11.3: chi
    /// chiama ha già il file al posto nuovo, e far fallire una rinomina riuscita
    /// perché un'icona non l'ha seguita sarebbe il verso sbagliato. La rinomina
    /// vale, ciò che resta indietro si dice.
    ///
    /// [decisione 0044]: ../../../docs/decisions/0190-sessioni-documento-e-undo.md
    pub(super) fn migrate_side_data(&mut self, from: &DocId, to: &DocId) {
        // **L'organizzazione segue l'identità** (§11.3): icona, pin e posto
        // nell'ordinamento sono attaccati alla nota, non al suo vecchio path.
        // Qui e non sull'evento `DocumentRenamed`, che pure lo direbbe: la coda
        // ha un budget e può troncare (decisione 0034), e l'organizzazione è un
        // dato **autorevole** — perso, non si ricostruisce da niente. Passando
        // di qui migra anche la rinomina fatta da **un'altra app** mentre Fub è
        // aperto, perché `sync_renamed_path` arriva allo stesso punto.
        //
        // **E lo stesso vale per lo stato per-documento di chiunque altro**
        // (§13.2), cercato sul **disco** e non fra i plugin montati: chi è
        // spento oggi non deve riaccendersi domani con le chiavi di ieri.
        //
        // **E la bozza non salvata** (§15.2), che è l'**unica** copia di ciò che
        // l'utente ha scritto: se `to` ne ha già una sua, quella di `from`
        // prende un nome di recupero e si elenca come orfana.
        let roots = self.docs.plugin_data_roots();
        let storage = Arc::clone(self.docs.vault.storage());
        let mut warnings = Vec::new();
        migrate_side_data_on(
            &self.organization,
            &self.drafts,
            storage.as_ref(),
            &roots,
            from,
            to,
            &mut warnings,
        );
        self.doc_data_warnings.extend(warnings);
    }

    /// Sincronizza un **rename accoppiato** riferito dal filesystem (`from` →
    /// `to`, file già spostato da qualcun altro: Finder, Obsidian, sync).
    ///
    /// Se `from` era indicizzato e `to` è un documento del vault, è una
    /// **migrazione d'identità** come quella di
    /// [`rename_document`](Workspace::rename_document) — versioning, meta del
    /// frontend e stato per-documento seguono il [`Event::DocumentRenamed`] —
    /// ma **senza riscrittura dei wikilink entranti**: chi ha rinominato il
    /// file può averci già pensato (Obsidian lo fa), e riscrivere sorgenti in
    /// risposta al watcher significherebbe litigare con l'altra app.
    ///
    /// Tutti gli altri casi degradano ai percorsi già noti: destinazione
    /// fuori dal vault/ignorata (es. cestinata da un'altra app) è una
    /// rimozione; sorgente mai vista è al più un'aggiunta ([`sync_path`]).
    ///
    /// [`sync_path`]: Workspace::sync_path
    ///
    /// Come [`sync_path`](Workspace::sync_path), un fallimento resta scritto
    /// anche se il chiamante non lo legge (§9.7) — e **una volta sola**: i rami
    /// che degradano a `sync_path` passano dal corpo interno, non dalla porta
    /// che registra.
    pub fn sync_renamed_path(&mut self, from: &Utf8Path, to: &Utf8Path) -> Result<bool> {
        let outcome = self.as_actor(Actor::Watcher, |ws| ws.sync_renamed_path_here(from, to));
        // Il soggetto è **dove il file è adesso**: una rinomina che fallisce
        // lascia indietro la destinazione, ed è quella che l'utente ha in mano.
        self.notes_sync(to, &outcome);
        outcome
    }

    pub(super) fn sync_renamed_path_here(
        &mut self,
        from: &Utf8Path,
        to: &Utf8Path,
    ) -> Result<bool> {
        let from_id = (!self.docs.vault.is_ignored(from))
            .then(|| self.docs.vault.doc_id_for_path(from).ok())
            .flatten()
            .filter(|id| self.indexes.core.metas.contains_key(id));
        let Some(from_id) = from_id else {
            // Nessuna **identità di documento** da migrare — ma le due mezze
            // verità vanno dette entrambe (§14.1): in `to` può essere comparso
            // qualcosa, e da `from` può essere sparito. Finché il vault vedeva
            // solo documenti la seconda non esisteva; adesso sì, e saltarla
            // lascerebbe in anagrafe un allegato che nessuno può più aprire,
            // fino alla riapertura del vault. Il corpo interno, non la porta:
            // chi ci ha chiamati registrerà l'esito una volta sola (§9.7).
            //
            // **Le due mezze verità dicono dov'è il file, non che cosa gli è
            // attaccato addosso** (difetto 0184). Un allegato non ha un modello,
            // e per questa funzione «non ha un modello» valeva «non ha
            // un'identità»: la rinomina dal Finder di `foto.png` usciva come
            // «sparita e ricomparsa», cioè due voci d'anagrafe scollegate, e
            // pin, icona, annotazioni e miniatura restavano sotto la chiave
            // vecchia — dove non li cerca più nessuno e dove la prima `collect`
            // li spazza, perché non corrispondono a nessun file vivo. La stessa
            // rinomina fatta **da dentro** li porta con sé da sempre
            // (`rename_entry_in_batch`), quindi la differenza non era una
            // regola: era il rilevatore che ne sapeva meno.
            self.migrate_attachment_state(from, to);
            let started = self.sync_path_here(from)?;
            return Ok(self.sync_path_here(to)? || started);
        };
        let to_id = (!self.docs.vault.is_ignored(to))
            .then(|| self.docs.vault.doc_id_for_path(to).ok())
            .flatten()
            .filter(|id| {
                let ext = extension_of(id).unwrap_or_default();
                self.docs.registry.provider_for_ext(&ext).is_some()
            });
        let Some(to_id) = to_id else {
            // Spostato fuori, in una cartella ignorata o in un formato non
            // gestito: per il workspace è una rimozione.
            self.remove_document(&from_id);
            return Ok(true);
        };
        if from_id == to_id {
            return self.sync_path_here(to);
        }
        // **Una rinomina che atterra su un'identità viva non è una rinomina**
        // (§25.1, decisione 0135). Dei tre modi di entrare in
        // `migrate_side_data` questo è l'unico che possa avere davanti una
        // destinazione *occupata*: `rename_document` ha un `AlreadyExists`
        // prima, `rejoin_renamed_while_closed` accoppia per impronta un id che
        // ieri non era in anagrafe. Senza questa riga il rito si
        // celebrava lo stesso, e i tre canali attaccati a `to` — icona e pin,
        // spazio per-documento, bozza — scrivevano il dato di `from` sopra
        // quello di `to`, che è vivo. La bozza è l'**unica** copia di ciò che
        // l'utente ha scritto: `mv A.md B.md` in un terminale cancellava per
        // sempre il buffer sporco di `B`, in silenzio.
        //
        // La guardia sta **qui e non dentro i tre canali** perché è la stessa
        // domanda per tutti e tre, e a valle nessuno dei tre saprebbe più
        // rispondere «allora non era un rename»: la si eredita passando di
        // qua, non ricordandosela.
        //
        // Il prezzo lo paga chi ha rinominato, ed è dichiarato: la storia di
        // `from` si spezza e i suoi dati restano orfani fino alla prima
        // raccolta. Non paga niente di ciò che era di `to`. La degradazione è
        // la stessa di sopra — è sparito qualcosa da `from`, è comparso
        // qualcosa in `to` — e le due mezze verità vanno dette entrambe
        // (§14.1). Fondere invece di degradare è la forma (b) della voce, che
        // vuole tre politiche di collisione e resta aperta.
        if self.indexes.core.metas.contains_key(&to_id) {
            let started = self.sync_path_here(from)?;
            return Ok(self.sync_path_here(to)? || started);
        }
        if !to.exists() {
            self.remove_document(&from_id);
            return Ok(true);
        }
        // **Il disco è già avanti, quindi da qui in poi un `Err` secco è il
        // difetto** (0181). Chi ha spostato il file è un'altra applicazione: a
        // `to` i byte ci sono da prima che il rilevatore ce lo dicesse, e a
        // `from` non c'è più niente. Rispondere `Err` perché la destinazione
        // non si rilegge o non si parsa lasciava memoria, grafo, indici,
        // registro ed eventi fermi al nome vecchio — cioè un vault che mostra
        // una nota che sul disco non esiste, e che ad aprirla dà un errore,
        // fino alla riapertura.
        //
        // È la regola che il ripristino staged enuncia dal verso in cui la si
        // può ancora rispettare — «il parse è puro, e farlo dopo lascerebbe il
        // disco avanti rispetto a modelli, grafo e indici davanti a un
        // chiamante che riceve `Err`» —: là si legge **prima** di muovere,
        // qui muovere non è stata una nostra mossa e l'ordine non si può più
        // scegliere. Ciò che resta da rispettare è la seconda metà: non
        // lasciare vivo il nome vecchio.
        //
        // Non serve inventare un ramo: sono le **due mezze verità** che questa
        // funzione dice già in tre punti (§14.1) — da `from` è sparito
        // qualcosa, in `to` è comparso qualcosa — col prezzo già dichiarato
        // sopra, la storia di `from` che si spezza. Si paga solo quando
        // l'alternativa è un vault che racconta un file che non c'è; e se
        // anche la seconda metà non riesce, l'errore che risale arriva **dopo**
        // che la prima è stata detta, non al posto suo.
        let new = match self.docs.vault.read(&to_id) {
            Ok(source) => {
                let revision = Revision::of(&source);
                self.docs
                    .parse_owned(&to_id, source)
                    .map(|model| (model, revision))
            }
            Err(and) => Err(and),
        };
        let (model, revision) = match new {
            Ok(done) => done,
            Err(_) => {
                let started = self.sync_path_here(from)?;
                return Ok(self.sync_path_here(to)? || started);
            }
        };
        self.migrate_identity(&from_id, &to_id, model, revision);
        self.emit_event(Event::IndexUpdated);
        self.dispatch_pending();
        Ok(true)
    }

    /// Per ogni documento che linkava `from` per nome o per path, la
    /// **modifica** che riscrive i suoi riferimenti verso `to`. Sostituzione
    /// chirurgica: si tocca solo il testo del riferimento dentro lo `Span` del
    /// link, mai il resto del documento (heading `#...`, blocco `^...`, alias
    /// `|label` e formattazione restano intatti).
    ///
    /// La prepare conserva span, testo atteso e sostituzione senza leggere
    /// sorgenti. L'`invoke` owned legge ciascuna sorgente e costruisce
    /// l'[`EditRequest`] con la revisione CAS osservata in quel momento, così
    /// una scrittura successiva non viene cancellata dal piano.
    ///
    /// Vale per **entrambe le specie di link**, e la seconda ha un caso in più
    /// della prima. Un wikilink si rompe solo se si sposta il suo bersaglio; un
    /// link markdown è relativo alla cartella di chi lo scrive, quindi si rompe
    /// anche se si sposta la **sorgente**: muovere `a.md` in `sub/` invalida
    /// ogni `[t](altra.md)` che conteneva. Per questo `from` è sempre fra le
    /// sorgenti del piano — i suoi link uscenti vanno ri-basati sulla cartella
    /// nuova — e non solo quando linka se stesso.
    ///
    /// `retarget`: `to` esiste già e `from` non si sposta (l'unione di note,
    /// [`Self::prepare_link_retarget`]). Cambiano due cose: `to` non è un
    /// omonimo di sé stesso, e la riscrittura dentro `from` resta in `from`.
    pub(super) fn prepare_explicit_link_rewrites(
        &self,
        from: &DocId,
        to: &DocId,
        retarget: bool,
    ) -> Vec<PreparedExplicitLinkRewrite> {
        // Chi conta come omonimo di `to`: nella rinomina `to` non esiste
        // ancora; nel retarget c'è, ed è proprio lui.
        let rival = |id: &DocId| id != from && !(retarget && id == to);
        let from_name = resolution_key(from.page_name());
        let from_path = resolution_key(&strip_ext(from.as_str()));

        // Nuovo riferimento: il nome pagina se nessun altro documento lo
        // contende, altrimenti il path senza estensione, altrimenti il path
        // intero.
        //
        // **La terza forma esiste perché la seconda non è «sempre univoca»**,
        // come questo commento ha dichiarato fino alla
        // [0107](../../../docs/decisions/0192-impostazioni-locale-e-temi.md): la
        // chiave di `path_index` è `resolution_key(strip_ext(…))`, quindi
        // `sub/Nota.md` e `sub/nota.txt` la condividono. E qui non si sta
        // scegliendo cosa mostrare a schermo: si sta **scrivendo su disco nei
        // documenti di terzi**, cioè producendo il riferimento che un altro
        // programma leggerà fra un anno.
        //
        // **La prova non si può fare qui**, ed è stato misurato provandoci: la
        // strada onesta sarebbe chiedere al grafo se il riferimento scelto torna
        // davvero a `to`, ma questo piano si calcola *prima* che il rename sia
        // applicato — il grafo conosce ancora `from` e non ha mai sentito
        // nominare `to`. Ogni candidato risulterebbe sbagliato, e la
        // riscrittura scriverebbe sempre la forma più lunga. Quindi resta una
        // regola; ciò che cambia è che adesso la seconda condizione la si
        // **verifica** invece di affermarla.
        // **`metas` e non `entries`, ed è la scelta giusta** (difetto 0059, che
        // affermava il contrario). La gemella qui accanto —
        // `prepare_explicit_entry_link_rewrites`, che sposta un allegato — cerca
        // gli omonimi nell'anagrafe, e la differenza fra le due non è una svista:
        // **ogni piano cerca l'omonimia nel registro che il proprio risolutore
        // legge**. Un wikilink verso un allegato lo risolve la chiave dei nomi
        // dell'anagrafe, che porta il nome del file **con l'estensione**
        // (`![[foto.png]]`, mai `[[foto]]`), quindi un allegato non contende mai
        // un *nome pagina*; e dove le due stringhe coincidono davvero — un file
        // senza estensione — chi risolve prova il grafo per primo e ripiega
        // sull'anagrafe solo se lì non ha trovato niente. Allargare la ricerca a
        // `entries` scriverebbe il path intero dentro i documenti di terzi per
        // un'ambiguità che non esiste.
        let to_name = to.page_name();
        let ambiguous = self
            .indexes
            .core
            .metas
            .keys()
            .any(|id| rival(id) && resolution_key(id.page_name()) == resolution_key(to_name));
        // La stessa domanda sul path senza estensione, che è la chiave di
        // `path_index`: `sub/Nota.md` e `sub/nota.txt` la condividono, quindi
        // due file possono contenderselo esattamente come si contendono un
        // nome. Dove anche questa è contesa si scrive il path **intero**.
        let to_path_key = resolution_key(&strip_ext(to.as_str()));
        let path_ambiguous = self
            .indexes
            .core
            .metas
            .keys()
            .any(|id| rival(id) && resolution_key(&strip_ext(id.as_str())) == to_path_key);
        let new_ref = if !ambiguous {
            to_name.to_string()
        } else if !path_ambiguous {
            strip_ext(to.as_str())
        } else {
            to.as_str().to_string()
        };
        // Chi ha scritto l'estensione (`[[board.canvas]]`) nominava il file, e
        // la ritrova: il nome del file se nessun altro lo porta, e nessuna
        // pagina si chiama così (il nome pagina precede), sennò il path intero.
        let file_of = |id: &DocId| resolution_key(id.as_str().rsplit('/').next().unwrap_or(""));
        let from_file = file_of(from);
        let from_full = resolution_key(from.as_str());
        let to_file = file_of(to);
        let file_ambiguous = self.indexes.core.metas.keys().any(|id| {
            rival(id) && (file_of(id) == to_file || resolution_key(id.page_name()) == to_file)
        });
        let new_file_ref = if file_ambiguous {
            to.as_str().to_string()
        } else {
            to.as_str()
                .rsplit('/')
                .next()
                .unwrap_or(to.as_str())
                .to_string()
        };

        // Le note che linkano `from`, **una volta ciascuna**: chi lo cita tre
        // volte va riscritto una volta sola, e il filtro per-link qui sotto
        // cammina già tutti i suoi link. Prima questo era un `.map().collect()`
        // in un `BTreeSet` costruito qui: adesso l'insieme lo dice la firma.
        let mut sources: BTreeSet<DocId> =
            self.indexes.core.graph.linked(from, LinkDirection::Inbound);
        // Il self-link è escluso dai backlink per scelta, ma al rename va
        // riscritto come gli altri: `[[Nota]]` dentro la nota stessa resterebbe
        // dangling — e verrebbe dirottato da chi ricreasse il vecchio nome. Ai
        // link markdown serve comunque (vedi la nota sopra: sposta la
        // sorgente), quindi `from` entra sempre e sarà il filtro per-link a
        // dire se c'è davvero qualcosa da riscrivere.
        sources.insert(from.clone());

        let mut prepared = Vec::new();
        for source in sources {
            let Some(metadata) = self.indexes.core.metas.get(&source) else {
                continue;
            };
            let mut rewrites = Vec::new();
            for link in &metadata.links {
                let replacement = match &link.target {
                    LinkTarget::Wiki { page, .. } => {
                        // Riscrivi solo se il link puntava davvero a `from`
                        // (non a un omonimo) e ci arrivava per nome o per path
                        // — mai per alias. Il path può essere parziale
                        // (`[[Progetti/Alpha]]` per `Note/Progetti/Alpha.md`):
                        // è la coda del path a confine di cartella, la stessa
                        // regola del grafo, che qui sotto conferma il bersaglio.
                        let key = resolution_key(page);
                        let by_name = key == from_name;
                        let stem = resolution_key(&strip_ext(&key));
                        let by_path = key == from_path
                            || stem == from_path
                            || (key.contains('/') && from_path.ends_with(&format!("/{stem}")));
                        let with_extension = key == from_file || key == from_full;
                        if !(by_name || by_path || with_extension)
                            || self.indexes.core.graph.resolve_wiki(page).as_ref() != Some(from)
                        {
                            continue;
                        }
                        if with_extension {
                            new_file_ref.clone()
                        } else {
                            new_ref.clone()
                        }
                    }
                    LinkTarget::Path(written) => {
                        let Some(new_target) = self.rebased_path_link(from, to, &source, written)
                        else {
                            continue;
                        };
                        let (_, fragment) = rules_path::split_fragment(written);
                        let rewritten = format!("{new_target}{fragment}");
                        if rewritten == *written {
                            continue;
                        }
                        rewritten
                    }
                    LinkTarget::Url(_) => continue,
                };
                rewrites.push(LinkRewrite {
                    span: link.span,
                    target: link.target.clone(),
                    replacement,
                });
            }
            if rewrites.is_empty() {
                continue;
            }
            let Ok(source_path) = self.docs.vault.path_for(&source) else {
                continue;
            };
            // La sorgente rinominata vive ormai al path nuovo: la sua
            // riscrittura va applicata lì — e la base resta valida, perché un
            // rename sposta il file senza toccarne il contenuto. È una proprietà
            // della revisione-impronta: un contatore per-documento, qui, avrebbe
            // detto che il documento è cambiato.
            let destination = if &source == from && !retarget {
                to.clone()
            } else {
                source.clone()
            };
            match self.rewrite_plan_for(&destination) {
                Some(rewrite) => prepared.push(PreparedExplicitLinkRewrite {
                    source_path,
                    destination,
                    provider: Some(rewrite.provider),
                    provider_id: rewrite.provider_id,
                    ctx: rewrite.ctx,
                    source_kind: rewrite.source_kind,
                    rewrites,
                }),
                None => prepared.push(PreparedExplicitLinkRewrite {
                    source_path,
                    destination: destination.clone(),
                    provider: None,
                    provider_id: String::new(),
                    ctx: ParseContext::obsidian(destination.as_str()),
                    source_kind: SourceKind::Text,
                    rewrites,
                }),
            };
        }
        prepared
    }

    /// La destinazione che il link markdown `written`, scritto dentro `src`,
    /// deve avere dopo il rename `from` → `to`; `None` se non va toccato.
    ///
    /// Ci sono tre modi di non toccarlo, e sono tre cose diverse: il link non
    /// risolve (è già rotto — riscriverlo sarebbe indovinare); né la sorgente
    /// né il bersaglio si spostano (il path relativo continua a valere); il
    /// link parte dalla radice del vault e a spostarsi è solo la sorgente (la
    /// radice non si muove).
    ///
    /// L'estensione ricompare sempre nel riferimento nuovo, anche se il
    /// vecchio ne era privo: vedi [`fub_abi::rules::path::relative_ref`].
    pub(super) fn rebased_path_link(
        &self,
        from: &DocId,
        to: &DocId,
        src: &DocId,
        written: &str,
    ) -> Option<String> {
        let resolved = self.indexes.core.graph.resolve_path(src, written)?;
        let source_moves = src == from;
        let target_moves = resolved == *from;
        if !source_moves && !target_moves {
            return None;
        }
        let (path, _) = rules_path::split_fragment(written);
        let from_root = path.trim_start().starts_with('/');
        if from_root {
            if !target_moves {
                return None;
            }
            // Un link dalla radice resta dalla radice: è una scelta di stile
            // di chi scrive, e il rename non è il momento di discuterla.
            return Some(format!("/{}", rules_path::percent_encode_path(to.as_str())));
        }
        let src_after = if source_moves { to } else { src };
        let target_after = if target_moves { to } else { &resolved };
        Some(rules_path::relative_ref(src_after, target_after))
    }
}
