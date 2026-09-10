//! Ripristino dal cestino a fasi: il parser e gli indici girano senza guardie
//! del workspace, mentre il kernel riconvalida il disco prima del commit.

use super::*;

enum RestoreContent {
    Document {
        source: DocumentSource,
        revision: Revision,
        parser: Box<PreparedParse>,
    },
    Attachment {
        revision: Revision,
    },
}

/// Ripristino risolto fino al confine del parser.
///
/// Il token non porta prestiti del workspace. `invoke` può quindi attraversare
/// un `FormatProvider` dopo che l'host ha rilasciato `Custody<Workspace>`.
#[must_use = "il ripristino preparato deve essere parsato e finalizzato"]
pub struct PreparedDocumentRestore {
    workspace_id: u64,
    entry: TrashEntry,
    target: DocId,
    content: RestoreContent,
}

/// Esito del parser, ancora da riconvalidare e applicare al vault.
pub struct CompletedDocumentRestore {
    workspace_id: u64,
    entry: TrashEntry,
    target: DocId,
    source_kind: Option<fub_abi::format::SourceKind>,
    source_revision: Revision,
    model: Option<DocumentModel>,
}

/// Ripristino già committato sul disco e nel core, con gli indici esterni
/// ancora da alimentare fuori dalla guardia.
#[must_use = "gli indici del ripristino devono essere invocati e finalizzati"]
pub struct PendingDocumentRestore {
    workspace_id: u64,
    trash_id: DocId,
    target: DocId,
    routing_generation: u64,
    previous_provider_call: Option<bool>,
    feed: Option<PreparedDocumentFeed>,
}

impl PreparedDocumentRestore {
    /// Destinazione nel vault risolta durante la preparazione.
    pub fn target(&self) -> &DocId {
        &self.target
    }

    /// Esegue soltanto il parser e le regole sintattiche esterne.
    pub fn invoke(self) -> Result<CompletedDocumentRestore> {
        let PreparedDocumentRestore {
            workspace_id,
            entry,
            target,
            content,
        } = self;
        let (source_kind, source_revision, model) = match content {
            RestoreContent::Document {
                source,
                revision,
                parser,
            } => (
                Some(source.kind()),
                revision,
                Some((*parser).invoke(source)?),
            ),
            RestoreContent::Attachment { revision } => (None, revision, None),
        };
        Ok(CompletedDocumentRestore {
            workspace_id,
            entry,
            target,
            source_kind,
            source_revision,
            model,
        })
    }
}

impl PendingDocumentRestore {
    /// Alimenta e rilascia gli indici senza prendere in prestito il workspace.
    pub fn invoke_indexes(mut self) -> Self {
        self.feed = self.feed.take().map(PreparedDocumentFeed::invoke_indexes);
        self
    }
}

impl Workspace {
    /// Risolve voce, destinazione e parser senza eseguire callback esterne.
    pub fn prepare_document_restore(
        &self,
        trash_id: &DocId,
        to: Option<DocId>,
    ) -> Result<PreparedDocumentRestore> {
        self.indexes.ensure_mutation_available()?;
        let entry = self
            .docs
            .vault
            .list_trash()?
            .into_iter()
            .find(|entry| &entry.id == trash_id)
            .ok_or_else(|| KernelError::NotFound(trash_id.to_string()))?;
        let target = match to {
            Some(to) => new_doc_id(to.as_str())?,
            None => entry.original.clone(),
        };
        if self.is_taken(&target) {
            return Err(KernelError::AlreadyExists(target.to_string()));
        }
        let ext = extension_of(&target).unwrap_or_default();
        let content = match self.docs.registry.provider_for_ext(&ext) {
            Some(_) => {
                let descriptor = self
                    .docs
                    .registry
                    .descriptor_for_ext(&ext)
                    .ok_or_else(|| KernelError::NoProvider(ext.clone()))?;
                let source = match descriptor.source {
                    fub_abi::format::SourceKind::Text => {
                        DocumentSource::Text(self.docs.vault.read(trash_id)?)
                    }
                    fub_abi::format::SourceKind::Bytes => {
                        DocumentSource::Bytes(self.docs.vault.read_bytes(trash_id)?)
                    }
                };
                let revision = Revision::of_bytes(source.bytes());
                let parser = self.docs.prepare_parse(&target)?;
                RestoreContent::Document {
                    source,
                    revision,
                    parser: Box::new(parser),
                }
            }
            None => RestoreContent::Attachment {
                revision: Revision::of_bytes(&self.docs.vault.read_bytes(trash_id)?),
            },
        };
        Ok(PreparedDocumentRestore {
            workspace_id: self.workspace_id,
            entry,
            target,
            content,
        })
    }

