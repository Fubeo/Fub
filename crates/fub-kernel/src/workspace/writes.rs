//! Scritture dei documenti: testo e byte, ganci prima della scrittura, journal e bozze.

use super::*;

/// Un gancio **prima della scrittura**: ciò che una feature vuole fare con
/// l'originale un istante prima che venga sovrascritto (0154).
///
/// È generico — un id di plugin e una chiusura — perché il kernel non sa cosa
/// sia una fotografia: sa solo che c'è un momento, fra il parse e il disco, in
/// cui il contenuto che sta per sparire è ancora leggibile, e che qualcuno può
/// volerlo guardare. Nessun gancio è il default e non è un difetto: la maggior
/// parte dei montaggi non registra niente.
pub type BeforeWriteHook =
    Arc<dyn Fn(&mut dyn HostApi, &DocId) -> std::result::Result<(), PluginError> + Send + Sync>;

/// Un gancio prima della scrittura pronto da chiamare, con l'owner a cui
/// intestare l'host.
///
/// I ganci sono uno per owner e girano nell'ordine di registrazione; il primo
/// errore ferma la scrittura e i ganci che seguono non girano. Chi scrive fuori
/// dal workspace (l'host) li percorre con [`PreparedDocumentWrite::before_write`]
/// e dà a ciascuno un proxy con le capacità del **suo** owner: un gancio non
/// presta le proprie capacità a quello dopo.
///
/// Il gancio è soltanto nativo: il WIT non ha un export per lui, quindi un
/// componente WASM non può registrarne uno.
pub struct BeforeWriteCall<'a> {
    pub(super) owner: &'a str,
    pub(super) hook: &'a BeforeWriteHook,
    pub(super) id: &'a DocId,
}

impl BeforeWriteCall<'_> {
    /// Il plugin che ha registrato il gancio.
    pub fn owner(&self) -> &str {
        self.owner
    }

    /// Chiama il gancio; un panico diventa un errore che nomina l'owner.
    pub fn invoke(&self, host: &mut dyn HostApi) -> std::result::Result<(), PluginError> {
        crate::safety::calling_callback(self.owner, "BeforeWriteHook", || {
            (self.hook)(host, self.id)
        })
    }
}

pub(super) fn before_write_calls<'a>(
    hooks: &'a [(String, BeforeWriteHook)],
    id: &'a DocId,
) -> impl Iterator<Item = BeforeWriteCall<'a>> {
    hooks
        .iter()
        .map(move |(owner, hook)| BeforeWriteCall { owner, hook, id })
}

/// Scrittura risolta fino al confine del codice esterno. Non porta guardie del
/// workspace: può essere parsata mentre `Custody<Workspace>` è rilasciato.
pub struct PreparedDocumentWrite {
    pub(super) id: DocId,
    pub(super) existed: bool,
    pub(super) from: Option<Revision>,
    pub(super) expected_source: Option<String>,
    pub(super) parser: PreparedParse,
    pub(super) before_write: Vec<(String, BeforeWriteHook)>,
    /// Il vault su cui posare i byte: la scrittura sul disco
    /// ([`PreparedDocumentWrite::place`]) gira senza prestito del workspace.
    pub(super) vault: crate::vault::Vault,
}

/// Una scrittura testuale **già sul disco**, che aspetta soltanto di entrare
/// nelle tabelle del workspace ([`Workspace::commit_placed_document_write`]).
///
/// Esiste perché la scrittura sul disco è la parte lunga di un salvataggio: un
/// `fsync` su un disco occupato da altri programmi dura secondi, e tenerla
/// dentro il prestito esclusivo fermava ogni lettura del vault per tutto quel
/// tempo (IMP-1805). La CAS sul disco resta la stessa e resta sotto il turno di
/// scrittura, che serializza i writer di Fub fra la base preparata e la
/// pubblicazione; il prestito esclusivo serve soltanto alle tabelle.
pub struct PlacedDocumentWrite {
    pub(super) id: DocId,
    pub(super) existed: bool,
    pub(super) from: Option<Revision>,
    pub(super) revision: Revision,
    pub(super) size: u64,
    pub(super) mtime: u64,
}

/// Come [`PlacedDocumentWrite`], per la via a byte.
pub struct PlacedDocumentBytesWrite {
    pub(super) id: DocId,
    pub(super) from: Option<Revision>,
    pub(super) rewrote: bool,
    pub(super) revision: Revision,
    pub(super) size: u64,
    pub(super) mtime: u64,
}

/// Scrittura raw preparata senza eseguire provider. La preimmagine resta quella
/// verificata all'apertura del turno, anche se il file cambia durante il parse.
pub struct PreparedDocumentBytesWrite {
    pub(super) id: DocId,
    pub(super) path: Utf8PathBuf,
    pub(super) from: Option<Revision>,
    pub(super) expected_bytes: Option<Vec<u8>>,
    pub(super) parser: Option<PreparedParse>,
    pub(super) before_write: Vec<(String, BeforeWriteHook)>,
    /// Il supporto su cui posare i byte, senza prestito del workspace.
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
}

