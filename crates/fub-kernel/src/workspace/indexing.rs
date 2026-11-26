//! I provider di indice, la reindicizzazione e la scansione del vault.

use super::*;

/// La scansione preparata senza chiamare codice esterno. Contiene una
/// fotografia degli handle degli indici, non una guardia del `Workspace`.
pub struct PreparedVaultScan {
    /// L'orologio letto prima di guardare il disco: la soglia *racily clean*
    /// delle voci di questa scansione (vedi `CoreIndex::set_entry_observed`).
    pub(super) observed_at: u64,
    pub(super) folders: Vec<String>,
    pub(super) entries: Vec<VaultEntry>,
    /// Il file che ogni voce certificata dall'anagrafe descrive, letto
    /// adesso (vedi `CoreIndex::learned_on`).
    pub(super) read_on: Vec<(DocId, FileWitness)>,
    pub(super) documents: Vec<VaultEntry>,
    pub(super) known_entries: Vec<Option<StoredEntry>>,
    pub(super) assets: Vec<VaultEntry>,
    pub(super) providers: Vec<(String, SharedIndexProvider)>,
}

/// La risposta degli indici alla scansione, pronta per la finalizzazione.
pub struct CompletedVaultScan {
    pub(super) observed_at: u64,
    pub(super) folders: Vec<String>,
    pub(super) entries: Vec<VaultEntry>,
    pub(super) read_on: Vec<(DocId, FileWitness)>,
    pub(super) documents: Vec<VaultEntry>,
    pub(super) known_entries: Vec<Option<StoredEntry>>,
    pub(super) assets: Vec<VaultEntry>,
    pub(super) up_to_date: BTreeSet<DocId>,
}

impl PreparedVaultScan {
    /// Esegue soltanto `IndexProvider::up_to_date`, sugli handle staccati.
    pub fn invoke(self) -> CompletedVaultScan {
        let PreparedVaultScan {
            observed_at,
            folders,
            entries,
            read_on,
            documents,
            known_entries,
            assets,
            providers,
        } = self;
        let mut up_to_date = up_to_date_index_handles(&providers, &documents);
        if release_index_handles(providers).is_err() {
            up_to_date.clear();
        }
        CompletedVaultScan {
            observed_at,
            folders,
            entries,
            read_on,
            documents,
            known_entries,
            assets,
            up_to_date,
        }
    }
}

impl Workspace {
    /// Registra un [`IndexProvider`] sotto un id. Va fatto **prima** di
    /// [`reindex`], che è il momento in cui l'indice riceve il contenuto del
    /// vault e riconcilia ciò che è cambiato mentre non era vivo.
    ///
    /// La registrazione **è** l'attivazione: l'indice riceve subito un
    /// [`HostApi`] intestato al proprio id e ricarica da `data_*` ciò che ha
    /// già visto. Prima di questo momento non può avere ricordi, e dopo il
    /// primo `on_documents_indexed` sarebbe troppo tardi per averli.
    ///
    /// I due esiti sono **diversi**, e li distingue chi chiama: un conflitto di
    /// rotte vuol dire che l'indice non è registrato affatto; un errore di
    /// attivazione che è registrato ma non ha ritrovato la propria memoria —
    /// reindicizzerà tutto, che è lento, non sbagliato.
    ///
    /// `id` è un nome semplice, senza separatori di path: determina lo spazio
    /// dati (`.fub/data/plugins/<id>/`), come per gli event handler.
    ///
    /// [`reindex`]: Workspace::reindex
    pub fn register_index_provider(
        &mut self,
        plugin: impl Into<String>,
        index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared =
            PreparedIndexRegistration::new(index).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.admit_index_registration(&permit, &prepared)?;
        self.with_provider_call(|ws| {
            let mut host = ws.host_for(&plugin, InvokeMode::Apply);
            // The token retains the outcome for publication, including the
            // established recoverable RegistryError::Activate case.
            let _ = prepared.activate(&mut host);
        });
        let result = self.commit_index_registration(&permit, &mut prepared);
        self.dispatch_pending();
        result
    }

