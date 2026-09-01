from pathlib import Path

# Questo helper completa la tranche `IndexProvider::on_documents_indexed` sul
# secondo callsite host: la seconda fase dell'apertura. Viene eseguito dopo
# `.audit-arch-index-feed-fix.py`, che introduce gli handle condivisi dei
# provider e lo split prepare/call/finalize per `write_document`.

# --- kernel: prepara il feed della fetta sotto lock, chiama fuori, finalizza ---
p = Path("crates/fub-kernel/src/workspace.rs")
s = p.read_text()

feed_anchor = "pub struct PreparedDocumentFeed {\n"
assert feed_anchor in s, "PreparedDocumentFeed non trovato: eseguire prima il fix principale"
opening_feed = r'''pub struct PreparedIndexBatchFeed {
    models: Vec<DocumentModel>,
    providers: Vec<(String, SharedIndexProvider)>,
    losses: Vec<IndexLoss>,
}

impl PreparedIndexBatchFeed {
    pub fn invoke_indexes(mut self) -> Self {
        self.losses
            .extend(feed_index_handles(&self.providers, &self.models));
        self
    }
}

'''
s = s.replace(feed_anchor, opening_feed + feed_anchor, 1)

start = s.find("    pub fn index_batch_prepared(&mut self, prepared: ParsedBatch) {\n")
end_anchor = "\n    /// (id, alias, link), e tiene il prestito condiviso solo per quella copia:"
end = s.find(end_anchor, start)
assert start != -1 and end != -1, "index_batch_prepared non trovato"
replacement = r'''    pub fn commit_index_batch_prepared(
        &mut self,
        prepared: ParsedBatch,
    ) -> Option<PreparedIndexBatchFeed> {
        let ParsedBatch {
            read,
            reused,
            models,
            seen,
        } = prepared;
        let aged: BTreeSet<DocId> = seen
            .into_iter()
            .filter(|(id, expected)| self.entry_fingerprint(id) != *expected)
            .map(|(id, _)| id)
            .collect();

        for entry in read {
            if entry.fingerprint.is_some() && !aged.contains(&entry.id) {
                self.indexes.core.set_entry_from_scan(entry);
            }
        }
        for (id, metadata) in reused {
            if aged.contains(&id) {
                continue;
            }
            self.indexes.core.restore(&id, metadata);
        }
        let models: Vec<DocumentModel> = models
            .into_iter()
            .filter(|model| !aged.contains(&model.id))
            .collect();
        if models.is_empty() {
            return None;
        }

        let losses = self.indexes.core.on_documents_indexed(&models);
        let providers = self.indexes.feed_handles();
        Some(PreparedIndexBatchFeed {
            models,
            providers,
            losses,
        })
    }

    pub fn finalize_index_batch_prepared(&mut self, pending: PreparedIndexBatchFeed) {
        self.report_losses(pending.losses);
    }

    pub fn index_batch_prepared(&mut self, prepared: ParsedBatch) {
        if let Some(pending) = self.commit_index_batch_prepared(prepared) {
            let pending = pending.invoke_indexes();
            self.finalize_index_batch_prepared(pending);
        }
    }
'''
s = s[:start] + replacement + s[end:]
p.write_text(s)

# --- host runner: mantiene il writer turn, non il guard Workspace, nel feed ---
p = Path("crates/fub-host/src/runner.rs")
s = p.read_text()
old = r'''            {
                let mut ws = self.workspace.write()?;
                ws.index_batch_prepared(prepared);
                // Il `total` c'è perché la scansione lo sa: l'apertura è il
                // caso in cui una barra può dire il vero, e
                // [`JobProgress::total`] è opzionale proprio per distinguerlo
                // da quelli in cui mentirebbe.
                ws.notes_job_progress(
                    in_progress.id,
                    JobProgress {
                        done: in_progress.work.done(),
                        total: Some(in_progress.total),
                        label,
                    },
                );
            }
'''
new = r'''            // Il turno serializza le mutazioni dell'apertura con le altre scritture,
            // ma non è il `RwLock<Workspace>`: durante il codice del provider i
            // lettori devono poter entrare. È la stessa forma di `write_document`:
            // prepare/commit sotto lock, callback fuori lock, finalize sotto lock.
            let _turn = self.workspace.write_turn();
            let pending = {
                let mut ws = self.workspace.write()?;
                ws.commit_index_batch_prepared(prepared)
            };
            let pending = pending.map(|pending| pending.invoke_indexes());
            {
                let mut ws = self.workspace.write()?;
                if let Some(pending) = pending {
                    ws.finalize_index_batch_prepared(pending);
                }
                // Il `total` c'è perché la scansione lo sa: l'apertura è il
                // caso in cui una barra può dire il vero, e
                // [`JobProgress::total`] è opzionale proprio per distinguerlo
                // da quelli in cui mentirebbe.
                ws.notes_job_progress(
                    in_progress.id,
                    JobProgress {
                        done: in_progress.work.done(),
                        total: Some(in_progress.total),
                        label,
                    },
                );
            }
'''
assert old in s, "blocco advance_opening non trovato"
s = s.replace(old, new, 1)

