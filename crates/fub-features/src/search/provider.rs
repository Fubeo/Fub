//! `IndexProvider` per `SearchIndex` e `SearchSettings`, l'handler che
//! rinfresca i pesi quando cambiano le impostazioni.

use super::*;

impl IndexProvider for SearchIndex {
    /// Tre foglie, nessuna famiglia.
    ///
    /// Il testo è l'unica che sa solo lui — il kernel non indicizza il corpo —
    /// mentre tag e cartelle le sa anche il kernel: dichiararle **non** è una
    /// rivendicazione contro di lui, è ciò che permette al pianificatore di
    /// consegnare a questo indice una clausola intera (`testo AND cartella`)
    /// invece di spezzarla e intersecare a mano. È il filtro dentro il motore
    /// della decisione 0005, e adesso è il motore a dichiarare di saperlo fare.
    fn routes(&self) -> Vec<QueryRoute> {
        vec![
            QueryRoute::Predicate(PredicateKind::Text),
            QueryRoute::Predicate(PredicateKind::Regex),
            QueryRoute::Predicate(PredicateKind::Task),
            QueryRoute::Predicate(PredicateKind::Tag),
            QueryRoute::Predicate(PredicateKind::Folder),
            QueryRoute::Predicate(PredicateKind::Scoped),
            QueryRoute::Predicate(PredicateKind::TaskDue),
        ]
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        // I pesi **prima** del manifest, e senza `?`: se le impostazioni non si
        // leggono valgono i default (vedi [`FieldWeights::read`]), mentre un
        // manifest che non si legge è una diagnostica vera. Sono due errori di
        // gravità diversa e sarebbe sbagliato farli cadere insieme.
        *self.weights.write().expect("rwlock") = FieldWeights::read(host);
        self.load_manifest(host)
    }

    /// Cosa è già a posto, guardando solo l'anagrafe (§14.2).
    ///
    /// La domanda che mancava: prima il kernel leggeva e parsava l'intero vault
    /// e *poi* consegnava tutto a chi ce l'aveva già. Qui si risponde senza
    /// aprire un file, confrontando la revisione del sorgente che il kernel
    /// dichiara con quella da cui è stato ricavato ciò che sta nell'indice.
    ///
    /// Tre cautele, tutte nello stesso verso — dire «ce l'ho» a sproposito
    /// farebbe **saltare** un documento, cioè mentire in silenzio, mentre dire
    /// «mandamelo» di troppo costa una rilettura:
    ///
    /// - senza impronta dichiarata non si risponde: chi non sa di che revisione
    ///   è un file non può sapere se è la sua;
    /// - la revisione deve stare accanto a un documento davvero indicizzato
    ///   (`fingerprints`), e le due mappe arrivano dallo stesso manifest, che è
    ///   già respinto in blocco se cita un'altra epoca o un altro schema;
    /// - ciò che non è un documento non è affar suo. Il kernel oggi manda solo
    ///   documenti, ma un provider che ci contasse leggerebbe il contratto più
    ///   stretto di com'è scritto.
    fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> {
        let mut announced = self.announced.lock().expect("mutex");
        let mut current = Vec::new();
        for entry in entries {
            // **La dichiarazione è per documento, e per documento si rifà.**
            // Qui c'era un `clear()` in testa, ed era giusto finché la domanda
            // arrivava una volta sola con il vault intero. Da quando il kernel
            // la fa **per fetta** (`Workspace::plan_batch`) quel `clear()`
            // trattava una mappa per-documento come il buffer di un giro: la
            // domanda su una fetta si portava via le dichiarazioni della fetta
            // prima, che stavano ancora aspettando la loro consegna, e quei
            // documenti finivano indicizzati **senza** la revisione del
            // sorgente — cioè da rileggere a ogni apertura, per sempre.
            //
            // Che oggi non si veda dipende da come le due fasi sono
            // programmate: il chiamante di adesso consegna una fetta prima di
            // chiedere della successiva. Ma è una proprietà del suo orario, non
            // del contratto, e dalla 0119 pianificare e applicare sono due
            // chiamate pubbliche apposta perché si possano sovrapporre.
            // Togliere di mezzo l'assunzione costa questa riga.
            announced.remove(&entry.id);
            let (EntryKind::Document, Some(revision)) = (entry.kind, entry.fingerprint.as_ref())
            else {
                continue;
            };
            if self.sources.get(&entry.id) == Some(revision)
                && self.fingerprints.contains_key(&entry.id)
            {
                current.push(entry.id.clone());
                // **Non** si dichiara ciò che si è appena detto di avere: quel
                // documento non arriverà, e una dichiarazione che resta lì ad
                // aspettare verrebbe raccolta dalla prima consegna successiva —
                // cioè dal primo salvataggio a sessione aperta, che porta un
                // testo nuovo e si prenderebbe la revisione di quello vecchio.
                // Se poi arrivasse lo stesso (un altro indice non ce l'aveva),
                // si resta senza revisione e lo si rilegge alla prossima
                // apertura: il verso sicuro dello sbaglio.
                continue;
            }
            announced.insert(entry.id.clone(), revision.clone());
        }
        current
    }

