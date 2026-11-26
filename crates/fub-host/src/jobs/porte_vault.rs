//! Le porte del vault che `JobHost` offre ai lavori: lettura, scrittura, struttura e dati.

use super::*;

// Le dodici famiglie. Sono righe di delega e nessuna decisione: ogni
// decisione è già stata presa un livello più in basso (il recinto dei `DocId`,
// la politica dei permessi, il dispatch degli eventi), e ripeterne una qui
// sarebbe una seconda idea della stessa regola.

impl VaultRead for JobHost {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        self.read_result(|h| h.read_document(id))
    }

    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
        self.read_result(|h| h.read_document_bytes(id))
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        self.read_result(|h| h.document_revision(id))
    }

    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        self.read_result(|h| h.list_documents(page))
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.reading(|h| h.free_name(id))
            .unwrap_or_else(|_| id.clone())
    }

    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        self.stopped()?;
        let prepared = {
            let workspace = self.workspace.read()?;
            let policy = workspace.granted_policy(&self.plugin);
            authorize_path(&policy, Capability::VaultRead, id.as_str(), || {
                format!("reading model of `{id}`")
            })?;
            workspace.prepare_detached_document_model(id)?
        };
        let completed = prepared.invoke()?;
        self.workspace
            .read()?
            .finish_detached_document_model(completed)
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        self.reading(|h| h.format_of(id)).unwrap_or_default()
    }

    fn format_link(&self, doc: &DocId, link: &LinkInsert) -> Result<Option<String>, PluginError> {
        match self.prepare_format_edit(doc, false, "asking a link")? {
            Some(prepared) => prepared.format_link(link),
            None => Ok(None),
        }
    }

    /// Il piano si fotografa sotto la lettura del workspace; i provider che
    /// scrivono gli edit girano dopo, senza la guardia.
    fn link_retarget_edits(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Result<Vec<PlannedEdit>, PluginError> {
        self.stopped()?;
        let prepared = {
            let workspace = self.workspace.read()?;
            let policy = workspace.granted_policy(&self.plugin);
            authorize_path(&policy, Capability::VaultRead, "", || {
                format!("planning the links of `{from}` onto `{to}`")
            })?;
            workspace.prepare_link_retarget(from, to)?
        };
        Ok(prepared
            .edits()
            .map_err(PluginError::from)?
            .into_iter()
            .map(|(doc, edit)| PlannedEdit::new(doc, edit))
            .collect())
    }

    fn task_state_edit(
        &self,
        doc: &DocId,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Option<EditRequest>, PluginError> {
        match self.prepare_format_edit(doc, true, "asking a task edit")? {
            Some(prepared) => prepared.task_state_edit(marker, done),
            None => Ok(None),
        }
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        self.read_result(|h| h.list_trash())
    }
}

impl VaultWrite for JobHost {
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        self.write_document_detached(id, source, base, Capability::VaultWrite, "writing", false)
    }

    fn write_document_bytes(
        &mut self,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        let prepared = {
            let ws = workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultWrite,
                    id.as_str(),
                    || format!("writing bytes to `{id}`"),
                )?;
            }
            authorize_path(
                &ws.granted_policy(&self.plugin),
                Capability::VaultWrite,
                id.as_str(),
                || format!("writing bytes to `{id}`"),
            )?;
            ws.prepare_document_bytes_write(id, expected)
                .map_err(PluginError::from)?
        };
        let model = prepared.parse(bytes).map_err(PluginError::from)?;
        self.stopped()?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut detached = self.for_provider(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut detached)
        });
        self.stopped()?;
        let placed = prepared
            .place(bytes, before_write)
            .map_err(PluginError::from)?;
        let pending = {
            let mut ws = workspace.write()?;
            ws.commit_placed_document_bytes_write(placed, model)
        };
        let pending = pending.invoke_indexes();
        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_document_write_deferred(pending)
        };
        finish_events(&workspace, deferred)
    }

    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        self.stopped()?;
        {
            let ws = self.workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultWrite,
                    id.as_str(),
                    || format!("editing `{id}`"),
                )?;
            }
            authorize_path(
                &ws.granted_policy(&self.plugin),
                Capability::VaultWrite,
                id.as_str(),
                || format!("editing `{id}`"),
            )?;
        }
        self.apply_edit_detached(id, request)
    }
}

impl JobHost {
    /// Crea o toglie una cartella: un `mkdir` o un `rmdir` sotto il turno di
    /// scrittura, che non chiama codice di nessuno e quindi non ha una parte
    /// da fare fuori dalla guardia.
    pub(super) fn folder_structure(
        &mut self,
        folder: &str,
        doing: &str,
        apply: impl FnOnce(&mut Workspace) -> fub_kernel::Result<()>,
    ) -> Result<(), PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        {
            let ws = workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultStructure,
                    folder,
                    || format!("{doing} `{folder}`"),
                )?;
            }
            authorize_path(
                &ws.granted_policy(&self.plugin),
                Capability::VaultStructure,
                folder,
                || format!("{doing} `{folder}`"),
            )?;
        }
        with_event_drain(&workspace, apply)?.map_err(PluginError::from)
    }
}