    /// Riconvalida il token e sposta la voce una sola volta. Non chiama
    /// provider: per un documento restituisce invece gli handle nel token
    /// pending, che l'host invoca dopo aver rilasciato la guardia.
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
        let entries = match self.docs.vault.list_trash() {
            Ok(entries) => entries,
            Err(error) => return Err(Box::new((PluginError::from(error), completed))),
        };
        let current = entries
            .into_iter()
            .find(|entry| entry.id == completed.entry.id);
        let Some(current) = current else {
            return Err(Box::new((
                PluginError::NotFound(completed.entry.id.to_string().into()),
                completed,
            )));
        };
        if current != completed.entry {
            return Err(Box::new((
                PluginError::Conflict(completed.entry.id.to_string().into()),
                completed,
            )));
        }
        if self.is_taken(&completed.target) {
            return Err(Box::new((
                PluginError::AlreadyExists(completed.target.to_string().into()),
                completed,
            )));
        }
        let current_revision = match completed.source_kind {
            Some(fub_abi::format::SourceKind::Text) => self
                .docs
                .vault
                .read(&completed.entry.id)
                .map(|source| Revision::of_bytes(source.as_bytes())),
            Some(fub_abi::format::SourceKind::Bytes) | None => self
                .docs
                .vault
                .read_bytes(&completed.entry.id)
                .map(|source| Revision::of_bytes(&source)),
        };
        let current_revision = match current_revision {
            Ok(revision) => revision,
            Err(error) => return Err(Box::new((PluginError::from(error), completed))),
        };
        if current_revision != completed.source_revision {
            return Err(Box::new((
                PluginError::Conflict(completed.entry.id.to_string().into()),
                completed,
            )));
        }