/// **La riga del registro di un epilogo**, da appendere fuori dal prestito
/// esclusivo ([`Workspace::finish_deferred_events_detached`]).
///
/// Appendere al registro è scrivere sul disco, e su un disco occupato da altri
/// programmi una scrittura dura secondi: dentro il prestito esclusivo fermava
/// ogni lettura del vault per tutto quel tempo (IMP-1805). L'origine si fissa
/// qui, sotto il prestito, com'era nell'epilogo; l'ordine fra le righe lo tiene
/// il turno di scrittura, che chi la appende deve tenere ancora: un altro
/// writer non può registrare la sua riga prima di questa.
#[must_use = "la riga va appesa con `append`, o il registro perde un'operazione"]
pub struct PendingJournalRecord {
    pub(super) journal: Arc<Journal>,
    pub(super) origin: fub_abi::event::Origin,
    pub(super) op: JournalOp,
}

/// Un'appendice del registro che non è riuscita: si riconsegna a
/// [`Workspace::report_journal_failure`], che la dice come l'epilogo l'ha
/// sempre detta.
pub struct JournalFailure(pub(super) String);

impl PendingJournalRecord {
    /// Appende la riga, senza prestito del workspace.
    pub fn append(self) -> std::result::Result<(), JournalFailure> {
        self.journal
            .append(self.origin, self.op)
            .map_err(JournalFailure)
    }
}

impl PreparedDocumentWrite {
    /// Esegue `FormatProvider::parse` e tutte le `SyntaxRule`, e nient'altro.
    pub fn parse(&self, source: &str) -> Result<DocumentModel> {
        self.parser.invoke(DocumentSource::Text(source.to_string()))
    }

    /// Il sorgente verificato da `WriteBase::DescendsFrom`.
    ///
    /// Serve al percorso host dell'edit: gli span vengono applicati e il
    /// provider di formato viene chiamato dopo aver rilasciato il workspace.
    pub fn expected_source(&self) -> Option<&str> {
        self.expected_source.as_deref()
    }

    /// I ganci esterni fra parse e disco, nell'ordine in cui girano. Il
    /// chiamante host dà a ciascuno un proxy che riacquisisce capacità strette
    /// una per volta, e si ferma al primo errore.
    pub fn before_write(&self) -> impl Iterator<Item = BeforeWriteCall<'_>> {
        before_write_calls(&self.before_write, &self.id)
    }

    /// **Posa i byte sul disco**, senza prestito del workspace.
    ///
    /// Va chiamata sotto il turno di scrittura, dopo il parse e i ganci, e il
    /// risultato va consegnato a [`Workspace::commit_placed_document_write`]:
    /// fra le due il disco ha già il testo nuovo e le tabelle ancora il
    /// vecchio, come durante la fase degli indici. La CAS è quella di sempre:
    /// con `DescendsFrom` scrive solo se il disco ha ancora la base verificata
    /// (altrimenti `Stale`), una creazione solo se il path è ancora libero
    /// (altrimenti `AlreadyExists`). Un gancio che ha detto di no ferma la
    /// scrittura prima del disco.
    pub fn place(
        self,
        source: &str,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<PlacedDocumentWrite> {
        let PreparedDocumentWrite {
            id,
            existed,
            from,
            expected_source,
            vault,
            ..
        } = self;
        if let Err(and) = before_write {
            return Err(Workspace::before_write_error(&id, and));
        }
        let (size, mtime) = if let Some(expected) = expected_source.as_deref() {
            vault
                .write_if_unchanged(&id, expected, source)?
                .ok_or_else(|| KernelError::Stale(id.to_string()))?
        } else if !existed {
            // La preparazione ha visto il path libero, e il registro dirà
            // `Created`, il cui inverso è cestinare. Un file posato nel frattempo
            // da un altro programma non è nostro: la scrittura resta una
            // creazione fino alla pubblicazione, come nella via a byte.
            vault
                .write_if_absent(&id, source)?
                .ok_or_else(|| KernelError::AlreadyExists(id.to_string()))?
        } else {
            vault.write(&id, source)?
        };
        Ok(PlacedDocumentWrite {
            id,
            existed,
            from,
            revision: Revision::of(source),
            size,
            mtime,
        })
    }
}

impl PreparedDocumentBytesWrite {
    /// Produce il modello attraverso la stessa pipeline dei salvataggi testuali.
    /// I file senza provider restano opachi; nessun buffer viene allocato per loro.
    pub fn parse(&self, bytes: &[u8]) -> Result<Option<DocumentModel>> {
        let Some(parser) = &self.parser else {
            return Ok(None);
        };
        let source = match parser.source_kind() {
            SourceKind::Bytes => DocumentSource::Bytes(bytes.to_vec()),
            SourceKind::Text => {
                let text =
                    fub_abi::rules::text_policy::decode(bytes).map_err(|at| KernelError::Io {
                        path: self.path.clone(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("invalid UTF-8 at byte {at}"),
                        ),
                    })?;
                DocumentSource::Text(text.to_string())
            }
        };
        parser.invoke(source).map(Some)
    }

