from pathlib import Path

# --- index handles ---------------------------------------------------------
p = Path('crates/fub-kernel/src/index/mod.rs')
s = p.read_text()
s = s.replace('use std::sync::Arc;', 'use std::sync::{Arc, RwLock};', 1)
s = s.replace(
    'pub(crate) use routing::{RouteTable, Target};\n',
    'pub(crate) use routing::{RouteTable, Target};\n\npub(crate) type SharedIndexProvider = Arc<RwLock<Box<dyn IndexProvider>>>;\n',
    1,
)
s = s.replace(
    'pub(crate) providers: ProviderTable<(String, Box<dyn IndexProvider>)>,',
    'pub(crate) providers: ProviderTable<(String, SharedIndexProvider)>,',
    1,
)
s = s.replace(
    'pub(crate) fn remove(&mut self, plugin: &str) -> Vec<(String, Box<dyn IndexProvider>)> {',
    'pub(crate) fn remove(&mut self, plugin: &str) -> Vec<(String, SharedIndexProvider)> {',
    1,
)
s = s.replace(
'''        for (id, index) in self.providers.iter_mut() {
            lost.extend(feeding(
                id,
                Gate::IndexFeed,
                models.iter().map(|m| &m.id),
                || index.on_documents_indexed(models),
            ));
        }
''',
'''        lost.extend(feed_shared(&self.providers, models));
''',
    1,
)
s = s.replace(
'''        for (plugin, index) in self.providers.iter_mut() {
            lost.extend(feeding(plugin, Gate::IndexForget, ids.iter(), || {
                index.on_documents_removed(ids)
            }));
        }
''',
'''        for (plugin, index) in self.providers.iter() {
            let mut index = index.write().unwrap_or_else(|poisoned| poisoned.into_inner());
            lost.extend(feeding(plugin, Gate::IndexForget, ids.iter(), || {
                index.on_documents_removed(ids)
            }));
        }
''',
    1,
)
s = s.replace(
'''            let theirs = crate::safety::calling(id, Gate::IndexUpToDate, "", || {
                Ok(index.up_to_date(entries))
            })
''',
'''            let index = index.read().unwrap_or_else(|poisoned| poisoned.into_inner());
            let theirs = crate::safety::calling(id, Gate::IndexUpToDate, "", || {
                Ok(index.up_to_date(entries))
            })
''',
    1,
)
s = s.replace(
'''        for (plugin, index) in self.providers.iter_mut() {
            lost.extend(feeding(
                plugin,
                Gate::IndexReconcile,
                ids.iter().take(1),
                || index.reconcile(ids),
            ));
        }
''',
'''        for (plugin, index) in self.providers.iter() {
            let mut index = index.write().unwrap_or_else(|poisoned| poisoned.into_inner());
            lost.extend(feeding(
                plugin,
                Gate::IndexReconcile,
                ids.iter().take(1),
                || index.reconcile(ids),
            ));
        }
''',
    1,
)
old_at = '''    /// L'indice a cui punta un bersaglio (il core non ha un id di plugin).
    pub(crate) fn at(&self, target: Target) -> Option<&dyn IndexProvider> {
        match target {
            Target::Core => Some(&self.core),
            Target::Provider(at) => self.providers.get(at).map(|(_, p)| p.as_ref()),
        }
    }
'''
new_at = '''    pub(crate) fn query_at(
        &self,
        target: Target,
        query: IndexQuery,
    ) -> Option<Result<IndexResult, PluginError>> {
        match target {
            Target::Core => Some(self.core.query(query)),
            Target::Provider(at) => self.providers.get(at).map(|(_, provider)| {
                let provider = provider
                    .read()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                provider.query(query)
            }),
        }
    }

    pub(crate) fn feed_handles(&self) -> Vec<(String, SharedIndexProvider)> {
        self.providers
            .iter()
            .map(|(id, provider)| (id.clone(), Arc::clone(provider)))
            .collect()
    }
'''
assert old_at in s
s = s.replace(old_at, new_at, 1)
insert = '''

pub(crate) fn feed_handles(
    providers: &[(String, SharedIndexProvider)],
    models: &[DocumentModel],
) -> Vec<IndexLoss> {
    let mut lost = Vec::new();
    for (id, provider) in providers {
        let mut provider = provider
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lost.extend(feeding(
            id,
            Gate::IndexFeed,
            models.iter().map(|model| &model.id),
            || provider.on_documents_indexed(models),
        ));
    }
    lost
}

fn feed_shared(
    providers: &ProviderTable<(String, SharedIndexProvider)>,
    models: &[DocumentModel],
) -> Vec<IndexLoss> {
    let handles: Vec<_> = providers
        .iter()
        .map(|(id, provider)| (id.clone(), Arc::clone(provider)))
        .collect();
    feed_handles(&handles, models)
}
'''
anchor = '\npub(crate) struct Indexes {'
assert anchor in s
s = s.replace(anchor, insert + anchor, 1)
p.write_text(s)

