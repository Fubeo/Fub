//! I piani della sincronizzazione col disco: rinomine esterne, recuperi, cambi osservati.

use super::*;

/// Piano owned di una sincronizzazione esterna.
///
/// La preparazione fotografa soltanto stato del kernel e handle condivisi. La
/// lettura `stat-read-stat` e il parse avvengono con [`SyncPlan::invoke`],
/// senza conservare alcun prestito del workspace.
pub struct SyncPlan {
    pub(super) snapshot: SyncSnapshot,
    pub(super) action: SyncPlanAction,
}

/// Routing owned di una rinomina consegnata dal watcher.
pub enum ExternalRenamePlan {
    Asset(Box<PreparedExternalAssetRename>),
    Document(Box<PreparedExternalDocumentRename>),
    Sync(Vec<(Utf8PathBuf, Option<SyncPlan>)>),
}

/// Lettura e parse detached della destinazione di una rinomina documento.
pub struct PreparedExternalDocumentRename {
    pub(super) snapshot: ExternalRenameSnapshot,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) parser: PreparedParse,
    pub(super) source_kind: SourceKind,
    pub(super) side_data: PreparedRenameSideData,
}

/// Destinazione già letta e parsata fuori dal workspace.
pub struct ParsedExternalDocumentRename {
    pub(super) snapshot: ExternalRenameSnapshot,
    pub(super) state: ParsedExternalDocumentState,
    pub(super) side_data: PreparedRenameSideData,
}

pub(super) enum ParsedExternalDocumentState {
    Ready {
        model: Box<DocumentModel>,
        fingerprint: Revision,
        stat: crate::storage::Stat,
    },
    /// La destinazione non si è potuta leggere come il documento rinominato.
    Unverified,
}

impl ParsedExternalDocumentRename {
    /// Da dove a dove: i due path che il chiamante riconcilia quando
    /// [`prepare_external_document_rename`](Workspace::prepare_external_document_rename)
    /// non convalida la rinomina.
    pub fn paths(&self) -> (Utf8PathBuf, Utf8PathBuf) {
        (
            self.snapshot.from_path.clone(),
            self.snapshot.to_path.clone(),
        )
    }
}

/// Core della rinomina già installato, callback e side-data ancora detached.
pub struct PendingExternalDocumentRename {
    pub(super) snapshot: ExternalRenameSnapshot,
    pub(super) installed: VaultEntry,
    pub(super) removal: PreparedDocumentRemoval,
    pub(super) feed: PreparedDocumentFeed,
    pub(super) side_data: PreparedRenameSideData,
}

/// Callback e side-data completati, pronto per l'unico epilogo.
pub struct CompletedExternalDocumentRename {
    pub(super) snapshot: ExternalRenameSnapshot,
    pub(super) installed: VaultEntry,
    pub(super) removal: CompletedDocumentRemoval,
    pub(super) feed: PreparedDocumentFeed,
    pub(super) side_data: CompletedRenameSideData,
}

/// Prima fase owned della migrazione d'identità di un asset.
pub struct PreparedExternalAssetRename {
    pub(super) snapshot: ExternalRenameSnapshot,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) organization: Arc<OrganizationStore>,
    pub(super) doc_data_roots: Vec<Utf8PathBuf>,
    pub(super) fallback: Vec<(Utf8PathBuf, Option<SyncPlan>)>,
}

/// Esito detached della prima fase di una rinomina asset.
pub enum ParsedExternalRename {
    Asset(Box<ParsedExternalAssetRename>),
    Sync(Vec<(Utf8PathBuf, Option<ParsedChange>)>),
}

pub struct ParsedExternalAssetRename {
    pub(super) snapshot: ExternalRenameSnapshot,
    pub(super) stat: crate::storage::Stat,
    pub(super) fingerprint: Revision,
    pub(super) organization: Arc<OrganizationStore>,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) doc_data_roots: Vec<Utf8PathBuf>,
}

/// Core già migrato, side-data ancora da spostare fuori dal workspace.
pub struct PendingExternalAssetRename {
    pub(super) snapshot: ExternalRenameSnapshot,
    pub(super) installed: VaultEntry,
    pub(super) organization: Arc<OrganizationStore>,
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) doc_data_roots: Vec<Utf8PathBuf>,
}

