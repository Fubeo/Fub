//! L'indicizzazione a lotti: controllo, parse e commit dei documenti, voci del vault.

use super::*;

/// Una fetta dell'apertura già letta e parsata, che aspetta di entrare nel workspace.
///
/// È il [`ParsedChange`] di un lotto invece che di un file, e il nome dice la
/// parentela apposta: la forma è la stessa della
/// [decisione 0119](../../../docs/decisions/README.md)
/// — leggere e parsare sotto prestito condiviso
/// ([`Workspace::plan_batch`]), mutare sotto quello esclusivo
/// ([`Workspace::index_batch_prepared`]) — su un percorso dove i file non sono
/// quattro ma quattromila.
///
/// I campi sono chiusi per la stessa ragione: chi ne tiene uno in mano ha per
/// forza già rilasciato il prestito condiviso, perché il tipo non ne porta con
/// sé nessun pezzo.
#[derive(Default)]
pub struct ParsedBatch {
    /// Le voci della fetta, con l'impronta che la lettura ha imparato e il
    /// file su cui l'ha imparata.
    pub(super) read: Vec<(VaultEntry, Option<FileWitness>)>,
    /// Ciò che si è ripreso dalla cache invece di riparsarlo.
    pub(super) reused: Vec<(DocId, StoredMeta)>,
    /// Ciò che si è letto e parsato.
    pub(super) models: Vec<DocumentModel>,
    /// **L'impronta che l'anagrafe attribuiva a ogni voce quando il piano è
    /// stato fatto.** Vedi [`Workspace::index_batch_prepared`].
    ///
    /// È per documento e non per fetta: fra il piano e l'applicazione l'utente
    /// salva *una* nota, e buttare le altre novecentonovantanove vorrebbe dire
    /// rileggerle dal disco per niente.
    pub(super) seen: BTreeMap<DocId, Option<Revision>>,
    /// I modelli già passati al core da una presa precedente della stessa
    /// fetta, con l'impronta che avevano in quel momento: gli indici dei
    /// provider li ricevono tutti insieme, quando la fetta finisce.
    pub(super) fed: Vec<(DocumentModel, Option<Revision>)>,
    pub(super) losses: Vec<IndexLoss>,
}

/// Dove è arrivata una fetta dopo una presa esclusiva a tempo: vedi
/// [`Workspace::commit_index_batch_within`].
pub enum IndexBatchStep {
    /// Applicata tutta al core: resta, se c'è, il feed per gli indici dei
    /// provider.
    Done(Option<PreparedIndexBatchFeed>),
    /// Il tempo è finito prima dei modelli: il resto della fetta, da
    /// riprendere con un'altra presa.
    More(ParsedBatch),
}

/// Per quanto una presa esclusiva applica i modelli di una fetta prima di
/// lasciare il workspace a chi aspetta. Un modello può costare millisecondi
/// (una nota che altre mille citano ri-collega tutte le mille), quindi il
/// tetto si guarda dopo ognuno e non a fine fetta: con 512 modelli per fetta,
/// una sola presa teneva fermo per più di un secondo chi apriva una nota.
pub const INDEX_WRITE_BUDGET: std::time::Duration = std::time::Duration::from_millis(5);

pub(super) struct PendingIndexEntry {
    pub(super) entry: VaultEntry,
    pub(super) source: Option<DocumentSource>,
    /// Il file letto per l'impronta, preso **prima** della lettura: un file
    /// messo al posto di quello letto dopo questo istante ha un altro
    /// testimone, e `store_entries` se ne accorge.
    pub(super) witness: Option<FileWitness>,
}

/// Il risultato di un pezzo di fetta lavorato da un thread: le voci della
/// fetta, con l'impronta che la lettura ha imparato, ma senza `seen` (che si
/// calcola una volta per tutta la fetta). Si fondono in
/// [`Workspace::prepare_index_batch_check`].
#[derive(Default)]
pub(super) struct IndexCheckChunk {
    pub(super) entries: Vec<PendingIndexEntry>,
    pub(super) discarded: Vec<(DocId, KernelError)>,
}

pub(super) struct PendingDocumentParse {
    pub(super) id: DocId,
    pub(super) parser: PreparedParse,
    pub(super) source: DocumentSource,
}

#[derive(Default)]
pub(super) struct IndexParseChunk {
    pub(super) models: Vec<DocumentModel>,
    pub(super) discarded: Vec<(DocId, KernelError)>,
}

/// Come il `Workspace` tiene aggiornato il grafo dopo una modifica.
///
/// L'incrementale è il percorso normale; il rebuild completo resta disponibile
/// come rete di sicurezza (e come oracolo nei test) finché non ci fidiamo
/// ciecamente dell'invalidazione — vedi `../../../docs/project/status.md`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum GraphUpdate {
    #[default]
    Incremental,
    FullRebuild,
}

/// Prima metà di una fetta d'apertura: impronte e fotografia dei provider,
/// senza callback esterne.
pub struct PreparedIndexBatchCheck {
    pub(super) seen: BTreeMap<DocId, Option<Revision>>,
    pub(super) entries: Vec<PendingIndexEntry>,
    pub(super) discarded: Vec<(DocId, KernelError)>,
    pub(super) providers: Vec<(String, SharedIndexProvider)>,
}

/// Risposta di `up_to_date` che non porta alcuna guardia del workspace.
pub struct CheckedIndexBatch {
    pub(super) seen: BTreeMap<DocId, Option<Revision>>,
    pub(super) entries: Vec<PendingIndexEntry>,
    pub(super) discarded: Vec<(DocId, KernelError)>,
    pub(super) already: BTreeSet<DocId>,
}

