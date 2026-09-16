//! Ripristino dal cestino a fasi: il parser e gli indici girano senza guardie
//! del workspace, mentre il kernel riconvalida il disco prima del commit.

use super::*;

enum RestoreContent {
    Document {
        source_kind: fub_abi::format::SourceKind,
        parser: Box<PreparedParse>,
    },
    Attachment,
}

/// Ripristino risolto fino al confine del parser e della mossa.
///
/// Il token non porta prestiti del workspace. `invoke` può quindi leggere,
/// chiamare il provider e rinominare la voce dopo che l'host ha rilasciato
/// `Custody<Workspace>`.
#[must_use = "il ripristino preparato deve essere invocato"]
pub struct PreparedDocumentRestore {
    workspace_id: u64,
    entry: TrashEntry,
    target: DocId,
    documents: crate::documents::DocumentStoreHandle,
    content: RestoreContent,
}

/// Esito del parser e della mossa autorevole, ancora da installare nel core.
#[must_use = "il ripristino mosso deve essere committato o annullato"]
pub struct CompletedDocumentRestore {
    workspace_id: u64,
    model: Option<DocumentModel>,
    documents: crate::documents::DocumentStoreHandle,
    moved: crate::vault::CompletedVaultRestore,
}

/// Ripristino già committato sul disco e nel core, con indici, migrazioni e
/// finalizzazione del sidecar ancora da eseguire fuori dalla guardia.
#[must_use = "il ripristino deve essere invocato e finalizzato"]
pub struct PendingDocumentRestore {
    workspace_id: u64,
    trash_id: DocId,
    target: DocId,
    documents: crate::documents::DocumentStoreHandle,
    organization: Arc<crate::organization::OrganizationStore>,
    rename_from: Option<DocId>,
    doc_data_warnings: Vec<String>,
    moved: Option<crate::vault::CompletedVaultRestore>,
    restored_identity: Option<crate::storage::FileIdentity>,
    observed_target: Option<(Revision, Option<crate::storage::FileIdentity>)>,
    routing_generation: u64,
    previous_provider_call: Option<bool>,
    journal: Arc<Journal>,
    origin: fub_abi::event::Origin,
    feed: Option<PreparedDocumentFeed>,
}

/// Epilogo che aspetta il drain degli eventi prima dell'unico append detached.
#[must_use = "il journal del ripristino deve essere scritto"]
pub struct PreparedDocumentRestoreCompletion {
    outcome: DocId,
    trash_id: DocId,
    journal: Arc<Journal>,
    origin: fub_abi::event::Origin,
}

/// Esito owned dell'append, da riportare nel workspace senza altro I/O.
pub struct CompletedDocumentRestoreCompletion {
    outcome: DocId,
    journal_fault: Option<String>,
}

impl PreparedDocumentRestoreCompletion {
    pub fn invoke(self) -> CompletedDocumentRestoreCompletion {
        let journal_fault = self
            .journal
            .append(
                self.origin,
                JournalOp::Restored {
                    trash: self.trash_id,
                    doc: self.outcome.clone(),
                },
            )
            .err();
        CompletedDocumentRestoreCompletion {
            outcome: self.outcome,
            journal_fault,
        }
    }
}

impl PreparedDocumentRestore {
    /// Destinazione nel vault risolta durante la preparazione.
    pub fn target(&self) -> &DocId {
        &self.target
    }

    /// Legge la sorgente, invoca parser e sintassi e infine compie la mossa
    /// no-replace usando soltanto handle owned.
    pub fn invoke(self) -> Result<CompletedDocumentRestore> {
        let PreparedDocumentRestore {
            workspace_id,
            entry,
            target,
            documents,
            content,
        } = self;
        let (source_revision, model) = match content {
            RestoreContent::Document {
                source_kind,
                parser,
            } => {
                let source = match source_kind {
                    fub_abi::format::SourceKind::Text => {
                        DocumentSource::Text(documents.read(&entry.id)?)
                    }
                    fub_abi::format::SourceKind::Bytes => {
                        DocumentSource::Bytes(documents.read_bytes(&entry.id)?)
                    }
                };
                let revision = Revision::of_bytes(source.bytes());
                (revision, Some((*parser).invoke(source)?))
            }
            RestoreContent::Attachment => {
                (Revision::of_bytes(&documents.read_bytes(&entry.id)?), None)
            }
        };
        let moved = documents
            .prepare_restore(entry, target, source_revision)?
            .invoke()?;
        Ok(CompletedDocumentRestore {
            workspace_id,
            model,
            documents,
            moved,
        })
    }
}

