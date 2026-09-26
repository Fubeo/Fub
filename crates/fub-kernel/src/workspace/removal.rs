//! Rimozioni: prima l'autorità del kernel, poi gli indici senza guard, infine
//! gli eventi. Il completamento non porta handle né può cancellare nuova identità.

use super::*;

#[must_use = "la rimozione deve notificare gli indici e finalizzare gli eventi"]
pub struct PreparedDocumentRemoval {
    workspace_id: u64,
    id: DocId,
    providers: Vec<(String, SharedIndexProvider)>,
    previous_provider_call: bool,
    watcher: bool,
    /// `None` per un documento; la specie per una voce dell'anagrafe che
    /// documento non è (un allegato, un file sconosciuto), che esce con
    /// `EntryRemoved` invece di `DocumentRemoved`.
    entry_kind: Option<EntryKind>,
}

pub struct CompletedDocumentRemoval {
    workspace_id: u64,
    id: DocId,
    previous_provider_call: bool,
    watcher: bool,
    losses: Vec<IndexLoss>,
    entry_kind: Option<EntryKind>,
}

impl PreparedDocumentRemoval {
    /// Consuma e rilascia tutti gli handle fuori da `Custody<Workspace>`.
    /// Gli errori e i panic dei provider diventano perdite nominate.
    pub fn invoke(self) -> CompletedDocumentRemoval {
        let PreparedDocumentRemoval {
            workspace_id,
            id,
            providers,
            previous_provider_call,
            watcher,
            entry_kind,
        } = self;
        let mut losses = crate::index::forget_handles(&providers, std::slice::from_ref(&id));
        if let Err(error) = crate::index::release_handles(providers) {
            losses.push(IndexLoss::new(id.clone(), error));
        }
        CompletedDocumentRemoval {
            workspace_id,
            id,
            previous_provider_call,
            watcher,
            losses,
            entry_kind,
        }
    }
}

#[must_use = "la cancellazione preparata deve essere invocata"]
pub struct PreparedDocumentDeletion {
    workspace_id: u64,
    id: DocId,
    entry: Option<VaultEntry>,
    fingerprint: Option<Revision>,
    trash: crate::vault::PreparedVaultTrash,
    drafts: Arc<Drafts>,
    journal: Arc<Journal>,
    origin: fub_abi::event::Origin,
}

/// File già nel cestino, ma core e indici ancora intatti.
#[must_use = "la cancellazione completata deve essere committata o annullata"]
pub struct CompletedDocumentDeletion {
    workspace_id: u64,
    id: DocId,
    entry: Option<VaultEntry>,
    fingerprint: Option<Revision>,
    trash: crate::vault::CompletedVaultTrash,
    drafts: Arc<Drafts>,
    journal: Arc<Journal>,
    origin: fub_abi::event::Origin,
}

#[must_use = "gli indici della cancellazione devono essere invocati"]
pub struct CommittedDocumentDeletion {
    removal: PreparedDocumentRemoval,
    trash: crate::vault::CompletedVaultTrash,
    drafts: Arc<Drafts>,
    journal: Arc<Journal>,
    origin: fub_abi::event::Origin,
}

pub struct FinalizedDocumentDeletion {
    removal: CompletedDocumentRemoval,
    trashed: DocId,
    sidecar_fault: Option<KernelError>,
    draft_fault: Option<String>,
    journal_fault: Option<String>,
}

/// La variante OS conserva lo stesso snapshot dell'operazione interna, senza
/// simulare una voce `.trash` che non esiste.
#[must_use = "la cancellazione OS completata va committata o annullata"]
pub struct CompletedOsDocumentDeletion(CompletedOsDeletionState);

enum CompletedOsDeletionState {
    Internal {
        completed: CompletedDocumentDeletion,
        reason: crate::os_trash::FallbackReason,
        size: u64,
    },
    Os {
        workspace_id: u64,
        id: DocId,
        entry: Option<VaultEntry>,
        fingerprint: Option<Revision>,
        moved: crate::vault::CompletedOsTrash,
        drafts: Arc<Drafts>,
        journal: Arc<Journal>,
        origin: fub_abi::event::Origin,
    },
}