    /// I ganci esterni fra parse e disco, come nella via testuale.
    pub fn before_write(&self) -> impl Iterator<Item = BeforeWriteCall<'_>> {
        before_write_calls(&self.before_write, &self.id)
    }

    /// **Posa i byte sul disco** senza prestito del workspace: la stessa
    /// `write_if_unchanged` di sempre (`None` = solo creazione, `Some` = CAS),
    /// da consegnare poi a [`Workspace::commit_placed_document_bytes_write`].
    /// Vedi [`PreparedDocumentWrite::place`] per perché sta fuori.
    pub fn place(
        self,
        bytes: &[u8],
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<PlacedDocumentBytesWrite> {
        let PreparedDocumentBytesWrite {
            id,
            path,
            from,
            expected_bytes,
            storage,
            ..
        } = self;
        if let Err(error) = before_write {
            return Err(Workspace::before_write_error(&id, error));
        }
        let stored = storage
            .write_if_unchanged(&path, expected_bytes.as_deref(), bytes)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        let stat = match stored {
            crate::storage::ConditionalWrite::Written(stat) => stat,
            crate::storage::ConditionalWrite::Changed => {
                return Err(if expected_bytes.is_some() {
                    KernelError::Stale(id.to_string())
                } else {
                    KernelError::AlreadyExists(id.to_string())
                });
            }
        };
        Ok(PlacedDocumentBytesWrite {
            id,
            from,
            rewrote: expected_bytes.is_some(),
            revision: Revision::of_bytes(bytes),
            size: stat.size,
            mtime: stat.mtime,
        })
    }
}

impl Workspace {
    /// Prima fase di [`write_document`](Workspace::write_document): controlla la
    /// base e prepara il parser, senza eseguire codice del provider.
    pub fn prepare_document_write(
        &self,
        id: &DocId,
        base: WriteBase,
    ) -> Result<PreparedDocumentWrite> {
        self.indexes.ensure_mutation_available()?;
        // Cosa si sapeva **prima**: l'impronta che l'anagrafe teneva, e se il
        // documento esistesse affatto.
        //
        // **«C'era» lo dice il disco** (difetto 0180). L'anagrafe è una cache
        // di ciò che si è indicizzato, quindi «non lo conosco» e «non c'è» ci
        // si assomigliano solo finché nessuno scrive nel vault da fuori: un
        // file creato da un'altra applicazione e non ancora visto dal
        // rilevatore c'è sul disco e in anagrafe no, e sopra quel file il
        // salvataggio scriveva `Created`. Non è una parola imprecisa in una
        // lista: il registro è **autorevole** (0067) e di quella variante c'è
        // scritto sopra che «l'inverso è cestinarlo», quindi chi ripercorre la
        // riga porta nel cestino un file che non abbiamo creato noi, con dentro
        // ciò che ci aveva messo qualcun altro.
        //
        // La domanda è la più povera che risponda — *c'è un file lì?* — e la
        // paga un `stat`, non una lettura: il doc di `write_document` dice
        // che «una riga di registro non vale una lettura a ogni salvataggio»,
        // ed è vera e resta vera, perché una lettura porta i byte e li fa
        // parsare per averne l'impronta mentre qui non serve niente di tutto
        // ciò. Con [`WriteBase::DescendsFrom`] non si paga nemmeno quello: il
        // disco è già stato letto qui sotto, e se non fosse esistito la base non
        // combaciava e non si arrivava a scrivere.
        //
        // E non si paga **quasi mai**, perché l'anagrafe sbaglia in una
        // direzione sola: conosce meno di quanto c'è, mai di più. Quando ha la
        // voce il file c'era, e la domanda è già risposta senza toccare il
        // disco; il `stat` resta al solo caso in cui l'anagrafe tace, che è
        // esattamente la finestra del difetto. Il salvataggio di una nota che
        // si sta scrivendo non ci passa mai, ed è ciò che tiene ferma la 0179 —
        // «un salvataggio non torna a chiedere al disco cosa ha appena
        // scritto», che ha un banco che conta gli `stat` e li vuole zero.
        let (id, existed, from, expected_source) = match base {
            WriteBase::DescendsFrom(expected) => {
                // Un file che **non c'è** non è un errore da propagare: è una
                // base che non combacia — chi scrive credeva di riscrivere
                // qualcosa che nel frattempo è stato cestinato, e ha diritto
                // alla stessa risposta. Ogni **altro** guasto invece risale con
                // il suo tipo, ed è la differenza che vale la riga: con `.ok()`
                // chi non riusciva più a leggere la propria nota — permessi, un
                // disco che sta fallendo, byte che non sono più testo — si
                // sentiva dire «il documento è cambiato sotto di te», cioè un
                // fatto del vault che non era avvenuto, e un conflitto vero non
                // si distingueva da un supporto rotto.
                let current = crate::error::optional(self.docs.vault.read(id))?;
                let now = current.as_ref().map(|s| Revision::of(s));
                if !current
                    .as_deref()
                    .is_some_and(|source| expected.matches(source))
                {
                    return Err(KernelError::Stale(id.to_string()));
                }
                (id.clone(), true, now, current)
            }
            WriteBase::Dictated => {
                let in_store = self.indexes.core.entries.get(id);
                // An indexed, already-portable id is the ordinary save path:
                // the index is authoritative for that unchanged spelling, so
                // keep the no-stat fast path. Imported names that would be
                // changed or rejected by `new_doc_id` must ask the disk: a
                // stale index cannot prove that such a file still exists.
                let candidate = new_doc_id(id.as_str());
                let unchanged_portable =
                    in_store.is_some() && candidate.as_ref().is_ok_and(|candidate| candidate == id);
                // Su Windows un nome con spazio finale (`nota.md `) risolve
                // allo stesso file di `nota.md`: se si guarda prima il nome
                // grezzo, si conserva però l'estensione `md ` e il provider
                // non viene trovato. Il target normalizzato ha precedenza se è
                // l'unico esistente o se i due nomi indicano lo stesso file;
                // due file distinti conservano invece l'import non portabile.
                let normalized_exists = !unchanged_portable
                    && candidate.as_ref().is_ok_and(|candidate| {
                        candidate != id && self.docs.vault.stat(candidate).is_some()
                    });
                let raw_exists = !unchanged_portable && self.docs.vault.stat(id).is_some();
                let normalized_aliases_raw = normalized_exists
                    && raw_exists
                    && candidate
                        .as_ref()
                        .is_ok_and(|candidate| self.docs.vault.same_file(id, candidate));
                let use_normalized = normalized_exists && (!raw_exists || normalized_aliases_raw);
                let existed = unchanged_portable || normalized_exists || raw_exists;
                // A dictated write is also the path used by importers and
                // restores. Apply the stricter naming rule only when this
                // call is actually creating a new document: an imported file
                // may already have a name that is not portable to every OS,
                // and writing it back must preserve that existing name.
                if existed {
                    let id = if use_normalized {
                        candidate
                            .as_ref()
                            .expect("a normalized existing target")
                            .clone()
                    } else {
                        id.clone()
                    };
                    let in_store = self.indexes.core.entries.get(&id);
                    let fingerprint = in_store.and_then(|and| and.fingerprint.clone());
                    (id, true, fingerprint, None)
                } else {
                    let id = candidate?;
                    // `new_doc_id` may normalize the name (NFC and trimmed
                    // segments) onto a file that is already on disk.  The
                    // stale index is not evidence that this normalized target
                    // exists: only the storage stat can classify this write.
                    let in_store = self.indexes.core.entries.get(&id);
                    let fingerprint = in_store.and_then(|and| and.fingerprint.clone());
                    let existed = self.docs.vault.stat(&id).is_some();
                    (id, existed, existed.then_some(fingerprint).flatten(), None)
                }
            }
        };
        let parser = self.docs.prepare_parse(&id)?;
        Ok(PreparedDocumentWrite {
            id,
            existed,
            from,
            expected_source,
            parser,
            before_write: self.before_write.clone(),
            vault: self.docs.vault.clone(),
        })
    }