        if let Err(error) = self
            .docs
            .vault
            .restore_trashed(&completed.entry.id, &completed.target)
        {
            return Err(Box::new((PluginError::from(error), completed)));
        }
        let journal = JournalOp::Restored {
            trash: completed.entry.id.clone(),
            doc: completed.target.clone(),
        };
        let routing_generation = self.indexes.routing_generation();
        let (feed, previous_provider_call) = match completed.model {
            Some(model) => {
                let previous_provider_call = self.dispatch.enter_provider_call();
                let feed = self.prepare_ingest_model(
                    &completed.target,
                    model,
                    completed.source_revision,
                    None,
                    journal,
                );
                self.announce_index_feed(&feed);
                (Some(feed), Some(previous_provider_call))
            }
            None => {
                let kind = self
                    .touch_entry(&completed.target, None)
                    .unwrap_or(EntryKind::Unknown);
                self.emit_event(Event::EntryChanged {
                    id: completed.target.clone(),
                    kind,
                });
                self.emit_event(Event::IndexUpdated);
                (None, None)
            }
        };
        if completed.target != completed.entry.original {
            self.migrate_doc_data(&completed.entry.original, &completed.target);
            self.emit_event(Event::DocumentRenamed {
                from: completed.entry.original,
                to: completed.target.clone(),
            });
        }
        Ok(PendingDocumentRestore {
            workspace_id: completed.workspace_id,
            trash_id: completed.entry.id,
            target: completed.target,
            routing_generation,
            previous_provider_call,
            feed,
        })
    }

    /// Completa stato derivato, migrazione e coda eventi senza richiamare
    /// codice esterno. Un token consegnato al workspace sbagliato viene
    /// restituito intatto al chiamante.
    pub fn finish_document_restore_deferred(
        &mut self,
        pending: PendingDocumentRestore,
    ) -> std::result::Result<DeferredEvents<DocId>, Box<(PluginError, PendingDocumentRestore)>>
    {
        if pending.workspace_id != self.workspace_id {
            return Err(Box::new((
                PluginError::Conflict("il ripristino appartiene a un altro workspace".into()),
                pending,
            )));
        }
        let PendingDocumentRestore {
            trash_id,
            target,
            routing_generation,
            previous_provider_call,
            feed,
            ..
        } = pending;
        if let Some(feed) = feed {
            if let Some(previous_provider_call) = previous_provider_call {
                self.dispatch.restore_provider_call(previous_provider_call);
            }
            let path = self.root().join(target.as_str());
            let current_revision = self
                .docs
                .vault
                .read_bytes(&target)
                .map(|source| Revision::of_bytes(&source));
            let current = self.docs.vault.doc_id_for_path(&path).ok().as_ref() == Some(&target)
                && current_revision.ok().as_ref() == Some(&feed.revision)
                && routing_generation == self.indexes.routing_generation();
            self.finish_sync_index_feed(feed, current);
        }
        Ok(DeferredEvents {
            outcome: target.clone(),
            previous_actor: None,
            journal: Some(JournalOp::Restored {
                trash: trash_id,
                doc: target,
            }),
        })
    }

    /// Chiude il ripristino staged dopo che l'host ha alimentato gli indici
    /// fuori dalla propria guardia. Gli eventi precedono l'unica riga journal,
    /// come nel percorso storico.
    pub fn finish_document_restore(
        &mut self,
        pending: PendingDocumentRestore,
    ) -> std::result::Result<DocId, Box<(PluginError, PendingDocumentRestore)>> {
        let deferred = self.finish_document_restore_deferred(pending)?;
        self.dispatch_pending();
        Ok(self.finish_deferred_events(deferred))
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
    fn wrong_workspace_returns_a_reusable_restore_token() {
        let (_first_dir, mut first) = workspace();
        let (_second_dir, mut second) = workspace();
        let trash_id = trashed_attachment(&mut first, "asset.bin", b"first");
        let completed = first
            .prepare_document_restore(&trash_id, None)
            .unwrap()
            .invoke()
            .unwrap();

        let completed = match second.commit_document_restore(completed) {
            Ok(_) => panic!("another workspace accepted the restore"),
            Err(failure) => {
                let (error, completed) = *failure;
                assert!(matches!(error, PluginError::Conflict(_)));
                completed
            }
        };
        let pending = match first.commit_document_restore(completed) {
            Ok(pending) => pending,
            Err(_) => panic!("the original workspace rejected its restore token"),
        };
        assert_eq!(pending.target, DocId::new("asset.bin"));
        assert_eq!(
            std::fs::read(first.root().join("asset.bin")).unwrap(),
            b"first"
        );
    }

    #[test]
    fn a_changed_attachment_is_rejected_before_the_restore_move() {
        let (_dir, mut workspace) = workspace();
        let trash_id = trashed_attachment(&mut workspace, "asset.bin", b"first");
        let completed = workspace
            .prepare_document_restore(&trash_id, None)
            .unwrap()
            .invoke()
            .unwrap();
        std::fs::write(workspace.root().join(trash_id.as_str()), b"changed").unwrap();

        let error = match workspace.commit_document_restore(completed) {
            Ok(_) => panic!("a stale attachment was restored"),
            Err(failure) => failure.0,
        };
        assert!(matches!(error, PluginError::Conflict(_)));
        assert!(!workspace.root().join("asset.bin").exists());
        assert_eq!(
            std::fs::read(workspace.root().join(trash_id.as_str())).unwrap(),
            b"changed"
        );
    }
}