impl CompletedOsDocumentDeletion {
    pub fn rollback(self) -> Result<()> {
        match self.0 {
            CompletedOsDeletionState::Internal { completed, .. } => completed.rollback(),
            CompletedOsDeletionState::Os { moved, .. } => moved.rollback(),
        }
    }
}

#[must_use = "la cancellazione OS committata va finalizzata"]
pub struct CommittedOsDocumentDeletion(CommittedOsDeletionState);

enum CommittedOsDeletionState {
    Internal {
        committed: CommittedDocumentDeletion,
        reason: crate::os_trash::FallbackReason,
        size: u64,
    },
    Os {
        removal: PreparedDocumentRemoval,
        receipt: crate::os_trash::OsTrashReceipt,
        drafts: Arc<Drafts>,
        journal: Arc<Journal>,
        origin: fub_abi::event::Origin,
    },
}

pub struct FinalizedOsDocumentDeletion(FinalizedOsDeletionState);

enum FinalizedOsDeletionState {
    Internal {
        finalized: FinalizedDocumentDeletion,
        reason: crate::os_trash::FallbackReason,
        size: u64,
    },
    Os {
        removal: CompletedDocumentRemoval,
        receipt: crate::os_trash::OsTrashReceipt,
        draft_fault: Option<String>,
        journal_fault: Option<String>,
    },
}

impl PreparedDocumentDeletion {
    /// Esegue soltanto la mossa sullo storage e il sidecar, senza workspace.
    pub fn invoke(self) -> Result<CompletedDocumentDeletion> {
        Ok(CompletedDocumentDeletion {
            workspace_id: self.workspace_id,
            id: self.id,
            entry: self.entry,
            fingerprint: self.fingerprint,
            trash: self.trash.invoke()?,
            drafts: self.drafts,
            journal: self.journal,
            origin: self.origin,
        })
    }

    pub fn invoke_os(
        self,
        backend: &dyn crate::os_trash::OsTrashBackend,
    ) -> Result<CompletedOsDocumentDeletion> {
        let moved = self.trash.invoke_os(backend)?;
        Ok(CompletedOsDocumentDeletion(match moved {
            crate::vault::CompletedOsTrashMove::Internal {
                completed,
                reason,
                size,
            } => CompletedOsDeletionState::Internal {
                completed: CompletedDocumentDeletion {
                    workspace_id: self.workspace_id,
                    id: self.id,
                    entry: self.entry,
                    fingerprint: self.fingerprint,
                    trash: completed,
                    drafts: self.drafts,
                    journal: self.journal,
                    origin: self.origin,
                },
                reason,
                size,
            },
            crate::vault::CompletedOsTrashMove::Os(moved) => CompletedOsDeletionState::Os {
                workspace_id: self.workspace_id,
                id: self.id,
                entry: self.entry,
                fingerprint: self.fingerprint,
                moved,
                drafts: self.drafts,
                journal: self.journal,
                origin: self.origin,
            },
        }))
    }
}

impl CompletedDocumentDeletion {
    /// Annulla una mossa che il workspace ha rifiutato al commit.
    pub fn rollback(self) -> Result<()> {
        self.trash.rollback()
    }

    pub fn trashed(&self) -> &DocId {
        self.trash.trashed()
    }
}

impl CommittedDocumentDeletion {
    /// Notifica gli indici usando soltanto handle owned.
    pub fn invoke(self) -> FinalizedDocumentDeletion {
        let id = self.removal.id.clone();
        let (trashed, sidecar_fault) = self.trash.into_parts();
        let draft_fault = self
            .drafts
            .discard(&id)
            .err()
            .map(|error| error.to_string());
        let journal_fault = self
            .journal
            .append(
                self.origin,
                JournalOp::Trashed {
                    doc: id,
                    trash: trashed.clone(),
                },
            )
            .err();
        FinalizedDocumentDeletion {
            removal: self.removal.invoke(),
            trashed,
            sidecar_fault,
            draft_fault,
            journal_fault,
        }
    }
}

