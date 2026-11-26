//! I passi di una rinomina chiesta da Fub (documento, allegato, identità): preparati, applicati, conclusi.

use super::*;

/// Lettura e parse owned di una rinomina esplicita di documento.
///
/// La preparazione fotografa il core e risolve provider e sintassi senza
/// invocarli. [`PreparedExplicitRename::invoke`] esegue lo stat-read-stat e il
/// parse senza prendere in prestito il workspace.
#[must_use = "la rinomina preparata deve essere invocata e committata"]
pub struct PreparedExplicitRename {
    pub(super) snapshot: ExplicitRenameSnapshot,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) parser: PreparedParse,
    pub(super) source_kind: SourceKind,
    pub(super) rewrites: Vec<PreparedExplicitLinkRewrite>,
    pub(super) side_data: PreparedRenameSideData,
    pub(super) recovery_root: Utf8PathBuf,
}

/// Piano owned di una rinomina esplicita di una voce senza provider di formato.
///
/// La preparazione fotografa soltanto core, path, riferimenti e handle. I byte
/// dell'asset, le sorgenti dei link e i side-data vengono letti o mossi da
/// [`PreparedExplicitAssetRename::invoke`] senza prendere in prestito il
/// workspace.
#[must_use = "la rinomina asset preparata deve essere invocata e committata"]
pub struct PreparedExplicitAssetRename {
    pub(super) snapshot: ExplicitRenameSnapshot,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) rewrites: Vec<PreparedExplicitLinkRewrite>,
    pub(super) side_data: PreparedAssetRenameSideData,
    pub(super) recovery_root: Utf8PathBuf,
}

/// Asset già spostato e fotografato esattamente, ancora da riconvalidare nel core.
#[must_use = "la rinomina asset spostata deve essere committata o annullata"]
pub struct MovedExplicitAssetRename {
    pub(super) snapshot: ExplicitRenameSnapshot,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) fingerprint: Revision,
    pub(super) stat: crate::storage::Stat,
    pub(super) identity: Option<crate::storage::FileIdentity>,
    pub(super) rewrites: Vec<(DocId, EditRequest)>,
    pub(super) stale_byte_links: Vec<String>,
    pub(super) side_data: CompletedAssetRenameSideData,
    pub(super) recovery: RenameRecoveryReceipt,
}

/// Core della rinomina asset installato, con callback ancora da invocare.
#[must_use = "registro e riscritture della rinomina asset devono essere invocati"]
pub struct PendingExplicitAssetRename {
    pub(super) workspace_id: u64,
    pub(super) installed: VaultEntry,
    pub(super) rewrites: Vec<(DocId, EditRequest)>,
    pub(super) stale_byte_links: Vec<String>,
    pub(super) side_data: CompletedAssetRenameSideData,
    pub(super) recovery: RenameRecoveryReceipt,
    pub(super) journal: Arc<Journal>,
    pub(super) origin: fub_abi::event::Origin,
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) owns_batch: bool,
}

/// Callback della rinomina asset concluse, pronto per eventi ed epilogo.
pub struct CompletedExplicitAssetRename {
    pub(super) workspace_id: u64,
    pub(super) installed: VaultEntry,
    pub(super) side_data: CompletedAssetRenameSideData,
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) owns_batch: bool,
    pub(super) rewrite_failures: Vec<String>,
    pub(super) stale_byte_links: Vec<String>,
    pub(super) journal_fault: Option<String>,
}

/// Sorgente stabile e modello già parsato, ancora da riconvalidare nel core.
#[must_use = "la rinomina parsata deve essere committata"]
pub struct ParsedExplicitRename {
    pub(super) snapshot: ExplicitRenameSnapshot,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) model: DocumentModel,
    pub(super) fingerprint: Revision,
    pub(super) stat: crate::storage::Stat,
    pub(super) identity: Option<crate::storage::FileIdentity>,
    pub(super) rewrites: Vec<(DocId, EditRequest)>,
    pub(super) stale_byte_links: Vec<String>,
    pub(super) side_data: CompletedRenameSideData,
    pub(super) recovery: RenameRecoveryReceipt,
}

/// Core della rinomina esplicita già installato, con gli handle degli indici
/// ancora da invocare fuori dal workspace.
#[must_use = "gli indici della rinomina devono essere invocati e finalizzati"]
pub struct PendingExplicitRename {
    pub(super) identity: PendingIdentityMigration,
    pub(super) rewrites: Vec<(DocId, EditRequest)>,
    pub(super) stale_byte_links: Vec<String>,
    pub(super) side_data: CompletedRenameSideData,
    pub(super) recovery: RenameRecoveryReceipt,
    pub(super) journal: Arc<Journal>,
    pub(super) origin: fub_abi::event::Origin,
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) owns_batch: bool,
}