    /// Registra un indice **sostituendo** chi rivendicava le stesse famiglie di
    /// domande.
    ///
    /// È l'operazione che il dispatch per tentativi faceva senza dirlo — vinceva
    /// chi si era registrato prima, e non c'era modo di accorgersene — e che
    /// adesso si chiede per nome. È anche il modo in cui l'indice del kernel si
    /// scavalca: `Backlinks`, `Tags` e gli altri non sono più un ramo prima del
    /// ciclo, sono rotte come le altre.
    pub fn replace_index_provider(
        &mut self,
        plugin: impl Into<String>,
        index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let namespaces = plugins::custom_namespaces(&index.routes());
        // Sostituire non scavalca la regola dei nomi: si prende il posto di chi
        // c'era, non il suo namespace. E il permesso si chiede **prima** di
        // togliere la riga di chi c'era, o un rifiuto lascerebbe la rotta ancora
        // servita e l'inventario a dire che non è di nessuno.
        self.providers
            .plugins
            .admit_replacing(&plugin, RegistrationKind::Index, &namespaces)?;
        self.providers
            .plugins
            .forget(RegistrationKind::Index, &namespaces);
        self.indexes.declare_replacing(index.as_ref());
        self.providers
            .plugins
            .record(&plugin, RegistrationKind::Index, &namespaces);
        self.activate_index(plugin, index)
    }

    /// La registrazione **è** l'attivazione: l'indice riceve subito un
    /// [`HostApi`] intestato al proprio id e ricarica da `data_*` ciò che ha già
    /// visto. Prima di questo momento non può avere ricordi, e dopo il primo
    /// `on_documents_indexed` sarebbe troppo tardi per averli.
    pub(super) fn activate_index(
        &mut self,
        id: String,
        mut index: Box<dyn IndexProvider>,
    ) -> std::result::Result<(), RegistryError> {
        // `index` è ancora una variabile locale: prestare `&mut self` all'host
        // qui non alias niente. `activate` è una chiamata a un provider come
        // le altre: il dispatch resta rimandato a chiamata tornata.
        let activated = self.with_provider_call(|ws| {
            let mut host = ws.host_for(&id, InvokeMode::Apply);
            index.activate(&mut host)
        });
        self.indexes
            .providers
            .push((id, Arc::new(SharedShelter::new(index))));
        self.dispatch_pending();
        activated.map_err(RegistryError::Activate)
    }