impl JobHost {
    /// Cestina `id`; con `expected`, soltanto se ha ancora quella revisione. Il
    /// confronto sta sotto lo stesso turno di scrittura che cestina: un
    /// salvataggio non può inserirsi fra l'uno e l'altro.
    pub(super) fn trash_checked(
        &mut self,
        id: &DocId,
        expected: Option<&Revision>,
    ) -> Result<DocId, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        let prepared = {
            let ws = workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultStructure,
                    id.as_str(),
                    || format!("trashing `{id}`"),
                )?;
            }
            authorize_path(
                &ws.granted_policy(&self.plugin),
                Capability::VaultStructure,
                id.as_str(),
                || format!("trashing `{id}`"),
            )?;
            let id = fenced_doc_id(id)?;
            if let Some(expected) = expected {
                if ws.document_revision(&id).map_err(PluginError::from)? != *expected {
                    return Err(PluginError::Conflict(Text::message(
                        "host.vault.moved",
                        vec![Arg::text("doc", id.as_str())],
                    )));
                }
            }
            ws.prepare_document_deletion(&id)
                .map_err(PluginError::from)?
        };
        let completed = prepared.invoke().map_err(PluginError::from)?;
        let committed = {
            let mut ws = workspace.write()?;
            ws.commit_document_deletion(completed)
                .map_err(|failure| *failure)
        };
        let committed = match committed {
            Ok(committed) => committed,
            Err((error, completed)) => {
                completed.rollback().map_err(PluginError::from)?;
                return Err(PluginError::from(error));
            }
        };
        let finalized = committed.invoke();
        with_event_drain(&workspace, |ws| ws.finish_document_deletion(finalized))?.map_err(
            |failure| {
                let (error, _) = *failure;
                error
            },
        )
    }
}