/// Side-data già migrato, pronto per l'unica finalizzazione e notifica.
pub struct CompletedExternalAssetRename {
    pub(super) snapshot: ExternalRenameSnapshot,
    pub(super) installed: VaultEntry,
    pub(super) doc_data_errors: Vec<String>,
}

pub(super) struct ExternalRenameSnapshot {
    pub(super) workspace_id: u64,
    pub(super) from_path: Utf8PathBuf,
    pub(super) to_path: Utf8PathBuf,
    pub(super) from_id: DocId,
    pub(super) to_id: DocId,
    pub(super) from_entry: VaultEntry,
    pub(super) to_entry: Option<VaultEntry>,
    pub(super) syntax_generation: u64,
    pub(super) routing_generation: u64,
}

/// Fotografia owned necessaria a confrontare il disco dopo l'avvio del watcher.
///
/// Il workspace la prepara senza I/O; [`PreparedCatchUp::invoke`] cammina il
/// vault e verifica le impronte dopo che la guardia di [`Workspace`] è caduta.
pub struct PreparedCatchUp {
    pub(super) vault: crate::Vault,
    /// `None` è il vault intero; altrimenti la sola cartella assoluta, e
    /// `entries` contiene soltanto le voci che stanno sotto di lei.
    pub(super) within: Option<Utf8PathBuf>,
    pub(super) entries: BTreeMap<DocId, VaultEntry>,
}

/// Candidati prodotti dalla scansione detached della riconciliazione d'apertura.
/// I campi restano chiusi: soltanto [`Workspace::plan_catch_up`] può trasformare
/// questa fotografia in piani legati allo stato corrente del workspace.
pub struct CatchUpSnapshot {
    pub(super) candidates: BTreeMap<DocId, Utf8PathBuf>,
}

impl CatchUpSnapshot {
    /// La scansione non ha trovato niente da riallineare.
    pub fn is_empty(&self) -> bool {
        self.candidates.is_empty()
    }
}

/// Esito già invocato della fase detached di una sincronizzazione esterna.
///
/// Questo tipo non espone `invoke`: non può quindi essere confuso con il piano
/// che ancora possiede I/O o parse da eseguire.
pub struct ParsedChange {
    pub(super) snapshot: SyncSnapshot,
    pub(super) state: ParsedChangeState,
}

/// Mutazione preparata sotto il workspace, ma non ancora notificata agli
/// indici esterni.
pub struct PendingSyncChange {
    pub(super) snapshot: SyncSnapshot,
    pub(super) state: PendingSyncState,
}

/// Risultato di una mutazione dopo l'unica callback esterna necessaria.
pub struct CompletedSyncChange {
    pub(super) snapshot: SyncSnapshot,
    pub(super) state: CompletedSyncState,
}

pub(super) struct SyncSnapshot {
    pub(super) workspace_id: u64,
    pub(super) path: Utf8PathBuf,
    pub(super) id: DocId,
    /// L'impronta che l'anagrafe aveva **al momento del piano**.
    pub(super) seen: Option<Revision>,
    pub(super) entry: Option<VaultEntry>,
    pub(super) syntax_generation: u64,
    pub(super) routing_generation: u64,
}

pub(super) enum SyncPlanAction {
    Parse {
        storage: Arc<dyn crate::storage::VaultStorage>,
        parser: Box<PreparedParse>,
        source_kind: SourceKind,
        already_ingested: bool,
    },
    Stat {
        storage: Arc<dyn crate::storage::VaultStorage>,
    },
}

pub(super) enum ParsedChangeState {
    Ready {
        model: Box<DocumentModel>,
        /// L'impronta del sorgente che è stato letto: è quella che finirà in
        /// anagrafe.
        fingerprint: Revision,
        stat: crate::storage::Stat,
    },
    Entry(Option<crate::storage::Stat>),
    /// Il file letto porta **l'impronta che l'anagrafe ha già**: è la
    /// scrittura del kernel che rientra dal rilevatore, e non c'è niente da
    /// parsare né da ingerire (difetto 0196, vedi
    /// [`Workspace::already_ingested`]).
    Unchanged(crate::storage::Stat),
    Missing,
    Unstable,
    Failed(KernelError),
}