    /// Guarda cosa c'è nel vault, ricostruisce il grafo e allinea gli indici
    /// registrati — **rileggendo e riparsando solo ciò che serve** (§14.1,
    /// §14.2).
    ///
    /// # Cosa succede, in ordine
    ///
    /// 1. **La scansione vede tutti i file**, non solo le estensioni dei
    ///    provider registrati: da qui nasce l'anagrafe, e da qui in poi un PNG
    ///    nel vault esiste.
    /// 2. Di ogni voce si porta avanti ciò che l'anagrafe scritta l'ultima
    ///    volta ne sapeva, **se descrive ancora quel file** (dimensione e data).
    /// 3. I documenti di cui non si sa niente si leggono, e leggendoli se ne
    ///    calcola l'impronta: è l'unico posto in cui si calcola: dove i byte
    ///    sono già in mano.
    /// 4. Si chiede agli indici registrati **cosa hanno già**
    ///    ([`IndexProvider::up_to_date`]). Prima non glielo si chiedeva: il
    ///    kernel leggeva e parsava tutto e poi lo consegnava a chi ce l'aveva
    ///    già.
    /// 5. Un documento si salta — niente lettura, niente parse, niente
    ///    alimentazione — solo se l'anagrafe ne ha i metadati, l'impronta
    ///    combacia e **ogni** indice ha detto di averlo. Tutto il resto passa
    ///    dalla strada di sempre.
    ///
    /// Per gli indici questo **non** è un rebuild: chi riceve un documento lo
    /// ha chiesto (o non ha detto niente, che vuol dire la stessa cosa), e
    /// [`IndexProvider::reconcile`] dice a tutti qual è l'insieme completo, così
    /// ognuno cancella ciò che è sparito ad app chiusa.
    ///
    /// # Cosa può fallire, e cosa no (§15.7)
    ///
    /// **Un documento che non si legge o non si parsa non fa fallire
    /// l'apertura**: finisce fra gli [`discarded`](Opening::discarded) dell'[`Opening`](Opening)
    /// che questa funzione restituisce, e la sua voce resta nell'anagrafe — il file c'è, è
    /// il suo contenuto che non si è potuto vedere. Il `Result` che resta porta
    /// **solo** ciò che riguarda il vault intero, cioè la scansione: il confine
    /// non è lettura-contro-parse, è se il vault sappia ancora dire *quali*
    /// documenti esistono. Il perché sta nella
    /// [decisione 0068](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md).
    pub fn reindex(&mut self) -> Result<Opening> {
        let mut indexing = self.scan_vault()?;
        while !indexing.finished() {
            self.index_batch(&mut indexing);
        }
        let opening = self.finish_index(indexing);
        // La raccolta sta fuori da `finish_index` perché vuole `&self` e non
        // `&mut` (vedi il suo doc); qui la si rifà subito, come prima, perché
        // `reindex` è il giro sincrono e chi lo chiama ha già il prestito in
        // mano — non c'è nessuno da non far aspettare.
        //
        // L'esito **non** risale, e la ragione è quella del § qui sopra: il
        // `Result` di un'apertura porta solo ciò che riguarda la scansione, e
        // una cartella di dati che non si è potuta togliere non impedisce a
        // nessuno di aprire una nota. Chi ha chiesto *espressamente* di
        // raccogliere — `vault.repair` — la riceve invece, perché è la sola
        // cosa che aveva chiesto.
        if let Err(and) = self.collect_doc_data() {
            tracing::warn!(target: "fub.kernel", "spazi per-documento non raccolti: {and}");
        }
        Ok(opening)
    }

    /// Toglie i temporanei di scrittura che la camminata ha trovato rimasti
    /// indietro (difetto 0155).
    ///
    /// Sta qui e non nella camminata perché è l'unica mutazione dell'apertura
    /// che non nasce da ciò che l'utente ha scritto, e sta **nell'apertura** e
    /// non in `vault.repair` perché il sedimento cresce a ogni crash e un
    /// comando che nessuno lancia non lo ferma: il posto giusto per raccogliere
    /// ciò che un crash ha lasciato è il giro successivo a quel crash.
    ///
    /// Un guasto non risale, per la ragione con cui non risale quello della
    /// raccolta degli spazi per-documento: un residuo che non si è potuto
    /// togliere non impedisce a nessuno di aprire una nota, e la prossima
    /// apertura ci riprova.
    pub(super) fn sweep_temporary(&self, temporary: &[Utf8PathBuf]) {
        for path in temporary {
            match self.docs.vault.storage().remove(path) {
                Ok(()) => tracing::info!(
                    target: "fub.kernel",
                    "temporaneo di scrittura rimasto indietro, tolto: {path}"
                ),
                Err(and) => tracing::warn!(
                    target: "fub.kernel",
                    "temporaneo di scrittura {path} non tolto: {and}"
                ),
            }
        }
    }

    /// Toglie i compagni di lock che nessuno tiene più: quelli di un'uscita
    /// forzata in mezzo a un salvataggio, e quelli che le versioni di Fub che
    /// il lock non lo toglievano hanno lasciato accanto a ogni file salvato o
    /// spostato. Sono file nascosti di Fub nella cartella dell'utente, e chi la
    /// sincronizza o la guarda con un altro programma li vede.
    ///
    /// Se un lock è rimasto indietro lo dice il supporto
    /// ([`VaultStorage::remove_abandoned_lock`]): uno tenuto adesso da un
    /// salvataggio — di questo processo o di un altro Fub sullo stesso vault —
    /// resta. Un guasto non risale, come per i temporanei.
    pub(super) fn sweep_locks(&self, locks: &[Utf8PathBuf]) {
        for path in locks {
            match self.docs.vault.storage().remove_abandoned_lock(path) {
                Ok(true) => tracing::info!(
                    target: "fub.kernel",
                    "lock rimasto indietro, tolto: {path}"
                ),
                Ok(false) => {}
                Err(and) => tracing::warn!(
                    target: "fub.kernel",
                    "lock {path} non tolto: {and}"
                ),
            }
        }
    }