impl VaultStructure for JobHost {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.write_document_detached(
            id,
            source,
            WriteBase::Dictated,
            Capability::VaultStructure,
            "creating",
            true,
        )
        .map(drop)
    }

    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        let (prepared_document, prepared_asset) = {
            let ws = workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultStructure,
                    from.as_str(),
                    || format!("renaming `{from}`"),
                )?;
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultStructure,
                    to.as_str(),
                    || format!("renaming to `{to}`"),
                )?;
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultWrite,
                    "",
                    || format!("rewriting backlinks after renaming `{from}`"),
                )?;
            }
            let policy = ws.granted_policy(&self.plugin);
            authorize_path(&policy, Capability::VaultStructure, from.as_str(), || {
                format!("renaming `{from}`")
            })?;
            authorize_path(&policy, Capability::VaultStructure, to.as_str(), || {
                format!("renaming to `{to}`")
            })?;
            authorize_path(&policy, Capability::VaultWrite, "", || {
                format!("rewriting backlinks after renaming `{from}`")
            })?;
            let from = fenced_doc_id(from)?;
            let to = fenced_doc_id(to)?;
            let prepared_document = ws
                .prepare_explicit_rename(&from, &to)
                .map_err(PluginError::from)?;
            let prepared_asset = if prepared_document.is_none() {
                ws.prepare_explicit_asset_rename(&from, &to)
                    .map_err(PluginError::from)?
            } else {
                None
            };
            (prepared_document, prepared_asset)
        };
        if let Some(prepared) = prepared_document {
            let parsed = prepared.invoke().map_err(PluginError::from)?;
            let committed = {
                let mut ws = workspace.write()?;
                ws.commit_explicit_rename(parsed)
                    .map_err(|failure| *failure)
            };
            let pending = match committed {
                Ok(pending) => pending,
                Err((error, parsed)) => {
                    parsed.rollback().map_err(PluginError::from)?;
                    return Err(PluginError::from(error));
                }
            };
            let completed = pending.invoke().invoke_rewrites(|source, request| {
                self.apply_edit_detached_inner(source, request.clone())
                    .map(drop)
            });
            with_event_drain(&workspace, |ws| ws.finish_explicit_rename(completed))?
                .map_err(|failure| failure.0)?
                .map_err(PluginError::from)
        } else if let Some(prepared) = prepared_asset {
            let moved = prepared.invoke().map_err(PluginError::from)?;
            let committed = {
                let mut ws = workspace.write()?;
                ws.commit_explicit_asset_rename(moved)
                    .map_err(|failure| *failure)
            };
            let pending = match committed {
                Ok(pending) => pending,
                Err((error, moved)) => {
                    moved.rollback().map_err(PluginError::from)?;
                    return Err(PluginError::from(error));
                }
            };
            let completed = pending.invoke_rewrites(|source, request| {
                self.apply_edit_detached_inner(source, request.clone())
                    .map(drop)
            });
            with_event_drain(&workspace, |ws| ws.finish_explicit_asset_rename(completed))?
                .map_err(|failure| failure.0)?
                .map_err(PluginError::from)
        } else {
            Ok(())
        }
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        self.trash_checked(id, None)
    }

    fn trash_document_if(&mut self, id: &DocId, expected: &Revision) -> Result<DocId, PluginError> {
        self.trash_checked(id, Some(expected))
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        let (policy, list_trash) = {
            let ws = workspace.read()?;
            let policy = ws.granted_policy(&self.plugin);
            if self.mode == InvokeMode::DryRun {
                authorize_family(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultStructure,
                    || format!("restoring `{entry}`"),
                )?;
            }
            authorize_family(&policy, Capability::VaultStructure, || {
                format!("restoring `{entry}`")
            })?;
            authorize_family(&policy, Capability::VaultRead, || "listing trash".into())?;
            (policy, ws.detached_trash_listing())
        };
        // La stessa regola della `Guard`, non una sua copia
        // (`fub_kernel::host::authorize_restore`), sulla stessa lista: ciò che
        // il plugin non può leggere non esiste, e la risposta è `NotFound` in
        // tutte e due. La simulazione è già stata rifiutata sopra: `ReadOnly`
        // nega l'intera famiglia `VaultStructure`, qualunque path.
        let (listed, _) = authorize_restore(&policy, entry, to.as_ref(), || {
            list_trash()
                .map_err(PluginError::from)?
                .into_iter()
                .filter(|candidate| {
                    policy
                        .denies_path(Capability::VaultRead, candidate.original.as_str())
                        .is_none()
                })
                .find(|candidate| &candidate.id == entry)
                .ok_or_else(|| PluginError::NotFound(entry.to_string().into()))
        })?;
        let prepared = {
            let ws = workspace.read()?;
            ws.prepare_listed_document_restore(listed, to)
                .map_err(PluginError::from)?
        };
        let completed = prepared.invoke().map_err(PluginError::from)?;
        let committed = {
            let mut ws = workspace.write()?;
            ws.commit_document_restore(completed)
                .map_err(|failure| *failure)
        };
        let pending = match committed {
            Ok(pending) => pending,
            Err((error, completed)) => {
                completed.rollback().map_err(PluginError::from)?;
                return Err(error);
            }
        };
        let pending = pending.invoke_indexes();
        let completion = {
            let mut ws = workspace.write()?;
            ws.finish_document_restore_deferred(pending)
                .map_err(|failure| {
                    let (error, _) = *failure;
                    error
                })?
        };
        drain_events(&workspace)?;
        let completion = completion.invoke();
        let outcome = {
            let mut ws = workspace.write()?;
            ws.finish_document_restore_completion(completion)
        };
        drain_events(&workspace)?;
        Ok(outcome)
    }

    fn create_folder(&mut self, folder: &str) -> Result<(), PluginError> {
        self.folder_structure(folder, "creating folder", |ws| {
            ws.create_folder(folder).map(drop)
        })
    }

    fn remove_empty_folder(&mut self, folder: &str) -> Result<(), PluginError> {
        self.folder_structure(folder, "removing folder", |ws| {
            ws.remove_empty_folder(folder)
        })
    }

    fn migrate_folder_organization(&mut self, from: &str, to: &str) -> Result<(), PluginError> {
        self.folder_structure(to, "moving folder to", |ws| {
            ws.migrate_folder_organization(from, to)
        })?;
        Ok(())
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        let prepared = {
            let ws = workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::VaultStructure,
                    "",
                    || "emptying trash".into(),
                )?;
            }
            authorize_path(
                &ws.granted_policy(&self.plugin),
                Capability::VaultStructure,
                "",
                || "emptying trash".into(),
            )?;
            ws.prepare_empty_trash()
        };
        prepared
            .invoke()
            .map(|count| count as u64)
            .map_err(PluginError::from)
    }
}

impl DataRead for JobHost {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.stopped()?;
        if path.is_empty() {
            return Err(PluginError::BadArgs("empty blob name".into()));
        }
        self.prepare_data_io(Capability::DataRead, path, format!("reading blob `{path}`"))?
            .read_authoritative()
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        self.stopped()?;
        self.prepare_data_io(Capability::DataRead, prefix, "listing blobs")?
            .list_authoritative()
    }

    fn cache_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.stopped()?;
        if path.is_empty() {
            return Err(PluginError::BadArgs("empty cache blob name".into()));
        }
        self.prepare_data_io(
            Capability::DataRead,
            path,
            format!("reading cache blob `{path}`"),
        )?
        .read_cache()
    }
}

impl DataWrite for JobHost {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.stopped()?;
        if path.is_empty() {
            return Err(PluginError::BadArgs("nome del blob vuoto".into()));
        }
        self.prepare_data_io(
            Capability::DataWrite,
            path,
            format!("writing blob `{path}`"),
        )?
        .write_authoritative(bytes)
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.stopped()?;
        if path.is_empty() {
            return Err(PluginError::BadArgs("nome del blob vuoto".into()));
        }
        self.prepare_data_io(
            Capability::DataWrite,
            path,
            format!("removing blob `{path}`"),
        )?
        .remove_authoritative()
    }

    fn cache_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.stopped()?;
        if path.is_empty() {
            return Err(PluginError::BadArgs("nome della cache vuoto".into()));
        }
        self.prepare_data_io(
            Capability::DataWrite,
            path,
            format!("writing cache blob `{path}`"),
        )?
        .write_cache(bytes)
    }
}