impl CommittedOsDocumentDeletion {
    /// Tutto il lavoro sui provider e sugli store avviene fuori custodia.
    pub fn invoke(self) -> FinalizedOsDocumentDeletion {
        match self.0 {
            CommittedOsDeletionState::Internal {
                committed,
                reason,
                size,
            } => FinalizedOsDocumentDeletion(FinalizedOsDeletionState::Internal {
                finalized: committed.invoke(),
                reason,
                size,
            }),
            CommittedOsDeletionState::Os {
                removal,
                receipt,
                drafts,
                journal,
                origin,
            } => {
                let draft_fault = drafts
                    .discard(&receipt.id)
                    .err()
                    .map(|error| error.to_string());
                let journal_fault = journal
                    .append(
                        origin,
                        JournalOp::TrashedOs {
                            doc: receipt.id.clone(),
                            destination: receipt.dest.to_string(),
                        },
                    )
                    .err();
                FinalizedOsDocumentDeletion(FinalizedOsDeletionState::Os {
                    removal: removal.invoke(),
                    receipt,
                    draft_fault,
                    journal_fault,
                })
            }
        }
    }
}

impl Workspace {
    /// Non chiama provider. Un rientro che dovrebbe riusare un indice già in
    /// chiamata è rifiutato prima di mutare lo stato autorevole.
    pub fn prepare_document_removal(
        &mut self,
        id: &DocId,
    ) -> Result<Option<PreparedDocumentRemoval>> {
        self.indexes.ensure_mutation_available()?;
        if !self.indexes.core.contains(id) {
            return Ok(None);
        }
        let previous_provider_call = self.dispatch.enter_provider_call();
        // La nota con il focus non esiste più: `active_context` non deve
        // continuare a nominarla alle view (né tenerne una selezione).
        self.session.invalidate(id, ContextChange::Gone);
        self.indexes.core.remove_entry(id);
        self.indexes
            .core
            .on_documents_removed(std::slice::from_ref(id));
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        Ok(Some(PreparedDocumentRemoval {
            workspace_id: self.workspace_id,
            id: id.clone(),
            providers: self.indexes.feed_handles(),
            previous_provider_call,
            watcher: false,
            entry_kind: None,
        }))
    }

    /// Si può cestinare: un documento, o una voce dell'anagrafe.
    fn is_trashable(&self, id: &DocId) -> bool {
        self.indexes.core.metas.contains_key(id) || self.indexes.core.entries.contains_key(id)
    }

    /// La rimozione dal core di ciò che la cancellazione ha appena spostato nel
    /// cestino: il percorso dei documenti se lo è, altrimenti quello della voce.
    fn prepare_trashed_removal(&mut self, id: &DocId) -> Result<Option<PreparedDocumentRemoval>> {
        if self.indexes.core.contains(id) {
            return self.prepare_document_removal(id);
        }
        self.indexes.ensure_mutation_available()?;
        let previous_provider_call = self.dispatch.enter_provider_call();
        let Some(kind) = self.indexes.core.remove_entry(id) else {
            self.dispatch.restore_provider_call(previous_provider_call);
            return Ok(None);
        };
        Ok(Some(PreparedDocumentRemoval {
            workspace_id: self.workspace_id,
            id: id.clone(),
            // Gli indici dei provider seguono i documenti: una voce che
            // documento non è non ha niente da far dimenticare.
            providers: Vec::new(),
            previous_provider_call,
            watcher: false,
            entry_kind: Some(kind),
        }))
    }

    /// Prima metà di un rename: rimuove il vecchio modello dal core senza
    /// dichiarare sparito il contesto e senza emettere eventi di rimozione.
    pub(super) fn prepare_document_rename_removal(
        &mut self,
        id: &DocId,
    ) -> Result<Option<PreparedDocumentRemoval>> {
        self.indexes.ensure_mutation_available()?;
        if !self.indexes.core.contains(id) {
            return Ok(None);
        }
        let previous_provider_call = self.dispatch.enter_provider_call();
        self.indexes.core.remove_entry(id);
        self.indexes
            .core
            .on_documents_removed(std::slice::from_ref(id));
        Ok(Some(PreparedDocumentRemoval {
            workspace_id: self.workspace_id,
            id: id.clone(),
            providers: self.indexes.feed_handles(),
            previous_provider_call,
            watcher: true,
            entry_kind: None,
        }))
    }