pub(super) enum PendingSyncState {
    Feed {
        feed: Box<PreparedDocumentFeed>,
        previous_provider_call: bool,
    },
    Removal(PreparedDocumentRemoval),
    Entry(Option<crate::storage::Stat>),
    Unchanged(crate::storage::Stat),
}

pub(super) enum CompletedSyncState {
    Feed {
        feed: Box<PreparedDocumentFeed>,
        previous_provider_call: bool,
    },
    Removal(CompletedDocumentRemoval),
    Entry(Option<crate::storage::Stat>),
    Unchanged(crate::storage::Stat),
}

impl SyncPlan {
    /// Esegue I/O e parse senza alcun prestito del workspace.
    pub fn invoke(self) -> ParsedChange {
        let SyncPlan { snapshot, action } = self;
        let state = match action {
            SyncPlanAction::Parse {
                storage,
                parser,
                source_kind,
                already_ingested,
            } => invoke_sync_read(
                &snapshot,
                storage.as_ref(),
                *parser,
                source_kind,
                already_ingested,
            ),
            SyncPlanAction::Stat { storage } => match storage.stat(&snapshot.path) {
                Ok(stat) if stat.is_file() => ParsedChangeState::Entry(Some(stat)),
                Ok(_) => ParsedChangeState::Entry(None),
                Err(error) if sync_path_is_absent(&error) => ParsedChangeState::Entry(None),
                Err(source) => ParsedChangeState::Failed(KernelError::Io {
                    path: snapshot.path.clone(),
                    source,
                }),
            },
        };
        ParsedChange { snapshot, state }
    }
}

impl PreparedExternalDocumentRename {
    /// Esegue stat-read-stat e parse nella forma dichiarata dal formato.
    ///
    /// Qualunque cosa impedisca di convalidarla — destinazione sparita o
    /// instabile, troppo grande, non UTF-8, rifiutata dal parser — rende la
    /// rinomina [non convalidata](ParsedExternalDocumentState::Unverified), senza
    /// diagnosi: chi chiama riconcilia i due path, e il guasto della
    /// destinazione lo dice quella sincronizzazione, una volta sola.
    pub fn invoke(self) -> ParsedExternalDocumentRename {
        let PreparedExternalDocumentRename {
            snapshot,
            storage,
            parser,
            source_kind,
            side_data,
        } = self;
        let state = (|| {
            let before = storage
                .stat(&snapshot.to_path)
                .ok()
                .filter(|stat| stat.is_file())?;
            crate::documents::within_source_limit(&snapshot.to_id, before.size).ok()?;
            let bytes = storage.read(&snapshot.to_path).ok()?;
            let stat = storage
                .stat(&snapshot.to_path)
                .ok()
                .filter(|after| after.is_file() && *after == before)?;
            let fingerprint = Revision::of_bytes(&bytes);
            let source = match source_kind {
                SourceKind::Text => DocumentSource::Text(
                    fub_abi::rules::text_policy::decode(&bytes)
                        .ok()?
                        .to_string(),
                ),
                SourceKind::Bytes => DocumentSource::Bytes(bytes),
            };
            let model = parser.invoke(source).ok()?;
            Some(ParsedExternalDocumentState::Ready {
                model: Box::new(model),
                fingerprint,
                stat,
            })
        })()
        .unwrap_or(ParsedExternalDocumentState::Unverified);
        ParsedExternalDocumentRename {
            snapshot,
            state,
            side_data,
        }
    }
}

impl PendingExternalDocumentRename {
    /// Notifica remove+feed e migra i dati autorevoli senza detenere il workspace.
    pub fn invoke(self) -> CompletedExternalDocumentRename {
        let PendingExternalDocumentRename {
            snapshot,
            installed,
            removal,
            feed,
            side_data,
        } = self;
        CompletedExternalDocumentRename {
            snapshot,
            installed,
            removal: removal.invoke(),
            feed: feed.invoke_indexes(),
            side_data: side_data.invoke(),
        }
    }
}