    /// **La prima fase dell'apertura** (§15.7): guarda cosa c'è, e basta.
    ///
    /// Al ritorno il vault è **utilizzabile** — l'anagrafe c'è, le cartelle ci
    /// sono, una nota si apre — e *non* è indicizzato: la ricerca e il grafo
    /// sono vuoti finché la [`Indicizzazione`] che questa funzione consegna non
    /// è stata portata in fondo a fette da
    /// [`plan_batch`](Workspace::plan_batch) e
    /// chiusa da [`finish_index`](Workspace::finish_index).
    ///
    /// **Il `Result` è qui e non altrove**, ed è tutta la ragione per cui il
    /// taglio cade in questo punto: ciò che può far fallire un'apertura è
    /// rimasto solo la scansione
    /// ([0068](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)),
    /// quindi la fase che può fallire e la fase che dura sono due fasi diverse.
    /// Chi apre aspetta la prima e non la seconda.
    pub fn prepare_scan_vault(&self) -> Result<PreparedVaultScan> {
        let _phase = tracing::info_span!(target: "fub.apertura", "scan_vault").entered();
        let observed_at = crate::time::now_unix_millis();
        let scanned = self.docs.vault.scan()?;
        self.sweep_temporary(&scanned.temporary_remaining_back);
        self.sweep_locks(&scanned.locks_remaining_back);
        // `.fub/` non è contenuto e la scansione non ci entra: i suoi lock
        // rimasti indietro si cercano a parte, con lo stesso criterio. Un
        // guasto della camminata non ferma l'apertura, come quello della
        // pulizia.
        match self.docs.vault.service_locks() {
            Ok(locks) => self.sweep_locks(&locks),
            Err(and) => tracing::warn!(
                target: "fub.kernel",
                "lock di .fub non cercati: {and}"
            ),
        }

        // La scansione raccoglie una fotografia completa ma non muta ancora il
        // core: durante `IndexProvider::up_to_date` i reader vedono l'ultimo stato
        // coerente, non metà della nuova anagrafe.
        //
        // La specie si **ricalcola** e non si rilegge dalla tabella: dipende da
        // chi è registrato adesso, e un `.canvas` diventa un documento il giorno
        // che qualcuno rivendica quell'estensione, senza essere cambiato.
        let mut entries: Vec<(VaultEntry, Option<StoredEntry>, Option<FileWitness>)> = scanned
            .files
            .into_iter()
            .map(|file| {
                // Una domanda sola all'anagrafe: la risposta intera serve
                // alla riapertura incrementale di `finalize_scan_vault`, e
                // rifarla là è un lock e una copia regalati per niente.
                //
                // **Timbro e identità si chiedono per ultimi**, e solo a una
                // voce che l'anagrafe potrebbe certificare: su Windows
                // leggerli è aprire il file, e alla prima apertura di un vault nessuna
                // voce è nota. Chiederlo a tutti costava cinquemila aperture
                // buttate su un vault da cinquemila file, la parte più lenta
                // del montaggio su Windows (issue #493).
                //
                // **Si copia solo la riga che si può certificare** (#523): la
                // domanda su misura, data e impronta si fa sulla riga dov'è, e
                // una riga che non passa non si copia. Nella closure niente
                // I/O: il testimone si chiede dopo, fuori dal lucchetto.
                let candidate = self
                    .entry_store
                    .ask_known(&file.id, |known| {
                        (known.describes(file.size, file.mtime) && known.fingerprint.is_some())
                            .then(|| known.clone())
                    })
                    .flatten();
                // Timbro **e identità**, con la regola unica e una domanda
                // sola al supporto: un file messo al posto di un altro da una
                // rinomina, dove il timbro è la data (FAT) o la rinomina non
                // lo tocca, ha la misura, la data e il timbro di quello di
                // prima, ma non la sua identità.
                let now = candidate
                    .as_ref()
                    .map(|_| FileWitness::of(&self.docs.vault, &file.id));
                let known =
                    candidate.filter(|known| now.is_some_and(|now| known.witness().agrees(&now)));
                // Il file che la riga certificata descrive: la voce ne porta
                // l'impronta, e `store_entries` la riscrive col timbro solo
                // se al momento di scriverla il file è ancora questo.
                let read_on = now.filter(|_| known.is_some());
                let entry = VaultEntry {
                    fingerprint: known.as_ref().and_then(|known| known.fingerprint.clone()),
                    kind: media::kind_of_ext(&file.id, |ext| self.docs.registry.has_doc_ext(ext)),
                    id: file.id,
                    size: file.size,
                    mtime: file.mtime,
                };
                (entry, known, read_on)
            })
            .collect();

        // La coppia viaggia in parallelo: il `VaultEntry` per gli indici
        // (che lo chiedono per valore), l'anagrafe per la riapertura. La riga
        // dell'anagrafe si **sposta** e non si copia: la terna serve dopo solo
        // per il `VaultEntry`.
        let mut documents = Vec::new();
        let mut known_entries = Vec::new();
        let mut assets = Vec::new();
        let mut read_on = Vec::new();
        for (entry, known, witness) in &mut entries {
            if let Some(witness) = witness {
                read_on.push((entry.id.clone(), *witness));
            }
            match entry.kind {
                EntryKind::Document => {
                    documents.push(entry.clone());
                    known_entries.push(known.take());
                }
                EntryKind::Asset => assets.push(entry.clone()),
                _ => {}
            }
        }

        Ok(PreparedVaultScan {
            observed_at,
            folders: scanned.folders,
            entries: entries.into_iter().map(|(entry, _, _)| entry).collect(),
            read_on,
            documents,
            known_entries,
            assets,
            providers: self.indexes.feed_handles(),
        })
    }