impl CompletedDocumentRestore {
    /// Annulla una mossa rifiutata dal core senza riprendere il workspace.
    pub fn rollback(self) -> Result<()> {
        self.moved.rollback()
    }
}

impl PendingDocumentRestore {
    /// Migra i side-data, alimenta gli indici, osserva la revisione stabile e
    /// infine rimuove best-effort il sidecar, sempre senza custodire il
    /// workspace.
    pub fn invoke_indexes(mut self) -> Self {
        if let Some(from) = self.rename_from.as_ref() {
            if let Err(error) = self
                .organization
                .migrate(from.as_str(), self.target.as_str())
            {
                self.organization.warn(format!(
                    "l'organizzazione di {from} non ha potuto seguire la rinomina in {}: {error}",
                    self.target
                ));
            }
            self.doc_data_warnings.extend(
                self.documents
                    .migrate_data(from, &self.target)
                    .into_iter()
                    .map(|error| {
                        format!(
                            "lo stato per-documento di {from} non ha potuto seguire la rinomina \
                             in {} — {error}",
                            self.target
                        )
                    }),
            );
        }
        if let Some(mut feed) = self.feed.take().map(PreparedDocumentFeed::invoke_indexes) {
            self.observed_target = match self.documents.observe_revision_stable(&self.target) {
                Ok(observed) => observed,
                Err(error) => {
                    feed.losses.push(IndexLoss::new(
                        self.target.clone(),
                        PluginError::from(error),
                    ));
                    None
                }
            };
            self.feed = Some(feed);
        }
        if let Some(moved) = self.moved.take() {
            moved.finalize();
        }
        self
    }
}