impl PreparedIndexBatchCheck {
    /// Attraversa il solo confine degli indici. Il chiamante deve aver già
    /// rilasciato qualunque guardia di `Custody<Workspace>`.
    pub fn invoke(self) -> CheckedIndexBatch {
        let PreparedIndexBatchCheck {
            seen,
            entries,
            discarded,
            providers,
        } = self;
        let documents: Vec<VaultEntry> = entries
            .iter()
            .filter(|pending| pending.entry.kind == EntryKind::Document)
            .map(|pending| pending.entry.clone())
            .collect();
        // **La domanda agli indici è per fetta**, come lo è l'alimentazione. Un
        // indice che risponde `up_to_date` guardando ciò che ha non cambia
        // risposta perché gliela si chiede in dieci volte; chiederla una volta
        // sola vorrebbe dire tenere in mano l'elenco intero prima di alimentare
        // il primo documento, che è esattamente ciò che questa voce toglie.
        let mut already = up_to_date_index_handles(&providers, &documents);
        if release_index_handles(providers).is_err() {
            already.clear();
        }
        CheckedIndexBatch {
            seen,
            entries,
            discarded,
            already,
        }
    }
}

/// Seconda metà preparata della fetta: parser e sorgenti risolti, ma nessun
/// `FormatProvider` o `SyntaxRule` ancora eseguito.
pub struct PreparedIndexBatchParse {
    pub(super) read: Vec<(VaultEntry, Option<FileWitness>)>,
    pub(super) reused: Vec<(DocId, StoredMeta)>,
    pub(super) parses: Vec<PendingDocumentParse>,
    pub(super) discarded: Vec<(DocId, KernelError)>,
    pub(super) seen: BTreeMap<DocId, Option<Revision>>,
}

impl PreparedIndexBatchParse {
    /// Esegue soltanto parse e regole sintattiche. Gli scarti aggiornano
    /// `Indexing`, che vive fuori dal workspace.
    pub fn invoke(self, work: &mut Indexing) -> ParsedBatch {
        let PreparedIndexBatchParse {
            read,
            reused,
            parses,
            mut discarded,
            seen,
        } = self;

        let n = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .clamp(1, 8);
        let chunks: Vec<IndexParseChunk> = if n > 1 && parses.len() > n {
            let mut buckets: Vec<Vec<PendingDocumentParse>> = (0..n).map(|_| Vec::new()).collect();
            for (at, pending) in parses.into_iter().enumerate() {
                buckets[at % n].push(pending);
            }
            std::thread::scope(|scope| {
                let handles: Vec<_> = buckets
                    .into_iter()
                    .filter(|bucket| !bucket.is_empty())
                    .map(|bucket| scope.spawn(move || Workspace::invoke_parse_chunk(bucket)))
                    .collect();
                handles
                    .into_iter()
                    .map(|handle| handle.join().expect("il parser non esce dal recinto"))
                    .collect()
            })
        } else {
            vec![Workspace::invoke_parse_chunk(parses)]
        };

        let mut models = Vec::new();
        for chunk in chunks {
            models.extend(chunk.models);
            discarded.extend(chunk.discarded);
        }
        for (id, why) in discarded {
            work.opening.discards(id, why);
        }
        ParsedBatch {
            read,
            reused,
            models,
            seen,
            fed: Vec::new(),
            losses: Vec::new(),
        }
    }
}

/// Chiusura dell'indicizzazione preparata: grafo, insieme completo e handle dei
/// provider attraversano il confine senza portarsi dietro il `Workspace`.
pub struct PreparedIndexFinish {
    pub(super) work: Indexing,
    pub(super) graph: BuiltGraph,
    pub(super) ids: Vec<DocId>,
    /// I documenti di cui ritirare le dichiarazioni, se l'apertura si è
    /// interrotta ([`Workspace::withdrawn_ids`]); vuoto se è finita.
    pub(super) withdrawn: Vec<DocId>,
    pub(super) providers: Vec<(String, SharedIndexProvider)>,
}

pub struct CompletedIndexFinish {
    pub(super) work: Indexing,
    pub(super) graph: BuiltGraph,
    pub(super) external_losses: Vec<IndexLoss>,
}

impl PreparedIndexFinish {
    pub fn invoke(self) -> CompletedIndexFinish {
        let PreparedIndexFinish {
            work,
            graph,
            ids,
            withdrawn,
            providers,
        } = self;
        let mut external_losses = if work.finished() {
            reconcile_index_handles(&providers, &ids)
        } else {
            withdraw_index_handles(&providers, &withdrawn);
            Vec::new()
        };
        if let Err(error) = release_index_handles(providers) {
            if let Some(id) = ids.into_iter().next() {
                external_losses.push(IndexLoss::new(id, error));
            }
        }
        CompletedIndexFinish {
            work,
            graph,
            external_losses,
        }
    }
}

pub struct PreparedIndexBatchFeed {
    pub(super) models: Vec<DocumentModel>,
    pub(super) providers: Vec<(String, SharedIndexProvider)>,
    pub(super) losses: Vec<IndexLoss>,
}

impl PreparedIndexBatchFeed {
    pub fn invoke_indexes(mut self) -> Self {
        let providers = std::mem::take(&mut self.providers);
        self.losses
            .extend(feed_index_handles(&providers, &self.models));
        if let Err(error) = release_index_handles(providers) {
            self.losses.extend(
                self.models
                    .iter()
                    .map(|model| IndexLoss::new(model.id.clone(), error.clone())),
            );
        }
        self
    }
}

impl Workspace {
    /// **La metà di una fetta che non ha bisogno del prestito esclusivo**:
    /// legge dal disco e parsa fino a [`FEED_BATCH`] documenti, sotto `&self`.
    ///
    /// È la regola della
    /// [decisione 0119](../../../docs/decisions/README.md)
    /// sul suo secondo sito, che quella voce aveva già nominato: la stessa forma
    /// del lotto del watcher, sul percorso dove i file da leggere non sono
    /// quattro ma quattromila. Chi guarda il vault appena aperto — la ricerca,
    /// l'albero, l'autocompletamento — non ha niente a che fare con l'I/O di una
    /// fetta, e prima di questa riga la aspettava tutta.
    ///
    /// Il cursore avanza **qui**, perché è qui che la fetta si prende in carico:
    /// l'[`Indicizzazione`] vive fuori dal workspace, quindi avanzarla non vuole
    /// nessun prestito. E siccome `work` è un `&mut`, due piani sulla stessa
    /// indicizzazione non compilano — l'ordine delle fette lo dice il tipo, come
    /// nella 0119 lo diceva `ExternalSync::batch`.
    pub fn plan_batch(&self, work: &mut Indexing) -> ParsedBatch {
        let checked = self.prepare_index_batch_check(work).invoke();
        self.prepare_index_batch_parse(checked).invoke(work)
    }