    /// Recupera le perdite del remove senza produrre `DocumentRemoved`.
    pub(super) fn finish_document_rename_removal(
        &mut self,
        completed: CompletedDocumentRemoval,
    ) -> std::result::Result<Vec<IndexLoss>, CompletedDocumentRemoval> {
        if completed.workspace_id != self.workspace_id {
            return Err(completed);
        }
        self.dispatch
            .restore_provider_call(completed.previous_provider_call);
        Ok(completed.losses)
    }

    /// Prepara la rimozione che una lettura detached ha già classificato come
    /// path sparito. Non consulta il filesystem: l'identità è stata
    /// riconvalidata dal finalizzatore del piano watcher. Il fatto resta nel
    /// token fino al ritorno degli indici esterni.
    pub fn prepare_sync_document_removal(
        &mut self,
        id: &DocId,
    ) -> Result<Option<PreparedDocumentRemoval>> {
        if !self.docs.has_provider_for(id) || !self.indexes.core.contains(id) {
            return Ok(None);
        }
        self.indexes.ensure_mutation_available()?;
        let mut prepared = self.prepare_document_removal(id)?;
        if let Some(prepared) = &mut prepared {
            prepared.watcher = true;
        }
        Ok(prepared)
    }

    /// Chiude la callback della rimozione watcher e annuncia solo adesso il
    /// fatto già committato. Il frame, il fatto e le perdite appartengono al
    /// token e vengono recuperati anche se nel frattempo il documento rinasce.
    pub(super) fn finish_sync_document_removal(
        &mut self,
        completed: CompletedDocumentRemoval,
    ) -> std::result::Result<(), (PluginError, CompletedDocumentRemoval)> {
        if completed.workspace_id != self.workspace_id {
            return Err((
                PluginError::Conflict("la rimozione appartiene a un altro workspace".into()),
                completed,
            ));
        }
        self.dispatch
            .restore_provider_call(completed.previous_provider_call);
        self.as_actor(Actor::Watcher, |ws| {
            ws.emit_event(Event::DocumentRemoved { id: completed.id });
            ws.emit_event(Event::IndexUpdated);
            ws.report_losses(completed.losses);
        });
        Ok(())
    }

    /// Il token non ripristina metadati né provider. Se il documento è stato
    /// ricreato da un'operazione più recente, conserva quella nuova identità.
    pub fn finish_document_removal(
        &mut self,
        completed: CompletedDocumentRemoval,
    ) -> std::result::Result<(), (PluginError, CompletedDocumentRemoval)> {
        if completed.workspace_id != self.workspace_id {
            return Err((
                PluginError::Conflict("la rimozione appartiene a un altro workspace".into()),
                completed,
            ));
        }
        self.apply_document_removal(completed);
        Ok(())
    }

    fn apply_document_removal(&mut self, completed: CompletedDocumentRemoval) {
        self.dispatch
            .restore_provider_call(completed.previous_provider_call);
        let finish = |ws: &mut Workspace| {
            ws.report_losses(completed.losses);
            if let Some(kind) = completed.entry_kind {
                if ws.indexes.core.entries.contains_key(&completed.id) {
                    ws.report_trouble(
                        Severity::Warning,
                        Some(completed.id),
                        PluginError::Conflict(
                            "la voce è stata ricreata durante la rimozione".into(),
                        ),
                        None,
                    );
                } else {
                    ws.emit_event(Event::EntryRemoved {
                        id: completed.id,
                        kind,
                    });
                    ws.emit_event(Event::IndexUpdated);
                }
            } else if ws.indexes.core.contains(&completed.id) {
                ws.report_trouble(
                    Severity::Warning,
                    Some(completed.id),
                    PluginError::Conflict(
                        "il documento è stato ricreato durante la rimozione".into(),
                    ),
                    None,
                );
            } else {
                ws.emit_event(Event::DocumentRemoved { id: completed.id });
                ws.emit_event(Event::IndexUpdated);
            }
        };
        if completed.watcher {
            self.as_actor(Actor::Watcher, finish);
        } else {
            finish(self);
        }
    }