# Regressione permanente: il test attraversa il vero Custody<Workspace> e
# blocca la callback con un canale. Se il guard è ancora detenuto, `try_read`
# fallisce immediatamente; nessun timing fragile e nessun thread lasciato appeso.
test_anchor = "    /// **La proprietà** (0119, secondo sito): mentre la fetta dell'apertura\n"
assert test_anchor in s, "anchor test apertura non trovato"
test = r'''    struct OpeningIndexFeedLockProbe {
        entered: std::sync::mpsc::SyncSender<()>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }

    impl fub_abi::traits::IndexProvider for OpeningIndexFeedLockProbe {
        fn routes(&self) -> Vec<fub_abi::traits::QueryRoute> {
            Vec::new()
        }

        fn activate(
            &mut self,
            _: &mut dyn fub_abi::traits::HostApi,
        ) -> Result<(), PluginError> {
            Ok(())
        }

        fn on_documents_indexed(
            &mut self,
            _: &[fub_abi::model::DocumentModel],
        ) -> Vec<fub_abi::traits::IndexLoss> {
            self.entered.send(()).expect("il test aspetta il feed");
            self.release
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .recv_timeout(Duration::from_secs(10))
                .expect("il test lascia uscire il feed");
            Vec::new()
        }

        fn on_documents_removed(
            &mut self,
            _: &[fub_abi::model::DocId],
        ) -> Vec<fub_abi::traits::IndexLoss> {
            Vec::new()
        }

        fn reconcile(
            &mut self,
            _: &[fub_abi::model::DocId],
        ) -> Vec<fub_abi::traits::IndexLoss> {
            Vec::new()
        }

        fn flush(
            &mut self,
            _: &mut dyn fub_abi::traits::HostApi,
        ) -> Result<(), PluginError> {
            Ok(())
        }

        fn close(
            &mut self,
            _: &mut dyn fub_abi::traits::HostApi,
        ) -> Result<(), PluginError> {
            Ok(())
        }

        fn query(
            &self,
            _: fub_abi::traits::IndexQuery,
        ) -> Result<fub_abi::traits::IndexResult, PluginError> {
            Err(PluginError::Unserved("feed-only probe".into()))
        }

        fn up_to_date(&self, _: &[fub_abi::traits::VaultEntry]) -> Vec<fub_abi::model::DocId> {
            Vec::new()
        }
    }

    #[test]
    fn reader_enters_while_opening_feeds_an_external_index() {
        let mut formats = fub_kernel::FormatRegistry::new();
        formats
            .register(fub_format_markdown::MarkdownProvider::boxed())
            .expect("un provider di formato solo non confligge");
        let (_dir, shared, _id, _root) = a_vault_scanned(1, formats);
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        {
            let mut ws = shared.workspace.write().expect("il vault è vivo");
            ws.register_plugin(
                fub_abi::traits::PluginManifest::new(
                    "fub.audit-index-feed-opening",
                    "Audit detached opening index feed",
                ),
                fub_kernel::Trust::Community,
            )
            .expect("l'owner dell'indice si dichiara");
            ws.register_index_provider(
                "fub.audit-index-feed-opening",
                Box::new(OpeningIndexFeedLockProbe {
                    entered: entered_tx,
                    release: Mutex::new(release_rx),
                }),
            )
            .expect("il probe dell'indice si registra");
        }

        let slice = {
            let shared = Arc::clone(&shared);
            std::thread::spawn(move || shared.advance_opening())
        };
        entered_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("IndexProvider::on_documents_indexed entra durante l'apertura");
        let reader_progressed = shared.workspace.try_read().is_some();
        release_tx.send(()).expect("il feed può terminare");
        let outcome = slice.join().expect("il thread dell'apertura non panica");

        assert!(
            reader_progressed,
            "la seconda fase dell'apertura ha tenuto Custody<Workspace> durante \
             IndexProvider::on_documents_indexed"
        );
        assert!(
            outcome.expect("nessun veleno"),
            "c'era una fetta di apertura da portare avanti"
        );
    }

'''
s = s.replace(test_anchor, test + test_anchor, 1)
p.write_text(s)