    /// Legge soltanto ciò che serve a determinare le impronte della prossima
    /// fetta e cattura gli handle degli indici. Nessuna callback esterna gira
    /// sotto il prestito condiviso del workspace.
    pub fn prepare_index_batch_check(&self, work: &mut Indexing) -> PreparedIndexBatchCheck {
        let slice = work.next_slice();
        // L'impronta che l'anagrafe dà a ogni voce **adesso**: è ciò che il
        // piano si porta dietro per accorgersi di essere invecchiato (0119).
        // Si calcola una volta per tutta la fetta, prima del lavoro parallelo.
        let seen: BTreeMap<DocId, Option<Revision>> = slice
            .iter()
            .map(|entry| (entry.id.clone(), self.entry_fingerprint(&entry.id)))
            .collect();
        if slice.is_empty() {
            return PreparedIndexBatchCheck {
                seen,
                entries: Vec::new(),
                discarded: Vec::new(),
                providers: self.indexes.feed_handles(),
            };
        }

        // Lo span copre il lavoro parallelo di lettura della fetta,
        // `thread::scope` compreso: è ciò che il banco dell'apertura legge per
        // vedere se le fette scalano davvero (§25.3).
        let _phase = tracing::info_span!(target: "fub.apertura", "plan_batch").entered();
        // La fetta si lavora in parallelo quando ci sono abbastanza documenti
        // da ripagare i thread: su un vault da 30k file la prima apertura
        // legge e parsa ogni documento, e farlo in un thread solo la rende
        // seriale. `thread::scope` presta `docs` ai figli — è `Sync` — e li
        // aspetta prima di restituire. Gli handle si raccolgono **tutti** prima
        // di joinare: `map(spawn).map(join)` è pigro, e joinerebbe un thread
        // alla volta.
        let n = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .clamp(1, 8);
        let docs = &self.docs;
        let chunks: Vec<IndexCheckChunk> = if n > 1 && slice.len() > n {
            let size = slice.len().div_ceil(n);
            std::thread::scope(|scope| {
                let handles: Vec<_> = slice
                    .chunks(size)
                    .map(|chunk| {
                        let chunk = chunk.to_vec();
                        scope.spawn(move || Self::prepare_index_check_chunk(docs, chunk))
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|handle| handle.join().expect("la lettura non esce dal recinto"))
                    .collect()
            })
        } else {
            vec![Self::prepare_index_check_chunk(docs, slice)]
        };

        let mut entries = Vec::new();
        let mut discarded = Vec::new();
        for chunk in chunks {
            entries.extend(chunk.entries);
            discarded.extend(chunk.discarded);
        }
        PreparedIndexBatchCheck {
            seen,
            entries,
            discarded,
            providers: self.indexes.feed_handles(),
        }
    }

    /// Il lavoro di un pezzo di fetta: lettura e impronta. Ogni pezzo è
    /// indipendente e può girare in un `thread::scope`.
    pub(super) fn prepare_index_check_chunk(
        docs: &DocumentStore,
        entries: Vec<VaultEntry>,
    ) -> IndexCheckChunk {
        let mut out = IndexCheckChunk::default();
        // Ciò che non si sa lo si legge, e leggendolo se ne prende l'impronta:
        // dopo un `git checkout` che ha ritimbrato mille file senza cambiarne
        // uno, la data non combacia ma il contenuto sì — e chi tiene l'impronta
        // (l'anagrafe, e chi risponde alla domanda di `up_to_date`) li riconosce
        // tutti e mille.
        //
        // **Si legge nella forma che il provider ha dichiarato** (§21.8): un
        // documento rivendicato a byte non passa da una decodifica UTF-8 che
        // fallirebbe, e la sua impronta si prende sui byte — che per una
        // sorgente di testo è lo stesso numero di prima.
        for mut entry in entries {
            let mut source = None;
            let mut witness = None;
            if entry.fingerprint.is_none()
                && matches!(entry.kind, EntryKind::Asset | EntryKind::Document)
            {
                witness = Some(FileWitness::of(&docs.vault, &entry.id));
            }
            match entry.kind {
                EntryKind::Asset if entry.fingerprint.is_none() => {
                    match docs.vault.fingerprint(&entry.id) {
                        Ok(revision) => entry.fingerprint = Some(revision),
                        Err(why) => out.discarded.push((entry.id.clone(), why)),
                    }
                }
                EntryKind::Document if entry.fingerprint.is_none() => {
                    match docs.source_from_disk(&entry.id) {
                        Ok(read) => {
                            entry.fingerprint = Some(Revision::of_bytes(read.bytes()));
                            source = Some(read);
                        }
                        Err(why) => {
                            // Un documento che non si legge come sorgente, troppo
                            // grande o non UTF-8, resta un file: l'impronta dei
                            // suoi byte è ciò con cui una rinomina verifica di
                            // spostare lo stesso file, come per un allegato.
                            entry.fingerprint = docs.vault.fingerprint(&entry.id).ok();
                            out.discarded.push((entry.id.clone(), why));
                        }
                    }
                }
                _ => {}
            }
            out.entries.push(PendingIndexEntry {
                entry,
                source,
                witness,
            });
        }
        out
    }

    /// Risolve cache e parser dopo che `up_to_date` è tornato. Leggere il
    /// sorgente resta sotto un prestito condiviso breve; il parser preparato lo
    /// attraverserà soltanto dopo il rilascio della guardia.
    pub fn prepare_index_batch_parse(&self, checked: CheckedIndexBatch) -> PreparedIndexBatchParse {
        let CheckedIndexBatch {
            seen,
            entries,
            mut discarded,
            already,
        } = checked;
        let discarded_ids: BTreeSet<DocId> = discarded.iter().map(|(id, _)| id.clone()).collect();
        let mut read = Vec::with_capacity(entries.len());
        let mut reused = Vec::new();
        let mut parses = Vec::new();

        for pending in entries {
            let PendingIndexEntry {
                entry,
                source,
                witness,
            } = pending;
            read.push((entry.clone(), witness));
            if discarded_ids.contains(&entry.id) || entry.kind != EntryKind::Document {
                continue;
            }
            let remembered = self
                .entry_store
                .known(&entry.id)
                .filter(|known| known.fingerprint == entry.fingerprint)
                .and_then(|known| known.metadata.clone());
            if let Some(metadata) = remembered.filter(|_| already.contains(&entry.id)) {
                reused.push((entry.id.clone(), metadata));
                continue;
            }
            let source = match source {
                Some(source) => source,
                None => match self.docs.source_from_disk(&entry.id) {
                    Ok(source) => source,
                    Err(why) => {
                        discarded.push((entry.id.clone(), why));
                        continue;
                    }
                },
            };
            let ext = extension_of(&entry.id).unwrap_or_default();
            if self.docs.registry.provider_for_ext(&ext).is_none() {
                continue;
            }
            match self.docs.prepare_parse(&entry.id) {
                Ok(parser) => parses.push(PendingDocumentParse {
                    id: entry.id,
                    parser,
                    source,
                }),
                Err(why) => discarded.push((entry.id, why)),
            }
        }

        PreparedIndexBatchParse {
            read,
            reused,
            parses,
            discarded,
            seen,
        }
    }

    pub(super) fn invoke_parse_chunk(parses: Vec<PendingDocumentParse>) -> IndexParseChunk {
        let mut out = IndexParseChunk::default();
        for pending in parses {
            match pending.parser.invoke(pending.source) {
                Ok(model) => out.models.push(model),
                Err(why) => out.discarded.push((pending.id, why)),
            }
        }
        out
    }

    /// L'applicazione di una fetta, con il lavoro di lettura **già fatto** da
    /// [`plan_batch`](Workspace::plan_batch).
    ///
    /// **Il piano dichiara cosa credeva di sapere, e chi applica lo verifica**
    /// (0119). Fra la fase condivisa e questa il prestito esclusivo passa di
    /// mano, e un'apertura dura secondi: in mezzo ci sta comodo un salvataggio
    /// dell'utente, che il vault è utilizzabile da quando la scansione è finita.
    /// Applicare qui un modello parsato *prima* di quella scrittura la
    /// cancellerebbe dalla memoria del kernel — sul disco resta, in anagrafe e
    /// negli indici no, e non se ne accorge nessuno fino alla riapertura.
    ///
    /// Il confronto è sull'impronta che l'anagrafe dà al documento, ed è la
    /// stessa di [`sync_path_prepared`](Workspace::sync_path_prepared): ogni
    /// scrittura che passa dal kernel la alza (`touch_entry`), quindi «l'impronta
    /// è un'altra» vuol dire esattamente «qualcuno ha scritto mentre leggevo».
    /// Non è mtime+size: quelli bastano a *saltare* un file, non a credergli
    /// (§14.1).
    ///
    /// Un documento invecchiato si **butta e basta**, senza rifare la strada:
    /// chi ha scritto in mezzo lo ha già parsato, alimentato agli indici e messo
    /// in anagrafe con l'impronta giusta. Rileggerlo dal disco vorrebbe dire
    /// rifare il lavoro di qualcun altro per arrivare al suo stesso risultato —
    /// ed è la differenza con la 0119, dove il piano buttato era l'unica notizia
    /// che quel file fosse cambiato.
    pub fn commit_index_batch_prepared(
        &mut self,
        prepared: ParsedBatch,
    ) -> Option<PreparedIndexBatchFeed> {
        let mut step = self.commit_index_batch_within(prepared, std::time::Duration::MAX);
        loop {
            match step {
                IndexBatchStep::Done(feed) => return feed,
                IndexBatchStep::More(rest) => {
                    step = self.commit_index_batch_within(rest, std::time::Duration::MAX);
                }
            }
        }
    }

    /// [`commit_index_batch_prepared`](Workspace::commit_index_batch_prepared)
    /// a tempo: applica al core un modello dopo l'altro finché non è passato
    /// `budget`, e rende il resto della fetta.
    ///
    /// Fra due prese il workspace è di chi aspetta, anche di chi scrive. Il
    /// resto porta quindi l'impronta che ogni documento ha **adesso**, e la
    /// presa successiva rifà il confronto: una nota salvata in mezzo si butta
    /// come quella salvata fra il piano e la prima presa. Lo stesso vale per i
    /// modelli già dati al core: alla fine, quelli la cui impronta è cambiata
    /// non vanno agli indici dei provider, che dalla scrittura hanno già avuto
    /// la versione nuova.
    pub fn commit_index_batch_within(
        &mut self,
        prepared: ParsedBatch,
        budget: std::time::Duration,
    ) -> IndexBatchStep {
        let started = std::time::Instant::now();
        let ParsedBatch {
            read,
            reused,
            models,
            seen,
            mut fed,
            mut losses,
        } = prepared;
        let aged: BTreeSet<DocId> = seen
            .into_iter()
            .filter(|(id, expected)| self.entry_fingerprint(id) != *expected)
            .map(|(id, _)| id)
            .collect();

        for (entry, witness) in read {
            // L'impronta appena calcolata torna in anagrafe: la voce c'era già
            // dalla prima fase, quello che qui si aggiunge è ciò che si è
            // imparato leggendola, e su quale file.
            if entry.fingerprint.is_some() && !aged.contains(&entry.id) {
                let id = entry.id.clone();
                self.indexes.core.set_entry_from_scan(entry);
                if let Some(witness) = witness {
                    self.indexes.core.remember_read_on(&id, witness);
                }
            }
        }
        for (id, metadata) in reused {
            if aged.contains(&id) {
                continue;
            }
            self.indexes.core.restore(&id, metadata);
        }

        // **Il kernel taglia** (§20.1): la fetta di lavoro è già grande quanto
        // il lotto di alimentazione, quindi qui non si taglia una seconda
        // volta per i provider. Il core invece la prende a pezzi, un modello
        // alla volta, finché dura `budget`.
        let mut models = models.into_iter().filter(|model| !aged.contains(&model.id));
        for model in models.by_ref() {
            losses.extend(
                self.indexes
                    .core
                    .on_documents_indexed(std::slice::from_ref(&model)),
            );
            let fingerprint = self.entry_fingerprint(&model.id);
            fed.push((model, fingerprint));
            if started.elapsed() >= budget {
                break;
            }
        }
        let rest: Vec<DocumentModel> = models.collect();
        if !rest.is_empty() {
            let seen = rest
                .iter()
                .map(|model| (model.id.clone(), self.entry_fingerprint(&model.id)))
                .collect();
            return IndexBatchStep::More(ParsedBatch {
                read: Vec::new(),
                reused: Vec::new(),
                models: rest,
                seen,
                fed,
                losses,
            });
        }

        // I modelli interi vivono solo nel feed preparato qui, il tempo di
        // alimentare indici e conteggi: in cache restano i metadati.
        //
        // **Una fetta senza modelli non attraversa il confine** (§17.1,
        // decisione 0113): è il caso normale di una riapertura a caldo, dove
        // ogni documento è stato ripreso dalla cache, e un lotto vuoto non
        // porta nessuna notizia a nessuno — a M5 sarebbe una serializzazione
        // per dire niente. Lo ha trovato il banco contando le chiamate: nessun
        // altro presidio le conta.
        let models: Vec<DocumentModel> = fed
            .into_iter()
            .filter(|(model, fingerprint)| self.entry_fingerprint(&model.id) == *fingerprint)
            .map(|(model, _)| model)
            .collect();
        if models.is_empty() {
            return IndexBatchStep::Done(None);
        }
        let providers = self.indexes.feed_handles();
        IndexBatchStep::Done(Some(PreparedIndexBatchFeed {
            models,
            providers,
            losses,
        }))
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

    /// Fotografia di ciò che il grafo legge. Costa O(documenti) di **copia**
    /// (id, alias, link), e tiene il prestito condiviso solo per quella copia:
    /// [`GraphSources::build`] gira dopo, senza lucchetto
    /// ([0024](../../../docs/decisions/README.md)).
    ///
    /// Chi ha i thread la chiama sotto prestito condiviso, poi costruisce, poi
    /// consegna il risultato a [`finish_index_with_graph`].
    pub fn graph_sources(&self) -> GraphSources {
        let _phase = tracing::info_span!(target: "fub.apertura", "graph_sources").entered();
        GraphSources::from_docs(
            self.indexes.core.metas.values(),
            self.indexes.core.graph_epoch,
            self.indexes.core.graph.prose().clone(),
        )
    }

    /// **La chiusura dell'apertura** (§15.7): il grafo, la riconciliazione, e i
    /// guasti di ciò che non si è letto.
    ///
    /// Si chiama sia su un'indicizzazione arrivata in fondo sia su una
    /// **interrotta**, e la differenza sta in una riga sola — chi ha smesso a
    /// metà non riconcilia. Il resto si fa comunque: ciò che è stato
    /// alimentato è buono, e buttarlo perché non è tutto vorrebbe dire che
    /// annullare costa più che non aver cominciato.
    ///
    /// Il grafo si ricostruisce **qui** quando chi chiama ha già il prestito
    /// esclusivo in mano (`reindex`, i test). Chi ha i thread usa
    /// [`finish_index_with_graph`]: a caldo `restore` non tocca il grafo, e
    /// rifarlo sotto esclusivo congelerebbe l'UI per tutto il vault
    /// (`a_reopening_a_warm_has_the_same_graph_of_a_a_cold`).
    ///
    /// Il flush degli indici è una **fase sua** (difetto 0113): sta qui solo
    /// perché questo percorso è sincrono e chi chiama tiene già il prestito
    /// esclusivo — non c'è concorrenza da servire. Chi ha i thread la fa
    /// seguire a [`finish_index_with_graph`] in un prestito esclusivo
    /// separato, come la terza fase di `ExternalSync::batch`: fra la chiusura
    /// dell'indicizzazione e la durevolezza il lucchetto si rilascia, e i
    /// lettori in coda passano.
    pub fn finish_index(&mut self, work: Indexing) -> Opening {
        let _phase = tracing::info_span!(target: "fub.apertura", "finish_index").entered();
        self.indexes.core.rebuild_graph();
        let ids = self.reconcile_ids(&work);
        let external_losses = if work.finished() {
            reconcile_index_handles(&self.indexes.feed_handles(), &ids)
        } else {
            withdraw_index_handles(&self.indexes.feed_handles(), &self.withdrawn_ids(&work));
            Vec::new()
        };
        let (opening, _) = self.close_indexing(work, external_losses, false);
        // Gli errori di flush non fanno fallire l'apertura del vault: un
        // indice è stato derivato, il vault è la verità (M4: notifica).
        {
            let _phase = tracing::info_span!(target: "fub.apertura", "flush_indexes").entered();
            let _ = self.flush_indexes();
        }
        self.store_entries();
        opening
    }

    /// Prepara la chiusura senza eseguire provider. Il turno di scrittura può
    /// restare aperto mentre la guardia del workspace viene rilasciata.
    pub fn prepare_finish_index_with_graph(
        &self,
        work: Indexing,
        graph: BuiltGraph,
    ) -> PreparedIndexFinish {
        let ids = self.reconcile_ids(&work);
        let withdrawn = self.withdrawn_ids(&work);
        PreparedIndexFinish {
            work,
            graph,
            ids,
            withdrawn,
            providers: self.indexes.feed_handles(),
        }
    }

    /// Installa grafo e stato soltanto dopo che `reconcile` dei provider è
    /// tornato. Questa fase non attraversa codice esterno.
    pub fn finalize_finish_index(&mut self, completed: CompletedIndexFinish) -> Opening {
        self.finalize_finish_index_with(completed, false).0
    }

    /// Come [`finalize_finish_index`](Self::finalize_finish_index), ma i dati
    /// delle rinomine fatte ad app chiusa **non** si spostano qui: tornano in
    /// un [`PendingRejoin`] che chi chiama esegue dopo aver lasciato il
    /// prestito esclusivo, sotto lo stesso turno, e consegna poi a
    /// [`finish_rejoin`](Self::finish_rejoin). Gli eventi `DocumentRenamed`
    /// escono lì, dopo i dati spostati.
    pub fn finalize_finish_index_detached(
        &mut self,
        completed: CompletedIndexFinish,
    ) -> (Opening, PendingRejoin) {
        self.finalize_finish_index_with(completed, true)
    }

    pub(super) fn finalize_finish_index_with(
        &mut self,
        completed: CompletedIndexFinish,
        detach_rejoin: bool,
    ) -> (Opening, PendingRejoin) {
        let CompletedIndexFinish {
            work,
            graph,
            external_losses,
        } = completed;
        if graph.epoch == self.indexes.core.graph_epoch {
            self.indexes.core.graph = graph.graph;
        } else {
            self.indexes.core.rebuild_graph();
        }
        self.close_indexing(work, external_losses, detach_rejoin)
    }

    /// Come [`finish_index`], col grafo già costruito fuori dal prestito
    /// esclusivo. Se l'epoca non coincide — una scrittura è arrivata in mezzo —
    /// lo ricostruisce qui dai metadati correnti.
    ///
    /// Il flush degli indici non sta qui (difetto 0113): è una fase sua, con
    /// un prestito esclusivo proprio, e chi ha i thread la fa seguire a questa
    /// funzione — fra i due prestiti il lucchetto si rilascia e i lettori in
    /// coda passano, come nella terza fase di `ExternalSync::batch`.
    pub fn finish_index_with_graph(&mut self, work: Indexing, graph: BuiltGraph) -> Opening {
        let completed = self.prepare_finish_index_with_graph(work, graph).invoke();
        self.finalize_finish_index(completed)
    }

    pub(super) fn reconcile_ids(&self, work: &Indexing) -> Vec<DocId> {
        if !work.finished() {
            return Vec::new();
        }
        let mut ids: Vec<DocId> = self.documents();
        ids.extend(
            work.opening
                .discarded
                .iter()
                .map(|discard| discard.id.clone()),
        );
        ids.sort();
        ids.dedup();
        ids
    }

    /// I documenti a cui un'apertura interrotta può aver lasciato una
    /// dichiarazione di revisione in volo: tutti quelli che la scansione ha
    /// chiesto agli indici, cioè i documenti già in memoria (anche quelli
    /// saltati perché ogni indice li aveva) e quelli ancora da esaminare.
    /// Vuoto per un'apertura finita: lì chiude `reconcile`.
    ///
    /// Comprende **anche le note consegnate**, ed è voluto: il ritiro toglie
    /// solo la dichiarazione in volo, mai ciò che un indice tiene, e una nota
    /// consegnata la sua dichiarazione l'ha già spesa, quindi per lei il ritiro
    /// non cambia niente e la prossima apertura non rilegge di più. Restringere
    /// l'elenco alle non consegnate vorrebbe dire tenere il conto di ogni
    /// consegna per non risparmiare nulla.
    pub(super) fn withdrawn_ids(&self, work: &Indexing) -> Vec<DocId> {
        if work.finished() {
            return Vec::new();
        }
        let mut ids: Vec<DocId> = self.documents();
        ids.extend(
            work.from_do
                .iter()
                .filter(|entry| entry.kind == EntryKind::Document)
                .map(|entry| entry.id.clone()),
        );
        ids.sort();
        ids.dedup();
        ids
    }

    pub(super) fn close_indexing(
        &mut self,
        work: Indexing,
        external_losses: Vec<IndexLoss>,
        detach_rejoin: bool,
    ) -> (Opening, PendingRejoin) {
        let mut opening = work.opening;
        if work.cursor >= work.from_do.len() {
            // **Gli scarti entrano nell'insieme completo**, e non è un
            // dettaglio. `reconcile` dice agli indici *quali documenti
            // esistono*, così ognuno cancella ciò che è sparito ad app chiusa;
            // un documento che non si è potuto leggere **non è sparito** — il
            // file c'è, è la vista sul suo contenuto che manca. Ometterlo
            // direbbe agli indici una cosa falsa, e alla prima apertura con un
            // permesso storto la nota uscirebbe dalla ricerca in silenzio.
            let mut ids: Vec<DocId> = self.documents();
            ids.extend(opening.discarded.iter().map(|discard| discard.id.clone()));
            ids.sort();
            ids.dedup();
            let mut lost = {
                let _phase = tracing::info_span!(target: "fub.apertura", "reconcile").entered();
                self.indexes.core.reconcile(&ids)
            };
            lost.extend(external_losses);
            self.report_losses(lost);
        } else {
            // **Un'indicizzazione interrotta non riconcilia**, ed è la stessa
            // riga con cui la 0068 tiene fatale la scansione: un insieme
            // incompleto non si dichiara completo. Qui l'insieme non è bucato
            // da un permesso ma da un pulsante, e la conseguenza sarebbe la
            // stessa e peggiore — dire a ogni indice di dimenticare tutto ciò
            // che l'annullamento non ha fatto in tempo a nominare, cioè
            // trasformare «ho smesso di indicizzare» in «cancella».
            opening.interrupted = true;
        }
        self.indexes.core.watch.indexing = if opening.interrupted {
            IndexingState::Stopped
        } else {
            IndexingState::Ready
        };
        // **Il flush non sta qui** (difetto 0113): è una fase sua, con un
        // prestito esclusivo proprio, come la terza fase di `ExternalSync::batch`.
        // Qui dentro restano le fasi che toccano lo stato condiviso — la
        // riconciliazione delle tabelle degli indici, il ricongiungimento delle
        // rinomine che cammina l'anagrafe, gli eventi — e chi chiama
        // (`finish_index`, il runner) fa seguire il flush da sé, fra un prestito
        // e l'altro: un lettore concorrente non aspetta la somma delle fasi ma
        // la sola che sta correndo.

        // **Prima si riconosce, poi si raccoglie** (§23.1), e l'ordine è tutto:
        // ciò che una rinomina fatta ad app chiusa ha lasciato sotto il nome
        // vecchio, per la raccolta è indistinguibile da ciò che è rimasto di una
        // nota cancellata. Invertire le due righe vorrebbe dire cancellare i
        // dati un istante prima di sapere di chi sono.
        //
        // Solo se l'apertura è arrivata in fondo: da un'anagrafe parziale
        // «sparito» e «non ancora guardato» sono la stessa cosa.
        let mut rejoined = Vec::new();
        if !opening.interrupted {
            let (pairs, suspended) = {
                let _phase = tracing::info_span!(target: "fub.apertura", "rejoin").entered();
                self.rejoin_renamed_while_closed()
            };
            self.suspended_from_rejoin = suspended;
            if detach_rejoin {
                rejoined = pairs;
            } else {
                self.rejoin_now(pairs);
            }
        }

        self.as_actor(Actor::Kernel, |ws| {
            // I guasti erano nello stesso lotto di `VaultOpened`, perché chi si
            // abbonava per disegnare il vault appena aperto avesse già in mano
            // ciò che di quel vault non si era letto. Con le fasi quel lotto
            // non esiste più — gli scarti si scoprono *dopo* che il vault è
            // aperto, per definizione — e la promessa che resta è più debole e
            // vera: chi disegna un albero lo disegna intero, e ciò che di quei
            // documenti non si è potuto leggere arriva mentre l'indicizzazione
            // procede, sulla stessa superficie di prima (`Event::Trouble`).
            for discard in &opening.discarded {
                ws.report_trouble(
                    Severity::Failure,
                    Some(discard.id.clone()),
                    discard.why.clone(),
                    discard.gate,
                );
            }
            ws.emit_event(Event::IndexUpdated);
            ws.dispatch_pending();
        });
        let rejoin = PendingRejoin {
            pairs: rejoined,
            organization: Arc::clone(&self.organization),
            drafts: Arc::clone(&self.drafts),
            storage: Arc::clone(self.docs.vault.storage()),
            doc_data_roots: self.docs.plugin_data_roots(),
        };
        (opening, rejoin)
    }

    /// Rimette in anagrafe un file che è appena cambiato, chiedendo al disco
    /// quanto è grande e di quando è (§14.1).
    ///
    /// Un file che non c'è più esce dall'anagrafe invece di restarci con i
    /// numeri di prima: `stat` che non risponde e file sparito sono la stessa
    /// cosa per chi tiene un elenco di ciò che esiste.
    ///
    /// La **specie** si ricalcola qui e non si porta dietro: è la stessa regola
    /// della scansione, e vale anche a metà sessione — un provider registrato
    /// dopo l'apertura cambia cosa è un documento.
    pub(super) fn touch_entry(
        &mut self,
        id: &DocId,
        fingerprint: Option<Revision>,
    ) -> Option<EntryKind> {
        // L'orologio prima della `stat`: la soglia *racily clean* è il momento
        // in cui si guarda (vedi `CoreIndex::set_entry_observed`).
        let observed_at = crate::time::now_unix_millis();
        let Some((size, mtime)) = self.docs.vault.stat(id) else {
            return self.indexes.core.remove_entry(id);
        };
        Some(self.set_entry_observed(id, size, mtime, fingerprint, observed_at))
    }

    /// La metà di [`touch_entry`](Workspace::touch_entry) **che non guarda il
    /// disco**: mette in anagrafe una dimensione e una data che il chiamante
    /// già sa.
    ///
    /// Le sa chi ha appena scritto — [`Vault::write`](crate::Vault::write) le
    /// rende insieme all'esito — e chiederle di nuovo era il difetto 0179: fra
    /// la scrittura riuscita e la `stat` ci sta la cancellazione di un altro
    /// processo, e in quella finestra l'anagrafe *toglieva la voce* di un
    /// documento che aveva appena risposto `Ok` e per cui era già uscito
    /// `DocumentChanged`. Il rimedio non è guardare meglio: è non guardare
    /// affatto, perché la risposta era già in mano.
    ///
    /// Chi invece **non** ha scritto niente — il rilevatore, un ripristino dal
    /// cestino — passa da `touch_entry`, dove togliere la voce di un file che
    /// non c'è è la risposta giusta.
    pub(super) fn set_entry(
        &mut self,
        id: &DocId,
        size: u64,
        mtime: u64,
        fingerprint: Option<Revision>,
    ) -> EntryKind {
        self.set_entry_observed(id, size, mtime, fingerprint, crate::time::now_unix_millis())
    }

    pub(super) fn set_entry_observed(
        &mut self,
        id: &DocId,
        size: u64,
        mtime: u64,
        fingerprint: Option<Revision>,
        observed_at: u64,
    ) -> EntryKind {
        let kind = media::kind_of_ext(id, |ext| self.docs.registry.has_doc_ext(ext));
        // Un file che c'è dice che le cartelle che attraversa ci sono (§14.3):
        // senza questa riga una nota creata in una cartella nuova comparirebbe
        // in un albero che quella cartella non conosce fino alla riapertura.
        self.indexes.core.ensure_folders_of(id);
        self.indexes.core.set_entry_observed(
            VaultEntry {
                id: id.clone(),
                kind,
                size,
                mtime,
                fingerprint,
            },
            observed_at,
        );
        kind
    }

    /// Scrive l'anagrafe, perché la prossima apertura non debba rifare ciò che
    /// questa ha appena fatto (§14.2).
    ///
    /// Si scrive **qui e alla chiusura** — i due chiamanti sono
    /// [`finish_index`](Workspace::finish_index) e
    /// [`close_with`](Workspace::close_with) — e non a ogni salvataggio: è un
    /// file che contiene una riga per file del vault, e riscriverlo a ogni
    /// battuta sarebbe pagare l'intero vault per un documento. Fra un giro e
    /// l'altro l'anagrafe vive in memoria; se il processo muore prima di
    /// scriverla, la riapertura rilegge ciò che si è toccato da quando è stata
    /// scritta l'ultima volta — cioè si comporta come prima che questa voce
    /// esistesse, che è il degrado giusto per un dato derivato.
    ///
    /// Non tocca lo stato condiviso del workspace — legge le tabelle degli
    /// indici e scrive su disco — e per questo (difetto 0113) chi ha i thread
    /// la chiama sotto prestito **condiviso**, fuori dal prestito esclusivo
    /// della chiusura dell'indicizzazione: un lettore concorrente non aspetta
    /// la riscrittura dell'anagrafe insieme alle fasi in memoria.
    ///
    /// L'esito non risale, e non perché non interessi: un'apertura riuscita non
    /// deve fallire perché una cache non si è scritta. Non finisce nemmeno in
    /// [`IndexQuery::VaultStatus`](fub_abi::traits::IndexQuery::VaultStatus),
    /// che è il fatto interrogabile del §9.7 e dice un'altra cosa — *questo
    /// vault vede le scritture altrui* —: allargarlo a «e poi non ho scritto una
    /// cache» renderebbe quel numero la somma di due incidenti diversi. Va su
    /// `stderr` come il sidecar del cestino, ed è il §20.2 che gli darà una
    /// destinazione vera.
    /// # Ciò che si è visto nel proprio istante non si scrive
    ///
    /// Una voce la cui data non era nel passato quando la si è letta non è
    /// affidabile per la **prossima** apertura, e qui è dove quella risposta —
    /// presa al momento dell'osservazione, che è l'unico in cui la domanda ha
    /// senso — si spende (difetto 0187). Saltarla costa la rilettura di quel
    /// file alla riapertura; scriverla costerebbe un indice fermo su un
    /// contenuto vecchio fino al primo evento che tornasse a toccare quel file,
    /// e se nessuno lo toccasse, per sempre.
    pub fn store_entries(&self) {
        let _phase = tracing::info_span!(target: "fub.apertura", "store_entries").entered();
        let core = &self.indexes.core;
        // Ogni file si guarda **una volta**, qui, fuori dal lucchetto
        // dell'anagrafe: il confronto e la tabella nuova vengono dalle stesse
        // risposte. Guardarli due volte raddoppiava le domande al supporto
        // proprio sulla riapertura che scrive, e un file cambiato fra le due
        // avrebbe dato una tabella diversa da quella confrontata.
        let rows: Vec<(&VaultEntry, StoredEntry)> = core
            .entries
            .values()
            .filter_map(|entry| {
                // Un accesso solo all'osservazione: la stessa risposta decide
                // se la voce si scrive e se il suo timbro era fermo.
                let observed_at = core.observed_at(&entry.id);
                if crate::index::CoreIndex::seen_in_its_own_instant(entry.mtime, observed_at) {
                    return None;
                }
                Some((entry, observed_at))
            })
            .map(|(entry, observed_at)| {
                let now = FileWitness::of(&self.docs.vault, &entry.id);
                // Il file da cui la voce ha l'impronta (una lettura della
                // seconda fase, la riga certificata alla riapertura, una
                // domanda sul contenuto). Se adesso al suo posto c'è un altro
                // file, con la stessa misura e la stessa data e senza un
                // evento, la riga non porta l'impronta, e la prossima
                // apertura rilegge il file invece di certificarlo con i byte
                // di prima.
                let read_on = core.learned_on(&entry.id);
                let fingerprint = entry
                    .fingerprint
                    .clone()
                    .filter(|_| read_on.is_none_or(|witness| witness.agrees(&now)));
                // Il timbro certifica la riga alla riapertura, quindi si
                // scrive solo se dice il file **letto**:
                //
                // - la voce sa su quale file ha imparato l'impronta, e adesso
                //   è ancora quello, timbro e identità. Timbro e identità di
                //   adesso, da soli, sono quelli di un file che può essere
                //   arrivato dopo la lettura con la misura e la data di
                //   quello letto (una rinomina sopra, su FAT); una voce che
                //   non lo sa (una scrittura di Fub, il rilevatore) va senza,
                //   e si rilegge;
                // - il timbro era già fermo quando si è guardato il file
                //   ([`change_stamp_settled`](crate::transfer::change_stamp_settled)):
                //   ogni riscrittura dopo l'osservazione ha un timbro più
                //   nuovo di una grana prima di lei, e un timbro più giovane
                //   può essere quello di una riscrittura sul posto venuta dopo
                //   la lettura, dello stesso peso e della stessa data.
                //
                // Senza timbro la voce resta, per il ricongiungimento, ma la
                // prossima apertura rilegge il file invece di crederle.
                let settled = observed_at.and_then(crate::storage::change_stamp_at_unix_millis);
                let change_stamp = now.change_stamp.filter(|_| {
                    read_on.is_some_and(|witness| witness.agrees(&now))
                        && crate::transfer::change_stamp_settled(now.change_stamp, settled)
                });
                // I metadati si confrontano al loro posto e si copiano solo se
                // la tabella si scrive davvero (#524).
                let row = StoredEntry {
                    size: entry.size,
                    mtime: entry.mtime,
                    change_stamp,
                    identity: now.identity,
                    fingerprint,
                    metadata: None,
                };
                (entry, row)
            })
            .collect();
        // Una riapertura ferma compone la stessa tabella che il file ha già:
        // la si confronta al suo posto, senza copiare i metadati di ogni
        // documento per buttarli via in fondo a `store` (#524). Il confronto
        // è lo stesso di `store`, campo per campo, e ogni dubbio scrive.
        let unchanged = self.entry_store.already_holds(|known| {
            rows.len() == known.len()
                && rows.iter().all(|(entry, row)| {
                    known.get(&entry.id).is_some_and(|stored| {
                        stored.size == row.size
                            && stored.mtime == row.mtime
                            && stored.change_stamp == row.change_stamp
                            && stored.identity == row.identity
                            && stored.fingerprint == row.fingerprint
                            && core.stores_metadata_as(&entry.id, stored.metadata.as_ref())
                    })
                })
        });
        if unchanged {
            return;
        }
        let table = rows
            .into_iter()
            .map(|(entry, row)| {
                let metadata = core.stored_metadata(&entry.id);
                (entry.id.clone(), StoredEntry { metadata, ..row })
            })
            .collect();
        if let Err(and) = self.entry_store.store(table) {
            tracing::warn!(target: "fub.kernel", "anagrafe: {and}");
        }
    }
}