    /// Cattura il documento e prepara la mossa senza I/O né mutazioni del core.
    pub fn prepare_document_deletion(&self, id: &DocId) -> Result<PreparedDocumentDeletion> {
        self.indexes.ensure_mutation_available()?;
        // Un documento o una qualunque voce dell'anagrafe: un allegato si
        // cestina come una nota (F02), e il cestino non distingue.
        if !self.is_trashable(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        Ok(PreparedDocumentDeletion {
            workspace_id: self.workspace_id,
            id: id.clone(),
            entry: self.indexes.core.entries.get(id).cloned(),
            fingerprint: self.entry_fingerprint(id),
            trash: self.docs.vault.prepare_trash(id)?,
            drafts: Arc::clone(&self.drafts),
            journal: Arc::clone(&self.journal),
            origin: self.dispatch.origin(),
        })
    }

    /// Riconvalida workspace, core, sorgente mossa e destinazione prima di
    /// iniziare la rimozione autorevole.
    pub fn commit_document_deletion(
        &mut self,
        completed: CompletedDocumentDeletion,
    ) -> std::result::Result<CommittedDocumentDeletion, Box<(KernelError, CompletedDocumentDeletion)>>
    {
        let current = completed.workspace_id == self.workspace_id
            && completed.trash.original() == &completed.id
            && self.is_trashable(&completed.id)
            && self.indexes.core.entries.get(&completed.id) == completed.entry.as_ref()
            && self.entry_fingerprint(&completed.id) == completed.fingerprint
            && completed
                .fingerprint
                .as_ref()
                .is_none_or(|revision| revision == completed.trash.revision())
            && completed.trash.is_current();
        if !current {
            return Err(Box::new((
                KernelError::Stale(completed.id.to_string()),
                completed,
            )));
        }
        if let Err(error) = self.indexes.ensure_mutation_available() {
            return Err(Box::new((error, completed)));
        }
        let removal = match self.prepare_trashed_removal(&completed.id) {
            Ok(Some(removal)) => removal,
            Ok(None) => {
                return Err(Box::new((
                    KernelError::Stale(completed.id.to_string()),
                    completed,
                )))
            }
            Err(error) => return Err(Box::new((error, completed))),
        };
        Ok(CommittedDocumentDeletion {
            removal,
            trash: completed.trash,
            drafts: completed.drafts,
            journal: completed.journal,
            origin: completed.origin,
        })
    }

    pub fn commit_os_document_deletion(
        &mut self,
        completed: CompletedOsDocumentDeletion,
    ) -> std::result::Result<
        CommittedOsDocumentDeletion,
        Box<(KernelError, CompletedOsDocumentDeletion)>,
    > {
        let (workspace_id, id, entry, fingerprint, moved, drafts, journal, origin) =
            match completed.0 {
                CompletedOsDeletionState::Internal {
                    completed,
                    reason,
                    size,
                } => {
                    return self
                        .commit_document_deletion(completed)
                        .map(|committed| {
                            CommittedOsDocumentDeletion(CommittedOsDeletionState::Internal {
                                committed,
                                reason,
                                size,
                            })
                        })
                        .map_err(|failure| {
                            let (error, completed) = *failure;
                            Box::new((
                                error,
                                CompletedOsDocumentDeletion(CompletedOsDeletionState::Internal {
                                    completed,
                                    reason,
                                    size,
                                }),
                            ))
                        });
                }
                CompletedOsDeletionState::Os {
                    workspace_id,
                    id,
                    entry,
                    fingerprint,
                    moved,
                    drafts,
                    journal,
                    origin,
                } => (
                    workspace_id,
                    id,
                    entry,
                    fingerprint,
                    moved,
                    drafts,
                    journal,
                    origin,
                ),
            };
        macro_rules! reject {
            ($error:expr) => {
                return Err(Box::new((
                    $error,
                    CompletedOsDocumentDeletion(CompletedOsDeletionState::Os {
                        workspace_id,
                        id,
                        entry,
                        fingerprint,
                        moved,
                        drafts,
                        journal,
                        origin,
                    }),
                )))
            };
        }
        let current = workspace_id == self.workspace_id
            && moved.original() == &id
            && self.is_trashable(&id)
            && self.indexes.core.entries.get(&id) == entry.as_ref()
            && self.entry_fingerprint(&id) == fingerprint
            && fingerprint
                .as_ref()
                .is_none_or(|revision| revision == moved.revision())
            && moved.is_current();
        if !current {
            reject!(KernelError::Stale(id.to_string()));
        }
        if let Err(error) = self.indexes.ensure_mutation_available() {
            reject!(error);
        }
        let removal = match self.prepare_trashed_removal(&id) {
            Ok(Some(removal)) => removal,
            Ok(None) => reject!(KernelError::Stale(id.to_string())),
            Err(error) => reject!(error),
        };
        Ok(CommittedOsDocumentDeletion(CommittedOsDeletionState::Os {
            removal,
            receipt: moved.receipt(),
            drafts,
            journal,
            origin,
        }))
    }

    pub fn finish_os_document_deletion(
        &mut self,
        finalized: FinalizedOsDocumentDeletion,
    ) -> std::result::Result<
        crate::os_trash::OsTrashReceipt,
        Box<(PluginError, FinalizedOsDocumentDeletion)>,
    > {
        match finalized.0 {
            FinalizedOsDeletionState::Internal {
                finalized,
                reason,
                size,
            } => {
                let original = finalized.removal.id.clone();
                self.finish_document_deletion(finalized)
                    .map(|trashed| crate::os_trash::OsTrashReceipt {
                        id: original,
                        via: crate::os_trash::TrashVia::InternalFallback { reason },
                        dest: self.docs.vault.root().join(trashed.as_str()),
                        size,
                    })
                    .map_err(|failure| {
                        let (error, finalized) = *failure;
                        Box::new((
                            error,
                            FinalizedOsDocumentDeletion(FinalizedOsDeletionState::Internal {
                                finalized,
                                reason,
                                size,
                            }),
                        ))
                    })
            }
            FinalizedOsDeletionState::Os {
                removal,
                receipt,
                draft_fault,
                journal_fault,
            } => {
                if removal.workspace_id != self.workspace_id {
                    return Err(Box::new((
                        PluginError::Conflict(
                            "la cancellazione appartiene a un altro workspace".into(),
                        ),
                        FinalizedOsDocumentDeletion(FinalizedOsDeletionState::Os {
                            removal,
                            receipt,
                            draft_fault,
                            journal_fault,
                        }),
                    )));
                }
                self.apply_document_removal(removal);
                self.dispatch_pending();
                self.finish_deleted_document(
                    &receipt.id,
                    receipt.id.clone(),
                    None,
                    draft_fault,
                    journal_fault,
                );
                Ok(receipt)
            }
        }
    }

    pub fn finish_document_deletion(
        &mut self,
        finalized: FinalizedDocumentDeletion,
    ) -> std::result::Result<DocId, Box<(PluginError, FinalizedDocumentDeletion)>> {
        if finalized.removal.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict("la cancellazione appartiene a un altro workspace".into()),
                finalized,
            )));
        }
        let FinalizedDocumentDeletion {
            removal,
            trashed,
            sidecar_fault,
            draft_fault,
            journal_fault,
        } = finalized;
        let id = removal.id.clone();
        self.apply_document_removal(removal);
        self.dispatch_pending();
        Ok(self.finish_deleted_document(&id, trashed, sidecar_fault, draft_fault, journal_fault))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(dir.path()).unwrap();
        let workspace = Workspace::new(root, FormatRegistry::new()).unwrap();
        (dir, workspace)
    }

    #[test]
    fn stale_removal_does_not_remove_a_recreated_identity() {
        let (_dir, mut ws) = workspace();
        let id = DocId::new("Note.md");
        let mut model = DocumentModel::empty(id.clone());
        ws.indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let prepared = ws.prepare_document_removal(&id).unwrap().unwrap();
        let completed = prepared.invoke();
        model.frontmatter.0.insert(
            "identity".into(),
            serde_json::Value::String("recreated".into()),
        );
        ws.indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let events = ws.bus().subscribe();
        assert!(ws.finish_document_removal(completed).is_ok());
        assert_eq!(
            ws.indexes
                .core
                .metas
                .get(&id)
                .and_then(|metadata| metadata.frontmatter.0.get("identity")),
            Some(&serde_json::Value::String("recreated".into()))
        );
        assert!(!ws.dispatch.in_provider_call());
        let notices: Vec<_> = events.try_iter().collect();
        assert_eq!(notices.len(), 1);
        assert!(matches!(
            &notices[0].event,
            Event::Trouble {
                error: PluginError::Conflict(_),
                ..
            }
        ));
    }

    #[test]
    fn wrong_workspace_returns_the_whole_sync_token_without_resetting_either_frame() {
        let (first_root, mut first) = workspace();
        let (_second_root, mut second) = workspace();
        let id = DocId::new("Note.md");
        first
            .indexes
            .core
            .on_documents_indexed(&[DocumentModel::empty(id.clone())]);
        let snapshot = SyncSnapshot {
            workspace_id: first.workspace_id,
            path: Utf8PathBuf::from_path_buf(first_root.path().join(id.as_str())).unwrap(),
            id: id.clone(),
            seen: first.entry_fingerprint(&id),
            entry: first.indexes.core.entries.get(&id).cloned(),
            syntax_generation: first.syntax_generation,
            routing_generation: first.indexes.routing_generation(),
        };
        let removal = first
            .prepare_document_removal(&id)
            .unwrap()
            .unwrap()
            .invoke();
        let completed = CompletedSyncChange {
            snapshot,
            state: CompletedSyncState::Removal(removal),
        };

        let (error, completed) = *match second.finish_sync_path_prepared(completed) {
            Err(failure) => failure,
            Ok(_) => panic!("il workspace sbagliato non deve consumare il token"),
        };
        assert!(matches!(error, PluginError::Conflict(_)));
        assert_eq!(completed.snapshot.workspace_id, first.workspace_id);
        assert!(first.dispatch.in_provider_call());
        assert!(!second.dispatch.in_provider_call());

        let removal = match completed.state {
            CompletedSyncState::Removal(removal) => removal,
            _ => panic!("il token deve conservare la rimozione completata"),
        };
        assert!(first.finish_document_removal(removal).is_ok());
        assert!(!first.dispatch.in_provider_call());
    }

    #[test]
    fn wrong_workspace_deletion_returns_the_whole_token_to_its_frame() {
        let (first_root, mut first) = workspace();
        let (_second_root, mut second) = workspace();
        let id = DocId::new("Note.md");
        std::fs::write(first_root.path().join(id.as_str()), "# Note\n").unwrap();
        first
            .indexes
            .core
            .on_documents_indexed(&[DocumentModel::empty(id.clone())]);
        let completed = first
            .prepare_document_deletion(&id)
            .unwrap()
            .invoke()
            .unwrap();
        let (error, completed) = *second.commit_document_deletion(completed).err().unwrap();
        assert!(matches!(error, KernelError::Stale(_)));
        assert!(!first.dispatch.in_provider_call());
        assert!(!second.dispatch.in_provider_call());

        let committed = match first.commit_document_deletion(completed) {
            Ok(committed) => committed,
            Err(failure) => {
                let (error, _) = *failure;
                panic!("il workspace originale deve accettare il token: {error}")
            }
        };
        assert!(first.dispatch.in_provider_call());
        let trashed = match first.finish_document_deletion(committed.invoke()) {
            Ok(trashed) => trashed,
            Err(failure) => {
                let (error, _) = *failure;
                panic!("il workspace originale deve finalizzare il token: {error}")
            }
        };
        assert!(!first.dispatch.in_provider_call());
        assert_ne!(trashed, id);
    }
}