impl PreparedExternalAssetRename {
    /// Verifica la destinazione con stat-read-stat e, se non è un file stabile,
    /// invoca i due piani per-path già fotografati. Tutto il filesystem resta
    /// fuori da Custody.
    pub fn invoke(self) -> ParsedExternalRename {
        let PreparedExternalAssetRename {
            snapshot,
            storage,
            organization,
            doc_data_roots,
            fallback,
        } = self;
        let verified = match storage.stat(&snapshot.to_path) {
            Ok(before) if before.is_file() => {
                match crate::vault::fingerprint_of(storage.as_ref(), &snapshot.to_path) {
                    Ok(fingerprint) => match storage.stat(&snapshot.to_path) {
                        Ok(after) if after.is_file() && before == after => {
                            Some((after, fingerprint))
                        }
                        _ => None,
                    },
                    Err(_) => None,
                }
            }
            _ => None,
        };
        match verified {
            Some((stat, fingerprint)) => {
                ParsedExternalRename::Asset(Box::new(ParsedExternalAssetRename {
                    snapshot,
                    stat,
                    fingerprint,
                    organization,
                    storage,
                    doc_data_roots,
                }))
            }
            None => ParsedExternalRename::Sync(
                fallback
                    .into_iter()
                    .map(|(path, plan)| (path, plan.map(SyncPlan::invoke)))
                    .collect(),
            ),
        }
    }
}

impl PendingExternalAssetRename {
    /// Migra i dati autorevoli dell'asset senza detenere il workspace.
    pub fn invoke(self) -> CompletedExternalAssetRename {
        let PendingExternalAssetRename {
            snapshot,
            installed,
            organization,
            storage,
            doc_data_roots,
        } = self;
        if let Err(error) = organization.migrate(snapshot.from_id.as_str(), snapshot.to_id.as_str())
        {
            organization.warn(format!(
                "l'organizzazione di {} non ha potuto seguire la rinomina in {}: {error}",
                snapshot.from_id, snapshot.to_id
            ));
        }
        let doc_data_errors = crate::docdata::migrate_data(
            storage.as_ref(),
            &doc_data_roots,
            &snapshot.from_id,
            &snapshot.to_id,
        );
        CompletedExternalAssetRename {
            snapshot,
            installed,
            doc_data_errors,
        }
    }
}

impl PreparedCatchUp {
    /// Cammina e legge il vault senza conservare alcun prestito del workspace.
    ///
    /// Soltanto un `size + mtime` uguale rende il file eleggibile al salto, e
    /// l'impronta sui byte decide poi se è davvero rimasto uguale. Un metadato
    /// diverso o una lettura fallita resta candidato.
    pub fn invoke(self) -> Result<CatchUpSnapshot> {
        let PreparedCatchUp {
            vault,
            within,
            entries,
        } = self;
        // La camminata è quella della scansione — stessa politica di
        // esclusione, stesse specie.
        let scanned = match &within {
            None => vault.scan()?,
            Some(dir) => vault.scan_within(dir)?,
        };
        let mut candidates = BTreeMap::new();
        let mut on_disk = BTreeSet::new();
        for file in scanned.files {
            let unchanged = entries
                .get(&file.id)
                .filter(|entry| entry.size == file.size && entry.mtime == file.mtime)
                .and_then(|entry| entry.fingerprint.as_ref())
                .is_some_and(|fingerprint| {
                    vault
                        .fingerprint(&file.id)
                        .is_ok_and(|current| current == *fingerprint)
                });
            on_disk.insert(file.id.clone());
            if !unchanged {
                candidates.insert(file.id.clone(), vault.root().join(file.id.as_str()));
            }
        }
        // Ciò che l'anagrafe aveva e il disco non ha più: un file sparito
        // nella finestra resta un candidato, e lo toglie chi applica il suo
        // piano — la strada intera, che è dove lo sparito si toglie.
        for id in entries.keys() {
            if on_disk.contains(id) {
                continue;
            }
            let path = vault.root().join(id.as_str());
            if !vault.is_ignored(&path) {
                candidates.insert(id.clone(), path);
            }
        }
        Ok(CatchUpSnapshot { candidates })
    }
}