    /// **Il posto in cui questo indice sapeva di perdere un documento e non
    /// aveva come dirlo** (§20.1). Il commento che c'è sotto — «mentire è
    /// peggio che perdere il documento» — era già qui prima della decisione
    /// 0051, ed era tutto ciò che si poteva fare: il ripiego (dimenticare
    /// l'impronta, così il prossimo passaggio riprova) funziona solo alla
    /// riapertura del vault, perché `reindex` è l'unico percorso che rialimenta
    /// un documento **immutato**. Per tutta la sessione corrente quella nota non
    /// era nella ricerca, e «nessun risultato» era indistinguibile da «nessuna
    /// corrispondenza».
    ///
    /// Adesso la stessa riga produce un [`IndexLoss`] che nomina il documento,
    /// e il ripiego resta: si riprova alla riapertura **e** lo si dice adesso.
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        let mut lost = Vec::new();
        for doc in docs {
            let print = fingerprint(doc);
            // Contenuto identico a quello già indicizzato: non c'è niente da
            // fare in tantivy. È questo salto — non una scorciatoia all'avvio —
            // a rendere rapida la riapertura di un vault non toccato. La
            // revisione del sorgente si aggiorna lo stesso: un file può cambiare
            // senza che il modello cambi (una riga di frontmatter che nessuno
            // indicizza), e lasciarci quella vecchia vorrebbe dire farlo
            // rileggere per sempre.
            if self.fingerprints.get(&doc.id) == Some(&print) {
                self.notes_source(&doc.id);
                continue;
            }
            // tantivy non aggiorna: si cancella il termine e si riscrive.
            let term = self.term_for(&doc.id);
            let td = self.tantivy_doc(doc);
            {
                let guard = self.writer.lock().expect("mutex");
                // Il writer è andato — chiuso (decisione 0028) o rotto — e in
                // entrambi i casi l'indice non è più affidabile: mentire è
                // peggio che perdere il documento. Si dimentica l'impronta, così
                // il prossimo passaggio riproverà.
                let Some(writer) = guard.as_ref() else {
                    drop(guard);
                    self.forget(&doc.id);
                    lost.push(IndexLoss::new(
                        doc.id.clone(),
                        PluginError::Internal(
                            "l'indice di ricerca non accetta più scritture: questo documento \
                             non è cercabile finché il vault non viene riaperto"
                                .into(),
                        ),
                    ));
                    continue;
                };
                writer.delete_term(term);
                if let Err(and) = writer.add_document(td) {
                    drop(guard);
                    self.forget(&doc.id);
                    lost.push(IndexLoss::new(
                        doc.id.clone(),
                        PluginError::Internal(
                            format!("l'indice di ricerca ha rifiutato il documento: {and}").into(),
                        ),
                    ));
                    continue;
                }
            }
            self.fingerprints.insert(doc.id.clone(), print);
            self.notes_source(&doc.id);
            self.dirty.store(true, Ordering::Release);
        }
        lost
    }

    /// La perdita di segno opposto, e la più visibile: senza writer il termine
    /// **non** si cancella, quindi il documento resta cercabile pur essendo
    /// sparito dal vault — chi cerca lo trova e lo apre, e trova un file che
    /// non c'è.
    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        let mut lost = Vec::new();
        for id in ids {
            self.sources.remove(id);
            if self.fingerprints.remove(id).is_none() {
                continue;
            }
            let term = self.term_for(id);
            match self.writer.lock().expect("mutex").as_ref() {
                Some(writer) => {
                    writer.delete_term(term);
                    self.dirty.store(true, Ordering::Release);
                }
                None => lost.push(IndexLoss::new(
                    id.clone(),
                    PluginError::Internal(
                        "l'indice di ricerca non accetta più scritture: questo documento resta \
                         fra i risultati pur non esistendo più"
                            .into(),
                    ),
                )),
            }
        }
        lost
    }

    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        // Fine del giro d'apertura: le consegne che la domanda annunciava sono
        // arrivate tutte, e ciò che resta dichiarato è di un documento che non
        // è arrivato — un parse fallito, un file sparito fra la scansione e la
        // lettura. Tenerlo vorrebbe dire consegnarlo a chi passa dopo.
        self.announced.lock().expect("mutex").clear();

        let alive: std::collections::HashSet<&DocId> = ids.iter().collect();
        let dead: Vec<DocId> = self
            .fingerprints
            .keys()
            .filter(|id| !alive.contains(id))
            .cloned()
            .collect();
        if dead.is_empty() {
            return Vec::new();
        }
        let terms: Vec<Term> = dead.iter().map(|id| self.term_for(id)).collect();
        // Senza writer i morti restano dentro, e `forget` qui sotto toglierebbe
        // anche l'unica traccia che permette di riprovare: sono perdite, e sono
        // esattamente il caso che `reconcile` esiste per chiudere — ciò che è
        // sparito ad app chiusa.
        let mut lost = Vec::new();
        match self.writer.lock().expect("mutex").as_ref() {
            Some(writer) => {
                for term in terms {
                    writer.delete_term(term);
                }
                self.dirty.store(true, Ordering::Release);
            }
            None => {
                lost = dead
                    .iter()
                    .map(|id| {
                        IndexLoss::new(
                            id.clone(),
                            PluginError::Internal(
                                "l'indice di ricerca non accetta più scritture: questo documento \
                                 è stato cancellato ad app chiusa e resta fra i risultati"
                                    .into(),
                            ),
                        )
                    })
                    .collect();
            }
        }
        for id in &dead {
            self.forget(id);
        }
        lost
    }

    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.commit()?;
        self.persist(host)
    }

    /// Lascia andare la cartella: commit di ciò che resta, manifest, e **il
    /// writer restituito a tantivy** aspettando i suoi thread di merge.
    ///
    /// L'ultimo passo è ciò per cui il §9.2 chiedeva questa funzione. Un
    /// `IndexWriter` tiene un lock esclusivo sulla cartella dell'indice: finché
    /// è vivo, un'altra sessione sullo stesso vault non apre la ricerca —
    /// e `Index::writer` non fallisce subito, *aspetta*. Chi riapriva lo stesso
    /// vault trovava il proprio indice dietro il lock della sessione che se ne
    /// stava andando.
    ///
    /// Il `flush` che il kernel chiama prima ha già fatto commit e manifest;
    /// rifarli qui non costa niente (`dirty` è spento, il manifest cita
    /// l'opstamp corrente) e copre chi chiama `close` da solo.
    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.commit()?;
        self.persist(host)?;
        let Some(writer) = self.writer.lock().expect("mutex").take() else {
            // Già chiuso: chiudere due volte non è un errore, è un no-op — la
            // stessa regola di `data_remove`.
            return Ok(());
        };
        writer
            .wait_merging_threads()
            .map_err(|and| PluginError::Internal(reason(INDEX_CLOSE, and)))
    }

    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
                excerpts,
            } => {
                // Il pianificatore non chiede a un indice ciò che l'indice non
                // sa fare: ordinare per una proprietà del frontmatter e
                // riempire le colonne è roba di chi il frontmatter ce l'ha in
                // cache. Se arrivasse comunque, rispondere ignorandolo sarebbe
                // mentire in silenzio.
                if sort.is_some() || !select.is_none() {
                    return Err(PluginError::BadArgs(Text::key(SELECT_UNSUPPORTED)));
                }
                Ok(IndexResult::Documents(
                    self.search(&matching, page, excerpts)?,
                ))
            }
            // Tutto il resto ha già una fonte di verità nel kernel — grafo,
            // modelli parsati, frontmatter — e non si duplica qui: due verità
            // sullo stesso dato divergono, e la seconda mente in silenzio.
            // Prima questo `match` doveva dirlo variante per variante con dei
            // `BadArgs`, perché era così che si scopriva chi servisse cosa;
            // adesso il routing è dichiarato e questo ramo è irraggiungibile.
            // Il `{what}` porta la famiglia chiesta (`other.kind()`), con la
            // chiave già in catalogo: nessuna nuova stringa fuori da `catalog()`.
            other => Err(PluginError::Unserved(Text::message(
                UNSERVED_FAMILY,
                vec![Arg::text(WHAT, format!("{:?}", other.kind()))],
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// Chi rinfresca i pesi (§21.6)
// ---------------------------------------------------------------------------

/// L'`EventHandler` che tiene i pesi di [`SearchIndex`] allineati alle
/// impostazioni.
///
/// # Perché è un secondo oggetto e non un metodo dell'indice
///
/// Perché il contratto lo impone, ed è giusto che lo imponga:
/// [`IndexProvider`] non riceve eventi e [`IndexProvider::query`] non riceve un
/// host, quindi l'unico posto in cui un indice può *sapere* che una chiave è
/// cambiata è un handler. Registrarne uno accanto al provider non è una
/// scorciatoia interna alle feature ufficiali: è esattamente ciò che farebbe un
/// plugin di terzi che volesse un indice configurabile, e il bundle della
/// ricerca passa dalle stesse due registrazioni.
///
/// # L'evento non porta il valore, e chi reagisce rilegge
///
/// [`Event::SettingChanged`] dice **quale** chiave è cambiata e in che livello,
/// non il valore nuovo — è una scelta di progetto (vedi il contratto in
/// `apps/client/src/host/contract.ts`), e la ragione è che un evento che portasse
/// il valore sarebbe una seconda fonte di verità che arriva in ritardo. Qui si
/// rilegge, e si rilegge **tutto**: quattro `setting()` su un file già in
/// memoria costano meno del ramo che deciderebbe quale delle quattro toccare.
pub struct SearchSettings {
    pub(super) weights: Arc<RwLock<FieldWeights>>,
}

impl EventHandler for SearchSettings {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::SettingChanged])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        // Il **prefisso**, e non i quattro nomi: il giorno che un quinto campo
        // diventa indicizzabile, la sua chiave arriva qui senza che nessuno si
        // ricordi di aggiungerla a un elenco.
        if let Event::SettingChanged { key, .. } = &notice.event {
            if key.starts_with(BOOST_PREFIX) {
                *self.weights.write().expect("rwlock") = FieldWeights::read(host);
            }
        }
        Ok(())
    }
}