/// Callback degli indici concluse, pronto per l'epilogo sotto guard.
pub struct CompletedExplicitRename {
    pub(super) identity: CompletedIdentityMigration,
    pub(super) rewrites: Vec<(DocId, EditRequest)>,
    pub(super) side_data: CompletedRenameSideData,
    pub(super) recovery: RenameRecoveryReceipt,
    pub(super) owns_batch: bool,
    pub(super) rewrite_failures: Vec<String>,
    pub(super) stale_byte_links: Vec<String>,
    pub(super) journal_fault: Option<String>,
}

pub(super) struct PendingIdentityMigration {
    pub(super) workspace_id: u64,
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) installed: VaultEntry,
    pub(super) removal: PreparedDocumentRemoval,
    pub(super) feed: PreparedDocumentFeed,
}

pub(super) struct CompletedIdentityMigration {
    pub(super) workspace_id: u64,
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) installed: VaultEntry,
    pub(super) removal: CompletedDocumentRemoval,
    pub(super) feed: PreparedDocumentFeed,
}

pub(super) struct ExplicitRenameSnapshot {
    pub(super) workspace_id: u64,
    pub(super) from_path: Utf8PathBuf,
    pub(super) to_path: Utf8PathBuf,
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) from_entry: VaultEntry,
    pub(super) to_entry: Option<VaultEntry>,
    pub(super) syntax_generation: u64,
    pub(super) routing_generation: u64,
}

pub(super) struct PreparedExplicitLinkRewrite {
    pub(super) source_path: Utf8PathBuf,
    pub(super) destination: DocId,
    pub(super) provider: Option<std::sync::Arc<dyn FormatProvider>>,
    pub(super) provider_id: String,
    pub(super) ctx: ParseContext,
    pub(super) source_kind: SourceKind,
    pub(super) rewrites: Vec<LinkRewrite>,
}

/// Fotografia provider-owned di una sorgente da riscrivere: handle condiviso,
/// id formato, contesto parse e specie sorgente. Solo dati owned, nessun lock.
pub(super) struct RewritePlan {
    pub(super) provider: std::sync::Arc<dyn FormatProvider>,
    pub(super) provider_id: String,
    pub(super) ctx: ParseContext,
    pub(super) source_kind: SourceKind,
}

/// Handle owned per spostare i dati autorevoli di una rinomina fuori dal
/// workspace.
pub(super) struct PreparedRenameSideData {
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) organization: Arc<OrganizationStore>,
    pub(super) drafts: Arc<Drafts>,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) doc_data_roots: Vec<Utf8PathBuf>,
}

/// Errori recuperabili prodotti dalla migrazione detached dei side-data.
pub(super) struct CompletedRenameSideData {
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) errors: Vec<String>,
    /// Ciò che gli spazi per-documento hanno fatto: il rollback disfa questo,
    /// non una migrazione al contrario ([`Migration::undo`]).
    ///
    /// [`Migration::undo`]: crate::docdata::Migration::undo
    pub(super) doc_data: crate::docdata::Migration,
    /// La mossa fatta alla bozza: il rollback disfa questa, non una
    /// migrazione al contrario che porterebbe sotto `from` la bozza di `to`.
    pub(super) draft_move: crate::drafts::DraftMove,
    pub(super) rollback: Option<PreparedRenameSideData>,
}

/// Handle owned per migrare soltanto i side-data che appartengono anche agli
/// asset. Le bozze sono buffer di documenti testuali e non seguono questa rotta.
pub(super) struct PreparedAssetRenameSideData {
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) organization: Arc<OrganizationStore>,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) doc_data_roots: Vec<Utf8PathBuf>,
}

/// Esito e ricevuta one-shot per il rollback dei side-data di un asset.
pub(super) struct CompletedAssetRenameSideData {
    pub(super) from: DocId,
    pub(super) to: DocId,
    pub(super) errors: Vec<String>,
    pub(super) doc_data: crate::docdata::Migration,
    pub(super) rollback: Option<PreparedAssetRenameSideData>,
}