# --- query planner uses provider locks ------------------------------------
p = Path('crates/fub-kernel/src/index/plan.rs')
s = p.read_text()
s = s.replace(
'''            let index = indexes
                .at(target)
                .ok_or_else(|| PluginError::Unserved(format!("{kind:?}").into()))?;
            index.query(query)
''',
'''            indexes
                .query_at(target, query)
                .ok_or_else(|| PluginError::Unserved(format!("{kind:?}").into()))?
''',
    1,
)
s = s.replace(
'''        let index = indexes
            .at(Target::Core)
            .expect("il bersaglio viene dalla tabella delle rotte");
        return index.query(IndexQuery::Documents {
''',
'''        return indexes
            .query_at(Target::Core, IndexQuery::Documents {
''',
    1,
)
s = s.replace(
'''            excerpts,
        });
''',
'''            excerpts,
        })
            .expect("il bersaglio core esiste sempre");
''',
    1,
)
s = s.replace(
'''        let Some(index) = indexes.at(*target) else {
            // Sparito fra le due chiamate: la selezione è già stata fatta e
            // resta valida — quello che manca è l'estratto, e un estratto che
            // manca è, da contratto, «nessuno l'ha calcolato».
            continue;
        };
        let answer = index.query(IndexQuery::Documents {
''',
'''        let Some(answer) = indexes.query_at(*target, IndexQuery::Documents {
''',
    1,
)
s = s.replace(
'''            excerpts: Excerpts::Attach,
        })?;
''',
'''            excerpts: Excerpts::Attach,
        }) else {
            continue;
        };
        let answer = answer?;
''',
    1,
)
s = s.replace(
'''        let index = self.indexes.at(target).ok_or_else(|| {
            PluginError::Unserved("index disappeared from the route table".to_string().into())
        })?;
''',
'',
    1,
)
s = s.replace(
'''        let answer = index.query(IndexQuery::Documents {
''',
'''        let answer = self
            .indexes
            .query_at(target, IndexQuery::Documents {
''',
    1,
)
s = s.replace(
'''            excerpts: Excerpts::Omit,
        })?;
        Ok(answer.documents()?.items.into_iter().collect())
''',
'''            excerpts: Excerpts::Omit,
        })
            .ok_or_else(|| {
                PluginError::Unserved(
                    "index disappeared from the route table".to_string().into(),
                )
            })??;
        Ok(answer.documents()?.items.into_iter().collect())
''',
    1,
)
p.write_text(s)

# --- split ingest around external index feed -------------------------------
p = Path('crates/fub-kernel/src/workspace.rs')
s = p.read_text()
s = s.replace(
    'use crate::index::Indexes;',
    'use crate::index::{feed_handles as feed_index_handles, Indexes, SharedIndexProvider};',
    1,
)
struct_anchor = 'pub struct PreparedDocumentWrite {'
pos = s.find(struct_anchor)
assert pos != -1
insert_at = s.find('\n}', pos) + 2
extra = r'''

pub struct PreparedDocumentFeed {
    id: DocId,
    model: DocumentModel,
    changes: DocumentChanges,
    revision: Revision,
    journal: JournalOp,
    providers: Vec<(String, SharedIndexProvider)>,
    losses: Vec<IndexLoss>,
}

impl PreparedDocumentFeed {
    pub fn invoke_indexes(mut self) -> Self {
        self.losses.extend(feed_index_handles(
            &self.providers,
            std::slice::from_ref(&self.model),
        ));
        self
    }
}
'''
s = s[:insert_at] + extra + s[insert_at:]

old_tail = '''        // stessa verità, nessun canale che può perdere pezzi per strada. E la
        // vedono ADESSO, sul modello intero: è l'unico momento in cui corpo e
        // testo esistono — la cache tiene i soli metadati.
        // Un lotto di uno: la scrittura singola È il caso normale, e la firma
        // a lotti non la trasforma in un'eccezione da spiegare.
        // Il rebuild legge la cache: va aggiornata prima.
        let lost = self
            .indexes
            .on_documents_indexed(std::slice::from_ref(&model));
        self.report_losses(lost);
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            // Il sorgente sotto la selezione è cambiato: gli offset pubblicati
            self.indexes.core.rebuild_graph();
        }
        // dalla shell erano di un altro testo. La shell ne ripubblicherà uno
        // vero al prossimo movimento del cursore (o subito dopo un
        // salvataggio); fino ad allora il contesto dice "non so dove", che è
        // la verità.
        // Sincronizza un path assoluto dopo un evento del filesystem: riparsa se
        self.session.invalidate(id, ContextChange::Rewritten);
        self.emit_event(Event::DocumentChanged {
            id: id.clone(),
            changes: Some(changes),
        });
        self.emit_event(Event::IndexUpdated);
'''
new_tail = '''        let lost = self.indexes.core.on_documents_indexed(std::slice::from_ref(&model));
        let providers = self.indexes.feed_handles();
        let pending = PreparedDocumentFeed {
            id: id.clone(),
            model,
            changes,
            revision: fingerprint,
            journal: JournalOp::Written {
                doc: id.clone(),
                from: None,
                to: Revision::of(""),
            },
            providers,
            losses: lost,
        };
        let pending = pending.invoke_indexes();
        self.finish_index_feed(pending);
'''
assert old_tail in s
s = s.replace(old_tail, new_tail, 1)