    /// Installa atomicamente la fotografia della scansione dopo che le risposte
    /// esterne sono tornate. Nessuna callback provider gira in questa fase.
    pub fn finalize_scan_vault(&mut self, completed: CompletedVaultScan) -> Indexing {
        let CompletedVaultScan {
            observed_at,
            folders,
            entries,
            read_on,
            documents,
            known_entries,
            assets,
            up_to_date,
        } = completed;

        // **Gli indici si svuotano qui**, cioè in chiusura della prima fase e
        // non a giro di lettura finito. Finché il parse era fatale, svuotare
        // tardi teneva il tutto-o-niente; quando la
        // [0068](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)
        // gliel'ha tolto, teneva ancora una cosa vera — gli indici non restano
        // vuoti per il tempo in cui si cammina il disco. Quella cosa **si
        // perde qui**, ed è il prezzo dichiarato dell'apertura a fasi: fra
        // `scan_vault` e `finish_index` la ricerca risponde poco e poi di più.
        // Il prezzo si paga in questo verso perché l'alternativa lo fa pagare
        // tutto a chi apre — che aspetta a schermo fermo — invece che a chi
        // cerca nei primi secondi, che vede l'app viva e i risultati arrivare.
        // Chi guarda non deve indovinarlo: lo dice `Indexing` a chi la porta
        // avanti, e `VaultStatus::indexing` a chiunque altro.
        self.indexes.core.clear();
        // Le cartelle prima delle voci, e dalla **camminata** e non dai path
        // dei file (§14.3): una cartella vuota non compare in nessun path, e
        // dedurle dai file vorrebbe dire che l'unica cartella che esiste è
        // quella che ha già qualcosa dentro.
        for folder in folders {
            self.indexes.core.set_folder(folder);
        }
        // L'anagrafe è **intera già adesso**, ed è ciò che rende il vault
        // utilizzabile alla fine di questa fase: l'albero dei file, le
        // cartelle e la specie di ogni voce non aspettano di aver letto niente.
        // Le impronte che mancano le riempirà la seconda fase, rimettendo in
        // anagrafe le voci che legge.
        for entry in entries {
            self.indexes.core.set_entry_observed(entry, observed_at);
        }
        for (id, witness) in read_on {
            self.indexes.core.remember_read_on(&id, witness);
        }
        self.indexes.core.mark_scanned();

        // **Riapertura incrementale**: per ogni documento descritto dall'anagrafe
        // (size+mtime+timbro di cambiamento → impronta) che porta i metadati e
        // per cui tutti gli indici plugin rispondono `up_to_date`, si
        // ripristinano direttamente i metadati in memoria senza rileggerlo dal
        // disco. A fette finiscono solo i documenti nuovi, modificati, o per cui
        // un indice plugin deve essere allineato.
        let mut to_index = Vec::new();
        let restoring = tracing::info_span!(target: "fub.apertura", "restore").entered();
        for (entry, known) in documents.into_iter().zip(known_entries) {
            let metadata = if entry.fingerprint.is_some() && up_to_date.contains(&entry.id) {
                known
                    .filter(|known| known.fingerprint == entry.fingerprint)
                    .and_then(|known| known.metadata)
            } else {
                None
            };
            if let Some(metadata) = metadata {
                self.indexes.core.restore(&entry.id, metadata);
            } else {
                to_index.push(entry);
            }
        }
        drop(restoring);
        // Gli allegati non hanno metadati da ripristinare: la seconda fase ne
        // legge i byte e aggiorna la stessa impronta dei documenti.
        to_index.extend(assets);

        // L'apertura non l'ha chiesta un documento né un plugin: è il kernel che
        // dichiara di esistere (decisione 0012).
        //
        // `VaultOpened` esce **qui**, dove il vault diventa usabile, e non alla
        // fine dell'indicizzazione: è l'evento che dice *questo vault è
        // aperto*, e con le fasi quel momento è questo. Chi lo riceve sa che
        // l'anagrafe c'è; per sapere se la ricerca è pronta c'è `IndexUpdated`,
        // che resta dov'era — in fondo.
        self.as_actor(Actor::Kernel, |ws| {
            ws.emit_event(Event::VaultOpened {
                root: ws.docs.vault.root().to_string(),
            });
            ws.dispatch_pending();
        });

        // Da qui l'indice risponde **meno di quanto il vault sappia**, e chi lo
        // interroga deve poterlo distinguere da un vault vuoto (§15.7).
        self.indexes.core.watch.indexing = IndexingState::Running;
        Indexing::new(to_index)
    }