    /// Prepara una creazione senza attraversare parser o hook esterni.
    ///
    /// Il nome nasce in questa operazione, quindi applica anche la portabilità
    /// stretta e rifiuta una destinazione già occupata prima di restituire il
    /// token staccato.
    pub fn prepare_document_creation(&self, id: &DocId) -> Result<PreparedDocumentWrite> {
        let id = new_doc_id(id.as_str())?;
        if self.is_taken(&id) {
            return Err(KernelError::AlreadyExists(id.to_string()));
        }
        self.prepare_document_write(&id, WriteBase::Dictated)
    }

    /// Finalizza una scrittura già parsata e con il gancio già tornato, disco
    /// compreso: è [`PreparedDocumentWrite::place`] seguita da
    /// [`commit_placed_document_write`](Self::commit_placed_document_write),
    /// per chi tiene già il workspace intero (la via breve, i banchi). L'host
    /// le chiama separate, sotto il turno di scrittura, per non tenere il
    /// prestito esclusivo durante la scrittura sul disco.
    pub fn commit_document_write(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<PreparedDocumentFeed> {
        self.indexes.ensure_mutation_available()?;
        let placed = prepared.place(source, before_write)?;
        Ok(self.commit_placed_document_write(placed, model))
    }

    /// Porta nelle tabelle una scrittura **già posata sul disco**
    /// ([`PreparedDocumentWrite::place`]): anagrafe, indice centrale, journal
    /// e consegna agli indici. Non tocca il disco, quindi il prestito
    /// esclusivo che la chiama dura il tempo di aggiornare la memoria.
    ///
    /// Non ripete il controllo di rientro degli indici: l'ha fatto
    /// [`prepare_document_write`](Self::prepare_document_write) sullo stesso
    /// thread, e fallire qui lascerebbe sul disco un testo che le tabelle non
    /// conoscono.
    pub fn commit_placed_document_write(
        &mut self,
        placed: PlacedDocumentWrite,
        model: DocumentModel,
    ) -> PreparedDocumentFeed {
        let PlacedDocumentWrite {
            id,
            existed,
            from,
            revision,
            size,
            mtime,
        } = placed;
        let changes = self.indexes.core.changes_for(&model, &revision);
        self.set_entry(&id, size, mtime, Some(revision.clone()));
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
        PreparedDocumentFeed {
            id,
            model: Some(model),
            changes,
            revision,
            journal,
            providers,
            losses,
        }
    }

    /// Come `commit_document_write`, conservando però la semantica di journal
    /// dell'edit chirurgico invece di registrarlo come una scrittura generica.
    pub fn commit_document_edit(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
        before_write: std::result::Result<(), PluginError>,
        base: Revision,
        report: &EditReport,
    ) -> Result<PreparedDocumentFeed> {
        self.indexes.ensure_mutation_available()?;
        let placed = prepared.place(source, before_write)?;
        Ok(self.commit_placed_document_edit(placed, model, base, report))
    }

    /// Come [`commit_placed_document_write`](Self::commit_placed_document_write),
    /// con la semantica di journal dell'edit chirurgico.
    pub fn commit_placed_document_edit(
        &mut self,
        placed: PlacedDocumentWrite,
        model: DocumentModel,
        base: Revision,
        report: &EditReport,
    ) -> PreparedDocumentFeed {
        let mut pending = self.commit_placed_document_write(placed, model);
        pending.journal = JournalOp::Edited {
            doc: pending.id.clone(),
            from: base,
            to: pending.revision.clone(),
            footprint: crate::journal::EditFootprint::of(&report.applied),
        };
        pending
    }

    /// Chiude la fase indici senza consegnare eventi. Il journal resta nel
    /// token e verrà registrato solo dopo il drain staccato.
    pub fn finish_document_write_deferred(
        &mut self,
        pending: PreparedDocumentFeed,
    ) -> DeferredEvents<Revision> {
        let revision = pending.revision.clone();
        let journal = pending.journal.clone();
        self.finish_index_feed(pending);
        DeferredEvents {
            outcome: revision,
            previous_actor: None,
            journal: Some(journal),
        }
    }

    /// Finalizza gli indici di un edit staccato e consegna il report originale
    /// soltanto dopo il drain degli eventi.
    pub fn finish_document_edit_deferred(
        &mut self,
        pending: PreparedDocumentFeed,
        report: EditReport,
    ) -> DeferredEvents<EditReport> {
        let journal = pending.journal.clone();
        self.finish_index_feed(pending);
        DeferredEvents {
            outcome: report,
            previous_actor: None,
            journal: Some(journal),
        }
    }

    pub fn finalize_document_write(&mut self, pending: PreparedDocumentFeed) -> Result<Revision> {
        let deferred = self.finish_document_write_deferred(pending);
        self.dispatch_pending();
        Ok(self.finish_deferred_events(deferred))
    }

    pub fn finish_document_write(
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

    /// Pipeline RAW per allegati/binari/opachi: `None` = create-only atomico,
    /// `Some(expected)` = CAS raw atomica. Nessuna variante Dictated, nessun
    /// fallback UTF-8 verso il disco: BOM/CRLF/binari restano identici;
    /// `Revision` raw (`of_bytes`) e testuale NON sono intercambiabili.
    /// Il parse gira detached in `PreparedDocumentBytesWrite::parse` (mai
    /// provider sotto lock); il commit usa `write_if_unchanged` in un colpo
    /// solo. `model: None` = file opaco senza provider: anagrafe + `EntryChanged`,
    /// nessun `DocumentChanged` inventato. Un preflight fallito non chiama hook.
    pub fn prepare_document_bytes_write(
        &self,
        id: &DocId,
        expected: Option<Revision>,
    ) -> Result<PreparedDocumentBytesWrite> {
        self.indexes.ensure_mutation_available()?;
        let id = valid_doc_id(id.as_str())?;
        let (id, from, expected_bytes) = match expected {
            Some(want) => {
                let current = crate::error::optional(self.docs.vault.read_bytes(&id))?
                    .ok_or_else(|| KernelError::Stale(id.to_string()))?;
                let actual = Revision::of_bytes(&current);
                if want != actual {
                    return Err(KernelError::Stale(id.to_string()));
                }
                (id, Some(actual), Some(current))
            }
            None => {
                if self.is_taken(&id) {
                    return Err(KernelError::AlreadyExists(id.to_string()));
                }
                (new_doc_id(id.as_str())?, None, None)
            }
        };
        let path = self.docs.vault.path_for(&id)?;
        let parser = match self.docs.prepare_parse(&id) {
            Ok(parser) => Some(parser),
            Err(KernelError::NoProvider(_)) => None,
            Err(error) => return Err(error),
        };
        Ok(PreparedDocumentBytesWrite {
            id,
            path,
            from,
            expected_bytes,
            parser,
            before_write: self.before_write.clone(),
            storage: Arc::clone(self.docs.vault.storage()),
        })
    }

    /// Commit atomico raw: UNICA `write_if_unchanged(path, None|Some, bytes)` —
    /// `None` = create-only atomico (`Changed` => `AlreadyExists`), `Some` = CAS
    /// (`Changed` => `Stale`). Mai `exists` + `write`. Il modello arriva dal
    /// parse detached. È [`PreparedDocumentBytesWrite::place`] seguita da
    /// [`commit_placed_document_bytes_write`](Self::commit_placed_document_bytes_write),
    /// per chi tiene già il workspace intero; l'host le chiama separate.
    pub fn commit_document_bytes_write(
        &mut self,
        prepared: PreparedDocumentBytesWrite,
        bytes: &[u8],
        model: Option<DocumentModel>,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<PreparedDocumentFeed> {
        self.indexes.ensure_mutation_available()?;
        let placed = prepared.place(bytes, before_write)?;
        Ok(self.commit_placed_document_bytes_write(placed, model))
    }

    /// Porta nelle tabelle una scrittura a byte **già posata sul disco**:
    /// anagrafe, journal e feed, senza I/O. Vedi
    /// [`commit_placed_document_write`](Self::commit_placed_document_write).
    pub fn commit_placed_document_bytes_write(
        &mut self,
        placed: PlacedDocumentBytesWrite,
        model: Option<DocumentModel>,
    ) -> PreparedDocumentFeed {
        let PlacedDocumentBytesWrite {
            id,
            from,
            rewrote,
            revision,
            size,
            mtime,
        } = placed;
        let (changes, losses, providers) = match &model {
            Some(model) => (
                self.indexes.core.changes_for(model, &revision),
                self.indexes
                    .core
                    .on_documents_indexed(std::slice::from_ref(model)),
                self.indexes.feed_handles(),
            ),
            None => (DocChanges::default(), Vec::new(), Vec::new()),
        };
        self.set_entry(&id, size, mtime, Some(revision.clone()));
        let journal = if rewrote {
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
        PreparedDocumentFeed {
            id,
            model,
            changes,
            revision,
            journal,
            providers,
            losses,
        }
    }

    /// Via breve raw: prepara detached, parsa fuori lock, committa atomico,
    /// finalizza; su CAS fallita niente eventi.
    pub fn write_document_bytes(
        &mut self,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision> {
        let prepared = self.prepare_document_bytes_write(id, expected)?;
        let model = prepared.parse(bytes)?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut host = self.host_for(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut host)
        });
        let pending = self.commit_document_bytes_write(prepared, bytes, model, before_write)?;
        let pending = pending.invoke_indexes();
        self.finalize_document_write(pending)
    }

    /// Scrive la sorgente, riparsa il documento, aggiorna il grafo ed emette
    /// gli eventi (il grafo per-documento, [`GraphUpdate`]) — dicendo **da cosa
    /// si parte** (§18.1).
    ///
    /// Con [`WriteBase::DescendsFrom`] la revisione attesa è quella che chi
    /// scrive si aspetta di trovare sul disco: se non combacia si risponde
    /// [`KernelError::Stale`] e non si tocca niente. È la guardia che
    /// `apply_edit` ha dalla
    /// [0008](../../../docs/decisions/README.md) e che questa
    /// metà non aveva, cioè il buco per cui il salvataggio dell'editor
    /// **copriva** una scrittura altrui che il watcher non aveva visto.
    ///
    /// Con [`WriteBase::Dictated`] la guardia non c'è perché non ci sarebbe
    /// niente da guardare, ed è una **dichiarazione**: fino alla
    /// [0092](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md) esisteva
    /// anche una `write_document` a due argomenti, che voleva dire `Dictated`
    /// senza dirlo. Era la stessa trappola del contratto, in casa: due firme per
    /// la stessa domanda, di cui una cieca e più corta da scrivere.
    ///
    /// Il confronto è col **disco** e non con l'anagrafe, per la ragione di
    /// [`document_revision`](Workspace::document_revision): la verità di un
    /// documento è il file, e una guardia che si fidasse di una cache
    /// direbbe di sì proprio nel caso in cui la cache è indietro — che è
    /// esattamente il caso che deve prendere. La lettura in più si paga **solo**
    /// quando qualcuno la chiede: una scrittura dettata legge dalla memoria come
    /// prima, perché una riga di registro non vale una lettura a ogni
    /// salvataggio (§15.2).
    pub fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision> {
        let prepared = self.prepare_document_write(id, base)?;
        let model = prepared.parse(source)?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut host = self.host_for(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut host)
        });
        self.finish_document_write(prepared, source, model, before_write)
    }

    /// Il corpo di una scrittura, **senza la riga di registro**: parse, disco,
    /// coda di ogni scrittura, eventi. Rende la revisione prodotta.
    ///
    /// Esiste perché i tre chiamanti raccontano tre cose diverse al registro —
    /// un salvataggio, una modifica chirurgica, un ripristino dal cestino — e
    /// senza questa separazione ognuno ne avrebbe scritte **due**: la propria e
    /// quella di `write_document`, cioè una mutazione contata due volte in una
    /// lista che esiste per essere ripercorsa.
    pub(super) fn write_source(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
    ) -> Result<Revision> {
        self.indexes.ensure_mutation_available()?;
        // Il parse è puro: farlo PRIMA di scrivere tiene la mutazione atomica.
        // Nell'ordine inverso un parse fallito lascerebbe il disco avanti
        // rispetto a modelli/grafo/indici — e il chiamante riceverebbe `Err`
        // pur avendo scritto.
        let model = self.docs.parse(id, source)?;
        // Il gancio **prima della scrittura** (0154): fra il parse e il disco
        // l'originale è ancora leggibile, e chi ha registrato una chiusura
        // (la fotografia del versioning) la vuole guardare in questo istante.
        // Un suo errore ferma la scrittura: sovrascrivere senza che la
        // fotografia sia riuscita sarebbe la finestra che il meccanismo
        // esiste per chiudere. L'host è intestato al plugin che ha registrato
        // il gancio, in modalità `Apply` — e non è `with_host`, che in fondo
        // drenerebbe la coda delle scritture mentre siamo dentro una scrittura.
        let hooks = self.before_write.clone();
        for hook in before_write_calls(&hooks, id) {
            let mut host = self.host_for(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut host)
                .map_err(|and| Self::before_write_error(id, and))?;
        }
        self.write_source_parsed(id, source, expected_source, model)
    }

    pub(super) fn before_write_error(id: &DocId, and: PluginError) -> KernelError {
        match and {
            PluginError::Io(why) => KernelError::Io {
                path: id.to_string().into(),
                source: std::io::Error::other(why.to_string()),
            },
            other => KernelError::BadEdit {
                doc: id.to_string(),
                why: other.to_string(),
            },
        }
    }

    /// Seconda metà di `write_source`: parse e gancio sono già tornati. Da qui
    /// in poi restano soltanto storage/CAS, ingestione ed eventi.
    pub(super) fn write_source_parsed(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
        model: DocumentModel,
    ) -> Result<Revision> {
        self.indexes.ensure_mutation_available()?;
        // Dimensione e data arrivano dalla scrittura stessa: sono ciò che i byte
        // appena posati dicono di sé, e ripeterle al disco con una `stat` era il
        // difetto 0179.
        let placed = if let Some(expected) = expected_source {
            self.docs
                .vault
                .write_if_unchanged(id, expected, source)?
                .ok_or_else(|| KernelError::Stale(id.to_string()))?
        } else {
            self.docs.vault.write(id, source)?
        };
        let revision = Revision::of(source);
        self.ingest_model(id, model, revision.clone(), Some(placed));
        self.dispatch_pending();
        Ok(revision)
    }

    /// Scrive una riga nel registro delle mutazioni (§15.2).
    ///
    /// Si chiama **dopo** che la mutazione è riuscita, e l'ordine è la decisione
    /// ([0067](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)):
    /// un crash può far perdere la coda del registro — le ultime operazioni non
    /// si potranno annullare — e mai il contrario, una riga che racconta
    /// qualcosa che non è successo.
    ///
    /// L'esito non risale, come per l'anagrafe e per il sidecar del cestino: una
    /// scrittura riuscita non deve fallire perché il suo registro non si è
    /// scritto. A differenza dell'anagrafe però qui si **perde qualcosa** — un
    /// pezzo di ciò che è successo, che non si ricostruisce da niente — quindi
    /// non è un `warn` e basta: è un guasto che esce anche dal canale (0052,
    /// 0062), perché chi importa cinquecento note ha il diritto di sapere che
    /// quella riga non sarà annullabile.
    pub(super) fn record(&mut self, op: JournalOp) {
        let origin = self.dispatch.origin();
        if let Err(and) = self.journal.append(origin, op) {
            self.report_journal_failure(JournalFailure(and));
        }
    }

    /// Ciò che è successo a questo vault, e **cosa non si è potuto leggere**
    /// (§15.2).
    ///
    /// È la lettura del registro come sta sul disco, non una cache in memoria:
    /// sullo stesso file scrivono anche le altre installazioni aperte sulla
    /// stessa cartella, e una copia in memoria mostrerebbe solo le proprie
    /// righe.
    ///
    /// **Un registro che non si legge non è un registro vuoto** (§15.2): il
    /// file assente resta una `JournalRead` vuota, ogni altro guasto del supporto
    /// arriva qui come [`KernelError::Io`] col path che non si è potuto
    /// aprire.
    pub fn journal(&self) -> Result<JournalRead> {
        self.journal.read().map_err(|and| KernelError::Io {
            path: self.journal.path().to_owned(),
            source: and,
        })
    }

    /// Pota il registro alla finestra dichiarata (§23.9).
    ///
    /// Una funzione sola per i due momenti in cui la finestra si sa — la si è
    /// appena dichiarata, o l'utente l'ha appena cambiata — invece della stessa
    /// lettura scritta due volte: il giorno che se ne aggiunge un terzo, quel
    /// terzo la eredita.
    ///
    /// Una chiave che non c'è vale zero, cioè *per sempre*: è la regola di
    /// [`FieldWeights::read`](fub_features) applicata qui — un'impostazione che
    /// manca fa cadere nel default, non in un guasto — e per un registro
    /// autorevole il default che non perde niente è l'unico difendibile.
    pub(super) fn prunes_the_record(&self) {
        let days = match self.setting(crate::journal::RETENTION_DAYS) {
            Ok(SettingValue::Number(n)) if n > 0.0 => n as u64,
            _ => 0,
        };
        self.journal.prune(days);
    }

    // -----------------------------------------------------------------------
    // Le bozze (§15.2)
    // -----------------------------------------------------------------------
    //
    // Tre righe e non una capacità dell'`HostApi`, ed è una scelta: il testo
    // che l'utente non ha ancora salvato è il dato più privato che il vault
    // contenga, e una porta su `HostApi` lo consegnerebbe a **ogni** plugin
    // montato — compresi quelli che a M5 non scriviamo noi. Chi ha bisogno di
    // scriverci è la shell, che non è un plugin.

    /// Scrive la bozza di un documento: ciò che c'è nel buffer adesso.
    ///
    /// `base` è la revisione del file su cui il buffer sta lavorando (`None`
    /// per una nota mai salvata) e non si deduce qui di proposito: dedurla
    /// vorrebbe dire rileggere il file a ogni battuta, e per giunta darebbe la
    /// revisione di **adesso** invece di quella su cui l'utente stava
    /// scrivendo — cioè proprio l'informazione che serve per accorgersi che il
    /// file è cambiato sotto.
    pub fn save_draft(
        &mut self,
        doc: &DocId,
        text: &str,
        base: Option<Revision>,
    ) -> std::io::Result<()> {
        let at = self.now_unix_millis();
        self.drafts.save(doc, text, base, at)
    }

    /// Butta la bozza di un documento: il buffer è tornato pulito, o l'utente ha
    /// scelto di scartarla.
    pub fn discard_draft(&mut self, doc: &DocId) -> std::io::Result<()> {
        self.drafts.discard(doc)
    }

    /// La porta delle bozze staccata dal workspace: chi la tiene scrive e butta
    /// bozze senza prestito né turno di scrittura (#485), così una bozza non
    /// aspetta il salvataggio lento che deve coprire. Le mutazioni delle bozze
    /// restano in fila fra loro e con le migrazioni della rinomina.
    pub fn draft_port(&self) -> crate::drafts::DraftPort {
        crate::drafts::DraftPort::new(Arc::clone(&self.drafts), Arc::clone(&self.clock))
    }

    /// Le bozze di questo vault, **e quante non si sono lette**.
    ///
    /// Dal disco e non da una cache, per la ragione del registro: dopo un crash
    /// non c'è nessuna memoria da consultare, ed è l'unico momento in cui questa
    /// domanda conta davvero.
    ///
    /// E una cartella che **non si legge** non è una cartella senza bozze: là
    /// dentro c'è l'unica copia di ciò che l'utente ha scritto e non ha ancora
    /// salvato, quindi il guasto risale con il path invece di diventare un
    /// elenco vuoto.
    pub fn drafts(&self) -> Result<crate::drafts::DraftRead> {
        self.drafts.read().map_err(|and| KernelError::Io {
            path: self.drafts.dir().to_owned(),
            source: and,
        })
    }

    /// La revisione dei byte sorgente di un documento, anche senza un provider
    /// di formato: l'identità del testo su cui una modifica chirurgica va
    /// calcolata (decisione 0008).
    ///
    /// Si legge dal **disco**, come ogni altra lettura del kernel: la verità di
    /// un documento è il file, e una revisione derivata da una cache sarebbe
    /// vera solo finché la cache lo è.
    pub fn document_revision(&self, id: &DocId) -> Result<Revision> {
        self.docs.vault.fingerprint(id)
    }

    /// Applica una modifica chirurgica: gli edit della richiesta, tutti o
    /// nessuno, sul sorgente che la sua `base` nomina.
    ///
    /// È l'altra scrittura del kernel accanto a
    /// [`write_document`](Workspace::write_document), e la differenza non è di
    /// comodo: qui la firma dice **su cosa** la modifica è stata calcolata,
    /// quindi due scritture concorrenti non possono sovrascriversi in silenzio
    /// — la seconda trova una base che non combacia e fallisce
    /// ([`KernelError::Stale`]) senza toccare niente.
    ///
    /// Il resto è la coda di sempre: il testo nuovo passa da `write_document`,
    /// quindi parse prima del disco, indici, grafo ed eventi come qualunque
    /// altra modifica. Una richiesta **senza edit** non è una scrittura: non
    /// tocca il file e non emette eventi.
    pub fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport> {
        let source = self.read_source(id)?;
        let (next, report) = request.apply_to(&source).map_err(|and| match and {
            PluginError::Conflict(_) => KernelError::Stale(id.to_string()),
            other => KernelError::BadEdit {
                doc: id.to_string(),
                why: other.to_string(),
            },
        })?;
        if report.is_empty() {
            return Ok(report);
        }
        let from = request.base.clone();
        let to = self.write_source(id, &next, Some(&source))?;
        // Nel registro va l'**impronta** e non l'inverso: dove la modifica ha
        // toccato e quanto ha sostituito, mai con cosa (0103). Non è
        // `report.inverse()` a cui si toglie il testo — quella funzione qui non
        // si chiama affatto, così i byte dell'utente non passano nemmeno per una
        // variabile sulla strada del disco.
        self.record(JournalOp::Edited {
            doc: id.clone(),
            from,
            to,
            footprint: crate::journal::EditFootprint::of(&report.applied),
        });
        Ok(report)
    }

    /// Riparsa un documento già presente sul disco (usato dal file watcher).
    ///
    /// L'origine è [`Actor::Watcher`] (decisione 0012): questa modifica non è passata da
    /// noi, e chi la riceve — la shell col buffer aperto, un'automazione — deve
    /// poterla distinguere da una scrittura che ha chiesto lui.
    ///
    /// **Ciò che il kernel ha già in memoria non si riparsa**: risponde `false`
    /// e non emette niente, che è la verità — nessuno ha cambiato niente da
    /// quando lo si è letto l'ultima volta. Vedi
    /// [`already_ingested`](Workspace::already_ingested) per il perché.
    pub fn refresh_from_disk(&mut self, id: &DocId) -> Result<bool> {
        self.as_actor(Actor::Watcher, |ws| {
            let Some(src) = ws.source_if_stable(id)? else {
                // Il file sta ancora cambiando, o è sparito fra le due `stat`
                // (difetto 0197). Non è un fallimento: il debounce del
                // rilevatore riproverà, e ingerire la metà sarebbe il difetto.
                return Ok(false);
            };
            if ws.already_ingested(id, &Revision::of(&src)) {
                return Ok(false);
            }
            ws.ingest(id, &src)?;
            ws.dispatch_pending();
            Ok(true)
        })
    }
}