# Replace the direct helper above with reusable prepare/finalize immediately after ingest_model.
needle = '''        let pending = pending.invoke_indexes();
        self.finish_index_feed(pending);
    }

    /// esiste ed è un documento'''
replacement = '''        let pending = pending.invoke_indexes();
        self.finish_index_feed(pending);
    }

    fn finish_index_feed(&mut self, pending: PreparedDocumentFeed) {
        self.report_losses(pending.losses);
        if self.indexes.core.graph_update == GraphUpdate::FullRebuild {
            self.indexes.core.rebuild_graph();
        }
        self.session.invalidate(&pending.id, ContextChange::Rewritten);
        self.emit_event(Event::DocumentChanged {
            id: pending.id,
            changes: Some(pending.changes),
        });
        self.emit_event(Event::IndexUpdated);
    }

    /// esiste ed è un documento'''
assert needle in s
s = s.replace(needle, replacement, 1)

# Add detached write commit/finalize methods before existing finish_document_write.
anchor = '    pub fn finish_document_write(\n'
idx = s.find(anchor)
assert idx != -1
methods = r'''    pub fn commit_document_write(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<PreparedDocumentFeed> {
        let PreparedDocumentWrite {
            id,
            existed,
            from,
            expected_source,
            ..
        } = prepared;
        if let Err(and) = before_write {
            return Err(Self::before_write_error(&id, and));
        }
        let placed = if let Some(expected) = expected_source.as_deref() {
            self.docs
                .vault
                .write_if_unchanged(&id, expected, source)?
                .ok_or_else(|| KernelError::Stale(id.to_string()))?
        } else {
            self.docs.vault.write(&id, source)?
        };
        let revision = Revision::of(source);
        let changes = self.indexes.core.changes_for(&model, &revision);
        self.set_entry(&id, placed.0, placed.1, Some(revision.clone()));
        let losses = self
            .indexes
            .core
            .on_documents_indexed(std::slice::from_ref(&model));
        let providers = self.indexes.feed_handles();
        let journal = if existed {
            JournalOp::Written {
                doc: id.clone(),
                from,
                to: revision.clone(),
            }
        } else {
            JournalOp::Created {
                doc: id.clone(),
                to: revision.clone(),
            }
        };
        Ok(PreparedDocumentFeed {
            id,
            model,
            changes,
            revision,
            journal,
            providers,
            losses,
        })
    }

    pub fn finalize_document_write(&mut self, pending: PreparedDocumentFeed) -> Result<Revision> {
        let revision = pending.revision.clone();
        let journal = pending.journal.clone();
        self.finish_index_feed(pending);
        self.dispatch_pending();
        self.record(journal);
        Ok(revision)
    }

'''
s = s[:idx] + methods + s[idx:]

# Rebuild finish_document_write as the direct, no-Custody convenience path.
start = s.find('    pub fn finish_document_write(\n')
end = s.find('\n    pub fn write_document(', start)
assert start != -1 and end != -1
old = s[start:end]
new = r'''    pub fn finish_document_write(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<Revision> {
        let pending = self.commit_document_write(prepared, source, model, before_write)?;
        let pending = pending.invoke_indexes();
        self.finalize_document_write(pending)
    }
'''
s = s[:start] + new + s[end:]
p.write_text(s)

# --- registration/lifecycle locks shared handles --------------------------
p = Path('crates/fub-kernel/src/workspace.rs')
s = p.read_text()
s = s.replace(
    '        self.indexes.providers.push((id, index));',
    '        self.indexes\n            .providers\n            .push((id, std::sync::Arc::new(std::sync::RwLock::new(index))));',
    1,
)
s = s.replace(
    '        for (id, mut index) in indexes {',
    '        for (id, index) in indexes {\n            let mut index = index.write().unwrap_or_else(|poisoned| poisoned.into_inner());',
    1,
)
s = s.replace(
'''                for (id, index) in indexes.iter_mut() {
                    let mut host = ws.host_for(id, InvokeMode::Apply);
                    if let Err(and) = index.flush(&mut host) {
''',
'''                for (id, index) in indexes.iter() {
                    let mut index = index.write().unwrap_or_else(|poisoned| poisoned.into_inner());
                    let mut host = ws.host_for(id, InvokeMode::Apply);
                    if let Err(and) = index.flush(&mut host) {
''',
    1,
)
p.write_text(s)

# --- host top-level write orchestration -----------------------------------
p = Path('crates/fub-host/src/session.rs')
s = p.read_text()
old = '''        let mut ws = workspace.write()?;
        ws.finish_document_write(prepared, source, model, before_write)
            .map_err(PluginError::from)
'''
new = '''        let pending = {
            let mut ws = workspace.write()?;
            ws.commit_document_write(prepared, source, model, before_write)
                .map_err(PluginError::from)?
        };
        let pending = pending.invoke_indexes();
        let mut ws = workspace.write()?;
        ws.finalize_document_write(pending).map_err(PluginError::from)
'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)