impl PendingSyncChange {
    /// Esegue la sola callback esterna successiva alla mutazione del core.
    pub fn invoke(self) -> CompletedSyncChange {
        let PendingSyncChange { snapshot, state } = self;
        let state = match state {
            PendingSyncState::Feed {
                feed,
                previous_provider_call,
            } => CompletedSyncState::Feed {
                feed: Box::new((*feed).invoke_indexes()),
                previous_provider_call,
            },
            PendingSyncState::Removal(removal) => CompletedSyncState::Removal(removal.invoke()),
            PendingSyncState::Entry(stat) => CompletedSyncState::Entry(stat),
            PendingSyncState::Unchanged(stat) => CompletedSyncState::Unchanged(stat),
        };
        CompletedSyncChange { snapshot, state }
    }
}

pub(super) fn invoke_sync_read(
    snapshot: &SyncSnapshot,
    storage: &dyn crate::storage::VaultStorage,
    parser: PreparedParse,
    source_kind: SourceKind,
    already_ingested: bool,
) -> ParsedChangeState {
    let before = match storage.stat(&snapshot.path) {
        Ok(stat) if stat.is_file() => stat,
        Ok(_) => return ParsedChangeState::Unstable,
        Err(error) if sync_path_is_absent(&error) => return ParsedChangeState::Missing,
        Err(source) => {
            return ParsedChangeState::Failed(KernelError::Io {
                path: snapshot.path.clone(),
                source,
            })
        }
    };
    if let Err(error) = crate::documents::within_source_limit(&snapshot.id, before.size) {
        return ParsedChangeState::Failed(error);
    }
    let bytes = match storage.read(&snapshot.path) {
        Ok(bytes) => bytes,
        Err(error) if sync_path_is_absent(&error) => return ParsedChangeState::Missing,
        Err(source) => {
            return ParsedChangeState::Failed(KernelError::Io {
                path: snapshot.path.clone(),
                source,
            })
        }
    };
    let after = match storage.stat(&snapshot.path) {
        Ok(stat) if stat.is_file() => stat,
        Ok(_) => return ParsedChangeState::Unstable,
        Err(error) if sync_path_is_absent(&error) => return ParsedChangeState::Missing,
        Err(source) => {
            return ParsedChangeState::Failed(KernelError::Io {
                path: snapshot.path.clone(),
                source,
            })
        }
    };
    if before != after {
        return ParsedChangeState::Unstable;
    }
    let fingerprint = Revision::of_bytes(&bytes);
    // L'eco della propria scrittura non si riparsa (§14.1, difetto 0196).
    if already_ingested && snapshot.seen.as_ref() == Some(&fingerprint) {
        return ParsedChangeState::Unchanged(after);
    }
    let source = match source_kind {
        SourceKind::Text => match fub_abi::rules::text_policy::decode(&bytes) {
            Ok(text) => DocumentSource::Text(text.to_string()),
            Err(at) => {
                return ParsedChangeState::Failed(KernelError::Io {
                    path: snapshot.path.clone(),
                    source: std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!(
                            "il file non è UTF-8: il primo byte non valido è a {at} \
                             (0x{:02X}), su {} byte in tutto",
                            bytes.get(at).copied().unwrap_or(0),
                            bytes.len()
                        ),
                    ),
                })
            }
        },
        SourceKind::Bytes => DocumentSource::Bytes(bytes),
    };
    match parser.invoke(source) {
        Ok(model) => ParsedChangeState::Ready {
            model: Box::new(model),
            fingerprint,
            stat: after,
        },
        Err(error) => ParsedChangeState::Failed(error),
    }
}

pub(super) fn sync_path_is_absent(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::InvalidInput
    ) || matches!(error.raw_os_error(), Some(2 | 3 | 123))
}

pub struct PreparedDocumentFeed {
    pub(super) id: DocId,
    pub(super) model: Option<DocumentModel>,
    pub(super) changes: DocChanges,
    pub(super) revision: Revision,
    pub(super) journal: JournalOp,
    pub(super) providers: Vec<(String, SharedIndexProvider)>,
    pub(super) losses: Vec<IndexLoss>,
}

impl PreparedDocumentFeed {
    pub fn invoke_indexes(mut self) -> Self {
        let providers = std::mem::take(&mut self.providers);
        if let Some(model) = &self.model {
            self.losses
                .extend(feed_index_handles(&providers, std::slice::from_ref(model)));
        }
        if let Err(error) = release_index_handles(providers) {
            self.losses.push(IndexLoss::new(self.id.clone(), error));
        }
        self
    }
}