    /// Percorso sincrono per chi possiede direttamente un `Workspace`. L'host,
    /// che usa `Custody`, chiama esplicitamente prepare/invoke/finalize.
    pub fn scan_vault(&mut self) -> Result<Indexing> {
        let completed = self.prepare_scan_vault()?.invoke();
        Ok(self.finalize_scan_vault(completed))
    }

    /// **Una fetta della seconda fase** (§15.7): legge, parsa e alimenta fino a
    /// [`FEED_BATCH`] documenti, e torna.
    ///
    /// Torna perché chi la chiama possa fare, fra una fetta e l'altra, le due
    /// cose che una chiamata sola non lascia fare: **guardare la bandiera**
    /// dell'annullamento e **timbrare un progresso**. È la stessa forma con cui
    /// il §20.1 taglia l'alimentazione, applicata un piano più in su: là la
    /// fetta serve a chi riceve, qui serve a chi guarda.
    ///
    /// Chiamarla su un'[`Indicizzazione`] già finita non fa niente.
    ///
    /// **Non è la porta di chi ha i thread**, ed è `pub(crate)` apposta: da
    /// fuori dal kernel una fetta si prepara con [`plan_batch`](Workspace::plan_batch)
    /// e si applica con
    /// [`index_batch_prepared`](Workspace::index_batch_prepared), così la forma
    /// che tiene il prestito esclusivo attraverso il disco **non si scrive**.
    /// Qui resta perché `reindex` è sincrono per definizione: chi lo chiama ha
    /// già il `&mut`, e non c'è nessuno da non far aspettare.
    pub(crate) fn index_batch(&mut self, work: &mut Indexing) {
        let prepared = self.plan_batch(work);
        self.index_batch_prepared(prepared);
    }
}