impl PreparedExplicitRename {
    /// Legge e parsa una versione stabile della sorgente, costruisce le
    /// richieste CAS dei backlink e persiste l'intent recuperabile prima di
    /// migrare side-data o file. Tutto avviene senza un prestito del workspace.
    pub fn invoke(self) -> Result<ParsedExplicitRename> {
        let PreparedExplicitRename {
            snapshot,
            storage,
            parser,
            source_kind,
            rewrites,
            side_data,
            recovery_root,
        } = self;

        // **Ciò che può fallire va prima di ciò che non si disfa.** Leggere e
        // parsare stanno qui e non dopo la `rename` per la ragione per cui ci
        // stanno in `write_source` e nel ripristino staged: un errore di parse —
        // un provider che rifiuta quel testo, un file sparito nella finestra —
        // risaliva con `?` **a rename avvenuta**, e allora il disco aveva il
        // nome nuovo, la memoria il vecchio (nessun `migrate_identity`), il
        // registro non aveva la riga `Renamed`, e chi aveva chiamato riceveva un
        // `Err` per un'operazione che sul disco era successa. Un secondo
        // tentativo rispondeva `NotFound(from)`, e la nota spariva dalla vista
        // fino alla riapertura del vault.
        //
        // Si legge `from` e si parsa **col nome nuovo**: i byte sono gli stessi
        // — una rinomina non li tocca — e il nome serve al parse per risolvere i
        // link relativi, che devono essere quelli di dove il documento sta per
        // andare.
        let path = snapshot.from_path.clone();
        let before = storage.stat(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        if !before.is_file() {
            return Err(KernelError::NotFound(snapshot.from.to_string()));
        }
        crate::documents::within_source_limit(&snapshot.from, before.size)?;
        let identity_before = storage
            .file_identity(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        let bytes = storage.read(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        let after = storage.stat(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        let identity_after = storage
            .file_identity(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        if !after.is_file() || before != after || identity_before != identity_after {
            return Err(KernelError::Stale(snapshot.from.to_string()));
        }
        let identity = identity_after;
        let fingerprint = Revision::of_bytes(&bytes);
        let source = match source_kind {
            SourceKind::Text => {
                let text =
                    fub_abi::rules::text_policy::decode(&bytes).map_err(|at| KernelError::Io {
                        path: path.clone(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("il file non è UTF-8: il primo byte non valido è a {at}"),
                        ),
                    })?;
                DocumentSource::Text(text.to_string())
            }
            SourceKind::Bytes => DocumentSource::Bytes(bytes),
        };
        let model = parser.invoke(source)?;
        let PreparedLinkRewriteOutcome {
            edits: durable_rewrites,
            unwritable_bytes,
        } = invoke_prepared_link_rewrites(storage.as_ref(), rewrites)?;
        let stale_byte_links = stale_byte_link_lines(&unwritable_bytes, &snapshot.from);

        // Rename "case-only" (`nota.md` → `Nota.md`): su un filesystem
        // case-insensitive (macOS/Windows) `storage.exists` vede lo STESSO
        // file, non una collisione — e il check sul disco va saltato **perché è
        // lo stesso file**, non perché i due nomi si somiglino. La differenza
        // non è di stile: là dove il filesystem il caso lo distingue, `Nota.md`
        // è un omonimo vero, e saltare il check lo seppelliva senza dire niente
        // (0182). Chi risponde è il supporto, l'unico che lo sappia.
        let same_file = storage.same_file(&snapshot.from_path, &snapshot.to_path);
        if !same_file && storage.exists(&snapshot.to_path) {
            return Err(KernelError::AlreadyExists(snapshot.to.to_string()));
        }
        let mut recovery = rename_recovery::persist(
            Arc::clone(&storage),
            &recovery_root,
            snapshot.from.clone(),
            snapshot.to.clone(),
            fingerprint.clone(),
            durable_rewrites.clone(),
        )?;
        let rewrites = durable_rewrites
            .iter()
            .map(|rewrite| (rewrite.source().clone(), rewrite.request().clone()))
            .collect();
        // I dati per-documento si spostano **prima** del file (difetto 0168),
        // mentre `from` è ancora vivo: un crash fra le due lasciava il file al
        // nome nuovo e i dati sotto la chiave vecchia, dove la prima `collect`
        // li spazza. `sync_renamed_path_here` resta migrate-dopo: là il file
        // è già a `to`. Il registro `Renamed` resta dopo la mutazione del
        // file (0067).
        //
        // Proprio perché il file non si è ancora mosso, uno spazio che non ha
        // potuto seguire **ferma** la rinomina invece di restare indietro: sotto
        // l'id vecchio di una nota che ha cambiato nome, la raccolta
        // successiva lo prenderebbe per lo spazio di una nota che non esiste
        // più. Chi la rinomina la vede soltanto dopo non ha questa scelta, e lo
        // dice ([`migrate_data`](crate::docdata::migrate_data)).
        let mut side_data = side_data.invoke();
        if let Some((path, source)) = side_data.doc_data.stranded.take() {
            let mut rollback_errors = side_data.rollback();
            if let Err(error) = recovery.cancel() {
                rollback_errors.push(format!("intent di recupero non cancellato: {error}"));
            }
            return Err(KernelError::Io {
                path,
                source: with_rollback_errors(source, rollback_errors),
            });
        }
        if let Err(source) = storage.rename_no_replace(&snapshot.from_path, &snapshot.to_path) {
            let mut rollback_errors = side_data.rollback();
            if let Err(error) = recovery.cancel() {
                rollback_errors.push(format!("intent di recupero non cancellato: {error}"));
            }
            if source.kind() == std::io::ErrorKind::AlreadyExists {
                let to = if rollback_errors.is_empty() {
                    snapshot.to.to_string()
                } else {
                    format!(
                        "{}; anche il rollback è fallito: {}",
                        snapshot.to,
                        rollback_errors.join("; ")
                    )
                };
                return Err(KernelError::AlreadyExists(to));
            }
            let source = if rollback_errors.is_empty() {
                source
            } else {
                std::io::Error::new(
                    source.kind(),
                    format!(
                        "{source}; anche il rollback è fallito: {}",
                        rollback_errors.join("; ")
                    ),
                )
            };
            return Err(KernelError::Io {
                path: snapshot.from_path,
                source,
            });
        }
        Ok(ParsedExplicitRename {
            snapshot,
            storage,
            model,
            fingerprint,
            stat: after,
            identity,
            rewrites,
            stale_byte_links,
            side_data,
            recovery,
        })
    }
}

impl ParsedExplicitRename {
    /// Annulla una mossa che il workspace ha rifiutato al commit. Il token è
    /// one-shot e riporta il file indietro soltanto se la destinazione contiene
    /// ancora esattamente i byte mossi da questa invocazione.
    pub fn rollback(self) -> Result<()> {
        let ParsedExplicitRename {
            snapshot,
            storage,
            fingerprint,
            identity,
            side_data,
            mut recovery,
            ..
        } = self;
        let before = storage
            .stat(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let identity_before =
            storage
                .file_identity(&snapshot.to_path)
                .map_err(|source| KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                })?;
        let current = crate::vault::fingerprint_of(storage.as_ref(), &snapshot.to_path).map_err(
            |source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            },
        )?;
        let after = storage
            .stat(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let identity_after =
            storage
                .file_identity(&snapshot.to_path)
                .map_err(|source| KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                })?;
        if !before.is_file()
            || before != after
            || identity_before != identity
            || identity_after != identity
            || current != fingerprint
        {
            return Err(KernelError::Stale(snapshot.to.to_string()));
        }
        recovery.mark_cancelled()?;
        let mut rollback_errors = side_data.rollback();
        if let Err(source) = storage.rename_no_replace(&snapshot.to_path, &snapshot.from_path) {
            let source = if rollback_errors.is_empty() {
                source
            } else {
                std::io::Error::new(
                    source.kind(),
                    format!(
                        "{source}; anche il rollback dei side-data è fallito: {}",
                        rollback_errors.join("; ")
                    ),
                )
            };
            return Err(KernelError::Io {
                path: snapshot.to_path,
                source,
            });
        }
        if let Err(error) = recovery.complete() {
            rollback_errors.push(format!("intent di recupero non rimosso: {error}"));
        }
        if rollback_errors.is_empty() {
            Ok(())
        } else {
            Err(KernelError::Io {
                path: snapshot.from_path,
                source: std::io::Error::other(format!(
                    "il file è stato ripristinato, ma il rollback è fallito: {}",
                    rollback_errors.join("; ")
                )),
            })
        }
    }
}

impl PendingExplicitRename {
    /// Esegue le callback remove+feed e registra il fatto usando handle owned,
    /// lasciando le riscritture al chiamante.
    pub fn invoke(self) -> CompletedExplicitRename {
        let PendingExplicitRename {
            identity,
            rewrites,
            stale_byte_links,
            side_data,
            recovery,
            journal,
            origin,
            from,
            to,
            owns_batch,
        } = self;
        let identity = identity.invoke();
        // La riga del rename va **prima** di quelle delle sorgenti riscritte:
        // sono tutte dentro lo stesso lotto, e chi le ripercorre all'indietro le
        // trova nell'ordine in cui `UndoStep` le vuole (0045: i passi sono in
        // ordine di esecuzione, e chi esegue non riordina).
        let journal_fault = journal
            .append(origin, JournalOp::Renamed { from, to })
            .err();
        CompletedExplicitRename {
            identity,
            rewrites,
            side_data,
            recovery,
            owns_batch,
            rewrite_failures: Vec::new(),
            stale_byte_links,
            journal_fault,
        }
    }
}

impl CompletedExplicitRename {
    /// Applica tutte le riscritture fuori dal workspace e conserva gli errori
    /// qualificati con la sorgente per il finalizzatore.
    pub fn invoke_rewrites<E>(
        mut self,
        mut apply: impl FnMut(&DocId, &EditRequest) -> std::result::Result<(), E>,
    ) -> Self
    where
        E: std::fmt::Display,
    {
        // Il piano si applica TUTTO, anche se una sorgente fallisce: abortire
        // a metà lascerebbe link misti vecchio/nuovo senza possibilità di
        // retry. Gli errori si accumulano per-sorgente e arrivano in coda.
        for (source, request) in &self.rewrites {
            if let Err(error) = apply(source, request) {
                self.rewrite_failures.push(format!("{source}: {error}"));
            }
        }
        if self.rewrite_failures.is_empty() {
            if let Err(error) = self.recovery.complete() {
                self.rewrite_failures
                    .push(format!("intent di recupero: {error}"));
            }
        }
        self
    }
}

/// Riscrittura format-owned, batch detached per sorgente.
///
/// Il kernel non conosce grammatica né escaping di alcun formato: per ogni
/// sorgente legge i byte nella forma del suo provider, invoca una volta
/// [`FormatProvider::rewrite_links`] sotto [`Gate::FormatParse`] e valida il
/// vincolo d'output — ogni [`TextEdit`] entro uno span osservato, bounds UTF-8,
/// patch non sovrapposte (validatore [`EditRequest`] esistente); ogni richiesta
/// effettiva coperta oppure errore esplicito. `None` = capability mancante, mai
/// fallback raw: errore tipizzato per la sorgente. Niente parsing JSON/Markdown
/// nel kernel, nessun provider sotto lock, nessuna omissione silenziosa.
/// La CAS di [`EditRequest`] resta la preimmagine per-file; i conflitti restano
/// [`KernelError::Stale`]/`AlreadyExists`, senza protocollo parallelo.
///
/// L'unica eccezione è una sorgente a byte ([`SourceKind::Bytes`]) che non sa
/// riscriversi (provider assente o `Ok(None)`): i file Craft dichiarano i loro
/// collegamenti ma Fub non li scrive mai (D-3). Quella sorgente non ferma il
/// piano: resta com'è e finisce in [`PreparedLinkRewriteOutcome::unwritable_bytes`],
/// e chi chiama decide che cosa dirne. Una sorgente a byte che risponde con
/// degli edit resta un errore, come prima.
pub(super) fn invoke_prepared_link_rewrites(
    storage: &dyn crate::storage::VaultStorage,
    rewrites: Vec<PreparedExplicitLinkRewrite>,
) -> Result<PreparedLinkRewriteOutcome> {
    let mut out = Vec::new();
    let mut unwritable_bytes = Vec::new();
    for prepared in rewrites {
        if prepared.source_kind == SourceKind::Bytes && prepared.provider.is_none() {
            unwritable_bytes.push(prepared.destination);
            continue;
        }
        let bytes = storage
            .read(&prepared.source_path)
            .map_err(|source| KernelError::Io {
                path: prepared.source_path.clone(),
                source,
            })?;
        let source = match prepared.source_kind {
            SourceKind::Text => {
                let text =
                    fub_abi::rules::text_policy::decode(&bytes).map_err(|at| KernelError::Io {
                        path: prepared.source_path.clone(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("il file non è UTF-8: il primo byte non valido è a {at}"),
                        ),
                    })?;
                DocumentSource::Text(text.to_string())
            }
            SourceKind::Bytes => DocumentSource::Bytes(bytes),
        };
        let revision = match &source {
            DocumentSource::Text(text) => Revision::of(text),
            DocumentSource::Bytes(bytes) => Revision::of_bytes(bytes),
        };
        let Some(provider) = prepared.provider.clone() else {
            return Err(no_link_rewrite(&prepared.destination));
        };
        let provider_id = prepared.provider_id.clone();
        let destination = prepared.destination.clone();
        let ctx = prepared.ctx.clone();
        let wanted = prepared.rewrites.clone();
        let edits = crate::safety::caught(
            &provider_id,
            Gate::FormatParse,
            destination.as_str(),
            FormatError::Parse,
            || provider.rewrite_links(&source, &ctx, &wanted),
        )?;
        let edits = match edits {
            Some(edits) => edits,
            None if prepared.source_kind == SourceKind::Bytes => {
                unwritable_bytes.push(destination);
                continue;
            }
            None => return Err(no_link_rewrite(&destination)),
        };
        validate_rewrite_output(&wanted, &edits, &source, &destination)?;
        if edits.is_empty() {
            continue;
        }
        let request = EditRequest::new(revision, edits);
        let result = match &source {
            DocumentSource::Text(text) => {
                let (next, _) = request
                    .apply_to(text)
                    .map_err(|error| KernelError::BadEdit {
                        doc: destination.to_string(),
                        why: error.to_string(),
                    })?;
                Revision::of(&next)
            }
            DocumentSource::Bytes(_) => {
                unreachable!("validate_rewrite_output rejects edits over a byte source")
            }
        };
        out.push(RenameRecoveryEdit::new(destination, request, result));
    }
    Ok(PreparedLinkRewriteOutcome {
        edits: out,
        unwritable_bytes,
    })
}

/// Il risultato di [`invoke_prepared_link_rewrites`]: gli edit da applicare e
/// le sorgenti a byte lasciate com'erano, nell'ordine del piano.
pub(super) struct PreparedLinkRewriteOutcome {
    pub(super) edits: Vec<RenameRecoveryEdit>,
    pub(super) unwritable_bytes: Vec<DocId>,
}

/// L'errore di una sorgente che il suo formato non sa riscrivere.
pub(super) fn no_link_rewrite(destination: &DocId) -> KernelError {
    KernelError::Format(FormatError::Parse(format!(
        "il formato di {destination} non offre la riscrittura dei link"
    )))
}

/// Una riga per ogni file a byte che punta ancora al nome vecchio `from`: la
/// rinomina è fatta, le note sono aggiornate, e queste righe arrivano a chi
/// l'ha chiesta nell'esito parziale [`KernelError::LinkRewrite`].
pub(super) fn stale_byte_link_lines(unwritable: &[DocId], from: &DocId) -> Vec<String> {
    unwritable
        .iter()
        .map(|src| format!("{src}: un file a byte non si riscrive, il link punta ancora a {from}"))
        .collect()
}

/// Vincolo d'output della porta format-owned: copertura totale, confini
/// dichiarati, validità UTF-8 e non sovrapposizione. Riusa il validatore
/// [`EditRequest`]; qui si aggiunge solo il recinto (entro span osservati) e la
/// copertura (ogni richiesta effettiva servita oppure errore esplicito).
pub(super) fn validate_rewrite_output(
    wanted: &[LinkRewrite],
    edits: &[TextEdit],
    source: &DocumentSource,
    destination: &DocId,
) -> Result<()> {
    let text = match source {
        DocumentSource::Text(text) => text.as_str(),
        DocumentSource::Bytes(_) => {
            return Err(KernelError::Format(FormatError::Parse(format!(
                "riscrittura dei link non applicabile a una sorgente non testuale in {destination}"
            ))));
        }
    };
    if !wanted.is_empty() && edits.is_empty() {
        return Err(KernelError::Format(FormatError::Parse(format!(
            "il formato di {destination} non ha riscritto alcun riferimento richiesto"
        ))));
    }
    for edit in edits {
        let inside = wanted
            .iter()
            .any(|want| edit.span.start >= want.span.start && edit.span.end <= want.span.end);
        if !inside {
            return Err(KernelError::Format(FormatError::Parse(format!(
                "il formato di {destination} ha scritto fuori dai riferimenti dichiarati"
            ))));
        }
    }
    EditRequest::new(Revision::of(text), edits.to_vec())
        .apply_to(text)
        .map(|_| ())
        .map_err(|and| KernelError::BadEdit {
            doc: destination.to_string(),
            why: and.to_string(),
        })
}

impl PreparedExplicitAssetRename {
    /// Verifica l'identità dell'asset, prepara le CAS dei riferimenti e
    /// persiste l'intent recuperabile prima di migrare side-data o file.
    pub fn invoke(self) -> Result<MovedExplicitAssetRename> {
        let PreparedExplicitAssetRename {
            snapshot,
            storage,
            rewrites,
            side_data,
            recovery_root,
        } = self;
        let path = snapshot.from_path.clone();
        let before = storage.stat(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        if !before.is_file() {
            return Err(KernelError::NotFound(snapshot.from.to_string()));
        }
        let identity_before = storage
            .file_identity(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        let fingerprint =
            crate::vault::fingerprint_of(storage.as_ref(), &path).map_err(|source| {
                KernelError::Io {
                    path: path.clone(),
                    source,
                }
            })?;
        let after = storage.stat(&path).map_err(|source| KernelError::Io {
            path: path.clone(),
            source,
        })?;
        let identity_after = storage
            .file_identity(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        if !after.is_file() || before != after || identity_before != identity_after {
            return Err(KernelError::Stale(snapshot.from.to_string()));
        }
        let identity = identity_after;
        let PreparedLinkRewriteOutcome {
            edits: durable_rewrites,
            unwritable_bytes,
        } = invoke_prepared_link_rewrites(storage.as_ref(), rewrites)?;
        let stale_byte_links = stale_byte_link_lines(&unwritable_bytes, &snapshot.from);
        let same_file = storage.same_file(&snapshot.from_path, &snapshot.to_path);
        if !same_file && storage.exists(&snapshot.to_path) {
            return Err(KernelError::AlreadyExists(snapshot.to.to_string()));
        }
        let mut recovery = rename_recovery::persist(
            Arc::clone(&storage),
            &recovery_root,
            snapshot.from.clone(),
            snapshot.to.clone(),
            fingerprint.clone(),
            durable_rewrites.clone(),
        )?;
        let rewrites = durable_rewrites
            .iter()
            .map(|rewrite| (rewrite.source().clone(), rewrite.request().clone()))
            .collect();
        // Come per un documento: lo spazio che non ha potuto seguire ferma la
        // rinomina finché il file non si è mosso.
        let mut side_data = side_data.invoke();
        if let Some((path, source)) = side_data.doc_data.stranded.take() {
            let mut rollback_errors = side_data.rollback();
            if let Err(error) = recovery.cancel() {
                rollback_errors.push(format!("intent di recupero non cancellato: {error}"));
            }
            return Err(KernelError::Io {
                path,
                source: with_rollback_errors(source, rollback_errors),
            });
        }
        if let Err(source) = storage.rename_no_replace(&snapshot.from_path, &snapshot.to_path) {
            let mut rollback_errors = side_data.rollback();
            if let Err(error) = recovery.cancel() {
                rollback_errors.push(format!("intent di recupero non cancellato: {error}"));
            }
            if source.kind() == std::io::ErrorKind::AlreadyExists {
                let to = if rollback_errors.is_empty() {
                    snapshot.to.to_string()
                } else {
                    format!(
                        "{}; anche il rollback è fallito: {}",
                        snapshot.to,
                        rollback_errors.join("; ")
                    )
                };
                return Err(KernelError::AlreadyExists(to));
            }
            let source = if rollback_errors.is_empty() {
                source
            } else {
                std::io::Error::new(
                    source.kind(),
                    format!(
                        "{source}; anche il rollback è fallito: {}",
                        rollback_errors.join("; ")
                    ),
                )
            };
            return Err(KernelError::Io {
                path: snapshot.from_path,
                source,
            });
        }
        Ok(MovedExplicitAssetRename {
            snapshot,
            storage,
            fingerprint,
            stat: after,
            identity,
            rewrites,
            stale_byte_links,
            side_data,
            recovery,
        })
    }
}

impl MovedExplicitAssetRename {
    /// Ripristina esattamente il file mosso se il commit del core lo rifiuta.
    pub fn rollback(self) -> Result<()> {
        let MovedExplicitAssetRename {
            snapshot,
            storage,
            fingerprint,
            stat,
            identity,
            side_data,
            mut recovery,
            ..
        } = self;
        let before = storage
            .stat(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let identity_before =
            storage
                .file_identity(&snapshot.to_path)
                .map_err(|source| KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                })?;
        let current = crate::vault::fingerprint_of(storage.as_ref(), &snapshot.to_path).map_err(
            |source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            },
        )?;
        let after = storage
            .stat(&snapshot.to_path)
            .map_err(|source| KernelError::Io {
                path: snapshot.to_path.clone(),
                source,
            })?;
        let identity_after =
            storage
                .file_identity(&snapshot.to_path)
                .map_err(|source| KernelError::Io {
                    path: snapshot.to_path.clone(),
                    source,
                })?;
        if !before.is_file()
            || before != stat
            || before != after
            || identity_before != identity
            || identity_after != identity
            || current != fingerprint
        {
            return Err(KernelError::Stale(snapshot.to.to_string()));
        }
        recovery.mark_cancelled()?;
        let mut rollback_errors = side_data.rollback();
        if let Err(source) = storage.rename_no_replace(&snapshot.to_path, &snapshot.from_path) {
            let source = if rollback_errors.is_empty() {
                source
            } else {
                std::io::Error::new(
                    source.kind(),
                    format!(
                        "{source}; anche il rollback dei side-data è fallito: {}",
                        rollback_errors.join("; ")
                    ),
                )
            };
            return Err(KernelError::Io {
                path: snapshot.to_path,
                source,
            });
        }
        if let Err(error) = recovery.complete() {
            rollback_errors.push(format!("intent di recupero non rimosso: {error}"));
        }
        if rollback_errors.is_empty() {
            Ok(())
        } else {
            Err(KernelError::Io {
                path: snapshot.from_path,
                source: std::io::Error::other(format!(
                    "l'asset è stato ripristinato, ma il rollback è fallito: {}",
                    rollback_errors.join("; ")
                )),
            })
        }
    }
}

impl PendingExplicitAssetRename {
    /// Registra il fatto e applica le riscritture tramite callback del chiamante.
    pub fn invoke_rewrites<E>(
        self,
        mut apply: impl FnMut(&DocId, &EditRequest) -> std::result::Result<(), E>,
    ) -> CompletedExplicitAssetRename
    where
        E: std::fmt::Display,
    {
        let PendingExplicitAssetRename {
            workspace_id,
            installed,
            rewrites,
            stale_byte_links,
            side_data,
            recovery,
            journal,
            origin,
            from,
            to,
            owns_batch,
        } = self;
        // Un allegato spostato è una mutazione del vault come le altre: il
        // registro non conosce la differenza fra un documento e un file di cui
        // nessuno sa il formato, e non deve — l'inverso è lo stesso.
        let journal_fault = journal
            .append(
                origin,
                JournalOp::Renamed {
                    from: from.clone(),
                    to: to.clone(),
                },
            )
            .err();
        let mut rewrite_failures = Vec::new();
        for (source, request) in &rewrites {
            if let Err(error) = apply(source, request) {
                rewrite_failures.push(format!("{source}: {error}"));
            }
        }
        if rewrite_failures.is_empty() {
            if let Err(error) = recovery.complete() {
                rewrite_failures.push(format!("intent di recupero: {error}"));
            }
        }
        CompletedExplicitAssetRename {
            workspace_id,
            installed,
            side_data,
            from,
            to,
            owns_batch,
            rewrite_failures,
            stale_byte_links,
            journal_fault,
        }
    }
}

impl PendingIdentityMigration {
    pub(super) fn invoke(self) -> CompletedIdentityMigration {
        CompletedIdentityMigration {
            workspace_id: self.workspace_id,
            from: self.from,
            to: self.to,
            installed: self.installed,
            removal: self.removal.invoke(),
            feed: self.feed.invoke_indexes(),
        }
    }
}

impl PreparedRenameSideData {
    pub(super) fn invoke(self) -> CompletedRenameSideData {
        let rollback = PreparedRenameSideData {
            from: self.to.clone(),
            to: self.from.clone(),
            organization: Arc::clone(&self.organization),
            drafts: Arc::clone(&self.drafts),
            storage: Arc::clone(&self.storage),
            doc_data_roots: self.doc_data_roots.clone(),
        };
        let PreparedRenameSideData {
            from,
            to,
            organization,
            drafts,
            storage,
            doc_data_roots,
        } = self;
        if let Err(error) = organization.migrate(from.as_str(), to.as_str()) {
            organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in {to}: {error}"
            ));
        }
        let mut doc_data = crate::docdata::migrate(storage.as_ref(), &doc_data_roots, &from, &to);
        let mut errors = std::mem::take(&mut doc_data.messages);
        let draft_move = match drafts.migrate_tracked(&from, &to) {
            Ok(moved) => moved,
            Err(error) => {
                errors.push(format!("bozza non migrata: {error}"));
                crate::drafts::DraftMove::Untouched
            }
        };
        CompletedRenameSideData {
            from,
            to,
            errors,
            doc_data,
            draft_move,
            rollback: Some(rollback),
        }
    }
}

/// Il guasto che ha fermato una rinomina, con ciò che il suo rollback non ha
/// potuto disfare.
pub(super) fn with_rollback_errors(
    source: std::io::Error,
    rollback_errors: Vec<String>,
) -> std::io::Error {
    if rollback_errors.is_empty() {
        return source;
    }
    std::io::Error::new(
        source.kind(),
        format!(
            "{source}; anche il rollback è fallito: {}",
            rollback_errors.join("; ")
        ),
    )
}

impl CompletedRenameSideData {
    pub(super) fn rollback(mut self) -> Vec<String> {
        let Some(rollback) = self.rollback.take() else {
            return vec!["ricevuta di rollback già consumata".into()];
        };
        let PreparedRenameSideData {
            from,
            to,
            organization,
            drafts,
            storage,
            doc_data_roots: _,
        } = rollback;
        let mut errors = Vec::new();
        if let Err(error) = organization.migrate(from.as_str(), to.as_str()) {
            errors.push(format!("organizzazione non ripristinata: {error}"));
        }
        errors.extend(std::mem::take(&mut self.doc_data).undo(storage.as_ref()));
        // `from` e `to` del rollback sono invertiti: la mossa è stata fatta da
        // `to` (qui) a `from`.
        if let Err(error) = drafts.undo_move(&to, &from, &self.draft_move) {
            errors.push(format!("bozza non ripristinata: {error}"));
        }
        errors
    }
}

impl PreparedAssetRenameSideData {
    pub(super) fn invoke(self) -> CompletedAssetRenameSideData {
        let rollback = PreparedAssetRenameSideData {
            from: self.to.clone(),
            to: self.from.clone(),
            organization: Arc::clone(&self.organization),
            storage: Arc::clone(&self.storage),
            doc_data_roots: self.doc_data_roots.clone(),
        };
        let PreparedAssetRenameSideData {
            from,
            to,
            organization,
            storage,
            doc_data_roots,
        } = self;
        // Seguono l'allegato le due cose che seguono ogni identità che cambia:
        // ciò che l'utente gli ha attaccato addosso (§11.3) e lo spazio
        // per-documento di chiunque altro (§13.2). Un allegato può essere
        // appuntato e può avere una miniatura, e nessuna delle due è meno sua
        // per il fatto che nessuno lo parsa.
        if let Err(error) = organization.migrate(from.as_str(), to.as_str()) {
            organization.warn(format!(
                "l'organizzazione di {from} non ha potuto seguire la rinomina in {to}: {error}"
            ));
        }
        let mut doc_data = crate::docdata::migrate(storage.as_ref(), &doc_data_roots, &from, &to);
        let errors = std::mem::take(&mut doc_data.messages);
        CompletedAssetRenameSideData {
            from,
            to,
            errors,
            doc_data,
            rollback: Some(rollback),
        }
    }
}

impl CompletedAssetRenameSideData {
    pub(super) fn rollback(mut self) -> Vec<String> {
        let Some(rollback) = self.rollback.take() else {
            return vec!["ricevuta di rollback asset già consumata".into()];
        };
        let PreparedAssetRenameSideData {
            from,
            to,
            organization,
            storage,
            doc_data_roots: _,
        } = rollback;
        let mut errors = Vec::new();
        if let Err(error) = organization.migrate(from.as_str(), to.as_str()) {
            errors.push(format!("organizzazione non ripristinata: {error}"));
        }
        errors.extend(std::mem::take(&mut self.doc_data).undo(storage.as_ref()));
        errors
    }
}