impl Workspace {
    /// Prepara una camminata owned del cestino. La closure esegue il solo I/O
    /// quando il chiamante ha già rilasciato l'eventuale guardia.
    #[doc(hidden)]
    pub fn detached_trash_listing(
        &self,
    ) -> impl FnOnce() -> Result<Vec<TrashEntry>> + Send + 'static {
        let documents = self.docs.detached();
        move || documents.list_trash()
    }

    /// Risolve voce, destinazione e parser per il percorso sincrono storico.
    pub fn prepare_document_restore(
        &self,
        trash_id: &DocId,
        to: Option<DocId>,
    ) -> Result<PreparedDocumentRestore> {
        let entry = self
            .docs
            .vault
            .list_trash()?
            .into_iter()
            .find(|entry| &entry.id == trash_id)
            .ok_or_else(|| KernelError::NotFound(trash_id.to_string()))?;
        self.prepare_listed_document_restore(entry, to)
    }

    /// Prepara una voce già elencata senza altro I/O né callback esterne.
    #[doc(hidden)]
    pub fn prepare_listed_document_restore(
        &self,
        entry: TrashEntry,
        to: Option<DocId>,
    ) -> Result<PreparedDocumentRestore> {
        self.indexes.ensure_mutation_available()?;
        let target = match to {
            Some(target) => new_doc_id(target.as_str())?,
            None => valid_doc_id(entry.original.as_str())?,
        };
        if self.indexes.core.entries.contains_key(&target)
            || self.indexes.core.metas.contains_key(&target)
        {
            return Err(KernelError::AlreadyExists(target.to_string()));
        }
        let documents = self.docs.detached();
        let content = match documents.prepare_parse_with_kind(&target)? {
            Some((source_kind, parser)) => RestoreContent::Document {
                source_kind,
                parser: Box::new(parser),
            },
            None => RestoreContent::Attachment,
        };
        Ok(PreparedDocumentRestore {
            workspace_id: self.workspace_id,
            entry,
            target,
            documents,
            content,
        })
    }

    /// Installa nel core una mossa già riconvalidata. Questa fase non consulta
    /// storage né provider: metadati e identità arrivano dalla ricevuta.
    pub fn commit_document_restore(
        &mut self,
        completed: CompletedDocumentRestore,
    ) -> std::result::Result<PendingDocumentRestore, Box<(PluginError, CompletedDocumentRestore)>>
    {
        if completed.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict("il ripristino appartiene a un altro workspace".into()),
                completed,
            )));
        }
        if let Err(error) = self.indexes.ensure_mutation_available() {
            return Err(Box::new((PluginError::from(error), completed)));
        }
        let target = completed.moved.target().clone();
        if self.indexes.core.entries.contains_key(&target)
            || self.indexes.core.metas.contains_key(&target)
        {
            return Err(Box::new((
                PluginError::AlreadyExists(target.to_string().into()),
                completed,
            )));
        }

        let entry = completed.moved.entry().clone();
        let source_revision = completed.moved.revision().clone();
        let stat = completed.moved.stat();
        let restored_identity = completed.moved.identity();
        let journal = JournalOp::Restored {
            trash: entry.id.clone(),
            doc: target.clone(),
        };
        let routing_generation = self.indexes.routing_generation();
        let (feed, previous_provider_call) = match completed.model {
            Some(model) => {
                let previous_provider_call = self.dispatch.enter_provider_call();
                let feed = self.prepare_ingest_model(
                    &target,
                    model,
                    source_revision,
                    Some((stat.size, stat.mtime)),
                    journal,
                );
                self.announce_index_feed(&feed);
                (Some(feed), Some(previous_provider_call))
            }
            None => {
                let kind = self.set_entry(&target, stat.size, stat.mtime, None);
                self.emit_event(Event::EntryChanged {
                    id: target.clone(),
                    kind,
                });
                self.emit_event(Event::IndexUpdated);
                (None, None)
            }
        };
        let rename_from = (target != entry.original).then(|| entry.original.clone());
        if let Some(from) = rename_from.as_ref() {
            self.emit_event(Event::DocumentRenamed {
                from: from.clone(),
                to: target.clone(),
            });
        }
        Ok(PendingDocumentRestore {
            workspace_id: completed.workspace_id,
            trash_id: entry.id,
            target,
            documents: completed.documents,
            organization: Arc::clone(&self.organization),
            rename_from,
            doc_data_warnings: Vec::new(),
            moved: Some(completed.moved),
            restored_identity,
            observed_target: None,
            routing_generation,
            previous_provider_call,
            journal: Arc::clone(&self.journal),
            origin: self.dispatch.origin(),
            feed,
        })
    }

    /// Completa stato derivato e coda eventi senza richiamare codice esterno.
    pub fn finish_document_restore_deferred(
        &mut self,
        pending: PendingDocumentRestore,
    ) -> std::result::Result<
        PreparedDocumentRestoreCompletion,
        Box<(PluginError, PendingDocumentRestore)>,
    > {
        if pending.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict("il ripristino appartiene a un altro workspace".into()),
                pending,
            )));
        }
        if pending.moved.is_some() {
            return Err(Box::new((
                PluginError::Conflict("il ripristino detached non è stato finalizzato".into()),
                pending,
            )));
        }
        let PendingDocumentRestore {
            trash_id,
            target,
            routing_generation,
            previous_provider_call,
            feed,
            restored_identity,
            observed_target,
            doc_data_warnings,
            journal,
            origin,
            ..
        } = pending;
        self.doc_data_warnings.extend(doc_data_warnings);
        if let Some(feed) = feed {
            if let Some(previous_provider_call) = previous_provider_call {
                self.dispatch.restore_provider_call(previous_provider_call);
            }
            let current = observed_target
                .as_ref()
                .is_some_and(|(revision, identity)| {
                    revision == &feed.revision && identity == &restored_identity
                })
                && routing_generation == self.indexes.routing_generation();
            self.finish_sync_index_feed(feed, current);
        }
        Ok(PreparedDocumentRestoreCompletion {
            outcome: target,
            trash_id,
            journal,
            origin,
        })
    }

    /// Chiude il ripristino staged nel percorso sincrono storico.
    pub fn finish_document_restore(
        &mut self,
        pending: PendingDocumentRestore,
    ) -> std::result::Result<DocId, Box<(PluginError, PendingDocumentRestore)>> {
        let prepared = self.finish_document_restore_deferred(pending)?;
        self.dispatch_pending();
        Ok(self.finish_document_restore_completion(prepared.invoke()))
    }

    /// Riporta soltanto l'eventuale guasto dell'append già eseguito.
    pub fn finish_document_restore_completion(
        &mut self,
        completed: CompletedDocumentRestoreCompletion,
    ) -> DocId {
        if let Some(error) = completed.journal_fault {
            self.report_trouble(
                Severity::Failure,
                None,
                PluginError::Internal(format!("registro: {error}").into()),
                None,
            );
        }
        completed.outcome
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

    fn trashed_attachment(workspace: &mut Workspace, name: &str, bytes: &[u8]) -> DocId {
        let id = DocId::new(name);
        std::fs::write(workspace.root().join(name), bytes).unwrap();
        workspace.docs.vault.trash(&id).unwrap().0
    }

    #[test]
    fn wrong_workspace_rollback_restores_the_exact_trash_entry_and_sidecar() {
        let (_first_dir, mut first) = workspace();
        let (_second_dir, mut second) = workspace();
        let trash_id = trashed_attachment(&mut first, "asset.bin", b"first");
        let sidecar = crate::vault::data_root(first.root())
            .join("trash")
            .join(format!(
                "{}.json",
                Utf8Path::new(trash_id.as_str()).file_name().unwrap()
            ));
        let sidecar_before = std::fs::read(&sidecar).unwrap();
        let completed = first
            .prepare_document_restore(&trash_id, None)
            .unwrap()
            .invoke()
            .unwrap();
        assert_eq!(std::fs::read(&sidecar).unwrap(), sidecar_before);

        let completed = match second.commit_document_restore(completed) {
            Ok(_) => panic!("another workspace accepted the restore"),
            Err(failure) => {
                let (error, completed) = *failure;
                assert!(matches!(error, PluginError::Conflict(_)));
                completed
            }
        };
        completed.rollback().unwrap();
        assert!(!first.root().join("asset.bin").exists());
        assert_eq!(
            std::fs::read(first.root().join(trash_id.as_str())).unwrap(),
            b"first"
        );
        assert_eq!(std::fs::read(sidecar).unwrap(), sidecar_before);
    }

    #[test]
    fn a_changed_attachment_is_rejected_before_the_restore_move() {
        let (_dir, mut workspace) = workspace();
        let trash_id = trashed_attachment(&mut workspace, "asset.bin", b"first");
        let entry = workspace
            .docs
            .vault
            .list_trash()
            .unwrap()
            .into_iter()
            .find(|entry| entry.id == trash_id)
            .unwrap();
        let prepared = workspace
            .docs
            .vault
            .prepare_restore(entry, DocId::new("asset.bin"), Revision::of_bytes(b"first"))
            .unwrap();
        std::fs::write(workspace.root().join(trash_id.as_str()), b"changed").unwrap();

        let error = match prepared.invoke() {
            Ok(_) => panic!("a stale attachment was restored"),
            Err(error) => error,
        };
        assert!(matches!(error, KernelError::Stale(_)));
        assert!(!workspace.root().join("asset.bin").exists());
        assert_eq!(
            std::fs::read(workspace.root().join(trash_id.as_str())).unwrap(),
            b"changed"
        );
    }
}
